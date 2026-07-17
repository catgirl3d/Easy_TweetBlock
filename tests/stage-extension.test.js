const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  EXTENSION_ICON_FILES,
  assertExtensionAssets,
  assertRequiredPath,
  assertTarget,
  copyIfExists,
  prepareStageDir,
  stageExtension
} = require("../scripts/stage-extension.js");

test("stageExtension prepares a Chrome stage with sources and a manifest", () => {
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), "easy-tweetblock-stage-chrome-"));

  try {
    const { outputPath, stageDir } = stageExtension("chrome", distDir);
    const manifest = JSON.parse(fs.readFileSync(outputPath, "utf8"));

    assert.equal(stageDir, path.join(distDir, "chrome-package"));
    assert.equal(manifest.background.service_worker, "src/background/background-chrome.js");
    assert.equal(fs.existsSync(path.join(stageDir, "src", "content", "dom.js")), true);
    assert.equal(fs.existsSync(path.join(stageDir, "src", "content", "main.js")), true);
    assert.equal(fs.existsSync(path.join(stageDir, "src", "popup", "popup.html")), true);
    assert.equal(fs.existsSync(path.join(stageDir, "src", "shared", "blocklist.js")), true);
    assert.equal(fs.existsSync(path.join(stageDir, "src", "shared", "content-script-files.js")), true);
    assert.equal(fs.existsSync(path.join(stageDir, "src", "shared", "settings.js")), true);
    assert.equal(fs.existsSync(path.join(stageDir, "src", "shared", "storage.js")), true);
    for (const iconFile of EXTENSION_ICON_FILES) {
      assert.equal(fs.existsSync(path.join(stageDir, "assets", "extension", iconFile)), true);
    }
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

test("assertTarget rejects unsupported stage targets", () => {
  assert.throws(() => assertTarget("edge"), /Unsupported stage target: edge/);
});

test("assertRequiredPath throws when a required path is missing", () => {
  assert.throws(() => assertRequiredPath(path.join(os.tmpdir(), "easy-tweetblock-missing-path")), /Missing required path:/);
});

test("assertExtensionAssets accepts the configured extension icons", () => {
  assert.doesNotThrow(() => assertExtensionAssets());
});

test("prepareStageDir recreates a clean stage directory", () => {
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), "easy-tweetblock-stage-clean-"));
  const staleStageDir = path.join(distDir, "chrome-package");

  try {
    fs.mkdirSync(staleStageDir, { recursive: true });
    fs.writeFileSync(path.join(staleStageDir, "stale.txt"), "old", "utf8");

    const stageDir = prepareStageDir("chrome", distDir);

    assert.equal(stageDir, staleStageDir);
    assert.equal(fs.existsSync(path.join(stageDir, "stale.txt")), false);
  } finally {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
});

test("copyIfExists copies existing sources and ignores missing ones", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "easy-tweetblock-copy-"));
  const sourceDir = path.join(tempDir, "source");
  const targetDir = path.join(tempDir, "target");

  try {
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "file.txt"), "copy me", "utf8");

    copyIfExists(sourceDir, targetDir);
    copyIfExists(path.join(tempDir, "missing"), path.join(tempDir, "unused"));

    assert.equal(fs.readFileSync(path.join(targetDir, "file.txt"), "utf8"), "copy me");
    assert.equal(fs.existsSync(path.join(tempDir, "unused")), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("stage-extension CLI prints usage when no target is provided", () => {
  const result = spawnSync(process.execPath, ["scripts/stage-extension.js"], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8"
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: node scripts\/stage-extension\.js <firefox\|chrome>/);
});

test("stage-extension CLI reports invalid targets", () => {
  const result = spawnSync(process.execPath, ["scripts/stage-extension.js", "edge"], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8"
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unsupported stage target: edge/);
});
