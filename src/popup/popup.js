(() => {
  const PAGE_LOG_PREFIX = '[Easy TweetBlock][page]';
  const POPUP_STATE_STORAGE_KEY = 'easyTweetBlockPopupState';
  const DEFAULT_STATUS_MESSAGE = 'Save usernames for later, or block the whole list immediately through any open X tab.';
  const OUTDATED_USERNAME_DRAFT_STATUS = 'Unsaved draft was outdated; loaded the saved list.';
  const EXTERNAL_USERNAME_LIST_CHANGE_STATUS = 'The active list changed elsewhere; your unsaved edits were kept.';
  const TOAST_AUTO_DISMISS_MS = 4200;

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

  const contentScriptFilesApi = globalThis.EasyTweetBlockContentScriptFiles
    || (typeof module !== 'undefined' && module.exports ? require('../shared/content-script-files.js') : null);
  const followerCandidatesApi = globalThis.EasyTweetBlockFollowerCandidates
    || (typeof module !== 'undefined' && module.exports ? require('../shared/follower-candidates.js') : null);
  const followerScanControllerApi = globalThis.EasyTweetBlockFollowerScanController
    || (typeof module !== 'undefined' && module.exports ? require('../shared/follower-scan-controller.js') : null);
  const followersApi = globalThis.EasyTweetBlockFollowers
    || (typeof module !== 'undefined' && module.exports ? require('../shared/followers.js') : null);
  const followerScanSessionsApi = globalThis.EasyTweetBlockFollowerScanSessions
    || (typeof module !== 'undefined' && module.exports ? require('../shared/follower-scan-session.js') : null);
  const popupDebugApi = globalThis.EasyTweetBlockPopupDebug
    || (typeof module !== 'undefined' && module.exports ? require('./debug-log.js') : null);
  const settingsApi = globalThis.EasyTweetBlockSettings
    || (typeof module !== 'undefined' && module.exports ? require('../shared/settings.js') : null);
  const usernameListsApi = globalThis.EasyTweetBlockUsernameLists
    || (typeof module !== 'undefined' && module.exports ? require('../shared/username-lists.js') : null);
  const xPlatformApi = globalThis.EasyTweetBlockXPlatform
    || (typeof module !== 'undefined' && module.exports ? require('../shared/x-platform.js') : null);

  if (!popupDebugApi) {
    throw new Error('Missing Easy TweetBlock popup debug API.');
  }

  const {
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
  } = popupDebugApi;

  if (!contentScriptFilesApi) {
    renderFatalPopupError(new Error('Missing Easy TweetBlock content script file config.'));
    return;
  }

  if (!followerCandidatesApi) {
    renderFatalPopupError(new Error('Missing Easy TweetBlock follower candidate API.'));
    return;
  }

  if (!followerScanControllerApi) {
    renderFatalPopupError(new Error('Missing Easy TweetBlock follower scan controller API.'));
    return;
  }

  if (!followersApi) {
    renderFatalPopupError(new Error('Missing Easy TweetBlock followers shared API.'));
    return;
  }

  if (!followerScanSessionsApi) {
    renderFatalPopupError(new Error('Missing Easy TweetBlock follower scan session API.'));
    return;
  }

  if (!settingsApi) {
    renderFatalPopupError(new Error('Missing Easy TweetBlock settings shared API.'));
    return;
  }

  if (!usernameListsApi) {
    renderFatalPopupError(new Error('Missing Easy TweetBlock username list API.'));
    return;
  }

  if (!xPlatformApi) {
    renderFatalPopupError(new Error('Missing Easy TweetBlock x-platform API.'));
    return;
  }

  const sleep = followersApi.sleep;
  const { DEFAULT_X_ORIGIN } = xPlatformApi;

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
      && (url.startsWith(`${DEFAULT_X_ORIGIN}/`) || url.startsWith('https://twitter.com/'));
  }

  function readScreenNameFromTabUrl(url) {
    if (!isSupportedTabUrl(url)) {
      return null;
    }

    try {
      const pathname = new URL(url).pathname || '';
      const [firstPathSegment] = pathname.split('/').filter(Boolean);
      const normalizedSegment = typeof firstPathSegment === 'string' ? firstPathSegment.trim() : '';

      if (!normalizedSegment) {
        return null;
      }

      if (typeof followersApi?.isReservedPathSegment === 'function' && followersApi.isReservedPathSegment(normalizedSegment)) {
        return null;
      }

      const normalizedScreenName = normalizedSegment.replace(/^@+/, '').toLowerCase();
      return /^[a-z0-9_]{1,15}$/i.test(normalizedScreenName)
        ? normalizedScreenName
        : null;
    } catch {
      return null;
    }
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

  async function invokeFollowersPreviewInTab(tabId, blockLimit, scanLimit, source, extensionApi = getExtensionApi(), runId = null, resumeState = null) {
    const port = connectFollowerRunPort(tabId, runId, extensionApi);

    try {
      const results = await executeTabFunction(
        tabId,
        async (requestedBlockLimit, requestedScanLimit, requestedSource, requestedResumeState, requestedRunId) => {
          if (typeof globalThis.EasyTweetBlockContent?.scanFollowersForBlocking !== 'function') {
            throw new Error('Easy TweetBlock followers preview runner is not available in this tab.');
          }

          const followerRun = globalThis.EasyTweetBlockContent.startFollowerRun?.(requestedRunId) || {};

          try {
            return await globalThis.EasyTweetBlockContent.scanFollowersForBlocking({
              blockLimit: requestedBlockLimit,
              resumeState: requestedResumeState,
              scanLimit: requestedScanLimit,
              source: requestedSource
            }, {
              signal: followerRun.signal || null
            });
          } finally {
            globalThis.EasyTweetBlockContent.finishFollowerRun?.(followerRun.runId, followerRun.controller);
          }
        },
        [blockLimit, scanLimit, source, resumeState, runId],
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

  async function requestFollowersPreview(tabId, blockLimit, scanLimit, source, extensionApi = getExtensionApi(), runId = null, resumeState = null) {
    const message = {
      options: {
        blockLimit,
        resumeState,
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
          hasResumeState: Boolean(resumeState),
          scanLimit,
          source
        });
        return invokeFollowersPreviewInTab(tabId, blockLimit, scanLimit, source, extensionApi, runId, resumeState);
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

    const xTabs = await queryTabs({ url: [`${DEFAULT_X_ORIGIN}/*`, 'https://twitter.com/*'] }, extensionApi);
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

  function init(
    documentRef = document,
    extensionApi = getExtensionApi(),
    blocklist = globalThis.EasyTweetBlockBlocklist,
    followers = followersApi,
    settings = globalThis.EasyTweetBlockSettings || settingsApi,
    followerScanSessions = globalThis.EasyTweetBlockFollowerScanSessions
      || (typeof module !== 'undefined' && module.exports ? require('../shared/follower-scan-session.js') : null)
  ) {
    const DEFAULT_FOLLOWERS_SUMMARY = 'Open a profile, followers, or following page in the active X tab, then run a preview scan.';
    const shellElement = documentRef.getElementById('popup-shell');
    const statusElement = documentRef.getElementById('status');
    const toastRegionElement = documentRef.getElementById('popup-toast-region');
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
    const scanFollowersButtonLabelElement = documentRef.getElementById('scan-followers-preview-label');
    const blockFollowerCandidatesButton = documentRef.getElementById('block-follower-candidates');

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
    let isFollowersSessionResetting = false;
    let currentFollowerRunTabId = null;
    let currentDelayMs = settings?.DEFAULT_BATCH_BLOCK_DELAY_MS;
    let currentPageButtonStyles = normalizePageButtonStylesValue(
      settings?.DEFAULT_PAGE_BLOCK_BUTTON_STYLES || settings?.DEFAULT_PAGE_BLOCK_BUTTON_STYLE
    );
    let currentUserCellAddButtonStyle = settings?.DEFAULT_USER_CELL_ADD_BUTTON_STYLE || settings?.DEFAULT_PAGE_BLOCK_BUTTON_STYLE || settings?.PAGE_BLOCK_BUTTON_STYLES?.icon || 'icon';
    let currentShowUserCellAddButton = settings?.DEFAULT_USER_CELL_ADD_BUTTON_VISIBILITY;
    let currentFollowersBlockLimit = followers?.DEFAULT_FOLLOWERS_BLOCK_LIMIT;
    let currentFollowersBlockRunId = null;
    let currentFollowerScanSession = null;
    let currentFollowerScanSessionStore = followerScanSessions?.normalizeFollowerScanSessionStore?.({}) || {
      activeSession: null,
      version: 1
    };
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
    let activeToastTimeoutId = null;
    let currentPersistentStatusMessage = '';
    const usernameDrafts = storedPopupState.usernameDrafts && typeof storedPopupState.usernameDrafts === 'object' && !Array.isArray(storedPopupState.usernameDrafts)
      ? { ...storedPopupState.usernameDrafts }
      : {};
    let isHydratingPopupState = true;

    if (!followerScanSessions) {
      renderFatalPopupError(new Error('Missing Easy TweetBlock follower scan session API.'), documentRef);
      return;
    }

    if (!blocklist || !followers || !settings || !extensionApi || !shellElement || !statusElement || !toastRegionElement || !textareaElement || !usernameListSelectLabelElement || !usernameListSelectElement || !usernameListOptionsElement || !newUsernameListButton || !renameUsernameListButton || !deleteUsernameListButton || !importUsernamesButton || !importUsernamesFileInput || !delayInputElement || !pageButtonStyleTweetIconElement || !pageButtonStyleTweetTextElement || !pageButtonStyleProfileIconElement || !pageButtonStyleProfileTextElement || !pageButtonStyleUserCellIconElement || !pageButtonStyleUserCellTextElement || !showUserCellAddButtonElement || !openSettingsButton || !openFollowersButton || !backToMainButton || !backFromFollowersButton || !saveButton || !saveSettingsButton || !blockNowButton || !cancelFollowersRunButton || !countElement || !followersBlockLimitElement || !followersScanLimitElement || !followersSummaryElement || !followersPreviewElement || !followersBlockProgressElement || !followersProgressCountElement || !followersProgressDetailElement || !followersProgressFillElement || !followersProgressLabelElement || !followersSourceFollowersElement || !followersSourceFollowingElement || !scanFollowersButton || !scanFollowersButtonLabelElement || !blockFollowerCandidatesButton || !addFollowersToListButton || !clearListButton) {
      return;
    }

    statusElement.textContent = DEFAULT_STATUS_MESSAGE;

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

    function isPopupBusy() {
      return isSaving || isBlocking || isFollowersScanning || isFollowersBlocking || isFollowersSessionResetting;
    }

    function getStoredFollowerScanSession(source = currentFollowersSource, expectedKey = null) {
      if (typeof followerScanSessions.getFollowerScanSession === 'function') {
        return followerScanSessions.getFollowerScanSession(currentFollowerScanSessionStore, source, expectedKey);
      }

      const activeSession = followerScanSessions.getActiveFollowerScanSession(currentFollowerScanSessionStore, expectedKey);
      return activeSession?.source === followers.normalizeFollowersSource(source) ? activeSession : null;
    }

    function getFollowerScanSessionForCurrentSource() {
      return currentFollowerScanSession?.source === currentFollowersSource
        ? currentFollowerScanSession
        : getStoredFollowerScanSession(currentFollowersSource);
    }

    function syncFollowerScanSessionState(session) {
      currentFollowerScanSession = followerScanControllerApi.normalizeFollowerScanSessionForController(session);

      if (currentFollowerScanSessionStore) {
        if (typeof followerScanSessions.setFollowerScanSession === 'function' && currentFollowerScanSession) {
          currentFollowerScanSessionStore = followerScanSessions.setFollowerScanSession(
            currentFollowerScanSessionStore,
            currentFollowersSource,
            currentFollowerScanSession
          );
        } else if (typeof followerScanSessions.clearFollowerScanSession === 'function') {
          currentFollowerScanSessionStore = followerScanSessions.clearFollowerScanSession(
            currentFollowerScanSessionStore,
            currentFollowersSource
          );
        } else if (currentFollowerScanSessionStore.activeSession !== currentFollowerScanSession) {
          currentFollowerScanSessionStore = {
            ...currentFollowerScanSessionStore,
            activeSession: currentFollowerScanSession
          };
        }
      }

      currentFollowersPreview = followerScanControllerApi.deriveFollowersPreviewFromSession(currentFollowerScanSession);
      return currentFollowersPreview;
    }

    function setCurrentFollowerScanSessionStatus(status) {
      if (!currentFollowerScanSession) {
        return null;
      }

      currentFollowerScanSession = {
        ...currentFollowerScanSession,
        status,
        updatedAt: Date.now()
      };
      if (typeof followerScanSessions.setFollowerScanSession === 'function') {
        currentFollowerScanSessionStore = followerScanSessions.setFollowerScanSession(
          currentFollowerScanSessionStore,
          currentFollowersSource,
          currentFollowerScanSession
        );
      } else {
        currentFollowerScanSessionStore = {
          ...currentFollowerScanSessionStore,
          activeSession: currentFollowerScanSession
        };
      }
      currentFollowersPreview = followerScanControllerApi.deriveFollowersPreviewFromSession(currentFollowerScanSession);
      return currentFollowerScanSession;
    }

    function restoreCurrentFollowerScanSessionStatus(activeStatus) {
      if (currentFollowerScanSession?.status !== activeStatus) {
        return currentFollowerScanSession;
      }

      return setCurrentFollowerScanSessionStatus(
        followerScanControllerApi.computeFollowerScanSessionStatus(currentFollowerScanSession)
      );
    }

    async function saveFollowerScanSessionStoreValue(store) {
      currentFollowerScanSessionStore = await followerScanSessions.saveFollowerScanSessionStore(store, extensionApi);
      syncFollowerScanSessionState(getStoredFollowerScanSession(currentFollowersSource));
      return currentFollowerScanSessionStore;
    }

    async function clearPersistedFollowerScanSession() {
      const clearSession = typeof followerScanSessions.clearFollowerScanSession === 'function'
        ? followerScanSessions.clearFollowerScanSession(currentFollowerScanSessionStore, currentFollowersSource)
        : followerScanSessions.clearActiveFollowerScanSession(currentFollowerScanSessionStore);

      return saveFollowerScanSessionStoreValue(clearSession);
    }

    function buildFollowerScanExpectedKey(targetScreenName, source = currentFollowersSource, blockLimit = currentFollowersBlockLimit, scanLimit = currentFollowersScanLimit) {
      return followerScanControllerApi.buildFollowerScanExpectedKey(
        targetScreenName,
        source,
        blockLimit,
        scanLimit
      );
    }

    function createEmptyFollowerScanSessionForTarget(targetScreenName, source, blockLimit, scanLimit) {
      return followerScanControllerApi.createEmptyFollowerScanSessionForTarget(
        targetScreenName,
        source,
        blockLimit,
        scanLimit
      );
    }

    function renderFollowersPreviewFromSession(session, options = {}) {
      return renderFollowersPreview(followerScanControllerApi.deriveFollowersPreviewFromSession(session), options);
    }

    function renderFollowersScanButton() {
      const session = getFollowerScanSessionForCurrentSource();
      const hasRemainingWork = followerScanControllerApi.hasRemainingFollowerScanWork(session);
      const readyCandidateCount = Array.isArray(session?.readyCandidates) ? session.readyCandidates.length : 0;
      const shouldDisableForSession = Boolean(session)
        && (
          session.status === 'scanning'
          || session.status === 'blocking'
          || (readyCandidateCount > 0 && (!hasRemainingWork || readyCandidateCount >= currentFollowersBlockLimit))
        );

      scanFollowersButtonLabelElement.textContent = hasRemainingWork ? 'Resume scan' : 'Scan';
      scanFollowersButton.disabled = isPopupBusy() || shouldDisableForSession;
    }

    async function updateSessionFromScan(preview, activeFollowerScanSession, expectedSessionKey, targetScreenName) {
      const baseSession = activeFollowerScanSession
        || createEmptyFollowerScanSessionForTarget(
          targetScreenName,
          currentFollowersSource,
          currentFollowersBlockLimit,
          currentFollowersScanLimit
        );

      if (!baseSession || !expectedSessionKey) {
        throw new Error('Unable to build a follower scan session for the active profile.');
      }

      const nextSession = followerScanControllerApi.updateFollowerScanSessionFromPreview(
        baseSession,
        preview,
        expectedSessionKey,
        targetScreenName
      );

      await saveFollowerScanSessionStoreValue(
        typeof followerScanSessions.setFollowerScanSession === 'function'
          ? followerScanSessions.setFollowerScanSession(currentFollowerScanSessionStore, currentFollowersSource, nextSession)
          : followerScanSessions.setActiveFollowerScanSession(currentFollowerScanSessionStore, nextSession)
      );
      renderFollowersPreviewFromSession(currentFollowerScanSession);
      return currentFollowerScanSession;
    }

    function persistCurrentPopupState() {
      if (isHydratingPopupState) {
        return;
      }

      saveStoredPopupState({
        followersBlockLimit: currentFollowersBlockLimit,
        followersScanLimit: currentFollowersScanLimit,
        followersSource: currentFollowersSource,
        statusMessage: currentPersistentStatusMessage,
        usernameDrafts,
        view: normalizePopupView(shellElement.dataset.view)
      });
    }

    function clearToastTimeout() {
      if (activeToastTimeoutId == null || typeof globalThis.clearTimeout !== 'function') {
        return;
      }

      globalThis.clearTimeout(activeToastTimeoutId);
      activeToastTimeoutId = null;
    }

    function clearToast() {
      clearToastTimeout();
      toastRegionElement.hidden = true;

      if (typeof toastRegionElement.replaceChildren === 'function') {
        toastRegionElement.replaceChildren();
        return;
      }

      toastRegionElement.textContent = '';
    }

    function showToast(message, { duration = TOAST_AUTO_DISMISS_MS, sticky = false, tone = 'info' } = {}) {
      const normalizedMessage = typeof message === 'string' ? message.trim() : '';

      if (!normalizedMessage) {
        clearToast();
        return;
      }

      clearToastTimeout();

      const toastElement = documentRef.createElement('div');
      toastElement.className = 'popup-toast';
      toastElement.dataset.tone = tone;
      toastElement.textContent = normalizedMessage;
      toastElement.setAttribute('aria-live', tone === 'error' ? 'assertive' : 'polite');
      toastElement.setAttribute('role', tone === 'error' || tone === 'warning' ? 'alert' : 'status');

      toastRegionElement.hidden = false;
      toastRegionElement.replaceChildren(toastElement);

      if (sticky || duration <= 0 || typeof globalThis.setTimeout !== 'function') {
        return;
      }

      activeToastTimeoutId = globalThis.setTimeout(() => {
        activeToastTimeoutId = null;
        clearToast();
      }, duration);
    }

    function setStatus(message, { duration = TOAST_AUTO_DISMISS_MS, tone = 'info' } = {}) {
      const normalizedMessage = typeof message === 'string' ? message.trim() : '';
      const persistedStatusMessage = getPersistedStatusMessage(normalizedMessage);

      if (!normalizedMessage || normalizedMessage === DEFAULT_STATUS_MESSAGE) {
        currentPersistentStatusMessage = '';
        clearToast();
        persistCurrentPopupState();
        return;
      }

      currentPersistentStatusMessage = persistedStatusMessage;
      showToast(normalizedMessage, {
        duration,
        sticky: Boolean(persistedStatusMessage),
        tone: persistedStatusMessage ? 'warning' : tone
      });
      persistCurrentPopupState();
    }

    function renderCount(usernames) {
      countElement.textContent = `${usernames.length} username${usernames.length === 1 ? '' : 's'}`;
    }

    function getActiveListStorageText(list = currentActiveUsernameList) {
        return usernameListsApi.serializeUsernameText(list?.usernames || []);
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

      renderCount(usernameListsApi.parseUsernameText(text).usernames);
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
      const activeListName = activeList?.name || usernameListsApi.DEFAULT_USERNAME_LIST_NAME || 'Blocklist';
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
      renderCount(usernameListsApi.parseUsernameText(nextText).usernames);
      renderUsernameListSelect();
      return draftStatus;
    }

    async function readUsernameListState() {
      return blocklist.getStoredUsernameListState(extensionApi);
    }

    function setCurrentUsernameListState(usernameListState) {
      currentUsernameLists = usernameListState.lists;
      currentActiveUsernameList = usernameListState.activeList;
      currentActiveUsernameListId = usernameListState.activeListId || usernameListState.activeList?.id || null;
    }

    async function refreshUsernameListStateFromStorage({ applyDraft = true } = {}) {
      const usernameListState = await readUsernameListState();

      setCurrentUsernameListState(usernameListState);
      return renderActiveUsernameList({ applyDraft });
    }

    function updateCurrentActiveListUsernames(usernames) {
      if (!currentActiveUsernameListId) {
        return;
      }

      const normalizedUsernames = usernameListsApi.normalizeStoredUsernames(usernames);
      currentUsernameLists = currentUsernameLists.map((list) => list.id === currentActiveUsernameListId
        ? { ...list, usernames: normalizedUsernames }
        : list);
      currentActiveUsernameList = currentUsernameLists.find((list) => list.id === currentActiveUsernameListId) || currentActiveUsernameList;
    }

    function applySavedUsernamesToDraft(savedUsernames) {
      updateCurrentActiveListUsernames(savedUsernames);
      textareaElement.value = usernameListsApi.serializeUsernameText(savedUsernames);
      isUsernameDraftDirty = false;
      clearUsernameDraft(currentActiveUsernameListId);
      renderCount(savedUsernames);
    }

    function getCurrentUsernameListId() {
      return currentActiveUsernameListId || currentActiveUsernameList?.id || usernameListsApi.DEFAULT_USERNAME_LIST_ID;
    }

    function getCurrentDraftBaseUsernames() {
      const draft = currentActiveUsernameListId ? getUsernameDraft(currentActiveUsernameListId) : null;
      return usernameListsApi.parseUsernameText(draft?.baseText ?? getActiveListStorageText()).usernames;
    }

    async function saveEditedUsernamesToActiveList(editedUsernames) {
      const baseUsernames = getCurrentDraftBaseUsernames();

      return mutateCurrentActiveUsernameListUsernames((latestUsernames) => (
        usernameListsApi.mergeEditedUsernamesWithLatest(baseUsernames, editedUsernames, latestUsernames)
      ));
    }

    async function mutateCurrentActiveUsernameListUsernames(createNextUsernames) {
      const result = await blocklist.updateUsernameListUsernames(
        getCurrentUsernameListId(),
        (targetList) => createNextUsernames(targetList.usernames),
        extensionApi
      );

      return result.usernames;
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
      const abandonedSuffix = preview.abandonedFailedCount ? ` Abandoned after retries: ${preview.abandonedFailedCount}.` : '';
      return `Scanned ${scannedLabel} from ${targetLabel}. Already blocked: ${preview.alreadyBlockedCount}. Blocked this session: ${preview.blockedSuccessCount || 0}. Ready: ${preview.readyCount}.${abandonedSuffix}${preview.hasMorePages ? ` More ${sourceCopy.accountsLabel} remain beyond this preview.` : ''}`;
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
      appendFollowersSummaryText(summaryNodes, '. Blocked this session: ');
      appendFollowersSummaryText(summaryNodes, String(preview.blockedSuccessCount || 0), 'followers-summary-strong');
      appendFollowersSummaryText(summaryNodes, '. Ready: ');
      appendFollowersSummaryText(summaryNodes, String(preview.readyCount), 'followers-summary-strong');
      appendFollowersSummaryText(summaryNodes, '.');

      if (preview.abandonedFailedCount) {
        appendFollowersSummaryText(summaryNodes, ' Abandoned after retries: ', 'followers-summary-note');
        appendFollowersSummaryText(summaryNodes, String(preview.abandonedFailedCount), 'followers-summary-strong');
        appendFollowersSummaryText(summaryNodes, '.', 'followers-summary-note');
      }

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

    function renderFollowersPreview(preview, { preserveProgress = false } = {}) {
      if (!preview) {
        clearFollowersPreview();
        return;
      }

      const normalizedPreview = {
        ...preview,
        source: followers.normalizeFollowersSource(preview.source)
      };

      currentFollowersPreview = normalizedPreview;

      const targetLabel = normalizedPreview.targetScreenName ? `@${normalizedPreview.targetScreenName}` : 'the active profile';
      const previewLines = normalizedPreview.candidates.slice(0, 10).map((candidate) => `@${candidate.username || candidate.restId || 'unknown'}`);

      if (normalizedPreview.candidates.length > 10) {
        previewLines.push(`+${normalizedPreview.candidates.length - 10} more`);
      }

      setFollowersPreviewSummary(normalizedPreview, targetLabel);
      followersPreviewElement.textContent = previewLines.length
        ? previewLines.join('\n')
        : followerScanControllerApi.hasRemainingFollowerScanWork(currentFollowerScanSession)
          ? `No block-ready ${getFollowersSourceCopy(normalizedPreview.source).accountsLabel} are queued right now. Continue scanning for the next batch.`
          : `No block-ready ${getFollowersSourceCopy(normalizedPreview.source).accountsLabel} were found within the current scan limit.`;

      if (!preserveProgress) {
        renderFollowerBlockProgress(normalizedPreview.candidates.length
          ? {
            delayMs: currentDelayMs,
            phase: 'ready',
            source: normalizedPreview.source,
            total: normalizedPreview.candidates.length
          }
          : { phase: 'idle' });
      }

      persistCurrentPopupState();
    }

    function setBusyState() {
      const isAnyBusy = isPopupBusy();

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
      followersBlockLimitElement.disabled = isAnyBusy;
      followersScanLimitElement.disabled = isAnyBusy;
      blockFollowerCandidatesButton.disabled = isAnyBusy || !currentFollowersPreview?.candidates?.length;
      cancelFollowersRunButton.disabled = !(isFollowersScanning || isFollowersBlocking);
      addFollowersToListButton.disabled = isAnyBusy || !currentFollowersPreview?.candidates?.length;
      renderFollowersScanButton();
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

    async function resetFollowerScanSession(summary = DEFAULT_FOLLOWERS_SUMMARY) {
      isFollowersSessionResetting = true;
      setBusyState();

      try {
        await clearPersistedFollowerScanSession();
        clearFollowersPreview(summary);
        renderFollowerBlockProgress({ phase: 'idle' });
      } finally {
        isFollowersSessionResetting = false;
        setBusyState();
      }
    }

    async function updateFollowersSource(source) {
      if (isPopupBusy()) {
        return;
      }

      const nextSource = followers.normalizeFollowersSource(source);

      if (nextSource === currentFollowersSource) {
        return;
      }

      isFollowersSessionResetting = true;
      setBusyState();

      try {
        const previousSession = getFollowerScanSessionForCurrentSource();

        if (previousSession) {
          await saveFollowerScanSessionStoreValue(
            followerScanSessions.setFollowerScanSession(
              currentFollowerScanSessionStore,
              currentFollowersSource,
              previousSession
            )
          );
        }

        currentFollowersSource = nextSource;
        renderFollowersSource(nextSource);

        const nextSession = getStoredFollowerScanSession(nextSource);

        if (nextSession) {
          currentFollowersBlockLimit = followers.normalizeFollowersBlockLimit(nextSession.blockLimit);
          currentFollowersScanLimit = followers.normalizeFollowersScanLimit(nextSession.scanLimit);
          renderFollowersBlockLimit(currentFollowersBlockLimit);
          renderFollowersScanLimit(currentFollowersScanLimit);
          await saveFollowerScanSessionStoreValue(
            followerScanSessions.setFollowerScanSession(
              currentFollowerScanSessionStore,
              nextSource,
              nextSession
            )
          );
          renderFollowersPreviewFromSession(currentFollowerScanSession);
        } else {
          await saveFollowerScanSessionStoreValue(
            typeof followerScanSessions.clearFollowerScanSession === 'function'
              ? followerScanSessions.clearFollowerScanSession(currentFollowerScanSessionStore, nextSource)
              : followerScanSessions.clearActiveFollowerScanSession(currentFollowerScanSessionStore)
          );
          clearFollowersPreview(`Source changed to ${getFollowersSourceCopy(nextSource).graphLabel}. Run a new scan.`);
          renderFollowerBlockProgress({ phase: 'idle' });
        }

        persistCurrentPopupState();
      } finally {
        isFollowersSessionResetting = false;
        setBusyState();
      }
    }

    function handleAsyncPopupAction(actionName, action) {
      Promise.resolve()
        .then(action)
        .catch((error) => {
          logPopupError(`${actionName} crashed with an unhandled error.`, error);
          setStatus(error instanceof Error ? error.message : String(error), { tone: 'error' });
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
      setStatus('Cancel requested. Waiting for the active X request to stop...', { tone: 'info' });

      try {
        await requestCancelFollowerRun(activeTabId, activeRunId, extensionApi);
      } catch (error) {
        logPopupError('Follower run cancel request failed.', error);
        setStatus(error instanceof Error ? error.message : String(error), { tone: 'error' });
      }
    }

    async function loadBlocklist() {
      const [usernameListState, delayMs, pageButtonStyles, userCellAddButtonStyle, showUserCellAddButton, followerScanSessionStore] = await Promise.all([
        readUsernameListState(),
        settings.getStoredBatchBlockDelayMs(extensionApi),
        readStoredPageButtonStyles(),
        readStoredUserCellAddButtonStyle(),
        settings.getStoredUserCellAddButtonVisibility(extensionApi),
        followerScanSessions.loadFollowerScanSessionStore(extensionApi)
      ]);
      currentFollowerScanSessionStore = followerScanSessionStore;

      const storedPopupSource = storedPopupState.followersSource
        ? followers.normalizeFollowersSource(storedPopupState.followersSource)
        : null;
      const preferredFollowerSource = storedPopupSource
        || followers.normalizeFollowersSource(followerScanSessionStore?.activeSession?.source)
        || followers.DEFAULT_FOLLOWERS_SOURCE;
      let activeFollowerScanSession = getStoredFollowerScanSession(preferredFollowerSource);

      if (!activeFollowerScanSession && !storedPopupSource) {
        activeFollowerScanSession = followerScanSessions.getActiveFollowerScanSession(followerScanSessionStore);
      }

      setCurrentUsernameListState(usernameListState);
      const usernameDraftStatus = renderActiveUsernameList();
      renderDelay(delayMs);
      currentDelayMs = delayMs;
      currentPageButtonStyles = pageButtonStyles;
      currentUserCellAddButtonStyle = userCellAddButtonStyle;
      currentShowUserCellAddButton = showUserCellAddButton;
      currentFollowersBlockLimit = followers.normalizeFollowersBlockLimit(
        activeFollowerScanSession?.blockLimit
          ?? storedPopupState.followersBlockLimit
          ?? followers.DEFAULT_FOLLOWERS_BLOCK_LIMIT
      );
      currentFollowersScanLimit = followers.normalizeFollowersScanLimit(
        activeFollowerScanSession?.scanLimit
          ?? storedPopupState.followersScanLimit
          ?? followers.DEFAULT_FOLLOWERS_SCAN_LIMIT
      );
      currentFollowersSource = followers.normalizeFollowersSource(
        activeFollowerScanSession?.source
          ?? preferredFollowerSource
      );

      if (!activeFollowerScanSession && currentFollowerScanSessionStore?.activeSession?.source === currentFollowersSource) {
        await clearPersistedFollowerScanSession();
      } else {
        syncFollowerScanSessionState(activeFollowerScanSession);
      }

      renderFollowersBlockLimit(currentFollowersBlockLimit);
      renderFollowersScanLimit(currentFollowersScanLimit);
      renderFollowersSource(currentFollowersSource);
      renderPageButtonStyles(pageButtonStyles);
      renderUserCellAddButtonStyle(userCellAddButtonStyle);
      renderShowUserCellAddButton(showUserCellAddButton);
      if (currentFollowerScanSession?.source === currentFollowersSource) {
        renderFollowersPreviewFromSession(currentFollowerScanSession);
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
      if (isPopupBusy()) {
        return;
      }

      const { usernames, invalidEntries } = usernameListsApi.parseUsernameText(textareaElement.value);

      isSaving = true;
      setBusyState();
      setStatus('Saving blocklist...', { tone: 'info' });

      try {
        const savedUsernames = await saveEditedUsernamesToActiveList(usernames);

        applySavedUsernamesToDraft(savedUsernames);
        persistCurrentPopupState();

        if (invalidEntries.length) {
          setStatus(`Saved ${savedUsernames.length} usernames. Skipped invalid values: ${invalidEntries.slice(0, 3).join(', ')}`, { tone: 'warning' });
          return;
        }

        setStatus(`Saved ${savedUsernames.length} usernames.`, { tone: 'success' });
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), { tone: 'error' });
      } finally {
        isSaving = false;
        setBusyState();
      }
    }

    async function saveSettings() {
      if (isPopupBusy()) {
        return;
      }

      const delayMs = readDelayMs();
      const pageButtonStyles = readPageButtonStyles();
      const userCellAddButtonStyle = readUserCellAddButtonStyle();
      const showUserCellAddButton = readShowUserCellAddButton();

      isSaving = true;
      setBusyState();
      setStatus('Saving settings...', { tone: 'info' });

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
        setStatus(`Saved settings. Delay: ${savedDelayMs} ms.`, { tone: 'success' });
        showMainView();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), { tone: 'error' });
      } finally {
        isSaving = false;
        setBusyState();
      }
    }

    async function blockListedNow() {
      if (isPopupBusy()) {
        return;
      }

      const { usernames, invalidEntries } = usernameListsApi.parseUsernameText(textareaElement.value);

      if (!usernames.length) {
        setStatus('Add at least one valid username before blocking.', { tone: 'warning' });
        return;
      }

      isBlocking = true;
      setBusyState();
      setStatus('Blocking listed usernames through the X page context...', { tone: 'info' });
      logPopupInfo('Starting immediate username block request.', {
        delayMs: currentDelayMs,
        requestedUsernames: usernames
      });

      try {
        const savedUsernames = await saveEditedUsernamesToActiveList(usernames);
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
          setStatus(`Blocked ${successCount}/${results.length} usernames with ${currentDelayMs} ms delay. Failed: ${failedPreview}.${invalidSuffix}`, { tone: 'warning' });
          return;
        }

        if (invalidEntries.length) {
          setStatus(`Blocked ${successCount} usernames with ${currentDelayMs} ms delay. Skipped invalid values: ${invalidEntries.slice(0, 3).join(', ')}`, { tone: 'warning' });
          return;
        }

        setStatus(`Blocked ${successCount} usernames with ${currentDelayMs} ms delay.`, { tone: 'success' });
      } catch (error) {
        logPopupError('Immediate username block flow threw an error.', error);
        setStatus(error instanceof Error ? error.message : String(error), { tone: 'error' });
      } finally {
        isBlocking = false;
        setBusyState();
      }
    }

    async function scanFollowersPreview() {
      let scanRunId = null;

      try {
        if (isPopupBusy()) {
          logPopupInfo('Followers preview scan ignored because popup is busy.', {
            isBlocking,
            isFollowersBlocking,
            isFollowersScanning,
            isFollowersSessionResetting,
            isSaving
          });
          return;
        }

        logPopupInfo('Followers preview scan: resolving active X tab.');
        const targetTab = await findActiveXTab(extensionApi);
        logPopupInfo('Followers preview scan: active tab resolved.', targetTab);

        if (!targetTab?.id) {
          setStatus('Make the target x.com profile tab active first.', { tone: 'warning' });
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
        const targetScreenName = readScreenNameFromTabUrl(targetTab.url);

        if (!targetScreenName) {
          setStatus('Open a profile, followers, or following page in the active X tab first.', { tone: 'warning' });
          return;
        }

        const expectedSessionKey = buildFollowerScanExpectedKey(
          targetScreenName,
          currentFollowersSource,
          currentFollowersBlockLimit,
          currentFollowersScanLimit
        );
        const storedSourceSession = getStoredFollowerScanSession(currentFollowersSource);
        let activeFollowerScanSession = getStoredFollowerScanSession(currentFollowersSource, expectedSessionKey);

        if (!activeFollowerScanSession && storedSourceSession) {
          await clearPersistedFollowerScanSession();
        }

        if (activeFollowerScanSession?.readyCandidates?.length >= currentFollowersBlockLimit) {
          renderFollowersPreviewFromSession(activeFollowerScanSession);
          setStatus(`Queue already has ${activeFollowerScanSession.readyCandidates.length} ${sourceCopy.readyLabel}. Block or retry the current queue first.`, { tone: 'warning' });
          return;
        }

        scanRunId = createFollowerBlockRunId();
        renderFollowersBlockLimit(currentFollowersBlockLimit);
        renderFollowersScanLimit(currentFollowersScanLimit);
        renderFollowersSource(currentFollowersSource);

        isFollowersScanning = true;
        currentFollowersScanRunId = scanRunId;
        currentFollowerRunTabId = targetTab.id;
        setCurrentFollowerScanSessionStatus('scanning');
        setBusyState();
        setFollowersSummary(`Scanning up to ${currentFollowersScanLimit} ${sourceCopy.accountsLabel} from the active X tab...`);
        renderFollowerBlockProgress({
          phase: 'scanning',
          source: currentFollowersSource,
          total: currentFollowersScanLimit
        });
        setStatus(`${sourceCopy.graphLabel} scan running.`, { tone: 'info' });
        logPopupInfo('Starting followers preview scan.', {
          blockLimit: currentFollowersBlockLimit,
          runId: scanRunId,
          scanLimit: currentFollowersScanLimit,
          source: currentFollowersSource,
          tabId: targetTab.id,
          tabUrl: targetTab.url
        });

        const runPreviewRequest = async (resumeState) => {
          const response = await requestFollowersPreview(
            targetTab.id,
            currentFollowersBlockLimit,
            currentFollowersScanLimit,
            currentFollowersSource,
            extensionApi,
            scanRunId,
            resumeState
          );

          if (response?.canceled) {
            return response;
          }

          if (!response?.ok) {
            logPopupError('Followers preview scan returned a non-ok response.', response);
            throw new Error(response?.error || 'The X page did not accept the followers scan request.');
          }

          return response;
        };

        let response;
        let fallbackStatusMessage = '';

        try {
          response = await runPreviewRequest(
            followerScanControllerApi.createFollowerScanResumeState(activeFollowerScanSession)
          );
        } catch (error) {
          if (isFollowerRunCanceledError(error) || !activeFollowerScanSession) {
            throw error;
          }

          logPopupWarn('Saved follower scan continuation failed; retrying once from the top.', error);
          const resetSession = followerScanControllerApi.createContinuationResetFollowerScanSession(activeFollowerScanSession);

          await saveFollowerScanSessionStoreValue(
            followerScanSessions.setFollowerScanSession(
              currentFollowerScanSessionStore,
              currentFollowersSource,
              resetSession
            )
          );
          activeFollowerScanSession = currentFollowerScanSession;
          fallbackStatusMessage = 'Saved scan position was invalid. Started a fresh scan from the top.';
          response = await runPreviewRequest(
            followerScanControllerApi.createFollowerScanResumeState(activeFollowerScanSession, {
              includeContinuation: false
            })
          );
        }

        if (response?.canceled) {
          restoreCurrentFollowerScanSessionStatus('scanning');
          setFollowersSummary(`${sourceCopy.graphLabel} scan canceled.`);
          renderFollowerBlockProgress({
            phase: 'canceled',
            source: currentFollowersSource,
            total: currentFollowersScanLimit
          });
          setStatus(`${sourceCopy.graphLabel} scan canceled.`, { tone: 'warning' });
          return;
        }

        logPopupInfo('Followers preview scan response received.', response.preview || response);
        await updateSessionFromScan(
          response.preview,
          activeFollowerScanSession,
          expectedSessionKey,
          targetScreenName
        );

        if (!currentFollowerScanSession?.readyCandidates?.length) {
          const fallbackStatusPrefix = fallbackStatusMessage ? `${fallbackStatusMessage} ` : '';

          if (followerScanControllerApi.hasRemainingFollowerScanWork(currentFollowerScanSession)) {
            setStatus(`${fallbackStatusPrefix}Scan complete. No block-ready ${sourceCopy.accountsLabel} found in this pass. Continue scanning for the next batch.`, { tone: fallbackStatusMessage ? 'warning' : 'info' });
            return;
          }

          setStatus(`${fallbackStatusPrefix}Scan complete. No block-ready ${sourceCopy.accountsLabel} found within ${currentFollowersScanLimit} scanned accounts.`, { tone: fallbackStatusMessage ? 'warning' : 'info' });
          return;
        }

        const readyCount = currentFollowerScanSession.readyCandidates.length;
        const readyMessage = `Preview ready: ${readyCount} ${readyCount === 1 ? sourceCopy.accountLabel : sourceCopy.readyLabel} can be blocked from @${currentFollowerScanSession.targetScreenName}.`;
        setStatus(
          fallbackStatusMessage ? `${fallbackStatusMessage} ${readyMessage}` : readyMessage,
          { tone: fallbackStatusMessage ? 'warning' : 'success' }
        );
      } catch (error) {
        if (isFollowerRunCanceledError(error)) {
          restoreCurrentFollowerScanSessionStatus('scanning');
          const sourceCopy = getFollowersSourceCopy(currentFollowersSource);

          setFollowersSummary(`${sourceCopy.graphLabel} scan canceled.`);
          renderFollowerBlockProgress({
            phase: 'canceled',
            source: currentFollowersSource,
            total: currentFollowersScanLimit
          });
          setStatus(`${sourceCopy.graphLabel} scan canceled.`, { tone: 'warning' });
          return;
        }

        logPopupError('Followers preview scan failed.', error);
        restoreCurrentFollowerScanSessionStatus('scanning');
        setFollowersSummary(`Scan failed: ${error instanceof Error ? error.message : String(error)}`);
        renderFollowerBlockProgress({ phase: 'idle' });
        setStatus(error instanceof Error ? error.message : String(error), { tone: 'error' });
      } finally {
        isFollowersScanning = false;

        if (scanRunId && currentFollowersScanRunId === scanRunId) {
          currentFollowersScanRunId = null;
        }

        if (!currentFollowersScanRunId && !currentFollowersBlockRunId) {
          currentFollowerRunTabId = null;
        }

        setBusyState();
      }
    }

    async function blockScannedFollowers() {
      let blockRunId = null;

      try {
        if (isPopupBusy()) {
          logPopupInfo('Follower block run ignored because popup is busy.', {
            isBlocking,
            isFollowersBlocking,
            isFollowersScanning,
            isFollowersSessionResetting,
            isSaving
          });
          return;
        }

        if (!currentFollowerScanSession?.readyCandidates?.length || !currentFollowersPreview?.candidates?.length) {
          setStatus(`Run a ${getFollowersSourceCopy().graphLabel} preview scan first.`, { tone: 'warning' });
          return;
        }

        const sourceCopy = getFollowersSourceCopy(currentFollowersPreview.source || currentFollowersSource);
        const queuedCandidates = followerCandidatesApi.stripFollowerCandidates(currentFollowerScanSession.readyCandidates);

        logPopupInfo('Follower block run: resolving active X tab.');
        const targetTab = await findActiveXTab(extensionApi);
        logPopupInfo('Follower block run: active tab resolved.', targetTab);

        if (!targetTab?.id) {
          setStatus('Make the target x.com profile tab active first.', { tone: 'warning' });
          return;
        }

        isFollowersBlocking = true;
        blockRunId = createFollowerBlockRunId();
        currentFollowersBlockRunId = blockRunId;
        currentFollowerRunTabId = targetTab.id;
        setCurrentFollowerScanSessionStatus('blocking');
        setBusyState();
        renderFollowerBlockProgress({
          delayMs: currentDelayMs,
          phase: 'started',
          source: currentFollowersPreview.source || currentFollowersSource,
          total: queuedCandidates.length
        });
        setStatus(`Blocking ${queuedCandidates.length} scanned ${sourceCopy.readyLabel} with ${currentDelayMs} ms delay between requests...`, { tone: 'info' });
        logPopupInfo('Starting follower block run from preview.', {
          candidateCount: queuedCandidates.length,
          delayMs: currentDelayMs,
          runId: currentFollowersBlockRunId,
          tabId: targetTab.id,
          tabUrl: targetTab.url
        });

        const previousPreview = currentFollowersPreview;
        const response = await requestFollowerBlocks(targetTab.id, queuedCandidates, currentDelayMs, extensionApi, blockRunId);

        if (response?.canceled) {
          restoreCurrentFollowerScanSessionStatus('blocking');
          renderFollowerBlockProgress({
            delayMs: currentDelayMs,
            phase: 'canceled',
            source: previousPreview.source || currentFollowersSource,
            total: previousPreview.candidates.length
          });
          setStatus(`Block run canceled for ${sourceCopy.graphLabel}.`, { tone: 'warning' });
          return;
        }

        if (!response?.ok) {
          logPopupError('Follower block run returned a non-ok response.', response);
          restoreCurrentFollowerScanSessionStatus('blocking');
          throw new Error(response?.error || 'The X page did not accept the followers block request.');
        }

        const results = Array.isArray(response.results) ? response.results : [];
        const failedEntries = results.filter((entry) => !entry?.ok);

        renderFollowerBlockResultProgress(results, currentDelayMs, currentFollowersPreview.source || currentFollowersSource);

        const blockUpdate = followerScanControllerApi.updateFollowerScanSessionAfterBlock(currentFollowerScanSession, results);

        logPopupInfo('Follower block run finished.', {
          batchFailedCount: blockUpdate.batchFailedCount,
          failedEntries,
          mismatchedCount: blockUpdate.mismatchedCount,
          results,
          successCount: blockUpdate.successCount
        });

        await saveFollowerScanSessionStoreValue(
          followerScanSessions.setFollowerScanSession(
            currentFollowerScanSessionStore,
            currentFollowersSource,
            blockUpdate.session
          )
        );
        renderFollowersPreviewFromSession(currentFollowerScanSession, { preserveProgress: true });

        if (blockUpdate.batchFailedCount) {
          const failedPreview = failedEntries.slice(0, 3).map((entry) => `@${entry.username || entry.restId || 'unknown'}`).join(', ');
          const mismatchSuffix = blockUpdate.mismatchedCount
            ? ` Mismatched results: ${blockUpdate.mismatchedCount}.`
            : '';
          const abandonedSuffix = blockUpdate.abandonedCount
            ? ` Abandoned after retry cap: ${blockUpdate.abandonedCount}.`
            : '';
          const failedPreviewSuffix = failedPreview ? ` Failed: ${failedPreview}.` : '';
          setStatus(`Block run finished with errors: blocked ${blockUpdate.successCount}/${results.length} ${sourceCopy.readyLabel}, failed ${blockUpdate.batchFailedCount}.${mismatchSuffix}${abandonedSuffix} Delay used: ${currentDelayMs} ms.${failedPreviewSuffix}`, { tone: 'warning' });
          return;
        }

        if (followerScanControllerApi.hasRemainingFollowerScanWork(currentFollowerScanSession)) {
          setStatus('Batch blocked. Continue scanning for the next batch.', { tone: 'success' });
          return;
        }

        setStatus(`Block run complete: blocked ${blockUpdate.successCount}/${results.length} ${sourceCopy.readyLabel}. Session complete.`, { tone: 'success' });
      } catch (error) {
        if (isFollowerRunCanceledError(error)) {
          restoreCurrentFollowerScanSessionStatus('blocking');
          const sourceCopy = getFollowersSourceCopy(currentFollowersPreview?.source || currentFollowersSource);

          renderFollowerBlockProgress({
            delayMs: currentDelayMs,
            phase: 'canceled',
            source: sourceCopy.source,
            total: currentFollowersPreview?.candidates?.length || 0
          });
          setStatus(`Block run canceled for ${sourceCopy.graphLabel}.`, { tone: 'warning' });
          return;
        }

        logPopupError('Follower block run failed.', error);
        restoreCurrentFollowerScanSessionStatus('blocking');
        renderFollowerBlockProgress({
          delayMs: currentDelayMs,
          failureCount: 1,
          phase: 'finished',
          successCount: 0,
          total: currentFollowersPreview?.candidates?.length || 0
        });
        setStatus(error instanceof Error ? error.message : String(error), { tone: 'error' });
      } finally {
        isFollowersBlocking = false;

        if (blockRunId && currentFollowersBlockRunId === blockRunId) {
          currentFollowersBlockRunId = null;
        }

        if (!currentFollowersScanRunId && !currentFollowersBlockRunId) {
          currentFollowerRunTabId = null;
        }

        setBusyState();
      }
    }

    function promptForUsernameListName(message, defaultName = '') {
      const rawName = typeof globalThis.prompt === 'function'
        ? globalThis.prompt(message, defaultName)
        : defaultName;

      if (rawName === null) {
        return null;
      }

      return usernameListsApi.normalizeUsernameListName(rawName, defaultName || usernameListsApi.DEFAULT_USERNAME_LIST_NAME);
    }

    async function switchActiveUsernameList(listId = usernameListSelectElement.value) {
      if (!listId || isPopupBusy()) {
        return;
      }

      persistUsernameDraft();
      await blocklist.setActiveUsernameListId(listId, extensionApi);
      const draftStatus = await refreshUsernameListStateFromStorage();
      setStatus(draftStatus || `Active list: ${currentActiveUsernameList?.name || 'Blocklist'}.`, { tone: 'info' });
      setBusyState();
      persistCurrentPopupState();
    }

    async function createNewUsernameList() {
      if (isPopupBusy()) {
        return;
      }

      persistUsernameDraft();
      const listName = promptForUsernameListName('New list name', 'New list');

      if (!listName) {
        return;
      }

      const { list } = await blocklist.createAndActivateUsernameList(listName, extensionApi);
      await refreshUsernameListStateFromStorage();
      setStatus(`Created list: ${list.name}.`, { tone: 'success' });
      setBusyState();
      persistCurrentPopupState();
    }

    async function renameActiveUsernameList() {
      if (!currentActiveUsernameList || isPopupBusy()) {
        return;
      }

      const listName = promptForUsernameListName('Rename list', currentActiveUsernameList.name);

      if (!listName) {
        return;
      }

      await blocklist.renameUsernameList(getCurrentUsernameListId(), listName, extensionApi);
      await refreshUsernameListStateFromStorage();
      setStatus(`Renamed list to ${listName}.`, { tone: 'success' });
      setBusyState();
      persistCurrentPopupState();
    }

    async function deleteActiveUsernameList() {
      if (!currentActiveUsernameList || currentUsernameLists.length <= 1 || isPopupBusy()) {
        return;
      }

      if (typeof globalThis.confirm === 'function' && !globalThis.confirm(`Delete list "${currentActiveUsernameList.name}"?`)) {
        return;
      }

      const deletedListId = getCurrentUsernameListId();

      clearUsernameDraft(deletedListId);
      const { activeList } = await blocklist.deleteUsernameList(deletedListId, extensionApi);
      await refreshUsernameListStateFromStorage();
      setStatus(`Deleted list. Active list: ${currentActiveUsernameList?.name || activeList.name}.`, { tone: 'success' });
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
      if (isPopupBusy()) {
        return;
      }

      const parsedImport = usernameListsApi.parseUsernameImport(text, fileName);
      const invalidSuffix = parsedImport.invalidEntries.length
        ? ` Skipped invalid values: ${parsedImport.invalidEntries.slice(0, 3).join(', ')}.`
        : '';

      if (parsedImport.lists.length) {
        await blocklist.importUsernameLists(parsedImport.lists, extensionApi);
        await refreshUsernameListStateFromStorage();
        setStatus(`Imported ${parsedImport.lists.length} list${parsedImport.lists.length === 1 ? '' : 's'}.${invalidSuffix}`, { tone: invalidSuffix ? 'warning' : 'success' });
        setBusyState();
        persistCurrentPopupState();
        return;
      }

      if (!parsedImport.usernames.length) {
        setStatus(`No valid usernames found in import.${invalidSuffix}`, { tone: 'warning' });
        return;
      }

      const visibleUsernames = usernameListsApi.parseUsernameText(textareaElement.value).usernames;
      const savedUsernames = await saveEditedUsernamesToActiveList([
        ...visibleUsernames,
        ...parsedImport.usernames
      ]);

      applySavedUsernamesToDraft(savedUsernames);
      setStatus(`Imported ${parsedImport.usernames.length} username${parsedImport.usernames.length === 1 ? '' : 's'} into ${currentActiveUsernameList?.name || 'the active list'}.${invalidSuffix}`, { tone: invalidSuffix ? 'warning' : 'success' });
      setBusyState();
      persistCurrentPopupState();
    }

    async function importUsernameFile(file) {
      const text = await readImportFile(file);
      await importUsernameText(text, file?.name || '');
    }

    async function addFollowersToActiveList() {
      if (isPopupBusy()) {
        return;
      }

      if (!currentFollowersPreview?.candidates?.length) {
        setStatus('No scanned candidates to add.', { tone: 'warning' });
        return;
      }

      const scannedUsernames = currentFollowersPreview.candidates
        .map((candidate) => candidate.username)
        .filter((username) => typeof username === 'string' && username.trim() !== '');

      if (!scannedUsernames.length) {
        setStatus('No valid usernames found in the scan.', { tone: 'warning' });
        return;
      }

      isSaving = true;
      setBusyState();
      setStatus('Adding scanned users to active list...', { tone: 'info' });

      try {
        const visibleUsernames = usernameListsApi.parseUsernameText(textareaElement.value).usernames;
        const savedUsernames = await saveEditedUsernamesToActiveList([
          ...visibleUsernames,
          ...scannedUsernames
        ]);

        applySavedUsernamesToDraft(savedUsernames);
        persistCurrentPopupState();

        setStatus(`Added ${scannedUsernames.length} usernames to list "${currentActiveUsernameList?.name || 'Blocklist'}".`, { tone: 'success' });
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), { tone: 'error' });
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
      setStatus('List cleared. Click Save list to save this change.', { tone: 'info' });
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
      handleAsyncPopupAction('updateFollowersSourceFollowers', () => updateFollowersSource(followers.FOLLOWERS_SOURCES.followers));
    });

    followersSourceFollowingElement.addEventListener('click', () => {
      handleAsyncPopupAction('updateFollowersSourceFollowing', () => updateFollowersSource(followers.FOLLOWERS_SOURCES.following));
    });

    delayInputElement.addEventListener('change', () => {
      renderDelay(readDelayMs());
    });

    textareaElement.addEventListener('input', persistUsernameDraft);
    textareaElement.addEventListener('change', persistUsernameDraft);

    followersBlockLimitElement.addEventListener('change', () => {
      handleAsyncPopupAction('updateFollowersBlockLimit', async () => {
        if (isPopupBusy()) {
          setBusyState();
          return;
        }

        const previousBlockLimit = currentFollowersBlockLimit;

        currentFollowersBlockLimit = readFollowersBlockLimit();
        renderFollowersBlockLimit(currentFollowersBlockLimit);
        currentFollowersScanLimit = readFollowersScanLimit();
        renderFollowersScanLimit(currentFollowersScanLimit);

        if (currentFollowersBlockLimit === previousBlockLimit) {
          setBusyState();
          return;
        }

        await resetFollowerScanSession('Preview cleared. Run a new scan with the updated limits.');
      });
    });

    followersScanLimitElement.addEventListener('change', () => {
      handleAsyncPopupAction('updateFollowersScanLimit', async () => {
        if (isPopupBusy()) {
          setBusyState();
          return;
        }

        const previousScanLimit = currentFollowersScanLimit;

        currentFollowersScanLimit = readFollowersScanLimit();
        renderFollowersScanLimit(currentFollowersScanLimit);

        if (currentFollowersScanLimit === previousScanLimit) {
          setBusyState();
          return;
        }

        await resetFollowerScanSession('Preview cleared. Run a new scan with the updated limits.');
      });
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
