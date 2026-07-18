const fs = require("node:fs");
const path = require("node:path");
const yazl = require("yazl");

const { SUPPORTED_TARGETS } = require("./build-manifest.js");
const { DIST_DIR, stageExtension } = require("./stage-extension.js");

const FIXED_ZIP_DATE = new Date(1980, 0, 1, 0, 0, 0);
const STABLE_FILE_MODE = 0o100644;
const ARCHIVE_EXTENSIONS = Object.freeze({
  chrome: ".zip",
  firefox: ".xpi"
});

function compareStrings(left, right) {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function resolveDistDir(distDir) {
  return distDir == null ? DIST_DIR : distDir;
}

function assertTarget(target) {
  if (!SUPPORTED_TARGETS.has(target)) {
    throw new Error(`Unsupported package target: ${target}`);
  }
}

function assertSafeOutputName(outputName) {
  if (typeof outputName !== "string") {
    throw new Error("Output name must be a string.");
  }

  const normalizedOutputName = outputName.trim();

  if (!normalizedOutputName) {
    throw new Error("Output name must not be empty.");
  }

  if (
    path.posix.basename(normalizedOutputName) !== normalizedOutputName ||
    path.win32.basename(normalizedOutputName) !== normalizedOutputName ||
    normalizedOutputName === "." ||
    normalizedOutputName === ".."
  ) {
    throw new Error("Output name must be a plain filename without path separators.");
  }

  return normalizedOutputName;
}

function normalizeOutputName(target, outputName, manifestVersion) {
  let resolvedOutputName = outputName || `easy-tweetblock-${manifestVersion}-${target}`;
  const archiveExtension = ARCHIVE_EXTENSIONS[target];

  if (!resolvedOutputName.toLowerCase().endsWith(archiveExtension)) {
    resolvedOutputName = `${resolvedOutputName}${archiveExtension}`;
  }

  return resolvedOutputName;
}

function parseArgs(argv) {
  const [target, ...rest] = argv;

  if (!target) {
    throw new Error("Usage: node scripts/package-extension.js <firefox|chrome> [--output-name <filename>]");
  }

  let outputName;

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];

    if (arg === "--output-name") {
      const nextValue = rest[index + 1];

      if (!nextValue) {
        throw new Error("Missing value for --output-name.");
      }

      outputName = nextValue;
      index += 1;
      continue;
    }

    if (arg.startsWith("--output-name=")) {
      outputName = arg.slice("--output-name=".length);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { target, outputName };
}

function toArchivePath(stageDir, absolutePath) {
  return path.relative(stageDir, absolutePath).split(path.sep).join("/");
}

function collectStageFiles(stageDir, currentDir = stageDir, collectedFiles = []) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true })
    .sort((left, right) => compareStrings(left.name, right.name));

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      collectStageFiles(stageDir, absolutePath, collectedFiles);
      continue;
    }

    if (entry.isFile()) {
      collectedFiles.push({
        absolutePath,
        archivePath: toArchivePath(stageDir, absolutePath)
      });
      continue;
    }

    throw new Error(`Unsupported staged entry type: ${absolutePath}`);
  }

  return collectedFiles.sort((left, right) => compareStrings(left.archivePath, right.archivePath));
}

function writeDeterministicZip({ stageDir, outputPath }) {
  const tempOutputPath = `${outputPath}.tmp`;
  const stagedFiles = collectStageFiles(stageDir);

  fs.rmSync(tempOutputPath, { force: true });

  return new Promise((resolve, reject) => {
    const zipFile = new yazl.ZipFile();
    const writeStream = fs.createWriteStream(tempOutputPath);
    let settled = false;

    function finish(error) {
      if (settled) {
        return;
      }

      settled = true;

      if (error) {
        writeStream.destroy();
        fs.rmSync(tempOutputPath, { force: true });
        reject(error);
        return;
      }

      resolve({ fileCount: stagedFiles.length, tempOutputPath });
    }

    zipFile.once("error", finish);
    zipFile.outputStream.once("error", finish);
    writeStream.once("error", finish);
    writeStream.once("close", () => finish());

    zipFile.outputStream.pipe(writeStream);

    for (const stagedFile of stagedFiles) {
      zipFile.addFile(stagedFile.absolutePath, stagedFile.archivePath, {
        compress: true,
        forceDosTimestamp: true,
        mode: STABLE_FILE_MODE,
        mtime: FIXED_ZIP_DATE
      });
    }

    zipFile.end();
  });
}

async function packageExtension({ target, outputName, distDir } = {}) {
  assertTarget(target);

  const safeOutputName = outputName == null ? undefined : assertSafeOutputName(outputName);
  const resolvedDistDir = resolveDistDir(distDir);
  const { outputPath: manifestPath, stageDir } = stageExtension(target, resolvedDistDir);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  if (typeof manifest.version !== "string" || !manifest.version) {
    throw new Error(`Missing manifest version: ${manifestPath}`);
  }

  const resolvedOutputName = normalizeOutputName(target, safeOutputName, manifest.version);
  const outputPath = path.join(resolvedDistDir, resolvedOutputName);

  fs.rmSync(outputPath, { force: true });

  const { fileCount, tempOutputPath } = await writeDeterministicZip({ stageDir, outputPath });
  fs.renameSync(tempOutputPath, outputPath);

  return { fileCount, manifest, outputPath, stageDir };
}

if (require.main === module) {
  (async () => {
    try {
      const options = parseArgs(process.argv.slice(2));
      const { fileCount, outputPath, stageDir } = await packageExtension(options);
      console.log(`Built ${options.target} package: ${outputPath}`);
      console.log(`Archived ${fileCount} files from: ${stageDir}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  })();
}

module.exports = {
  ARCHIVE_EXTENSIONS,
  DIST_DIR,
  FIXED_ZIP_DATE,
  STABLE_FILE_MODE,
  assertSafeOutputName,
  assertTarget,
  collectStageFiles,
  normalizeOutputName,
  packageExtension,
  parseArgs,
  writeDeterministicZip
};
