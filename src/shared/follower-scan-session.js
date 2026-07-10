(() => {
  const storageApi = globalThis.EasyTweetBlockStorage
    || (typeof module !== 'undefined' && module.exports ? require('./storage.js') : null);
  const followersApi = globalThis.EasyTweetBlockFollowers
    || (typeof module !== 'undefined' && module.exports ? require('./followers.js') : null);
  const usernamesApi = globalThis.EasyTweetBlockUsernames
    || (typeof module !== 'undefined' && module.exports ? require('./usernames.js') : null);
  const identityApi = globalThis.EasyTweetBlockIdentity
    || (typeof module !== 'undefined' && module.exports ? require('./identity.js') : null);
  const followerCandidatesApi = globalThis.EasyTweetBlockFollowerCandidates
    || (typeof module !== 'undefined' && module.exports ? require('./follower-candidates.js') : null);
  const normalizationApi = globalThis.EasyTweetBlockNormalization
    || (typeof module !== 'undefined' && module.exports ? require('./normalization.js') : null);

  if (!storageApi || !followersApi || !usernamesApi || !identityApi || !followerCandidatesApi || !normalizationApi) {
    throw new Error('Missing Easy TweetBlock storage/followers/usernames/identity/follower-candidate API.');
  }

  const { callStorageGet, callStorageSet, getExtensionApi } = storageApi;
  const {
    FOLLOWERS_SOURCES,
    normalizeFollowersBlockLimit,
    normalizeFollowersScanLimit,
    normalizeFollowersSource
  } = followersApi;
  const { normalizeUsername } = usernamesApi;
  const { normalizeRestId } = identityApi;
  const { normalizeNonNegativeInteger, normalizeOptionalString } = normalizationApi;
  const {
    normalizeFollowerPendingUsers: normalizeFollowerScanPendingUsers,
    normalizeFollowerReadyCandidates,
    normalizeIdentityKeyListAll
  } = followerCandidatesApi;

  const FOLLOWER_SCAN_SESSION_STORAGE_KEY = 'followerScanSession';
  const FOLLOWER_SCAN_SESSION_VERSION = 1;
  const MAX_FOLLOWER_SCAN_QUEUE_SIZE = 500;
  const MAX_FOLLOWER_SCAN_DEDUPE_KEYS = 500;
  const FOLLOWER_SCAN_SESSION_TTL_MS = 10 * 60 * 1000;
  const MAX_FOLLOWER_SCAN_CANDIDATE_ATTEMPTS = 3;
  const FOLLOWER_SCAN_SESSION_STATUSES = new Set([
    'idle',
    'scanning',
    'ready',
    'blocking',
    'completed',
    'error'
  ]);

  function normalizeTimestamp(value) {
    return normalizeNonNegativeInteger(value);
  }

  function normalizeSessionStatus(value) {
    return FOLLOWER_SCAN_SESSION_STATUSES.has(value)
      ? value
      : 'idle';
  }

  function normalizeIdentityKeyList(keys, maximum = MAX_FOLLOWER_SCAN_DEDUPE_KEYS) {
    const normalizedKeys = normalizeIdentityKeyListAll(keys);

    return normalizedKeys.length > maximum
      ? normalizedKeys.slice(normalizedKeys.length - maximum)
      : normalizedKeys;
  }

  function normalizeFollowerScanTotals(totals) {
    const sourceTotals = totals && typeof totals === 'object' && !Array.isArray(totals)
      ? totals
      : {};

    return {
      scanned: normalizeNonNegativeInteger(sourceTotals.scanned),
      alreadyBlocked: normalizeNonNegativeInteger(sourceTotals.alreadyBlocked),
      blockedSuccess: normalizeNonNegativeInteger(sourceTotals.blockedSuccess),
      blockedFailed: normalizeNonNegativeInteger(sourceTotals.blockedFailed),
      abandonedFailed: normalizeNonNegativeInteger(sourceTotals.abandonedFailed)
    };
  }

  function createFollowerScanSessionKey({
    targetRestId,
    targetScreenName,
    source,
    blockLimit,
    scanLimit
  } = {}) {
    const normalizedTargetScreenName = normalizeUsername(targetScreenName);
    const normalizedTargetRestId = normalizeRestId(targetRestId);
    const targetKey = normalizedTargetScreenName || normalizedTargetRestId || 'unknown';

    return [
      normalizeFollowersSource(source),
      targetKey,
      normalizeFollowersBlockLimit(blockLimit),
      normalizeFollowersScanLimit(scanLimit)
    ].join(':');
  }

  function createEmptyFollowerScanSession(input = {}) {
    const now = normalizeTimestamp(input.updatedAt || input.startedAt || Date.now()) || Date.now();
    const targetRestId = normalizeRestId(input.targetRestId);
    const targetScreenName = normalizeUsername(input.targetScreenName);

    return {
      version: FOLLOWER_SCAN_SESSION_VERSION,
      key: normalizeOptionalString(input.key) || createFollowerScanSessionKey({
        targetRestId,
        targetScreenName,
        source: input.source,
        blockLimit: input.blockLimit,
        scanLimit: input.scanLimit
      }),
      targetRestId,
      targetScreenName,
      source: normalizeFollowersSource(input.source),
      blockLimit: normalizeFollowersBlockLimit(input.blockLimit),
      scanLimit: normalizeFollowersScanLimit(input.scanLimit),
      status: normalizeSessionStatus(input.status),
      nextCursor: null,
      hasMorePages: true,
      pendingUsers: [],
      readyCandidates: [],
      totals: normalizeFollowerScanTotals(input.totals),
      dedupe: {
        alreadyBlockedKeys: []
      },
      startedAt: now,
      updatedAt: now
    };
  }

  function normalizeFollowerScanSession(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const targetRestId = normalizeRestId(value.targetRestId);
    const targetScreenName = normalizeUsername(value.targetScreenName);

    if (!targetRestId && !targetScreenName) {
      return null;
    }

    const normalizedPendingUsers = normalizeFollowerScanPendingUsers(value.pendingUsers, MAX_FOLLOWER_SCAN_QUEUE_SIZE);
    const normalizedReadyCandidateResult = normalizeFollowerReadyCandidates(value.readyCandidates, {
      maxAttempts: MAX_FOLLOWER_SCAN_CANDIDATE_ATTEMPTS,
      maxCandidates: MAX_FOLLOWER_SCAN_QUEUE_SIZE
    });
    const normalizedTotals = normalizeFollowerScanTotals(value.totals);
    const normalizedNextCursor = normalizeOptionalString(value.nextCursor);
    const normalizedStartedAt = normalizeTimestamp(value.startedAt);
    const normalizedUpdatedAt = normalizeTimestamp(value.updatedAt) || normalizedStartedAt;

    if (normalizedReadyCandidateResult.droppedForAttempts > 0) {
      normalizedTotals.abandonedFailed += normalizedReadyCandidateResult.droppedForAttempts;
    }

    return {
      version: FOLLOWER_SCAN_SESSION_VERSION,
      key: normalizeOptionalString(value.key) || createFollowerScanSessionKey({
        targetRestId,
        targetScreenName,
        source: value.source,
        blockLimit: value.blockLimit,
        scanLimit: value.scanLimit
      }),
      targetRestId,
      targetScreenName,
      source: normalizeFollowersSource(value.source),
      blockLimit: normalizeFollowersBlockLimit(value.blockLimit),
      scanLimit: normalizeFollowersScanLimit(value.scanLimit),
      status: normalizeSessionStatus(value.status),
      nextCursor: normalizedNextCursor,
      hasMorePages: Boolean(value.hasMorePages) || Boolean(normalizedNextCursor),
      pendingUsers: normalizedPendingUsers,
      readyCandidates: normalizedReadyCandidateResult.candidates,
      totals: normalizedTotals,
      dedupe: {
        alreadyBlockedKeys: normalizeIdentityKeyList(value?.dedupe?.alreadyBlockedKeys)
      },
      startedAt: normalizedStartedAt || normalizedUpdatedAt,
      updatedAt: normalizedUpdatedAt
    };
  }

  function normalizeFollowerScanSessionStore(value) {
    const normalizedActiveSession = normalizeFollowerScanSession(value?.activeSession);
    const normalizedSessions = {};
    const storedSessions = value?.sessions;

    if (storedSessions && typeof storedSessions === 'object' && !Array.isArray(storedSessions)) {
      for (const source of Object.values(FOLLOWERS_SOURCES)) {
        const normalizedSession = normalizeFollowerScanSession(storedSessions[source]);

        if (normalizedSession?.source === source) {
          normalizedSessions[source] = normalizedSession;
        }
      }
    }

    const normalizedStore = {
      version: FOLLOWER_SCAN_SESSION_VERSION,
      activeSession: normalizedActiveSession
    };

    if (Object.keys(normalizedSessions).length) {
      normalizedStore.sessions = normalizedSessions;
    }

    return normalizedStore;
  }

  function isFollowerScanSessionExpired(session, now = Date.now()) {
    if (!session) {
      return true;
    }

    const updatedAt = normalizeTimestamp(session.updatedAt);

    if (!updatedAt) {
      return true;
    }

    return updatedAt + FOLLOWER_SCAN_SESSION_TTL_MS < now;
  }

  async function loadFollowerScanSessionStore(extensionApi = getExtensionApi()) {
    const normalizedExtensionApi = getExtensionApi(extensionApi);
    const storageArea = normalizedExtensionApi?.storage?.local;
    const storedValues = await callStorageGet(storageArea, [FOLLOWER_SCAN_SESSION_STORAGE_KEY], normalizedExtensionApi);
    return normalizeFollowerScanSessionStore(storedValues?.[FOLLOWER_SCAN_SESSION_STORAGE_KEY]);
  }

  async function saveFollowerScanSessionStore(store, extensionApi = getExtensionApi()) {
    const normalizedExtensionApi = getExtensionApi(extensionApi);
    const storageArea = normalizedExtensionApi?.storage?.local;
    const normalizedStore = normalizeFollowerScanSessionStore(store);

    await callStorageSet(storageArea, {
      [FOLLOWER_SCAN_SESSION_STORAGE_KEY]: normalizedStore
    }, normalizedExtensionApi);

    return normalizedStore;
  }

  function getActiveFollowerScanSession(store, expectedKey = null) {
    const normalizedStore = normalizeFollowerScanSessionStore(store);
    const normalizedExpectedKey = normalizeOptionalString(expectedKey);
    const activeSession = normalizedStore.activeSession;

    if (!activeSession || isFollowerScanSessionExpired(activeSession)) {
      return null;
    }

    if (normalizedExpectedKey && activeSession.key !== normalizedExpectedKey) {
      return null;
    }

    return activeSession;
  }

  function getFollowerScanSession(store, source, expectedKey = null) {
    const normalizedStore = normalizeFollowerScanSessionStore(store);
    const normalizedSource = normalizeFollowersSource(source);
    const storedSession = normalizedStore.sessions?.[normalizedSource];
    const activeSession = normalizedStore.activeSession?.source === normalizedSource
      ? normalizedStore.activeSession
      : null;
    const session = storedSession || activeSession;
    const normalizedExpectedKey = normalizeOptionalString(expectedKey);

    if (!session || isFollowerScanSessionExpired(session)) {
      return null;
    }

    if (normalizedExpectedKey && session.key !== normalizedExpectedKey) {
      return null;
    }

    return session;
  }

  function setFollowerScanSession(store, source, session) {
    const normalizedStore = normalizeFollowerScanSessionStore(store);
    const normalizedSource = normalizeFollowersSource(source);
    const normalizedSession = normalizeFollowerScanSession(session);
    const sessions = {
      ...(normalizedStore.sessions || {})
    };

    // Migrate a legacy single active session as soon as the source-aware store
    // is updated, so switching sources does not discard it.
    if (normalizedStore.activeSession && !sessions[normalizedStore.activeSession.source]) {
      sessions[normalizedStore.activeSession.source] = normalizedStore.activeSession;
    }

    if (normalizedSession && normalizedSession.source === normalizedSource) {
      sessions[normalizedSource] = normalizedSession;
    } else {
      delete sessions[normalizedSource];
    }

    const nextStore = {
      version: FOLLOWER_SCAN_SESSION_VERSION,
      activeSession: normalizedSession
    };

    if (Object.keys(sessions).length) {
      nextStore.sessions = sessions;
    }

    return nextStore;
  }

  function clearFollowerScanSession(store, source) {
    const normalizedStore = normalizeFollowerScanSessionStore(store);
    const normalizedSource = normalizeFollowersSource(source);
    const sessions = {
      ...(normalizedStore.sessions || {})
    };

    if (normalizedStore.activeSession && !sessions[normalizedStore.activeSession.source]) {
      sessions[normalizedStore.activeSession.source] = normalizedStore.activeSession;
    }

    delete sessions[normalizedSource];

    const nextStore = {
      version: FOLLOWER_SCAN_SESSION_VERSION,
      activeSession: null
    };

    if (Object.keys(sessions).length) {
      nextStore.sessions = sessions;
    }

    return nextStore;
  }

  function setActiveFollowerScanSession(store, session) {
    const normalizedStore = normalizeFollowerScanSessionStore(store);
    return {
      ...normalizedStore,
      activeSession: normalizeFollowerScanSession(session)
    };
  }

  function clearActiveFollowerScanSession(store) {
    const normalizedStore = normalizeFollowerScanSessionStore(store);
    return {
      ...normalizedStore,
      activeSession: null
    };
  }

  const followerScanSessionApi = {
    FOLLOWER_SCAN_SESSION_STORAGE_KEY,
    FOLLOWER_SCAN_SESSION_VERSION,
    MAX_FOLLOWER_SCAN_QUEUE_SIZE,
    MAX_FOLLOWER_SCAN_DEDUPE_KEYS,
    FOLLOWER_SCAN_SESSION_TTL_MS,
    MAX_FOLLOWER_SCAN_CANDIDATE_ATTEMPTS,
    createFollowerScanSessionKey,
    createEmptyFollowerScanSession,
    normalizeIdentityKeyList,
    normalizeFollowerScanSession,
    normalizeFollowerScanSessionStore,
    loadFollowerScanSessionStore,
    saveFollowerScanSessionStore,
    getFollowerScanSession,
    getActiveFollowerScanSession,
    setFollowerScanSession,
    setActiveFollowerScanSession,
    clearFollowerScanSession,
    clearActiveFollowerScanSession
  };

  globalThis.EasyTweetBlockFollowerScanSessions = followerScanSessionApi;

  if (typeof module !== 'undefined') {
    module.exports = followerScanSessionApi;
  }
})();
