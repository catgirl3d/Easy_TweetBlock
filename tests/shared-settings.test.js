const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_BATCH_BLOCK_DELAY_MS,
  DEFAULT_PAGE_BLOCK_BUTTON_STYLE,
  DEFAULT_PAGE_BLOCK_BUTTON_STYLES,
  DEFAULT_USER_CELL_ADD_BUTTON_STYLE,
  DEFAULT_USER_CELL_ADD_BUTTON_VISIBILITY,
  MAX_BATCH_BLOCK_DELAY_MS,
  MIN_BATCH_BLOCK_DELAY_MS,
  PAGE_BLOCK_BUTTON_STYLES,
  PAGE_BLOCK_BUTTON_STYLES_STORAGE_KEY,
  PAGE_BUTTON_STYLE_SURFACES,
  getStoredBatchBlockDelayMs,
  getStoredPageBlockButtonStyles,
  getStoredUserCellAddButtonStyle,
  getStoredUserCellAddButtonVisibility,
  normalizeBatchBlockDelayMs,
  normalizePageBlockButtonStyle,
  normalizePageBlockButtonStyles,
  normalizePageButtonStyleSurface,
  normalizeUserCellAddButtonVisibility,
  setStoredBatchBlockDelayMs,
  setStoredPageBlockButtonStyles,
  setStoredUserCellAddButtonStyle,
  setStoredUserCellAddButtonVisibility
} = require('../src/shared/settings.js');

function createExtensionApi(initialStore = {}) {
  const store = { ...initialStore };

  return {
    runtime: {
      lastError: null
    },
    storage: {
      local: {
        get(keys, callback) {
          const response = {};

          for (const key of keys) {
            response[key] = store[key];
          }

          callback(response);
        },
        set(payload, callback) {
          Object.assign(store, payload);
          callback();
        }
      }
    },
    store
  };
}

function createPromiseExtensionApi(initialStore = {}) {
  const store = { ...initialStore };

  return {
    runtime: {
      lastError: null
    },
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
          Object.assign(store, payload);
          return Promise.resolve();
        }
      }
    },
    store
  };
}

test('normalizePageBlockButtonStyle defaults to icon and accepts text', () => {
  assert.equal(normalizePageBlockButtonStyle(undefined), DEFAULT_PAGE_BLOCK_BUTTON_STYLE);
  assert.equal(normalizePageBlockButtonStyle(PAGE_BLOCK_BUTTON_STYLES.text), PAGE_BLOCK_BUTTON_STYLES.text);
  assert.equal(normalizePageBlockButtonStyle('random'), DEFAULT_PAGE_BLOCK_BUTTON_STYLE);
});

test('normalizePageBlockButtonStyles defaults every surface to icon and accepts per-surface overrides', () => {
  assert.deepEqual(normalizePageBlockButtonStyles(undefined), DEFAULT_PAGE_BLOCK_BUTTON_STYLES);
  assert.deepEqual(normalizePageBlockButtonStyles(PAGE_BLOCK_BUTTON_STYLES.text), {
    [PAGE_BUTTON_STYLE_SURFACES.tweet]: PAGE_BLOCK_BUTTON_STYLES.text,
    [PAGE_BUTTON_STYLE_SURFACES.profile]: PAGE_BLOCK_BUTTON_STYLES.text,
    [PAGE_BUTTON_STYLE_SURFACES.userCell]: PAGE_BLOCK_BUTTON_STYLES.text
  });
  assert.deepEqual(normalizePageBlockButtonStyles({
    [PAGE_BUTTON_STYLE_SURFACES.tweet]: PAGE_BLOCK_BUTTON_STYLES.text,
    [PAGE_BUTTON_STYLE_SURFACES.profile]: 'bad-value'
  }), {
    [PAGE_BUTTON_STYLE_SURFACES.tweet]: PAGE_BLOCK_BUTTON_STYLES.text,
    [PAGE_BUTTON_STYLE_SURFACES.profile]: PAGE_BLOCK_BUTTON_STYLES.icon,
    [PAGE_BUTTON_STYLE_SURFACES.userCell]: PAGE_BLOCK_BUTTON_STYLES.icon
  });
});

test('normalizePageButtonStyleSurface defaults to tweet and accepts known surfaces', () => {
  assert.equal(normalizePageButtonStyleSurface('random'), PAGE_BUTTON_STYLE_SURFACES.tweet);
  assert.equal(normalizePageButtonStyleSurface(PAGE_BUTTON_STYLE_SURFACES.profile), PAGE_BUTTON_STYLE_SURFACES.profile);
  assert.equal(normalizePageButtonStyleSurface(PAGE_BUTTON_STYLE_SURFACES.userCell), PAGE_BUTTON_STYLE_SURFACES.userCell);
});

test('normalizeUserCellAddButtonVisibility defaults to true and only treats false as disabled', () => {
  assert.equal(normalizeUserCellAddButtonVisibility(undefined), DEFAULT_USER_CELL_ADD_BUTTON_VISIBILITY);
  assert.equal(normalizeUserCellAddButtonVisibility(true), true);
  assert.equal(normalizeUserCellAddButtonVisibility(false), false);
  assert.equal(normalizeUserCellAddButtonVisibility('nope'), true);
});

test('normalizeBatchBlockDelayMs clamps values into the supported range', () => {
  assert.equal(normalizeBatchBlockDelayMs(undefined), DEFAULT_BATCH_BLOCK_DELAY_MS);
  assert.equal(normalizeBatchBlockDelayMs('250'), MIN_BATCH_BLOCK_DELAY_MS);
  assert.equal(normalizeBatchBlockDelayMs('1200'), 1200);
  assert.equal(normalizeBatchBlockDelayMs(2500), MAX_BATCH_BLOCK_DELAY_MS);
});

