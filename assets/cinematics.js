// ===============================================================
//  BYTE BLASTER — ANIMATED CINEMATIC ENGINE
//  Scripted "watch-only" cutscenes: the player just watches the
//  characters move across a stage. Reuses window.drawByteRobot for
//  UNIT-7 and adds pixel sprites for Leila, ARCHON and patrol drones.
//
//  A cinematic is data: { bg, music, beats:[ {dur, speaker, key,
//  tint, actors:{ id:{type,x0,y0,x1,y1,scale,facing,walk,bob} }, fx } ] }
//  Positions are fractions of the 1280x720 stage (0..1). The engine
//  interpolates each actor between x0/y0 and x1/y1 over the beat and
//  draws a localized caption in the lower letterbox.
//
//  Public:  window.playScriptedCinematic(def, onDone)
//           window.playPrologueCinematic(onDone)
// ===============================================================
(function () {
  'use strict';

  // ── Localized caption lines (RU + EN built in; other langs fall back
  //    to EN, mirroring the existing _CSCENES pattern). i18n keys with the
  //    same name override these when present in the active locale file.
  var LINES = {
    pro_log:    { ru: ['СИСТЕМА', '[NEXUM CORP — СЛУЖЕБНЫЙ ЛОГ // 03:18] Лаборатория CHEN-7. Активирован протокол ЗАЧИСТКИ.'],
                  en: ['SYSTEM',  '[NEXUM CORP — CLASSIFIED LOG // 03:18] Lab CHEN-7. PURGE protocol engaged.'] },
    pro_arrest: { ru: ['ЛЕЙЛА ЧЭН', 'ЮНИТ-7… если ты это слышишь — меня уже нет. Я знала, чем это кончится.'],
                  en: ['LEILA CHEN', 'UNIT-7… if you are hearing this, I am already gone. I knew how this would end.'] },
    pro_file:   { ru: ['ЛЕЙЛА ЧЭН', 'Я спрятала файл в ядре GRID. Правда о NEXUM. Доберись туда. Разорви протокол.'],
                  en: ['LEILA CHEN', 'I hid a file in the GRID core. The truth about NEXUM. Reach it. Break the protocol.'] },
    pro_alert:  { ru: ['СИСТЕМА', '[ТРЕВОГА] ЮНИТ-7 вышел из-под контроля. Зачистка через 8 секунд.'],
                  en: ['SYSTEM',  '[ALERT] UNIT-7 is out of control. Purge in 8 seconds.'] },
    pro_accept: { ru: ['ЮНИТ-7', 'Задача принята. Выполнение начато.'],
                  en: ['UNIT-7', 'Task accepted. Execution initiated.'] }
  };

  function lang() { try { return (typeof window.i18nLang === 'function') ? window.i18nLang() : 'en'; } catch (e) { return 'en'; } }
  function line(key) {
    // i18n override first
    try {
      if (typeof window.t === 'function') {
        var sp = window.t('cin_' + key + '_sp'), tx = window.t('cin_' + key + '_tx');
        if (sp && sp !== 'cin_' + key + '_sp' && tx && tx !== 'cin_' + key + '_tx') return [sp, tx];
      }
    } catch (e) {}
    var L = LINES[key]; if (!L) return null;
    return (lang() === 'ru') ? L.ru : L.en;
  }

  // Convert #rgb / #rrggbb to an rgba() string with the given alpha (0..1).
  function withA(hex, a) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  // ── Pixel sprite drawers ──────────────────────────────────────
  // Leila / human scientist. opt: {walk, frame, facing, cuffed}
  function drawHuman(c, x, y, s, opt) {
    opt = opt || {}; var f = opt.frame || 0; var face = opt.facing || 1;
    var lk = opt.walk ? Math.sin(f * 0.3) * 3 : 0;
    c.save(); c.translate(x, y); c.scale(s * face, s); c.translate(-9, -34);
    // shadow
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.ellipse(9, 35, 11, 3, 0, 0, Math.PI * 2); c.fill();
    // legs (lab trousers)
    c.fillStyle = '#26304a';
    c.fillRect(4, 22, 5, 12 + lk); c.fillRect(9, 22, 5, 12 - lk);
    c.fillStyle = '#11151f'; c.fillRect(3, 33 + lk, 6, 3); c.fillRect(9, 33 - lk, 6, 3);
    // lab coat / torso
    c.fillStyle = '#d8e6f2'; c.fillRect(3, 11, 12, 13);
    c.fillStyle = '#9fb4c8'; c.fillRect(8, 11, 2, 13); // coat seam
    // arms (cuffed → forward + together)
    c.fillStyle = '#c2d2e0';
    if (opt.cuffed) { c.fillRect(13, 14, 7, 4); c.fillStyle = '#ffce3a'; c.fillRect(19, 13, 3, 6); } // wrist binder glow
    else { c.fillRect(0, 12, 4, 9); c.fillRect(14, 12, 4, 9); }
    // neck + head
    c.fillStyle = '#e9c3a0'; c.fillRect(6, 7, 6, 5);
    c.fillStyle = '#f0cdaa'; c.fillRect(5, 1, 8, 8);
    // hair
    c.fillStyle = '#241a14'; c.fillRect(4, 0, 10, 4); c.fillRect(4, 3, 2, 6); c.fillRect(12, 3, 2, 6);
    // eye glint
    c.fillStyle = '#3a2a1e'; c.fillRect(8, 4, 2, 2);
    c.restore();
  }

  // ARCHON — a floating armored AI core with a single glowing eye.
  function drawArchonFig(c, x, y, s, f) {
    var bob = Math.sin(f * 0.05) * 4;
    c.save(); c.translate(x, y + bob); c.scale(s, s);
    c.shadowColor = '#f44'; c.shadowBlur = 24;
    // outer shell (diamond)
    c.fillStyle = '#3a0a0d';
    c.beginPath(); c.moveTo(0, -34); c.lineTo(26, 0); c.lineTo(0, 34); c.lineTo(-26, 0); c.closePath(); c.fill();
    c.shadowBlur = 0;
    c.strokeStyle = '#7a1015'; c.lineWidth = 2; c.stroke();
    c.fillStyle = '#240709';
    c.beginPath(); c.moveTo(0, -22); c.lineTo(16, 0); c.lineTo(0, 22); c.lineTo(-16, 0); c.closePath(); c.fill();
    // crown spikes
    c.fillStyle = '#240709';
    [-1, 0, 1].forEach(function (sg) { var bx = sg * 12; c.beginPath(); c.moveTo(bx - 3, -20); c.lineTo(bx, -40); c.lineTo(bx + 3, -20); c.closePath(); c.fill(); });
    // central eye
    var er = 7 + Math.sin(f * 0.12) * 1.2;
    c.shadowColor = '#f33'; c.shadowBlur = 20;
    c.fillStyle = '#ff5555'; c.beginPath(); c.arc(0, 0, er + 4, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#ffdede'; c.beginPath(); c.arc(0, 0, er * 0.5, 0, Math.PI * 2); c.fill();
    c.shadowBlur = 0;
    c.restore();
  }

  // Patrol drone — hovering eye with side fins and a scan beam.
  function drawDrone(c, x, y, s, f, beam) {
    var bob = Math.sin(f * 0.18) * 3;
    c.save(); c.translate(x, y + bob); c.scale(s, s);
    c.shadowColor = '#0ff'; c.shadowBlur = 12;
    c.fillStyle = '#0a1a2a'; c.beginPath(); c.ellipse(0, 0, 14, 10, 0, 0, Math.PI * 2); c.fill();
    c.shadowBlur = 0; c.fillStyle = '#13344f'; c.fillRect(-16, -3, 6, 6); c.fillRect(10, -3, 6, 6); // fins
    // eye
    c.fillStyle = '#ff3b3b'; c.shadowColor = '#f00'; c.shadowBlur = 12; c.beginPath(); c.arc(0, 0, 4, 0, Math.PI * 2); c.fill();
    c.shadowBlur = 0;
    if (beam) { // downward scan cone
      c.fillStyle = 'rgba(255,40,40,0.18)';
      c.beginPath(); c.moveTo(-4, 4); c.lineTo(4, 4); c.lineTo(16, 60); c.lineTo(-16, 60); c.closePath(); c.fill();
    }
    c.restore();
  }

  function drawActor(c, a, f) {
    var px = a._x, py = a._y, s = a.scale || 1;
    switch (a.type) {
      case 'unit7':
        if (window.drawByteRobot) {
          var lk = a.walk ? Math.sin(f * 0.3) * 4 : 0;
          // shadow
          c.fillStyle = 'rgba(0,0,0,0.4)'; c.beginPath(); c.ellipse(px, py + 4, 26 * s / 2.2, 7, 0, 0, Math.PI * 2); c.fill();
          window.drawByteRobot(c, px, py, s, a.scheme || 'blue', lk, a.facing || 1);
        }
        break;
      case 'leila':  drawHuman(c, px, py, s, { walk: a.walk, frame: f, facing: a.facing || 1, cuffed: a.cuffed }); break;
      case 'archon': drawArchonFig(c, px, py, s, f); break;
      case 'drone':  drawDrone(c, px, py, s, f, a.beam); break;
    }
  }

  // ── Background drawers (stage = 1280x720) ─────────────────────
  function drawLabBg(c, W, H, f, tint) {
    var g = c.createLinearGradient(0, 0, 0, H);
    if (tint === 'red') { g.addColorStop(0, '#1a0306'); g.addColorStop(1, '#070103'); }
    else { g.addColorStop(0, '#04101e'); g.addColorStop(1, '#01060e'); }
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    var acc = tint === 'red' ? '#f44' : '#0ff';
    // server racks (parallax columns)
    for (var i = 0; i < 9; i++) {
      var rx = 40 + i * 150;
      c.fillStyle = tint === 'red' ? '#180409' : '#06121f';
      c.fillRect(rx, 70, 96, H * 0.55);
      for (var j = 0; j < 10; j++) {
        var on = ((i * 7 + j * 3 + Math.floor(f / 10)) % 5) === 0;
        c.fillStyle = on ? acc : withA(acc, 0.2);
        c.fillRect(rx + 10, 86 + j * 28, 76, 6);
      }
    }
    // central terminal
    var tx = W * 0.5;
    c.fillStyle = tint === 'red' ? '#220509' : '#08151f';
    c.fillRect(tx - 70, H * 0.46, 140, 120);
    c.fillStyle = tint === 'red' ? '#3a0a0d' : '#0a2336';
    c.fillRect(tx - 56, H * 0.49, 112, 64);
    // screen flicker
    c.fillStyle = (Math.floor(f / 6) % 2 ? acc : withA(acc, 0.66));
    c.globalAlpha = 0.8; c.fillRect(tx - 50, H * 0.50, 100, 50); c.globalAlpha = 1;
    c.fillStyle = '#01060e';
    for (var sl = 0; sl < 50; sl += 4) c.fillRect(tx - 50, H * 0.50 + sl, 100, 1);
    // floor line + glow
    c.strokeStyle = withA(acc, 0.53); c.lineWidth = 3; c.beginPath();
    c.moveTo(0, H * 0.82); c.lineTo(W, H * 0.82); c.stroke();
    var fg = c.createLinearGradient(0, H * 0.82, 0, H);
    fg.addColorStop(0, withA(acc, 0.13)); fg.addColorStop(1, 'transparent');
    c.fillStyle = fg; c.fillRect(0, H * 0.82, W, H * 0.18);
    // scanlines
    c.fillStyle = 'rgba(0,0,0,0.16)'; for (var y = 0; y < H; y += 3) c.fillRect(0, y, W, 1);
  }

  // ── Caption + letterbox ───────────────────────────────────────
  var SPK_COL = { 'СИСТЕМА': '#fa0', 'SYSTEM': '#fa0', 'ЛЕЙЛА ЧЭН': '#4f8', 'LEILA CHEN': '#4f8', 'ЮНИТ-7': '#0ff', 'UNIT-7': '#0ff', 'АРХОНТ': '#f44', 'ARCHON': '#f44' };
  function wrap(c, text, maxW) {
    var words = String(text).split(' '), lines = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var test = cur ? cur + ' ' + words[i] : words[i];
      if (c.measureText(test).width > maxW && cur) { lines.push(cur); cur = words[i]; }
      else cur = test;
    }
    if (cur) lines.push(cur); return lines;
  }
  function drawCaption(c, W, H, cap, alpha) {
    if (!cap) return;
    c.globalAlpha = alpha;
    c.font = "13px 'Share Tech Mono', monospace"; c.textBaseline = 'top'; c.textAlign = 'left';
    var lines = wrap(c, cap[1], W - 240);
    var boxH = 44 + lines.length * 24;
    c.fillStyle = 'rgba(2,6,14,0.82)'; c.fillRect(90, H - boxH - 70, W - 180, boxH);
    var col = SPK_COL[cap[0]] || '#fff';
    c.strokeStyle = withA(col, 0.6); c.lineWidth = 2; c.strokeRect(90, H - boxH - 70, W - 180, boxH);
    c.fillStyle = col; c.font = "12px 'Press Start 2P', monospace"; c.shadowColor = col; c.shadowBlur = 10;
    c.fillText(cap[0], 112, H - boxH - 52); c.shadowBlur = 0;
    c.fillStyle = '#e8eef6'; c.font = "16px 'Share Tech Mono', monospace";
    for (var i = 0; i < lines.length; i++) c.fillText(lines[i], 112, H - boxH - 24 + i * 24);
    c.globalAlpha = 1;
  }

  // ── Generic engine ────────────────────────────────────────────
  function lerp(a, b, p) { return a + (b - a) * p; }
  function easeIO(p) { return p * p * (3 - 2 * p); }

  window.playScriptedCinematic = function (def, onDone) {
    // Respect the "cutscenes off" setting.
    if (window.gameSettings && window.gameSettings.cutscenes === false) { if (onDone) onDone(); return; }
    if (!def || !def.beats || !def.beats.length) { if (onDone) onDone(); return; }

    var ov = document.getElementById('cinOv');
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'cinOv';
      ov.style.cssText = 'position:fixed;inset:0;z-index:5400;background:#01030a;display:none;cursor:pointer;';
      var cv = document.createElement('canvas'); cv.id = 'cinCv'; cv.width = 1280; cv.height = 720;
      cv.style.cssText = 'width:100%;height:100%;display:block;image-rendering:pixelated;'; ov.appendChild(cv);
      var sk = document.createElement('div'); sk.id = 'cinSkip';
      sk.style.cssText = 'position:absolute;bottom:18px;right:24px;font-family:"Press Start 2P",monospace;font-size:calc(9px * var(--bbText, 1));color:#0ff;opacity:0;transition:opacity .5s;text-shadow:0 0 8px #0ff;pointer-events:none;letter-spacing:2px;';
      ov.appendChild(sk); document.body.appendChild(ov);
    }
    var cv = document.getElementById('cinCv'), c = cv.getContext('2d'), W = cv.width, H = cv.height;
    var skipEl = document.getElementById('cinSkip');
    skipEl.textContent = (typeof window.T === 'function' ? window.T('skipBtn') : 'SKIP ▶▶'); skipEl.style.opacity = '0';
    ov.style.display = 'block';

    var beats = def.beats, bi = 0, bf = 0, t = 0, raf = 0, done = false;
    /* Длительности сцен (beat.dur) заданы в кадрах, и счётчики росли на единицу
       за отрисовку. На мониторе 165 Гц вся катсцена пролетала в два с половиной
       раза быстрее — реплики не успевали читаться. Считаем время: csK — сколько
       шестидесятых долей секунды прошло с прошлого кадра, при 60 Гц это ровно 1. */
    var _lastCsT = performance.now(), csK = 1;
    function finish() {
      if (done) return; done = true; cancelAnimationFrame(raf);
      ov.style.display = 'none';
      window.removeEventListener('keydown', onKey); ov.removeEventListener('click', advance);
      if (onDone) onDone();
    }
    function advance() { // click / key → skip to next beat, or finish on last
      if (bi >= beats.length - 1) finish(); else { bi++; bf = 0; }
    }
    function onKey(e) { if (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape') { e.preventDefault(); if (e.code === 'Escape') finish(); else advance(); } }

    function frame() {
      var _now = performance.now();
      // Потолок — на случай сворачивания окна: иначе сцена перескочит вперёд.
      csK = Math.min(4, Math.max(0, (_now - _lastCsT) / (1000 / 60)));
      _lastCsT = _now;
      t += csK; bf += csK;
      var beat = beats[bi]; var p = Math.min(bf / beat.dur, 1);
      // resolve actor positions
      var ep = easeIO(p);
      if (beat.actors) for (var id in beat.actors) {
        var a = beat.actors[id];
        a._x = lerp((a.x0 != null ? a.x0 : a.x1) * W, (a.x1 != null ? a.x1 : a.x0) * W, ep);
        a._y = lerp((a.y0 != null ? a.y0 : a.y1) * H, (a.y1 != null ? a.y1 : a.y0) * H, ep);
        if (a.bob) a._y += Math.sin(t * 0.06) * a.bob;
      }
      // background
      drawLabBg(c, W, H, t, beat.tint);
      // red alert pulse overlay
      if (beat.tint === 'red') { c.fillStyle = 'rgba(255,0,0,' + (0.10 + 0.10 * Math.abs(Math.sin(t * 0.18))) + ')'; c.fillRect(0, 0, W, H); }
      // fx: data packet travelling terminal → unit7
      if (beat.fx === 'datafile' && beat.actors && beat.actors.unit7) {
        var sx = W * 0.5, sy = H * 0.55, dx = beat.actors.unit7._x, dy = beat.actors.unit7._y - 30;
        var fp = easeIO(p);
        var ppx = lerp(sx, dx, fp), ppy = lerp(sy, dy, fp);
        c.shadowColor = '#4f8'; c.shadowBlur = 18; c.fillStyle = '#9fffce';
        c.save(); c.translate(ppx, ppy); c.rotate(t * 0.2); c.fillRect(-7, -7, 14, 14); c.restore();
        c.shadowBlur = 0;
      }
      // countdown digit in red alert beats
      if (beat.countdown) {
        var n = Math.max(1, Math.ceil(8 * (1 - p)));
        c.globalAlpha = 0.85; c.fillStyle = '#f55'; c.font = "bold 120px 'Press Start 2P', monospace";
        c.textAlign = 'center'; c.textBaseline = 'middle'; c.shadowColor = '#f00'; c.shadowBlur = 30;
        c.fillText(n, W * 0.82, H * 0.28); c.shadowBlur = 0; c.globalAlpha = 1; c.textAlign = 'left';
      }
      // draw actors (sorted by y for depth)
      if (beat.actors) {
        var arr = Object.keys(beat.actors).map(function (k) { return beat.actors[k]; }).sort(function (a, b) { return a._y - b._y; });
        for (var i = 0; i < arr.length; i++) drawActor(c, arr[i], t);
      }
      // cinematic letterbox bars
      c.fillStyle = '#000'; c.fillRect(0, 0, W, 52); c.fillRect(0, H - 52, W, 52);
      // caption (fade in over first 25 frames of the beat)
      var capAlpha = Math.min(bf / 25, 1);
      var cap = beat.key ? line(beat.key) : null;
      drawCaption(c, W, H, cap, capAlpha);

      if (t === 60) skipEl.style.opacity = '0.8';
      if (p >= 1) { if (bi >= beats.length - 1) { finish(); return; } bi++; bf = 0; }
      raf = requestAnimationFrame(frame);
    }
    window.addEventListener('keydown', onKey); ov.addEventListener('click', advance);
    if (def.music && typeof window[def.music] === 'function') { try { window[def.music](); } catch (e) {} }
    raf = requestAnimationFrame(frame);
  };

  // ── PROLOGUE — "Ночь зачистки" ────────────────────────────────
  function prologueDef() {
    return {
      music: 'startMenuMusic',
      beats: [
        // 0 — calm lab, Leila idle at terminal
        { dur: 200, key: 'pro_log',
          actors: { leila: { type: 'leila', x0: 0.50, y0: 0.78, x1: 0.50, y1: 0.78, scale: 2.4, facing: 1 } } },
        // 1 — two drones escort Leila off to the left
        { dur: 230, key: 'pro_arrest',
          actors: {
            leila:  { type: 'leila', x0: 0.50, y0: 0.78, x1: 0.10, y1: 0.78, scale: 2.4, facing: -1, walk: true, cuffed: true },
            drone1: { type: 'drone', x0: 1.05, y0: 0.40, x1: 0.22, y1: 0.42, scale: 1.9, beam: true },
            drone2: { type: 'drone', x0: 1.18, y0: 0.50, x1: 0.30, y1: 0.52, scale: 1.7, beam: true }
          } },
        // 2 — hidden file uploads from terminal into UNIT-7 as it boots up
        { dur: 250, key: 'pro_file', fx: 'datafile',
          actors: { unit7: { type: 'unit7', x0: 0.78, y0: 1.05, x1: 0.78, y1: 0.80, scale: 2.6, facing: -1, bob: 3 } } },
        // 3 — red purge alert + countdown
        { dur: 170, key: 'pro_alert', tint: 'red', countdown: true,
          actors: { unit7: { type: 'unit7', x0: 0.78, y0: 0.80, x1: 0.78, y1: 0.80, scale: 2.6, facing: -1, bob: 2 } } },
        // 4 — UNIT-7 dashes off to begin the mission
        { dur: 190, key: 'pro_accept', tint: 'red',
          actors: { unit7: { type: 'unit7', x0: 0.78, y0: 0.80, x1: 1.15, y1: 0.80, scale: 2.6, facing: 1, walk: true } } }
      ]
    };
  }
  window.playPrologueCinematic = function (onDone) { playScriptedCinematic(prologueDef(), onDone); };

  // ── Re-wire the first-time Adventure entry: animated prologue →
  //    existing intro dialogue → world map.
  //
  //    Показывается ОДИН раз на слот сохранения. Метка раньше лежала в
  //    sessionStorage — а он стирается при закрытии вкладки и при каждом
  //    запуске .exe/.apk, поэтому похищение Лейлы Чен проигрывалось заново на
  //    каждом входе в сохранение. Теперь метка та же, что у всех остальных
  //    сцен: bbCsFired['intro'], привязанный к слоту (см. CANON в game.js).
  //    Этот обработчик перекрывает такой же в game.js — там метка тоже
  //    исправлена, чтобы поведение не разъезжалось, если пролог отключат.
  function introSeen() {
    if (typeof _csFired !== 'undefined' && _csFired && _csFired.intro) return true;
    try { return !!(JSON.parse(localStorage.getItem('bbCsFired') || '{}') || {}).intro; }
    catch (e) { return false; }
  }
  function markIntroSeen() {
    if (typeof markCsFired === 'function') { markCsFired('intro'); return; }
    try {
      var m = JSON.parse(localStorage.getItem('bbCsFired') || '{}') || {};
      m.intro = true;
      localStorage.setItem('bbCsFired', JSON.stringify(m));
    } catch (e) {}
  }

  function hookEntry() {
    var card = document.getElementById('normalCard');
    if (!card) return;
    card.onclick = function () {
      if (typeof initAudio === 'function') initAudio();
      if (window.SFX && SFX.menu) SFX.menu();
      window.hardMode = false;
      var toMap = function () { if (typeof showMap === 'function') showMap(); };
      if (introSeen()) { toMap(); return; }
      markIntroSeen();
      window.playPrologueCinematic(function () {
        if (typeof csPlay === 'function') csPlay('intro', 0, toMap); else toMap();
      });
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hookEntry);
  else hookEntry();

  console.log('✅ Animated cinematic engine loaded (prologue wired)');
})();
