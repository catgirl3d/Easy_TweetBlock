(() => {
  const usernamesApi = globalThis.EasyTweetBlockUsernames
    || (typeof module !== 'undefined' && module.exports ? require('./usernames.js') : null);
  const identityApi = globalThis.EasyTweetBlockIdentity
    || (typeof module !== 'undefined' && module.exports ? require('./identity.js') : null);
  const normalizationApi = globalThis.EasyTweetBlockNormalization
    || (typeof module !== 'undefined' && module.exports ? require('./normalization.js') : null);

  if (!usernamesApi || !identityApi || !normalizationApi) {
    throw new Error('Missing Easy TweetBlock follower candidate dependencies.');
  }

  const { normalizeUsername } = usernamesApi;
  const { normalizeRestId } = identityApi;
  const { normalizeNonNegativeInteger, normalizeOptionalString } = normalizationApi;

  function capList(values, maximum = Number.POSITIVE_INFINITY) {
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

  function normalizeFollowerBlockCandidate(candidate) {
    if (!candidate || typeof candidate !== 'object') {
      return null;
    }

    const restId = normalizeRestId(candidate.restId || candidate.userId || candidate.id);
    const username = normalizeUsername(candidate.username || candidate.screenName || '');

    if (!restId && !username) {
      return null;
    }

    return {
      restId,
      username
    };
  }

  function normalizeFollowerPendingUser(user) {
    const normalizedCandidate = normalizeFollowerBlockCandidate(user);

    if (!normalizedCandidate) {
      return null;
    }

    return {
      ...normalizedCandidate,
      blocking: user?.blocking === true
    };
  }

  function normalizeFollowerPendingUsers(users, maximum = Number.POSITIVE_INFINITY) {
    if (!Array.isArray(users)) {
      return [];
    }

    const normalizedUsers = [];

    for (const user of users) {
      const normalizedUser = normalizeFollowerPendingUser(user);

      if (normalizedUser) {
        normalizedUsers.push(normalizedUser);
      }
    }

    return capList(normalizedUsers, maximum);
  }

  function getFollowerCandidateIdentityKeys(candidate) {
    const normalizedCandidate = normalizeFollowerBlockCandidate(candidate);

    if (!normalizedCandidate) {
      return [];
    }

    const identityKeys = [];

    if (normalizedCandidate.restId) {
      identityKeys.push(`id:${normalizedCandidate.restId}`);
    }

    if (normalizedCandidate.username) {
      identityKeys.push(`username:${normalizedCandidate.username}`);
    }

    return identityKeys;
  }

  function getFollowerCandidatePrimaryKey(candidate) {
    return getFollowerCandidateIdentityKeys(candidate)[0] || null;
  }

  function appendUniqueFollowerCandidate(candidates, seenKeys, candidate) {
    const identityKeys = getFollowerCandidateIdentityKeys(candidate);

    if (!identityKeys.length || identityKeys.some((identityKey) => seenKeys.has(identityKey))) {
      return false;
    }

    for (const identityKey of identityKeys) {
      seenKeys.add(identityKey);
    }

    candidates.push(candidate);
    return true;
  }

  function normalizeFollowerReadyCandidates(candidates, {
    maxAttempts = Number.POSITIVE_INFINITY,
    maxCandidates = Number.POSITIVE_INFINITY
  } = {}) {
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
      const normalizedPendingUser = normalizeFollowerPendingUser(candidate);

      if (!normalizedPendingUser) {
        continue;
      }

      const attempts = normalizeNonNegativeInteger(candidate?.attempts);

      if (attempts >= maxAttempts) {
        droppedForAttempts += 1;
        continue;
      }

      const normalizedReadyCandidate = {
        restId: normalizedPendingUser.restId,
        username: normalizedPendingUser.username,
        attempts,
        lastError: normalizeOptionalString(candidate?.lastError)
      };

      if (!appendUniqueFollowerCandidate(normalizedCandidates, seenKeys, normalizedReadyCandidate)) {
        continue;
      }

      if (normalizedCandidates.length >= maxCandidates) {
        break;
      }
    }

    return {
      candidates: normalizedCandidates,
      droppedForAttempts
    };
  }

  function mergeFollowerReadyCandidates(existingCandidates, newCandidates, {
    maxAttempts = Number.POSITIVE_INFINITY,
    maxCandidates = Number.POSITIVE_INFINITY
  } = {}) {
    const normalizedExisting = normalizeFollowerReadyCandidates(existingCandidates, {
      maxAttempts,
      maxCandidates
    }).candidates;

    if (normalizedExisting.length >= maxCandidates) {
      return normalizedExisting;
    }

    const normalizedNew = normalizeFollowerReadyCandidates(newCandidates, {
      maxAttempts,
      maxCandidates
    }).candidates;
    const mergedCandidates = normalizedExisting.slice();
    const seenKeys = new Set();

    for (const candidate of normalizedExisting) {
      for (const identityKey of getFollowerCandidateIdentityKeys(candidate)) {
        seenKeys.add(identityKey);
      }
    }

    for (const candidate of normalizedNew) {
      if (!appendUniqueFollowerCandidate(mergedCandidates, seenKeys, candidate)) {
        continue;
      }

      if (mergedCandidates.length >= maxCandidates) {
        break;
      }
    }

    return mergedCandidates;
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

      appendUniqueFollowerCandidate(normalizedCandidates, seenKeys, normalizedCandidate);
    }

    return normalizedCandidates;
  }

  function stripFollowerCandidates(candidates) {
    if (!Array.isArray(candidates)) {
      return [];
    }

    const normalizedCandidates = [];

    for (const candidate of candidates) {
      const normalizedCandidate = normalizeFollowerBlockCandidate(candidate);

      if (normalizedCandidate) {
        normalizedCandidates.push(normalizedCandidate);
      }
    }

    return normalizedCandidates;
  }

  function doFollowerCandidatesMatch(leftCandidate, rightCandidate) {
    const leftKeys = getFollowerCandidateIdentityKeys(leftCandidate);
    const rightKeys = getFollowerCandidateIdentityKeys(rightCandidate);

    if (!leftKeys.length || !rightKeys.length) {
      return true;
    }

    return leftKeys.some((identityKey) => rightKeys.includes(identityKey));
  }

  const followerCandidatesApi = {
    createFollowerBlockCandidates,
    doFollowerCandidatesMatch,
    getFollowerCandidateIdentityKeys,
    getFollowerCandidatePrimaryKey,
    mergeFollowerReadyCandidates,
    normalizeFollowerBlockCandidate,
    normalizeFollowerPendingUser,
    normalizeFollowerPendingUsers,
    normalizeFollowerReadyCandidates,
    normalizeIdentityKeyListAll,
    stripFollowerCandidates
  };

  globalThis.EasyTweetBlockFollowerCandidates = followerCandidatesApi;

  if (typeof module !== 'undefined') {
    module.exports = followerCandidatesApi;
  }
})();
