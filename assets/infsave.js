// ===============================================================
//  BYTE BLASTER — INFINITE MODE: SAVED RUN
// ===============================================================
// Infinite mode used to be all-or-nothing: leave for any reason — the phone
// rang, you wanted to check the map, you closed the game — and a 40-level run
// was gone. Adventure has always saved; this gives the endless mode the same
// respect for the player's time.
//
// Rules:
//   • the run is saved whenever you LEAVE it alive (pause → menu, ESC, closing
//     the window) and at every level change, so a crash costs one level, not
//     the whole run;
//   • dying ends the run and clears the save — continuing past a game over
//     would make the mode pointless;
//   • with a save present, picking INFINITE asks CONTINUE or NEW RUN. Starting
//     a new run drops the old save (with the score shown, so the choice is
//     informed). With no save, the mode starts immediately — no pointless
//     dialogue in front of a fresh run.
(function () {
  'use strict';

  const KEY = 'bbInfRun';
  const T = (k, ...a) => (typeof window.t === 'function' ? window.t(k, ...a) : k);
  // game.js state is declared with `let`, so it lives in the shared global
  // lexical scope rather than on window — read/written by bare name.
  const g = (read, fallback) => { try { const v = read(); return v === undefined ? fallback : v; } catch (e) { return fallback; } };

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (!d || typeof d.level !== 'number' || d.level < 1) return null;
      return d;
    } catch (e) { return null; }
  }
  function clear() { try { localStorage.removeItem(KEY); } catch (e) {} }
  function has() { return !!load(); }

  // Snapshot the run. Called on level change and whenever the player leaves a
  // live run; never while dead (see `alive` guard at the call sites).
  function save() {
    try {
      if (g(() => advMode, true)) return false;          // adventure has its own save
      if (window.netActive) return false;                // an online run is the room's, not ours
      const lv = g(() => level, 0);
      if (!lv || lv < 1) return false;
      const d = {
        level: lv,
        score: g(() => score, 0),
        lives: g(() => lives, 3),
        coins: g(() => coinsTotal, 0),
        hard: !!g(() => hardMode, false),
        twoP: !!g(() => twoPlayer, false),
        at: Date.now(),
      };
      localStorage.setItem(KEY, JSON.stringify(d));
      return true;
    } catch (e) { return false; }
  }

  // Restore into game.js's globals, then let its own start function build the
  // level. Deliberately does NOT touch level generation — a resumed run must
  // generate exactly what a fresh one at that level would.
  function resume() {
    const d = load();
    if (!d) return false;
    try {
      level = d.level;
      score = d.score || 0;
      lives = d.lives || 3;
      coinsTotal = d.coins || 0;
      advMode = false;
      hardMode = !!d.hard;
    } catch (e) { return false; }
    if (typeof window.patchedStartInf === 'function') window.patchedStartInf(false);
    else if (typeof window.startInf === 'function') window.startInf(false);
    return true;
  }

  // ── Choice overlay ───────────────────────────────────────────────────────
  let ov = null;
  function styles() {
    if (document.getElementById('bbInfCSS')) return;
    const st = document.createElement('style');
    st.id = 'bbInfCSS';
    st.textContent = `
#bbInfResume{position:fixed;inset:0;z-index:2600;display:none;flex-direction:column;
  align-items:center;justify-content:center;gap:16px;padding:20px;text-align:center;
  background:#04040fee;font-family:'Press Start 2P',monospace}
#bbInfResume h2{font-size:calc(13px * var(--bbText, 1));color:#0ff;text-shadow:0 0 14px #0ff;letter-spacing:4px;margin:0}
#bbInfResume .irSub{font-family:'Share Tech Mono',monospace;font-size:calc(12px * var(--bbText, 1));color:#9fd;letter-spacing:2px}
#bbInfResume .irCards{display:flex;gap:18px;flex-wrap:wrap;justify-content:center}
#bbInfResume .irCard{background:#080820;border:2px solid #4af4;border-radius:8px;padding:16px 18px;
  cursor:pointer;transition:all .22s;text-align:center;min-width:150px}
#bbInfResume .irCard:hover{border-color:#0ff;box-shadow:0 0 18px #0ff4;background:#0a0a30;transform:scale(1.04)}
#bbInfResume .irIcon{font-size:calc(24px * var(--bbText, 1));margin-bottom:7px}
#bbInfResume .irTitle{font-size:calc(8px * var(--bbText, 1));color:#0ff;letter-spacing:2px;margin-bottom:5px}
#bbInfResume .irDesc{font-family:'Share Tech Mono',monospace;font-size:calc(8px * var(--bbText, 1));color:#aaa;line-height:1.7}
#bbInfResume .irBack{margin-top:4px;background:none;border:1px solid #4af6;color:#4af;
  font-family:'Press Start 2P',monospace;font-size:calc(7px * var(--bbText, 1));padding:8px 14px;cursor:pointer;border-radius:4px}
#bbInfResume .irBack:hover{background:#4af2;color:#fff}
@media (max-width:900px){
  /* This sheet is injected at runtime, i.e. after assets/ui-fix.css, so the
     phone sizing for these controls belongs here or ui-fix.css would lose. */
  #bbInfResume h2{font-size:calc(18px * var(--bbText, 1))}
  #bbInfResume .irSub{font-size:calc(15px * var(--bbText, 1))}
  #bbInfResume .irCard{min-width:210px;padding:26px}
  #bbInfResume .irTitle{font-size:calc(14px * var(--bbText, 1))}
  #bbInfResume .irDesc{font-size:calc(12px * var(--bbText, 1))}
  #bbInfResume .irBack{font-size:calc(15px * var(--bbText, 1));padding:18px 26px}
}
@media (max-width:900px) and (max-height:420px){
  #bbInfResume h2{font-size:calc(14px * var(--bbText, 1))}
  #bbInfResume .irCard{min-width:175px;padding:18px 20px}
  #bbInfResume .irBack{font-size:calc(12px * var(--bbText, 1));padding:14px 20px}
}`;
    document.head.appendChild(st);
  }

  function build() {
    styles();
    ov = document.createElement('div');
    ov.id = 'bbInfResume';
    ov.innerHTML =
      '<h2 id="irTitle"></h2>' +
      '<div class="irSub" id="irSub"></div>' +
      '<div class="irCards">' +
        '<div class="irCard" id="irContinue"><div class="irIcon">▶</div>' +
          '<div class="irTitle" id="irContinueT"></div><div class="irDesc" id="irContinueD"></div></div>' +
        '<div class="irCard" id="irNew"><div class="irIcon">✦</div>' +
          '<div class="irTitle" id="irNewT"></div><div class="irDesc" id="irNewD"></div></div>' +
      '</div>' +
      '<button class="irBack" id="irBack"></button>';
    document.body.appendChild(ov);

    ov.querySelector('#irContinue').onclick = () => {
      if (window.SFX && window.SFX.menu) window.SFX.menu();
      hide();
      if (!resume()) startFresh();   // corrupt save: fall back to a new run
    };
    ov.querySelector('#irNew').onclick = () => {
      if (window.SFX && window.SFX.menu) window.SFX.menu();
      hide(); clear(); startFresh();
    };
    ov.querySelector('#irBack').onclick = () => {
      if (window.SFX && window.SFX.back) window.SFX.back();
      hide();
      if (typeof window.showMode === 'function') window.showMode();
    };
  }

  function startFresh() {
    clear();
    try { hardMode = false; } catch (e) {}
    if (typeof window.patchedStartInf === 'function') window.patchedStartInf(true);
    else if (typeof window.startInf === 'function') window.startInf(true);
  }

  function fmtAge(ts) {
    const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (mins < 60) return T('infAgeMin', mins);
    const h = Math.floor(mins / 60);
    if (h < 24) return T('infAgeHour', h);
    return T('infAgeDay', Math.floor(h / 24));
  }

  function hide() { if (ov) ov.style.display = 'none'; }

  // The only entry point the game calls: decides between asking and starting.
  function open() {
    const d = load();
    if (!d) { startFresh(); return 'new'; }
    if (!ov) build();
    if (typeof window.hideAll === 'function') window.hideAll();
    ov.querySelector('#irTitle').textContent = T('infResumeTitle');
    ov.querySelector('#irSub').textContent = fmtAge(d.at || Date.now());
    ov.querySelector('#irContinueT').textContent = T('infContinue');
    ov.querySelector('#irContinueD').innerHTML =
      T('infRunLevel', d.level) + '<br>' + T('infRunScore', (d.score || 0).toLocaleString()) +
      '<br>' + T('infRunLives', d.lives || 0) + (d.hard ? '<br>💀 ' + T('hardcore') : '');
    ov.querySelector('#irNewT').textContent = T('infNewRun');
    ov.querySelector('#irNewD').innerHTML = T('infNewRunDesc');
    ov.querySelector('#irBack').textContent = T('back');
    ov.style.display = 'flex';
    try { navScr = 'infResume'; } catch (e) {}
    return 'ask';
  }

  // Saving on the way out. Called from the pause menu and from page unload; the
  // caller has already decided the player is alive and in an infinite run.
  function saveIfLiveRun() {
    const alive = g(() => gState, 'menu') === 'playing' || g(() => gState, '') === 'paused';
    if (!alive) return false;
    return save();
  }
  window.addEventListener('beforeunload', () => { try { saveIfLiveRun(); } catch (e) {} });

  window.InfSave = { has, load, save, saveIfLiveRun, clear, resume, open, hide, startFresh };
})();
