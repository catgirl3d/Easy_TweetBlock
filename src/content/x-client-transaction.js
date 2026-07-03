(() => {
  const namespace = globalThis.EasyTweetBlockContent || (globalThis.EasyTweetBlockContent = {});
  const TRANSACTION_LOG_PREFIX = '[Easy TweetBlock][transaction]';
  const ON_DEMAND_CHUNK_NAME = 'ondemand.s';
  const TRANSACTION_CACHE_TTL_MS = 10 * 60 * 1000;
  const X_TRANSACTION_EPOCH_SECONDS = 1682924400;
  const TRANSACTION_KEYWORD = 'obfiowerehiring';
  const ADDITIONAL_RANDOM_NUMBER = 3;
  const INDICES_REGEX = /\(\w\[(\d{1,2})\],\s*16\)/g;
  const ON_DEMAND_FILE_HASH_REGEX = /(\d+):\s*["']ondemand\.s["'][\s\S]*?\}\)\[e\]\s*\|\|\s*e\)\s*\+\s*["']\.["']\s*\+\s*\(\{[\s\S]*?\b\1:\s*["']([a-zA-Z0-9_-]+)["']/s;

  function logTransactionInfo(message, details) {
    if (details === undefined) {
      console.info(TRANSACTION_LOG_PREFIX, message);
      return;
    }

    console.info(TRANSACTION_LOG_PREFIX, message, details);
  }

  function logTransactionError(message, error) {
    if (error === undefined) {
      console.error(TRANSACTION_LOG_PREFIX, message);
      return;
    }

    console.error(TRANSACTION_LOG_PREFIX, message, error);
  }

  class Cubic {
    constructor(curves) {
      this.curves = Array.isArray(curves) ? curves : [];
    }

    calculate(a, b, m) {
      return (3 * a * (1 - m) * (1 - m) * m) + (3 * b * (1 - m) * m * m) + (m * m * m);
    }

    getValue(time) {
      let startGradient = 0;
      let endGradient = 0;
      let start = 0;
      let mid = 0;
      let end = 1;

      if (time <= 0) {
        if (this.curves[0] > 0) {
          startGradient = this.curves[1] / this.curves[0];
        } else if (this.curves[1] === 0 && this.curves[2] > 0) {
          startGradient = this.curves[3] / this.curves[2];
        }

        return startGradient * time;
      }

      if (time >= 1) {
        if (this.curves[2] < 1) {
          endGradient = (this.curves[3] - 1) / (this.curves[2] - 1);
        } else if (this.curves[2] === 1 && this.curves[0] < 1) {
          endGradient = (this.curves[1] - 1) / (this.curves[0] - 1);
        }

        return 1 + endGradient * (time - 1);
      }

      while (start < end) {
        mid = (start + end) / 2;
        const xEstimate = this.calculate(this.curves[0], this.curves[2], mid);

        if (Math.abs(time - xEstimate) < 0.00001) {
          return this.calculate(this.curves[1], this.curves[3], mid);
        }

        if (xEstimate < time) {
          start = mid;
        } else {
          end = mid;
        }
      }

      return this.calculate(this.curves[1], this.curves[3], mid);
    }
  }

  function interpolateNum(fromValue, toValue, factor) {
    if (typeof fromValue === 'number' && typeof toValue === 'number') {
      return fromValue * (1 - factor) + toValue * factor;
    }

    if (typeof fromValue === 'boolean' && typeof toValue === 'boolean') {
      return factor < 0.5 ? (fromValue ? 1 : 0) : (toValue ? 1 : 0);
    }

    return 0;
  }

  function interpolate(fromList, toList, factor) {
    if (!Array.isArray(fromList) || !Array.isArray(toList) || fromList.length !== toList.length) {
      throw new Error('Invalid interpolation inputs for X transaction id generation.');
    }

    return fromList.map((fromValue, index) => interpolateNum(fromValue, toList[index], factor));
  }

  function convertRotationToMatrix(rotation) {
    const radians = (rotation * Math.PI) / 180;
    return [Math.cos(radians), -Math.sin(radians), Math.sin(radians), Math.cos(radians)];
  }

  function floatToHex(value) {
    const result = [];
    let quotient = Math.floor(value);
    let fraction = value - quotient;
    let fractionGuard = 0;

    while (quotient > 0) {
      quotient = Math.floor(value / 16);
      const remainder = Math.floor(value - quotient * 16);
      result.unshift(remainder > 9 ? String.fromCharCode(remainder + 55) : remainder.toString());
      value = quotient;
    }

    if (fraction === 0) {
      return result.join('');
    }

    result.push('.');

    while (fraction > 0 && fractionGuard < 16) {
      fraction *= 16;
      const integer = Math.floor(fraction);
      fraction -= integer;
      result.push(integer > 9 ? String.fromCharCode(integer + 55) : integer.toString());
      fractionGuard += 1;
    }

    return result.join('');
  }

  function isOdd(value) {
    return value % 2 ? -1 : 0;
  }

  function decodeBase64ToBytes(value) {
    const normalizedValue = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const paddingLength = (4 - (normalizedValue.length % 4)) % 4;
    const decoded = globalThis.atob(`${normalizedValue}${'='.repeat(paddingLength)}`);
    return Array.from(decoded, (char) => char.charCodeAt(0));
  }

  function encodeBytesToBase64(bytes) {
    let binary = '';

    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }

    return globalThis.btoa(binary);
  }

  function resolveOnDemandFileUrlFromRuntime(runtimeSource) {
    if (typeof runtimeSource !== 'string' || !runtimeSource) {
      return null;
    }

    const match = ON_DEMAND_FILE_HASH_REGEX.exec(runtimeSource);

    if (!match) {
      return null;
    }

    return `https://abs.twimg.com/responsive-web/client-web/${ON_DEMAND_CHUNK_NAME}.${match[2]}a.js`;
  }

  function resolveOnDemandFileUrlFromDocument(documentRef) {
    const runtimeSources = [];
    const scripts = typeof documentRef?.querySelectorAll === 'function'
      ? Array.from(documentRef.querySelectorAll('script'))
      : [];

    for (const script of scripts) {
      const scriptText = script?.textContent || '';

      if (scriptText.includes(ON_DEMAND_CHUNK_NAME)) {
        runtimeSources.push(scriptText);
      }
    }

    if (documentRef?.documentElement?.outerHTML) {
      runtimeSources.push(documentRef.documentElement.outerHTML);
    }

    for (const runtimeSource of runtimeSources) {
      const onDemandFileUrl = resolveOnDemandFileUrlFromRuntime(runtimeSource);

      if (onDemandFileUrl) {
        return onDemandFileUrl;
      }
    }

    return null;
  }

  function extractXClientTransactionIndicesFromScriptText(scriptText) {
    const indices = [];
    let match;

    INDICES_REGEX.lastIndex = 0;

    while ((match = INDICES_REGEX.exec(scriptText || '')) !== null) {
      indices.push(Number.parseInt(match[1], 10));
    }

    if (!indices.length) {
      return null;
    }

    return {
      keyByteIndices: indices.slice(1),
      rowIndex: indices[0]
    };
  }

  function extractXClientTransactionKeyFromDocument(documentRef) {
    const element = typeof documentRef?.querySelector === 'function'
      ? documentRef.querySelector("[name='twitter-site-verification']")
      : null;
    const content = element?.getAttribute?.('content') || '';

    return content || null;
  }

  function getTransactionFrames(documentRef) {
    return typeof documentRef?.querySelectorAll === 'function'
      ? Array.from(documentRef.querySelectorAll("[id^='loading-x-anim']"))
      : [];
  }

  function getFrameDataArray(keyBytes, documentRef) {
    const frames = getTransactionFrames(documentRef);

    if (!frames.length) {
      return [[]];
    }

    const frame = frames[keyBytes[5] % 4];
    const firstChild = frame?.children?.[0];
    const targetChild = firstChild?.children?.[1];
    const pathData = targetChild?.getAttribute?.('d');

    if (!pathData) {
      return [];
    }

    return pathData.substring(9).split('C').map((item) => {
      const cleaned = item.replace(/[^\d]+/g, ' ').trim();
      const parts = cleaned === '' ? [] : cleaned.split(/\s+/);
      return parts.map((part) => Number.parseInt(part, 10));
    });
  }

  function solveFrameValue(value, minimum, maximum, rounding) {
    const result = (value * (maximum - minimum)) / 255 + minimum;
    return rounding ? Math.floor(result) : Math.round(result * 100) / 100;
  }

  function animateTransactionFrame(frames, targetTime) {
    const fromColor = frames.slice(0, 3).concat(1).map(Number);
    const toColor = frames.slice(3, 6).concat(1).map(Number);
    const fromRotation = [0];
    const toRotation = [solveFrameValue(frames[6], 60, 360, true)];
    const curves = frames.slice(7).map((item, index) => solveFrameValue(item, isOdd(index), 1, false));
    const cubic = new Cubic(curves);
    const cubicValue = cubic.getValue(targetTime);
    const color = interpolate(fromColor, toColor, cubicValue).map((value) => (value > 0 ? value : 0));
    const rotation = interpolate(fromRotation, toRotation, cubicValue);
    const matrix = convertRotationToMatrix(rotation[0]);
    const stringParts = color.slice(0, -1).map((value) => Math.round(value).toString(16));

    for (const value of matrix) {
      let rounded = Math.round(value * 100) / 100;

      if (rounded < 0) {
        rounded = -rounded;
      }

      const hexValue = floatToHex(rounded);
      stringParts.push(hexValue.startsWith('.') ? `0${hexValue}`.toLowerCase() : hexValue || '0');
    }

    stringParts.push('0', '0');
    return stringParts.join('').replace(/[.-]/g, '');
  }

  function createAnimationKey(keyBytes, documentRef, rowIndex, keyByteIndices) {
    const totalTime = 4096;
    const frameRowIndex = keyBytes[rowIndex] % 16;
    let frameTime = keyByteIndices.reduce((current, index) => current * (keyBytes[index] % 16), 1);

    frameTime = Math.round(frameTime / 10) * 10;

    const frameDataArray = getFrameDataArray(keyBytes, documentRef);
    const frameRow = frameDataArray?.[frameRowIndex];

    if (!frameRow?.length) {
      throw new Error(`Missing X transaction animation frame data at row ${frameRowIndex}.`);
    }

    return animateTransactionFrame(frameRow, frameTime / totalTime);
  }

  function documentHasTransactionMaterial(documentRef) {
    return Boolean(
      extractXClientTransactionKeyFromDocument(documentRef)
      && getTransactionFrames(documentRef).length
      && resolveOnDemandFileUrlFromDocument(documentRef)
    );
  }

  async function fetchXHomeDocument(options = {}) {
    const {
      baseOrigin = 'https://x.com',
      fetchImpl = globalThis.fetch,
      signal = null
    } = options;

    if (typeof globalThis.DOMParser !== 'function') {
      throw new Error('DOMParser is not available for X transaction document parsing.');
    }

    const homeUrl = new URL('/home', baseOrigin).toString();
    const response = await fetchImpl(homeUrl, {
      credentials: 'include',
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      method: 'GET',
      mode: 'cors',
      signal
    });

    if (!response?.ok || typeof response.text !== 'function') {
      throw new Error(`Failed to fetch X home document for transaction id generation: ${response?.status || 'unknown'}`);
    }

    return new DOMParser().parseFromString(await response.text(), 'text/html');
  }

  async function getTransactionDocument(options = {}) {
    const { documentRef = document } = options;

    if (!documentRef || typeof documentRef.querySelector !== 'function') {
      throw new Error('Missing usable X document for transaction id generation.');
    }

    if (documentHasTransactionMaterial(documentRef)) {
      return documentRef;
    }

    const homeDocument = await fetchXHomeDocument(options);

    if (!documentHasTransactionMaterial(homeDocument)) {
      throw new Error('Fetched X home document does not contain transaction id material.');
    }

    return homeDocument;
  }

  function getTransactionCache() {
    if (!namespace.contentState) {
      namespace.contentState = {};
    }

    if (!namespace.contentState.xClientTransactionCache) {
      namespace.contentState.xClientTransactionCache = new Map();
    }

    return namespace.contentState.xClientTransactionCache;
  }

  async function loadXClientTransactionState(options = {}) {
    const {
      baseOrigin = 'https://x.com',
      documentRef = document,
      fetchImpl = globalThis.fetch,
      signal = null
    } = options;
    const cache = getTransactionCache();
    const cachedEntry = cache.get(baseOrigin);
    const now = Date.now();

    if (cachedEntry && now - cachedEntry.createdAt < TRANSACTION_CACHE_TTL_MS) {
      return cachedEntry.state;
    }

    const transactionDocument = await getTransactionDocument({
      baseOrigin,
      documentRef,
      fetchImpl,
      signal
    });
    const onDemandFileUrl = resolveOnDemandFileUrlFromDocument(transactionDocument);

    if (!onDemandFileUrl) {
      throw new Error('Unable to resolve X ondemand.s file URL for transaction id generation.');
    }

    const onDemandResponse = await fetchImpl(onDemandFileUrl, {
      credentials: 'omit',
      method: 'GET',
      mode: 'cors',
      signal
    });

    if (!onDemandResponse?.ok || typeof onDemandResponse.text !== 'function') {
      throw new Error(`Failed to fetch X ondemand.s file for transaction id generation: ${onDemandResponse?.status || 'unknown'}`);
    }

    const indices = extractXClientTransactionIndicesFromScriptText(await onDemandResponse.text());

    if (!indices) {
      throw new Error('Unable to extract X transaction key byte indices from ondemand.s.');
    }

    const key = extractXClientTransactionKeyFromDocument(transactionDocument);

    if (!key) {
      throw new Error('Unable to extract X transaction site verification key.');
    }

    const keyBytes = decodeBase64ToBytes(key);
    const state = {
      animationKey: createAnimationKey(keyBytes, transactionDocument, indices.rowIndex, indices.keyByteIndices),
      keyBytes
    };

    cache.set(baseOrigin, {
      createdAt: now,
      state
    });
    logTransactionInfo('Initialized X client transaction id generator.', {
      baseOrigin,
      onDemandFileUrl
    });
    return state;
  }

  async function generateXClientTransactionId(method, path, options = {}) {
    const normalizedMethod = String(method || 'GET').toUpperCase();
    const normalizedPath = String(path || '').trim();

    if (!normalizedPath.startsWith('/')) {
      throw new Error('X transaction id generation requires an API path starting with /.');
    }

    const {
      randomByte,
      timeNow
    } = options;
    const state = await loadXClientTransactionState(options);
    const currentTime = Number.isFinite(timeNow)
      ? Math.floor(timeNow)
      : Math.floor((Date.now() - X_TRANSACTION_EPOCH_SECONDS * 1000) / 1000);
    const timeBytes = [
      currentTime & 0xff,
      (currentTime >> 8) & 0xff,
      (currentTime >> 16) & 0xff,
      (currentTime >> 24) & 0xff
    ];
    const data = `${normalizedMethod}!${normalizedPath}!${currentTime}${TRANSACTION_KEYWORD}${state.animationKey}`;
    const dataBuffer = new TextEncoder().encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashBytes = Array.from(new Uint8Array(hashBuffer));
    const normalizedRandomByte = Number.isInteger(randomByte)
      ? Math.max(0, Math.min(255, randomByte))
      : Math.floor(Math.random() * 256);
    const payloadBytes = [
      ...state.keyBytes,
      ...timeBytes,
      ...hashBytes.slice(0, 16),
      ADDITIONAL_RANDOM_NUMBER
    ];
    const output = new Uint8Array([
      normalizedRandomByte,
      ...payloadBytes.map((item) => item ^ normalizedRandomByte)
    ]);

    return encodeBytesToBase64(output).replace(/=/g, '');
  }

  async function tryGenerateXClientTransactionId(method, path, options = {}) {
    try {
      return await generateXClientTransactionId(method, path, options);
    } catch (error) {
      logTransactionError('Failed to generate X client transaction id.', error);
      return null;
    }
  }

  Object.assign(namespace, {
    extractXClientTransactionIndicesFromScriptText,
    extractXClientTransactionKeyFromDocument,
    generateXClientTransactionId,
    resolveOnDemandFileUrlFromRuntime,
    tryGenerateXClientTransactionId
  });

  if (typeof module !== 'undefined') {
    module.exports = {
      extractXClientTransactionIndicesFromScriptText,
      extractXClientTransactionKeyFromDocument,
      generateXClientTransactionId,
      resolveOnDemandFileUrlFromRuntime,
      tryGenerateXClientTransactionId
    };
  }
})();
