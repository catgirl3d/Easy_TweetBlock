(() => {
  function normalizeNonNegativeInteger(value, fallback = 0) {
    const normalizedValue = Math.round(Number(value));

    if (!Number.isFinite(normalizedValue) || normalizedValue < 0) {
      return fallback;
    }

    return normalizedValue;
  }

  function normalizeOptionalString(value, { stringOnly = false } = {}) {
    if (value == null || (stringOnly && typeof value !== 'string')) {
      return null;
    }

    const normalizedValue = String(value).trim();
    return normalizedValue || null;
  }

  const normalizationApi = {
    normalizeNonNegativeInteger,
    normalizeOptionalString
  };

  globalThis.EasyTweetBlockNormalization = normalizationApi;

  if (typeof module !== 'undefined') {
    module.exports = normalizationApi;
  }
})();
