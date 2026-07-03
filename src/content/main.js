(() => {
  if (typeof module !== 'undefined' && module.exports) {
    require('./shared.js');
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

    // Reuse X's own UI flow so auth, CSRF, and anti-bot state stay in the page session.
    caretButton.click();

    const blockMenuItem = await waitForElement(SELECTORS.blockMenuItem, documentRef);
    blockMenuItem.click();

    const confirmButton = await waitForElement(SELECTORS.blockConfirmButton, documentRef);
    confirmButton.click();
  }

  function createActionButton(tweet, kind, action) {
    const button = document.createElement('button');
    const screenName = namespace.readScreenNameFromTweet(tweet);

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
        console.warn(`Easy TweetBlock failed to complete ${kind} block flow.`, error);
        namespace.setButtonState(button, 'error', screenName, kind);
      }
    });

    return button;
  }

  function createNativeBlockButton(tweet, documentRef = document) {
    return createActionButton(tweet, BUTTON_KINDS.native, () => runNativeBlockFlow(tweet, documentRef));
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

  function registerRuntimeMessageListener(globalRef = globalThis) {
    const extensionApi = globalRef.browser || globalRef.chrome;
    const runtimeApi = extensionApi?.runtime;

    if (!runtimeApi?.onMessage?.addListener || globalRef.__easyTweetBlockRuntimeListenerAttached__) {
      return;
    }

    runtimeApi.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== MESSAGE_TYPES.blockUsernamesViaApi) {
        return false;
      }

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
          sendResponse({
            error: error instanceof Error ? error.message : String(error),
            ok: false
          });
        });

      return true;
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
        processNode(globalRef.document);
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
            processNode(node);
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
    init,
    observeStoredPageButtonStyle,
    registerRuntimeMessageListener,
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
      attachButtonToTweet,
      blockUserByScreenNameViaApi: namespace.blockUserByScreenNameViaApi,
      blockUsernamesViaApi: namespace.blockUsernamesViaApi,
      buildUserLookupUrls: namespace.buildUserLookupUrls,
      buildXApiHeaders: namespace.buildXApiHeaders,
      collectTweets,
      createApiBlockButton,
      createUsernameSet: namespace.createUsernameSet,
      createNativeBlockButton,
      extractScreenNameFromHref: namespace.extractScreenNameFromHref,
      findActionRowContainer,
      findPrimaryActionWrapper,
      getExtensionApi: namespace.getExtensionApi,
      getElementChildren,
      getClientLanguage: namespace.getClientLanguage,
      getButtonLabel: namespace.getButtonLabel,
      getButtonTitle: namespace.getButtonTitle,
      getCsrfToken: namespace.getCsrfToken,
      getStoredPageButtonStyle: namespace.getStoredPageButtonStyle,
      init,
      lookupUserRestId: namespace.lookupUserRestId,
      normalizeBatchBlockDelayMs: namespace.normalizeBatchBlockDelayMs,
      normalizePageButtonStyle: namespace.normalizePageButtonStyle,
      normalizeUsernameForMatching: namespace.normalizeUsernameForMatching,
      observeStoredPageButtonStyle,
      parseUserLookupRestId: namespace.parseUserLookupRestId,
      readCookieValue: namespace.readCookieValue,
      readScreenNameFromTweet: namespace.readScreenNameFromTweet,
      registerRuntimeMessageListener,
      runImmediateBlockInPageContext: namespace.runImmediateBlockInPageContext,
      runApiBlockFlow: namespace.runApiBlockFlow,
      runNativeBlockFlow,
      applyCurrentNativeButtonStyleToDocument,
      setCurrentNativeButtonStyle: namespace.setCurrentNativeButtonStyle,
      setButtonState: namespace.setButtonState,
      sleep: namespace.sleep,
      subtreeContainsButton,
      syncStoredPageButtonStyle,
      waitForElement
    };
  }

  globalThis.EasyTweetBlockRunImmediateBlock = (usernames, delayMs) => namespace.runImmediateBlockInPageContext(usernames, delayMs, globalThis);

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    init(window);
  }
})();
