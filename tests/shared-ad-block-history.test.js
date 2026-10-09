const assert = require('node:assert/strict');
const test = require('node:test');

function createHistoryStorage(initialStore = {}) {
  const store = structuredClone(initialStore);
  return {
    runtime: {},
    storage: {
      local: {
        async get(query) {
          assert.equal(query, null);
          return structuredClone(store);
        },
        async set(values) {
          Object.assign(store, structuredClone(values));
        }
      }
    },
    store
  };
}

test('concurrent ad history writers preserve different accounts and deduplicate a renamed account by ID', async () => {
  const { recordAdBlock, getStoredAdBlockHistory } = require('../src/shared/ad-block-history.js');
  const extensionApi = createHistoryStorage({ unrelated: ['keep'] });
  const pendingWrites = [];
  const set = extensionApi.storage.local.set;
  extensionApi.storage.local.set = (values) => new Promise((resolve) => {
    pendingWrites.push(async () => { await set(values); resolve(); });
  });
  const first = Object.freeze({ restId: '2057563419742486528', username: '@FirstAd', blockedAt: 1000 });
  const second = Object.freeze({ restId: '202', username: 'SecondAd', blockedAt: 2000 });
  const writes = [recordAdBlock(first, extensionApi), recordAdBlock(second, extensionApi)];
  assert.equal(pendingWrites.length, 2);
  await pendingWrites[1]();
  await pendingWrites[0]();
  await Promise.all(writes);
  extensionApi.storage.local.set = set;

  assert.deepEqual(await getStoredAdBlockHistory(extensionApi), [
    { restId: '202', username: 'secondad', blockedAt: 2000 },
    { restId: '2057563419742486528', username: 'firstad', blockedAt: 1000 }
  ]);
  await recordAdBlock({ restId: '2057563419742486528', username: 'RenamedAd', blockedAt: 3000 }, extensionApi);
  assert.deepEqual(await getStoredAdBlockHistory(extensionApi), [
    { restId: '2057563419742486528', username: 'renamedad', blockedAt: 3000 },
    { restId: '202', username: 'secondad', blockedAt: 2000 }
  ]);
  assert.deepEqual(extensionApi.store.unrelated, ['keep']);
  assert.deepEqual(first, { restId: '2057563419742486528', username: '@FirstAd', blockedAt: 1000 });
});

test('reading ad history ignores unrelated and malformed records without modifying storage', async () => {
  const { getStoredAdBlockHistory } = require('../src/shared/ad-block-history.js');
  const initialStore = {
    unrelated: { restId: '9', username: 'unrelated', blockedAt: 5000 },
    'easyTweetBlockAdBlockHistory:101': { restId: '101', username: 'FirstAd', blockedAt: 1000 },
    'easyTweetBlockAdBlockHistory:202': { restId: '202', username: 'FirstAd', blockedAt: 2000 },
    'easyTweetBlockAdBlockHistory:303': { restId: '404', username: 'wrongid', blockedAt: 3000 },
    'easyTweetBlockAdBlockHistory:505': { restId: '505', username: '<script>', blockedAt: 4000 },
    'easyTweetBlockAdBlockHistory:606': { restId: '606', username: 'baddate', blockedAt: 1e20 },
    'easyTweetBlockAdBlockHistory:707': { restId: '707', username: 'baddate', blockedAt: '2000' },
    'easyTweetBlockAdBlockHistory:808': null
  };
  const extensionApi = createHistoryStorage(initialStore);
  assert.deepEqual(await getStoredAdBlockHistory(extensionApi), [
    { restId: '202', username: 'firstad', blockedAt: 2000 },
    { restId: '101', username: 'firstad', blockedAt: 1000 }
  ]);
  assert.deepEqual(extensionApi.store, initialStore);
});

test('invalid history records and rejected storage writes leave existing history untouched', async () => {
  const { recordAdBlock } = require('../src/shared/ad-block-history.js');
  const initialStore = { unrelated: 'keep' };
  const extensionApi = createHistoryStorage(initialStore);
  for (const record of [
    { restId: 'not-an-id', username: 'advertiser', blockedAt: 1000 },
    { restId: '101', username: '', blockedAt: 1000 },
    { restId: '101', username: 'advertiser', blockedAt: NaN }
  ]) {
    await assert.rejects(recordAdBlock(record, extensionApi), /Invalid ad block history record/);
  }
  extensionApi.storage.local.set = async () => { throw new Error('storage failed'); };
  await assert.rejects(recordAdBlock({ restId: '101', username: 'advertiser', blockedAt: 1000 }, extensionApi), /storage failed/);
  assert.deepEqual(extensionApi.store, initialStore);
});
