// Сверяет ключи, которые игра запрашивает, со словарём en.json.
//
// Пропущенный ключ не падает и никак не подсвечивается: t() возвращает само имя
// ключа, и игрок видит на экране «dailyNoServer» вместо текста. Такое замечают
// только глазами — или вот этим скриптом.
//
// Ключи в игре берутся тремя способами, все три и собираем:
//   t('key')          — из кода;
//   T('key', 'текст') — экран «Что нового», с русским запасным вариантом;
//   data-i18n="key"   — прямо в разметке index.html.
//
// Склейки вида t('cin_' + id) известны только во время работы: они считаются
// отдельно и выводятся как предупреждение, а не как ошибка.
//
// Запуск:  node tools/loc-keys-used.js
const fs = require('fs');
const path = require('path');

const GAME = path.join(__dirname, '..');
const en = JSON.parse(fs.readFileSync(path.join(GAME, 'assets/localisation/en.json'), 'utf8'));

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'localisation' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|html)$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = [...walk(path.join(GAME, 'assets')), path.join(GAME, 'index.html')]
  .filter((f) => fs.existsSync(f));

const used = new Map();
const dynamic = new Map();

/**
 * Выкидывает комментарии: в них живут примеры вроде «data-i18n-ph="key"», и
 * скрипт честно требовал ключ `key`, которого, конечно, нет в словаре.
 * Строковые литералы при этом целы — вырезаем только сами комментарии.
 */
function stripComments(src, isHtml) {
  if (isHtml) return src.replace(/<!--[\s\S]*?-->/g, ' ');
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    // Однострочный комментарий: до конца строки. «://» в адресах не трогаем.
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

for (const file of files) {
  const rel = path.relative(GAME, file).split(path.sep).join('/');
  const src = stripComments(fs.readFileSync(file, 'utf8'), /\.html$/.test(file));
  const add = (k) => { if (!used.has(k)) used.set(k, rel); };

  // Литерал — только если за закрывающей кавычкой НЕ идёт «+»: иначе это
  // начало склейки вроде T('bossHint' + wi), и целого ключа тут нет.
  for (const m of src.matchAll(/(?<![A-Za-z0-9_$.])[tT]\(\s*['"]([A-Za-z][\w]*)['"](?!\s*\+)/g)) add(m[1]);
  for (const m of src.matchAll(/data-i18n(?:-[a-z]+)?\s*=\s*["']([A-Za-z][\w]*)["']/g)) add(m[1]);

  for (const m of src.matchAll(/(?<![A-Za-z0-9_$.])[tT]\(\s*['"]([^'"]*)['"]\s*\+/g)) {
    const k = m[1] + '…';
    if (!dynamic.has(k)) dynamic.set(k, rel);
  }
}

const missing = [...used].filter(([k]) => !(k in en));

console.log(`ключей запрошено: ${used.size}`);
console.log(`нет в en.json: ${missing.length}`);
if (missing.length) {
  console.log('\n⚠  Игрок увидит сырое имя ключа:');
  for (const [k, where] of missing) console.log(`   ${k}  (${where})`);
}

if (dynamic.size) {
  console.log(`\nсклеенные ключи (проверьте вручную): ${dynamic.size}`);
  for (const [k, where] of dynamic) console.log(`   ${k}  (${where})`);
}
