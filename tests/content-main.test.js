const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BLOCK_BUTTON_ATTRIBUTE,
  BUTTON_KINDS,
  DEFAULT_BATCH_BLOCK_DELAY_MS,
  MAX_BATCH_BLOCK_DELAY_MS,
  MESSAGE_TYPES,
  MIN_BATCH_BLOCK_DELAY_MS,
  SELECTORS,
  USER_BY_SCREEN_NAME_QUERY_IDS,
  attachButtonToTweet,
  blockUserByScreenNameViaApi,
  blockUsernamesViaApi,
  buildUserLookupUrls,
  buildXApiHeaders,
  collectTweets,
  createApiBlockButton,
  createNativeBlockButton,
  createUsernameSet,
  extractScreenNameFromHref,
  getClientLanguage,
  getButtonTitle,
  getCsrfToken,
  init,
  lookupUserRestId,
  normalizeBatchBlockDelayMs,
  normalizeUsernameForMatching,
  parseUserLookupRestId,
  readCookieValue,
  readScreenNameFromTweet,
  registerRuntimeMessageListener,
  runNativeBlockFlow,
  setButtonState,
  waitForElement
} = require('../src/content/main.js');

function createTweetStub(selectorMap) {
  return {
    querySelector(selector) {
      return selectorMap[selector] || null;
    }
  };
}

function flushAsyncWork() {
  return new Promise((resolve) => setImmediate(resolve));
}

function useGlobalOverrides(t, overrides) {
  const originalValues = new Map();

  for (const [key, value] of Object.entries(overrides)) {
    originalValues.set(key, globalThis[key]);
    globalThis[key] = value;
  }

  t.after(() => {
    for (const [key, value] of originalValues.entries()) {
      if (value === undefined) {
        delete globalThis[key];
        continue;
      }

      globalThis[key] = value;
    }
  });
}

function createDomElement(overrides = {}) {
  const attributes = {};
  const listeners = new Map();
  const element = {
    attributes,
    dataset: {},
    disabled: false,
    textContent: '',
    title: '',
    addEventListener(type, listener) {
      const typeListeners = listeners.get(type) || [];
      typeListeners.push(listener);
      listeners.set(type, typeListeners);
    },
    click() {
      const typeListeners = listeners.get('click') || [];

      for (const listener of typeListeners) {
        listener({
          currentTarget: element,
          preventDefault() {},
          stopPropagation() {},
          target: element,
          type: 'click'
        });
      }
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null;
    },
    setAttribute(name, value) {
      attributes[name] = value;
    },
    ...overrides
  };

  return element;
}

function createDocumentStub() {
  const styles = new Map();
  const createdElements = [];
  const documentRef = {
    body: {},
    createElement(tagName) {
      const element = createDomElement({ tagName });
      createdElements.push(element);
      return element;
    },
    getElementById(id) {
      return styles.get(id) || null;
    },
    head: {
      appendedNodes: [],
      appendChild(node) {
        this.appendedNodes.push(node);

        if (node?.id) {
          styles.set(node.id, node);
        }
      }
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    }
  };

  return {
    createdElements,
    documentRef
  };
}

function createTweetNode(screenName = 'Felixmfdo', options = {}) {
  const caretButton = createDomElement();
  const parentElement = {
    children: [caretButton],
    insertBefore(child, referenceNode) {
      child.parentElement = parentElement;
      const index = parentElement.children.indexOf(referenceNode);
      parentElement.children.splice(index, 0, child);
    }
  };

  caretButton.parentElement = parentElement;

  const tweetNode = {
    nodeType: 1,
    matches(selector) {
      return selector === SELECTORS.tweet;
    },
    querySelector(selector) {
      if (selector === `[${BLOCK_BUTTON_ATTRIBUTE}]`) {
        return options.existingButton || null;
      }

      if (selector === SELECTORS.caretButton) {
        return caretButton;
      }

      if (selector === SELECTORS.permalink) {
        if (options.includePermalink === false) {
          return null;
        }

        return {
          getAttribute(name) {
            return name === 'href' ? `/${screenName}/status/1` : null;
          }
        };
      }

      if (selector === SELECTORS.profileLink) {
        return options.profileLink || null;
      }

      if (selector === SELECTORS.avatarContainer) {
        return options.avatarContainer || null;
      }

      return null;
    },
    querySelectorAll() {
      return [];
    }
  };

  return {
    caretButton,
    parentElement,
    tweetNode
  };
}

