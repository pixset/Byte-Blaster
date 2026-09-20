const { app, BrowserWindow, ipcMain, shell, Menu, Notification, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Без этого Windows молча выбрасывает тосты приложения: система связывает
// уведомление с ярлыком по AppUserModelID.
//
// Значение обязано совпадать с тем, что прописал установщик, иначе Windows не
// находит ярлык — и не только молчат уведомления: окно теряет иконку в панели
// задач, потому что система не может сопоставить его с установленной
// программой. Каналы кроме релиза ставятся со своим суффиксом (см. правило в
// build-steam.js), поэтому вычисляем то же самое, а не зашиваем строку.
//
// Запуск из исходников (`npm start`) идёт под ЧУЖИМ идентификатором — с
// суффиксом .dev, — даже если в edition.js сейчас стоит release. Иначе
// получается ровно то, ради чего идентификатор и заводили, только наоборот:
// Windows запоминает связку «этот AppUserModelID = electron.exe», а потом
// показывает установленной игре иконку Electron в панели задач. Связка живёт в
// системном кэше и переживает переустановку игры — вычистить её можно только
// вручную (см. _tools/fix-taskbar-icon.cmd).
function appUserModelId() {
  let base = 'com.pixsetstudio.byteblaster';
  try { base = (require('./package.json').build || {}).appId || base; } catch (e) {}
  let type = 'release';
  try {
    const src = fs.readFileSync(path.join(__dirname, 'assets', 'edition.js'), 'utf8');
    const m = src.match(/BB_BUILD_TYPE\s*=\s*['"]([^'"]+)['"]/);
    if (m) type = m[1];
  } catch (e) { /* нет файла — считаем релизом */ }
  if (!app.isPackaged) type = 'dev';         // запуск из папки проекта
  return type === 'release' ? base : base + '.' + type.replace(/-/g, '');
}
if (process.platform === 'win32') app.setAppUserModelId(appUserModelId());

// ── File-based startup log ───────────────────────────────────────────────────
// The player reported a black screen with "no log at all" even after adding
// console logging + a renderer error overlay — meaning whatever's failing
// happens too early/too low-level for either of those to ever run (or the
// player has no easy way to see console output from a double-clicked .exe:
// Electron only prints the MAIN process's console.* to a terminal if the app
// was actually launched FROM one; double-clicking the .exe opens no terminal
// at all, so every console.log below was invisible to them by default).
// This writes a plain text log file next to the executable (or, if that
// folder isn't writable — e.g. under Program Files — falls back to the
// per-user app-data folder) on EVERY run, overwritten each launch, so it can
// just be opened in Notepad after a crash — no terminal, no DevTools needed.
let _logPath = null;
let _logPath2 = null; // set by _initFileLog, used by the sync writer below
function _initFileLog() {
  const candidates = [
    path.join(path.dirname(process.execPath), 'byte-blaster-log.txt'),
    path.join(app.getPath('userData'), 'byte-blaster-log.txt'),
    path.join(os.tmpdir(), 'byte-blaster-log.txt'),
  ];
  for (const p of candidates) {
    try {
      fs.writeFileSync(p, ''); // overwrite from the previous run; also proves the folder is writable
      _logPath = p;
      _logPath2 = p;
      break;
    } catch (e) { /* try the next candidate */ }
  }
}
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(a => (a instanceof Error ? (a.stack || a.message) : (typeof a === 'object' ? JSON.stringify(a) : String(a)))).join(' ')}`;
  console.log(line);
  // Synchronous, unbuffered write — this file is our only lead on a native
  // renderer crash that happens too fast for anything else to react to, so a
  // line MUST be on disk the instant this call returns, not whenever a stream
  // buffer next happens to flush.
  if (_logPath2) { try { fs.appendFileSync(_logPath2, line + '\n'); } catch (e) {} }
}
_initFileLog();
log('=== Byte Blaster starting ===');
log('electron:', process.versions.electron, 'chrome:', process.versions.chrome, 'node:', process.versions.node);
log('platform:', process.platform, process.arch, 'os release:', os.release());
log('exePath:', process.execPath);
log('log file:', _logPath || '(none — could not open any writable location)');

// Catch crashes in the MAIN process itself — without this, a startup error
// here (before any window/renderer exists) prints to a console nobody's
// watching and the app just silently vanishes, which looks identical to a
// black screen that never even appeared.
process.on('uncaughtException', (err) => { log('[FATAL main] uncaughtException:', err); });
process.on('unhandledRejection', (reason) => { log('[FATAL main] unhandledRejection:', reason); });

const { startLocalRelay } = require('./local-server');

// ── Rendering mode / GPU fallback ───────────────────────────────────────────
// THIS is what caused the "black screen .exe": the previous attempt at working
// around a broken video driver passed `--use-gl=swiftshader`. That value was
// removed from Chromium years ago (SwiftShader is now selected through ANGLE,
// i.e. `--use-angle=swiftshader`), so on the Chromium build Electron 43 ships
// it hits an unreachable branch in gl_factory_win.cc:
//     ERROR:ui\gl\init\gl_factory_win.cc  NOTREACHED hit.
//     ContextResult::kFatalFailure: Failed to create shared context …
//     GpuChannel: Failed to create SharedImageStub
// GL initialisation then fails outright, the compositor never produces a
// frame, and the window stays black forever while the process happily keeps
// running (which is exactly what players reported: no crash, no error, just
// black). `--in-process-gpu` and disabling DirectComposition made it worse —
// both are non-default paths that get far less testing on Windows.
//
// The fix is to stop fighting Chromium and let it pick its own backend, then
// degrade *gradually* and only if a launch actually fails:
//
//   tier 0 (default)  hardware acceleration, Chromium's own driver blocklist
//   tier 1            software GL through ANGLE  (--use-angle=swiftshader)
//   tier 2            no hardware acceleration at all
//
// Which tier is used is decided by `render-mode.json` in userData: every
// launch provisionally records "this run has not painted yet", and the
// renderer clears it via the `boot:ok` IPC as soon as the menu is on screen.
// A run that never paints therefore leaves the marker behind and the NEXT
// launch automatically drops a tier. Healthy machines always stay on tier 0.
const RENDER_STATE_FILE = 'render-mode.json';
function _renderStatePath() { return path.join(app.getPath('userData'), RENDER_STATE_FILE); }
function _readRenderState() {
  try {
    // Strip a UTF-8 BOM: these files are meant to be hand-editable, and most
    // Windows editors (Notepad, PowerShell's Set-Content) add one, which makes
    // JSON.parse throw and would silently reset the render tier.
    const raw = fs.readFileSync(_renderStatePath(), 'utf8').replace(/^﻿/, '');
    const obj = JSON.parse(raw);
    if (obj && typeof obj.failedLaunches === 'number') return obj;
  } catch (e) { /* first run, or unreadable — treat as healthy */ }
  return { failedLaunches: 0 };
}
function _writeRenderState(obj) {
  try { fs.writeFileSync(_renderStatePath(), JSON.stringify(obj, null, 2), 'utf8'); } catch (e) {}
}

// `--safe-mode` lets a player force the software path from a shortcut without
// having to reproduce a failure first; `--reset-render-mode` clears the marker.
const _cliSafeMode = process.argv.includes('--safe-mode');
if (process.argv.includes('--reset-render-mode')) _writeRenderState({ failedLaunches: 0 });

let renderTier = _cliSafeMode ? 1 : Math.min(_readRenderState().failedLaunches, 2);
if (renderTier === 1) {
  // Software OpenGL via ANGLE's SwiftShader backend — the supported way to
  // bypass a broken driver while keeping the normal compositor pipeline.
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  app.commandLine.appendSwitch('disable-gpu-compositing');
} else if (renderTier >= 2) {
  // Last resort: no GPU process involvement in compositing at all.
  app.disableHardwareAcceleration();
}
// Windows-only occlusion tracking that has a long history of blanking or
// freezing Electron windows that are partially covered. Safe on every tier and
// recommended for Electron apps generally.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
log('[render] tier', renderTier, renderTier === 0 ? '(hardware)' : renderTier === 1 ? '(software GL / ANGLE SwiftShader)' : '(hardware acceleration disabled)');
// Provisionally mark this launch as "not yet painted". Cleared by boot:ok.
_writeRenderState({ failedLaunches: renderTier + 1, lastTier: renderTier });

// The renderer calls this once the menu is actually on screen. Reaching it
// proves the current render tier works, so the "this launch failed" marker
// written above is replaced with the tier that just succeeded — the app then
// keeps using it instead of re-testing a broken driver on every start.
let _bootConfirmed = false;
ipcMain.on('boot:ok', (e) => {
  if (!_bootConfirmed) {
    _bootConfirmed = true;
    _writeRenderState({ failedLaunches: renderTier, lastTier: renderTier, confirmed: true });
    log('[render] first paint confirmed on tier', renderTier);
  }
  e.returnValue = true;
});

// Embedded LAN relay (powers the in-game "LOCAL" room source). Started on app
// launch so ws://localhost:3000 always answers — fixes "local game: no connection
// to server". LAN peers reach the host at ws://<host-LAN-ip>:3000.
let lanRelay = null;
const LAN_RELAY_PORT = 3000;
function startEmbeddedRelay() {
  startLocalRelay({ port: LAN_RELAY_PORT, host: '0.0.0.0' })
    .then((r) => { lanRelay = r; log('✓ LAN relay listening on port ' + r.port); })
    .catch((err) => {
      // EADDRINUSE usually means a relay is already running (another game window,
      // or a manually-started server) — that's fine, LOCAL mode still works.
      if (err && err.code === 'EADDRINUSE') { lanRelay = { port: LAN_RELAY_PORT, external: true }; log('⚠ LAN relay port in use — assuming an existing relay'); }
      else { log('⚠ LAN relay failed to start:', err && err.message); }
    });
}

// List this machine's LAN IPv4 addresses so the host can tell friends what to
// type as the LOCAL host address.
function lanIPv4s() {
  const out = [];
  try {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const ni of ifaces[name] || []) {
        if (ni && ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
      }
    }
  } catch (e) { /* ignore */ }
  return out;
}
ipcMain.handle('net:lanInfo', () => ({
  running: !!lanRelay,
  port:    LAN_RELAY_PORT,
  ips:     lanIPv4s(),
}));

// Render rate / V-Sync. The game logic runs at a fixed 60 Hz via the accumulator
// in index.html; draw() runs once per animation frame.
//
// By default V-Sync is ON: we set no special switches, so the renderer is bounded
// by the monitor's refresh rate (e.g. 60 on a 60 Hz panel) — smooth, no tearing.
// Chromium also caps requestAnimationFrame at the display rate in this mode.
//
// If the player turns V-Sync OFF in Settings → Graphics, we uncap the frame rate
// (disable-gpu-vsync + disable-frame-rate-limit) so the renderer can exceed the
// monitor's refresh and the FPS counter can read above 60. This can cause tearing
// and, without a limit, high CPU use — the in-game FPS Limiter (incl. a Custom
// value) lets the player bound it. The setting is read from the save file at
// startup because command-line switches must be applied before the app is ready;
// changing V-Sync therefore takes effect after a restart.
function _readVsyncPref() {
  const p = path.join(app.getPath('userData'), 'byte-blaster-save.json');
  try {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8').replace(/^﻿/, ''); // tolerate a BOM (hand-edited save file)
      const obj = JSON.parse(raw);
      if (obj && obj.settings && obj.settings.vsync === false) return false;
    } else {
      log('[vsync] no save file yet at', p, '— defaulting to V-Sync ON');
    }
  } catch (e) {
    // Corrupted/unreadable save file: log exactly what happened (path + error)
    // instead of failing silently, then fall back to the safe default (V-Sync ON).
    log('[vsync] failed to read/parse', p, '-', e && e.message, '— defaulting to V-Sync ON');
  }
  return true;
}
if (!_readVsyncPref()) {
  app.commandLine.appendSwitch('disable-gpu-vsync');
  app.commandLine.appendSwitch('disable-frame-rate-limit');
}

// ── Human-readable save file ───────────────────────────────────────────────
// Stored as plain, pretty-printed JSON in the app's userData folder so players
// can open and edit it by hand. The renderer mirrors localStorage into it.
function getSavePath() {
  return path.join(app.getPath('userData'), 'byte-blaster-save.json');
}
// Synchronous read so the game can load progress before its scripts run.
ipcMain.on('save:readSync', (e) => {
  try {
    const p = getSavePath();
    e.returnValue = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  } catch (err) {
    e.returnValue = null;
  }
});
ipcMain.handle('save:write', (e, data) => {
  try {
    fs.writeFileSync(getSavePath(), data, 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
ipcMain.handle('save:path', () => {
  try { return getSavePath(); } catch (e) { return null; }
});

// ── Вход, переживающий обновление ──────────────────────────────────────────
// Аккаунт хранился только в localStorage, а тот лежит внутри профиля Chromium.
// Установщик перед новой версией сносит старую целиком (см. customInit в
// build/installer.nsh), и профиль вместе с ней: игрок обновлялся и обнаруживал,
// что его разлогинило, хотя он ничего не делал.
//
// Поэтому ключи входа дублируются обычным файлом в папке данных — её не трогает
// ни установщик, ни деинсталлятор. Содержимое шифруется средствами системы,
// когда они доступны: внутри токен доступа к аккаунту, а не безобидная
// настройка. Если шифрование недоступно (редкие сборки Linux), пишем как есть —
// потерять вход хуже, чем хранить его рядом с сохранениями.
function getLoginPath() {
  return path.join(app.getPath('userData'), 'pixset-login.dat');
}

function readLoginStore() {
  try {
    const p = getLoginPath();
    if (!fs.existsSync(p)) return {};
    const raw = fs.readFileSync(p);
    if (!raw.length) return {};
    // Первый байт '{' — файл записан без шифрования (или система его тогда
    // не умела). Разбираем оба вида, чтобы обновление настроек не теряло вход.
    const text = raw[0] === 0x7b ? raw.toString('utf8') : safeStorage.decryptString(raw);
    const obj = JSON.parse(text);
    return (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {};
  } catch (err) {
    log('[login] не смогли прочитать хранилище:', err && err.message);
    return {};
  }
}

function writeLoginStore(obj) {
  try {
    const text = JSON.stringify(obj || {});
    let out;
    try {
      out = safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(text)
        : Buffer.from(text, 'utf8');
    } catch (e) {
      out = Buffer.from(text, 'utf8');
    }
    fs.writeFileSync(getLoginPath(), out);
    return true;
  } catch (err) {
    log('[login] не смогли сохранить хранилище:', err && err.message);
    return false;
  }
}

// Чтение синхронное: вход нужен раньше, чем отрисуется первый кадр.
ipcMain.on('login:readSync', (e) => { e.returnValue = readLoginStore(); });
// Запись — без ответа: её вызывают часто (одни только часы), и ждать нечего.
ipcMain.on('login:write', (_e, obj) => { writeLoginStore(obj); });

// ── Localisation discovery ──────────────────────────────────────────────────
// Lists language codes from the "assets/localisation/" folder so the i18n
// loader can pick them up automatically. Works whether the app runs from source
// or packaged (asar): __dirname points at the app root in both cases.
ipcMain.handle('locale:list', () => {
  try {
    const dir = path.join(__dirname, 'assets', 'localisation');
    return fs.readdirSync(dir)
      .filter(f => f.toLowerCase().endsWith('.json') && f.toLowerCase() !== 'index.json' && !f.startsWith('_'))
      .map(f => f.replace(/\.json$/i, ''));
  } catch (e) {
    return [];
  }
});
// Read+parse a single locale file (guards against path traversal).
ipcMain.handle('locale:read', (e, code) => {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(String(code))) return null;
    const file = path.join(__dirname, 'assets', 'localisation', code + '.json');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return null;
  }
});

// Read a baked audio file under assets/audio/ as base64 (guards against path traversal).
ipcMain.handle('audio:read', (e, rel) => {
  try {
    // Музыка лежит на уровень глубже — в папке стиля (Music/modern/...).
    // Пока этого не было в правиле, в .exe не загружался НИ ОДИН трек: проверка
    // молча возвращала null, и игра всегда играла запасным синтезом.
    const r = String(rel).replace(/\\/g, '/');
    if (r.includes('..') || !/^assets\/audio\/(Music\/(modern|chip)|SFX)\/[A-Za-z0-9_]+\.mp3$/.test(r)) return null;
    return fs.readFileSync(path.join(__dirname, r)).toString('base64');
  } catch (err) {
    return null;
  }
});

/* ── Кэш догружаемого звука ───────────────────────────────────────────────────
   Восьмибитный набор музыки не входит в сборку и скачивается по выбору игрока.
   Страница живёт на file://, где Cache Storage браузера недоступен, поэтому
   файлы кладём на диск сами — в папку данных приложения.

   Имя приходит из рендерера, поэтому чистим его от всего, что могло бы увести
   запись за пределы этой папки. */
const AUDIO_CACHE = path.join(app.getPath('userData'), 'audio-cache');

function cachePathFor(rel) {
  const clean = String(rel || '').split(/[\\/]+/)
    .filter((p) => p && p !== '.' && p !== '..')
    .map((p) => p.replace(/[^\w.\-]/g, '_'))
    .join(path.sep);
  if (!clean) return null;
  const full = path.join(AUDIO_CACHE, clean);
  return full.startsWith(AUDIO_CACHE) ? full : null;
}

ipcMain.handle('audio:cacheGet', (_e, rel) => {
  try {
    const f = cachePathFor(rel);
    if (!f || !fs.existsSync(f)) return null;
    return fs.readFileSync(f).toString('base64');
  } catch (err) { return null; }
});

ipcMain.handle('audio:cachePut', (_e, rel, b64) => {
  try {
    const f = cachePathFor(rel);
    if (!f) return { success: false };
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, Buffer.from(String(b64 || ''), 'base64'));
    return { success: true };
  } catch (err) {
    log('[audio-cache] не удалось сохранить:', err && err.message);
    return { success: false };
  }
});

// Steam integration (optional - requires greenworks)
let steamworks = null;
try {
  steamworks = require('./greenworks');
  if (steamworks && steamworks.initAPI()) {
    log('✓ Steam API initialized');
  } else {
    log('⚠ Steam API not available (running without Steam)');
    steamworks = null;
  }
} catch (e) {
  log('⚠ Greenworks not found (running without Steam)');
  steamworks = null;
}

let mainWindow;
let _crashReloadCount = 0;

function createWindow() {
  log('createWindow() called');
  // Kill the default application menu outright. `autoHideMenuBar` only HIDES
  // it — pressing Alt still popped up File/Edit/View/Window over the game,
  // which is Electron's stock menu and has nothing to do with Byte Blaster.
  // Removing the menu entirely means Alt does nothing at all.
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    backgroundColor: '#04040f',
    icon: path.join(__dirname, 'icons/icon.ico'),
    show: false, // avoid a white/blank flash — shown once the page has actually rendered
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    autoHideMenuBar: true,
    // Belt and braces: even with no application menu, this stops a menu bar
    // from ever being toggled into existence on this window.
    title: 'Byte Blaster',
    center: true,
    resizable: true,
    fullscreenable: true
  });

  const indexPath = path.join(__dirname, 'index.html');
  log('[window] loading', indexPath);
  mainWindow.loadFile(indexPath).catch((err) => {
    log('[window] loadFile failed:', err && err.message);
  });

  // Open DevTools in development
  // mainWindow.webContents.openDevTools();

  // Normal path: page finished loading its DOM + scripts — safe to reveal.
  mainWindow.webContents.on('did-finish-load', () => {
    log('[window] did-finish-load');
    if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
  });
  // Electron also fires this once layout is ready; kept as a second trigger in
  // case did-finish-load already ran before this listener was attached.
  mainWindow.once('ready-to-show', () => {
    log('[window] ready-to-show');
    if (mainWindow) mainWindow.show();
  });
  // Diagnose the actual "blank .exe window" reports: log *why* the page failed
  // to load (bad path under asar packaging, missing file, etc.) instead of the
  // player just seeing a black window with no explanation in the console.
  mainWindow.webContents.on('did-fail-load', (e, errorCode, errorDescription, validatedURL) => {
    log('[window] did-fail-load:', errorCode, errorDescription, validatedURL);
  });
  mainWindow.webContents.on('render-process-gone', (e, details) => {
    log('[window] renderer process gone:', details && details.reason, details && details.exitCode);
    // A crashed (not just "killed"/"clean-exit") renderer is almost always the
    // native GPU/canvas crash the flags above target — reloading the page
    // often recovers since it's a driver hiccup, not a corrupted game state.
    // Capped at 3 reloads so a persistent crash shows the black window (and
    // this log entry) instead of silently reloading forever.
    if (details && details.reason === 'crashed') {
      _crashReloadCount = (_crashReloadCount || 0) + 1;
      if (_crashReloadCount <= 3 && mainWindow) {
        log('[window] attempting reload after crash, attempt', _crashReloadCount);
        setTimeout(() => { if (mainWindow) mainWindow.reload(); }, 500);
      } else {
        log('[window] giving up after', _crashReloadCount, 'crash-reloads');
      }
    }
  });
  // Safety net: if neither event above fires within 8s (e.g. a very slow first
  // paint), show the window anyway rather than leaving the app invisible forever
  // — an invisible-but-running app looks exactly like the reported "blank .exe".
  const showFallback = setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      log('[window] show() fallback fired — did-finish-load/ready-to-show never signalled in time');
      mainWindow.show();
    }
  }, 8000);
  mainWindow.once('show', () => clearTimeout(showFallback));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('gpu-process-crashed', (e, killed) => log('[FATAL] app gpu-process-crashed, killed=', killed));
app.on('child-process-gone', (e, details) => log('[FATAL] app child-process-gone:', details));
app.on('render-process-gone', (e, wc, details) => log('[FATAL] app render-process-gone:', details));

app.whenReady().then(() => {
  log('app.whenReady() fired');
  // startEmbeddedRelay() is fire-and-forget (its own .then/.catch handle success
  // and EADDRINUSE) so it never blocks window creation — LAN mode simply finishes
  // initialising a moment after the window appears. Not critical to reorder.
  startEmbeddedRelay();
  createWindow();

  // Per-process memory tracing. This used to run unconditionally every 2s for
  // the whole session — each tick doing a SYNCHRONOUS append to the log file,
  // so a long play session wrote tens of thousands of useless lines and hit
  // the disk twice a second forever. It is a leak-hunting tool, so it is now
  // opt-in: launch with `--mem-log` when you actually need it.
  if (process.argv.includes('--mem-log')) {
    setInterval(() => {
      try {
        const metrics = app.getAppMetrics();
        const summary = metrics.map(m => `${m.type}${m.serviceName ? '/' + m.serviceName : ''}=${Math.round((m.memory && m.memory.workingSetSize || 0) / 1024)}MB`).join(' ');
        log('[mem]', summary);
      } catch (e) { log('[mem] failed:', e); }
    }, 2000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch((err) => log('[FATAL] app.whenReady() rejected:', err));

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ═══════════════════════════════════════════════
//  STEAM API INTEGRATION
// ═══════════════════════════════════════════════

// Quit the application (Exit button on the main menu).
ipcMain.on('renderer-log', (e, msg) => { log('[renderer]', msg); e.returnValue = true; });

ipcMain.handle('app:quit', () => {
  app.quit();
  return { success: true };
});

// Сохранить скачанное обновление в «Загрузки» и открыть его.
// Апдейтер уже сверил контрольную сумму: сюда попадает проверенный файл.
ipcMain.handle('update:save', async (_e, name, bytes) => {
  try {
    const safeName = String(name || 'update.exe').replace(/[^\w.\-]/g, '_');
    const dir = app.getPath('downloads') || os.tmpdir();
    const file = path.join(dir, safeName);

    fs.writeFileSync(file, Buffer.from(bytes));
    log('[update] saved', file);

    // Показываем файл в проводнике, а не запускаем сами: установщик просит
    // подтверждения у пользователя, и он должен видеть, что именно открывает.
    shell.showItemInFolder(file);
    return { success: true, path: file };
  } catch (err) {
    log('[update] save failed', err && err.message);
    return { success: false, error: String(err && err.message) };
  }
});

// Open an external link in the player's default browser (the demo build's
// "get the full version" button). Only http/https is ever forwarded to the OS,
// so a bad value in assets/edition.js can't turn this into a launcher for
// arbitrary files or protocols.
ipcMain.handle('app:openExternal', (e, url) => {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      log('[openExternal] refused non-web url:', u.protocol);
      return { success: false };
    }
    shell.openExternal(u.href);
    return { success: true };
  } catch (err) {
    log('[openExternal] invalid url:', String(url));
    return { success: false };
  }
});

// ── Уведомления ──────────────────────────────────────────────────────────────
// Показываем их из главного процесса, а не из страницы. Причина: index.html
// грузится через loadFile, то есть с origin file://, и веб-уведомление оттуда
// уходит в никуда — конструктор не падает, тост просто не появляется. У
// главного процесса такой зависимости нет, он говорит с системой напрямую.
//
// Клик по тосту должен возвращать игрока в игру и доводить дело до конца
// (например, заводить в комнату друга), поэтому окно поднимаем сами, а
// полезную нагрузку отдаём рендереру.
ipcMain.handle('notify:supported', () => {
  try { return Notification.isSupported(); } catch (e) { return false; }
});

ipcMain.handle('notify:show', (e, opts) => {
  const o = opts || {};
  try {
    if (!Notification.isSupported()) return { success: false, reason: 'unsupported' };
    const icon = path.join(__dirname, 'icons', 'android-chrome-192x192.png');
    const n = new Notification({
      title: String(o.title || 'Byte Blaster'),
      body: String(o.body || ''),
      icon: fs.existsSync(icon) ? icon : undefined,
      silent: !!o.silent,
    });
    n.on('click', () => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
        if (o.tag) win.webContents.send('notify:clicked', o.tag);
      }
    });
    n.show();
    return { success: true };
  } catch (err) {
    log('[notify] failed:', err && err.message);
    return { success: false, reason: String(err && err.message) };
  }
});

// Relaunch the app (used when a setting that only applies at startup — e.g.
// V-Sync — is changed and the player chooses to apply it now).
ipcMain.handle('app:relaunch', () => {
  app.relaunch();
  app.exit(0);
  return { success: true };
});

// Window resize handler
ipcMain.handle('resize-window', async (event, width, height) => {
  if (mainWindow) {
    mainWindow.setSize(width, height);
    mainWindow.center();
    return { success: true };
  }
  return { success: false };
});

// Window mode handler
ipcMain.handle('set-window-mode', async (event, mode) => {
  if (!mainWindow) return { success: false };
  try {
    if (mode === 'fullscreen') {
      mainWindow.setFullScreen(true);
    } else if (mode === 'frameless') {
      // True frameless can't be toggled at runtime in Electron;
      // approximate "borderless" with a maximized non-fullscreen window.
      mainWindow.setFullScreen(false);
      mainWindow.maximize();
    } else {
      // windowed — normal windowed mode
      mainWindow.setFullScreen(false);
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Achievement unlock
ipcMain.handle('steam:unlockAchievement', async (event, achievementId) => {
  if (!steamworks) return { success: false, error: 'Steam not available' };
  
  try {
    steamworks.activateAchievement(achievementId, () => {
      log(`✓ Achievement unlocked: ${achievementId}`);
    }, (err) => {
      log(`✗ Failed to unlock achievement: ${err}`);
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Cloud save - write
ipcMain.handle('steam:saveToCloud', async (event, filename, data) => {
  if (!steamworks) return { success: false, error: 'Steam not available' };
  
  try {
    steamworks.saveTextToFile(filename, data, () => {
      log(`✓ Saved to Steam Cloud: ${filename}`);
    }, (err) => {
      log(`✗ Failed to save to cloud: ${err}`);
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Cloud save - read
ipcMain.handle('steam:loadFromCloud', async (event, filename) => {
  if (!steamworks) return { success: false, error: 'Steam not available' };
  
  return new Promise((resolve) => {
    try {
      steamworks.readTextFromFile(filename, (data) => {
        log(`✓ Loaded from Steam Cloud: ${filename}`);
        resolve({ success: true, data });
      }, (err) => {
        log(`✗ Failed to load from cloud: ${err}`);
        resolve({ success: false, error: err });
      });
    } catch (e) {
      resolve({ success: false, error: e.message });
    }
  });
});

// Get Steam username
ipcMain.handle('steam:getUsername', async () => {
  if (!steamworks) return { success: false, error: 'Steam not available' };
  
  try {
    const username = steamworks.getSteamId().getPersonaName();
    return { success: true, username };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Update stats
ipcMain.handle('steam:setStat', async (event, statName, value) => {
  if (!steamworks) return { success: false, error: 'Steam not available' };
  
  try {
    steamworks.setStat(statName, value);
    steamworks.storeStats(() => {
      log(`✓ Stat updated: ${statName} = ${value}`);
    }, (err) => {
      log(`✗ Failed to update stat: ${err}`);
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
