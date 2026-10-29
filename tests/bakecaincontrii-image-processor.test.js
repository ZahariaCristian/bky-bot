const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { getCompatibilityCanvas } = require("../imageCompatibility");

let sharp = null;
try {
  sharp = require("sharp");
} catch { }

test("selects a standard compatibility canvas from the oriented image shape", () => {
  assert.deepEqual(getCompatibilityCanvas({ width: 400, height: 900 }), { width: 1200, height: 1600 });
  assert.deepEqual(getCompatibilityCanvas({ width: 900, height: 400 }), { width: 1600, height: 1200 });
  assert.deepEqual(getCompatibilityCanvas({ width: 400, height: 900, orientation: 6 }), { width: 1600, height: 1200 });
  assert.deepEqual(getCompatibilityCanvas({ width: 500, height: 500 }), { width: 1400, height: 1400 });
});

test("compatibility mode creates an opaque baseline JPEG on a safe canvas", {
  skip: sharp ? false : "sharp is not installed in this local checkout",
}, async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "bky-image-processor-"));
  process.env.IMAGE_PATH = temporaryDirectory;
  const { prepareUploadImage } = require("../imageProcessor");
  const sourcePath = path.join(temporaryDirectory, "small-transparent-source.png");
  try {
    await sharp({
      create: {
        width: 240,
        height: 480,
        channels: 4,
        background: { r: 30, g: 80, b: 120, alpha: 0.4 },
      },
    }).png().toFile(sourcePath);

    const outputPath = await prepareUploadImage(sourcePath, { compatibilityMode: true });
    const metadata = await sharp(outputPath).metadata();
    const statistics = fs.statSync(outputPath);

    assert.equal(metadata.format, "jpeg");
    assert.equal(metadata.width, 1200);
    assert.equal(metadata.height, 1600);
    assert.equal(metadata.channels, 3);
    assert.equal(metadata.isProgressive, false);
    assert.equal(Boolean(metadata.exif), false);
    assert.equal(statistics.size > 0, true);
  } finally {
    const resolvedTemporaryDirectory = path.resolve(temporaryDirectory);
    const resolvedSystemTemporaryDirectory = path.resolve(os.tmpdir());
    assert.equal(resolvedTemporaryDirectory.startsWith(resolvedSystemTemporaryDirectory), true);
    fs.rmSync(resolvedTemporaryDirectory, { recursive: true, force: true });
  }
});
