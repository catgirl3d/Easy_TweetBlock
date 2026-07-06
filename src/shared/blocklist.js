(() => {
  const USERNAME_LISTS_STORAGE_KEY = 'usernameLists';
  const ACTIVE_USERNAME_LIST_ID_STORAGE_KEY = 'activeUsernameListId';
  const DEFAULT_USERNAME_LIST_ID = 'blocklist';
  const DEFAULT_USERNAME_LIST_NAME = 'Blocklist';
  const BATCH_BLOCK_DELAY_MS_STORAGE_KEY = 'batchBlockDelayMs';
  const PAGE_BLOCK_BUTTON_STYLES_STORAGE_KEY = 'pageBlockButtonStyles';
  const USER_CELL_ADD_BUTTON_STYLE_STORAGE_KEY = 'userCellAddButtonStyle';
  const USER_CELL_ADD_BUTTON_VISIBILITY_STORAGE_KEY = 'showUserCellAddButton';
  const DEFAULT_BATCH_BLOCK_DELAY_MS = 1000;
  const DEFAULT_PAGE_BLOCK_BUTTON_STYLE = 'icon';
  const PAGE_BUTTON_STYLE_SURFACES = Object.freeze({
    profile: 'profile',
    tweet: 'tweet',
    userCell: 'user-cell'
  });
  const DEFAULT_PAGE_BLOCK_BUTTON_STYLES = Object.freeze({
    [PAGE_BUTTON_STYLE_SURFACES.tweet]: DEFAULT_PAGE_BLOCK_BUTTON_STYLE,
    [PAGE_BUTTON_STYLE_SURFACES.profile]: DEFAULT_PAGE_BLOCK_BUTTON_STYLE,
    [PAGE_BUTTON_STYLE_SURFACES.userCell]: DEFAULT_PAGE_BLOCK_BUTTON_STYLE
  });
  const DEFAULT_USER_CELL_ADD_BUTTON_STYLE = DEFAULT_PAGE_BLOCK_BUTTON_STYLE;
  const DEFAULT_USER_CELL_ADD_BUTTON_VISIBILITY = true;
  const MIN_BATCH_BLOCK_DELAY_MS = 500;
  const MAX_BATCH_BLOCK_DELAY_MS = 2000;
  const PAGE_BLOCK_BUTTON_STYLES = Object.freeze({
    icon: 'icon',
    text: 'text'
  });
  const USERNAME_PATTERN = /^[A-Za-z0-9_]{1,15}$/;
  const USERNAME_LIST_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

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

  function normalizeBatchBlockDelayMs(value) {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return DEFAULT_BATCH_BLOCK_DELAY_MS;
    }

    const roundedValue = Math.round(numericValue);
    return Math.min(MAX_BATCH_BLOCK_DELAY_MS, Math.max(MIN_BATCH_BLOCK_DELAY_MS, roundedValue));
  }

  function normalizePageBlockButtonStyle(value) {
    return value === PAGE_BLOCK_BUTTON_STYLES.text
      ? PAGE_BLOCK_BUTTON_STYLES.text
      : DEFAULT_PAGE_BLOCK_BUTTON_STYLE;
  }

  function normalizePageButtonStyleSurface(value) {
    return value === PAGE_BUTTON_STYLE_SURFACES.profile || value === PAGE_BUTTON_STYLE_SURFACES.userCell
      ? value
      : PAGE_BUTTON_STYLE_SURFACES.tweet;
  }

  function normalizePageBlockButtonStyles(value) {
    if (typeof value === 'string') {
      const normalizedStyle = normalizePageBlockButtonStyle(value);
      return {
        [PAGE_BUTTON_STYLE_SURFACES.tweet]: normalizedStyle,
        [PAGE_BUTTON_STYLE_SURFACES.profile]: normalizedStyle,
        [PAGE_BUTTON_STYLE_SURFACES.userCell]: normalizedStyle
      };
    }

    const styles = value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : DEFAULT_PAGE_BLOCK_BUTTON_STYLES;

    return {
      [PAGE_BUTTON_STYLE_SURFACES.tweet]: normalizePageBlockButtonStyle(styles[PAGE_BUTTON_STYLE_SURFACES.tweet]),
      [PAGE_BUTTON_STYLE_SURFACES.profile]: normalizePageBlockButtonStyle(styles[PAGE_BUTTON_STYLE_SURFACES.profile]),
      [PAGE_BUTTON_STYLE_SURFACES.userCell]: normalizePageBlockButtonStyle(styles[PAGE_BUTTON_STYLE_SURFACES.userCell])
    };
  }

  function normalizeUserCellAddButtonVisibility(value) {
    return value !== false;
  }

  function getExtensionApi(extensionApi = globalThis.browser || globalThis.chrome) {
    return extensionApi || null;
  }

  function callStorageGet(storageArea, query, extensionApi) {
    if (!storageArea) {
      return Promise.resolve({});
    }

    try {
      const maybePromise = storageArea.get(query);

      if (maybePromise && typeof maybePromise.then === 'function') {
        return maybePromise.then((value) => value || {});
      }
    } catch {
      // Fall through to callback mode for older Chrome-style APIs.
    }

    return new Promise((resolve, reject) => {
      storageArea.get(query, (value) => {
        const lastError = extensionApi?.runtime?.lastError;

        if (lastError) {
          reject(new Error(lastError.message || String(lastError)));
          return;
        }

        resolve(value || {});
      });
    });
  }

  function callStorageSet(storageArea, payload, extensionApi) {
    if (!storageArea) {
      return Promise.resolve();
    }

    try {
      const maybePromise = storageArea.set(payload);

      if (maybePromise && typeof maybePromise.then === 'function') {
        return maybePromise;
      }
    } catch {
      // Fall through to callback mode for older Chrome-style APIs.
    }

    return new Promise((resolve, reject) => {
      storageArea.set(payload, () => {
        const lastError = extensionApi?.runtime?.lastError;

        if (lastError) {
          reject(new Error(lastError.message || String(lastError)));
          return;
        }

        resolve();
      });
    });
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

  async function getStoredBatchBlockDelayMs(extensionApi = getExtensionApi()) {
    const storageArea = extensionApi?.storage?.local;
    const storedValues = await callStorageGet(storageArea, [BATCH_BLOCK_DELAY_MS_STORAGE_KEY], extensionApi);
    return normalizeBatchBlockDelayMs(storedValues?.[BATCH_BLOCK_DELAY_MS_STORAGE_KEY]);
  }

  async function setStoredBatchBlockDelayMs(delayMs, extensionApi = getExtensionApi()) {
    const normalizedDelayMs = normalizeBatchBlockDelayMs(delayMs);
    const storageArea = extensionApi?.storage?.local;

    await callStorageSet(storageArea, {
      [BATCH_BLOCK_DELAY_MS_STORAGE_KEY]: normalizedDelayMs
    }, extensionApi);

    return normalizedDelayMs;
  }

  async function getStoredPageBlockButtonStyles(extensionApi = getExtensionApi()) {
    const storageArea = extensionApi?.storage?.local;
    const storedValues = await callStorageGet(storageArea, [PAGE_BLOCK_BUTTON_STYLES_STORAGE_KEY], extensionApi);
    return normalizePageBlockButtonStyles(storedValues?.[PAGE_BLOCK_BUTTON_STYLES_STORAGE_KEY]);
  }

  async function setStoredPageBlockButtonStyles(styles, extensionApi = getExtensionApi()) {
    const normalizedStyles = normalizePageBlockButtonStyles(styles);
    const storageArea = extensionApi?.storage?.local;

    await callStorageSet(storageArea, {
      [PAGE_BLOCK_BUTTON_STYLES_STORAGE_KEY]: normalizedStyles
    }, extensionApi);

    return normalizedStyles;
  }

  async function getStoredUserCellAddButtonVisibility(extensionApi = getExtensionApi()) {
    const storageArea = extensionApi?.storage?.local;
    const storedValues = await callStorageGet(storageArea, [USER_CELL_ADD_BUTTON_VISIBILITY_STORAGE_KEY], extensionApi);
    return normalizeUserCellAddButtonVisibility(storedValues?.[USER_CELL_ADD_BUTTON_VISIBILITY_STORAGE_KEY]);
  }

  async function getStoredUserCellAddButtonStyle(extensionApi = getExtensionApi()) {
    const storageArea = extensionApi?.storage?.local;
    const storedValues = await callStorageGet(storageArea, [USER_CELL_ADD_BUTTON_STYLE_STORAGE_KEY], extensionApi);
    return normalizePageBlockButtonStyle(storedValues?.[USER_CELL_ADD_BUTTON_STYLE_STORAGE_KEY]);
  }

  async function setStoredUserCellAddButtonVisibility(isVisible, extensionApi = getExtensionApi()) {
    const normalizedVisibility = normalizeUserCellAddButtonVisibility(isVisible);
    const storageArea = extensionApi?.storage?.local;

    await callStorageSet(storageArea, {
      [USER_CELL_ADD_BUTTON_VISIBILITY_STORAGE_KEY]: normalizedVisibility
    }, extensionApi);

    return normalizedVisibility;
  }

  async function setStoredUserCellAddButtonStyle(style, extensionApi = getExtensionApi()) {
    const normalizedStyle = normalizePageBlockButtonStyle(style);
    const storageArea = extensionApi?.storage?.local;

    await callStorageSet(storageArea, {
      [USER_CELL_ADD_BUTTON_STYLE_STORAGE_KEY]: normalizedStyle
    }, extensionApi);

    return normalizedStyle;
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
    BATCH_BLOCK_DELAY_MS_STORAGE_KEY,
    DEFAULT_USER_CELL_ADD_BUTTON_VISIBILITY,
    DEFAULT_USER_CELL_ADD_BUTTON_STYLE,
    DEFAULT_BATCH_BLOCK_DELAY_MS,
    DEFAULT_PAGE_BLOCK_BUTTON_STYLE,
    DEFAULT_PAGE_BLOCK_BUTTON_STYLES,
    DEFAULT_USERNAME_LIST_ID,
    DEFAULT_USERNAME_LIST_NAME,
    MAX_BATCH_BLOCK_DELAY_MS,
    MIN_BATCH_BLOCK_DELAY_MS,
    PAGE_BLOCK_BUTTON_STYLES,
    PAGE_BLOCK_BUTTON_STYLES_STORAGE_KEY,
    PAGE_BUTTON_STYLE_SURFACES,
    USER_CELL_ADD_BUTTON_STYLE_STORAGE_KEY,
    USER_CELL_ADD_BUTTON_VISIBILITY_STORAGE_KEY,
    USERNAME_LISTS_STORAGE_KEY,
    USERNAME_PATTERN,
    addUsernameToActiveList,
    createUsernameList,
    createUsernameListId,
    getActiveUsernameList,
    getStoredBatchBlockDelayMs,
    getStoredPageBlockButtonStyles,
    getStoredUserCellAddButtonStyle,
    getStoredUserCellAddButtonVisibility,
    getStoredUsernameListState,
    getStoredUsernameLists,
    getStoredUsernames,
    isUsernameInActiveList,
    mergeUsernameLists,
    normalizeBatchBlockDelayMs,
    normalizePageBlockButtonStyle,
    normalizePageBlockButtonStyles,
    normalizePageButtonStyleSurface,
    normalizeUserCellAddButtonVisibility,
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
    setStoredBatchBlockDelayMs,
    setStoredPageBlockButtonStyles,
    setStoredUserCellAddButtonStyle,
    setStoredUserCellAddButtonVisibility,
    setStoredUsernameLists,
    setStoredUsernames
  };

  if (typeof module !== 'undefined') {
    module.exports = blocklistApi;
  }

  globalThis.EasyTweetBlockBlocklist = blocklistApi;
})();
