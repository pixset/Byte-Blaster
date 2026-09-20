// ===============================================================
//  BYTE BLASTER — ОБУЧЕНИЕ
// ===============================================================
// Два разных куска:
//
//   1) Отдельный уровень «0». Играется как обычный: время идёт, жизни
//      тратятся, в конце настоящий флаг. В кампанию он ничего не пишет —
//      doFlagComplete и обработчик смерти видят активное обучение и уводят
//      управление сюда. Мир собран руками, а не генератором, чтобы каждый
//      шаг обучения гарантированно было где выполнить.
//
//   2) Одноразовые подсказки в первом уровне кампании. Предлагаются после
//      обучения и показываются РОВНО один раз: как только уровень 1 пройден,
//      они больше не появятся никогда.
//
// Подписи рисуются в DOM поверх игры, а не на холсте: так их не надо вплетать
// в порядок отрисовки игры и они сами масштабируются вместе с интерфейсом.
(function (root) {
  'use strict';

  const T = (k, d) => (typeof root.t === 'function' && root.t(k) !== k) ? root.t(k) : d;

  const DONE_KEY = 'bbTutorialDone';      // обучение пройдено
  const HINTS_KEY = 'bbLvl1Hints';        // 'on' | 'off' | 'used'

  // «Играют пальцем?» — общий ответ из game.js (см. bbWantsTouchUI): иначе на
  // ноутбуке с сенсорным экраном обучение показывало подсказки для пальцев.
  const isTouch = () => (typeof root.bbWantsTouchUI === 'function')
    ? root.bbWantsTouchUI()
    : (('ontouchstart' in root) || navigator.maxTouchPoints > 0 ||
       (root.gameSettings && root.gameSettings.touchControls === 'on'));

  /* ── Шаги ──────────────────────────────────────────────────────────────
     at   — точка в мире, к которой ведёт выноска
     tip  — что написать
     pad  — какую сенсорную кнопку подсветить (класс из touch.js)
     done — условие выполнения                                            */
  const STEPS = [
    {
      at: () => [520, H - 150],
      tip: () => isTouch()
        ? T('tut1Touch', 'Нажми ▶, чтобы идти вправо')
        : T('tut1Key', 'Стрелки или A/D — идти вправо'),
      pad: 'tp-arrow-r',
      done: () => player && player.x > 460,
    },
    {
      at: () => [980, H - 230],
      tip: () => isTouch()
        ? T('tut2Touch', 'Нажми JUMP, чтобы перепрыгнуть яму')
        : T('tut2Key', 'Пробел или ↑ — прыжок. Второй раз в воздухе — двойной'),
      pad: 'tp-jump',
      done: () => player && player.x > 1080,
    },
    {
      at: () => [1420, H - 300],
      tip: () => T('tut3', 'Ударь золотой блок СНИЗУ — посыплются монеты'),
      done: () => tutState.blockHit,
    },
    {
      at: () => [1700, H - 250],
      tip: () => T('tut4', 'Собери монеты — за них дают очки'),
      done: () => tutState.coinsGot >= 3,
    },
    {
      at: () => [2120, H - 190],
      tip: () => T('tut5', 'Прыгни на врага СВЕРХУ — сбоку он опасен'),
      done: () => tutState.enemyStomped,
    },
    {
      at: () => [EXIT_X + 20, H - 220],
      tip: () => T('tut6', 'Хватай флаг — чем выше, тем больше очков'),
      // Шаг закрывает сам флаг: finish() зовёт doFlagComplete, а не этот шаг.
      done: () => false,
    },
  ];

  const EXIT_X = 2540;
  const tutState = { blockHit: false, coinsGot: 0, enemyStomped: false };

  let active = false, step = 0, ov = null, raf = 0, prevCoins = 0;

  /* ── Мир обучения ──────────────────────────────────────────────────────
     Собираем руками: генератор не даёт гарантий, что нужный блок или враг
     окажется там, где на него показывает подпись. */
  function buildWorld() {
    const G = H - 40;                       // уровень земли

    platforms.length = 0; blocks.length = 0; coins.length = 0;
    enemies.length = 0; hazards.length = 0; dataShards.length = 0;
    checkpoints.length = 0; powerups.length = 0; decors.length = 0;

    const ground = (x, w) => platforms.push(
      { x: x, y: G, w: w, h: 40, type: 'ground', solid: false, gone: false });

    // Шаг 1–2: ровная земля, потом яма, которую надо перепрыгнуть.
    ground(0, 1000);
    ground(1180, 1700);

    // Шаг 3: золотой блок над землёй — на высоте удара снизу.
    blocks.push({ x: 1400, y: G - 150, w: 28, h: 28, type: 'c', solid: true,
      used: false, bounce: 0, origY: G - 150, coinCap: 5, coinLeft: 5 });

    // Шаг 4: монеты на площадке, до них надо допрыгнуть.
    platforms.push({ x: 1640, y: G - 130, w: 190, h: 14, type: 'normal', solid: false, gone: false });
    for (let i = 0; i < 4; i++)
      coins.push({ x: 1668 + i * 42, y: G - 176, w: 14, h: 14, a: i * 0.7, got: false });

    // Шаг 5: один слабый враг — обычный ходок первого мира, чтобы игрок сразу
    // увидел того, кого встретит в кампании. Площадку передаём как поверхность,
    // иначе он уйдёт патрулировать за пределы видимого куска.
    if (typeof mkEnemy === 'function') {
      const surf = { x: 2040, y: G, w: 260, h: 40 };
      try { mkEnemy('cy_glitch', 2120, G - 26, surf, Math.random); } catch (e) {}
    }

    worldW = 2900;
    // Шаг 6: настоящий финишный флаг, как в любом уровне. Записи в кампанию он
    // не делает — её перехватывает doFlagComplete, увидев активное обучение.
    flagX = EXIT_X;
    platforms.push({ x: flagX - 30, y: G, w: 240, h: 40, type: 'ground', solid: false, gone: false });
    spawnX = 90; spawnY = G - 60;
    if (player) { player.x = spawnX; player.y = spawnY; player.vx = 0; player.vy = 0; }
    camX = 0;
    prevCoins = 0;
  }

  /* ── Подписи ───────────────────────────────────────────────────────────── */
  function ensureStyles() {
    if (document.getElementById('bbTutCss')) return;
    const css = document.createElement('style');
    css.id = 'bbTutCss';
    css.textContent = `
      #bbTut{position:fixed;inset:0;z-index:58;pointer-events:none;
        font-family:'Share Tech Mono',monospace}
      /* Подсказку ведёт Лейла — поэтому это маленькая реплика с портретом и
         именем, а не безличная табличка. Тот же портрет, что в катсценах. */
      #bbTutTip{position:absolute;transform:translate(-50%,-100%);
        background:#04040fee;border:2px solid #4affa0;color:#4affa0;
        padding:8px 13px;font-size:calc(12px * var(--bbText, 1));
        box-shadow:0 0 18px #4affa055;display:flex;align-items:center;gap:11px;
        transition:left .18s ease,top .18s ease}
      #bbTutPort{width:calc(42px * var(--bbText, 1));height:calc(42px * var(--bbText, 1));
        flex:none;image-rendering:pixelated;background:#0a1a12;border:1px solid #4affa055}
      #bbTutTip .tipWho{font-family:'Press Start 2P',monospace;
        font-size:calc(8px * var(--bbText, 1));letter-spacing:1px;
        color:#bfffdc;margin-bottom:5px;white-space:nowrap}
      #bbTutTip .tipMsg{white-space:nowrap}
      #bbTutTip:after{content:'';position:absolute;left:50%;bottom:-9px;
        margin-left:-7px;border:7px solid transparent;border-top-color:#4affa0}
      #bbTutBar{position:absolute;left:50%;bottom:20px;transform:translateX(-50%);
        display:flex;gap:7px;align-items:center}
      #bbTutBar .seg{width:26px;height:5px;background:#1a3a5a}
      #bbTutBar .seg.on{background:#4affa0;box-shadow:0 0 8px #4affa0}
      #bbTutBar .lbl{color:#4affa0;font-size:calc(11px * var(--bbText, 1));margin-right:8px}
      /* Подсветка сенсорной кнопки: гасим остальное и обводим нужную. */
      .tpHilite{position:relative;z-index:59!important;
        box-shadow:0 0 0 4px #4affa0,0 0 26px #4affa0!important;
        animation:tpPulse 1.1s ease-in-out infinite}
      @keyframes tpPulse{0%,100%{filter:brightness(1)}50%{filter:brightness(1.5)}}
      #bbTutDim{position:fixed;inset:0;z-index:57;background:#000;opacity:.55;
        pointer-events:none;display:none}`;
    document.head.appendChild(css);
  }

  function build() {
    ensureStyles();
    ov = document.createElement('div');
    ov.id = 'bbTut';
    ov.innerHTML =
      '<div id="bbTutTip">' +
        '<canvas id="bbTutPort" width="64" height="64"></canvas>' +
        '<div><div class="tipWho"></div><div class="tipMsg"></div></div>' +
      '</div><div id="bbTutBar"></div>';
    document.body.appendChild(ov);
    const dim = document.createElement('div');
    dim.id = 'bbTutDim';
    document.body.appendChild(dim);
    renderBar();
  }

  function renderBar() {
    const bar = ov.querySelector('#bbTutBar');
    let html = '<span class="lbl">' +
      T('tutStep', 'Шаг') + ' ' + Math.min(step + 1, STEPS.length) + '/' + STEPS.length + '</span>';
    for (let i = 0; i < STEPS.length; i++)
      html += '<span class="seg' + (i < step ? ' on' : '') + '"></span>';
    bar.innerHTML = html;
  }

  /**
   * Заполнить реплику. Портрет перерисовываем только при смене говорящего:
   * csDrawPortrait рисует вручную и на каждый кадр это лишняя работа.
   */
  let lastWho = null;
  function setTip(msg, who, name) {
    const t = ov.querySelector('#bbTutTip');
    t.querySelector('.tipWho').textContent = name || '';
    t.querySelector('.tipMsg').textContent = msg;
    if (who !== lastWho) {
      lastWho = who;
      const port = document.getElementById('bbTutPort');
      if (port) port.style.display = who ? 'block' : 'none';
      if (who && typeof csDrawPortrait === 'function') {
        try { csDrawPortrait('bbTutPort', who, false); } catch (e) {}
      }
    }
    return t;
  }

  /** Мировые координаты → экранные, с учётом масштаба холста. */
  function toScreen(wx, wy) {
    const cv = document.getElementById('c');
    if (!cv) return [innerWidth / 2, innerHeight / 2];
    const r = cv.getBoundingClientRect();
    const kx = r.width / cv.width, ky = r.height / cv.height;
    return [r.left + (wx - camX) * kx, r.top + wy * ky];
  }

  function highlightPad(cls) {
    document.querySelectorAll('.tpHilite').forEach((e) => e.classList.remove('tpHilite'));
    const dim = document.getElementById('bbTutDim');
    if (!cls || !isTouch()) { if (dim) dim.style.display = 'none'; return; }
    const el = document.querySelector('.' + cls);
    if (!el) { if (dim) dim.style.display = 'none'; return; }
    el.classList.add('tpHilite');
    if (dim) dim.style.display = 'block';
  }

  function tick() {
    if (!active) return;
    raf = requestAnimationFrame(tick);
    // На экране поражения подсказку прячем — иначе она висит поверх него.
    const dead = typeof gState !== 'undefined' && gState === 'gameover';
    ov.style.display = dead ? 'none' : 'block';
    if (dead || !player) return;

    // Поблажек нет: время идёт, жизни тратятся, смерть возвращает в начало
    // обучения. Это обычный уровень, у которого просто есть подсказки.

    // Что игрок уже сделал.
    const got = coins.filter((c) => c.got).length;
    if (got > prevCoins) { tutState.coinsGot += got - prevCoins; prevCoins = got; }
    const gold = blocks[0];
    if (gold && gold.coinLeft < 5) tutState.blockHit = true;
    if (enemies.length === 0 || enemies.every((e) => e.dead || e.hp <= 0)) tutState.enemyStomped = true;

    const cur = STEPS[step];
    if (cur && cur.done()) {
      step++;
      if (root.SFX && root.SFX.coin) root.SFX.coin();
      renderBar();
      if (step >= STEPS.length) { finish(); return; }
      highlightPad(STEPS[step].pad);
    }

    const s = STEPS[Math.min(step, STEPS.length - 1)];
    const [wx, wy] = s.at();
    const [sx, sy] = toScreen(wx, wy);
    const tip = setTip(s.tip(), 'leila', T('leilaName', 'ЛЕЙЛА ЧЭН'));
    // Держим подпись в пределах экрана — на телефоне она иначе уезжает за край.
    const half = tip.offsetWidth / 2 + 10;
    tip.style.left = Math.max(half, Math.min(innerWidth - half, sx)) + 'px';
    tip.style.top = Math.max(60, sy) + 'px';
  }

  /* ── Запуск и завершение ───────────────────────────────────────────────── */
  function start() {
    if (!ov) build();
    step = 0;
    tutState.blockHit = false; tutState.coinsGot = 0; tutState.enemyStomped = false;

    startAdv(1);                            // обычный путь: игрок, HUD, цикл
    if (typeof _csActive !== 'undefined' && _csActive && typeof csSkip === 'function') csSkip();
    buildWorld();

    active = true;
    ov.style.display = 'block';
    // Подсказки первого уровня прячут полосу шагов; при запуске обучения её
    // надо вернуть, иначе после них обучение идёт без индикатора прогресса.
    ov.querySelector('#bbTutBar').style.display = 'flex';
    renderBar();
    highlightPad(STEPS[0].pad);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  }

  function stop() {
    active = false;
    cancelAnimationFrame(raf);
    if (ov) ov.style.display = 'none';
    highlightPad(null);
  }

  function finish() {
    stop();
    try { localStorage.setItem(DONE_KEY, '1'); } catch (e) {}
    if (root.SFX && root.SFX.powerup) root.SFX.powerup();
    // В прологе за уровнем идёт вторая катсцена — похищение. Вопрос про
    // подсказки задаём после неё, чтобы не разрывать сцену на полуслове.
    if (inPrologue) {
      inPrologue = false;
      // Мир замораживаем на время сцены: игрок стоит у флага, а физика и враги
      // иначе продолжали бы жить под диалогом.
      if (typeof gState !== 'undefined') gState = 'paused';
      if (typeof csPlay === 'function') csPlay('prologue_end', 0, askHints);
      else askHints();
      return;
    }
    askHints();
  }

  /* ── Пролог ────────────────────────────────────────────────────────────
     Мир «Пролог» на карте — один узел. Нажатие ведёт сюда: катсцена в
     лаборатории, обучающий уровень, катсцена похищения, вопрос о подсказках.
     В кампанию ничего из этого не пишется. */
  let inPrologue = false;
  function startPrologue() {
    inPrologue = true;
    if (typeof csPlay === 'function') csPlay('prologue_start', 0, start);
    else start();
  }

  /** Вопрос про подсказки в первом уровне — сразу после обучения. */
  function askHints() {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;inset:0;z-index:80;display:flex;' +
      'flex-direction:column;align-items:center;justify-content:center;gap:22px;' +
      'background:#04040ff2;font-family:"Share Tech Mono",monospace';
    box.innerHTML =
      '<div style="font-family:\'Press Start 2P\',monospace;color:#4affa0;' +
      'font-size:calc(14px * var(--bbText, 1));text-shadow:0 0 14px #4affa0;text-align:center">' +
      T('tutDone', 'ОБУЧЕНИЕ ПРОЙДЕНО') + '</div>' +
      '<div style="color:#c8dcf0;font-size:calc(14px * var(--bbText, 1));text-align:center;' +
      'max-width:min(560px,86vw);line-height:1.6">' +
      T('tutAskHints', 'Включить подсказки в первом уровне? Они покажутся один раз и больше не появятся.') +
      '</div><div style="display:flex;gap:16px;flex-wrap:wrap;justify-content:center"></div>';
    const row = box.querySelector('div:last-child');
    const mk = (label, col, val) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'font-family:"Press Start 2P",monospace;' +
        'font-size:calc(11px * var(--bbText, 1));padding:15px 34px;cursor:pointer;' +
        'background:#0a0a26;border:2px solid ' + col + ';color:' + col;
      b.onclick = () => {
        try { localStorage.setItem(HINTS_KEY, val); } catch (e) {}
        if (root.SFX && root.SFX.menu) root.SFX.menu();
        box.remove();
        // Возвращаем на карту мира, а не в главное меню: игрок пришёл сюда с
        // карты и следующим шагом выбирает первый уровень кампании.
        //
        // Именно через showMap(), а НЕ через WorldMap.show(): вторая только
        // рисует карту и не трогает состояние игры. После обучения оставались
        // navScr='game', работающий игровой цикл под картой и gState от уровня,
        // поэтому Escape уводил игрока обратно в уже пройденное обучение,
        // откуда он не мог выбраться. showMap() гасит цикл, прячет оверлеи и
        // выставляет navScr='map' — Escape после неё ведёт куда положено.
        if (typeof gState !== 'undefined') gState = 'menu';
        if (typeof showMap === 'function') showMap();
        else if (root.WorldMap && root.WorldMap.show) root.WorldMap.show(false);
        else if (typeof showMain === 'function') showMain();
      };
      return b;
    };
    row.appendChild(mk(T('yes', 'ДА'), '#4affa0', 'on'));
    row.appendChild(mk(T('no', 'НЕТ'), '#5a7a9a', 'off'));
    document.body.appendChild(box);
  }

  /* ── Одноразовые подсказки в первом уровне ─────────────────────────────── */
  function hintsWanted() {
    try { return localStorage.getItem(HINTS_KEY) === 'on'; } catch (e) { return false; }
  }
  /** Первый уровень пройден — подсказки отработали и больше не нужны. */
  function markHintsUsed() {
    try { if (localStorage.getItem(HINTS_KEY) === 'on') localStorage.setItem(HINTS_KEY, 'used'); } catch (e) {}
  }

  const passed = () => { try { return localStorage.getItem(DONE_KEY) === '1'; } catch (e) { return false; } };

  /* ── Подсказки первого уровня ──────────────────────────────────────────
     Отдельный наблюдатель: ждёт, когда игрок войдёт в уровень 1 кампании, и
     ведёт его теми же выносками. Гаснут навсегда, как только уровень пройден. */
  const L1 = [
    { at: 420, tip: () => T('l1a', 'Жёлтые блоки бей снизу') },
    { at: 1500, tip: () => T('l1b', 'На врагов прыгай сверху') },
    { at: 2600, tip: () => T('l1c', 'Чем выше схватишь флаг, тем больше очков') },
  ];
  let l1On = false, l1Idx = 0, l1Raf = 0;

  /**
   * Пройден ли первый уровень в ТОМ ЖЕ режиме, в котором игрок сейчас.
   * Смотреть оба слота нельзя: хардкор — режим не для новичков, и пройденный
   * там уровень 1 отбирал бы подсказки у того, кто начинает обычную кампанию.
   */
  function level1Done() {
    const slot = (typeof hardMode !== 'undefined' && hardMode) ? 'bbAdvH' : 'bbAdv3';
    try {
      const p = JSON.parse(localStorage.getItem(slot) || '{}');
      return Array.isArray(p.done) && p.done.indexOf(1) >= 0;
    } catch (e) { return false; }
  }

  function l1Tick() {
    l1Raf = requestAnimationFrame(l1Tick);
    // advMode/advLevel объявлены через let — в объекте window их нет, только в
    // общем лексическом окружении. Обращаться можно лишь по голому имени.
    const inLevel1 =
      typeof advMode !== 'undefined' && advMode &&
      typeof advLevel !== 'undefined' && advLevel === 1 &&
      typeof gState !== 'undefined' && gState === 'playing' && !active;

    if (!inLevel1 || !hintsWanted()) {
      if (l1On) { l1On = false; if (ov) ov.style.display = 'none'; }
      return;
    }
    // Первый уровень уже пройден — подсказки отработали, гасим навсегда.
    // Смотрим именно ЗАПИСЬ О ПРОХОЖДЕНИИ, а не флаг касания флага: касание
    // сразу уводит игру из состояния «играем», и до проверки дело не доходило.
    if (level1Done()) { markHintsUsed(); if (l1On) { l1On = false; ov.style.display = 'none'; } return; }

    if (!ov) build();
    if (!l1On) { l1On = true; l1Idx = 0; ov.style.display = 'block'; ov.querySelector('#bbTutBar').style.display = 'none'; }
    if (!player) return;

    while (l1Idx < L1.length - 1 && player.x > L1[l1Idx].at + 700) l1Idx++;
    const h = L1[l1Idx];
    const [sx, sy] = toScreen(h.at, H - 220);
    // Лейлу уже увели — в кампании подсказки идут от самого ЮНИТ-7.
    const tip = setTip(h.tip(), 'unit7', T('unit7Name', 'ЮНИТ-7'));
    const half = tip.offsetWidth / 2 + 10;
    tip.style.left = Math.max(half, Math.min(innerWidth - half, sx)) + 'px';
    tip.style.top = Math.max(60, sy) + 'px';
  }
  l1Raf = requestAnimationFrame(l1Tick);

  root.Tutorial = { start, startPrologue, stop, finish, passed,
                    hintsWanted, markHintsUsed, isActive: () => active };
})(typeof globalThis !== 'undefined' ? globalThis : this);
