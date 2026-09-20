// ===============================================================
//  BYTE BLASTER — ПРОВЕРКА ОБНОВЛЕНИЙ
// ===============================================================
// Работает во всех сборках: .exe, Android и браузер. Сама версия сборки лежит
// в BB_VERSION, актуальная берётся из каталога студии.
//
// Файлы сборок раздаются только владельцам лицензии: ссылка запрашивается у
// сервера и живёт десять минут, прямых ссылок на установщики не существует.
// Поэтому кнопка «Скачать» появляется, только если игрок вошёл и купил игру, —
// остальным показывается ссылка на сайт.
(function () {
  'use strict';

  const SUPABASE_URL = 'https://zyjhvuhovimorpokiwty.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_1bj04J3qsO1EqsKPQeSbmg_cBDEtreK';
  const GAME = 'byte-blaster';
  const CHECK_KEY = 'bbUpdateCheck';        // отметка последней проверки
  const SKIP_KEY = 'bbUpdateSkip';          // версия, которую попросили не напоминать
  const CHECK_EVERY_MS = 6 * 3600 * 1000;   // раз в шесть часов достаточно

  const T = (k, ...a) => (typeof window.t === 'function' ? window.t(k, ...a) : k);

  /** Платформа сборки: от неё зависит, какой файл предлагать. */
  function platform() {
    // По userAgent судить нельзя: строка с «Electron» встречается и у обычных
    // браузеров на его основе, и тогда веб-сборка выдаёт себя за настольную.
    // Надёжный признак нашей сборки — мост, который выставляет preload.
    if (typeof window !== 'undefined') {
      if (window.electronAPI && typeof window.electronAPI.quit === 'function') return 'windows';
      if (window.Capacitor) return 'android';
    }
    const ua = navigator.userAgent || '';
    if (/Android/i.test(ua)) return 'android';
    return 'web';
  }

  /** Сравнение версий вида 1.0.10 — по числам, а не по строке. */
  function newer(remote, local) {
    const a = String(remote).split('.').map((n) => parseInt(n, 10) || 0);
    const b = String(local).split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if ((a[i] || 0) > (b[i] || 0)) return true;
      if ((a[i] || 0) < (b[i] || 0)) return false;
    }
    return false;
  }

  function get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function set(key, v) { try { localStorage.setItem(key, v); } catch (e) {} }

  /** Текущая версия для нашей платформы. Открытые данные, лицензия не нужна. */
  async function fetchLatest() {
    const url = SUPABASE_URL + '/rest/v1/current_releases'
      + '?game_slug=eq.' + GAME + '&platform=eq.' + platform()
      + '&select=version,notes,file_size,external_url';
    const res = await fetch(url, { headers: { apikey: SUPABASE_KEY } });
    if (!res.ok) throw new Error('releases_' + res.status);
    const rows = await res.json();
    return rows && rows[0] ? rows[0] : null;
  }

  /** Ссылка на файл: только для вошедшего игрока с лицензией. */
  async function fetchLink() {
    if (!window.License || !window.License.loggedIn()) return null;
    const session = JSON.parse(get('pixset.session') || 'null');
    if (!session || !session.access_token) return null;

    const res = await fetch(SUPABASE_URL + '/functions/v1/download', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + session.access_token,
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
      },
      body: JSON.stringify({ game_slug: GAME, platform: platform() }),
    });
    if (!res.ok) return null;
    return res.json();
  }

  /** SHA-256 скачанного файла — сверяется с суммой из каталога сборок. */
  async function sha256(buffer) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Качает обновление внутри приложения и проверяет контрольную сумму.
   * Возвращает false, если такой возможности нет (браузер, старая оболочка) —
   * тогда вызывающий просто открывает ссылку.
   */
  async function downloadChecked(link) {
    const api = window.electronAPI;
    if (!api || typeof api.saveUpdate !== 'function') return false;

    // Крупная сборка лежит в хранилище кусками: бесплатный тариф не принимает
    // файл больше 50 МБ. Забираем их по порядку и склеиваем обратно —
    // контрольная сумма считается уже от собранного установщика.
    const urls = (link.urls && link.urls.length) ? link.urls : [link.url];
    const chunks = [];
    let total = 0;

    for (let i = 0; i < urls.length; i++) {
      const res = await fetch(urls[i]);
      if (!res.ok) throw new Error('download_' + res.status);
      const part = new Uint8Array(await res.arrayBuffer());
      chunks.push(part);
      total += part.length;

      if (urls.length > 1) {
        msgFail(T('updDownloading', Math.floor(((i + 1) / urls.length) * 100)));
      }
    }

    let bytes;
    if (chunks.length === 1) {
      bytes = chunks[0];
    } else {
      bytes = new Uint8Array(total);
      let at = 0;
      for (const c of chunks) { bytes.set(c, at); at += c.length; }
    }
    const buf = bytes.buffer;

    if (link.sha256) {
      const actual = await sha256(buf);
      if (actual.toLowerCase() !== String(link.sha256).toLowerCase()) {
        // Файл побился по дороге или подменён — устанавливать его нельзя.
        msgFail(T('updBroken'));
        return true;   // ссылку не открываем: пусть игрок попробует позже
      }
    }

    const name = 'ByteBlaster-Setup-' + (link.version || 'latest') + '.exe';
    await api.saveUpdate(name, bytes);
    return true;
  }

  function msgFail(text) {
    if (!ov) return;
    const t = ov.querySelector('#uText');
    if (t) t.textContent = text;
    ov.style.display = 'block';
  }

  /**
   * Страница «Скачать» открывается внутри игры, а сам файл сборки — системой:
   * загрузка внутри встроенного окна либо не начнётся, либо уедет неизвестно
   * куда. Разбирается с этим сам BBBrowser — он смотрит на расширение.
   */
  function openExternal(url) {
    if (window.BBBrowser) { window.BBBrowser.open(url); return; }
    try {
      if (window.electronAPI && typeof window.electronAPI.openExternal === 'function') {
        window.electronAPI.openExternal(url);
        return;
      }
    } catch (e) {}
    try { window.open(url, '_blank', 'noopener'); } catch (e) {}
  }

  /* ── Окно с предложением обновиться ────────────────────────────────── */
  let ov = null;

  function ensureStyles() {
    if (document.getElementById('bbUpdCss')) return;
    const css = document.createElement('style');
    css.id = 'bbUpdCss';
    css.textContent = `
      #bbUpd{position:fixed;left:14px;bottom:14px;z-index:65;max-width:330px;
        background:#0a0a16;border:2px solid #0ff;padding:14px 16px;display:none;
        font-family:'Share Tech Mono',monospace;color:#cfe;box-shadow:0 12px 30px #000a}
      #bbUpd .uTitle{font-family:'Press Start 2P',monospace;font-size:calc(9px * var(--bbText, 1));color:#0ff;
        letter-spacing:1px;margin-bottom:8px;text-shadow:0 0 8px #0ff}
      #bbUpd .uText{font-size:calc(12px * var(--bbText, 1));line-height:1.7;margin-bottom:10px}
      #bbUpd .uRow{display:flex;gap:8px;flex-wrap:wrap}
      #bbUpd button{font-family:'Press Start 2P',monospace;font-size:calc(8px * var(--bbText, 1));padding:9px 12px;
        background:#0ff1;color:#0ff;border:2px solid #0ff;cursor:pointer;letter-spacing:1px}
      #bbUpd button:hover{background:#0ff3}
      #bbUpd button.skip{color:#89a;border-color:#3a4a5a;background:transparent}
      @media (max-width:640px){#bbUpd{left:8px;right:8px;bottom:8px;max-width:none}}`;
    document.head.appendChild(css);
  }

  function show(latest) {
    ensureStyles();
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'bbUpd';
      ov.innerHTML =
        '<div class="uTitle" id="uTitle"></div>' +
        '<div class="uText" id="uText"></div>' +
        '<div class="uRow">' +
          '<button id="uGet"></button>' +
          '<button class="skip" id="uLater"></button>' +
          '<button class="skip" id="uSkip"></button>' +
        '</div>';
      document.body.appendChild(ov);
    }

    ov.querySelector('#uTitle').textContent = T('updTitle');
    ov.querySelector('#uText').textContent =
      T('updText', latest.version) + (latest.notes ? ' — ' + latest.notes : '');
    ov.querySelector('#uGet').textContent = T('updGet');
    ov.querySelector('#uLater').textContent = T('updLater');
    ov.querySelector('#uSkip').textContent = T('updSkip');

    ov.querySelector('#uLater').onclick = () => { ov.style.display = 'none'; };
    ov.querySelector('#uSkip').onclick = () => {
      set(SKIP_KEY, latest.version);
      ov.style.display = 'none';
    };

    ov.querySelector('#uGet').onclick = async () => {
      const btn = ov.querySelector('#uGet');
      btn.disabled = true;
      btn.textContent = T('updWait');

      // Веб-сборка обновляется перезагрузкой страницы — качать нечего.
      if (platform() === 'web') { location.reload(); return; }

      try {
        const link = await fetchLink();
        if (link && link.url) {
          // В Electron скачиваем сами и сверяем контрольную сумму: битая
          // загрузка не должна дойти до установщика.
          const viaApp = await downloadChecked(link);
          if (!viaApp) openExternal(link.url);
        } else if (latest.external_url) {
          openExternal(latest.external_url);
        } else {
          openExternal(window.BB_STORE_URL || 'https://pixset-studio.github.io/byte-blaster/download/');
        }
      } catch (e) {
        openExternal('https://pixset-studio.github.io/byte-blaster/download/');
      } finally {
        btn.disabled = false;
        btn.textContent = T('updGet');
        ov.style.display = 'none';
      }
    };

    ov.style.display = 'block';
  }

  /** Проверка. Тихая: нет сети или сервер молчит — игра просто идёт дальше. */
  async function check(force) {
    try {
      if (window.gameSettings && window.gameSettings.autoUpdateCheck === 'off' && !force) return null;

      const last = parseInt(get(CHECK_KEY) || '0', 10);
      if (!force && Date.now() - last < CHECK_EVERY_MS) return null;
      set(CHECK_KEY, String(Date.now()));

      const latest = await fetchLatest();
      if (!latest) return null;

      const mine = window.BB_VERSION || '1.0.0';
      if (!newer(latest.version, mine)) return null;
      if (!force && get(SKIP_KEY) === latest.version) return null;

      show(latest);
      return latest;
    } catch (e) {
      return null;   // обновления — не повод мешать игроку
    }
  }

  /* ── Доступность веб-версии ───────────────────────────────────────────
     Прятать кнопку на сайте мало: страницу игры открывают по прямой ссылке и
     из закладок. Поэтому браузерная сборка сама спрашивает у студии, включён
     ли веб-канал, и если нет — показывает заглушку вместо игры.
     Проверка касается только браузера: .exe и .apk уже у игрока на руках,
     отбирать у них игру было бы нечестно. */
  async function checkWebAllowed() {
    if (platform() !== 'web') return;

    try {
      const url = SUPABASE_URL + '/rest/v1/app_settings'
        + '?key=eq.channel_web&select=value';
      const res = await fetch(url, { headers: { apikey: SUPABASE_KEY } });
      if (!res.ok) return;                 // не ответили — играем как обычно
      const rows = await res.json();
      if (!rows.length || rows[0].value !== false) return;

      showWebClosed();
    } catch (e) { /* нет сети — не мешаем играть */ }
  }

  function showWebClosed() {
    // Скрипт подключён до <body>: если страница ещё не разобрана, дожидаемся.
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', showWebClosed, { once: true });
      return;
    }
    if (document.getElementById('bbWebClosed')) return;

    ensureStyles();
    const box = document.createElement('div');
    box.id = 'bbWebClosed';
    box.style.cssText =
      'position:fixed;inset:0;z-index:99998;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;gap:16px;padding:24px;text-align:center;' +
      'background:radial-gradient(ellipse at 50% 40%,#12002a 0%,#04040f 70%);' +
      "font-family:'Press Start 2P',monospace";
    box.innerHTML =
      '<div style="font-size:calc(15px * var(--bbText, 1));color:#0ff;text-shadow:0 0 18px #0ff;letter-spacing:3px;' +
      'line-height:1.8">' + T('webClosedTitle') + '</div>' +
      '<div style="font-family:\'Share Tech Mono\',monospace;font-size:calc(13px * var(--bbText, 1));color:#9fd;' +
      'max-width:460px;line-height:1.9">' + T('webClosedText') + '</div>' +
      '<button id="bbWebClosedBtn" style="font-family:\'Press Start 2P\',monospace;' +
      'font-size:calc(9px * var(--bbText, 1));padding:12px 20px;background:#0ff1;color:#0ff;border:2px solid #0ff;' +
      'cursor:pointer;letter-spacing:2px">' + T('webClosedGet') + '</button>';
    document.body.appendChild(box);

    const btn = box.querySelector('#bbWebClosedBtn');
    if (btn) {
      btn.onclick = () => openExternal(
        'https://pixset-studio.github.io/byte-blaster/download/');
    }

    // Останавливаем звук: экран закрыт, а музыка играла бы дальше.
    try { if (typeof window.stopMusic === 'function') window.stopMusic(); } catch (e) {}
  }

  window.Updater = { check, platform, newer, checkWebAllowed };

  // Спрашиваем сразу: если веб-версия закрыта, игрок не должен успеть начать.
  checkWebAllowed();

  // Проверяем через несколько секунд после запуска: сначала пусть загрузится игра.
  setTimeout(function () { check(false); }, 6000);
})();
