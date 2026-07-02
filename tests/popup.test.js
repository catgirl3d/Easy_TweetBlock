const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CONTENT_SCRIPT_FILES,
  POPUP_VIEWS,
  ensureContentScriptsInTab,
  executeTabFunction,
  findUsableXTab,
  invokeImmediateBlockInTab,
  isMissingReceiverError,
  normalizePopupView,
  requestImmediateBlock,
  setPopupView
} = require('../src/popup/popup.js');

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
