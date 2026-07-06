const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ACTIVE_USERNAME_LIST_ID_STORAGE_KEY,
  DEFAULT_USER_CELL_ADD_BUTTON_VISIBILITY,
  DEFAULT_BATCH_BLOCK_DELAY_MS,
  DEFAULT_PAGE_BLOCK_BUTTON_STYLE,
  DEFAULT_USERNAME_LIST_ID,
  DEFAULT_USERNAME_LIST_NAME,
  MAX_BATCH_BLOCK_DELAY_MS,
  MIN_BATCH_BLOCK_DELAY_MS,
  PAGE_BLOCK_BUTTON_STYLES,
  USERNAME_LISTS_STORAGE_KEY,
  addUsernameToActiveList,
  createUsernameList,
  getStoredPageBlockButtonStyle,
  getStoredBatchBlockDelayMs,
  getStoredUsernameListState,
  getStoredUserCellAddButtonVisibility,
  getActiveUsernameList,
  getStoredUsernameLists,
  getStoredUsernames,
  isUsernameInActiveList,
  mergeUsernameLists,
  normalizeBatchBlockDelayMs,
  normalizePageBlockButtonStyle,
  normalizeStoredUsernames,
  normalizeUsername,
  normalizeUserCellAddButtonVisibility,
  normalizeUsernameListName,
  normalizeUsernameLists,
  observeActiveUsernameList,
  observeStoredUsernames,
  parseUsernameImport,
  parseUsernameText,
  serializeUsernameText,
  setActiveStoredUsernames,
  setActiveUsernameListId,
  setStoredBatchBlockDelayMs,
  setStoredPageBlockButtonStyle,
  setStoredUserCellAddButtonVisibility,
  setStoredUsernameLists,
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

