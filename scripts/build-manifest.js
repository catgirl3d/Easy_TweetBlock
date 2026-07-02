const fs = require("node:fs");
const path = require("node:path");

const {
  CONTENT_SCRIPT_CSS_FILES,
  CONTENT_SCRIPT_FILES
} = require("../src/shared/content-script-files.js");

const PROJECT_ROOT = path.join(__dirname, "..");
const MANIFESTS_DIR = path.join(PROJECT_ROOT, "manifests");
const SUPPORTED_TARGETS = new Set(["firefox", "chrome"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue(entry));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)])
    );
  }

  return value;
}

function deepMerge(baseValue, overrideValue) {
  if (Array.isArray(baseValue) && Array.isArray(overrideValue)) {
    return cloneValue(overrideValue);
  }

  if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
    const result = cloneValue(baseValue);

    for (const [key, value] of Object.entries(overrideValue)) {
      result[key] = Object.prototype.hasOwnProperty.call(baseValue, key)
        ? deepMerge(baseValue[key], value)
        : cloneValue(value);
    }

    return result;
  }

  return cloneValue(overrideValue);
}

function assertTarget(target) {
  if (!SUPPORTED_TARGETS.has(target)) {
    throw new Error(`Unsupported manifest target: ${target}`);
  }
}

function loadManifestFragment(name) {
  const filePath = path.join(MANIFESTS_DIR, `${name}.json`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function applyDefaultContentScriptFiles(manifest) {
  const nextManifest = cloneValue(manifest);

  if (!Array.isArray(nextManifest.content_scripts)) {
    return nextManifest;
  }

  nextManifest.content_scripts = nextManifest.content_scripts.map((entry) => {
    const nextEntry = cloneValue(entry);

    if (!Array.isArray(nextEntry.css)) {
      nextEntry.css = [...CONTENT_SCRIPT_CSS_FILES];
    }

    if (!Array.isArray(nextEntry.js)) {
      nextEntry.js = [...CONTENT_SCRIPT_FILES];
    }

    return nextEntry;
  });

  return nextManifest;
}

function buildManifest(target) {
  assertTarget(target);
  return applyDefaultContentScriptFiles(
    deepMerge(loadManifestFragment("base"), loadManifestFragment(target))
  );
}

function writeManifest(target, outputDir) {
  assertTarget(target);

  if (!outputDir) {
    throw new Error("An output directory is required.");
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const manifest = buildManifest(target);
  const outputPath = path.join(outputDir, "manifest.json");

  fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return {
    manifest,
    outputPath
  };
}

if (require.main === module) {
  const [, , target, outputDir] = process.argv;

  if (!target || !outputDir) {
    console.error("Usage: node scripts/build-manifest.js <firefox|chrome> <output-dir>");
    process.exit(1);
  }

  try {
    const { outputPath } = writeManifest(target, outputDir);
    console.log(`Built manifest: ${outputPath}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  MANIFESTS_DIR,
  PROJECT_ROOT,
  SUPPORTED_TARGETS,
  applyDefaultContentScriptFiles,
  assertTarget,
  buildManifest,
  cloneValue,
  deepMerge,
  loadManifestFragment,
  writeManifest
};
