// Localisation audit. Run from the project root:
//
//   node tools/loc-audit.js              summary table for every language
//   node tools/loc-audit.js de           full report for one language
//   node tools/loc-audit.js --untranslated   list every string still in English
//   node tools/loc-audit.js --keys       keys used in code but absent from en.json
//   node tools/loc-audit.js --fix        delete keys no locale file should have
//
// Why this exists: keys kept being added to en.json/ru.json by whoever wrote a
// feature, and the other 37 files silently fell behind — t() falls back to
// English, so nothing ever breaks loudly and the drift is invisible in game.
// This makes it countable.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOC = path.join(ROOT, 'assets', 'localisation');

// Strings that are SUPPOSED to read the same in every language: proper nouns,
// numbers, punctuation-only labels and codes. Flagging them as untranslated is
// noise, and "fixing" them would be wrong.
const SAME_BY_DESIGN = new Set([
  // Название игры одинаково на всех языках — это имя собственное.
  'accLicences',
  'langName', 'netCodePlaceholder', 'stomp', 'resHD', 'resFullHD', 'res2K', 'res4K',
  'boss0', 'boss1', 'boss2', 'boss3', 'boss4', 'boss5', 'boss6', 'boss7', 'boss8', 'boss9', 'boss10',
  'vsync', 'fps30', 'fps60', 'fps120', 'fps144', 'fpsUnlimited',
  // Character and product names — these are the same in every language, and a
  // "translation" of them would just be wrong.
  'avUnit7', 'avUnitVariant', 'avLeila', 'avArchon', 'profileDefaultNick',
  'cin_pro_arrest_sp', 'cin_pro_file_sp', 'cin_pro_accept_sp',
  // Symbol/number-only strings and technical examples.
  'mapProg', 'netLanHostPlaceholder', 'ctrlTabPC', 'achSecretName',
]);
const CODEY = /^[\s\d+\-—·/×%:.,()[\]{}<>|←-⇿☀-➿️\u{1F000}-\u{1FAFF}]*$/u;

// Per-language loanwords: words a language genuinely borrowed from English, so
// the correct translation IS the English spelling ("MENU" in Malay, "SABOTEUR"
// in French, "Later" in Dutch). Unlike SAME_BY_DESIGN these are language-
// specific — "CHAT" is right in German and wrong in Russian — so they live in a
// reviewed baseline file rather than in this Set. Every entry was checked by
// hand once the file reached full coverage; a key that is NOT listed here still
// gets flagged, so new drift is caught as usual.
const LOANWORDS = (() => {
  const p = path.join(__dirname, 'loc-loanwords.json');
  if (!fs.existsSync(p)) return {};
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const out = {};
  for (const k of Object.keys(raw)) out[k] = new Set(raw[k]);
  return out;
})();

function locales() {
  return fs.readdirSync(LOC)
    .filter(f => f.endsWith('.json') && f !== 'index.json' && !f.startsWith('_'))
    .map(f => f.replace(/\.json$/, ''))
    .sort();
}
const read = code => JSON.parse(fs.readFileSync(path.join(LOC, code + '.json'), 'utf8'));
const write = (code, obj) =>
  fs.writeFileSync(path.join(LOC, code + '.json'), JSON.stringify(obj, null, 2) + '\n', 'utf8');

// {0}, {1}… must survive translation: a dropped placeholder shows a raw brace
// or silently loses a number the sentence depends on.
const slots = s => (String(s).match(/\{\d+\}/g) || []).sort().join(',');
// <br>, <b>, <span…> likewise: several strings are injected with innerHTML.
const tags = s => (String(s).match(/<[^>]+>/g) || []).map(t => t.split(/[\s>]/)[0] + '>').sort().join(',');

function analyse(code, en) {
  const d = read(code);
  const missing = [], extra = [], slotBad = [], tagBad = [], sameAsEn = [];
  for (const k of Object.keys(en)) {
    if (!(k in d)) { missing.push(k); continue; }
    const a = en[k], b = d[k];
    if (typeof a !== 'string' || typeof b !== 'string') continue;
    if (slots(a) !== slots(b)) slotBad.push(k + ' [en:' + (slots(a) || '-') + ' → ' + (slots(b) || '-') + ']');
    if (tags(a) !== tags(b)) tagBad.push(k + ' [en:' + (tags(a) || '-') + ' → ' + (tags(b) || '-') + ']');
    const loan = LOANWORDS[code];
    if (code !== 'en' && a === b && !SAME_BY_DESIGN.has(k) && !(loan && loan.has(k))
        && !CODEY.test(a) && a.length > 3) sameAsEn.push(k);
  }
  for (const k of Object.keys(d)) if (!(k in en)) extra.push(k);
  return { code, count: Object.keys(d).length, missing, extra, slotBad, tagBad, sameAsEn };
}

// Every key the code actually asks for. Dynamic keys (built by concatenation)
// are listed as prefixes so they don't show up as false positives.
const DYNAMIC_PREFIXES = ['bossHint', 'cin_', 'world', 'boss', 'achievement_', 'rank', 'w10_'];

