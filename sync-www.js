// Обновляет www/ — папку, из которой Capacitor собирает Android-версию.
//
// Правки живут в корне проекта (index.html, assets/), а www/ — их копия.
// Раньше её обновляли руками, и в .apk легко уезжал вчерашний код: например,
// исправленная проверка лицензии оставалась только в исходнике.
// Запускать перед `npx cap sync`: npm run sync:www
const path = require('path');
const { buildWeb } = require('./build-html');

buildWeb(path.join(__dirname, 'www'));

console.log('📦 www/ обновлён — можно запускать npx cap sync');
