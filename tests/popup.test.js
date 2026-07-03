const assert = require('node:assert/strict');
const test = require('node:test');

const sharedBlocklist = require('../src/shared/blocklist.js');
const sharedFollowers = require('../src/shared/followers.js');
const {
  CONTENT_SCRIPT_CSS_FILES,
  CONTENT_SCRIPT_FILES,
  FOLLOWERS_BLOCK_MESSAGE_TYPE,
  FOLLOWERS_BLOCK_PROGRESS_MESSAGE_TYPE,
  FOLLOWERS_SCAN_MESSAGE_TYPE,
  POPUP_VIEWS,
  clearStoredPopupState,
  ensureContentScriptsInTab,
  executeTabFunction,
  formatPopupError,
  findActiveXTab,
  findUsableXTab,
  init,
  invokeImmediateBlockInTab,
  isMissingReceiverError,
  isSupportedTabUrl,
  logPopupError,
  logPopupInfo,
  loadStoredPopupState,
  normalizePopupView,
  queryTabs,
  registerPopupErrorHandlers,
  renderFatalPopupError,
  requestFollowerBlocks,
  requestFollowersPreview,
  requestImmediateBlock,
  requestMessageWithContentScript,
  sendTabMessage,
  setPopupView,
  saveStoredPopupState
} = require('../src/popup/popup.js');

function flushAsyncWork() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    reject,
    resolve
  };
}

function createLocalStorageStub(initialValues = {}) {
  const values = new Map(Object.entries(initialValues));

  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, String(value));
    }
  };
}

function createPopupElement(overrides = {}) {
  const listeners = new Map();
  const element = {
    dataset: {},
    disabled: false,
    style: {},
    textContent: '',
    value: '',
    addEventListener(type, listener) {
      const typeListeners = listeners.get(type) || [];
      typeListeners.push(listener);
      listeners.set(type, typeListeners);
    },
    change() {
      element.dispatch('change');
    },
    click() {
      element.dispatch('click');
    },
    dispatch(type) {
      const typeListeners = listeners.get(type) || [];

      for (const listener of typeListeners) {
        listener({
          currentTarget: element,
          preventDefault() {},
          stopPropagation() {},
          target: element,
          type
        });
      }
    },
    ...overrides
  };

  return element;
}

function createPopupDocument() {
  const elements = {
    'back-to-main': createPopupElement(),
    'back-from-followers': createPopupElement(),
    'batch-block-delay-ms': createPopupElement(),
    'block-follower-candidates': createPopupElement(),
    'block-now': createPopupElement(),
    'clear-popup-debug-log': createPopupElement(),
    'followers-block-limit': createPopupElement(),
    'followers-block-progress': createPopupElement(),
    'followers-progress-count': createPopupElement(),
    'followers-progress-detail': createPopupElement(),
    'followers-progress-fill': createPopupElement(),
    'followers-progress-label': createPopupElement(),
    'followers-preview': createPopupElement(),
    'followers-scan-limit': createPopupElement(),
    'followers-source-followers': createPopupElement(),
    'followers-source-following': createPopupElement(),
    'followers-summary': createPopupElement(),
    'open-settings': createPopupElement(),
    'open-followers': createPopupElement(),
    'popup-debug-log': createPopupElement({ scrollTop: 0, scrollHeight: 0 }),
    'page-button-style-icon': createPopupElement({ setAttribute() {} }),
    'page-button-style-text': createPopupElement({ setAttribute() {} }),
    'popup-shell': createPopupElement({ dataset: {} }),
    'scan-followers-preview': createPopupElement(),
    'save-blocklist': createPopupElement(),
    'save-settings': createPopupElement(),
    status: createPopupElement(),
    'username-blocklist': createPopupElement(),
    'username-count': createPopupElement()
  };

  return {
    documentRef: {
      body: {
        textContent: ''
      },
      getElementById(id) {
        return elements[id] || null;
      }
    },
    elements
  };
}

test('normalizePopupView falls back to the main screen for unknown values', () => {
  assert.equal(normalizePopupView(POPUP_VIEWS.settings), POPUP_VIEWS.settings);
  assert.equal(normalizePopupView(POPUP_VIEWS.followers), POPUP_VIEWS.followers);
  assert.equal(normalizePopupView('random'), POPUP_VIEWS.main);
});

test('setPopupView updates the shell dataset with the normalized view', () => {
  const shellElement = {
    dataset: {}
  };

  assert.equal(setPopupView(shellElement, POPUP_VIEWS.settings), POPUP_VIEWS.settings);
  assert.equal(shellElement.dataset.view, POPUP_VIEWS.settings);
  assert.equal(setPopupView(shellElement, 'unknown'), POPUP_VIEWS.main);
  assert.equal(shellElement.dataset.view, POPUP_VIEWS.main);
});

