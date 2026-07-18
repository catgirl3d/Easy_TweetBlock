const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const sharedBlocklist = require('../src/shared/blocklist.js');
const sharedFollowerScanSessions = require('../src/shared/follower-scan-session.js');
const sharedFollowers = require('../src/shared/followers.js');
const sharedSettings = require('../src/shared/settings.js');
const {
  CONTENT_SCRIPT_CSS_FILES,
  CONTENT_SCRIPT_FILES,
  FOLLOWERS_BLOCK_MESSAGE_TYPE,
  FOLLOWERS_BLOCK_PROGRESS_MESSAGE_TYPE,
  FOLLOWERS_CANCEL_MESSAGE_TYPE,
  FOLLOWERS_RUN_PORT_PREFIX,
  FOLLOWERS_SCAN_MESSAGE_TYPE,
  POPUP_VIEWS,
  appendPopupDebugEntry,
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
  clearStoredPopupDebugEntries,
  loadStoredPopupDebugEntries,
  loadStoredPopupState,
  normalizePopupView,
  queryTabs,
  registerPopupErrorHandlers,
  renderFatalPopupError,
  requestFollowerBlocks,
  requestFollowersPreview,
  requestImmediateBlock,
  saveStoredPopupDebugEntries,
  sendTabMessage,
  setPopupView,
  saveStoredPopupState
} = require('../src/popup/popup.js');

test('popup header uses the packaged extension icon', () => {
  const popupHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'popup', 'popup.html'), 'utf8');

  assert.match(popupHtml, /<img class="logo-icon" src="\.\.\/\.\.\/assets\/extension\/48\.png" alt="" width="20" height="20">/);
  assert.doesNotMatch(popupHtml, /class="logo-shield"/);
});

test('settings view replaces its topbar action with back navigation', () => {
  const popupHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'popup', 'popup.html'), 'utf8');
  const popupCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'popup', 'popup.css'), 'utf8');
  const settingsPanel = popupHtml.slice(
    popupHtml.indexOf('data-view-panel="settings"'),
    popupHtml.indexOf('data-view-panel="followers"')
  );

  assert.match(popupHtml, /<div class="topbar-actions">[\s\S]*?id="open-settings"[\s\S]*?id="back-to-main"/);
  assert.doesNotMatch(settingsPanel, /id="back-to-main"/);
  assert.match(popupCss, /\.topbar-actions\s*\{[\s\S]*?grid-template-areas: "action";/);
  assert.match(popupCss, /\.popup-shell\[data-view="settings"\] #back-to-main\s*\{[\s\S]*?visibility: visible;/);
});

test('settings card uses the shared title icon markup', () => {
  const popupHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'popup', 'popup.html'), 'utf8');
  const settingsPanel = popupHtml.slice(
    popupHtml.indexOf('data-view-panel="settings"'),
    popupHtml.indexOf('data-view-panel="followers"')
  );

  assert.match(settingsPanel, /class="settings-header">\s*<div class="card-title">[\s\S]*?class="card-title-icon"[\s\S]*?<h2>Settings<\/h2>/);
});

test('segmented controls use the shared blue-gray surface', () => {
  const popupCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'popup', 'popup.css'), 'utf8');

  assert.match(popupCss, /--bg-segmented-control:\s*#0f1628;/);
  assert.match(popupCss, /\.segmented-control\s*\{[\s\S]*?background: var\(--bg-segmented-control\);/);
  assert.match(popupCss, /\.source-toggle\s*\{[\s\S]*?background: var\(--bg-segmented-control\);/);
  assert.match(popupCss, /\.segmented-control::before,[\s\S]*?\.source-toggle::before\s*\{[\s\S]*?transition: transform 220ms/);
  assert.match(popupCss, /\.segmented-control:has\(\.segment-button\[data-active="true"\]:nth-child\(2\)\)::before,[\s\S]*?transform: translateX\(calc\(100% \+ 3px\)\);/);
  assert.doesNotMatch(popupCss, /segmentedControlActivate/);
  assert.match(popupCss, /@media \(prefers-reduced-motion: reduce\)/);
});

test('followers source and block actions use readable semantic colors', () => {
  const popupCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'popup', 'popup.css'), 'utf8');
  const popupHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'popup', 'popup.html'), 'utf8');

  assert.match(popupCss, /\.source-toggle-button\[data-active="true"\]\s*\{[\s\S]*?color: #ffffff;/);
  assert.match(popupHtml, /id="block-follower-candidates" class="danger-button"/);
});

test('toggle thumb remains vertically centered in both states', () => {
  const popupCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'popup', 'popup.css'), 'utf8');

  assert.match(popupCss, /\.toggle-checkbox-switch::after\s*\{[\s\S]*?top: 50%;[\s\S]*?transform: translateY\(-50%\);/);
  assert.match(popupCss, /\.toggle-checkbox:checked \+ \.toggle-checkbox-switch::after\s*\{[\s\S]*?transform: translate\(14px, -50%\);/);
});

test('popup save and import buttons use distinct semantic hover colors', () => {
  const popupCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'popup', 'popup.css'), 'utf8');

  assert.match(popupCss, /--accent-green-alpha-14:\s*#10b98124;/);
  assert.match(popupCss, /--accent-import-alpha-14:\s*#3b82f624;/);
  assert.match(popupCss, /#save-blocklist:hover:not\(:disabled\)[\s\S]*?var\(--accent-green-alpha-14\)/);
  assert.match(popupCss, /#import-usernames:hover:not\(:disabled\)[\s\S]*?var\(--accent-import-alpha-14\)/);
});

test('followers tool includes a caution note with a keyboard-accessible tooltip', () => {
  const popupHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'popup', 'popup.html'), 'utf8');
  const popupCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'popup', 'popup.css'), 'utf8');

  assert.match(popupHtml, /class="followers-caution" role="note"/);
  assert.match(popupHtml, /Use with caution: blocking many accounts at once may look suspicious to X\/Twitter\./);
  assert.match(popupHtml, /id="followers-caution-help"[\s\S]*aria-describedby="followers-caution-tooltip"/);
  assert.match(popupHtml, /id="followers-caution-tooltip" class="followers-caution-tooltip" role="tooltip"/);
  assert.match(popupCss, /\.followers-caution-help:hover \.followers-caution-tooltip,[\s\S]*\.followers-caution-help:focus-within \.followers-caution-tooltip/);
});

test('followers tool does not render the popup debug log UI', () => {
  const popupHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'popup', 'popup.html'), 'utf8');
  const popupCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'popup', 'popup.css'), 'utf8');

  assert.doesNotMatch(popupHtml, /popup-debug-log|clear-popup-debug-log|Debug log/);
  assert.doesNotMatch(popupCss, /popup-debug-log|debug-header/);
});

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

function createStorageExtensionApi(initialStore = {}, { onSet = null } = {}) {
  const store = { ...initialStore };
  const listeners = [];

  return {
    runtime: {},
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

          if (typeof onSet === 'function') {
            return Promise.resolve(onSet({ changes, payload, store }));
          }

          return Promise.resolve();
        }
      },
      onChanged: {
        addListener(listener) {
          listeners.push(listener);
        },
        removeListener(listener) {
          const index = listeners.indexOf(listener);

          if (index !== -1) {
            listeners.splice(index, 1);
          }
        }
      }
    },
    store
  };
}

function createStoredFollowerScanSession(overrides = {}) {
  const session = sharedFollowerScanSessions.createEmptyFollowerScanSession({
    blockLimit: 25,
    scanLimit: 80,
    source: 'followers',
    targetRestId: '999',
    targetScreenName: 'targetuser'
  });

  return sharedFollowerScanSessions.normalizeFollowerScanSession({
    ...session,
    ...overrides
  });
}

function createFollowerScanRetryPreview(overrides = {}) {
  const resumeState = {
    alreadyBlockedKeys: ['id:301'],
    hasMorePages: false,
    nextCursor: null,
    pendingUsers: [],
    ...(overrides.resumeState || {})
  };

  return {
    alreadyBlockedCount: 0,
    blockLimit: 25,
    candidates: [],
    hasMorePages: false,
    readyCount: 0,
    resumeState,
    scanLimit: 80,
    scannedCount: 2,
    source: 'followers',
    targetRestId: '999',
    targetScreenName: 'targetuser',
    ...overrides,
    resumeState
  };
}

async function runStaleContinuationRetryScan({
  initialSessionOverrides = {},
  retryPreview
} = {}) {
  const { documentRef, elements } = createPopupDocument();
  const messages = [];
  const blocklist = sharedBlocklist;
  const extensionApi = createStorageExtensionApi({
    [sharedFollowerScanSessions.FOLLOWER_SCAN_SESSION_STORAGE_KEY]: {
      version: 1,
      activeSession: createStoredFollowerScanSession({
        dedupe: {
          alreadyBlockedKeys: ['id:301']
        },
        hasMorePages: true,
        nextCursor: 'cursor-stale',
        pendingUsers: [{ restId: '202', username: 'bob', blocking: false }],
        readyCandidates: [],
        totals: {
          scanned: 5,
          alreadyBlocked: 1,
          blockedSuccess: 0,
          blockedFailed: 0,
          abandonedFailed: 0
        },
        ...initialSessionOverrides
      })
    }
  });
  let scanAttempt = 0;

  extensionApi.tabs = {
    async query(queryInfo) {
      if (queryInfo.active) {
        return [{ id: 52, url: 'https://x.com/targetuser/followers' }];
      }

      return [];
    },
    async sendMessage(tabId, message) {
      messages.push({ message, tabId });
      scanAttempt += 1;

      if (scanAttempt === 1) {
        return {
          error: 'Saved cursor is invalid.',
          ok: false
        };
      }

      return {
        ok: true,
        preview: createFollowerScanRetryPreview(retryPreview)
      };
    }
  };

  init(documentRef, extensionApi, blocklist, sharedFollowers, sharedSettings, sharedFollowerScanSessions);
  await flushAsyncWork();
  await flushAsyncWork();

  elements['open-followers'].click();
  elements['followers-block-limit'].value = '25';
  elements['followers-scan-limit'].value = '80';
  elements['scan-followers-preview'].click();
  await flushAsyncWork();
  await flushAsyncWork();
  await flushAsyncWork();

  return {
    elements,
    extensionApi,
    messages
  };
}

function createPopupElement(overrides = {}) {
  const listeners = new Map();
  const element = {
    children: [],
    dataset: {},
    disabled: false,
    hidden: false,
    parentElement: null,
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
    contains(target) {
      if (target === element) {
        return true;
      }

      return element.children.some((child) => child?.contains?.(target) || child === target);
    },
    focus() {},
    removeAttribute(name) {
      delete element[name];
    },
    replaceChildren(...children) {
      element.children = children;

      for (const child of children) {
        if (child && typeof child === 'object') {
          child.parentElement = element;
        }
      }

      element.textContent = children.map((child) => child?.textContent || '').join('');
    },
    setAttribute(name, value) {
      element[name] = value;
    },
    ...overrides
  };

  return element;
}

