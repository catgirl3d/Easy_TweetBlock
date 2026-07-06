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
    require('../shared/blocklist.js');
    require('./x-client-transaction.js');
    require('./api.js');
    require('./dom.js');
  }

  const namespace = globalThis.EasyTweetBlockContent || (globalThis.EasyTweetBlockContent = {});
  const {
    BLOCK_BUTTON_ATTRIBUTE,
    BUTTON_ACTION_ATTRIBUTE,
    BUTTON_ACTIONS,
    BUTTON_KINDS,
    DEFAULT_BATCH_BLOCK_DELAY_MS,
    DEFAULT_PAGE_BLOCK_BUTTON_STYLE,
    DEFAULT_PAGE_BLOCK_BUTTON_STYLES,
    MAX_BATCH_BLOCK_DELAY_MS,
    MESSAGE_TYPES,
    MIN_BATCH_BLOCK_DELAY_MS,
    PAGE_BLOCK_BUTTON_STYLES_STORAGE_KEY,
    PAGE_BUTTON_STYLES,
    PAGE_BUTTON_STYLE_SURFACES,
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
  const DEFAULT_USER_CELL_ADD_BUTTON_STYLE = namespace.DEFAULT_USER_CELL_ADD_BUTTON_STYLE || PAGE_BUTTON_STYLES.icon;
  const DEFAULT_USER_CELL_ADD_BUTTON_VISIBILITY = true;
  const activeUsernameListPromiseByExtensionApi = new WeakMap();

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

  function getBlocklistSharedApi() {
    return globalThis.EasyTweetBlockBlocklist
      || (typeof module !== 'undefined' && module.exports ? require('../shared/blocklist.js') : null);
  }

  function createActionButton(
    targetRoot,
    kind,
    action,
    screenName = namespace.readScreenNameFromTweet(targetRoot),
    surface = null,
    buttonAction = BUTTON_ACTIONS.block,
    actionOptions = {}
  ) {
    const button = document.createElement('button');

    button.type = 'button';
    button.setAttribute(BLOCK_BUTTON_ATTRIBUTE, 'true');
    button.setAttribute(BUTTON_ACTION_ATTRIBUTE, buttonAction);

    if (kind) {
      button.dataset.kind = kind;
    }

    button.dataset.displayStyle = buttonAction === BUTTON_ACTIONS.saveToList
      ? namespace.getCurrentUserCellAddButtonStyle()
      : kind === BUTTON_KINDS.native ? namespace.getCurrentNativeButtonStyle(surface) : PAGE_BUTTON_STYLES.text;

    if (surface) {
      button.dataset.surface = surface;
    }

    namespace.setButtonState(button, 'idle', screenName, kind || BUTTON_KINDS.native);

    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (button.disabled) {
        return;
      }

      const runningState = typeof actionOptions.getRunningState === 'function'
        ? actionOptions.getRunningState(button)
        : 'running';
      namespace.setButtonState(button, runningState, screenName, kind || BUTTON_KINDS.native);

      try {
        const result = await action();
        const successState = typeof actionOptions.getSuccessState === 'function'
          ? actionOptions.getSuccessState(result, button)
          : 'success';
        namespace.setButtonState(button, successState, screenName, kind || BUTTON_KINDS.native);
      } catch (error) {
        const actionLabel = buttonAction === BUTTON_ACTIONS.saveToList ? 'list save' : `${kind} block`;
        logContentError(`Failed to complete ${actionLabel} flow.`, error);
        namespace.setButtonState(button, 'error', screenName, kind || BUTTON_KINDS.native);
      }
    });

    return button;
  }

  function getUserCellBlockMode(button) {
    return button?.dataset?.userCellBlockMode === 'unblock' ? 'unblock' : 'block';
  }

  function setUserCellBlockMode(button, mode) {
    if (button?.dataset) {
      button.dataset.userCellBlockMode = mode === 'unblock' ? 'unblock' : 'block';
    }
  }

  function setUserCellBlockRestId(button, restId) {
    if (!button?.dataset) {
      return;
    }

    if (restId) {
      button.dataset.userRestId = String(restId);
      return;
    }

    delete button.dataset.userRestId;
  }

  function createNativeBlockButton(tweet, documentRef = document) {
    return createActionButton(tweet, BUTTON_KINDS.native, () => runNativeBlockFlow(tweet, documentRef), undefined, 'tweet');
  }

  function setManagedButtonVisibility(button, isVisible) {
    if (!button) {
      return;
    }

    const isHidden = !Boolean(isVisible);
    button.hidden = isHidden;

    if (button.style) {
      if (isHidden) {
        if (typeof button.style.setProperty === 'function') {
          button.style.setProperty('display', 'none', 'important');
        } else {
          button.style.display = 'none';
        }
      } else if (typeof button.style.removeProperty === 'function') {
        button.style.removeProperty('display');
      } else {
        button.style.display = '';
      }
    }

    if (typeof button.setAttribute === 'function') {
      button.setAttribute('aria-hidden', String(isHidden));
    }
  }

  function createProfileBlockButton(documentRef = document) {
    const screenName = namespace.readScreenNameFromProfilePage(documentRef);

    if (!screenName) {
      return null;
    }

    let button = null;
    button = createActionButton(
      documentRef,
      BUTTON_KINDS.native,
      async () => {
        const result = await runProfileNativeBlockFlow(documentRef);
        setManagedButtonVisibility(button, false);
        return result;
      },
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

    let button = null;
    const action = async () => {
      if (getUserCellBlockMode(button) === 'unblock') {
        // The cached restId/screenName belong to the user we blocked. If X has
        // since recycled this cell for a different account (virtualized lists
        // reuse DOM nodes), acting on them would unblock the wrong user. Re-read
        // the live screen name and, on a mismatch, refuse to unblock and reset.
        const liveScreenName = namespace.readScreenNameFromTweet(userCell);

        if (liveScreenName && liveScreenName !== screenName) {
          setUserCellBlockMode(button, 'block');
          setUserCellBlockRestId(button, null);
          setUserCellNativeActionButtonVisibility(options.actionButton, false);
          return { mode: 'unblock' };
        }

        const restId = button?.dataset?.userRestId || null;
        const result = restId
          ? await namespace.unblockUserByRestIdViaApi(restId, {
            ...options,
            screenName
          })
          : await namespace.unblockUserByScreenNameViaApi(screenName, options);

        setUserCellBlockMode(button, 'block');
        setUserCellBlockRestId(button, null);
        setUserCellNativeActionButtonVisibility(options.actionButton, false);

        return {
          mode: 'unblock',
          ...result
        };
      }

      const result = await namespace.runApiBlockFlow(userCell, options);
      setUserCellBlockMode(button, 'unblock');
      setUserCellBlockRestId(button, result?.restId || null);
      setUserCellNativeActionButtonVisibility(options.actionButton, true);

      return {
        mode: 'block',
        ...result
      };
    };

    button = createActionButton(
      userCell,
      BUTTON_KINDS.native,
      action,
      screenName,
      'user-cell',
      BUTTON_ACTIONS.block,
      {
        getRunningState(currentButton) {
          return getUserCellBlockMode(currentButton) === 'unblock' ? 'running-unblock' : 'running';
        },
        getSuccessState(result) {
          return result?.mode === 'unblock' ? 'idle' : 'blocked';
        }
      }
    );

    setUserCellBlockMode(button, 'block');
    button.addEventListener('mouseenter', () => {
      if (button.dataset.state === 'blocked') {
        namespace.setButtonState(button, 'unblock', screenName, BUTTON_KINDS.native);
      }
    });
    button.addEventListener('mouseleave', () => {
      if (button.dataset.state === 'unblock') {
        namespace.setButtonState(button, 'blocked', screenName, BUTTON_KINDS.native);
      }
    });
    button.addEventListener('focus', () => {
      if (button.dataset.state === 'blocked') {
        namespace.setButtonState(button, 'unblock', screenName, BUTTON_KINDS.native);
      }
    });
    button.addEventListener('blur', () => {
      if (button.dataset.state === 'unblock') {
        namespace.setButtonState(button, 'blocked', screenName, BUTTON_KINDS.native);
      }
    });

    return button;
  }

  function getExtensionApiForOptions(options = {}, globalRef = globalThis) {
    return options.extensionApi || namespace.getExtensionApi(options.globalRef || options.documentRef?.defaultView || globalRef);
  }

  function cacheActiveUsernameList(extensionApi, activeList) {
    if (!extensionApi || (typeof extensionApi !== 'object' && typeof extensionApi !== 'function')) {
      return;
    }

    activeUsernameListPromiseByExtensionApi.set(extensionApi, Promise.resolve(activeList));
  }

  function getCachedActiveUsernameList(options = {}) {
    const blocklistApi = getBlocklistSharedApi();

    if (!blocklistApi?.getActiveUsernameList) {
      return Promise.resolve(null);
    }

    const extensionApi = getExtensionApiForOptions(options);

    if (!extensionApi || (typeof extensionApi !== 'object' && typeof extensionApi !== 'function')) {
      return blocklistApi.getActiveUsernameList(extensionApi);
    }

    const cachedPromise = activeUsernameListPromiseByExtensionApi.get(extensionApi);

    if (cachedPromise) {
      return cachedPromise;
    }

    const activeListPromise = blocklistApi.getActiveUsernameList(extensionApi).catch((error) => {
      activeUsernameListPromiseByExtensionApi.delete(extensionApi);
      throw error;
    });
    activeUsernameListPromiseByExtensionApi.set(extensionApi, activeListPromise);
    return activeListPromise;
  }

  function normalizeUserCellAddButtonVisibility(value) {
    const blocklistApi = getBlocklistSharedApi();

    if (typeof blocklistApi?.normalizeUserCellAddButtonVisibility === 'function') {
      return blocklistApi.normalizeUserCellAddButtonVisibility(value);
    }

    return value !== false;
  }

  function getCurrentUserCellAddButtonVisibility() {
    return normalizeUserCellAddButtonVisibility(namespace.contentState?.showUserCellAddButton);
  }

  function setCurrentUserCellAddButtonVisibility(isVisible) {
    namespace.contentState.showUserCellAddButton = normalizeUserCellAddButtonVisibility(isVisible);
    return namespace.contentState.showUserCellAddButton;
  }

  function getCurrentUserCellAddButtonStyle() {
    return namespace.getCurrentUserCellAddButtonStyle?.() || DEFAULT_USER_CELL_ADD_BUTTON_STYLE;
  }

  function setCurrentUserCellAddButtonStyle(style) {
    return typeof namespace.setCurrentUserCellAddButtonStyle === 'function'
      ? namespace.setCurrentUserCellAddButtonStyle(style)
      : DEFAULT_USER_CELL_ADD_BUTTON_STYLE;
  }

  function applyUserCellListButtonStyle(button) {
    if (!button || namespace.getButtonAction(button) !== BUTTON_ACTIONS.saveToList || button.dataset?.surface !== 'user-cell') {
      return;
    }

    button.dataset.displayStyle = getCurrentUserCellAddButtonStyle();
    namespace.setButtonState(button, button.dataset.state || 'idle', button.dataset.screenName || '', BUTTON_KINDS.native);
  }

  function applyUserCellListButtonVisibility(button) {
    if (!button || namespace.getButtonAction(button) !== BUTTON_ACTIONS.saveToList || button.dataset?.surface !== 'user-cell') {
      return;
    }

    const isVisible = getCurrentUserCellAddButtonVisibility();
    button.hidden = !isVisible;

    if (typeof button.setAttribute === 'function') {
      button.setAttribute('aria-hidden', String(!isVisible));
    }
  }

  function syncUserCellListButtonVisibility(documentRef = document) {
    if (!documentRef || typeof documentRef.querySelectorAll !== 'function') {
      return;
    }

    const listButtons = Array.from(documentRef.querySelectorAll(
      `[${BLOCK_BUTTON_ATTRIBUTE}][${BUTTON_ACTION_ATTRIBUTE}="${BUTTON_ACTIONS.saveToList}"]`
    ));

    for (const button of listButtons) {
      applyUserCellListButtonStyle(button);
      applyUserCellListButtonVisibility(button);
    }
  }

  function readUserCellActionButtonText(actionButton) {
    if (!actionButton) {
      return '';
    }

    const rawText = [
      actionButton.textContent,
      actionButton.innerText,
      actionButton.getAttribute?.('aria-label'),
      actionButton.title
    ].find((value) => typeof value === 'string' && value.trim());

    return typeof rawText === 'string'
      ? rawText.trim().replace(/\s+/g, ' ').toLowerCase()
      : '';
  }

  function isBlockedUserCellActionButton(actionButton) {
    const normalizedText = readUserCellActionButtonText(actionButton);
    return normalizedText.includes('blocked') || normalizedText.includes('unblock');
  }

  function syncUserCellBlockButtonVisibility(button, actionButton) {
    if (!button || namespace.getButtonAction(button) !== BUTTON_ACTIONS.block || button.dataset?.surface !== 'user-cell') {
      return;
    }

    const isBlocked = isBlockedUserCellActionButton(actionButton);
    button.hidden = isBlocked;

    if (typeof button.setAttribute === 'function') {
      button.setAttribute('aria-hidden', String(isBlocked));
    }
  }

  function setUserCellNativeActionButtonVisibility(actionButton, isHidden) {
    if (!actionButton) {
      return;
    }

    setManagedButtonVisibility(actionButton, !Boolean(isHidden));

    if (actionButton.dataset) {
      actionButton.dataset.easyTweetblockHiddenByBlock = String(Boolean(isHidden));
    }
  }

  function syncUserCellNativeActionButtonVisibility(button, actionButton) {
    if (!button || namespace.getButtonAction(button) !== BUTTON_ACTIONS.block || button.dataset?.surface !== 'user-cell') {
      return;
    }

    setUserCellNativeActionButtonVisibility(actionButton, getUserCellBlockMode(button) === 'unblock');
  }

  async function syncStoredUserCellAddButtonVisibility(globalRef = globalThis) {
    const blocklistApi = getBlocklistSharedApi();
    const extensionApi = namespace.getExtensionApi(globalRef);
    const isVisible = typeof blocklistApi?.getStoredUserCellAddButtonVisibility === 'function'
      ? await blocklistApi.getStoredUserCellAddButtonVisibility(extensionApi)
      : DEFAULT_USER_CELL_ADD_BUTTON_VISIBILITY;

    setCurrentUserCellAddButtonVisibility(isVisible);
    syncUserCellListButtonVisibility(globalRef.document);
    return isVisible;
  }

  async function syncStoredUserCellAddButtonStyle(globalRef = globalThis) {
    const blocklistApi = getBlocklistSharedApi();
    const extensionApi = namespace.getExtensionApi(globalRef);
    const style = typeof blocklistApi?.getStoredUserCellAddButtonStyle === 'function'
      ? await blocklistApi.getStoredUserCellAddButtonStyle(extensionApi)
      : DEFAULT_USER_CELL_ADD_BUTTON_STYLE;

    setCurrentUserCellAddButtonStyle(style);
    syncUserCellListButtonVisibility(globalRef.document);
    return style;
  }

  function observeStoredUserCellAddButtonVisibility(globalRef = globalThis) {
    const blocklistApi = getBlocklistSharedApi();
    const extensionApi = namespace.getExtensionApi(globalRef);
    const onChangedApi = extensionApi?.storage?.onChanged;
    const storageKey = blocklistApi?.USER_CELL_ADD_BUTTON_VISIBILITY_STORAGE_KEY;

    if (!storageKey || !onChangedApi?.addListener) {
      return () => {};
    }

    const handleStorageChange = (changes, areaName) => {
      if (areaName !== 'local' || !Object.prototype.hasOwnProperty.call(changes, storageKey)) {
        return;
      }

      setCurrentUserCellAddButtonVisibility(changes[storageKey]?.newValue);
      syncUserCellListButtonVisibility(globalRef.document);
    };

    onChangedApi.addListener(handleStorageChange);

    return () => {
      if (typeof onChangedApi.removeListener === 'function') {
        onChangedApi.removeListener(handleStorageChange);
      }
    };
  }

  function observeStoredUserCellAddButtonStyle(globalRef = globalThis) {
    const blocklistApi = getBlocklistSharedApi();
    const extensionApi = namespace.getExtensionApi(globalRef);
    const onChangedApi = extensionApi?.storage?.onChanged;
    const storageKey = blocklistApi?.USER_CELL_ADD_BUTTON_STYLE_STORAGE_KEY;

    if (!storageKey || !onChangedApi?.addListener) {
      return () => {};
    }

    const handleStorageChange = (changes, areaName) => {
      if (areaName !== 'local' || !Object.prototype.hasOwnProperty.call(changes, storageKey)) {
        return;
      }

      setCurrentUserCellAddButtonStyle(changes[storageKey]?.newValue);
      syncUserCellListButtonVisibility(globalRef.document);
    };

    onChangedApi.addListener(handleStorageChange);

    return () => {
      if (typeof onChangedApi.removeListener === 'function') {
        onChangedApi.removeListener(handleStorageChange);
      }
    };
  }

  async function syncUserCellListButtonState(button, activeList = null, options = {}) {
    if (!button || button.dataset?.state === 'running') {
      return;
    }

    const blocklistApi = getBlocklistSharedApi();
    const screenName = button.dataset?.screenName || '';

    if (!blocklistApi?.normalizeUsername) {
      namespace.setButtonState(button, 'error', screenName, BUTTON_KINDS.native);
      return;
    }

    const normalizedUsername = blocklistApi.normalizeUsername(screenName);
    const isListed = activeList && Array.isArray(activeList.usernames)
      ? activeList.usernames.includes(normalizedUsername)
      : await blocklistApi.isUsernameInActiveList(normalizedUsername, getExtensionApiForOptions(options));

    namespace.setButtonState(button, isListed ? 'listed' : 'idle', screenName, BUTTON_KINDS.native);
    applyUserCellListButtonVisibility(button);
  }

  function syncUserCellListButtons(documentRef = document, activeList = null, options = {}) {
    if (!documentRef || typeof documentRef.querySelectorAll !== 'function') {
      return;
    }

    const listButtons = Array.from(documentRef.querySelectorAll(
      `[${BLOCK_BUTTON_ATTRIBUTE}][${BUTTON_ACTION_ATTRIBUTE}="${BUTTON_ACTIONS.saveToList}"]`
    ));

    for (const button of listButtons) {
      void syncUserCellListButtonState(button, activeList, options).catch((error) => {
        logContentError('Failed to sync UserCell list button state.', error);
      });
    }
  }

  function createUserCellListButton(userCell, options = {}) {
    const screenName = namespace.readScreenNameFromTweet(userCell);

    if (!screenName) {
      return null;
    }

    const button = createActionButton(
      userCell,
      null,
      () => {
        const blocklistApi = getBlocklistSharedApi();

        if (!blocklistApi?.addUsernameToActiveList) {
          throw new Error('Missing shared username list API.');
        }

        const extensionApi = getExtensionApiForOptions(options);
        return blocklistApi.addUsernameToActiveList(screenName, extensionApi).then((result) => {
          if (result?.list) {
            cacheActiveUsernameList(extensionApi, result.list);
          }

          return result;
        });
      },
      screenName,
      'user-cell',
      BUTTON_ACTIONS.saveToList,
      {
        getSuccessState(result) {
          return result?.added === false ? 'listed' : 'success';
        }
      }
    );

    applyUserCellListButtonStyle(button);
    applyUserCellListButtonVisibility(button);

    void getCachedActiveUsernameList(options)
      .then((activeList) => syncUserCellListButtonState(button, activeList, options))
      .catch((error) => {
        logContentError('Failed to initialize UserCell list button state.', error);
      });

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
      button.dataset.displayStyle = namespace.getCurrentNativeButtonStyle(button.dataset.surface || PAGE_BUTTON_STYLE_SURFACES.tweet);
      namespace.setButtonState(button, button.dataset.state || 'idle', button.dataset.screenName || '', BUTTON_KINDS.native);
    }
  }

  async function syncStoredPageButtonStyle(globalRef = globalThis) {
    const styles = await namespace.getStoredPageButtonStyles(globalRef);
    namespace.setCurrentNativeButtonStyles(styles);
    applyCurrentNativeButtonStyleToDocument(globalRef.document);
    return styles;
  }

  function observeStoredPageButtonStyle(globalRef = globalThis) {
    const extensionApi = namespace.getExtensionApi(globalRef);
    const onChangedApi = extensionApi?.storage?.onChanged;

    if (!onChangedApi?.addListener) {
      return () => {};
    }

    const handleStorageChange = (changes, areaName) => {
      if (areaName !== 'local' || !Object.prototype.hasOwnProperty.call(changes, PAGE_BLOCK_BUTTON_STYLES_STORAGE_KEY)) {
        return;
      }

      namespace.setCurrentNativeButtonStyles(changes[PAGE_BLOCK_BUTTON_STYLES_STORAGE_KEY]?.newValue);
      applyCurrentNativeButtonStyleToDocument(globalRef.document);
    };

    onChangedApi.addListener(handleStorageChange);

    return () => {
      if (typeof onChangedApi.removeListener === 'function') {
        onChangedApi.removeListener(handleStorageChange);
      }
    };
  }

  function observeActiveUsernameList(globalRef = globalThis) {
    const blocklistApi = getBlocklistSharedApi();
    const extensionApi = namespace.getExtensionApi(globalRef);

    if (!blocklistApi?.observeActiveUsernameList) {
      return () => {};
    }

    return blocklistApi.observeActiveUsernameList((activeList) => {
      cacheActiveUsernameList(extensionApi, activeList);
      syncUserCellListButtons(globalRef.document, activeList, {
        extensionApi,
        globalRef
      });
    }, extensionApi);
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
    setCurrentUserCellAddButtonVisibility(DEFAULT_USER_CELL_ADD_BUTTON_VISIBILITY);
    setCurrentUserCellAddButtonStyle(DEFAULT_USER_CELL_ADD_BUTTON_STYLE);

    void Promise.allSettled([
      syncStoredPageButtonStyle(globalRef),
      syncStoredUserCellAddButtonVisibility(globalRef),
      syncStoredUserCellAddButtonStyle(globalRef)
    ])
      .then((results) => {
        if (results[0]?.status === 'rejected') {
          namespace.setCurrentNativeButtonStyles(DEFAULT_PAGE_BLOCK_BUTTON_STYLES || DEFAULT_PAGE_BLOCK_BUTTON_STYLE);
        }

        if (results[1]?.status === 'rejected') {
          setCurrentUserCellAddButtonVisibility(DEFAULT_USER_CELL_ADD_BUTTON_VISIBILITY);
        }

        if (results[2]?.status === 'rejected') {
          setCurrentUserCellAddButtonStyle(DEFAULT_USER_CELL_ADD_BUTTON_STYLE);
        }
      })
      .finally(() => {
        processNode(globalRef.document, globalRef.document);
        syncUserCellListButtonVisibility(globalRef.document);
      });

    const stopStyleObservation = observeStoredPageButtonStyle(globalRef);
    const stopActiveListObservation = observeActiveUsernameList(globalRef);
    const stopUserCellAddButtonObservation = observeStoredUserCellAddButtonVisibility(globalRef);
    const stopUserCellAddButtonStyleObservation = observeStoredUserCellAddButtonStyle(globalRef);

    if (typeof globalRef.addEventListener === 'function') {
      globalRef.addEventListener('unload', stopStyleObservation, { once: true });
      globalRef.addEventListener('unload', stopActiveListObservation, { once: true });
      globalRef.addEventListener('unload', stopUserCellAddButtonObservation, { once: true });
      globalRef.addEventListener('unload', stopUserCellAddButtonStyleObservation, { once: true });
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
    createUserCellListButton,
    finishFollowerRun,
    FOLLOWER_RUN_PORT_PREFIX,
    getBlocklistSharedApi,
    init,
    observeActiveUsernameList,
    observeStoredPageButtonStyle,
    observeStoredUserCellAddButtonStyle,
    observeStoredUserCellAddButtonVisibility,
    registerRuntimeConnectionListener,
    registerRuntimeMessageListener,
    runProfileNativeBlockFlow,
    runNativeBlockFlow,
    syncUserCellBlockButtonVisibility,
    syncUserCellNativeActionButtonVisibility,
    startFollowerRun,
    syncStoredPageButtonStyle,
    syncStoredUserCellAddButtonStyle,
    syncStoredUserCellAddButtonVisibility,
    waitForElement
  });

  if (typeof module !== 'undefined') {
    module.exports = {
      BLOCK_BUTTON_ATTRIBUTE,
      BUTTON_ACTION_ATTRIBUTE,
      BUTTON_ACTIONS,
      BUTTON_KINDS,
      DEFAULT_BATCH_BLOCK_DELAY_MS,
      DEFAULT_PAGE_BLOCK_BUTTON_STYLE,
      DEFAULT_PAGE_BLOCK_BUTTON_STYLES,
      DEFAULT_USER_CELL_ADD_BUTTON_STYLE,
      MAX_BATCH_BLOCK_DELAY_MS,
      MESSAGE_TYPES,
      MIN_BATCH_BLOCK_DELAY_MS,
      PAGE_BLOCK_BUTTON_STYLES_STORAGE_KEY,
      PAGE_BUTTON_STYLES,
      PAGE_BUTTON_STYLE_SURFACES,
      USER_CELL_ADD_BUTTON_STYLE_STORAGE_KEY: namespace.USER_CELL_ADD_BUTTON_STYLE_STORAGE_KEY,
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
      unblockUserByRestIdViaApi: namespace.unblockUserByRestIdViaApi,
      unblockUserByScreenNameViaApi: namespace.unblockUserByScreenNameViaApi,
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
      createUserCellListButton,
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
      getBlocklistSharedApi,
      getCsrfToken: namespace.getCsrfToken,
      getStoredPageButtonStyles: namespace.getStoredPageButtonStyles,
      getStoredUserCellAddButtonStyle: namespace.getStoredUserCellAddButtonStyle,
      fetchFollowersPage: namespace.fetchFollowersPage,
      finishFollowerRun,
      FOLLOWER_RUN_PORT_PREFIX,
      init,
      lookupUserRestId: namespace.lookupUserRestId,
      normalizeBatchBlockDelayMs: namespace.normalizeBatchBlockDelayMs,
      normalizeFollowerBlockCandidate: namespace.normalizeFollowerBlockCandidate,
      normalizePageButtonStyle: namespace.normalizePageButtonStyle,
      normalizePageButtonStyles: namespace.normalizePageButtonStyles,
      normalizeUsernameForMatching: namespace.normalizeUsernameForMatching,
      observeStoredPageButtonStyle,
      observeStoredUserCellAddButtonStyle,
      observeStoredUserCellAddButtonVisibility,
      observeActiveUsernameList,
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
      isBlockedUserCellActionButton,
      readUserCellActionButtonText,
      runProfileNativeBlockFlow,
      runNativeBlockFlow,
      scanFollowersForBlocking: namespace.scanFollowersForBlocking,
      applyCurrentNativeButtonStyleToDocument,
      setCurrentNativeButtonStyle: namespace.setCurrentNativeButtonStyle,
      setCurrentNativeButtonStyles: namespace.setCurrentNativeButtonStyles,
      setCurrentUserCellAddButtonStyle,
      setButtonState: namespace.setButtonState,
      setUserCellNativeActionButtonVisibility,
      sleep: namespace.sleep,
      startFollowerRun,
      syncUserCellListButtonState,
      syncUserCellListButtons,
      syncUserCellBlockButtonVisibility,
      syncUserCellNativeActionButtonVisibility,
      subtreeContainsButton,
      syncStoredPageButtonStyle,
      syncStoredUserCellAddButtonStyle,
      syncStoredUserCellAddButtonVisibility,
      tryGenerateXClientTransactionId: namespace.tryGenerateXClientTransactionId,
      waitForElement
    };
  }

  globalThis.EasyTweetBlockRunImmediateBlock = (usernames, delayMs) => namespace.runImmediateBlockInPageContext(usernames, delayMs, globalThis);

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    init(window);
  }
})();
