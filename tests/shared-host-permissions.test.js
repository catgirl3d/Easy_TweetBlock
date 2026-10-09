const assert = require('node:assert/strict');
const test = require('node:test');

const {
  REQUIRED_HOST_ORIGINS,
  hasRequiredHostPermissions,
  requestRequiredHostPermissions
} = require('../src/shared/host-permissions.js');

function createPromisePermissionsExtensionApi({ grantedOrigins = [], grantedOnRequest = true, calls = [] } = {}) {
  const granted = new Set(grantedOrigins);

  return {
    calls,
    permissions: {
      contains(details) {
        calls.push({ details, method: 'contains' });
        return Promise.resolve(details.origins.every((origin) => granted.has(origin)));
      },
      request(details) {
        calls.push({ details, method: 'request' });

        if (grantedOnRequest) {
          for (const origin of details.origins) {
            granted.add(origin);
          }
        }

        return Promise.resolve(grantedOnRequest);
      }
    }
  };
}

test('hasRequiredHostPermissions reports false while any required origin is revoked', async () => {
  const extensionApi = createPromisePermissionsExtensionApi({
    grantedOrigins: [REQUIRED_HOST_ORIGINS[0]]
  });

  assert.equal(await hasRequiredHostPermissions(extensionApi), false);
});

test('hasRequiredHostPermissions reports true when every required origin is granted', async () => {
  const extensionApi = createPromisePermissionsExtensionApi({
    grantedOrigins: [...REQUIRED_HOST_ORIGINS]
  });

  assert.equal(await hasRequiredHostPermissions(extensionApi), true);
});

test('hasRequiredHostPermissions treats a missing permissions API as granted', async () => {
  assert.equal(await hasRequiredHostPermissions({ runtime: {} }), true);
});

test('requestRequiredHostPermissions invokes the permissions API synchronously for user input handlers', async () => {
  const extensionApi = createPromisePermissionsExtensionApi();
  const requestPromise = requestRequiredHostPermissions(extensionApi);

  assert.deepEqual(extensionApi.calls, [{
    details: { origins: [...REQUIRED_HOST_ORIGINS] },
    method: 'request'
  }]);
  assert.equal(await requestPromise, true);
});

test('requestRequiredHostPermissions reports a denied request', async () => {
  const extensionApi = createPromisePermissionsExtensionApi({
    grantedOnRequest: false
  });

  assert.equal(await requestRequiredHostPermissions(extensionApi), false);
  assert.equal(await hasRequiredHostPermissions(extensionApi), false);
});

test('callback-style permissions APIs are supported for contains and request', async () => {
  const granted = new Set();
  const extensionApi = {
    permissions: {
      contains(details, callback) {
        if (typeof callback !== 'function') {
          throw new Error('callback mode only');
        }

        callback(details.origins.every((origin) => granted.has(origin)));
      },
      request(details, callback) {
        if (typeof callback !== 'function') {
          throw new Error('callback mode only');
        }

        for (const origin of details.origins) {
          granted.add(origin);
        }

        callback(true);
      }
    },
    runtime: {}
  };

  assert.equal(await hasRequiredHostPermissions(extensionApi), false);
  assert.equal(await requestRequiredHostPermissions(extensionApi), true);
  assert.equal(await hasRequiredHostPermissions(extensionApi), true);
});

test('callback-style permissions lastError rejects the site access check', async () => {
  const extensionApi = {
    permissions: {
      contains(_details, callback) {
        extensionApi.runtime.lastError = { message: 'contains failed' };
        callback(false);
        extensionApi.runtime.lastError = null;
      }
    },
    runtime: {
      lastError: null
    }
  };

  await assert.rejects(hasRequiredHostPermissions(extensionApi), /contains failed/);
});
