const assert = require('node:assert/strict');
const test = require('node:test');

const { USER_ID_PATTERN, normalizeRestId } = require('../src/shared/identity.js');

test('normalizeRestId accepts trimmed numeric ids and preserves the canonical string form', () => {
  assert.equal(normalizeRestId(' 2057563419742486528 '), '2057563419742486528');
  assert.equal(normalizeRestId(12345), '12345');
  assert.equal(USER_ID_PATTERN.test('12345'), true);
});

test('normalizeRestId rejects non-numeric identities', () => {
  for (const value of [null, undefined, '', '  ', '1.5', '-1', '1e3', 'abc', {}, []]) {
    assert.equal(normalizeRestId(value), null, `expected ${String(value)} to be rejected`);
  }
});
