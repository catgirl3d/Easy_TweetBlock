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
    collectTweets,
    findActionRowContainer,
    findPrimaryActionWrapper,
    getElementChildren,
    processNode,
    subtreeContainsButton,
    WAIT_INTERVAL_MS,
    WAIT_TIMEOUT_MS
  } = namespace;

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

  function createActionButton(targetRoot, kind, action, screenName = namespace.readScreenNameFromTweet(targetRoot)) {
    const button = document.createElement('button');

    button.type = 'button';
    button.setAttribute(BLOCK_BUTTON_ATTRIBUTE, 'true');
    button.dataset.kind = kind;
    button.dataset.displayStyle = kind === BUTTON_KINDS.native ? namespace.getCurrentNativeButtonStyle() : PAGE_BUTTON_STYLES.text;

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
    const button = createActionButton(tweet, BUTTON_KINDS.native, () => runNativeBlockFlow(tweet, documentRef));
    button.dataset.surface = 'tweet';
    return button;
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
      screenName
    );

    button.dataset.surface = 'profile';
    return button;
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
        void namespace.scanFollowersForBlocking(message.options, {
          documentRef: globalRef.document
        })
          .then((preview) => {
            sendResponse({
              ok: true,
              preview
            });
          })
          .catch((error) => {
            logContentError('Runtime followers preview scan failed.', error);
            sendResponse({
              error: error instanceof Error ? error.message : String(error),
              ok: false
            });
          });

        return true;
      }

      if (message?.type === MESSAGE_TYPES.blockFollowerCandidatesViaApi) {
        logContentInfo('Received runtime request: block follower candidates via API.', message);
        void namespace.blockFollowerCandidatesViaApi(message.candidates, {
          delayMs: message.delayMs,
          documentRef: globalRef.document,
          onProgress(progress) {
            sendRuntimeProgressMessage(runtimeApi, {
              progress,
              runId: message.runId || null,
              type: MESSAGE_TYPES.followerBlockProgress
            });
          }
        })
          .then((results) => {
            sendResponse({
              ok: true,
              results
            });
          })
          .catch((error) => {
            logContentError('Runtime follower candidate block request failed.', error);
            sendResponse({
              error: error instanceof Error ? error.message : String(error),
              ok: false
            });
          });

        return true;
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
    createApiBlockButton,
    createNativeBlockButton,
    createProfileBlockButton,
    init,
    observeStoredPageButtonStyle,
    registerRuntimeMessageListener,
    runProfileNativeBlockFlow,
    runNativeBlockFlow,
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
      FOLLOWERS_PAGE_SIZE: namespace.FOLLOWERS_PAGE_SIZE,
      FOLLOWERS_QUERY_IDS: namespace.FOLLOWERS_QUERY_IDS,
      blockFollowerCandidatesViaApi: namespace.blockFollowerCandidatesViaApi,
      blockUserByRestIdViaApi: namespace.blockUserByRestIdViaApi,
      blockUserByScreenNameViaApi: namespace.blockUserByScreenNameViaApi,
      blockUsernamesViaApi: namespace.blockUsernamesViaApi,
      buildFollowersLookupUrls: namespace.buildFollowersLookupUrls,
      buildUserLookupUrls: namespace.buildUserLookupUrls,
      buildXApiHeaders: namespace.buildXApiHeaders,
      collectTweets,
      createFollowerBlockCandidates: namespace.createFollowerBlockCandidates,
      discoverGraphqlQueryIds: namespace.discoverGraphqlQueryIds,
      extractGraphqlQueryIdsFromScriptText: namespace.extractGraphqlQueryIdsFromScriptText,
      extractXClientTransactionIndicesFromScriptText: namespace.extractXClientTransactionIndicesFromScriptText,
      extractXClientTransactionKeyFromDocument: namespace.extractXClientTransactionKeyFromDocument,
      createApiBlockButton,
      createUsernameSet: namespace.createUsernameSet,
      createNativeBlockButton,
      createProfileBlockButton,
      extractScreenNameFromHref: namespace.extractScreenNameFromHref,
      findActionRowContainer,
      findProfileActionBar: namespace.findProfileActionBar,
      findPrimaryActionWrapper,
      generateXClientTransactionId: namespace.generateXClientTransactionId,
      getExtensionApi: namespace.getExtensionApi,
      getElementChildren,
      getClientLanguage: namespace.getClientLanguage,
      getButtonLabel: namespace.getButtonLabel,
      getButtonTitle: namespace.getButtonTitle,
      getCsrfToken: namespace.getCsrfToken,
      getStoredPageButtonStyle: namespace.getStoredPageButtonStyle,
      fetchFollowersPage: namespace.fetchFollowersPage,
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
      runImmediateBlockInPageContext: namespace.runImmediateBlockInPageContext,
      runApiBlockFlow: namespace.runApiBlockFlow,
      runProfileNativeBlockFlow,
      runNativeBlockFlow,
      scanFollowersForBlocking: namespace.scanFollowersForBlocking,
      applyCurrentNativeButtonStyleToDocument,
      setCurrentNativeButtonStyle: namespace.setCurrentNativeButtonStyle,
      setButtonState: namespace.setButtonState,
      sleep: namespace.sleep,
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
