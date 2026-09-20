// ===============================================================
//  BYTE BLASTER — ЗАДНИЕ ФОНЫ: ОДИН СЛОЙ НА МИР
// ===============================================================
// Раньше фон каждого мира собирался из множества слоёв: небо, свечение
// горизонта, дымка, звёзды, светлячки, окна домов, полосы силуэтов с
// параллаксом. Всё это рисовалось каждый кадр, наезжало друг на друга и
// превращалось в кашу, из-за которой не читалась сама геометрия уровня.
//
// Здесь фон — ОДИН слой, запечённый в холст. В кадре он стоит два drawImage.
//
// Силуэта горизонта здесь нет намеренно. Он был, но занимал верхнюю половину
// экрана и спорил и с уровнем, и с декорациями у земли, которые игра рисует
// отдельно. Наверху теперь ровно небо и одна деталь, которая мир и обозначает:
// луна, зарево или звёзды.
(function (root) {
  'use strict';

  /* ── Миры ──────────────────────────────────────────────────────────────
     Цвета берутся из темы мира, чтобы фон и платформы оставались одной
     палитрой. От мира к миру меняются: высота перехода неба, акцент и одна
     крупная деталь.

     accent: 'stars' звёзды | 'glow' зарево у горизонта | 'none' ничего
     disc:   [доля ширины, доля высоты, радиус в долях высоты, яркость]  */
  const WORLDS = {
    // 🏙 кибергород: ночь над городом, низкая луна
    0:  { seed: 1.1, accent: 'stars', horizon: 0.62, disc: [0.74, 0.24, 0.085, 0.5] },
    // 🌿 джунгли: тёплый влажный воздух, света мало
    1:  { seed: 2.4, accent: 'none', horizon: 0.70, warm: 0.25 },
    // 🌋 лава: зарево снизу
    2:  { seed: 3.9, accent: 'glow', horizon: 0.66 },
    // ❄ лёд: бледное небо и тусклая луна
    3:  { seed: 4.2, accent: 'stars', horizon: 0.62, disc: [0.24, 0.20, 0.10, 0.34] },
    // 🏜 пустыня: низкое солнце у горизонта
    4:  { seed: 5.6, accent: 'glow', horizon: 0.68, disc: [0.62, 0.52, 0.13, 0.5] },
    // 🛸 станция: открытый космос и планета
    5:  { seed: 6.3, accent: 'stars', horizon: 0.80, disc: [0.30, 0.32, 0.22, 0.3] },
    // 🌲 тёмный лес: самый глухой мир, ни звёзд, ни зарева
    6:  { seed: 7.1, accent: 'none', horizon: 0.66, dark: 0.3 },
    // ☣ токсичная зона: тяжёлое свечение снизу
    7:  { seed: 8.8, accent: 'glow', horizon: 0.70 },
    // ⚡ вершины: разреженный холодный воздух
    8:  { seed: 9.4, accent: 'stars', horizon: 0.64 },
    // 🔱 крепость: багровое зарево
    9:  { seed: 10.7, accent: 'glow', horizon: 0.64 },
    // 🌈 призма: единственный мир, где всё переливается — см. rainbow ниже
    10: { seed: 11.2, accent: 'stars', horizon: 0.70, rainbow: true,
          disc: [0.68, 0.26, 0.12, 0.55] },
  };

  /** Радужный мир — тот, у которого это прямо указано. */
  const isRainbow = (id) => !!(WORLDS[id] && WORLDS[id].rainbow);

  /* ── Цвет ──────────────────────────────────────────────────────────────
     Осветление и затемнение без разбора формата: браузер сам приведёт цвет к
     rgb(), а мы только сместим яркость. */
  let probeCtx = null;
  function toRGB(col) {
    if (!probeCtx) probeCtx = document.createElement('canvas').getContext('2d');
    probeCtx.fillStyle = '#000';
    probeCtx.fillStyle = col;
    const s = probeCtx.fillStyle;
    if (s[0] === '#') {
      return s.length === 4
        ? s.slice(1).split('').map(ch => parseInt(ch + ch, 16))
        : [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
    }
    const m = s.match(/[\d.]+/g);
    return m ? [+m[0], +m[1], +m[2]] : [0, 0, 0];
  }
  const mix = (a, b, t) => {
    const A = toRGB(a), B = toRGB(b);
    return 'rgb(' + Math.round(A[0] + (B[0] - A[0]) * t) + ','
                  + Math.round(A[1] + (B[1] - A[1]) * t) + ','
                  + Math.round(A[2] + (B[2] - A[2]) * t) + ')';
  };
  const rgba = (col, a) => { const c = toRGB(col); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; };

  /** Детерминированный ГПСЧ: фон одного мира выглядит одинаково при каждом входе. */
  function rng(seed) {
    let s = Math.floor(seed * 100000) >>> 0 || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }

  /* ── Запекание ─────────────────────────────────────────────────────────
     Ключ кэша включает размер: игра и карта мира рисуют один и тот же мир в
     холсты РАЗНОГО размера. */
  const cache = new Map();

  function bake(W, H, theme) {
    const spec = WORLDS[theme.id] || WORLDS[0];
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, W); cv.height = Math.max(1, H);
    const c = cv.getContext('2d');
    const r = rng(spec.seed);

    const horizonY = H * spec.horizon;
    const deep = theme.bg || '#04040f';
    const near = theme.bg2 || theme.bg || '#0a0a20';
    const accentCol = theme.mc || theme.grid || '#4af';

    // 1. Небо.
    const g = c.createLinearGradient(0, 0, 0, H);
    if (spec.rainbow) {
      // Призма-аномалия: небо переливается всем спектром. Тона приглушены —
      // на полной насыщенности платформы и враги на таком фоне не читаются.
      const stops = [
        [0.00, 'hsl(280,60%,10%)'],
        [0.18, 'hsl(225,62%,15%)'],
        [0.36, 'hsl(180,55%,16%)'],
        [0.54, 'hsl(120,48%,15%)'],
        [0.72, 'hsl(45,62%,17%)'],
        [0.88, 'hsl(0,60%,16%)'],
        [1.00, 'hsl(310,62%,16%)'],
      ];
      for (const [p, col] of stops) g.addColorStop(p, col);
    } else {
      g.addColorStop(0, mix(deep, '#000000', 0.35 + (spec.dark || 0)));
      g.addColorStop(0.55, deep);
      g.addColorStop(1, mix(near, accentCol, 0.10 + (spec.warm || 0)));
    }
    c.fillStyle = g; c.fillRect(0, 0, W, H);

    // 2. Диск — луна, солнце или планета. Единственная крупная деталь в небе.
    if (spec.disc) {
      const [dx, dy, dr, da] = spec.disc;
      const x = W * dx, y = H * dy, r0 = H * dr;
      if (spec.rainbow) {
        // Радужный диск: круговая развёртка спектра вместо ровной заливки.
        const halo = c.createRadialGradient(x, y, r0 * 0.6, x, y, r0 * 2.4);
        halo.addColorStop(0, 'hsla(0,0%,100%,0.10)');
        halo.addColorStop(1, 'hsla(0,0%,100%,0)');
        c.fillStyle = halo;
        c.beginPath(); c.arc(x, y, r0 * 2.4, 0, Math.PI * 2); c.fill();
        // Много узких секторов вместо двенадцати широких: на двенадцати это
        // читалось палитрой цветов, а не небесным телом. Секторы перекрываются
        // на пол-градуса, иначе между ними просвечивают швы.
        const SEG = 180;
        for (let i = 0; i < SEG; i++) {
          c.fillStyle = 'hsl(' + Math.round(i * 360 / SEG) + ',92%,60%)';
          c.beginPath();
          c.moveTo(x, y);
          c.arc(x, y, r0, (i / SEG) * Math.PI * 2, ((i + 1.6) / SEG) * Math.PI * 2);
          c.closePath(); c.fill();
        }
        // Мягкая сердцевина: к центру цвета сходятся в белый, как в призме.
        const core = c.createRadialGradient(x, y, 0, x, y, r0);
        core.addColorStop(0, 'rgba(255,255,255,0.85)');
        core.addColorStop(0.45, 'rgba(255,255,255,0.15)');
        core.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = core;
        c.beginPath(); c.arc(x, y, r0, 0, Math.PI * 2); c.fill();
      } else {
        const halo = c.createRadialGradient(x, y, r0 * 0.6, x, y, r0 * 2.4);
        halo.addColorStop(0, rgba(accentCol, da * 0.25));
        halo.addColorStop(1, rgba(accentCol, 0));
        c.fillStyle = halo;
        c.beginPath(); c.arc(x, y, r0 * 2.4, 0, Math.PI * 2); c.fill();
        c.fillStyle = rgba(mix(accentCol, '#ffffff', 0.5), da);
        c.beginPath(); c.arc(x, y, r0, 0, Math.PI * 2); c.fill();
      }
    }

    // 3. Акцент — ровно один на мир.
    if (spec.accent === 'stars') {
      const n = Math.round(W * H / 9000);
      for (let i = 0; i < n; i++) {
        const x = r() * W, y = r() * horizonY;
        const a = 0.18 + r() * 0.5, s = r() < 0.85 ? 1 : 2;
        // В радужном мире и звёзды разноцветные.
        c.fillStyle = spec.rainbow
          ? 'hsla(' + Math.round(r() * 360) + ',100%,72%,' + a.toFixed(2) + ')'
          : 'rgba(255,255,255,' + a.toFixed(2) + ')';
        c.fillRect(x | 0, y | 0, s, s);
      }
    } else if (spec.accent === 'glow') {
      const gg = c.createLinearGradient(0, horizonY - H * 0.26, 0, H);
      gg.addColorStop(0, rgba(accentCol, 0));
      gg.addColorStop(1, rgba(accentCol, 0.22));
      c.fillStyle = gg; c.fillRect(0, horizonY - H * 0.26, W, H - (horizonY - H * 0.26));
    }

    return cv;
  }

  /**
   * Нарисовать фон. Сдвиг — медленный параллакс: полотно шириной в экран
   * рисуется дважды со смещением, стык не виден, потому что края совпадают
   * (в полотне нет ни одной формы, привязанной к краю).
   */
  function draw(ctx, W, H, theme, camX) {
    const key = theme.id + '|' + W + '|' + H;
    let hit = cache.get(key);
    if (!hit) {
      hit = bake(W, H, theme);
      cache.set(key, hit);
      while (cache.size > 4) cache.delete(cache.keys().next().value);
    }
    const off = ((camX * 0.14) % W + W) % W;
    ctx.drawImage(hit, -off, 0);
    if (off > 0) ctx.drawImage(hit, W - off, 0);
  }

  function invalidate() { cache.clear(); }

  root.BBBackdrop = { draw, invalidate, WORLDS, isRainbow };
})(typeof globalThis !== 'undefined' ? globalThis : this);