test('stored popup state helpers round-trip through localStorage', () => {
  const storage = createLocalStorageStub();
  const state = {
    followersBlockLimit: 25,
    statusMessage: 'Preview ready.',
    view: POPUP_VIEWS.followers
  };

  saveStoredPopupState(state, storage);
  assert.deepEqual(loadStoredPopupState(storage), state);
  clearStoredPopupState(storage);
  assert.deepEqual(loadStoredPopupState(storage), {});
});

test('formatPopupError and renderFatalPopupError expose the real popup failure text', () => {
  const body = { textContent: '' };
  const error = new Error('popup exploded');

  assert.equal(formatPopupError(error).includes('popup exploded'), true);
  assert.equal(renderFatalPopupError(error, { body }).includes('popup exploded'), true);
  assert.equal(body.textContent.includes('Easy TweetBlock popup failed to load.'), true);
  assert.equal(body.textContent.includes('popup exploded'), true);
});

test('logPopupInfo and logPopupError write prefixed browser console messages', () => {
  const originalInfo = console.info;
  const originalError = console.error;
  const calls = [];

  console.info = (...args) => {
    calls.push({ args, type: 'info' });
  };
  console.error = (...args) => {
    calls.push({ args, type: 'error' });
  };

  try {
    logPopupInfo('scan started', { blockLimit: 25 });
    logPopupError('scan failed', new Error('boom'));
  } finally {
    console.info = originalInfo;
    console.error = originalError;
  }

  assert.equal(calls[0].type, 'info');
  assert.equal(calls[0].args[0], '[Easy TweetBlock][popup]');
  assert.equal(calls[0].args[1], 'scan started');
  assert.deepEqual(calls[0].args[2], { blockLimit: 25 });
  assert.equal(calls[1].type, 'error');
  assert.equal(calls[1].args[0], '[Easy TweetBlock][popup]');
  assert.equal(calls[1].args[1], 'scan failed');
  assert.equal(calls[1].args[2] instanceof Error, true);
});

test('registerPopupErrorHandlers renders unhandled popup failures into the popup body', () => {
  const listeners = new Map();
  const globalRef = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    }
  };
  const documentRef = {
    body: {
      textContent: ''
    }
  };

  registerPopupErrorHandlers(globalRef, documentRef);
  listeners.get('unhandledrejection')({ reason: new Error('async popup boom') });

  assert.equal(documentRef.body.textContent.includes('async popup boom'), true);
  assert.equal(globalRef.__easyTweetBlockPopupErrorHandlersAttached__, true);
});

test('isMissingReceiverError detects missing content-script receiver failures', () => {
  assert.equal(isMissingReceiverError(new Error('Could not establish connection. Receiving end does not exist.')), true);
  assert.equal(isMissingReceiverError(new Error('Something else failed.')), false);
});

test('isSupportedTabUrl only accepts X and Twitter tabs', () => {
  assert.equal(isSupportedTabUrl('https://x.com/home'), true);
  assert.equal(isSupportedTabUrl('https://twitter.com/someuser'), true);
  assert.equal(isSupportedTabUrl('https://example.com/'), false);
  assert.equal(isSupportedTabUrl('x.com/home'), false);
});

test('queryTabs falls back to callback-style browser APIs', async () => {
  const extensionApi = {
    runtime: {
      lastError: null
    },
    tabs: {
      query(queryInfo, callback) {
        if (typeof callback !== 'function') {
          throw new Error('callback mode only');
        }

        callback([{ id: 3, queryInfo }]);
      }
    }
  };

  const tabs = await queryTabs({ active: true }, extensionApi);

  assert.deepEqual(tabs, [{ id: 3, queryInfo: { active: true } }]);
});

test('queryTabs surfaces callback lastError failures', async () => {
  const extensionApi = {
    runtime: {
      lastError: null
    },
    tabs: {
      query(_queryInfo, callback) {
        if (typeof callback !== 'function') {
          throw new Error('callback mode only');
        }

        extensionApi.runtime.lastError = { message: 'query failed' };
        callback([]);
        extensionApi.runtime.lastError = null;
      }
    }
  };

  await assert.rejects(queryTabs({ active: true }, extensionApi), /query failed/);
});

test('sendTabMessage falls back to callback-style browser APIs', async () => {
  const extensionApi = {
    runtime: {
      lastError: null
    },
    tabs: {
      sendMessage(tabId, message, callback) {
        if (typeof callback !== 'function') {
          throw new Error('callback mode only');
        }

        callback({ echoed: { message, tabId } });
      }
    }
  };

  const response = await sendTabMessage(14, { type: 'ping' }, extensionApi);

  assert.deepEqual(response, {
    echoed: {
      message: { type: 'ping' },
      tabId: 14
    }
  });
});