// Those prefixes hide real gaps. Keys like `world10`, `boss10` and the ten late
// `achievement_*` entries are built by concatenation, so --keys skipped them —
// and all three sets turned out to be missing from every locale while the game
// silently fell back to English text baked into the source. This walks the
// actual definitions and reports any that no locale defines.
function enumeratedKeys() {
  const want = new Set();
  const read = f => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return ''; } };

  // achievements.js: every id is a real key, plus its _desc twin.
  for (const m of read('assets/achievements.js').matchAll(/id:\s*'(achievement_[A-Za-z0-9_]+)'/g)) {
    want.add(m[1]); want.add(m[1] + '_desc');
  }
  // worldmap.js: one world + boss name per world in the WORLDS table.
  const worlds = (read('assets/worldmap.js').match(/\{\s*id:\s*\d+,\s*name:/g) || []).length;
  for (let i = 0; i < worlds; i++) { want.add('world' + i); want.add('boss' + i); }
  return want;
}

function keysUsedInCode() {
  // i18n-new.js is the engine, not a consumer: its comments document the
  // data-i18n-ph="key" attribute syntax and would be read as a real key.
  const files = [path.join(ROOT, 'index.html')]
    .concat(fs.readdirSync(path.join(ROOT, 'assets'))
      .filter(f => f.endsWith('.js') && f !== 'i18n-new.js')
      .map(f => path.join(ROOT, 'assets', f)));
  const found = new Set();
  const re = /\b[tT]\('([a-zA-Z0-9_]+)'|data-i18n(?:-html|-ph)?="([a-zA-Z0-9_]+)"/g;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    let m;
    while ((m = re.exec(src))) found.add(m[1] || m[2]);
  }
  return found;
}

const arg = process.argv[2];
const en = read('en');
const all = locales();

if (arg === '--keys') {
  const used = keysUsedInCode();
  const enumerated = [...enumeratedKeys()].filter(k => !(k in en));
  const missing = [...used].filter(k => !(k in en) && !DYNAMIC_PREFIXES.some(p => k === p || k.startsWith(p)))
    .concat(enumerated);
  const unused = Object.keys(en).filter(k => !used.has(k) && !DYNAMIC_PREFIXES.some(p => k.startsWith(p)));
  console.log('keys used in code : ' + used.size);
  console.log('keys in en.json   : ' + Object.keys(en).length);
  console.log('\nUSED BUT NOT DEFINED (' + missing.length + '):');
  missing.forEach(k => console.log('  ' + k));
  console.log('\nDEFINED BUT NEVER USED (' + unused.length + '):');
  unused.forEach(k => console.log('  ' + k));
  process.exit(missing.length ? 1 : 0);
}

if (arg === '--fix') {
  let removed = 0;
  for (const code of all) {
    const d = read(code);
    const extra = Object.keys(d).filter(k => !(k in en));
    if (!extra.length) continue;
    extra.forEach(k => { delete d[k]; removed++; });
    write(code, d);
    console.log(code + ': removed ' + extra.length + ' stale key(s): ' + extra.join(', '));
  }
  console.log(removed ? '\nRemoved ' + removed + ' stale entries.' : 'Nothing to remove.');
  process.exit(0);
}

if (arg === '--untranslated') {
  for (const code of all) {
    if (code === 'en') continue;
    const r = analyse(code, en);
    if (!r.sameAsEn.length) continue;
    console.log('\n── ' + code + ' (' + r.sameAsEn.length + ') ' + '─'.repeat(40));
    r.sameAsEn.forEach(k => console.log('  ' + k.padEnd(28) + JSON.stringify(en[k]).slice(0, 70)));
  }
  process.exit(0);
}

if (arg && all.includes(arg)) {
  const r = analyse(arg, en);
  console.log('=== ' + arg + ' — ' + r.count + ' keys ===');
  const dump = (title, list) => {
    console.log('\n' + title + ' (' + list.length + ')');
    list.forEach(k => console.log('  ' + k));
  };
  dump('MISSING', r.missing);
  dump('STALE (not in en.json)', r.extra);
  dump('PLACEHOLDER MISMATCH', r.slotBad);
  dump('HTML TAG MISMATCH', r.tagBad);
  dump('STILL IN ENGLISH', r.sameAsEn);
  process.exit(r.missing.length + r.slotBad.length + r.tagBad.length ? 1 : 0);
}

// Default: the summary table.
const rows = all.map(c => analyse(c, en));
const bad = rows.filter(r => r.missing.length || r.extra.length || r.slotBad.length || r.tagBad.length);
console.log('en.json defines ' + Object.keys(en).length + ' keys across ' + all.length + ' languages\n');
console.log('lang    keys  missing  stale  {n}  <tag>  english');
console.log('─'.repeat(56));
for (const r of rows.sort((a, b) => (b.missing.length - a.missing.length) || a.code.localeCompare(b.code))) {
  console.log(
    r.code.padEnd(8) + String(r.count).padStart(4) +
    String(r.missing.length).padStart(9) + String(r.extra.length).padStart(7) +
    String(r.slotBad.length).padStart(5) + String(r.tagBad.length).padStart(7) +
    String(r.sameAsEn.length).padStart(9));
}
console.log('\n"english" = strings identical to en.json (excluding proper nouns / codes).');
console.log('Run  node tools/loc-audit.js <lang>  for the detail, --untranslated for all of it.');
process.exit(bad.length ? 1 : 0);
