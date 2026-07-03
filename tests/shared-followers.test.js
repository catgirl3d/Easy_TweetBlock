const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_FOLLOWERS_BLOCK_LIMIT,
  DEFAULT_FOLLOWERS_SOURCE,
  DEFAULT_FOLLOWERS_SCAN_LIMIT,
  FOLLOWERS_SOURCES,
  MAX_FOLLOWERS_BLOCK_LIMIT,
  MAX_FOLLOWERS_SCAN_LIMIT,
  normalizeFollowersBlockLimit,
  normalizeFollowersScanLimit,
  normalizeFollowersSource,
  sleep
} = require('../src/shared/followers.js');

test('normalizeFollowersBlockLimit clamps invalid and out-of-range values', () => {
  assert.equal(normalizeFollowersBlockLimit(undefined), DEFAULT_FOLLOWERS_BLOCK_LIMIT);
  assert.equal(normalizeFollowersBlockLimit(0), 1);
  assert.equal(normalizeFollowersBlockLimit(25.4), 25);
  assert.equal(normalizeFollowersBlockLimit(9999), MAX_FOLLOWERS_BLOCK_LIMIT);
});

test('normalizeFollowersScanLimit clamps invalid and out-of-range values', () => {
  assert.equal(normalizeFollowersScanLimit(undefined), DEFAULT_FOLLOWERS_SCAN_LIMIT);
  assert.equal(normalizeFollowersScanLimit(0), 1);
  assert.equal(normalizeFollowersScanLimit(73.6), 74);
  assert.equal(normalizeFollowersScanLimit(9999), MAX_FOLLOWERS_SCAN_LIMIT);
});

test('normalizeFollowersSource accepts followers and following only', () => {
  assert.equal(normalizeFollowersSource(FOLLOWERS_SOURCES.followers), FOLLOWERS_SOURCES.followers);
  assert.equal(normalizeFollowersSource(FOLLOWERS_SOURCES.following), FOLLOWERS_SOURCES.following);
  assert.equal(normalizeFollowersSource('unknown'), DEFAULT_FOLLOWERS_SOURCE);
});

test('sleep delegates to the provided setTimeout implementation', async () => {
  let observedDelay = null;

  await sleep(25, (callback, delayMs) => {
    observedDelay = delayMs;
    callback();
    return 0;
  });

  assert.equal(observedDelay, 25);
});