function createPopupDocument() {
  const elements = {
    'add-followers-to-list': createPopupElement(),
    'back-to-main': createPopupElement(),
    'back-from-followers': createPopupElement(),
    'batch-block-delay-ms': createPopupElement(),
    'block-follower-candidates': createPopupElement(),
    'block-now': createPopupElement(),
    'cancel-followers-run': createPopupElement(),
    'clear-list': createPopupElement(),
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
    'delete-username-list': createPopupElement(),
    'import-usernames': createPopupElement(),
    'import-usernames-file': createPopupElement({ files: [] }),
    'new-username-list': createPopupElement(),
    'open-settings': createPopupElement(),
    'open-followers': createPopupElement(),
    'page-button-style-profile-icon': createPopupElement({ setAttribute() {} }),
    'page-button-style-profile-text': createPopupElement({ setAttribute() {} }),
    'page-button-style-tweet-icon': createPopupElement({ setAttribute() {} }),
    'page-button-style-tweet-text': createPopupElement({ setAttribute() {} }),
    'page-button-style-user-cell-icon': createPopupElement({ setAttribute() {} }),
    'page-button-style-user-cell-text': createPopupElement({ setAttribute() {} }),
    'popup-shell': createPopupElement({ dataset: {} }),
    'popup-toast-region': createPopupElement({ hidden: true }),
    'rename-username-list': createPopupElement(),
    'scan-followers-preview': createPopupElement(),
    'scan-followers-preview-label': createPopupElement({ textContent: 'Scan' }),
    'save-blocklist': createPopupElement(),
    'save-settings': createPopupElement(),
    'user-cell-add-button-style-icon': createPopupElement({ setAttribute() {} }),
    'user-cell-add-button-style-text': createPopupElement({ setAttribute() {} }),
    'show-user-cell-add-button': createPopupElement({ checked: false }),
    status: createPopupElement(),
    'username-blocklist': createPopupElement(),
    'username-list-options': createPopupElement(),
    'username-list-select-label': createPopupElement(),
    'username-list-select': createPopupElement(),
    'username-count': createPopupElement()
  };

  return {
    documentRef: {
      addEventListener() {},
      body: {
        textContent: ''
      },
      getElementById(id) {
        return elements[id] || null;
      },
      removeEventListener() {},
      createElement(tagName) {
        return createPopupElement({
          tagName: String(tagName).toUpperCase()
        });
      }
    },
    elements
  };
}

