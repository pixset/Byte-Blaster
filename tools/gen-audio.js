// ============================================================================
//  Byte Blaster — offline audio renderer
//  Re-implements the in-game procedural synth (assets/game.js AUDIO ENGINE) in
//  plain Node and bakes every music track + SFX into .mp3 files under:
//      Audio/Music/*.mp3   and   Audio/SFX/*.mp3
//  The game then plays these samples instead of synthesising every note live
//  (which stuttered on phones because each 16th-note spawned ~10 WebAudio nodes
//  via setTimeout on the busy main thread).
//
//  Run:  node tools/gen-audio.js
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
let lamejs = null; // loaded via dynamic import() in main() — the working fork is ESM-only.

const SR = 44100;
const ROOT = path.join(__dirname, '..');
// Пишем прямо в assets/audio — единственное место, откуда игра читает звук
// (assets/audiofiles.js и IPC-мост в main.js). Раньше генератор складывал файлы
// в Audio/ в корне, и перенос делался руками: в итоге в игре месяцами лежали
// старые треки, а свежесгенерированные до неё просто не доезжали.
const OUT_MUSIC = path.join(ROOT, 'assets', 'audio', 'Music');
const OUT_SFX   = path.join(ROOT, 'assets', 'audio', 'SFX');
fs.mkdirSync(OUT_MUSIC, { recursive: true });
fs.mkdirSync(OUT_SFX,   { recursive: true });

// ── Волны без алиасинга («обычный» стиль) ────────────────────────────────────
// Наивные квадрат и пила — это и есть «восьмибитность»: у них бесконечный ряд
// гармоник, который на 48 кГц заворачивается обратно в слышимый диапазон и даёт
// характерный жёсткий призвук. Для обычного стиля собираем те же волны сложением
// ограниченного числа гармоник и кладём в таблицы, иначе синусы пришлось бы
// считать миллиардами.
//
// Таблиц несколько на волну — чем выше нота, тем меньше гармоник помещается до
// половины частоты дискретизации.
const TBL_SIZE = 2048;
const TBL_HARM = [64, 32, 16, 8, 4, 2, 1];
const tables = {};

function buildTables(type) {
  const out = TBL_HARM.map((limit) => {
    const t = new Float32Array(TBL_SIZE);
    for (let k = 1; k <= limit; k++) {
      let amp = 0, odd = k % 2 === 1;
      if (type === 'sawtooth') amp = 1 / k;
      else if (type === 'square') amp = odd ? 1 / k : 0;
      else if (type === 'triangle') amp = odd ? (1 / (k * k)) * (((k - 1) / 2) % 2 === 0 ? 1 : -1) : 0;
      else amp = k === 1 ? 1 : 0;                       // sine
      if (!amp) continue;
      for (let i = 0; i < TBL_SIZE; i++) t[i] += amp * Math.sin(2 * Math.PI * k * i / TBL_SIZE);
    }
    let peak = 0;
    for (let i = 0; i < TBL_SIZE; i++) peak = Math.max(peak, Math.abs(t[i]));
    if (peak > 0) for (let i = 0; i < TBL_SIZE; i++) t[i] /= peak;
    return t;
  });
  return out;
}
function tableFor(type, freq) {
  if (!tables[type]) tables[type] = buildTables(type);
  const maxH = Math.max(1, Math.floor((SR / 2) / Math.max(1, freq)));
  let li = 0;
  while (li < TBL_HARM.length - 1 && TBL_HARM[li] > maxH) li++;
  return tables[type][li];
}
function tableSample(tbl, phase01) {
  const x = (phase01 - Math.floor(phase01)) * TBL_SIZE;
  const i = x | 0, f = x - i;
  const a = tbl[i], b = tbl[(i + 1) & (TBL_SIZE - 1)];
  return a + (b - a) * f;
}

