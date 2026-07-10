const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ACTIVE_USERNAME_LIST_ID_STORAGE_KEY,
  DEFAULT_USERNAME_LIST_ID,
  DEFAULT_USERNAME_LIST_NAME,
  USERNAME_LISTS_STORAGE_KEY
} = require('../src/shared/username-lists.js');
const {
  addUsernameToActiveList,
  createAndActivateUsernameList,
  deleteUsernameList,
  getActiveUsernameList,
  getStoredUsernameListState,
  getStoredUsernameLists,
  importUsernameLists,
  isUsernameInActiveList,
  observeActiveUsernameList,
  renameUsernameList,
  setActiveStoredUsernames,
  setActiveUsernameListId,
  setStoredUsernameLists,
  toggleUsernameInActiveList,
  updateUsernameListUsernames
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

test('active list wrappers read, write, switch, add usernames without duplicates, and toggle membership', async () => {
  const extensionApi = createPromiseExtensionApi();
  const lists = [
    { id: 'blocklist', name: 'Blocklist', usernames: ['alice'] },
    { id: 'watchlist', name: 'Watchlist', usernames: ['bob'] }
  ];

  await setStoredUsernameLists(lists, extensionApi);
  await setActiveUsernameListId('watchlist', extensionApi);

  assert.deepEqual((await getActiveUsernameList(extensionApi)).usernames, ['bob']);
  assert.deepEqual(await setActiveStoredUsernames(['Charlie', 'bob'], extensionApi), ['charlie', 'bob']);
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

  assert.deepEqual(await toggleUsernameInActiveList('Dana', extensionApi), {
    added: false,
    removed: true,
    list: { id: 'watchlist', name: 'Watchlist', usernames: ['charlie', 'bob'] },
    username: 'dana',
    usernames: ['charlie', 'bob']
  });
  assert.deepEqual(await toggleUsernameInActiveList('Dana', extensionApi), {
    added: true,
    removed: false,
    list: { id: 'watchlist', name: 'Watchlist', usernames: ['charlie', 'bob', 'dana'] },
    username: 'dana',
    usernames: ['charlie', 'bob', 'dana']
  });
});

test('active list helpers round-trip through callback-style storage APIs', async () => {
  const extensionApi = createExtensionApi();

  const savedUsernames = await setActiveStoredUsernames(['Felixmfdo', 'spam_account', '@Felixmfdo'], extensionApi);
  const activeList = await getActiveUsernameList(extensionApi);

  assert.deepEqual(savedUsernames, ['felixmfdo', 'spam_account']);
  assert.deepEqual(activeList, {
    id: DEFAULT_USERNAME_LIST_ID,
    name: DEFAULT_USERNAME_LIST_NAME,
    usernames: ['felixmfdo', 'spam_account']
  });
});

test('active list username mutations persist active id and only update the active list', async () => {
  const extensionApi = createPromiseExtensionApi({
    [ACTIVE_USERNAME_LIST_ID_STORAGE_KEY]: 'watchlist',
    [USERNAME_LISTS_STORAGE_KEY]: [
      { id: 'blocklist', name: 'Blocklist', usernames: ['alice'] },
      { id: 'watchlist', name: 'Watchlist', usernames: ['bob'] }
    ]
  });
  const storedPayloads = [];
  const storageSet = extensionApi.storage.local.set.bind(extensionApi.storage.local);

  extensionApi.storage.local.set = (payload) => {
    storedPayloads.push(payload);
    return storageSet(payload);
  };

  await setActiveStoredUsernames(['Carol'], extensionApi);

  assert.deepEqual(storedPayloads[0], {
    [ACTIVE_USERNAME_LIST_ID_STORAGE_KEY]: 'watchlist',
    [USERNAME_LISTS_STORAGE_KEY]: [
      { id: 'blocklist', name: 'Blocklist', usernames: ['alice'] },
      { id: 'watchlist', name: 'Watchlist', usernames: ['carol'] }
    ]
  });

  await addUsernameToActiveList('Dana', extensionApi);

  assert.deepEqual(storedPayloads[1], {
    [ACTIVE_USERNAME_LIST_ID_STORAGE_KEY]: 'watchlist',
    [USERNAME_LISTS_STORAGE_KEY]: [
      { id: 'blocklist', name: 'Blocklist', usernames: ['alice'] },
      { id: 'watchlist', name: 'Watchlist', usernames: ['carol', 'dana'] }
    ]
  });

  await addUsernameToActiveList('@Dana', extensionApi);

  assert.equal(storedPayloads.length, 2);

  await toggleUsernameInActiveList('Carol', extensionApi);

  assert.deepEqual(storedPayloads[2], {
    [ACTIVE_USERNAME_LIST_ID_STORAGE_KEY]: 'watchlist',
    [USERNAME_LISTS_STORAGE_KEY]: [
      { id: 'blocklist', name: 'Blocklist', usernames: ['alice'] },
      { id: 'watchlist', name: 'Watchlist', usernames: ['dana'] }
    ]
  });
  assert.deepEqual(extensionApi.store[USERNAME_LISTS_STORAGE_KEY][0], {
    id: 'blocklist',
    name: 'Blocklist',
    usernames: ['alice']
  });
  assert.equal(extensionApi.store[ACTIVE_USERNAME_LIST_ID_STORAGE_KEY], 'watchlist');
});

test('updateUsernameListUsernames merges against the targeted list without changing the active list id', async () => {
  const extensionApi = createPromiseExtensionApi({
    [ACTIVE_USERNAME_LIST_ID_STORAGE_KEY]: 'second',
    [USERNAME_LISTS_STORAGE_KEY]: [
      { id: 'first', name: 'First', usernames: ['alice'] },
      { id: 'second', name: 'Second', usernames: ['bob'] }
    ]
  });

  const result = await updateUsernameListUsernames('first', (list) => ([
    ...list.usernames,
    'Carol'
  ]), extensionApi);

  assert.equal(result.activeListId, 'second');
  assert.deepEqual(result.list, { id: 'first', name: 'First', usernames: ['alice', 'carol'] });
  assert.deepEqual(extensionApi.store[USERNAME_LISTS_STORAGE_KEY], [
    { id: 'first', name: 'First', usernames: ['alice', 'carol'] },
    { id: 'second', name: 'Second', usernames: ['bob'] }
  ]);
  assert.equal(extensionApi.store[ACTIVE_USERNAME_LIST_ID_STORAGE_KEY], 'second');
});

test('list intent helpers create, rename, delete, and import lists through shared state APIs', async () => {
  const extensionApi = createPromiseExtensionApi({
    [ACTIVE_USERNAME_LIST_ID_STORAGE_KEY]: 'blocklist',
    [USERNAME_LISTS_STORAGE_KEY]: [
      { id: 'blocklist', name: 'Blocklist', usernames: ['alice'] },
      { id: 'watchlist', name: 'Watchlist', usernames: ['bob'] }
    ]
  });

  const created = await createAndActivateUsernameList('VIP', extensionApi);
  assert.equal(created.activeListId, 'vip');
  assert.deepEqual(created.list, { id: 'vip', name: 'VIP', usernames: [] });

  const renamed = await renameUsernameList('vip', 'VIP renamed', extensionApi);
  assert.deepEqual(renamed.list, { id: 'vip', name: 'VIP renamed', usernames: [] });

  const imported = await importUsernameLists([
    { name: 'VIP renamed', usernames: ['Dana'] },
    { name: 'Muted', usernames: ['Eve'] }
  ], extensionApi);
  assert.equal(imported.activeListId, 'vip');
  assert.deepEqual(imported.lists, [
    { id: 'blocklist', name: 'Blocklist', usernames: ['alice'] },
    { id: 'watchlist', name: 'Watchlist', usernames: ['bob'] },
    { id: 'vip', name: 'VIP renamed', usernames: ['dana'] },
    { id: 'muted', name: 'Muted', usernames: ['eve'] }
  ]);

  const deleted = await deleteUsernameList('vip', extensionApi);
  assert.equal(deleted.activeListId, 'muted');
  assert.deepEqual(deleted.deletedList, { id: 'vip', name: 'VIP renamed', usernames: ['dana'] });
  assert.deepEqual(extensionApi.store[USERNAME_LISTS_STORAGE_KEY], [
    { id: 'blocklist', name: 'Blocklist', usernames: ['alice'] },
    { id: 'watchlist', name: 'Watchlist', usernames: ['bob'] },
    { id: 'muted', name: 'Muted', usernames: ['eve'] }
  ]);
  assert.equal(extensionApi.store[ACTIVE_USERNAME_LIST_ID_STORAGE_KEY], 'muted');
});

test('getActiveUsernameList rejects callback-style storage errors', async () => {
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

  await assert.rejects(getActiveUsernameList(extensionApi), /storage get failed/);
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
