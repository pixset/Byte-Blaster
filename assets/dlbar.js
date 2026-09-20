// ===============================================================
//  BYTE BLASTER — ПОЛОСА ЗАКАЧКИ
// ===============================================================
// Показывает, сколько данных уже скачано, пока веб-сборка тянет музыку мира.
// Раньше это происходило молча: игрок ждал у тихого экрана и не понимал —
// идёт закачка или сломалось.
//
// Полоса появляется ТОЛЬКО когда данные реально идут по сети. Под Electron
// файлы лежат рядом и читаются одним куском через IPC — там показывать
// мегабайты нечестно, поэтому AudioFiles про такие чтения ничего не сообщает.
(function (root) {
  'use strict';

  const T = (k, d) => (typeof root.t === 'function' && root.t(k) !== k) ? root.t(k) : d;
  const MB = (b) => (b / 1048576).toFixed(1).replace('.', ',');

  let el = null, fill = null, text = null, hideT = 0;

  function build() {
    const css = document.createElement('style');
    css.textContent = `
      /* Прямой ребёнок body: масштабирование игрового поля иначе утащит полосу
         в леттербокс на телефоне — та же причина, что у кнопки аккаунта. */
      #bbDl{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);
        z-index:60;display:none;flex-direction:column;gap:6px;
        min-width:min(340px,80vw);padding:11px 15px;
        background:#04040fe8;border:2px solid #ffd24a88;
        font-family:'Share Tech Mono',monospace;pointer-events:none}
      #bbDl .dlRow{display:flex;justify-content:space-between;gap:14px;
        font-size:calc(11px * var(--bbText, 1));color:#ffd24a;white-space:nowrap}
      #bbDl .dlTrack{height:7px;background:#0a0a22;overflow:hidden}
      #bbDl .dlFill{height:100%;width:0%;background:linear-gradient(90deg,#0ff,#ffd24a);
        box-shadow:0 0 10px #ffd24a;transition:width .18s linear}`;
    document.head.appendChild(css);

    el = document.createElement('div');
    el.id = 'bbDl';
    el.innerHTML = '<div class="dlRow"><span id="bbDlName"></span><span id="bbDlSize"></span></div>' +
                   '<div class="dlTrack"><div class="dlFill" id="bbDlFill"></div></div>';
    document.body.appendChild(el);
    fill = el.querySelector('#bbDlFill');
    text = { name: el.querySelector('#bbDlName'), size: el.querySelector('#bbDlSize') };
  }

  function show(info) {
    if (!el) build();
    clearTimeout(hideT);
    el.style.display = 'flex';
    text.name.textContent = T('dlLoading', 'Загрузка') + ': ' + info.label;
    // Без Content-Length процент посчитать не из чего — тогда только мегабайты.
    if (info.total > 0) {
      const f = Math.min(1, info.loaded / info.total);
      fill.style.width = Math.round(f * 100) + '%';
      text.size.textContent = MB(info.loaded) + ' / ' + MB(info.total) + ' ' + T('dlMb', 'МБ');
    } else {
      fill.style.width = '100%';
      text.size.textContent = MB(info.loaded) + ' ' + T('dlMb', 'МБ');
    }
    if (info.done) hideT = setTimeout(() => { if (el) el.style.display = 'none'; }, 700);
  }

  function attach() {
    if (!root.AudioFiles || !root.AudioFiles.onProgress) return false;
    root.AudioFiles.onProgress(show);
    return true;
  }

  // AudioFiles может подняться позже — ждём его, но недолго.
  if (!attach()) {
    const iv = setInterval(() => { if (attach()) clearInterval(iv); }, 200);
    setTimeout(() => clearInterval(iv), 15000);
  }

  root.DlBar = { show };
})(typeof globalThis !== 'undefined' ? globalThis : this);