// ── Oscillator (naive — matches the chiptune character of the live synth) ─────
function oscSample(type, phase) {
  switch (type) {
    case 'sine':     return Math.sin(phase);
    case 'square':   return Math.sin(phase) >= 0 ? 1 : -1;
    case 'sawtooth': { const x = (phase / (2 * Math.PI)) % 1; return 2 * ((x + 1) % 1) - 1; }
    case 'triangle': { const x = ((phase / (2 * Math.PI)) % 1 + 1) % 1; return 4 * Math.abs(x - 0.5) - 1; }
    default:         return Math.sin(phase);
  }
}

// tone(): linear attack (default 5ms) to vol, then exponential decay to ~0 by `dur`.
function addTone(buf, startT, freq, type, dur, vol, detune = 0, attack = 0.005) {
  const f = freq * Math.pow(2, detune / 1200);
  const i0 = Math.floor(startT * SR);
  const n = Math.floor(dur * SR) + 2;
  const dec = Math.max(1e-6, dur - attack);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const idx = i0 + i; if (idx < 0) continue; if (idx >= buf.length) break;
    const t = i / SR;
    phase += 2 * Math.PI * f / SR;
    let g;
    if (attack > 0 && t < attack) g = vol * (t / attack);
    else g = vol * Math.pow(0.0001 / vol, Math.min(1, (t - attack) / dec));
    buf[idx] += oscSample(type, phase) * g;
  }
}

/**
 * Голос «обычного» стиля.
 *
 * Три вещи, которых нет у чиптюна и по которым ухо мгновенно отличает одно от
 * другого:
 *   расстройка — несколько слоёв, разведённых на считаные центы, дают биение и
 *                толщину вместо плоского одиночного тона;
 *   огибающая  — плавная атака и спад вместо мгновенного включения;
 *   фильтр     — верхи уходят по мере затухания ноты, как у живого инструмента.
 */
function addVoice(buf, startT, freq, type, dur, vol, opts) {
  const o = opts || {};
  const voices = o.voices || 3;
  const spread = o.spread === undefined ? 8 : o.spread;   // центы
  const attack = o.attack === undefined ? 0.012 : o.attack;
  const release = o.release === undefined ? 0.35 : o.release;
  const i0 = Math.floor(startT * SR);
  const total = dur + release;
  const n = Math.floor(total * SR) + 2;

  // Фильтр ведём вручную по однополюсной схеме: коэффициент пересчитывается
  // каждый сэмпл, поэтому срез действительно едет вниз вместе с нотой.
  const fStart = o.cutoff || Math.min(SR / 2.2, freq * 14 + 2600);
  const fEnd = o.cutoffEnd || Math.max(freq * 3, fStart * 0.4);
  let lp = 0;

  const phases = new Float32Array(voices);
  const incs = new Float32Array(voices);
  for (let v = 0; v < voices; v++) {
    const cents = voices === 1 ? 0 : (v - (voices - 1) / 2) * spread;
    incs[v] = (freq * Math.pow(2, cents / 1200)) / SR;
    phases[v] = v * 0.13;                                 // разный старт фазы
  }
  const tbl = tableFor(type, freq);
  const norm = vol / voices;

  for (let i = 0; i < n; i++) {
    const idx = i0 + i; if (idx < 0) continue; if (idx >= buf.length) break;
    const t = i / SR;
    let g;
    if (t < attack) g = t / attack;
    else if (t < dur) g = 1 - 0.25 * ((t - attack) / Math.max(1e-6, dur - attack));
    else g = Math.max(0, 0.75 * (1 - (t - dur) / release));
    // Выходим только когда нота действительно отзвучала. Условие «g <= 0» без
    // проверки времени обрывало КАЖДУЮ ноту на первом же сэмпле: в начале атаки
    // усиление равно нулю по определению.
    if (g <= 0 && t > attack) break;

    let s = 0;
    for (let v = 0; v < voices; v++) { phases[v] += incs[v]; s += tableSample(tbl, phases[v]); }
    s *= norm * g;

    const cut = fStart + (fEnd - fStart) * Math.min(1, t / total);
    const a = 1 - Math.exp(-2 * Math.PI * cut / SR);
    lp += a * (s - lp);
    buf[idx] += lp;
  }
}

