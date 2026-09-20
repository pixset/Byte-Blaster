/* ===========================================================================
   Тест облачного сохранения: что уезжает в аккаунт, а что остаётся устройству.

   Зачем отдельный тест. Прогресс общий для всех устройств, а настройки — нет:
   разрешение окна, тир графики, раскладка клавиш и экранные кнопки описывают
   железо, а не игрока. Пока bbSettings уезжал в облако целиком, загрузка
   сохранения с ПК ломала телефон (пропадал геймпад, прыгало качество) и
   наоборот. Здесь проверяется именно эта граница.

   Запуск:  node test-cloudsave.js       (из папки Game, зависимостей нет)
   =========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── Минимальная среда браузера: только то, чем пользуется модуль ───────────
const store = new Map();
const localStorage = {
  get length() { return store.size; },
  key: (i) => Array.from(store.keys())[i],
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

const sandbox = {
  localStorage, console, setTimeout, clearTimeout,
  Date, JSON, Math, Error, Set, Object, String, Number,
  parseInt, parseFloat, isNaN,
  fetch: () => Promise.reject(new Error('сеть в этом тесте не нужна')),
};
sandbox.window = sandbox;
sandbox.window.addEventListener = () => {};

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'assets', 'cloudsave.js'), 'utf8'), sandbox);
const CloudSave = sandbox.window.CloudSave;

let failed = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log((ok ? '✔ ' : '✘ ') + name +
    (ok ? '' : '\n    получено:  ' + JSON.stringify(got) +
               '\n    ожидалось: ' + JSON.stringify(want)));
}

// Настройки телефона и ПК — намеренно противоположные по всем «железным» полям.
const PHONE = {
  resolution: '1280x720', gameScale: 0, textScale: 2, graphicsQuality: 'low',
  gfx: { glow: 0.4 }, touchControls: 'on', touchScale: 1.4,
  controls: { p1Left: 'KeyA' },
  language: 'ru', masterVolume: 60, cutscenes: true,
};
const PC = {
  resolution: '2560x1440', gameScale: 2, textScale: 1, graphicsQuality: 'ultra',
  gfx: { glow: 1.8 }, touchControls: 'off', touchScale: 1,
  controls: { p1Left: 'ArrowLeft' },
  language: 'en', masterVolume: 100, cutscenes: false, showHints: false,
};

// ── 1. Телефон загружает сохранение, сделанное на ПК ───────────────────────
store.clear();
store.set('bbSettings', JSON.stringify(PHONE));
store.set('bbAdv3', '{"max":5}');
store.set('bbPlaytime', '100');

CloudSave.apply({ bbSettings: JSON.stringify(PC), bbAdv3: '{"max":42}' });
const after = JSON.parse(store.get('bbSettings'));

check('прогресс приехал из облака', store.get('bbAdv3'), '{"max":42}');
check('ключа нет в облаке — стёрт локально', store.get('bbPlaytime'), undefined);
check('разрешение осталось своим', after.resolution, '1280x720');
check('размер текста остался своим', after.textScale, 2);
check('качество графики осталось своим', after.graphicsQuality, 'low');
check('параметры графики остались своими', after.gfx, { glow: 0.4 });
check('экранные кнопки остались своими', after.touchControls, 'on');
check('размер экранных кнопок остался своим', after.touchScale, 1.4);
check('раскладка клавиш осталась своей', after.controls, { p1Left: 'KeyA' });
check('язык приехал из облака', after.language, 'en');
check('громкость приехала из облака', after.masterVolume, 100);
check('катсцены приехали из облака', after.cutscenes, false);
check('новое предпочтение приехало из облака', after.showHints, false);

// ── 2. Что этот телефон отправит в облако ──────────────────────────────────
const up = JSON.parse(CloudSave.collect().bbSettings);
check('разрешение не уходит в облако', 'resolution' in up, false);
check('графика не уходит в облако', 'gfx' in up, false);
check('управление не уходит в облако', 'controls' in up, false);
check('размер текста не уходит в облако', 'textScale' in up, false);
check('язык уходит в облако', up.language, 'en');

// ── 3. Устройство, где настроек ещё нет ────────────────────────────────────
store.delete('bbSettings');
CloudSave.apply({ bbSettings: JSON.stringify(PC) });
const fresh = JSON.parse(store.get('bbSettings'));
check('чужое железо не навязывается новому устройству', 'resolution' in fresh, false);
check('предпочтения приезжают и на новое устройство', fresh.language, 'en');

// ── 4. Битые и отсутствующие настройки в облаке ────────────────────────────
store.set('bbSettings', JSON.stringify(PHONE));
CloudSave.apply({ bbSettings: 'не json' });
check('битые настройки из облака игнорируются',
  JSON.parse(store.get('bbSettings')).resolution, '1280x720');

CloudSave.apply({ bbAdv3: '{"max":7}' });
check('отсутствие настроек в облаке не стирает местные',
  JSON.parse(store.get('bbSettings')).resolution, '1280x720');

console.log(failed
  ? '\n❌ провалов: ' + failed
  : '\n✅ все проверки прошли');
process.exit(failed ? 1 : 0);
