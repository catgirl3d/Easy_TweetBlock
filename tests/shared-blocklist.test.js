const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_BATCH_BLOCK_DELAY_MS,
  MAX_BATCH_BLOCK_DELAY_MS,
  MIN_BATCH_BLOCK_DELAY_MS,
  getStoredBatchBlockDelayMs,
  getStoredUsernames,
  normalizeBatchBlockDelayMs,
  normalizeStoredUsernames,
  normalizeUsername,
  observeStoredUsernames,
  parseUsernameText,
  serializeUsernameText,
  setStoredBatchBlockDelayMs,
  setStoredUsernames
} = require('../src/shared/blocklist.js');

function createExtensionApi(initialStore = {}) {
  const store = { ...initialStore };
  const listeners = new Set();

  return {
    runtime: {
      lastError: null
    },
    storage: {
      local: {
        get(keys, callback) {
          const response = {};

          for (const key of keys) {
            response[key] = store[key];
          }

          callback(response);
        },
        set(payload, callback) {
          const changes = {};

          for (const [key, value] of Object.entries(payload)) {
            changes[key] = {
              oldValue: store[key],
              newValue: value
            };
            store[key] = value;
          }

          for (const listener of listeners) {
            listener(changes, 'local');
          }

          callback();
        }
      },
      onChanged: {
        addListener(listener) {
          listeners.add(listener);
        },
        removeListener(listener) {
          listeners.delete(listener);
        }
      }
    },
    store
  };
}

function createPromiseExtensionApi(initialStore = {}) {
  const store = { ...initialStore };
  const listeners = new Set();

  return {
    runtime: {
      lastError: null
    },
    storage: {
      local: {
        get(keys) {
          const response = {};

          for (const key of keys) {
            response[key] = store[key];
          }

          return Promise.resolve(response);
        },
        set(payload) {
          const changes = {};

          for (const [key, value] of Object.entries(payload)) {
            changes[key] = {
              oldValue: store[key],
              newValue: value
            };
            store[key] = value;
          }

          for (const listener of listeners) {
            listener(changes, 'local');
          }

          return Promise.resolve();
        }
      },
      onChanged: {
        addListener(listener) {
          listeners.add(listener);
        },
        removeListener(listener) {
          listeners.delete(listener);
        }
      }
    },
    store
  };
}

test('normalizeUsername lowercases handles and validates username shape', () => {
  assert.equal(normalizeUsername('@Felixmfdo'), 'felixmfdo');
  assert.equal(normalizeUsername('/Felixmfdo'), 'felixmfdo');
  assert.equal(normalizeUsername('bad-name'), null);
  assert.equal(normalizeUsername(''), null);
});

test('parseUsernameText deduplicates usernames and reports invalid entries', () => {
  const { usernames, invalidEntries } = parseUsernameText('@Felixmfdo\nspam_account\ninvalid-name\nFelixmfdo');

  assert.deepEqual(usernames, ['felixmfdo', 'spam_account']);
  assert.deepEqual(invalidEntries, ['invalid-name']);
});

test('normalizeStoredUsernames cleans invalid and duplicate stored values', () => {
  assert.deepEqual(normalizeStoredUsernames(['Felixmfdo', '@felixmfdo', 'ok_name', 'bad-name']), ['felixmfdo', 'ok_name']);
});

test('serializeUsernameText formats usernames one per line with @ prefix', () => {
  assert.equal(serializeUsernameText(['felixmfdo', 'spam_account']), '@felixmfdo\n@spam_account');
});

test('normalizeBatchBlockDelayMs clamps values into the supported range', () => {
  assert.equal(normalizeBatchBlockDelayMs(undefined), DEFAULT_BATCH_BLOCK_DELAY_MS);
  assert.equal(normalizeBatchBlockDelayMs('250'), MIN_BATCH_BLOCK_DELAY_MS);
  assert.equal(normalizeBatchBlockDelayMs('1200'), 1200);
  assert.equal(normalizeBatchBlockDelayMs(2500), MAX_BATCH_BLOCK_DELAY_MS);
});

test('setStoredUsernames and getStoredUsernames round-trip through extension storage', async () => {
  const extensionApi = createExtensionApi();

  const savedUsernames = await setStoredUsernames(['Felixmfdo', 'spam_account', '@Felixmfdo'], extensionApi);
  const loadedUsernames = await getStoredUsernames(extensionApi);

  assert.deepEqual(savedUsernames, ['felixmfdo', 'spam_account']);
  assert.deepEqual(loadedUsernames, ['felixmfdo', 'spam_account']);
});

test('setStoredBatchBlockDelayMs and getStoredBatchBlockDelayMs round-trip through extension storage', async () => {
  const extensionApi = createExtensionApi();

  const savedDelayMs = await setStoredBatchBlockDelayMs(2200, extensionApi);
  const loadedDelayMs = await getStoredBatchBlockDelayMs(extensionApi);

  assert.equal(savedDelayMs, MAX_BATCH_BLOCK_DELAY_MS);
  assert.equal(loadedDelayMs, MAX_BATCH_BLOCK_DELAY_MS);
});

test('stored blocklist helpers also work with promise-based storage APIs', async () => {
  const extensionApi = createPromiseExtensionApi();

  const savedUsernames = await setStoredUsernames(['Felixmfdo', 'spam_account'], extensionApi);
  const loadedUsernames = await getStoredUsernames(extensionApi);
  const savedDelayMs = await setStoredBatchBlockDelayMs(1201, extensionApi);
  const loadedDelayMs = await getStoredBatchBlockDelayMs(extensionApi);

  assert.deepEqual(savedUsernames, ['felixmfdo', 'spam_account']);
  assert.deepEqual(loadedUsernames, ['felixmfdo', 'spam_account']);
  assert.equal(savedDelayMs, 1201);
  assert.equal(loadedDelayMs, 1201);
});

test('getStoredUsernames rejects callback-style storage errors', async () => {
  const extensionApi = {
    runtime: {
      lastError: null
    },
    storage: {
      local: {
        get(_keys, callback) {
          extensionApi.runtime.lastError = { message: 'storage get failed' };
          callback({});
          extensionApi.runtime.lastError = null;
        }
      }
    }
  };

  await assert.rejects(getStoredUsernames(extensionApi), /storage get failed/);
});

test('setStoredBatchBlockDelayMs rejects callback-style storage errors', async () => {
  const extensionApi = {
    runtime: {
      lastError: null
    },
    storage: {
      local: {
        set(_payload, callback) {
          extensionApi.runtime.lastError = { message: 'storage set failed' };
          callback();
          extensionApi.runtime.lastError = null;
        }
      }
    }
  };

  await assert.rejects(setStoredBatchBlockDelayMs(1000, extensionApi), /storage set failed/);
});

test('observeStoredUsernames notifies normalized updates and unsubscribe stops listening', async () => {
  const extensionApi = createPromiseExtensionApi();
  const updates = [];
  const unsubscribe = observeStoredUsernames((usernames) => {
    updates.push(usernames);
  }, extensionApi);

  await setStoredUsernames(['Felixmfdo', '@Felixmfdo', 'spam_account'], extensionApi);
  unsubscribe();
  await setStoredUsernames(['another_user'], extensionApi);

  assert.deepEqual(updates, [['felixmfdo', 'spam_account']]);
});