/**
 * Реверберация Шрёдера: четыре гребенчатых фильтра параллельно, два фазовых
 * последовательно. У чиптюна пространства нет вовсе — именно оно и делает звук
 * «записанным», а не «выпиленным на месте».
 */
function reverb(buf, wet) {
  const combs = [1557, 1617, 1491, 1422, 1277, 1356].slice(0, 4)
    .map((d) => ({ d: Math.round(d * SR / 44100), b: null, i: 0, fb: 0.82 }));
  const allp = [225, 556].map((d) => ({ d: Math.round(d * SR / 44100), b: null, i: 0, g: 0.7 }));
  for (const c of combs) c.b = new Float32Array(c.d);
  for (const a of allp) a.b = new Float32Array(a.d);

  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    let y = 0;
    for (const c of combs) {
      const v = c.b[c.i];
      c.b[c.i] = x + v * c.fb;
      c.i = (c.i + 1) % c.d;
      y += v;
    }
    y *= 0.25;
    for (const a of allp) {
      const v = a.b[a.i];
      const o = -a.g * y + v;
      a.b[a.i] = y + a.g * o;
      a.i = (a.i + 1) % a.d;
      y = o;
    }
    out[i] = y;
  }
  for (let i = 0; i < buf.length; i++) buf[i] += out[i] * wet;
  return buf;
}

// sweep(): gain starts at vol, exponential decay; frequency exp-ramps f0→f1.
// attack — время нарастания: без него свип всегда врубается на полной громкости
// и «щёлкает». Для нарастающих звуков (зарядка выстрела, щит) это обязательно.
function addSweep(buf, startT, f0, f1, type, dur, vol, attack = 0) {
  const i0 = Math.floor(startT * SR);
  const n = Math.floor(dur * SR) + 2;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const idx = i0 + i; if (idx < 0) continue; if (idx >= buf.length) break;
    const t = i / SR;
    const f = f0 * Math.pow(f1 / f0, Math.min(1, t / dur));
    phase += 2 * Math.PI * f / SR;
    let g = vol * Math.pow(0.0001 / vol, Math.min(1, t / dur));
    if (attack > 0 && t < attack) g *= t / attack;
    buf[idx] += oscSample(type, phase) * g;
  }
}

// RBJ biquad (Direct Form I). Used for the music low-pass and the hat/snare filters.
function biquad(samples, type, freq, Q) {
  const w0 = 2 * Math.PI * freq / SR, cw = Math.cos(w0), sw = Math.sin(w0), alpha = sw / (2 * Q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lowpass')      { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; }
  else if (type === 'highpass'){ b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; }
  else /* bandpass (0 dB peak) */ { b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; }
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y; out[i] = y;
  }
  return out;
}

// noise(): white noise burst, optional filter, exponential decay from vol.
function addNoise(buf, startT, dur, vol, filter = null) {
  const i0 = Math.floor(startT * SR);
  const n = Math.floor(dur * SR);
  let raw = new Float32Array(n);
  for (let i = 0; i < n; i++) raw[i] = Math.random() * 2 - 1;
  if (filter) raw = biquad(raw, filter.type, filter.freq, filter.Q);
  for (let i = 0; i < n; i++) {
    const idx = i0 + i; if (idx < 0) continue; if (idx >= buf.length) break;
    const g = vol * Math.pow(0.0001 / vol, i / n);
    buf[idx] += raw[i] * g;
  }
}

/* ── Ударные «обычного» стиля ─────────────────────────────────────────────────
   Чиптюновые барабаны — это короткий шум и синус. Здесь у каждого удара есть
   тело, щелчок атаки и хвост: бочка ведёт высоту вниз и слегка перегружена,
   малый складывается из тона и полосового шума, хэт отфильтрован сверху. */
