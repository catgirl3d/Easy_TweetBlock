const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { extractReleaseNotes } = require("../scripts/extract-release-notes.js");
const {
  normalizeTagName,
  validateReleaseTag
} = require("../scripts/validate-release-tag.js");

test("normalizeTagName accepts version tags with and without v prefix", () => {
  assert.equal(normalizeTagName("v0.1.0"), "0.1.0");
  assert.equal(normalizeTagName("0.1.0"), "0.1.0");
});

test("validateReleaseTag matches the manifest version", () => {
  assert.deepEqual(validateReleaseTag("v0.1.0"), {
    manifestVersion: "0.1.0",
    normalizedTag: "0.1.0",
    tagName: "v0.1.0"
  });
  assert.throws(() => validateReleaseTag("v0.1.1"), /does not match/);
});

test("extractReleaseNotes returns only the requested changelog section", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "easy-tweetblock-release-notes-"));
  const changelogPath = path.join(tempDir, "changelog.md");

  try {
    fs.writeFileSync(changelogPath, [
      "# Changelog",
      "",
      "## v2.0.0 - 2026-07-18",
      "New release notes.",
      "",
      "## v1.0.0 - 2026-07-01",
      "Old release notes.",
      ""
    ].join("\n"), "utf8");

    assert.equal(
      extractReleaseNotes("v2.0.0", changelogPath),
      "## v2.0.0 - 2026-07-18\nNew release notes."
    );
    assert.throws(() => extractReleaseNotes("v3.0.0", changelogPath), /Could not find changelog section/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
