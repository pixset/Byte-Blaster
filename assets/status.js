// ===============================================================
//  BYTE BLASTER — STATUS EFFECTS ON THE PLAYER
// ===============================================================
// Enemies used to be interchangeable: whatever hit you, the result was the same
// single stage-down. Now the hit ALSO leaves the robot damaged in a way that
// belongs to whatever hit it — a lava crawler sets you smouldering, a cyber
// drone fries your blaster, a frost worm stiffens your servos.
//
// Design rules this module sticks to:
//   • an effect NEVER deals damage — the hit already cost you a stage. It costs
//     you capability for a few seconds. Chaining hits must not chain-kill.
//   • only ONE effect at a time. Re-applying refreshes the timer instead of
//     stacking, so a crowded room can't bury the player under four debuffs.
//   • the matching power-up makes you immune: fire mode ignores BURN, ice mode
//     ignores CHILL. That is what makes carrying an element worth something
//     beyond damage, and it is symmetric with enemyImmuneTo().
//   • star mode and i-frames never take an effect at all.
//
// Mechanics live here; game.js only asks questions (speedMul, blasterBlocked…)
// at the four places where they matter.
(function () {
  'use strict';

  const T = (k, ...a) => (typeof window.t === 'function' ? window.t(k, ...a) : k);
  // game.js is a classic script whose state is declared with `let`, so those
  // names live in the shared global lexical scope and are NOT window
  // properties. They have to be read by bare name inside a try/catch.
  const g = (read, fallback) => { try { const v = read(); return v === undefined ? fallback : v; } catch (e) { return fallback; } };
  const gTick = () => (typeof window.__bbTick === 'function' ? window.__bbTick() : 0);
  const gTheme = () => g(() => CT, null);
  const gParticles = () => g(() => _particleAliveCount, 0);

  // dur = frames at 60 fps.
  const EFFECTS = {
    burn:    { key: 'stBurn',    col: '#ff6622', icon: '🔥', dur: 300 },
    chill:   { key: 'stChill',   col: '#66ddff', icon: '❄', dur: 300 },
    emp:     { key: 'stEmp',     col: '#ffee44', icon: '⚡', dur: 240 },
    corrode: { key: 'stCorrode', col: '#88ff44', icon: '☣', dur: 300 },
  };
  const IDS = Object.keys(EFFECTS);

  // Which effect a world's enemies inflict. Index = world id (0-9); the secret
  // Prism world (10) cycles through all four, like everything else in it.
  const BY_WORLD = ['emp', 'corrode', 'burn', 'chill', 'corrode',
                    'emp', 'chill', 'corrode', 'emp', 'burn'];

  // A few enemies carry an element that outranks their world — a fire elemental
  // in the desert still burns you. enemyElement() already knows these.
  function effectFor(e) {
    if (!e) return null;
    const type = (typeof e === 'string') ? e : (e.type || '');
    if (typeof window.enemyElement === 'function' && typeof e === 'object') {
      const el = window.enemyElement(e);
      if (el === 'fire') return 'burn';
      if (el === 'ice') return 'chill';
    }
    if (type.indexOf('lv_') === 0) return 'burn';
    if (type.indexOf('ic_') === 0) return 'chill';
    if (type.indexOf('pr_') === 0) return IDS[Math.floor(Math.random() * IDS.length)];
    const world = (typeof window.worldOfEnemyType === 'function') ? window.worldOfEnemyType(type) : -1;
    if (world >= 0 && BY_WORLD[world]) return BY_WORLD[world];
    // Infinite mode / unknown prefix: follow the current theme instead.
    const ct = gTheme();
    if (ct && typeof ct.id === 'number' && BY_WORLD[ct.id]) return BY_WORLD[ct.id];
    return 'emp';
  }

  function immune(p, id) {
    if (!p) return true;
    if (p.starMode) return true;
    if (id === 'burn' && p.fireMode) return true;
    if (id === 'chill' && p.iceMode) return true;
    return false;
  }

  // ── Applying ─────────────────────────────────────────────────────────────
  function apply(p, source) {
    if (!p || !window.gameSettings || window.gameSettings.enemyEffects === 'off') return null;
    const id = (typeof source === 'string' && EFFECTS[source]) ? source : effectFor(source);
    if (!id || !EFFECTS[id]) return null;
    if (immune(p, id)) {
      if (typeof window.floatTxt === 'function')
        window.floatTxt(p.x + p.w / 2, p.y - 14, T('stImmune'), '#8ff');
      return null;
    }
    const refresh = (p.stId === id);
    p.stId = id;
    p.stT = EFFECTS[id].dur;
    p.stMax = EFFECTS[id].dur;
    if (typeof window.floatTxt === 'function')
      window.floatTxt(p.x + p.w / 2, p.y - 14, EFFECTS[id].icon + ' ' + T(EFFECTS[id].key), EFFECTS[id].col);
    if (!refresh && typeof window.burst === 'function')
      window.burst(p.x + p.w / 2, p.y + p.h / 2, EFFECTS[id].col, 12, 3, 4);
    return id;
  }

  function clear(p) { if (p) { p.stId = null; p.stT = 0; p.stMax = 0; } }

  // Called once per frame per player from updatePlayer/updatePlayer2.
  function tick(p) {
    if (!p || !p.stId) return;
    // Grabbing the matching element burns the effect off — a reward for
    // picking the right power-up rather than a coincidence.
    if (immune(p, p.stId)) { clear(p); return; }
    p.stT--;
    if (p.stT <= 0) { clear(p); return; }
    // EMP keeps the double jump locked out for as long as it lasts, including
    // the boots refill that runs every grounded frame.
    if (p.stId === 'emp' && p.jl > 1) p.jl = 1;
    // Ambient particles, cheap: a couple per second, skipped when the particle
    // budget is already busy (same guard the burning-enemy effect uses).
    if (p.stT % 12 === 0 && typeof window.burst === 'function' && gParticles() < 110) {
      window.burst(p.x + p.w / 2 + (Math.random() - 0.5) * p.w, p.y + p.h * 0.4,
                   EFFECTS[p.stId].col, 2, 1.2, 2);
    }
  }

  // ── Questions game.js asks ───────────────────────────────────────────────
  // CHILL makes you SLIDE and CORRODE makes you SLOW — swapped from the
  // original pairing because ice being slippery and acid gumming up the servos
  // is what a player expects; the reverse read as arbitrary.
  const has = (p, id) => !!(p && p.stId === id && p.stT > 0);
  function speedMul(p)      { return has(p, 'corrode') ? 0.75 : 1; }
  function jumpMul(p)       { return has(p, 'corrode') ? 0.88 : 1; }
  function slippery(p)      { return has(p, 'chill'); }
  function blasterBlocked(p){ return has(p, 'emp'); }
  function noDoubleJump(p)  { return has(p, 'emp'); }
  // Extra whole seconds of level time burned away per real second.
  function timerDrain(p)    { return has(p, 'burn') ? 1 : 0; }

  // ── Drawing ──────────────────────────────────────────────────────────────
  // A ring under the robot's feet plus a screen-edge vignette in the effect's
  // colour. No full-screen tint: it washed out the level art and made the
  // fire/ice suit unreadable.
  function drawOnPlayer(ctx, p) {
    if (!p || !p.stId || p.stT <= 0) return;
    const e = EFFECTS[p.stId], t = gTick();
    const frac = p.stT / Math.max(1, p.stMax);
    ctx.save();
    ctx.globalAlpha = 0.30 + Math.sin(t * 0.18) * 0.10;
    ctx.strokeStyle = e.col; ctx.lineWidth = 2; ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.ellipse(p.x + p.w / 2, p.y + p.h - 2, p.w * 0.62, 5, 0, 0, Math.PI * 2);
    ctx.stroke();
    // Remaining-duration arc above the head.
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x + p.w / 2, p.y - 9, 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    ctx.stroke();
    ctx.restore();
  }

  function drawVignette(ctx, p, W, H) {
    if (!p || !p.stId || p.stT <= 0) return;
    const e = EFFECTS[p.stId];
    const a = 0.16 + Math.sin(gTick() * 0.09) * 0.05;
    const grad = ctx.createRadialGradient(W / 2, H / 2, H * 0.34, W / 2, H / 2, H * 0.78);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, hexToRgba(e.col, a));
    ctx.save(); ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H); ctx.restore();
  }

  // #rrggbb → rgba(). Effect colours are authored as 6-digit hex above, so the
  // 3-digit shorthand trap that bit withAlpha() cannot occur here.
  function hexToRgba(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a.toFixed(3) + ')';
  }

  function label(p) {
    if (!p || !p.stId || p.stT <= 0) return null;
    const e = EFFECTS[p.stId];
    return { icon: e.icon, name: T(e.key), col: e.col, frac: p.stT / Math.max(1, p.stMax) };
  }

  window.Status = {
    EFFECTS, IDS, BY_WORLD,
    effectFor, apply, clear, tick, label,
    speedMul, jumpMul, slippery, blasterBlocked, noDoubleJump, timerDrain,
    drawOnPlayer, drawVignette,
  };
})();
