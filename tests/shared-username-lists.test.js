const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createUsernameList,
  DEFAULT_USERNAME_LIST_ID,
  DEFAULT_USERNAME_LIST_NAME,
  ensureUsernameLists,
  mergeEditedUsernamesWithLatest,
  mergeUsernameLists,
  normalizeStoredUsernames,
  normalizeUsernameListName,
  normalizeUsernameLists,
  parseUsernameImport,
  parseUsernameText,
  serializeUsernameText
} = require('../src/shared/username-lists.js');

test('normalizeStoredUsernames preserves insertion order while removing invalid and duplicate values', () => {
  assert.deepEqual(
    normalizeStoredUsernames(['Felixmfdo', '@felixmfdo', 'ok_name', 'bad-name', 'Second', '@ok_name']),
    ['felixmfdo', 'ok_name', 'second']
  );
});

test('mergeEditedUsernamesWithLatest preserves external additions while honoring draft removals and additions', () => {
  assert.deepEqual(
    mergeEditedUsernamesWithLatest(
      ['alice'],
      ['alice', 'bob', 'dana'],
      ['alice', 'carol']
    ),
    ['alice', 'carol', 'bob', 'dana']
  );

  assert.deepEqual(
    mergeEditedUsernamesWithLatest(
      ['alice', 'carol'],
      ['carol', 'bob'],
      ['alice', 'carol', 'dana']
    ),
    ['carol', 'dana', 'bob']
  );
});

test('parseUsernameText deduplicates usernames and reports invalid entries', () => {
  const { usernames, invalidEntries } = parseUsernameText('@Felixmfdo\nspam_account\ninvalid-name\nFelixmfdo');

  assert.deepEqual(usernames, ['felixmfdo', 'spam_account']);
  assert.deepEqual(invalidEntries, ['invalid-name']);
});

test('serializeUsernameText formats usernames one per line with @ prefix', () => {
  assert.equal(serializeUsernameText(['felixmfdo', 'spam_account']), '@felixmfdo\n@spam_account');
});

test('ensureUsernameLists returns the default list for missing input', () => {
  assert.deepEqual(ensureUsernameLists(null), [{
    id: DEFAULT_USERNAME_LIST_ID,
    name: DEFAULT_USERNAME_LIST_NAME,
    usernames: []
  }]);
});

test('username list normalization keeps ids unique and cleans names', () => {
  assert.equal(normalizeUsernameListName('  Spam   Team  '), 'Spam Team');
  assert.deepEqual(normalizeUsernameLists([
    { id: 'same', name: 'One', usernames: ['Alice'] },
    { id: 'same', name: 'One', usernames: ['Alice', 'Bob'] },
    { id: 'bad id', name: '', usernames: ['bad-name'] }
  ]), [
    { id: 'same', name: 'One', usernames: ['alice'] },
    { id: 'one', name: 'One', usernames: ['alice', 'bob'] },
    { id: 'blocklist-3', name: 'Blocklist 3', usernames: [] }
  ]);
  assert.deepEqual(createUsernameList('My List', ['Alice'], ['my-list']), {
    id: 'my-list-2',
    name: 'My List',
    usernames: ['alice']
  });
});

test('parseUsernameImport supports text, json usernames, and json lists', () => {
  assert.deepEqual(parseUsernameImport('@Alice,bad-name Bob', 'names.csv'), {
    invalidEntries: ['bad-name'],
    lists: [],
    usernames: ['alice', 'bob']
  });
  assert.deepEqual(parseUsernameImport('{"usernames":["Alice","bad-name","Bob"]}', 'names.json'), {
    invalidEntries: ['bad-name'],
    lists: [],
    usernames: ['alice', 'bob']
  });
  assert.deepEqual(parseUsernameImport('{"lists":[{"name":"Spam","usernames":["Alice","bad-name"]}]}', 'lists.json'), {
    invalidEntries: ['bad-name'],
    lists: [{ id: 'spam', name: 'Spam', usernames: ['alice'] }],
    usernames: []
  });
});

test('parseUsernameImport preserves JSON username values before validation', () => {
  assert.deepEqual(parseUsernameImport('{"usernames":["Alice","bad name","bad,name","Alice",null,""]}', 'names.json'), {
    invalidEntries: ['bad name', 'bad,name'],
    lists: [],
    usernames: ['alice']
  });
});

test('mergeUsernameLists merges imported lists by name and deduplicates usernames', () => {
  assert.deepEqual(mergeUsernameLists([
    { id: 'spam', name: 'Spam', usernames: ['alice'] }
  ], [
    { name: 'spam', usernames: ['Alice', 'Bob'] },
    { name: 'VIP', usernames: ['Charlie'] }
  ]), [
    { id: 'spam', name: 'Spam', usernames: ['alice', 'bob'] },
    { id: 'vip', name: 'VIP', usernames: ['charlie'] }
  ]);
});
