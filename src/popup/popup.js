(() => {
  const PAGE_LOG_PREFIX = '[Easy TweetBlock][page]';
  const POPUP_DEBUG_STORAGE_KEY = 'easyTweetBlockPopupDebugLog';
  const POPUP_STATE_STORAGE_KEY = 'easyTweetBlockPopupState';
  const POPUP_LOG_PREFIX = '[Easy TweetBlock][popup]';
  const MAX_POPUP_DEBUG_ENTRIES = 120;

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

  function loadStoredPopupDebugEntries(storageRef = globalThis.localStorage) {
    try {
      const rawValue = storageRef?.getItem?.(POPUP_DEBUG_STORAGE_KEY);

      if (!rawValue) {
        return [];
      }

      const parsedValue = JSON.parse(rawValue);
      return Array.isArray(parsedValue) ? parsedValue.filter((entry) => typeof entry === 'string') : [];
    } catch {
      return [];
    }
  }

  function saveStoredPopupDebugEntries(entries, storageRef = globalThis.localStorage) {
    try {
      storageRef?.setItem?.(POPUP_DEBUG_STORAGE_KEY, JSON.stringify(entries.slice(-MAX_POPUP_DEBUG_ENTRIES)));
    } catch {
      // Ignore storage write failures during debug logging.
    }
  }

  function appendPopupDebugEntry(level, message, details, storageRef = globalThis.localStorage) {
    const timestamp = new Date().toISOString();
    const detailsText = safeSerializePopupDetails(details);
    const composedEntry = detailsText
      ? `${timestamp} ${level} ${message}\n${detailsText}`
      : `${timestamp} ${level} ${message}`;
    const entries = loadStoredPopupDebugEntries(storageRef);

    entries.push(composedEntry);
    saveStoredPopupDebugEntries(entries, storageRef);
    globalThis.__easyTweetBlockPopupDebugEntries__ = entries;
    return composedEntry;
  }

  function clearStoredPopupDebugEntries(storageRef = globalThis.localStorage) {
    try {
      storageRef?.removeItem?.(POPUP_DEBUG_STORAGE_KEY);
    } catch {
      // Ignore storage cleanup failures during debug logging.
    }

    globalThis.__easyTweetBlockPopupDebugEntries__ = [];
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

  if (!contentScriptFilesApi) {
    renderFatalPopupError(new Error('Missing Easy TweetBlock content script file config.'));
    return;
  }

  if (!followersApi) {
    renderFatalPopupError(new Error('Missing Easy TweetBlock followers shared API.'));
    return;
  }

  const IMMEDIATE_BLOCK_MESSAGE_TYPE = 'easy-tweetblock:block-usernames-via-api';
  const FOLLOWERS_BLOCK_MESSAGE_TYPE = 'easy-tweetblock:block-follower-candidates-via-api';
  const FOLLOWERS_BLOCK_PROGRESS_MESSAGE_TYPE = 'easy-tweetblock:follower-block-progress';
  const FOLLOWERS_SCAN_MESSAGE_TYPE = 'easy-tweetblock:scan-followers-for-block';
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

  function sleep(ms) {
    return new Promise((resolve) => {
      globalThis.setTimeout(resolve, ms);
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

  async function invokeFollowersPreviewInTab(tabId, blockLimit, scanLimit, extensionApi = getExtensionApi()) {
    const results = await executeTabFunction(
      tabId,
      async (requestedBlockLimit, requestedScanLimit) => {
        if (typeof globalThis.EasyTweetBlockContent?.scanFollowersForBlocking !== 'function') {
          throw new Error('Easy TweetBlock followers preview runner is not available in this tab.');
        }

        return globalThis.EasyTweetBlockContent.scanFollowersForBlocking({
          blockLimit: requestedBlockLimit,
          scanLimit: requestedScanLimit
        });
      },
      [blockLimit, scanLimit],
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
  }

  async function invokeFollowerBlocksInTab(tabId, candidates, delayMs, extensionApi = getExtensionApi()) {
    const results = await executeTabFunction(
      tabId,
      async (requestedCandidates, requestedDelayMs) => {
        if (typeof globalThis.EasyTweetBlockContent?.blockFollowerCandidatesViaApi !== 'function') {
          throw new Error('Easy TweetBlock follower block runner is not available in this tab.');
        }

        return globalThis.EasyTweetBlockContent.blockFollowerCandidatesViaApi(requestedCandidates, {
          delayMs: requestedDelayMs
        });
      },
      [candidates, delayMs],
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
  }

  async function requestFollowersPreview(tabId, blockLimit, scanLimit, extensionApi = getExtensionApi()) {
    try {
      return await sendTabMessage(tabId, {
        options: {
          blockLimit,
          scanLimit
        },
        type: FOLLOWERS_SCAN_MESSAGE_TYPE
      }, extensionApi);
    } catch (error) {
      if (!isMissingReceiverError(error)) {
        logPopupError(`Followers preview message delivery failed for tab ${tabId}.`, error);
        throw error;
      }

      logPopupInfo(`Followers preview content script missing in tab ${tabId}; injecting before direct execution fallback.`, {
        blockLimit,
        scanLimit
      });
      await ensureContentScriptsInTab(tabId, extensionApi, CONTENT_SCRIPT_FILES, []);
      logPopupInfo(`Retrying followers preview message in tab ${tabId} after injection.`, {
        blockLimit,
        scanLimit
      });

      try {
        await sleep(50);
        return await sendTabMessage(tabId, {
          options: {
            blockLimit,
            scanLimit
          },
          type: FOLLOWERS_SCAN_MESSAGE_TYPE
        }, extensionApi);
      } catch (retryError) {
        logPopupError(`Followers preview message retry failed for tab ${tabId}; falling back to direct execution.`, retryError);
        logPopupInfo(`Invoking followers preview directly in tab ${tabId} after message retry failure.`, {
          blockLimit,
          scanLimit
        });
        return invokeFollowersPreviewInTab(tabId, blockLimit, scanLimit, extensionApi);
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
      return await sendTabMessage(tabId, message, extensionApi);
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
        return await sendTabMessage(tabId, message, extensionApi);
      } catch (retryError) {
        logPopupError(`Follower block message retry failed for tab ${tabId}; falling back to direct execution.`, retryError);
        logPopupInfo(`Invoking follower block run directly in tab ${tabId} after message retry failure.`, {
          candidateCount: Array.isArray(candidates) ? candidates.length : 0,
          delayMs
        });
        return invokeFollowerBlocksInTab(tabId, candidates, delayMs, extensionApi);
      }
    }
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

  function init(documentRef = document, extensionApi = getExtensionApi(), blocklist = globalThis.EasyTweetBlockBlocklist, followers = followersApi) {
    const DEFAULT_FOLLOWERS_SUMMARY = 'Open a profile or followers page in the active X tab, then run a preview scan.';
    const shellElement = documentRef.getElementById('popup-shell');
    const statusElement = documentRef.getElementById('status');
    const textareaElement = documentRef.getElementById('username-blocklist');
    const delayInputElement = documentRef.getElementById('batch-block-delay-ms');
    const pageButtonStyleIconElement = documentRef.getElementById('page-button-style-icon');
    const pageButtonStyleTextElement = documentRef.getElementById('page-button-style-text');
    const openSettingsButton = documentRef.getElementById('open-settings');
    const openFollowersButton = documentRef.getElementById('open-followers');
    const backToMainButton = documentRef.getElementById('back-to-main');
    const backFromFollowersButton = documentRef.getElementById('back-from-followers');
    const saveButton = documentRef.getElementById('save-blocklist');
    const saveSettingsButton = documentRef.getElementById('save-settings');
    const blockNowButton = documentRef.getElementById('block-now');
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
    const scanFollowersButton = documentRef.getElementById('scan-followers-preview');
    const blockFollowerCandidatesButton = documentRef.getElementById('block-follower-candidates');
    const popupDebugLogElement = documentRef.getElementById('popup-debug-log');
    const clearPopupDebugLogButton = documentRef.getElementById('clear-popup-debug-log');

    let isSaving = false;
    let isBlocking = false;
    let isFollowersScanning = false;
    let isFollowersBlocking = false;
    let currentDelayMs = blocklist?.DEFAULT_BATCH_BLOCK_DELAY_MS;
    let currentPageButtonStyle = blocklist?.DEFAULT_PAGE_BLOCK_BUTTON_STYLE;
    let currentFollowersBlockLimit = followers?.DEFAULT_FOLLOWERS_BLOCK_LIMIT;
    let currentFollowersBlockRunId = null;
    let currentFollowersPreview = null;
    let currentFollowersScanLimit = followers?.DEFAULT_FOLLOWERS_SCAN_LIMIT;
    let draftPageButtonStyle = currentPageButtonStyle;
    const storedPopupState = loadStoredPopupState();
    let isHydratingPopupState = true;

    if (!blocklist || !followers || !extensionApi || !shellElement || !statusElement || !textareaElement || !delayInputElement || !pageButtonStyleIconElement || !pageButtonStyleTextElement || !openSettingsButton || !openFollowersButton || !backToMainButton || !backFromFollowersButton || !saveButton || !saveSettingsButton || !blockNowButton || !countElement || !followersBlockLimitElement || !followersScanLimitElement || !followersSummaryElement || !followersPreviewElement || !followersBlockProgressElement || !followersProgressCountElement || !followersProgressDetailElement || !followersProgressFillElement || !followersProgressLabelElement || !scanFollowersButton || !blockFollowerCandidatesButton || !popupDebugLogElement || !clearPopupDebugLogButton) {
      return;
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
        statusMessage: statusElement.textContent || '',
        usernameDraftText: textareaElement.value || '',
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

    function readDelayMs() {
      return blocklist.normalizeBatchBlockDelayMs(delayInputElement.value);
    }

    function renderDelay(delayMs) {
      delayInputElement.value = String(blocklist.normalizeBatchBlockDelayMs(delayMs));
    }

    function readPageButtonStyle() {
      return blocklist.normalizePageBlockButtonStyle(draftPageButtonStyle);
    }

    function renderPageButtonStyle(style) {
      draftPageButtonStyle = blocklist.normalizePageBlockButtonStyle(style);

      pageButtonStyleIconElement.dataset.active = String(draftPageButtonStyle === blocklist.PAGE_BLOCK_BUTTON_STYLES.icon);
      pageButtonStyleTextElement.dataset.active = String(draftPageButtonStyle === blocklist.PAGE_BLOCK_BUTTON_STYLES.text);
      pageButtonStyleIconElement.setAttribute('aria-pressed', String(draftPageButtonStyle === blocklist.PAGE_BLOCK_BUTTON_STYLES.icon));
      pageButtonStyleTextElement.setAttribute('aria-pressed', String(draftPageButtonStyle === blocklist.PAGE_BLOCK_BUTTON_STYLES.text));
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

    function setFollowersSummary(message) {
      followersSummaryElement.textContent = message;
    }

    function formatFollowersPreviewSummaryText(preview, targetLabel) {
      const scannedLabel = preview.scannedCount === 1 ? '1 follower' : `${preview.scannedCount} followers`;
      return `Scanned ${scannedLabel} from ${targetLabel}. Already blocked: ${preview.alreadyBlockedCount}. Ready: ${preview.readyCount}.${preview.hasMorePages ? ' More followers remain beyond this preview.' : ''}`;
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
      const scannedLabel = preview.scannedCount === 1 ? '1 follower' : `${preview.scannedCount} followers`;

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
        appendFollowersSummaryText(summaryNodes, ' More followers remain beyond this preview.', 'followers-summary-note');
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
      const delayMs = blocklist.normalizeBatchBlockDelayMs(progress.delayMs ?? currentDelayMs);
      const phase = typeof progress.phase === 'string' ? progress.phase : 'idle';
      const candidateLabel = getFollowerProgressCandidateLabel(progress.candidate);
      let state = 'running';
      let label = 'Block run in progress';
      let detail = `Blocked ${successCount}, failed ${failureCount}. Delay between requests: ${delayMs} ms.`;

      if (phase === 'idle') {
        state = 'idle';
        label = 'Preview required';
        detail = 'Run a scan to prepare a block-ready follower batch.';
      } else if (phase === 'scanning') {
        state = 'running';
        label = 'Scanning followers';
        detail = `Checking up to ${total || currentFollowersScanLimit} followers. Already-blocked accounts will be skipped.`;
      } else if (phase === 'ready') {
        state = 'ready';
        label = `Ready to block ${total} follower${total === 1 ? '' : 's'}`;
        detail = `Click Block ready to start. Delay from Settings: ${delayMs} ms between requests.`;
      } else if (phase === 'started') {
        label = `Starting block run for ${total} followers`;
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

    function renderFollowerBlockResultProgress(results, delayMs) {
      const normalizedResults = Array.isArray(results) ? results : [];
      const successCount = normalizedResults.filter((entry) => entry?.ok).length;
      const failureCount = normalizedResults.length - successCount;

      renderFollowerBlockProgress({
        completed: normalizedResults.length,
        delayMs,
        failureCount,
        phase: 'finished',
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
      followersPreviewElement.textContent = previewLines.length ? previewLines.join('\n') : 'No block-ready followers were found within the current scan limit.';
      renderFollowerBlockProgress(preview.candidates.length
        ? {
          delayMs: currentDelayMs,
          phase: 'ready',
          total: preview.candidates.length
        }
        : { phase: 'idle' });
      persistCurrentPopupState();
    }

    function setBusyState() {
      const isAnyBusy = isSaving || isBlocking || isFollowersScanning || isFollowersBlocking;

      saveButton.disabled = isAnyBusy;
      blockNowButton.disabled = isAnyBusy;
      saveSettingsButton.disabled = isAnyBusy;
      openSettingsButton.disabled = isAnyBusy;
      openFollowersButton.disabled = isAnyBusy;
      backToMainButton.disabled = isAnyBusy;
      backFromFollowersButton.disabled = isAnyBusy;
      scanFollowersButton.disabled = isAnyBusy;
      blockFollowerCandidatesButton.disabled = isAnyBusy || !currentFollowersPreview?.candidates?.length;
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

    function handleAsyncPopupAction(actionName, action) {
      Promise.resolve()
        .then(action)
        .catch((error) => {
          logPopupError(`${actionName} crashed with an unhandled error.`, error);
          refreshPopupDebugLog();
          setStatus(error instanceof Error ? error.message : String(error));
        });
    }

    async function loadBlocklist() {
      const [usernames, delayMs, pageButtonStyle] = await Promise.all([
        blocklist.getStoredUsernames(extensionApi),
        blocklist.getStoredBatchBlockDelayMs(extensionApi),
        blocklist.getStoredPageBlockButtonStyle(extensionApi)
      ]);

      textareaElement.value = typeof storedPopupState.usernameDraftText === 'string'
        ? storedPopupState.usernameDraftText
        : blocklist.serializeUsernameText(usernames);
      renderCount(blocklist.parseUsernameText(textareaElement.value).usernames);
      renderDelay(delayMs);
      currentDelayMs = delayMs;
      currentPageButtonStyle = pageButtonStyle;
      currentFollowersBlockLimit = followers.normalizeFollowersBlockLimit(
        storedPopupState.followersBlockLimit ?? followers.DEFAULT_FOLLOWERS_BLOCK_LIMIT
      );
      currentFollowersScanLimit = followers.normalizeFollowersScanLimit(
        storedPopupState.followersScanLimit ?? followers.DEFAULT_FOLLOWERS_SCAN_LIMIT
      );
      renderFollowersBlockLimit(currentFollowersBlockLimit);
      renderFollowersScanLimit(currentFollowersScanLimit);
      renderPageButtonStyle(pageButtonStyle);
      const storedFollowersPreview = normalizeStoredFollowersPreview(storedPopupState.followersPreview);

      if (storedFollowersPreview) {
        renderFollowersPreview(storedFollowersPreview);
      } else {
        clearFollowersPreview();
      }

      setStatus(typeof storedPopupState.statusMessage === 'string' && storedPopupState.statusMessage.trim()
        ? storedPopupState.statusMessage
        : 'Save usernames for later, or block the whole list immediately through any open X tab.');
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
        const savedUsernames = await blocklist.setStoredUsernames(usernames, extensionApi);

        textareaElement.value = blocklist.serializeUsernameText(savedUsernames);
        renderCount(savedUsernames);

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
      const pageButtonStyle = readPageButtonStyle();

      isSaving = true;
      setBusyState();
      setStatus('Saving settings...');

      try {
        const [savedDelayMs, savedPageButtonStyle] = await Promise.all([
          blocklist.setStoredBatchBlockDelayMs(delayMs, extensionApi),
          blocklist.setStoredPageBlockButtonStyle(pageButtonStyle, extensionApi)
        ]);

        currentDelayMs = savedDelayMs;
        renderDelay(savedDelayMs);
        currentPageButtonStyle = savedPageButtonStyle;
        renderPageButtonStyle(savedPageButtonStyle);
        setStatus(`Saved settings. Delay: ${savedDelayMs} ms. Style: ${savedPageButtonStyle}.`);
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
        const savedUsernames = await blocklist.setStoredUsernames(usernames, extensionApi);
        const targetTab = await findUsableXTab(extensionApi);

        textareaElement.value = blocklist.serializeUsernameText(savedUsernames);
        renderCount(savedUsernames);

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
        renderFollowersBlockLimit(currentFollowersBlockLimit);
        renderFollowersScanLimit(currentFollowersScanLimit);

        isFollowersScanning = true;
        setBusyState();
        setFollowersSummary(`Scanning up to ${currentFollowersScanLimit} followers from the active X tab...`);
        renderFollowerBlockProgress({
          phase: 'scanning',
          total: currentFollowersScanLimit
        });
        setStatus('Followers scan running.');
        logPopupInfo('Starting followers preview scan.', {
          blockLimit: currentFollowersBlockLimit,
          scanLimit: currentFollowersScanLimit,
          tabId: targetTab.id,
          tabUrl: targetTab.url
        });
        refreshPopupDebugLog();

        const response = await requestFollowersPreview(targetTab.id, currentFollowersBlockLimit, currentFollowersScanLimit, extensionApi);

        if (!response?.ok) {
          logPopupError('Followers preview scan returned a non-ok response.', response);
          throw new Error(response?.error || 'The X page did not accept the followers scan request.');
        }

        logPopupInfo('Followers preview scan response received.', response.preview || response);
        renderFollowersPreview(response.preview || null);
        refreshPopupDebugLog();

        if (!response?.preview?.candidates?.length) {
          setStatus(`Scan complete. No block-ready followers found within ${currentFollowersScanLimit} scanned accounts.`);
          return;
        }

        setStatus(`Preview ready: ${response.preview.readyCount} followers can be blocked from @${response.preview.targetScreenName}.`);
      } catch (error) {
        logPopupError('Followers preview scan failed.', error);
        refreshPopupDebugLog();
        setFollowersSummary(`Scan failed: ${error instanceof Error ? error.message : String(error)}`);
        renderFollowerBlockProgress({ phase: 'idle' });
        setStatus(error instanceof Error ? error.message : String(error));
      } finally {
        isFollowersScanning = false;
        setBusyState();
        refreshPopupDebugLog();
      }
    }

    async function blockScannedFollowers() {
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
          setStatus('Run a followers preview scan first.');
          refreshPopupDebugLog();
          return;
        }

        logPopupInfo('Follower block run: resolving active X tab.');
        const targetTab = await findActiveXTab(extensionApi);
        logPopupInfo('Follower block run: active tab resolved.', targetTab);

        if (!targetTab?.id) {
          setStatus('Make the target x.com profile tab active first.');
          refreshPopupDebugLog();
          return;
        }

        isFollowersBlocking = true;
        currentFollowersBlockRunId = createFollowerBlockRunId();
        setBusyState();
        renderFollowerBlockProgress({
          delayMs: currentDelayMs,
          phase: 'started',
          total: currentFollowersPreview.candidates.length
        });
        setStatus(`Blocking ${currentFollowersPreview.candidates.length} scanned followers with ${currentDelayMs} ms delay between requests...`);
        logPopupInfo('Starting follower block run from preview.', {
          candidateCount: currentFollowersPreview.candidates.length,
          delayMs: currentDelayMs,
          runId: currentFollowersBlockRunId,
          tabId: targetTab.id,
          tabUrl: targetTab.url
        });
        refreshPopupDebugLog();

        const previousPreview = currentFollowersPreview;
        const response = await requestFollowerBlocks(targetTab.id, previousPreview.candidates, currentDelayMs, extensionApi, currentFollowersBlockRunId);

        if (!response?.ok) {
          logPopupError('Follower block run returned a non-ok response.', response);
          throw new Error(response?.error || 'The X page did not accept the followers block request.');
        }

        const results = Array.isArray(response.results) ? response.results : [];
        const successCount = results.filter((entry) => entry?.ok).length;
        const failedEntries = results.filter((entry) => !entry?.ok);

        renderFollowerBlockResultProgress(results, currentDelayMs);

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
          setStatus(`Block run finished with errors: blocked ${successCount}/${results.length}, failed ${failedEntries.length}. Delay used: ${currentDelayMs} ms. Failed: ${failedPreview}.`);
          return;
        }

        clearFollowersPreview('Preview cleared. Run a new scan for another batch.');
        setStatus(`Block run complete: blocked ${successCount}/${results.length} followers. Delay used: ${currentDelayMs} ms between requests.`);
      } catch (error) {
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
        currentFollowersBlockRunId = null;
        setBusyState();
        refreshPopupDebugLog();
      }
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

    scanFollowersButton.addEventListener('click', () => {
      handleAsyncPopupAction('scanFollowersPreview', scanFollowersPreview);
    });

    blockFollowerCandidatesButton.addEventListener('click', () => {
      handleAsyncPopupAction('blockScannedFollowers', blockScannedFollowers);
    });

    openSettingsButton.addEventListener('click', () => {
      renderDelay(currentDelayMs);
      renderPageButtonStyle(currentPageButtonStyle);
      showSettingsView();
    });

    openFollowersButton.addEventListener('click', () => {
      renderFollowersBlockLimit(currentFollowersBlockLimit);
      renderFollowersScanLimit(currentFollowersScanLimit);
      showFollowersView();
    });

    backToMainButton.addEventListener('click', () => {
      renderDelay(currentDelayMs);
      renderPageButtonStyle(currentPageButtonStyle);
      showMainView();
    });

    backFromFollowersButton.addEventListener('click', () => {
      renderFollowersBlockLimit(currentFollowersBlockLimit);
      renderFollowersScanLimit(currentFollowersScanLimit);
      showMainView();
    });

    pageButtonStyleIconElement.addEventListener('click', () => {
      renderPageButtonStyle(blocklist.PAGE_BLOCK_BUTTON_STYLES.icon);
    });

    pageButtonStyleTextElement.addEventListener('click', () => {
      renderPageButtonStyle(blocklist.PAGE_BLOCK_BUTTON_STYLES.text);
    });

    delayInputElement.addEventListener('change', () => {
      renderDelay(readDelayMs());
    });

    function persistUsernameDraft() {
      renderCount(blocklist.parseUsernameText(textareaElement.value).usernames);
      persistCurrentPopupState();
    }

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

    renderPageButtonStyle(currentPageButtonStyle);
    renderFollowersBlockLimit(currentFollowersBlockLimit);
    renderFollowersScanLimit(currentFollowersScanLimit);
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
      loadStoredPopupState,
      setPopupView,
      safeSerializePopupDetails,
      saveStoredPopupDebugEntries,
      saveStoredPopupState,
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
