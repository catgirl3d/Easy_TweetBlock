(() => {
  const SELECTORS = Object.freeze({
    tweet: 'article[data-testid="tweet"]',
    caretButton: 'button[data-testid="caret"]',
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
    blockUsernamesViaApi: 'easy-tweetblock:block-usernames-via-api'
  });
  const BLOCK_BUTTON_ATTRIBUTE = 'data-easy-tweetblock-button';
  const STYLE_ELEMENT_ID = 'easy-tweetblock-styles';
  const WAIT_INTERVAL_MS = 50;
  const WAIT_TIMEOUT_MS = 2500;
  const DEFAULT_BATCH_BLOCK_DELAY_MS = 1000;
  const MIN_BATCH_BLOCK_DELAY_MS = 500;
  const MAX_BATCH_BLOCK_DELAY_MS = 2000;
  const USERNAME_PATTERN = /^[A-Za-z0-9_]{1,15}$/;
  const X_WEB_BEARER_TOKEN = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
  const USER_BY_SCREEN_NAME_QUERY_IDS = Object.freeze([
    'IGgvgiOx4QZndDHuD3x9TQ',
    'NimuplG1OB7Fd2btCLdBOw',
    'xc8f1g7BYqr6VTzTbvNlGw',
    'ck5KkZ8t5cOmoLssopN99Q',
    'BQ6xjFU6Mgm-WhEP3OiT9w'
  ]);
  const USER_BY_SCREEN_NAME_FEATURES = Object.freeze({
    hidden_profile_subscriptions_enabled: true,
    payments_enabled: false,
    rweb_xchat_enabled: false,
    profile_label_improvements_pcf_label_in_post_enabled: true,
    rweb_tipjar_consumption_enabled: true,
    verified_phone_label_enabled: false,
    highlights_tweets_tab_ui_enabled: true,
    responsive_web_twitter_article_notes_tab_enabled: true,
    subscriptions_feature_can_gift_premium: true,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    responsive_web_graphql_timeline_navigation_enabled: true,
    subscriptions_verification_info_is_identity_verified_enabled: true,
    subscriptions_verification_info_verified_since_enabled: true
  });
  const USER_BY_SCREEN_NAME_FIELD_TOGGLES = Object.freeze({
    withAuxiliaryUserLabels: true
  });
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
  const userRestIdCache = new Map();

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

  function buildXApiHeaders(documentRef = document, extraHeaders = {}) {
    const csrfToken = getCsrfToken(documentRef);

    if (!csrfToken) {
      throw new Error('Missing ct0 csrf token cookie.');
    }

    return {
      authorization: X_WEB_BEARER_TOKEN,
      'x-csrf-token': csrfToken,
      'x-twitter-active-user': 'yes',
      'x-twitter-auth-type': 'OAuth2Session',
      'x-twitter-client-language': getClientLanguage(documentRef),
      ...extraHeaders
    };
  }

  function buildUserLookupUrls(screenName, baseOrigin = 'https://x.com', queryIds = USER_BY_SCREEN_NAME_QUERY_IDS) {
    if (!screenName) {
      return [];
    }

    return queryIds.map((queryId) => {
      const lookupUrl = new URL(`/i/api/graphql/${queryId}/UserByScreenName`, baseOrigin);

      lookupUrl.searchParams.set('variables', JSON.stringify({
        screen_name: screenName,
        withGrokTranslatedBio: false
      }));
      lookupUrl.searchParams.set('features', JSON.stringify(USER_BY_SCREEN_NAME_FEATURES));
      lookupUrl.searchParams.set('fieldToggles', JSON.stringify(USER_BY_SCREEN_NAME_FIELD_TOGGLES));

      return lookupUrl.toString();
    });
  }

  function parseUserLookupRestId(payload) {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    return payload?.data?.user?.result?.rest_id || payload?.data?.user_result_by_screen_name?.result?.rest_id || null;
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

    button.dataset.state = state;
    button.disabled = state === 'running' || state === 'success';
    button.textContent = label;
    button.title = title;
    button.setAttribute('aria-label', title);
  }

  function installStyles(documentRef) {
    if (!documentRef || documentRef.getElementById(STYLE_ELEMENT_ID)) {
      return;
    }

    const styleElement = documentRef.createElement('style');
    styleElement.id = STYLE_ELEMENT_ID;
    styleElement.textContent = `
      [${BLOCK_BUTTON_ATTRIBUTE}] {
        align-items: center;
        appearance: none;
        background: transparent;
        border-radius: 9999px;
        cursor: pointer;
        display: inline-flex;
        font: 500 12px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        height: 32px;
        justify-content: center;
        margin-inline-end: 8px;
        min-width: 62px;
        padding: 0 10px;
        transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease, opacity 120ms ease;
      }

      [${BLOCK_BUTTON_ATTRIBUTE}][data-kind="native"] {
        border: 1px solid rgba(244, 33, 46, 0.35);
        color: rgb(244, 33, 46);
      }

      [${BLOCK_BUTTON_ATTRIBUTE}][data-kind="api"] {
        border: 1px solid rgba(29, 155, 240, 0.35);
        color: rgb(29, 155, 240);
        min-width: 48px;
      }

      [${BLOCK_BUTTON_ATTRIBUTE}]:hover:not(:disabled) {
        background: rgba(244, 33, 46, 0.12);
      }

      [${BLOCK_BUTTON_ATTRIBUTE}][data-kind="native"]:hover:not(:disabled) {
        border-color: rgba(244, 33, 46, 0.55);
      }

      [${BLOCK_BUTTON_ATTRIBUTE}][data-kind="api"]:hover:not(:disabled) {
        background: rgba(29, 155, 240, 0.12);
        border-color: rgba(29, 155, 240, 0.55);
      }

      [${BLOCK_BUTTON_ATTRIBUTE}][data-state="running"] {
        opacity: 0.72;
      }

      [${BLOCK_BUTTON_ATTRIBUTE}][data-state="success"] {
        border-color: rgba(0, 186, 124, 0.45);
        color: rgb(0, 186, 124);
      }

      [${BLOCK_BUTTON_ATTRIBUTE}][data-state="error"] {
        border-color: rgba(255, 173, 31, 0.45);
        color: rgb(255, 173, 31);
      }
    `;

    documentRef.head.appendChild(styleElement);
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

    // Reuse X's own UI flow so auth, CSRF, and anti-bot state stay in the page session.
    caretButton.click();

    const blockMenuItem = await waitForElement(SELECTORS.blockMenuItem, documentRef);
    blockMenuItem.click();

    const confirmButton = await waitForElement(SELECTORS.blockConfirmButton, documentRef);
    confirmButton.click();
  }

  async function lookupUserRestId(screenName, options = {}) {
    const normalizedScreenName = typeof screenName === 'string' ? screenName.trim().replace(/^@/, '') : '';

    if (!normalizedScreenName) {
      throw new Error('Missing screen name for API block lookup.');
    }

    const {
      documentRef = document,
      fetchImpl = globalThis.fetch,
      baseOrigin = documentRef?.location?.origin || 'https://x.com',
      queryIds = USER_BY_SCREEN_NAME_QUERY_IDS,
      cache = userRestIdCache
    } = options;
    const cacheKey = normalizedScreenName.toLowerCase();

    if (cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }

    const lookupHeaders = buildXApiHeaders(documentRef);
    const lookupUrls = buildUserLookupUrls(normalizedScreenName, baseOrigin, queryIds);
    let lastError = null;

    for (const lookupUrl of lookupUrls) {
      try {
        const response = await fetchImpl(lookupUrl, {
          method: 'GET',
          headers: lookupHeaders,
          credentials: 'include',
          mode: 'cors'
        });

        if (!response.ok) {
          lastError = new Error(`User lookup failed with ${response.status} for ${lookupUrl}`);
          continue;
        }

        const payload = await response.json();
        const restId = parseUserLookupRestId(payload);

        if (restId) {
          cache.set(cacheKey, restId);
          return restId;
        }

        lastError = new Error(`User lookup response did not include rest_id for @${normalizedScreenName}`);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error(`Unable to resolve rest_id for @${normalizedScreenName}`);
  }

  async function runApiBlockFlow(tweet, options = {}) {
    const {
      documentRef = document,
      fetchImpl = globalThis.fetch,
      baseOrigin = documentRef?.location?.origin || 'https://x.com'
    } = options;
    const screenName = readScreenNameFromTweet(tweet);

    if (!screenName) {
      throw new Error('Unable to resolve tweet author screen name for API block.');
    }

    return blockUserByScreenNameViaApi(screenName, options);
  }

  async function blockUserByScreenNameViaApi(screenName, options = {}) {
    const normalizedUsername = normalizeUsernameForMatching(screenName);

    if (!normalizedUsername) {
      throw new Error('Unable to resolve a valid username for API block.');
    }

    const {
      documentRef = document,
      fetchImpl = globalThis.fetch,
      baseOrigin = documentRef?.location?.origin || 'https://x.com',
      queryIds = USER_BY_SCREEN_NAME_QUERY_IDS,
      cache = userRestIdCache
    } = options;
    const restId = await lookupUserRestId(normalizedUsername, {
      cache,
      documentRef,
      fetchImpl,
      baseOrigin,
      queryIds
    });
    const blockResponse = await fetchImpl(new URL('/i/api/1.1/blocks/create.json', baseOrigin).toString(), {
      method: 'POST',
      headers: buildXApiHeaders(documentRef, {
        'content-type': 'application/x-www-form-urlencoded'
      }),
      body: new URLSearchParams({
        user_id: restId
      }).toString(),
      credentials: 'include',
      mode: 'cors'
    });

    if (!blockResponse.ok) {
      let responseBody = '';

      try {
        responseBody = await blockResponse.text();
      } catch {
        responseBody = '';
      }

      throw new Error(`Block API failed with ${blockResponse.status}${responseBody ? `: ${responseBody.slice(0, 200)}` : ''}`);
    }

    let payload = null;

    try {
      payload = await blockResponse.json();
    } catch {
      payload = null;
    }

    return {
      payload,
      restId,
      screenName: normalizedUsername
    };
  }

  async function blockUsernamesViaApi(usernames, options = {}) {
    const normalizedUsernames = Array.from(createUsernameSet(usernames));
    const normalizedDelayMs = normalizeBatchBlockDelayMs(options.delayMs);
    const sleepImpl = options.sleepImpl || sleep;
    const results = [];

    for (const [index, username] of normalizedUsernames.entries()) {
      try {
        const result = await blockUserByScreenNameViaApi(username, options);

        results.push({
          ok: true,
          restId: result.restId,
          username
        });
      } catch (error) {
        results.push({
          error: error instanceof Error ? error.message : String(error),
          ok: false,
          username
        });
      }

      if (index < normalizedUsernames.length - 1) {
        await sleepImpl(normalizedDelayMs);
      }
    }

    return results;
  }

  function runImmediateBlockInPageContext(usernames, delayMs, globalRef = globalThis) {
    return blockUsernamesViaApi(usernames, {
      delayMs,
      documentRef: globalRef.document
    });
  }

  function createActionButton(tweet, kind, action) {
    const button = document.createElement('button');
    const screenName = readScreenNameFromTweet(tweet);

    button.type = 'button';
    button.setAttribute(BLOCK_BUTTON_ATTRIBUTE, 'true');
    button.dataset.kind = kind;
    setButtonState(button, 'idle', screenName, kind);

    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (button.disabled) {
        return;
      }

      setButtonState(button, 'running', screenName, kind);

      try {
        await action();
        setButtonState(button, 'success', screenName, kind);
      } catch (error) {
        console.warn(`Easy TweetBlock failed to complete ${kind} block flow.`, error);
        setButtonState(button, 'error', screenName, kind);
      }
    });

    return button;
  }

  function createNativeBlockButton(tweet, documentRef = document) {
    return createActionButton(tweet, BUTTON_KINDS.native, () => runNativeBlockFlow(tweet, documentRef));
  }

  function createApiBlockButton(tweet, options = {}) {
    return createActionButton(tweet, BUTTON_KINDS.api, () => runApiBlockFlow(tweet, options));
  }

  function attachButtonToTweet(tweet) {
    if (!tweet || tweet.querySelector(`[${BLOCK_BUTTON_ATTRIBUTE}]`)) {
      return;
    }

    const caretButton = tweet.querySelector(SELECTORS.caretButton);

    if (!caretButton?.parentElement) {
      return;
    }

    const nativeButton = createNativeBlockButton(tweet, document);
    const apiButton = createApiBlockButton(tweet, {
      documentRef: document
    });

    caretButton.parentElement.insertBefore(apiButton, caretButton);
    caretButton.parentElement.insertBefore(nativeButton, apiButton);
  }

  function collectTweets(rootNode) {
    if (!rootNode || typeof rootNode.querySelectorAll !== 'function') {
      return [];
    }

    const tweets = [];

    if (typeof rootNode.matches === 'function' && rootNode.matches(SELECTORS.tweet)) {
      tweets.push(rootNode);
    }

    return tweets.concat(Array.from(rootNode.querySelectorAll(SELECTORS.tweet)));
  }

  function processNode(rootNode) {
    for (const tweet of collectTweets(rootNode)) {
      attachButtonToTweet(tweet);
    }
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

      void blockUsernamesViaApi(message.usernames, {
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

    installStyles(globalRef.document);
    registerRuntimeMessageListener(globalRef);
    processNode(globalRef.document);

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

  if (typeof module !== 'undefined') {
    module.exports = {
      BLOCK_BUTTON_ATTRIBUTE,
      BUTTON_KINDS,
      DEFAULT_BATCH_BLOCK_DELAY_MS,
      MAX_BATCH_BLOCK_DELAY_MS,
      MESSAGE_TYPES,
      MIN_BATCH_BLOCK_DELAY_MS,
      RESERVED_PATH_SEGMENTS,
      SELECTORS,
      USER_BY_SCREEN_NAME_FIELD_TOGGLES,
      USER_BY_SCREEN_NAME_FEATURES,
      USER_BY_SCREEN_NAME_QUERY_IDS,
      WAIT_TIMEOUT_MS,
      attachButtonToTweet,
      blockUserByScreenNameViaApi,
      blockUsernamesViaApi,
      buildUserLookupUrls,
      buildXApiHeaders,
      collectTweets,
      createApiBlockButton,
      createUsernameSet,
      createNativeBlockButton,
      extractScreenNameFromHref,
      getClientLanguage,
      getButtonLabel,
      getButtonTitle,
      getCsrfToken,
      init,
      lookupUserRestId,
      normalizeBatchBlockDelayMs,
      normalizeUsernameForMatching,
      parseUserLookupRestId,
      readCookieValue,
      readScreenNameFromTweet,
      registerRuntimeMessageListener,
      runImmediateBlockInPageContext,
      runApiBlockFlow,
      runNativeBlockFlow,
      setButtonState,
      sleep,
      waitForElement
    };
  }

  globalThis.EasyTweetBlockRunImmediateBlock = (usernames, delayMs) => runImmediateBlockInPageContext(usernames, delayMs, globalThis);

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    init(window);
  }
})();
