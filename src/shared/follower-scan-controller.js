(() => {
  const followersApi = globalThis.EasyTweetBlockFollowers
    || (typeof module !== 'undefined' && module.exports ? require('./followers.js') : null);
  const followerCandidatesApi = globalThis.EasyTweetBlockFollowerCandidates
    || (typeof module !== 'undefined' && module.exports ? require('./follower-candidates.js') : null);
  const followerScanSessionsApi = globalThis.EasyTweetBlockFollowerScanSessions
    || (typeof module !== 'undefined' && module.exports ? require('./follower-scan-session.js') : null);
  const usernamesApi = globalThis.EasyTweetBlockUsernames
    || (typeof module !== 'undefined' && module.exports ? require('./usernames.js') : null);
  const normalizationApi = globalThis.EasyTweetBlockNormalization
    || (typeof module !== 'undefined' && module.exports ? require('./normalization.js') : null);

  if (!followersApi || !followerCandidatesApi || !followerScanSessionsApi || !usernamesApi || !normalizationApi) {
    throw new Error('Missing Easy TweetBlock follower scan controller dependencies.');
  }

  const {
    DEFAULT_FOLLOWERS_SOURCE,
    normalizeFollowersBlockLimit,
    normalizeFollowersScanLimit,
    normalizeFollowersSource
  } = followersApi;
  const {
    doFollowerCandidatesMatch,
    getFollowerCandidateIdentityKeys,
    mergeFollowerReadyCandidates,
    normalizeFollowerPendingUsers,
    normalizeIdentityKeyListAll,
    stripFollowerCandidates
  } = followerCandidatesApi;
  const {
    MAX_FOLLOWER_SCAN_CANDIDATE_ATTEMPTS,
    MAX_FOLLOWER_SCAN_QUEUE_SIZE,
    createEmptyFollowerScanSession,
    createFollowerScanSessionKey
  } = followerScanSessionsApi;
  const { normalizeUsername } = usernamesApi;
  const { normalizeNonNegativeInteger, normalizeOptionalString } = normalizationApi;

  function countRetryableFailedCandidates(candidates) {
    return Array.isArray(candidates)
      ? candidates.filter((candidate) => normalizeNonNegativeInteger(candidate?.attempts) > 0).length
      : 0;
  }

  function getFollowerScanReadyKeys(candidates) {
    const readyKeys = [];
    const seenKeys = new Set();

    for (const candidate of Array.isArray(candidates) ? candidates : []) {
      const identityKeys = getFollowerCandidateIdentityKeys(candidate);

      for (const identityKey of identityKeys) {
        if (seenKeys.has(identityKey)) {
          continue;
        }

        seenKeys.add(identityKey);
        readyKeys.push(identityKey);
      }
    }

    return readyKeys;
  }

  function computeFollowerScanSessionStatus(session) {
    if (!session) {
      return 'idle';
    }

    if (Array.isArray(session.readyCandidates) && session.readyCandidates.length) {
      return 'ready';
    }

    if (!session.pendingUsers?.length && session.hasMorePages === false) {
      return 'completed';
    }

    return 'idle';
  }

  function normalizeFollowerScanSessionForController(session) {
    if (!session) {
      return null;
    }

    if (session.status !== 'scanning' && session.status !== 'blocking') {
      return session;
    }

    return {
      ...session,
      status: computeFollowerScanSessionStatus(session)
    };
  }

  function hasRemainingFollowerScanWork(session) {
    return Boolean(session?.pendingUsers?.length) || session?.hasMorePages === true;
  }

  function deriveFollowersPreviewFromSession(session) {
    if (!session) {
      return null;
    }

    const candidates = stripFollowerCandidates(session.readyCandidates);

    return {
      abandonedFailedCount: normalizeNonNegativeInteger(session?.totals?.abandonedFailed),
      alreadyBlockedCount: normalizeNonNegativeInteger(session?.totals?.alreadyBlocked),
      blockedFailedCount: countRetryableFailedCandidates(session.readyCandidates),
      blockedSuccessCount: normalizeNonNegativeInteger(session?.totals?.blockedSuccess),
      blockLimit: normalizeFollowersBlockLimit(session.blockLimit),
      candidates,
      hasMorePages: Boolean(session.hasMorePages),
      readyCount: candidates.length,
      scanLimit: normalizeFollowersScanLimit(session.scanLimit),
      scannedCount: normalizeNonNegativeInteger(session?.totals?.scanned),
      source: normalizeFollowersSource(session.source),
      targetRestId: session.targetRestId == null ? null : String(session.targetRestId),
      targetScreenName: session.targetScreenName == null ? null : String(session.targetScreenName)
    };
  }

  function normalizeFollowerScanResumeState(resumeState) {
    const normalizedResumeState = resumeState && typeof resumeState === 'object' && !Array.isArray(resumeState)
      ? resumeState
      : null;

    return {
      alreadyBlockedKeys: normalizeIdentityKeyListAll(normalizedResumeState?.alreadyBlockedKeys),
      existingReadyCount: normalizeNonNegativeInteger(normalizedResumeState?.existingReadyCount),
      existingReadyKeys: normalizeIdentityKeyListAll(normalizedResumeState?.existingReadyKeys),
      hasExplicitResumeState: Boolean(normalizedResumeState),
      hasMorePages: typeof normalizedResumeState?.hasMorePages === 'boolean'
        ? normalizedResumeState.hasMorePages
        : null,
      nextCursor: normalizeOptionalString(normalizedResumeState?.nextCursor, { stringOnly: true }),
      pendingUsers: normalizeFollowerPendingUsers(normalizedResumeState?.pendingUsers, MAX_FOLLOWER_SCAN_QUEUE_SIZE),
      raw: normalizedResumeState ? { ...normalizedResumeState } : null
    };
  }

  function createFollowerScanResumeStateOutput({ nextCursor, pendingUsers, alreadyBlockedKeys, hasMorePages }) {
    return {
      nextCursor: normalizeOptionalString(nextCursor, { stringOnly: true }),
      pendingUsers: normalizeFollowerPendingUsers(pendingUsers, MAX_FOLLOWER_SCAN_QUEUE_SIZE),
      alreadyBlockedKeys: normalizeIdentityKeyListAll(alreadyBlockedKeys),
      hasMorePages: Boolean(hasMorePages)
    };
  }

  function createFollowerScanResumeState(session, { includeContinuation = true } = {}) {
    if (!session) {
      return null;
    }

    return {
      alreadyBlockedKeys: Array.isArray(session?.dedupe?.alreadyBlockedKeys)
        ? [...session.dedupe.alreadyBlockedKeys]
        : [],
      existingReadyCount: Array.isArray(session.readyCandidates) ? session.readyCandidates.length : 0,
      existingReadyKeys: getFollowerScanReadyKeys(session.readyCandidates),
      hasMorePages: includeContinuation ? Boolean(session.hasMorePages) : true,
      nextCursor: includeContinuation ? session.nextCursor || null : null,
      pendingUsers: includeContinuation ? [...(session.pendingUsers || [])] : []
    };
  }

  function buildFollowerScanExpectedKey(targetScreenName, source, blockLimit, scanLimit) {
    const normalizedTargetScreenName = normalizeUsername(targetScreenName);

    if (!normalizedTargetScreenName) {
      return null;
    }

    return createFollowerScanSessionKey({
      targetScreenName: normalizedTargetScreenName,
      source,
      blockLimit,
      scanLimit
    });
  }

  function createEmptyFollowerScanSessionForTarget(targetScreenName, source, blockLimit, scanLimit) {
    const expectedKey = buildFollowerScanExpectedKey(targetScreenName, source, blockLimit, scanLimit);

    if (!expectedKey) {
      return null;
    }

    return createEmptyFollowerScanSession({
      blockLimit,
      key: expectedKey,
      scanLimit,
      source,
      targetScreenName
    });
  }

  function updateFollowerScanSessionFromPreview(baseSession, preview, expectedKey, fallbackTargetScreenName) {
    const now = Date.now();
    const nextReadyCandidates = mergeFollowerReadyCandidates(
      baseSession?.readyCandidates,
      preview?.candidates,
      {
        maxAttempts: MAX_FOLLOWER_SCAN_CANDIDATE_ATTEMPTS,
        maxCandidates: MAX_FOLLOWER_SCAN_QUEUE_SIZE
      }
    );
    const nextSession = {
      ...(baseSession || {}),
      blockLimit: normalizeFollowersBlockLimit(preview?.blockLimit ?? baseSession?.blockLimit),
      dedupe: {
        alreadyBlockedKeys: Array.isArray(preview?.resumeState?.alreadyBlockedKeys)
          ? preview.resumeState.alreadyBlockedKeys
          : (baseSession?.dedupe?.alreadyBlockedKeys || [])
      },
      hasMorePages: Boolean(preview?.resumeState?.hasMorePages),
      key: expectedKey,
      nextCursor: preview?.resumeState?.nextCursor || null,
      pendingUsers: Array.isArray(preview?.resumeState?.pendingUsers)
        ? preview.resumeState.pendingUsers
        : [],
      readyCandidates: nextReadyCandidates,
      scanLimit: normalizeFollowersScanLimit(preview?.scanLimit ?? baseSession?.scanLimit),
      source: normalizeFollowersSource(preview?.source ?? baseSession?.source ?? DEFAULT_FOLLOWERS_SOURCE),
      startedAt: baseSession?.startedAt || now,
      targetRestId: preview?.targetRestId || baseSession?.targetRestId || null,
      targetScreenName: preview?.targetScreenName || baseSession?.targetScreenName || fallbackTargetScreenName || null,
      totals: {
        abandonedFailed: normalizeNonNegativeInteger(baseSession?.totals?.abandonedFailed),
        alreadyBlocked: normalizeNonNegativeInteger(baseSession?.totals?.alreadyBlocked) + normalizeNonNegativeInteger(preview?.alreadyBlockedCount),
        blockedFailed: countRetryableFailedCandidates(nextReadyCandidates),
        blockedSuccess: normalizeNonNegativeInteger(baseSession?.totals?.blockedSuccess),
        scanned: normalizeNonNegativeInteger(baseSession?.totals?.scanned) + normalizeNonNegativeInteger(preview?.scannedCount)
      },
      updatedAt: now,
      version: baseSession?.version || 1
    };

    nextSession.status = computeFollowerScanSessionStatus(nextSession);
    return nextSession;
  }

  function createContinuationResetFollowerScanSession(session) {
    if (!session) {
      return null;
    }

    const now = Date.now();
    const resetSession = {
      ...session,
      hasMorePages: true,
      nextCursor: null,
      pendingUsers: [],
      updatedAt: now
    };

    return {
      ...resetSession,
      status: computeFollowerScanSessionStatus(resetSession)
    };
  }

  function updateFollowerScanSessionAfterBlock(session, results) {
    const normalizedResults = Array.isArray(results) ? results : [];
    const readyCandidates = Array.isArray(session?.readyCandidates) ? session.readyCandidates : [];
    const nextReadyCandidates = [];
    let batchFailedCount = 0;
    let mismatchedCount = 0;
    let successCount = 0;
    let abandonedCount = 0;

    for (let index = 0; index < readyCandidates.length; index += 1) {
      const candidate = readyCandidates[index];
      const result = normalizedResults[index];

      if (result && !doFollowerCandidatesMatch(result, candidate)) {
        mismatchedCount += 1;
        batchFailedCount += 1;
        const nextAttempts = normalizeNonNegativeInteger(candidate?.attempts) + 1;

        if (nextAttempts >= MAX_FOLLOWER_SCAN_CANDIDATE_ATTEMPTS) {
          abandonedCount += 1;
          continue;
        }

        nextReadyCandidates.push({
          ...candidate,
          attempts: nextAttempts,
          lastError: 'Block result did not match the queued candidate.'
        });
        continue;
      }

      if (result?.ok) {
        successCount += 1;
        continue;
      }

      batchFailedCount += 1;
      const nextAttempts = normalizeNonNegativeInteger(candidate?.attempts) + 1;

      if (nextAttempts >= MAX_FOLLOWER_SCAN_CANDIDATE_ATTEMPTS) {
        abandonedCount += 1;
        continue;
      }

      nextReadyCandidates.push({
        ...candidate,
        attempts: nextAttempts,
        lastError: typeof result?.error === 'string' && result.error.trim()
          ? result.error.trim()
          : 'Block request failed.'
      });
    }

    const nextSession = {
      ...session,
      readyCandidates: nextReadyCandidates,
      totals: {
        ...session.totals,
        abandonedFailed: normalizeNonNegativeInteger(session?.totals?.abandonedFailed) + abandonedCount,
        blockedFailed: nextReadyCandidates.length,
        blockedSuccess: normalizeNonNegativeInteger(session?.totals?.blockedSuccess) + successCount
      },
      updatedAt: Date.now()
    };

    nextSession.status = computeFollowerScanSessionStatus(nextSession);

    return {
      abandonedCount,
      batchFailedCount,
      failedCount: nextReadyCandidates.length,
      mismatchedCount,
      session: nextSession,
      successCount
    };
  }

  const followerScanControllerApi = {
    buildFollowerScanExpectedKey,
    computeFollowerScanSessionStatus,
    createContinuationResetFollowerScanSession,
    createEmptyFollowerScanSessionForTarget,
    createFollowerScanResumeState,
    createFollowerScanResumeStateOutput,
    deriveFollowersPreviewFromSession,
    hasRemainingFollowerScanWork,
    normalizeFollowerScanResumeState,
    normalizeFollowerScanSessionForController,
    updateFollowerScanSessionAfterBlock,
    updateFollowerScanSessionFromPreview
  };

  globalThis.EasyTweetBlockFollowerScanController = followerScanControllerApi;

  if (typeof module !== 'undefined') {
    module.exports = followerScanControllerApi;
  }
})();
