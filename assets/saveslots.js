// ===============================================
//  SAVE SLOTS — selection screen (shown on PLAY)
// ===============================================
// UI layer over window.SaveSlots (the storage engine lives in index.html).
// Lets the player pick one of 3 slots to continue/start, or delete a slot.
// A slot holds ONLY level progress, achievements and player records.

(function () {
  'use strict';

  const T = (k, ...a) => (typeof window.t === 'function' ? window.t(k, ...a) : k);
  // Denominator for a slot's "levels done" line. The main story is 100 levels;
  // once the secret Prism Anomaly world (101–110) has been reached, a slot can
  // legitimately show more than 100 done — which used to read as "102/100".
  const _slotTotal = (done) => (done > 100 ? 110 : 100);
  const sfx = () => { if (window.SFX && window.SFX.menu) window.SFX.menu(); };
  let overlay = null;

  function build() {
    overlay = document.createElement('div');
    overlay.id = 'slotOv';
    overlay.className = 'fov';
    overlay.style.cssText = `
      position: fixed; inset: 0; display: none;
      flex-direction: column; align-items: center; justify-content: center;
      background: rgba(4,4,15,0.96); z-index: 2500;
      overflow: auto; -webkit-overflow-scrolling: touch;
      font-family: 'Press Start 2P', monospace;`;
    // Content lives in an inner box that JS scales to fit the viewport (see fit()).
    // The cards stay on one row (nowrap) so the whole picker shrinks proportionally
    // on a phone instead of being clipped — matching how the game UI is fitted.
    overlay.innerHTML = `
      <div id="slotInner" style="display:flex;flex-direction:column;align-items:center;transform-origin:center center;">
        <h2 data-i18n="selectSave" style="color:#0ff;font-size:calc(18px * var(--bbText, 1));letter-spacing:4px;text-shadow:0 0 14px #0ff;margin-bottom:22px;">SELECT SAVE</h2>
        <div id="slotCards" style="display:flex;gap:18px;flex-wrap:nowrap;justify-content:center;"></div>
        <button id="slotBackBtn" data-i18n="back" style="margin-top:24px;padding:10px 20px;font-family:'Press Start 2P',monospace;font-size:calc(10px * var(--bbText, 1));background:#0a0a20;color:#4af;border:2px solid #4af;border-radius:4px;cursor:pointer;">← BACK [ESC]</button>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#slotBackBtn').onclick = () => { sfx(); hide(); if (typeof showMain === 'function') showMain(); };
  }

  // Scale the inner content so the full picker always fits the screen (only ever
  // shrinks; never enlarges past native size on desktop).
  function fit() {
    if (!overlay) return;
    const inner = overlay.querySelector('#slotInner');
    if (!inner) return;
    inner.style.transform = 'none';
    const vv = window.visualViewport;
    const vpW = (vv && vv.width)  ? vv.width  : window.innerWidth;
    const vpH = (vv && vv.height) ? vv.height : window.innerHeight;
    const w = inner.offsetWidth, h = inner.offsetHeight;
    if (!w || !h) return;
    const k = Math.min((vpW * 0.94) / w, (vpH * 0.94) / h, 1);
    inner.style.transform = 'scale(' + k + ')';
  }
  let _fitBound = false;
  function bindFit() {
    if (_fitBound) return;
    _fitBound = true;
    let raf = 0;
    const onResize = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fit); };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', () => { onResize(); setTimeout(onResize, 250); setTimeout(onResize, 600); });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', onResize);
      window.visualViewport.addEventListener('scroll', onResize);
    }
  }

  function card(i) {
    const s = window.SaveSlots.summary(i);
    const active = window.SaveSlots.getActive() === i;
    const accent = active ? '#0ff' : '#4af';
    const el = document.createElement('div');
    el.style.cssText = `
      width: 280px; background: rgba(10,10,32,0.95); border: 2px solid ${accent};
      border-radius: 8px; padding: 18px; text-align: center;
      box-shadow: ${active ? '0 0 18px #0ff5' : 'none'};`;

    const title = `<div style="color:${accent};font-size:calc(13px * var(--bbText, 1));letter-spacing:2px;margin-bottom:12px;">${T('slot')} ${i + 1}</div>`;

    let body, actions;
    if (s.empty) {
      body = `<div style="font-family:'Share Tech Mono',monospace;font-size:calc(11px * var(--bbText, 1));color:#556;letter-spacing:2px;margin:18px 0;" data-i18n="slotEmpty">— EMPTY —</div>`;
      actions = `<button class="slotPlay" style="width:100%;padding:10px;margin-top:8px;font-family:'Press Start 2P',monospace;font-size:calc(9px * var(--bbText, 1));background:#0a0a20;color:#0f8;border:2px solid #0f8;border-radius:4px;cursor:pointer;">${T('slotNewGame')}</button>`;
    } else {
      const updated = s.updatedAt ? new Date(s.updatedAt).toLocaleDateString() : '';
      body = `
        <div style="font-family:'Share Tech Mono',monospace;font-size:calc(10px * var(--bbText, 1));color:#9cf;line-height:2;text-align:left;margin:6px 2px 14px;">
          <div>${T('slotLevels', s.done, _slotTotal(s.done))}</div>
          <div>${T('slotHardcore', s.doneH, _slotTotal(s.doneH))}</div>
          <div>${T('slotAch', s.ach)}</div>
          <div>${T('slotBest', s.best)}</div>
          ${updated ? `<div style="color:#456;font-size:calc(8px * var(--bbText, 1));margin-top:4px;">${updated}</div>` : ''}
        </div>`;
      actions = `
        <button class="slotPlay" style="width:100%;padding:10px;font-family:'Press Start 2P',monospace;font-size:calc(9px * var(--bbText, 1));background:#0a0a20;color:#0ff;border:2px solid #0ff;border-radius:4px;cursor:pointer;">${T('slotContinue')}</button>
        <button class="slotDel" style="width:100%;padding:8px;margin-top:8px;font-family:'Press Start 2P',monospace;font-size:calc(8px * var(--bbText, 1));background:#0a0a20;color:#f55;border:2px solid #f55;border-radius:4px;cursor:pointer;">${T('slotDelete')}</button>`;
    }
    el.innerHTML = title + body + actions;

    el.querySelector('.slotPlay').onclick = () => {
      sfx();
      window.SaveSlots.select(i);
      hide();
      if (typeof showMode === 'function') showMode();
    };
    const del = el.querySelector('.slotDel');
    if (del) {
      let armed = false;
      del.onclick = () => {
        sfx();
        if (!armed) { armed = true; del.textContent = T('slotDeleteConfirm'); del.style.background = '#3a0000'; return; }
        window.SaveSlots.remove(i);
        render(); // rebuild cards to reflect the now-empty slot
      };
    }
    return el;
  }

  function render() {
    const wrap = overlay.querySelector('#slotCards');
    wrap.innerHTML = '';
    for (let i = 0; i < window.SaveSlots.count; i++) wrap.appendChild(card(i));
    if (typeof window.applyI18nDOM === 'function') window.applyI18nDOM();
    fit();
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); sfx(); hide(); if (typeof showMain === 'function') showMain(); }
  }

  function hide() {
    if (overlay) overlay.style.display = 'none';
    window.removeEventListener('keydown', onKey);
  }

  /* ── Кнопка активного слота в углу меню ──────────────────────────────────
     Стоит рядом с кнопкой аккаунта: слот — это «чей прогресс сейчас идёт»,
     такой же статус игрока, как и сам аккаунт. Раньше узнать, в каком слоте
     играешь, можно было только зайдя в выбор сохранения. */

  let slotBtn = null;
  let stylesDone = false;

  function ensureStyles() {
    if (stylesDone) return;
    stylesDone = true;
    const css = document.createElement('style');
    css.textContent = `
      /* Прямой ребёнок body с position:fixed — как и кнопка аккаунта: иначе
         масштабирование игрового поля утащит кнопку в леттербокс на телефоне. */
      #bbSlotBtn{position:fixed;top:16px;left:16px;z-index:55;display:none;
        flex-direction:column;align-items:stretch;justify-content:center;gap:6px;
        padding:11px 16px;min-width:150px;
        background:#0ff1;border:2px solid #0ff8;cursor:pointer;
        transition:background .15s,box-shadow .15s,border-color .15s}
      #bbSlotBtn:hover{background:#0ff3;border-color:#0ff;box-shadow:0 0 16px #0ff8}
      #bbSlotBtn .sbName{font-family:'Press Start 2P',monospace;
        font-size:calc(9px * var(--bbFix, 1));letter-spacing:1px;color:#0ff;
        text-shadow:0 0 8px #0ff;white-space:nowrap}
      #bbSlotBtn .sbWhat{font-family:'Share Tech Mono',monospace;
        font-size:calc(10px * var(--bbFix, 1));letter-spacing:1px;color:#7a94a8;
        text-transform:uppercase;white-space:nowrap;margin-top:-3px}
      #bbSlotBtn .sbLine{display:flex;align-items:center;gap:8px}
      #bbSlotBtn .sbBar{flex:1;height:calc(7px * var(--bbFix, 1));min-width:60px;
        background:#04121c;border:1px solid #0ff6;overflow:hidden}
      #bbSlotBtn .sbBar>i{display:block;height:100%;width:0;background:#0ff;
        box-shadow:0 0 8px #0ff;transition:width .3s}
      #bbSlotBtn .sbPct{font-family:'Share Tech Mono',monospace;
        font-size:calc(11px * var(--bbFix, 1));color:#9fd;white-space:nowrap}
      /* Пустой слот не хвастается нулём — он честно пишет, что пуст. */
      #bbSlotBtn.empty{border-color:#4af8}
      #bbSlotBtn.empty .sbName{color:#4af;text-shadow:0 0 8px #4af}
      @media (max-width:640px){
        #bbSlotBtn{top:10px;left:10px;padding:9px 12px;gap:4px;min-width:112px}
        #bbSlotBtn .sbName{font-size:calc(7px * var(--bbFix, 1))}
        #bbSlotBtn .sbWhat{font-size:calc(8px * var(--bbFix, 1))}
        #bbSlotBtn .sbPct{font-size:calc(9px * var(--bbFix, 1))}
      }`;
    document.head.appendChild(css);
  }

  /**
   * Процент прохождения — тот же, что на экране профиля: уровни, звёзды,
   * кристаллы, достижения и записи поровну. Считать здесь по-своему нельзя:
   * кнопка и профиль показывали бы разные числа про одно и то же.
   */
  function progressPct() {
    try {
      const P = window.Profile;
      if (P && typeof P.snapshot === 'function' && typeof P.completion === 'function') {
        return Math.round(P.completion(P.snapshot()) * 100);
      }
    } catch (e) { /* профиль ещё не загрузился — считаем по уровням */ }
    try {
      const s = window.SaveSlots.summary(window.SaveSlots.getActive());
      if (s && !s.empty) return Math.round(100 * s.done / _slotTotal(s.done));
    } catch (e) {}
    return 0;
  }

  function buildSlotButton() {
    ensureStyles();
    slotBtn = document.createElement('div');
    slotBtn.id = 'bbSlotBtn';
    slotBtn.innerHTML =
      '<span class="sbName"></span>' +
      '<span class="sbWhat"></span>' +
      '<span class="sbLine"><span class="sbBar"><i></i></span><span class="sbPct"></span></span>';
    slotBtn.onclick = () => { sfx(); window.showSlots(); };
    document.body.appendChild(slotBtn);
    updateSlotButton();
    // Тот же интервал, что у кнопки аккаунта: опрос дешевле, чем хуки на
    // каждый переход между экранами игры.
    setInterval(updateSlotButton, 400);
  }

  /**
   * Показ и положение. Обе угловые кнопки живут по одному правилу: кнопка
   * слота видна ровно тогда, когда видна кнопка аккаунта, — та уже умеет
   * прятаться под открытыми поверх меню экранами. И встаёт она справа от неё,
   * потому что ширина кнопки аккаунта зависит от длины ника.
   */
  function updateSlotButton() {
    if (!slotBtn || !window.SaveSlots) return;

    const acc = document.getElementById('bbAccBtn');
    const main = document.getElementById('mainOv');
    const visible = acc
      ? getComputedStyle(acc).display !== 'none'
      : !!main && getComputedStyle(main).display !== 'none';

    slotBtn.style.display = visible ? 'flex' : 'none';
    if (!visible) return;

    if (acc) {
      const r = acc.getBoundingClientRect();
      slotBtn.style.left = Math.round(r.right + 10) + 'px';
      slotBtn.style.top = Math.round(r.top) + 'px';
      slotBtn.style.minHeight = Math.round(r.height) + 'px';
    }

    const i = window.SaveSlots.getActive();
    const s = window.SaveSlots.summary(i);
    const empty = !s || s.empty;
    slotBtn.classList.toggle('empty', empty);
    slotBtn.querySelector('.sbName').textContent = T('slot') + ' ' + (i + 1);
    // Подпись под номером слота: без неё шкала читалась как что угодно —
    // от здоровья до места в памяти. Ключ берём готовый, тот же, что у раздела
    // профиля, — он уже переведён на все языки.
    slotBtn.querySelector('.sbWhat').textContent = T('profileSecProgress');

    const pct = empty ? 0 : progressPct();
    slotBtn.querySelector('.sbBar > i').style.width = pct + '%';
    slotBtn.querySelector('.sbPct').textContent = empty ? T('slotEmpty') : pct + '%';
    slotBtn.title = T('selectSave');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildSlotButton, { once: true });
  } else {
    buildSlotButton();
  }

  // Public: show the slot picker. Falls back to mode select if the engine is absent.
  window.showSlots = function () {
    if (!window.SaveSlots) { if (typeof showMode === 'function') showMode(); return; }
    if (!overlay) build();
    // Hide other full-screen overlays the way the game's hideAll() would.
    if (typeof window.hideAll === 'function') window.hideAll();
    render();
    overlay.style.display = 'flex';
    bindFit();
    fit();
    // WebViews settle their final size a beat late — re-fit a few times.
    [60, 200, 500].forEach(t => setTimeout(fit, t));
    window.addEventListener('keydown', onKey);
  };

  console.log('✅ Save slots UI loaded');
})();
