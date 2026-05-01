/**
 * Writes build/icon.png (1024×1024) from renderer/public/logo3.jpeg with a centered cover.
 *
 * Applies a centered superellipse (≈Apple squircle silhouette) alpha mask so the Dock shows
 * a rounded icon; raw square PNGs are drawn sharp by Electron’s dock integration.
 *
 * Run: npm run build:icon
 */
const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'build');
const OUT_FILE = path.join(OUT_DIR, 'icon.png');
const SRC = path.join(ROOT, 'renderer', 'public', 'logo3.jpeg');

function insideSquircle(px, py, size, exponent) {
  const half = size / 2;
  const ux = (px + 0.5 - half) / half;
  const uy = (py + 0.5 - half) / half;
  const ax = Math.abs(ux);
  const ay = Math.abs(uy);
  const v = Math.pow(ax, exponent) + Math.pow(ay, exponent);
  return v <= 1 + 1e-6;
}

async function main() {
  if (!fs.existsSync(SRC)) {
    throw new Error(`Source logo not found: ${SRC}`);
  }
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  const size = 1024;
  const exponent = 5;

  const image = await Jimp.read(SRC);
  image.cover(
    size,
    size,
    Jimp.HORIZONTAL_ALIGN_CENTER | Jimp.VERTICAL_ALIGN_MIDDLE
  );

  image.scan(0, 0, size, size, function (x, y, idx) {
    if (!insideSquircle(x, y, size, exponent)) {
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
