const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildManifest, writeManifest } = require("../scripts/build-manifest.js");

test("buildManifest merges the Chrome overlay into the base manifest", () => {
  const manifest = buildManifest("chrome");

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, "Easy TweetBlock");
  assert.equal(manifest.background.service_worker, "src/background/background-chrome.js");
  assert.deepEqual(manifest.host_permissions, [
    "https://x.com/*",
    "https://twitter.com/*"
  ]);
  assert.equal(manifest.action.default_popup, "src/popup/popup.html");
});

test("buildManifest merges the Firefox overlay into the base manifest", () => {
  const manifest = buildManifest("firefox");

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.browser_specific_settings.gecko.id, "easy-tweetblock@local.dev");
  assert.deepEqual(manifest.background.scripts, ["src/background/background-firefox.js"]);
});

test("writeManifest writes manifest.json to the requested directory", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "easy-tweetblock-manifest-"));

  try {
    const { manifest, outputPath } = writeManifest("chrome", tempDir);
    const writtenManifest = JSON.parse(fs.readFileSync(outputPath, "utf8"));

    assert.equal(path.basename(outputPath), "manifest.json");
    assert.deepEqual(writtenManifest, manifest);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
