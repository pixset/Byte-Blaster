# 🎮 Byte Blaster — документация

Киберпанк 2D-платформер: 110 уровней, 11 миров, кооператив до 5 игроков,
50 языков. Десктоп (Electron), Android (Capacitor) и браузер из одной кодовой
базы.

**У игроков стоит 1.0.2. В работе — 1.0.3**, она ещё не выпущена: номер лежит в
`package.json` и `assets/version.js`, меняется только по явному указанию.

---

## 📚 С чего начать

| Если ты хочешь… | Читай |
|---|---|
| понять устройство проекта целиком | **[ARCHITECTURE.md](ARCHITECTURE.md)** ← начни отсюда |
| быстро запустить и что-то поправить | [QUICKSTART.md](QUICKSTART.md) |
| собрать сборку | [BUILD_GUIDE.md](BUILD_GUIDE.md) |
| узнать, что изменилось | [CHANGELOG.md](CHANGELOG.md) · [WHATS_NEW.md](WHATS_NEW.md) |

## 🏗 Техническая документация

| Документ | О чём |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | модули, порядок загрузки, состояния, как всё связано |
| [PLATFORMS.md](PLATFORMS.md) | Electron / Android / веб: различия, IPC, тиры рендеринга, тач |
| [NETWORK_PROTOCOL.md](NETWORK_PROTOCOL.md) | мультиплеер: сообщения, роли, синхронизация, два транспорта |
| [RENDERING.md](RENDERING.md) | канвас, качество, оптимизации, замеры, ловушки с цветом |
| [LOCALISATION.md](LOCALISATION.md) | 50 языков, `t()`, аудит, слияние партий, как добавить язык |
| [SAVE_DATA.md](SAVE_DATA.md) | ключи хранилища, слоты, файл сохранения, повреждения |
| [TESTING.md](TESTING.md) | проверки, сетевые тесты, диагностический харнесс |
| [WORLDMAP_README.md](WORLDMAP_README.md) | карта мира |
| [SETTINGS.md](SETTINGS.md) | все настройки игры |

## 🌐 Аккаунт и режимы поверх сети

| Документ | О чём |
|---|---|
| [ACCOUNTS.md](ACCOUNTS.md) | единый аккаунт студии, лицензии, вход по нику, облачные сохранения |
| [DAILY_LEVEL.md](DAILY_LEVEL.md) | уровень дня: пять слотов, общий сид, суточная таблица |
| [GHOST.md](GHOST.md) | призрак лучшего забега: запись, хранение, воспроизведение |
| [PAYMENTS.md](PAYMENTS.md) | продажа игры: ЮKassa, выдача лицензии, юридические страницы |

## 🎨 Контент и дизайн

| Документ | О чём |
|---|---|
| [STORY.md](STORY.md) | сюжет, лор, катсцены по мирам |
| [ACHIEVEMENTS.md](ACHIEVEMENTS.md) · [ACHIEVEMENTS_GUIDE.md](ACHIEVEMENTS_GUIDE.md) | достижения и как они отслеживаются |
| [MUSIC.md](MUSIC.md) · [SOUNDS.md](SOUNDS.md) | музыка и звуковые эффекты |

## 📋 Состояние проекта

| Документ | О чём |
|---|---|
| [PROJECT_STATUS.md](PROJECT_STATUS.md) | что готово, что в работе |
| [BUGS.md](BUGS.md) | аудит багов: исправленное и непокрытое |
| [TODO.md](TODO.md) | текущие задачи |
| [ROADMAP.md](ROADMAP.md) | предложения по развитию с оценкой «отдача / стоимость» |

## 🚀 Публикация

| Документ | О чём |
|---|---|
| [STEAM_SETUP.md](STEAM_SETUP.md) | подготовка к Steam |
| [SYSTEM_REQUIREMENTS.md](SYSTEM_REQUIREMENTS.md) | системные требования |
| [WHATS_NEW.md](WHATS_NEW.md) | готовые тексты для соцсетей и страницы магазина |

---

## ⚡ Быстрый старт

```bash
npm install
npm start
```

### Сборка

```bash
npm run build:steam   # .exe → dist/Byte Blaster (Steam)/
npm run build:html    # веб → dist/Byte Blaster (HTML)/
npm run build         # обе версии
```

Удобнее — `build/build.bat`: спрашивает платформу, редакцию (полная / демо /
обе) и версию, помнит прошлые ответы и умеет повторить всю прошлую сборку одним
нажатием. Android — `build/android-build.ps1`. Подробности:
[BUILD_GUIDE.md](BUILD_GUIDE.md).

### Проверки перед сборкой

```bash
node tools/loc-audit.js        # переводы — должны быть нули везде
node tools/loc-keys-used.js    # ключи, которых просит код, но нет в словаре
node tools/find-hardcoded.js   # английские литералы в коде — должен быть 0
```

Переводы вливаются пачкой: `node tools/loc-merge.js <файл.json>` раскладывает
`{ "de": {…}, "fr": {…} }` по языковым файлам, сохраняя порядок ключей из
`en.json`. Подробности — в [LOCALISATION.md](LOCALISATION.md).

---

## 🔧 Стек

| Слой | Технология |
|---|---|
| Рендер | HTML5 Canvas 2D |
| Интерфейс | DOM + CSS поверх канваса |
| Логика | JS без модулей и сборщика |
| Звук | Web Audio API: mp3-сэмплы + процедурный синтез |
| Десктоп | Electron 43 |
| Android | Capacitor |
| Мультиплеер | WebSocket relay на Node.js (Railway) + запасной канал через Supabase Realtime |
| Аккаунт, таблицы, уровень дня | Supabase (Postgres + RLS + RPC + Edge Functions) |
| Steam | Greenworks (код готов, нужен App ID) |

Почему без сборщика: один и тот же набор файлов должен работать в Electron через
`file://`, внутри Capacitor-WebView и с веб-сервера. Любой шаг сборки ломает
хотя бы один из этих маршрутов.

---

## 📁 Что где лежит

```
Game/
├─ index.html      точка входа и порядок загрузки скриптов
├─ main.js         главный процесс Electron
├─ assets/         модули игры, стили, локали, звук
├─ build/          скрипты сборки
├─ tools/          аудит переводов, поиск хардкода, генерация звука
├─ _nettest/       тесты сетевого протокола
├─ android/        проект Capacitor
├─ www/            веб-сборка
└─ docs/           эта документация
```

---

© 2022–2026 Pixset Studio. Все права защищены.
