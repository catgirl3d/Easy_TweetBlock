const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildFollowerScanExpectedKey,
  computeFollowerScanSessionStatus,
  createContinuationResetFollowerScanSession,
  createEmptyFollowerScanSessionForTarget,
  createFollowerScanResumeState,
  deriveFollowersPreviewFromSession,
  hasRemainingFollowerScanWork,
  updateFollowerScanSessionAfterBlock,
  updateFollowerScanSessionFromPreview
} = require('../src/shared/follower-scan-controller.js');
const {
  createEmptyFollowerScanSession,
  normalizeFollowerScanSession
} = require('../src/shared/follower-scan-session.js');

function createSession(overrides = {}) {
  const session = createEmptyFollowerScanSession({
    blockLimit: 25,
    scanLimit: 80,
    source: 'followers',
    targetRestId: '999',
    targetScreenName: 'targetuser'
  });

  return normalizeFollowerScanSession({
    ...session,
    ...overrides
  });
}

test('createFollowerScanResumeState carries dedupe, ready keys, and continuation fields', () => {
  const session = createSession({
    dedupe: {
      alreadyBlockedKeys: ['id:301', 'username:alreadyblocked']
    },
    hasMorePages: true,
    nextCursor: 'cursor-next',
    pendingUsers: [{ restId: '202', username: 'bob', blocking: false }],
    readyCandidates: [{ restId: '101', username: 'alice', attempts: 0, lastError: null }]
  });

  assert.deepEqual(createFollowerScanResumeState(session), {
    alreadyBlockedKeys: ['id:301', 'username:alreadyblocked'],
    existingReadyCount: 1,
    existingReadyKeys: ['id:101', 'username:alice'],
    hasMorePages: true,
    nextCursor: 'cursor-next',
    pendingUsers: [{ restId: '202', username: 'bob', blocking: false }]
  });
  assert.deepEqual(createFollowerScanResumeState(session, { includeContinuation: false }), {
    alreadyBlockedKeys: ['id:301', 'username:alreadyblocked'],
    existingReadyCount: 1,
    existingReadyKeys: ['id:101', 'username:alice'],
    hasMorePages: true,
    nextCursor: null,
    pendingUsers: []
  });
});

test('updateFollowerScanSessionFromPreview merges preview candidates and totals into the persisted session', () => {
  const baseSession = createSession({
    dedupe: {
      alreadyBlockedKeys: ['id:301']
    },
    hasMorePages: true,
    nextCursor: 'cursor-old',
    pendingUsers: [{ restId: '202', username: 'bob', blocking: false }],
    readyCandidates: [{ restId: '101', username: 'alice', attempts: 0, lastError: null }],
    totals: {
      scanned: 5,
      alreadyBlocked: 1,
      blockedSuccess: 2,
      blockedFailed: 0,
      abandonedFailed: 0
    }
  });
  const nextSession = updateFollowerScanSessionFromPreview(baseSession, {
    alreadyBlockedCount: 1,
    blockLimit: 25,
    candidates: [{ restId: '404', username: 'dave' }],
    resumeState: {
      alreadyBlockedKeys: ['id:301', 'username:carol'],
      hasMorePages: true,
      nextCursor: 'cursor-fresh',
      pendingUsers: [{ restId: '505', username: 'eve', blocking: false }]
    },
    scanLimit: 80,
    scannedCount: 2,
    source: 'followers',
    targetRestId: '999',
    targetScreenName: 'targetuser'
  }, buildFollowerScanExpectedKey('targetuser', 'followers', 25, 80), 'targetuser');

  assert.equal(nextSession.status, 'ready');
  assert.deepEqual(nextSession.readyCandidates, [
    { restId: '101', username: 'alice', attempts: 0, lastError: null },
    { restId: '404', username: 'dave', attempts: 0, lastError: null }
  ]);
  assert.deepEqual(nextSession.pendingUsers, [{ restId: '505', username: 'eve', blocking: false }]);
  assert.deepEqual(nextSession.totals, {
    scanned: 7,
    alreadyBlocked: 2,
    blockedSuccess: 2,
    blockedFailed: 0,
    abandonedFailed: 0
  });
  assert.equal(deriveFollowersPreviewFromSession(nextSession).readyCount, 2);
});

test('createContinuationResetFollowerScanSession preserves the queue while clearing continuation fields', () => {
  const session = createSession({
    hasMorePages: true,
    nextCursor: 'cursor-stale',
    pendingUsers: [{ restId: '202', username: 'bob', blocking: false }],
    readyCandidates: [{ restId: '101', username: 'alice', attempts: 0, lastError: null }],
    status: 'scanning'
  });
  const resetSession = createContinuationResetFollowerScanSession(session);

  assert.equal(resetSession.hasMorePages, true);
  assert.equal(resetSession.nextCursor, null);
  assert.deepEqual(resetSession.pendingUsers, []);
  assert.deepEqual(resetSession.readyCandidates, [{ restId: '101', username: 'alice', attempts: 0, lastError: null }]);
  assert.equal(resetSession.status, 'ready');
  assert.equal(hasRemainingFollowerScanWork(resetSession), true);
  assert.equal(computeFollowerScanSessionStatus(createSession({ hasMorePages: false, pendingUsers: [], readyCandidates: [] })), 'completed');
});

test('updateFollowerScanSessionAfterBlock keeps retryable failures, abandons retry-capped candidates, and counts mismatches', () => {
  const session = createSession({
    hasMorePages: false,
    pendingUsers: [],
    readyCandidates: [
      { restId: '101', username: 'alice', attempts: 0, lastError: null },
      { restId: '202', username: 'bob', attempts: 1, lastError: null },
      { restId: '303', username: 'carol', attempts: 2, lastError: null }
    ],
    totals: {
      scanned: 3,
      alreadyBlocked: 0,
      blockedSuccess: 2,
      blockedFailed: 0,
      abandonedFailed: 1
    }
  });
  const blockUpdate = updateFollowerScanSessionAfterBlock(session, [
    { ok: true, restId: '101', username: 'alice' },
    { error: 'Rate limited', ok: false, restId: '202', username: 'bob' },
    { ok: true, restId: '999', username: 'mallory' }
  ]);

  assert.equal(blockUpdate.successCount, 1);
  assert.equal(blockUpdate.batchFailedCount, 2);
  assert.equal(blockUpdate.mismatchedCount, 1);
  assert.equal(blockUpdate.abandonedCount, 1);
  assert.deepEqual(blockUpdate.session.readyCandidates, [
    { restId: '202', username: 'bob', attempts: 2, lastError: 'Rate limited' }
  ]);
  assert.deepEqual(blockUpdate.session.totals, {
    scanned: 3,
    alreadyBlocked: 0,
    blockedSuccess: 3,
    blockedFailed: 1,
    abandonedFailed: 2
  });
  assert.equal(blockUpdate.session.status, 'ready');
});

test('createEmptyFollowerScanSessionForTarget returns null for an invalid target and a keyed session for a valid target', () => {
  assert.equal(createEmptyFollowerScanSessionForTarget('bad-name', 'followers', 25, 80), null);

  const session = createEmptyFollowerScanSessionForTarget('TargetUser', 'followers', 25, 80);

  assert.equal(session.targetScreenName, 'targetuser');
  assert.equal(session.key, buildFollowerScanExpectedKey('targetuser', 'followers', 25, 80));
});