test('sendTabMessage surfaces callback lastError failures', async () => {
  const extensionApi = {
    runtime: {
      lastError: null
    },
    tabs: {
      sendMessage(_tabId, _message, callback) {
        if (typeof callback !== 'function') {
          throw new Error('callback mode only');
        }

        extensionApi.runtime.lastError = { message: 'send failed' };
        callback();
        extensionApi.runtime.lastError = null;
      }
    }
  };

  await assert.rejects(sendTabMessage(1, { type: 'ping' }, extensionApi), /send failed/);
});

test('ensureContentScriptsInTab injects popup dependencies through scripting API', async () => {
  const insertCssCalls = [];
  const executeScriptCalls = [];
  const extensionApi = {
    runtime: {},
    scripting: {
      async insertCSS(options) {
        insertCssCalls.push(options);
      },
      async executeScript(options) {
        executeScriptCalls.push(options);
        return [];
      }
    }
  };

  await ensureContentScriptsInTab(17, extensionApi);

  assert.deepEqual(insertCssCalls, [{
    files: CONTENT_SCRIPT_CSS_FILES,
    target: { tabId: 17 }
  }]);
  assert.deepEqual(executeScriptCalls, [{
    files: CONTENT_SCRIPT_FILES,
    target: { tabId: 17 }
  }]);
});

test('executeTabFunction runs a function in the selected tab via scripting API', async () => {
  const calls = [];
  const extensionApi = {
    runtime: {},
    scripting: {
      async executeScript(options) {
        calls.push(options);
        return [{ result: 'ok' }];
      }
    }
  };

  const result = await executeTabFunction(44, () => 'ok', [], extensionApi);

  assert.deepEqual(result, [{ result: 'ok' }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].target.tabId, 44);
});

test('executeTabFunction falls back to callback-style scripting APIs', async () => {
  const extensionApi = {
    runtime: {
      lastError: null
    },
    scripting: {
      executeScript(options, callback) {
        if (typeof callback !== 'function') {
          throw new Error('callback mode only');
        }

        callback([{ result: { args: options.args, ok: true } }]);
      }
    }
  };

  const results = await executeTabFunction(6, () => 'ignored', ['alice'], extensionApi);

  assert.deepEqual(results, [{ result: { args: ['alice'], ok: true } }]);
});

test('executeTabFunction rejects when scripting.executeScript is unavailable', async () => {
  await assert.rejects(executeTabFunction(2, () => 'ignored', [], { runtime: {} }), /does not support scripting\.executeScript/);
});

test('ensureContentScriptsInTab falls back to legacy tabs.executeScript', async () => {
  const injectedCssFiles = [];
  const injectedFiles = [];
  const extensionApi = {
    runtime: {
      lastError: null
    },
    tabs: {
      insertCSS(tabId, options, callback) {
        if (typeof callback !== 'function') {
          throw new Error('callback mode only');
        }

        injectedCssFiles.push({ file: options.file, tabId });
        callback();
      },
      executeScript(tabId, options, callback) {
        if (typeof callback !== 'function') {
          throw new Error('callback mode only');
        }

        injectedFiles.push({ file: options.file, tabId });
        callback();
      }
    }
  };

  await ensureContentScriptsInTab(19, extensionApi, ['first.js', 'second.js']);

  assert.deepEqual(injectedCssFiles, CONTENT_SCRIPT_CSS_FILES.map((file) => ({ file, tabId: 19 })));
  assert.deepEqual(injectedFiles, [
    { file: 'first.js', tabId: 19 },
    { file: 'second.js', tabId: 19 }
  ]);
});

test('ensureContentScriptsInTab rejects when the browser has no injection API', async () => {
  await assert.rejects(ensureContentScriptsInTab(19, { runtime: {} }), /does not expose a script injection API/);
});

test('invokeImmediateBlockInTab executes the tab runner and returns its result', async () => {
  const extensionApi = {
    runtime: {},
    scripting: {
      async executeScript(options) {
        return [{ result: [{ delayMs: options.args[1], ok: true, username: options.args[0][0] }] }];
      }
    }
  };

  const response = await invokeImmediateBlockInTab(11, ['firstuser'], 1400, extensionApi);

  assert.equal(response.ok, true);
  assert.deepEqual(response.results, [{ delayMs: 1400, ok: true, username: 'firstuser' }]);
});

