(() => {
  const DEFAULT_FOLLOWERS_BLOCK_LIMIT = 50;
  const DEFAULT_FOLLOWERS_SCAN_LIMIT = 100;
  const MIN_FOLLOWERS_BLOCK_LIMIT = 1;
  const MAX_FOLLOWERS_BLOCK_LIMIT = 200;
  const MIN_FOLLOWERS_SCAN_LIMIT = 1;
  const MAX_FOLLOWERS_SCAN_LIMIT = 500;

  function clampRoundedNumber(value, fallback, minimum, maximum) {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return fallback;
    }

    const roundedValue = Math.round(numericValue);
    return Math.min(maximum, Math.max(minimum, roundedValue));
  }

  function normalizeFollowersBlockLimit(value) {
    return clampRoundedNumber(
      value,
      DEFAULT_FOLLOWERS_BLOCK_LIMIT,
      MIN_FOLLOWERS_BLOCK_LIMIT,
      MAX_FOLLOWERS_BLOCK_LIMIT
    );
  }

  function normalizeFollowersScanLimit(value, minimum = MIN_FOLLOWERS_SCAN_LIMIT) {
    const normalizedMinimum = clampRoundedNumber(
      minimum,
      MIN_FOLLOWERS_SCAN_LIMIT,
      MIN_FOLLOWERS_SCAN_LIMIT,
      MAX_FOLLOWERS_SCAN_LIMIT
    );

    return clampRoundedNumber(
      value,
      Math.max(DEFAULT_FOLLOWERS_SCAN_LIMIT, normalizedMinimum),
      normalizedMinimum,
      MAX_FOLLOWERS_SCAN_LIMIT
    );
  }

  const followersApi = {
    DEFAULT_FOLLOWERS_BLOCK_LIMIT,
    DEFAULT_FOLLOWERS_SCAN_LIMIT,
    MAX_FOLLOWERS_BLOCK_LIMIT,
    MAX_FOLLOWERS_SCAN_LIMIT,
    MIN_FOLLOWERS_BLOCK_LIMIT,
    MIN_FOLLOWERS_SCAN_LIMIT,
    normalizeFollowersBlockLimit,
    normalizeFollowersScanLimit
  };

  globalThis.EasyTweetBlockFollowers = followersApi;

  if (typeof module !== 'undefined') {
    module.exports = followersApi;
  }
})();
