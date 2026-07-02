(() => {
  const STORAGE_KEY = 'usernameBlocklist';
  const BATCH_BLOCK_DELAY_MS_STORAGE_KEY = 'batchBlockDelayMs';
  const DEFAULT_BATCH_BLOCK_DELAY_MS = 1000;
  const MIN_BATCH_BLOCK_DELAY_MS = 500;
  const MAX_BATCH_BLOCK_DELAY_MS = 2000;
  const USERNAME_PATTERN = /^[A-Za-z0-9_]{1,15}$/;

  function normalizeUsername(value) {
    if (typeof value !== 'string') {
      return null;
    }

    const normalizedValue = value.trim().replace(/^[@/]+/, '').toLowerCase();

    if (!normalizedValue || !USERNAME_PATTERN.test(normalizedValue)) {
      return null;
    }

    return normalizedValue;
  }

  function normalizeStoredUsernames(usernames) {
    if (!Array.isArray(usernames)) {
      return [];
    }

    const normalizedUsernames = [];
    const seenUsernames = new Set();

    for (const username of usernames) {
      const normalizedUsername = normalizeUsername(username);

      if (!normalizedUsername || seenUsernames.has(normalizedUsername)) {
        continue;
      }

      seenUsernames.add(normalizedUsername);
      normalizedUsernames.push(normalizedUsername);
    }

    return normalizedUsernames;
  }

  function parseUsernameText(text) {
    if (typeof text !== 'string' || !text.trim()) {
      return {
        usernames: [],
        invalidEntries: []
      };
    }

    const usernames = [];
    const invalidEntries = [];
    const seenUsernames = new Set();
    const rawEntries = text.split(/[\s,]+/).map((entry) => entry.trim()).filter(Boolean);

    for (const entry of rawEntries) {
      const normalizedUsername = normalizeUsername(entry);

      if (!normalizedUsername) {
        invalidEntries.push(entry);
        continue;
      }

      if (seenUsernames.has(normalizedUsername)) {
        continue;
      }

      seenUsernames.add(normalizedUsername);
      usernames.push(normalizedUsername);
    }

    return {
      usernames,
      invalidEntries
    };
  }

  function serializeUsernameText(usernames) {
    return normalizeStoredUsernames(usernames).map((username) => `@${username}`).join('\n');
  }

  function normalizeBatchBlockDelayMs(value) {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return DEFAULT_BATCH_BLOCK_DELAY_MS;
    }

    const roundedValue = Math.round(numericValue);
    return Math.min(MAX_BATCH_BLOCK_DELAY_MS, Math.max(MIN_BATCH_BLOCK_DELAY_MS, roundedValue));
  }

  function getExtensionApi(extensionApi = globalThis.browser || globalThis.chrome) {
    return extensionApi || null;
  }

  function callStorageGet(storageArea, query, extensionApi) {
    if (!storageArea) {
      return Promise.resolve({});
    }

    try {
      const maybePromise = storageArea.get(query);

      if (maybePromise && typeof maybePromise.then === 'function') {
        return maybePromise.then((value) => value || {});
      }
    } catch {
      // Fall through to callback mode for older Chrome-style APIs.
    }

    return new Promise((resolve, reject) => {
      storageArea.get(query, (value) => {
        const lastError = extensionApi?.runtime?.lastError;

        if (lastError) {
          reject(new Error(lastError.message || String(lastError)));
          return;
        }

        resolve(value || {});
      });
    });
  }

  function callStorageSet(storageArea, payload, extensionApi) {
    if (!storageArea) {
      return Promise.resolve();
    }

    try {
      const maybePromise = storageArea.set(payload);

      if (maybePromise && typeof maybePromise.then === 'function') {
        return maybePromise;
      }
    } catch {
      // Fall through to callback mode for older Chrome-style APIs.
    }

    return new Promise((resolve, reject) => {
      storageArea.set(payload, () => {
        const lastError = extensionApi?.runtime?.lastError;

        if (lastError) {
          reject(new Error(lastError.message || String(lastError)));
          return;
        }

        resolve();
      });
    });
  }

  async function getStoredUsernames(extensionApi = getExtensionApi()) {
    const storageArea = extensionApi?.storage?.local;
    const storedValues = await callStorageGet(storageArea, [STORAGE_KEY], extensionApi);
    return normalizeStoredUsernames(storedValues?.[STORAGE_KEY]);
  }

  async function setStoredUsernames(usernames, extensionApi = getExtensionApi()) {
    const normalizedUsernames = normalizeStoredUsernames(usernames);
    const storageArea = extensionApi?.storage?.local;

    await callStorageSet(storageArea, {
      [STORAGE_KEY]: normalizedUsernames
    }, extensionApi);

    return normalizedUsernames;
  }

  async function getStoredBatchBlockDelayMs(extensionApi = getExtensionApi()) {
    const storageArea = extensionApi?.storage?.local;
    const storedValues = await callStorageGet(storageArea, [BATCH_BLOCK_DELAY_MS_STORAGE_KEY], extensionApi);
    return normalizeBatchBlockDelayMs(storedValues?.[BATCH_BLOCK_DELAY_MS_STORAGE_KEY]);
  }

  async function setStoredBatchBlockDelayMs(delayMs, extensionApi = getExtensionApi()) {
    const normalizedDelayMs = normalizeBatchBlockDelayMs(delayMs);
    const storageArea = extensionApi?.storage?.local;

    await callStorageSet(storageArea, {
      [BATCH_BLOCK_DELAY_MS_STORAGE_KEY]: normalizedDelayMs
    }, extensionApi);

    return normalizedDelayMs;
  }

  function observeStoredUsernames(listener, extensionApi = getExtensionApi()) {
    const onChangedApi = extensionApi?.storage?.onChanged;

    if (typeof listener !== 'function' || !onChangedApi?.addListener) {
      return () => {};
    }

    const handleStorageChange = (changes, areaName) => {
      if (areaName !== 'local' || !Object.prototype.hasOwnProperty.call(changes, STORAGE_KEY)) {
        return;
      }

      listener(normalizeStoredUsernames(changes[STORAGE_KEY]?.newValue));
    };

    onChangedApi.addListener(handleStorageChange);

    return () => {
      if (typeof onChangedApi.removeListener === 'function') {
        onChangedApi.removeListener(handleStorageChange);
      }
    };
  }

  const blocklistApi = {
    BATCH_BLOCK_DELAY_MS_STORAGE_KEY,
    DEFAULT_BATCH_BLOCK_DELAY_MS,
    MAX_BATCH_BLOCK_DELAY_MS,
    MIN_BATCH_BLOCK_DELAY_MS,
    STORAGE_KEY,
    USERNAME_PATTERN,
    getStoredBatchBlockDelayMs,
    getStoredUsernames,
    normalizeBatchBlockDelayMs,
    normalizeStoredUsernames,
    normalizeUsername,
    observeStoredUsernames,
    parseUsernameText,
    serializeUsernameText,
    setStoredBatchBlockDelayMs,
    setStoredUsernames
  };

  if (typeof module !== 'undefined') {
    module.exports = blocklistApi;
  }

  globalThis.EasyTweetBlockBlocklist = blocklistApi;
})();