test('requestImmediateBlock injects scripts and falls back to direct tab execution after missing receiver', async () => {
  const insertCssCalls = [];
  const sentMessages = [];
  const executeScriptCalls = [];
  let attempt = 0;
  const extensionApi = {
    runtime: {},
    scripting: {
      async insertCSS(options) {
        insertCssCalls.push(options);
      },
      async executeScript(options) {
        executeScriptCalls.push(options);

        if (options.files) {
          return [];
        }

        return [{ result: [{ ok: true, username: 'firstuser' }] }];
      }
    },
    tabs: {
      async sendMessage(tabId, message) {
        sentMessages.push({ message, tabId });
        attempt += 1;

        if (attempt === 1) {
          throw new Error('Could not establish connection. Receiving end does not exist.');
        }

        return {
          ok: true,
          results: []
        };
      }
    }
  };

  const response = await requestImmediateBlock(25, ['firstuser'], 1600, extensionApi);

  assert.equal(response.ok, true);
  assert.deepEqual(response.results, [{ ok: true, username: 'firstuser' }]);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].message.delayMs, 1600);
  assert.deepEqual(insertCssCalls, []);
  assert.equal(executeScriptCalls.length, 2);
  assert.deepEqual(executeScriptCalls[0], {
    files: CONTENT_SCRIPT_FILES,
    target: { tabId: 25 }
  });
  assert.equal(typeof executeScriptCalls[1].func, 'function');
  assert.equal(executeScriptCalls[1].args[1], 1600);
});

test('requestMessageWithContentScript injects scripts and retries the message after missing receiver', async () => {
  const insertCssCalls = [];
  const executeScriptCalls = [];
  const sentMessages = [];
  let attempt = 0;
  const extensionApi = {
    runtime: {},
    scripting: {
      async insertCSS(options) {
        insertCssCalls.push(options);
      },
      async executeScript(options) {
        executeScriptCalls.push(options);
        return [];
      }
    },
    tabs: {
      async sendMessage(tabId, message) {
        sentMessages.push({ message, tabId });
        attempt += 1;

        if (attempt === 1) {
          throw new Error('Could not establish connection. Receiving end does not exist.');
        }

        return {
          echoed: true,
          ok: true
        };
      }
    }
  };

  const response = await requestMessageWithContentScript(12, { type: 'ping' }, extensionApi);

  assert.deepEqual(response, { echoed: true, ok: true });
  assert.equal(sentMessages.length, 2);
  assert.deepEqual(insertCssCalls, [{
    files: CONTENT_SCRIPT_CSS_FILES,
    target: { tabId: 12 }
  }]);
  assert.deepEqual(executeScriptCalls, [{
    files: CONTENT_SCRIPT_FILES,
    target: { tabId: 12 }
  }]);
});

test('requestFollowersPreview and requestFollowerBlocks send the expected message payloads', async () => {
  const messages = [];
  const extensionApi = {
    runtime: {},
    tabs: {
      async sendMessage(tabId, message) {
        messages.push({ message, tabId });
        return { ok: true };
      }
    }
  };

  await requestFollowersPreview(33, 25, 80, 'following', extensionApi);
  await requestFollowerBlocks(33, [{ restId: '1', username: 'alice' }], 1400, extensionApi);

  assert.deepEqual(messages, [
    {
      message: {
        options: {
          blockLimit: 25,
          scanLimit: 80,
          source: 'following'
        },
        type: FOLLOWERS_SCAN_MESSAGE_TYPE
      },
      tabId: 33
    },
    {
      message: {
        candidates: [{ restId: '1', username: 'alice' }],
        delayMs: 1400,
        type: FOLLOWERS_BLOCK_MESSAGE_TYPE
      },
      tabId: 33
    }
  ]);
});

test('findActiveXTab returns only the active supported X tab', async () => {
  const extensionApi = {
    runtime: {},
    tabs: {
      async query(queryInfo) {
        assert.deepEqual(queryInfo, { active: true, currentWindow: true });
        return [{ id: 7, url: 'https://x.com/someuser/followers' }];
      }
    }
  };

  const tab = await findActiveXTab(extensionApi);

  assert.deepEqual(tab, { id: 7, url: 'https://x.com/someuser/followers' });
});

test('findUsableXTab prefers the active X tab and falls back to any X tab', async () => {
  const queries = [];
  const extensionApi = {
    runtime: {},
    tabs: {
      async query(queryInfo) {
        queries.push(queryInfo);

        if (queryInfo.active) {
          return [{ id: 2, url: 'https://example.com/' }];
        }

        return [{ id: 9, url: 'https://x.com/someuser' }];
      }
    }
  };

  const tab = await findUsableXTab(extensionApi);

  assert.equal(tab.id, 9);
  assert.equal(queries.length, 2);
});

test('findUsableXTab returns the active X tab immediately when available', async () => {
  const extensionApi = {
    runtime: {},
    tabs: {
      async query(queryInfo) {
        if (queryInfo.active) {
          return [{ id: 17, url: 'https://x.com/home' }];
        }

        throw new Error('fallback query should not run');
      }
    }
  };

  const tab = await findUsableXTab(extensionApi);

  assert.deepEqual(tab, { id: 17, url: 'https://x.com/home' });
});

