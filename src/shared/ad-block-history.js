(() => {
  const storageApi = globalThis.EasyTweetBlockStorage
    || (typeof module !== 'undefined' && module.exports ? require('./storage.js') : null);
  const identityApi = globalThis.EasyTweetBlockIdentity
    || (typeof module !== 'undefined' && module.exports ? require('./identity.js') : null);
  const usernamesApi = globalThis.EasyTweetBlockUsernames
    || (typeof module !== 'undefined' && module.exports ? require('./usernames.js') : null);

  if (!storageApi || !identityApi || !usernamesApi) {
    throw new Error('Missing Easy TweetBlock ad block history dependencies.');
  }

  const { callStorageGet, callStorageSet, getExtensionApi } = storageApi;
  const AD_BLOCK_HISTORY_KEY_PREFIX = 'easyTweetBlockAdBlockHistory:';

  function normalizeAdBlockRecord(value) {
    const restId = identityApi.normalizeRestId(value?.restId);
    const username = usernamesApi.normalizeUsername(value?.username);
    const blockedAt = value?.blockedAt;

    if (!restId || !username || typeof blockedAt !== 'number' || blockedAt <= 0 || !Number.isFinite(new Date(blockedAt).getTime())) {
      return null;
    }

    return { restId, username, blockedAt };
  }

  async function recordAdBlock(value, extensionApi = getExtensionApi()) {
    const record = normalizeAdBlockRecord(value);

    if (!record) {
      throw new Error('Invalid ad block history record.');
    }

    const storageArea = extensionApi?.storage?.local;

    if (!storageArea) {
      throw new Error('Local storage is unavailable for ad block history.');
    }

    await callStorageSet(storageArea, {
      [`${AD_BLOCK_HISTORY_KEY_PREFIX}${record.restId}`]: record
    }, extensionApi);
    return record;
  }

  async function getStoredAdBlockHistory(extensionApi = getExtensionApi()) {
    const values = await callStorageGet(extensionApi?.storage?.local, null, extensionApi);
    const records = [];

    for (const [key, value] of Object.entries(values)) {
      if (!key.startsWith(AD_BLOCK_HISTORY_KEY_PREFIX)) {
        continue;
      }

      const record = normalizeAdBlockRecord(value);

      if (record && key === `${AD_BLOCK_HISTORY_KEY_PREFIX}${record.restId}`) {
        records.push(record);
      }
    }

    return records.sort((first, second) => second.blockedAt - first.blockedAt);
  }

  function hasAdBlockHistoryStorageChange(changes) {
    return Object.keys(changes || {}).some((key) => key.startsWith(AD_BLOCK_HISTORY_KEY_PREFIX));
  }

  const adBlockHistoryApi = {
    getStoredAdBlockHistory,
    hasAdBlockHistoryStorageChange,
    recordAdBlock
  };

  globalThis.EasyTweetBlockAdBlockHistory = adBlockHistoryApi;

  if (typeof module !== 'undefined') {
    module.exports = adBlockHistoryApi;
  }
})();