function getToastText(elements) {
  return elements['popup-toast-region'].textContent;
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

test('appendPopupDebugEntry keeps popup debug log in memory and does not touch storage', () => {
  let getItemCalls = 0;
  let setItemCalls = 0;
  let removeItemCalls = 0;
  let storedValue = null;
  const storage = {
    getItem() {
      getItemCalls += 1;
      return storedValue;
    },
    removeItem() {
      removeItemCalls += 1;
      storedValue = null;
    },
    setItem(_key, value) {
      setItemCalls += 1;
      storedValue = value;
    }
  };

  appendPopupDebugEntry('INFO', 'first event', null, storage);
  appendPopupDebugEntry('INFO', 'second event', null, storage);

  assert.equal(getItemCalls, 0);
  assert.equal(setItemCalls, 0);
  assert.equal(removeItemCalls, 0);
  assert.equal(loadStoredPopupDebugEntries(storage).length, 2);
});

test('saveStoredPopupDebugEntries and clearStoredPopupDebugEntries stay in memory only', () => {
  let getItemCalls = 0;
  let setItemCalls = 0;
  let removeItemCalls = 0;
  let storedValue = null;
  const storage = {
    getItem() {
      getItemCalls += 1;
      return storedValue;
    },
    removeItem() {
      removeItemCalls += 1;
      storedValue = null;
    },
    setItem(_key, value) {
      setItemCalls += 1;
      storedValue = value;
    }
  };

  saveStoredPopupDebugEntries(['first event', 'second event'], storage);
  assert.deepEqual(loadStoredPopupDebugEntries(storage), ['first event', 'second event']);

  clearStoredPopupDebugEntries(storage);

  assert.deepEqual(loadStoredPopupDebugEntries(storage), []);
  assert.equal(getItemCalls, 0);
  assert.equal(setItemCalls, 0);
  assert.equal(removeItemCalls, 0);
  assert.equal(storedValue, null);
});

test('popup debug helpers do not mirror entries onto globalThis', (t) => {
  const globalKey = '__easyTweetBlockPopupDebugEntries__';
  const hadOriginalValue = Object.prototype.hasOwnProperty.call(globalThis, globalKey);
  const originalValue = globalThis[globalKey];
  const storage = createLocalStorageStub();

  globalThis[globalKey] = 'sentinel';

  t.after(() => {
    if (hadOriginalValue) {
      globalThis[globalKey] = originalValue;
      return;
    }

    delete globalThis[globalKey];
  });

  saveStoredPopupDebugEntries(['first event'], storage);
  appendPopupDebugEntry('INFO', 'second event', null, storage);
  clearStoredPopupDebugEntries(storage);

  assert.equal(globalThis[globalKey], 'sentinel');
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
          resumeState: null,
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

test('requestFollowerBlocks relays progress during direct execution fallback', async (t) => {
  const originalChrome = globalThis.chrome;
  const originalEasyTweetBlockContent = globalThis.EasyTweetBlockContent;
  const originalSetTimeout = globalThis.setTimeout;
  const progressMessages = [];
  let sendMessageCalls = 0;

  globalThis.chrome = {
    runtime: {
      sendMessage(message) {
        progressMessages.push(message);
        return Promise.resolve();
      }
    }
  };
  globalThis.EasyTweetBlockContent = {
    async blockFollowerCandidatesViaApi(candidates, options) {
      options.onProgress({
        completed: 0,
        delayMs: options.delayMs,
        failureCount: 0,
        phase: 'started',
        successCount: 0,
        total: candidates.length
      });
      options.onProgress({
        candidate: candidates[0],
        completed: 1,
        currentIndex: 1,
        delayMs: options.delayMs,
        failureCount: 0,
        phase: 'blocked',
        successCount: 1,
        total: candidates.length
      });

      return [{ ok: true, restId: '1', username: 'alice' }];
    },
    finishFollowerRun() {},
    startFollowerRun(runId) {
      return {
        controller: null,
        runId,
        signal: null
      };
    }
  };
  globalThis.setTimeout = (callback) => {
    callback();
    return 0;
  };

  t.after(() => {
    if (originalChrome === undefined) {
      delete globalThis.chrome;
    } else {
      globalThis.chrome = originalChrome;
    }

    if (originalEasyTweetBlockContent === undefined) {
      delete globalThis.EasyTweetBlockContent;
    } else {
      globalThis.EasyTweetBlockContent = originalEasyTweetBlockContent;
    }

    globalThis.setTimeout = originalSetTimeout;
  });

  const extensionApi = {
    runtime: {},
    scripting: {
      async executeScript(options) {
        if (Array.isArray(options.files)) {
          return [];
        }

        return [{ result: await options.func(...options.args) }];
      },
      async insertCSS() {
        return [];
      }
    },
    tabs: {
      async sendMessage() {
        sendMessageCalls += 1;
        throw new Error('Could not establish connection. Receiving end does not exist.');
      }
    }
  };

  const response = await requestFollowerBlocks(
    33,
    [{ restId: '1', username: 'alice' }],
    1400,
    extensionApi,
    'run-1'
  );

  assert.deepEqual(response, {
    ok: true,
    results: [{ ok: true, restId: '1', username: 'alice' }]
  });
  assert.equal(sendMessageCalls, 2);
  assert.deepEqual(progressMessages, [
    {
      progress: {
        completed: 0,
        delayMs: 1400,
        failureCount: 0,
        phase: 'started',
        successCount: 0,
        total: 1
      },
      runId: 'run-1',
      type: FOLLOWERS_BLOCK_PROGRESS_MESSAGE_TYPE
    },
    {
      progress: {
        candidate: { restId: '1', username: 'alice' },
        completed: 1,
        currentIndex: 1,
        delayMs: 1400,
        failureCount: 0,
        phase: 'blocked',
        successCount: 1,
        total: 1
      },
      runId: 'run-1',
      type: FOLLOWERS_BLOCK_PROGRESS_MESSAGE_TYPE
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
    async getStoredUsernameListState() {
      return {
        activeList: {
          id: 'blocklist',
          name: 'Blocklist',
          usernames: ['alice', 'bob']
        },
        activeListId: 'blocklist',
        lists: [{
          id: 'blocklist',
          name: 'Blocklist',
          usernames: ['alice', 'bob']
        }]
      };
    }
  };
  const settings = {
    ...sharedSettings,
    async getStoredBatchBlockDelayMs() {
      return 1400;
    },
    async getStoredPageBlockButtonStyles() {
      return {
        [sharedSettings.PAGE_BUTTON_STYLE_SURFACES.tweet]: sharedSettings.PAGE_BLOCK_BUTTON_STYLES.text,
        [sharedSettings.PAGE_BUTTON_STYLE_SURFACES.profile]: sharedSettings.PAGE_BLOCK_BUTTON_STYLES.icon,
        [sharedSettings.PAGE_BUTTON_STYLE_SURFACES.userCell]: sharedSettings.PAGE_BLOCK_BUTTON_STYLES.text
      };
    },
    async getStoredUserCellAddButtonStyle() {
      return sharedSettings.PAGE_BLOCK_BUTTON_STYLES.icon;
    },
    async getStoredUserCellAddButtonVisibility() {
      return false;
    }
  };

  init(documentRef, { runtime: {}, tabs: {} }, blocklist, sharedFollowers, settings);

  assert.equal(elements['popup-shell'].dataset.view, POPUP_VIEWS.main);
  await flushAsyncWork();

  assert.equal(elements['username-blocklist'].value, '@alice\n@bob');
  assert.equal(elements['username-count'].textContent, '2 usernames');
  assert.equal(elements['batch-block-delay-ms'].value, '1400');
  assert.equal(elements['followers-block-limit'].value, String(sharedFollowers.DEFAULT_FOLLOWERS_BLOCK_LIMIT));
  assert.equal(elements['followers-scan-limit'].value, String(sharedFollowers.DEFAULT_FOLLOWERS_SCAN_LIMIT));
  assert.equal(elements['page-button-style-tweet-text'].dataset.active, 'true');
  assert.equal(elements['page-button-style-tweet-icon'].dataset.active, 'false');
  assert.equal(elements['page-button-style-profile-icon'].dataset.active, 'true');
  assert.equal(elements['page-button-style-profile-text'].dataset.active, 'false');
  assert.equal(elements['page-button-style-user-cell-text'].dataset.active, 'true');
  assert.equal(elements['page-button-style-user-cell-icon'].dataset.active, 'false');
  assert.equal(elements['user-cell-add-button-style-icon'].dataset.active, 'true');
  assert.equal(elements['user-cell-add-button-style-text'].dataset.active, 'false');
  assert.equal(elements['show-user-cell-add-button'].checked, false);
  assert.equal(elements.status.textContent, 'Save usernames for later, or block the whole list immediately through any open X tab.');

  elements['open-settings'].click();
  assert.equal(elements['popup-shell'].dataset.view, POPUP_VIEWS.settings);

  elements['batch-block-delay-ms'].value = '10500';
  elements['batch-block-delay-ms'].change();
  assert.equal(elements['batch-block-delay-ms'].value, '10000');
  elements['page-button-style-tweet-icon'].click();
  assert.equal(elements['page-button-style-tweet-icon'].dataset.active, 'true');
  assert.equal(elements['page-button-style-tweet-text'].dataset.active, 'false');

  elements['back-to-main'].click();
  assert.equal(elements['popup-shell'].dataset.view, POPUP_VIEWS.main);
  assert.equal(elements['batch-block-delay-ms'].value, '1400');
  assert.equal(elements['page-button-style-tweet-text'].dataset.active, 'true');
  assert.equal(elements['page-button-style-profile-icon'].dataset.active, 'true');
  assert.equal(elements['page-button-style-user-cell-text'].dataset.active, 'true');
  assert.equal(elements['user-cell-add-button-style-icon'].dataset.active, 'true');
  assert.equal(elements['show-user-cell-add-button'].checked, false);

  elements['open-followers'].click();
  assert.equal(elements['popup-shell'].dataset.view, POPUP_VIEWS.followers);
  elements['back-from-followers'].click();
  assert.equal(elements['popup-shell'].dataset.view, POPUP_VIEWS.main);
});

test('init renders a fatal error when the injected follower scan session API is missing', () => {
  const { documentRef } = createPopupDocument();

  init(documentRef, { runtime: {}, tabs: {} }, sharedBlocklist, sharedFollowers, sharedSettings, null);

  assert.equal(documentRef.body.textContent.includes('Missing Easy TweetBlock follower scan session API.'), true);
});

test('init restores the active follower scan session from extension storage and keeps username draft state in localStorage', async (t) => {
  const originalLocalStorage = globalThis.localStorage;
  const storage = createLocalStorageStub();
  const extensionApi = createStorageExtensionApi({
    [sharedBlocklist.ACTIVE_USERNAME_LIST_ID_STORAGE_KEY]: 'blocklist',
    [sharedFollowerScanSessions.FOLLOWER_SCAN_SESSION_STORAGE_KEY]: {
      version: 1,
      activeSession: createStoredFollowerScanSession({
        hasMorePages: true,
        readyCandidates: [{ restId: '101', username: 'alice', attempts: 0, lastError: null }],
        totals: {
          scanned: 5,
          alreadyBlocked: 1,
          blockedSuccess: 2,
          blockedFailed: 0,
          abandonedFailed: 0
        }
      })
    },
    [sharedBlocklist.USERNAME_LISTS_STORAGE_KEY]: [
      { id: 'blocklist', name: 'Blocklist', usernames: ['saveduser'] }
    ]
  });

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
    followersScanLimit: 80,
    statusMessage: 'Preview ready: 1 followers can be blocked from @targetuser.',
    usernameDrafts: {
      blocklist: {
        baseText: '@saveduser',
        text: '@draftuser'
      }
    },
    view: POPUP_VIEWS.followers
  }, storage);

  const { documentRef, elements } = createPopupDocument();

  init(documentRef, extensionApi, {
    ...sharedBlocklist,
  }, sharedFollowers, sharedSettings, sharedFollowerScanSessions);
  await flushAsyncWork();
  await flushAsyncWork();

  assert.equal(elements['popup-shell'].dataset.view, POPUP_VIEWS.followers);
  assert.equal(elements['username-blocklist'].value, '@draftuser');
  assert.equal(elements['username-count'].textContent, '1 username');
  assert.equal(elements['followers-block-limit'].value, '25');
  assert.equal(elements['followers-scan-limit'].value, '80');
  assert.equal(elements['followers-preview'].textContent, '@alice');
  assert.equal(elements['followers-summary'].textContent.includes('Scanned 5 followers from @targetuser'), true);
  assert.equal(elements['followers-summary'].textContent.includes('Blocked this session: 2'), true);
  assert.equal(elements.status.textContent, 'Save usernames for later, or block the whole list immediately through any open X tab.');
  assert.equal(elements['block-follower-candidates'].disabled, false);
  assert.equal(elements['scan-followers-preview-label'].textContent, 'Resume scan');
  assert.equal(elements['scan-followers-preview'].disabled, false);

  elements['username-blocklist'].value = '@changeduser';
  elements['username-blocklist'].dispatch('input');
  assert.equal(loadStoredPopupState(storage).usernameDrafts.blocklist.text, '@changeduser');
  assert.equal(loadStoredPopupState(storage).followersPreviews, undefined);
  assert.equal(loadStoredPopupState(storage).followersPreview, undefined);
});

test('init disables scanning when the stored session has ready candidates but no continuation left', async () => {
  const extensionApi = createStorageExtensionApi({
    [sharedFollowerScanSessions.FOLLOWER_SCAN_SESSION_STORAGE_KEY]: {
      version: 1,
      activeSession: createStoredFollowerScanSession({
        hasMorePages: false,
        pendingUsers: [],
        readyCandidates: [{ restId: '101', username: 'alice', attempts: 0, lastError: null }]
      })
    }
  });
  const { documentRef, elements } = createPopupDocument();

  init(documentRef, extensionApi, sharedBlocklist, sharedFollowers, sharedSettings, sharedFollowerScanSessions);
  await flushAsyncWork();
  await flushAsyncWork();

  assert.equal(elements['scan-followers-preview-label'].textContent, 'Scan');
  assert.equal(elements['scan-followers-preview'].disabled, true);
});

test('init resumes a stored follower scan session by sending the rebuilt resume state and merging the new batch', async () => {
  const { documentRef, elements } = createPopupDocument();
  const messages = [];
  const blocklist = sharedBlocklist;
  const extensionApi = createStorageExtensionApi({
    [sharedFollowerScanSessions.FOLLOWER_SCAN_SESSION_STORAGE_KEY]: {
      version: 1,
      activeSession: createStoredFollowerScanSession({
        dedupe: {
          alreadyBlockedKeys: ['id:301', 'username:carol']
        },
        hasMorePages: true,
        nextCursor: 'cursor-resume',
        pendingUsers: [{ restId: '202', username: 'bob', blocking: false }],
        readyCandidates: [{ restId: '101', username: 'alice', attempts: 0, lastError: null }],
        totals: {
          scanned: 5,
          alreadyBlocked: 1,
          blockedSuccess: 2,
          blockedFailed: 0,
          abandonedFailed: 0
        }
      })
    }
  });

  extensionApi.runtime = {};
  extensionApi.tabs = {
    async query(queryInfo) {
      if (queryInfo.active) {
        return [{ id: 51, url: 'https://x.com/targetuser/followers' }];
      }

      return [];
    },
    async sendMessage(tabId, message) {
      messages.push({ message, tabId });

      return {
        ok: true,
        preview: {
          alreadyBlockedCount: 1,
          blockLimit: 25,
          candidates: [{ restId: '404', username: 'dave' }],
          hasMorePages: true,
          readyCount: 1,
          resumeState: {
            alreadyBlockedKeys: ['id:301', 'username:carol', 'id:505', 'username:eve'],
            hasMorePages: true,
            nextCursor: 'cursor-next',
            pendingUsers: [{ restId: '505', username: 'eve', blocking: false }]
          },
          scanLimit: 80,
          scannedCount: 2,
          source: 'followers',
          targetRestId: '999',
          targetScreenName: 'targetuser'
        }
      };
    }
  };

  init(documentRef, extensionApi, blocklist, sharedFollowers, sharedSettings, sharedFollowerScanSessions);
  await flushAsyncWork();
  await flushAsyncWork();

  elements['open-followers'].click();
  elements['followers-block-limit'].value = '25';
  elements['followers-scan-limit'].value = '80';
  elements['scan-followers-preview'].click();
  await flushAsyncWork();
  await flushAsyncWork();

  assert.equal(messages.length, 1);
  assert.equal(messages[0].tabId, 51);
  assert.deepEqual(messages[0].message.options, {
    blockLimit: 25,
    resumeState: {
      alreadyBlockedKeys: ['id:301', 'username:carol'],
      existingReadyCount: 1,
      existingReadyKeys: ['id:101', 'username:alice'],
      hasMorePages: true,
      nextCursor: 'cursor-resume',
      pendingUsers: [{ restId: '202', username: 'bob', blocking: false }]
    },
    scanLimit: 80,
    source: 'followers'
  });
  assert.equal(getToastText(elements), 'Preview ready: 2 followers can be blocked from @targetuser.');
  assert.equal(elements['followers-preview'].textContent, '@alice\n@dave');
  assert.equal(elements['followers-summary'].textContent, 'Scanned 7 followers from @targetuser. Already blocked: 2. Blocked this session: 2. Ready: 2. More followers remain beyond this preview.');
  assert.equal(elements['scan-followers-preview-label'].textContent, 'Resume scan');
  assert.deepEqual(extensionApi.store[sharedFollowerScanSessions.FOLLOWER_SCAN_SESSION_STORAGE_KEY].activeSession.readyCandidates, [
    { restId: '101', username: 'alice', attempts: 0, lastError: null },
    { restId: '404', username: 'dave', attempts: 0, lastError: null }
  ]);
  assert.deepEqual(extensionApi.store[sharedFollowerScanSessions.FOLLOWER_SCAN_SESSION_STORAGE_KEY].activeSession.totals, {
    scanned: 7,
    alreadyBlocked: 2,
    blockedSuccess: 2,
    blockedFailed: 0,
    abandonedFailed: 0
  });
  assert.deepEqual(extensionApi.store[sharedFollowerScanSessions.FOLLOWER_SCAN_SESSION_STORAGE_KEY].activeSession.pendingUsers, [
    { restId: '505', username: 'eve', blocking: false }
  ]);
  assert.equal(extensionApi.store[sharedFollowerScanSessions.FOLLOWER_SCAN_SESSION_STORAGE_KEY].activeSession.nextCursor, 'cursor-next');
});

test('init retries from the top when a saved follower scan continuation is invalid', async () => {
  const { elements, extensionApi, messages } = await runStaleContinuationRetryScan({
    initialSessionOverrides: {
      readyCandidates: [{ restId: '101', username: 'alice', attempts: 0, lastError: null }]
    },
    retryPreview: {
      candidates: [{ restId: '303', username: 'charlie' }],
      hasMorePages: true,
      readyCount: 1,
      resumeState: {
        hasMorePages: true,
        nextCursor: 'cursor-fresh',
        pendingUsers: [{ restId: '404', username: 'dave', blocking: false }]
      }
    }
  });

  assert.equal(messages.length, 2);
  assert.equal(messages[0].tabId, 52);
  assert.deepEqual(messages[0].message.options.resumeState, {
    alreadyBlockedKeys: ['id:301'],
    existingReadyCount: 1,
    existingReadyKeys: ['id:101', 'username:alice'],
    hasMorePages: true,
    nextCursor: 'cursor-stale',
    pendingUsers: [{ restId: '202', username: 'bob', blocking: false }]
  });
  assert.deepEqual(messages[1].message.options.resumeState, {
    alreadyBlockedKeys: ['id:301'],
    existingReadyCount: 1,
    existingReadyKeys: ['id:101', 'username:alice'],
    hasMorePages: true,
    nextCursor: null,
    pendingUsers: []
  });
  assert.equal(getToastText(elements), 'Saved scan position was invalid. Started a fresh scan from the top. Preview ready: 2 followers can be blocked from @targetuser.');
  assert.equal(elements['followers-preview'].textContent, '@alice\n@charlie');
  assert.deepEqual(extensionApi.store[sharedFollowerScanSessions.FOLLOWER_SCAN_SESSION_STORAGE_KEY].activeSession.readyCandidates, [
    { restId: '101', username: 'alice', attempts: 0, lastError: null },
    { restId: '303', username: 'charlie', attempts: 0, lastError: null }
  ]);
  assert.deepEqual(extensionApi.store[sharedFollowerScanSessions.FOLLOWER_SCAN_SESSION_STORAGE_KEY].activeSession.pendingUsers, [
    { restId: '404', username: 'dave', blocking: false }
  ]);
  assert.equal(extensionApi.store[sharedFollowerScanSessions.FOLLOWER_SCAN_SESSION_STORAGE_KEY].activeSession.nextCursor, 'cursor-fresh');
});

for (const {
  expectedToast,
  initialSessionOverrides,
  retryPreview,
  testName
} of [
  {
    expectedToast: 'Saved scan position was invalid. Started a fresh scan from the top. Scan complete. No block-ready followers found in this pass. Continue scanning for the next batch.',
    initialSessionOverrides: {},
    retryPreview: {
      hasMorePages: true,
      resumeState: {
        hasMorePages: true,
        nextCursor: 'cursor-fresh',
        pendingUsers: [{ restId: '404', username: 'dave', blocking: false }]
      }
    },
    testName: 'init prefixes the stale continuation warning when a fresh retry finds no ready followers but more pages remain'
  },
  {
    expectedToast: 'Saved scan position was invalid. Started a fresh scan from the top. Scan complete. No block-ready followers found within 80 scanned accounts.',
    initialSessionOverrides: {
      pendingUsers: []
    },
    retryPreview: {
      hasMorePages: false
    },
    testName: 'init prefixes the stale continuation warning when a fresh retry finds no ready followers within the scan limit'
  }
]) {
  test(testName, async () => {
    const { elements, messages } = await runStaleContinuationRetryScan({
      initialSessionOverrides,
      retryPreview
    });

    assert.equal(messages.length, 2);
    assert.equal(getToastText(elements), expectedToast);
  });
}

test('init clears the active follower scan session when the block limit changes', async () => {
  const extensionApi = createStorageExtensionApi({
    [sharedFollowerScanSessions.FOLLOWER_SCAN_SESSION_STORAGE_KEY]: {
      version: 1,
      activeSession: createStoredFollowerScanSession({
        hasMorePages: true,
        readyCandidates: [{ restId: '101', username: 'alice', attempts: 0, lastError: null }],
        totals: {
          scanned: 5,
          alreadyBlocked: 1,
          blockedSuccess: 0,
          blockedFailed: 0,
          abandonedFailed: 0
        }
      })
    }
  });
  const { documentRef, elements } = createPopupDocument();

  init(documentRef, extensionApi, sharedBlocklist, sharedFollowers, sharedSettings, sharedFollowerScanSessions);
  await flushAsyncWork();
  await flushAsyncWork();

  elements['open-followers'].click();
  assert.equal(elements['followers-preview'].textContent, '@alice');

  elements['followers-block-limit'].value = '30';
  elements['followers-block-limit'].change();
  await flushAsyncWork();
  await flushAsyncWork();

  assert.equal(extensionApi.store[sharedFollowerScanSessions.FOLLOWER_SCAN_SESSION_STORAGE_KEY].activeSession, null);
  assert.equal(elements['followers-summary'].textContent, 'Preview cleared. Run a new scan with the updated limits.');
  assert.equal(elements['followers-preview'].textContent, '');
  assert.equal(elements['block-follower-candidates'].disabled, true);
});

test('init keeps scan and block actions fenced while a follower session reset is still persisting', async () => {
  const { documentRef, elements } = createPopupDocument();
  const clearDeferred = createDeferred();
  const messages = [];
  let deferredClearConsumed = false;
  const extensionApi = createStorageExtensionApi({
    [sharedFollowerScanSessions.FOLLOWER_SCAN_SESSION_STORAGE_KEY]: {
      version: 1,
      activeSession: createStoredFollowerScanSession({
        hasMorePages: true,
        readyCandidates: [{ restId: '101', username: 'alice', attempts: 0, lastError: null }],
        totals: {
          scanned: 5,
          alreadyBlocked: 1,
          blockedSuccess: 0,
          blockedFailed: 0,
          abandonedFailed: 0
        }
      })
    }
  }, {
    onSet({ payload }) {
      const nextSessionStore = payload[sharedFollowerScanSessions.FOLLOWER_SCAN_SESSION_STORAGE_KEY];

      if (!deferredClearConsumed && nextSessionStore?.activeSession === null) {
        deferredClearConsumed = true;
        return clearDeferred.promise;
      }

      return null;
    }
  });

  extensionApi.tabs = {
    async query(queryInfo) {
      if (queryInfo.active) {
        return [{ id: 77, url: 'https://x.com/targetuser/followers' }];
      }

      return [];
    },
    async sendMessage(tabId, message) {
      messages.push({ message, tabId });

      return {
        ok: true,
        preview: {
          alreadyBlockedCount: 0,
          blockLimit: 30,
          candidates: [{ restId: '303', username: 'charlie' }],
          hasMorePages: false,
          readyCount: 1,
          resumeState: {
            alreadyBlockedKeys: [],
            hasMorePages: false,
            nextCursor: null,
            pendingUsers: []
          },
          scanLimit: 80,
          scannedCount: 1,
          source: 'followers',
          targetRestId: '999',
          targetScreenName: 'targetuser'
        }
      };
    }
  };

  init(documentRef, extensionApi, sharedBlocklist, sharedFollowers, sharedSettings, sharedFollowerScanSessions);
  await flushAsyncWork();
  await flushAsyncWork();

  elements['open-followers'].click();
  assert.equal(elements['followers-preview'].textContent, '@alice');

  elements['followers-block-limit'].value = '30';
  elements['followers-block-limit'].change();
  await flushAsyncWork();
  await flushAsyncWork();

  assert.equal(elements['scan-followers-preview'].disabled, true);
  assert.equal(elements['followers-block-limit'].disabled, true);
  assert.equal(elements['followers-scan-limit'].disabled, true);

  elements['scan-followers-preview'].click();
  elements['block-follower-candidates'].click();
  await flushAsyncWork();
  await flushAsyncWork();

  assert.equal(messages.length, 0);
  clearDeferred.resolve();
  await flushAsyncWork();
  await flushAsyncWork();

  assert.equal(extensionApi.store[sharedFollowerScanSessions.FOLLOWER_SCAN_SESSION_STORAGE_KEY].activeSession, null);
  assert.equal(elements['followers-summary'].textContent, 'Preview cleared. Run a new scan with the updated limits.');
  assert.equal(elements['scan-followers-preview'].disabled, false);

  elements['scan-followers-preview'].click();
  await flushAsyncWork();
  await flushAsyncWork();

  assert.equal(messages.length, 1);
  assert.equal(extensionApi.store[sharedFollowerScanSessions.FOLLOWER_SCAN_SESSION_STORAGE_KEY].activeSession.blockLimit, 30);
  assert.equal(elements['followers-preview'].textContent, '@charlie');
});

test('init ignores legacy popup preview persistence during hydration and evicts it on the next popup-state write', async (t) => {
  const originalLocalStorage = globalThis.localStorage;
  const storage = createLocalStorageStub();
  const extensionApi = createStorageExtensionApi();

  globalThis.localStorage = storage;
  t.after(() => {
    if (originalLocalStorage === undefined) {
      delete globalThis.localStorage;
      return;
    }

    globalThis.localStorage = originalLocalStorage;
  });

  saveStoredPopupState({
    followersPreview: {
      alreadyBlockedCount: 1,
      blockLimit: 25,
      candidates: [{ restId: '101', username: 'alice' }],
      hasMorePages: false,
      readyCount: 1,
      scanLimit: 80,
      scannedCount: 5,
      source: 'followers',
      targetRestId: '999',
      targetScreenName: 'targetuser'
    },
    followersPreviews: {
      followers: {
        alreadyBlockedCount: 1,
        blockLimit: 25,
        candidates: [{ restId: '101', username: 'alice' }],
        hasMorePages: false,
        readyCount: 1,
        savedAt: Date.now(),
        scanLimit: 80,
        scannedCount: 5,
        source: 'followers',
        targetRestId: '999',
        targetScreenName: 'targetuser'
      },
      following: null
    },
    followersSource: 'followers',
    view: POPUP_VIEWS.followers
  }, storage);

  const { documentRef, elements } = createPopupDocument();

  init(documentRef, extensionApi, sharedBlocklist, sharedFollowers, sharedSettings, sharedFollowerScanSessions);
  await flushAsyncWork();

  assert.equal(elements['popup-shell'].dataset.view, POPUP_VIEWS.followers);
  assert.equal(elements['followers-preview'].textContent, '');
  assert.equal(elements['followers-summary'].textContent, 'Open a profile, followers, or following page in the active X tab, then run a preview scan.');
  assert.equal(elements['block-follower-candidates'].disabled, true);
  assert.equal(loadStoredPopupState(storage).followersPreviews, undefined);
  assert.equal(loadStoredPopupState(storage).followersPreview, undefined);
});

test('init clear list only updates the local draft until the user saves', async (t) => {
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

  const extensionApi = createStorageExtensionApi({
    [sharedBlocklist.ACTIVE_USERNAME_LIST_ID_STORAGE_KEY]: 'blocklist',
    [sharedBlocklist.USERNAME_LISTS_STORAGE_KEY]: [
      { id: 'blocklist', name: 'Blocklist', usernames: ['alice', 'bob'] }
    ]
  });
  const { documentRef, elements } = createPopupDocument();

  init(documentRef, extensionApi, sharedBlocklist, sharedFollowers);
  await flushAsyncWork();
  await flushAsyncWork();

  assert.equal(elements['username-blocklist'].value, '@alice\n@bob');

  elements['clear-list'].click();

  assert.equal(elements['username-blocklist'].value, '');
  assert.equal(elements['username-count'].textContent, '0 usernames');
  assert.deepEqual(extensionApi.store[sharedBlocklist.USERNAME_LISTS_STORAGE_KEY][0].usernames, ['alice', 'bob']);
  assert.deepEqual(loadStoredPopupState(storage).usernameDrafts.blocklist, {
    baseText: '@alice\n@bob',
    text: ''
  });
  assert.equal(elements.status.textContent, 'Save usernames for later, or block the whole list immediately through any open X tab.');
  assert.equal(getToastText(elements), 'List cleared. Click Save list to save this change.');
});

test('init loads, switches, saves, creates, renames, and deletes username lists', async (t) => {
  const originalPrompt = globalThis.prompt;
  const originalConfirm = globalThis.confirm;
  const promptResponses = ['VIP', 'VIP renamed'];
  globalThis.prompt = () => promptResponses.shift();
  globalThis.confirm = () => true;
  t.after(() => {
    if (originalPrompt === undefined) {
      delete globalThis.prompt;
    } else {
      globalThis.prompt = originalPrompt;
    }

    if (originalConfirm === undefined) {
      delete globalThis.confirm;
    } else {
      globalThis.confirm = originalConfirm;
    }
  });

  const extensionApi = createStorageExtensionApi({
    [sharedBlocklist.ACTIVE_USERNAME_LIST_ID_STORAGE_KEY]: 'second',
    [sharedBlocklist.USERNAME_LISTS_STORAGE_KEY]: [
      { id: 'first', name: 'First', usernames: ['alice'] },
      { id: 'second', name: 'Second', usernames: ['bob'] }
    ]
  });
  const { documentRef, elements } = createPopupDocument();

  init(documentRef, extensionApi, sharedBlocklist);
  await flushAsyncWork();
  await flushAsyncWork();

  assert.equal(elements['username-list-select'].value, 'second');
  assert.equal(elements['username-blocklist'].value, '@bob');

  elements['username-list-select'].value = 'first';
  elements['username-list-select'].change();
  await flushAsyncWork();
  await flushAsyncWork();

  assert.equal(elements['username-blocklist'].value, '@alice');
  elements['username-blocklist'].value = '@Alice @Charlie';
  elements['save-blocklist'].click();
  await flushAsyncWork();
  await flushAsyncWork();
  assert.deepEqual(extensionApi.store[sharedBlocklist.USERNAME_LISTS_STORAGE_KEY][0].usernames, ['alice', 'charlie']);

  elements['new-username-list'].click();
  await flushAsyncWork();
  await flushAsyncWork();
  assert.equal(extensionApi.store[sharedBlocklist.ACTIVE_USERNAME_LIST_ID_STORAGE_KEY], 'vip');
  assert.equal(elements['username-list-select'].value, 'vip');

  elements['rename-username-list'].click();
  await flushAsyncWork();
  await flushAsyncWork();
  assert.equal(extensionApi.store[sharedBlocklist.USERNAME_LISTS_STORAGE_KEY].find((list) => list.id === 'vip').name, 'VIP renamed');

  elements['delete-username-list'].click();
  await flushAsyncWork();
  await flushAsyncWork();
  assert.equal(extensionApi.store[sharedBlocklist.USERNAME_LISTS_STORAGE_KEY].some((list) => list.id === 'vip'), false);
  assert.notEqual(extensionApi.store[sharedBlocklist.ACTIVE_USERNAME_LIST_ID_STORAGE_KEY], 'vip');
});

test('init custom username list dropdown opens and switches the active list by option click', async () => {
  const extensionApi = createStorageExtensionApi({
    [sharedBlocklist.ACTIVE_USERNAME_LIST_ID_STORAGE_KEY]: 'second',
    [sharedBlocklist.USERNAME_LISTS_STORAGE_KEY]: [
      { id: 'first', name: 'First', usernames: ['alice'] },
      { id: 'second', name: 'Second', usernames: ['bob'] }
    ]
  });
  const { documentRef, elements } = createPopupDocument();

  init(documentRef, extensionApi, sharedBlocklist);
  await flushAsyncWork();
  await flushAsyncWork();

  elements['username-list-select'].click();

  assert.equal(elements['username-list-options'].hidden, false);
  assert.equal(elements['username-list-options'].children.length, 2);
  assert.equal(elements['username-list-options'].children[0].textContent, 'First');
  assert.equal(elements['username-list-options'].children[1].textContent, 'Second');

  elements['username-list-options'].children[0].click();
  await flushAsyncWork();
  await flushAsyncWork();

  assert.equal(extensionApi.store[sharedBlocklist.ACTIVE_USERNAME_LIST_ID_STORAGE_KEY], 'first');
  assert.equal(elements['username-list-select'].value, 'first');
  assert.equal(elements['username-list-select'].textContent, 'First');
  assert.equal(elements['username-blocklist'].value, '@alice');
  assert.equal(elements['username-list-options'].hidden, true);
});

test('init preserves a dirty username draft while renaming the active list', async (t) => {
  const originalLocalStorage = globalThis.localStorage;
  const originalPrompt = globalThis.prompt;
  const storage = createLocalStorageStub();
  globalThis.localStorage = storage;
  globalThis.prompt = () => 'Renamed blocklist';
  t.after(() => {
    if (originalLocalStorage === undefined) {
      delete globalThis.localStorage;
    } else {
      globalThis.localStorage = originalLocalStorage;
    }

    if (originalPrompt === undefined) {
      delete globalThis.prompt;
    } else {
      globalThis.prompt = originalPrompt;
    }
  });
  const extensionApi = createStorageExtensionApi({
    [sharedBlocklist.ACTIVE_USERNAME_LIST_ID_STORAGE_KEY]: 'blocklist',
    [sharedBlocklist.USERNAME_LISTS_STORAGE_KEY]: [
      { id: 'blocklist', name: 'Blocklist', usernames: ['alice'] }
    ]
  });
  const { documentRef, elements } = createPopupDocument();

  init(documentRef, extensionApi, sharedBlocklist);
  await flushAsyncWork();
  await flushAsyncWork();

  elements['username-blocklist'].value = '@alice\n@bob';
  elements['username-blocklist'].dispatch('input');
  elements['rename-username-list'].click();
  await flushAsyncWork();
  await flushAsyncWork();

  assert.equal(extensionApi.store[sharedBlocklist.USERNAME_LISTS_STORAGE_KEY][0].name, 'Renamed blocklist');
  assert.equal(elements['username-blocklist'].value, '@alice\n@bob');
  assert.equal(loadStoredPopupState(storage).usernameDrafts.blocklist.text, '@alice\n@bob');
  assert.equal(elements.status.textContent, 'Save usernames for later, or block the whole list immediately through any open X tab.');
  assert.equal(getToastText(elements), 'Renamed list to Renamed blocklist.');
});

test('init imports usernames into the active list and JSON lists by name', async () => {
  const extensionApi = createStorageExtensionApi({
    [sharedBlocklist.ACTIVE_USERNAME_LIST_ID_STORAGE_KEY]: 'blocklist',
    [sharedBlocklist.USERNAME_LISTS_STORAGE_KEY]: [
      { id: 'blocklist', name: 'Blocklist', usernames: ['alice'] }
    ]
  });
  const { documentRef, elements } = createPopupDocument();

  init(documentRef, extensionApi, sharedBlocklist);
  await flushAsyncWork();
  await flushAsyncWork();

  elements['import-usernames-file'].files = [{
    name: 'names.csv',
    text: () => Promise.resolve('@Bob,bad-name,Alice')
  }];
  elements['import-usernames-file'].change();
  await flushAsyncWork();
  await flushAsyncWork();

  assert.deepEqual(extensionApi.store[sharedBlocklist.USERNAME_LISTS_STORAGE_KEY][0].usernames, ['alice', 'bob']);
  assert.equal(elements.status.textContent, 'Save usernames for later, or block the whole list immediately through any open X tab.');
  assert.equal(getToastText(elements), 'Imported 2 usernames into Blocklist. Skipped invalid values: bad-name.');

  elements['import-usernames-file'].files = [{
    name: 'lists.json',
    text: () => Promise.resolve('{"lists":[{"name":"Blocklist","usernames":["Charlie"]},{"name":"VIP","usernames":["Dana"]}]}')
  }];
  elements['import-usernames-file'].change();
  await flushAsyncWork();
  await flushAsyncWork();

  assert.deepEqual(extensionApi.store[sharedBlocklist.USERNAME_LISTS_STORAGE_KEY], [
    { id: 'blocklist', name: 'Blocklist', usernames: ['alice', 'bob', 'charlie'] },
    { id: 'vip', name: 'VIP', usernames: ['dana'] }
  ]);
});

test('init imports usernames without dropping external active-list additions', async () => {
  const extensionApi = createStorageExtensionApi({
    [sharedBlocklist.ACTIVE_USERNAME_LIST_ID_STORAGE_KEY]: 'blocklist',
    [sharedBlocklist.USERNAME_LISTS_STORAGE_KEY]: [
      { id: 'blocklist', name: 'Blocklist', usernames: ['alice'] }
    ]
  });
  const { documentRef, elements } = createPopupDocument();

  init(documentRef, extensionApi, sharedBlocklist);
  await flushAsyncWork();
  await flushAsyncWork();

  elements['username-blocklist'].value = '@alice\n@bob';
  elements['username-blocklist'].dispatch('input');

  await sharedBlocklist.addUsernameToActiveList('Carol', extensionApi);
  await flushAsyncWork();
  await flushAsyncWork();

  elements['import-usernames-file'].files = [{
    name: 'names.csv',
    text: () => Promise.resolve('@Dana,bad-name')
  }];
  elements['import-usernames-file'].change();
  await flushAsyncWork();
  await flushAsyncWork();

  assert.deepEqual(extensionApi.store[sharedBlocklist.USERNAME_LISTS_STORAGE_KEY][0].usernames, ['alice', 'carol', 'bob', 'dana']);
  assert.equal(elements['username-blocklist'].value, '@alice\n@carol\n@bob\n@dana');
  assert.equal(elements['username-count'].textContent, '4 usernames');
  assert.equal(elements.status.textContent, 'Save usernames for later, or block the whole list immediately through any open X tab.');
  assert.equal(getToastText(elements), 'Imported 1 username into Blocklist. Skipped invalid values: bad-name.');
});

test('init protects incompatible drafts and reacts to external list changes', async (t) => {
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
    usernameDrafts: {
      blocklist: {
        baseText: '@old',
        text: '@stale_draft'
      }
    }
  }, storage);
  const extensionApi = createStorageExtensionApi({
    [sharedBlocklist.ACTIVE_USERNAME_LIST_ID_STORAGE_KEY]: 'blocklist',
    [sharedBlocklist.USERNAME_LISTS_STORAGE_KEY]: [
      { id: 'blocklist', name: 'Blocklist', usernames: ['alice'] }
    ]
  });
  const { documentRef, elements } = createPopupDocument();

  init(documentRef, extensionApi, sharedBlocklist);
  await flushAsyncWork();
  await flushAsyncWork();

  assert.equal(elements['username-blocklist'].value, '@alice');
  assert.equal(elements.status.textContent, 'Save usernames for later, or block the whole list immediately through any open X tab.');
  assert.equal(getToastText(elements), 'Unsaved draft was outdated; loaded the saved list.');

  await sharedBlocklist.addUsernameToActiveList('Bob', extensionApi);
  await flushAsyncWork();
  await flushAsyncWork();
  assert.equal(elements['username-blocklist'].value, '@alice\n@bob');

  elements['username-blocklist'].value = '@local_draft';
  elements['username-blocklist'].dispatch('input');
  await sharedBlocklist.addUsernameToActiveList('Charlie', extensionApi);
  await flushAsyncWork();
  await flushAsyncWork();

  assert.equal(elements['username-blocklist'].value, '@local_draft');
  assert.equal(elements.status.textContent, 'Save usernames for later, or block the whole list immediately through any open X tab.');
  assert.equal(getToastText(elements), 'The active list changed elsewhere; your unsaved edits were kept.');
});

test('init saves dirty username drafts without dropping external active-list additions', async () => {
  const extensionApi = createStorageExtensionApi({
    [sharedBlocklist.ACTIVE_USERNAME_LIST_ID_STORAGE_KEY]: 'blocklist',
    [sharedBlocklist.USERNAME_LISTS_STORAGE_KEY]: [
      { id: 'blocklist', name: 'Blocklist', usernames: ['alice'] }
    ]
  });
  const { documentRef, elements } = createPopupDocument();

  init(documentRef, extensionApi, sharedBlocklist);
  await flushAsyncWork();
  await flushAsyncWork();

  elements['username-blocklist'].value = '@alice\n@bob';
  elements['username-blocklist'].dispatch('input');

  await sharedBlocklist.addUsernameToActiveList('Carol', extensionApi);
  await flushAsyncWork();
  await flushAsyncWork();

  assert.equal(elements['username-blocklist'].value, '@alice\n@bob');
  assert.equal(elements.status.textContent, 'Save usernames for later, or block the whole list immediately through any open X tab.');
  assert.equal(getToastText(elements), 'The active list changed elsewhere; your unsaved edits were kept.');

  elements['save-blocklist'].click();
  await flushAsyncWork();
  await flushAsyncWork();

  assert.deepEqual(extensionApi.store[sharedBlocklist.USERNAME_LISTS_STORAGE_KEY][0].usernames, ['alice', 'carol', 'bob']);
  assert.equal(elements['username-blocklist'].value, '@alice\n@carol\n@bob');
  assert.equal(elements['username-count'].textContent, '3 usernames');
  assert.equal(elements.status.textContent, 'Save usernames for later, or block the whole list immediately through any open X tab.');
  assert.equal(getToastText(elements), 'Saved 3 usernames.');

  elements['username-blocklist'].value = '@carol\n@bob';
  elements['username-blocklist'].dispatch('input');
  elements['save-blocklist'].click();
  await flushAsyncWork();
  await flushAsyncWork();

  assert.deepEqual(extensionApi.store[sharedBlocklist.USERNAME_LISTS_STORAGE_KEY][0].usernames, ['carol', 'bob']);
  assert.equal(elements['username-blocklist'].value, '@carol\n@bob');
  assert.equal(elements.status.textContent, 'Save usernames for later, or block the whole list immediately through any open X tab.');
  assert.equal(getToastText(elements), 'Saved 2 usernames.');
});

test('init ignores a persisted completed follower-run status and restores the default header copy', async (t) => {
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
    statusMessage: 'Block run complete: blocked 3/3 accounts. Delay used: 1000 ms between requests.'
  }, storage);

  const { documentRef, elements } = createPopupDocument();

  init(documentRef, { runtime: {}, tabs: {} }, sharedBlocklist);
  await flushAsyncWork();

  assert.equal(elements.status.textContent, 'Save usernames for later, or block the whole list immediately through any open X tab.');
  assert.equal(getToastText(elements), '');
});

