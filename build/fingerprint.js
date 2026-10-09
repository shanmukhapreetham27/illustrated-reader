// Render every scene twice with src/art.js and print {figureId: fingerprint}.
// Exits non-zero if two renders of the same spec differ (determinism check).
const fs = require('fs');
const path = require('path');
const Art = require(path.join(__dirname, '..', 'src', 'art.js'));

const figures = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = {};
for (const f of figures) {
  const a = Art.render(f), b = Art.render(f);
  if (a !== b) { console.error(`${f.id}: two renders differ`); process.exit(1); }
  out[f.id] = Art.fingerprint(f);
}
process.stdout.write(JSON.stringify(out));
