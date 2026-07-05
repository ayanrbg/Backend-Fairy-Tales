/**
 * Generate small "first illustration" thumbnails for every tale and write them
 * to the promo admin site's static folder, so the analytics UI shows tale
 * covers loaded locally (no per-view API call).
 *
 *   node scripts/gen-tale-thumbs.js [outDir]
 *   default outDir: /var/www/bala-stories/client/tale-thumbs
 *
 * Source = the first illustration (page_0) of each tale in
 * data/illustrations/<id>/ (prefers plain page_0, then _boy, then _girl).
 * Re-run after adding/replacing illustrations.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ILL_DIR = path.join(__dirname, '..', 'data', 'illustrations');
const OUT_DIR = process.argv[2] || '/var/www/bala-stories/client/tale-thumbs';
const WIDTH = 480;
// Preference order for "first illustration".
const CANDIDATES = [
  'page_0.jpg', 'page_0.jpeg', 'page_0.png', 'page_0.webp',
  'page_0_boy.jpg', 'page_0_boy.png', 'page_0_girl.jpg', 'page_0_girl.png',
];

async function main() {
  if (!fs.existsSync(ILL_DIR)) { console.error('no illustrations dir:', ILL_DIR); process.exit(1); }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tales = fs.readdirSync(ILL_DIR).filter((d) => {
    try { return fs.statSync(path.join(ILL_DIR, d)).isDirectory(); } catch (_) { return false; }
  });
  let made = 0, skipped = 0;
  for (const id of tales) {
    const dir = path.join(ILL_DIR, id);
    let src = CANDIDATES.map((c) => path.join(dir, c)).find((p) => fs.existsSync(p));
    if (!src) {
      const any = fs.readdirSync(dir).find((f) => /^page_0(_|\.)/i.test(f));
      if (any) src = path.join(dir, any);
    }
    if (!src) { console.log(`- ${id}: no page_0, skip`); skipped++; continue; }
    try {
      await sharp(src).rotate()
        .resize({ width: WIDTH, withoutEnlargement: true })
        .jpeg({ quality: 80, mozjpeg: true })
        .toFile(path.join(OUT_DIR, id + '.jpg'));
      made++;
      console.log(`✓ ${id} <- ${path.basename(src)}`);
    } catch (e) { console.error(`✗ ${id}: ${e.message}`); skipped++; }
  }
  console.log(`\nDone: ${made} thumbnails -> ${OUT_DIR}, ${skipped} skipped`);
}
main();
