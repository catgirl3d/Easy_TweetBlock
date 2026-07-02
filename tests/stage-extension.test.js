const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { stageExtension } = require("../scripts/stage-extension.js");

test("stageExtension prepares a Chrome stage with sources and a manifest", () => {
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), "easy-tweetblock-stage-chrome-"));

  try {
    const { outputPath, stageDir } = stageExtension("chrome", distDir);
    const manifest = JSON.parse(fs.readFileSync(outputPath, "utf8"));

    assert.equal(stageDir, path.join(distDir, "chrome-package"));
    assert.equal(manifest.background.service_worker, "src/background/background-chrome.js");
    assert.equal(fs.existsSync(path.join(stageDir, "src", "content", "main.js")), true);
    assert.equal(fs.existsSync(path.join(stageDir, "src", "popup", "popup.html")), true);
  } finally {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
});

test("stageExtension prepares a Firefox stage with the Firefox manifest overlay", () => {
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), "easy-tweetblock-stage-firefox-"));

  try {
    const { outputPath, stageDir } = stageExtension("firefox", distDir);
    const manifest = JSON.parse(fs.readFileSync(outputPath, "utf8"));

    assert.equal(stageDir, path.join(distDir, "firefox-package"));
    assert.equal(manifest.browser_specific_settings.gecko.id, "easy-tweetblock@local.dev");
    assert.deepEqual(manifest.background.scripts, ["src/background/background-firefox.js"]);
  } finally {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
});