test('findUsableXTab returns null when no usable X tab exists', async () => {
  const extensionApi = {
    runtime: {},
    tabs: {
      async query(queryInfo) {
        if (queryInfo.active) {
          return [{ id: 1, url: 'https://example.com/' }];
        }

        return [{ id: 2, url: 'https://example.com/' }];
      }
    }
  };

  const tab = await findUsableXTab(extensionApi);

  assert.equal(tab, null);
});

test('init loads stored popup state and supports settings navigation', async () => {
  const { documentRef, elements } = createPopupDocument();
  const blocklist = {
    ...sharedBlocklist,
    async getStoredBatchBlockDelayMs() {
      return 1400;
    },
    async getStoredPageBlockButtonStyle() {
      return sharedBlocklist.PAGE_BLOCK_BUTTON_STYLES.text;
    },
    async getStoredUsernames() {
      return ['alice', 'bob'];
    }
  };

  init(documentRef, { runtime: {}, tabs: {} }, blocklist);

  assert.equal(elements['popup-shell'].dataset.view, POPUP_VIEWS.main);
  await flushAsyncWork();

  assert.equal(elements['username-blocklist'].value, '@alice\n@bob');
  assert.equal(elements['username-count'].textContent, '2 usernames');
  assert.equal(elements['batch-block-delay-ms'].value, '1400');
  assert.equal(elements['followers-block-limit'].value, String(sharedFollowers.DEFAULT_FOLLOWERS_BLOCK_LIMIT));
  assert.equal(elements['followers-scan-limit'].value, String(sharedFollowers.DEFAULT_FOLLOWERS_SCAN_LIMIT));
  assert.equal(elements['page-button-style-text'].dataset.active, 'true');
  assert.equal(elements['page-button-style-icon'].dataset.active, 'false');
  assert.equal(elements.status.textContent, 'Save usernames for later, or block the whole list immediately through any open X tab.');

  elements['open-settings'].click();
  assert.equal(elements['popup-shell'].dataset.view, POPUP_VIEWS.settings);

  elements['batch-block-delay-ms'].value = '2600';
  elements['batch-block-delay-ms'].change();
  assert.equal(elements['batch-block-delay-ms'].value, '2000');
  elements['page-button-style-icon'].click();
  assert.equal(elements['page-button-style-icon'].dataset.active, 'true');
  assert.equal(elements['page-button-style-text'].dataset.active, 'false');

  elements['back-to-main'].click();
  assert.equal(elements['popup-shell'].dataset.view, POPUP_VIEWS.main);
  assert.equal(elements['batch-block-delay-ms'].value, '1400');
  assert.equal(elements['page-button-style-text'].dataset.active, 'true');

  elements['open-followers'].click();
  assert.equal(elements['popup-shell'].dataset.view, POPUP_VIEWS.followers);
  elements['back-from-followers'].click();
  assert.equal(elements['popup-shell'].dataset.view, POPUP_VIEWS.main);
});

test('init restores persisted followers preview and username draft state', async (t) => {
  const originalLocalStorage = globalThis.localStorage;
  const storage = createLocalStorageStub();

  globalThis.localStorage = storage;
  t.after(() => {
    if (originalLocalStorage === undefined) {
      delete globalThis.localStorage;
      return;
    }

    globalThis.localStorage = originalLocalStorage;
  });

  saveStoredPopupState({
    followersBlockLimit: 25,
    followersPreview: {
      alreadyBlockedCount: 1,
      blockLimit: 25,
      candidates: [{ restId: '101', username: 'alice' }],
      hasMorePages: true,
      readyCount: 1,
      scanLimit: 80,
      scannedCount: 5,
      targetRestId: '999',
      targetScreenName: 'targetuser'
    },
    followersScanLimit: 80,
    statusMessage: 'Preview ready: 1 followers can be blocked from @targetuser.',
    usernameDraftText: '@draftuser',
    view: POPUP_VIEWS.followers
  }, storage);

  const { documentRef, elements } = createPopupDocument();

  init(documentRef, { runtime: {}, tabs: {} }, {
    ...sharedBlocklist,
    async getStoredBatchBlockDelayMs() {
      return 1000;
    },
    async getStoredPageBlockButtonStyle() {
      return sharedBlocklist.PAGE_BLOCK_BUTTON_STYLES.icon;
    },
    async getStoredUsernames() {
      return ['saveduser'];
    }
  });
  await flushAsyncWork();

  assert.equal(elements['popup-shell'].dataset.view, POPUP_VIEWS.followers);
  assert.equal(elements['username-blocklist'].value, '@draftuser');
  assert.equal(elements['username-count'].textContent, '1 username');
  assert.equal(elements['followers-block-limit'].value, '25');
  assert.equal(elements['followers-scan-limit'].value, '80');
  assert.equal(elements['followers-preview'].textContent, '@alice');
  assert.equal(elements['followers-summary'].textContent.includes('Scanned 5 followers from @targetuser'), true);
  assert.equal(elements.status.textContent, 'Preview ready: 1 followers can be blocked from @targetuser.');
  assert.equal(elements['block-follower-candidates'].disabled, false);

  elements['username-blocklist'].value = '@changeduser';
  elements['username-blocklist'].dispatch('input');
  assert.equal(loadStoredPopupState(storage).usernameDraftText, '@changeduser');
});