test('extractScreenNameFromHref reads a screen name from tweet permalinks', () => {
  assert.equal(extractScreenNameFromHref('/Felixmfdo/status/2072691291956068443'), 'Felixmfdo');
  assert.equal(extractScreenNameFromHref('https://x.com/Felixmfdo/status/2072691291956068443'), 'Felixmfdo');
});

test('extractScreenNameFromHref reads a screen name from profile links', () => {
  assert.equal(extractScreenNameFromHref('/Felixmfdo'), 'Felixmfdo');
  assert.equal(extractScreenNameFromHref('https://twitter.com/Felixmfdo'), 'Felixmfdo');
});

test('extractScreenNameFromHref rejects reserved internal paths', () => {
  assert.equal(extractScreenNameFromHref('/i/web/status/2072691291956068443'), null);
  assert.equal(extractScreenNameFromHref('/home'), null);
  assert.equal(extractScreenNameFromHref('/search?q=test'), null);
});

test('readScreenNameFromTweet prefers the tweet permalink', () => {
  const tweet = createTweetStub({
    [SELECTORS.permalink]: {
      getAttribute(name) {
        return name === 'href' ? '/Felixmfdo/status/2072691291956068443' : null;
      }
    },
    [SELECTORS.profileLink]: {
      getAttribute(name) {
        return name === 'href' ? '/SomeoneElse' : null;
      }
    }
  });

  assert.equal(readScreenNameFromTweet(tweet), 'Felixmfdo');
});

test('readScreenNameFromTweet falls back to the profile link', () => {
  const tweet = createTweetStub({
    [SELECTORS.profileLink]: {
      getAttribute(name) {
        return name === 'href' ? '/Felixmfdo' : null;
      }
    }
  });

  assert.equal(readScreenNameFromTweet(tweet), 'Felixmfdo');
});

test('readScreenNameFromTweet falls back to avatar data-testid', () => {
  const tweet = createTweetStub({
    [SELECTORS.avatarContainer]: {
      getAttribute(name) {
        return name === 'data-testid' ? 'UserAvatar-Container-Felixmfdo' : null;
      }
    }
  });

  assert.equal(readScreenNameFromTweet(tweet), 'Felixmfdo');
});

test('setButtonState updates the visible label and accessibility metadata', () => {
  const attributes = {};
  const button = {
    dataset: {
      kind: BUTTON_KINDS.native
    },
    disabled: false,
    textContent: '',
    title: '',
    setAttribute(name, value) {
      attributes[name] = value;
    }
  };

  setButtonState(button, 'running', 'Felixmfdo');
  assert.equal(button.dataset.state, 'running');
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, 'Blocking...');
  assert.equal(button.title, 'Blocking @Felixmfdo using X menu flow');
  assert.equal(attributes['aria-label'], 'Blocking @Felixmfdo using X menu flow');

  setButtonState(button, 'success', 'Felixmfdo');
  assert.equal(button.dataset.state, 'success');
  assert.equal(button.textContent, 'Blocked');
  assert.equal(getButtonTitle(BUTTON_KINDS.native, 'Felixmfdo', 'success'), 'Blocked @Felixmfdo using X menu flow');
});

test('setButtonState uses API-specific labels and titles for the experimental button', () => {
  const attributes = {};
  const button = {
    dataset: {
      kind: BUTTON_KINDS.api
    },
    disabled: false,
    textContent: '',
    title: '',
    setAttribute(name, value) {
      attributes[name] = value;
    }
  };

  setButtonState(button, 'idle', 'Felixmfdo');
  assert.equal(button.textContent, 'API');
  assert.equal(button.title, 'Try blocking @Felixmfdo via internal API');
  assert.equal(attributes['aria-label'], 'Try blocking @Felixmfdo via internal API');

  setButtonState(button, 'success', 'Felixmfdo');
  assert.equal(button.textContent, 'API ok');
  assert.equal(button.title, 'Blocked @Felixmfdo via internal API');
});

test('waitForElement resolves when an element appears and rejects on timeout', async (t) => {
  const originalSetTimeout = globalThis.setTimeout;
  let callCount = 0;
  const match = { id: 'ready' };

  t.after(() => {
    globalThis.setTimeout = originalSetTimeout;
  });

  globalThis.setTimeout = (callback) => {
    callback();
    return 0;
  };

  const resolved = await waitForElement('.match', {
    querySelector() {
      callCount += 1;
      return callCount === 2 ? match : null;
    }
  }, 100);

  assert.equal(resolved, match);
  await assert.rejects(waitForElement('.missing', {
    querySelector() {
      return null;
    }
  }, 0), /Timed out waiting for \.missing/);
});

