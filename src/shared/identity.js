(() => {
  const USER_ID_PATTERN = /^\d+$/;

  function normalizeRestId(value) {
    if (typeof value !== 'string' && typeof value !== 'number') {
      return null;
    }

    const normalizedValue = String(value).trim();
    return USER_ID_PATTERN.test(normalizedValue) ? normalizedValue : null;
  }

  const identityApi = {
    USER_ID_PATTERN,
    normalizeRestId
  };

  globalThis.EasyTweetBlockIdentity = identityApi;

  if (typeof module !== 'undefined') {
    module.exports = identityApi;
  }
})();
