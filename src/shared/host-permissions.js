(() => {
  const REQUIRED_HOST_ORIGINS = Object.freeze([
    'https://x.com/*',
    'https://twitter.com/*'
  ]);

  function getExtensionApi(extensionApi = globalThis.browser || globalThis.chrome) {
    return extensionApi || null;
  }

  function getPermissionsApi(extensionApi = getExtensionApi()) {
    return extensionApi?.permissions || null;
  }

  function callPermissionsMethod(permissionsApi, methodName, details, extensionApi) {
    const method = permissionsApi?.[methodName];

    if (typeof method !== 'function') {
      return Promise.resolve(false);
    }

    let maybePromise = null;

    try {
      maybePromise = method.call(permissionsApi, details);
    } catch {
      maybePromise = null;
    }

    if (maybePromise && typeof maybePromise.then === 'function') {
      return maybePromise.then((result) => Boolean(result));
    }

    return new Promise((resolve, reject) => {
      method.call(permissionsApi, details, (result) => {
        const lastError = extensionApi?.runtime?.lastError;

        if (lastError) {
          reject(new Error(lastError.message || String(lastError)));
          return;
        }

        resolve(Boolean(result));
      });
    });
  }

  async function hasRequiredHostPermissions(extensionApi = getExtensionApi()) {
    const permissionsApi = getPermissionsApi(extensionApi);

    if (typeof permissionsApi?.contains !== 'function') {
      return true;
    }

    return callPermissionsMethod(permissionsApi, 'contains', { origins: [...REQUIRED_HOST_ORIGINS] }, extensionApi);
  }

  function requestRequiredHostPermissions(extensionApi = getExtensionApi()) {
    const permissionsApi = getPermissionsApi(extensionApi);

    if (typeof permissionsApi?.request !== 'function') {
      return Promise.resolve(false);
    }

    return callPermissionsMethod(permissionsApi, 'request', { origins: [...REQUIRED_HOST_ORIGINS] }, extensionApi);
  }

  const hostPermissionsApi = {
    REQUIRED_HOST_ORIGINS,
    hasRequiredHostPermissions,
    requestRequiredHostPermissions
  };

  globalThis.EasyTweetBlockHostPermissions = hostPermissionsApi;

  if (typeof module !== 'undefined') {
    module.exports = hostPermissionsApi;
  }
})();
