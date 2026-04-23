/**
 * Writes build/icon.png (1024×1024) with a circular mask from renderer/public/logo2.png
 * for macOS squircle + electron-builder. Run: node scripts/apply-circular-macos-icon.js
 */
const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'build');
const OUT_FILE = path.join(OUT_DIR, 'icon.png');
const SRC = path.join(ROOT, 'renderer', 'public', 'logo3.jpeg');

async function main() {
  if (!fs.existsSync(SRC)) {
    throw new Error(`Source logo not found: ${SRC}`);
  }
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  const size = 1024;
  const radius = size / 2 - 2;
  const cx = size / 2;
  const cy = size / 2;

  const image = await Jimp.read(SRC);
  image.cover(
    size,
    size,
    Jimp.HORIZONTAL_ALIGN_CENTER | Jimp.VERTICAL_ALIGN_MIDDLE
  );
  image.scan(0, 0, size, size, function (x, y, idx) {
    const dist = Math.hypot(x - cx, y - cy);
    if (dist > radius) {
      this.bitmap.data[idx + 3] = 0;
    }
  });

  await image.writeAsync(OUT_FILE);
  // eslint-disable-next-line no-console
  console.log('Wrote', OUT_FILE);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
