const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const yauzl = require("yauzl");

const { packageExtension } = require("../scripts/package-extension.js");

function readArchiveEntries(archivePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true }, (openError, zipFile) => {
      if (openError) {
        reject(openError);
        return;
      }

      const entries = [];

      zipFile.once("error", reject);
      zipFile.once("end", () => {
        zipFile.close();
        resolve(entries);
      });
      zipFile.on("entry", (entry) => {
        entries.push({
          compressionMethod: entry.compressionMethod,
          fileName: entry.fileName
        });
        zipFile.readEntry();
      });

      zipFile.readEntry();
    });
  });
}

function readArchiveTextFile(archivePath, targetFileName) {
  return new Promise((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true }, (openError, zipFile) => {
      if (openError) {
        reject(openError);
        return;
      }

      let settled = false;

      function finish(error, result) {
        if (settled) {
          return;
        }

        settled = true;
        zipFile.close();

        if (error) {
          reject(error);
          return;
        }

        resolve(result);
      }

      zipFile.once("error", (error) => finish(error));
      zipFile.once("end", () => finish(new Error(`Archive entry not found: ${targetFileName}`)));
      zipFile.on("entry", (entry) => {
        if (entry.fileName !== targetFileName) {
          zipFile.readEntry();
          return;
        }

        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError) {
            finish(streamError);
            return;
          }

          const chunks = [];
          stream.on("data", (chunk) => chunks.push(chunk));
          stream.once("error", (error) => finish(error));
          stream.once("end", () => finish(null, Buffer.concat(chunks).toString("utf8")));
        });
      });

      zipFile.readEntry();
    });
  });
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

test("packageExtension creates deterministic Chrome ZIP and Firefox XPI archives", async () => {
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), "easy-tweetblock-package-"));

  try {
    await assert.rejects(
      packageExtension({ target: "firefox", outputName: "nested/archive", distDir }),
      /plain filename/
    );

    for (const target of ["firefox", "chrome"]) {
      const outputName = `package-smoke-${target}`;
      const result = await packageExtension({ target, outputName, distDir });
      const entries = await readArchiveEntries(result.outputPath);
      const entryNames = entries.map((entry) => entry.fileName);
      const manifest = JSON.parse(await readArchiveTextFile(result.outputPath, "manifest.json"));
      const firstHash = sha256(result.outputPath);

      assert.equal(result.outputPath, path.join(distDir, `${outputName}${target === "firefox" ? ".xpi" : ".zip"}`));
      assert.equal(result.fileCount, entryNames.length);
      assert.deepEqual(entryNames, [...entryNames].sort());
      assert.equal(entries.every((entry) => entry.compressionMethod === 8), true);
      assert.equal(entryNames.some((entryName) => entryName.endsWith("/")), false);
      assert.deepEqual([...new Set(entryNames.map((entryName) => entryName.split("/")[0]))].sort(), ["assets", "manifest.json", "src"]);
      assert.equal(entryNames.includes("assets/extension/16.png"), true);
      assert.equal(entryNames.includes("src/popup/popup.html"), true);
      assert.equal(entryNames.includes("src/content/main.js"), true);

      if (target === "firefox") {
        assert.deepEqual(manifest.background.scripts, ["src/background/background-firefox.js"]);
      } else {
        assert.equal(manifest.background.service_worker, "src/background/background-chrome.js");
      }

      await packageExtension({ target, outputName, distDir });
      assert.equal(sha256(result.outputPath), firstHash);
    }
  } finally {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
});
