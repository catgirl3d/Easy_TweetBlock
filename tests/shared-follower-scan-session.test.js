const assert = require('node:assert/strict');
const test = require('node:test');

const {
  FOLLOWER_SCAN_SESSION_STORAGE_KEY,
  FOLLOWER_SCAN_SESSION_TTL_MS,
  MAX_FOLLOWER_SCAN_CANDIDATE_ATTEMPTS,
  MAX_FOLLOWER_SCAN_DEDUPE_KEYS,
  MAX_FOLLOWER_SCAN_QUEUE_SIZE,
  clearActiveFollowerScanSession,
  createEmptyFollowerScanSession,
  createFollowerScanSessionKey,
  getActiveFollowerScanSession,
  getFollowerScanCandidateIdentityKeys,
  getFollowerScanCandidatePrimaryKey,
  loadFollowerScanSessionStore,
  mergeFollowerScanReadyCandidates,
  normalizeIdentityKeyListAll,
  normalizeFollowerScanSession,
  normalizeFollowerScanSessionStore,
  saveFollowerScanSessionStore,
  setActiveFollowerScanSession
} = require('../src/shared/follower-scan-session.js');

function createPromiseExtensionApi(initialStore = {}) {
  const store = { ...initialStore };

  return {
    runtime: {},
    storage: {
      local: {
        get(keys) {
          const response = {};

          for (const key of keys) {
            if (Object.prototype.hasOwnProperty.call(store, key)) {
              response[key] = store[key];
            }
          }

          return Promise.resolve(response);
        },
        set(payload) {
          Object.assign(store, payload);
          return Promise.resolve();
        }
      }
    },
    store
  };
}

function createSession(overrides = {}) {
  const session = createEmptyFollowerScanSession({
    blockLimit: 50,
    scanLimit: 120,
    source: 'followers',
    targetRestId: '999',
    targetScreenName: 'targetuser'
  });

  return {
    ...session,
    ...overrides
  };
}

test('normalizeFollowerScanSessionStore normalizes invalid persisted values', () => {
  assert.deepEqual(normalizeFollowerScanSessionStore(null), {
    version: 1,
    activeSession: null
  });

  assert.deepEqual(normalizeFollowerScanSessionStore({
    activeSession: {
      source: 'followers'
    }
  }), {
    version: 1,
    activeSession: null
  });
});

test('normalizeFollowerScanSession caps pending users and ready candidates at 500', () => {
  const pendingUsers = Array.from({ length: MAX_FOLLOWER_SCAN_QUEUE_SIZE + 20 }, (_, index) => ({
    id: String(index + 1),
    screenName: `pending_${index}`,
    blocking: index % 2 === 0
  }));
  const readyCandidates = Array.from({ length: MAX_FOLLOWER_SCAN_QUEUE_SIZE + 20 }, (_, index) => ({
    restId: String(index + 1),
    username: `ready_${index}`,
    attempts: 0
  }));
  const normalizedSession = normalizeFollowerScanSession(createSession({
    pendingUsers,
    readyCandidates
  }));

  assert.equal(normalizedSession.pendingUsers.length, MAX_FOLLOWER_SCAN_QUEUE_SIZE);
  assert.equal(normalizedSession.readyCandidates.length, MAX_FOLLOWER_SCAN_QUEUE_SIZE);
  assert.deepEqual(normalizedSession.pendingUsers.at(-1), {
    restId: '500',
    username: 'pending_499',
    blocking: false
  });
  assert.deepEqual(normalizedSession.readyCandidates.at(-1), {
    restId: '500',
    username: 'ready_499',
    attempts: 0,
    lastError: null
  });
});

test('normalizeFollowerScanSession prunes dedupe keys to the newest 500 entries', () => {
  const dedupeKeys = Array.from({ length: MAX_FOLLOWER_SCAN_DEDUPE_KEYS + 20 }, (_, index) => `id:${index + 1}`);
  const normalizedSession = normalizeFollowerScanSession(createSession({
    dedupe: {
      alreadyBlockedKeys: dedupeKeys
    }
  }));

  assert.equal(normalizedSession.dedupe.alreadyBlockedKeys.length, MAX_FOLLOWER_SCAN_DEDUPE_KEYS);
  assert.equal(normalizedSession.dedupe.alreadyBlockedKeys[0], 'id:21');
  assert.equal(normalizedSession.dedupe.alreadyBlockedKeys.at(-1), 'id:520');
});

test('normalizeIdentityKeyListAll preserves the full normalized key list', () => {
  const dedupeKeys = Array.from({ length: MAX_FOLLOWER_SCAN_DEDUPE_KEYS + 20 }, (_, index) => ` id:${index + 1} `);
  const normalizedKeys = normalizeIdentityKeyListAll([
    null,
    '',
    'id:1',
    ...dedupeKeys,
    'id:520'
  ]);

  assert.equal(normalizedKeys.length, MAX_FOLLOWER_SCAN_DEDUPE_KEYS + 20);
  assert.equal(normalizedKeys[0], 'id:1');
  assert.equal(normalizedKeys.at(-1), 'id:520');
});

