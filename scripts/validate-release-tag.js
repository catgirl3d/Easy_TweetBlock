const fs = require("node:fs");
const path = require("node:path");

const { PROJECT_ROOT } = require("./build-manifest.js");

const BASE_MANIFEST_PATH = path.join(PROJECT_ROOT, "manifests", "base.json");
const RELEASE_TAG_PATTERN = /^v?\d+\.\d+\.\d+$/;

function readManifestVersion() {
  return JSON.parse(fs.readFileSync(BASE_MANIFEST_PATH, "utf8")).version;
}

function normalizeTagName(tagName) {
  if (typeof tagName !== "string" || !tagName.trim()) {
    throw new Error("A release tag is required.");
  }

  const trimmedTagName = tagName.trim();

  if (!RELEASE_TAG_PATTERN.test(trimmedTagName)) {
    throw new Error(`Release tag must look like v1.2.3 or 1.2.3. Received '${trimmedTagName}'.`);
  }

  return trimmedTagName.startsWith("v") ? trimmedTagName.slice(1) : trimmedTagName;
}

function validateReleaseTag(tagName) {
  const manifestVersion = readManifestVersion();
  const normalizedTag = normalizeTagName(tagName);

  if (normalizedTag !== manifestVersion) {
    throw new Error(`Release tag '${tagName.trim()}' does not match manifests/base.json version '${manifestVersion}'.`);
  }

  return {
    manifestVersion,
    normalizedTag,
    tagName: tagName.trim()
  };
}

if (require.main === module) {
  try {
    const [, , tagName] = process.argv;
    const result = validateReleaseTag(tagName);
    console.log(`Validated release tag ${result.tagName} against manifests/base.json version ${result.manifestVersion}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  BASE_MANIFEST_PATH,
  RELEASE_TAG_PATTERN,
  normalizeTagName,
  readManifestVersion,
  validateReleaseTag
};
