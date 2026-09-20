# Byte Blaster - Build Guide

## Быстрый старт

Просто запусти `build/build.bat` (Windows) или `build/build.sh` (Linux/Mac) и выбери что собрать:
1. Windows .exe (Steam / portable)
2. Web (HTML)
3. Android (.apk)
4. Все три

Дальше `build.bat` спросит **тип сборки** (dev / demo / pre-alpha / alpha /
beta / release), потом версию игры и, если в сборке есть Android, вариант .apk.
После этого вопросов больше нет.

## Тип сборки и лицензия

Отдельной «демо-сборки» больше нет. Сборка всегда одна, а объём игры решает
**лицензия на аккаунте Pixset Studio**:

- лицензии нет → доступен первый мир (`BB_FREE_LEVELS`, по умолчанию 10);
- лицензия есть → все 110 уровней, онлайн, хардкор, игра вдвоём.

Проверка идёт по подписанному токену, сохранённому на устройстве, поэтому
**интернет для запуска не нужен** — только для продления раз в 30 дней
(плюс 7 дней запаса). Подробности — в `assets/license.js`.

Тип сборки — это канал поставки, а не объём контента. Хранится в
`assets/edition.js`, генерируется так же, как `assets/version.js`:

```bash
node build/set-edition.js dev
node build/set-edition.js beta
node build/set-edition.js release
node build/set-edition.js demo "https://pixset-studio.github.io/store" 10
```

Аргументы: тип (`dev` | `demo` | `pre-alpha` | `alpha` | `beta` | `release`),
ссылка на магазин, число бесплатных уровней. Пропущенные аргументы сохраняют
текущие значения.

`build.bat` в конце возвращает дерево на `dev`, чтобы `npm start` после сборки
релиза не запускал билд, помеченный как release.

Тип виден игроку рядом с версией в углу меню (`v1.0.2 · BETA`); у релиза
пометки нет. Если лицензии нет, туда же добавляется `· ДЕМО`.

### Что закрыто без лицензии

| Что | Без лицензии |
|-----|--------------|
| Приключение | только первые `BB_FREE_LEVELS` уровней (по умолчанию 10 — Кибергород) |
| Карта мира | один мир, стрелки дальше не листают, счётчики показывают `/10` |
| Бесконечный режим | заблокирован |
| Хардкор | заблокирован |
| 2 игрока (локально) | заблокирован |
| Онлайн | заблокирован |
| Секретный 11-й мир | недостижим |

После последнего бесплатного уровня вместо загрузки следующего показывается
экран с итоговым счётом, перечнем того, что даёт покупка, кнопкой в магазин
(`BB_STORE_URL`) и кнопкой «у меня есть аккаунт» — для тех, кто уже купил и
просто не вошёл на этом устройстве.

Вся логика ограничений лежит в `assets/demo.js`; остальной код только задаёт ему
вопросы (`Demo.beyond(n)`, `Demo.lockCard(...)`). При наличии лицензии
`Demo.on === false` и все эти вызовы — пустышки.

### Куда собирается

Каждый тип пишет в свою папку, поэтому сборки разных каналов не затирают друг
друга:

```
release → dist/Byte Blaster (Steam|HTML|Android)/
beta    → dist/Byte Blaster Beta (Steam|HTML|Android)/
dev     → dist/Byte Blaster Dev (Steam|HTML|Android)/
```

У всех типов кроме release свой `applicationId` (`…byteblaster.beta` и т.п.) и
имя ярлыка, так что тестовая сборка ставится на телефон рядом с релизной, не
заменяя её.

## Build Commands

### Build Both Versions (Steam + HTML)
```bash
npm run build
```
Создаст обе версии в папке `dist`:
- `dist/Byte Blaster (Steam)/Byte Blaster-win32-x64/` - Electron executable (.exe)
- `dist/Byte Blaster (HTML)/` - Web version (HTML files)

### Build Steam Version Only
```bash
npm run build:steam
```
Создаёт только Steam/Electron версию в `dist/Byte Blaster (Steam)/Byte Blaster-win32-x64/`

### Build HTML Version Only
```bash
npm run build:html
```
Создаёт только веб-версию в `dist/Byte Blaster (HTML)/`

## Output Structure

После запуска `npm run build` или `build/build.bat` (выбор 3), получишь:

```
dist/
├── Byte Blaster (Steam)/
│   └── Byte Blaster-win32-x64/
│       └── Byte Blaster.exe (portable executable)
└── Byte Blaster (HTML)/
    ├── index.html
    ├── preload.js
    ├── assets/
    ├── icons/
    └── README.md
```

## HTML Version Usage

HTML версию можно:
1. Открыть напрямую в браузере (двойной клик на `index.html`)
2. Запустить через локальный веб-сервер:
   - `python -m http.server 8000`
   - `npx http-server`
   - `php -S localhost:8000`

## Версия

```bash
node build/set-version.js 1.0.3
```
Проставляет версию сразу в `package.json` (версия файла .exe) и
`assets/version.js` (тег «vX.Y.Z» в углу главного меню). `android-build.ps1`
читает версию из `package.json` для `versionName`/`versionCode` в .apk.

## Что попадает в .exe

Steam-сборка описана в `build-steam.js` — там же список исключений. В архив
идут только `index.html`, `main.js`, `preload.js`, `local-server.js`,
`assets/`, `icons/` и `package.json`; итоговый `app.asar` весит ~7 МБ.

Исключены `node_modules`, `dist`, `docs`, `build`, `android`, `www`, `tools`,
`_archive`, `_nettest`, дублирующие папки `localisation/` и `Audio/` в корне,
а также корневые `.md`/`.txt`/скриншоты и dev-скрипты. В Electron-процессе ни
один node-модуль не нужен: `main.js`, `preload.js` и `local-server.js`
используют только Electron и встроенные модули Node.

> До версии 1.0.3 список исключений отсутствовал, и `app.asar` весил 499 МБ —
> в него утягивались `node_modules`, `android/`, `build/` и предыдущие сборки.
> Если увидишь такой размер снова — значит правки в `build-steam.js` потерялись.

## Флаги запуска .exe

| Флаг | Зачем |
|------|-------|
| `--safe-mode` | сразу софтверный рендеринг (для сбойных видеодрайверов) |
| `--reset-render-mode` | сбросить сохранённый тир рендеринга обратно на аппаратный |
| `--mem-log` | писать потребление памяти по процессам в лог каждые 2 сек |

Игра сама понижает тир рендеринга, если предыдущий запуск не отрисовал первый
кадр (см. `render-mode.json` в userData и раздел CR-1 в `BUGS.md`).

## Notes

- Steam версия включает все возможности Electron (управление окном, файловая система и т.д.)
- HTML версия работает в браузере с ограниченными возможностями по сравнению со Steam версией
- Обе версии используют один и тот же игровой код и ассеты
- Steam версия собирается через `electron-packager` (быстро, без проблем с правами)