test('init saves the blocklist, disables actions while saving, and reports invalid entries', async () => {
  const { documentRef, elements } = createPopupDocument();
  const deferredSave = createDeferred();
  const persistedUsernames = [];
  const blocklist = {
    ...sharedBlocklist,
    async getStoredBatchBlockDelayMs() {
      return 1000;
    },
    async getStoredUsernames() {
      return [];
    },
    setStoredUsernames(usernames) {
      persistedUsernames.push(usernames);
      return deferredSave.promise;
    }
  };

  init(documentRef, { runtime: {}, tabs: {} }, blocklist);
  await flushAsyncWork();

  elements['username-blocklist'].value = '@Alice bad-name @Bob';
  elements['save-blocklist'].click();
  await flushAsyncWork();

  assert.equal(JSON.stringify(persistedUsernames), JSON.stringify([['alice', 'bob']]));
  assert.equal(elements.status.textContent, 'Saving blocklist...');
  assert.equal(elements['save-blocklist'].disabled, true);
  assert.equal(elements['block-now'].disabled, true);
  assert.equal(elements['save-settings'].disabled, true);

  deferredSave.resolve(['alice', 'bob']);
  await flushAsyncWork();

  assert.equal(elements['username-blocklist'].value, '@alice\n@bob');
  assert.equal(elements['username-count'].textContent, '2 usernames');
  assert.equal(elements.status.textContent, 'Saved 2 usernames. Skipped invalid values: bad-name');
  assert.equal(elements['save-blocklist'].disabled, false);
  assert.equal(elements['block-now'].disabled, false);
  assert.equal(elements['save-settings'].disabled, false);
});

test('init saves settings, updates the active delay, and returns to the main view', async () => {
  const { documentRef, elements } = createPopupDocument();
  const deferredDelaySave = createDeferred();
  const deferredStyleSave = createDeferred();
  const savedDelayInputs = [];
  const savedStyles = [];
  const blocklist = {
    ...sharedBlocklist,
    async getStoredBatchBlockDelayMs() {
      return 1400;
    },
    async getStoredPageBlockButtonStyle() {
      return sharedBlocklist.PAGE_BLOCK_BUTTON_STYLES.icon;
    },
    async getStoredUsernames() {
      return [];
    },
    setStoredBatchBlockDelayMs(delayMs) {
      savedDelayInputs.push(delayMs);
      return deferredDelaySave.promise;
    },
    setStoredPageBlockButtonStyle(style) {
      savedStyles.push(style);
      return deferredStyleSave.promise;
    }
  };

  init(documentRef, { runtime: {}, tabs: {} }, blocklist);
  await flushAsyncWork();

  elements['open-settings'].click();
  elements['batch-block-delay-ms'].value = '2301';
  elements['page-button-style-text'].click();
  elements['save-settings'].click();
  await flushAsyncWork();

  assert.equal(JSON.stringify(savedDelayInputs), JSON.stringify([2000]));
  assert.equal(JSON.stringify(savedStyles), JSON.stringify([sharedBlocklist.PAGE_BLOCK_BUTTON_STYLES.text]));
  assert.equal(elements.status.textContent, 'Saving settings...');
  assert.equal(elements['save-blocklist'].disabled, true);
  assert.equal(elements['block-now'].disabled, true);
  assert.equal(elements['save-settings'].disabled, true);

  deferredDelaySave.resolve(1900);
  deferredStyleSave.resolve(sharedBlocklist.PAGE_BLOCK_BUTTON_STYLES.text);
  await flushAsyncWork();

  assert.equal(elements['popup-shell'].dataset.view, POPUP_VIEWS.main);
  assert.equal(elements['batch-block-delay-ms'].value, '1900');
  assert.equal(elements['page-button-style-text'].dataset.active, 'true');
  assert.equal(elements.status.textContent, 'Saved settings. Delay: 1900 ms. Style: text.');
  assert.equal(elements['save-blocklist'].disabled, false);
  assert.equal(elements['block-now'].disabled, false);
  assert.equal(elements['save-settings'].disabled, false);

  elements['open-settings'].click();
  assert.equal(elements['batch-block-delay-ms'].value, '1900');
  assert.equal(elements['page-button-style-text'].dataset.active, 'true');
});

