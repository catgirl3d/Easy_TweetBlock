const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createUsernameSet,
  normalizeUsername,
  USERNAME_PATTERN
} = require('../src/shared/usernames.js');

test('normalizeUsername shares the canonical username normalization rule', () => {
  assert.equal(normalizeUsername('@Felixmfdo'), 'felixmfdo');
  assert.equal(normalizeUsername('/Felixmfdo'), 'felixmfdo');
  assert.equal(normalizeUsername('bad-name'), null);
  assert.equal(USERNAME_PATTERN.test('Valid_Name15'), true);
  assert.equal(USERNAME_PATTERN.test('bad-name'), false);
});

test('createUsernameSet deduplicates normalized usernames and drops invalid values', () => {
  assert.deepEqual(
    Array.from(createUsernameSet(['Alice', '@alice', 'Bob', 'bad-name', null])),
    ['alice', 'bob']
  );
});
