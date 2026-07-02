const assert = require('node:assert/strict');
const test = require('node:test');

const sharedBlocklist = require('../src/shared/blocklist.js');
const {
  CONTENT_SCRIPT_FILES,
  POPUP_VIEWS,
  ensureContentScriptsInTab,
  executeTabFunction,
  findUsableXTab,
  init,
  invokeImmediateBlockInTab,
  isMissingReceiverError,
  isSupportedTabUrl,
  normalizePopupView,
  queryTabs,
  requestImmediateBlock,
  sendTabMessage,
  setPopupView
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

function createPopupElement(overrides = {}) {
  const listeners = new Map();
  const element = {
    dataset: {},
    disabled: false,
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
    'batch-block-delay-ms': createPopupElement(),
    'block-now': createPopupElement(),
    'open-settings': createPopupElement(),
    'popup-shell': createPopupElement({ dataset: {} }),
    'save-blocklist': createPopupElement(),
    'save-settings': createPopupElement(),
    status: createPopupElement(),
    'username-blocklist': createPopupElement(),
    'username-count': createPopupElement()
  };

  return {
    documentRef: {
      getElementById(id) {
        return elements[id] || null;
      }
    },
    elements
  };
}

test('normalizePopupView falls back to the main screen for unknown values', () => {
  assert.equal(normalizePopupView(POPUP_VIEWS.settings), POPUP_VIEWS.settings);
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
  const calls = [];
  const extensionApi = {
    runtime: {},
    scripting: {
      async executeScript(options) {
        calls.push(options);
        return [];
      }
    }
  };

  await ensureContentScriptsInTab(17, extensionApi);

  assert.deepEqual(calls, [{
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
  const injectedFiles = [];
  const extensionApi = {
    runtime: {
      lastError: null
    },
    tabs: {
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
  const sentMessages = [];
  const executeScriptCalls = [];
  let attempt = 0;
  const extensionApi = {
    runtime: {},
    scripting: {
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
  assert.equal(executeScriptCalls.length, 2);
  assert.deepEqual(executeScriptCalls[0], {
    files: CONTENT_SCRIPT_FILES,
    target: { tabId: 25 }
  });
  assert.equal(typeof executeScriptCalls[1].func, 'function');
  assert.equal(executeScriptCalls[1].args[1], 1600);
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
  assert.equal(elements.status.textContent, 'Save usernames for later, or block the whole list immediately through any open X tab.');

  elements['open-settings'].click();
  assert.equal(elements['popup-shell'].dataset.view, POPUP_VIEWS.settings);

  elements['batch-block-delay-ms'].value = '2600';
  elements['batch-block-delay-ms'].change();
  assert.equal(elements['batch-block-delay-ms'].value, '2000');

  elements['back-to-main'].click();
  assert.equal(elements['popup-shell'].dataset.view, POPUP_VIEWS.main);
  assert.equal(elements['batch-block-delay-ms'].value, '1400');
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

  assert.deepEqual(persistedUsernames, [['alice', 'bob']]);
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
  const deferredSave = createDeferred();
  const savedDelayInputs = [];
  const blocklist = {
    ...sharedBlocklist,
    async getStoredBatchBlockDelayMs() {
      return 1400;
    },
    async getStoredUsernames() {
      return [];
    },
    setStoredBatchBlockDelayMs(delayMs) {
      savedDelayInputs.push(delayMs);
      return deferredSave.promise;
    }
  };

  init(documentRef, { runtime: {}, tabs: {} }, blocklist);
  await flushAsyncWork();

  elements['open-settings'].click();
  elements['batch-block-delay-ms'].value = '2301';
  elements['save-settings'].click();

  assert.deepEqual(savedDelayInputs, [2000]);
  assert.equal(elements.status.textContent, 'Saving settings...');
  assert.equal(elements['save-blocklist'].disabled, true);
  assert.equal(elements['block-now'].disabled, true);
  assert.equal(elements['save-settings'].disabled, true);

  deferredSave.resolve(1900);
  await flushAsyncWork();

  assert.equal(elements['popup-shell'].dataset.view, POPUP_VIEWS.main);
  assert.equal(elements['batch-block-delay-ms'].value, '1900');
  assert.equal(elements.status.textContent, 'Saved settings. Delay: 1900 ms.');
  assert.equal(elements['save-blocklist'].disabled, false);
  assert.equal(elements['block-now'].disabled, false);
  assert.equal(elements['save-settings'].disabled, false);

  elements['open-settings'].click();
  assert.equal(elements['batch-block-delay-ms'].value, '1900');
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

  assert.equal(elements.status.textContent, 'Add at least one valid username before blocking.');
});