test('runNativeBlockFlow clicks the caret, block action, and confirmation button', async () => {
  const clickOrder = [];
  const caretButton = {
    click() {
      clickOrder.push('caret');
    }
  };
  const blockMenuItem = {
    click() {
      clickOrder.push('menu');
    }
  };
  const confirmButton = {
    click() {
      clickOrder.push('confirm');
    }
  };

  await runNativeBlockFlow({
    querySelector(selector) {
      return selector === SELECTORS.caretButton ? caretButton : null;
    }
  }, {
    querySelector(selector) {
      if (selector === SELECTORS.blockMenuItem) {
        return blockMenuItem;
      }

      if (selector === SELECTORS.blockConfirmButton) {
        return confirmButton;
      }

      return null;
    }
  });

  assert.deepEqual(clickOrder, ['caret', 'menu', 'confirm']);
});

test('runNativeBlockFlow requires the tweet caret button', async () => {
  await assert.rejects(runNativeBlockFlow({
    querySelector() {
      return null;
    }
  }, {
    querySelector() {
      return null;
    }
  }), /Missing tweet caret button/);
});

test('readCookieValue and getCsrfToken parse cookie values safely', () => {
  const cookieSource = 'lang=en; ct0=abc123%3Dtoken; theme=dark';

  assert.equal(readCookieValue(cookieSource, 'ct0'), 'abc123=token');
  assert.equal(readCookieValue(cookieSource, 'missing'), null);
  assert.equal(getCsrfToken({ cookie: cookieSource }), 'abc123=token');
});

test('getClientLanguage returns the page language primary tag', () => {
  assert.equal(getClientLanguage({ documentElement: { lang: 'pl-PL' } }), 'pl');
  assert.equal(getClientLanguage({ documentElement: { lang: '' } }), 'en');
});

test('buildXApiHeaders includes the shared web bearer and csrf token', () => {
  const headers = buildXApiHeaders({
    cookie: 'ct0=token123',
    documentElement: { lang: 'en-US' }
  }, {
    'content-type': 'application/x-www-form-urlencoded'
  });

  assert.equal(headers.authorization.startsWith('Bearer '), true);
  assert.equal(headers['x-csrf-token'], 'token123');
  assert.equal(headers['x-twitter-client-language'], 'en');
  assert.equal(headers['content-type'], 'application/x-www-form-urlencoded');
});

test('buildUserLookupUrls creates one candidate URL per known query id', () => {
  const urls = buildUserLookupUrls('Felixmfdo', 'https://x.com');

  assert.equal(urls.length, USER_BY_SCREEN_NAME_QUERY_IDS.length);
  assert.equal(urls[0].startsWith(`https://x.com/i/api/graphql/${USER_BY_SCREEN_NAME_QUERY_IDS[0]}/UserByScreenName?`), true);
  assert.equal(urls[0].includes('screen_name'), true);
  assert.equal(urls[0].includes('Felixmfdo'), true);
});

test('parseUserLookupRestId reads rest_id from common response shapes', () => {
  assert.equal(parseUserLookupRestId({
    data: {
      user: {
        result: {
          rest_id: '123'
        }
      }
    }
  }), '123');

  assert.equal(parseUserLookupRestId({
    data: {
      user_result_by_screen_name: {
        result: {
          rest_id: '456'
        }
      }
    }
  }), '456');

  assert.equal(parseUserLookupRestId({ data: {} }), null);
});

test('lookupUserRestId retries stale query ids until one returns rest_id', async () => {
  const requestedUrls = [];
  const cache = new Map();
  const responses = [
    {
      ok: false,
      status: 404
    },
    {
      ok: true,
      async json() {
        return {
          data: {
            user: {
              result: {
                rest_id: '2057563419742486528'
              }
            }
          }
        };
      }
    }
  ];

  async function fetchImpl(url) {
    requestedUrls.push(url);
    return responses.shift();
  }

  const restId = await lookupUserRestId('Felixmfdo', {
    cache,
    documentRef: {
      cookie: 'ct0=token123',
      documentElement: { lang: 'en-US' },
      location: { origin: 'https://x.com' }
    },
    fetchImpl,
    queryIds: ['staleQueryId', 'workingQueryId']
  });

  assert.equal(restId, '2057563419742486528');
  assert.equal(cache.get('felixmfdo'), '2057563419742486528');
  assert.equal(requestedUrls.length, 2);
  assert.equal(requestedUrls[0].includes('/staleQueryId/UserByScreenName'), true);
  assert.equal(requestedUrls[1].includes('/workingQueryId/UserByScreenName'), true);
});

