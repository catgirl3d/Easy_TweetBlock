(() => {
  const USERNAME_PATTERN = /^[A-Za-z0-9_]{1,15}$/;

  function normalizeUsername(value) {
    if (typeof value !== 'string') {
      return null;
    }

    const normalizedValue = value.trim().replace(/^[@/]+/, '').toLowerCase();
    return normalizedValue && USERNAME_PATTERN.test(normalizedValue) ? normalizedValue : null;
  }

  function createUsernameSet(usernames) {
    const normalizedUsernames = new Set();

    if (!Array.isArray(usernames)) {
      return normalizedUsernames;
    }

    for (const username of usernames) {
      const normalizedUsername = normalizeUsername(username);

      if (normalizedUsername) {
        normalizedUsernames.add(normalizedUsername);
      }
    }

    return normalizedUsernames;
  }

  const usernamesApi = {
    createUsernameSet,
    normalizeUsername,
    USERNAME_PATTERN
  };

  globalThis.EasyTweetBlockUsernames = usernamesApi;

  if (typeof module !== 'undefined') {
    module.exports = usernamesApi;
  }
})();
