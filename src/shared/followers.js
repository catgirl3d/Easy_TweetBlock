(() => {
  const DEFAULT_FOLLOWERS_BLOCK_LIMIT = 50;
  const DEFAULT_FOLLOWERS_SCAN_LIMIT = 100;
  const MIN_FOLLOWERS_BLOCK_LIMIT = 1;
  const MAX_FOLLOWERS_BLOCK_LIMIT = 200;
  const MIN_FOLLOWERS_SCAN_LIMIT = 1;
  const MAX_FOLLOWERS_SCAN_LIMIT = 500;
  const FOLLOWERS_SOURCES = Object.freeze({
    followers: 'followers',
    following: 'following'
  });
  const DEFAULT_FOLLOWERS_SOURCE = FOLLOWERS_SOURCES.followers;

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

  function normalizeFollowersScanLimit(value) {
    return clampRoundedNumber(
      value,
      DEFAULT_FOLLOWERS_SCAN_LIMIT,
      MIN_FOLLOWERS_SCAN_LIMIT,
      MAX_FOLLOWERS_SCAN_LIMIT
    );
  }

  function sleep(delayMs, setTimeoutImpl = globalThis.setTimeout) {
    return new Promise((resolve) => {
      setTimeoutImpl(resolve, delayMs);
    });
  }

  function normalizeFollowersSource(value) {
    return value === FOLLOWERS_SOURCES.following ? FOLLOWERS_SOURCES.following : DEFAULT_FOLLOWERS_SOURCE;
  }

  const followersApi = {
    clampRoundedNumber,
    DEFAULT_FOLLOWERS_SOURCE,
    DEFAULT_FOLLOWERS_BLOCK_LIMIT,
    DEFAULT_FOLLOWERS_SCAN_LIMIT,
    FOLLOWERS_SOURCES,
    MAX_FOLLOWERS_BLOCK_LIMIT,
    MAX_FOLLOWERS_SCAN_LIMIT,
    normalizeFollowersBlockLimit,
    normalizeFollowersScanLimit,
    normalizeFollowersSource,
    sleep
  };

  globalThis.EasyTweetBlockFollowers = followersApi;

  if (typeof module !== 'undefined') {
    module.exports = followersApi;
  }
})();