test('lookupUserRestId reuses the current tab cache without another network lookup', async () => {
  const requestedUrls = [];
  const cache = new Map([
    ['felixmfdo', '2057563419742486528']
  ]);

  async function fetchImpl(url) {
    requestedUrls.push(url);
    throw new Error('fetch should not run when rest_id is cached');
  }

  const restId = await lookupUserRestId('Felixmfdo', {
    cache,
    documentRef: {
      cookie: 'ct0=token123',
      documentElement: { lang: 'en-US' },
      location: { origin: 'https://x.com' }
    },
    fetchImpl,
    queryIds: ['workingQueryId']
  });

  assert.equal(restId, '2057563419742486528');
  assert.deepEqual(requestedUrls, []);
});

test('blockUserByScreenNameViaApi resolves rest_id and posts block request', async () => {
  const requestedUrls = [];

  async function fetchImpl(url, options = {}) {
    requestedUrls.push({ options, url });

    if (options.method === 'POST') {
      return {
        ok: true,
        async json() {
          return { ok: true };
        }
      };
    }

    return {
      ok: true,
      async json() {
        return {
          data: {
            user: {
              result: {
                rest_id: '2057563419742486528'
              }
            }
          }
        };
      }
    };
  }

  const result = await blockUserByScreenNameViaApi('Felixmfdo', {
    documentRef: {
      cookie: 'ct0=token123',
      documentElement: { lang: 'en-US' },
      location: { origin: 'https://x.com' }
    },
    fetchImpl,
    queryIds: ['workingQueryId']
  });

  assert.equal(result.restId, '2057563419742486528');
  assert.equal(result.screenName, 'felixmfdo');
  assert.equal(requestedUrls.length, 2);
  assert.equal(requestedUrls[0].url.includes('/workingQueryId/UserByScreenName'), true);
  assert.equal(requestedUrls[1].url.endsWith('/i/api/1.1/blocks/create.json'), true);
  assert.equal(requestedUrls[1].options.method, 'POST');
  assert.equal(requestedUrls[1].options.body, 'user_id=2057563419742486528');
});

test('blockUserByScreenNameViaApi tolerates block responses without JSON bodies', async () => {
  async function fetchImpl(url, options = {}) {
    if (options.method === 'POST') {
      return {
        ok: true,
        async json() {
          throw new Error('no JSON body');
        }
      };
    }

    return {
      ok: true,
      async json() {
        return {
          data: {
            user: {
              result: {
                rest_id: '2057563419742486528'
              }
            }
          }
        };
      }
    };
  }

  const result = await blockUserByScreenNameViaApi('Felixmfdo', {
    documentRef: {
      cookie: 'ct0=token123',
      documentElement: { lang: 'en-US' },
      location: { origin: 'https://x.com' }
    },
    fetchImpl,
    queryIds: ['workingQueryId']
  });

  assert.equal(result.payload, null);
  assert.equal(result.restId, '2057563419742486528');
});

test('blockUsernamesViaApi blocks usernames sequentially and returns per-user results', async () => {
  const sleepCalls = [];

  async function fetchImpl(url, options = {}) {
    if (options.method === 'POST') {
      if (options.body === 'user_id=111') {
        return {
          ok: true,
          async json() {
            return { ok: true };
          }
        };
      }

      return {
        ok: false,
        status: 403,
        async text() {
          return 'forbidden';
        }
      };
    }

    if (url.includes('firstuser')) {
      return {
        ok: true,
        async json() {
          return {
            data: {
              user: {
                result: {
                  rest_id: '111'
                }
              }
            }
          };
        }
      };
    }

    return {
      ok: true,
      async json() {
        return {
          data: {
            user: {
              result: {
                rest_id: '222'
              }
            }
          }
        };
      }
    };
  }

  const results = await blockUsernamesViaApi(['@FirstUser', 'SecondUser', '@FirstUser'], {
    delayMs: 1200,
    documentRef: {
      cookie: 'ct0=token123',
      documentElement: { lang: 'en-US' },
      location: { origin: 'https://x.com' }
    },
    fetchImpl,
    queryIds: ['workingQueryId'],
    sleepImpl: async (delayMs) => {
      sleepCalls.push(delayMs);
    }
  });

  assert.deepEqual(results.map((entry) => entry.username), ['firstuser', 'seconduser']);
  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, false);
  assert.equal(results[1].error.includes('Block API failed with 403'), true);
  assert.deepEqual(sleepCalls, [1200]);
});

