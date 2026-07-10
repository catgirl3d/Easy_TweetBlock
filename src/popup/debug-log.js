(() => {
  const POPUP_LOG_PREFIX = '[Easy TweetBlock][popup]';
  const MAX_POPUP_DEBUG_ENTRIES = 120;
  const popupDebugEntriesCache = new Map();

  function safeSerializePopupDetails(details) {
    if (details === undefined) {
      return '';
    }

    if (details instanceof Error) {
      return details.stack || details.message;
    }

    if (typeof details === 'string') {
      return details;
    }

    try {
      return JSON.stringify(details, (_key, value) => {
        if (value instanceof Error) {
          return {
            message: value.message,
            name: value.name,
            stack: value.stack || null
          };
        }

        return value;
      }, 2);
    } catch {
      return String(details);
    }
  }

  function getPopupDebugCacheKey(storageRef = globalThis.localStorage) {
    return storageRef && (typeof storageRef === 'object' || typeof storageRef === 'function')
      ? storageRef
      : globalThis;
  }

  function normalizePopupDebugEntries(entries) {
    return Array.isArray(entries)
      ? entries.filter((entry) => typeof entry === 'string').slice(-MAX_POPUP_DEBUG_ENTRIES)
      : [];
  }

  function setCachedPopupDebugEntries(entries, storageRef = globalThis.localStorage) {
    const normalizedEntries = normalizePopupDebugEntries(entries);
    const cacheKey = getPopupDebugCacheKey(storageRef);

    popupDebugEntriesCache.set(cacheKey, normalizedEntries);
    return normalizedEntries;
  }

  function getMutablePopupDebugEntries(storageRef = globalThis.localStorage) {
    const cacheKey = getPopupDebugCacheKey(storageRef);

    if (popupDebugEntriesCache.has(cacheKey)) {
      return popupDebugEntriesCache.get(cacheKey);
    }

    return setCachedPopupDebugEntries([], storageRef);
  }

  function loadStoredPopupDebugEntries(storageRef = globalThis.localStorage) {
    return [...getMutablePopupDebugEntries(storageRef)];
  }

  function saveStoredPopupDebugEntries(entries, storageRef = globalThis.localStorage) {
    setCachedPopupDebugEntries(entries, storageRef);
  }

  function appendPopupDebugEntry(level, message, details, storageRef = globalThis.localStorage) {
    const timestamp = new Date().toISOString();
    const detailsText = safeSerializePopupDetails(details);
    const composedEntry = detailsText
      ? `${timestamp} ${level} ${message}\n${detailsText}`
      : `${timestamp} ${level} ${message}`;
    const entries = getMutablePopupDebugEntries(storageRef);

    entries.push(composedEntry);

    if (entries.length > MAX_POPUP_DEBUG_ENTRIES) {
      entries.splice(0, entries.length - MAX_POPUP_DEBUG_ENTRIES);
    }

    return composedEntry;
  }

  function clearStoredPopupDebugEntries(storageRef = globalThis.localStorage) {
    setCachedPopupDebugEntries([], storageRef);
  }

  function renderPopupDebugLog(debugElement, storageRef = globalThis.localStorage) {
    if (!debugElement) {
      return '';
    }

    const entries = loadStoredPopupDebugEntries(storageRef);
    const renderedValue = entries.length ? entries.join('\n\n') : 'No popup debug events recorded yet.';

    debugElement.textContent = renderedValue;
    return renderedValue;
  }

  function logPopupInfo(message, details) {
    appendPopupDebugEntry('INFO', message, details);

    if (details === undefined) {
      console.info(POPUP_LOG_PREFIX, message);
      return;
    }

    console.info(POPUP_LOG_PREFIX, message, details);
  }

  function logPopupWarn(message, details) {
    appendPopupDebugEntry('WARN', message, details);

    if (details === undefined) {
      console.warn(POPUP_LOG_PREFIX, message);
      return;
    }

    console.warn(POPUP_LOG_PREFIX, message, details);
  }

  function logPopupError(message, error) {
    appendPopupDebugEntry('ERROR', message, error);

    if (error === undefined) {
      console.error(POPUP_LOG_PREFIX, message);
      return;
    }

    console.error(POPUP_LOG_PREFIX, message, error);
  }

  function formatPopupError(error) {
    if (error instanceof Error) {
      return error.stack || error.message;
    }

    if (typeof error === 'string') {
      return error;
    }

    try {
      return JSON.stringify(error, null, 2);
    } catch {
      return String(error);
    }
  }

  function renderFatalPopupError(error, documentRef = globalThis.document) {
    const message = formatPopupError(error);
    const debugLog = loadStoredPopupDebugEntries().join('\n\n');

    logPopupError('Fatal popup error.', error);

    if (!documentRef?.body) {
      return message;
    }

    documentRef.body.textContent = `Easy TweetBlock popup failed to load.\n\n${message}${debugLog ? `\n\nDebug log:\n\n${debugLog}` : ''}`;
    return message;
  }

  function registerPopupErrorHandlers(globalRef = globalThis, documentRef = globalRef?.document || globalThis.document) {
    if (!globalRef?.addEventListener || globalRef.__easyTweetBlockPopupErrorHandlersAttached__) {
      return;
    }

    globalRef.addEventListener('error', (event) => {
      event?.preventDefault?.();
      renderFatalPopupError(event?.error || event?.message || 'Unknown popup error', documentRef);
    });
    globalRef.addEventListener('unhandledrejection', (event) => {
      event?.preventDefault?.();
      renderFatalPopupError(event?.reason || 'Unhandled popup promise rejection', documentRef);
    });

    globalRef.__easyTweetBlockPopupErrorHandlersAttached__ = true;
  }

  const popupDebugApi = {
    appendPopupDebugEntry,
    clearStoredPopupDebugEntries,
    formatPopupError,
    loadStoredPopupDebugEntries,
    logPopupError,
    logPopupInfo,
    logPopupWarn,
    registerPopupErrorHandlers,
    renderFatalPopupError,
    renderPopupDebugLog,
    safeSerializePopupDetails,
    saveStoredPopupDebugEntries
  };

  globalThis.EasyTweetBlockPopupDebug = popupDebugApi;

  if (typeof module !== 'undefined') {
    module.exports = popupDebugApi;
  }
})();