test('init ignores a persisted list CRUD status and restores the default header copy', async (t) => {
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
    statusMessage: 'Deleted list. Active list: Blocklist.'
  }, storage);

  const { documentRef, elements } = createPopupDocument();

  init(documentRef, { runtime: {}, tabs: {} }, sharedBlocklist);
  await flushAsyncWork();

  assert.equal(elements.status.textContent, 'Save usernames for later, or block the whole list immediately through any open X tab.');
  assert.equal(getToastText(elements), '');
});

test('init auto-dismisses transient popup toasts without changing the header copy', async (t) => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const scheduledCallbacks = [];

  globalThis.setTimeout = (callback) => {
    scheduledCallbacks.push(callback);
    return scheduledCallbacks.length;
  };
  globalThis.clearTimeout = () => {};
  t.after(() => {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  });

  const extensionApi = createStorageExtensionApi({
    [sharedBlocklist.ACTIVE_USERNAME_LIST_ID_STORAGE_KEY]: 'blocklist',
    [sharedBlocklist.USERNAME_LISTS_STORAGE_KEY]: [
      { id: 'blocklist', name: 'Blocklist', usernames: ['alice'] }
    ]
  });
  const { documentRef, elements } = createPopupDocument();

  init(documentRef, extensionApi, sharedBlocklist, sharedFollowers);
  await flushAsyncWork();
  await flushAsyncWork();

  elements['clear-list'].click();

  assert.equal(getToastText(elements), 'List cleared. Click Save list to save this change.');
  assert.equal(elements.status.textContent, 'Save usernames for later, or block the whole list immediately through any open X tab.');
  assert.equal(scheduledCallbacks.length > 0, true);

  scheduledCallbacks.at(-1)();

  assert.equal(getToastText(elements), '');
  assert.equal(elements.status.textContent, 'Save usernames for later, or block the whole list immediately through any open X tab.');
});

