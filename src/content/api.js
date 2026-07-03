(() => {
  const CONTENT_API_LOG_PREFIX = '[Easy TweetBlock][content-api]';

  function logContentApiInfo(message, details) {
    if (details === undefined) {
      console.info(CONTENT_API_LOG_PREFIX, message);
      return;
    }

    console.info(CONTENT_API_LOG_PREFIX, message, details);
  }

  function logContentApiError(message, error) {
    if (error === undefined) {
      console.error(CONTENT_API_LOG_PREFIX, message);
      return;
    }

    console.error(CONTENT_API_LOG_PREFIX, message, error);
  }

  const followersApi = globalThis.EasyTweetBlockFollowers
    || (typeof module !== 'undefined' && module.exports ? require('../shared/followers.js') : null);

  if (!followersApi) {
    throw new Error('Missing Easy TweetBlock followers shared API.');
  }

  const namespace = globalThis.EasyTweetBlockContent || (globalThis.EasyTweetBlockContent = {});
  const {
    DEFAULT_FOLLOWERS_SOURCE,
    FOLLOWERS_SOURCES,
    DEFAULT_FOLLOWERS_BLOCK_LIMIT,
    DEFAULT_FOLLOWERS_SCAN_LIMIT,
    normalizeFollowersBlockLimit,
    normalizeFollowersScanLimit,
    normalizeFollowersSource
  } = followersApi;

  const X_WEB_BEARER_TOKEN = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
  const USER_ID_PATTERN = /^\d+$/;
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
  const FOLLOWERS_QUERY_IDS = Object.freeze([
    '4yeuNabfz3qFlfncCAy8Yw',
    '_wt2xR9Ozi8ZI7agzWf_bw'
  ]);
  const FOLLOWING_QUERY_IDS = Object.freeze([
    'eNoXdfXv5rU75RBzlmfuPA'
  ]);
  const FOLLOW_TIMELINE_SOURCE_CONFIGS = Object.freeze({
    [FOLLOWERS_SOURCES.followers]: Object.freeze({
      operationName: 'Followers',
      queryIds: FOLLOWERS_QUERY_IDS
    }),
    [FOLLOWERS_SOURCES.following]: Object.freeze({
      operationName: 'Following',
      queryIds: FOLLOWING_QUERY_IDS
    })
  });
  const FOLLOWERS_FEATURES = Object.freeze({
    rweb_video_screen_enabled: false,
    rweb_cashtags_enabled: true,
    profile_label_improvements_pcf_label_in_post_enabled: true,
    responsive_web_profile_redirect_enabled: false,
    rweb_tipjar_consumption_enabled: false,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    premium_content_api_read_enabled: false,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    responsive_web_grok_analyze_button_fetch_trends_enabled: false,
    responsive_web_grok_analyze_post_followups_enabled: true,
    rweb_cashtags_composer_attachment_enabled: true,
    responsive_web_jetfuel_frame: true,
    responsive_web_grok_share_attachment_enabled: true,
    responsive_web_grok_annotations_enabled: true,
    articles_preview_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    rweb_conversational_replies_downvote_enabled: false,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    content_disclosure_indicator_enabled: true,
    content_disclosure_ai_generated_indicator_enabled: true,
    responsive_web_grok_show_grok_translated_post: true,
    responsive_web_grok_analysis_button_from_backend: true,
    post_ctas_fetch_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: false,
    responsive_web_grok_image_annotation_enabled: true,
    responsive_web_grok_imagine_annotation_enabled: true,
    responsive_web_grok_community_note_auto_translation_is_enabled: true,
    responsive_web_enhance_cards_enabled: false
  });
  const FOLLOWERS_PAGE_SIZE = 20;
  const GRAPHQL_DISCOVERY_CACHE_TTL_MS = 5 * 60 * 1000;
  const GRAPHQL_DISCOVERY_OPERATION_WINDOW_SIZE = 700;
  const GRAPHQL_DISCOVERY_SCRIPT_LIMIT = 40;
  const GRAPHQL_QUERY_ID_PATTERN = /^[A-Za-z0-9_-]{10,}$/;
  const X_SCRIPT_HOSTS = new Set([
    'abs.twimg.com',
    'twitter.com',
    'x.com'
  ]);

  function normalizeRestId(value) {
    if (typeof value !== 'string' && typeof value !== 'number') {
      return null;
    }

    const normalizedValue = String(value).trim();
    return USER_ID_PATTERN.test(normalizedValue) ? normalizedValue : null;
  }

  function normalizeGraphqlQueryId(value) {
    if (typeof value !== 'string') {
      return null;
    }

    const normalizedValue = value.trim();
    return GRAPHQL_QUERY_ID_PATTERN.test(normalizedValue) ? normalizedValue : null;
  }

  function normalizeGraphqlQueryIds(queryIds) {
    const normalizedQueryIds = [];
    const seenQueryIds = new Set();

    if (!Array.isArray(queryIds)) {
      return normalizedQueryIds;
    }

    for (const queryId of queryIds) {
      const normalizedQueryId = normalizeGraphqlQueryId(queryId);

      if (!normalizedQueryId || seenQueryIds.has(normalizedQueryId)) {
        continue;
      }

      seenQueryIds.add(normalizedQueryId);
      normalizedQueryIds.push(normalizedQueryId);
    }

    return normalizedQueryIds;
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function isDiscoverableXScriptUrl(url) {
    if (!url || url.protocol !== 'https:') {
      return false;
    }

    const hostname = url.hostname.toLowerCase();

    if (!X_SCRIPT_HOSTS.has(hostname) && !hostname.endsWith('.twimg.com')) {
      return false;
    }

    return url.pathname.endsWith('.js')
      || url.pathname.includes('/client-web/')
      || url.pathname.includes('/responsive-web/');
  }

  function addDiscoverableScriptUrl(urls, rawUrl, baseUrl) {
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
      return;
    }

    let url;

    try {
      url = new URL(rawUrl, baseUrl);
    } catch {
      return;
    }

    if (isDiscoverableXScriptUrl(url)) {
      urls.add(url.toString());
    }
  }

  function collectGraphqlDiscoveryScriptUrls(documentRef = document, baseOrigin = 'https://x.com') {
    const scriptUrls = new Set();
    const baseUrl = documentRef?.baseURI || documentRef?.location?.href || baseOrigin;
    const scriptElements = typeof documentRef?.querySelectorAll === 'function'
      ? Array.from(documentRef.querySelectorAll('script[src], link[href]'))
      : Array.from(documentRef?.scripts || []);

    for (const scriptElement of scriptElements) {
      addDiscoverableScriptUrl(
        scriptUrls,
        scriptElement?.src
          || scriptElement?.href
          || scriptElement?.getAttribute?.('src')
          || scriptElement?.getAttribute?.('href')
          || '',
        baseUrl
      );

      if (scriptUrls.size >= GRAPHQL_DISCOVERY_SCRIPT_LIMIT) {
        return [...scriptUrls];
      }
    }

    const performanceRef = documentRef?.defaultView?.performance || globalThis.performance;

    try {
      const entries = typeof performanceRef?.getEntriesByType === 'function'
        ? performanceRef.getEntriesByType('resource')
        : [];

      for (const entry of entries) {
        if (entry?.initiatorType && entry.initiatorType !== 'script') {
          continue;
        }

        addDiscoverableScriptUrl(scriptUrls, entry?.name || '', baseUrl);

        if (scriptUrls.size >= GRAPHQL_DISCOVERY_SCRIPT_LIMIT) {
          break;
        }
      }
    } catch {
      // Performance entries are only an optimization; DOM script tags are enough when available.
    }

    return [...scriptUrls];
  }

  function addUniqueQueryIds(targetQueryIds, queryIds) {
    const seenQueryIds = new Set(targetQueryIds);

    for (const queryId of queryIds) {
      const normalizedQueryId = normalizeGraphqlQueryId(queryId);

      if (!normalizedQueryId || seenQueryIds.has(normalizedQueryId)) {
        continue;
      }

      seenQueryIds.add(normalizedQueryId);
      targetQueryIds.push(normalizedQueryId);
    }
  }

  function extractGraphqlQueryIdsFromScriptText(scriptText, operationName) {
    if (typeof scriptText !== 'string' || typeof operationName !== 'string' || !operationName) {
      return [];
    }

    const discoveredQueryIds = [];
    const escapedOperationName = escapeRegExp(operationName);
    const operationPatterns = [
      new RegExp(`["']?queryId["']?\\s*:\\s*["']([A-Za-z0-9_-]{10,})["'][^{}]{0,${GRAPHQL_DISCOVERY_OPERATION_WINDOW_SIZE}}["']?operationName["']?\\s*:\\s*["']${escapedOperationName}["']`, 'g'),
      new RegExp(`["']?operationName["']?\\s*:\\s*["']${escapedOperationName}["'][^{}]{0,${GRAPHQL_DISCOVERY_OPERATION_WINDOW_SIZE}}["']?queryId["']?\\s*:\\s*["']([A-Za-z0-9_-]{10,})["']`, 'g')
    ];

    for (const operationPattern of operationPatterns) {
      let queryIdMatch;

      while ((queryIdMatch = operationPattern.exec(scriptText)) !== null) {
        addUniqueQueryIds(discoveredQueryIds, [queryIdMatch[1]]);
      }
    }

    return discoveredQueryIds;
  }

  function getGraphqlQueryIdCache() {
    if (!namespace.contentState) {
      namespace.contentState = {};
    }

    if (!namespace.contentState.graphqlQueryIdCache) {
      namespace.contentState.graphqlQueryIdCache = new Map();
    }

    return namespace.contentState.graphqlQueryIdCache;
  }

  async function discoverGraphqlQueryIds(operationName, options = {}) {
    const {
      documentRef = document,
      fetchImpl = globalThis.fetch,
      baseOrigin = documentRef?.location?.origin || 'https://x.com'
    } = options;
    const cache = getGraphqlQueryIdCache();
    const cacheKey = operationName;
    const cachedEntry = cache.get(cacheKey);
    const now = Date.now();

    if (cachedEntry && now - cachedEntry.createdAt < GRAPHQL_DISCOVERY_CACHE_TTL_MS) {
      return cachedEntry.queryIds;
    }

    const scriptUrls = collectGraphqlDiscoveryScriptUrls(documentRef, baseOrigin);

    if (!scriptUrls.length) {
      logContentApiInfo('No X script assets found for GraphQL query id discovery.', { operationName });
      return [];
    }

    logContentApiInfo('Scanning X script assets for GraphQL query ids.', {
      operationName,
      scriptCount: scriptUrls.length
    });

    for (const scriptUrl of scriptUrls) {
      try {
        const response = await fetchImpl(scriptUrl, {
          credentials: 'omit',
          method: 'GET',
          mode: 'cors'
        });

        if (!response?.ok || typeof response.text !== 'function') {
          continue;
        }

        const discoveredQueryIds = extractGraphqlQueryIdsFromScriptText(await response.text(), operationName);

        if (!discoveredQueryIds.length) {
          continue;
        }

        cache.set(cacheKey, {
          createdAt: now,
          queryIds: discoveredQueryIds
        });
        logContentApiInfo('Discovered GraphQL query ids from X script asset.', {
          operationName,
          queryIds: discoveredQueryIds,
          scriptUrl
        });
        return discoveredQueryIds;
      } catch (error) {
        logContentApiError('Failed to scan X script asset for GraphQL query ids.', {
          error,
          operationName,
          scriptUrl
        });
      }
    }

    logContentApiInfo('GraphQL query id discovery finished without matches.', { operationName });
    return [];
  }

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

  function extractTimelineInstructions(payload, pathSegments) {
    let current = payload;

    for (const segment of pathSegments) {
      if (!current || typeof current !== 'object') {
        return [];
      }

      current = current[segment];
    }

    if (Array.isArray(current?.timeline?.instructions)) {
      return current.timeline.instructions;
    }

    if (Array.isArray(current?.instructions)) {
      return current.instructions;
    }

    return [];
  }

  function extractFollowersEntryUserResults(entry) {
    const userResults = [];
    const directResult = entry?.content?.itemContent?.user_results?.result;

    if (directResult && typeof directResult === 'object') {
      userResults.push(directResult);
    }

    const moduleItems = Array.isArray(entry?.content?.items) ? entry.content.items : [];

    for (const moduleItem of moduleItems) {
      const moduleResult = moduleItem?.item?.itemContent?.user_results?.result;

      if (moduleResult && typeof moduleResult === 'object') {
        userResults.push(moduleResult);
      }
    }

    return userResults;
  }

  function parseFollowersUserResult(userResult) {
    if (!userResult || typeof userResult !== 'object') {
      return null;
    }

    const relationshipPerspectives = userResult.relationship_perspectives || {};
    const username = namespace.normalizeUsernameForMatching(
      userResult?.core?.screen_name || userResult?.legacy?.screen_name || ''
    );
    const restId = normalizeRestId(userResult?.rest_id);

    if (!username && !restId) {
      return null;
    }

    return {
      blockedBy: Boolean(relationshipPerspectives.blocked_by),
      blocking: Boolean(relationshipPerspectives.blocking),
      restId,
      username
    };
  }

  function parseFollowersPage(payload) {
    const instructions = extractTimelineInstructions(payload, ['data', 'user', 'result', 'timeline']);
    const users = [];
    let nextCursor = null;

    for (const instruction of instructions) {
      const entries = Array.isArray(instruction?.entries) ? [...instruction.entries] : [];

      if (instruction?.entry) {
        entries.push(instruction.entry);
      }

      for (const entry of entries) {
        for (const userResult of extractFollowersEntryUserResults(entry)) {
          const parsedUser = parseFollowersUserResult(userResult);

          if (parsedUser) {
            users.push(parsedUser);
          }
        }

        if (entry?.content?.cursorType === 'Bottom' && typeof entry?.content?.value === 'string' && entry.content.value) {
          nextCursor = entry.content.value;
        }
      }
    }

    return {
      hasNext: Boolean(nextCursor),
      nextCursor,
      users
    };
  }

  function getFollowTimelineSourceConfig(source) {
    const normalizedSource = normalizeFollowersSource(source);
    return {
      source: normalizedSource,
      ...FOLLOW_TIMELINE_SOURCE_CONFIGS[normalizedSource]
    };
  }

  function buildFollowersLookupUrls(userId, options = {}) {
    const normalizedUserId = normalizeRestId(userId);

    if (!normalizedUserId) {
      return [];
    }

    const {
      baseOrigin = 'https://x.com',
      count = FOLLOWERS_PAGE_SIZE,
      cursor = '',
      source = DEFAULT_FOLLOWERS_SOURCE
    } = options;
    const sourceConfig = getFollowTimelineSourceConfig(source);
    const queryIds = options.queryIds || sourceConfig.queryIds;
    const variables = {
      userId: normalizedUserId,
      count: Math.min(FOLLOWERS_PAGE_SIZE, Math.max(1, Math.round(Number(count) || FOLLOWERS_PAGE_SIZE))),
      includePromotedContent: false,
      withGrokTranslatedBio: true
    };

    if (cursor) {
      variables.cursor = cursor;
    }

    return normalizeGraphqlQueryIds(queryIds).map((queryId) => {
      const lookupUrl = new URL(`/i/api/graphql/${queryId}/${sourceConfig.operationName}`, baseOrigin);

      lookupUrl.searchParams.set('variables', JSON.stringify(variables));
      lookupUrl.searchParams.set('features', JSON.stringify(FOLLOWERS_FEATURES));

      return lookupUrl.toString();
    });
  }

  async function fetchFollowersPage(userId, options = {}) {
    const normalizedUserId = normalizeRestId(userId);

    if (!normalizedUserId) {
      throw new Error('Missing user ID for followers lookup.');
    }

    const {
      count = FOLLOWERS_PAGE_SIZE,
      cursor = '',
      documentRef = document,
      fetchImpl = globalThis.fetch,
      baseOrigin = documentRef?.location?.origin || 'https://x.com',
      source = DEFAULT_FOLLOWERS_SOURCE
    } = options;
    const sourceConfig = getFollowTimelineSourceConfig(source);
    const queryIds = options.queryIds || sourceConfig.queryIds;
    const lookupHeaders = buildXApiHeaders(documentRef, {
      'content-type': 'application/json'
    });
    const primaryQueryIds = normalizeGraphqlQueryIds(queryIds);
    let lastError = null;

    async function tryFetchFollowersPage(lookupQueryIds, source) {
      const lookupUrls = buildFollowersLookupUrls(normalizedUserId, {
        baseOrigin,
        count,
        cursor,
        queryIds: lookupQueryIds,
        source: sourceConfig.source
      });

      if (!lookupUrls.length) {
        return null;
      }

      logContentApiInfo(`Fetching ${sourceConfig.operationName} page.`, {
        count,
        cursor,
        operationName: sourceConfig.operationName,
        queryIds: lookupQueryIds,
        source,
        userId: normalizedUserId
      });

      for (const lookupUrl of lookupUrls) {
        try {
          const requestHeaders = { ...lookupHeaders };
          const transactionId = typeof namespace.tryGenerateXClientTransactionId === 'function'
            ? await namespace.tryGenerateXClientTransactionId('GET', new URL(lookupUrl).pathname, {
              baseOrigin,
              documentRef,
              fetchImpl
            })
            : null;

          if (transactionId) {
            requestHeaders['x-client-transaction-id'] = transactionId;
          }

          const response = await fetchImpl(lookupUrl, {
            method: 'GET',
            headers: requestHeaders,
            credentials: 'include',
            mode: 'cors'
          });

          if (!response.ok) {
            lastError = new Error(`${sourceConfig.operationName} fetch failed with ${response.status} for ${lookupUrl}`);
            logContentApiError(`${sourceConfig.operationName} request returned a non-ok response.`, {
              source,
              status: response.status,
              url: lookupUrl
            });
            continue;
          }

          const page = parseFollowersPage(await response.json());

          logContentApiInfo(`${sourceConfig.operationName} page fetched successfully.`, {
            hasNext: page.hasNext,
            nextCursor: page.nextCursor,
            operationName: sourceConfig.operationName,
            source,
            userCount: page.users.length,
            userId: normalizedUserId
          });
          return page;
        } catch (error) {
          lastError = error;
          logContentApiError(`${sourceConfig.operationName} request threw an exception.`, {
            error,
            source,
            url: lookupUrl
          });
        }
      }

      return null;
    }

    const primaryPage = await tryFetchFollowersPage(primaryQueryIds, 'known');

    if (primaryPage) {
      return primaryPage;
    }

    const discoveredQueryIds = await discoverGraphqlQueryIds(sourceConfig.operationName, {
      baseOrigin,
      documentRef,
      fetchImpl
    });
    const primaryQueryIdSet = new Set(primaryQueryIds);
    const discoveredOnlyQueryIds = normalizeGraphqlQueryIds(discoveredQueryIds)
      .filter((discoveredQueryId) => !primaryQueryIdSet.has(discoveredQueryId));

    if (discoveredOnlyQueryIds.length) {
      const discoveredPage = await tryFetchFollowersPage(discoveredOnlyQueryIds, 'discovered');

      if (discoveredPage) {
        return discoveredPage;
      }
    } else {
      logContentApiInfo(`No additional discovered ${sourceConfig.operationName} query ids to try.`, {
        discoveredQueryIds,
        operationName: sourceConfig.operationName,
        primaryQueryIds,
        userId: normalizedUserId
      });
    }

    throw lastError || new Error(`Unable to fetch ${sourceConfig.operationName} for user ${normalizedUserId}`);
  }

  function normalizeFollowerBlockCandidate(candidate) {
    if (!candidate || typeof candidate !== 'object') {
      return null;
    }

    const restId = normalizeRestId(candidate.restId || candidate.userId || candidate.id);
    const username = namespace.normalizeUsernameForMatching(candidate.username || candidate.screenName || '');

    if (!restId && !username) {
      return null;
    }

    return {
      restId,
      username
    };
  }

  function createFollowerBlockCandidates(candidates) {
    if (!Array.isArray(candidates)) {
      return [];
    }

    const normalizedCandidates = [];
    const seenKeys = new Set();

    for (const candidate of candidates) {
      const normalizedCandidate = normalizeFollowerBlockCandidate(candidate);

      if (!normalizedCandidate) {
        continue;
      }

      const candidateKey = normalizedCandidate.restId
        ? `id:${normalizedCandidate.restId}`
        : `username:${normalizedCandidate.username}`;

      if (seenKeys.has(candidateKey)) {
        continue;
      }

      seenKeys.add(candidateKey);
      normalizedCandidates.push(normalizedCandidate);
    }

    return normalizedCandidates;
  }

  async function scanFollowersForBlocking(options = {}, runtimeOptions = {}) {
    const {
      documentRef = document,
      fetchImpl = globalThis.fetch,
      baseOrigin = documentRef?.location?.origin || 'https://x.com',
      userLookupQueryIds = USER_BY_SCREEN_NAME_QUERY_IDS
    } = runtimeOptions;
    const sourceConfig = getFollowTimelineSourceConfig(options.source);
    const queryIds = runtimeOptions.queryIds || sourceConfig.queryIds;
    const targetScreenName = namespace.readScreenNameFromProfilePage(documentRef);

    if (!targetScreenName) {
      throw new Error('Open a profile, followers, or following page in the active X tab first.');
    }

    const blockLimit = normalizeFollowersBlockLimit(options.blockLimit);
    const scanLimit = normalizeFollowersScanLimit(options.scanLimit);
    const targetRestId = await lookupUserRestId(targetScreenName, {
      baseOrigin,
      cache: namespace.getUserRestIdCache(),
      documentRef,
      fetchImpl,
      queryIds: userLookupQueryIds
    });
    const candidates = [];
    const seenCandidateKeys = new Set();
    let alreadyBlockedCount = 0;
    let cursor = typeof options.cursor === 'string' ? options.cursor : '';
    let fetchedPageCount = 0;
    let hasMorePages = false;
    let stoppedByBlockLimit = false;
    let stoppedByScanLimit = false;

    while (fetchedPageCount < scanLimit && candidates.length < blockLimit) {
      const page = await fetchFollowersPage(targetRestId, {
        baseOrigin,
        count: FOLLOWERS_PAGE_SIZE,
        cursor,
        documentRef,
        fetchImpl,
        queryIds,
        source: sourceConfig.source
      });
      const users = Array.isArray(page.users) ? page.users : [];

      if (!users.length && !page.hasNext) {
        hasMorePages = false;
        break;
      }

      for (const user of users) {
        if (fetchedPageCount >= scanLimit) {
          stoppedByScanLimit = true;
          hasMorePages = true;
          break;
        }

        fetchedPageCount += 1;

        if (user.blocking) {
          alreadyBlockedCount += 1;
          continue;
        }

        const normalizedCandidate = normalizeFollowerBlockCandidate(user);

        if (!normalizedCandidate) {
          continue;
        }

        const candidateKey = normalizedCandidate.restId
          ? `id:${normalizedCandidate.restId}`
          : `username:${normalizedCandidate.username}`;

        if (seenCandidateKeys.has(candidateKey)) {
          continue;
        }

        seenCandidateKeys.add(candidateKey);
        candidates.push(normalizedCandidate);

        if (candidates.length >= blockLimit) {
          stoppedByBlockLimit = true;
          hasMorePages = true;
          break;
        }
      }

      if (stoppedByBlockLimit || stoppedByScanLimit) {
        break;
      }

      if (!page.hasNext || !page.nextCursor || !users.length) {
        hasMorePages = false;
        break;
      }

      hasMorePages = true;
      cursor = page.nextCursor;
    }

    logContentApiInfo(`${sourceConfig.operationName} preview scan finished.`, {
      alreadyBlockedCount,
      blockLimit,
      candidateCount: candidates.length,
      hasMorePages,
      scanLimit,
      scannedCount: fetchedPageCount,
      source: sourceConfig.source,
      targetRestId,
      targetScreenName
    });

    return {
      alreadyBlockedCount,
      blockLimit,
      candidates,
      hasMorePages,
      readyCount: candidates.length,
      scanLimit,
      scannedCount: fetchedPageCount,
      source: sourceConfig.source,
      stoppedByBlockLimit,
      stoppedByScanLimit,
      targetRestId,
      targetScreenName
    };
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

  async function blockUserByRestIdViaApi(restId, options = {}) {
    const normalizedRestId = normalizeRestId(restId);

    if (!normalizedRestId) {
      throw new Error('Unable to resolve a valid user ID for API block.');
    }

    const {
      documentRef = document,
      fetchImpl = globalThis.fetch,
      baseOrigin = documentRef?.location?.origin || 'https://x.com',
      screenName = null
    } = options;
    const blockResponse = await fetchImpl(new URL('/i/api/1.1/blocks/create.json', baseOrigin).toString(), {
      method: 'POST',
      headers: buildXApiHeaders(documentRef, {
        'content-type': 'application/x-www-form-urlencoded'
      }),
      body: new URLSearchParams({
        user_id: normalizedRestId
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
      restId: normalizedRestId,
      screenName: namespace.normalizeUsernameForMatching(screenName)
    };
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
    return blockUserByRestIdViaApi(restId, {
      baseOrigin,
      documentRef,
      fetchImpl,
      screenName: normalizedUsername
    });
  }

  async function blockFollowerCandidatesViaApi(candidates, options = {}) {
    const normalizedCandidates = createFollowerBlockCandidates(candidates);
    const normalizedDelayMs = namespace.normalizeBatchBlockDelayMs(options.delayMs);
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const sleepImpl = options.sleepImpl || namespace.sleep;
    const results = [];
    let failureCount = 0;
    let successCount = 0;

    function reportProgress(phase, details = {}) {
      if (!onProgress) {
        return;
      }

      try {
        onProgress({
          completed: results.length,
          delayMs: normalizedDelayMs,
          failureCount,
          phase,
          successCount,
          total: normalizedCandidates.length,
          ...details
        });
      } catch (error) {
        logContentApiError('Follower block progress callback failed.', error);
      }
    }

    logContentApiInfo('Starting follower candidate block run.', {
      candidateCount: normalizedCandidates.length,
      delayMs: normalizedDelayMs
    });
    reportProgress('started');

    for (const [index, candidate] of normalizedCandidates.entries()) {
      reportProgress('blocking', {
        candidate,
        currentIndex: index + 1
      });

      try {
        const result = candidate.restId
          ? await blockUserByRestIdViaApi(candidate.restId, {
            ...options,
            screenName: candidate.username
          })
          : await blockUserByScreenNameViaApi(candidate.username, options);

        results.push({
          ok: true,
          restId: result.restId,
          username: result.screenName || candidate.username || ''
        });
        successCount += 1;
        reportProgress('blocked', {
          candidate,
          completed: results.length,
          currentIndex: index + 1
        });
      } catch (error) {
        logContentApiError('Follower candidate block failed.', {
          candidate,
          error
        });
        results.push({
          error: error instanceof Error ? error.message : String(error),
          ok: false,
          restId: candidate.restId || null,
          username: candidate.username || ''
        });
        failureCount += 1;
        reportProgress('failed', {
          candidate,
          completed: results.length,
          currentIndex: index + 1,
          error: error instanceof Error ? error.message : String(error)
        });
      }

      if (index < normalizedCandidates.length - 1) {
        reportProgress('waiting', {
          currentIndex: index + 1,
          nextIndex: index + 2
        });
        await sleepImpl(normalizedDelayMs);
      }
    }

    logContentApiInfo('Follower candidate block run finished.', results);
    reportProgress('finished', {
      completed: results.length
    });

    return results;
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
    DEFAULT_FOLLOWERS_BLOCK_LIMIT,
    DEFAULT_FOLLOWERS_SCAN_LIMIT,
    FOLLOWERS_PAGE_SIZE,
    FOLLOWERS_QUERY_IDS,
    FOLLOWING_QUERY_IDS,
    blockFollowerCandidatesViaApi,
    blockUserByRestIdViaApi,
    USER_BY_SCREEN_NAME_FIELD_TOGGLES,
    USER_BY_SCREEN_NAME_FEATURES,
    USER_BY_SCREEN_NAME_QUERY_IDS,
    blockUserByScreenNameViaApi,
    blockUsernamesViaApi,
    buildFollowersLookupUrls,
    buildUserLookupUrls,
    buildXApiHeaders,
    createFollowerBlockCandidates,
    discoverGraphqlQueryIds,
    extractGraphqlQueryIdsFromScriptText,
    fetchFollowersPage,
    lookupUserRestId,
    normalizeFollowerBlockCandidate,
    parseFollowersPage,
    parseUserLookupRestId,
    runApiBlockFlow,
    runImmediateBlockInPageContext,
    scanFollowersForBlocking
  };

  Object.assign(namespace, apiExports);

  if (typeof module !== 'undefined') {
    module.exports = apiExports;
  }
})();
