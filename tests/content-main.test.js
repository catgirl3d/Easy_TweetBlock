const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BUTTON_KINDS,
  DEFAULT_BATCH_BLOCK_DELAY_MS,
  MAX_BATCH_BLOCK_DELAY_MS,
  MIN_BATCH_BLOCK_DELAY_MS,
  SELECTORS,
  USER_BY_SCREEN_NAME_QUERY_IDS,
  blockUserByScreenNameViaApi,
  blockUsernamesViaApi,
  buildUserLookupUrls,
  buildXApiHeaders,
  createUsernameSet,
  extractScreenNameFromHref,
  getClientLanguage,
  getButtonTitle,
  getCsrfToken,
  lookupUserRestId,
  normalizeBatchBlockDelayMs,
  normalizeUsernameForMatching,
  parseUserLookupRestId,
  readCookieValue,
  readScreenNameFromTweet,
  setButtonState
} = require('../src/content/main.js');

function createTweetStub(selectorMap) {
  return {
    querySelector(selector) {
      return selectorMap[selector] || null;
    }
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
    documentRef: {
      cookie: 'ct0=token123',
      documentElement: { lang: 'en-US' },
      location: { origin: 'https://x.com' }
    },
    fetchImpl,
    queryIds: ['staleQueryId', 'workingQueryId'],
    cache: new Map()
  });

  assert.equal(restId, '2057563419742486528');
  assert.equal(requestedUrls.length, 2);
  assert.equal(requestedUrls[0].includes('/staleQueryId/UserByScreenName'), true);
  assert.equal(requestedUrls[1].includes('/workingQueryId/UserByScreenName'), true);
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
