// Finds user-visible text that is written straight into the DOM (or into the
// game's own floating-text/banner helpers) as an English literal instead of
// going through t(). Those strings stay English in every language — which is
// exactly what a player notices as "the popups are still in English".
//
//   node tools/find-hardcoded.js
//
// It is deliberately noisy-but-filtered rather than clever: the point is a
// short list a human can scan, not a parser.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILES = [path.join(ROOT, 'index.html')].concat(
  fs.readdirSync(path.join(ROOT, 'assets'))
    .filter(f => f.endsWith('.js'))
    .map(f => path.join(ROOT, 'assets', f)));

// Sinks that put text in front of the player.
const SINKS = [
  /\bfloatTxt\s*\(\s*[^,]+,\s*[^,]+,\s*(['"])((?:(?!\1).)+)\1/g,
  /\.textContent\s*=\s*(['"])((?:(?!\1).)+)\1/g,
  /\.innerHTML\s*=\s*(['"])((?:(?!\1).)+)\1/g,
  /\.placeholder\s*=\s*(['"])((?:(?!\1).)+)\1/g,
  /\bsetStatus\s*\(\s*(['"])((?:(?!\1).)+)\1/g,
  /\bnetStatus\s*\(\s*(['"])((?:(?!\1).)+)\1/g,
  /\btoast\s*\(\s*(['"])((?:(?!\1).)+)\1/g,
  /\bshowBanner\s*\(\s*(['"])((?:(?!\1).)+)\1/g,
];

// Things that are not translatable copy.
const IGNORE = [
  /^[\s\d.,:;/%×+\-–—·()[\]{}<>|#*]*$/,           // punctuation / numbers only
  /^(none|flex|block|inline[-\w]*|grid|auto|hidden|visible|absolute|fixed|relative|static|scroll)$/i,
  /^[a-z-]+:\s*[^;]+;?$/i,                          // a css declaration
  /^#[0-9a-f]{3,8}$/i, /^rgba?\(/i, /^hsla?\(/i,
  /^\d+(\.\d+)?(px|em|rem|%|vh|vw|s|ms)$/i,
  /^<[a-z/]/i,                                      // markup fragments
  /^https?:|^wss?:/i,
  /^[a-z_][a-z0-9_]*$/,                             // single lowercase identifier
  /^\p{Emoji}+[\s‍️]*$/u,                 // emoji-only decoration
  /^⚡ BYTE BLASTER$/,                               // the game's own name — a proper noun
];

function translatable(s) {
  const t = s.trim();
  if (t.length < 3) return false;
  if (IGNORE.some(re => re.test(t))) return false;
  // Must contain at least two consecutive latin letters to be prose.
  if (!/[A-Za-z]{2}/.test(t)) return false;
  return true;
}

let total = 0;
for (const file of FILES) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const hits = [];
  for (const re of SINKS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      const text = m[2];
      if (!translatable(text)) continue;
      const line = src.slice(0, m.index).split('\n').length;
      // Skip lines that already call the translator somewhere — those are
      // usually `el.textContent = 'x' ; ... t(...)` false positives.
      if (/\bt\(|\bT\(|tt0\(/.test(lines[line - 1])) continue;
      hits.push({ line, text });
    }
  }
  if (!hits.length) continue;
  hits.sort((a, b) => a.line - b.line);
  console.log('\n── ' + path.relative(ROOT, file) + ' (' + hits.length + ')');
  const seen = new Set();
  for (const h of hits) {
    const key = h.line + '|' + h.text;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log('  ' + String(h.line).padStart(5) + '  ' + JSON.stringify(h.text));
    total++;
  }
}
console.log('\n' + total + ' hardcoded user-visible string(s).');
process.exit(total ? 1 : 0);