test('getStoredUserCellAddButtonStyle defaults to icon and round-trips through storage', async () => {
  const extensionApi = createExtensionApi();

  assert.equal(await getStoredUserCellAddButtonStyle(extensionApi), DEFAULT_USER_CELL_ADD_BUTTON_STYLE);

  const savedStyle = await setStoredUserCellAddButtonStyle(PAGE_BLOCK_BUTTON_STYLES.text, extensionApi);
  const loadedStyle = await getStoredUserCellAddButtonStyle(extensionApi);

  assert.equal(savedStyle, PAGE_BLOCK_BUTTON_STYLES.text);
  assert.equal(loadedStyle, PAGE_BLOCK_BUTTON_STYLES.text);
});

test('setStoredBatchBlockDelayMs and getStoredBatchBlockDelayMs round-trip through extension storage', async () => {
  const extensionApi = createExtensionApi();

  const savedDelayMs = await setStoredBatchBlockDelayMs(2200, extensionApi);
  const loadedDelayMs = await getStoredBatchBlockDelayMs(extensionApi);

  assert.equal(savedDelayMs, MAX_BATCH_BLOCK_DELAY_MS);
  assert.equal(loadedDelayMs, MAX_BATCH_BLOCK_DELAY_MS);
});

test('setStoredPageBlockButtonStyles and getStoredPageBlockButtonStyles round-trip through extension storage', async () => {
  const extensionApi = createExtensionApi();

  const savedStyles = await setStoredPageBlockButtonStyles({
    [PAGE_BUTTON_STYLE_SURFACES.tweet]: PAGE_BLOCK_BUTTON_STYLES.text,
    [PAGE_BUTTON_STYLE_SURFACES.profile]: PAGE_BLOCK_BUTTON_STYLES.icon,
    [PAGE_BUTTON_STYLE_SURFACES.userCell]: PAGE_BLOCK_BUTTON_STYLES.text
  }, extensionApi);
  const loadedStyles = await getStoredPageBlockButtonStyles(extensionApi);

  assert.deepEqual(savedStyles, {
    [PAGE_BUTTON_STYLE_SURFACES.tweet]: PAGE_BLOCK_BUTTON_STYLES.text,
    [PAGE_BUTTON_STYLE_SURFACES.profile]: PAGE_BLOCK_BUTTON_STYLES.icon,
    [PAGE_BUTTON_STYLE_SURFACES.userCell]: PAGE_BLOCK_BUTTON_STYLES.text
  });
  assert.deepEqual(loadedStyles, savedStyles);
  assert.deepEqual(extensionApi.store[PAGE_BLOCK_BUTTON_STYLES_STORAGE_KEY], savedStyles);
});

test('setStoredUserCellAddButtonVisibility and getStoredUserCellAddButtonVisibility round-trip through extension storage', async () => {
  const extensionApi = createExtensionApi();

  const savedVisibility = await setStoredUserCellAddButtonVisibility(false, extensionApi);
  const loadedVisibility = await getStoredUserCellAddButtonVisibility(extensionApi);

  assert.equal(savedVisibility, false);
  assert.equal(loadedVisibility, false);
});

test('stored settings helpers also work with promise-based storage APIs', async () => {
  const extensionApi = createPromiseExtensionApi();

  const savedDelayMs = await setStoredBatchBlockDelayMs(1201, extensionApi);
  const loadedDelayMs = await getStoredBatchBlockDelayMs(extensionApi);
  const savedStyles = await setStoredPageBlockButtonStyles({
    [PAGE_BUTTON_STYLE_SURFACES.tweet]: PAGE_BLOCK_BUTTON_STYLES.text,
    [PAGE_BUTTON_STYLE_SURFACES.profile]: PAGE_BLOCK_BUTTON_STYLES.icon,
    [PAGE_BUTTON_STYLE_SURFACES.userCell]: PAGE_BLOCK_BUTTON_STYLES.text
  }, extensionApi);
  const loadedStyles = await getStoredPageBlockButtonStyles(extensionApi);
  const savedVisibility = await setStoredUserCellAddButtonVisibility(false, extensionApi);
  const loadedVisibility = await getStoredUserCellAddButtonVisibility(extensionApi);
  const savedAddStyle = await setStoredUserCellAddButtonStyle(PAGE_BLOCK_BUTTON_STYLES.text, extensionApi);
  const loadedAddStyle = await getStoredUserCellAddButtonStyle(extensionApi);

  assert.equal(savedDelayMs, 1201);
  assert.equal(loadedDelayMs, 1201);
  assert.deepEqual(savedStyles, loadedStyles);
  assert.equal(savedVisibility, false);
  assert.equal(loadedVisibility, false);
  assert.equal(savedAddStyle, PAGE_BLOCK_BUTTON_STYLES.text);
  assert.equal(loadedAddStyle, PAGE_BLOCK_BUTTON_STYLES.text);
});

test('settings storage helpers reject callback-style storage errors', async () => {
  const extensionApi = {
    runtime: {
      lastError: null
    },
    storage: {
      local: {
        set(_payload, callback) {
          extensionApi.runtime.lastError = { message: 'storage set failed' };
          callback();
          extensionApi.runtime.lastError = null;
        }
      }
    }
  };

  await assert.rejects(setStoredBatchBlockDelayMs(1000, extensionApi), /storage set failed/);
});
