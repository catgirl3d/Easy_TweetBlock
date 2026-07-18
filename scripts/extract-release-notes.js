const fs = require("node:fs");
const path = require("node:path");

const { PROJECT_ROOT } = require("./build-manifest.js");
const { normalizeTagName } = require("./validate-release-tag.js");

const CHANGELOG_PATH = path.join(PROJECT_ROOT, "changelog.md");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractReleaseNotes(tagName, changelogPath = CHANGELOG_PATH) {
  const normalizedTag = normalizeTagName(tagName);
  const changelog = fs.readFileSync(changelogPath, "utf8");
  const headerPattern = new RegExp(`^##\\s+v?${escapeRegExp(normalizedTag)}(?:\\s+-.*)?$`);
  const sectionLines = [];
  let isCollecting = false;

  for (const line of changelog.split(/\r?\n/)) {
    if (!isCollecting && headerPattern.test(line.trim())) {
      isCollecting = true;
      sectionLines.push(line);
      continue;
    }

    if (isCollecting && line.startsWith("## ")) {
      break;
    }

    if (isCollecting) {
      sectionLines.push(line);
    }
  }

  if (!sectionLines.length) {
    throw new Error(`Could not find changelog section for version '${normalizedTag}' in ${path.basename(changelogPath)}.`);
  }

  return sectionLines.join("\n").trim();
}

function writeReleaseNotes(tagName, outputPath, changelogPath = CHANGELOG_PATH) {
  if (typeof outputPath !== "string" || !outputPath.trim()) {
    throw new Error("An output file path is required.");
  }

  const releaseNotes = extractReleaseNotes(tagName, changelogPath);
  fs.writeFileSync(outputPath, `${releaseNotes}\n`, "utf8");

  return outputPath;
}

if (require.main === module) {
  try {
    const [, , tagName, outputPath] = process.argv;

    if (outputPath) {
      writeReleaseNotes(tagName, outputPath);
    } else {
      process.stdout.write(`${extractReleaseNotes(tagName)}\n`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  CHANGELOG_PATH,
  extractReleaseNotes,
  writeReleaseNotes
};
