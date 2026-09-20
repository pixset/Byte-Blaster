// Дописывает переводы в языковые файлы пачкой.
//
// Переводить 50 файлов по одному редактором — верный способ где-нибудь сбить
// запятую и уронить разбор JSON у всей игры. Скрипт принимает один файл вида
//
//   { "de": { "ключ": "перевод", … }, "fr": { … } }
//
// и вписывает ключи в каждый язык. Порядок ключей берётся из en.json: так все
// файлы остаются в одном порядке и их можно сравнивать построчно.
//
// Уже существующий перевод по умолчанию НЕ трогается — чтобы случайный повтор
// не затёр вычитанную строку. Перезапись только с --overwrite.
//
// Запуск:  node tools/loc-merge.js <файл.json> [--overwrite] [--dry]
const fs = require('fs');
const path = require('path');

const LOC = path.join(__dirname, '..', 'assets', 'localisation');
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const OVERWRITE = args.includes('--overwrite');
const DRY = args.includes('--dry');

if (!file) {
  console.error('Укажите файл с переводами: node tools/loc-merge.js batch.json');
  process.exit(1);
}

const batch = JSON.parse(fs.readFileSync(file, 'utf8'));
const enPath = path.join(LOC, 'en.json');
const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));

// Порядок ключей: сначала как в en.json, затем всё, чего в нём ещё нет —
// в порядке появления в первом языке партии (так добавляется сам английский).
function orderedKeys(obj) {
  const order = Object.keys(en);
  const known = order.filter((k) => k in obj);
  const extra = Object.keys(obj).filter((k) => !(k in en));
  return [...known, ...extra];
}

let touched = 0;
const report = [];

for (const [lang, entries] of Object.entries(batch)) {
  const p = path.join(LOC, `${lang}.json`);
  if (!fs.existsSync(p)) { report.push(`${lang}: ФАЙЛА НЕТ — пропущен`); continue; }

  const cur = JSON.parse(fs.readFileSync(p, 'utf8'));
  let added = 0, replaced = 0, skipped = 0;

  for (const [k, v] of Object.entries(entries)) {
    if (k in cur) {
      if (!OVERWRITE || cur[k] === v) { skipped++; continue; }
      replaced++;
    } else {
      added++;
    }
    cur[k] = v;
  }

  const next = {};
  for (const k of orderedKeys(cur)) next[k] = cur[k];

  if (!DRY) fs.writeFileSync(p, JSON.stringify(next, null, 2) + '\n', 'utf8');
  touched++;
  report.push(`${lang}: +${added}${replaced ? `, заменено ${replaced}` : ''}${skipped ? `, пропущено ${skipped}` : ''}`);
}

console.log(report.join('\n'));
console.log(`\nязыков обработано: ${touched}${DRY ? ' (без записи, --dry)' : ''}`);

// Ключ, которого нет в en.json, в игре покажется как есть — сырым именем.
// Поэтому о таких говорим сразу.
const langs = Object.keys(batch);
if (!langs.includes('en')) {
  const unknown = new Set();
  for (const entries of Object.values(batch)) {
    for (const k of Object.keys(entries)) if (!(k in en)) unknown.add(k);
  }
  if (unknown.size) {
    console.log(`\n⚠  Нет в en.json (${unknown.size}): ${[...unknown].join(' ')}`);
    console.log('   Добавьте их в en.json, иначе аудит будет считать их лишними.');
  }
}
