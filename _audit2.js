const fs = require('fs'), path = require('path');
const dir = 'localisation';
const en = JSON.parse(fs.readFileSync(path.join(dir, 'en.json'), 'utf8'));
const enKeys = Object.keys(en).filter(k => k !== '_cutscenes');
const codes = fs.readdirSync(dir)
  .filter(f => f.endsWith('.json') && !f.startsWith('_') && f !== 'index.json')
  .map(f => f.replace('.json', ''))
  .filter(c => c !== 'en' && c !== 'ru');

// Keys whose value is legitimately identical across languages (codes, symbols, brand)
const allowIdentical = new Set(['langName','netCodePlaceholder']);

console.log('code  | identical/total UI | sample untranslated keys');
const report = {};
for (const c of codes) {
  const o = JSON.parse(fs.readFileSync(path.join(dir, c + '.json'), 'utf8'));
  let identical = [];
  for (const k of enKeys) {
    if (allowIdentical.has(k)) continue;
    const ev = en[k], ov = o[k];
    if (typeof ev === 'string' && typeof ov === 'string') {
      // strip placeholders/markup/emoji-ish to compare core text
      const norm = s => s.replace(/\{\d+\}/g,'').replace(/<br>/g,'').replace(/&amp;/g,'&').trim();
      if (norm(ev) && norm(ev) === norm(ov)) identical.push(k);
    }
  }
  report[c] = identical;
  const sample = identical.slice(0, 8).join(', ');
  console.log(c.padEnd(6) + '| ' + String(identical.length).padStart(3) + '/' + enKeys.length + '            | ' + sample);
}
// Aggregate: which keys are most commonly untranslated
const freq = {};
for (const c of codes) for (const k of report[c]) freq[k] = (freq[k]||0)+1;
const common = Object.entries(freq).filter(([k,n]) => n >= codes.length*0.5).sort((a,b)=>b[1]-a[1]);
console.log('\nKeys identical-to-EN in >=50% of locales (likely intentionally untranslated or systemic gaps):');
common.forEach(([k,n]) => console.log('  ' + k.padEnd(24) + n + '/' + codes.length + '  EN="' + String(en[k]).slice(0,40) + '"'));
