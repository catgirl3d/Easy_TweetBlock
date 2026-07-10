(() => {
  const CONTENT_SCRIPT_CSS_FILES = Object.freeze([
    'src/content/main.css'
  ]);
  const CONTENT_SCRIPT_FILES = Object.freeze([
    'src/shared/storage.js',
    'src/shared/settings.js',
    'src/shared/followers.js',
    'src/shared/normalization.js',
    'src/shared/usernames.js',
    'src/shared/identity.js',
    'src/shared/x-platform.js',
    'src/shared/follower-candidates.js',
    'src/shared/username-lists.js',
    'src/content/shared.js',
    'src/shared/blocklist.js',
    'src/shared/follower-scan-session.js',
    'src/shared/follower-scan-controller.js',
    'src/content/x-client-transaction.js',
    'src/content/features.js',
    'src/content/api.js',
    'src/content/dom.js',
    'src/content/main.js'
  ]);
  const contentScriptFilesApi = {
    CONTENT_SCRIPT_CSS_FILES,
    CONTENT_SCRIPT_FILES
  };

  globalThis.EasyTweetBlockContentScriptFiles = contentScriptFilesApi;

  if (typeof module !== 'undefined') {
    module.exports = contentScriptFilesApi;
  }
})();
