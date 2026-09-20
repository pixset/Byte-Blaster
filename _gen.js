const fs = require('fs'), path = require('path');
const dir = 'localisation';
const en = JSON.parse(fs.readFileSync(path.join(dir, 'en.json'), 'utf8'));
const enKeys = Object.keys(en).filter(k => k !== '_cutscenes');

// 1) Extract the EN pre-scenes from the builtin _CSCENES_EN in index.html
const html = fs.readFileSync('index.html', 'utf8');
const enTbl = html.slice(html.indexOf('var _CSCENES_EN={'), html.indexOf('// Expose CSCENES'));
const pre = {};
for (let i = 0; i <= 9; i++) {
  const key = 'w' + i + '_pre';
  const start = enTbl.indexOf('\n  ' + key + ':[');
  if (start < 0) { console.log('!! missing ' + key); continue; }
  const seg = enTbl.slice(start);
  const end = seg.indexOf('\n  ],');
  const body = seg.slice(seg.indexOf('[') + 1, end);
  // crude parse of {sp:'..',k:'..',text:'..'} entries
  const lines = [];
  const re = /\{sp:'((?:[^'\\]|\\.)*)',k:'([a-z0-9]+)',text:'((?:[^'\\]|\\.)*)'\}/g;
  let m;
  while ((m = re.exec(body))) {
    lines.push({ sp: m[1].replace(/\\'/g, "'"), k: m[2], text: m[3].replace(/\\'/g, "'") });
  }
  pre[key] = lines;
}
fs.writeFileSync(path.join(dir, '_pre_en.json'), JSON.stringify(pre, null, 2));
console.log('Wrote _pre_en.json with ' + Object.keys(pre).length + ' scenes, lines: ' + Object.values(pre).map(a=>a.length).join('/'));

// 2) Per-language suspect UI keys (value identical to EN) + speaker-label map
const codes = fs.readdirSync(dir)
  .filter(f => f.endsWith('.json') && !f.startsWith('_') && f !== 'index.json')
  .map(f => f.replace('.json', ''))
  .filter(c => c !== 'en' && c !== 'ru');
const allowIdentical = new Set(['langName','netCodePlaceholder']);
const norm = s => s.replace(/\{\d+\}/g,'').replace(/<br>/g,'').replace(/&amp;/g,'&').trim();

for (const c of codes) {
  const o = JSON.parse(fs.readFileSync(path.join(dir, c + '.json'), 'utf8'));
  const suspects = {};
  for (const k of enKeys) {
    if (allowIdentical.has(k)) continue;
    const ev = en[k], ov = o[k];
    if (typeof ev === 'string' && typeof ov === 'string' && norm(ev) && norm(ev) === norm(ov)) {
      suspects[k] = ev;
    }
  }
  // speaker labels from this locale's existing cutscenes
  const speakers = {};
  if (o._cutscenes) {
    for (const sc of Object.values(o._cutscenes)) {
      if (Array.isArray(sc)) for (const ln of sc) { if (ln && ln.k && ln.sp) speakers[ln.k] = ln.sp; }
    }
  }
  fs.writeFileSync(path.join(dir, '_suspect_' + c + '.json'),
    JSON.stringify({ suspects, speakers }, null, 2));
}
console.log('Wrote _suspect_<code>.json for ' + codes.length + ' languages.');