test('init saves the blocklist, disables actions while saving, and reports invalid entries', async () => {
  const { documentRef, elements } = createPopupDocument();
  const deferredSave = createDeferred();
  const persistedUsernames = [];
  const blocklist = {
    ...sharedBlocklist,
    async getStoredUsernameListState() {
      return {
        activeList: {
          id: 'blocklist',
          name: 'Blocklist',
          usernames: []
        },
        activeListId: 'blocklist',
        lists: [{
          id: 'blocklist',
          name: 'Blocklist',
          usernames: []
        }]
      };
    },
    updateUsernameListUsernames(_listId, createNextUsernames) {
      persistedUsernames.push(createNextUsernames({
        id: 'blocklist',
        name: 'Blocklist',
        usernames: []
      }));
      return deferredSave.promise;
    }
  };

  init(documentRef, { runtime: {}, tabs: {} }, blocklist);
  await flushAsyncWork();

  elements['username-blocklist'].value = '@Alice bad-name @Bob';
  elements['save-blocklist'].click();
  await flushAsyncWork();

  assert.equal(JSON.stringify(persistedUsernames), JSON.stringify([['alice', 'bob']]));
  assert.equal(elements.status.textContent, 'Save usernames for later, or block the whole list immediately through any open X tab.');
  assert.equal(getToastText(elements), 'Saving blocklist...');
  assert.equal(elements['save-blocklist'].disabled, true);
  assert.equal(elements['block-now'].disabled, true);
  assert.equal(elements['save-settings'].disabled, true);

  deferredSave.resolve({ usernames: ['alice', 'bob'] });
  await flushAsyncWork();

  assert.equal(elements['username-blocklist'].value, '@alice\n@bob');
  assert.equal(elements['username-count'].textContent, '2 usernames');
  assert.equal(elements.status.textContent, 'Save usernames for later, or block the whole list immediately through any open X tab.');
  assert.equal(getToastText(elements), 'Saved 2 usernames. Skipped invalid values: bad-name');
  assert.equal(elements['save-blocklist'].disabled, false);
  assert.equal(elements['block-now'].disabled, false);
  assert.equal(elements['save-settings'].disabled, false);
});