test('normalizeBatchBlockDelayMs clamps values into the supported range', () => {
  assert.equal(normalizeBatchBlockDelayMs(undefined), DEFAULT_BATCH_BLOCK_DELAY_MS);
  assert.equal(normalizeBatchBlockDelayMs(250), MIN_BATCH_BLOCK_DELAY_MS);
  assert.equal(normalizeBatchBlockDelayMs(1250), 1250);
  assert.equal(normalizeBatchBlockDelayMs(2500), MAX_BATCH_BLOCK_DELAY_MS);
});

test('normalizeUsernameForMatching lowercases usernames for blocklist checks', () => {
  assert.equal(normalizeUsernameForMatching('@Felixmfdo'), 'felixmfdo');
  assert.equal(normalizeUsernameForMatching('/Felixmfdo'), 'felixmfdo');
  assert.equal(normalizeUsernameForMatching('bad-name'), null);
  assert.equal(normalizeUsernameForMatching(''), null);
});

test('createUsernameSet deduplicates and normalizes usernames', () => {
  const blocklistSet = createUsernameSet(['@Felixmfdo', 'spam_account', 'Felixmfdo', 'bad-name']);

  assert.equal(blocklistSet.has('felixmfdo'), true);
  assert.equal(blocklistSet.has('spam_account'), true);
  assert.equal(blocklistSet.has('bad-name'), false);
  assert.equal(blocklistSet.size, 2);
});

test('attachButtonToTweet inserts native and API buttons before the caret and skips duplicates', (t) => {
  const { createdElements, documentRef } = createDocumentStub();
  const { caretButton, parentElement, tweetNode } = createTweetNode();

  useGlobalOverrides(t, { document: documentRef });

  attachButtonToTweet(tweetNode);

  assert.equal(createdElements.length, 2);
  assert.equal(parentElement.children[0].dataset.kind, BUTTON_KINDS.native);
  assert.equal(parentElement.children[1].dataset.kind, BUTTON_KINDS.api);
  assert.equal(parentElement.children[2], caretButton);

  attachButtonToTweet({
    querySelector(selector) {
      if (selector === `[${BLOCK_BUTTON_ATTRIBUTE}]`) {
        return {};
      }

      return selector === SELECTORS.caretButton ? caretButton : null;
    }
  });

  assert.equal(createdElements.length, 2);
});

test('collectTweets returns the root tweet and nested tweet descendants', () => {
  const nestedTweet = { id: 'nested' };
  const rootNode = {
    matches(selector) {
      return selector === SELECTORS.tweet;
    },
    querySelectorAll(selector) {
      return selector === SELECTORS.tweet ? [nestedTweet] : [];
    }
  };

  assert.deepEqual(collectTweets(rootNode), [rootNode, nestedTweet]);
  assert.deepEqual(collectTweets({}), []);
});

test('createApiBlockButton marks success after a completed API block', async (t) => {
  const { documentRef } = createDocumentStub();
  const { tweetNode } = createTweetNode('Felixmfdo');

  useGlobalOverrides(t, { document: documentRef });

  const button = createApiBlockButton(tweetNode, {
    documentRef: {
      cookie: 'ct0=token123',
      documentElement: { lang: 'en-US' },
      location: { origin: 'https://x.com' }
    },
    async fetchImpl(url, options = {}) {
      if (options.method === 'POST') {
        return {
          ok: true,
          async json() {
            return { ok: true };
          }
        };
      }

      return {
        ok: true,
        async json() {
          return {
            data: {
              user: {
                result: {
                  rest_id: '111'
                }
              }
            }
          };
        }
      };
    },
    queryIds: ['workingQueryId']
  });

  button.click();
  await flushAsyncWork();

  assert.equal(button.dataset.state, 'success');
  assert.equal(button.textContent, 'API ok');
});