function addKickM(buf, startT, vol) {
  const i0 = Math.floor(startT * SR), n = Math.floor(0.42 * SR);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const idx = i0 + i; if (idx < 0) continue; if (idx >= buf.length) break;
    const t = i / SR;
    // Ниже 55 Гц бочка на обычных колонках не слышна, зато съедает весь запас
    // по громкости и читается как глухой топот. Держим её выше и короче.
    const f = 58 + (150 - 58) * Math.exp(-t / 0.024);     // высота падает
    phase += 2 * Math.PI * f / SR;
    const body = Math.sin(phase) * Math.exp(-t / 0.085);
    const click = t < 0.006 ? (Math.random() * 2 - 1) * (1 - t / 0.006) * 0.6 : 0;
    buf[idx] += Math.tanh((body + click) * 1.05) * vol * 0.72;
  }
}
function addSnareM(buf, startT, vol) {
  const i0 = Math.floor(startT * SR), n = Math.floor(0.26 * SR);
  let p1 = 0, p2 = 0;
  let nz = new Float32Array(n);
  for (let i = 0; i < n; i++) nz[i] = Math.random() * 2 - 1;
  nz = biquad(nz, 'bandpass', 2100, 0.6);
  for (let i = 0; i < n; i++) {
    const idx = i0 + i; if (idx < 0) continue; if (idx >= buf.length) break;
    const t = i / SR;
    p1 += 2 * Math.PI * 185 / SR; p2 += 2 * Math.PI * 248 / SR;
    const tone = (Math.sin(p1) + Math.sin(p2) * 0.7) * Math.exp(-t / 0.045);
    const body = nz[i] * Math.exp(-t / 0.11);
    buf[idx] += (tone * 0.5 + body) * vol * 1.1;
  }
}
function addHatM(buf, startT, vol) {
  const n = Math.floor(0.05 * SR);
  let nz = new Float32Array(n);
  for (let i = 0; i < n; i++) nz[i] = Math.random() * 2 - 1;
  nz = biquad(nz, 'highpass', 8200, 0.8);
  const i0 = Math.floor(startT * SR);
  for (let i = 0; i < n; i++) {
    const idx = i0 + i; if (idx < 0) continue; if (idx >= buf.length) break;
    // Полторы громкости: без наивных волн верх микса держится на одних хэтах,
    // и при прежнем уровне обычный стиль звучал глуховато.
    buf[idx] += nz[i] * Math.exp(-(i / SR) / 0.016) * vol * 1.6;
  }
}

// ── Percussion (route to the un-filtered drum bus) ───────────────────────────
function addKick(buf, startT, vol) {
  const i0 = Math.floor(startT * SR), dur = 0.18, fsw = 0.13, attack = 0.004;
  const n = Math.floor(0.2 * SR);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const idx = i0 + i; if (idx < 0) continue; if (idx >= buf.length) break;
    const t = i / SR;
    const f = 135 * Math.pow(45 / 135, Math.min(1, t / fsw));
    phase += 2 * Math.PI * f / SR;
    let g;
    if (t < attack) g = vol * (t / attack);
    else g = vol * Math.pow(0.0001 / vol, Math.min(1, (t - attack) / (dur - attack)));
    buf[idx] += Math.sin(phase) * g;
  }
}
function addHat(buf, startT, vol)   { addNoise(buf, startT, 0.03, vol, { type: 'highpass', freq: 7000, Q: 1 }); }
function addSnare(buf, startT, vol) {
  addNoise(buf, startT, 0.12, vol, { type: 'bandpass', freq: 1900, Q: 0.7 });
  addTone(buf, startT, 180, 'triangle', 0.09, vol * 0.5, 0, 0);
}

