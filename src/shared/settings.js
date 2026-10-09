(() => {
  const storageApi = globalThis.EasyTweetBlockStorage
    || (typeof module !== 'undefined' && module.exports ? require('./storage.js') : null);

  if (!storageApi) {
    throw new Error('Missing Easy TweetBlock storage API.');
  }

  const { callStorageGet, callStorageSet, getExtensionApi } = storageApi;

  const BATCH_BLOCK_DELAY_MS_STORAGE_KEY = 'batchBlockDelayMs';
  const AD_FILTER_MODE_STORAGE_KEY = 'adFilterMode';
  const PAGE_BLOCK_BUTTON_STYLES_STORAGE_KEY = 'pageBlockButtonStyles';
  const USER_CELL_ADD_BUTTON_STYLE_STORAGE_KEY = 'userCellAddButtonStyle';
  const USER_CELL_ADD_BUTTON_VISIBILITY_STORAGE_KEY = 'showUserCellAddButton';
  const DEFAULT_BATCH_BLOCK_DELAY_MS = 1000;
  const DEFAULT_PAGE_BLOCK_BUTTON_STYLE = 'icon';
  const AD_FILTER_MODES = Object.freeze({
    hide: 'hide',
    hideAndBlock: 'hide-and-block',
    off: 'off'
  });
  const DEFAULT_AD_FILTER_MODE = AD_FILTER_MODES.hide;
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
  const MAX_BATCH_BLOCK_DELAY_MS = 10000;
  const PAGE_BLOCK_BUTTON_STYLES = Object.freeze({
    icon: 'icon',
    text: 'text'
  });

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

  function normalizeAdFilterMode(value) {
    if (value === AD_FILTER_MODES.off || value === AD_FILTER_MODES.hideAndBlock) {
      return value;
    }

    return DEFAULT_AD_FILTER_MODE;
  }

  async function getStoredAdFilterMode(extensionApi = getExtensionApi()) {
    const storageArea = extensionApi?.storage?.local;
    const storedValues = await callStorageGet(storageArea, [AD_FILTER_MODE_STORAGE_KEY], extensionApi);
    return normalizeAdFilterMode(storedValues?.[AD_FILTER_MODE_STORAGE_KEY]);
  }

  async function setStoredAdFilterMode(mode, extensionApi = getExtensionApi()) {
    const normalizedMode = normalizeAdFilterMode(mode);
    const storageArea = extensionApi?.storage?.local;

    await callStorageSet(storageArea, {
      [AD_FILTER_MODE_STORAGE_KEY]: normalizedMode
    }, extensionApi);

    return normalizedMode;
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

  async function setStoredUserCellAddButtonVisibility(isVisible, extensionApi = getExtensionApi()) {
    const normalizedVisibility = normalizeUserCellAddButtonVisibility(isVisible);
    const storageArea = extensionApi?.storage?.local;

    await callStorageSet(storageArea, {
      [USER_CELL_ADD_BUTTON_VISIBILITY_STORAGE_KEY]: normalizedVisibility
    }, extensionApi);

    return normalizedVisibility;
  }

  async function getStoredUserCellAddButtonStyle(extensionApi = getExtensionApi()) {
    const storageArea = extensionApi?.storage?.local;
    const storedValues = await callStorageGet(storageArea, [USER_CELL_ADD_BUTTON_STYLE_STORAGE_KEY], extensionApi);
    return normalizePageBlockButtonStyle(storedValues?.[USER_CELL_ADD_BUTTON_STYLE_STORAGE_KEY]);
  }

  async function setStoredUserCellAddButtonStyle(style, extensionApi = getExtensionApi()) {
    const normalizedStyle = normalizePageBlockButtonStyle(style);
    const storageArea = extensionApi?.storage?.local;

    await callStorageSet(storageArea, {
      [USER_CELL_ADD_BUTTON_STYLE_STORAGE_KEY]: normalizedStyle
    }, extensionApi);

    return normalizedStyle;
  }

  const settingsApi = {
    AD_FILTER_MODE_STORAGE_KEY,
    AD_FILTER_MODES,
    BATCH_BLOCK_DELAY_MS_STORAGE_KEY,
    DEFAULT_AD_FILTER_MODE,
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
    USER_CELL_ADD_BUTTON_STYLE_STORAGE_KEY,
    USER_CELL_ADD_BUTTON_VISIBILITY_STORAGE_KEY,
    getStoredAdFilterMode,
    getStoredBatchBlockDelayMs,
    getStoredPageBlockButtonStyles,
    getStoredUserCellAddButtonStyle,
    getStoredUserCellAddButtonVisibility,
    normalizeAdFilterMode,
    normalizeBatchBlockDelayMs,
    normalizePageBlockButtonStyle,
    normalizePageBlockButtonStyles,
    normalizePageButtonStyleSurface,
    normalizeUserCellAddButtonVisibility,
    setStoredAdFilterMode,
    setStoredBatchBlockDelayMs,
    setStoredPageBlockButtonStyles,
    setStoredUserCellAddButtonStyle,
    setStoredUserCellAddButtonVisibility
  };

  globalThis.EasyTweetBlockSettings = settingsApi;

  if (typeof module !== 'undefined') {
    module.exports = settingsApi;
  }
})();
