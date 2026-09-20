# 🧪 Тестирование и диагностика

В проекте нет юнит-тестового фреймворка и он ему не нужен: почти всё, что может
сломаться, ломается **в браузерном окружении** — при загрузке скриптов, в цикле
отрисовки, в масштабировании под экран, в сетевой синхронизации. Поэтому
проверки здесь двух видов: статические анализаторы над исходниками и сценарии,
которые реально запускают игру в Electron и опрашивают её состояние.

---

## 1. Статические проверки (быстрые, запускать всегда)

```bash
node tools/loc-audit.js        # переводы: пропуски, мусор, {0}, теги, английские остатки
node tools/loc-keys-used.js    # ключи, которых просит код, но нет в словаре
node tools/find-hardcoded.js   # английские литералы в коде вместо t()
node --check assets/game.js    # синтаксис после правки большого файла
```

Целевое состояние: **все колонки в нулях** у всех 50 языков, `find-hardcoded`
показывает 0. Подробности — [LOCALISATION.md](LOCALISATION.md).

---

## 2. Сетевые тесты — `_nettest/`

Настоящие тесты протокола. Поднимают встроенный relay (`local-server.js`) на
свободном порту и гоняют по нему реальные WebSocket-клиенты через библиотеку
`ws` — она шлёт маскированные клиентские фреймы, ровно как браузер, поэтому
заодно проверяется собственная реализация RFC6455 (рукопожатие, маскирование,
16-битные длины).

```bash
cd _nettest
npm install
node relay.test.js      # протокол комнат/лобби, смена хоста, фрейминг
node test_flow.js       # полный цикл: создать → войти → готов → старт
node test_leave.js      # выход участника и передача хоста
node test_mode.js       # выбор режима и уровня
node test_boss_net.js   # синхронизация босса
node test_boss_logic.js # логика фаз босса
```

---

## 3. Тесты платформенных особенностей

В корне `Game/`:

- **`test-worldmap-electron.js`** — проверяет, что `window.WorldMap` доступен в
  рендерере Electron. Тест написан так, что **обязан падать на несломанном
  коде**: он фиксирует условие бага с `contextIsolation`, из-за которого карта
  мира не загружалась.
- **`test-preservation.js`** — обратная сторона того же: поведение на **не**
  затронутых платформах (веб, Android, меню Electron) должно остаться прежним.

- **`test-license-session.js`** — сохранение входа в аккаунт. Модуль
  `assets/license.js` грузится в песочницу с поддельным `fetch`, который
  изображает Supabase: досчёт срока сессии, гонку параллельных обновлений
  одноразовым refresh-токеном, ответы 500/502/503/429, отсутствие сети и
  прямой отказ сервера. Зависимостей нет:

  ```bash
  node test-license-session.js
  ```

  Правило, которое он охраняет: сессию удаляем ТОЛЬКО когда сервер прямо
  отверг токен. Всё остальное — временная беда, вход должен пережить её.

- **`test-cloudsave.js`** — граница «прогресс общий, настройки устройства
  местные» в облачном сохранении. Зависимостей нет, среда браузера
  подставляется заглушкой:

  ```bash
  node test-cloudsave.js
  ```

  Проверяет обе стороны: что уезжает в аккаунт (`collect`) и что переживает
  загрузку чужого сохранения (`apply`) — см. [SAVE_DATA.md](SAVE_DATA.md) §5a.

- **`tools/verify-audio-electron.js`** — проверяет, что mp3-сэмплы реально
  читаются под `file://` через IPC.

---

## 3a. Приёмы проверки в браузере

Три вещи, которые сильно экономят время при отладке из консоли.

### Прогон уровней вручную

`window.update`, `window.draw`, `window.startAdv`, `window.startInf`,
`window.startDailyLevel` торчат в `window`. Когда `requestAnimationFrame`
заморожен (скрытая вкладка, панель превью не на экране), кадры крутятся руками:

```js
window.startAdv(35);
document.getElementById('csSkipBtn')?.click();   // пропустить заставку
for (let i = 0; i < 45; i++) { window.update(); window.draw(); }
```

Так за несколько секунд проходятся все 110 уровней, 11 боссов и пять слотов
уровня дня — ловятся ошибки отрисовки, которые иначе видны только глазами.
Ошибки собираются через `window.addEventListener('error')` и подмену
`console.error`.

### Фиктивные часы для сцен и заставок

Проверить, что сцена длится одинаково на 30 и 165 Гц, «по-настоящему» нельзя:
кадры даёт браузер, а в скрытой вкладке их нет вовсе. Подменяются сразу и часы,
и планировщик кадров, после чего кадры крутятся самостоятельно:

```js
performance.now = () => clock;
window.requestAnimationFrame = (cb) => { pending = cb; return 1; };
while (pending && !done) { const cb = pending; pending = null; clock += dt; cb(clock); }
```

Измеряется **модельное** время сцены. Финал должен давать 11 секунд и при
`dt = 1000/30`, и при `1000/165`; пролог — 17.4 секунды.