test('init blocks the saved list through an open X tab and reports failures with the saved delay', async () => {
  const { documentRef, elements } = createPopupDocument();
  const sentMessages = [];
  const blocklist = {
    ...sharedBlocklist,
    async getStoredBatchBlockDelayMs() {
      return 1300;
    },
    async getStoredUsernames() {
      return [];
    },
    async setStoredUsernames(usernames) {
      return usernames;
    }
  };
  const extensionApi = {
    runtime: {},
    tabs: {
      async query(queryInfo) {
        if (queryInfo.active) {
          return [{ id: 12, url: 'https://x.com/home' }];
        }

        return [];
      },
      async sendMessage(tabId, message) {
        sentMessages.push({ message, tabId });
        return {
          ok: true,
          results: [
            { ok: true, username: 'alice' },
            { ok: false, username: 'bob' }
          ]
        };
      }
    }
  };

  init(documentRef, extensionApi, blocklist);
  await flushAsyncWork();

  elements['username-blocklist'].value = '@Alice @Bob bad-name';
  elements['block-now'].click();
  await flushAsyncWork();
  await flushAsyncWork();

  assert.equal(sentMessages.length, 1);
  assert.deepEqual(sentMessages[0], {
    message: {
      delayMs: 1300,
      type: 'easy-tweetblock:block-usernames-via-api',
      usernames: ['alice', 'bob']
    },
    tabId: 12
  });
  assert.equal(elements['username-blocklist'].value, '@alice\n@bob');
  assert.equal(elements['username-count'].textContent, '2 usernames');
  assert.equal(elements.status.textContent, 'Blocked 1/2 usernames with 1300 ms delay. Failed: @bob. Invalid: bad-name.');
});

test('init requires at least one valid username before blocking', async () => {
  const { documentRef, elements } = createPopupDocument();

  init(documentRef, { runtime: {}, tabs: {} }, {
    ...sharedBlocklist,
    async getStoredBatchBlockDelayMs() {
      return 1000;
    },
    async getStoredUsernames() {
      return [];
    }
  });
  await flushAsyncWork();

  elements['username-blocklist'].value = 'bad-name';
  elements['block-now'].click();
  await flushAsyncWork();

  assert.equal(elements.status.textContent, 'Add at least one valid username before blocking.');
});

test('init scans followers in the active tab and blocks only the ready preview candidates', async () => {
  const { documentRef, elements } = createPopupDocument();
  const blockDeferred = createDeferred();
  const messages = [];
  const runtimeListeners = [];
  const blocklist = {
    ...sharedBlocklist,
    async getStoredBatchBlockDelayMs() {
      return 1100;
    },
    async getStoredUsernames() {
      return [];
    }
  };
  const extensionApi = {
    runtime: {
      onMessage: {
        addListener(listener) {
          runtimeListeners.push(listener);
        }
      }
    },
    tabs: {
      async query(queryInfo) {
        if (queryInfo.active) {
          return [{ id: 41, url: 'https://x.com/targetuser/followers' }];
        }

        return [];
      },
      async sendMessage(tabId, message) {
        messages.push({ message, tabId });

        if (message.type === FOLLOWERS_SCAN_MESSAGE_TYPE) {
          return {
            ok: true,
            preview: {
              alreadyBlockedCount: 2,
              blockLimit: 25,
              candidates: [
                { restId: '101', username: 'alice' },
                { restId: '202', username: 'bob' }
              ],
              hasMorePages: true,
              readyCount: 2,
              scanLimit: 80,
              scannedCount: 5,
              targetRestId: '999',
              targetScreenName: 'targetuser'
            }
          };
        }

        const runId = message.runId;

        assert.equal(typeof runId, 'string');
        runtimeListeners[0]?.({
          progress: {
            completed: 1,
            delayMs: 1100,
            failureCount: 0,
            phase: 'waiting',
            successCount: 1,
            total: 2
          },
          runId,
          type: FOLLOWERS_BLOCK_PROGRESS_MESSAGE_TYPE
        });

        return blockDeferred.promise;
      }
    }
  };

  init(documentRef, extensionApi, blocklist, sharedFollowers);
  await flushAsyncWork();

  elements['open-followers'].click();
  elements['followers-block-limit'].value = '25';
  elements['followers-scan-limit'].value = '80';
  elements['scan-followers-preview'].click();
  await flushAsyncWork();
  await flushAsyncWork();

  assert.equal(elements.status.textContent, 'Preview ready: 2 followers can be blocked from @targetuser.');
  assert.equal(elements['followers-summary'].textContent, 'Scanned 5 followers from @targetuser. Already blocked: 2. Ready: 2. More followers remain beyond this preview.');
  assert.equal(elements['followers-preview'].textContent, '@alice\n@bob');
  assert.equal(elements['block-follower-candidates'].disabled, false);

  elements['block-follower-candidates'].click();
  await flushAsyncWork();
  assert.equal(elements['followers-progress-label'].textContent, 'Waiting 1100 ms before next block');
  assert.equal(elements['followers-progress-count'].textContent, '1/2');
  assert.equal(elements['followers-progress-fill'].style.width, '50%');
  blockDeferred.resolve({
    ok: true,
    results: [
      { ok: true, restId: '101', username: 'alice' },
      { ok: true, restId: '202', username: 'bob' }
    ]
  });
  await flushAsyncWork();

  assert.equal(elements.status.textContent, 'Block run complete: blocked 2/2 followers. Delay used: 1100 ms between requests.');
  assert.equal(elements['followers-progress-label'].textContent, 'Block run complete');
  assert.equal(elements['followers-progress-count'].textContent, '2/2');
  assert.equal(elements['followers-progress-detail'].textContent, 'Blocked 2/2. Failed: 0. Delay used: 1100 ms between requests.');
  assert.equal(elements['followers-summary'].textContent, 'Preview cleared. Run a new scan for another batch.');
  assert.equal(elements['followers-preview'].textContent, '');
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0], {
    message: {
      options: {
        blockLimit: 25,
        scanLimit: 80,
        source: 'followers'
      },
      type: FOLLOWERS_SCAN_MESSAGE_TYPE
    },
    tabId: 41
  });
  assert.equal(messages[1].tabId, 41);
  assert.deepEqual(messages[1].message.candidates, [
    { restId: '101', username: 'alice' },
    { restId: '202', username: 'bob' }
  ]);
  assert.equal(messages[1].message.delayMs, 1100);
  assert.equal(typeof messages[1].message.runId, 'string');
  assert.equal(messages[1].message.type, FOLLOWERS_BLOCK_MESSAGE_TYPE);
});

