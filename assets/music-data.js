// ===============================================================
//  BYTE BLASTER — МУЗЫКА: ЕДИНЫЙ ИСТОЧНИК
// ===============================================================
// Раньше трек был одним 16-шаговым паттерном, который крутился без конца: при
// 140 BPM это 1,7 секунды, и нота стояла на каждой шестнадцатой без единой
// паузы. Отсюда и «бесит» — не мелодия виновата, а то, что она долбит одну
// фразу и никогда не даёт тишины.
//
// Здесь описана нормальная композиция: аккордовая последовательность, несколько
// мелодических фраз с ритмом и паузами и форма — интро, куплеты, припев, брейк,
// бридж, финал. Получается 1,5–2,5 минуты без дословных повторов подряд.
//
// Файл один на две реализации, потому что раньше данные лежали и в game.js, и в
// tools/gen-audio.js двумя копиями, и они неизбежно разъезжались:
//
//   живой синтез  (assets/game.js)     — играет на телефоне и до загрузки mp3;
//   офлайн-рендер (tools/gen-audio.js) — печёт те же ноты в Audio/Music/*.mp3.
//
// Обе стороны зовут buildSong() и получают один и тот же список событий, так что
// разойтись они больше не могут.
(function (root) {
  'use strict';

  /* ── Лады ──────────────────────────────────────────────────────────────
     Семь ступеней, чтобы аккорды строились терциями (0-2-4 по ступеням). */
  const SC = {
    PENT: [0, 2, 4, 7, 9, 12, 14],       // мажорная пентатоника
    MIN:  [0, 2, 3, 5, 7, 8, 10],        // натуральный минор
    HARM: [0, 2, 3, 5, 7, 8, 11],        // гармонический минор
    DORI: [0, 2, 3, 5, 7, 9, 10],        // дорийский
    PHRY: [0, 1, 3, 5, 7, 8, 10],        // фригийский — самый «тёмный»
  };

  const hz = (base, semis) => base * Math.pow(2, semis / 12);

  /** Ступень лада → полутона, с переносом за пределы октавы. */
  function deg(sc, d) {
    const n = sc.length;
    const oct = Math.floor(d / n);
    return sc[((d % n) + n) % n] + oct * 12;
  }

  /* ── Ритмы ─────────────────────────────────────────────────────────────
     Такт = 16 шестнадцатых. Числа — длительности нот; сумма всегда 16.
     Паузы задаются отдельной маской: именно тишина отличает мелодию от
     бесконечной долбёжки. */
  const RHY = [
    [2, 2, 2, 2, 2, 2, 2, 2],   // ровные восьмые — основной ход
    [2, 2, 4, 2, 2, 4],
    [4, 2, 2, 4, 2, 2],
    [2, 2, 2, 2, 4, 4],
    [3, 1, 2, 2, 4, 4],         // синкопа
    [4, 4, 2, 2, 4],
    [2, 2, 4, 4, 4],
    [6, 2, 4, 4],
    [8, 4, 4],                  // длинные ноты — передышка
    [4, 4, 4, 4],
  ];
  // Какие ноты такта молчат (индексы в ритме). Одна-две паузы на такт: без них
  // мелодия долбит без остановки, но и злоупотреблять нельзя — иначе она
  // рассыпается и перестаёт вести.
  const RESTS = [
    [3], [2], [1], [4], [1], [2], [3], [1], [], [2],
  ];

  /* ── Контуры ───────────────────────────────────────────────────────────
     Смещения по ступеням лада относительно тона аккорда. Не случайные ноты, а
     узнаваемые формы: подъём, арка, спуск, скачок с возвратом. */
  const CONT = [
    [0, 1, 2, 4],
    [0, 2, 4, 2],
    [4, 2, 1, 0],
    [0, 4, 2, 3],
    [0, -1, 2, 4],
    [2, 4, 3, 0],
    [0, 2, -1, 1],
    [4, 3, 2, 0],
    [0, 3, 2, 4],
    [2, 0, 4, 2],
  ];

  /** Небольшой детерминированный ГПСЧ: один и тот же трек звучит одинаково. */
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5;  s >>>= 0;
      return s / 4294967296;
    };
  }

  /**
   * Фраза из четырёх тактов: два раза мотив, развитие, каденция с возвратом в
   * тонику. Это самая обычная песенная логика — она и делает мелодию
   * запоминающейся, а не бесконечной.
   */
  function phrase(seed, spread) {
    const r = rng(seed);
    const pick = (arr) => Math.floor(r() * arr.length) % arr.length;
    const ri = [pick(RHY), pick(RHY), pick(RHY), 3];
    const ci = [pick(CONT), pick(CONT), pick(CONT), 2];
    const bars = [];

    for (let b = 0; b < 4; b++) {
      const rhythm = RHY[ri[b]];
      const rests = RESTS[ri[b]];
      const contour = CONT[ci[b]];
      const notes = [];
      let step = 0;
      for (let i = 0; i < rhythm.length; i++) {
        const len = rhythm[i];
        // Последний такт — каденция: приходим в тонику и замолкаем.
        const isLast = b === 3 && i >= rhythm.length - 1;
        const rest = rests.indexOf(i) >= 0;
        if (!rest) {
          let d = isLast ? 0 : contour[i % contour.length];
          // Второй такт — тот же мотив ступенью выше: развитие, а не копия.
          if (b === 1) d += 1;
          if (b === 2) d += spread;
          notes.push({ at: step, len, d });
        }
        step += len;
      }
      bars.push(notes);
    }
    return bars;
  }

  /* ── Форма ─────────────────────────────────────────────────────────────
     Слои включаются и выключаются по секциям — именно смена плотности читается
     на слух как «песня идёт», а не «петля крутится».
       drums: 0 нет | 1 только бочка | 2 полный грув
       lead:  0 молчит | 1 мелодия | 2 мелодия октавой выше
       arp:   бегущее арпеджио на фоне
       bass:  басовая линия  */
  // Интро короткое и уже с пульсом. Четыре такта без мелодии и без ударных
  // читались не как вступление, а как «музыка не включилась».
  const INTRO = [
    { ph: 0, bars: 2, drums: 1, lead: 0, arp: 1, bass: 1 },
  ];
  const BODY = [
    { ph: 0, bars: 4, drums: 1, lead: 1, arp: 0, bass: 1 },  // куплет
    { ph: 0, bars: 4, drums: 2, lead: 1, arp: 1, bass: 1 },
    { ph: 1, bars: 4, drums: 2, lead: 2, arp: 1, bass: 1 },  // припев
    { ph: 1, bars: 4, drums: 2, lead: 2, arp: 1, bass: 1 },
    { ph: 0, bars: 2, drums: 1, lead: 0, arp: 1, bass: 1 },  // брейк — бочку и бас
                                                             // держим, иначе дыра
    { ph: 2, bars: 4, drums: 1, lead: 1, arp: 0, bass: 1 },  // бридж
    { ph: 2, bars: 4, drums: 2, lead: 1, arp: 1, bass: 1 },
  ];
  const OUTRO = [
    { ph: 1, bars: 4, drums: 2, lead: 2, arp: 1, bass: 1 },  // последний припев
    { ph: 0, bars: 4, drums: 1, lead: 1, arp: 1, bass: 1 },  // финал
    { ph: 0, bars: 2, drums: 1, lead: 0, arp: 1, bass: 1 },  // затихание
  ];

  // Короткая форма для служебных тем: победа и звезда звучат считаные секунды,
  // полноценная песня там просто не успеет прозвучать.
  const FORM_SHORT = [
    { ph: 0, bars: 2, drums: 1, lead: 1, arp: 1, bass: 1 },
    { ph: 1, bars: 4, drums: 2, lead: 2, arp: 1, bass: 1 },
    { ph: 0, bars: 4, drums: 2, lead: 1, arp: 1, bass: 1 },
    { ph: 1, bars: 2, drums: 2, lead: 2, arp: 1, bass: 1 },
  ];

  // Фанфара. У победы нет времени на разгон: она должна вступать сразу в полную
  // силу, иначе звучит как обычный куплет, который просто закончился. Прежняя
  // тема начиналась вполсилы и ровно этим и грешила.
  const FORM_FANFARE = [
    { ph: 1, bars: 2, drums: 2, lead: 2, arp: 1, bass: 1 },   // удар с порога
    { ph: 1, bars: 2, drums: 2, lead: 2, arp: 1, bass: 1 },
    { ph: 0, bars: 2, drums: 2, lead: 1, arp: 1, bass: 1 },   // ответная фраза
    { ph: 1, bars: 4, drums: 2, lead: 2, arp: 1, bass: 1 },   // возврат темы
    { ph: 1, bars: 2, drums: 1, lead: 2, arp: 1, bass: 1 },   // разрешение
  ];

  /**
   * Сколько раз повторить основной блок, чтобы трек лёг в 1,5–2,5 минуты вне
   * зависимости от темпа. Иначе быстрые миры кончались бы за минуту, а
   * медленные тянулись бы вчетверо дольше.
   */
  function buildForm(bpm) {
    const barSec = (60 / bpm / 4) * 16;
    const fixed = (2 + 10) * barSec;                 // интро + финал
    const bodyBars = 26;
    let n = Math.round((110 - fixed) / (bodyBars * barSec));
    n = Math.max(1, Math.min(3, n));
    const form = INTRO.slice();
    for (let i = 0; i < n; i++) form.push(...BODY);
    return form.concat(OUTRO);
  }

  /* ── Характер ──────────────────────────────────────────────────────────
     Одних только разных нот мало: если у всех треков один состав инструментов,
     один рисунок ударных и одинаковое арпеджио, миры звучат на одно лицо. Здесь
     задаётся подача — она и делает лаву тяжёлой, а ледяные пещеры просторными.

       lead/bassW/arpW  тембр каждого слоя по отдельности;
       drums   'four'   бочка на каждую долю — ровный ход;
               'half'   вдвое реже, тяжело;
               'break'  ломаный бит;
               'tribal' частая бочка, редкий малый — «племенной»;
               'march'  маршевая дробь малого;
               'sparse' почти нет — простор;
       hats    0 нет · 1 четверти · 2 восьмые · 3 шестнадцатые (гонит вперёд);
       bassS   'drive' четвертями · 'pulse' восьмыми · 'hold' одна длинная ·
               'octave' прыжок через октаву;
       arpS    'run' восьмыми · 'slow' четвертями · 'shimmer' высоко и редко ·
               'none';
       echo    отражение мелодии через N шагов — пещеры и космос;
       bright  срез верхов при запекании: лес глухой, лёд звонкий. */
  const CH = (o) => Object.assign({
    lead: 'square', bassW: 'square', arpW: 'triangle',
    drums: 'four', hats: 2, bassS: 'drive', arpS: 'run', echo: 0, bright: 5400,
  }, o);

  /* ── Треки ─────────────────────────────────────────────────────────────
     prog — ступени лада, по одному аккорду на такт, повторяется по кругу.
     seed — из него растут мелодические фразы, поэтому миры не повторяют друг
     друга, но каждый воспроизводится одинаково при каждой сборке.
     Темп: держим 96–150 у миров. Раньше было и слишком медленно, и слишком
     быстро — гнало вперёд не столько BPM, сколько шестнадцатые в хэтах и
     непрерывное арпеджио, поэтому и то и другое теперь разное по мирам. */
  const T = (o) => {
    const t = Object.assign({ sc: SC.MIN, spread: 2 }, o);
    t.ch = CH(t.ch || {});
    if (!t.form) t.form = buildForm(t.bpm);
    return t;
  };

  const TRACKS = {
    menu:    T({ bpm: 104, base: 261.63, sc: SC.PENT, prog: [0, 5, 3, 4], seed: 1071,
      ch: { lead: 'triangle', bassW: 'triangle', drums: 'sparse', hats: 1, bassS: 'hold', arpS: 'slow', bright: 4800 } }),
    boss:    T({ bpm: 150, base: 110,    sc: SC.PHRY, prog: [0, 0, 1, 0, 4, 4, 1, 0], seed: 6602, spread: 3,
      ch: { lead: 'sawtooth', bassW: 'sawtooth', drums: 'break', hats: 3, bassS: 'pulse', bright: 6200 } }),
    star:    T({ bpm: 168, base: 329.63, sc: SC.PENT, prog: [0, 3, 4, 3], seed: 3310, form: FORM_SHORT,
      ch: { drums: 'four', hats: 3, arpS: 'run', bright: 7000 } }),
    // Победа: мажорная пентатоника, ход I–IV–V–I, пила вместо треугольника —
    // она читается как духовые, а не как колыбельная. Маршевый малый и бас
    // через октаву добавляют поступь.
    victory: T({ bpm: 108, base: 349.23, sc: SC.PENT, prog: [0, 3, 4, 0], seed: 8890, form: FORM_FANFARE,
      ch: { lead: 'sawtooth', bassW: 'square', arpW: 'triangle', drums: 'march', hats: 2,
            bassS: 'octave', arpS: 'run', bright: 7400 } }),
    // Карта мира: раньше на ней играла тема меню. Здесь простор и любопытство —
    // медленно, высоко, с эхом и почти без ударных.
    worldmap: T({ bpm: 96, base: 293.66, sc: SC.PENT, prog: [0, 4, 5, 3], seed: 4711,
      ch: { lead: 'sine', bassW: 'triangle', arpW: 'sine', drums: 'sparse', hats: 1,
            bassS: 'hold', arpS: 'shimmer', echo: 6, bright: 8200 } }),

    // 🏙 Неоновый мегаполис: ровный ход, всё блестит и движется.
    world0:  T({ bpm: 126, base: 261.63, sc: SC.PENT, prog: [0, 4, 5, 3], seed: 1001,
      ch: { lead: 'square', bassW: 'sawtooth', drums: 'four', hats: 3, bassS: 'pulse', arpS: 'run', bright: 6400 } }),
    // 🌿 Джунгли: ломаный «живой» ритм, тёплые тембры.
    world1:  T({ bpm: 118, base: 220,    sc: SC.DORI, prog: [0, 5, 3, 4], seed: 2002,
      ch: { lead: 'triangle', bassW: 'triangle', drums: 'tribal', hats: 2, bassS: 'octave', arpS: 'slow', bright: 5000 } }),
    // 🌋 Лава: тяжело и вдвое реже — вес важнее скорости.
    world2:  T({ bpm: 108, base: 174.61, sc: SC.PHRY, prog: [0, 1, 0, 4], seed: 3003, spread: 3,
      ch: { lead: 'sawtooth', bassW: 'sawtooth', drums: 'half', hats: 1, bassS: 'hold', arpS: 'none', bright: 3600 } }),
    // ❄ Ледяные пещеры: простор, эхо, звонкий верх, почти нет ударных.
    world3:  T({ bpm: 100, base: 329.63, sc: SC.PENT, prog: [0, 5, 1, 4], seed: 4004,
      ch: { lead: 'sine', bassW: 'triangle', arpW: 'sine', drums: 'sparse', hats: 0, bassS: 'hold', arpS: 'shimmer', echo: 6, bright: 8000 } }),
    // 🏜 Пустыня: гармонический минор даёт восточный оттенок, шаг размеренный.
    world4:  T({ bpm: 112, base: 220,    sc: SC.HARM, prog: [0, 4, 5, 4], seed: 5005,
      ch: { lead: 'sawtooth', bassW: 'square', drums: 'march', hats: 1, bassS: 'drive', arpS: 'slow', bright: 4600 } }),
    // 🛸 Станция: механический пульс, холодные синусы, эхо отсека.
    world5:  T({ bpm: 122, base: 277.18, sc: SC.DORI, prog: [0, 3, 0, 4], seed: 6006,
      ch: { lead: 'sine', bassW: 'square', arpW: 'square', drums: 'sparse', hats: 2, bassS: 'pulse', arpS: 'shimmer', echo: 8, bright: 6800 } }),
    // 🌲 Тёмный лес: самый глухой и тихий мир в игре.
    world6:  T({ bpm: 96,  base: 196,    sc: SC.MIN,  prog: [0, 3, 5, 4], seed: 7007,
      ch: { lead: 'triangle', bassW: 'triangle', drums: 'sparse', hats: 0, bassS: 'hold', arpS: 'none', bright: 3000 } }),
    // ☣ Токсичная зона: нервный ломаный бит, кислотная пила.
    world7:  T({ bpm: 134, base: 233.08, sc: SC.PHRY, prog: [0, 1, 4, 3], seed: 8008, spread: 3,
      ch: { lead: 'sawtooth', bassW: 'sawtooth', arpW: 'sawtooth', drums: 'break', hats: 3, bassS: 'pulse', arpS: 'run', bright: 7200 } }),
    // ⚡ Грозовые вершины: мощно и широко, но не суетливо.
    world8:  T({ bpm: 128, base: 261.63, sc: SC.DORI, prog: [0, 4, 3, 5], seed: 9009, spread: 3,
      ch: { lead: 'sawtooth', bassW: 'sawtooth', drums: 'four', hats: 2, bassS: 'octave', arpS: 'run', echo: 4, bright: 6600 } }),
    // 🔱 Крепость: марш, гармонический минор, тяжёлый шаг.
    world9:  T({ bpm: 120, base: 196,    sc: SC.HARM, prog: [0, 1, 4, 0, 0, 5, 4, 4], seed: 1110, spread: 3,
      ch: { lead: 'sawtooth', bassW: 'square', drums: 'march', hats: 2, bassS: 'octave', arpS: 'slow', bright: 5200 } }),
    // 🌈 Призматическая аномалия: секретный мир, всё «переливается».
    world10: T({ bpm: 116, base: 293.66, sc: SC.DORI, prog: [0, 2, 4, 6], seed: 1211,
      ch: { lead: 'sine', bassW: 'triangle', arpW: 'sine', drums: 'sparse', hats: 2, bassS: 'hold', arpS: 'shimmer', echo: 3, bright: 9000 } }),
  };

  /* ── Сборка ────────────────────────────────────────────────────────────
     Разворачиваем форму в плоский список событий по шагам. Обе реализации
     работают с этим списком и потому звучат одинаково. */
  /**
   * Компенсация громкости секции.
   *
   * Слоёв в интро два, а в припеве шесть — без поправки припев звучит втрое
   * громче, и после нормализации по пику интро проваливается в тишину. Считаем
   * ожидаемую энергию секции (мощности складываются, поэтому корень из суммы
   * квадратов) и подтягиваем тихие секции к общему уровню.
   *
   * Полностью выравнивать нельзя — тогда пропадёт та самая динамика, ради
   * которой форма и затевалась. Поэтому компенсируем не до конца, а на 75%, и
   * не даём поднять больше чем вдвое.
   */
  function sectionGain(sec, ch) {
    const w = [];
    if (sec.lead) w.push(0.11, 0.05);
    if (sec.bass) w.push(0.15, 0.07);
    // Считаем арпеджио, только если мир его вообще играет: иначе тихие миры
    // недополучали компенсацию и звучали ещё тише.
    if (sec.arp && ch.arpS !== 'none') w.push(ch.arpS === 'shimmer' ? 0.038 : 0.055);
    if (sec.drums >= 1) w.push(0.30);
    if (sec.drums >= 2) w.push(ch.hats ? 0.18 : 0.12);
    const energy = Math.sqrt(w.reduce((s, v) => s + v * v, 0)) || 0.01;
    const FULL = Math.sqrt(0.11 ** 2 + 0.05 ** 2 + 0.15 ** 2 + 0.07 ** 2 + 0.055 ** 2 + 0.30 ** 2 + 0.18 ** 2);
    const g = Math.pow(FULL / energy, 0.9);
    return Math.min(3.2, g);
  }

  function buildSong(track) {
    const t = typeof track === 'string' ? TRACKS[track] : track;
    if (!t) return null;
    const sc = t.sc, base = t.base, prog = t.prog, ch = t.ch || CH({});
    const phrases = [phrase(t.seed, t.spread), phrase(t.seed + 77, t.spread), phrase(t.seed + 149, t.spread)];
    const ev = [];
    let bar = 0;

    for (const sec of t.form) {
      const ph = phrases[sec.ph % phrases.length];
      const G = sectionGain(sec, ch);
      for (let b = 0; b < sec.bars; b++, bar++) {
        const step0 = bar * 16;
        const root = prog[bar % prog.length];

        // Мелодия. Ступени контура отсчитываются от тона текущего аккорда,
        // поэтому она сама собой попадает в гармонию.
        if (sec.lead) {
          const oct = sec.lead === 2 ? 12 : 0;
          for (const n of ph[b % ph.length]) {
            const f = hz(base, deg(sc, root + n.d) + oct);
            ev.push({ step: step0 + n.at, k: 'lead', w: ch.lead, f, len: n.len, vol: 0.11 * G });
            ev.push({ step: step0 + n.at, k: 'lead2', w: ch.lead, f, len: n.len, vol: 0.05 * G });
            // Отражение: пещеры и открытый космос без него звучат как коробка.
            if (ch.echo) {
              ev.push({ step: step0 + n.at + ch.echo, k: 'lead2', w: ch.lead, f,
                len: n.len, vol: 0.045 * G });
            }
          }
        }

        // Бас. Рисунок задаёт мир: ровный шаг, восьмые, одна длинная нота или
        // прыжок через октаву.
        if (sec.bass) {
          const rootF = hz(base * 0.5, deg(sc, root));
          const hits =
            ch.bassS === 'hold' ? [[0, 15]] :
            ch.bassS === 'pulse' ? [0, 2, 4, 6, 8, 10, 12, 14].map((s) => [s, 1]) :
            ch.bassS === 'octave' ? [[0, 3], [4, 3], [8, 3], [12, 3]] :
            [[0, 3], [4, 3], [8, 3], [12, 3]];
          hits.forEach(([s, len], i) => {
            const up = ch.bassS === 'octave' && i % 2 === 1;
            const f = up ? rootF * 2 : rootF;
            ev.push({ step: step0 + s, k: 'bass', w: ch.bassW, f, len, vol: 0.15 * G });
            ev.push({ step: step0 + s, k: 'sub', w: 'triangle', f: rootF * 0.5, len, vol: 0.07 * G });
          });
        }

        // Арпеджио — трезвучие аккорда фоном. Именно оно сильнее всего гонит
        // темп вперёд, поэтому в тяжёлых и тихих мирах его нет вовсе.
        if (sec.arp && ch.arpS !== 'none') {
          const tones = [0, 2, 4, 2];
          const cfg =
            ch.arpS === 'slow' ? { n: 4, every: 4, oct: 12, vol: 0.055, len: 3 } :
            ch.arpS === 'shimmer' ? { n: 4, every: 4, oct: 24, vol: 0.038, len: 3 } :
            { n: 8, every: 2, oct: 12, vol: 0.055, len: 1 };
          for (let i = 0; i < cfg.n; i++) {
            const f = hz(base, deg(sc, root + tones[i % tones.length]) + cfg.oct);
            ev.push({ step: step0 + i * cfg.every, k: 'arp', w: ch.arpW, f, len: cfg.len, vol: cfg.vol * G });
          }
        }

        // Ударные. Рисунок бочки и малого — половина характера мира.
        if (sec.drums >= 1) {
          const kicks =
            ch.drums === 'half' ? [0, 8] :
            ch.drums === 'break' ? [0, 6, 10] :
            ch.drums === 'tribal' ? [0, 3, 6, 10, 13] :
            ch.drums === 'sparse' ? [0, 8] :
            [0, 4, 8, 12];
          for (const s of kicks) ev.push({ step: step0 + s, k: 'kick', vol: 0.42 * G });
        }
        if (sec.drums >= 2) {
          const snares =
            ch.drums === 'half' ? [8] :
            ch.drums === 'tribal' ? [12] :
            ch.drums === 'march' ? [2, 6, 10, 14] :
            ch.drums === 'sparse' ? [12] :
            [4, 12];
          for (const s of snares) ev.push({ step: step0 + s, k: 'snare', vol: 0.15 * G });
          // Шестнадцатые в хэтах — самый сильный ускоритель на слух, поэтому
          // плотность задаётся миром, а не одинаково для всех.
          const every = ch.hats === 3 ? 1 : ch.hats === 2 ? 2 : ch.hats === 1 ? 4 : 0;
          if (every) {
            for (let i = 0; i < 16; i += every) {
              if (i % 4 === 0 && every > 1) continue;         // не спорим с бочкой
              ev.push({ step: step0 + i, k: 'hat', vol: (i % 4 === 2 ? 0.05 : 0.03) * G });
            }
          }
        }
      }
    }

    const steps = bar * 16;
    // Эхо могло уехать за последний такт — заворачиваем в начало, трек зациклен.
    for (const e of ev) if (e.step >= steps) e.step -= steps;
    ev.sort((a, b) => a.step - b.step);
    return {
      steps,
      spb: 60 / t.bpm / 4,          // секунд на шестнадцатую
      bright: ch.bright,            // срез верхов при запекании
      seconds: steps * (60 / t.bpm / 4),
      events: ev,
    };
  }

  /** События, сгруппированные по шагу — так их удобно проигрывать вживую. */
  function byStep(song) {
    const map = new Array(song.steps);
    for (const e of song.events) {
      (map[e.step] || (map[e.step] = [])).push(e);
    }
    return map;
  }

  const api = { SC, TRACKS, buildSong, byStep, hz, deg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BBMusic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
