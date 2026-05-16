/* eslint-disable no-console */
/**
 * Build script: render media/icon.svg → media/icon.png at 256x256 for the
 * Marketplace icon. Run via `npm run build-icon`.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const src = path.join(__dirname, '..', 'media', 'icon.svg');
const out = path.join(__dirname, '..', 'media', 'icon.png');

sharp(fs.readFileSync(src), { density: 384 })
  .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png({ compressionLevel: 9 })
  .toFile(out)
  .then(() => console.log(`✔ Wrote ${out}`))
  .catch((err) => { console.error(err); process.exit(1); });
