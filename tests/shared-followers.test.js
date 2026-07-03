const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_FOLLOWERS_BLOCK_LIMIT,
  DEFAULT_FOLLOWERS_SCAN_LIMIT,
  MAX_FOLLOWERS_BLOCK_LIMIT,
  MAX_FOLLOWERS_SCAN_LIMIT,
  normalizeFollowersBlockLimit,
  normalizeFollowersScanLimit
} = require('../src/shared/followers.js');

test('normalizeFollowersBlockLimit clamps invalid and out-of-range values', () => {
  assert.equal(normalizeFollowersBlockLimit(undefined), DEFAULT_FOLLOWERS_BLOCK_LIMIT);
  assert.equal(normalizeFollowersBlockLimit(0), 1);
  assert.equal(normalizeFollowersBlockLimit(25.4), 25);
  assert.equal(normalizeFollowersBlockLimit(9999), MAX_FOLLOWERS_BLOCK_LIMIT);
});

test('normalizeFollowersScanLimit respects the block minimum and max scan ceiling', () => {
  assert.equal(normalizeFollowersScanLimit(undefined, 50), DEFAULT_FOLLOWERS_SCAN_LIMIT);
  assert.equal(normalizeFollowersScanLimit(10, 25), 25);
  assert.equal(normalizeFollowersScanLimit(73.6, 25), 74);
  assert.equal(normalizeFollowersScanLimit(9999, 25), MAX_FOLLOWERS_SCAN_LIMIT);
});
