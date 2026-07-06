(() => {
  const namespace = globalThis.EasyTweetBlockContent || (globalThis.EasyTweetBlockContent = {});
  const storageApi = globalThis.EasyTweetBlockStorage
    || (typeof module !== 'undefined' && module.exports ? require('../shared/storage.js') : null);
  const settingsApi = globalThis.EasyTweetBlockSettings
    || (typeof module !== 'undefined' && module.exports ? require('../shared/settings.js') : null);

  if (!storageApi || !settingsApi) {
    throw new Error('Missing Easy TweetBlock shared settings/storage API.');
  }

  const { getExtensionApi: getStorageExtensionApi } = storageApi;
  const {
    DEFAULT_BATCH_BLOCK_DELAY_MS,
    DEFAULT_PAGE_BLOCK_BUTTON_STYLE,
    DEFAULT_PAGE_BLOCK_BUTTON_STYLES,
    DEFAULT_USER_CELL_ADD_BUTTON_STYLE,
    DEFAULT_USER_CELL_ADD_BUTTON_VISIBILITY,
    MAX_BATCH_BLOCK_DELAY_MS,
    MIN_BATCH_BLOCK_DELAY_MS,
    PAGE_BLOCK_BUTTON_STYLES,
    PAGE_BLOCK_BUTTON_STYLES_STORAGE_KEY,
    PAGE_BUTTON_STYLE_SURFACES,
    USER_CELL_ADD_BUTTON_STYLE_STORAGE_KEY,
    USER_CELL_ADD_BUTTON_VISIBILITY_STORAGE_KEY,
    normalizeBatchBlockDelayMs,
    normalizePageBlockButtonStyle,
    normalizePageBlockButtonStyles,
    normalizePageButtonStyleSurface,
    normalizeUserCellAddButtonVisibility
  } = settingsApi;

  const SELECTORS = Object.freeze({
    tweet: 'article[data-testid="tweet"]',
    userCell: 'button[data-testid="UserCell"]',
    caretButton: 'button[data-testid="caret"]',
    grokButton: 'button[aria-label="Grok actions"]',
    profileActionsButton: 'button[data-testid="userActions"]',
    blockMenuItem: '[data-testid="block"]',
    blockConfirmButton: '[data-testid="confirmationSheetConfirm"]',
    permalink: 'a[href*="/status/"]',
    profileLink: '[data-testid="User-Name"] a[href^="/"]:not([href*="/status/"])',
    avatarContainer: '[data-testid^="UserAvatar-Container-"]'
  });
  const BUTTON_KINDS = Object.freeze({
    native: 'native',
    api: 'api'
  });
  const MESSAGE_TYPES = Object.freeze({
    blockFollowerCandidatesViaApi: 'easy-tweetblock:block-follower-candidates-via-api',
    cancelFollowerRun: 'easy-tweetblock:cancel-follower-run',
    followerBlockProgress: 'easy-tweetblock:follower-block-progress',
    blockUsernamesViaApi: 'easy-tweetblock:block-usernames-via-api',
    scanFollowersForBlock: 'easy-tweetblock:scan-followers-for-block'
  });
  const BLOCK_BUTTON_ATTRIBUTE = 'data-easy-tweetblock-button';
  const BUTTON_ACTION_ATTRIBUTE = 'data-easy-tweetblock-action';
  const BUTTON_ACTIONS = Object.freeze({
    block: 'block',
    saveToList: 'save-to-list'
  });
  const WAIT_INTERVAL_MS = 50;
  const WAIT_TIMEOUT_MS = 2500;
  const USERNAME_PATTERN = /^[A-Za-z0-9_]{1,15}$/;
  const RESERVED_PATH_SEGMENTS = new Set([
    'compose',
    'explore',
    'hashtag',
    'home',
    'i',
    'intent',
    'messages',
    'notifications',
    'search',
    'settings',
    'share'
  ]);
  const BLOCK_ICON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><g><path d="M12 3.75c-4.55 0-8.25 3.69-8.25 8.25 0 1.92.66 3.68 1.75 5.08L17.09 5.5C15.68 4.4 13.92 3.75 12 3.75zm6.5 3.17L6.92 18.5c1.4 1.1 3.16 1.75 5.08 1.75 4.56 0 8.25-3.69 8.25-8.25 0-1.92-.65-3.68-1.75-5.08zM1.75 12C1.75 6.34 6.34 1.75 12 1.75S22.25 6.34 22.25 12 17.66 22.25 12 22.25 1.75 17.66 1.75 12z"></path></g></svg>';
  const ADD_ICON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><g><path d="M11.25 4.75h1.5v6.5h6.5v1.5h-6.5v6.5h-1.5v-6.5h-6.5v-1.5h6.5z"></path></g></svg>';
  const CHECK_ICON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><g><path d="M9.55 16.94L5.3 12.7l1.41-1.41 2.84 2.83 7.84-7.84 1.41 1.41-9.25 9.25z"></path></g></svg>';

  const contentState = namespace.contentState || {
    currentNativeButtonStyles: { ...DEFAULT_PAGE_BLOCK_BUTTON_STYLES },
    currentUserCellAddButtonStyle: DEFAULT_USER_CELL_ADD_BUTTON_STYLE,
    userRestIdCache: new Map()
  };

  contentState.currentNativeButtonStyles = normalizePageBlockButtonStyles(
    contentState.currentNativeButtonStyles || DEFAULT_PAGE_BLOCK_BUTTON_STYLES
  );
  contentState.currentUserCellAddButtonStyle = normalizePageBlockButtonStyle(
    contentState.currentUserCellAddButtonStyle || DEFAULT_USER_CELL_ADD_BUTTON_STYLE
  );

  namespace.contentState = contentState;

  function makePrefixedLogger(prefix, methodName) {
    return function logWithPrefix(message, details) {
      const logger = console?.[methodName];

      if (typeof logger !== 'function') {
        return;
      }

      if (details === undefined) {
        logger(prefix, message);
        return;
      }

      logger(prefix, message, details);
    };
  }

  function extractScreenNameFromHref(href, baseUrl = 'https://x.com') {
    if (typeof href !== 'string' || !href.trim()) {
      return null;
    }

    let url;

    try {
      url = new URL(href, baseUrl);
    } catch {
      return null;
    }

    const pathSegments = url.pathname.split('/').filter(Boolean);

    if (!pathSegments.length) {
      return null;
    }

    const [firstSegment, secondSegment] = pathSegments;

    if (!firstSegment || RESERVED_PATH_SEGMENTS.has(firstSegment.toLowerCase())) {
      return null;
    }

    if (secondSegment && secondSegment !== 'status') {
      return null;
    }

    return firstSegment;
  }

  function readScreenNameFromTweet(tweet) {
    const permalink = tweet.querySelector(SELECTORS.permalink);
    const permalinkScreenName = extractScreenNameFromHref(
      permalink?.getAttribute?.('href') || permalink?.href || ''
    );

    if (permalinkScreenName) {
      return permalinkScreenName;
    }

    const profileLink = tweet.querySelector(SELECTORS.profileLink);
    const profileScreenName = extractScreenNameFromHref(
      profileLink?.getAttribute?.('href') || profileLink?.href || ''
    );

    if (profileScreenName) {
      return profileScreenName;
    }

    const avatarContainer = tweet.querySelector(SELECTORS.avatarContainer);
    const avatarTestId = avatarContainer?.getAttribute?.('data-testid') || '';

    if (!avatarTestId.startsWith('UserAvatar-Container-')) {
      return null;
    }

    const avatarScreenName = avatarTestId.slice('UserAvatar-Container-'.length).trim();
    return avatarScreenName || null;
  }

  function readScreenNameFromProfilePage(documentRef = document) {
    const pathname = documentRef?.location?.pathname;

    if (typeof pathname !== 'string' || !pathname.trim()) {
      return null;
    }

    const [firstPathSegment] = pathname.split('/').filter(Boolean);

    if (!firstPathSegment || RESERVED_PATH_SEGMENTS.has(firstPathSegment.toLowerCase())) {
      return null;
    }

    return USERNAME_PATTERN.test(firstPathSegment) ? firstPathSegment : null;
  }

  function normalizeUsernameForMatching(value) {
    if (typeof value !== 'string') {
      return null;
    }

    const normalizedValue = value.trim().replace(/^[@/]+/, '').toLowerCase();
    return normalizedValue && USERNAME_PATTERN.test(normalizedValue) ? normalizedValue : null;
  }

  function createUsernameSet(usernames) {
    const normalizedUsernames = new Set();

    if (!Array.isArray(usernames)) {
      return normalizedUsernames;
    }

    for (const username of usernames) {
      const normalizedUsername = normalizeUsernameForMatching(username);

      if (normalizedUsername) {
        normalizedUsernames.add(normalizedUsername);
      }
    }

    return normalizedUsernames;
  }

  function getExtensionApi(globalRef = globalThis) {
    if (globalRef?.runtime || globalRef?.storage || globalRef?.tabs) {
      return getStorageExtensionApi(globalRef);
    }

    return getStorageExtensionApi(globalRef?.browser || globalRef?.chrome || undefined);
  }

  function getCurrentNativeButtonStyles() {
    return { ...contentState.currentNativeButtonStyles };
  }

  function getCurrentNativeButtonStyle(surface = PAGE_BUTTON_STYLE_SURFACES.tweet) {
    const normalizedSurface = normalizePageButtonStyleSurface(surface);
    return normalizePageBlockButtonStyle(contentState.currentNativeButtonStyles?.[normalizedSurface]);
  }

  function setCurrentNativeButtonStyles(styles) {
    contentState.currentNativeButtonStyles = normalizePageBlockButtonStyles(styles);
    return getCurrentNativeButtonStyles();
  }

  function setCurrentNativeButtonStyle(style, surface = null) {
    if (surface) {
      const normalizedSurface = normalizePageButtonStyleSurface(surface);
      contentState.currentNativeButtonStyles = normalizePageBlockButtonStyles({
        ...contentState.currentNativeButtonStyles,
        [normalizedSurface]: style
      });
      return getCurrentNativeButtonStyle(normalizedSurface);
    }

    contentState.currentNativeButtonStyles = normalizePageBlockButtonStyles(style);
    return getCurrentNativeButtonStyles();
  }

  function getCurrentUserCellAddButtonStyle() {
    return normalizePageBlockButtonStyle(contentState.currentUserCellAddButtonStyle);
  }

  function setCurrentUserCellAddButtonStyle(style) {
    contentState.currentUserCellAddButtonStyle = normalizePageBlockButtonStyle(style);
    return contentState.currentUserCellAddButtonStyle;
  }

  function getUserRestIdCache() {
    return contentState.userRestIdCache;
  }

  async function getStoredPageButtonStyles(globalRef = globalThis) {
    const extensionApi = getExtensionApi(globalRef);
    return settingsApi.getStoredPageBlockButtonStyles(extensionApi);
  }

  async function getStoredUserCellAddButtonStyle(globalRef = globalThis) {
    const extensionApi = getExtensionApi(globalRef);
    return settingsApi.getStoredUserCellAddButtonStyle(extensionApi);
  }

  async function getStoredUserCellAddButtonVisibility(globalRef = globalThis) {
    const extensionApi = getExtensionApi(globalRef);
    return settingsApi.getStoredUserCellAddButtonVisibility(extensionApi);
  }

  function getFollowersSharedApi() {
    return globalThis.EasyTweetBlockFollowers
      || (typeof module !== 'undefined' && module.exports ? require('../shared/followers.js') : null);
  }

  function sleep(delayMs, setTimeoutImpl = globalThis.setTimeout) {
    const sharedSleep = getFollowersSharedApi()?.sleep;

    if (typeof sharedSleep !== 'function' || sharedSleep === sleep) {
      throw new Error('Missing Easy TweetBlock followers shared sleep helper.');
    }

    return sharedSleep(delayMs, setTimeoutImpl);
  }

  function createAbortError(reason) {
    if (reason instanceof Error) {
      reason.name = 'AbortError';
      return reason;
    }

    const error = new Error(typeof reason === 'string' && reason.trim()
      ? reason
      : 'Operation canceled.');
    error.name = 'AbortError';
    return error;
  }

  function isAbortError(error) {
    return error?.name === 'AbortError';
  }

  function readCookieValue(cookieSource, cookieName) {
    if (typeof cookieSource !== 'string' || !cookieSource || !cookieName) {
      return null;
    }

    for (const cookiePart of cookieSource.split(';')) {
      const normalizedPart = cookiePart.trim();

      if (!normalizedPart.startsWith(`${cookieName}=`)) {
        continue;
      }

      const rawValue = normalizedPart.slice(cookieName.length + 1);

      try {
        return decodeURIComponent(rawValue);
      } catch {
        return rawValue;
      }
    }

    return null;
  }

  function getClientLanguage(documentRef = document) {
    const lang = documentRef?.documentElement?.lang?.trim();

    if (!lang) {
      return 'en';
    }

    return lang.split('-')[0].toLowerCase() || 'en';
  }

  function getCsrfToken(documentRef = document) {
    return readCookieValue(documentRef?.cookie || '', 'ct0');
  }

  function getButtonAction(button) {
    const action = button?.getAttribute?.(BUTTON_ACTION_ATTRIBUTE)
      || button?.dataset?.easyTweetblockAction
      || button?.dataset?.action;

    return action === BUTTON_ACTIONS.saveToList ? BUTTON_ACTIONS.saveToList : BUTTON_ACTIONS.block;
  }

  function getButtonLabel(kind, state, action = BUTTON_ACTIONS.block, surface = null, mode = null) {
    if (action === BUTTON_ACTIONS.saveToList) {
      if (state === 'running') {
        return 'Adding...';
      }

      if (state === 'running-remove') {
        return 'Removing...';
      }

      if (state === 'error-remove') {
        return 'Retry remove';
      }

      if (state === 'listed') {
        return 'Remove';
      }

      if (state === 'success') {
        return 'Added';
      }

      if (state === 'error') {
        return 'Retry';
      }

      return 'Add';
    }

    if (surface === 'user-cell') {
      if (state === 'running-unblock') {
        return 'Unblocking...';
      }

      if (state === 'blocked') {
        return 'Blocked';
      }

      if (state === 'unblock') {
        return 'Unblock';
      }

      if (state === 'error' && mode === 'unblock') {
        return 'Retry unblock';
      }
    }

    if (state === 'running') {
      return kind === BUTTON_KINDS.api ? 'API...' : 'Blocking...';
    }

    if (state === 'success') {
      return kind === BUTTON_KINDS.api ? 'API ok' : 'Blocked';
    }

    if (state === 'error') {
      return 'Retry';
    }

    return kind === BUTTON_KINDS.api ? 'API' : 'Block';
  }

  function getButtonTitle(kind, screenName, state, surface = null, action = BUTTON_ACTIONS.block, mode = null) {
    if (action === BUTTON_ACTIONS.saveToList) {
      if (state === 'running') {
        return screenName ? `Adding @${screenName} to the active list` : 'Adding this account to the active list';
      }

      if (state === 'running-remove') {
        return screenName ? `Removing @${screenName} from the active list` : 'Removing this account from the active list';
      }

      if (state === 'error-remove') {
        return screenName ? `Retry removing @${screenName} from the active list` : 'Retry removing this account from the active list';
      }

      if (state === 'listed') {
        return screenName ? `Remove @${screenName} from the active list` : 'Remove this account from the active list';
      }

      if (state === 'success') {
        return screenName ? `Added @${screenName} to the active list` : 'Added this account to the active list';
      }

      if (state === 'error') {
        return screenName ? `Retry adding @${screenName} to the active list` : 'Retry adding this account to the active list';
      }

      return screenName ? `Add @${screenName} to the active list` : 'Add this account to the active list';
    }

    if (surface === 'user-cell') {
      if (state === 'running-unblock') {
        return screenName ? `Unblocking @${screenName} from this list` : 'Unblocking this account from this list';
      }

      if (state === 'unblock') {
        return screenName ? `Unblock @${screenName} from this list` : 'Unblock this account from this list';
      }

      if (state === 'running') {
        return screenName ? `Blocking @${screenName} from this list` : 'Blocking this account from this list';
      }

      if (state === 'success' || state === 'blocked') {
        return screenName ? `Blocked @${screenName} from this list` : 'Blocked this account from this list';
      }

      if (state === 'error') {
        if (mode === 'unblock') {
          return screenName ? `Retry unblock for @${screenName} from this list` : 'Retry unblocking this account from this list';
        }

        return screenName ? `Retry block for @${screenName} from this list` : 'Retry blocking this account from this list';
      }

      return screenName ? `Block @${screenName} from this list` : 'Block this account from this list';
    }

    if (state === 'running') {
      if (kind === BUTTON_KINDS.api) {
        return screenName ? `Trying API block for @${screenName}` : 'Trying API block for this account';
      }

      return screenName ? `Blocking @${screenName} using X menu flow` : 'Blocking this account using X menu flow';
    }

    if (state === 'success') {
      if (kind === BUTTON_KINDS.api) {
        return screenName ? `Blocked @${screenName} via internal API` : 'Blocked this account via internal API';
      }

      return screenName ? `Blocked @${screenName} using X menu flow` : 'Blocked this account using X menu flow';
    }

    if (state === 'error') {
      if (kind === BUTTON_KINDS.api) {
        return screenName ? `Retry API block for @${screenName}` : 'Retry API block for this account';
      }

      return screenName ? `Retry block for @${screenName} using X menu flow` : 'Retry blocking this account using X menu flow';
    }

    if (kind === BUTTON_KINDS.api) {
      return screenName ? `Try blocking @${screenName} via internal API` : 'Try blocking this account via internal API';
    }

    return screenName ? `Block @${screenName} using X menu flow` : 'Block this account using X menu flow';
  }

  function setButtonState(button, state, screenName, kind = button?.dataset?.kind || BUTTON_KINDS.native) {
    const action = getButtonAction(button);
    const surface = button?.dataset?.surface || null;
    const mode = button?.dataset?.userCellBlockMode || null;
    const label = getButtonLabel(kind, state, action, surface, mode);
    const title = getButtonTitle(kind, screenName, state, surface, action, mode);
    const displayStyle = action === BUTTON_ACTIONS.saveToList
      ? normalizePageBlockButtonStyle(button?.dataset?.displayStyle || getCurrentUserCellAddButtonStyle())
      : kind === BUTTON_KINDS.native
      ? normalizePageBlockButtonStyle(button?.dataset?.displayStyle || getCurrentNativeButtonStyle(surface))
      : PAGE_BLOCK_BUTTON_STYLES.text;
    button.dataset.state = state;
    button.dataset.displayStyle = displayStyle;
    button.dataset.screenName = screenName || '';
    button.disabled = action === BUTTON_ACTIONS.saveToList
      ? state === 'running' || state === 'running-remove' || state === 'success'
      : state === 'running' || state === 'running-unblock' || state === 'success' || state === 'listed';

    if (displayStyle === PAGE_BLOCK_BUTTON_STYLES.icon) {
      button.textContent = '';
      if (action === BUTTON_ACTIONS.saveToList) {
        button.innerHTML = (state === 'listed' || state === 'running-remove' || state === 'error-remove' || state === 'success') ? CHECK_ICON_SVG : ADD_ICON_SVG;
      } else {
        button.innerHTML = BLOCK_ICON_SVG;
      }
    } else {
      button.innerHTML = '';
      button.textContent = label;
    }

    button.title = title;
    button.setAttribute('aria-label', title);
  }

  const sharedExports = {
    BLOCK_BUTTON_ATTRIBUTE,
    BUTTON_ACTION_ATTRIBUTE,
    BUTTON_ACTIONS,
    BUTTON_KINDS,
    DEFAULT_BATCH_BLOCK_DELAY_MS,
    DEFAULT_PAGE_BLOCK_BUTTON_STYLE,
    DEFAULT_PAGE_BLOCK_BUTTON_STYLES,
    DEFAULT_USER_CELL_ADD_BUTTON_STYLE,
    DEFAULT_USER_CELL_ADD_BUTTON_VISIBILITY,
    MAX_BATCH_BLOCK_DELAY_MS,
    MESSAGE_TYPES,
    MIN_BATCH_BLOCK_DELAY_MS,
    PAGE_BLOCK_BUTTON_STYLES,
    PAGE_BLOCK_BUTTON_STYLES_STORAGE_KEY,
    PAGE_BUTTON_STYLE_SURFACES,
    USER_CELL_ADD_BUTTON_STYLE_STORAGE_KEY,
    USER_CELL_ADD_BUTTON_VISIBILITY_STORAGE_KEY,
    RESERVED_PATH_SEGMENTS,
    SELECTORS,
    WAIT_INTERVAL_MS,
    WAIT_TIMEOUT_MS,
    createUsernameSet,
    createAbortError,
    extractScreenNameFromHref,
    getButtonLabel,
    getButtonAction,
    getButtonTitle,
    getClientLanguage,
    getCsrfToken,
    getCurrentNativeButtonStyle,
    getCurrentNativeButtonStyles,
    getCurrentUserCellAddButtonStyle,
    getExtensionApi,
    makePrefixedLogger,
    getStoredPageButtonStyles,
    getStoredUserCellAddButtonStyle,
    getStoredUserCellAddButtonVisibility,
    getUserRestIdCache,
    isAbortError,
    normalizeBatchBlockDelayMs,
    normalizePageBlockButtonStyle,
    normalizePageBlockButtonStyles,
    normalizePageButtonStyleSurface,
    normalizeUserCellAddButtonVisibility,
    normalizeUsernameForMatching,
    readCookieValue,
    readScreenNameFromProfilePage,
    readScreenNameFromTweet,
    setButtonState,
    setCurrentNativeButtonStyle,
    setCurrentNativeButtonStyles,
    setCurrentUserCellAddButtonStyle,
    sleep
  };

  Object.assign(namespace, sharedExports);

  if (typeof module !== 'undefined') {
    module.exports = sharedExports;
  }
})();