/**
 * Компрессор: подтягивает тихие места к громким.
 *
 * Нужен потому, что нормализация по пику опирается на самый громкий момент
 * трека, и всё, что тише, проваливается. Партитура уже выравнивает секции по
 * задуманной энергии, но реальная сумма волн от неё отличается — этим и
 * занимается компрессор, уже по факту звучания.
 *
 * Огибающая по модулю сигнала: быстрая атака, чтобы поймать удар бочки, и
 * медленное восстановление, чтобы между ударами не «дышало».
 */
function compress(buf, threshold, ratio, attackMs, releaseMs) {
  const aA = Math.exp(-1 / (SR * attackMs / 1000));
  const aR = Math.exp(-1 / (SR * releaseMs / 1000));
  let env = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = Math.abs(buf[i]);
    env = x > env ? aA * env + (1 - aA) * x : aR * env + (1 - aR) * x;
    let g = 1;
    if (env > threshold) g = (threshold + (env - threshold) / ratio) / env;
    buf[i] *= g;
  }
  return buf;
}

/**
 * Мастеринг: сжатие динамики, выравнивание по громкости и мягкое ограничение.
 *
 * Нормализуем по средней громкости, а не по пику. По пику нельзя: у чиптюна и
 * у обычного стиля разное соотношение пика к средней, и при равном пике
 * обычный оказывался в два с половиной раза громче — переключение стиля в
 * настройках било бы по ушам. Пики после этого подрезает tanh.
 */
const TARGET_RMS = 0.062;

function finalize(buf, targetPeak) {
  compress(buf, 0.22, 4, 6, 140);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / buf.length) || 1e-6;
  let norm = TARGET_RMS / rms;
  // Страховка от разгона тихого материала до хрипа.
  let peak = 0;
  for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > peak) peak = a; }
  if (peak * norm > 1.6) norm = 1.6 / peak;
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(buf[i] * norm) * (targetPeak || 0.9);
  return buf;
}

// ── Music data ───────────────────────────────────────────────────────────────
// Ноты берём из assets/music-data.js — единственного места, где они описаны.
// Раньше здесь лежала копия паттернов из game.js, и две копии успели разойтись.
const BBMusic = require('../assets/music-data.js');

