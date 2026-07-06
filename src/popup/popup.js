(() => {
  const PAGE_LOG_PREFIX = '[Easy TweetBlock][page]';
  const POPUP_STATE_STORAGE_KEY = 'easyTweetBlockPopupState';
  const POPUP_LOG_PREFIX = '[Easy TweetBlock][popup]';
  const DEFAULT_STATUS_MESSAGE = 'Save usernames for later, or block the whole list immediately through any open X tab.';
  const OUTDATED_USERNAME_DRAFT_STATUS = 'Unsaved draft was outdated; loaded the saved list.';
  const EXTERNAL_USERNAME_LIST_CHANGE_STATUS = 'The active list changed elsewhere; your unsaved edits were kept.';
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

  function normalizeStoredStatusMessage(statusMessage) {
    const normalizedMessage = typeof statusMessage === 'string' ? statusMessage.trim() : '';

    if (
      normalizedMessage === OUTDATED_USERNAME_DRAFT_STATUS
      || normalizedMessage === EXTERNAL_USERNAME_LIST_CHANGE_STATUS
    ) {
      return normalizedMessage;
    }

    return DEFAULT_STATUS_MESSAGE;
  }

  function getPersistedStatusMessage(statusMessage) {
    const normalizedMessage = typeof statusMessage === 'string' ? statusMessage.trim() : '';

    if (
      normalizedMessage === OUTDATED_USERNAME_DRAFT_STATUS
      || normalizedMessage === EXTERNAL_USERNAME_LIST_CHANGE_STATUS
    ) {
      return normalizedMessage;
    }

    return '';
  }

  function setCachedPopupDebugEntries(entries, storageRef = globalThis.localStorage) {
    const normalizedEntries = normalizePopupDebugEntries(entries);
    const cacheKey = getPopupDebugCacheKey(storageRef);

    popupDebugEntriesCache.set(cacheKey, normalizedEntries);
    globalThis.__easyTweetBlockPopupDebugEntries__ = normalizedEntries;
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

    globalThis.__easyTweetBlockPopupDebugEntries__ = entries;
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

  const contentScriptFilesApi = globalThis.EasyTweetBlockContentScriptFiles
    || (typeof module !== 'undefined' && module.exports ? require('../shared/content-script-files.js') : null);
  const followersApi = globalThis.EasyTweetBlockFollowers
    || (typeof module !== 'undefined' && module.exports ? require('../shared/followers.js') : null);
  const settingsApi = globalThis.EasyTweetBlockSettings
    || (typeof module !== 'undefined' && module.exports ? require('../shared/settings.js') : null);

  if (!contentScriptFilesApi) {
    renderFatalPopupError(new Error('Missing Easy TweetBlock content script file config.'));
    return;
  }

  if (!followersApi) {
    renderFatalPopupError(new Error('Missing Easy TweetBlock followers shared API.'));
    return;
  }

  if (!settingsApi) {
    renderFatalPopupError(new Error('Missing Easy TweetBlock settings shared API.'));
    return;
  }

  const sleep = followersApi.sleep;

  const IMMEDIATE_BLOCK_MESSAGE_TYPE = 'easy-tweetblock:block-usernames-via-api';
  const FOLLOWERS_BLOCK_MESSAGE_TYPE = 'easy-tweetblock:block-follower-candidates-via-api';
  const FOLLOWERS_BLOCK_PROGRESS_MESSAGE_TYPE = 'easy-tweetblock:follower-block-progress';
  const FOLLOWERS_CANCEL_MESSAGE_TYPE = 'easy-tweetblock:cancel-follower-run';
  const FOLLOWERS_SCAN_MESSAGE_TYPE = 'easy-tweetblock:scan-followers-for-block';
  const FOLLOWERS_RUN_PORT_PREFIX = 'easy-tweetblock:follower-run:';
  const POPUP_VIEWS = Object.freeze({
    followers: 'followers',
    main: 'main',
    settings: 'settings'
  });
  const CONTENT_SCRIPT_CSS_FILES = Object.freeze([...contentScriptFilesApi.CONTENT_SCRIPT_CSS_FILES]);
  const CONTENT_SCRIPT_FILES = Object.freeze([...contentScriptFilesApi.CONTENT_SCRIPT_FILES]);

  function normalizePopupView(view) {
    if (view === POPUP_VIEWS.settings || view === POPUP_VIEWS.followers) {
      return view;
    }

    return POPUP_VIEWS.main;
  }

  function setPopupView(shellElement, view) {
    if (!shellElement) {
      return normalizePopupView(view);
    }

    const normalizedView = normalizePopupView(view);
    shellElement.dataset.view = normalizedView;
    return normalizedView;
  }

  function loadStoredPopupState(storageRef = globalThis.localStorage) {
    try {
      const rawValue = storageRef?.getItem?.(POPUP_STATE_STORAGE_KEY);

      if (!rawValue) {
        return {};
      }

      const parsedValue = JSON.parse(rawValue);
      return parsedValue && typeof parsedValue === 'object' && !Array.isArray(parsedValue) ? parsedValue : {};
    } catch {
      return {};
    }
  }

  function saveStoredPopupState(state, storageRef = globalThis.localStorage) {
    try {
      storageRef?.setItem?.(POPUP_STATE_STORAGE_KEY, JSON.stringify(state && typeof state === 'object' ? state : {}));
    } catch {
      // Ignore UI state write failures; the popup remains usable without persistence.
    }
  }

  function clearStoredPopupState(storageRef = globalThis.localStorage) {
    try {
      storageRef?.removeItem?.(POPUP_STATE_STORAGE_KEY);
    } catch {
      // Ignore UI state cleanup failures.
    }
  }

  function getExtensionApi(extensionApi = globalThis.browser || globalThis.chrome) {
    // Canonical storage plumbing lives in src/shared/storage.js; popup keeps this adapter for tab/runtime APIs.
    return extensionApi || null;
  }

  function isSupportedTabUrl(url) {
    return typeof url === 'string'
      && (url.startsWith('https://x.com/') || url.startsWith('https://twitter.com/'));
  }

  function isMissingReceiverError(error) {
    const message = error instanceof Error ? error.message : String(error || '');

    return message.includes('Receiving end does not exist')
      || message.includes('Could not establish connection');
  }

  function queryTabs(queryInfo, extensionApi = getExtensionApi()) {
    try {
      const maybePromise = extensionApi?.tabs?.query?.(queryInfo);

      if (maybePromise && typeof maybePromise.then === 'function') {
        return maybePromise;
      }
    } catch {
      // Fall through to callback mode.
    }

    return new Promise((resolve, reject) => {
      extensionApi.tabs.query(queryInfo, (tabs) => {
        const lastError = extensionApi.runtime?.lastError;

        if (lastError) {
          reject(new Error(lastError.message || String(lastError)));
          return;
        }

        resolve(tabs || []);
      });
    });
  }

  function sendTabMessage(tabId, message, extensionApi = getExtensionApi()) {
    try {
      const maybePromise = extensionApi?.tabs?.sendMessage?.(tabId, message);

      if (maybePromise && typeof maybePromise.then === 'function') {
        return maybePromise;
      }
    } catch {
      // Fall through to callback mode.
    }

    return new Promise((resolve, reject) => {
      extensionApi.tabs.sendMessage(tabId, message, (response) => {
        const lastError = extensionApi.runtime?.lastError;

        if (lastError) {
          reject(new Error(lastError.message || String(lastError)));
          return;
        }

        resolve(response);
      });
    });
  }

  function connectFollowerRunPort(tabId, runId, extensionApi = getExtensionApi()) {
    if (!runId || !extensionApi?.tabs?.connect) {
      return null;
    }

    try {
      return extensionApi.tabs.connect(tabId, {
        name: `${FOLLOWERS_RUN_PORT_PREFIX}${runId}`
      }) || null;
    } catch (error) {
      logPopupError(`Follower run port connection failed for tab ${tabId}.`, error);
      return null;
    }
  }

  function disconnectFollowerRunPort(port) {
    try {
      port?.disconnect?.();
    } catch {
      // The port may already be disconnected when the popup is closing.
    }
  }

  async function sendFollowerRunMessage(tabId, message, extensionApi = getExtensionApi()) {
    const port = connectFollowerRunPort(tabId, message?.runId, extensionApi);

    try {
      return await sendTabMessage(tabId, message, extensionApi);
    } finally {
      disconnectFollowerRunPort(port);
    }
  }

  function executeTabFunction(tabId, func, args = [], extensionApi = getExtensionApi()) {
    if (!extensionApi?.scripting?.executeScript) {
      return Promise.reject(new Error('This browser does not support scripting.executeScript for direct tab execution.'));
    }

    try {
      const maybePromise = extensionApi.scripting.executeScript({
        args,
        func,
        target: { tabId }
      });

      if (maybePromise && typeof maybePromise.then === 'function') {
        return maybePromise;
      }
    } catch {
      // Fall through to callback mode.
    }

    return new Promise((resolve, reject) => {
      extensionApi.scripting.executeScript({
        args,
        func,
        target: { tabId }
      }, (result) => {
        const lastError = extensionApi.runtime?.lastError;

        if (lastError) {
          reject(new Error(lastError.message || String(lastError)));
          return;
        }

        resolve(result || []);
      });
    });
  }

  async function executeScriptsWithLegacyTabs(tabId, files, extensionApi) {
    for (const file of files) {
      try {
        const maybePromise = extensionApi.tabs.executeScript(tabId, { file });

        if (maybePromise && typeof maybePromise.then === 'function') {
          await maybePromise;
          continue;
        }
      } catch {
        // Fall through to callback mode.
      }

      await new Promise((resolve, reject) => {
        extensionApi.tabs.executeScript(tabId, { file }, () => {
          const lastError = extensionApi.runtime?.lastError;

          if (lastError) {
            reject(new Error(lastError.message || String(lastError)));
            return;
          }

          resolve();
        });
      });
    }
  }

  async function insertCssWithLegacyTabs(tabId, files, extensionApi) {
    for (const file of files) {
      try {
        const maybePromise = extensionApi.tabs.insertCSS(tabId, { file });

        if (maybePromise && typeof maybePromise.then === 'function') {
          await maybePromise;
          continue;
        }
      } catch {
        // Fall through to callback mode.
      }

      await new Promise((resolve, reject) => {
        extensionApi.tabs.insertCSS(tabId, { file }, () => {
          const lastError = extensionApi.runtime?.lastError;

          if (lastError) {
            reject(new Error(lastError.message || String(lastError)));
            return;
          }

          resolve();
        });
      });
    }
  }

  function insertCssWithScripting(tabId, file, extensionApi) {
    try {
      const maybePromise = extensionApi?.scripting?.insertCSS?.({
        files: [file],
        target: { tabId }
      });

      if (maybePromise && typeof maybePromise.then === 'function') {
        return maybePromise;
      }
    } catch {
      // Fall through to callback mode.
    }

    return new Promise((resolve, reject) => {
      extensionApi.scripting.insertCSS({
        files: [file],
        target: { tabId }
      }, () => {
        const lastError = extensionApi.runtime?.lastError;

        if (lastError) {
          reject(new Error(lastError.message || String(lastError)));
          return;
        }

        resolve();
      });
    });
  }

  async function ensureContentStylesInTab(tabId, extensionApi = getExtensionApi(), files = CONTENT_SCRIPT_CSS_FILES) {
    if (!Array.isArray(files) || !files.length) {
      return;
    }

    if (extensionApi?.scripting?.insertCSS) {
      for (const file of files) {
        logPopupInfo(`Injecting CSS into tab ${tabId}.`, { file });

        try {
          await insertCssWithScripting(tabId, file, extensionApi);
          logPopupInfo(`Injected CSS into tab ${tabId}.`, { file });
        } catch (error) {
          logPopupError(`Failed to inject CSS into tab ${tabId}.`, {
            error,
            file
          });
          throw error;
        }
      }

      return;
    }

    if (extensionApi?.tabs?.insertCSS) {
      await insertCssWithLegacyTabs(tabId, files, extensionApi);
    }
  }

  function executeScriptsWithScripting(tabId, files, extensionApi) {
    try {
      const maybePromise = extensionApi?.scripting?.executeScript?.({
        files,
        target: { tabId }
      });

      if (maybePromise && typeof maybePromise.then === 'function') {
        return maybePromise;
      }
    } catch {
      // Fall through to callback mode.
    }

    return new Promise((resolve, reject) => {
      extensionApi.scripting.executeScript({
        files,
        target: { tabId }
      }, (result) => {
        const lastError = extensionApi.runtime?.lastError;

        if (lastError) {
          reject(new Error(lastError.message || String(lastError)));
          return;
        }

        resolve(result);
      });
    });
  }

  async function ensureContentScriptsInTab(tabId, extensionApi = getExtensionApi(), files = CONTENT_SCRIPT_FILES, cssFiles = CONTENT_SCRIPT_CSS_FILES) {
    await ensureContentStylesInTab(tabId, extensionApi, cssFiles);

    if (extensionApi?.scripting?.executeScript) {
      logPopupInfo(`Injecting script batch into tab ${tabId}.`, { files });

      try {
        await executeScriptsWithScripting(tabId, files, extensionApi);
        logPopupInfo(`Injected script batch into tab ${tabId}.`, { files });
      } catch (error) {
        logPopupError(`Failed to inject script batch into tab ${tabId}.`, {
          error,
          files
        });
        throw error;
      }

      return;
    }

    if (extensionApi?.tabs?.executeScript) {
      await executeScriptsWithLegacyTabs(tabId, files, extensionApi);
      return;
    }

    throw new Error('This browser does not expose a script injection API for the selected tab. Reload the X tab and retry.');
  }

  async function invokeImmediateBlockInTab(tabId, usernames, delayMs, extensionApi = getExtensionApi()) {
    const results = await executeTabFunction(
      tabId,
      async (requestedUsernames, requestedDelayMs) => {
        if (typeof globalThis.EasyTweetBlockRunImmediateBlock !== 'function') {
          throw new Error('Easy TweetBlock immediate block runner is not available in this tab.');
        }

        return globalThis.EasyTweetBlockRunImmediateBlock(requestedUsernames, requestedDelayMs);
      },
      [usernames, delayMs],
      extensionApi
    );
    const firstResult = Array.isArray(results) ? results[0] : null;

    return {
      ok: true,
      results: firstResult?.result || []
    };
  }

  async function requestImmediateBlock(tabId, usernames, delayMs, extensionApi = getExtensionApi()) {
    try {
      return await sendTabMessage(tabId, {
        delayMs,
        type: IMMEDIATE_BLOCK_MESSAGE_TYPE,
        usernames
      }, extensionApi);
    } catch (error) {
      if (!isMissingReceiverError(error)) {
        throw error;
      }

      logPopupInfo(`Immediate block content script missing in tab ${tabId}; injecting logic scripts without CSS.`, {
        delayMs,
        usernames
      });
      await ensureContentScriptsInTab(tabId, extensionApi, CONTENT_SCRIPT_FILES, []);

      return invokeImmediateBlockInTab(tabId, usernames, delayMs, extensionApi);
    }
  }

  async function requestMessageWithContentScript(tabId, message, extensionApi = getExtensionApi()) {
    try {
      logPopupInfo(`Sending message to tab ${tabId}.`, message);
      return await sendTabMessage(tabId, message, extensionApi);
    } catch (error) {
      if (!isMissingReceiverError(error)) {
        logPopupError(`Message delivery failed for tab ${tabId}.`, {
          error,
          message
        });
        throw error;
      }

      logPopupInfo(`Content script missing in tab ${tabId}; injecting before retry.`, message);
      await ensureContentScriptsInTab(tabId, extensionApi);
      logPopupInfo(`Retrying message after content script injection for tab ${tabId}.`, message);
      return sendTabMessage(tabId, message, extensionApi);
    }
  }

  async function invokeFollowersPreviewInTab(tabId, blockLimit, scanLimit, source, extensionApi = getExtensionApi(), runId = null) {
    const port = connectFollowerRunPort(tabId, runId, extensionApi);

    try {
      const results = await executeTabFunction(
        tabId,
        async (requestedBlockLimit, requestedScanLimit, requestedSource, requestedRunId) => {
          if (typeof globalThis.EasyTweetBlockContent?.scanFollowersForBlocking !== 'function') {
            throw new Error('Easy TweetBlock followers preview runner is not available in this tab.');
          }

          const followerRun = globalThis.EasyTweetBlockContent.startFollowerRun?.(requestedRunId) || {};

          try {
            return await globalThis.EasyTweetBlockContent.scanFollowersForBlocking({
              blockLimit: requestedBlockLimit,
              scanLimit: requestedScanLimit,
              source: requestedSource
            }, {
              signal: followerRun.signal || null
            });
          } finally {
            globalThis.EasyTweetBlockContent.finishFollowerRun?.(followerRun.runId, followerRun.controller);
          }
        },
        [blockLimit, scanLimit, source, runId],
        extensionApi
      );
      const firstResult = Array.isArray(results) ? results[0] : null;

      if (!firstResult || firstResult.result == null) {
        throw new Error('Followers preview direct execution returned no result.');
      }

      return {
        ok: true,
        preview: firstResult.result
      };
    } finally {
      disconnectFollowerRunPort(port);
    }
  }

  async function invokeFollowerBlocksInTab(tabId, candidates, delayMs, extensionApi = getExtensionApi(), runId = null) {
    const port = connectFollowerRunPort(tabId, runId, extensionApi);

    try {
      const results = await executeTabFunction(
        tabId,
        async (requestedCandidates, requestedDelayMs, requestedRunId, progressMessageType) => {
          if (typeof globalThis.EasyTweetBlockContent?.blockFollowerCandidatesViaApi !== 'function') {
            throw new Error('Easy TweetBlock follower block runner is not available in this tab.');
          }

          const followerRun = globalThis.EasyTweetBlockContent.startFollowerRun?.(requestedRunId) || {};
          const extensionRuntime = globalThis.browser?.runtime || globalThis.chrome?.runtime || null;

          function reportProgress(progress) {
            if (!extensionRuntime?.sendMessage || !progressMessageType) {
              return;
            }

            try {
              const maybePromise = extensionRuntime.sendMessage({
                progress,
                runId: requestedRunId || null,
                type: progressMessageType
              });

              if (maybePromise && typeof maybePromise.catch === 'function') {
                maybePromise.catch(() => {});
              }
            } catch {
              // Popup progress updates are best-effort during direct execution fallback.
            }
          }

          try {
            return await globalThis.EasyTweetBlockContent.blockFollowerCandidatesViaApi(requestedCandidates, {
              delayMs: requestedDelayMs,
              onProgress: reportProgress,
              signal: followerRun.signal || null
            });
          } finally {
            globalThis.EasyTweetBlockContent.finishFollowerRun?.(followerRun.runId, followerRun.controller);
          }
        },
        [candidates, delayMs, runId, FOLLOWERS_BLOCK_PROGRESS_MESSAGE_TYPE],
        extensionApi
      );
      const firstResult = Array.isArray(results) ? results[0] : null;

      if (!firstResult || !Array.isArray(firstResult.result)) {
        throw new Error('Follower block direct execution returned no result array.');
      }

      return {
        ok: true,
        results: firstResult.result
      };
    } finally {
      disconnectFollowerRunPort(port);
    }
  }

  async function requestFollowersPreview(tabId, blockLimit, scanLimit, source, extensionApi = getExtensionApi(), runId = null) {
    const message = {
      options: {
        blockLimit,
        scanLimit,
        source
      },
      type: FOLLOWERS_SCAN_MESSAGE_TYPE
    };

    if (runId) {
      message.runId = runId;
    }

    try {
      return await sendFollowerRunMessage(tabId, message, extensionApi);
    } catch (error) {
      if (!isMissingReceiverError(error)) {
        logPopupError(`Followers preview message delivery failed for tab ${tabId}.`, error);
        throw error;
      }

      logPopupInfo(`Followers preview content script missing in tab ${tabId}; injecting before direct execution fallback.`, {
        blockLimit,
        scanLimit,
        source
      });
      await ensureContentScriptsInTab(tabId, extensionApi, CONTENT_SCRIPT_FILES, []);
      logPopupInfo(`Retrying followers preview message in tab ${tabId} after injection.`, {
        blockLimit,
        scanLimit,
        source
      });

      try {
        await sleep(50);
        return await sendFollowerRunMessage(tabId, message, extensionApi);
      } catch (retryError) {
        logPopupError(`Followers preview message retry failed for tab ${tabId}; falling back to direct execution.`, retryError);
        logPopupInfo(`Invoking followers preview directly in tab ${tabId} after message retry failure.`, {
          blockLimit,
          scanLimit,
          source
        });
        return invokeFollowersPreviewInTab(tabId, blockLimit, scanLimit, source, extensionApi, runId);
      }
    }
  }

  async function requestFollowerBlocks(tabId, candidates, delayMs, extensionApi = getExtensionApi(), runId = null) {
    const message = {
      candidates,
      delayMs,
      type: FOLLOWERS_BLOCK_MESSAGE_TYPE
    };

    if (runId) {
      message.runId = runId;
    }

    try {
      return await sendFollowerRunMessage(tabId, message, extensionApi);
    } catch (error) {
      if (!isMissingReceiverError(error)) {
        logPopupError(`Follower block message delivery failed for tab ${tabId}.`, error);
        throw error;
      }

      logPopupInfo(`Follower block content script missing in tab ${tabId}; injecting before direct execution fallback.`, {
        candidateCount: Array.isArray(candidates) ? candidates.length : 0,
        delayMs
      });
      await ensureContentScriptsInTab(tabId, extensionApi, CONTENT_SCRIPT_FILES, []);
      logPopupInfo(`Retrying follower block message in tab ${tabId} after injection.`, {
        candidateCount: Array.isArray(candidates) ? candidates.length : 0,
        delayMs
      });

      try {
        await sleep(50);
        return await sendFollowerRunMessage(tabId, message, extensionApi);
      } catch (retryError) {
        logPopupError(`Follower block message retry failed for tab ${tabId}; falling back to direct execution.`, retryError);
        logPopupInfo(`Invoking follower block run directly in tab ${tabId} after message retry failure.`, {
          candidateCount: Array.isArray(candidates) ? candidates.length : 0,
          delayMs
        });
        return invokeFollowerBlocksInTab(tabId, candidates, delayMs, extensionApi, runId);
      }
    }
  }

  async function requestCancelFollowerRun(tabId, runId, extensionApi = getExtensionApi()) {
    if (!runId) {
      return { canceled: false, ok: false };
    }

    return sendTabMessage(tabId, {
      runId,
      type: FOLLOWERS_CANCEL_MESSAGE_TYPE
    }, extensionApi);
  }

  function isFollowerRunCanceledError(error) {
    return error?.name === 'AbortError';
  }

  async function findActiveXTab(extensionApi = getExtensionApi()) {
    const activeTabs = await queryTabs({ active: true, currentWindow: true }, extensionApi);
    return activeTabs.find((tab) => tab?.id != null && isSupportedTabUrl(tab?.url)) || null;
  }

  async function findUsableXTab(extensionApi = getExtensionApi()) {
    const activeTab = await findActiveXTab(extensionApi);

    if (activeTab?.id != null) {
      return activeTab;
    }

    const xTabs = await queryTabs({ url: ['https://x.com/*', 'https://twitter.com/*'] }, extensionApi);
    return xTabs.find((tab) => tab?.id != null && isSupportedTabUrl(tab?.url)) || null;
  }

  async function emitPopupOpenDebug(extensionApi = getExtensionApi()) {
    const popupDetails = {
      openedAt: new Date().toISOString(),
      popupUrl: globalThis.location?.href || null,
      readyState: globalThis.document?.readyState || null
    };

    logPopupWarn('Popup opened.', popupDetails);

    try {
      const activeTab = await findActiveXTab(extensionApi);

      if (!activeTab?.id) {
        logPopupWarn('Popup open debug: no active X tab to echo into page console.', popupDetails);
        return;
      }

      const echoPayload = {
        popup: popupDetails,
        tab: {
          id: activeTab.id,
          url: activeTab.url || null
        }
      };

      await executeTabFunction(
        activeTab.id,
        (details, prefix) => {
          console.warn(prefix, 'Popup opened from extension.', details);
          return true;
        },
        [echoPayload, PAGE_LOG_PREFIX],
        extensionApi
      );
      logPopupWarn('Popup open debug echoed into active X tab console.', echoPayload.tab);
    } catch (error) {
      logPopupError('Popup open debug failed to echo into active X tab console.', error);
    }
  }

  function init(documentRef = document, extensionApi = getExtensionApi(), blocklist = globalThis.EasyTweetBlockBlocklist, followers = followersApi, settings = globalThis.EasyTweetBlockSettings || settingsApi) {
    const DEFAULT_FOLLOWERS_SUMMARY = 'Open a profile, followers, or following page in the active X tab, then run a preview scan.';
    const shellElement = documentRef.getElementById('popup-shell');
    const statusElement = documentRef.getElementById('status');
    const textareaElement = documentRef.getElementById('username-blocklist');
    const usernameListSelectLabelElement = documentRef.getElementById('username-list-select-label');
    const usernameListSelectElement = documentRef.getElementById('username-list-select');
    const usernameListOptionsElement = documentRef.getElementById('username-list-options');
    const newUsernameListButton = documentRef.getElementById('new-username-list');
    const renameUsernameListButton = documentRef.getElementById('rename-username-list');
    const deleteUsernameListButton = documentRef.getElementById('delete-username-list');
    const importUsernamesButton = documentRef.getElementById('import-usernames');
    const importUsernamesFileInput = documentRef.getElementById('import-usernames-file');
    const delayInputElement = documentRef.getElementById('batch-block-delay-ms');
    const pageButtonStyleTweetIconElement = documentRef.getElementById('page-button-style-tweet-icon');
    const pageButtonStyleTweetTextElement = documentRef.getElementById('page-button-style-tweet-text');
    const pageButtonStyleProfileIconElement = documentRef.getElementById('page-button-style-profile-icon');
    const pageButtonStyleProfileTextElement = documentRef.getElementById('page-button-style-profile-text');
    const pageButtonStyleUserCellIconElement = documentRef.getElementById('page-button-style-user-cell-icon');
    const pageButtonStyleUserCellTextElement = documentRef.getElementById('page-button-style-user-cell-text');
    const userCellAddButtonStyleIconElement = documentRef.getElementById('user-cell-add-button-style-icon');
    const userCellAddButtonStyleTextElement = documentRef.getElementById('user-cell-add-button-style-text');
    const showUserCellAddButtonElement = documentRef.getElementById('show-user-cell-add-button');
    const openSettingsButton = documentRef.getElementById('open-settings');
    const openFollowersButton = documentRef.getElementById('open-followers');
    const backToMainButton = documentRef.getElementById('back-to-main');
    const backFromFollowersButton = documentRef.getElementById('back-from-followers');
    const saveButton = documentRef.getElementById('save-blocklist');
    const saveSettingsButton = documentRef.getElementById('save-settings');
    const blockNowButton = documentRef.getElementById('block-now');
    const clearListButton = documentRef.getElementById('clear-list');
    const cancelFollowersRunButton = documentRef.getElementById('cancel-followers-run');
    const addFollowersToListButton = documentRef.getElementById('add-followers-to-list');
    const countElement = documentRef.getElementById('username-count');
    const followersBlockLimitElement = documentRef.getElementById('followers-block-limit');
    const followersScanLimitElement = documentRef.getElementById('followers-scan-limit');
    const followersSummaryElement = documentRef.getElementById('followers-summary');
    const followersPreviewElement = documentRef.getElementById('followers-preview');
    const followersBlockProgressElement = documentRef.getElementById('followers-block-progress');
    const followersProgressCountElement = documentRef.getElementById('followers-progress-count');
    const followersProgressDetailElement = documentRef.getElementById('followers-progress-detail');
    const followersProgressFillElement = documentRef.getElementById('followers-progress-fill');
    const followersProgressLabelElement = documentRef.getElementById('followers-progress-label');
    const followersSourceFollowersElement = documentRef.getElementById('followers-source-followers');
    const followersSourceFollowingElement = documentRef.getElementById('followers-source-following');
    const scanFollowersButton = documentRef.getElementById('scan-followers-preview');
    const blockFollowerCandidatesButton = documentRef.getElementById('block-follower-candidates');
    const popupDebugLogElement = documentRef.getElementById('popup-debug-log');
    const clearPopupDebugLogButton = documentRef.getElementById('clear-popup-debug-log');

    const pageButtonStyleSurfaces = settings?.PAGE_BUTTON_STYLE_SURFACES || {
      profile: 'profile',
      tweet: 'tweet',
      userCell: 'user-cell'
    };
    const normalizePageButtonStylesValue = (value) => {
      if (typeof settings?.normalizePageBlockButtonStyles === 'function') {
        return settings.normalizePageBlockButtonStyles(value);
      }

      const fallbackStyle = value === 'text' ? 'text' : 'icon';
      return {
        [pageButtonStyleSurfaces.tweet]: fallbackStyle,
        [pageButtonStyleSurfaces.profile]: fallbackStyle,
        [pageButtonStyleSurfaces.userCell]: fallbackStyle
      };
    };
    const pageButtonStyleControls = {
      [pageButtonStyleSurfaces.tweet]: {
        icon: pageButtonStyleTweetIconElement,
        text: pageButtonStyleTweetTextElement
      },
      [pageButtonStyleSurfaces.profile]: {
        icon: pageButtonStyleProfileIconElement,
        text: pageButtonStyleProfileTextElement
      },
      [pageButtonStyleSurfaces.userCell]: {
        icon: pageButtonStyleUserCellIconElement,
        text: pageButtonStyleUserCellTextElement
      }
    };
    const userCellAddButtonStyleControls = {
      icon: userCellAddButtonStyleIconElement,
      text: userCellAddButtonStyleTextElement
    };
    let isSaving = false;
    let isBlocking = false;
    let isFollowersScanning = false;
    let isFollowersBlocking = false;
    let currentFollowerRunTabId = null;
    let currentDelayMs = settings?.DEFAULT_BATCH_BLOCK_DELAY_MS;
    let currentPageButtonStyles = normalizePageButtonStylesValue(
      settings?.DEFAULT_PAGE_BLOCK_BUTTON_STYLES || settings?.DEFAULT_PAGE_BLOCK_BUTTON_STYLE
    );
    let currentUserCellAddButtonStyle = settings?.DEFAULT_USER_CELL_ADD_BUTTON_STYLE || settings?.DEFAULT_PAGE_BLOCK_BUTTON_STYLE || settings?.PAGE_BLOCK_BUTTON_STYLES?.icon || 'icon';
    let currentShowUserCellAddButton = settings?.DEFAULT_USER_CELL_ADD_BUTTON_VISIBILITY;
    let currentFollowersBlockLimit = followers?.DEFAULT_FOLLOWERS_BLOCK_LIMIT;
    let currentFollowersBlockRunId = null;
    let currentFollowersPreview = null;
    let currentFollowersScanLimit = followers?.DEFAULT_FOLLOWERS_SCAN_LIMIT;
    let currentFollowersScanRunId = null;
    let currentFollowersSource = followers?.DEFAULT_FOLLOWERS_SOURCE;
    let draftPageButtonStyles = { ...currentPageButtonStyles };
    let draftUserCellAddButtonStyle = currentUserCellAddButtonStyle;
    const storedPopupState = loadStoredPopupState();
    let currentUsernameLists = [];
    let currentActiveUsernameList = null;
    let currentActiveUsernameListId = null;
    let isUsernameDraftDirty = false;
    let isUsernameListDropdownOpen = false;
    let highlightedUsernameListIndex = -1;
    let draftListId = null;
    const usernameDrafts = storedPopupState.usernameDrafts && typeof storedPopupState.usernameDrafts === 'object' && !Array.isArray(storedPopupState.usernameDrafts)
      ? { ...storedPopupState.usernameDrafts }
      : {};
    let isHydratingPopupState = true;

    if (!blocklist || !followers || !settings || !extensionApi || !shellElement || !statusElement || !textareaElement || !usernameListSelectLabelElement || !usernameListSelectElement || !usernameListOptionsElement || !newUsernameListButton || !renameUsernameListButton || !deleteUsernameListButton || !importUsernamesButton || !importUsernamesFileInput || !delayInputElement || !pageButtonStyleTweetIconElement || !pageButtonStyleTweetTextElement || !pageButtonStyleProfileIconElement || !pageButtonStyleProfileTextElement || !pageButtonStyleUserCellIconElement || !pageButtonStyleUserCellTextElement || !showUserCellAddButtonElement || !openSettingsButton || !openFollowersButton || !backToMainButton || !backFromFollowersButton || !saveButton || !saveSettingsButton || !blockNowButton || !cancelFollowersRunButton || !countElement || !followersBlockLimitElement || !followersScanLimitElement || !followersSummaryElement || !followersPreviewElement || !followersBlockProgressElement || !followersProgressCountElement || !followersProgressDetailElement || !followersProgressFillElement || !followersProgressLabelElement || !followersSourceFollowersElement || !followersSourceFollowingElement || !scanFollowersButton || !blockFollowerCandidatesButton || !popupDebugLogElement || !clearPopupDebugLogButton || !addFollowersToListButton || !clearListButton) {
      return;
    }

    async function readStoredPageButtonStyles() {
      return settings.getStoredPageBlockButtonStyles(extensionApi);
    }

    async function writeStoredPageButtonStyles(styles) {
      return settings.setStoredPageBlockButtonStyles(styles, extensionApi);
    }

    async function readStoredUserCellAddButtonStyle() {
      if (typeof settings.getStoredUserCellAddButtonStyle === 'function') {
        return settings.getStoredUserCellAddButtonStyle(extensionApi);
      }

      return settings.normalizePageBlockButtonStyle(settings.DEFAULT_USER_CELL_ADD_BUTTON_STYLE || settings.DEFAULT_PAGE_BLOCK_BUTTON_STYLE);
    }

    async function writeStoredUserCellAddButtonStyle(style) {
      if (typeof settings.setStoredUserCellAddButtonStyle === 'function') {
        return settings.setStoredUserCellAddButtonStyle(style, extensionApi);
      }

      return settings.normalizePageBlockButtonStyle(style);
    }

    void emitPopupOpenDebug(extensionApi);

    function normalizeStoredFollowersPreview(preview) {
      if (!preview || typeof preview !== 'object' || !Array.isArray(preview.candidates)) {
        return null;
      }

      const candidates = preview.candidates
        .filter((candidate) => candidate && typeof candidate === 'object')
        .map((candidate) => ({
          restId: candidate.restId == null ? null : String(candidate.restId),
          username: candidate.username == null ? null : String(candidate.username)
        }))
        .filter((candidate) => candidate.restId || candidate.username);

      return {
        alreadyBlockedCount: Math.max(0, Math.round(Number(preview.alreadyBlockedCount) || 0)),
        blockLimit: followers.normalizeFollowersBlockLimit(preview.blockLimit),
        candidates,
        hasMorePages: Boolean(preview.hasMorePages),
        readyCount: Math.max(0, Math.round(Number(preview.readyCount) || candidates.length)),
        scanLimit: followers.normalizeFollowersScanLimit(preview.scanLimit),
        scannedCount: Math.max(0, Math.round(Number(preview.scannedCount) || 0)),
        source: followers.normalizeFollowersSource(preview.source),
        targetRestId: preview.targetRestId == null ? null : String(preview.targetRestId),
        targetScreenName: preview.targetScreenName == null ? null : String(preview.targetScreenName)
      };
    }

    function persistCurrentPopupState() {
      if (isHydratingPopupState) {
        return;
      }

      saveStoredPopupState({
        followersBlockLimit: currentFollowersBlockLimit,
        followersPreview: currentFollowersPreview,
        followersScanLimit: currentFollowersScanLimit,
        followersSource: currentFollowersSource,
        statusMessage: getPersistedStatusMessage(statusElement.textContent || ''),
        usernameDrafts,
        view: normalizePopupView(shellElement.dataset.view)
      });
    }

    function setStatus(message) {
      statusElement.textContent = message;
      persistCurrentPopupState();
    }

    function renderCount(usernames) {
      countElement.textContent = `${usernames.length} username${usernames.length === 1 ? '' : 's'}`;
    }

    function getActiveListStorageText(list = currentActiveUsernameList) {
      return blocklist.serializeUsernameText(list?.usernames || []);
    }

    function getUsernameDraft(listId) {
      const draft = usernameDrafts[listId];

      if (!draft || typeof draft !== 'object' || typeof draft.text !== 'string' || typeof draft.baseText !== 'string') {
        return null;
      }

      return draft;
    }

    function clearUsernameDraft(listId = currentActiveUsernameListId) {
      if (!listId) {
        return;
      }

      delete usernameDrafts[listId];

      if (draftListId === listId) {
        draftListId = null;
      }
    }

    function persistUsernameDraft() {
      const storageText = getActiveListStorageText();
      const text = textareaElement.value || '';

      isUsernameDraftDirty = text !== storageText;
      draftListId = isUsernameDraftDirty ? currentActiveUsernameListId : null;

      if (currentActiveUsernameListId) {
        if (isUsernameDraftDirty) {
          usernameDrafts[currentActiveUsernameListId] = {
            baseText: storageText,
            text
          };
        } else {
          clearUsernameDraft(currentActiveUsernameListId);
        }
      }

      renderCount(blocklist.parseUsernameText(text).usernames);
      persistCurrentPopupState();
    }

    function dispatchUsernameListChange() {
      if (typeof usernameListSelectElement.dispatchEvent === 'function' && typeof Event === 'function') {
        usernameListSelectElement.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }

      if (typeof usernameListSelectElement.change === 'function') {
        usernameListSelectElement.change();
        return;
      }

      if (typeof usernameListSelectElement.dispatch === 'function') {
        usernameListSelectElement.dispatch('change');
      }
    }

    function getCurrentActiveUsernameListIndex() {
      return currentUsernameLists.findIndex((list) => list.id === currentActiveUsernameListId);
    }

    function normalizeHighlightedUsernameListIndex(index) {
      if (!currentUsernameLists.length) {
        return -1;
      }

      if (!Number.isFinite(index)) {
        return getCurrentActiveUsernameListIndex() >= 0 ? getCurrentActiveUsernameListIndex() : 0;
      }

      const lastIndex = currentUsernameLists.length - 1;
      return Math.max(0, Math.min(lastIndex, Math.round(index)));
    }

    function closeUsernameListDropdown({ preservePendingSelection = false } = {}) {
      if (!isUsernameListDropdownOpen) {
        return;
      }

      isUsernameListDropdownOpen = false;
      highlightedUsernameListIndex = -1;

      if (preservePendingSelection) {
        usernameListSelectElement.dataset.open = 'false';
        usernameListSelectElement.setAttribute('aria-expanded', 'false');
        usernameListOptionsElement.hidden = true;

        if (typeof usernameListSelectElement.removeAttribute === 'function') {
          usernameListSelectElement.removeAttribute('aria-activedescendant');
        }

        return;
      }

      renderUsernameListSelect();
    }

    function openUsernameListDropdown({ highlightedIndex = null } = {}) {
      if (usernameListSelectElement.disabled || !currentUsernameLists.length) {
        return;
      }

      isUsernameListDropdownOpen = true;
      highlightedUsernameListIndex = normalizeHighlightedUsernameListIndex(
        highlightedIndex == null ? getCurrentActiveUsernameListIndex() : highlightedIndex
      );
      renderUsernameListSelect();
    }

    function toggleUsernameListDropdown() {
      if (isUsernameListDropdownOpen) {
        closeUsernameListDropdown();
        return;
      }

      openUsernameListDropdown();
    }

    function moveHighlightedUsernameList(step) {
      if (!currentUsernameLists.length) {
        return;
      }

      if (!isUsernameListDropdownOpen) {
        openUsernameListDropdown({
          highlightedIndex: step > 0 ? 0 : currentUsernameLists.length - 1
        });
        return;
      }

      const lastIndex = currentUsernameLists.length - 1;
      const currentIndex = normalizeHighlightedUsernameListIndex(highlightedUsernameListIndex);
      const nextIndex = step > 0
        ? (currentIndex >= lastIndex ? 0 : currentIndex + 1)
        : (currentIndex <= 0 ? lastIndex : currentIndex - 1);

      highlightedUsernameListIndex = nextIndex;
      renderUsernameListSelect();
    }

    function selectUsernameListOption(listId) {
      if (!listId || usernameListSelectElement.disabled) {
        return;
      }

      usernameListSelectElement.value = listId;
      closeUsernameListDropdown({ preservePendingSelection: listId !== currentActiveUsernameListId });

      if (listId !== currentActiveUsernameListId) {
        dispatchUsernameListChange();
      }
    }

    function handleUsernameListSelectKeydown(event) {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          moveHighlightedUsernameList(1);
          break;
        case 'ArrowUp':
          event.preventDefault();
          moveHighlightedUsernameList(-1);
          break;
        case 'Home':
          if (!isUsernameListDropdownOpen || !currentUsernameLists.length) {
            return;
          }

          event.preventDefault();
          highlightedUsernameListIndex = 0;
          renderUsernameListSelect();
          break;
        case 'End':
          if (!isUsernameListDropdownOpen || !currentUsernameLists.length) {
            return;
          }

          event.preventDefault();
          highlightedUsernameListIndex = currentUsernameLists.length - 1;
          renderUsernameListSelect();
          break;
        case 'Enter':
        case ' ':
          event.preventDefault();

          if (!isUsernameListDropdownOpen) {
            openUsernameListDropdown();
            return;
          }

          selectUsernameListOption(currentUsernameLists[normalizeHighlightedUsernameListIndex(highlightedUsernameListIndex)]?.id);
          break;
        case 'Escape':
          if (!isUsernameListDropdownOpen) {
            return;
          }

          event.preventDefault();
          closeUsernameListDropdown();
          break;
        case 'Tab':
          closeUsernameListDropdown();
          break;
        default:
          break;
      }
    }

    function renderUsernameListSelect() {
      const activeList = currentUsernameLists.find((list) => list.id === currentActiveUsernameListId) || currentUsernameLists[0] || null;
      const activeListId = activeList?.id || '';
      const activeListName = activeList?.name || blocklist.DEFAULT_USERNAME_LIST_NAME || 'Blocklist';
      const optionButtons = currentUsernameLists.map((list, index) => {
        const option = typeof documentRef.createElement === 'function'
          ? documentRef.createElement('button')
          : { dataset: {} };
        option.type = 'button';
        option.className = 'list-select-option';
        option.id = `username-list-option-${list.id}`;
        option.textContent = list.name;
        option.dataset.active = String(isUsernameListDropdownOpen && normalizeHighlightedUsernameListIndex(highlightedUsernameListIndex) === index);
        option.dataset.selected = String(list.id === activeListId);
        option.tabIndex = -1;

        if (typeof option.setAttribute === 'function') {
          option.setAttribute('role', 'option');
          option.setAttribute('aria-selected', String(list.id === activeListId));
        }

        if (typeof option.addEventListener === 'function') {
          option.addEventListener('click', (event) => {
            event?.stopPropagation?.();
            selectUsernameListOption(list.id);
          });
        }

        return option;
      });

      if (typeof usernameListOptionsElement.replaceChildren === 'function') {
        usernameListOptionsElement.replaceChildren(...optionButtons);
      } else {
        usernameListOptionsElement.children = optionButtons;
      }

      usernameListSelectElement.value = activeListId;
      usernameListSelectElement.textContent = activeListName;
      usernameListSelectElement.dataset.open = String(isUsernameListDropdownOpen);
      usernameListSelectElement.setAttribute('aria-label', `Active list: ${activeListName}`);
      usernameListSelectElement.setAttribute('aria-controls', 'username-list-options');
      usernameListSelectElement.setAttribute('aria-expanded', String(isUsernameListDropdownOpen));

      if (isUsernameListDropdownOpen && currentUsernameLists.length) {
        usernameListSelectElement.setAttribute(
          'aria-activedescendant',
          `username-list-option-${currentUsernameLists[normalizeHighlightedUsernameListIndex(highlightedUsernameListIndex)]?.id || activeListId}`
        );
      } else if (typeof usernameListSelectElement.removeAttribute === 'function') {
        usernameListSelectElement.removeAttribute('aria-activedescendant');
      }

      usernameListOptionsElement.hidden = !isUsernameListDropdownOpen || !currentUsernameLists.length;
    }

    function renderActiveUsernameList({ applyDraft = true } = {}) {
      const storageText = getActiveListStorageText();
      let nextText = storageText;
      let draftStatus = null;
      const draft = currentActiveUsernameListId ? getUsernameDraft(currentActiveUsernameListId) : null;

      if (applyDraft && draft) {
        if (draft.baseText === storageText) {
          nextText = draft.text;
        } else {
          clearUsernameDraft(currentActiveUsernameListId);
          draftStatus = OUTDATED_USERNAME_DRAFT_STATUS;
        }
      }

      textareaElement.value = nextText;
      isUsernameDraftDirty = nextText !== storageText;
      draftListId = isUsernameDraftDirty ? currentActiveUsernameListId : null;
      renderCount(blocklist.parseUsernameText(nextText).usernames);
      renderUsernameListSelect();
      return draftStatus;
    }

    async function readUsernameListState() {
      if (extensionApi?.storage?.local && typeof blocklist.getStoredUsernameListState === 'function') {
        const { activeList, lists } = await blocklist.getStoredUsernameListState(extensionApi);
        const normalizedLists = blocklist.normalizeUsernameLists(lists);
        const normalizedActiveList = activeList || normalizedLists[0] || blocklist.createUsernameList(blocklist.DEFAULT_USERNAME_LIST_NAME, []);

        return {
          activeList: normalizedActiveList,
          lists: normalizedLists.length ? normalizedLists : [normalizedActiveList]
        };
      }

      if (extensionApi?.storage?.local && typeof blocklist.getStoredUsernameLists === 'function' && typeof blocklist.getActiveUsernameList === 'function') {
        const [lists, activeList] = await Promise.all([
          blocklist.getStoredUsernameLists(extensionApi),
          blocklist.getActiveUsernameList(extensionApi)
        ]);
        const normalizedLists = blocklist.normalizeUsernameLists(lists);
        const normalizedActiveList = activeList || normalizedLists[0] || blocklist.createUsernameList(blocklist.DEFAULT_USERNAME_LIST_NAME, []);

        return {
          activeList: normalizedActiveList,
          lists: normalizedLists.length ? normalizedLists : [normalizedActiveList]
        };
      }

      const usernames = await blocklist.getStoredUsernames(extensionApi);
      const fallbackList = {
        id: blocklist.DEFAULT_USERNAME_LIST_ID || 'blocklist',
        name: blocklist.DEFAULT_USERNAME_LIST_NAME || 'Blocklist',
        usernames
      };

      return {
        activeList: fallbackList,
        lists: [fallbackList]
      };
    }

    function setCurrentUsernameListState(lists, activeList) {
      currentUsernameLists = blocklist.normalizeUsernameLists(lists);
      currentActiveUsernameList = currentUsernameLists.find((list) => list.id === activeList?.id)
        || activeList
        || currentUsernameLists[0]
        || null;
      currentActiveUsernameListId = currentActiveUsernameList?.id || null;
    }

    async function refreshUsernameListStateFromStorage({ applyDraft = true } = {}) {
      const { activeList, lists } = await readUsernameListState();

      setCurrentUsernameListState(lists, activeList);
      return renderActiveUsernameList({ applyDraft });
    }

    function updateCurrentActiveListUsernames(usernames) {
      if (!currentActiveUsernameListId) {
        return;
      }

      const normalizedUsernames = blocklist.normalizeStoredUsernames(usernames);
      currentUsernameLists = currentUsernameLists.map((list) => list.id === currentActiveUsernameListId
        ? { ...list, usernames: normalizedUsernames }
        : list);
      currentActiveUsernameList = currentUsernameLists.find((list) => list.id === currentActiveUsernameListId) || currentActiveUsernameList;
    }

    function applySavedUsernamesToDraft(savedUsernames) {
      updateCurrentActiveListUsernames(savedUsernames);
      textareaElement.value = blocklist.serializeUsernameText(savedUsernames);
      isUsernameDraftDirty = false;
      clearUsernameDraft(currentActiveUsernameListId);
      renderCount(savedUsernames);
    }

    function getSetActiveUsernames() {
      return extensionApi?.storage?.local && typeof blocklist.setActiveStoredUsernames === 'function'
        ? blocklist.setActiveStoredUsernames
        : blocklist.setStoredUsernames;
    }

    function hasUsernameListStorageApi() {
      return Boolean(extensionApi?.storage?.local
        && typeof blocklist.getStoredUsernameLists === 'function'
        && typeof blocklist.setStoredUsernameLists === 'function');
    }

    function areUsernameListsEqual(leftUsernames, rightUsernames) {
      if (leftUsernames.length !== rightUsernames.length) {
        return false;
      }

      return leftUsernames.every((username, index) => username === rightUsernames[index]);
    }

    function mergeEditedUsernamesWithLatest(baseUsernames, editedUsernames, latestUsernames) {
      const normalizedBaseUsernames = blocklist.normalizeStoredUsernames(baseUsernames);
      const normalizedEditedUsernames = blocklist.normalizeStoredUsernames(editedUsernames);
      const normalizedLatestUsernames = blocklist.normalizeStoredUsernames(latestUsernames);

      if (areUsernameListsEqual(normalizedLatestUsernames, normalizedBaseUsernames)) {
        return normalizedEditedUsernames;
      }

      const editedUsernameSet = new Set(normalizedEditedUsernames);
      const removedBaseUsernames = new Set(
        normalizedBaseUsernames.filter((username) => !editedUsernameSet.has(username))
      );

      return blocklist.normalizeStoredUsernames([
        ...normalizedLatestUsernames.filter((username) => !removedBaseUsernames.has(username)),
        ...normalizedEditedUsernames
      ]);
    }

    function getCurrentDraftBaseUsernames() {
      const draft = currentActiveUsernameListId ? getUsernameDraft(currentActiveUsernameListId) : null;
      return blocklist.parseUsernameText(draft?.baseText ?? getActiveListStorageText()).usernames;
    }

    async function mutateCurrentActiveUsernameListUsernames(createNextUsernames) {
      if (hasUsernameListStorageApi()) {
        const latestLists = blocklist.normalizeUsernameLists(await blocklist.getStoredUsernameLists(extensionApi));
        const targetListId = currentActiveUsernameListId || currentActiveUsernameList?.id || latestLists[0]?.id;
        const targetList = targetListId
          ? latestLists.find((list) => list.id === targetListId)
          : latestLists[0];

        if (!targetList) {
          throw new Error('The active username list changed elsewhere. Reload the popup and try again.');
        }

        const savedUsernames = blocklist.normalizeStoredUsernames(createNextUsernames(targetList.usernames));
        const nextLists = latestLists.map((list) => list.id === targetList.id
          ? { ...list, usernames: savedUsernames }
          : list);

        await blocklist.setStoredUsernameLists(nextLists, extensionApi);
        return savedUsernames;
      }

      const currentUsernames = currentActiveUsernameList?.usernames || [];
      const nextUsernames = blocklist.normalizeStoredUsernames(createNextUsernames(currentUsernames));
      const setActiveUsernames = getSetActiveUsernames();
      return setActiveUsernames(nextUsernames, extensionApi);
    }

    function readDelayMs() {
      return settings.normalizeBatchBlockDelayMs(delayInputElement.value);
    }

    function renderDelay(delayMs) {
      delayInputElement.value = String(settings.normalizeBatchBlockDelayMs(delayMs));
    }

    function readPageButtonStyles() {
      return settings.normalizePageBlockButtonStyles(draftPageButtonStyles);
    }

    function renderPageButtonStyles(styles) {
      draftPageButtonStyles = settings.normalizePageBlockButtonStyles(styles);

      for (const surface of Object.values(pageButtonStyleSurfaces)) {
        const controls = pageButtonStyleControls[surface];
        const style = draftPageButtonStyles[surface];

        controls.icon.dataset.active = String(style === settings.PAGE_BLOCK_BUTTON_STYLES.icon);
        controls.text.dataset.active = String(style === settings.PAGE_BLOCK_BUTTON_STYLES.text);
        controls.icon.setAttribute('aria-pressed', String(style === settings.PAGE_BLOCK_BUTTON_STYLES.icon));
        controls.text.setAttribute('aria-pressed', String(style === settings.PAGE_BLOCK_BUTTON_STYLES.text));
      }
    }

    function setDraftPageButtonStyle(surface, style) {
      renderPageButtonStyles({
        ...draftPageButtonStyles,
        [surface]: style
      });
    }

    function readUserCellAddButtonStyle() {
      return settings.normalizePageBlockButtonStyle(draftUserCellAddButtonStyle);
    }

    function renderUserCellAddButtonStyle(style) {
      draftUserCellAddButtonStyle = settings.normalizePageBlockButtonStyle(style);
      userCellAddButtonStyleControls.icon.dataset.active = String(draftUserCellAddButtonStyle === settings.PAGE_BLOCK_BUTTON_STYLES.icon);
      userCellAddButtonStyleControls.text.dataset.active = String(draftUserCellAddButtonStyle === settings.PAGE_BLOCK_BUTTON_STYLES.text);
      userCellAddButtonStyleControls.icon.setAttribute('aria-pressed', String(draftUserCellAddButtonStyle === settings.PAGE_BLOCK_BUTTON_STYLES.icon));
      userCellAddButtonStyleControls.text.setAttribute('aria-pressed', String(draftUserCellAddButtonStyle === settings.PAGE_BLOCK_BUTTON_STYLES.text));
    }

    function readShowUserCellAddButton() {
      return settings.normalizeUserCellAddButtonVisibility(showUserCellAddButtonElement.checked);
    }

    function renderShowUserCellAddButton(isVisible) {
      showUserCellAddButtonElement.checked = settings.normalizeUserCellAddButtonVisibility(isVisible);
    }

    function readFollowersBlockLimit() {
      return followers.normalizeFollowersBlockLimit(followersBlockLimitElement.value);
    }

    function renderFollowersBlockLimit(limit) {
      followersBlockLimitElement.value = String(followers.normalizeFollowersBlockLimit(limit));
    }

    function readFollowersScanLimit() {
      return followers.normalizeFollowersScanLimit(followersScanLimitElement.value);
    }

    function renderFollowersScanLimit(limit) {
      followersScanLimitElement.value = String(followers.normalizeFollowersScanLimit(limit));
    }

    function getFollowersSourceCopy(source = currentFollowersSource) {
      const normalizedSource = followers.normalizeFollowersSource(source);

      if (normalizedSource === followers.FOLLOWERS_SOURCES.following) {
        return {
          accountLabel: 'following account',
          accountsLabel: 'following accounts',
          graphLabel: 'following',
          pageLabel: 'following page',
          readyLabel: 'accounts',
          source: normalizedSource
        };
      }

      return {
        accountLabel: 'follower',
        accountsLabel: 'followers',
        graphLabel: 'followers',
        pageLabel: 'followers page',
        readyLabel: 'followers',
        source: followers.FOLLOWERS_SOURCES.followers
      };
    }

    function readFollowersSource() {
      return followers.normalizeFollowersSource(currentFollowersSource);
    }

    function renderFollowersSource(source) {
      currentFollowersSource = followers.normalizeFollowersSource(source);
      followersSourceFollowersElement.dataset.active = String(currentFollowersSource === followers.FOLLOWERS_SOURCES.followers);
      followersSourceFollowingElement.dataset.active = String(currentFollowersSource === followers.FOLLOWERS_SOURCES.following);

      if (typeof followersSourceFollowersElement.setAttribute === 'function') {
        followersSourceFollowersElement.setAttribute('aria-pressed', String(currentFollowersSource === followers.FOLLOWERS_SOURCES.followers));
      }

      if (typeof followersSourceFollowingElement.setAttribute === 'function') {
        followersSourceFollowingElement.setAttribute('aria-pressed', String(currentFollowersSource === followers.FOLLOWERS_SOURCES.following));
      }
    }

    function setFollowersSummary(message) {
      followersSummaryElement.textContent = message;
    }

    function formatFollowersPreviewSummaryText(preview, targetLabel) {
      const sourceCopy = getFollowersSourceCopy(preview.source);
      const scannedLabel = preview.scannedCount === 1 ? `1 ${sourceCopy.accountLabel}` : `${preview.scannedCount} ${sourceCopy.accountsLabel}`;
      return `Scanned ${scannedLabel} from ${targetLabel}. Already blocked: ${preview.alreadyBlockedCount}. Ready: ${preview.readyCount}.${preview.hasMorePages ? ` More ${sourceCopy.accountsLabel} remain beyond this preview.` : ''}`;
    }

    function appendFollowersSummaryText(nodes, text, className = '') {
      const textElement = documentRef.createElement('span');

      if (className) {
        textElement.className = className;
      }

      textElement.textContent = text;
      nodes.push(textElement);
    }

    function setFollowersPreviewSummary(preview, targetLabel) {
      if (typeof documentRef.createElement !== 'function') {
        followersSummaryElement.textContent = formatFollowersPreviewSummaryText(preview, targetLabel);
        return;
      }

      const summaryNodes = [];
      const sourceCopy = getFollowersSourceCopy(preview.source);
      const scannedLabel = preview.scannedCount === 1 ? `1 ${sourceCopy.accountLabel}` : `${preview.scannedCount} ${sourceCopy.accountsLabel}`;

      appendFollowersSummaryText(summaryNodes, 'Scanned ');
      appendFollowersSummaryText(summaryNodes, scannedLabel, 'followers-summary-strong');
      appendFollowersSummaryText(summaryNodes, ' from ');
      appendFollowersSummaryText(summaryNodes, targetLabel, 'followers-summary-accent');
      appendFollowersSummaryText(summaryNodes, '. Already blocked: ');
      appendFollowersSummaryText(summaryNodes, String(preview.alreadyBlockedCount), 'followers-summary-strong');
      appendFollowersSummaryText(summaryNodes, '. Ready: ');
      appendFollowersSummaryText(summaryNodes, String(preview.readyCount), 'followers-summary-strong');
      appendFollowersSummaryText(summaryNodes, '.');

      if (preview.hasMorePages) {
        appendFollowersSummaryText(summaryNodes, ` More ${sourceCopy.accountsLabel} remain beyond this preview.`, 'followers-summary-note');
      }

      if (typeof followersSummaryElement.replaceChildren === 'function') {
        followersSummaryElement.replaceChildren(...summaryNodes);
      } else {
        followersSummaryElement.textContent = summaryNodes.map((node) => node.textContent).join('');
      }
    }

    function getFollowerProgressCandidateLabel(candidate) {
      if (!candidate || typeof candidate !== 'object') {
        return 'unknown account';
      }

      return candidate.username ? `@${candidate.username}` : `id:${candidate.restId || 'unknown'}`;
    }

    function createFollowerBlockRunId() {
      return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    function renderFollowerBlockProgress(progress = {}) {
      const total = Math.max(0, Math.round(Number(progress.total) || 0));
      const completed = Math.min(total, Math.max(0, Math.round(Number(progress.completed) || 0)));
      const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
      const successCount = Math.max(0, Math.round(Number(progress.successCount) || 0));
      const failureCount = Math.max(0, Math.round(Number(progress.failureCount) || 0));
      const delayMs = settings.normalizeBatchBlockDelayMs(progress.delayMs ?? currentDelayMs);
      const phase = typeof progress.phase === 'string' ? progress.phase : 'idle';
      const candidateLabel = getFollowerProgressCandidateLabel(progress.candidate);
      let state = 'running';
      let label = 'Block run in progress';
      let detail = `Blocked ${successCount}, failed ${failureCount}. Delay between requests: ${delayMs} ms.`;

      if (phase === 'idle') {
        state = 'idle';
        label = 'Preview required';
        detail = `Run a scan to prepare a block-ready ${getFollowersSourceCopy().graphLabel} batch.`;
      } else if (phase === 'scanning') {
        const sourceCopy = getFollowersSourceCopy(progress.source);
        state = 'running';
        label = `Scanning ${sourceCopy.graphLabel}`;
        detail = `Checking up to ${total || currentFollowersScanLimit} ${sourceCopy.accountsLabel}. Already-blocked accounts will be skipped.`;
      } else if (phase === 'ready') {
        const sourceCopy = getFollowersSourceCopy(progress.source);
        state = 'ready';
        label = `Ready to block ${total} ${total === 1 ? sourceCopy.accountLabel : sourceCopy.readyLabel}`;
        detail = `Click Block to start. Delay from Settings: ${delayMs} ms between requests.`;
      } else if (phase === 'started') {
        const sourceCopy = getFollowersSourceCopy(progress.source);
        label = `Starting block run for ${total} ${total === 1 ? sourceCopy.accountLabel : sourceCopy.readyLabel}`;
        detail = `Using ${delayMs} ms delay between block requests from Settings.`;
      } else if (phase === 'blocking') {
        label = `Blocking ${progress.currentIndex || completed + 1}/${total}`;
        detail = `Sending block request for ${candidateLabel}. Success: ${successCount}. Failed: ${failureCount}.`;
      } else if (phase === 'blocked') {
        label = `Blocked ${completed}/${total}`;
        detail = `${candidateLabel} blocked. Success: ${successCount}. Failed: ${failureCount}.`;
      } else if (phase === 'failed') {
        state = 'error';
        label = `Failed ${completed}/${total}`;
        detail = `${candidateLabel} failed: ${progress.error || 'unknown error'}. Success: ${successCount}. Failed: ${failureCount}.`;
      } else if (phase === 'waiting') {
        state = 'waiting';
        label = `Waiting ${delayMs} ms before next block`;
        detail = `Next: ${progress.nextIndex || completed + 1}/${total}. Success: ${successCount}. Failed: ${failureCount}.`;
      } else if (phase === 'canceling') {
        state = 'waiting';
        label = 'Canceling run';
        detail = 'Waiting for the active X request to stop.';
      } else if (phase === 'canceled') {
        state = 'idle';
        label = 'Run canceled';
        detail = 'No further scan or block requests will be sent for this run.';
      } else if (phase === 'finished') {
        state = failureCount ? 'error' : 'success';
        label = failureCount ? `Finished with ${failureCount} failures` : 'Block run complete';
        detail = `Blocked ${successCount}/${total}. Failed: ${failureCount}. Delay used: ${delayMs} ms between requests.`;
      }

      followersBlockProgressElement.dataset.state = state;
      followersProgressLabelElement.textContent = label;
      followersProgressCountElement.textContent = total ? `${completed}/${total}` : '0/0';
      followersProgressDetailElement.textContent = detail;
      followersProgressFillElement.style.width = `${percent}%`;

      if (typeof followersBlockProgressElement.querySelector === 'function') {
        followersBlockProgressElement.querySelector('.block-progress-track')?.setAttribute('aria-valuenow', String(percent));
      }
    }

    function renderFollowerBlockResultProgress(results, delayMs, source = currentFollowersSource) {
      const normalizedResults = Array.isArray(results) ? results : [];
      const successCount = normalizedResults.filter((entry) => entry?.ok).length;
      const failureCount = normalizedResults.length - successCount;

      renderFollowerBlockProgress({
        completed: normalizedResults.length,
        delayMs,
        failureCount,
        phase: 'finished',
        source,
        successCount,
        total: normalizedResults.length
      });
    }

    function handleFollowerBlockProgressMessage(message) {
      if (message?.type !== FOLLOWERS_BLOCK_PROGRESS_MESSAGE_TYPE || message.runId !== currentFollowersBlockRunId) {
        return false;
      }

      renderFollowerBlockProgress(message.progress || {});
      return false;
    }

    function clearFollowersPreview(summary = DEFAULT_FOLLOWERS_SUMMARY) {
      currentFollowersPreview = null;
      setFollowersSummary(summary);
      followersPreviewElement.textContent = '';
      persistCurrentPopupState();
    }

    function refreshPopupDebugLog() {
      renderPopupDebugLog(popupDebugLogElement);
    }

    function renderFollowersPreview(preview) {
      if (!preview) {
        clearFollowersPreview();
        return;
      }

      currentFollowersPreview = preview;

      const targetLabel = preview.targetScreenName ? `@${preview.targetScreenName}` : 'the active profile';
      const previewLines = preview.candidates.slice(0, 10).map((candidate) => `@${candidate.username || candidate.restId || 'unknown'}`);

      if (preview.candidates.length > 10) {
        previewLines.push(`+${preview.candidates.length - 10} more`);
      }

      setFollowersPreviewSummary(preview, targetLabel);
      followersPreviewElement.textContent = previewLines.length
        ? previewLines.join('\n')
        : `No block-ready ${getFollowersSourceCopy(preview.source).accountsLabel} were found within the current scan limit.`;
      renderFollowerBlockProgress(preview.candidates.length
        ? {
          delayMs: currentDelayMs,
          phase: 'ready',
          source: preview.source,
          total: preview.candidates.length
        }
        : { phase: 'idle' });
      persistCurrentPopupState();
    }

    function setBusyState() {
      const isAnyBusy = isSaving || isBlocking || isFollowersScanning || isFollowersBlocking;

      if (isAnyBusy) {
        closeUsernameListDropdown();
      }

      saveButton.disabled = isAnyBusy;
      blockNowButton.disabled = isAnyBusy;
      clearListButton.disabled = isAnyBusy;
      saveSettingsButton.disabled = isAnyBusy;
      usernameListSelectElement.disabled = isAnyBusy;
      newUsernameListButton.disabled = isAnyBusy;
      renameUsernameListButton.disabled = isAnyBusy || !currentActiveUsernameList;
      deleteUsernameListButton.disabled = isAnyBusy || currentUsernameLists.length <= 1;
      importUsernamesButton.disabled = isAnyBusy;
      openSettingsButton.disabled = isAnyBusy;
      openFollowersButton.disabled = isAnyBusy;
      backToMainButton.disabled = isAnyBusy;
      backFromFollowersButton.disabled = isAnyBusy;
      followersSourceFollowersElement.disabled = isAnyBusy;
      followersSourceFollowingElement.disabled = isAnyBusy;
      scanFollowersButton.disabled = isAnyBusy;
      blockFollowerCandidatesButton.disabled = isAnyBusy || !currentFollowersPreview?.candidates?.length;
      cancelFollowersRunButton.disabled = !(isFollowersScanning || isFollowersBlocking);
      addFollowersToListButton.disabled = isAnyBusy || !currentFollowersPreview?.candidates?.length;
    }

    function showMainView() {
      setPopupView(shellElement, POPUP_VIEWS.main);
      persistCurrentPopupState();
    }

    function showSettingsView() {
      setPopupView(shellElement, POPUP_VIEWS.settings);
      persistCurrentPopupState();
    }

    function showFollowersView() {
      setPopupView(shellElement, POPUP_VIEWS.followers);
      persistCurrentPopupState();
    }

    function updateFollowersSource(source) {
      const nextSource = followers.normalizeFollowersSource(source);

      if (nextSource === currentFollowersSource) {
        return;
      }

      renderFollowersSource(nextSource);
      clearFollowersPreview(`Source changed to ${getFollowersSourceCopy(nextSource).graphLabel}. Run a new preview scan.`);
      renderFollowerBlockProgress({ phase: 'idle' });
      persistCurrentPopupState();
    }

    function handleAsyncPopupAction(actionName, action) {
      Promise.resolve()
        .then(action)
        .catch((error) => {
          logPopupError(`${actionName} crashed with an unhandled error.`, error);
          refreshPopupDebugLog();
          setStatus(error instanceof Error ? error.message : String(error));
        });
    }

    async function cancelActiveFollowerRun() {
      const activeRunId = currentFollowersBlockRunId || currentFollowersScanRunId;
      const activeTabId = currentFollowerRunTabId;

      if (!activeRunId || !activeTabId || (!isFollowersScanning && !isFollowersBlocking)) {
        return;
      }

      logPopupInfo('Canceling active follower run.', {
        runId: activeRunId,
        tabId: activeTabId
      });
      renderFollowerBlockProgress({
        phase: 'canceling',
        total: currentFollowersPreview?.candidates?.length || currentFollowersScanLimit
      });
      setStatus('Cancel requested. Waiting for the active X request to stop...');
      refreshPopupDebugLog();

      try {
        await requestCancelFollowerRun(activeTabId, activeRunId, extensionApi);
      } catch (error) {
        logPopupError('Follower run cancel request failed.', error);
        refreshPopupDebugLog();
        setStatus(error instanceof Error ? error.message : String(error));
      }
    }

    async function loadBlocklist() {
      const [usernameListState, delayMs, pageButtonStyles, userCellAddButtonStyle, showUserCellAddButton] = await Promise.all([
        readUsernameListState(),
        settings.getStoredBatchBlockDelayMs(extensionApi),
        readStoredPageButtonStyles(),
        readStoredUserCellAddButtonStyle(),
        settings.getStoredUserCellAddButtonVisibility(extensionApi)
      ]);

      setCurrentUsernameListState(usernameListState.lists, usernameListState.activeList);
      const usernameDraftStatus = renderActiveUsernameList();
      renderDelay(delayMs);
      currentDelayMs = delayMs;
      currentPageButtonStyles = pageButtonStyles;
      currentUserCellAddButtonStyle = userCellAddButtonStyle;
      currentShowUserCellAddButton = showUserCellAddButton;
      currentFollowersBlockLimit = followers.normalizeFollowersBlockLimit(
        storedPopupState.followersBlockLimit ?? followers.DEFAULT_FOLLOWERS_BLOCK_LIMIT
      );
      currentFollowersScanLimit = followers.normalizeFollowersScanLimit(
        storedPopupState.followersScanLimit ?? followers.DEFAULT_FOLLOWERS_SCAN_LIMIT
      );
      currentFollowersSource = followers.normalizeFollowersSource(
        storedPopupState.followersSource ?? storedPopupState.followersPreview?.source ?? followers.DEFAULT_FOLLOWERS_SOURCE
      );
      renderFollowersBlockLimit(currentFollowersBlockLimit);
      renderFollowersScanLimit(currentFollowersScanLimit);
      renderFollowersSource(currentFollowersSource);
      renderPageButtonStyles(pageButtonStyles);
      renderUserCellAddButtonStyle(userCellAddButtonStyle);
      renderShowUserCellAddButton(showUserCellAddButton);
      const storedFollowersPreview = normalizeStoredFollowersPreview(storedPopupState.followersPreview);

      if (storedFollowersPreview) {
        renderFollowersPreview(storedFollowersPreview);
      } else {
        clearFollowersPreview();
      }

      setStatus(usernameDraftStatus || normalizeStoredStatusMessage(storedPopupState.statusMessage));
      setPopupView(shellElement, storedPopupState.view);
      isHydratingPopupState = false;
      setBusyState();
      persistCurrentPopupState();
    }

    async function saveBlocklist() {
      if (isSaving || isBlocking || isFollowersScanning || isFollowersBlocking) {
        return;
      }

      const { usernames, invalidEntries } = blocklist.parseUsernameText(textareaElement.value);

      isSaving = true;
      setBusyState();
      setStatus('Saving blocklist...');

      try {
        const baseUsernames = getCurrentDraftBaseUsernames();
        const savedUsernames = await mutateCurrentActiveUsernameListUsernames((latestUsernames) => (
          mergeEditedUsernamesWithLatest(baseUsernames, usernames, latestUsernames)
        ));

        applySavedUsernamesToDraft(savedUsernames);
        persistCurrentPopupState();

        if (invalidEntries.length) {
          setStatus(`Saved ${savedUsernames.length} usernames. Skipped invalid values: ${invalidEntries.slice(0, 3).join(', ')}`);
          return;
        }

        setStatus(`Saved ${savedUsernames.length} usernames.`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      } finally {
        isSaving = false;
        setBusyState();
      }
    }

    async function saveSettings() {
      if (isSaving || isBlocking || isFollowersScanning || isFollowersBlocking) {
        return;
      }

      const delayMs = readDelayMs();
      const pageButtonStyles = readPageButtonStyles();
      const userCellAddButtonStyle = readUserCellAddButtonStyle();
      const showUserCellAddButton = readShowUserCellAddButton();

      isSaving = true;
      setBusyState();
      setStatus('Saving settings...');

      try {
        const [savedDelayMs, savedPageButtonStyles, savedUserCellAddButtonStyle, savedShowUserCellAddButton] = await Promise.all([
          settings.setStoredBatchBlockDelayMs(delayMs, extensionApi),
          writeStoredPageButtonStyles(pageButtonStyles),
          writeStoredUserCellAddButtonStyle(userCellAddButtonStyle),
          settings.setStoredUserCellAddButtonVisibility(showUserCellAddButton, extensionApi)
        ]);

        currentDelayMs = savedDelayMs;
        renderDelay(savedDelayMs);
        currentPageButtonStyles = savedPageButtonStyles;
        renderPageButtonStyles(savedPageButtonStyles);
        currentUserCellAddButtonStyle = savedUserCellAddButtonStyle;
        renderUserCellAddButtonStyle(savedUserCellAddButtonStyle);
        currentShowUserCellAddButton = savedShowUserCellAddButton;
        renderShowUserCellAddButton(savedShowUserCellAddButton);
        setStatus(`Saved settings. Delay: ${savedDelayMs} ms.`);
        showMainView();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      } finally {
        isSaving = false;
        setBusyState();
      }
    }

    async function blockListedNow() {
      if (isSaving || isBlocking || isFollowersScanning || isFollowersBlocking) {
        return;
      }

      const { usernames, invalidEntries } = blocklist.parseUsernameText(textareaElement.value);

      if (!usernames.length) {
        setStatus('Add at least one valid username before blocking.');
        return;
      }

      isBlocking = true;
      setBusyState();
      setStatus('Blocking listed usernames through the X page context...');
      logPopupInfo('Starting immediate username block request.', {
        delayMs: currentDelayMs,
        requestedUsernames: usernames
      });

      try {
        const baseUsernames = getCurrentDraftBaseUsernames();
        const savedUsernames = await mutateCurrentActiveUsernameListUsernames((latestUsernames) => (
          mergeEditedUsernamesWithLatest(baseUsernames, usernames, latestUsernames)
        ));
        const targetTab = await findUsableXTab(extensionApi);

        applySavedUsernamesToDraft(savedUsernames);
        persistCurrentPopupState();

        if (!targetTab?.id) {
          throw new Error('Open any x.com or twitter.com tab first.');
        }

        const response = await requestImmediateBlock(targetTab.id, savedUsernames, currentDelayMs, extensionApi);

        if (!response?.ok) {
          logPopupError('Immediate username block request failed.', response);
          throw new Error(response?.error || 'The X page did not accept the block request.');
        }

        const results = Array.isArray(response.results) ? response.results : [];
        const successCount = results.filter((entry) => entry?.ok).length;
        const failedEntries = results.filter((entry) => !entry?.ok);

        logPopupInfo('Immediate username block request finished.', {
          failedEntries,
          results,
          successCount
        });

        if (failedEntries.length) {
          const failedPreview = failedEntries.slice(0, 3).map((entry) => `@${entry.username}`).join(', ');
          const invalidSuffix = invalidEntries.length ? ` Invalid: ${invalidEntries.slice(0, 3).join(', ')}.` : '';
          setStatus(`Blocked ${successCount}/${results.length} usernames with ${currentDelayMs} ms delay. Failed: ${failedPreview}.${invalidSuffix}`);
          return;
        }

        if (invalidEntries.length) {
          setStatus(`Blocked ${successCount} usernames with ${currentDelayMs} ms delay. Skipped invalid values: ${invalidEntries.slice(0, 3).join(', ')}`);
          return;
        }

        setStatus(`Blocked ${successCount} usernames with ${currentDelayMs} ms delay.`);
      } catch (error) {
        logPopupError('Immediate username block flow threw an error.', error);
        setStatus(error instanceof Error ? error.message : String(error));
      } finally {
        isBlocking = false;
        setBusyState();
      }
    }

    async function scanFollowersPreview() {
      let scanRunId = null;

      try {
        if (isSaving || isBlocking || isFollowersScanning || isFollowersBlocking) {
          logPopupInfo('Followers preview scan ignored because popup is busy.', {
            isBlocking,
            isFollowersBlocking,
            isFollowersScanning,
            isSaving
          });
          refreshPopupDebugLog();
          return;
        }

        logPopupInfo('Followers preview scan: resolving active X tab.');
        const targetTab = await findActiveXTab(extensionApi);
        logPopupInfo('Followers preview scan: active tab resolved.', targetTab);

        if (!targetTab?.id) {
          setStatus('Make the target x.com profile tab active first.');
          refreshPopupDebugLog();
          return;
        }

        logPopupInfo('Followers preview scan: normalizing limits.', {
          rawBlockLimit: followersBlockLimitElement.value,
          rawScanLimit: followersScanLimitElement.value
        });
        currentFollowersBlockLimit = readFollowersBlockLimit();
        currentFollowersScanLimit = readFollowersScanLimit();
        currentFollowersSource = readFollowersSource();
        const sourceCopy = getFollowersSourceCopy(currentFollowersSource);
        scanRunId = createFollowerBlockRunId();
        renderFollowersBlockLimit(currentFollowersBlockLimit);
        renderFollowersScanLimit(currentFollowersScanLimit);
        renderFollowersSource(currentFollowersSource);

        isFollowersScanning = true;
        currentFollowersScanRunId = scanRunId;
        currentFollowerRunTabId = targetTab.id;
        setBusyState();
        setFollowersSummary(`Scanning up to ${currentFollowersScanLimit} ${sourceCopy.accountsLabel} from the active X tab...`);
        renderFollowerBlockProgress({
          phase: 'scanning',
          source: currentFollowersSource,
          total: currentFollowersScanLimit
        });
        setStatus(`${sourceCopy.graphLabel} scan running.`);
        logPopupInfo('Starting followers preview scan.', {
          blockLimit: currentFollowersBlockLimit,
          runId: scanRunId,
          scanLimit: currentFollowersScanLimit,
          source: currentFollowersSource,
          tabId: targetTab.id,
          tabUrl: targetTab.url
        });
        refreshPopupDebugLog();

        const response = await requestFollowersPreview(targetTab.id, currentFollowersBlockLimit, currentFollowersScanLimit, currentFollowersSource, extensionApi, scanRunId);

        if (response?.canceled) {
          setFollowersSummary(`${sourceCopy.graphLabel} scan canceled.`);
          renderFollowerBlockProgress({
            phase: 'canceled',
            source: currentFollowersSource,
            total: currentFollowersScanLimit
          });
          setStatus(`${sourceCopy.graphLabel} scan canceled.`);
          return;
        }

        if (!response?.ok) {
          logPopupError('Followers preview scan returned a non-ok response.', response);
          throw new Error(response?.error || 'The X page did not accept the followers scan request.');
        }

        logPopupInfo('Followers preview scan response received.', response.preview || response);
        renderFollowersPreview(response.preview || null);
        refreshPopupDebugLog();

        if (!response?.preview?.candidates?.length) {
          setStatus(`Scan complete. No block-ready ${sourceCopy.accountsLabel} found within ${currentFollowersScanLimit} scanned accounts.`);
          return;
        }

        setStatus(`Preview ready: ${response.preview.readyCount} ${response.preview.readyCount === 1 ? sourceCopy.accountLabel : sourceCopy.readyLabel} can be blocked from @${response.preview.targetScreenName}.`);
      } catch (error) {
        if (isFollowerRunCanceledError(error)) {
          const sourceCopy = getFollowersSourceCopy(currentFollowersSource);

          setFollowersSummary(`${sourceCopy.graphLabel} scan canceled.`);
          renderFollowerBlockProgress({
            phase: 'canceled',
            source: currentFollowersSource,
            total: currentFollowersScanLimit
          });
          setStatus(`${sourceCopy.graphLabel} scan canceled.`);
          refreshPopupDebugLog();
          return;
        }

        logPopupError('Followers preview scan failed.', error);
        refreshPopupDebugLog();
        setFollowersSummary(`Scan failed: ${error instanceof Error ? error.message : String(error)}`);
        renderFollowerBlockProgress({ phase: 'idle' });
        setStatus(error instanceof Error ? error.message : String(error));
      } finally {
        isFollowersScanning = false;

        if (scanRunId && currentFollowersScanRunId === scanRunId) {
          currentFollowersScanRunId = null;
        }

        if (!currentFollowersScanRunId && !currentFollowersBlockRunId) {
          currentFollowerRunTabId = null;
        }

        setBusyState();
        refreshPopupDebugLog();
      }
    }

    async function blockScannedFollowers() {
      let blockRunId = null;

      try {
        if (isSaving || isBlocking || isFollowersScanning || isFollowersBlocking) {
          logPopupInfo('Follower block run ignored because popup is busy.', {
            isBlocking,
            isFollowersBlocking,
            isFollowersScanning,
            isSaving
          });
          refreshPopupDebugLog();
          return;
        }

        if (!currentFollowersPreview?.candidates?.length) {
          setStatus(`Run a ${getFollowersSourceCopy().graphLabel} preview scan first.`);
          refreshPopupDebugLog();
          return;
        }

        const sourceCopy = getFollowersSourceCopy(currentFollowersPreview.source || currentFollowersSource);

        logPopupInfo('Follower block run: resolving active X tab.');
        const targetTab = await findActiveXTab(extensionApi);
        logPopupInfo('Follower block run: active tab resolved.', targetTab);

        if (!targetTab?.id) {
          setStatus('Make the target x.com profile tab active first.');
          refreshPopupDebugLog();
          return;
        }

        isFollowersBlocking = true;
        blockRunId = createFollowerBlockRunId();
        currentFollowersBlockRunId = blockRunId;
        currentFollowerRunTabId = targetTab.id;
        setBusyState();
        renderFollowerBlockProgress({
          delayMs: currentDelayMs,
          phase: 'started',
          source: currentFollowersPreview.source || currentFollowersSource,
          total: currentFollowersPreview.candidates.length
        });
        setStatus(`Blocking ${currentFollowersPreview.candidates.length} scanned ${sourceCopy.readyLabel} with ${currentDelayMs} ms delay between requests...`);
        logPopupInfo('Starting follower block run from preview.', {
          candidateCount: currentFollowersPreview.candidates.length,
          delayMs: currentDelayMs,
          runId: currentFollowersBlockRunId,
          tabId: targetTab.id,
          tabUrl: targetTab.url
        });
        refreshPopupDebugLog();

        const previousPreview = currentFollowersPreview;
        const response = await requestFollowerBlocks(targetTab.id, previousPreview.candidates, currentDelayMs, extensionApi, blockRunId);

        if (response?.canceled) {
          renderFollowerBlockProgress({
            delayMs: currentDelayMs,
            phase: 'canceled',
            source: previousPreview.source || currentFollowersSource,
            total: previousPreview.candidates.length
          });
          setStatus(`Block run canceled for ${sourceCopy.graphLabel}.`);
          return;
        }

        if (!response?.ok) {
          logPopupError('Follower block run returned a non-ok response.', response);
          throw new Error(response?.error || 'The X page did not accept the followers block request.');
        }

        const results = Array.isArray(response.results) ? response.results : [];
        const successCount = results.filter((entry) => entry?.ok).length;
        const failedEntries = results.filter((entry) => !entry?.ok);

        renderFollowerBlockResultProgress(results, currentDelayMs, currentFollowersPreview.source || currentFollowersSource);

        logPopupInfo('Follower block run finished.', {
          failedEntries,
          results,
          successCount
        });
        refreshPopupDebugLog();

        if (failedEntries.length) {
          const failedPreview = failedEntries.slice(0, 3).map((entry) => `@${entry.username || entry.restId || 'unknown'}`).join(', ');

          renderFollowersPreview({
            ...previousPreview,
            candidates: failedEntries.map((entry) => ({
              restId: entry.restId || null,
              username: entry.username || null
            })),
            readyCount: failedEntries.length
          });
          setStatus(`Block run finished with errors: blocked ${successCount}/${results.length} ${sourceCopy.readyLabel}, failed ${failedEntries.length}. Delay used: ${currentDelayMs} ms. Failed: ${failedPreview}.`);
          return;
        }

        clearFollowersPreview('Preview cleared. Run a new scan for another batch.');
        setStatus(DEFAULT_STATUS_MESSAGE);
      } catch (error) {
        if (isFollowerRunCanceledError(error)) {
          const sourceCopy = getFollowersSourceCopy(currentFollowersPreview?.source || currentFollowersSource);

          renderFollowerBlockProgress({
            delayMs: currentDelayMs,
            phase: 'canceled',
            source: sourceCopy.source,
            total: currentFollowersPreview?.candidates?.length || 0
          });
          setStatus(`Block run canceled for ${sourceCopy.graphLabel}.`);
          refreshPopupDebugLog();
          return;
        }

        logPopupError('Follower block run failed.', error);
        refreshPopupDebugLog();
        renderFollowerBlockProgress({
          delayMs: currentDelayMs,
          failureCount: 1,
          phase: 'finished',
          successCount: 0,
          total: currentFollowersPreview?.candidates?.length || 0
        });
        setStatus(error instanceof Error ? error.message : String(error));
      } finally {
        isFollowersBlocking = false;

        if (blockRunId && currentFollowersBlockRunId === blockRunId) {
          currentFollowersBlockRunId = null;
        }

        if (!currentFollowersScanRunId && !currentFollowersBlockRunId) {
          currentFollowerRunTabId = null;
        }

        setBusyState();
        refreshPopupDebugLog();
      }
    }

    function promptForUsernameListName(message, defaultName = '') {
      const rawName = typeof globalThis.prompt === 'function'
        ? globalThis.prompt(message, defaultName)
        : defaultName;

      if (rawName === null) {
        return null;
      }

      return blocklist.normalizeUsernameListName(rawName, defaultName || blocklist.DEFAULT_USERNAME_LIST_NAME);
    }

    async function switchActiveUsernameList(listId = usernameListSelectElement.value) {
      if (!listId || isSaving || isBlocking || isFollowersScanning || isFollowersBlocking) {
        return;
      }

      persistUsernameDraft();
      await blocklist.setActiveUsernameListId(listId, extensionApi);
      const draftStatus = await refreshUsernameListStateFromStorage();
      setStatus(draftStatus || `Active list: ${currentActiveUsernameList?.name || 'Blocklist'}.`);
      setBusyState();
      persistCurrentPopupState();
    }

    async function createNewUsernameList() {
      if (isSaving || isBlocking || isFollowersScanning || isFollowersBlocking) {
        return;
      }

      persistUsernameDraft();
      const listName = promptForUsernameListName('New list name', 'New list');

      if (!listName) {
        return;
      }

      const nextList = blocklist.createUsernameList(
        listName,
        [],
        currentUsernameLists.map((list) => list.id)
      );
      await blocklist.setStoredUsernameLists([...currentUsernameLists, nextList], extensionApi);
      await blocklist.setActiveUsernameListId(nextList.id, extensionApi);
      await refreshUsernameListStateFromStorage();
      setStatus(`Created list: ${nextList.name}.`);
      setBusyState();
      persistCurrentPopupState();
    }

    async function renameActiveUsernameList() {
      if (!currentActiveUsernameList || isSaving || isBlocking || isFollowersScanning || isFollowersBlocking) {
        return;
      }

      const listName = promptForUsernameListName('Rename list', currentActiveUsernameList.name);

      if (!listName) {
        return;
      }

      const nextLists = currentUsernameLists.map((list) => list.id === currentActiveUsernameListId
        ? { ...list, name: listName }
        : list);

      await blocklist.setStoredUsernameLists(nextLists, extensionApi);
      await refreshUsernameListStateFromStorage();
      setStatus(`Renamed list to ${listName}.`);
      setBusyState();
      persistCurrentPopupState();
    }

    async function deleteActiveUsernameList() {
      if (!currentActiveUsernameList || currentUsernameLists.length <= 1 || isSaving || isBlocking || isFollowersScanning || isFollowersBlocking) {
        return;
      }

      if (typeof globalThis.confirm === 'function' && !globalThis.confirm(`Delete list "${currentActiveUsernameList.name}"?`)) {
        return;
      }

      const deletedListId = currentActiveUsernameListId;
      const deletedListIndex = currentUsernameLists.findIndex((list) => list.id === deletedListId);
      const nextLists = currentUsernameLists.filter((list) => list.id !== deletedListId);
      const nextActiveList = nextLists[Math.max(0, Math.min(deletedListIndex, nextLists.length - 1))] || nextLists[0];

      clearUsernameDraft(deletedListId);
      await blocklist.setStoredUsernameLists(nextLists, extensionApi);
      await blocklist.setActiveUsernameListId(nextActiveList.id, extensionApi);
      await refreshUsernameListStateFromStorage();
      setStatus(`Deleted list. Active list: ${currentActiveUsernameList?.name || nextActiveList.name}.`);
      setBusyState();
      persistCurrentPopupState();
    }

    function readImportFile(file) {
      if (!file) {
        return Promise.resolve('');
      }

      if (typeof file.text === 'function') {
        return file.text();
      }

      return new Promise((resolve, reject) => {
        if (typeof FileReader !== 'function') {
          reject(new Error('File import is not available in this browser context.'));
          return;
        }

        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => reject(reader.error || new Error('Failed to read import file.'));
        reader.readAsText(file);
      });
    }

    async function importUsernameText(text, fileName = '') {
      if (isSaving || isBlocking || isFollowersScanning || isFollowersBlocking) {
        return;
      }

      const parsedImport = blocklist.parseUsernameImport(text, fileName);
      const invalidSuffix = parsedImport.invalidEntries.length
        ? ` Skipped invalid values: ${parsedImport.invalidEntries.slice(0, 3).join(', ')}.`
        : '';

      if (parsedImport.lists.length) {
        const latestLists = hasUsernameListStorageApi()
          ? blocklist.normalizeUsernameLists(await blocklist.getStoredUsernameLists(extensionApi))
          : currentUsernameLists;
        const nextLists = blocklist.mergeUsernameLists(latestLists, parsedImport.lists);

        await blocklist.setStoredUsernameLists(nextLists, extensionApi);
        await refreshUsernameListStateFromStorage();
        setStatus(`Imported ${parsedImport.lists.length} list${parsedImport.lists.length === 1 ? '' : 's'}.${invalidSuffix}`);
        setBusyState();
        persistCurrentPopupState();
        return;
      }

      if (!parsedImport.usernames.length) {
        setStatus(`No valid usernames found in import.${invalidSuffix}`);
        return;
      }

      const visibleUsernames = blocklist.parseUsernameText(textareaElement.value).usernames;
      const savedUsernames = await mutateCurrentActiveUsernameListUsernames((latestUsernames) => ([
        ...latestUsernames,
        ...visibleUsernames,
        ...parsedImport.usernames
      ]));

      applySavedUsernamesToDraft(savedUsernames);
      setStatus(`Imported ${parsedImport.usernames.length} username${parsedImport.usernames.length === 1 ? '' : 's'} into ${currentActiveUsernameList?.name || 'the active list'}.${invalidSuffix}`);
      setBusyState();
      persistCurrentPopupState();
    }

    async function importUsernameFile(file) {
      const text = await readImportFile(file);
      await importUsernameText(text, file?.name || '');
    }

    async function addFollowersToActiveList() {
      if (isSaving || isBlocking || isFollowersScanning || isFollowersBlocking) {
        return;
      }

      if (!currentFollowersPreview?.candidates?.length) {
        setStatus('No scanned candidates to add.');
        return;
      }

      const scannedUsernames = currentFollowersPreview.candidates
        .map((candidate) => candidate.username)
        .filter((username) => typeof username === 'string' && username.trim() !== '');

      if (!scannedUsernames.length) {
        setStatus('No valid usernames found in the scan.');
        return;
      }

      isSaving = true;
      setBusyState();
      setStatus('Adding scanned users to active list...');

      try {
        const visibleUsernames = blocklist.parseUsernameText(textareaElement.value).usernames;
        const savedUsernames = await mutateCurrentActiveUsernameListUsernames((latestUsernames) => ([
          ...latestUsernames,
          ...visibleUsernames,
          ...scannedUsernames
        ]));

        applySavedUsernamesToDraft(savedUsernames);
        persistCurrentPopupState();

        setStatus(`Added ${scannedUsernames.length} usernames to list "${currentActiveUsernameList?.name || 'Blocklist'}".`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      } finally {
        isSaving = false;
        setBusyState();
      }
    }

    function observePopupUsernameLists() {
      if (typeof blocklist.observeActiveUsernameList !== 'function') {
        return () => {};
      }

      return blocklist.observeActiveUsernameList(() => {
        if (isHydratingPopupState) {
          return;
        }

        if (isUsernameDraftDirty) {
          setStatus(EXTERNAL_USERNAME_LIST_CHANGE_STATUS);
          return;
        }

        void refreshUsernameListStateFromStorage()
          .then((draftStatus) => {
            if (draftStatus) {
              setStatus(draftStatus);
            }
            setBusyState();
          })
          .catch((error) => {
            logPopupError('Failed to refresh username lists after storage change.', error);
          });
      }, extensionApi);
    }

    saveButton.addEventListener('click', () => {
      handleAsyncPopupAction('saveBlocklist', saveBlocklist);
    });

    saveSettingsButton.addEventListener('click', () => {
      handleAsyncPopupAction('saveSettings', saveSettings);
    });

    blockNowButton.addEventListener('click', () => {
      handleAsyncPopupAction('blockListedNow', blockListedNow);
    });

    clearListButton.addEventListener('click', () => {
      textareaElement.value = '';
      persistUsernameDraft();
      setStatus('List cleared. Click Save list to save this change.');
    });

    usernameListSelectLabelElement.addEventListener('click', () => {
      if (typeof usernameListSelectElement.focus === 'function') {
        usernameListSelectElement.focus();
      }

      if (!usernameListSelectElement.disabled) {
        toggleUsernameListDropdown();
      }
    });

    usernameListSelectElement.addEventListener('click', () => {
      toggleUsernameListDropdown();
    });

    usernameListSelectElement.addEventListener('keydown', handleUsernameListSelectKeydown);

    usernameListSelectElement.addEventListener('change', () => {
      handleAsyncPopupAction('switchActiveUsernameList', () => switchActiveUsernameList());
    });

    newUsernameListButton.addEventListener('click', () => {
      handleAsyncPopupAction('createNewUsernameList', createNewUsernameList);
    });

    renameUsernameListButton.addEventListener('click', () => {
      handleAsyncPopupAction('renameActiveUsernameList', renameActiveUsernameList);
    });

    deleteUsernameListButton.addEventListener('click', () => {
      handleAsyncPopupAction('deleteActiveUsernameList', deleteActiveUsernameList);
    });

    importUsernamesButton.addEventListener('click', () => {
      if (typeof importUsernamesFileInput.click === 'function') {
        importUsernamesFileInput.click();
      }
    });

    importUsernamesFileInput.addEventListener('change', (event) => {
      const [file] = Array.from(event?.target?.files || importUsernamesFileInput.files || []);

      if (!file) {
        return;
      }

      handleAsyncPopupAction('importUsernameFile', () => importUsernameFile(file));
      importUsernamesFileInput.value = '';
    });

    scanFollowersButton.addEventListener('click', () => {
      handleAsyncPopupAction('scanFollowersPreview', scanFollowersPreview);
    });

    blockFollowerCandidatesButton.addEventListener('click', () => {
      handleAsyncPopupAction('blockScannedFollowers', blockScannedFollowers);
    });

    cancelFollowersRunButton.addEventListener('click', () => {
      handleAsyncPopupAction('cancelActiveFollowerRun', cancelActiveFollowerRun);
    });

    addFollowersToListButton.addEventListener('click', () => {
      handleAsyncPopupAction('addFollowersToActiveList', addFollowersToActiveList);
    });

    openSettingsButton.addEventListener('click', () => {
      renderDelay(currentDelayMs);
      renderPageButtonStyles(currentPageButtonStyles);
      renderUserCellAddButtonStyle(currentUserCellAddButtonStyle);
      renderShowUserCellAddButton(currentShowUserCellAddButton);
      showSettingsView();
    });

    openFollowersButton.addEventListener('click', () => {
      renderFollowersBlockLimit(currentFollowersBlockLimit);
      renderFollowersScanLimit(currentFollowersScanLimit);
      renderFollowersSource(currentFollowersSource);
      showFollowersView();
    });

    backToMainButton.addEventListener('click', () => {
      renderDelay(currentDelayMs);
      renderPageButtonStyles(currentPageButtonStyles);
      renderUserCellAddButtonStyle(currentUserCellAddButtonStyle);
      renderShowUserCellAddButton(currentShowUserCellAddButton);
      showMainView();
    });

    backFromFollowersButton.addEventListener('click', () => {
      renderFollowersBlockLimit(currentFollowersBlockLimit);
      renderFollowersScanLimit(currentFollowersScanLimit);
      renderFollowersSource(currentFollowersSource);
      showMainView();
    });

    pageButtonStyleTweetIconElement.addEventListener('click', () => {
      setDraftPageButtonStyle(pageButtonStyleSurfaces.tweet, settings.PAGE_BLOCK_BUTTON_STYLES.icon);
    });

    pageButtonStyleTweetTextElement.addEventListener('click', () => {
      setDraftPageButtonStyle(pageButtonStyleSurfaces.tweet, settings.PAGE_BLOCK_BUTTON_STYLES.text);
    });

    pageButtonStyleProfileIconElement.addEventListener('click', () => {
      setDraftPageButtonStyle(pageButtonStyleSurfaces.profile, settings.PAGE_BLOCK_BUTTON_STYLES.icon);
    });

    pageButtonStyleProfileTextElement.addEventListener('click', () => {
      setDraftPageButtonStyle(pageButtonStyleSurfaces.profile, settings.PAGE_BLOCK_BUTTON_STYLES.text);
    });

    pageButtonStyleUserCellIconElement.addEventListener('click', () => {
      setDraftPageButtonStyle(pageButtonStyleSurfaces.userCell, settings.PAGE_BLOCK_BUTTON_STYLES.icon);
    });

    pageButtonStyleUserCellTextElement.addEventListener('click', () => {
      setDraftPageButtonStyle(pageButtonStyleSurfaces.userCell, settings.PAGE_BLOCK_BUTTON_STYLES.text);
    });

    userCellAddButtonStyleIconElement.addEventListener('click', () => {
      renderUserCellAddButtonStyle(settings.PAGE_BLOCK_BUTTON_STYLES.icon);
    });

    userCellAddButtonStyleTextElement.addEventListener('click', () => {
      renderUserCellAddButtonStyle(settings.PAGE_BLOCK_BUTTON_STYLES.text);
    });

    followersSourceFollowersElement.addEventListener('click', () => {
      updateFollowersSource(followers.FOLLOWERS_SOURCES.followers);
    });

    followersSourceFollowingElement.addEventListener('click', () => {
      updateFollowersSource(followers.FOLLOWERS_SOURCES.following);
    });

    delayInputElement.addEventListener('change', () => {
      renderDelay(readDelayMs());
    });

    textareaElement.addEventListener('input', persistUsernameDraft);
    textareaElement.addEventListener('change', persistUsernameDraft);

    followersBlockLimitElement.addEventListener('change', () => {
      currentFollowersBlockLimit = readFollowersBlockLimit();
      renderFollowersBlockLimit(currentFollowersBlockLimit);
      currentFollowersScanLimit = readFollowersScanLimit();
      renderFollowersScanLimit(currentFollowersScanLimit);
      clearFollowersPreview('Preview cleared. Run a new scan with the updated limits.');
      setBusyState();
    });

    followersScanLimitElement.addEventListener('change', () => {
      currentFollowersScanLimit = readFollowersScanLimit();
      renderFollowersScanLimit(currentFollowersScanLimit);
      clearFollowersPreview('Preview cleared. Run a new scan with the updated limits.');
      setBusyState();
    });

    clearPopupDebugLogButton.addEventListener('click', () => {
      clearStoredPopupDebugEntries();
      refreshPopupDebugLog();
      logPopupInfo('Popup debug log cleared by user.');
      refreshPopupDebugLog();
    });

    if (extensionApi.runtime?.onMessage?.addListener) {
      extensionApi.runtime.onMessage.addListener(handleFollowerBlockProgressMessage);
    }

    const stopUsernameListObservation = observePopupUsernameLists();

    const handleDocumentClick = (event) => {
      if (!isUsernameListDropdownOpen) {
        return;
      }

      const dropdownContainer = usernameListSelectElement.parentElement;
      const eventTarget = event?.target;

      if (dropdownContainer?.contains?.(eventTarget) || usernameListSelectLabelElement?.contains?.(eventTarget)) {
        return;
      }

      closeUsernameListDropdown();
    };

    if (typeof documentRef.addEventListener === 'function') {
      documentRef.addEventListener('click', handleDocumentClick);
    }

    if (typeof globalThis.addEventListener === 'function') {
      globalThis.addEventListener('unload', stopUsernameListObservation, { once: true });
      globalThis.addEventListener('unload', () => {
        if (typeof documentRef.removeEventListener === 'function') {
          documentRef.removeEventListener('click', handleDocumentClick);
        }
      }, { once: true });
    }

    renderPageButtonStyles(currentPageButtonStyles);
    renderUserCellAddButtonStyle(currentUserCellAddButtonStyle);
    renderFollowersBlockLimit(currentFollowersBlockLimit);
    renderFollowersScanLimit(currentFollowersScanLimit);
    renderFollowersSource(currentFollowersSource);
    clearFollowersPreview();
    renderFollowerBlockProgress({ phase: 'idle' });
    refreshPopupDebugLog();
    showMainView();
    setBusyState();
    void loadBlocklist().catch((error) => {
      renderFatalPopupError(error, documentRef);
    });
  }

  if (typeof module !== 'undefined') {
    module.exports = {
      CONTENT_SCRIPT_CSS_FILES,
      CONTENT_SCRIPT_FILES,
      FOLLOWERS_BLOCK_MESSAGE_TYPE,
      FOLLOWERS_BLOCK_PROGRESS_MESSAGE_TYPE,
      FOLLOWERS_CANCEL_MESSAGE_TYPE,
      FOLLOWERS_RUN_PORT_PREFIX,
      FOLLOWERS_SCAN_MESSAGE_TYPE,
      IMMEDIATE_BLOCK_MESSAGE_TYPE,
      POPUP_VIEWS,
      ensureContentScriptsInTab,
      executeTabFunction,
      findActiveXTab,
      findUsableXTab,
      formatPopupError,
      init,
      invokeImmediateBlockInTab,
      isMissingReceiverError,
      isSupportedTabUrl,
      logPopupWarn,
      loadStoredPopupDebugEntries,
      logPopupError,
      logPopupInfo,
      normalizePopupView,
      renderPopupDebugLog,
      queryTabs,
      emitPopupOpenDebug,
      registerPopupErrorHandlers,
      renderFatalPopupError,
      requestFollowerBlocks,
      requestFollowersPreview,
      requestImmediateBlock,
      requestMessageWithContentScript,
      clearStoredPopupDebugEntries,
      clearStoredPopupState,
      appendPopupDebugEntry,
      connectFollowerRunPort,
      loadStoredPopupState,
      requestCancelFollowerRun,
      setPopupView,
      safeSerializePopupDetails,
      saveStoredPopupDebugEntries,
      saveStoredPopupState,
      sendFollowerRunMessage,
      sendTabMessage
    };
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    registerPopupErrorHandlers(window, document);
  }

  if (typeof document !== 'undefined') {
    try {
      init(document);
    } catch (error) {
      renderFatalPopupError(error, document);
    }
  }
})();
