(() => {
  const storageApi = globalThis.EasyTweetBlockStorage
    || (typeof module !== 'undefined' && module.exports ? require('./storage.js') : null);
  const FALLBACK_FOLLOWERS_SOURCES = Object.freeze({
    followers: 'followers',
    following: 'following'
  });
  const FALLBACK_DEFAULT_FOLLOWERS_SOURCE = FALLBACK_FOLLOWERS_SOURCES.followers;
  const FALLBACK_DEFAULT_FOLLOWERS_BLOCK_LIMIT = 50;
  const FALLBACK_DEFAULT_FOLLOWERS_SCAN_LIMIT = 100;
  const FALLBACK_MIN_FOLLOWERS_BLOCK_LIMIT = 1;
  const FALLBACK_MAX_FOLLOWERS_BLOCK_LIMIT = 200;
  const FALLBACK_MIN_FOLLOWERS_SCAN_LIMIT = 1;
  const FALLBACK_MAX_FOLLOWERS_SCAN_LIMIT = 500;

  if (!storageApi) {
    throw new Error('Missing Easy TweetBlock storage API.');
  }

  const { callStorageGet, callStorageSet, getExtensionApi } = storageApi;

  const FOLLOWER_SCAN_SESSION_STORAGE_KEY = 'followerScanSession';
  const FOLLOWER_SCAN_SESSION_VERSION = 1;
  const MAX_FOLLOWER_SCAN_QUEUE_SIZE = 500;
  const MAX_FOLLOWER_SCAN_DEDUPE_KEYS = 500;
  const FOLLOWER_SCAN_SESSION_TTL_MS = 10 * 60 * 1000;
  const MAX_FOLLOWER_SCAN_CANDIDATE_ATTEMPTS = 3;
  const USERNAME_PATTERN = /^[A-Za-z0-9_]{1,15}$/;
  const USER_ID_PATTERN = /^\d+$/;
  const FOLLOWER_SCAN_SESSION_STATUSES = new Set([
    'idle',
    'scanning',
    'ready',
    'blocking',
    'completed',
    'error'
  ]);

  function getFollowersSharedApi() {
    return globalThis.EasyTweetBlockFollowers
      || (typeof module !== 'undefined' && module.exports ? require('./followers.js') : null);
  }

  function clampRoundedNumber(value, fallback, minimum, maximum) {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return fallback;
    }

    const roundedValue = Math.round(numericValue);
    return Math.min(maximum, Math.max(minimum, roundedValue));
  }

  function normalizeFollowersBlockLimit(value) {
    const sharedNormalizeFollowersBlockLimit = getFollowersSharedApi()?.normalizeFollowersBlockLimit;

    if (typeof sharedNormalizeFollowersBlockLimit === 'function') {
      return sharedNormalizeFollowersBlockLimit(value);
    }

    return clampRoundedNumber(
      value,
      FALLBACK_DEFAULT_FOLLOWERS_BLOCK_LIMIT,
      FALLBACK_MIN_FOLLOWERS_BLOCK_LIMIT,
      FALLBACK_MAX_FOLLOWERS_BLOCK_LIMIT
    );
  }

  function normalizeFollowersScanLimit(value) {
    const sharedNormalizeFollowersScanLimit = getFollowersSharedApi()?.normalizeFollowersScanLimit;

    if (typeof sharedNormalizeFollowersScanLimit === 'function') {
      return sharedNormalizeFollowersScanLimit(value);
    }

    return clampRoundedNumber(
      value,
      FALLBACK_DEFAULT_FOLLOWERS_SCAN_LIMIT,
      FALLBACK_MIN_FOLLOWERS_SCAN_LIMIT,
      FALLBACK_MAX_FOLLOWERS_SCAN_LIMIT
    );
  }

  function normalizeFollowersSource(value) {
    const sharedNormalizeFollowersSource = getFollowersSharedApi()?.normalizeFollowersSource;

    if (typeof sharedNormalizeFollowersSource === 'function') {
      return sharedNormalizeFollowersSource(value);
    }

    return value === FALLBACK_FOLLOWERS_SOURCES.following
      ? FALLBACK_FOLLOWERS_SOURCES.following
      : FALLBACK_DEFAULT_FOLLOWERS_SOURCE;
  }

  function normalizeUsernameForMatching(value) {
    if (typeof value !== 'string') {
      return null;
    }

    const normalizedValue = value.trim().replace(/^[@/]+/, '').toLowerCase();
    return normalizedValue && USERNAME_PATTERN.test(normalizedValue) ? normalizedValue : null;
  }

  function normalizeRestId(value) {
    if (typeof value !== 'string' && typeof value !== 'number') {
      return null;
    }

    const normalizedValue = String(value).trim();
    return USER_ID_PATTERN.test(normalizedValue) ? normalizedValue : null;
  }

  function normalizeNonNegativeInteger(value, fallback = 0) {
    const normalizedValue = Math.round(Number(value));

    if (!Number.isFinite(normalizedValue) || normalizedValue < 0) {
      return fallback;
    }

    return normalizedValue;
  }

  function normalizeTimestamp(value) {
    const normalizedValue = Math.round(Number(value));

    if (!Number.isFinite(normalizedValue) || normalizedValue <= 0) {
      return 0;
    }

    return normalizedValue;
  }

  function normalizeOptionalString(value) {
    if (value == null) {
      return null;
    }

    const normalizedValue = String(value).trim();
    return normalizedValue || null;
  }

  function normalizeSessionStatus(value) {
    return FOLLOWER_SCAN_SESSION_STATUSES.has(value)
      ? value
      : 'idle';
  }

  function capQueue(values, maximum) {
    return values.length > maximum
      ? values.slice(0, maximum)
      : values;
  }

  function normalizeIdentityKeyListAll(keys) {
    const normalizedKeys = [];
    const seenKeys = new Set();

    if (!Array.isArray(keys)) {
      return normalizedKeys;
    }

    for (const key of keys) {
      if (typeof key !== 'string') {
        continue;
      }

      const normalizedKey = key.trim();

      if (!normalizedKey || seenKeys.has(normalizedKey)) {
        continue;
      }

      seenKeys.add(normalizedKey);
      normalizedKeys.push(normalizedKey);
    }

    return normalizedKeys;
  }

  function normalizeIdentityKeyList(keys, maximum = MAX_FOLLOWER_SCAN_DEDUPE_KEYS) {
    const normalizedKeys = normalizeIdentityKeyListAll(keys);

    return normalizedKeys.length > maximum
      ? normalizedKeys.slice(normalizedKeys.length - maximum)
      : normalizedKeys;
  }

  function normalizeFollowerScanPendingUser(user) {
    if (!user || typeof user !== 'object') {
      return null;
    }

    const restId = normalizeRestId(user.restId || user.userId || user.id);
    const username = normalizeUsernameForMatching(user.username || user.screenName || '');

    if (!restId && !username) {
      return null;
    }

    return {
      restId,
      username,
      blocking: user.blocking === true
    };
  }

  function normalizeFollowerScanPendingUsers(users) {
    if (!Array.isArray(users)) {
      return [];
    }

    const normalizedUsers = [];

    for (const user of users) {
      const normalizedUser = normalizeFollowerScanPendingUser(user);

      if (normalizedUser) {
        normalizedUsers.push(normalizedUser);
      }
    }

    return capQueue(normalizedUsers, MAX_FOLLOWER_SCAN_QUEUE_SIZE);
  }

  function getFollowerScanCandidateIdentityKeys(candidate) {
    if (!candidate || typeof candidate !== 'object') {
      return [];
    }

    const restId = normalizeRestId(candidate.restId || candidate.userId || candidate.id);
    const username = normalizeUsernameForMatching(candidate.username || candidate.screenName || '');
    const identityKeys = [];

    if (restId) {
      identityKeys.push(`id:${restId}`);
    }

    if (username) {
      identityKeys.push(`username:${username}`);
    }

    return identityKeys;
  }

  function getFollowerScanCandidatePrimaryKey(candidate) {
    return getFollowerScanCandidateIdentityKeys(candidate)[0] || null;
  }

  function normalizeFollowerScanReadyCandidates(candidates) {
    const normalizedCandidates = [];
    const seenKeys = new Set();
    let droppedForAttempts = 0;

    if (!Array.isArray(candidates)) {
      return {
        candidates: normalizedCandidates,
        droppedForAttempts
      };
    }

    for (const candidate of candidates) {
      const normalizedPendingUser = normalizeFollowerScanPendingUser(candidate);

      if (!normalizedPendingUser) {
        continue;
      }

      const attempts = normalizeNonNegativeInteger(candidate?.attempts);

      if (attempts >= MAX_FOLLOWER_SCAN_CANDIDATE_ATTEMPTS) {
        droppedForAttempts += 1;
        continue;
      }

      const identityKeys = getFollowerScanCandidateIdentityKeys(normalizedPendingUser);

      if (!identityKeys.length || identityKeys.some((identityKey) => seenKeys.has(identityKey))) {
        continue;
      }

      for (const identityKey of identityKeys) {
        seenKeys.add(identityKey);
      }

      normalizedCandidates.push({
        restId: normalizedPendingUser.restId,
        username: normalizedPendingUser.username,
        attempts,
        lastError: normalizeOptionalString(candidate?.lastError)
      });

      if (normalizedCandidates.length >= MAX_FOLLOWER_SCAN_QUEUE_SIZE) {
        break;
      }
    }

    return {
      candidates: normalizedCandidates,
      droppedForAttempts
    };
  }

  function mergeFollowerScanReadyCandidates(existingCandidates, newCandidates) {
    const normalizedExisting = normalizeFollowerScanReadyCandidates(existingCandidates).candidates;
    const normalizedNew = normalizeFollowerScanReadyCandidates(newCandidates).candidates;
    const mergedCandidates = normalizedExisting.slice();
    const seenKeys = new Set();

    for (const candidate of normalizedExisting) {
      for (const identityKey of getFollowerScanCandidateIdentityKeys(candidate)) {
        seenKeys.add(identityKey);
      }
    }

    for (const candidate of normalizedNew) {
      const identityKeys = getFollowerScanCandidateIdentityKeys(candidate);

      if (!identityKeys.length || identityKeys.some((identityKey) => seenKeys.has(identityKey))) {
        continue;
      }

      for (const identityKey of identityKeys) {
        seenKeys.add(identityKey);
      }

      mergedCandidates.push(candidate);

      if (mergedCandidates.length >= MAX_FOLLOWER_SCAN_QUEUE_SIZE) {
        break;
      }
    }

    return mergedCandidates;
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
    const normalizedTargetScreenName = normalizeUsernameForMatching(targetScreenName);
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
    const targetScreenName = normalizeUsernameForMatching(input.targetScreenName);

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
    const targetScreenName = normalizeUsernameForMatching(value.targetScreenName);

    if (!targetRestId && !targetScreenName) {
      return null;
    }

    const normalizedPendingUsers = normalizeFollowerScanPendingUsers(value.pendingUsers);
    const normalizedReadyCandidateResult = normalizeFollowerScanReadyCandidates(value.readyCandidates);
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

    return {
      version: FOLLOWER_SCAN_SESSION_VERSION,
      activeSession: normalizedActiveSession
    };
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
    getFollowerScanCandidateIdentityKeys,
    getFollowerScanCandidatePrimaryKey,
    mergeFollowerScanReadyCandidates,
    normalizeIdentityKeyListAll,
    normalizeIdentityKeyList,
    normalizeFollowerScanSession,
    normalizeFollowerScanSessionStore,
    loadFollowerScanSessionStore,
    saveFollowerScanSessionStore,
    getActiveFollowerScanSession,
    setActiveFollowerScanSession,
    clearActiveFollowerScanSession
  };

  globalThis.EasyTweetBlockFollowerScanSessions = followerScanSessionApi;

  if (typeof module !== 'undefined') {
    module.exports = followerScanSessionApi;
  }
})();