// Печём целую композицию из assets/music-data.js — тот же список событий, что
// играет живой синтез, поэтому mp3 и запасной движок звучат одинаково.
//
// Хвост в 1,2 с сворачивается на начало: трек всё равно зациклен, а последняя
// секция и интро одинаково тихие, так что стык не слышен.
function renderMusic(song, style) {
  const { spb, steps } = song;
  const modern = style === 'modern';
  const loopT = spb * steps;
  // Обычному стилю нужен запас подлиннее: у нот есть спад, а у зала — хвост.
  const tail = modern ? 2.6 : 1.2;
  const N = Math.ceil((loopT + tail) * SR);
  const tonal = new Float32Array(N);
  const drums = new Float32Array(N);

  // Ноты звучат почти всю свою длительность — именно это отличает мелодию от
  // стаккатной долбёжки, которой трек был раньше.
  const dur = (len, k) => spb * len * (k === 'arp' ? 0.7 : 0.9);

  for (const e of song.events) {
    const at = e.step * spb;
    if (modern) {
      switch (e.k) {
        // Мелодия толще всего: три расстроенных слоя и подвижный фильтр.
        case 'lead':  addVoice(tonal, at, e.f, e.w, dur(e.len), e.vol * 1.45,
                        { voices: 3, spread: 9, attack: 0.014, release: 0.3 }); break;
        // Второй голос — октавой выше и тише: даёт «воздух», а не удвоение.
        case 'lead2': addVoice(tonal, at, e.f * 2, e.w, dur(e.len), e.vol * 0.62,
                        { voices: 2, spread: 14, attack: 0.03, release: 0.35 }); break;
        // Бас и субоктаву держим в узде: у плавных волн вся энергия собрана в
        // основном тоне, и при прежних множителях низ забивал собой весь микс.
        case 'bass':  addVoice(tonal, at, e.f, e.w, dur(e.len), e.vol * 0.58,
                        { voices: 2, spread: 5, attack: 0.008, release: 0.16,
                          cutoff: 1400, cutoffEnd: 420 }); break;
        case 'sub':   addVoice(tonal, at, e.f, 'sine', dur(e.len), e.vol * 0.32,
                        { voices: 1, attack: 0.01, release: 0.2 }); break;
        case 'arp':   addVoice(tonal, at, e.f, e.w, dur(e.len, 'arp'), e.vol * 0.9,
                        { voices: 2, spread: 12, attack: 0.006, release: 0.5,
                          cutoff: 6000, cutoffEnd: 2200 }); break;
        case 'kick':  addKickM(drums, at, e.vol); break;
        case 'snare': addSnareM(drums, at, e.vol); break;
        case 'hat':   addHatM(drums, at, e.vol); break;
      }
    } else {
      switch (e.k) {
        case 'lead':  addTone(tonal, at, e.f, e.w, dur(e.len), e.vol, 7); break;
        case 'lead2': addTone(tonal, at, e.f, e.w, dur(e.len), e.vol, -9); break;
        case 'bass':  addTone(tonal, at, e.f, e.w, dur(e.len), e.vol, 0); break;
        case 'sub':   addTone(tonal, at, e.f, e.w, dur(e.len), e.vol, 0); break;
        case 'arp':   addTone(tonal, at, e.f, e.w, dur(e.len, 'arp'), e.vol, 4); break;
        case 'kick':  addKick(drums, at, e.vol); break;
        case 'snare': addSnare(drums, at, e.vol); break;
        case 'hat':   addHat(drums, at, e.vol); break;
      }
    }
  }

  // Срез верхов — часть характера мира: тёмный лес глухой, лёд звонкий.
  // У обычного стиля волны и так без лишних гармоник, поэтому режем мягче:
  // тот же срез задушил бы его в вату.
  // У обычного стиля волны уже собраны из ограниченного числа гармоник, лишних
  // верхов в них нет. Поэтому режем гораздо выше — иначе он звучит как вата.
  const cut = song.bright || 5400;
  const tonalLP = biquad(tonal, 'lowpass', modern ? Math.min(SR / 2.4, cut * 3.2) : cut, 0.4);

  const loopN = Math.round(loopT * SR);
  const mix = new Float32Array(loopN);
  for (let i = 0; i < N; i++) mix[i % loopN] += tonalLP[i] + drums[i];
  // Зал добавляем после сворачивания петли, иначе стык был бы сухим.
  if (modern) reverb(mix, 0.22);
  return finalize(mix, 0.9);
}

// ── SFX definitions ──────────────────────────────────────────────────────────
// Берём из assets/sfx-data.js — оттуда же их играет живой синтез в game.js.
const BBSfx = require('../assets/sfx-data.js');
const SFX = BBSfx.SFX;

function renderSfx(events) {
  let end = 0;
  for (const e of events) end = Math.max(end, e.start + (e.dur || 0));
  const buf = new Float32Array(Math.ceil((end + 0.1) * SR));
  for (const e of events) {
    if (e.k === 'tone') addTone(buf, e.start, e.f, e.type, e.dur, e.vol, e.detune || 0, e.attack);
    else if (e.k === 'sweep') addSweep(buf, e.start, e.f0, e.f1, e.type, e.dur, e.vol, e.attack);
    else if (e.k === 'noise') addNoise(buf, e.start, e.dur, e.vol, e.filter);
  }
  // Soft-clip only (preserve relative SFX loudness; the SFX bus volume is a runtime slider).
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(buf[i] * 1.02) * 0.98;
  return buf;
}