test('init saves settings, updates the active delay, and returns to the main view', async () => {
  const { documentRef, elements } = createPopupDocument();
  const deferredDelaySave = createDeferred();
  const deferredStylesSave = createDeferred();
  const deferredAddStyleSave = createDeferred();
  const deferredVisibilitySave = createDeferred();
  const savedDelayInputs = [];
  const savedStyles = [];
  const savedAddStyles = [];
  const savedVisibilityInputs = [];
  const blocklist = sharedBlocklist;
  const settings = {
    ...sharedSettings,
    async getStoredBatchBlockDelayMs() {
      return 1400;
    },
    async getStoredPageBlockButtonStyles() {
      return {
        [sharedSettings.PAGE_BUTTON_STYLE_SURFACES.tweet]: sharedSettings.PAGE_BLOCK_BUTTON_STYLES.icon,
        [sharedSettings.PAGE_BUTTON_STYLE_SURFACES.profile]: sharedSettings.PAGE_BLOCK_BUTTON_STYLES.icon,
        [sharedSettings.PAGE_BUTTON_STYLE_SURFACES.userCell]: sharedSettings.PAGE_BLOCK_BUTTON_STYLES.text
      };
    },
    async getStoredUserCellAddButtonStyle() {
      return sharedSettings.PAGE_BLOCK_BUTTON_STYLES.icon;
    },
    async getStoredUserCellAddButtonVisibility() {
      return true;
    },
    setStoredBatchBlockDelayMs(delayMs) {
      savedDelayInputs.push(delayMs);
      return deferredDelaySave.promise;
    },
    setStoredPageBlockButtonStyles(styles) {
      savedStyles.push(styles);
      return deferredStylesSave.promise;
    },
    setStoredUserCellAddButtonStyle(style) {
      savedAddStyles.push(style);
      return deferredAddStyleSave.promise;
    },
    setStoredUserCellAddButtonVisibility(isVisible) {
      savedVisibilityInputs.push(isVisible);
      return deferredVisibilitySave.promise;
    }
  };

  init(documentRef, { runtime: {}, tabs: {} }, blocklist, sharedFollowers, settings);
  await flushAsyncWork();

  elements['open-settings'].click();
  elements['batch-block-delay-ms'].value = '10500';
  elements['page-button-style-tweet-text'].click();
  elements['page-button-style-profile-text'].click();
  elements['page-button-style-user-cell-icon'].click();
  elements['user-cell-add-button-style-text'].click();
  elements['show-user-cell-add-button'].checked = false;
  elements['save-settings'].click();
  await flushAsyncWork();

  assert.equal(JSON.stringify(savedDelayInputs), JSON.stringify([10000]));
  assert.equal(JSON.stringify(savedStyles), JSON.stringify([{
    [sharedSettings.PAGE_BUTTON_STYLE_SURFACES.tweet]: sharedSettings.PAGE_BLOCK_BUTTON_STYLES.text,
    [sharedSettings.PAGE_BUTTON_STYLE_SURFACES.profile]: sharedSettings.PAGE_BLOCK_BUTTON_STYLES.text,
    [sharedSettings.PAGE_BUTTON_STYLE_SURFACES.userCell]: sharedSettings.PAGE_BLOCK_BUTTON_STYLES.icon
  }]));
  assert.equal(JSON.stringify(savedAddStyles), JSON.stringify([sharedSettings.PAGE_BLOCK_BUTTON_STYLES.text]));
  assert.equal(JSON.stringify(savedVisibilityInputs), JSON.stringify([false]));
  assert.equal(elements.status.textContent, 'Save usernames for later, or block the whole list immediately through any open X tab.');
  assert.equal(getToastText(elements), 'Saving settings...');
  assert.equal(elements['save-blocklist'].disabled, true);
  assert.equal(elements['block-now'].disabled, true);
  assert.equal(elements['save-settings'].disabled, true);

  deferredDelaySave.resolve(1900);
  deferredStylesSave.resolve({
    [sharedSettings.PAGE_BUTTON_STYLE_SURFACES.tweet]: sharedSettings.PAGE_BLOCK_BUTTON_STYLES.text,
    [sharedSettings.PAGE_BUTTON_STYLE_SURFACES.profile]: sharedSettings.PAGE_BLOCK_BUTTON_STYLES.text,
    [sharedSettings.PAGE_BUTTON_STYLE_SURFACES.userCell]: sharedSettings.PAGE_BLOCK_BUTTON_STYLES.icon
  });
  deferredAddStyleSave.resolve(sharedSettings.PAGE_BLOCK_BUTTON_STYLES.text);
  deferredVisibilitySave.resolve(false);
  await flushAsyncWork();

  assert.equal(elements['popup-shell'].dataset.view, POPUP_VIEWS.main);
  assert.equal(elements['batch-block-delay-ms'].value, '1900');
  assert.equal(elements['page-button-style-tweet-text'].dataset.active, 'true');
  assert.equal(elements['page-button-style-profile-text'].dataset.active, 'true');
  assert.equal(elements['page-button-style-user-cell-icon'].dataset.active, 'true');
  assert.equal(elements['user-cell-add-button-style-text'].dataset.active, 'true');
  assert.equal(elements['show-user-cell-add-button'].checked, false);
  assert.equal(elements.status.textContent, 'Save usernames for later, or block the whole list immediately through any open X tab.');
  assert.equal(getToastText(elements), 'Saved settings. Delay: 1900 ms.');
  assert.equal(elements['save-blocklist'].disabled, false);
  assert.equal(elements['block-now'].disabled, false);
  assert.equal(elements['save-settings'].disabled, false);

  elements['open-settings'].click();
  assert.equal(elements['batch-block-delay-ms'].value, '1900');
  assert.equal(elements['page-button-style-tweet-text'].dataset.active, 'true');
  assert.equal(elements['page-button-style-profile-text'].dataset.active, 'true');
  assert.equal(elements['page-button-style-user-cell-icon'].dataset.active, 'true');
  assert.equal(elements['user-cell-add-button-style-text'].dataset.active, 'true');
  assert.equal(elements['show-user-cell-add-button'].checked, false);
});

