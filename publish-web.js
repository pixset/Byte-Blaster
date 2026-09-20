// Кладёт собранную веб-версию на сайт: www/ → ../Site/game/.
//
// Раньше это делалось вручную, и копия на сайте отставала от игры: в браузере
// люди играли в прошлую версию — со старым адресом релея и без свежих режимов.
// Теперь порядок один: `npm run sync:www` собирает www, `npm run publish:web`
// переносит его на сайт.
//
// Копируем по одному файлу, а не fs.cpSync: на этой машине рекурсивное
// копирование средствами Node молча убивает процесс (см. заметку в памяти
// проекта). Один файл за раз медленнее на доли секунды и работает всегда.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, 'www');
const dst = path.join(__dirname, '..', 'Site', 'game');

if (!fs.existsSync(src)) {
  console.error('Нет папки www — сначала запустите npm run sync:www');
  process.exit(1);
}

let copied = 0, skipped = 0, dirs = 0;

function copyDir(from, to) {
  if (!fs.existsSync(to)) { fs.mkdirSync(to, { recursive: true }); dirs++; }
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, entry.name);
    const b = path.join(to, entry.name);
    if (entry.isDirectory()) { copyDir(a, b); continue; }
    // Не трогаем то, что не изменилось: так видно, что на самом деле поехало.
    try {
      const sa = fs.statSync(a);
      if (fs.existsSync(b)) {
        const sb = fs.statSync(b);
        if (sa.size === sb.size && sa.mtimeMs <= sb.mtimeMs) { skipped++; continue; }
      }
    } catch (err) { /* не смогли сравнить — просто копируем */ }
    fs.copyFileSync(a, b);
    copied++;
  }
}

copyDir(src, dst);

// Файлы, которые могли остаться от прошлых сборок и которых больше нет в www,
// не удаляем: в Site/game лежит и то, что сайт добавляет от себя.
console.log('Веб-версия опубликована на сайт: скопировано ' + copied
  + ', без изменений ' + skipped + ', создано папок ' + dirs);
console.log('Куда: ' + dst);
