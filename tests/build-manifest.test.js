const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  CONTENT_SCRIPT_CSS_FILES,
  CONTENT_SCRIPT_FILES
} = require("../src/shared/content-script-files.js");
const {
  applyDefaultContentScriptFiles,
  assertTarget,
  buildManifest,
  deepMerge,
  writeManifest
} = require("../scripts/build-manifest.js");

test("buildManifest merges the Chrome overlay into the base manifest", () => {
  const manifest = buildManifest("chrome");

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, "Easy TweetBlock");
  assert.equal(manifest.background.service_worker, "src/background/background-chrome.js");
  assert.deepEqual(manifest.host_permissions, [
    "https://abs.twimg.com/*",
    "https://x.com/*",
    "https://twitter.com/*"
  ]);
  assert.equal(manifest.action.default_popup, "src/popup/popup.html");
  assert.deepEqual(manifest.content_scripts[0].css, CONTENT_SCRIPT_CSS_FILES);
  assert.deepEqual(manifest.content_scripts[0].js, CONTENT_SCRIPT_FILES);
});

test("content script files load shared blocklist before content main", () => {
  assert.equal(CONTENT_SCRIPT_FILES.includes("src/shared/blocklist.js"), true);
  assert.equal(
    CONTENT_SCRIPT_FILES.indexOf("src/shared/blocklist.js") < CONTENT_SCRIPT_FILES.indexOf("src/content/main.js"),
    true
  );
});

test("buildManifest merges the Firefox overlay into the base manifest", () => {
  const manifest = buildManifest("firefox");

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.browser_specific_settings.gecko.id, "easy-tweetblock@local.dev");
  assert.deepEqual(manifest.background.scripts, ["src/background/background-firefox.js"]);
});

test("applyDefaultContentScriptFiles fills omitted content script asset lists", () => {
  const manifest = applyDefaultContentScriptFiles({
    content_scripts: [{
      matches: ["https://x.com/*"],
      run_at: "document_idle"
    }]
  });

  assert.deepEqual(manifest.content_scripts[0].css, CONTENT_SCRIPT_CSS_FILES);
  assert.deepEqual(manifest.content_scripts[0].js, CONTENT_SCRIPT_FILES);
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

test("deepMerge clones nested values and replaces arrays with override values", () => {
  const baseValue = {
    action: {
      default_title: "Easy TweetBlock"
    },
    host_permissions: ["https://x.com/*"],
    permissions: ["tabs"]
  };
  const overrideValue = {
    action: {
      default_popup: "src/popup/popup.html"
    },
    host_permissions: ["https://twitter.com/*"]
  };

  const mergedValue = deepMerge(baseValue, overrideValue);

  assert.deepEqual(mergedValue, {
    action: {
      default_popup: "src/popup/popup.html",
      default_title: "Easy TweetBlock"
    },
    host_permissions: ["https://twitter.com/*"],
    permissions: ["tabs"]
  });

  overrideValue.host_permissions[0] = "changed";
  assert.deepEqual(baseValue.host_permissions, ["https://x.com/*"]);
  assert.deepEqual(mergedValue.host_permissions, ["https://twitter.com/*"]);
});

test("assertTarget rejects unsupported manifest targets", () => {
  assert.throws(() => assertTarget("edge"), /Unsupported manifest target: edge/);
});

test("writeManifest requires an output directory", () => {
  assert.throws(() => writeManifest("chrome"), /An output directory is required/);
});

test("build-manifest CLI prints usage when required arguments are missing", () => {
  const result = spawnSync(process.execPath, ["scripts/build-manifest.js"], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8"
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: node scripts\/build-manifest\.js <firefox\|chrome> <output-dir>/);
});

test("build-manifest CLI reports invalid targets", () => {
  const result = spawnSync(process.execPath, ["scripts/build-manifest.js", "edge", path.join(os.tmpdir(), "easy-tweetblock-invalid-target")], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8"
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unsupported manifest target: edge/);
});
