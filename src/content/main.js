(() => {
  const CONTENT_LOG_PREFIX = '[Easy TweetBlock][content]';

  function logContentInfo(message, details) {
    if (details === undefined) {
      console.info(CONTENT_LOG_PREFIX, message);
      return;
    }

    console.info(CONTENT_LOG_PREFIX, message, details);
  }

  function logContentError(message, error) {
    if (error === undefined) {
      console.error(CONTENT_LOG_PREFIX, message);
      return;
    }

    console.error(CONTENT_LOG_PREFIX, message, error);
  }

  if (typeof module !== 'undefined' && module.exports) {
    require('./shared.js');
    require('./x-client-transaction.js');
    require('./api.js');
    require('./dom.js');
  }

  const namespace = globalThis.EasyTweetBlockContent || (globalThis.EasyTweetBlockContent = {});
  const {
    BLOCK_BUTTON_ATTRIBUTE,
    BUTTON_KINDS,
    DEFAULT_BATCH_BLOCK_DELAY_MS,
    DEFAULT_PAGE_BLOCK_BUTTON_STYLE,
    MAX_BATCH_BLOCK_DELAY_MS,
    MESSAGE_TYPES,
    MIN_BATCH_BLOCK_DELAY_MS,
    PAGE_BLOCK_BUTTON_STYLE_STORAGE_KEY,
    PAGE_BUTTON_STYLES,
    RESERVED_PATH_SEGMENTS,
    SELECTORS,
    USER_BY_SCREEN_NAME_FIELD_TOGGLES,
    USER_BY_SCREEN_NAME_FEATURES,
    USER_BY_SCREEN_NAME_QUERY_IDS,
    attachButtonToTweet,
    attachButtonToUserCell,
    collectTweets,
    collectUserCells,
    findActionRowContainer,
    findPrimaryActionWrapper,
    getElementChildren,
    processNode,
    subtreeContainsButton,
    WAIT_INTERVAL_MS,
    WAIT_TIMEOUT_MS
  } = namespace;
  const FOLLOWER_RUN_PORT_PREFIX = 'easy-tweetblock:follower-run:';

  function normalizeFollowerRunId(runId) {
    return typeof runId === 'string' && runId.trim() ? runId.trim() : null;
  }

  function getFollowerRunControllers() {
    if (!namespace.contentState) {
      namespace.contentState = {};
    }

    if (!namespace.contentState.followerRunControllers) {
      namespace.contentState.followerRunControllers = new Map();
    }

    return namespace.contentState.followerRunControllers;
  }

  function startFollowerRun(runId) {
    const normalizedRunId = normalizeFollowerRunId(runId);

    if (!normalizedRunId || typeof AbortController !== 'function') {
      return {
        controller: null,
        runId: normalizedRunId,
        signal: null
      };
    }

    const controllers = getFollowerRunControllers();
    let controller = controllers.get(normalizedRunId);

    if (!controller) {
      controller = new AbortController();
      controllers.set(normalizedRunId, controller);
    }

    return {
      controller,
      runId: normalizedRunId,
      signal: controller.signal
    };
  }

  function finishFollowerRun(runId, controller) {
    const normalizedRunId = normalizeFollowerRunId(runId);

    if (!normalizedRunId) {
      return;
    }

    const controllers = getFollowerRunControllers();

    if (!controller || controllers.get(normalizedRunId) === controller) {
      controllers.delete(normalizedRunId);
    }
  }

  function cancelFollowerRun(runId, reason = 'Follower run canceled.') {
    const normalizedRunId = normalizeFollowerRunId(runId);

    if (!normalizedRunId) {
      return false;
    }

    const controllers = getFollowerRunControllers();
    const controller = controllers.get(normalizedRunId);

    if (!controller) {
      return false;
    }

    if (!controller.signal.aborted) {
      controller.abort(namespace.createAbortError(reason));
    }

    return true;
  }

  function readFollowerRunIdFromPortName(portName) {
    if (typeof portName !== 'string' || !portName.startsWith(FOLLOWER_RUN_PORT_PREFIX)) {
      return null;
    }

    return normalizeFollowerRunId(portName.slice(FOLLOWER_RUN_PORT_PREFIX.length));
  }

  function waitForElement(selector, documentRef = document, timeoutMs = WAIT_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;

      function poll() {
        const match = documentRef.querySelector(selector);

        if (match) {
          resolve(match);
          return;
        }

        if (Date.now() >= deadline) {
          reject(new Error(`Timed out waiting for ${selector}`));
          return;
        }

        globalThis.setTimeout(poll, WAIT_INTERVAL_MS);
      }

      poll();
    });
  }

  async function runNativeBlockFlow(tweet, documentRef = document) {
    const caretButton = tweet.querySelector(SELECTORS.caretButton);

    if (!caretButton) {
      throw new Error('Missing tweet caret button.');
    }

    return runNativeBlockFlowFromTriggerButton(caretButton, documentRef);
  }

  async function runNativeBlockFlowFromTriggerButton(triggerButton, documentRef = document) {
    if (!triggerButton) {
      throw new Error('Missing native block trigger button.');
    }

    // Reuse X's own UI flow so auth, CSRF, and anti-bot state stay in the page session.
    triggerButton.click();

    const blockMenuItem = await waitForElement(SELECTORS.blockMenuItem, documentRef);
    blockMenuItem.click();

    const confirmButton = await waitForElement(SELECTORS.blockConfirmButton, documentRef);
    confirmButton.click();
  }

  async function runProfileNativeBlockFlow(documentRef = document) {
    const profileActionsButton = documentRef?.querySelector?.(SELECTORS.profileActionsButton);

    if (!profileActionsButton) {
      throw new Error('Missing profile actions button.');
    }

    return runNativeBlockFlowFromTriggerButton(profileActionsButton, documentRef);
  }

  function createActionButton(targetRoot, kind, action, screenName = namespace.readScreenNameFromTweet(targetRoot), surface = null) {
    const button = document.createElement('button');

    button.type = 'button';
    button.setAttribute(BLOCK_BUTTON_ATTRIBUTE, 'true');
    button.dataset.kind = kind;
    button.dataset.displayStyle = kind === BUTTON_KINDS.native ? namespace.getCurrentNativeButtonStyle() : PAGE_BUTTON_STYLES.text;

    if (surface) {
      button.dataset.surface = surface;
    }

    namespace.setButtonState(button, 'idle', screenName, kind);

    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (button.disabled) {
        return;
      }

      namespace.setButtonState(button, 'running', screenName, kind);

      try {
        await action();
        namespace.setButtonState(button, 'success', screenName, kind);
      } catch (error) {
        logContentError(`Failed to complete ${kind} block flow.`, error);
        namespace.setButtonState(button, 'error', screenName, kind);
      }
    });

    return button;
  }

  function createNativeBlockButton(tweet, documentRef = document) {
    return createActionButton(tweet, BUTTON_KINDS.native, () => runNativeBlockFlow(tweet, documentRef), undefined, 'tweet');
  }

  function createProfileBlockButton(documentRef = document) {
    const screenName = namespace.readScreenNameFromProfilePage(documentRef);

    if (!screenName) {
      return null;
    }

    const button = createActionButton(
      documentRef,
      BUTTON_KINDS.native,
      () => runProfileNativeBlockFlow(documentRef),
      screenName,
      'profile'
    );

    return button;
  }

  function createUserCellBlockButton(userCell, options = {}) {
    const screenName = namespace.readScreenNameFromTweet(userCell);

    if (!screenName) {
      return null;
    }

    return createActionButton(
      userCell,
      BUTTON_KINDS.native,
      () => namespace.runApiBlockFlow(userCell, options),
      screenName,
      'user-cell'
    );
  }

  function createApiBlockButton(tweet, options = {}) {
    return createActionButton(tweet, BUTTON_KINDS.api, () => namespace.runApiBlockFlow(tweet, options));
  }

  function applyCurrentNativeButtonStyleToDocument(documentRef = document) {
    if (!documentRef || typeof documentRef.querySelectorAll !== 'function') {
      return;
    }

    const nativeButtons = Array.from(documentRef.querySelectorAll(`[${BLOCK_BUTTON_ATTRIBUTE}][data-kind="native"]`));

    for (const button of nativeButtons) {
      button.dataset.displayStyle = namespace.getCurrentNativeButtonStyle();
      namespace.setButtonState(button, button.dataset.state || 'idle', button.dataset.screenName || '', BUTTON_KINDS.native);
    }
  }

  async function syncStoredPageButtonStyle(globalRef = globalThis) {
    const style = await namespace.getStoredPageButtonStyle(globalRef);
    namespace.setCurrentNativeButtonStyle(style);
    applyCurrentNativeButtonStyleToDocument(globalRef.document);
    return style;
  }

  function observeStoredPageButtonStyle(globalRef = globalThis) {
    const extensionApi = namespace.getExtensionApi(globalRef);
    const onChangedApi = extensionApi?.storage?.onChanged;

    if (!onChangedApi?.addListener) {
      return () => {};
    }

    const handleStorageChange = (changes, areaName) => {
      if (areaName !== 'local' || !Object.prototype.hasOwnProperty.call(changes, PAGE_BLOCK_BUTTON_STYLE_STORAGE_KEY)) {
        return;
      }

      namespace.setCurrentNativeButtonStyle(changes[PAGE_BLOCK_BUTTON_STYLE_STORAGE_KEY]?.newValue);
      applyCurrentNativeButtonStyleToDocument(globalRef.document);
    };

    onChangedApi.addListener(handleStorageChange);

    return () => {
      if (typeof onChangedApi.removeListener === 'function') {
        onChangedApi.removeListener(handleStorageChange);
      }
    };
  }

  function sendRuntimeProgressMessage(runtimeApi, message) {
    if (!runtimeApi?.sendMessage) {
      return;
    }

    try {
      const maybePromise = runtimeApi.sendMessage(message);

      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch(() => {});
      }
    } catch {
      // Popup may be closed; progress messages are best-effort UI updates.
    }
  }

  function registerRuntimeConnectionListener(globalRef = globalThis) {
    const extensionApi = namespace.getExtensionApi(globalRef);
    const runtimeApi = extensionApi?.runtime;

    if (!runtimeApi?.onConnect?.addListener || globalRef.__easyTweetBlockRuntimeConnectionListenerAttached__) {
      return;
    }

    runtimeApi.onConnect.addListener((port) => {
      const runId = readFollowerRunIdFromPortName(port?.name);

      if (!runId || !port?.onDisconnect?.addListener) {
        return;
      }

      port.onDisconnect.addListener(() => {
        if (cancelFollowerRun(runId, 'Popup closed or disconnected.')) {
          logContentInfo('Follower run port disconnected; canceled active run.', { runId });
        }
      });
    });

    globalRef.__easyTweetBlockRuntimeConnectionListenerAttached__ = true;
  }

  function registerRuntimeMessageListener(globalRef = globalThis) {
    const extensionApi = namespace.getExtensionApi(globalRef);
    const runtimeApi = extensionApi?.runtime;

    if (!runtimeApi?.onMessage?.addListener || globalRef.__easyTweetBlockRuntimeListenerAttached__) {
      if (!runtimeApi?.onMessage?.addListener) {
        logContentError('Runtime message listener was not attached because extension API is unavailable in this context.', {
          hasBrowserGlobal: typeof browser !== 'undefined',
          hasChromeGlobal: typeof chrome !== 'undefined',
          hasGlobalRefBrowser: Boolean(globalRef?.browser),
          hasGlobalRefChrome: Boolean(globalRef?.chrome)
        });
      }

      return;
    }

    runtimeApi.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === MESSAGE_TYPES.blockUsernamesViaApi) {
        logContentInfo('Received runtime request: block usernames via API.', message);
        void namespace.blockUsernamesViaApi(message.usernames, {
          delayMs: message.delayMs,
          documentRef: globalRef.document
        })
          .then((results) => {
            sendResponse({
              ok: true,
              results
            });
          })
          .catch((error) => {
            logContentError('Runtime username block request failed.', error);
            sendResponse({
              error: error instanceof Error ? error.message : String(error),
              ok: false
            });
          });

        return true;
      }

      if (message?.type === MESSAGE_TYPES.scanFollowersForBlock) {
        logContentInfo('Received runtime request: scan followers for block.', message);
        const followerRun = startFollowerRun(message.runId);

        void namespace.scanFollowersForBlocking(message.options, {
          documentRef: globalRef.document,
          signal: followerRun.signal
        })
          .then((preview) => {
            finishFollowerRun(followerRun.runId, followerRun.controller);
            sendResponse({
              ok: true,
              preview
            });
          })
          .catch((error) => {
            if (namespace.isAbortError(error)) {
              logContentInfo('Runtime followers preview scan canceled.', {
                runId: followerRun.runId
              });
              finishFollowerRun(followerRun.runId, followerRun.controller);
              sendResponse({
                canceled: true,
                error: error instanceof Error ? error.message : String(error),
                ok: false
              });
              return;
            }

            logContentError('Runtime followers preview scan failed.', error);
            finishFollowerRun(followerRun.runId, followerRun.controller);
            sendResponse({
              error: error instanceof Error ? error.message : String(error),
              ok: false
            });
          });

        return true;
      }

      if (message?.type === MESSAGE_TYPES.blockFollowerCandidatesViaApi) {
        logContentInfo('Received runtime request: block follower candidates via API.', message);
        const followerRun = startFollowerRun(message.runId);

        void namespace.blockFollowerCandidatesViaApi(message.candidates, {
          delayMs: message.delayMs,
          documentRef: globalRef.document,
          onProgress(progress) {
            sendRuntimeProgressMessage(runtimeApi, {
              progress,
              runId: message.runId || null,
              type: MESSAGE_TYPES.followerBlockProgress
            });
          },
          signal: followerRun.signal
        })
          .then((results) => {
            finishFollowerRun(followerRun.runId, followerRun.controller);
            sendResponse({
              ok: true,
              results
            });
          })
          .catch((error) => {
            if (namespace.isAbortError(error)) {
              logContentInfo('Runtime follower candidate block run canceled.', {
                runId: followerRun.runId
              });
              finishFollowerRun(followerRun.runId, followerRun.controller);
              sendResponse({
                canceled: true,
                error: error instanceof Error ? error.message : String(error),
                ok: false
              });
              return;
            }

            logContentError('Runtime follower candidate block request failed.', error);
            finishFollowerRun(followerRun.runId, followerRun.controller);
            sendResponse({
              error: error instanceof Error ? error.message : String(error),
              ok: false
            });
          });

        return true;
      }

      if (message?.type === MESSAGE_TYPES.cancelFollowerRun) {
        const canceled = cancelFollowerRun(message.runId);
        logContentInfo('Received runtime request: cancel follower run.', {
          canceled,
          runId: normalizeFollowerRunId(message.runId)
        });
        sendResponse({
          canceled,
          ok: true
        });

        return false;
      }

      return false;
    });

    globalRef.__easyTweetBlockRuntimeListenerAttached__ = true;
  }

  function init(globalRef = globalThis) {
    if (globalRef.__easyTweetBlockInjected__ || !globalRef.document) {
      return;
    }

    globalRef.__easyTweetBlockInjected__ = true;

    registerRuntimeConnectionListener(globalRef);
    registerRuntimeMessageListener(globalRef);
    void syncStoredPageButtonStyle(globalRef)
      .catch(() => {
        namespace.setCurrentNativeButtonStyle(DEFAULT_PAGE_BLOCK_BUTTON_STYLE);
      })
      .finally(() => {
        processNode(globalRef.document, globalRef.document);
      });

    const stopStyleObservation = observeStoredPageButtonStyle(globalRef);

    if (typeof globalRef.addEventListener === 'function') {
      globalRef.addEventListener('unload', stopStyleObservation, { once: true });
    }

    if (!globalRef.document.body || typeof globalRef.MutationObserver !== 'function') {
      return;
    }

    const observer = new globalRef.MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node?.nodeType === 1) {
            processNode(node, globalRef.document);
          }
        }
      }
    });

    observer.observe(globalRef.document.body, {
      childList: true,
      subtree: true
    });
  }

  Object.assign(namespace, {
    applyCurrentNativeButtonStyleToDocument,
    cancelFollowerRun,
    createApiBlockButton,
    createNativeBlockButton,
    createProfileBlockButton,
    createUserCellBlockButton,
    finishFollowerRun,
    FOLLOWER_RUN_PORT_PREFIX,
    init,
    observeStoredPageButtonStyle,
    registerRuntimeConnectionListener,
    registerRuntimeMessageListener,
    runProfileNativeBlockFlow,
    runNativeBlockFlow,
    startFollowerRun,
    syncStoredPageButtonStyle,
    waitForElement
  });

  if (typeof module !== 'undefined') {
    module.exports = {
      BLOCK_BUTTON_ATTRIBUTE,
      BUTTON_KINDS,
      DEFAULT_BATCH_BLOCK_DELAY_MS,
      DEFAULT_PAGE_BLOCK_BUTTON_STYLE,
      MAX_BATCH_BLOCK_DELAY_MS,
      MESSAGE_TYPES,
      MIN_BATCH_BLOCK_DELAY_MS,
      PAGE_BLOCK_BUTTON_STYLE_STORAGE_KEY,
      PAGE_BUTTON_STYLES,
      RESERVED_PATH_SEGMENTS,
      SELECTORS,
      USER_BY_SCREEN_NAME_FIELD_TOGGLES,
      USER_BY_SCREEN_NAME_FEATURES,
      USER_BY_SCREEN_NAME_QUERY_IDS,
      WAIT_TIMEOUT_MS,
      attachButtonToProfilePage: namespace.attachButtonToProfilePage,
      attachButtonToTweet,
      attachButtonToUserCell: namespace.attachButtonToUserCell,
      FOLLOWERS_PAGE_SIZE: namespace.FOLLOWERS_PAGE_SIZE,
      FOLLOWERS_QUERY_IDS: namespace.FOLLOWERS_QUERY_IDS,
      FOLLOWING_QUERY_IDS: namespace.FOLLOWING_QUERY_IDS,
      blockFollowerCandidatesViaApi: namespace.blockFollowerCandidatesViaApi,
      blockUserByRestIdViaApi: namespace.blockUserByRestIdViaApi,
      blockUserByScreenNameViaApi: namespace.blockUserByScreenNameViaApi,
      blockUsernamesViaApi: namespace.blockUsernamesViaApi,
      buildFollowersLookupUrls: namespace.buildFollowersLookupUrls,
      buildUserLookupUrls: namespace.buildUserLookupUrls,
      buildXApiHeaders: namespace.buildXApiHeaders,
      cancelFollowerRun,
      collectTweets,
      collectUserCells,
      createFollowerBlockCandidates: namespace.createFollowerBlockCandidates,
      discoverGraphqlQueryIds: namespace.discoverGraphqlQueryIds,
      extractGraphqlQueryIdsFromScriptText: namespace.extractGraphqlQueryIdsFromScriptText,
      extractXClientTransactionIndicesFromScriptText: namespace.extractXClientTransactionIndicesFromScriptText,
      extractXClientTransactionKeyFromDocument: namespace.extractXClientTransactionKeyFromDocument,
      createApiBlockButton,
      createUsernameSet: namespace.createUsernameSet,
      createNativeBlockButton,
      createProfileBlockButton,
      createUserCellBlockButton,
      extractScreenNameFromHref: namespace.extractScreenNameFromHref,
      findActionRowContainer,
      findAncestorUserCell: namespace.findAncestorUserCell,
      findProfileActionBar: namespace.findProfileActionBar,
      findPrimaryActionWrapper,
      findUserCellActionBar: namespace.findUserCellActionBar,
      getExtensionApi: namespace.getExtensionApi,
      getElementChildren,
      getClientLanguage: namespace.getClientLanguage,
      getButtonLabel: namespace.getButtonLabel,
      getButtonTitle: namespace.getButtonTitle,
      getCsrfToken: namespace.getCsrfToken,
      getStoredPageButtonStyle: namespace.getStoredPageButtonStyle,
      fetchFollowersPage: namespace.fetchFollowersPage,
      finishFollowerRun,
      FOLLOWER_RUN_PORT_PREFIX,
      init,
      lookupUserRestId: namespace.lookupUserRestId,
      normalizeBatchBlockDelayMs: namespace.normalizeBatchBlockDelayMs,
      normalizeFollowerBlockCandidate: namespace.normalizeFollowerBlockCandidate,
      normalizePageButtonStyle: namespace.normalizePageButtonStyle,
      normalizeUsernameForMatching: namespace.normalizeUsernameForMatching,
      observeStoredPageButtonStyle,
      parseFollowersPage: namespace.parseFollowersPage,
      parseUserLookupRestId: namespace.parseUserLookupRestId,
      readCookieValue: namespace.readCookieValue,
      readScreenNameFromProfilePage: namespace.readScreenNameFromProfilePage,
      readScreenNameFromTweet: namespace.readScreenNameFromTweet,
      resolveOnDemandFileUrlFromRuntime: namespace.resolveOnDemandFileUrlFromRuntime,
      registerRuntimeMessageListener,
      registerRuntimeConnectionListener,
      runImmediateBlockInPageContext: namespace.runImmediateBlockInPageContext,
      runApiBlockFlow: namespace.runApiBlockFlow,
      processNode: namespace.processNode,
      runProfileNativeBlockFlow,
      runNativeBlockFlow,
      scanFollowersForBlocking: namespace.scanFollowersForBlocking,
      applyCurrentNativeButtonStyleToDocument,
      setCurrentNativeButtonStyle: namespace.setCurrentNativeButtonStyle,
      setButtonState: namespace.setButtonState,
      sleep: namespace.sleep,
      startFollowerRun,
      subtreeContainsButton,
      syncStoredPageButtonStyle,
      tryGenerateXClientTransactionId: namespace.tryGenerateXClientTransactionId,
      waitForElement
    };
  }

  globalThis.EasyTweetBlockRunImmediateBlock = (usernames, delayMs) => namespace.runImmediateBlockInPageContext(usernames, delayMs, globalThis);

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    init(window);
  }
})();