test('normalizeFollowerScanSession drops retry-capped candidates and increments abandoned totals', () => {
  const normalizedSession = normalizeFollowerScanSession(createSession({
    readyCandidates: [
      { restId: '101', username: 'alice', attempts: -2, lastError: '' },
      { restId: '202', username: 'bob', attempts: MAX_FOLLOWER_SCAN_CANDIDATE_ATTEMPTS - 1, lastError: 'rate limit' },
      { restId: '303', username: 'carol', attempts: MAX_FOLLOWER_SCAN_CANDIDATE_ATTEMPTS, lastError: 'hard fail' },
      { restId: '404', username: 'dave', attempts: 99, lastError: 'still failing' }
    ],
    totals: {
      abandonedFailed: 4,
      alreadyBlocked: 8,
      blockedFailed: 2,
      blockedSuccess: 7,
      scanned: 30
    }
  }));

  assert.deepEqual(normalizedSession.readyCandidates, [
    { restId: '101', username: 'alice', attempts: 0, lastError: null },
    { restId: '202', username: 'bob', attempts: 2, lastError: 'rate limit' }
  ]);
  assert.equal(normalizedSession.totals.abandonedFailed, 6);
  assert.equal(normalizedSession.totals.scanned, 30);
  assert.equal(normalizedSession.totals.blockedSuccess, 7);
  assert.equal(normalizedSession.totals.blockedFailed, 2);
  assert.equal(normalizedSession.totals.alreadyBlocked, 8);
});

test('getActiveFollowerScanSession rejects expired sessions', () => {
  const now = Date.now();
  const expiredSession = normalizeFollowerScanSession(createSession({
    startedAt: now - FOLLOWER_SCAN_SESSION_TTL_MS - 10,
    updatedAt: now - FOLLOWER_SCAN_SESSION_TTL_MS - 1
  }));
  const activeSession = normalizeFollowerScanSession(createSession({
    startedAt: now - 100,
    updatedAt: now - 50
  }));

  assert.equal(getActiveFollowerScanSession({ activeSession: expiredSession }), null);
  assert.equal(getActiveFollowerScanSession({ activeSession }, activeSession.key)?.key, activeSession.key);
});

test('createFollowerScanSessionKey is stable for normalized profile and limit inputs', () => {
  assert.equal(
    createFollowerScanSessionKey({
      targetScreenName: '@TargetUser',
      source: 'followers',
      blockLimit: 49.6,
      scanLimit: 120.2
    }),
    createFollowerScanSessionKey({
      targetScreenName: ' targetuser ',
      source: 'unknown',
      blockLimit: 50,
      scanLimit: 120
    })
  );
});

test('normalizeFollowerScanSession preserves aggregates and omits lastBatch fields', () => {
  const normalizedSession = normalizeFollowerScanSession({
    ...createSession(),
    lastBatch: {
      candidateCount: 10
    },
    totals: {
      scanned: 11,
      alreadyBlocked: 4,
      blockedSuccess: 3,
      blockedFailed: 2,
      abandonedFailed: 1
    }
  });

  assert.deepEqual(normalizedSession.totals, {
    scanned: 11,
    alreadyBlocked: 4,
    blockedSuccess: 3,
    blockedFailed: 2,
    abandonedFailed: 1
  });
  assert.equal(Object.hasOwn(normalizedSession, 'lastBatch'), false);
});

test('candidate identity helpers normalize usernames consistently', () => {
  assert.deepEqual(getFollowerScanCandidateIdentityKeys({
    restId: 123,
    username: ' @Alice '
  }), ['id:123', 'username:alice']);
  assert.equal(getFollowerScanCandidatePrimaryKey({ username: '/Bob' }), 'username:bob');
});

test('normalizeFollowerScanSession drops malformed user entries', () => {
  const normalizedSession = normalizeFollowerScanSession(createSession({
    pendingUsers: [
      null,
      {},
      { id: '1', screenName: 'alice', blocking: true },
      { id: 'bad-id', screenName: 'bad-name' }
    ],
    readyCandidates: [
      { restId: '2', username: 'bob' },
      { restId: 'bad-id', username: 'bad-name' },
      'skip-me'
    ]
  }));

  assert.deepEqual(normalizedSession.pendingUsers, [{
    restId: '1',
    username: 'alice',
    blocking: true
  }]);
  assert.deepEqual(normalizedSession.readyCandidates, [{
    restId: '2',
    username: 'bob',
    attempts: 0,
    lastError: null
  }]);
});

test('mergeFollowerScanReadyCandidates appends unique candidates after the existing queue', () => {
  const mergedCandidates = mergeFollowerScanReadyCandidates(
    [
      { restId: '1', username: 'alice', attempts: 1, lastError: 'temporary' },
      { restId: '2', username: 'bob', attempts: 0 }
    ],
    [
      { restId: '2', username: 'bob' },
      { restId: '3', username: '@carol' },
      { username: 'alice' }
    ]
  );

  assert.deepEqual(mergedCandidates, [
    { restId: '1', username: 'alice', attempts: 1, lastError: 'temporary' },
    { restId: '2', username: 'bob', attempts: 0, lastError: null },
    { restId: '3', username: 'carol', attempts: 0, lastError: null }
  ]);
});

test('session store helpers load and save the active session through extension storage', async () => {
  const extensionApi = createPromiseExtensionApi();
  const session = createSession();
  const savedStore = await saveFollowerScanSessionStore(setActiveFollowerScanSession({}, session), extensionApi);
  const loadedStore = await loadFollowerScanSessionStore(extensionApi);

  assert.equal(extensionApi.store[FOLLOWER_SCAN_SESSION_STORAGE_KEY].activeSession.key, session.key);
  assert.equal(savedStore.activeSession.key, session.key);
  assert.equal(loadedStore.activeSession.key, session.key);
  assert.deepEqual(clearActiveFollowerScanSession(loadedStore), {
    version: 1,
    activeSession: null
  });
});
