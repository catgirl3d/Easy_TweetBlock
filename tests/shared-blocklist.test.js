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
