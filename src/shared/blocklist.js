(() => {
  const storageApi = globalThis.EasyTweetBlockStorage
    || (typeof module !== 'undefined' && module.exports ? require('./storage.js') : null);
  const usernamesApi = globalThis.EasyTweetBlockUsernames
    || (typeof module !== 'undefined' && module.exports ? require('./usernames.js') : null);
  const usernameListsApi = globalThis.EasyTweetBlockUsernameLists
    || (typeof module !== 'undefined' && module.exports ? require('./username-lists.js') : null);

  if (!storageApi || !usernamesApi || !usernameListsApi) {
    throw new Error('Missing Easy TweetBlock shared blocklist dependencies.');
  }

  const { callStorageGet, callStorageSet, getExtensionApi } = storageApi;
  const { normalizeUsername } = usernamesApi;
  const {
    ACTIVE_USERNAME_LIST_ID_STORAGE_KEY,
    createUsernameList,
    ensureUsernameLists,
    getActiveListId,
    mergeUsernameLists,
    normalizeStoredUsernames,
    normalizeUsernameListId,
    normalizeUsernameListName,
    USERNAME_LISTS_STORAGE_KEY
  } = usernameListsApi;

  async function writeUsernameListState(lists, activeListId, extensionApi = getExtensionApi()) {
    const storageArea = extensionApi?.storage?.local;
    const normalizedLists = ensureUsernameLists(lists);
    const nextActiveListId = getActiveListId(normalizedLists, activeListId);

    await callStorageSet(storageArea, {
      [ACTIVE_USERNAME_LIST_ID_STORAGE_KEY]: nextActiveListId,
      [USERNAME_LISTS_STORAGE_KEY]: normalizedLists
    }, extensionApi);

    const activeList = normalizedLists.find((list) => list.id === nextActiveListId) || normalizedLists[0];

    return {
      activeList,
      activeListId: nextActiveListId,
      lists: normalizedLists
    };
  }

  async function getStoredUsernameListState(extensionApi = getExtensionApi()) {
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
    const { lists } = await getStoredUsernameListState(extensionApi);
    return lists;
  }

  async function setStoredUsernameLists(lists, extensionApi = getExtensionApi()) {
    const storageArea = extensionApi?.storage?.local;
    const storedValues = await callStorageGet(storageArea, [ACTIVE_USERNAME_LIST_ID_STORAGE_KEY], extensionApi);
    const { lists: normalizedLists } = await writeUsernameListState(
      lists,
      storedValues?.[ACTIVE_USERNAME_LIST_ID_STORAGE_KEY],
      extensionApi
    );

    return normalizedLists;
  }

  async function getActiveUsernameList(extensionApi = getExtensionApi()) {
    const { activeList } = await getStoredUsernameListState(extensionApi);
    return activeList;
  }

  async function setActiveUsernameListId(listId, extensionApi = getExtensionApi()) {
    const normalizedListId = normalizeUsernameListId(listId);
    const { lists } = await getStoredUsernameListState(extensionApi);
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

  async function applyUsernameListUsernamesUpdate(listId, createNextUsernames, extensionApi = getExtensionApi(), currentState = null) {
    const normalizedListId = normalizeUsernameListId(listId);
    const { activeListId, lists } = currentState || await getStoredUsernameListState(extensionApi);
    const targetList = lists.find((list) => list.id === normalizedListId);
    const activeList = lists.find((list) => list.id === activeListId) || lists[0];

    if (typeof createNextUsernames !== 'function') {
      throw new Error('Missing username list update callback.');
    }

    if (!targetList) {
      throw new Error('Unknown username list.');
    }

    const nextUsernamesValue = createNextUsernames(targetList);

    if (nextUsernamesValue === null) {
      return {
        activeList,
        activeListId,
        list: targetList,
        lists,
        updated: false,
        usernames: targetList.usernames
      };
    }

    const nextUsernames = normalizeStoredUsernames(nextUsernamesValue);
    const nextList = { ...targetList, usernames: nextUsernames };
    const nextLists = lists.map((list) => list.id === targetList.id ? nextList : list);
    const nextState = await writeUsernameListState(nextLists, activeListId, extensionApi);

    return {
      ...nextState,
      list: nextList,
      updated: true,
      usernames: nextUsernames
    };
  }

  async function updateUsernameListUsernames(listId, createNextUsernames, extensionApi = getExtensionApi()) {
    return applyUsernameListUsernamesUpdate(listId, createNextUsernames, extensionApi);
  }

  async function updateActiveUsernameListUsernames(createNextUsernames, extensionApi = getExtensionApi()) {
    const currentState = await getStoredUsernameListState(extensionApi);

    return applyUsernameListUsernamesUpdate(
      currentState.activeListId,
      createNextUsernames,
      extensionApi,
      currentState
    );
  }

  async function setActiveStoredUsernames(usernames, extensionApi = getExtensionApi()) {
    const result = await updateActiveUsernameListUsernames(() => usernames, extensionApi);
    return result.usernames;
  }

  async function addUsernameToActiveList(username, extensionApi = getExtensionApi()) {
    const normalizedUsername = normalizeUsername(username);

    if (!normalizedUsername) {
      throw new Error('Invalid username.');
    }

    const result = await updateActiveUsernameListUsernames((activeList) => {
      if (activeList.usernames.includes(normalizedUsername)) {
        return null;
      }

      return [...activeList.usernames, normalizedUsername];
    }, extensionApi);

    return {
      added: result.updated,
      list: result.list,
      username: normalizedUsername,
      usernames: result.usernames
    };
  }

  async function toggleUsernameInActiveList(username, extensionApi = getExtensionApi()) {
    const normalizedUsername = normalizeUsername(username);

    if (!normalizedUsername) {
      throw new Error('Invalid username.');
    }

    let wasListed = false;
    const result = await updateActiveUsernameListUsernames((activeList) => {
      wasListed = activeList.usernames.includes(normalizedUsername);
      return wasListed
        ? activeList.usernames.filter((storedUsername) => storedUsername !== normalizedUsername)
        : [...activeList.usernames, normalizedUsername];
    }, extensionApi);

    return {
      added: !wasListed,
      removed: wasListed,
      list: result.list,
      username: normalizedUsername,
      usernames: result.usernames
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

  async function createAndActivateUsernameList(name, extensionApi = getExtensionApi()) {
    const { lists } = await getStoredUsernameListState(extensionApi);
    const nextList = createUsernameList(name, [], lists.map((list) => list.id));
    const nextState = await writeUsernameListState([...lists, nextList], nextList.id, extensionApi);

    return {
      ...nextState,
      list: nextState.activeList
    };
  }

  async function renameUsernameList(listId, name, extensionApi = getExtensionApi()) {
    const normalizedListId = normalizeUsernameListId(listId);
    const currentState = await getStoredUsernameListState(extensionApi);
    const targetList = currentState.lists.find((list) => list.id === normalizedListId);

    if (!targetList) {
      throw new Error('Unknown username list.');
    }

    const normalizedName = normalizeUsernameListName(name, targetList.name);
    const nextLists = currentState.lists.map((list) => list.id === targetList.id
      ? { ...list, name: normalizedName }
      : list);
    const nextState = await writeUsernameListState(nextLists, currentState.activeListId, extensionApi);

    return {
      ...nextState,
      list: nextState.lists.find((list) => list.id === targetList.id) || nextState.activeList
    };
  }

  async function deleteUsernameList(listId, extensionApi = getExtensionApi()) {
    const normalizedListId = normalizeUsernameListId(listId);
    const currentState = await getStoredUsernameListState(extensionApi);
    const deletedListIndex = currentState.lists.findIndex((list) => list.id === normalizedListId);

    if (deletedListIndex < 0) {
      throw new Error('Unknown username list.');
    }

    if (currentState.lists.length <= 1) {
      throw new Error('Cannot delete the last username list.');
    }

    const deletedList = currentState.lists[deletedListIndex];
    const nextLists = currentState.lists.filter((list) => list.id !== deletedList.id);
    const nextActiveListId = currentState.activeListId === deletedList.id
      ? (nextLists[Math.max(0, Math.min(deletedListIndex, nextLists.length - 1))] || nextLists[0])?.id
      : currentState.activeListId;
    const nextState = await writeUsernameListState(nextLists, nextActiveListId, extensionApi);

    return {
      ...nextState,
      deletedList
    };
  }

  async function importUsernameLists(lists, extensionApi = getExtensionApi()) {
    const currentState = await getStoredUsernameListState(extensionApi);
    return writeUsernameListState(
      mergeUsernameLists(currentState.lists, lists),
      currentState.activeListId,
      extensionApi
    );
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

  const blocklistApi = {
    ACTIVE_USERNAME_LIST_ID_STORAGE_KEY,
    USERNAME_LISTS_STORAGE_KEY,
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
    updateActiveUsernameListUsernames,
    updateUsernameListUsernames
  };

  if (typeof module !== 'undefined') {
    module.exports = blocklistApi;
  }

  globalThis.EasyTweetBlockBlocklist = blocklistApi;
})();
