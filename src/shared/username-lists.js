(() => {
  const usernamesApi = globalThis.EasyTweetBlockUsernames
    || (typeof module !== 'undefined' && module.exports ? require('./usernames.js') : null);

  if (!usernamesApi) {
    throw new Error('Missing Easy TweetBlock usernames API.');
  }

  const { normalizeUsername } = usernamesApi;

  const USERNAME_LISTS_STORAGE_KEY = 'usernameLists';
  const ACTIVE_USERNAME_LIST_ID_STORAGE_KEY = 'activeUsernameListId';
  const DEFAULT_USERNAME_LIST_ID = 'blocklist';
  const DEFAULT_USERNAME_LIST_NAME = 'Blocklist';
  const MAX_USERNAME_LIST_NAME_LENGTH = 80;
  const MAX_USERNAME_LIST_ID_LENGTH = 80;
  // Keep slug bases shorter than the full ID limit so numeric suffixes stay in-bounds.
  const MAX_USERNAME_LIST_ID_BASE_LENGTH = 48;
  const USERNAME_LIST_ID_PATTERN = new RegExp(`^[A-Za-z0-9_-]{1,${MAX_USERNAME_LIST_ID_LENGTH}}$`);

  function normalizeStoredUsernames(usernames) {
    return Array.from(usernamesApi.createUsernameSet(usernames));
  }

  function areUsernameListsEqual(leftUsernames, rightUsernames) {
    return leftUsernames.length === rightUsernames.length
      && leftUsernames.every((username, index) => username === rightUsernames[index]);
  }

  function mergeEditedUsernamesWithLatest(baseUsernames, editedUsernames, latestUsernames) {
    const normalizedBaseUsernames = normalizeStoredUsernames(baseUsernames);
    const normalizedEditedUsernames = normalizeStoredUsernames(editedUsernames);
    const normalizedLatestUsernames = normalizeStoredUsernames(latestUsernames);

    if (areUsernameListsEqual(normalizedLatestUsernames, normalizedBaseUsernames)) {
      return normalizedEditedUsernames;
    }

    const editedUsernameSet = new Set(normalizedEditedUsernames);
    const removedBaseUsernames = new Set(
      normalizedBaseUsernames.filter((username) => !editedUsernameSet.has(username))
    );

    return normalizeStoredUsernames([
      ...normalizedLatestUsernames.filter((username) => !removedBaseUsernames.has(username)),
      ...normalizedEditedUsernames
    ]);
  }

  function parseUsernameEntries(entries) {
    const usernames = [];
    const invalidEntries = [];
    const seenUsernames = new Set();

    for (const value of entries) {
      const rawEntry = typeof value === 'string' ? value : String(value ?? '');
      const entry = rawEntry.trim();

      if (!entry) {
        continue;
      }

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

  function parseUsernameText(text) {
    if (typeof text !== 'string' || !text.trim()) {
      return {
        usernames: [],
        invalidEntries: []
      };
    }

    return parseUsernameEntries(text.split(/[\s,]+/));
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

    return (normalizedName || fallback).slice(0, MAX_USERNAME_LIST_NAME_LENGTH);
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
      .slice(0, MAX_USERNAME_LIST_ID_BASE_LENGTH) || DEFAULT_USERNAME_LIST_ID;
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

  function parseUsernameValues(values) {
    if (!Array.isArray(values)) {
      return {
        usernames: [],
        invalidEntries: []
      };
    }

    return parseUsernameEntries(values);
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

  const usernameListsApi = {
    ACTIVE_USERNAME_LIST_ID_STORAGE_KEY,
    createUsernameList,
    createUsernameListId,
    DEFAULT_USERNAME_LIST_ID,
    DEFAULT_USERNAME_LIST_NAME,
    ensureUsernameLists,
    getActiveListId,
    mergeEditedUsernamesWithLatest,
    mergeUsernameLists,
    normalizeStoredUsernames,
    normalizeUsernameListId,
    normalizeUsernameListName,
    normalizeUsernameLists,
    parseUsernameImport,
    parseUsernameText,
    serializeUsernameText,
    USERNAME_LISTS_STORAGE_KEY
  };

  globalThis.EasyTweetBlockUsernameLists = usernameListsApi;

  if (typeof module !== 'undefined') {
    module.exports = usernameListsApi;
  }
})();
