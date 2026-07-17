const fs = require("node:fs");
const path = require("node:path");

const { PROJECT_ROOT, SUPPORTED_TARGETS, writeManifest } = require("./build-manifest.js");

const DIST_DIR = path.join(PROJECT_ROOT, "dist");
const SRC_DIR = path.join(PROJECT_ROOT, "src");
const ASSETS_DIR = path.join(PROJECT_ROOT, "assets");
const EXTENSION_ICON_FILES = Object.freeze([
  "16.png",
  "32.png",
  "48.png",
  "128.png"
]);

function assertTarget(target) {
  if (!SUPPORTED_TARGETS.has(target)) {
    throw new Error(`Unsupported stage target: ${target}`);
  }
}

function assertRequiredPath(requiredPath) {
  if (!fs.existsSync(requiredPath)) {
    throw new Error(`Missing required path: ${requiredPath}`);
  }
}

function assertExtensionAssets() {
  for (const iconFile of EXTENSION_ICON_FILES) {
    assertRequiredPath(path.join(ASSETS_DIR, "extension", iconFile));
  }
}

function prepareStageDir(target, distDir = DIST_DIR) {
  const stageDir = path.join(distDir, `${target}-package`);

  fs.mkdirSync(distDir, { recursive: true });
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });

  return stageDir;
}

function copyIfExists(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath)) {
    return;
  }

  fs.cpSync(sourcePath, targetPath, { recursive: true, force: true });
}

function stageExtension(target, distDir = DIST_DIR) {
  assertTarget(target);
  assertRequiredPath(SRC_DIR);
  assertExtensionAssets();

  const stageDir = prepareStageDir(target, distDir);

  copyIfExists(SRC_DIR, path.join(stageDir, "src"));
  copyIfExists(ASSETS_DIR, path.join(stageDir, "assets"));

  const { outputPath } = writeManifest(target, stageDir);

  return {
    outputPath,
    stageDir
  };
}

if (require.main === module) {
  const [, , target] = process.argv;

  if (!target) {
    console.error("Usage: node scripts/stage-extension.js <firefox|chrome>");
    process.exit(1);
  }

  try {
    const { stageDir } = stageExtension(target);
    console.log(`Prepared stage: ${stageDir}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  ASSETS_DIR,
  DIST_DIR,
  EXTENSION_ICON_FILES,
  SRC_DIR,
  assertRequiredPath,
  assertExtensionAssets,
  assertTarget,
  copyIfExists,
  prepareStageDir,
  stageExtension
};
