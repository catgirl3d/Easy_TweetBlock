const assert = require('node:assert/strict');
const test = require('node:test');

const {
  callStorageGet,
  callStorageSet,
  getExtensionApi
} = require('../src/shared/storage.js');

test('getExtensionApi returns the provided extension API or the global browser API', () => {
  const extensionApi = { runtime: {} };

  assert.equal(getExtensionApi(extensionApi), extensionApi);
  assert.equal(getExtensionApi(null), null);
});

test('callStorageGet reads promise-based storage APIs and normalizes empty values', async () => {
  const storageArea = {
    get(keys) {
      assert.deepEqual(keys, ['first']);
      return Promise.resolve(null);
    }
  };

  assert.deepEqual(await callStorageGet(storageArea, ['first'], { runtime: {} }), {});
});

test('callStorageSet writes promise-based storage APIs', async () => {
  const calls = [];
  const storageArea = {
    set(payload) {
      calls.push(payload);
      return Promise.resolve();
    }
  };

  await callStorageSet(storageArea, { first: true }, { runtime: {} });

  assert.deepEqual(calls, [{ first: true }]);
});

test('callStorageGet supports callback-style storage APIs', async () => {
  const extensionApi = {
    runtime: {
      lastError: null
    }
  };
  const storageArea = {
    get(keys, callback) {
      if (typeof callback !== 'function') {
        throw new Error('callback mode only');
      }

      callback({ [keys[0]]: 'value' });
    }
  };

  assert.deepEqual(await callStorageGet(storageArea, ['first'], extensionApi), { first: 'value' });
});

test('callStorageSet supports callback-style storage APIs', async () => {
  const extensionApi = {
    runtime: {
      lastError: null
    }
  };
  const calls = [];
  const storageArea = {
    set(payload, callback) {
      if (typeof callback !== 'function') {
        throw new Error('callback mode only');
      }

      calls.push(payload);
      callback();
    }
  };

  await callStorageSet(storageArea, { first: true }, extensionApi);

  assert.deepEqual(calls, [{ first: true }]);
});

test('callback-style storage lastError rejects get and set calls', async () => {
  const extensionApi = {
    runtime: {
      lastError: null
    }
  };
  const storageArea = {
    get(_keys, callback) {
      extensionApi.runtime.lastError = { message: 'get failed' };
      callback({});
      extensionApi.runtime.lastError = null;
    },
    set(_payload, callback) {
      extensionApi.runtime.lastError = { message: 'set failed' };
      callback();
      extensionApi.runtime.lastError = null;
    }
  };

  await assert.rejects(callStorageGet(storageArea, ['first'], extensionApi), /get failed/);
  await assert.rejects(callStorageSet(storageArea, { first: true }, extensionApi), /set failed/);
});