### Баланс `save()` / `restore()`

Незакрытый `ctx.save()` утаскивает состояние холста в следующий кадр. Проверяется
подменой методов прототипа:

```js
const proto = CanvasRenderingContext2D.prototype;
let saves = 0, restores = 0;
// …обернуть proto.save / proto.restore счётчиками, прогнать кадр, сравнить
```

Особенно важно для мобильного пути: зум оборачивает всю отрисовку мира в
`save()`/`restore()`, а на десктопе этот блок не выполняется вовсе.

---

## 4. Диагностический харнесс (Electron + скрипт-шаг)

Самый полезный инструмент при отладке всего остального: он запускает игру в
настоящем Electron, выполняет произвольный JS **внутри страницы**, собирает
консоль, ошибки и скриншоты.

Файл-харнесс собирается разово и живёт во временной папке, а не в репозитории.
Схема такая:

```js
// probe.js — запускать: npx electron probe.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path'), fs = require('fs');

const GAME = 'C:\\...\\Byte Blaster\\Game';
const OUT  = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

const STEPS = JSON.parse(process.env.BB_STEPS || '[]');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 720, show: false,
    webPreferences: { preload: path.join(GAME, 'preload.js'), contextIsolation: true } });

  win.webContents.on('console-message', (e, lvl, msg, line, src) =>
    console.log('[console]', msg, ' (' + path.basename(src) + ':' + line + ')'));

  await win.loadFile(path.join(GAME, 'index.html'));
  await new Promise(r => setTimeout(r, 2500));      // дать игре догрузиться

  for (const [i, step] of STEPS.entries()) {
    const res = await win.webContents.executeJavaScript(step.js, true);
    fs.writeFileSync(path.join(OUT, `step-${i}-${step.name}.json`),
                     JSON.stringify(res, null, 2), 'utf8');
    const shot = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, `${i}-${step.name}.png`), shot.toPNG());
  }
  app.quit();
});
```

Шаг — это IIFE, возвращающая объект с результатами и списком найденных проблем:

```js
(async () => {
  const out = [], issues = [];
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  window.setLanguage('de'); await sleep(200);
  out.push('adventure = ' + t('adventure'));

  for (const el of document.querySelectorAll('[data-i18n]')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;                    // невидимое не считаем
    if (el.textContent.trim() === el.getAttribute('data-i18n'))
      issues.push('ключ не переведён: ' + el.getAttribute('data-i18n'));
  }
  return { out, issues };
})()
```

Такими шагами проверялись: прохождение уровня, гибель, таймаут, пауза, бой с
боссом, все 49 локалей, адаптивность под размеры экранов, демо-ограничения,
сохранение забега, кооператив в двух окнах.

---

## 5. Как тестировать мультиплеер вручную

Два окна Electron с **разными `partition:`** в `webPreferences.session` —
иначе оба клиента делят один `localStorage`, а значит один позывной и один сейв,
и половина сценариев вырождается.

```js
const a = new BrowserWindow({ webPreferences: { partition: 'persist:p1', ... } });
const b = new BrowserWindow({ webPreferences: { partition: 'persist:p2', ... } });
```

Сценарии, которые стоит прогонять: счастливый путь (создать → войти → готов →
старт → пройти уровень), выход участника посреди уровня, гибель участника,
смена хоста, обрыв связи и переподключение.

---

## 6. Ловушки, на которые уже наступали

Эти ошибки давали **ложные результаты** — тест «падал» или «проходил» не по той
причине. Проверь их, прежде чем чинить продукт по итогам теста.

- **Загрязнение состояния между сценариями.** Сценарий, включивший `godMode`,
  оставляет его следующему. Сбрасывай состояние явно.
- **`updateHUD()` живёт в `loop()`, а не в `draw()`** — тест, дёргающий только
  `draw()`, никогда не увидит обновления HUD.
- **Оставшийся с прошлого шага враг** может пересечься с игроком раньше, чем
  сработает проверка пули, — и урон засчитается «не тому».
- **Проверка `display` недостаточна для оверлея.** Профиль открывался под
  картой мира: `display` был правильным, а видно его не было. Проверять надо
  `document.elementFromPoint()` — что элемент действительно верхний.
- **Содержимое внутри прокручиваемого предка** и внутри контейнеров с
  `pointer-events: none` не является «вылезшим за экран» — иначе аудит
  адаптивности выдаёт десятки ложных находок.
- **Профилирование в синхронном цикле** даёт пики до 700 мс — это артефакт
  сборки мусора от отсутствия yield, а не игра. Мерить только под настоящим rAF.

---

## 7. Чек-лист перед сборкой

```bash
node tools/loc-audit.js          # нули везде
node tools/find-hardcoded.js     # 0
cd _nettest && node relay.test.js  # сетевой протокол
npm start                        # игра запускается, меню на экране
```

Плюс ручная проверка того, что затронуто изменением, по таблице из
[PLATFORMS.md](PLATFORMS.md).
