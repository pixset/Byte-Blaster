const fs = require('fs'), path = require('path');
const dir = 'localisation';
const en = JSON.parse(fs.readFileSync(path.join(dir, 'en.json'), 'utf8'));
const enKeys = Object.keys(en).filter(k => k !== '_cutscenes');
const codes = fs.readdirSync(dir)
  .filter(f => f.endsWith('.json') && !f.startsWith('_') && f !== 'index.json')
  .map(f => f.replace('.json', ''))
  .filter(c => c !== 'en');

// Build the set of cutscene keys from the builtin EN table inside index.html
const html = fs.readFileSync('index.html', 'utf8');
const enBlock = html.slice(html.indexOf('var _CSCENES_EN={'));
const csKeys = [...new Set((enBlock.match(/\n  ([a-z0-9_]+):\[/g) || []).map(s => s.trim().replace(':[','')))];

console.log('UI keys in en.json: ' + enKeys.length);
console.log('Cutscene keys in builtin EN: ' + csKeys.length + ' -> ' + csKeys.join(', '));
console.log('');
console.log('code | missingUI | hasCutscenes | missingCutscenes');
let totalMissUI = 0;
for (const c of codes) {
  const o = JSON.parse(fs.readFileSync(path.join(dir, c + '.json'), 'utf8'));
  const missUI = enKeys.filter(k => !(k in o));
  totalMissUI += missUI.length;
  const cs = o._cutscenes || null;
  const missCS = cs ? csKeys.filter(k => !(k in cs)) : csKeys;
  const flag = (missUI.length || (cs && missCS.length) || !cs) ? ' <<<' : '';
  console.log(
    c.padEnd(6) + '| ' +
    String(missUI.length).padStart(3) + '       | ' +
    (cs ? 'yes' : 'NO ') + '          | ' +
    (cs ? missCS.length : 'all ' + csKeys.length) + flag
  );
  if (missUI.length && missUI.length <= 12) console.log('        missingUI: ' + missUI.join(', '));
}
console.log('\nTotal missing UI keys across locales: ' + totalMissUI);
