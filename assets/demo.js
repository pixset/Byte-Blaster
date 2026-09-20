// ===============================================================
//  BYTE BLASTER — БЕСПЛАТНАЯ ЧАСТЬ (без лицензии)
// ===============================================================
// Everything that makes the demo a demo lives here. The rest of the game asks
// this module questions ("is this level past the demo?", "should this card be
// locked?") instead of scattering `if (demo)` branches through the codebase —
// Когда на аккаунте есть лицензия, каждый помощник ниже — пустышка,
// а `Demo.on` равен false.
//
// What the demo cuts (see docs/BUILD_GUIDE.md):
//   • adventure stops after level BB_FREE_LEVELS (World 1 / Cyber City)
//   • world map shows that one world only
//   • INFINITE mode        — locked
//   • HARDCORE difficulty  — locked
//   • 2 PLAYERS (local)    — locked
//   • ONLINE multiplayer   — locked
//
// Loaded before every other game script (see index.html) so `window.Demo` is
// available to all of them. Nothing here touches the DOM at load time — the end
// screen is built on first use.
(function () {
  'use strict';

  const T = (k, ...a) => (typeof window.t === 'function' ? window.t(k, ...a) : k);

  // Единственный критерий: есть ли на аккаунте лицензия. Отдельной демо-сборки
  // больше нет — сборка всегда одна, полную игру открывает покупка. Проверка
  // идёт по локально подписанному токену, поэтому работает и без интернета.
  const GAME_SLUG = 'byte-blaster';

  // Функция, а не константа: игрок может войти в аккаунт прямо из меню.
  function isOn() {
    if (!window.License) return false;          // SDK не загрузился — не наказываем игрока
    if (!window.License.isReady()) return true; // проверка ещё идёт: до ответа закрыто
    return !window.License.hasGame(GAME_SLUG);
  }

  const LEVELS = Math.max(1, Math.min(110, parseInt(window.BB_FREE_LEVELS, 10) || 10));
  const URL = String(window.BB_STORE_URL || '');

  // ── Queries the game asks ────────────────────────────────────────────────
  // Level cap. In the full game the answer is whatever the caller already had.
  function totalLevels(fullValue) { return isOn() ? LEVELS : fullValue; }
  // True when a level number is outside the demo (level 11 in a 10-level demo).
  function beyond(n) { return isOn() && n > LEVELS; }
  // Clamp a stored "highest unlocked level" so the demo can never unlock more.
  function capMax(n) { return isOn() ? Math.min(n, LEVELS) : n; }
  // How many worlds the map may show (the demo is World 1 only).
  function worldCount(fullValue) { return isOn() ? Math.ceil(LEVELS / 10) : fullValue; }

  // ── Locking menu cards ───────────────────────────────────────────────────
  // Cards already have a `.locked` style in the game's CSS; this reuses it and
  // swaps the icon/description so the player is told WHY, not just that it's off.
  function lockCard(card, descKey) {
    if (!isOn() || !card) return false;
    card.classList.add('locked');
    const icon = card.querySelector('.mIcon');
    const desc = card.querySelector('.mDesc');
    if (icon) icon.textContent = '🔒';
    if (desc) desc.innerHTML = T(descKey);
    return true;
  }

  // Feedback when a locked thing is clicked: a short shake + the "denied" sound,
  // so the click clearly registers as refused rather than as a dead button.
  function refuse(el) {
    if (!isOn()) return false;
    if (window.SFX && window.SFX.back) window.SFX.back();
    if (el) {
      el.classList.remove('demoRefuse');
      void el.offsetWidth; // restart the animation
      el.classList.add('demoRefuse');
      setTimeout(() => el.classList.remove('demoRefuse'), 420);
    }
    return true;
  }

  // ── DEMO badge next to the version tag ───────────────────────────────────
  function tagVersion(text) { return isOn() ? text + ' · ' + T('demoTag') : text; }

  // ── Styles (injected once, only in the demo build) ───────────────────────
  let stylesDone = false;
  function ensureStyles() {
    if (stylesDone) return;
    stylesDone = true;
    const css = document.createElement('style');
    css.textContent = `
      @keyframes demoShake{0%,100%{transform:translateX(0)}20%{transform:translateX(-6px)}
        40%{transform:translateX(6px)}60%{transform:translateX(-4px)}80%{transform:translateX(4px)}}
      .demoRefuse{animation:demoShake .38s ease}
      /* The player-count toggle has no locked state in the base stylesheet
         (nothing ever locked it before the demo), so it gets one here. */
      .ptBtn.locked{opacity:.45;cursor:not-allowed;filter:grayscale(.7)}
      .ptBtn.locked:hover{background:transparent;color:#4af}
      #bbDemoEnd{position:fixed;inset:0;z-index:60;display:none;flex-direction:column;
        align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;
        background:radial-gradient(ellipse at 50% 40%,#12002a 0%,#04040f 70%);
        font-family:'Press Start 2P',monospace;overflow-y:auto}
      #bbDemoEnd .deTitle{font-size:calc(20px * var(--bbText, 1));color:#0ff;text-shadow:0 0 18px #0ff,0 0 40px #0ff6;
        letter-spacing:4px;line-height:1.6}
      #bbDemoEnd .deSub{font-family:'Share Tech Mono',monospace;font-size:calc(13px * var(--bbText, 1));color:#ff0;
        letter-spacing:2px;text-shadow:0 0 10px #ff08}
      #bbDemoEnd .deBody{font-family:'Share Tech Mono',monospace;font-size:calc(12px * var(--bbText, 1));color:#9fd;
        line-height:2;max-width:520px}
      #bbDemoEnd .deBody b{color:#0ff}
      #bbDemoEnd .deCta{font-size:calc(9px * var(--bbText, 1));color:#f0f;text-shadow:0 0 12px #f0f;line-height:2;
        letter-spacing:2px;max-width:520px;margin-top:2px}
      #bbDemoEnd .deUrl{font-family:'Share Tech Mono',monospace;font-size:calc(11px * var(--bbText, 1));color:#0ff8;
        letter-spacing:1px;word-break:break-all}
      #bbDemoEnd .deBtn{font-family:'Press Start 2P',monospace;font-size:calc(9px * var(--bbText, 1));padding:12px 20px;
        background:#0ff1;color:#0ff;border:2px solid #0ff;cursor:pointer;letter-spacing:2px;
        text-shadow:0 0 8px #0ff;transition:background .15s,box-shadow .15s}
      #bbDemoEnd .deBtn:hover{background:#0ff3;box-shadow:0 0 18px #0ff8}
      #bbDemoEnd .deBtn.deGet{color:#f0f;border-color:#f0f;background:#f0f1;text-shadow:0 0 8px #f0f}
      #bbDemoEnd .deBtn.deGet:hover{background:#f0f3;box-shadow:0 0 18px #f0f8}
      #bbDemoEnd .deRow{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin-top:6px}
      #bbDemoEnd .deScore{font-family:'Share Tech Mono',monospace;font-size:calc(12px * var(--bbText, 1));color:#0f8;letter-spacing:2px}
      @media (max-width:640px){
        #bbDemoEnd .deTitle{font-size:calc(13px * var(--bbText, 1))}
        #bbDemoEnd .deBody,#bbDemoEnd .deSub{font-size:calc(11px * var(--bbText, 1))}
        #bbDemoEnd .deCta{font-size:calc(8px * var(--bbText, 1))}
      }`;
    document.head.appendChild(css);
  }

  // ── End-of-demo screen ───────────────────────────────────────────────────
  // Shown INSTEAD of loading level LEVELS+1. It is a real ending screen, not an
  // error popup: the player just beat the demo's final boss and should be told
  // what they finished, what the full game holds, and where to get it.
  let ov = null;
  function buildOverlay() {
    ensureStyles();
    ov = document.createElement('div');
    ov.id = 'bbDemoEnd';
    ov.innerHTML =
      '<div class="deTitle" id="deTitle"></div>' +
      '<div class="deSub" id="deSub"></div>' +
      '<div class="deScore" id="deScore"></div>' +
      '<div class="deBody" id="deBody"></div>' +
      '<div class="deCta" id="deCta"></div>' +
      '<div class="deUrl" id="deUrl"></div>' +
      '<div class="deRow">' +
        '<button class="deBtn deGet" id="deGetBtn" style="display:none"></button>' +
        '<button class="deBtn" id="deAccBtn"></button>' +
        '<button class="deBtn" id="deMenuBtn"></button>' +
      '</div>';
    document.body.appendChild(ov);

    ov.querySelector('#deMenuBtn').onclick = () => {
      if (window.SFX && window.SFX.menu) window.SFX.menu();
      hide();
      if (typeof window.showMain === 'function') window.showMain();
    };
    ov.querySelector('#deGetBtn').onclick = () => {
      if (window.SFX && window.SFX.menu) window.SFX.menu();
      openStore();
    };
    // Игра уже куплена, просто не выполнен вход — самый частый случай на
    // втором устройстве. Экран аккаунта открывается прямо отсюда.
    ov.querySelector('#deAccBtn').onclick = () => {
      if (window.AccountUI) window.AccountUI.open();
    };
  }

  // Магазин открывается прямо поверх игры: уводить игрока в другое приложение
  // ровно в тот момент, когда он собрался покупать, — верный способ его
  // потерять. Системный путь остаётся запасным, если модуль не загрузился.
  function openStore() {
    if (!URL) return;
    if (window.BBBrowser) { window.BBBrowser.open(URL); return; }
    try {
      if (window.electronAPI && typeof window.electronAPI.openExternal === 'function') {
        window.electronAPI.openExternal(URL);
        return;
      }
    } catch (e) {}
    try { window.open(URL, '_blank', 'noopener'); } catch (e) {}
  }

  function showEnd() {
    if (!isOn()) return false;
    if (!ov) buildOverlay();

    // Take the game down first — same order showWin() uses.
    if (typeof window.hideAll === 'function') window.hideAll();
    if (typeof window.stopMusic === 'function') window.stopMusic();
    // Same story as `score` below: gState is a script-level `let`, reachable
    // only by bare name. Leaving it on 'levelclear' would let the pending
    // level-clear timer keep running behind this screen.
    try { gState = 'menu'; navScr = 'demoEnd'; } catch (e) {}
    // Cancel a pending level-advance so nothing loads behind this screen.
    try { if (_goNextTimer) { clearTimeout(_goNextTimer); _goNextTimer = 0; } } catch (e) {}

    ov.querySelector('#deTitle').textContent = T('demoEndTitle');
    ov.querySelector('#deSub').textContent = T('demoEndSub', LEVELS);
    ov.querySelector('#deBody').innerHTML = T('demoEndBody');
    ov.querySelector('#deCta').textContent = T('demoEndCta');

    // `score` is a script-level `let` in game.js, so it is NOT on window — it
    // lives in the shared global lexical scope and has to be read by bare name.
    let sc = 0;
    try { sc = (typeof score === 'number') ? score : 0; } catch (e) {}
    const scEl = ov.querySelector('#deScore');
    scEl.textContent = sc ? T('finalScore', sc) : '';
    scEl.style.display = sc ? '' : 'none';

    const urlEl = ov.querySelector('#deUrl');
    const getBtn = ov.querySelector('#deGetBtn');
    urlEl.textContent = URL;
    urlEl.style.display = URL ? '' : 'none';
    getBtn.style.display = URL ? '' : 'none';
    getBtn.textContent = T('demoEndGet');
    ov.querySelector('#deAccBtn').textContent = T('accHaveAccount');
    ov.querySelector('#deMenuBtn').textContent = T('demoEndMenu');

    ov.style.display = 'flex';
    return true;
  }

  function hide() { if (ov) ov.style.display = 'none'; }

  window.Demo = {
    get on() { return isOn(); },
    get levels() { return LEVELS; },
    get url() { return URL; },
    totalLevels, beyond, capMax, worldCount,
    lockCard, refuse, tagVersion,
    showEnd, hide,
  };

  // Стили нужны заранее: анимация отказа и замок на переключателе игроков
  // работают с первого открытия экрана режимов. Теперь их вставляем всегда —
  // демо может включиться в любой момент (выход из аккаунта), а вставлять
  // стили в этот момент поздно.
  ensureStyles();
})();