test('init blocks the saved list through an open X tab and reports failures with the saved delay', async () => {
  const { documentRef, elements } = createPopupDocument();
  const sentMessages = [];
  const blocklist = sharedBlocklist;
  const settings = {
    ...sharedSettings,
    async getStoredBatchBlockDelayMs() {
      return 1300;
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

  init(documentRef, extensionApi, blocklist, sharedFollowers, settings);
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
  assert.equal(elements.status.textContent, 'Save usernames for later, or block the whole list immediately through any open X tab.');
  assert.equal(getToastText(elements), 'Blocked 1/2 usernames with 1300 ms delay. Failed: @bob. Invalid: bad-name.');
});

test('init requires at least one valid username before blocking', async () => {
  const { documentRef, elements } = createPopupDocument();

  init(documentRef, { runtime: {}, tabs: {} }, sharedBlocklist);
  await flushAsyncWork();

  elements['username-blocklist'].value = 'bad-name';
  elements['block-now'].click();
  await flushAsyncWork();

  assert.equal(elements.status.textContent, 'Save usernames for later, or block the whole list immediately through any open X tab.');
  assert.equal(getToastText(elements), 'Add at least one valid username before blocking.');
});

test('init scans followers in the active tab and blocks only the ready preview candidates', async () => {
  const { documentRef, elements } = createPopupDocument();
  const blockDeferred = createDeferred();
  const messages = [];
  const runtimeListeners = [];
  const blocklist = sharedBlocklist;
  const settings = {
    ...sharedSettings,
    async getStoredBatchBlockDelayMs() {
      return 1100;
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
              resumeState: {
                alreadyBlockedKeys: ['id:301'],
                hasMorePages: true,
                nextCursor: 'cursor-bottom',
                pendingUsers: []
              },
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

  init(documentRef, extensionApi, blocklist, sharedFollowers, settings);
  await flushAsyncWork();

  elements['open-followers'].click();
  elements['followers-block-limit'].value = '25';
  elements['followers-scan-limit'].value = '80';
  elements['scan-followers-preview'].click();
  await flushAsyncWork();
  await flushAsyncWork();

  assert.equal(elements.status.textContent, 'Save usernames for later, or block the whole list immediately through any open X tab.');
  assert.equal(getToastText(elements), 'Preview ready: 2 followers can be blocked from @targetuser.');
  assert.equal(elements['followers-summary'].textContent, 'Scanned 5 followers from @targetuser. Already blocked: 2. Blocked this session: 0. Ready: 2. More followers remain beyond this preview.');
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

  assert.equal(elements.status.textContent, 'Save usernames for later, or block the whole list immediately through any open X tab.');
  assert.equal(getToastText(elements), 'Batch blocked. Continue scanning for the next batch.');
  assert.equal(elements['followers-progress-label'].textContent, 'Block run complete');
  assert.equal(elements['followers-progress-count'].textContent, '2/2');
  assert.equal(elements['followers-progress-detail'].textContent, 'Blocked 2/2. Failed: 0. Delay used: 1100 ms between requests.');
  assert.equal(elements['followers-summary'].textContent, 'Scanned 5 followers from @targetuser. Already blocked: 2. Blocked this session: 2. Ready: 0. More followers remain beyond this preview.');
  assert.equal(elements['followers-preview'].textContent, 'No block-ready followers are queued right now. Continue scanning for the next batch.');
  assert.equal(messages.length, 2);
  assert.equal(messages[0].tabId, 41);
  assert.deepEqual(messages[0].message.options, {
    blockLimit: 25,
    resumeState: null,
    scanLimit: 80,
    source: 'followers'
  });
  assert.equal(typeof messages[0].message.runId, 'string');
  assert.equal(messages[0].message.type, FOLLOWERS_SCAN_MESSAGE_TYPE);
  assert.equal(messages[1].tabId, 41);
  assert.deepEqual(messages[1].message.candidates, [
    { restId: '101', username: 'alice' },
    { restId: '202', username: 'bob' }
  ]);
  assert.equal(messages[1].message.delayMs, 1100);
  assert.equal(typeof messages[1].message.runId, 'string');
  assert.equal(messages[1].message.type, FOLLOWERS_BLOCK_MESSAGE_TYPE);
});

test('init counts blockedFailed by retryable candidates and abandons them after the retry cap', async () => {
  const { documentRef, elements } = createPopupDocument();
  const extensionApi = createStorageExtensionApi({
    [sharedFollowerScanSessions.FOLLOWER_SCAN_SESSION_STORAGE_KEY]: {
      version: 1,
      activeSession: createStoredFollowerScanSession({
        hasMorePages: false,
        readyCandidates: [{ restId: '101', username: 'alice', attempts: 0, lastError: null }],
        totals: {
          scanned: 5,
          alreadyBlocked: 0,
          blockedSuccess: 0,
          blockedFailed: 0,
          abandonedFailed: 0
        }
      })
    }
  });

  extensionApi.runtime = {};
  extensionApi.tabs = {
    async query(queryInfo) {
      if (queryInfo.active) {
        return [{ id: 44, url: 'https://x.com/targetuser/followers' }];
      }

      return [];
    },
    async sendMessage(_tabId, message) {
      if (message.type === FOLLOWERS_BLOCK_MESSAGE_TYPE) {
        return {
          ok: true,
          results: [{ ok: false, restId: '101', username: 'alice', error: 'rate limit' }]
        };
      }

      throw new Error(`Unexpected message type: ${message.type}`);
    }
  };

  init(documentRef, extensionApi, sharedBlocklist, sharedFollowers, sharedSettings, sharedFollowerScanSessions);
  await flushAsyncWork();
  await flushAsyncWork();

  elements['open-followers'].click();
  elements['block-follower-candidates'].click();
  await flushAsyncWork();
  await flushAsyncWork();

  assert.equal(extensionApi.store[sharedFollowerScanSessions.FOLLOWER_SCAN_SESSION_STORAGE_KEY].activeSession.readyCandidates[0].attempts, 1);
  assert.equal(extensionApi.store[sharedFollowerScanSessions.FOLLOWER_SCAN_SESSION_STORAGE_KEY].activeSession.totals.blockedFailed, 1);
  assert.equal(extensionApi.store[sharedFollowerScanSessions.FOLLOWER_SCAN_SESSION_STORAGE_KEY].activeSession.totals.abandonedFailed, 0);

  elements['block-follower-candidates'].click();
  await flushAsyncWork();
  await flushAsyncWork();

  assert.equal(extensionApi.store[sharedFollowerScanSessions.FOLLOWER_SCAN_SESSION_STORAGE_KEY].activeSession.readyCandidates[0].attempts, 2);
  assert.equal(extensionApi.store[sharedFollowerScanSessions.FOLLOWER_SCAN_SESSION_STORAGE_KEY].activeSession.totals.blockedFailed, 1);
  assert.equal(extensionApi.store[sharedFollowerScanSessions.FOLLOWER_SCAN_SESSION_STORAGE_KEY].activeSession.totals.abandonedFailed, 0);

  elements['block-follower-candidates'].click();
  await flushAsyncWork();
  await flushAsyncWork();

  assert.deepEqual(extensionApi.store[sharedFollowerScanSessions.FOLLOWER_SCAN_SESSION_STORAGE_KEY].activeSession.readyCandidates, []);
  assert.equal(extensionApi.store[sharedFollowerScanSessions.FOLLOWER_SCAN_SESSION_STORAGE_KEY].activeSession.totals.blockedFailed, 0);
  assert.equal(extensionApi.store[sharedFollowerScanSessions.FOLLOWER_SCAN_SESSION_STORAGE_KEY].activeSession.totals.abandonedFailed, 1);
});

test('init keeps the queued candidate when the block result does not match the queued identity', async () => {
  const { documentRef, elements } = createPopupDocument();
  const extensionApi = createStorageExtensionApi({
    [sharedFollowerScanSessions.FOLLOWER_SCAN_SESSION_STORAGE_KEY]: {
      version: 1,
      activeSession: createStoredFollowerScanSession({
        hasMorePages: false,
        readyCandidates: [{ restId: '101', username: 'alice', attempts: 0, lastError: null }],
        totals: {
          scanned: 5,
          alreadyBlocked: 0,
          blockedSuccess: 0,
          blockedFailed: 0,
          abandonedFailed: 0
        }
      })
    }
  });

  extensionApi.runtime = {};
  extensionApi.tabs = {
    async query(queryInfo) {
      if (queryInfo.active) {
        return [{ id: 45, url: 'https://x.com/targetuser/followers' }];
      }

      return [];
    },
    async sendMessage(_tabId, message) {
      if (message.type === FOLLOWERS_BLOCK_MESSAGE_TYPE) {
        return {
          ok: true,
          results: [{ ok: true, restId: '999', username: 'mallory' }]
        };
      }

      throw new Error(`Unexpected message type: ${message.type}`);
    }
  };

  init(documentRef, extensionApi, sharedBlocklist, sharedFollowers, sharedSettings, sharedFollowerScanSessions);
  await flushAsyncWork();
  await flushAsyncWork();

  elements['open-followers'].click();
  elements['block-follower-candidates'].click();
  await flushAsyncWork();
  await flushAsyncWork();

  assert.equal(extensionApi.store[sharedFollowerScanSessions.FOLLOWER_SCAN_SESSION_STORAGE_KEY].activeSession.readyCandidates[0].username, 'alice');
  assert.equal(extensionApi.store[sharedFollowerScanSessions.FOLLOWER_SCAN_SESSION_STORAGE_KEY].activeSession.readyCandidates[0].attempts, 1);
  assert.equal(extensionApi.store[sharedFollowerScanSessions.FOLLOWER_SCAN_SESSION_STORAGE_KEY].activeSession.totals.blockedSuccess, 0);
  assert.equal(extensionApi.store[sharedFollowerScanSessions.FOLLOWER_SCAN_SESSION_STORAGE_KEY].activeSession.totals.blockedFailed, 1);
  assert.equal(getToastText(elements).includes('Mismatched results: 1.'), true);
});

test('init can cancel an active follower block run', async () => {
  const { documentRef, elements } = createPopupDocument();
  const blockDeferred = createDeferred();
  const messages = [];
  const ports = [];
  let activeBlockRunId = null;
  const blocklist = sharedBlocklist;
  const extensionApi = {
    runtime: {},
    tabs: {
      connect(tabId, options) {
        const port = {
          disconnected: false,
          name: options.name,
          tabId,
          disconnect() {
            port.disconnected = true;
          }
        };
        ports.push(port);
        return port;
      },
      async query(queryInfo) {
        if (queryInfo.active) {
          return [{ id: 43, url: 'https://x.com/targetuser/followers' }];
        }

        return [];
      },
      async sendMessage(tabId, message) {
        messages.push({ message, tabId });

        if (message.type === FOLLOWERS_SCAN_MESSAGE_TYPE) {
          return {
            ok: true,
            preview: {
              alreadyBlockedCount: 0,
              blockLimit: 5,
              candidates: [{ restId: '101', username: 'alice' }],
              hasMorePages: false,
              readyCount: 1,
              scanLimit: 10,
              scannedCount: 1,
              source: 'followers',
              targetRestId: '999',
              targetScreenName: 'targetuser'
            }
          };
        }

        if (message.type === FOLLOWERS_BLOCK_MESSAGE_TYPE) {
          activeBlockRunId = message.runId;
          return blockDeferred.promise;
        }

        if (message.type === FOLLOWERS_CANCEL_MESSAGE_TYPE) {
          assert.equal(message.runId, activeBlockRunId);
          blockDeferred.resolve({
            canceled: true,
            error: 'Follower run canceled.',
            ok: false
          });
          return {
            canceled: true,
            ok: true
          };
        }

        return { ok: false };
      }
    }
  };

  init(documentRef, extensionApi, blocklist, sharedFollowers);
  await flushAsyncWork();

  elements['open-followers'].click();
  elements['scan-followers-preview'].click();
  await flushAsyncWork();
  await flushAsyncWork();
  elements['block-follower-candidates'].click();
  await flushAsyncWork();

  assert.equal(elements['cancel-followers-run'].disabled, false);
  elements['cancel-followers-run'].click();
  await flushAsyncWork();
  await flushAsyncWork();

  assert.equal(messages.at(-1).message.type, FOLLOWERS_CANCEL_MESSAGE_TYPE);
  assert.equal(messages.at(-1).tabId, 43);
  assert.equal(ports.some((port) => port.name === `${FOLLOWERS_RUN_PORT_PREFIX}${activeBlockRunId}`), true);
  assert.equal(elements.status.textContent, 'Save usernames for later, or block the whole list immediately through any open X tab.');
  assert.equal(getToastText(elements), 'Block run canceled for followers.');
  assert.equal(elements['followers-progress-label'].textContent, 'Run canceled');
});

test('init scans following when the following source is selected', async () => {
  const { documentRef, elements } = createPopupDocument();
  const messages = [];
  const blocklist = sharedBlocklist;
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
            resumeState: {
              alreadyBlockedKeys: [],
              hasMorePages: false,
              nextCursor: null,
              pendingUsers: []
            },
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
  await flushAsyncWork();
  assert.equal(elements['followers-summary'].textContent, 'Source changed to following. Run a new scan.');
  elements['followers-block-limit'].value = '10';
  elements['followers-scan-limit'].value = '15';
  elements['scan-followers-preview'].click();
  await flushAsyncWork();
  await flushAsyncWork();

  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].message.options, {
    blockLimit: 10,
    resumeState: null,
    scanLimit: 15,
    source: 'following'
  });
  assert.equal(typeof messages[0].message.runId, 'string');
  assert.equal(elements.status.textContent, 'Save usernames for later, or block the whole list immediately through any open X tab.');
  assert.equal(getToastText(elements), 'Preview ready: 1 following account can be blocked from @targetuser.');
  assert.equal(elements['followers-summary'].textContent, 'Scanned 1 following account from @targetuser. Already blocked: 0. Blocked this session: 0. Ready: 1.');
  assert.equal(elements['followers-progress-label'].textContent, 'Ready to block 1 following account');
});

test('init preserves each source scan session when switching sources and restores it after reopening', async (t) => {
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

  const { documentRef, elements } = createPopupDocument();
  const blocklist = sharedBlocklist;
  const extensionApi = createStorageExtensionApi();
  extensionApi.runtime = {};
  extensionApi.tabs = {
    async query(queryInfo) {
      if (queryInfo.active) {
        return [{ id: 42, url: 'https://x.com/targetuser/followers' }];
      }

      return [];
    },
    async sendMessage(_tabId, message) {
      if (message.options?.source === 'following') {
        return {
          ok: true,
          preview: {
            alreadyBlockedCount: 0,
            blockLimit: 10,
            candidates: [{ restId: '303', username: 'charlie' }],
            hasMorePages: false,
            readyCount: 1,
            resumeState: {
              alreadyBlockedKeys: [],
              hasMorePages: false,
              nextCursor: null,
              pendingUsers: []
            },
            scanLimit: 15,
            scannedCount: 1,
            source: 'following',
            targetRestId: '999',
            targetScreenName: 'targetuser'
          }
        };
      }

      return {
        ok: true,
        preview: {
          alreadyBlockedCount: 0,
          blockLimit: 10,
          candidates: [{ restId: '101', username: 'alice' }],
          hasMorePages: false,
          readyCount: 1,
          resumeState: {
            alreadyBlockedKeys: [],
            hasMorePages: false,
            nextCursor: null,
            pendingUsers: []
          },
          scanLimit: 15,
          scannedCount: 1,
          source: 'followers',
          targetRestId: '999',
          targetScreenName: 'targetuser'
        }
      };
    }
  };

  init(documentRef, extensionApi, blocklist, sharedFollowers);
  await flushAsyncWork();

  elements['open-followers'].click();
  elements['followers-block-limit'].value = '10';
  elements['followers-scan-limit'].value = '15';
  elements['scan-followers-preview'].click();
  await flushAsyncWork();
  await flushAsyncWork();

  assert.equal(elements['followers-preview'].textContent, '@alice');
  assert.equal(extensionApi.store[sharedFollowerScanSessions.FOLLOWER_SCAN_SESSION_STORAGE_KEY].activeSession.source, 'followers');
  assert.equal(loadStoredPopupState(storage).followersPreviews, undefined);

  elements['followers-source-following'].click();
  await flushAsyncWork();
  assert.equal(elements['followers-summary'].textContent, 'Source changed to following. Run a new scan.');
  assert.equal(elements['block-follower-candidates'].disabled, true);
  assert.equal(extensionApi.store[sharedFollowerScanSessions.FOLLOWER_SCAN_SESSION_STORAGE_KEY].activeSession, null);

  elements['scan-followers-preview'].click();
  await flushAsyncWork();
  await flushAsyncWork();

  assert.equal(elements['followers-preview'].textContent, '@charlie');
  assert.equal(extensionApi.store[sharedFollowerScanSessions.FOLLOWER_SCAN_SESSION_STORAGE_KEY].activeSession.source, 'following');
  assert.equal(elements['followers-summary'].textContent, 'Scanned 1 following account from @targetuser. Already blocked: 0. Blocked this session: 0. Ready: 1.');

  elements['followers-source-followers'].click();
  await flushAsyncWork();
  assert.equal(elements['followers-preview'].textContent, '@alice');
  assert.equal(elements['followers-summary'].textContent, 'Scanned 1 follower from @targetuser. Already blocked: 0. Blocked this session: 0. Ready: 1.');
  assert.equal(extensionApi.store[sharedFollowerScanSessions.FOLLOWER_SCAN_SESSION_STORAGE_KEY].activeSession.source, 'followers');

  elements['followers-source-following'].click();
  await flushAsyncWork();
  assert.equal(elements['followers-preview'].textContent, '@charlie');

  const reopenedPopup = createPopupDocument();
  init(reopenedPopup.documentRef, extensionApi, blocklist, sharedFollowers);
  await flushAsyncWork();

  assert.equal(reopenedPopup.elements['followers-source-following'].dataset.active, 'true');
  assert.equal(reopenedPopup.elements['followers-preview'].textContent, '@charlie');
});

test('init renders fatal popup text when the initial popup load rejects', async () => {
  const { documentRef } = createPopupDocument();
  const blocklist = {
    ...sharedBlocklist,
    async getStoredUsernameListState() {
      throw new Error('storage exploded');
    }
  };

  init(documentRef, { runtime: {}, tabs: {} }, blocklist, sharedFollowers);
  await flushAsyncWork();

  assert.equal(documentRef.body.textContent.includes('storage exploded'), true);
  assert.equal(documentRef.body.textContent.includes('Easy TweetBlock popup failed to load.'), true);
});
