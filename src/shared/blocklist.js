(() => {
  const USERNAME_LISTS_STORAGE_KEY = 'usernameLists';
  const ACTIVE_USERNAME_LIST_ID_STORAGE_KEY = 'activeUsernameListId';
  const DEFAULT_USERNAME_LIST_ID = 'blocklist';
  const DEFAULT_USERNAME_LIST_NAME = 'Blocklist';
  const USERNAME_PATTERN = /^[A-Za-z0-9_]{1,15}$/;
  const USERNAME_LIST_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
  const storageApi = globalThis.EasyTweetBlockStorage
    || (typeof module !== 'undefined' && module.exports ? require('./storage.js') : null);

  if (!storageApi) {
    throw new Error('Missing Easy TweetBlock storage API.');
  }

  const { callStorageGet, callStorageSet, getExtensionApi } = storageApi;

  function normalizeUsername(value) {
    if (typeof value !== 'string') {
      return null;
    }

    const normalizedValue = value.trim().replace(/^[@/]+/, '').toLowerCase();

    if (!normalizedValue || !USERNAME_PATTERN.test(normalizedValue)) {
      return null;
    }

    return normalizedValue;
  }

  function normalizeStoredUsernames(usernames) {
    if (!Array.isArray(usernames)) {
      return [];
    }

    const normalizedUsernames = [];
    const seenUsernames = new Set();

    for (const username of usernames) {
      const normalizedUsername = normalizeUsername(username);

      if (!normalizedUsername || seenUsernames.has(normalizedUsername)) {
        continue;
      }

      seenUsernames.add(normalizedUsername);
      normalizedUsernames.push(normalizedUsername);
    }

    return normalizedUsernames;
  }

  function parseUsernameText(text) {
    if (typeof text !== 'string' || !text.trim()) {
      return {
        usernames: [],
        invalidEntries: []
      };
    }

    const usernames = [];
    const invalidEntries = [];
    const seenUsernames = new Set();
    const rawEntries = text.split(/[\s,]+/).map((entry) => entry.trim()).filter(Boolean);

    for (const entry of rawEntries) {
      const normalizedUsername = normalizeUsername(entry);

      if (!normalizedUsername) {
        invalidEntries.push(entry);
        continue;
      }

      if (seenUsernames.has(normalizedUsername)) {
        continue;
      }

      seenUsernames.add(normalizedUsername);
      usernames.push(normalizedUsername);
    }

    return {
      usernames,
      invalidEntries
    };
  }

  function serializeUsernameText(usernames) {
    return normalizeStoredUsernames(usernames).map((username) => `@${username}`).join('\n');
  }

  function normalizeUsernameListName(value, fallbackName = DEFAULT_USERNAME_LIST_NAME) {
    const normalizedName = typeof value === 'string'
      ? value.trim().replace(/\s+/g, ' ')
      : '';
    const fallback = typeof fallbackName === 'string' && fallbackName.trim()
      ? fallbackName.trim().replace(/\s+/g, ' ')
      : DEFAULT_USERNAME_LIST_NAME;

    return (normalizedName || fallback).slice(0, 80);
  }

  function normalizeUsernameListId(value) {
    if (typeof value !== 'string') {
      return null;
    }

    const normalizedId = value.trim();
    return USERNAME_LIST_ID_PATTERN.test(normalizedId) ? normalizedId : null;
  }

  function createUsernameListId(name = DEFAULT_USERNAME_LIST_NAME, existingIds = []) {
    const usedIds = new Set(Array.isArray(existingIds) ? existingIds.filter(Boolean) : []);
    const normalizedName = normalizeUsernameListName(name);
    const baseId = normalizedName
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || DEFAULT_USERNAME_LIST_ID;
    let candidateId = baseId;
    let suffix = 2;

    while (usedIds.has(candidateId)) {
      candidateId = `${baseId}-${suffix}`;
      suffix += 1;
    }

    return candidateId;
  }

  function createUsernameList(name = DEFAULT_USERNAME_LIST_NAME, usernames = [], existingIds = []) {
    const normalizedName = normalizeUsernameListName(name);
    const id = normalizedName === DEFAULT_USERNAME_LIST_NAME && !existingIds.length
      ? DEFAULT_USERNAME_LIST_ID
      : createUsernameListId(normalizedName, existingIds);

    return {
      id,
      name: normalizedName,
      usernames: normalizeStoredUsernames(usernames)
    };
  }

  function normalizeUsernameLists(lists) {
    if (!Array.isArray(lists)) {
      return [];
    }

    const normalizedLists = [];
    const seenListIds = new Set();

    for (const [index, list] of lists.entries()) {
      if (!list || typeof list !== 'object') {
        continue;
      }

      const name = normalizeUsernameListName(list.name, `${DEFAULT_USERNAME_LIST_NAME} ${index + 1}`);
      const storedId = normalizeUsernameListId(list.id);
      const id = storedId && !seenListIds.has(storedId)
        ? storedId
        : createUsernameListId(name, [...seenListIds]);

      seenListIds.add(id);
      normalizedLists.push({
        id,
        name,
        usernames: normalizeStoredUsernames(list.usernames)
      });
    }

    return normalizedLists;
  }

  function ensureUsernameLists(lists) {
    const normalizedLists = normalizeUsernameLists(lists);
    return normalizedLists.length
      ? normalizedLists
      : [createUsernameList(DEFAULT_USERNAME_LIST_NAME, [])];
  }

  function getActiveListId(lists, activeListId) {
    const normalizedActiveListId = normalizeUsernameListId(activeListId);

    if (normalizedActiveListId && lists.some((list) => list.id === normalizedActiveListId)) {
      return normalizedActiveListId;
    }

    return lists[0]?.id || DEFAULT_USERNAME_LIST_ID;
  }

  async function readUsernameListState(extensionApi = getExtensionApi()) {
    const storageArea = extensionApi?.storage?.local;
    const storedValues = await callStorageGet(storageArea, [
      USERNAME_LISTS_STORAGE_KEY,
      ACTIVE_USERNAME_LIST_ID_STORAGE_KEY
    ], extensionApi);
    const lists = ensureUsernameLists(storedValues?.[USERNAME_LISTS_STORAGE_KEY]);
    const activeListId = getActiveListId(lists, storedValues?.[ACTIVE_USERNAME_LIST_ID_STORAGE_KEY]);
    const activeList = lists.find((list) => list.id === activeListId) || lists[0];

    return {
      activeList,
      activeListId,
      lists
    };
  }

  async function getStoredUsernameLists(extensionApi = getExtensionApi()) {
    const { lists } = await readUsernameListState(extensionApi);
    return lists;
  }

  async function getStoredUsernameListState(extensionApi = getExtensionApi()) {
    const { activeList, activeListId, lists } = await readUsernameListState(extensionApi);

    return {
      activeList,
      activeListId,
      lists
    };
  }

  async function setStoredUsernameLists(lists, extensionApi = getExtensionApi()) {
    const storageArea = extensionApi?.storage?.local;
    const normalizedLists = ensureUsernameLists(lists);
    const storedValues = await callStorageGet(storageArea, [ACTIVE_USERNAME_LIST_ID_STORAGE_KEY], extensionApi);
    const activeListId = getActiveListId(normalizedLists, storedValues?.[ACTIVE_USERNAME_LIST_ID_STORAGE_KEY]);

    await callStorageSet(storageArea, {
      [ACTIVE_USERNAME_LIST_ID_STORAGE_KEY]: activeListId,
      [USERNAME_LISTS_STORAGE_KEY]: normalizedLists
    }, extensionApi);

    return normalizedLists;
  }

  async function getActiveUsernameList(extensionApi = getExtensionApi()) {
    const { activeList } = await readUsernameListState(extensionApi);
    return activeList;
  }

  async function setActiveUsernameListId(listId, extensionApi = getExtensionApi()) {
    const normalizedListId = normalizeUsernameListId(listId);
    const { lists } = await readUsernameListState(extensionApi);
    const activeList = lists.find((list) => list.id === normalizedListId);

    if (!activeList) {
      throw new Error('Unknown username list.');
    }

    const storageArea = extensionApi?.storage?.local;
    await callStorageSet(storageArea, {
      [ACTIVE_USERNAME_LIST_ID_STORAGE_KEY]: activeList.id
    }, extensionApi);

    return activeList;
  }

  async function setActiveStoredUsernames(usernames, extensionApi = getExtensionApi()) {
    const normalizedUsernames = normalizeStoredUsernames(usernames);
    const { activeListId, lists } = await readUsernameListState(extensionApi);
    const nextLists = lists.map((list) => list.id === activeListId
      ? { ...list, usernames: normalizedUsernames }
      : list);
    const storageArea = extensionApi?.storage?.local;

    await callStorageSet(storageArea, {
      [ACTIVE_USERNAME_LIST_ID_STORAGE_KEY]: activeListId,
      [USERNAME_LISTS_STORAGE_KEY]: nextLists
    }, extensionApi);

    return normalizedUsernames;
  }

  async function addUsernameToActiveList(username, extensionApi = getExtensionApi()) {
    const normalizedUsername = normalizeUsername(username);

    if (!normalizedUsername) {
      throw new Error('Invalid username.');
    }

    const { activeList, activeListId, lists } = await readUsernameListState(extensionApi);

    if (activeList.usernames.includes(normalizedUsername)) {
      return {
        added: false,
        list: activeList,
        username: normalizedUsername,
        usernames: activeList.usernames
      };
    }

    const nextUsernames = normalizeStoredUsernames([...activeList.usernames, normalizedUsername]);
    const nextLists = lists.map((list) => list.id === activeListId
      ? { ...list, usernames: nextUsernames }
      : list);
    const storageArea = extensionApi?.storage?.local;

    await callStorageSet(storageArea, {
      [ACTIVE_USERNAME_LIST_ID_STORAGE_KEY]: activeListId,
      [USERNAME_LISTS_STORAGE_KEY]: nextLists
    }, extensionApi);

    return {
      added: true,
      list: { ...activeList, usernames: nextUsernames },
      username: normalizedUsername,
      usernames: nextUsernames
    };
  }

  async function toggleUsernameInActiveList(username, extensionApi = getExtensionApi()) {
    const normalizedUsername = normalizeUsername(username);

    if (!normalizedUsername) {
      throw new Error('Invalid username.');
    }

    const { activeList, activeListId, lists } = await readUsernameListState(extensionApi);
    const wasListed = activeList.usernames.includes(normalizedUsername);
    const nextUsernames = wasListed
      ? activeList.usernames.filter((storedUsername) => storedUsername !== normalizedUsername)
      : normalizeStoredUsernames([...activeList.usernames, normalizedUsername]);
    const nextLists = lists.map((list) => list.id === activeListId
      ? { ...list, usernames: nextUsernames }
      : list);
    const storageArea = extensionApi?.storage?.local;

    await callStorageSet(storageArea, {
      [ACTIVE_USERNAME_LIST_ID_STORAGE_KEY]: activeListId,
      [USERNAME_LISTS_STORAGE_KEY]: nextLists
    }, extensionApi);

    return {
      added: !wasListed,
      removed: wasListed,
      list: { ...activeList, usernames: nextUsernames },
      username: normalizedUsername,
      usernames: nextUsernames
    };
  }

  async function isUsernameInActiveList(username, extensionApi = getExtensionApi()) {
    const normalizedUsername = normalizeUsername(username);

    if (!normalizedUsername) {
      return false;
    }

    const activeList = await getActiveUsernameList(extensionApi);
    return activeList.usernames.includes(normalizedUsername);
  }

  async function getStoredUsernames(extensionApi = getExtensionApi()) {
    const activeList = await getActiveUsernameList(extensionApi);
    return activeList.usernames;
  }

  async function setStoredUsernames(usernames, extensionApi = getExtensionApi()) {
    return setActiveStoredUsernames(usernames, extensionApi);
  }

  function hasUsernameListStorageChange(changes) {
    return Object.prototype.hasOwnProperty.call(changes, USERNAME_LISTS_STORAGE_KEY)
      || Object.prototype.hasOwnProperty.call(changes, ACTIVE_USERNAME_LIST_ID_STORAGE_KEY);
  }

  function observeActiveUsernameList(listener, extensionApi = getExtensionApi()) {
    const onChangedApi = extensionApi?.storage?.onChanged;

    if (typeof listener !== 'function' || !onChangedApi?.addListener) {
      return () => {};
    }

    const handleStorageChange = (changes, areaName) => {
      if (areaName !== 'local' || !hasUsernameListStorageChange(changes || {})) {
        return;
      }

      void getActiveUsernameList(extensionApi)
        .then((activeList) => {
          listener(activeList);
        })
        .catch(() => {});
    };

    onChangedApi.addListener(handleStorageChange);

    return () => {
      if (typeof onChangedApi.removeListener === 'function') {
        onChangedApi.removeListener(handleStorageChange);
      }
    };
  }

  function observeStoredUsernames(listener, extensionApi = getExtensionApi()) {
    return observeActiveUsernameList((activeList) => {
      listener(activeList.usernames);
    }, extensionApi);
  }

  function parseUsernameValues(values) {
    const usernames = [];
    const invalidEntries = [];
    const seenUsernames = new Set();

    if (!Array.isArray(values)) {
      return {
        usernames,
        invalidEntries
      };
    }

    for (const value of values) {
      const rawEntry = typeof value === 'string' ? value : String(value ?? '');
      const normalizedUsername = normalizeUsername(rawEntry);

      if (!normalizedUsername) {
        if (rawEntry.trim()) {
          invalidEntries.push(rawEntry.trim());
        }
        continue;
      }

      if (seenUsernames.has(normalizedUsername)) {
        continue;
      }

      seenUsernames.add(normalizedUsername);
      usernames.push(normalizedUsername);
    }

    return {
      usernames,
      invalidEntries
    };
  }

  function parseJsonUsernameImport(payload) {
    if (Array.isArray(payload)) {
      return {
        ...parseUsernameValues(payload),
        lists: []
      };
    }

    if (!payload || typeof payload !== 'object') {
      return {
        invalidEntries: ['Unsupported JSON import shape'],
        lists: [],
        usernames: []
      };
    }

    if (Array.isArray(payload.lists)) {
      const invalidEntries = [];
      const importedLists = [];

      for (const [index, list] of payload.lists.entries()) {
        if (!list || typeof list !== 'object') {
          invalidEntries.push(`lists[${index}]`);
          continue;
        }

        const parsedListUsernames = parseUsernameValues(list.usernames);
        invalidEntries.push(...parsedListUsernames.invalidEntries);
        importedLists.push({
          name: normalizeUsernameListName(list.name, `Imported list ${index + 1}`),
          usernames: parsedListUsernames.usernames
        });
      }

      return {
        invalidEntries,
        lists: normalizeUsernameLists(importedLists),
        usernames: []
      };
    }

    if (Array.isArray(payload.usernames)) {
      return {
        ...parseUsernameValues(payload.usernames),
        lists: []
      };
    }

    return {
      invalidEntries: ['Unsupported JSON import shape'],
      lists: [],
      usernames: []
    };
  }

  function parseUsernameImport(text, fileName = '') {
    const importText = typeof text === 'string' ? text : '';
    const shouldParseJson = /\.json$/i.test(fileName) || /^[\s]*[\[{]/.test(importText);

    if (!shouldParseJson) {
      return {
        ...parseUsernameText(importText),
        lists: []
      };
    }

    try {
      return parseJsonUsernameImport(JSON.parse(importText));
    } catch {
      return {
        invalidEntries: ['Invalid JSON import'],
        lists: [],
        usernames: []
      };
    }
  }

  function mergeUsernameLists(baseLists, incomingLists) {
    const mergedLists = ensureUsernameLists(baseLists).map((list) => ({
      ...list,
      usernames: [...list.usernames]
    }));
    const normalizedIncomingLists = normalizeUsernameLists(incomingLists);

    for (const incomingList of normalizedIncomingLists) {
      const existingList = mergedLists.find((list) => list.name.toLowerCase() === incomingList.name.toLowerCase());

      if (existingList) {
        existingList.usernames = normalizeStoredUsernames([...existingList.usernames, ...incomingList.usernames]);
        continue;
      }

      mergedLists.push(createUsernameList(
        incomingList.name,
        incomingList.usernames,
        mergedLists.map((list) => list.id)
      ));
    }

    return normalizeUsernameLists(mergedLists);
  }

  const blocklistApi = {
    ACTIVE_USERNAME_LIST_ID_STORAGE_KEY,
    DEFAULT_USERNAME_LIST_ID,
    DEFAULT_USERNAME_LIST_NAME,
    USERNAME_LISTS_STORAGE_KEY,
    USERNAME_PATTERN,
    addUsernameToActiveList,
    createUsernameList,
    createUsernameListId,
    getActiveUsernameList,
    getStoredUsernameListState,
    getStoredUsernameLists,
    getStoredUsernames,
    isUsernameInActiveList,
    mergeUsernameLists,
    normalizeStoredUsernames,
    normalizeUsername,
    normalizeUsernameListName,
    normalizeUsernameLists,
    observeActiveUsernameList,
    observeStoredUsernames,
    parseUsernameImport,
    parseUsernameText,
    serializeUsernameText,
    setActiveStoredUsernames,
    setActiveUsernameListId,
    setStoredUsernameLists,
    setStoredUsernames,
    toggleUsernameInActiveList
  };

  if (typeof module !== 'undefined') {
    module.exports = blocklistApi;
  }

  globalThis.EasyTweetBlockBlocklist = blocklistApi;
})();
