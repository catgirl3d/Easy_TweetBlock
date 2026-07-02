(() => {
  const namespace = globalThis.EasyTweetBlockContent || (globalThis.EasyTweetBlockContent = {});

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

  function buildXApiHeaders(documentRef = document, extraHeaders = {}) {
    const csrfToken = namespace.getCsrfToken(documentRef);

    if (!csrfToken) {
      throw new Error('Missing ct0 csrf token cookie.');
    }

    return {
      authorization: X_WEB_BEARER_TOKEN,
      'x-csrf-token': csrfToken,
      'x-twitter-active-user': 'yes',
      'x-twitter-auth-type': 'OAuth2Session',
      'x-twitter-client-language': namespace.getClientLanguage(documentRef),
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
      cache = namespace.getUserRestIdCache()
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
    const screenName = namespace.readScreenNameFromTweet(tweet);

    if (!screenName) {
      throw new Error('Unable to resolve tweet author screen name for API block.');
    }

    return blockUserByScreenNameViaApi(screenName, options);
  }

  async function blockUserByScreenNameViaApi(screenName, options = {}) {
    const normalizedUsername = namespace.normalizeUsernameForMatching(screenName);

    if (!normalizedUsername) {
      throw new Error('Unable to resolve a valid username for API block.');
    }

    const {
      documentRef = document,
      fetchImpl = globalThis.fetch,
      baseOrigin = documentRef?.location?.origin || 'https://x.com',
      queryIds = USER_BY_SCREEN_NAME_QUERY_IDS,
      cache = namespace.getUserRestIdCache()
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
    const normalizedUsernames = Array.from(namespace.createUsernameSet(usernames));
    const normalizedDelayMs = namespace.normalizeBatchBlockDelayMs(options.delayMs);
    const sleepImpl = options.sleepImpl || namespace.sleep;
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

  const apiExports = {
    USER_BY_SCREEN_NAME_FIELD_TOGGLES,
    USER_BY_SCREEN_NAME_FEATURES,
    USER_BY_SCREEN_NAME_QUERY_IDS,
    blockUserByScreenNameViaApi,
    blockUsernamesViaApi,
    buildUserLookupUrls,
    buildXApiHeaders,
    lookupUserRestId,
    parseUserLookupRestId,
    runApiBlockFlow,
    runImmediateBlockInPageContext
  };

  Object.assign(namespace, apiExports);

  if (typeof module !== 'undefined') {
    module.exports = apiExports;
  }
})();
