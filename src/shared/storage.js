(() => {
  function getExtensionApi(extensionApi = globalThis.browser || globalThis.chrome) {
    return extensionApi || null;
  }

  function callStorageGet(storageArea, query, extensionApi = getExtensionApi()) {
    if (!storageArea) {
      return Promise.resolve({});
    }

    try {
      const maybePromise = storageArea.get(query);

      if (maybePromise && typeof maybePromise.then === 'function') {
        return maybePromise.then((value) => value || {});
      }
    } catch {
      // Fall through to callback mode for older Chrome-style APIs.
    }

    return new Promise((resolve, reject) => {
      storageArea.get(query, (value) => {
        const lastError = extensionApi?.runtime?.lastError;

        if (lastError) {
          reject(new Error(lastError.message || String(lastError)));
          return;
        }

        resolve(value || {});
      });
    });
  }

  function callStorageSet(storageArea, payload, extensionApi = getExtensionApi()) {
    if (!storageArea) {
      return Promise.resolve();
    }

    try {
      const maybePromise = storageArea.set(payload);

      if (maybePromise && typeof maybePromise.then === 'function') {
        return maybePromise;
      }
    } catch {
      // Fall through to callback mode for older Chrome-style APIs.
    }

    return new Promise((resolve, reject) => {
      storageArea.set(payload, () => {
        const lastError = extensionApi?.runtime?.lastError;

        if (lastError) {
          reject(new Error(lastError.message || String(lastError)));
          return;
        }

        resolve();
      });
    });
  }

  const storageApi = {
    callStorageGet,
    callStorageSet,
    getExtensionApi
  };

  globalThis.EasyTweetBlockStorage = storageApi;

  if (typeof module !== 'undefined') {
    module.exports = storageApi;
  }
})();
