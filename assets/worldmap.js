// ===============================================
//  WORLD MAP SYSTEM — Visual level selection
// ===============================================
// Replaces the old button-based level grid with an interactive
// world map showing all 10 worlds and 100 levels as a connected path.

(function() {
  'use strict';

  console.log('🗺️ Loading World Map system...');

  // ═══════════════════════════════════════════════
  //  WORLD & LEVEL DATA
  // ═══════════════════════════════════════════════

  const WORLDS = [
    {id:0, name:'CYBER CITY',    icon:'🏙', accent:'#0ff', dark:'#001a2a', mid:'#003355', range:[1,10]},
    {id:1, name:'NEON JUNGLE',   icon:'🌿', accent:'#4f8', dark:'#001a0a', mid:'#003315', range:[11,20]},
    {id:2, name:'LAVA WORLD',    icon:'🌋', accent:'#f62', dark:'#2a0800', mid:'#441100', range:[21,30]},
    {id:3, name:'ICE CAVES',     icon:'❄',  accent:'#8cf', dark:'#001a33', mid:'#002a55', range:[31,40]},
    {id:4, name:'DESERT RUINS',  icon:'🏜', accent:'#e8a', dark:'#2a1800', mid:'#442800', range:[41,50]},
    {id:5, name:'SPACE STATION', icon:'🛸', accent:'#a0f', dark:'#1a0033', mid:'#2a0055', range:[51,60]},
    {id:6, name:'DARK FOREST',   icon:'🌲', accent:'#0b4', dark:'#001a0a', mid:'#003315', range:[61,70]},
    {id:7, name:'TOXIC ZONE',    icon:'☣',  accent:'#cf0', dark:'#1a2200', mid:'#2a3300', range:[71,80]},
    {id:8, name:'STORM PEAKS',   icon:'⚡', accent:'#88f', dark:'#0a0a1a', mid:'#15152a', range:[81,90]},
    {id:9, name:'FINAL FORTRESS', icon:'🔱', accent:'#f44', dark:'#2a0000', mid:'#440000', range:[91,100]},
    // Secret 11th world — see drawWorldLockOverlay()'s cousin, the rainbow gate
    // in loadProgress(). Only reachable after finding all 10 Rainbow Shards.
    {id:10, name:'PRISM ANOMALY', icon:'🌈', accent:'#f0f', dark:'#1a0030', mid:'#300050', range:[101,110], secret:true},
    // Пролог — один уровень до начала кампании. Стоит последним в списке,
    // чтобы не сдвигать номера миров 0–10 (их держат сохранения), но в
    // стрелках показывается ПЕРВЫМ — см. cycleOrder().
    {id:11, name:'PROLOGUE', icon:'🧪', accent:'#4affa0', dark:'#02140d', mid:'#042a1a', range:[0,0], prologue:true, count:1},
  ];
  const LEVELS_PER_WORLD = 10;
  /** Узлы одного мира. Заменяет адресацию LEVELS[w*10+i]: у пролога узел один. */
  const worldLevels = (w) => LEVELS.filter((l) => l.worldId === w);
  /** Порядок миров в стрелках: пролог первым, секретный — только когда открыт. */
  function cycleOrder() {
    const rainbowDone = (typeof rainbowCount === "function") && rainbowCount() >= 10;
    const main = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const order = [11].concat(main);
    if (rainbowDone) order.push(10);
    return order;
  }

  // Localized world name (falls back to the English constant). Uses the shared
  // helper from index.html so the map matches the in-game watermark.
  function wName(world) {
    // У пролога своя строка перевода: таблица worldName рассчитана на десять
    // миров кампании и про одиннадцатый ничего не знает.
    if (world.prologue) {
      const t = window.t;
      return (typeof t === 'function' && t('prologueLab') !== 'prologueLab')
        ? t('prologueLab') : 'LAB CHEN-7';
    }
    if (typeof window.worldName === 'function') return window.worldName(world.id);
    return world.name;
  }

  // Generate 100 level nodes positioned along a winding path
  const LEVELS = [];

  // Path layout: snake through the map in a visually pleasing way
  // Each world gets 10 levels arranged in a cluster
  const worldPositions = [
    {cx: 280, cy: 720, spread: 140},  // World 0: bottom-left
    {cx: 480, cy: 620, spread: 130},  // World 1
    {cx: 700, cy: 560, spread: 135},  // World 2
    {cx: 920, cy: 480, spread: 140},  // World 3
    {cx: 1100, cy: 370, spread: 130}, // World 4
    {cx: 1000, cy: 240, spread: 135}, // World 5
    {cx: 820, cy: 170, spread: 130},  // World 6
    {cx: 620, cy: 160, spread: 135},  // World 7
    {cx: 420, cy: 240, spread: 140},  // World 8
    {cx: 280, cy: 380, spread: 150},  // World 9: final
    {cx: 700, cy: 450, spread: 140},  // World 10 (secret) — placeholder, actual on-screen layout comes from layoutLevels()
    {cx: 700, cy: 450, spread: 140},  // World 11 (пролог) — один узел, всегда в центре
  ];

  // Each world lays its 10 levels out in a DIFFERENT shape so no two worlds
  // look the same. `f` runs 0→1 across the levels; the returned local offset
  // (lx,ly in roughly [-1,1]) is scaled by the world's spread. Consecutive
  // levels stay close so the connecting road traces a coherent path.
  function layoutPoint(w, i) {
    const f = i / 9;
    let lx = 0, ly = 0;
    switch (w % 10) {
      case 0: { // Outward spiral
        const a = f * Math.PI * 2.2 - Math.PI * 0.4, r = 0.25 + f * 0.7;
        lx = Math.cos(a) * r; ly = Math.sin(a) * r;
        break;
      }
      case 1: { // Snake — zigzag rows
        const col = i % 3, row = Math.floor(i / 3);
        lx = (col - 1) * 0.72 * (row % 2 === 0 ? 1 : -1);
        ly = -0.85 + row * 0.55;
        break;
      }
      case 2: { // Rainbow arc
        const a = Math.PI * (1 - f);
        lx = Math.cos(a) * 0.95; ly = -Math.sin(a) * 0.75 + 0.25;
        break;
      }
      case 3: { // S-curve
        lx = Math.sin(f * Math.PI * 2) * 0.85;
        ly = -0.9 + f * 1.8;
        break;
      }
      case 4: { // Vertical wave climbing up
        lx = Math.sin(f * Math.PI * 3) * 0.72;
        ly = 0.9 - f * 1.8;
        break;
      }
      case 5: { // Ring / loop
        const a = f * Math.PI * 1.9 - Math.PI / 2;
        lx = Math.cos(a) * 0.9; ly = Math.sin(a) * 0.9;
        break;
      }
      case 6: { // Diagonal staircase
        lx = -0.9 + f * 1.8;
        ly = 0.75 - f * 1.5 + (i % 2 === 0 ? 0.16 : -0.16);
        break;
      }
      case 7: { // Figure-eight
        const a = f * Math.PI * 2;
        lx = Math.sin(a) * 0.9; ly = Math.sin(a * 2) * 0.5;
        break;
      }
      case 8: { // Horizontal wave
        lx = -0.9 + f * 1.8;
        ly = Math.sin(f * Math.PI * 2.5) * 0.7;
        break;
      }
      case 9: { // Inward spiral toward the center (final fortress)
        const a = f * Math.PI * 2.4, r = 1 - f * 0.82;
        lx = Math.cos(a) * r; ly = Math.sin(a) * r;
        break;
      }
    }
    // Small deterministic jitter so even similar curves feel hand-placed.
    const jx = Math.sin(w * 12.9898 + i * 78.233);
    const jy = Math.sin(w * 39.346 + i * 11.135);
    return { lx: lx + jx * 0.07, ly: ly + jy * 0.07 };
  }

  for (let w = 0; w < 11; w++) {
    const world = WORLDS[w];
    const pos = worldPositions[w];
    const [start, end] = world.range;

    for (let i = 0; i < 10; i++) {
      const levelNum = start + i;
      const isBoss = (i === 9); // Last level of each world is boss

      // World-specific shape — each world traces a distinct path.
      const lp = layoutPoint(w, i);
      const x = pos.cx + lp.lx * pos.spread;
      const y = pos.cy + lp.ly * pos.spread;

      LEVELS.push({
        id: `L${levelNum}`,
        num: levelNum,
        worldId: w,
        name: `${levelNum}${isBoss ? ' BOSS' : ''}`,
        // bx/by are the immutable base-layout coords (1400×900 reference space).
        // The on-screen x/y are recomputed from these by layoutLevels() so the
        // field can scale with resolution + Game Scale without losing the shape.
        bx: x,
        by: y,
        x: Math.round(x),
        y: Math.round(y),
        type: isBoss ? 'boss' : 'normal',
        unlocked: levelNum === 1, // Only first level unlocked initially
        completed: false,
      });
    }
  }

  // Узел пролога: номер 0, чтобы он не пересекался с кампанией (1–110) и не
  // попадал ни в один подсчёт пройденного.
  LEVELS.push({
    id: 'L0', num: 0, worldId: 11, name: '0',
    bx: 700, by: 450, x: 700, y: 450,
    type: 'prologue', unlocked: true, completed: false,
  });

  // Immutable base reference for the world-zone gradients/labels (1400×900 space).
  // `worldRender` holds the on-screen copy that layoutLevels() rewrites each time
  // the field is sized.
  const BASE_WORLD = worldPositions.map(p => ({ cx: p.cx, cy: p.cy, spread: p.spread }));
  let worldRender = BASE_WORLD.map(p => ({ ...p }));

  // Base bounds of the node layout, computed once (drives every relayout).
  let BASE_MINX = Infinity, BASE_MAXX = -Infinity, BASE_MINY = Infinity, BASE_MAXY = -Infinity;
  for (const l of LEVELS) {
    if (l.bx < BASE_MINX) BASE_MINX = l.bx; if (l.bx > BASE_MAXX) BASE_MAXX = l.bx;
    if (l.by < BASE_MINY) BASE_MINY = l.by; if (l.by > BASE_MAXY) BASE_MAXY = l.by;
  }

  // Generate paths between consecutive levels
  const PATHS = [];
  for (let i = 0; i < LEVELS.length - 1; i++) {
    // Пролог стоит особняком: дорога от него к первому уровню кампании не
    // рисуется, иначе она тянулась бы через полкарты между разными мирами.
    if (LEVELS[i].worldId !== LEVELS[i + 1].worldId) continue;
    PATHS.push([LEVELS[i].id, LEVELS[i + 1].id]);
  }

  // ═══════════════════════════════════════════════
  //  MAP STATE
  // ═══════════════════════════════════════════════

  const MAP_STATE = {
    currentLevelId: 'L1',
    activeWorld: 0,     // which world (0-9) is currently displayed — map now shows ONE world at a time
    playerX: LEVELS[0].x,
    playerY: LEVELS[0].y,
    playerMoving: false,
    playerCurve: null,
    playerT: 1,
    time: 0,
    hard: false, // Hardcore mode — drives which save slot is read and the red theme
    twoPlayer: false, // two robots walk the map in 2-player mode
    walk: null,    // active walk animation along the road (null when idle)
    walkPhase: 0,  // leg-kick phase
    faceDir: 1,    // 1 = facing right, -1 = left
  };

  // Accent colour for a world — overridden to red in Hardcore mode.
  function worldAccent(world) {
    if (MAP_STATE.hard) return '#f44';
    // Prism Anomaly is the one world that should actually read as "rainbow" on
    // the map (roads, node rings, glow) rather than a single fixed tint like
    // every other world — cycle its hue instead of returning a flat colour.
    if (world && world.secret) {
      const hue = (MAP_STATE.time * 60) % 360;
      return `hsl(${hue},95%,62%)`;
    }
    return world['accent'];
  }

  // ═══════════════════════════════════════════════
  //  CANVAS SETUP
  // ═══════════════════════════════════════════════

  let mapCanvas, mapCtx;

  let mapOverlay;
  // Live canvas dimensions (follow the window/resolution) and node-size factor.
  // mapW/mapH are LOGICAL (CSS) pixels — all drawing uses them. mapDpr is the
  // device-pixel-ratio: the canvas backing store is mapW*mapDpr so the map is
  // rendered crisp on high-DPI phones (otherwise it was drawn at the low CSS
  // resolution and stretched, which made it blurry with oversized labels —
  // looking nothing like the sharp PC version).
  let mapW = 1400, mapH = 900, nodeScale = 1, mapDpr = 1;

  const clampN = (v, a, b) => (v < a ? a : (v > b ? b : v));
  const nodeBaseR = level => (level.type === 'boss' ? 22 : 16);
  const nodeR = level => nodeBaseR(level) * nodeScale;

  // Lay out the 10 levels of the ACTIVE world in a circle ("orbit") around the
  // centre of the safe field, instead of the old scheme that crammed all 100
  // levels across 10 clusters into one screen. Levels 1..10 sit clockwise
  // starting at the top so the reading order matches the road direction; the
  // boss (level 10 of the world) lands back near the top, next to level 1,
  // which reads naturally as "the loop closes".
  function layoutLevels() {
    // HUD-safe margins: clear the top title/arrows and the bottom info panel.
    // Measured from the ACTUAL on-screen chrome (scaled by fitHud()) so nodes
    // never slip under a panel on small phones. Falls back to fixed insets
    // before the overlay/panels exist.
    let PAD_L = 60, PAD_R = 60, PAD_T = 170, PAD_B = 160;
    let ARROW_L = 0, ARROW_R = 0;   // hard floors: the world-switch buttons
    // Panels that sit on the vertical centre line, where nodes 1 (top) and 6
    // (bottom) live. Used for a final correction after the ring is sized: the
    // proportional squeeze can otherwise slide the bottom node under the level
    // panel on a very short screen.
    let centreTop = 0, centreBot = Infinity;
    // Фактические границы панелей — по ним доводим кольцо к центру экрана.
    let chromeTop = 0, chromeBot = mapH;
    let mapRects = null;
    if (mapOverlay) {
      const rectOf = sel => {
        const el = mapOverlay.querySelector(sel);
        if (!el || el.style.display === 'none') return null;
        const r = el.getBoundingClientRect();
        return (r.width && r.height) ? r : null;
      };
      mapRects = rectOf;
      let topB = 0;
      [rectOf('#mapHudTL'), rectOf('#mapAchBtn'), rectOf('#mapWorldTitle')].forEach(r => { if (r) topB = Math.max(topB, r.bottom); });
      if (topB > 0) { PAD_T = clampN(topB + 16, 90, mapH * 0.42); chromeTop = topB; }
      let botTop = mapH;
      ['#mapZoneTag', '#mapBackTouch', '#mapKbdHint', '#mapLevelPanel'].forEach(sel => {
        const r = rectOf(sel); if (r) botTop = Math.min(botTop, r.top);
      });
      if (botTop < mapH) chromeBot = botTop;
      const measuredB = botTop < mapH ? (mapH - botTop) : 0;
      PAD_B = clampN(Math.max(measuredB + 16, 150), 110, mapH * 0.46);
      // Keep clear of the left/right arrow buttons too. Their edges double as
      // the floor the squeeze below must not cross.
      const arrL = rectOf('#mapArrowLeft'), arrR = rectOf('#mapArrowRight');
      if (arrL) { ARROW_L = arrL.right + 6; PAD_L = clampN(arrL.right + 14, 60, mapW * 0.28); }
      if (arrR) { ARROW_R = (mapW - arrR.left) + 6; PAD_R = clampN((mapW - arrR.left) + 14, 60, mapW * 0.28); }
    }
    // When the chrome asks for more room than the screen has, SHRINK the
    // paddings proportionally. The previous code clamped the field to a minimum
    // size instead (`Math.max(200, …)`), which does not create space — it just
    // makes the ring bigger than the gap it has to fit into, and the nodes end
    // up under the panels or off-screen. A short landscape phone hits this on
    // every open.
    // `hardA`/`hardB` are floors the squeeze may not cross — they mark buttons
    // the ring must never sit on top of (the world arrows). Panels that only
    // display text can be encroached on; a tappable control cannot, or the node
    // and the arrow fight over the same touch.
    const squeeze = (padA, padB, total, minBand, hardA, hardB) => {
      const band = total - padA - padB;
      if (band >= minBand) return [padA, padB];
      const room = (padA - (hardA || 0)) + (padB - (hardB || 0));
      if (room <= 0) return [padA, padB];
      // Never eat more than 60% of the squeezable margin: panels stay reachable.
      const cut = Math.min(minBand - band, room * 0.6);
      return [padA - cut * ((padA - (hardA || 0)) / room),
              padB - cut * ((padB - (hardB || 0)) / room)];
    };
    [PAD_T, PAD_B] = squeeze(PAD_T, PAD_B, mapH, Math.min(170, mapH * 0.5), 0, 0);
    [PAD_L, PAD_R] = squeeze(PAD_L, PAD_R, mapW, Math.min(240, mapW * 0.6), ARROW_L, ARROW_R);

    // Кольцо ставим ровно в центр ЭКРАНА, а не в центр свободной полосы.
    // Отступы сверху и снизу (заголовок против панели уровня) и слева-справа
    // (стрелки миров) почти никогда не равны, и центр полосы оказывается
    // смещённым — на телефоне это сразу заметно как перекос. Берём больший из
    // двух отступов на обе стороны: так кольцо и стоит по центру, и по-прежнему
    // не залезает ни под одну панель. Если после выравнивания места остаётся
    // слишком мало, возвращаемся к прежнему несимметричному варианту — лучше
    // небольшой перекос, чем узлы под панелью.
    const centreBand = (padA, padB, total, minBand) => {
      const p = Math.max(padA, padB);
      return (total - 2 * p >= minBand) ? [p, p] : [padA, padB];
    };
    [PAD_T, PAD_B] = centreBand(PAD_T, PAD_B, mapH, Math.min(170, mapH * 0.5));
    [PAD_L, PAD_R] = centreBand(PAD_L, PAD_R, mapW, Math.min(240, mapW * 0.6));

    const safeX = PAD_L, safeY = PAD_T;
    const safeW = Math.max(120, mapW - PAD_L - PAD_R);
    const safeH = Math.max(90, mapH - PAD_T - PAD_B);
    // Не const: ниже кольцо ещё придвигается к центру экрана.
    let cx = safeX + safeW / 2, cy = safeY + safeH / 2;

    // Game Scale widens/narrows the ring radius.
    const gs = (window.gameSettings && window.gameSettings.gameScale) || 0;
    const factor = gs > 0 ? clampN(gs / 3, 0.45, 1) : 1.0;

    // ELLIPTICAL orbit. A circle sized by the SHORTER axis threw away the whole
    // width of a 20:9 phone in landscape: ten nodes crammed into a small ring in
    // the middle with empty space either side, every node too small to tap.
    // Using both axes spreads the ring across the space that actually exists.
    // The ratio cap keeps it reading as a ring rather than a flat slit.
    let rx = safeW / 2 * 0.86 * factor;
    let ry = safeH / 2 * 0.86 * factor;
    // How far it may stretch depends on how starved of height we are, so a
    // desktop keeps the round ring it always had (ratio 1) and only a cramped
    // screen — a phone in landscape, where safeH falls to ~150px — earns the
    // wide one. Interpolated rather than switched, so resizing a window doesn't
    // make the ring jump at a threshold.
    // Keep the ring ROUND — the same shape a PC shows. The ellipse this used to
    // stretch into filled a phone's width better, but it made the map read as a
    // different screen depending on the device, which is exactly what the
    // player objected to. A slight give (1.15) absorbs awkward aspect ratios
    // without the shape visibly changing.
    const RATIO_MAX = 1.15;
    if (rx > ry * RATIO_MAX) rx = ry * RATIO_MAX;
    if (ry > rx * RATIO_MAX) ry = rx * RATIO_MAX;

    const isTouchMap = ('ontouchstart' in window) || navigator.maxTouchPoints > 0 ||
                       (window.gameSettings && window.gameSettings.touchControls === 'on');
    // Space the nodes evenly BY ARC LENGTH, not by angle. Equal angles on an
    // ellipse bunch the nodes up at the ends of the long axis — on a phone that
    // put nodes 3-4 and 8-9 only 45px apart while the side ones sat 90px apart,
    // so they overlapped AND had to be shrunk to compensate. Even arc spacing
    // fixes both: the tightest gap becomes perimeter/10, which on the same phone
    // is 74px instead of 45 — nodes end up 1.6× bigger and evenly placed.
    // Walked numerically because an ellipse has no closed-form arc length.
    const ARC_STEPS = 720;
    const arcTable = (a, b) => {
      const cum = [0];
      let px = a * Math.cos(-Math.PI / 2), py = b * Math.sin(-Math.PI / 2);
      for (let i = 1; i <= ARC_STEPS; i++) {
        const t = -Math.PI / 2 + (i / ARC_STEPS) * Math.PI * 2;
        const x = a * Math.cos(t), y = b * Math.sin(t);
        cum.push(cum[i - 1] + Math.hypot(x - px, y - py));
        px = x; py = y;
      }
      return cum;
    };
    // Angles for the 10 nodes, first one at the top, going clockwise.
    const arcAngles = (a, b, n) => {
      const cum = arcTable(a, b), total = cum[ARC_STEPS], out = [];
      let j = 0;
      for (let k = 0; k < n; k++) {
        const want = (k / n) * total;
        while (j < ARC_STEPS && cum[j + 1] < want) j++;
        out.push(-Math.PI / 2 + (j / ARC_STEPS) * Math.PI * 2);
      }
      return out;
    };
    const minGap = (a, b) => arcTable(a, b)[ARC_STEPS] / LEVELS_PER_WORLD;
    // Node radius, then fit the ring inside the screen for THAT radius, then
    // recompute the radius for the (possibly smaller) ring. Two passes settle it.
    // The top and bottom nodes sit on the vertical centre line, so a centred
    // panel there (world title above, level panel below) would swallow them.
    // Measure only the panels that actually cross x = cx.
    if (mapRects) {
      for (const sel of ['#mapWorldTitle', '#mapHudTL', '#mapAchBtn']) {
        const r = mapRects(sel);
        if (r && r.left - 4 < cx && r.right + 4 > cx) centreTop = Math.max(centreTop, r.bottom);
      }
      for (const sel of ['#mapLevelPanel', '#mapZoneTag', '#mapBackTouch', '#mapKbdHint']) {
        const r = mapRects(sel);
        if (r && r.left - 4 < cx && r.right + 4 > cx) centreBot = Math.min(centreBot, r.top);
      }
    }
    // Size the nodes, shrink the ring to fit them, then re-size the nodes for
    // the smaller ring. Three passes settle it. Every constraint lives INSIDE
    // the loop: applying one of them afterwards (as the panel correction used to
    // be) leaves the other axis stale — that is how a 640×300 screen ended up
    // with a 142×36 ring, far past the ratio cap, and overlapping nodes again.
    let rTarget = 16;
    for (let pass = 0; pass < 3; pass++) {
      // The worst pair is the boss (22/16 = 1.375× a normal node) next to a
      // normal one, so their radii sum to 2.375 × rTarget. Leave ~8% of the gap
      // as breathing room: rTarget ≤ gap × 0.92 / 2.375.
      const rSafe = minGap(rx, ry) * 0.387;
      // Touch wants a bigger node, but never big enough to overlap: the floor
      // yields to rSafe rather than overriding it.
      rTarget = clampN(rSafe, Math.min(isTouchMap ? 15 : 10, rSafe), 34);
      // Hard guarantee: no node may leave the canvas, whatever the paddings did.
      rx = Math.min(rx, Math.max(36, Math.min(cx, mapW - cx) - rTarget - 6));
      ry = Math.min(ry, Math.max(28, Math.min(cy, mapH - cy) - rTarget - 6));
      // …and none may hide under a centred panel.
      const upRoom = cy - centreTop - rTarget - 4;
      const dnRoom = (centreBot === Infinity ? mapH : centreBot) - cy - rTarget - 4;
      ry = Math.min(ry, Math.max(28, Math.min(upRoom, dnRoom)));
      // Re-apply the ratio cap: the two clamps above only ever shrink one axis,
      // so without this the ring degenerates into a flat slit.
      if (rx > ry * RATIO_MAX) rx = ry * RATIO_MAX;
    }
    nodeScale = rTarget / 16; // 16 = base normal-node radius

    // ── Доводка до центра экрана ────────────────────────────────────────
    // Выше кольцо ставилось в середину СВОБОДНОЙ ПОЛОСЫ между панелями. Но
    // сверху и снизу их высота разная (заголовок мира выше, чем нижняя
    // панель), и центр полосы не совпадает с центром экрана: на портретном
    // телефоне кольцо уезжало вниз почти на сотню пикселей.
    //
    // Само кольцо при этом обычно заметно меньше доступного места — его
    // ограничивают стрелки миров по бокам. Значит, его можно просто придвинуть
    // к центру экрана: настолько, насколько позволяют панели, и ни пикселем
    // больше. Если места нет вовсе, останется как было.
    const pull = (c, r, total, padA, padB) => {
      const half = r + rTarget + 4;          // радиус кольца плюс сам узел
      const lo = padA + half, hi = total - padB - half;
      if (hi < lo) return c;                 // места нет — не трогаем
      return clampN(total / 2, lo, hi);
    };
    cx = pull(cx, rx, mapW, PAD_L, PAD_R);
    cy = pull(cy, ry, mapH, Math.max(PAD_T, chromeTop + 6), Math.max(PAD_B, mapH - chromeBot + 6));

    const w = MAP_STATE.activeWorld;
    const ring = worldLevels(w);
    // Мир из одного узла (пролог) кольцом не раскладывается — ставим в центр.
    if (ring.length === 1) {
      ring[0].x = Math.round(cx); ring[0].y = Math.round(cy);
      ring[0].r = Math.round(nodeR * 1.35);
      return;
    }
    const angles = arcAngles(rx, ry, ring.length);
    for (let i = 0; i < ring.length; i++) {
      const level = ring[i];
      // Start at the top and go clockwise, evenly spaced along the ring.
      const a = angles[i];
      level.x = Math.round(cx + Math.cos(a) * rx);
      level.y = Math.round(cy + Math.sin(a) * ry);
    }
    worldRender[w].cx = cx; worldRender[w].cy = cy;
    worldRender[w].spread = rx; worldRender[w].spreadY = ry;

    // Keep the idle robot on its current node after a relayout/resize.
    const cur = LEVELS.find(l => l.id === MAP_STATE.currentLevelId);
    if (cur && cur.worldId === w && !MAP_STATE.walk) { MAP_STATE.playerX = cur.x; MAP_STATE.playerY = cur.y; }
  }

  function createMapCanvas() {
    mapCanvas = document.createElement('canvas');
    mapCanvas.id = 'worldMapCanvas';
    mapCanvas.width = mapW;
    mapCanvas.height = mapH;
    mapCanvas.style.cssText = `
      display: block;
      image-rendering: auto;
      cursor: pointer;
    `;
    mapCtx = mapCanvas.getContext('2d');
  }

  function createMapOverlay() {
    mapOverlay = document.createElement('div');
    mapOverlay.id = 'mapOverlay';
    mapOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(4, 4, 15, 0.98);
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 3000;
    `;

    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
      position: relative;
      display: inline-block;
    `;

    // HUD overlay. Each corner panel is independently anchored so fitHud() can
    // scale it toward its own corner on small screens (no overlap on phones).
    const hud = document.createElement('div');
    // This wrapper exists only to hold the fixed-position corner panels; it must
    // not be a layout box of its own. Left as a default block it took part in
    // layout and was measured 133px past the right edge of a 375px screen.
    hud.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:hidden';
    hud.innerHTML = `
      <div id="mapHudTL" style="position: fixed; top: calc(10px + env(safe-area-inset-top, 0px)); left: calc(10px + env(safe-area-inset-left, 0px)); transform-origin: top left; pointer-events: none; z-index: 10; background: rgba(0,0,0,0.8); border: 1px solid #0ff; padding: 8px 14px; backdrop-filter: blur(4px);">
        <div id="worldMapTitle" style="font-family: 'Press Start 2P', monospace; font-size: calc(12px * var(--bbText, 1)); color: #0ff; text-shadow: 0 0 10px #0ff; letter-spacing: 2px;">⚡ BYTE BLASTER</div>
        <div id="worldMapSub" style="font-family: 'Share Tech Mono', monospace; font-size: calc(8px * var(--bbText, 1)); color: #0f0; letter-spacing: 2px; margin-top: 3px;">▸ <span data-i18n="mapWorldMap">WORLD MAP</span></div>
        <div style="font-family: 'Share Tech Mono', monospace; font-size: calc(10px * var(--bbText, 1)); color: #0ff; letter-spacing: 1px; margin-top: 8px; padding-top: 6px; border-top: 1px solid #0ff3;"><span data-i18n="mapCleared">CLEARED</span>: <span id="mapClearedCount">0</span> / <span id="mapClearedMax">100</span></div>
        <div style="font-family: 'Share Tech Mono', monospace; font-size: calc(10px * var(--bbText, 1)); color: #ffd23f; letter-spacing: 1px; margin-top: 4px;">★ <span data-i18n="mapStars">STARS</span>: <span id="mapStarsCount">0</span> / <span id="mapStarsMax">300</span></div>
        <div style="font-family: 'Share Tech Mono', monospace; font-size: calc(10px * var(--bbText, 1)); color: #0ff; letter-spacing: 1px; margin-top: 4px;">◆ <span data-i18n="mapCrystals">CRYSTALS</span>: <span id="mapShardsCount">0</span> / <span id="mapShardsMax">300</span></div>
        <div style="font-family: 'Share Tech Mono', monospace; font-size: calc(10px * var(--bbText, 1)); color: #ffcc33; letter-spacing: 1px; margin-top: 4px;">◉ <span data-i18n="mapCoins">COINS</span>: <span id="mapCoinsCount">0</span></div>
        <div style="font-family: 'Share Tech Mono', monospace; font-size: calc(10px * var(--bbText, 1)); color: #f0f; letter-spacing: 1px; margin-top: 4px;">🌈 <span data-i18n="mapRainbow">RAINBOW</span>: <span id="mapRainbowCount">0</span> / 10</div>
        <div style="font-family: 'Share Tech Mono', monospace; font-size: calc(10px * var(--bbText, 1)); color: #8cf; letter-spacing: 1px; margin-top: 4px;">∑ <span data-i18n="score">SCORE</span>: <span id="mapTotalScore">0</span></div>
        <div id="mapCurrentZone" style="font-family: 'Share Tech Mono', monospace; font-size: calc(9px * var(--bbText, 1)); color: #666; letter-spacing: 2px; margin-top: 2px;">CYBER CITY</div>
      </div>
      <div id="mapWorldTitle" style="position: fixed; top: calc(10px + env(safe-area-inset-top, 0px)); left: 50%; transform: translateX(-50%); transform-origin: top center; z-index: 10; pointer-events: none; text-align: center;">
        <div id="mapWorldTitleNum" style="font-family: 'Press Start 2P', monospace; font-size: calc(20px * var(--bbText, 1)); letter-spacing: 3px; color: #0ff; text-shadow: 0 0 14px #0ff;">WORLD 1</div>
        <div id="mapWorldTitleName" style="font-family: 'Share Tech Mono', monospace; font-size: calc(12px * var(--bbText, 1)); letter-spacing: 4px; color: #8cf; margin-top: 4px;">CYBER CITY</div>
        <div id="mapWorldShard" style="font-family: 'Press Start 2P', monospace; font-size: calc(9px * var(--bbText, 1)); letter-spacing: 2px; margin-top: 7px; color: #666;">🌈 ✗</div>
      </div>
      <button id="mapArrowLeft" aria-label="Previous world" style="position: fixed; top: 50%; left: calc(10px + env(safe-area-inset-left, 0px)); transform: translateY(-50%); transform-origin: center left; z-index: 10; pointer-events: auto; background: rgba(0,0,0,0.72); border: 2px solid #0ff; color: #0ff; width: 54px; height: 64px; font-size: calc(26px * var(--bbText, 1)); cursor: pointer; text-shadow: 0 0 8px #0ff;">◀</button>
      <button id="mapArrowRight" aria-label="Next world" style="position: fixed; top: 50%; right: calc(10px + env(safe-area-inset-right, 0px)); transform: translateY(-50%); transform-origin: center right; z-index: 10; pointer-events: auto; background: rgba(0,0,0,0.72); border: 2px solid #0ff; color: #0ff; width: 54px; height: 64px; font-size: calc(26px * var(--bbText, 1)); cursor: pointer; text-shadow: 0 0 8px #0ff;">▶</button>
      <button id="mapAchBtn" data-i18n="profileBtn" style="position: fixed; top: calc(10px + env(safe-area-inset-top, 0px)); right: calc(10px + env(safe-area-inset-right, 0px)); transform-origin: top right; z-index: 10; pointer-events: auto; background: rgba(0,0,0,0.8); border: 1px solid #0ff; color: #0ff; padding: 8px 14px; font-family: 'Press Start 2P', monospace; font-size: calc(9px * var(--bbText, 1)); letter-spacing: 1px; cursor: pointer; text-shadow: 0 0 8px #0ff;">👤 PROFILE</button>
      <button id="mapBackTouch" data-i18n="back" style="position: fixed; bottom: calc(10px + env(safe-area-inset-bottom, 0px)); right: calc(10px + env(safe-area-inset-right, 0px)); transform-origin: bottom right; z-index: 12; display: none; pointer-events: auto; background: rgba(0,0,0,0.85); border: 1px solid #f44; color: #f88; padding: 12px 16px; font-family: 'Press Start 2P', monospace; font-size: calc(9px * var(--bbText, 1)); letter-spacing: 1px; cursor: pointer;">← BACK</button>
      <div id="mapZoneTag" style="position: fixed; bottom: calc(10px + env(safe-area-inset-bottom, 0px)); left: calc(10px + env(safe-area-inset-left, 0px)); transform-origin: bottom left; z-index: 10; pointer-events: none; font-family: 'Share Tech Mono', monospace; font-size: calc(9px * var(--bbText, 1)); letter-spacing: 3px; padding: 7px 12px; background: rgba(0,0,0,0.6); border-left: 3px solid #0ff; color: #0ff;">CYBER CITY</div>
      <div id="mapKbdHint" style="position: fixed; bottom: 10px; right: 10px; transform-origin: bottom right; z-index: 10; background: rgba(0,0,0,0.55); border: 1px solid #1a1a1a; padding: 7px 12px; font-family: 'Share Tech Mono', monospace; font-size: calc(8px * var(--bbText, 1)); color: #383838; line-height: 1.8; text-align: right; pointer-events: none;">
        ↑↓←→ / WASD — MOVE<br>
        ENTER / SPACE — START<br>
        ESC — BACK TO MENU
      </div>
      <div id="mapLevelPanel" style="position: fixed; bottom: calc(72px + env(safe-area-inset-bottom, 0px)); left: 50%; transform: translateX(-50%); transform-origin: bottom center; background: rgba(0,0,0,0.92); border: 2px solid #0ff; padding: 11px 28px; text-align: center; min-width: 310px; display: none; z-index: 11;">
        <div id="mapLevelName" style="font-family: 'Press Start 2P', monospace; font-size: calc(12px * var(--bbText, 1)); font-weight: bold; letter-spacing: 2px; margin-bottom: 2px; color: #0ff;">LEVEL 1</div>
        <div id="mapLevelSub" style="font-family: 'Share Tech Mono', monospace; font-size: calc(8px * var(--bbText, 1)); color: #555; letter-spacing: 2px; margin-bottom: 6px;">CYBER CITY</div>
        <div id="mapLevelScore" style="font-family: 'Share Tech Mono', monospace; font-size: calc(9px * var(--bbText, 1)); color: #ffd23f; letter-spacing: 1px; margin-bottom: 7px; display: none;"></div>
        <div id="mapLevelAction" style="font-family: 'Share Tech Mono', monospace; font-size: calc(9px * var(--bbText, 1)); letter-spacing: 1px;"></div>
      </div>
    `;

    wrapper.appendChild(mapCanvas);
    wrapper.appendChild(hud);
    mapOverlay.appendChild(wrapper);
    document.body.appendChild(mapOverlay);

    // Achievements button (top-right of the map). The Achievements overlay sits
    // above the map and its close simply reveals the map again.
    const achBtn = mapOverlay.querySelector('#mapAchBtn');
    if (achBtn) {
      achBtn.onclick = () => {
        if (window.SFX && window.SFX.menu) window.SFX.menu();
        // Achievements are one tab of the profile now, not their own screen.
        if (window.Profile && window.Profile.show) window.Profile.show('overview');
        else if (window.Achievements && window.Achievements.showMenu) window.Achievements.showMenu();
      };
      achBtn.onmouseenter = () => { achBtn.style.boxShadow = '0 0 14px #0ff'; achBtn.style.transform = 'scale(1.04)'; };
      achBtn.onmouseleave = () => { achBtn.style.boxShadow = 'none'; achBtn.style.transform = 'scale(1)'; };
    }
    // Touch-only BACK button (no ESC key on phones) — returns to the previous
    // screen (the difficulty select). It must route through the game's doEsc()
    // so navScr is updated and that screen is actually shown; calling only
    // hideWorldMap() left navScr stuck on 'map' and showed a blank screen.
    const backTouch = mapOverlay.querySelector('#mapBackTouch');
    if (backTouch) {
      backTouch.onclick = () => {
        hideWorldMap();
        if (typeof window.doEsc === 'function') window.doEsc(); // plays SFX + navigates map→diff
        else if (window.SFX && window.SFX.back) window.SFX.back();
      };
    }
    // World-switch arrows — browse any of the 10 worlds (locked ones show
    // greyed/locked level nodes, matching the existing per-level lock visuals).
    const arrL = mapOverlay.querySelector('#mapArrowLeft');
    const arrR = mapOverlay.querySelector('#mapArrowRight');
    if (arrL) arrL.onclick = () => setActiveWorld(MAP_STATE.activeWorld - 1);
    if (arrR) arrR.onclick = () => setActiveWorld(MAP_STATE.activeWorld + 1);
    // Translate the freshly-built HUD (the achievements label uses data-i18n).
    if (typeof window.applyI18nDOM === 'function') window.applyI18nDOM();

    // Resize canvas to fit window
    resizeMapCanvas();
    window.addEventListener('resize', resizeMapCanvas);
  }

  function resizeMapCanvas() {
    // Fill the window in LOGICAL (CSS) pixels — the layout math below works in
    // this space, identical on PC and phone, so the map looks the same on both.
    //
    // These floors used to be 640×480, and that was THE reason the map looked
    // broken on a real phone but fine in an emulator. A 2400×1080 phone at
    // dpr 2.75 reports a CSS viewport of 873×393 — shorter than the 480 floor —
    // so the canvas was built 873×480, the overlay centred it, and it hung 43px
    // off the top and 44px off the bottom. Every node position was then computed
    // for a height that does not exist on screen, which is exactly the "levels
    // slide off the map" report. An emulator at dpr 1 reports 2400×1080, clears
    // the floor, and shows nothing wrong. The canvas must match the viewport.
    mapW = Math.max(240, window.innerWidth);
    mapH = Math.max(160, window.innerHeight);
    // High-DPI: render the backing store at device resolution and scale the
    // context back to CSS pixels. This is THE fix for the phone map looking
    // blurry/zoomed (oversized labels) vs the crisp PC map — on a 2.5–3× phone
    // the canvas was previously drawn at ~960px and stretched across the screen.
    // Cap by the active graphics tier as well: a phone that had to drop to a
    // low tier for the game itself gains nothing from a 3× map backing store
    // (2401x1081 = 2.6M pixels measured on a 20:9 phone). Text stays crisp
    // because the cap never goes below 1.5×.
    const tierCap = (window.gameSettings && window.gameSettings.gfx &&
                     window.gameSettings.gfx.renderScale) || 3;
    mapDpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), Math.max(1.5, tierCap));
    mapCanvas.width = Math.round(mapW * mapDpr);
    mapCanvas.height = Math.round(mapH * mapDpr);
    mapCanvas.style.width = mapW + 'px';
    mapCanvas.style.height = mapH + 'px';
    // Setting canvas.width resets the transform, so (re)apply the DPR scale here.
    mapCtx.setTransform(mapDpr, 0, 0, mapDpr, 0, 0);
    // fitHud() scales the corner panels, then re-lays the level nodes using the
    // panels' measured sizes (so nothing overlaps). It owns layoutLevels() now.
    fitHud();
  }

  // Scale the corner HUD panels down on small screens so they never overlap or
  // spill off-screen. Each panel scales toward its own corner (transform-origin
  // set in the markup). The keyboard-hint panel is hidden on touch devices.
  function fitHud() {
    if (!mapOverlay) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0 ||
                    (window.gameSettings && window.gameSettings.touchControls === 'on');
    const kbd = mapOverlay.querySelector('#mapKbdHint');
    if (kbd) kbd.style.display = isTouch ? 'none' : '';
    // The touch BACK button replaces the (hidden) keyboard hint on touch devices.
    const backTouch = mapOverlay.querySelector('#mapBackTouch');
    if (backTouch) backTouch.style.display = isTouch ? '' : 'none';

    // On phones the ACHIEVEMENTS + BACK buttons were shrunk together with the
    // info panels down to ~3px (invisible/untappable). Give them a bigger base
    // size on touch so that — even after scaling — they stay readable and meet
    // a comfortable touch-target size. Reset to the desktop size otherwise.
    // Размер пишем через тот же множитель --bbText, что и вся остальная
    // разметка: голое «13px» перебивало настройку размера текста, и эти две
    // кнопки оставались мелкими, когда всё вокруг увеличилось.
    const touchFS = 'calc(13px * var(--bbText, 1))';
    const achEl0 = mapOverlay.querySelector('#mapAchBtn');
    if (achEl0)    { achEl0.style.fontSize  = isTouch ? touchFS : ''; achEl0.style.padding = isTouch ? '12px 16px' : ''; }
    if (backTouch) { backTouch.style.fontSize = isTouch ? touchFS : ''; backTouch.style.padding = isTouch ? '14px 20px' : ''; }

    // One master scale `k` (≤1) shared by every panel so the chrome stays
    // proportional AND leaves the node field enough room. Constraints folded in:
    //  • each corner panel ≤44% width / 40% height
    //  • top-left stats + top-right ACHIEVEMENTS fit side by side (no cover-up)
    //  • the centred level panel ≤90% width
    //  • VERTICAL STACK: stats (top) + level panel (bottom) must leave the node
    //    field ≥~42% of the height — the key fix for short landscape phones where
    //    the tall stats panel + level panel otherwise eat the whole screen and
    //    push nodes underneath them.
    const panels = ['#mapHudTL', '#mapAchBtn', '#mapZoneTag', '#mapKbdHint', '#mapBackTouch']
      .map(s => mapOverlay.querySelector(s))
      .filter(el => el && el.style.display !== 'none');
    const lvl = mapOverlay.querySelector('#mapLevelPanel');
    if (lvl) lvl.style.transform = 'translateX(-50%)';   // measure natural (no scale)

    let k = 1;
    panels.forEach(el => {
      el.style.transform = '';            // measure at natural size
      const w = el.offsetWidth, h = el.offsetHeight;
      if (!w || !h) return;
      k = Math.min(k, (vw * 0.44) / w, (vh * 0.40) / h);
    });
    const tlEl = mapOverlay.querySelector('#mapHudTL');
    const achEl = mapOverlay.querySelector('#mapAchBtn');
    if (tlEl && achEl) {
      const need = tlEl.offsetWidth + achEl.offsetWidth;        // natural widths
      if (need > 0) k = Math.min(k, (vw * 0.94) / need);
    }
    const lvlW = lvl ? lvl.offsetWidth : 0, lvlH = lvl ? lvl.offsetHeight : 0;
    if (lvlW > 0) k = Math.min(k, (vw * 0.90) / lvlW);
    // Vertical stack constraint (the landscape fix). On touch we reserve a bit
    // less height for the node field so the chrome can stay a readable size.
    const stackH = (tlEl ? tlEl.offsetHeight : 0) + lvlH;
    const minBand = clampN(vh * (isTouch ? 0.34 : 0.42), isTouch ? 150 : 210, 340);
    if (stackH > 0) k = Math.min(k, (vh - minBand - 98) / stackH);

    // Floor: keep the chrome readable. Higher on touch so the info panels never
    // collapse to an illegible smear like they did before.
    k = Math.max(isTouch ? 0.5 : 0.34, k);
    // ...but FITTING ON SCREEN outranks readability. On a 375px phone the floor
    // held the top-left panel at a size 133px wider than the screen, so the
    // title ran off the right edge entirely. Re-apply the hard width/height
    // limits after the floor: a small panel beats an invisible one.
    const hardW = tlEl && tlEl.offsetWidth ? (vw * 0.96) / tlEl.offsetWidth : 1;
    const hardH = tlEl && tlEl.offsetHeight ? (vh * 0.52) / tlEl.offsetHeight : 1;
    k = Math.min(k, hardW, hardH, 1);
    panels.forEach(el => { el.style.transform = k < 1 ? 'scale(' + k + ')' : ''; });
    if (lvl) lvl.style.transform = 'translateX(-50%)' + (k < 1 ? ' scale(' + k + ')' : '');
    // The two control buttons (ACHIEVEMENTS, BACK) get their own gentler floor so
    // they always stay big enough to read and tap, independent of how much the
    // info panels had to shrink. They sit in their own corners, so enlarging them
    // can't cover the stats panel.
    const kBtn = Math.min(1, Math.max(k, isTouch ? 0.85 : 0.34));
    [achEl0, backTouch].forEach(el => {
      if (el && el.style.display !== 'none') el.style.transform = kBtn < 1 ? 'scale(' + kBtn + ')' : '';
    });

    // The centre world title sits between the stats panel (top-left) and the
    // profile button (top-right). On a narrow screen those three claim more
    // width than exists and the title ends up printed straight through both —
    // see the 375px capture. When they would collide, drop the title below the
    // side panels instead of overlapping them.
    const titleEl = mapOverlay.querySelector('#mapWorldTitle');
    if (titleEl) {
      const tlR = tlEl ? tlEl.getBoundingClientRect() : null;
      const acR = achEl0 ? achEl0.getBoundingClientRect() : null;
      titleEl.style.top = '';
      const tR = titleEl.getBoundingClientRect();
      const hits = (r) => r && !(tR.right < r.left - 6 || tR.left > r.right + 6) &&
                          !(tR.bottom < r.top || tR.top > r.bottom);
      if (hits(tlR) || hits(acR)) {
        const below = Math.max(tlR ? tlR.bottom : 0, acR ? acR.bottom : 0);
        titleEl.style.top = (below + 8) + 'px';
      }
    }

    // Panels are now sized for this screen — re-lay the level nodes so they keep
    // clear of the (possibly scaled) chrome. Done here so every fitHud() caller,
    // including the post-open settle timers, gets a correct field.
    layoutLevels();
  }

  // ═══════════════════════════════════════════════
  //  DRAWING FUNCTIONS
  // ═══════════════════════════════════════════════

  // Per-world map backdrop. "Space" (the original look — orbit motes, starfield,
  // nebula) is kept as an alternate style via Settings → World Map Environment;
  // by default each world now gets its own themed sky + ground silhouette +
  // weather particles so Neon Jungle doesn't look like a space station.
  const WORLD_ENV = [
    { sky:['#001a2a','#04304a','#0a4a5a'], ground:'skyline', weather:'spark',  weatherCol:'#0ff' }, // Cyber City
    { sky:['#001a0a','#0a3315','#145522'], ground:'vines',   weather:'leaf',   weatherCol:'#7f8' }, // Neon Jungle
    { sky:['#1a0400','#441100','#7a2200'], ground:'rocks',   weather:'ember',  weatherCol:'#f80' }, // Lava World
    { sky:['#001028','#002a55','#0a4a7a'], ground:'icicles', weather:'snow',   weatherCol:'#cff' }, // Ice Caves
    { sky:['#1a1000','#442800','#6a3f0a'], ground:'dunes',   weather:'sand',   weatherCol:'#eb8' }, // Desert Ruins
    { sky:['#050014','#1a0033','#2a0055'], ground:'none',    weather:'star',   weatherCol:'#fff' }, // Space Station
    { sky:['#000c04','#001a0a','#0a2a12'], ground:'trees',   weather:'spore',  weatherCol:'#4f8' }, // Dark Forest
    { sky:['#0a1200','#1a2200','#2a3300'], ground:'pipes',   weather:'bubble', weatherCol:'#cf0' }, // Toxic Zone
    { sky:['#050510','#0a0a1a','#15152a'], ground:'clouds',  weather:'bolt',   weatherCol:'#88f' }, // Storm Peaks
    { sky:['#140000','#2a0000','#440000'], ground:'walls',   weather:'rune',   weatherCol:'#f44' }, // Final Fortress
    { sky:['#1a0030','#300050','#500070'], ground:'rift',    weather:'prism',  weatherCol:'#f0f' }, // Prism Anomaly (secret)
    { sky:['#02100a','#052a1a','#0a4a30'], ground:'pipes',   weather:'spark',  weatherCol:'#4affa0' }, // Пролог — лаборатория CHEN-7
  ];

  function _mapEnvMode(){
    return (window.gameSettings && window.gameSettings.mapEnvironment === 'space') ? 'space' : 'themed';
  }

  function drawBackground() {
    if (_mapEnvMode() === 'space') _drawSpaceBackground();
    else _drawThemedBackground();
  }

  // ── Themed mode: unique sky + horizon silhouette + weather per world ───────
  function _drawThemedBackground() {
    const ctx = mapCtx;
    const W = mapW, H = mapH, t = MAP_STATE.time;
    const world = WORLDS[MAP_STATE.activeWorld];
    const env = WORLD_ENV[MAP_STATE.activeWorld];

    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, env.sky[0]);
    sky.addColorStop(0.55, env.sky[1]);
    sky.addColorStop(1, env.sky[2]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Soft accent-tinted glow washes — keeps some atmospheric depth without
    // committing to the "space nebula" look specifically.
    const NEB = [{ x:0.2, y:0.25, r:0.28 }, { x:0.8, y:0.2, r:0.26 }, { x:0.5, y:0.9, r:0.36 }];
    ctx.save();
    for (let i = 0; i < NEB.length; i++) {
      const n = NEB[i], cx = n.x*W, cy = n.y*H, rr = n.r*Math.min(W,H)*(1+Math.sin(t*0.2+i)*0.05);
      const g = ctx.createRadialGradient(cx,cy,0,cx,cy,rr);
      g.addColorStop(0, world.mid); g.addColorStop(1, 'transparent');
      ctx.globalAlpha = 0.18; ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx,cy,rr,0,Math.PI*2); ctx.fill();
    }
    ctx.restore();

    _drawEnvGround(ctx, env.ground, world, W, H, t);
    _drawEnvWeather(ctx, env.weather, env.weatherCol, W, H, t);
  }

  // Horizon silhouette along the lower part of the screen — gives each world a
  // distinct sense of place at a glance, drawn cheaply (a handful of shapes).
  function _drawEnvGround(ctx, type, world, W, H, t) {
    const GY = H * 0.86; // horizon line
    ctx.save();
    switch (type) {
      case 'skyline': { // Cyber City — neon building silhouettes
        for (let i = 0; i < 9; i++) {
          const bw = 40 + (i*53)%50, bh = 60 + (i*97)%140;
          const bx = (i * (W/9)) + (i*23)%20;
          ctx.globalAlpha = 0.85; ctx.fillStyle = '#010a14';
          ctx.fillRect(bx, GY-bh, bw, bh+H*0.14);
          // lit windows
          for (let wy = GY-bh+8; wy < GY-10; wy += 14) {
            for (let wx = bx+6; wx < bx+bw-6; wx += 12) {
              if ((Math.floor(wx+wy+i)) % 4 !== 0) continue;
              ctx.globalAlpha = 0.5 + Math.sin(t*0.8+wx*0.1)*0.2;
              ctx.fillStyle = world.accent;
              ctx.fillRect(wx, wy, 4, 5);
            }
          }
        }
        break;
      }
      case 'vines': { // Neon Jungle — hanging canopy + undergrowth
        ctx.globalAlpha = 0.8; ctx.fillStyle = '#03170a';
        ctx.fillRect(0, GY, W, H-GY);
        for (let i = 0; i < 14; i++) {
          const x = (i*97)%W, len = 30+(i*53)%70;
          ctx.strokeStyle = '#0a4a1a'; ctx.lineWidth = 5; ctx.globalAlpha = 0.7;
          ctx.beginPath(); ctx.moveTo(x,0); ctx.quadraticCurveTo(x+Math.sin(t*0.5+i)*10, len/2, x, len); ctx.stroke();
          ctx.fillStyle = world.accent; ctx.globalAlpha = 0.35;
          ctx.beginPath(); ctx.arc(x, len, 6, 0, Math.PI*2); ctx.fill();
        }
        break;
      }
      case 'rocks': { // Lava World — volcanic peaks with glowing cracks
        ctx.beginPath(); ctx.moveTo(0,H);
        for (let x = 0; x <= W; x += W/10) { ctx.lineTo(x, GY - (Math.sin(x*0.01+2)*40+40)); }
        ctx.lineTo(W,H); ctx.closePath();
        ctx.fillStyle = '#150400'; ctx.globalAlpha = 0.9; ctx.fill();
        for (let i = 0; i < 6; i++) {
          const x = (i*167)%W, glow = 0.5+Math.sin(t*1.2+i)*0.4;
          ctx.strokeStyle = '#ff6600'; ctx.lineWidth = 2; ctx.globalAlpha = Math.max(0.15,glow);
          ctx.beginPath(); ctx.moveTo(x, H); ctx.lineTo(x+10, GY+10); ctx.lineTo(x-6, GY-6); ctx.stroke();
        }
        break;
      }
      case 'icicles': { // Ice Caves — stalactites/stalagmites frame
        ctx.fillStyle = '#dff'; ctx.globalAlpha = 0.22;
        for (let i = 0; i < 10; i++) {
          const x = (i*(W/10)), w = 24+(i*17)%20, len = 20+(i*31)%50;
          ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x+w,0); ctx.lineTo(x+w/2,len); ctx.closePath(); ctx.fill();
          ctx.beginPath(); ctx.moveTo(x,H); ctx.lineTo(x+w,H); ctx.lineTo(x+w/2,H-len*0.8); ctx.closePath(); ctx.fill();
        }
        break;
      }
      case 'dunes': { // Desert Ruins — layered sand dunes
        const layers = [{c:'#3a2408', y:0.72},{c:'#2a1a04', y:0.82},{c:'#1a1002', y:0.94}];
        for (const L of layers) {
          ctx.beginPath(); ctx.moveTo(0,H);
          for (let x = 0; x <= W; x += 8) ctx.lineTo(x, H*L.y + Math.sin(x*0.006+L.y*10)*18);
          ctx.lineTo(W,H); ctx.closePath();
          ctx.globalAlpha = 0.85; ctx.fillStyle = L.c; ctx.fill();
        }
        break;
      }
      case 'trees': { // Dark Forest — trunk silhouettes
        ctx.globalAlpha = 0.85; ctx.fillStyle = '#010601';
        for (let i = 0; i < 12; i++) {
          const x = (i*83)%W, tw = 8+(i*13)%10, th = 90+(i*37)%110;
          ctx.fillRect(x, GY-th, tw, th+H*0.14);
          ctx.beginPath(); ctx.ellipse(x+tw/2, GY-th, tw*2.4, tw*3, 0, 0, Math.PI*2); ctx.fill();
        }
        break;
      }
      case 'pipes': { // Toxic Zone — industrial pipe/tank silhouettes
        ctx.globalAlpha = 0.85; ctx.fillStyle = '#141a02';
        for (let i = 0; i < 8; i++) {
          const x = (i*(W/8))+10, w = 20+(i*11)%14, h = 70+(i*29)%90;
          ctx.fillRect(x, GY-h, w, h+H*0.14);
          ctx.fillStyle = world.accent; ctx.globalAlpha = 0.4+Math.sin(t+i)*0.2;
          ctx.beginPath(); ctx.arc(x+w/2, GY-h+10, 4, 0, Math.PI*2); ctx.fill();
          ctx.fillStyle = '#141a02'; ctx.globalAlpha = 0.85;
        }
        break;
      }
      case 'clouds': { // Storm Peaks — puffy storm clouds
        ctx.fillStyle = '#1a1a2a'; ctx.globalAlpha = 0.6;
        for (let i = 0; i < 6; i++) {
          const cx = (i*(W/6))+((t*6+i*40)%W*0)+30, cy = H*0.18+(i%2)*30;
          for (let k = 0; k < 4; k++) ctx.beginPath(), ctx.arc(cx+k*22, cy+Math.sin(k)*8, 22, 0, Math.PI*2), ctx.fill();
        }
        break;
      }
      case 'walls': { // Final Fortress — dark blocky ramparts
        ctx.globalAlpha = 0.9; ctx.fillStyle = '#0a0000';
        ctx.fillRect(0, GY, W, H-GY);
        for (let x = 0; x < W; x += 44) ctx.fillRect(x, GY-24, 26, 24);
        ctx.strokeStyle = world.accent; ctx.globalAlpha = 0.25; ctx.lineWidth = 1;
        for (let x = 0; x < W; x += 44) ctx.strokeRect(x+2, GY+2, 40, H-GY-4);
        break;
      }
      case 'rift': { // Prism Anomaly — a jagged rainbow crack tearing through the ground
        ctx.globalAlpha = 0.85; ctx.fillStyle = '#0a0014';
        ctx.fillRect(0, GY, W, H-GY);
        const midY = GY + (H-GY)*0.4;
        ctx.beginPath(); ctx.moveTo(0, midY);
        for (let x = 0; x <= W; x += 24) ctx.lineTo(x, midY + Math.sin(x*0.05+t)*10);
        ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
        const g = ctx.createLinearGradient(0, midY, 0, H);
        g.addColorStop(0, '#ff00ff'); g.addColorStop(0.5, '#00ffff'); g.addColorStop(1, '#1a0030');
        ctx.globalAlpha = 0.35; ctx.fillStyle = g; ctx.fill();
        // Floating glitch fragments along the rift
        for (let i = 0; i < 8; i++) {
          const x = (i*(W/8))+((Math.sin(t*0.7+i)*10)), y = midY-10+Math.sin(t*1.3+i)*14;
          ctx.globalAlpha = 0.5+Math.sin(t*2+i)*0.3;
          ctx.fillStyle = `hsl(${(i*45+t*30)%360},100%,65%)`;
          ctx.fillRect(x-4,y-4,8,8);
        }
        break;
      }
      case 'none': default: break; // Space Station — clean starfield, no ground
    }
    ctx.restore();
  }

  // Ambient weather/atmosphere particles — the "living air" layer on top of the
  // ground silhouette. Deterministic positions (index-based), animated by time.
  function _drawEnvWeather(ctx, type, col, W, H, t) {
    if (type === 'none') return;
    const n = Math.min(70, Math.round((W*H)/9000));
    ctx.save();
    ctx.fillStyle = col;
    for (let i = 0; i < n; i++) {
      let x, y, a = 0.5, sz = 2;
      switch (type) {
        case 'spark':
          x = (i*137.5)%W; y = (i*97.3)%H;
          a = Math.random() < 0.02 ? 1 : 0.15+Math.sin(t*3+i)*0.15;
          break;
        case 'leaf':
          x = ((i*211 + t*10) % (W+40)) - 20;
          y = ((i*151 + t*22 + Math.sin(t*0.6+i)*30) % H);
          a = 0.5; sz = 3;
          break;
        case 'ember':
          x = (i*173)%W;
          y = H - ((t*30 + i*61) % H);
          a = 0.7*(1 - y/H); sz = 1.6;
          break;
        case 'snow':
          x = ((i*191 + Math.sin(t*0.4+i)*20) % W + W) % W;
          y = (i*137 + t*18) % H;
          a = 0.6; sz = 1.8;
          break;
        case 'sand':
          x = ((i*181 + t*40) % (W+30)) - 15;
          y = H*0.6 + ((i*89) % (H*0.4));
          a = 0.35; sz = 1.4;
          break;
        case 'star':
          x = (i*149.3)%W; y = (i*97.7)%H;
          a = 0.22 + Math.sin(t*0.6+i)*0.22; sz = i%11===0?2:1;
          break;
        case 'spore':
          x = (i*163)%W;
          y = H - ((t*12 + i*71) % H);
          a = 0.45+Math.sin(t*2+i)*0.25; sz = 1.6;
          break;
        case 'bubble':
          x = (i*179)%W;
          y = H - ((t*22 + i*53) % H);
          a = 0.4; sz = 2+((i*7)%3);
          break;
        case 'bolt':
          if (i > 2) continue; // just a couple of occasional bolts
          if (Math.sin(t*2+i*7) < 0.93) continue;
          ctx.globalAlpha = 0.8; ctx.strokeStyle = col; ctx.lineWidth = 2;
          { const bx = (i*W/3)+W/6; ctx.beginPath(); ctx.moveTo(bx,0); ctx.lineTo(bx-10,H*0.3); ctx.lineTo(bx+8,H*0.32); ctx.lineTo(bx-6,H*0.6); ctx.stroke(); }
          continue;
        case 'rune':
          x = (i*197)%W; y = (i*127)%H;
          a = 0.3+Math.sin(t*1.5+i)*0.2; sz = 3;
          ctx.save(); ctx.translate(x,y); ctx.rotate(t*0.3+i);
          ctx.globalAlpha = a; ctx.strokeStyle = col; ctx.lineWidth = 1;
          ctx.strokeRect(-sz,-sz,sz*2,sz*2);
          ctx.restore();
          continue;
        case 'prism':
          x = (i*211)%W; y = (i*163 + Math.sin(t*0.5+i)*20)%H;
          a = 0.4+Math.sin(t*2.5+i)*0.3; sz = 2+((i*3)%3);
          ctx.globalAlpha = Math.max(0,a);
          ctx.fillStyle = `hsl(${(i*37+t*40)%360},100%,65%)`;
          ctx.beginPath(); ctx.arc(x,y,sz,0,Math.PI*2); ctx.fill();
          continue;
        default: continue;
      }
      ctx.globalAlpha = Math.max(0, a);
      ctx.beginPath(); ctx.arc(x, y, sz, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  // ── Space mode: the original look (kept as an alternate style) ─────────────
  function _drawSpaceBackground() {
    const ctx = mapCtx;
    const W = mapW, H = mapH, t = MAP_STATE.time;
    const world = WORLDS[MAP_STATE.activeWorld];

    // Sky gradient — tinted toward the active world's own palette so each
    // world visually feels like a different place, not just a different ring
    // of icons on the same generic backdrop.
    const sky = ctx.createLinearGradient(0, 0, W * 0.5, H);
    sky.addColorStop(0, world.dark);
    sky.addColorStop(0.5, '#020c1a');
    sky.addColorStop(1, '#010912');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Nebula washes — large soft colour blobs that fill the empty space,
    // tinted with the world's accent + mid colours instead of a fixed palette.
    const NEB = [
      { x: 0.18, y: 0.24, r: 0.30, c: world.mid }, { x: 0.80, y: 0.20, r: 0.30, c: world.dark },
      { x: 0.62, y: 0.80, r: 0.34, c: world.mid }, { x: 0.16, y: 0.76, r: 0.27, c: world.dark },
      { x: 0.50, y: 0.45, r: 0.40, c: '#06243f' },
    ];
    ctx.save();
    for (let i = 0; i < NEB.length; i++) {
      const n = NEB[i], cx = n.x * W, cy = n.y * H, rr = n.r * Math.min(W, H) * (1 + Math.sin(t * 0.2 + i) * 0.05);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
      g.addColorStop(0, n.c); g.addColorStop(1, 'transparent');
      ctx.globalAlpha = 0.20; ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // Faint tech grid for depth (single stroke — cheap).
    ctx.save();
    ctx.globalAlpha = 0.045; ctx.strokeStyle = '#0a4a66'; ctx.lineWidth = 1;
    const gs = 64; ctx.beginPath();
    for (let gx = 0; gx <= W; gx += gs) { ctx.moveTo(gx, 0); ctx.lineTo(gx, H); }
    for (let gy = 0; gy <= H; gy += gs) { ctx.moveTo(0, gy); ctx.lineTo(W, gy); }
    ctx.stroke();
    ctx.restore();

    // Stars — density scales with the canvas area so big screens aren't bare.
    const starCount = Math.min(460, Math.round((W * H) / 4200));
    ctx.fillStyle = '#ffffee';
    for (let i = 0; i < starCount; i++) {
      const x = (i * 149.3) % W;
      const y = (i * 97.7) % H;
      const sz = i % 11 === 0 ? 2 : 1;
      ctx.globalAlpha = 0.22 + Math.sin(t * 0.6 + i) * 0.22;
      ctx.fillRect(x, y, sz, sz);
    }
    ctx.globalAlpha = 1;

    // Drifting data motes — more of them, spread across the whole canvas.
    const moteCount = Math.min(90, Math.round((W * H) / 22000));
    ctx.save();
    for (let i = 0; i < moteCount; i++) {
      const x = ((i * 237.5 + t * 8) % W + W) % W;
      const y = ((i * 143.7 + Math.sin(t * 0.3 + i) * 24) % H + H) % H;
      const pulse = Math.sin(t * 0.6 + i * 0.5) * 0.5 + 0.5;
      ctx.globalAlpha = pulse * 0.18;
      ctx.fillStyle = i % 3 === 0 ? '#0ff' : i % 3 === 1 ? '#4af' : '#08f';
      ctx.beginPath();
      ctx.arc(x, y, 1 + pulse * 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawActiveWorldZone() {
    const ctx = mapCtx;
    const t = MAP_STATE.time;
    const world = WORLDS[MAP_STATE.activeWorld];
    const pos = worldRender[world.id];
    const accent = worldAccent(world);
    // The ring is an ellipse (see layoutLevels) — drawing the glow and the orbit
    // line as a circle would leave them visibly detached from the nodes on a
    // wide phone screen.
    const RX = Math.max(60, pos.spread);
    const RY = Math.max(60, pos.spreadY != null ? pos.spreadY : pos.spread);
    const R = Math.max(RX, RY);

    // Zone glow behind the whole ring.
    const gradient = ctx.createRadialGradient(pos.cx, pos.cy, 0, pos.cx, pos.cy, R * 1.5);
    gradient.addColorStop(0, world.mid + 'aa');
    gradient.addColorStop(0.55, world.dark + '55');
    gradient.addColorStop(1, 'transparent');
    ctx.fillStyle = gradient;
    ctx.fillRect(pos.cx - R * 1.5, pos.cy - R * 1.5, R * 3, R * 3);

    // Dashed boundary ring (the "orbit" path itself).
    ctx.save();
    ctx.globalAlpha = 0.28; ctx.strokeStyle = accent; ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 7]);
    ctx.beginPath(); ctx.ellipse(pos.cx, pos.cy, RX, RY, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Orbiting motes for atmosphere.
    ctx.save();
    for (let i = 0; i < 14; i++) {
      const angle = (i / 14) * Math.PI * 2 + t * 0.2;
      const radius = R * 1.1 + Math.sin(t * 0.4 + i) * 8;
      const dx = pos.cx + Math.cos(angle) * radius;
      const dy = pos.cy + Math.sin(angle) * radius;
      const pulse = Math.sin(t * 0.6 + i * 0.8) * 0.5 + 0.5;
      ctx.globalAlpha = 0.18 + pulse * 0.12;
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(dx, dy, 1.5 + pulse * 1.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // World icon watermark, big and centred behind the ring.
    const iconPulse = Math.sin(t * 0.4 + world.id * 0.7) * 0.15 + 0.85;
    ctx.globalAlpha = 0.16 * iconPulse;
    ctx.font = `${Math.max(48, R * 0.9)}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = accent;
    ctx.fillText(world.icon, pos.cx, pos.cy);
    ctx.restore();
  }

  function drawPaths() {
    const ctx = mapCtx;
    const activeWorld = MAP_STATE.activeWorld;

    for (const [fromId, toId] of PATHS) {
      const from = LEVELS.find(l => l.id === fromId);
      const to = LEVELS.find(l => l.id === toId);
      if (!from || !to) continue;
      if (from.worldId !== activeWorld || to.worldId !== activeWorld) continue; // only this world's ring

      const world = WORLDS[from.worldId];
      const unlocked = from.unlocked && to.unlocked;
      const isActive = MAP_STATE.currentLevelId === fromId || MAP_STATE.currentLevelId === toId;

      ctx.save();
      ctx.lineCap = 'round';

      if (unlocked) {
        // Shadow
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y + 2);
        ctx.lineTo(to.x, to.y + 2);
        ctx.stroke();

        // Base road
        ctx.strokeStyle = '#1a1a2a';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();

        // Accent line
        ctx.strokeStyle = worldAccent(world);
        ctx.lineWidth = isActive ? 3 : 2;
        ctx.globalAlpha = isActive ? 0.9 : 0.5;
        if (isActive) {
          ctx.shadowBlur = 12;
          ctx.shadowColor = worldAccent(world);
        }
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
      } else {
        // Locked path
        ctx.strokeStyle = '#0d0d1a';
        ctx.lineWidth = 4;
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  function drawLevelNode(level) {
    const ctx = mapCtx;
    const world = WORLDS[level.worldId];
    const isCurrent = MAP_STATE.currentLevelId === level.id;
    const R = nodeR(level);

    // Shadow
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.ellipse(level.x + 2, level.y + R * 0.6 + 3, R * 1.1, R * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Pulse ring for current level
    if (isCurrent && level.unlocked) {
      const pulse = 0.5 + 0.5 * Math.sin(MAP_STATE.time * 2.5);
      ctx.save();
      ctx.strokeStyle = worldAccent(world);
      ctx.lineWidth = 3;
      ctx.globalAlpha = pulse * 0.7;
      ctx.shadowBlur = 20;
      ctx.shadowColor = worldAccent(world);
      ctx.beginPath();
      ctx.arc(level.x, level.y, R + 8 + pulse * 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    if (isCurrent) {
      ctx.shadowBlur = 30;
      ctx.shadowColor = worldAccent(world);
    }

    // Circle
    ctx.beginPath();
    ctx.arc(level.x, level.y, R, 0, Math.PI * 2);
    ctx.fillStyle = !level.unlocked ? '#07071a' : level.completed ? '#041408' : '#0b0e20';
    ctx.fill();
    ctx.strokeStyle = level.unlocked ? worldAccent(world) : '#181832';
    ctx.lineWidth = isCurrent ? 3.5 : 2;
    ctx.globalAlpha = level.unlocked ? 1 : 0.25;
    ctx.stroke();

    // Icon/Label
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (!level.unlocked) {
      // Lock icon
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = '#3333aa';
      ctx.fillRect(level.x - 4, level.y - 1, 8, 5);
      ctx.beginPath();
      ctx.arc(level.x, level.y - 3, 3.5, Math.PI, 0);
      ctx.strokeStyle = '#3333aa';
      ctx.lineWidth = 2;
      ctx.stroke();
      // Show level number below lock
      ctx.globalAlpha = 0.15;
      ctx.font = `bold ${R * 0.4}px "Share Tech Mono", monospace`;
      ctx.fillStyle = '#666';
      ctx.fillText(level.num, level.x, level.y + R * 0.7);
    } else if (level.completed) {
      // Checkmark on top
      ctx.font = `bold ${R * 0.7}px monospace`;
      ctx.fillStyle = '#00ee44';
      ctx.shadowBlur = 14;
      ctx.shadowColor = '#00ff44';
      ctx.fillText('✓', level.x, level.y - R * 0.25);
      // Level number below checkmark
      ctx.shadowBlur = 0;
      ctx.font = `bold ${R * 0.45}px "Share Tech Mono", monospace`;
      ctx.fillStyle = worldAccent(world);
      ctx.globalAlpha = 0.7;
      ctx.fillText(level.num, level.x, level.y + R * 0.35);
    } else if (level.type === 'boss') {
      // Boss icon on top
      ctx.font = `bold ${R * 0.65}px monospace`;
      ctx.fillStyle = worldAccent(world);
      ctx.shadowBlur = isCurrent ? 14 : 0;
      ctx.shadowColor = worldAccent(world);
      ctx.fillText('👑', level.x, level.y - R * 0.2);
      // Level number below crown
      ctx.shadowBlur = 0;
      ctx.font = `bold ${R * 0.4}px "Share Tech Mono", monospace`;
      ctx.fillText(level.num, level.x, level.y + R * 0.4);
    } else {
      // Level number (centered)
      ctx.font = `bold ${R * 0.55}px "Share Tech Mono", monospace`;
      ctx.fillStyle = worldAccent(world);
      ctx.shadowBlur = isCurrent ? 12 : 0;
      ctx.shadowColor = worldAccent(world);
      ctx.fillText(level.num, level.x, level.y + 1);
    }

    // Star rating row (completed levels only): 3 tiny stars below the node.
    if (level.completed && window.levelStars) {
      const stars = window.levelStars(level.num, MAP_STATE.hard);
      if (stars > 0) {
        const sy = level.y + R + 8;
        const gap = R * 0.45;
        ctx.shadowBlur = 0;
        for (let i = 0; i < 3; i++) {
          const sx = level.x + (i - 1) * gap;
          const lit = i < stars;
          ctx.globalAlpha = lit ? 0.9 : 0.2;
          ctx.fillStyle = lit ? '#ffd23f' : '#3a3a4a';
          // Tiny 5-point star
          const r = R * 0.18;
          ctx.beginPath();
          for (let p = 0; p < 10; p++) {
            const rad = (p % 2 === 0) ? r : r * 0.45;
            const ang = Math.PI * p / 5 - Math.PI / 2;
            const px = sx + rad * Math.cos(ang);
            const py = sy + rad * Math.sin(ang);
            if (p === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    ctx.restore();
  }

  // Draw one little robot token at (x,y) with optional leg animation.
  function drawRobot(x, y, body, glow, legKick = 0) {
    const ctx = mapCtx;
    const S = 3;
    ctx.save();
    ctx.shadowBlur = 16;
    ctx.shadowColor = glow;
    // Legs (animated when walking)
    ctx.fillStyle = body;
    ctx.fillRect(x - S * 1.5, y + S, S * 1.2, S * 2 + legKick * 0.5);  // Left leg
    ctx.fillRect(x + S * 0.3, y + S, S * 1.2, S * 2 - legKick * 0.5);  // Right leg
    // Body
    ctx.fillRect(x - S * 2, y - S * 3, S * 4, S * 4);
    // Antenna
    ctx.fillRect(x - 0.5, y - S * 4, 1, S);
    ctx.beginPath(); ctx.arc(x, y - S * 4, 1.6, 0, Math.PI * 2); ctx.fill();
    // Eyes
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffff00';
    ctx.fillRect(x - S, y - S * 2, S * 0.8, S * 0.8);
    ctx.fillRect(x + S * 0.2, y - S * 2, S * 0.8, S * 0.8);
    ctx.restore();
  }

  function drawPlayer() {
    const ctx = mapCtx;
    const x = MAP_STATE.playerX;
    const y = MAP_STATE.playerY;
    const face = MAP_STATE.faceDir || 1;
    const walking = !!MAP_STATE.walk;
    const sc = 0.62;       // robot scale on the map
    const footY = y + 11;  // stand on/just below the node
    // Pronounced alternating leg kick + a little body bob while walking.
    const legOf = (ph) => walking ? Math.sin(MAP_STATE.walkPhase * 0.45 + ph) * 4 : 0;
    const bob = walking ? Math.abs(Math.sin(MAP_STATE.walkPhase * 0.45)) * 2 : 0;

    const drawOne = (px, scheme, phase) => {
      if (window.drawByteRobot) window.drawByteRobot(ctx, px, footY - bob, sc, scheme, legOf(phase), face);
      else drawRobot(px, y, scheme === 'red' ? '#ff5555' : '#2aa0ff', scheme === 'red' ? '#ff2a2a' : '#00ccff', legOf(phase));
    };

    if (MAP_STATE.twoPlayer) {
      if (walking) {
        // Red trails behind the blue leader along the facing direction (legs out of phase).
        drawOne(x - face * 13, 'red', Math.PI);
        drawOne(x, 'blue', 0);
      } else {
        drawOne(x - 9, 'blue', 0);
        drawOne(x + 9, 'red', Math.PI);
      }
    } else {
      drawOne(x, 'blue', 0);
    }
  }

  function worldUnlocked(w) {
    // Пролог — вступление, его нельзя «заслужить»: он открыт с самого начала.
    if (WORLDS[w] && WORLDS[w].prologue) return true;
    const first = worldLevels(w)[0];
    return !!(first && first.unlocked);
  }

  function render() {
    drawBackground();
    drawActiveWorldZone();

    const w = MAP_STATE.activeWorld;
    const locked = !worldUnlocked(w);

    drawPaths();

    // Draw all nodes of the active world except current
    for (const level of worldLevels(w)) {
      if (level.id !== MAP_STATE.currentLevelId) drawLevelNode(level);
    }

    // Draw current node on top (only if it belongs to the world on screen)
    const current = LEVELS.find(l => l.id === MAP_STATE.currentLevelId);
    if (current && current.worldId === w) drawLevelNode(current);

    // The robot only ever stands on a world the player has actually reached —
    // browsing ahead to a locked world previews its layout, but empty, with a
    // big lock over it (see drawWorldLockOverlay), never the player's avatar.
    if (!locked) drawPlayer();
    else drawWorldLockOverlay(w);
  }

  // Big padlock + caption over a world the player hasn't reached yet. Levels
  // still render underneath (dimmed/locked, same as any individual locked
  // level) so browsing ahead previews the shape of what's coming.
  function drawWorldLockOverlay(w) {
    const ctx = mapCtx;
    const cx = mapW / 2, cy = mapH / 2;
    const pulse = Math.sin(MAP_STATE.time * 1.4) * 0.08 + 0.92;

    // Dim everything behind the lock so it reads clearly as inaccessible.
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, mapW, mapH);
    ctx.restore();

    ctx.save();
    ctx.translate(cx, cy - 10);
    ctx.scale(pulse, pulse);

    // Padlock body
    ctx.fillStyle = '#0a0a0a';
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 3;
    const bw = 56, bh = 46;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(-bw/2, -bh/2 + 14, bw, bh, 6) : ctx.rect(-bw/2, -bh/2 + 14, bw, bh);
    ctx.fill(); ctx.stroke();

    // Shackle
    ctx.beginPath();
    ctx.arc(0, -6, 20, Math.PI, 0, false);
    ctx.stroke();

    // Keyhole
    ctx.fillStyle = '#888';
    ctx.beginPath(); ctx.arc(0, 32, 5, 0, Math.PI*2); ctx.fill();
    ctx.fillRect(-2, 32, 4, 10);

    // Soft red glow ring behind the lock — reads as "blocked" at a glance.
    ctx.globalAlpha = 0.25 + Math.sin(MAP_STATE.time*1.4)*0.06;
    const g = ctx.createRadialGradient(0, 14, 0, 0, 14, 70);
    g.addColorStop(0, '#f44'); g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 14, 70, 0, Math.PI*2); ctx.fill();
    ctx.restore();

    // Caption
    const tt = (k, d) => (typeof window.t === 'function' && window.t(k) !== k) ? window.t(k) : d;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f44';
    ctx.font = "bold 15px 'Press Start 2P', monospace";
    ctx.shadowColor = '#f44'; ctx.shadowBlur = 10;
    ctx.fillText(tt('mapWorldLockedTitle', 'WORLD LOCKED'), cx, cy + 62);
    ctx.shadowBlur = 0;
    ctx.font = "10px 'Share Tech Mono', monospace";
    ctx.fillStyle = '#ccc';
    ctx.fillText(tt('mapWorldLockedHint', 'Complete the previous world to unlock it'), cx, cy + 84);
    ctx.restore();
  }

  // ═══════════════════════════════════════════════
  //  UPDATE & ANIMATION
  // ═══════════════════════════════════════════════

  let animationFrame;

  /* Карта жила «по кадрам»: время прибавлялось на 0.016 за отрисовку, а робот
     шагал на единицу. Формулы верны ровно для 60 кадров в секунду — на
     мониторе 165 Гц карта дышала и робот бежал в два с половиной раза быстрее.
     Теперь шаг измеряется временем: animK — сколько шестидесятых долей секунды
     прошло с прошлого кадра. При 60 Гц это единица, и всё как было. */
  let _lastMapT = performance.now();
  let animK = 1;
  function stepMapClock() {
    const now = performance.now();
    // Потолок нужен после сворачивания окна: иначе накопленный простой
    // швырнул бы робота через полкарты одним прыжком.
    animK = Math.min(4, Math.max(0, (now - _lastMapT) / (1000 / 60)));
    _lastMapT = now;
  }

  function update() {
    // Honor the shared FPS limiter/counter (settings.js). Without this the map
    // ran at full refresh rate doing a heavy full redraw every frame, ignoring
    // the user's FPS-limit setting and never updating the FPS counter here.
    if (typeof window._fpsShouldSkip === 'function' && window._fpsShouldSkip()) {
      animationFrame = requestAnimationFrame(update);
      return;
    }
    if (typeof window._fpsTick === 'function') window._fpsTick();

    stepMapClock();
    MAP_STATE.time += 0.016 * animK;
    stepWalk();
    render();
    updateDOM();
    animationFrame = requestAnimationFrame(update);
  }

  // Advance the walking animation: move the robot along the road polyline.
  function stepWalk() {
    const wk = MAP_STATE.walk;
    if (!wk) return;
    wk.t += animK;
    const u = Math.min(wk.t / wk.dur, 1);
    // Ease in/out for a natural start & stop.
    const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    let dist = e * wk.total, i = 0;
    while (i < wk.seg.length && dist > wk.seg[i]) { dist -= wk.seg[i]; i++; }
    if (i >= wk.seg.length) {
      const last = wk.poly[wk.poly.length - 1];
      MAP_STATE.playerX = last.x; MAP_STATE.playerY = last.y;
    } else {
      const a = wk.poly[i], b = wk.poly[i + 1];
      const f = wk.seg[i] ? dist / wk.seg[i] : 0;
      MAP_STATE.playerX = a.x + (b.x - a.x) * f;
      MAP_STATE.playerY = a.y + (b.y - a.y) * f;
      if (Math.abs(b.x - a.x) > 0.5) MAP_STATE.faceDir = (b.x - a.x) >= 0 ? 1 : -1;
    }
    MAP_STATE.walkPhase += animK;
    if (u >= 1) MAP_STATE.walk = null;
  }

  // Switch which world's ring is on screen. Any of the 10 worlds can be
  // browsed (locked ones show their nodes greyed/locked, same as any locked
  // level today) — this lets the player scout ahead, which reads as
  // exploration rather than a hard wall. The map cursor follows: if the
  // player was standing in the world we're leaving, jump to the first level
  // of the new world (or its own current level, if already visited).
  function setActiveWorld(w) {
    // The secret 11th world doesn't even appear in the arrow cycle until all
    // 10 Rainbow Shards are found — it should be invisible, not just locked,
    // per the design: worlds 0-9 can be browsed ahead with a lock overlay,
    // but Prism Anomaly doesn't exist on the map at all until then.
    // Стрелки ходят по явному порядку, а не по номерам миров: пролог стоит
    // в списке последним (чтобы не сдвигать сохранения), а показывается первым.
    let order = cycleOrder();
    if (window.Demo && window.Demo.on) {
      const lim = window.Demo.worldCount(order.length);
      order = order.filter((id) => id === 11 || id < lim);
    }
    const here = order.indexOf(MAP_STATE.activeWorld);
    // w приходит как «текущий ± 1» — переводим сдвиг в шаг по порядку.
    const delta = w - MAP_STATE.activeWorld;
    const idx = ((here + delta) % order.length + order.length) % order.length;
    w = order[idx];
    if (w === MAP_STATE.activeWorld) return;
    MAP_STATE.activeWorld = w;
    MAP_STATE.walk = null;
    const stillInWorld = LEVELS.find(l => l.id === MAP_STATE.currentLevelId && l.worldId === w);
    const target = stillInWorld || worldLevels(w)[0];
    MAP_STATE.currentLevelId = target.id;
    layoutLevels(); // recompute the ring for the new world before we snap the robot to it
    MAP_STATE.playerX = target.x;
    MAP_STATE.playerY = target.y;
    if (window.SFX && window.SFX.menu) window.SFX.menu();
    updateDOM();
  }

  function updateDOM() {
    const current = LEVELS.find(l => l.id === MAP_STATE.currentLevelId);
    if (!current) return;

    const activeW = WORLDS[MAP_STATE.activeWorld];
    const world = WORLDS[current.worldId];
    const clearedCount = LEVELS.filter(l => l.completed).length;

    // Big top title: WORLD N + localized name, always reflecting whichever
    // world's ring is on screen (not necessarily the cursor's world, if the
    // player is browsing ahead with the arrows).
    const numEl = document.getElementById('mapWorldTitleNum');
    const nameEl = document.getElementById('mapWorldTitleName');
    if (numEl) {
      const tt0 = (k, d) => (typeof window.t === 'function' && window.t(k) !== k) ? window.t(k) : d;
      // У пролога номера нет — он не входит в счёт миров кампании.
      numEl.textContent = activeW.prologue
        ? tt0('prologue', 'ПРОЛОГ')
        : `${tt0('mapWorldLabel','WORLD')} ${activeW.id + 1}`;
      numEl.style.color = worldAccent(activeW);
      numEl.style.textShadow = `0 0 14px ${worldAccent(activeW)}`;
    }
    if (nameEl) {
      nameEl.textContent = wName(activeW);
      nameEl.style.color = worldAccent(activeW);
    }
    // Rainbow shard status for THIS world. A tick or a cross, no words: the
    // shard is the one collectible players hunt world by world, and adding two
    // more strings to fifty locales for it would be waste.
    const shardEl = document.getElementById('mapWorldShard');
    if (shardEl) {
      if (activeW.secret) {
        shardEl.style.display = 'none';           // the secret world has none
      } else {
        const got = (typeof window.rainbowHasShard === 'function')
          ? window.rainbowHasShard(activeW.id) : false;
        shardEl.style.display = '';
        shardEl.textContent = got ? '🌈 ✓' : '🌈 ✗';
        shardEl.style.color = got ? '#0f8' : '#556';
        shardEl.style.textShadow = got ? '0 0 12px rgba(0,255,136,.8)' : 'none';
      }
    }
    const anyUnlockedInWorld = LEVELS.some(l => l.worldId === MAP_STATE.activeWorld && l.unlocked);
    const arrL = document.getElementById('mapArrowLeft'), arrR = document.getElementById('mapArrowRight');
    if (arrL) arrL.style.opacity = MAP_STATE.activeWorld > 0 ? '1' : '0.25';
    const _rainbowDone = (typeof rainbowCount === 'function') && rainbowCount() >= 10;
    let _cycleLen = _rainbowDone ? WORLDS.length : WORLDS.length - 1;
    if (window.Demo && window.Demo.on) _cycleLen = window.Demo.worldCount(_cycleLen);
    if (arrR) arrR.style.opacity = MAP_STATE.activeWorld < _cycleLen - 1 ? '1' : '0.25';
    if (!anyUnlockedInWorld && arrL) { /* still browsable, just visually locked via node state */ }

    document.getElementById('mapClearedCount').textContent = clearedCount;

    // Update star count (total earned across all unlocked levels)
    const starsCount = window.totalStars ? window.totalStars(MAP_STATE.hard) : 0;
    document.getElementById('mapStarsCount').textContent = starsCount;

    // Update crystal (data-shard) count — total collected across all unlocked levels.
    const shardsEl = document.getElementById('mapShardsCount');
    if (shardsEl) {
      const shardsCount = window.totalShards ? window.totalShards(MAP_STATE.hard) : 0;
      shardsEl.textContent = shardsCount;
    }

    // Монеты: сумма лучших сборов по всем уровням этого слота прогресса.
    // Общий счётчик за всё время (включая бесконечный режим) живёт в профиле —
    // на карте показываем именно то, что относится к её уровням.
    const coinsEl = document.getElementById('mapCoinsCount');
    if (coinsEl) {
      const coinsCount = window.totalLevelCoins ? window.totalLevelCoins(MAP_STATE.hard) : 0;
      coinsEl.textContent = coinsCount.toLocaleString();
    }

    // The secret 11th world (10 extra levels, 30 extra possible stars/crystals)
    // only counts toward the displayed totals once it's actually unlocked —
    // otherwise the HUD would advertise a max the player can't yet see.
    const _rbDoneForMax = (typeof rainbowCount === 'function') && rainbowCount() >= 10;
    // Demo build: the denominators are the demo's own totals (3 stars and 3
    // crystals per level), not the full game's — advertising 100 levels the
    // player can't reach would be a lie on the HUD.
    const _demo = window.Demo && window.Demo.on;
    const _maxLv = _demo ? window.Demo.levels : (_rbDoneForMax ? 110 : 100);
    const clearedMaxEl = document.getElementById('mapClearedMax');
    if (clearedMaxEl) clearedMaxEl.textContent = String(_maxLv);
    const starsMaxEl = document.getElementById('mapStarsMax');
    if (starsMaxEl) starsMaxEl.textContent = String(_maxLv * 3);
    const shardsMaxEl = document.getElementById('mapShardsMax');
    if (shardsMaxEl) shardsMaxEl.textContent = String(_maxLv * 3);

    // Rainbow Shards — secret collectible, 1 per world, 10 total. Not affected
    // by Hardcore/Normal mode (found once, shared across both, like achievements).
    const rainbowEl = document.getElementById('mapRainbowCount');
    if (rainbowEl) {
      rainbowEl.textContent = (typeof rainbowCount === 'function') ? rainbowCount() : 0;
    }

    // Total campaign score (sum of every level's best score).
    const totalScoreEl = document.getElementById('mapTotalScore');
    if (totalScoreEl) {
      const ts = window.totalScore ? window.totalScore(MAP_STATE.hard) : 0;
      totalScoreEl.textContent = ts.toLocaleString();
    }

    document.getElementById('mapCurrentZone').textContent = wName(world);
    document.getElementById('mapCurrentZone').style.color = worldAccent(world);

    const zoneTag = document.getElementById('mapZoneTag');
    zoneTag.textContent = wName(world);
    zoneTag.style.color = worldAccent(world);
    zoneTag.style.borderColor = worldAccent(world);

    const panel = document.getElementById('mapLevelPanel');
    panel.style.display = 'block';
    panel.style.borderColor = worldAccent(world);

    const tt = (k, d) => (typeof window.t === 'function' && window.t(k) !== k) ? window.t(k) : d;
    document.getElementById('mapLevelName').textContent = current.type === 'prologue'
      ? tt('prologueLab', 'ЛАБОРАТОРИЯ CHEN-7')
      : `${tt('level','LEVEL')} ${current.num}${current.type === 'boss' ? ' — ' + tt('mapBoss','BOSS') : ''}`;
    document.getElementById('mapLevelName').style.color = worldAccent(world);
    // У пролога заголовок карточки и есть название мира — повторять его
    // второй строкой незачем; вместо этого поясняем, что это вступление.
    document.getElementById('mapLevelSub').textContent = current.type === 'prologue'
      ? tt('prologueSub', 'вступление — не влияет на прогресс')
      : wName(world);

    // Per-level best score (when the player has completed it at least once).
    const scoreEl = document.getElementById('mapLevelScore');
    if (scoreEl) {
      const best = window.levelScore ? window.levelScore(current.num, MAP_STATE.hard) : 0;
      const shards = window.levelShards ? window.levelShards(current.num, MAP_STATE.hard) : 0;
      const coins = window.levelCoins ? window.levelCoins(current.num, MAP_STATE.hard) : 0;
      const parts = [];
      if (current.completed && best > 0) parts.push(`★ ${tt('mapBest','BEST')}: ${best.toLocaleString()}`);
      if (current.unlocked && current.type !== 'prologue')
        parts.push(`<span style="color:#0ff">◆ ${shards}/3</span>`);
      // Лучший сбор монет на этом уровне: видно, куда есть смысл вернуться.
      // Максимума у монет нет — он зависит от того, как сгенерировался уровень.
      if (current.completed && coins > 0)
        parts.push(`<span style="color:#ffcc33">◉ ${coins}</span>`);
      if (parts.length) {
        scoreEl.innerHTML = parts.join('  ');
        scoreEl.style.display = 'block';
      } else {
        scoreEl.style.display = 'none';
      }
    }

    const action = document.getElementById('mapLevelAction');
    if (!current.unlocked) {
      action.innerHTML = `<span style="color:#444">[ ${tt('mapLocked','LOCKED')} ]</span>`;
    } else if (current.completed) {
      action.innerHTML = `<span style="color:#0f0">[ ${tt('mapCompleted','COMPLETED')} ✓ ]</span>`;
    } else {
      action.innerHTML = `<span style="color:${worldAccent(world)}">[ ${tt('mapStart','ENTER / SPACE TO START')} ]</span>`;
    }
  }

  // ═══════════════════════════════════════════════
  //  NAVIGATION & INPUT
  // ═══════════════════════════════════════════════

  function getNeighbors(levelId) {
    const neighbors = [];
    for (const [fromId, toId] of PATHS) {
      if (fromId === levelId) {
        const level = LEVELS.find(l => l.id === toId);
        if (level && level.unlocked) neighbors.push(level);
      }
      if (toId === levelId) {
        const level = LEVELS.find(l => l.id === fromId);
        if (level && level.unlocked) neighbors.push(level);
      }
    }
    return neighbors;
  }

  // Move to ANY unlocked level. The robot WALKS there along the road (following the
  // node chain) instead of teleporting; the cursor/logic updates immediately.
  function moveToLevel(targetId) {
    const target = LEVELS.find(l => l.id === targetId);
    if (!target || !target.unlocked) return;

    const cur = LEVELS.find(l => l.id === MAP_STATE.currentLevelId);
    MAP_STATE.currentLevelId = targetId;
    if (window.SFX && window.SFX.menu) window.SFX.menu();

    if (!cur || cur.num === target.num) {
      MAP_STATE.playerX = target.x;
      MAP_STATE.playerY = target.y;
      return;
    }

    // Build a polyline from the current robot position through every node on the
    // way to the target (the levels form a linear chain, so this traces the road).
    const poly = [{ x: MAP_STATE.playerX, y: MAP_STATE.playerY }];
    const step = target.num > cur.num ? 1 : -1;
    for (let n = cur.num; n !== target.num; n += step) {
      const nx = LEVELS.find(l => l.num === n + step);
      if (nx) poly.push({ x: nx.x, y: nx.y });
    }
    const seg = [];
    let total = 0;
    for (let i = 1; i < poly.length; i++) {
      const d = Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y);
      seg.push(d); total += d;
    }
    const hops = poly.length - 1;
    // Slower, more deliberate stroll: ~1.2s for one hop, capped for long jumps.
    MAP_STATE.walk = { poly, seg, total, t: 0, dur: Math.min(50 + hops * 35, 400) };
  }

  // Move the cursor to the nearest unlocked level in the pressed direction,
  // scanning the whole map (not just directly connected nodes).
  function navigateDirection(dx, dy) {
    const current = LEVELS.find(l => l.id === MAP_STATE.currentLevelId);
    if (!current) return;

    let best = null;
    let bestScore = -Infinity;

    for (const lv of LEVELS) {
      if (lv.id === current.id || !lv.unlocked || lv.worldId !== MAP_STATE.activeWorld) continue;
      const vx = lv.x - current.x, vy = lv.y - current.y;
      const proj = dx * vx + dy * vy;          // travel along the desired axis
      if (proj <= 0) continue;                 // candidate must lie in that direction
      const perp = Math.abs(dx * vy - dy * vx); // sideways deviation
      const dist = Math.hypot(vx, vy) || 1;
      // Favour well-aligned, nearby nodes.
      const score = proj - perp * 1.5 - dist * 0.2;
      if (score > bestScore) { bestScore = score; best = lv; }
    }

    if (best) moveToLevel(best.id);
  }

  function startLevel() {
    const current = LEVELS.find(l => l.id === MAP_STATE.currentLevelId);
    if (!current || !current.unlocked) return;

    // Close map and start the level
    hideWorldMap();

    // Пролог идёт своим путём: катсцена, обучающий уровень, катсцена. В
    // кампанию он не входит, поэтому startAdventureLevel сюда не годится.
    if (current.type === 'prologue') {
      if (window.Tutorial && window.Tutorial.startPrologue) window.Tutorial.startPrologue();
      return;
    }

    // Trigger level start in main game (pass mode so Hardcore launches correctly)
    if (window.startAdventureLevel) {
      window.startAdventureLevel(current.num, MAP_STATE.hard);
    }
  }

  // ═══════════════════════════════════════════════
  //  PUBLIC API
  // ═══════════════════════════════════════════════

  function showWorldMap(hard) {
    MAP_STATE.hard = !!hard;
    MAP_STATE.twoPlayer = !!window.bbTwoPlayer;

    if (!mapOverlay) {
      createMapCanvas();
      createMapOverlay();
    }

    // Re-fit the field to the current window + Game Scale setting on every open.
    resizeMapCanvas();

    // Load progress from localStorage (mode-aware)
    loadProgress();
    applyModeChrome();

    mapOverlay.style.display = 'flex';
    // Re-translate the HUD on every open so a language change made elsewhere
    // (e.g. in settings) is reflected when the map is reopened.
    if (typeof window.applyI18nDOM === 'function') window.applyI18nDOM();
    // Re-fit after translation (localised labels change panel sizes) and again a
    // beat later once fonts/layout settle in a mobile WebView.
    fitHud();
    [60, 250, 600].forEach(t => setTimeout(fitHud, t));
    // Cancel any previous map loop before starting a fresh one, so re-opening
    // the map can never leave two update() RAF chains running at once.
    if (animationFrame) { cancelAnimationFrame(animationFrame); animationFrame = null; }
    update();

    // Setup input handlers
    setupInput();
  }

  // Recolour the static HUD chrome to match the active mode.
  function applyModeChrome() {
    const hard = MAP_STATE.hard;
    const col = hard ? '#f44' : '#0ff';
    const titleEl = mapOverlay && mapOverlay.querySelector('#worldMapTitle');
    const subEl = mapOverlay && mapOverlay.querySelector('#worldMapSub');
    if (titleEl) { titleEl.textContent = hard ? '💀 BYTE BLASTER' : '⚡ BYTE BLASTER'; titleEl.style.color = col; titleEl.style.textShadow = '0 0 10px ' + col; }
    if (subEl) {
      const tt = (k, d) => (typeof window.t === 'function' && window.t(k) !== k) ? window.t(k) : d;
      subEl.textContent = '▸ ' + (hard ? tt('mapHardcoreMap', 'HARDCORE MAP') : tt('mapWorldMap', 'WORLD MAP'));
    }
  }

  function hideWorldMap() {
    if (mapOverlay) {
      mapOverlay.style.display = 'none';
    }
    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
    cleanupInput();
  }

  function loadProgress() {
    // Reset every node first so switching between Normal/Hardcore never leaks
    // the other mode's completion/unlock state into this view.
    for (const level of LEVELS) {
      level.completed = false;
      // Узел пролога (номер 0) открыт всегда — он вне кампании, и его
      // прохождение хранится отдельным ключом, а не в списке done.
      level.unlocked = (level.num === 1 || level.worldId === 11);
      if (level.worldId === 11) {
        try { level.completed = localStorage.getItem('bbTutorialDone') === '1'; } catch (e) {}
      }
    }
    MAP_STATE.currentLevelId = 'L1';
    MAP_STATE.activeWorld = 0;
    MAP_STATE.playerX = LEVELS[0].x;
    MAP_STATE.playerY = LEVELS[0].y;
    MAP_STATE.walk = null; // cancel any in-progress walk animation

    try {
      const saved = localStorage.getItem(MAP_STATE.hard ? 'bbAdvH' : 'bbAdv3');
      if (saved) {
        const data = JSON.parse(saved);
        if (data && data.done && Array.isArray(data.done)) {
          // Mark levels as completed
          for (const levelNum of data.done) {
            const level = LEVELS.find(l => l.num === levelNum);
            if (level) {
              level.completed = true;
              level.unlocked = true;
            }
          }

          // Unlock all levels up to max
          if (data.max) {
            for (let i = 1; i <= data.max; i++) {
              const level = LEVELS.find(l => l.num === i);
              if (level) level.unlocked = true;
            }
          }

          // Set current level to highest unlocked
          const maxUnlocked = data.max || 1;
          const currentLevel = LEVELS.find(l => l.num === maxUnlocked);
          if (currentLevel) {
            MAP_STATE.currentLevelId = currentLevel.id;
            MAP_STATE.activeWorld = currentLevel.worldId;
            MAP_STATE.playerX = currentLevel.x;
            MAP_STATE.playerY = currentLevel.y;
          }
        }
      }
    } catch (e) {
      console.error('Failed to load progress:', e);
    }

    // Demo build: everything past the demo's last level stays locked, however
    // far a save file (possibly carried over from a full build) says the player
    // got. Done last so it overrides the unlock loops above.
    if (window.Demo && window.Demo.on) {
      for (const level of LEVELS) {
        if (level.num > window.Demo.levels) { level.unlocked = false; level.completed = false; }
      }
      if (MAP_STATE.activeWorld >= window.Demo.worldCount(WORLDS.length)) {
        MAP_STATE.activeWorld = 0;
        MAP_STATE.currentLevelId = 'L1';
        MAP_STATE.playerX = LEVELS[0].x;
        MAP_STATE.playerY = LEVELS[0].y;
      }
      const cur = LEVELS.find(l => l.id === MAP_STATE.currentLevelId);
      if (cur && cur.num > window.Demo.levels) {
        const last = LEVELS.find(l => l.num === window.Demo.levels);
        if (last) {
          MAP_STATE.currentLevelId = last.id;
          MAP_STATE.activeWorld = last.worldId;
          MAP_STATE.playerX = last.x;
          MAP_STATE.playerY = last.y;
        }
      }
      return; // the secret world below can never open in a demo
    }

    // Secret 11th world (Prism Anomaly, levels 101-110): only unlockable by
    // finding all 10 Rainbow Shards — never by ordinary sequential progress,
    // even though `data.max` marches straight through 100→101 once the main
    // story is cleared. If the player is CURRENTLY standing in it (they must
    // have unlocked it in a past session) but somehow no longer qualifies
    // (e.g. after a slot switch to a fresh profile), bounce them back to World 1.
    const rainbowDone = (typeof rainbowCount === 'function') ? rainbowCount() >= 10
      : (typeof window.rainbowCount === 'function' ? window.rainbowCount() >= 10 : false);
    for (const level of LEVELS) {
      if (level.worldId !== 10) continue;
      if (!rainbowDone) { level.unlocked = false; continue; }
      // The entry gate (level 101) opens as soon as all 10 shards are found —
      // this does NOT depend on advProg.max, which existing save files already
      // have permanently capped at 100 from before this world existed (their
      // stored value can't retroactively know about level 101). The rest of
      // the secret world (102-110) still unlocks the normal sequential way as
      // advProg.max climbs past 101 while the player actually plays through it.
      if (level.num === 101) level.unlocked = true;
    }
    if (!rainbowDone && MAP_STATE.activeWorld === 10) {
      MAP_STATE.activeWorld = 0;
      MAP_STATE.currentLevelId = 'L1';
      MAP_STATE.playerX = LEVELS[0].x;
      MAP_STATE.playerY = LEVELS[0].y;
    }
  }

  // Input handling
  let keyHandler, clickHandler;

  function setupInput() {
    keyHandler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        hideWorldMap();
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        startLevel();
        return;
      }

      let dx = 0, dy = 0;
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') dx = 1;
      else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') dx = -1;
      else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') dy = -1;
      else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') dy = 1;
      else if (e.key === 'q' || e.key === 'Q' || e.key === '[') { e.preventDefault(); setActiveWorld(MAP_STATE.activeWorld - 1); return; }
      else if (e.key === 'e' || e.key === 'E' || e.key === ']') { e.preventDefault(); setActiveWorld(MAP_STATE.activeWorld + 1); return; }
      else return;

      e.preventDefault();
      navigateDirection(dx, dy);
    };

    clickHandler = (e) => {
      const rect = mapCanvas.getBoundingClientRect();
      // Map the click into LOGICAL (CSS-pixel) space — the same space node x/y
      // live in. Uses mapW/mapH, not the (DPR-scaled) backing store size.
      const scaleX = mapW / rect.width;
      const scaleY = mapH / rect.height;
      const mx = (e.clientX - rect.left) * scaleX;
      const my = (e.clientY - rect.top) * scaleY;

      // Only the ACTIVE world's 10 nodes are on screen — levels in other worlds
      // keep stale coordinates from their last layout and must never be hit here.
      for (const level of LEVELS) {
        if (level.worldId !== MAP_STATE.activeWorld) continue;
        const R = nodeR(level);
        const dist = Math.hypot(mx - level.x, my - level.y);
        if (dist < R + 10) {
          if (level.id === MAP_STATE.currentLevelId) {
            startLevel();
          } else {
            moveToLevel(level.id);
          }
          break;
        }
      }
    };

    window.addEventListener('keydown', keyHandler);
    mapCanvas.addEventListener('click', clickHandler);
  }

  function cleanupInput() {
    if (keyHandler) window.removeEventListener('keydown', keyHandler);
    if (clickHandler) mapCanvas.removeEventListener('click', clickHandler);
  }

  // Refresh progress from localStorage. Optional `hard` switches the active mode
  // so the in-game level-complete hook can target the right save slot.
  function refresh(hard) {
    if (typeof hard === 'boolean') MAP_STATE.hard = hard;
    loadProgress();
  }

  // Immediately mark a level node completed (and unlocked) in the given mode.
  // Used by the game so the final level (100) reliably shows its checkmark.
  function markCompleted(num, hard) {
    if (typeof hard === 'boolean') MAP_STATE.hard = hard;
    const level = LEVELS.find(l => l.num === num);
    if (level) { level.completed = true; level.unlocked = true; }
  }

  // Expose API
  window.WorldMap = {
    show: showWorldMap,
    hide: hideWorldMap,
    refresh: refresh,
    markCompleted: markCompleted,
    // Read-only view of the current ring, for layout diagnostics. The node
    // positions are the one thing about this screen that cannot be checked from
    // the DOM (they live on the canvas), and getting them wrong is invisible
    // until someone opens the map on a phone — so they are worth exposing.
    debugNodes() {
      const w = MAP_STATE.activeWorld;
      const pos = worldRender[w] || {};
      return {
        world: w, cx: pos.cx, cy: pos.cy, rx: pos.spread, ry: pos.spreadY,
        nodeScale,
        nodes: worldLevels(w).map(l => ({
          num: l.num, x: l.x, y: l.y, r: nodeR(l), type: l.type,
          unlocked: l.unlocked, completed: l.completed,
        })),
      };
    },
  };

  console.log('✅ World Map system loaded');

})();