function flushAsyncWork() {
  return new Promise((resolve) => setImmediate(resolve));
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

test('normalizePageBlockButtonStyle defaults to icon and accepts text', () => {
  assert.equal(normalizePageBlockButtonStyle(undefined), DEFAULT_PAGE_BLOCK_BUTTON_STYLE);
  assert.equal(normalizePageBlockButtonStyle(PAGE_BLOCK_BUTTON_STYLES.text), PAGE_BLOCK_BUTTON_STYLES.text);
  assert.equal(normalizePageBlockButtonStyle('random'), DEFAULT_PAGE_BLOCK_BUTTON_STYLE);
});

test('normalizeUserCellAddButtonVisibility defaults to true and only treats false as disabled', () => {
  assert.equal(normalizeUserCellAddButtonVisibility(undefined), DEFAULT_USER_CELL_ADD_BUTTON_VISIBILITY);
  assert.equal(normalizeUserCellAddButtonVisibility(true), true);
  assert.equal(normalizeUserCellAddButtonVisibility(false), false);
  assert.equal(normalizeUserCellAddButtonVisibility('nope'), true);
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

test('missing username lists read as an empty default list without writing storage', async () => {
  const extensionApi = createPromiseExtensionApi();

  const lists = await getStoredUsernameLists(extensionApi);
  const activeList = await getActiveUsernameList(extensionApi);

  assert.deepEqual(lists, [{
    id: DEFAULT_USERNAME_LIST_ID,
    name: DEFAULT_USERNAME_LIST_NAME,
    usernames: []
  }]);
  assert.deepEqual(activeList, lists[0]);
  assert.equal(extensionApi.store[ACTIVE_USERNAME_LIST_ID_STORAGE_KEY], undefined);
  assert.equal(extensionApi.store[USERNAME_LISTS_STORAGE_KEY], undefined);
});

test('getStoredUsernameListState returns lists and active list with one storage read', async () => {
  const extensionApi = createPromiseExtensionApi({
    [ACTIVE_USERNAME_LIST_ID_STORAGE_KEY]: 'watchlist',
    [USERNAME_LISTS_STORAGE_KEY]: [
      { id: 'blocklist', name: 'Blocklist', usernames: ['alice'] },
      { id: 'watchlist', name: 'Watchlist', usernames: ['bob'] }
    ]
  });
  const getFromStorage = extensionApi.storage.local.get.bind(extensionApi.storage.local);
  let storageGetCount = 0;
  extensionApi.storage.local.get = (keys) => {
    storageGetCount += 1;
    return getFromStorage(keys);
  };

  const state = await getStoredUsernameListState(extensionApi);

  assert.equal(storageGetCount, 1);
  assert.equal(state.activeListId, 'watchlist');
  assert.deepEqual(state.activeList, { id: 'watchlist', name: 'Watchlist', usernames: ['bob'] });
  assert.deepEqual(state.lists, [
    { id: 'blocklist', name: 'Blocklist', usernames: ['alice'] },
    { id: 'watchlist', name: 'Watchlist', usernames: ['bob'] }
  ]);
});

test('active list wrappers read, write, switch, and add usernames without duplicates', async () => {
  const extensionApi = createPromiseExtensionApi();
  const lists = [
    { id: 'blocklist', name: 'Blocklist', usernames: ['alice'] },
    { id: 'watchlist', name: 'Watchlist', usernames: ['bob'] }
  ];

  await setStoredUsernameLists(lists, extensionApi);
  await setActiveUsernameListId('watchlist', extensionApi);

  assert.deepEqual(await getStoredUsernames(extensionApi), ['bob']);
  assert.deepEqual(await setStoredUsernames(['Charlie', 'bob'], extensionApi), ['charlie', 'bob']);
  assert.equal(await isUsernameInActiveList('@charlie', extensionApi), true);

  assert.deepEqual(await addUsernameToActiveList('Dana', extensionApi), {
    added: true,
    list: { id: 'watchlist', name: 'Watchlist', usernames: ['charlie', 'bob', 'dana'] },
    username: 'dana',
    usernames: ['charlie', 'bob', 'dana']
  });
  assert.deepEqual(await addUsernameToActiveList('@Dana', extensionApi), {
    added: false,
    list: { id: 'watchlist', name: 'Watchlist', usernames: ['charlie', 'bob', 'dana'] },
    username: 'dana',
    usernames: ['charlie', 'bob', 'dana']
  });
});

test('username list normalization keeps ids unique and cleans names', () => {
  assert.equal(normalizeUsernameListName('  Spam   Team  '), 'Spam Team');
  assert.deepEqual(normalizeUsernameLists([
    { id: 'same', name: 'One', usernames: ['Alice'] },
    { id: 'same', name: 'One', usernames: ['Alice', 'Bob'] },
    { id: 'bad id', name: '', usernames: ['bad-name'] }
  ]), [
    { id: 'same', name: 'One', usernames: ['alice'] },
    { id: 'one', name: 'One', usernames: ['alice', 'bob'] },
    { id: 'blocklist-3', name: 'Blocklist 3', usernames: [] }
  ]);
  assert.deepEqual(createUsernameList('My List', ['Alice'], ['my-list']), {
    id: 'my-list-2',
    name: 'My List',
    usernames: ['alice']
  });
});

test('parseUsernameImport supports text, json usernames, and json lists', () => {
  assert.deepEqual(parseUsernameImport('@Alice,bad-name Bob', 'names.csv'), {
    invalidEntries: ['bad-name'],
    lists: [],
    usernames: ['alice', 'bob']
  });
  assert.deepEqual(parseUsernameImport('{"usernames":["Alice","bad-name","Bob"]}', 'names.json'), {
    invalidEntries: ['bad-name'],
    lists: [],
    usernames: ['alice', 'bob']
  });
  assert.deepEqual(parseUsernameImport('{"lists":[{"name":"Spam","usernames":["Alice","bad-name"]}]}', 'lists.json'), {
    invalidEntries: ['bad-name'],
    lists: [{ id: 'spam', name: 'Spam', usernames: ['alice'] }],
    usernames: []
  });
});

test('mergeUsernameLists merges imported lists by name and deduplicates usernames', () => {
  assert.deepEqual(mergeUsernameLists([
    { id: 'spam', name: 'Spam', usernames: ['alice'] }
  ], [
    { name: 'spam', usernames: ['Alice', 'Bob'] },
    { name: 'VIP', usernames: ['Charlie'] }
  ]), [
    { id: 'spam', name: 'Spam', usernames: ['alice', 'bob'] },
    { id: 'vip', name: 'VIP', usernames: ['charlie'] }
  ]);
});

test('setStoredBatchBlockDelayMs and getStoredBatchBlockDelayMs round-trip through extension storage', async () => {
  const extensionApi = createExtensionApi();

  const savedDelayMs = await setStoredBatchBlockDelayMs(2200, extensionApi);
  const loadedDelayMs = await getStoredBatchBlockDelayMs(extensionApi);

  assert.equal(savedDelayMs, MAX_BATCH_BLOCK_DELAY_MS);
  assert.equal(loadedDelayMs, MAX_BATCH_BLOCK_DELAY_MS);
});

test('setStoredPageBlockButtonStyle and getStoredPageBlockButtonStyle round-trip through extension storage', async () => {
  const extensionApi = createExtensionApi();

  const savedStyle = await setStoredPageBlockButtonStyle(PAGE_BLOCK_BUTTON_STYLES.text, extensionApi);
  const loadedStyle = await getStoredPageBlockButtonStyle(extensionApi);

  assert.equal(savedStyle, PAGE_BLOCK_BUTTON_STYLES.text);
  assert.equal(loadedStyle, PAGE_BLOCK_BUTTON_STYLES.text);
});

test('setStoredUserCellAddButtonVisibility and getStoredUserCellAddButtonVisibility round-trip through extension storage', async () => {
  const extensionApi = createExtensionApi();

  const savedVisibility = await setStoredUserCellAddButtonVisibility(false, extensionApi);
  const loadedVisibility = await getStoredUserCellAddButtonVisibility(extensionApi);

  assert.equal(savedVisibility, false);
  assert.equal(loadedVisibility, false);
});

test('stored blocklist helpers also work with promise-based storage APIs', async () => {
  const extensionApi = createPromiseExtensionApi();

  const savedUsernames = await setStoredUsernames(['Felixmfdo', 'spam_account'], extensionApi);
  const loadedUsernames = await getStoredUsernames(extensionApi);
  const savedDelayMs = await setStoredBatchBlockDelayMs(1201, extensionApi);
  const loadedDelayMs = await getStoredBatchBlockDelayMs(extensionApi);
  const savedStyle = await setStoredPageBlockButtonStyle(PAGE_BLOCK_BUTTON_STYLES.text, extensionApi);
  const loadedStyle = await getStoredPageBlockButtonStyle(extensionApi);
  const savedVisibility = await setStoredUserCellAddButtonVisibility(false, extensionApi);
  const loadedVisibility = await getStoredUserCellAddButtonVisibility(extensionApi);

  assert.deepEqual(savedUsernames, ['felixmfdo', 'spam_account']);
  assert.deepEqual(loadedUsernames, ['felixmfdo', 'spam_account']);
  assert.equal(savedDelayMs, 1201);
  assert.equal(loadedDelayMs, 1201);
  assert.equal(savedStyle, PAGE_BLOCK_BUTTON_STYLES.text);
  assert.equal(loadedStyle, PAGE_BLOCK_BUTTON_STYLES.text);
  assert.equal(savedVisibility, false);
  assert.equal(loadedVisibility, false);
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

test('observeActiveUsernameList follows active id and list content changes', async () => {
  const extensionApi = createPromiseExtensionApi({
    [ACTIVE_USERNAME_LIST_ID_STORAGE_KEY]: 'first',
    [USERNAME_LISTS_STORAGE_KEY]: [
      { id: 'first', name: 'First', usernames: ['alice'] },
      { id: 'second', name: 'Second', usernames: ['bob'] }
    ]
  });
  const updates = [];
  const unsubscribe = observeActiveUsernameList((activeList) => {
    updates.push(activeList);
  }, extensionApi);

  await setActiveUsernameListId('second', extensionApi);
  await flushAsyncWork();
  await setActiveStoredUsernames(['Charlie'], extensionApi);
  await flushAsyncWork();
  unsubscribe();
  await setActiveStoredUsernames(['Dana'], extensionApi);
  await flushAsyncWork();

  assert.deepEqual(updates, [
    { id: 'second', name: 'Second', usernames: ['bob'] },
    { id: 'second', name: 'Second', usernames: ['charlie'] }
  ]);
});