test('createApiBlockButton marks errors as retryable when the API flow fails', async (t) => {
  const { documentRef } = createDocumentStub();
  const { tweetNode } = createTweetNode('Felixmfdo', {
    includePermalink: false
  });
  const originalWarn = console.warn;

  useGlobalOverrides(t, { document: documentRef });
  console.warn = () => {};

  t.after(() => {
    console.warn = originalWarn;
  });

  const button = createApiBlockButton(tweetNode, {
    documentRef: {
      cookie: 'ct0=token123',
      documentElement: { lang: 'en-US' },
      location: { origin: 'https://x.com' }
    }
  });

  button.click();
  await flushAsyncWork();

  assert.equal(button.dataset.state, 'error');
  assert.equal(button.textContent, 'Retry');
});

test('createNativeBlockButton runs the native flow and updates state on success', async (t) => {
  const { documentRef } = createDocumentStub();
  const clickOrder = [];
  const blockMenuItem = {
    click() {
      clickOrder.push('menu');
    }
  };
  const confirmButton = {
    click() {
      clickOrder.push('confirm');
    }
  };

  useGlobalOverrides(t, { document: documentRef });

  const button = createNativeBlockButton({
    querySelector(selector) {
      if (selector === SELECTORS.caretButton) {
        return {
          click() {
            clickOrder.push('caret');
          }
        };
      }

      if (selector === SELECTORS.permalink) {
        return {
          getAttribute(name) {
            return name === 'href' ? '/Felixmfdo/status/1' : null;
          }
        };
      }

      return null;
    }
  }, {
    querySelector(selector) {
      if (selector === SELECTORS.blockMenuItem) {
        return blockMenuItem;
      }

      if (selector === SELECTORS.blockConfirmButton) {
        return confirmButton;
      }

      return null;
    }
  });

  button.click();
  await flushAsyncWork();

  assert.deepEqual(clickOrder, ['caret', 'menu', 'confirm']);
  assert.equal(button.dataset.state, 'success');
});

test('registerRuntimeMessageListener attaches only once and answers block requests', async () => {
  const listeners = [];
  const responses = [];
  const globalRef = {
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            listeners.push(listener);
          }
        }
      }
    },
    document: {}
  };

  registerRuntimeMessageListener(globalRef);
  registerRuntimeMessageListener(globalRef);

  assert.equal(listeners.length, 1);
  assert.equal(globalRef.__easyTweetBlockRuntimeListenerAttached__, true);
  assert.equal(listeners[0]({ type: 'other' }, null, () => {}), false);
  assert.equal(listeners[0]({
    delayMs: 1200,
    type: MESSAGE_TYPES.blockUsernamesViaApi,
    usernames: ['bad-name']
  }, null, (response) => {
    responses.push(response);
  }), true);

  await flushAsyncWork();

  assert.deepEqual(responses, [{ ok: true, results: [] }]);
});

test('init installs styles, registers runtime messaging, and observes added tweets once', (t) => {
  const { documentRef } = createDocumentStub();
  const { caretButton, parentElement, tweetNode } = createTweetNode();
  let observedConfig = null;
  let observerCallback = null;
  const runtimeListeners = [];

  useGlobalOverrides(t, { document: documentRef });

  class FakeMutationObserver {
    constructor(callback) {
      observerCallback = callback;
    }

    observe(target, options) {
      observedConfig = { options, target };
    }
  }

  const globalRef = {
    MutationObserver: FakeMutationObserver,
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            runtimeListeners.push(listener);
          }
        }
      }
    },
    document: documentRef
  };

  init(globalRef);

  assert.equal(globalRef.__easyTweetBlockInjected__, true);
  assert.equal(documentRef.head.appendedNodes.length, 1);
  assert.equal(documentRef.head.appendedNodes[0].id, 'easy-tweetblock-styles');
  assert.deepEqual(observedConfig, {
    options: {
      childList: true,
      subtree: true
    },
    target: documentRef.body
  });
  assert.equal(runtimeListeners.length, 1);

  observerCallback([{ addedNodes: [tweetNode] }]);

  assert.equal(parentElement.children[0].dataset.kind, BUTTON_KINDS.native);
  assert.equal(parentElement.children[1].dataset.kind, BUTTON_KINDS.api);
  assert.equal(parentElement.children[2], caretButton);

  init(globalRef);

  assert.equal(documentRef.head.appendedNodes.length, 1);
  assert.equal(runtimeListeners.length, 1);
});
