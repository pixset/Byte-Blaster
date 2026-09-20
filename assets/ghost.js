// ═══════════════════════════════════════════════════════════════════════════
//  ПРИЗРАК ЛУЧШЕГО ЗАБЕГА
//
//  Полупрозрачный робот бежит рядом и повторяет чей-то прошлый заход. Ни на
//  что не влияет: ни столкновений, ни урона — только видно, где ты отстал.
//
//  ЧТО ЗАПИСЫВАЕТСЯ. Путь, а не нажатия. Нажатия занимали бы меньше места, но
//  воспроизвести их можно только в полностью детерминированной симуляции: у нас
//  же на игрока влияют враги, отскоки и таймеры, и малейшее расхождение уводит
//  «призрака» в стену на второй секунде. Путь врать не может — он показывает
//  ровно то, что было.
//
//  СКОЛЬКО ЭТО ВЕСИТ. Точка пишется каждый третий кадр (20 в секунду), координаты
//  округляются до пикселя и хранятся разницей с предыдущей: почти всегда это
//  один байт на ось. Трёхминутный уровень — около 8 КБ текста, потолок на
//  сервере 48 КБ (см. миграцию 0018).
//
//  НАСТРОЙКА. «Призрак» в разделе «Игра»: выключен (по умолчанию), свой рекорд,
//  лидер уровня дня, лидер любого уровня. Выключен именно по умолчанию — режим
//  для тех, кто хочет гонки, а не для всех подряд.
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const root = window;
  const SUPABASE_URL = 'https://zyjhvuhovimorpokiwty.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_1bj04J3qsO1EqsKPQeSbmg_cBDEtreK';
  const GAME = 'byte-blaster';

  const STEP = 3;                 // кадров между точками пути
  const MAX_POINTS = 24000;       // потолок: 20 точек/с × 20 минут
  const LOCAL_KEEP = 12;          // сколько своих записей держим на устройстве
  const LS_KEY = 'bbGhosts';

  const T = (k, d) => (typeof root.t === 'function' && root.t(k) !== k) ? root.t(k) : d;
  const mode = () => (root.gameSettings && root.gameSettings.ghost) || 'off';

  /* ── Кодирование пути ────────────────────────────────────────────────────
     Точка — это dx, dy и флаги (куда смотрит, оторван ли от земли). Дельты
     почти всегда влезают в один байт; когда не влезают (респавн, телепорт),
     ставим escape-байт и пишем координату целиком. Всё это уезжает в base64,
     потому что колонка на сервере текстовая. */
  const ESC = 0x80;                // «дальше две абсолютные координаты»

  function encode(points) {
    const out = [];
    let px = 0, py = 0;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const dx = p.x - px, dy = p.y - py;
      if (i === 0 || dx < -120 || dx > 120 || dy < -120 || dy > 120) {
        out.push(ESC, (p.x >> 8) & 0xff, p.x & 0xff, (p.y >> 8) & 0xff, p.y & 0xff, p.f);
      } else {
        // Величина и знак хранятся врозь: дополнительный код здесь не годится —
        // байт величины должен остаться меньше ESC, иначе декодер примет его за
        // начало абсолютной записи.
        out.push(Math.abs(dx), Math.abs(dy),
                 ((dx < 0) ? 1 : 0) | ((dy < 0) ? 2 : 0) | (p.f << 2));
      }
      px = p.x; py = p.y;
    }
    let bin = '';
    for (let i = 0; i < out.length; i++) bin += String.fromCharCode(out[i] & 0xff);
    try { return btoa(bin); } catch (e) { return ''; }
  }

  function decode(text) {
    let bin;
    try { bin = atob(text || ''); } catch (e) { return []; }
    const pts = [];
    let x = 0, y = 0, i = 0;
    while (i < bin.length) {
      const b = bin.charCodeAt(i);
      if (b === ESC) {
        if (i + 6 > bin.length) break;
        x = (bin.charCodeAt(i + 1) << 8) | bin.charCodeAt(i + 2);
        y = (bin.charCodeAt(i + 3) << 8) | bin.charCodeAt(i + 4);
        pts.push({ x, y, f: bin.charCodeAt(i + 5) & 1 });
        i += 6;
      } else {
        if (i + 3 > bin.length) break;
        const flags = bin.charCodeAt(i + 2);
        const dx = (flags & 1) ? -b : b;
        const dy = (flags & 2) ? -bin.charCodeAt(i + 1) : bin.charCodeAt(i + 1);
        x += dx; y += dy;
        pts.push({ x, y, f: (flags >> 2) & 1 });
        i += 3;
      }
    }
    return pts;
  }

  /* ── Своё хранилище ──────────────────────────────────────────────────────
     Держим на устройстве только последние записи: гоняются с собой на том
     уровне, который сейчас проходят, а не на всех ста десяти сразу. */
  function readStore() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }

  function writeStore(store) {
    const keys = Object.keys(store);
    if (keys.length > LOCAL_KEEP) {
      keys.sort((a, b) => (store[a].at || 0) - (store[b].at || 0));
      keys.slice(0, keys.length - LOCAL_KEEP).forEach((k) => { delete store[k]; });
    }
    try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch (e) { /* переполнено — переживём */ }
  }

  /* ── Сервер ──────────────────────────────────────────────────────────── */
  async function token() {
    if (!root.License || !root.License.loggedIn || !root.License.loggedIn()) return null;
    return root.License.accessToken ? root.License.accessToken() : null;
  }

  async function rpc(fn, args, needAuth) {
    const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_KEY };
    const tk = await token();
    if (tk) headers.Authorization = 'Bearer ' + tk;
    else if (needAuth) throw new Error('not_logged_in');
    const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST', headers, body: JSON.stringify(args),
    });
    if (!res.ok) throw new Error('rpc_failed');
    return res.json();
  }

  /* ── Состояние забега ────────────────────────────────────────────────── */
  let ctxKey = null;        // что за уровень идёт: {kind, level, hardcore, slot}
  let rec = null;           // записываемый путь
  let play = null;          // { pts, i, who } — призрак, которого показываем
  let frame = 0;

  function keyOf(c) {
    return c.kind === 'daily'
      ? 'd:' + (c.slot || '') + ':' + (root.Daily ? root.Daily.todayUTC() : '')
      : 'l:' + (c.level | 0) + ':' + (c.hardcore ? 'h' : 'n');
  }

  /** Начало уровня: закрываем прошлую запись и решаем, кого показывать. */
  function begin(c) {
    ctxKey = c || null;
    rec = ctxKey ? [] : null;
    play = null;
    frame = 0;
    if (!ctxKey) return;

    const m = mode();
    if (m === 'off') return;

    if (m === 'mine') {
      const saved = readStore()[keyOf(ctxKey)];
      if (saved && saved.data) play = { pts: decode(saved.data), i: 0, who: T('ghostMine', 'ваш рекорд') };
      return;
    }
    // Лидер: у уровня дня — лидер дня, у кампании — лидер этого уровня.
    // «Только день» и «везде» отличаются лишь тем, спрашиваем ли мы сервер вне дня.
    if (m === 'dailyLeader' && ctxKey.kind !== 'daily') return;
    loadLeader(ctxKey);
  }

  async function loadLeader(c) {
    const args = c.kind === 'daily'
      ? { p_game_slug: GAME, p_kind: 'daily', p_slot: c.slot }
      : { p_game_slug: GAME, p_kind: 'level', p_level: c.level | 0, p_hardcore: !!c.hardcore };
    let rows;
    try { rows = await rpc('get_ghost', args); } catch (e) { return; }
    const row = rows && rows[0];
    if (!row || !row.data) return;
    // Уровень мог смениться, пока летел запрос.
    if (!ctxKey || keyOf(ctxKey) !== keyOf(c)) return;
    play = { pts: decode(row.data), i: 0, who: row.nickname || T('ghostLeader', 'лидер') };
  }

  /* Кадр записи. Зовётся из update() игры.
     Счётчик кадров ОБЩИЙ для записи и воспроизведения — см. step(). */
  function record(p) {
    if (!rec) return;
    // Кадр считаем всегда, даже если робота сейчас нет (гибель, перерождение,
    // смена сцены). Раньше выход стоял до счётчика: запись эти кадры
    // пропускала, а воспроизведение — нет, и чужой призрак с каждой такой
    // паузой уходил вперёд. За уровень набегало столько, что он «заканчивался»
    // где-то на середине — со стороны это выглядело так, будто он умер.
    frame++;
    if (!p) return;
    if (frame % STEP) return;
    if (rec.length >= MAX_POINTS) return;
    rec.push({ x: Math.round(p.x), y: Math.round(p.y), f: p.facing < 0 ? 1 : 0 });
  }

  /* Кадр воспроизведения.
     Отдельного счётчика у призрака нет намеренно: он идёт по тому же `frame`,
     что и запись, поэтому обогнать её не может в принципе. */
  function step() { /* оставлено ради совместимости вызова из update() */ }

  /** Отрисовка. Зовётся из draw() игры, в мировых координатах. */
  function draw(ctx) {
    if (!play || !play.pts.length) return;
    const at = frame / STEP;
    const last = play.pts.length - 1;
    // Запись кончилась — призрак уже финишировал. Оставляем его стоять на
    // последней точке, а не растворяем: исчезнувший силуэт читается как
    // «сломался», а стоящий у флага — как «он тут раньше тебя».
    const i = Math.min(Math.floor(at), last);
    const a = play.pts[i], b = play.pts[Math.min(i + 1, last)];
    const t = (i < last) ? (at - i) : 0;
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    if (x < (root.camX || 0) - 80 || x > (root.camX || 0) + (root.W || 1280) + 80) return;

    ctx.save();
    ctx.globalAlpha = 0.42;
    if (typeof root.drawByteRobot === 'function') {
      // Робот призрака рисуется тем же спрайтом, что и живой, — иначе рядом
      // бежали бы два разных существа. Схема серая: гонка идёт с результатом,
      // а не с чужим цветом.
      root.drawByteRobot(ctx, x + 12, y + 32, 1, { h: 200, s: 10, l: 70 }, 0, a.f ? -1 : 1);
    } else {
      ctx.fillStyle = 'rgba(200,220,255,0.6)';
      ctx.fillRect(x, y, 24, 32);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /** Подпись «с кем гонка» для HUD. Пусто, если призрака нет. */
  function label() { return play ? play.who : ''; }

  /**
   * Конец забега. Записываем свой путь на устройство и, если это рекорд,
   * отправляем на сервер — там он станет призраком «лидера» для остальных.
   */
  async function finish(score, ok) {
    if (!ctxKey || !rec || rec.length < 4) return;
    const key = keyOf(ctxKey);
    const data = encode(rec);
    if (!data) return;

    /* Свой призрак нужен и после неудачного захода: гоняться с собой можно и
       с половины уровня. Но пройденный забег ценнее оборванного, и по одному
       только счёту это не видно — за неудачную попытку очков можно набрать
       больше (собрал монеты, побил врагов) и погибнуть у самого флага. Раньше
       такая попытка затирала полную запись, и в следующий раз призрак
       обрывался на середине уровня, будто он там погиб.

       Поэтому сравниваем сперва по «дошёл ли до конца», и только потом по
       счёту. Равный результат ничего не меняет — переписывать нечего. */
    const store = readStore();
    const old = store[key];
    const better = !old
      || (ok && !old.ok)                                   // прошёл против оборванного
      || (ok === !!old.ok && (score | 0) > (old.score | 0)); // при равном исходе — по счёту
    if (better) {
      store[key] = { data, score: score | 0, ok: !!ok, at: Date.now() };
      writeStore(store);
    }

    // На сервер — только пройденный уровень: путь, оборвавшийся смертью, не
    // тот образец, за которым стоит гнаться.
    if (!ok) return;
    if (data.length > 49152) return;             // потолок колонки
    if (!(root.License && root.License.loggedIn && root.License.loggedIn())) return;
    const args = ctxKey.kind === 'daily'
      ? { p_game_slug: GAME, p_kind: 'daily', p_score: score | 0, p_frames: frame, p_data: data, p_slot: ctxKey.slot }
      : { p_game_slug: GAME, p_kind: 'level', p_score: score | 0, p_frames: frame, p_data: data,
          p_level: ctxKey.level | 0, p_hardcore: !!ctxKey.hardcore };
    try { await rpc('submit_ghost', args, true); } catch (e) { /* не улетело — не беда */ }
  }

  root.Ghost = { begin, record, step, draw, finish, label, encode, decode,
    get active() { return !!play; } };
})();