// ── Encode Float32 (-1..1) mono → MP3 ─────────────────────────────────────────
function writeMp3(floatBuf, outPath, kbps) {
  const enc = new lamejs.Mp3Encoder(1, SR, kbps);
  const int16 = new Int16Array(floatBuf.length);
  for (let i = 0; i < floatBuf.length; i++) {
    let s = floatBuf[i]; if (s > 1) s = 1; else if (s < -1) s = -1;
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  const block = 1152, chunks = [];
  for (let i = 0; i < int16.length; i += block) {
    const mp3 = enc.encodeBuffer(int16.subarray(i, i + block));
    if (mp3.length) chunks.push(Buffer.from(mp3));
  }
  const end = enc.flush();
  if (end.length) chunks.push(Buffer.from(end));
  fs.writeFileSync(outPath, Buffer.concat(chunks));
  return fs.statSync(outPath).size;
}

// ── Run ───────────────────────────────────────────────────────────────────────
// 96 кбит/с моно: треки стали в двадцать раз длиннее, и прежние 160 кбит/с
// раздули бы папку до полусотни мегабайт. На квадратных и пилообразных волнах
// разницы на слух нет.
const MUSIC_KBPS = 96;

async function main() {
  lamejs = await import('@breezystack/lamejs');
  const manifest = { music: [], sfx: [] };

  // Два стиля звучания в отдельных папках: игрок выбирает в настройках.
  //   modern — расстроенные слои, огибающие, движение фильтра, зал;
  //   chip   — прежний чиптюн, наивные волны без всякой обработки.
  // Обе папки лежат рядом в assets/audio/Music/ — их удобно открыть и
  // послушать в любое время, это и есть смысл генератора.
  //
  // В СБОРКИ УЕЗЖАЕТ ТОЛЬКО modern/. Восьмибитный стиль в игре целиком играет
  // живой синтез (assets/audiofiles.js), поэтому класть его файлы в .exe и
  // .apk значит удваивать музыку впустую. Раньше chip/ выкладывался на сайт и
  // качался оттуда — от этого отказались: так весь саундтрек лежал в открытом
  // доступе и скачивался одной ссылкой.
  const STYLES = ['modern', 'chip'];
  manifest.styles = STYLES;
  let totalSec = 0;
  for (const style of STYLES) {
    const dir = path.join(OUT_MUSIC, style);
    fs.mkdirSync(dir, { recursive: true });
    console.log(`🎵 Rendering music (${style})...`);
    for (const name of Object.keys(BBMusic.TRACKS)) {
      const song = BBMusic.buildSong(name);
      const buf = renderMusic(song, style);
      const kb = writeMp3(buf, path.join(dir, name + '.mp3'), MUSIC_KBPS);
      if (style === STYLES[0]) { manifest.music.push(name); totalSec += song.seconds; }
      const mm = Math.floor(song.seconds / 60), ss = Math.round(song.seconds % 60);
      console.log(`  ✓ ${style}/${name}.mp3  ${mm}:${String(ss).padStart(2, '0')}  (${(kb / 1024).toFixed(0)} KB)`);
    }
    if (style === 'chip') console.log(`  → 8 бит только для прослушивания, в сборки не идёт: ${path.relative(ROOT, dir)}`);
  }
  console.log(`  музыки на стиль: ${(totalSec / 60).toFixed(1)} мин, стилей: ${STYLES.length}`);

  console.log('🔊 Rendering SFX...');
  for (const name of Object.keys(SFX)) {
    const buf = renderSfx(SFX[name]);
    const kb = writeMp3(buf, path.join(OUT_SFX, name + '.mp3'), 128);
    manifest.sfx.push(name);
    console.log(`  ✓ SFX/${name}.mp3  (${(kb / 1024).toFixed(1)} KB)`);
  }

  fs.writeFileSync(path.join(ROOT, 'assets', 'audio', 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('✅ Done. Wrote assets/audio/manifest.json');
}

main().catch(e => { console.error(e); process.exit(1); });
