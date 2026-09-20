// Post-build cleanup: remove every "win-unpacked" folder produced by
// electron-builder (the intermediate unpacked app dir). Runs after a build so
// only the final artifacts (installers / portable exe / asar packages) remain.
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SKIP = new Set(['node_modules', '.git', '_archive']);
let removed = 0;

function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { return; }

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (SKIP.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.name === 'win-unpacked') {
      try {
        fs.rmSync(full, { recursive: true, force: true });
        console.log('🧹 Removed', path.relative(ROOT, full) || full);
        removed++;
      } catch (e) {
        console.warn('⚠ Could not remove', full, '-', e.message);
      }
      continue; // nothing left to descend into
    }
    walk(full);
  }
}

walk(ROOT);
console.log(removed ? `✅ Cleanup done — ${removed} win-unpacked folder(s) removed.` : 'ℹ No win-unpacked folders found.');
