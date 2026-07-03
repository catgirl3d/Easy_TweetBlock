(() => {
  const namespace = globalThis.EasyTweetBlockContent || (globalThis.EasyTweetBlockContent = {});

  const SELECTORS = Object.freeze({
    tweet: 'article[data-testid="tweet"]',
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
    followerBlockProgress: 'easy-tweetblock:follower-block-progress',
    blockUsernamesViaApi: 'easy-tweetblock:block-usernames-via-api',
    scanFollowersForBlock: 'easy-tweetblock:scan-followers-for-block'
  });
  const BLOCK_BUTTON_ATTRIBUTE = 'data-easy-tweetblock-button';
  const WAIT_INTERVAL_MS = 50;
  const WAIT_TIMEOUT_MS = 2500;
  const DEFAULT_BATCH_BLOCK_DELAY_MS = 1000;
  const MIN_BATCH_BLOCK_DELAY_MS = 500;
  const MAX_BATCH_BLOCK_DELAY_MS = 2000;
  const DEFAULT_PAGE_BLOCK_BUTTON_STYLE = 'icon';
  const PAGE_BLOCK_BUTTON_STYLE_STORAGE_KEY = 'pageBlockButtonStyle';
  const PAGE_BUTTON_STYLES = Object.freeze({
    icon: 'icon',
    text: 'text'
  });
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

  const contentState = namespace.contentState || {
    currentNativeButtonStyle: DEFAULT_PAGE_BLOCK_BUTTON_STYLE,
    userRestIdCache: new Map()
  };

  namespace.contentState = contentState;

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

  function normalizeBatchBlockDelayMs(value) {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return DEFAULT_BATCH_BLOCK_DELAY_MS;
    }

    const roundedValue = Math.round(numericValue);
    return Math.min(MAX_BATCH_BLOCK_DELAY_MS, Math.max(MIN_BATCH_BLOCK_DELAY_MS, roundedValue));
  }

  function normalizePageButtonStyle(value) {
    return value === PAGE_BUTTON_STYLES.text
      ? PAGE_BUTTON_STYLES.text
      : DEFAULT_PAGE_BLOCK_BUTTON_STYLE;
  }

  function getExtensionApi(globalRef = globalThis) {
    if (typeof browser !== 'undefined') {
      return browser;
    }

    if (typeof chrome !== 'undefined') {
      return chrome;
    }

    return globalRef?.browser || globalRef?.chrome || null;
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
      // Fall through to callback mode.
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

  function getCurrentNativeButtonStyle() {
    return contentState.currentNativeButtonStyle;
  }

  function setCurrentNativeButtonStyle(style) {
    contentState.currentNativeButtonStyle = normalizePageButtonStyle(style);
    return contentState.currentNativeButtonStyle;
  }

  function getUserRestIdCache() {
    return contentState.userRestIdCache;
  }

  async function getStoredPageButtonStyle(globalRef = globalThis) {
    const extensionApi = getExtensionApi(globalRef);
    const storageArea = extensionApi?.storage?.local;
    const storedValues = await callStorageGet(storageArea, [PAGE_BLOCK_BUTTON_STYLE_STORAGE_KEY], extensionApi);
    return normalizePageButtonStyle(storedValues?.[PAGE_BLOCK_BUTTON_STYLE_STORAGE_KEY]);
  }

  function sleep(delayMs, setTimeoutImpl = globalThis.setTimeout) {
    return new Promise((resolve) => {
      setTimeoutImpl(resolve, delayMs);
    });
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

  function getButtonLabel(kind, state) {
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

  function getButtonTitle(kind, screenName, state) {
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
    const label = getButtonLabel(kind, state);
    const title = getButtonTitle(kind, screenName, state);
    const displayStyle = kind === BUTTON_KINDS.native
      ? normalizePageButtonStyle(button?.dataset?.displayStyle || contentState.currentNativeButtonStyle)
      : PAGE_BUTTON_STYLES.text;

    button.dataset.state = state;
    button.dataset.displayStyle = displayStyle;
    button.dataset.screenName = screenName || '';
    button.disabled = state === 'running' || state === 'success';

    if (displayStyle === PAGE_BUTTON_STYLES.icon) {
      button.textContent = '';
      button.innerHTML = BLOCK_ICON_SVG;
    } else {
      button.innerHTML = '';
      button.textContent = label;
    }

    button.title = title;
    button.setAttribute('aria-label', title);
  }

  const sharedExports = {
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
    WAIT_INTERVAL_MS,
    WAIT_TIMEOUT_MS,
    createUsernameSet,
    extractScreenNameFromHref,
    getButtonLabel,
    getButtonTitle,
    getClientLanguage,
    getCsrfToken,
    getCurrentNativeButtonStyle,
    getExtensionApi,
    getStoredPageButtonStyle,
    getUserRestIdCache,
    normalizeBatchBlockDelayMs,
    normalizePageButtonStyle,
    normalizeUsernameForMatching,
    readCookieValue,
    readScreenNameFromProfilePage,
    readScreenNameFromTweet,
    setButtonState,
    setCurrentNativeButtonStyle,
    sleep
  };

  Object.assign(namespace, sharedExports);

  if (typeof module !== 'undefined') {
    module.exports = sharedExports;
  }
})();
