// ===============================================================
//  BYTE BLASTER — ОТДАЧА: ЧТО ИГРА ОТВЕЧАЕТ НА ДЕЙСТВИЯ ИГРОКА
// ===============================================================
// Отзыв игрока был короткий: «почти нет анимаций». Тряска экрана, вспышка
// врага и частицы в игре уже были — не хватало связи между действием и
// откликом. Здесь собрано то, чего не было:
//
//   замирание кадра   удар получает вес: игра встаёт на сорок миллисекунд;
//   замедление        последний удар по боссу идёт в половину скорости;
//   пыль              под ногами при посадке и рывке — контакт с землёй;
//   шлейф             гаснущие силуэты позади на скорости;
//   полёт добычи      монета летит к счётчику, а не пропадает на месте;
//   комбо             серия убийств копит множитель и растёт на экране;
//   камера вперёд     на бегу смотрит по ходу движения;
//   переходы          шторка между экранами вместо мгновенной подмены.
//
// Всё живёт здесь, а не в game.js: тот и так на двенадцать тысяч строк, и
// добавлять туда девятый вид частиц значит хоронить его окончательно.
(function (root) {
  'use strict';

  const S = () => root.gameSettings || {};
  const on = (key, dflt) => { const v = S()[key]; return v === undefined ? dflt : v !== false; };

  /* ── Темп времени ──────────────────────────────────────────────────────
     Замирание и замедление меняют только скорость ЛОГИКИ. Кадры продолжают
     рисоваться: если остановить и отрисовку, получится не удар, а подвисание.

     В сетевой игре не применяем вовсе — логику комнаты ведёт хост, и его
     остановка заморозит всех остальных. */
  let stopMs = 0;        // сколько ещё стоять
  let slowMs = 0;        // сколько ещё замедлять
  let slowK = 1;         // во сколько раз

  function netBusy() { return !!root.netActive; }

  function hitStop(ms) {
    if (netBusy() || !on('hitStop', true)) return;
    stopMs = Math.max(stopMs, ms || 40);
  }
  function slowmo(ms, k) {
    if (netBusy()) return;
    slowMs = Math.max(slowMs, ms || 600);
    slowK = k || 0.35;
  }

  /** Вызывается из _advanceLogic: сколько игрового времени прошло на самом деле. */
  function scaleTime(dt) {
    if (stopMs > 0) { stopMs -= dt; return 0; }
    if (slowMs > 0) { slowMs -= dt; return dt * slowK; }
    return dt;
  }
  const timeScale = () => (stopMs > 0 ? 0 : slowMs > 0 ? slowK : 1);

  /* ── Частицы отдачи ────────────────────────────────────────────────────
     Свой пул, отдельно от игровых частиц: у тех своя логика столкновений и
     свой бюджет, а эти чисто декоративные и должны отключаться первыми на
     слабом устройстве. */
  const MAX = 140;
  const dusts = [];      // пыль и шлейф — рисуются в мировых координатах
  const flies = [];      // летящая добыча — в экранных

  function budgetOk() {
    if (root.gameSettings && root.gameSettings.particles === false) return false;
    const g = root.GFX;
    if (g && typeof g.bgDetail === 'number' && g.bgDetail < 0.5) return false;
    return dusts.length < MAX;
  }

  /** Облачко пыли: dir = -1 влево, 1 вправо, 0 в обе стороны (посадка). */
  function dust(x, y, dir, n) {
    if (!budgetOk()) return;
    const count = Math.min(n || 6, MAX - dusts.length);
    for (let i = 0; i < count; i++) {
      const side = dir === 0 ? (i % 2 ? 1 : -1) : dir;
      dusts.push({
        k: 'dust', x, y,
        vx: side * (0.4 + Math.random() * 1.1),
        vy: -(0.1 + Math.random() * 0.5),
        r: 2 + Math.random() * 3, life: 1, fade: 0.045 + Math.random() * 0.02,
      });
    }
  }

  /** Кадр шлейфа: гаснущий силуэт на месте, где игрок был мгновение назад. */
  function trail(x, y, w, h, color) {
    if (!budgetOk()) return;
    dusts.push({ k: 'trail', x, y, w, h, col: color || '#4af', life: 1, fade: 0.09 });
  }

  /* ── Летящая добыча ────────────────────────────────────────────────────
     Монета не исчезает в точке подбора, а летит к своему счётчику в HUD: так
     видно, ЗА ЧТО начислили, и счётчик перестаёт быть просто цифрой. */
  let hudCoin = null, hudShard = null;   // экранные позиции целей
  const bumps = { coin: 0, shard: 0 };   // подпрыгивание счётчика

  function setTargets(coinEl, shardEl) { hudCoin = coinEl; hudShard = shardEl; }

  function pickup(sx, sy, kind) {
    if (root.gameSettings && root.gameSettings.particles === false) return;
    if (flies.length > 40) return;
    flies.push({ x: sx, y: sy, t: 0, kind: kind || 'coin',
      // Дуга: сначала подброс вверх, потом притяжение к цели.
      vy: -2.4 - Math.random() * 1.2, vx: (Math.random() - 0.5) * 2.2 });
  }

  /* ── Комбо ─────────────────────────────────────────────────────────────
     Серия убийств без паузы копит множитель. Это уже не только эффект: игрок
     получает повод не отсиживаться, а идти вперёд. */
  const COMBO_WINDOW = 150;   // тиков без убийства до сброса
  let comboN = 0, comboT = 0, comboPop = 0;

  function combo() {
    comboN++; comboT = COMBO_WINDOW; comboPop = 1;
    return comboMul();
  }
  function comboMul() { return comboN < 2 ? 1 : Math.min(5, 1 + (comboN - 1) * 0.25); }
  function comboBreak() { comboN = 0; comboT = 0; }

  /* ── Камера вперёд ─────────────────────────────────────────────────────
     На бегу смещаем взгляд по ходу движения: видно, куда летишь, а не откуда.
     Смещение плавное — резкий рывок камеры читается как рывок игрока. */
  let lead = 0;
  function camLead(vx, max) {
    const want = Math.max(-1, Math.min(1, (vx || 0) / 5)) * (max || 70);
    lead += (want - lead) * 0.06;
    return lead;
  }

  /* ── Переход между экранами ────────────────────────────────────────────
     Шторка поверх всего: закрылась — меняем экран — открылась. Мгновенная
     подмена читается как сбой, особенно после долгой загрузки уровня. */
  let veil = null;
  function transition(swap, ms) {
    const dur = ms || 260;
    if (!veil) {
      veil = document.createElement('div');
      veil.id = 'bbVeil';
      veil.style.cssText = 'position:fixed;inset:0;z-index:4000;background:#04040f;' +
        'opacity:0;pointer-events:none;transition:opacity ' + (dur / 2) + 'ms ease';
      document.body.appendChild(veil);
    }
    if (root.SFX && root.SFX.swoosh) { try { root.SFX.swoosh(); } catch (e) {} }
    veil.style.pointerEvents = 'auto';
    veil.style.opacity = '1';
    setTimeout(() => {
      try { swap && swap(); } catch (e) { console.error('[juice] переход:', e); }
      veil.style.opacity = '0';
      setTimeout(() => { veil.style.pointerEvents = 'none'; }, dur / 2);
    }, dur / 2);
  }

  /* ── Шаг ───────────────────────────────────────────────────────────────
     Зовётся из update() игры один раз за логический шаг. */
  function update() {
    for (let i = dusts.length - 1; i >= 0; i--) {
      const d = dusts[i];
      if (d.k === 'dust') { d.x += d.vx; d.y += d.vy; d.vy += 0.045; d.vx *= 0.94; }
      d.life -= d.fade;
      if (d.life <= 0) dusts.splice(i, 1);
    }
    if (comboT > 0) { comboT--; if (comboT === 0) comboN = 0; }
    if (comboPop > 0) comboPop = Math.max(0, comboPop - 0.06);
  }

  /** Мировые эффекты — внутри трансформации камеры. */
  function drawWorld(ctx) {
    if (!dusts.length) return;
    ctx.save();
    for (const d of dusts) {
      ctx.globalAlpha = Math.max(0, d.life) * (d.k === 'trail' ? 0.34 : 0.5);
      if (d.k === 'trail') {
        ctx.fillStyle = d.col;
        ctx.fillRect(d.x, d.y, d.w, d.h);
      } else {
        ctx.fillStyle = '#cfd8e6';
        ctx.beginPath(); ctx.arc(d.x, d.y, d.r * d.life, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  /** Экранные эффекты — поверх мира, до интерфейса. */
  function drawScreen(ctx, W, H) {
    // Летящая добыча
    if (flies.length) {
      const tgt = (kind) => {
        const el = kind === 'shard' ? hudShard : hudCoin;
        if (!el) return { x: W * 0.5, y: 24 };
        const r = el.getBoundingClientRect();
        const cv = ctx.canvas.getBoundingClientRect();
        // Переводим позицию в HUD в координаты холста: HUD живёт в своём
        // масштабе (zoom), поэтому пересчёт обязателен.
        return { x: (r.left + r.width / 2 - cv.left) * (W / Math.max(1, cv.width)),
                 y: (r.top + r.height / 2 - cv.top) * (H / Math.max(1, cv.height)) };
      };
      ctx.save();
      for (let i = flies.length - 1; i >= 0; i--) {
        const f = flies[i];
        f.t += 0.02;
        const g = tgt(f.kind);
        if (f.t < 0.28) {                    // фаза подброса
          f.x += f.vx; f.y += f.vy; f.vy += 0.28;
        } else {                             // фаза притяжения
          const k = Math.min(1, (f.t - 0.28) / 0.72);
          f.x += (g.x - f.x) * (0.06 + k * 0.22);
          f.y += (g.y - f.y) * (0.06 + k * 0.22);
        }
        const near = Math.hypot(g.x - f.x, g.y - f.y) < 16;
        if (near || f.t > 1.4) {
          flies.splice(i, 1);
          bumps[f.kind === 'shard' ? 'shard' : 'coin'] = 1;
          continue;
        }
        const col = f.kind === 'shard' ? '#4de2ff' : '#ffd700';
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = col;
        ctx.shadowBlur = 8; ctx.shadowColor = col;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.kind === 'shard' ? 5 : 4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    // Комбо
    if (comboN >= 2) {
      const pop = 1 + comboPop * 0.5;
      const fade = comboT < 30 ? comboT / 30 : 1;
      ctx.save();
      ctx.globalAlpha = 0.9 * fade;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const size = Math.round(20 * pop);
      ctx.font = 'bold ' + size + 'px "Press Start 2P", monospace';
      const hue = Math.min(comboN * 14, 60);
      ctx.fillStyle = 'hsl(' + (52 - hue) + ',100%,62%)';
      ctx.shadowBlur = 12; ctx.shadowColor = ctx.fillStyle;
      ctx.fillText('x' + comboN, W * 0.5, H * 0.18);
      ctx.font = Math.round(9 * pop) + 'px "Share Tech Mono", monospace';
      ctx.globalAlpha = 0.7 * fade;
      ctx.fillText('КОМБО ×' + comboMul().toFixed(2), W * 0.5, H * 0.18 + size * 0.9);
      ctx.restore();
    }
  }

  /** Подпрыгивание счётчика в HUD после прилёта добычи. */
  function hudBump(kind) {
    const v = bumps[kind] || 0;
    if (v > 0) bumps[kind] = Math.max(0, v - 0.08);
    return v;
  }

  root.Juice = {
    scaleTime, timeScale, hitStop, slowmo,
    dust, trail, pickup, setTargets, hudBump,
    combo, comboMul, comboBreak, comboCount: () => comboN,
    camLead, transition,
    update, drawWorld, drawScreen,
    // Для проверок
    _counts: () => ({ dust: dusts.length, fly: flies.length, combo: comboN }),
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