test('init scans following when the following source is selected', async () => {
  const { documentRef, elements } = createPopupDocument();
  const messages = [];
  const blocklist = {
    ...sharedBlocklist,
    async getStoredBatchBlockDelayMs() {
      return 1000;
    },
    async getStoredUsernames() {
      return [];
    }
  };
  const extensionApi = {
    runtime: {},
    tabs: {
      async query(queryInfo) {
        if (queryInfo.active) {
          return [{ id: 42, url: 'https://x.com/targetuser/following' }];
        }

        return [];
      },
      async sendMessage(tabId, message) {
        messages.push({ message, tabId });

        return {
          ok: true,
          preview: {
            alreadyBlockedCount: 0,
            blockLimit: 10,
            candidates: [{ restId: '303', username: 'charlie' }],
            hasMorePages: false,
            readyCount: 1,
            scanLimit: 15,
            scannedCount: 1,
            source: 'following',
            targetRestId: '999',
            targetScreenName: 'targetuser'
          }
        };
      }
    }
  };

  init(documentRef, extensionApi, blocklist, sharedFollowers);
  await flushAsyncWork();

  elements['open-followers'].click();
  elements['followers-source-following'].click();
  assert.equal(elements['followers-summary'].textContent, 'Source changed to following. Run a new preview scan.');
  elements['followers-block-limit'].value = '10';
  elements['followers-scan-limit'].value = '15';
  elements['scan-followers-preview'].click();
  await flushAsyncWork();
  await flushAsyncWork();

  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].message.options, {
    blockLimit: 10,
    scanLimit: 15,
    source: 'following'
  });
  assert.equal(elements.status.textContent, 'Preview ready: 1 following account can be blocked from @targetuser.');
  assert.equal(elements['followers-summary'].textContent, 'Scanned 1 following account from @targetuser. Already blocked: 0. Ready: 1.');
  assert.equal(elements['followers-progress-label'].textContent, 'Ready to block 1 following account');
});

test('init renders fatal popup text when the initial popup load rejects', async () => {
  const { documentRef } = createPopupDocument();
  const blocklist = {
    ...sharedBlocklist,
    async getStoredBatchBlockDelayMs() {
      return 1000;
    },
    async getStoredPageBlockButtonStyle() {
      return sharedBlocklist.PAGE_BLOCK_BUTTON_STYLES.icon;
    },
    async getStoredUsernames() {
      throw new Error('storage exploded');
    }
  };

  init(documentRef, { runtime: {}, tabs: {} }, blocklist, sharedFollowers);
  await flushAsyncWork();

  assert.equal(documentRef.body.textContent.includes('storage exploded'), true);
  assert.equal(documentRef.body.textContent.includes('Easy TweetBlock popup failed to load.'), true);
});
