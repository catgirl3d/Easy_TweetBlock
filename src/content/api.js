(() => {
  const CONTENT_API_LOG_PREFIX = '[Easy TweetBlock][content-api]';

  if (typeof module !== 'undefined' && module.exports) {
    require('./shared.js');
    require('./features.js');
    require('../shared/follower-scan-session.js');
  }

  const followersApi = globalThis.EasyTweetBlockFollowers
    || (typeof module !== 'undefined' && module.exports ? require('../shared/followers.js') : null);
  const followerScanSessionsApi = globalThis.EasyTweetBlockFollowerScanSessions
    || (typeof module !== 'undefined' && module.exports ? require('../shared/follower-scan-session.js') : null);
  const contentFeaturesApi = globalThis.EasyTweetBlockContentFeatures
    || (typeof module !== 'undefined' && module.exports ? require('./features.js') : null);

  if (!followersApi) {
    throw new Error('Missing Easy TweetBlock followers shared API.');
  }

  if (!contentFeaturesApi) {
    throw new Error('Missing Easy TweetBlock content features API.');
  }

  if (!followerScanSessionsApi) {
    throw new Error('Missing Easy TweetBlock follower scan session API.');
  }

  const namespace = globalThis.EasyTweetBlockContent || (globalThis.EasyTweetBlockContent = {});
  const logContentApiInfo = namespace.makePrefixedLogger(CONTENT_API_LOG_PREFIX, 'info');
  const logContentApiError = namespace.makePrefixedLogger(CONTENT_API_LOG_PREFIX, 'error');
  const {
    clampRoundedNumber,
    DEFAULT_FOLLOWERS_SOURCE,
    FOLLOWERS_SOURCES,
    DEFAULT_FOLLOWERS_BLOCK_LIMIT,
    DEFAULT_FOLLOWERS_SCAN_LIMIT,
    normalizeFollowersBlockLimit,
    normalizeFollowersScanLimit,
    normalizeFollowersSource
  } = followersApi;
  const {
    FOLLOWERS_FEATURES,
    USER_BY_SCREEN_NAME_FEATURES
  } = contentFeaturesApi;
  const {
    getFollowerScanCandidateIdentityKeys,
    normalizeIdentityKeyListAll
  } = followerScanSessionsApi;

  const X_WEB_BEARER_TOKEN = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
  const USER_ID_PATTERN = /^\d+$/;
  const USER_BY_SCREEN_NAME_QUERY_IDS = Object.freeze([
    'IGgvgiOx4QZndDHuD3x9TQ',
    'NimuplG1OB7Fd2btCLdBOw',
    'xc8f1g7BYqr6VTzTbvNlGw',
    'ck5KkZ8t5cOmoLssopN99Q',
    'BQ6xjFU6Mgm-WhEP3OiT9w'
  ]);
  const USER_BY_SCREEN_NAME_FEATURES_PARAM = JSON.stringify(USER_BY_SCREEN_NAME_FEATURES);
  const USER_BY_SCREEN_NAME_FIELD_TOGGLES = Object.freeze({
    withAuxiliaryUserLabels: true
  });
  const USER_BY_SCREEN_NAME_FIELD_TOGGLES_PARAM = JSON.stringify(USER_BY_SCREEN_NAME_FIELD_TOGGLES);
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
  const FOLLOWERS_FEATURES_PARAM = JSON.stringify(FOLLOWERS_FEATURES);
  const FOLLOWERS_PAGE_SIZE = 50;
  const GRAPHQL_DISCOVERY_CACHE_TTL_MS = 5 * 60 * 1000;
  const GRAPHQL_DISCOVERY_OPERATION_WINDOW_SIZE = 700;
  const GRAPHQL_DISCOVERY_SCRIPT_LIMIT = 40;
  const GRAPHQL_QUERY_ID_PATTERN = /^[A-Za-z0-9_-]{10,}$/;
  const X_SCRIPT_HOSTS = new Set([
    'abs.twimg.com',
    'twitter.com',
    'x.com'
  ]);

  function waitForDelay(delayMs, sleepImpl, signal) {
    signal?.throwIfAborted?.();

    if (!signal || typeof signal.addEventListener !== 'function') {
      return sleepImpl(delayMs);
    }

    return new Promise((resolve, reject) => {
      let settled = false;

      function cleanup() {
        signal.removeEventListener('abort', handleAbort);
      }

      function settle(callback, value) {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        callback(value);
      }

      function handleAbort() {
        settle(reject, namespace.createAbortError(signal.reason));
      }

      signal.addEventListener('abort', handleAbort, { once: true });

      Promise.resolve()
        .then(() => sleepImpl(delayMs))
        .then(
          () => settle(resolve),
          (error) => settle(reject, error)
        );

      if (signal.aborted) {
        handleAbort();
      }
    });
  }

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
      baseOrigin = documentRef?.location?.origin || 'https://x.com',
      signal = null
    } = options;
    const cache = getGraphqlQueryIdCache();
    const cacheKey = operationName;
    const cachedEntry = cache.get(cacheKey);
    const now = Date.now();

    signal?.throwIfAborted?.();

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
        signal?.throwIfAborted?.();
        const response = await fetchImpl(scriptUrl, {
          credentials: 'omit',
          method: 'GET',
          mode: 'cors',
          signal
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
        if (namespace.isAbortError(error) || signal?.aborted) {
          throw signal?.reason || error;
        }

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

  async function buildSignedXApiHeaders(method, path, options = {}) {
    const {
      documentRef = document,
      extraHeaders = {},
      fetchImpl = globalThis.fetch,
      baseOrigin = documentRef?.location?.origin || 'https://x.com',
      signal = null
    } = options;
    const requestHeaders = buildXApiHeaders(documentRef, extraHeaders);

    if (typeof namespace.tryGenerateXClientTransactionId !== 'function') {
      signal?.throwIfAborted?.();
      return requestHeaders;
    }

    signal?.throwIfAborted?.();

    const transactionId = await namespace.tryGenerateXClientTransactionId(method, path, {
      baseOrigin,
      documentRef,
      fetchImpl,
      signal
    });

    signal?.throwIfAborted?.();

    if (transactionId) {
      requestHeaders['x-client-transaction-id'] = transactionId;
    }

    return requestHeaders;
  }

  function buildUserLookupUrls(screenName, baseOrigin = 'https://x.com', queryIds = USER_BY_SCREEN_NAME_QUERY_IDS) {
    if (!screenName) {
      return [];
    }

    const variablesParam = JSON.stringify({
      screen_name: screenName,
      withGrokTranslatedBio: false
    });

    return queryIds.map((queryId) => {
      const lookupUrl = new URL(`/i/api/graphql/${queryId}/UserByScreenName`, baseOrigin);

      lookupUrl.searchParams.set('variables', variablesParam);
      lookupUrl.searchParams.set('features', USER_BY_SCREEN_NAME_FEATURES_PARAM);
      lookupUrl.searchParams.set('fieldToggles', USER_BY_SCREEN_NAME_FIELD_TOGGLES_PARAM);

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

  function formatResponseBodySnippet(responseText) {
    const normalizedText = String(responseText || '').replace(/\s+/g, ' ').trim();
    return normalizedText ? normalizedText.slice(0, 200) : 'empty response body';
  }

  async function readJsonResponse(response, contextLabel) {
    const responseStatus = response?.status || 'unknown';

    if (typeof response?.text === 'function') {
      const responseText = await response.text();

      try {
        return JSON.parse(responseText);
      } catch {
        const contentType = response?.headers?.get?.('content-type') || 'unknown';
        throw new Error(`${contextLabel} returned invalid JSON (status ${responseStatus}, content-type ${contentType}): ${formatResponseBodySnippet(responseText)}`);
      }
    }

    if (typeof response?.json === 'function') {
      try {
        return await response.json();
      } catch (error) {
        throw new Error(`${contextLabel} returned invalid JSON (status ${responseStatus}): ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    throw new Error(`${contextLabel} did not expose a readable response body.`);
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
      count: clampRoundedNumber(count, FOLLOWERS_PAGE_SIZE, 1, FOLLOWERS_PAGE_SIZE),
      includePromotedContent: false,
      withGrokTranslatedBio: true
    };

    if (cursor) {
      variables.cursor = cursor;
    }

    const variablesParam = JSON.stringify(variables);

    return normalizeGraphqlQueryIds(queryIds).map((queryId) => {
      const lookupUrl = new URL(`/i/api/graphql/${queryId}/${sourceConfig.operationName}`, baseOrigin);

      lookupUrl.searchParams.set('variables', variablesParam);
      lookupUrl.searchParams.set('features', FOLLOWERS_FEATURES_PARAM);

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
      signal = null,
      source = DEFAULT_FOLLOWERS_SOURCE
    } = options;
    const sourceConfig = getFollowTimelineSourceConfig(source);
    const queryIds = options.queryIds || sourceConfig.queryIds;
    const primaryQueryIds = normalizeGraphqlQueryIds(queryIds);
    let lastError = null;

    async function tryFetchFollowersPage(lookupQueryIds, source) {
      signal?.throwIfAborted?.();

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
          signal?.throwIfAborted?.();
          const requestHeaders = await buildSignedXApiHeaders('GET', new URL(lookupUrl).pathname, {
            baseOrigin,
            documentRef,
            extraHeaders: {
              'content-type': 'application/json'
            },
            fetchImpl,
            signal
          });

          const response = await fetchImpl(lookupUrl, {
            method: 'GET',
            headers: requestHeaders,
            credentials: 'include',
            mode: 'cors',
            signal
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

          const page = parseFollowersPage(await readJsonResponse(response, `${sourceConfig.operationName} response from ${lookupUrl}`));

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
          if (namespace.isAbortError(error) || signal?.aborted) {
            throw signal?.reason || error;
          }

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

    signal?.throwIfAborted?.();

    const discoveredQueryIds = await discoverGraphqlQueryIds(sourceConfig.operationName, {
      baseOrigin,
      documentRef,
      fetchImpl,
      signal
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

  function normalizeResumePendingUser(user) {
    const normalizedCandidate = normalizeFollowerBlockCandidate(user);

    if (!normalizedCandidate) {
      return null;
    }

    return {
      ...normalizedCandidate,
      blocking: user?.blocking === true
    };
  }

  function normalizeResumePendingUsers(users) {
    if (!Array.isArray(users)) {
      return [];
    }

    const normalizedUsers = [];

    for (const user of users) {
      const normalizedUser = normalizeResumePendingUser(user);

      if (normalizedUser) {
        normalizedUsers.push(normalizedUser);
      }
    }

    return normalizedUsers;
  }

  function normalizeResumeCount(value) {
    return Math.max(0, Math.round(Number(value) || 0));
  }

  function normalizeResumeCursor(value) {
    return typeof value === 'string' && value.trim()
      ? value.trim()
      : null;
  }

  function normalizeScanResumeState(resumeState) {
    const normalizedResumeState = resumeState && typeof resumeState === 'object' && !Array.isArray(resumeState)
      ? resumeState
      : null;

    return {
      alreadyBlockedKeys: normalizeIdentityKeyListAll(normalizedResumeState?.alreadyBlockedKeys),
      existingReadyCount: normalizeResumeCount(normalizedResumeState?.existingReadyCount),
      existingReadyKeys: normalizeIdentityKeyListAll(normalizedResumeState?.existingReadyKeys),
      hasExplicitResumeState: Boolean(normalizedResumeState),
      hasMorePages: typeof normalizedResumeState?.hasMorePages === 'boolean'
        ? normalizedResumeState.hasMorePages
        : null,
      nextCursor: normalizeResumeCursor(normalizedResumeState?.nextCursor),
      pendingUsers: normalizeResumePendingUsers(normalizedResumeState?.pendingUsers),
      raw: normalizedResumeState ? { ...normalizedResumeState } : null
    };
  }

  function createScanResumeStateOutput({ nextCursor, pendingUsers, alreadyBlockedKeys, hasMorePages }) {
    return {
      nextCursor: nextCursor || null,
      pendingUsers,
      alreadyBlockedKeys,
      hasMorePages: Boolean(hasMorePages)
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

      const identityKeys = getFollowerScanCandidateIdentityKeys(normalizedCandidate);

      if (identityKeys.some((identityKey) => seenKeys.has(identityKey))) {
        continue;
      }

      for (const identityKey of identityKeys) {
        seenKeys.add(identityKey);
      }

      normalizedCandidates.push(normalizedCandidate);
    }

    return normalizedCandidates;
  }

  async function scanFollowersForBlocking(options = {}, runtimeOptions = {}) {
    const {
      documentRef = document,
      fetchImpl = globalThis.fetch,
      baseOrigin = documentRef?.location?.origin || 'https://x.com',
      signal = null,
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
    const normalizedResumeState = normalizeScanResumeState(options.resumeState);
    signal?.throwIfAborted?.();

    const targetRestId = await lookupUserRestId(targetScreenName, {
      baseOrigin,
      cache: namespace.getUserRestIdCache(),
      documentRef,
      fetchImpl,
      signal,
      queryIds: userLookupQueryIds
    });
    const candidates = [];
    // X can yield one cursor-only transit page before the next batch arrives.
    // Two consecutive empty pages with hasNext=true usually mean the cursor is
    // stuck or throttled, so stop before we loop forever on empty responses.
    const MAX_CONSECUTIVE_EMPTY_PAGES = 2;
    const seenAlreadyBlockedKeys = new Set(normalizedResumeState.alreadyBlockedKeys);
    const seenCandidateKeys = new Set(normalizedResumeState.existingReadyKeys);
    const existingReadyCount = normalizedResumeState.existingReadyCount;
    let alreadyBlockedCount = 0;
    let consecutiveEmptyPageCount = 0;
    let cursor = normalizedResumeState.nextCursor;
    let pendingUsers = normalizedResumeState.pendingUsers.slice();
    let processedUserCount = 0;
    let hasMorePages = pendingUsers.length > 0 || Boolean(cursor) || normalizedResumeState.hasMorePages === true;
    let stoppedByBlockLimit = false;
    let stoppedByScanLimit = false;

    if (existingReadyCount >= blockLimit) {
      return {
        alreadyBlockedCount: 0,
        blockLimit,
        candidates: [],
        hasMorePages,
        readyCount: 0,
        resumeState: normalizedResumeState.raw
          ? { ...normalizedResumeState.raw }
          : createScanResumeStateOutput({
            alreadyBlockedKeys: normalizedResumeState.alreadyBlockedKeys,
            hasMorePages,
            nextCursor: cursor,
            pendingUsers
          }),
        scanLimit,
        scannedCount: 0,
        source: sourceConfig.source,
        stoppedByBlockLimit: false,
        stoppedByScanLimit: false,
        targetRestId,
        targetScreenName
      };
    }

    function consumeUsers(users) {
      for (let index = 0; index < users.length; index += 1) {
        const user = users[index];

        signal?.throwIfAborted?.();

        if (processedUserCount >= scanLimit) {
          stoppedByScanLimit = true;
          return users.slice(index);
        }

        processedUserCount += 1;

        if (user.blocking) {
          const normalizedAlreadyBlockedUser = normalizeFollowerBlockCandidate(user);
          const identityKeys = getFollowerScanCandidateIdentityKeys(normalizedAlreadyBlockedUser);

          if (!identityKeys.some((identityKey) => seenAlreadyBlockedKeys.has(identityKey))) {
            for (const identityKey of identityKeys) {
              seenAlreadyBlockedKeys.add(identityKey);
            }

            if (identityKeys.length) {
              alreadyBlockedCount += 1;
            }
          }

          continue;
        }

        const normalizedCandidate = normalizeFollowerBlockCandidate(user);

        if (!normalizedCandidate) {
          continue;
        }

        const identityKeys = getFollowerScanCandidateIdentityKeys(normalizedCandidate);

        if (!identityKeys.length || identityKeys.some((identityKey) => seenCandidateKeys.has(identityKey))) {
          continue;
        }

        for (const identityKey of identityKeys) {
          seenCandidateKeys.add(identityKey);
        }

        candidates.push(normalizedCandidate);

        if (existingReadyCount + candidates.length >= blockLimit) {
          stoppedByBlockLimit = true;
          return users.slice(index + 1);
        }
      }

      return null;
    }

    while (processedUserCount < scanLimit && existingReadyCount + candidates.length < blockLimit) {
      if (pendingUsers.length) {
        const remainingPendingUsers = consumeUsers(pendingUsers);

        if (remainingPendingUsers) {
          pendingUsers = normalizeResumePendingUsers(remainingPendingUsers);
          hasMorePages = pendingUsers.length > 0 || Boolean(cursor) || normalizedResumeState.hasMorePages === true;
          break;
        }

        pendingUsers = [];
      }

      if (stoppedByBlockLimit || stoppedByScanLimit) {
        hasMorePages = pendingUsers.length > 0 || Boolean(cursor) || normalizedResumeState.hasMorePages === true;
        break;
      }

      if (normalizedResumeState.hasExplicitResumeState && !pendingUsers.length && !cursor && normalizedResumeState.hasMorePages === false) {
        hasMorePages = false;
        break;
      }

      signal?.throwIfAborted?.();

      const page = await fetchFollowersPage(targetRestId, {
        baseOrigin,
        count: FOLLOWERS_PAGE_SIZE,
        cursor: cursor || '',
        documentRef,
        fetchImpl,
        queryIds,
        signal,
        source: sourceConfig.source
      });
      const users = Array.isArray(page.users) ? page.users : [];
      const isEmptyPage = users.length === 0;

      // Phase 1 — empty-page streak guard (pre-harvest).
      // One empty page with a cursor is a valid transit page (X returns
      // cursor-only pages before the next batch). 2+ empties in a row while
      // hasNext stays true = stuck/throttled cursor → stop. Terminal empties
      // (no hasNext) have no users to harvest and fall through to the
      // continuation guard below.
      consecutiveEmptyPageCount = isEmptyPage ? consecutiveEmptyPageCount + 1 : 0;

      if (isEmptyPage && page.hasNext && consecutiveEmptyPageCount >= MAX_CONSECUTIVE_EMPTY_PAGES) {
        logContentApiInfo('Stopped scanning followers: reached maximum consecutive empty pages limit.', {
          consecutiveEmptyPageCount,
          nextCursor: page.nextCursor
        });
        cursor = page.nextCursor || null;
        hasMorePages = Boolean(page.hasNext && page.nextCursor);
        break;
      }

      const remainingPageUsers = consumeUsers(users);

      if (remainingPageUsers) {
        pendingUsers = normalizeResumePendingUsers(remainingPageUsers);
        cursor = page.nextCursor || null;
        hasMorePages = Boolean(page.hasNext && page.nextCursor);
        break;
      }

      pendingUsers = [];

      if (stoppedByBlockLimit || stoppedByScanLimit) {
        cursor = page.nextCursor || null;
        hasMorePages = Boolean(page.hasNext && page.nextCursor);
        break;
      }

      // Phase 2 — continuation guard (post-harvest).
      // Stop at end of stream (!hasNext) or when hasNext is set but no cursor
      // is offered. Also covers terminal empty pages, so no separate guard
      // is needed for them above.
      if (!page.hasNext || !page.nextCursor) {
        cursor = null;
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
      pendingUserCount: pendingUsers.length,
      scanLimit,
      scannedCount: processedUserCount,
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
      resumeState: createScanResumeStateOutput({
        alreadyBlockedKeys: Array.from(seenAlreadyBlockedKeys),
        hasMorePages,
        nextCursor: cursor,
        pendingUsers
      }),
      scanLimit,
      // Keep the public field name for popup/UI compatibility.
      scannedCount: processedUserCount,
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
      cache = namespace.getUserRestIdCache(),
      signal = null
    } = options;
    const cacheKey = normalizedScreenName.toLowerCase();

    signal?.throwIfAborted?.();

    if (cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }

    const lookupUrls = buildUserLookupUrls(normalizedScreenName, baseOrigin, queryIds);
    let lastError = null;

    for (const lookupUrl of lookupUrls) {
      try {
        signal?.throwIfAborted?.();
        const requestHeaders = await buildSignedXApiHeaders('GET', new URL(lookupUrl).pathname, {
          baseOrigin,
          documentRef,
          fetchImpl,
          signal
        });
        const response = await fetchImpl(lookupUrl, {
          method: 'GET',
          headers: requestHeaders,
          credentials: 'include',
          mode: 'cors',
          signal
        });

        if (!response.ok) {
          lastError = new Error(`User lookup failed with ${response.status} for ${lookupUrl}`);
          continue;
        }

        const payload = await readJsonResponse(response, `User lookup response from ${lookupUrl}`);
        const restId = parseUserLookupRestId(payload);

        if (restId) {
          cache.set(cacheKey, restId);
          return restId;
        }

        lastError = new Error(`User lookup response did not include rest_id for @${normalizedScreenName}`);
      } catch (error) {
        if (namespace.isAbortError(error) || signal?.aborted) {
          throw signal?.reason || error;
        }

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

  async function postBlockMutationByRestId(restId, mutationConfig, options = {}) {
    const normalizedRestId = normalizeRestId(restId);

    if (!normalizedRestId) {
      throw new Error(mutationConfig.invalidRestIdErrorMessage);
    }

    const {
      documentRef = document,
      fetchImpl = globalThis.fetch,
      baseOrigin = documentRef?.location?.origin || 'https://x.com',
      signal = null,
      screenName = null
    } = options;
    signal?.throwIfAborted?.();

    const requestHeaders = await buildSignedXApiHeaders('POST', mutationConfig.path, {
      baseOrigin,
      documentRef,
      extraHeaders: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      fetchImpl,
      signal
    });

    const response = await fetchImpl(new URL(mutationConfig.path, baseOrigin).toString(), {
      method: 'POST',
      headers: requestHeaders,
      body: new URLSearchParams({
        user_id: normalizedRestId
      }).toString(),
      credentials: 'include',
      mode: 'cors',
      signal
    });

    if (!response.ok) {
      let responseBody = '';

      try {
        responseBody = await response.text();
      } catch {
        responseBody = '';
      }

      throw new Error(`${mutationConfig.failureLabel} with ${response.status}${responseBody ? `: ${responseBody.slice(0, 200)}` : ''}`);
    }

    let payload = null;

    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    return {
      payload,
      restId: normalizedRestId,
      screenName: namespace.normalizeUsernameForMatching(screenName)
    };
  }

  async function blockUserByRestIdViaApi(restId, options = {}) {
    return postBlockMutationByRestId(restId, {
      failureLabel: 'Block API failed',
      invalidRestIdErrorMessage: 'Unable to resolve a valid user ID for API block.',
      path: '/i/api/1.1/blocks/create.json'
    }, options);
  }

  async function postBlockMutationByScreenName(screenName, mutationConfig, options = {}) {
    const normalizedUsername = namespace.normalizeUsernameForMatching(screenName);

    if (!normalizedUsername) {
      throw new Error(mutationConfig.invalidUsernameErrorMessage);
    }

    const {
      documentRef = document,
      fetchImpl = globalThis.fetch,
      baseOrigin = documentRef?.location?.origin || 'https://x.com',
      queryIds = USER_BY_SCREEN_NAME_QUERY_IDS,
      cache = namespace.getUserRestIdCache(),
      signal = null
    } = options;
    signal?.throwIfAborted?.();

    const restId = await lookupUserRestId(normalizedUsername, {
      cache,
      documentRef,
      fetchImpl,
      baseOrigin,
      queryIds,
      signal
    });
    return mutationConfig.mutateByRestId(restId, {
      baseOrigin,
      documentRef,
      fetchImpl,
      signal,
      screenName: normalizedUsername
    });
  }

  async function blockUserByScreenNameViaApi(screenName, options = {}) {
    return postBlockMutationByScreenName(screenName, {
      invalidUsernameErrorMessage: 'Unable to resolve a valid username for API block.',
      mutateByRestId: blockUserByRestIdViaApi
    }, options);
  }

  async function unblockUserByRestIdViaApi(restId, options = {}) {
    return postBlockMutationByRestId(restId, {
      failureLabel: 'Unblock API failed',
      invalidRestIdErrorMessage: 'Unable to resolve a valid user ID for API unblock.',
      path: '/i/api/1.1/blocks/destroy.json'
    }, options);
  }

  async function unblockUserByScreenNameViaApi(screenName, options = {}) {
    return postBlockMutationByScreenName(screenName, {
      invalidUsernameErrorMessage: 'Unable to resolve a valid username for API unblock.',
      mutateByRestId: unblockUserByRestIdViaApi
    }, options);
  }

  async function blockFollowerCandidatesViaApi(candidates, options = {}) {
    const normalizedCandidates = createFollowerBlockCandidates(candidates);
    const normalizedDelayMs = namespace.normalizeBatchBlockDelayMs(options.delayMs);
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const signal = options.signal || null;
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

    signal?.throwIfAborted?.();

    logContentApiInfo('Starting follower candidate block run.', {
      candidateCount: normalizedCandidates.length,
      delayMs: normalizedDelayMs
    });
    reportProgress('started');

    for (const [index, candidate] of normalizedCandidates.entries()) {
      signal?.throwIfAborted?.();
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
        if (namespace.isAbortError(error) || signal?.aborted) {
          throw signal?.reason || error;
        }

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
        await waitForDelay(normalizedDelayMs, sleepImpl, signal);
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
    unblockUserByRestIdViaApi,
    USER_BY_SCREEN_NAME_FIELD_TOGGLES,
    USER_BY_SCREEN_NAME_FEATURES,
    USER_BY_SCREEN_NAME_QUERY_IDS,
    blockUserByScreenNameViaApi,
    unblockUserByScreenNameViaApi,
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
