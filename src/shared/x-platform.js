(() => {
  const DEFAULT_X_ORIGIN = 'https://x.com';

  const xPlatformApi = {
    DEFAULT_X_ORIGIN
  };

  globalThis.EasyTweetBlockXPlatform = xPlatformApi;

  if (typeof module !== 'undefined') {
    module.exports = xPlatformApi;
  }
})();
