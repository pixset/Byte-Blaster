// ═══════════════════════════════════════════════════════════════════════════
//  УРОВЕНЬ ДНЯ
//
//  Пять испытаний в сутки: лёгкое, среднее, сложное, случайное и случайное с
//  мутатором. У каждого своя таблица, живущая до полуночи по UTC.
//
//  САМ УРОВЕНЬ НИГДЕ НЕ ХРАНИТСЯ. Он собирается из даты и слота тем же
//  генератором, что и кампания: одинаковый сид даёт одинаковый уровень у всех.
//  Сервер знает только результаты — сравнивать нечего, если у каждого свой
//  уровень, и незачем гонять по сети то, что каждый может собрать сам.
//
//  Попыток сколько угодно, в зачёт идёт лучшая: одна глупая смерть не должна
//  портить день. Результат уходит и после флага, и после проигрыша — пройденная
//  половина уровня тоже чего-то стоит.
//
//  Требуется миграция 0018. Пока её нет, экран честно пишет, что таблицы
//  недоступны, а играть всё равно можно.
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const root = window;
  const SUPABASE_URL = 'https://zyjhvuhovimorpokiwty.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_1bj04J3qsO1EqsKPQeSbmg_cBDEtreK';
  const GAME = 'byte-blaster';

  const T = (k, d) => (typeof root.t === 'function' && root.t(k) !== k) ? root.t(k) : d;
  const N = (v) => Number(v || 0).toLocaleString();

  /* ── Слоты ─────────────────────────────────────────────────────────────
     diff = 0 означает «сложность тоже из сида»: случайные слоты каждый день
     достаются разной трудности, иначе «случайный» отличался бы от «среднего»
     только раскладкой. */
  const SLOTS = [
    { id: 'easy',    key: 'dailyEasy',    def: 'ЛЁГКИЙ',    icon: '🙂', col: '#0f8', diff: 3,  mods: false },
    { id: 'normal',  key: 'dailyNormal',  def: 'СРЕДНИЙ',   icon: '🔥', col: '#0ff', diff: 8,  mods: false },
    { id: 'hard',    key: 'dailyHard',    def: 'СЛОЖНЫЙ',   icon: '💀', col: '#f55', diff: 14, mods: false },
    { id: 'random',  key: 'dailyRandom',  def: 'СЛУЧАЙНЫЙ', icon: '🎲', col: '#a8f', diff: 0,  mods: false },
    { id: 'mutator', key: 'dailyMutator', def: 'С МУТАТОРОМ', icon: '🌀', col: '#fb0', diff: 0, mods: true },
  ];

  // Мутаторы берём те же, что генератор раздаёт уровням кампании (см.
  // pickModifiers в game.js): свой набор пришлось бы отдельно балансировать.
  const MUTATORS = [
    { id: 'lowGravity',  mods: { lowGravity: true },  key: 'modLowGravity',  def: 'НИЗКАЯ ГРАВИТАЦИЯ' },
    { id: 'highGravity', mods: { highGravity: true }, key: 'modHighGravity', def: 'ТЯЖЁЛАЯ ГРАВИТАЦИЯ' },
    { id: 'slippery',    mods: { slippery: true },    key: 'modSlippery',    def: 'ГОЛОЛЁД' },
    { id: 'darkness',    mods: { darkness: true },    key: 'modDarkness',    def: 'ТЕМНОТА' },
    { id: 'windRight',   mods: { wind: 0.35 },        key: 'modWindRight',   def: 'ВЕТЕР →' },
    { id: 'windLeft',    mods: { wind: -0.35 },       key: 'modWindLeft',    def: 'ВЕТЕР ←' },
  ];

  const SCOPES = [
    { id: 'world',   key: 'scopeWorld',   def: 'МИР' },
    { id: 'country', key: 'scopeCountry', def: 'СТРАНА' },
    { id: 'friends', key: 'scopeFriends', def: 'ДРУЗЬЯ' },
  ];

  /* ── День и сид ────────────────────────────────────────────────────────
     День считается по UTC — так же, как на сервере (см. daily_today в 0018).
     Иначе у Владивостока и Лиссабона «сегодня» разное, и общей таблицы не
     получается. */
  function todayUTC() {
    return new Date().toISOString().slice(0, 10);      // YYYY-MM-DD
  }

  /** Сколько осталось до смены уровней. */
  function msLeft() {
    const now = new Date();
    const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    return Math.max(0, next - now.getTime());
  }

  function hms(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h + ' ' + T('hourShort', 'ч') + ' ' + String(m).padStart(2, '0') + ' ' + T('minShort', 'мин');
  }

  // Обычный 32-битный хэш строки: нужен один и тот же результат в браузере, в
  // .exe и в .apk, поэтому никакого Math.random и никакой зависимости от
  // локали — только коды символов.
  function hash32(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  /**
   * Во что превращается пара «день + слот».
   *
   * Мир у каждого слота свой (сегодня лёгкий может оказаться в джунглях, а
   * сложный — в буране), номер уровня для генератора выбран не кратным десяти:
   * босса в дне быть не должно, он ломает сравнение по очкам.
   */
  function cfgFor(slotId, day) {
    const slot = SLOTS.filter((s) => s.id === slotId)[0] || SLOTS[0];
    day = day || todayUTC();
    const seed = hash32(day + ':' + slot.id);
    const world = seed % 10;
    const inWorld = 1 + ((seed >>> 8) % 9);            // 1..9 — не боссовый уровень
    const advN = world * 10 + inWorld;
    const diff = slot.diff || (2 + ((seed >>> 12) % 13));
    // Скрытные уровни живут своими правилами (свет, тревога) и с мутаторами
    // не дружат — в слоте мутатора их не берём.
    const arch = (slot.id === 'easy' || slot.id === 'normal' || slot.id === 'hard')
      ? 'classic'
      : ['classic', 'speedrun', slot.mods ? 'classic' : 'stealth'][(seed >>> 16) % 3];
    const mut = slot.mods ? MUTATORS[(seed >>> 20) % MUTATORS.length] : null;
    return {
      slot: slot.id, day, seed, world, advN, diff, arch,
      mods: mut ? mut.mods : {},
      mutator: mut,
    };
  }

  /* ── Сервер ────────────────────────────────────────────────────────────── */
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
    if (!res.ok) {
      const e = new Error(res.status === 404 ? 'no_migration' : 'rpc_failed');
      e.status = res.status;
      throw e;
    }
    return res.json();
  }

  const topOf   = (slot, scope) => rpc('daily_top',    { p_game_slug: GAME, p_slot: slot, p_limit: 50, p_scope: scope || 'world' });
  const mineOf  = (scope)       => rpc('my_daily',     { p_game_slug: GAME, p_scope: scope || 'world' }, true);
  const counts  = ()            => rpc('daily_counts', { p_game_slug: GAME });

  /**
   * Есть ли у игрока лицензия — уровень дня входит в купленную игру.
   *
   * hasGame ждёт КОД ИГРЫ; без него он всегда возвращал false, кнопка «Играть»
   * оставалась серой у владельца игры, а play() молча выходил.
   */
  function licensed() {
    return !!(root.License && root.License.hasGame && root.License.hasGame(GAME));
  }

  /* ── Экран ─────────────────────────────────────────────────────────────── */
  let ov = null, pick = 'normal', scope = 'world', busy = false, ticker = 0;
  let myRows = {}, playerCounts = {};

  function css() {
    if (document.getElementById('bbDayCss')) return;
    const s = document.createElement('style');
    s.id = 'bbDayCss';
    s.textContent = `
      #bbDay{position:fixed;inset:0;z-index:74;display:none;flex-direction:column;
        background:#04040ff2;padding:calc(16px * var(--bbFix, 1));
        font-family:'Share Tech Mono',monospace;overflow-y:auto}
      #bbDay h2{font-family:'Press Start 2P',monospace;color:#ffd24a;
        font-size:calc(13px * var(--bbFix, 1));text-shadow:0 0 14px #ffd24a;
        letter-spacing:3px;margin:0 0 calc(4px * var(--bbFix, 1));text-align:center}
      #bbDayWhen{text-align:center;color:#7a8a9a;font-size:calc(11px * var(--bbFix, 1));
        margin-bottom:calc(10px * var(--bbFix, 1))}
      #bbDaySlots{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));
        gap:calc(8px * var(--bbFix, 1));margin-bottom:calc(10px * var(--bbFix, 1))}
      .bbDaySlot{background:#06061a;border:2px solid #1a3a5a;padding:calc(9px * var(--bbFix, 1));
        cursor:pointer;text-align:left}
      .bbDaySlot.sel{box-shadow:0 0 12px #ffd24a55}
      .bbDaySlot .t{font-family:'Press Start 2P',monospace;
        font-size:calc(8px * var(--bbFix, 1));letter-spacing:1px;display:block;
        margin-bottom:calc(5px * var(--bbFix, 1))}
      .bbDaySlot .m{display:block;color:#8ac;font-size:calc(10px * var(--bbFix, 1))}
      .bbDaySlot .p{display:block;color:#5f7a99;font-size:calc(9px * var(--bbFix, 1));margin-top:2px}
      .bbDayRow2{display:flex;gap:6px;justify-content:center;flex-wrap:wrap;
        margin-bottom:calc(8px * var(--bbFix, 1))}
      .bbDayTab{background:#06061a;border:2px solid #1a3a5a;color:#6a8aaa;
        font-family:'Press Start 2P',monospace;font-size:calc(8px * var(--bbFix, 1));
        padding:calc(7px * var(--bbFix, 1)) calc(12px * var(--bbFix, 1));cursor:pointer}
      .bbDayTab.sel{border-color:#ffd24a;color:#ffd24a;box-shadow:0 0 12px #ffd24a55}
      #bbDayBody{flex:1;min-height:calc(90px * var(--bbFix, 1));border:2px solid #1a3a5a;
        background:#06061a;padding:calc(6px * var(--bbFix, 1));overflow-y:auto}
      .bbDayLine{display:grid;grid-template-columns:auto 1fr auto;align-items:center;
        gap:calc(9px * var(--bbFix, 1));padding:calc(6px * var(--bbFix, 1));
        border-bottom:1px solid #10203a}
      .bbDayLine.me{background:#0ff1;border-left:3px solid #0ff}
      .bbDayLine .r{color:#6a8aaa;min-width:26px;text-align:right;font-size:calc(11px * var(--bbFix, 1))}
      .bbDayLine .r.top1{color:#ffd24a}.bbDayLine .r.top2{color:#cfd8e8}.bbDayLine .r.top3{color:#d89a5a}
      .bbDayLine .n{color:#cfe;font-size:calc(11px * var(--bbFix, 1));overflow:hidden;
        text-overflow:ellipsis;white-space:nowrap}
      .bbDayLine .s{color:#ffd24a;font-variant-numeric:tabular-nums;
        font-size:calc(12px * var(--bbFix, 1));text-align:right}
      #bbDayNote{color:#7a8a9a;text-align:center;padding:calc(20px * var(--bbFix, 1)) 10px;
        font-size:calc(11px * var(--bbFix, 1));line-height:1.7}
      #bbDayBtns{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;
        margin-top:calc(10px * var(--bbFix, 1))}
      #bbDay button.act{background:#06061a;border:2px solid #1a3a5a;color:#8ac;
        font-family:'Press Start 2P',monospace;font-size:calc(9px * var(--bbFix, 1));
        padding:calc(11px * var(--bbFix, 1)) calc(24px * var(--bbFix, 1));cursor:pointer}
      #bbDay button.act.go{border-color:#ffd24a;color:#ffd24a}
      #bbDay button.act:hover{border-color:#0ff;color:#0ff;box-shadow:0 0 14px #0ff6}
      @media (max-width:520px){
        #bbDay{padding:calc(10px * var(--bbFix, 1))}
        #bbDay h2{font-size:calc(10px * var(--bbFix, 1));letter-spacing:2px}
        #bbDaySlots{grid-template-columns:repeat(auto-fit,minmax(46%,1fr));gap:6px}
        .bbDayTab{font-family:'Share Tech Mono',monospace;
          font-size:calc(12px * min(var(--bbFix, 1), 1.6));border-width:1px}
        #bbDay button.act{font-size:calc(8px * var(--bbFix, 1));
          padding:calc(9px * var(--bbFix, 1)) calc(16px * var(--bbFix, 1))}
      }`;
    document.head.appendChild(s);
  }

  function build() {
    css();
    ov = document.createElement('div');
    ov.id = 'bbDay';
    ov.innerHTML =
      '<h2>' + T('dailyTitle', 'УРОВЕНЬ ДНЯ') + '</h2>' +
      '<div id="bbDayWhen"></div>' +
      '<div id="bbDaySlots"></div>' +
      '<div class="bbDayRow2" id="bbDayScopes"></div>' +
      '<div id="bbDayBody"></div>' +
      '<div id="bbDayBtns">' +
        '<button class="act go" id="bbDayPlay">' + T('dailyPlay', 'ИГРАТЬ') + '</button>' +
        '<button class="act" id="bbDayBack">' + T('back', 'НАЗАД') + '</button>' +
      '</div>';
    document.body.appendChild(ov);
    ov.querySelector('#bbDayBack').onclick = () => {
      if (root.SFX && root.SFX.back) root.SFX.back();
      hide();
      if (typeof root.showNetType === 'function') root.showNetType();
    };
    ov.querySelector('#bbDayPlay').onclick = () => play(pick);
  }

  function slotLabel(s) { return T(s.key, s.def); }

  function paintSlots() {
    const host = ov.querySelector('#bbDaySlots');
    host.innerHTML = '';
    SLOTS.forEach((s) => {
      const cfg = cfgFor(s.id);
      const mine = myRows[s.id];
      const el = document.createElement('button');
      el.className = 'bbDaySlot' + (s.id === pick ? ' sel' : '');
      el.style.borderColor = s.id === pick ? s.col : '#1a3a5a';
      el.innerHTML =
        '<span class="t" style="color:' + s.col + '">' + s.icon + ' ' + slotLabel(s) + '</span>' +
        '<span class="m"></span><span class="p"></span>';
      el.querySelector('.m').textContent = mine
        ? N(mine.score) + ' · ' + T('dailyPlace', 'место') + ' ' + mine.rank
        : T('dailyNotPlayed', 'ещё не пройден');
      // У слота с мутатором подпись говорит, что сегодня мешает жить: игрок
      // должен знать это до того, как решит, стоит ли туда лезть.
      el.querySelector('.p').textContent = cfg.mutator
        ? T(cfg.mutator.key, cfg.mutator.def)
        : (playerCounts[s.id] ? T('dailyPlayers', 'сыграли: {0}').replace('{0}', playerCounts[s.id]) : '');
      el.onclick = () => {
        if (root.SFX && root.SFX.menu) root.SFX.menu();
        pick = s.id; paintSlots(); paintScopes(); loadBoard();
      };
      host.appendChild(el);
    });
  }

  function paintScopes() {
    const host = ov.querySelector('#bbDayScopes');
    host.innerHTML = '';
    SCOPES.forEach((sc) => {
      const b = document.createElement('button');
      b.className = 'bbDayTab' + (sc.id === scope ? ' sel' : '');
      b.textContent = T(sc.key, sc.def);
      b.onclick = () => {
        if (root.SFX && root.SFX.menu) root.SFX.menu();
        scope = sc.id; paintScopes(); loadBoard();
      };
      host.appendChild(b);
    });
  }

  function note(text) {
    ov.querySelector('#bbDayBody').innerHTML = '<div id="bbDayNote">' + text + '</div>';
  }

  async function loadBoard() {
    if (busy) return;
    busy = true;
    note(T('lbLoading', 'Загрузка…'));
    let rows = [];
    try {
      rows = await topOf(pick, scope);
    } catch (e) {
      note(e.message === 'no_migration'
        ? T('dailyNoServer', 'Таблица дня пока недоступна.')
        : T('lbOffline', 'Нет связи с сервером рекордов.'));
      busy = false; return;
    }
    if (!rows || !rows.length) {
      note(T('dailyEmpty', 'Сегодня здесь ещё никого. Будьте первым.'));
      busy = false; return;
    }
    const me = (root.License && root.License.userId) ? root.License.userId() : null;
    const body = ov.querySelector('#bbDayBody');
    body.innerHTML = '';
    rows.forEach((r) => {
      const line = document.createElement('div');
      line.className = 'bbDayLine' + (me && r.user_id === me ? ' me' : '');
      const cls = r.rank === 1 ? ' top1' : r.rank === 2 ? ' top2' : r.rank === 3 ? ' top3' : '';
      line.innerHTML = '<span class="r' + cls + '">' + r.rank + '</span>' +
                       '<span class="n"></span><span class="s">' + N(r.score) + '</span>';
      line.querySelector('.n').textContent = r.nickname || '—';
      body.appendChild(line);
    });
    busy = false;
  }

  async function loadMine() {
    myRows = {}; playerCounts = {};
    try {
      const c = await counts();
      (c || []).forEach((x) => { playerCounts[x.slot] = x.players; });
    } catch (e) { /* счётчик — украшение, без него экран работает */ }
    if (!(root.License && root.License.loggedIn && root.License.loggedIn())) return;
    try {
      const rows = await mineOf('world');
      (rows || []).forEach((r) => { myRows[r.slot] = r; });
    } catch (e) { /* не вошёл или нет миграции — просто нет своих строк */ }
  }

  function paintWhen() {
    const when = ov.querySelector('#bbDayWhen');
    if (!when) return;
    when.textContent = todayUTC() + ' · ' + T('dailyNewIn', 'новые через {0}').replace('{0}', hms(msLeft()));
  }

  async function open() {
    if (!ov) build();
    ov.style.display = 'flex';
    paintWhen();
    if (ticker) clearInterval(ticker);
    ticker = setInterval(paintWhen, 30000);

    // Уровень дня — часть купленной игры. Демо и гость видят объяснение, а не
    // пустую таблицу: так понятно, почему кнопка не работает. Причины две, и
    // они разные: «не вошёл» и «нет лицензии» — путать их нельзя, иначе
    // владелец игры читает, что игра ему не принадлежит.
    const playBtn = ov.querySelector('#bbDayPlay');
    const signedIn = !!(root.License && root.License.loggedIn && root.License.loggedIn());
    if (!licensed()) {
      playBtn.disabled = true;
      playBtn.style.opacity = '0.45';
      paintSlots(); paintScopes();
      note(signedIn
        ? T('dailyNeedLicense', 'Уровень дня открыт владельцам игры.')
        : T('dailyNeedLogin', 'Войдите в аккаунт, чтобы результат попал в таблицу.'));
      return;
    }
    playBtn.disabled = false;
    playBtn.style.opacity = '';
    paintSlots(); paintScopes();
    await loadMine();
    paintSlots();
    loadBoard();
  }

  function hide() {
    if (ticker) { clearInterval(ticker); ticker = 0; }
    if (ov) ov.style.display = 'none';
  }

  /* ── Запуск и результат ────────────────────────────────────────────────── */
  let current = null;         // конфиг слота, который сейчас играется

  function play(slotId) {
    if (!licensed()) return;
    if (typeof root.startDailyLevel !== 'function') return;
    if (root.SFX && root.SFX.menu) root.SFX.menu();
    current = cfgFor(slotId);
    pick = slotId;
    hide();
    root.startDailyLevel(current, true);
  }

  /** Повтор: fresh=true — новая попытка, false — та же, но с потерянной жизнью. */
  function replay(fresh) {
    if (!current || typeof root.startDailyLevel !== 'function') return;
    // День мог смениться прямо посреди забега — тогда пересобираем уровень на
    // сегодняшний, иначе игрок доигрывал бы вчерашний в сегодняшнюю таблицу.
    if (current.day !== todayUTC()) current = cfgFor(current.slot);
    hide();
    root.startDailyLevel(current, fresh !== false);
  }

  /** Результат забега. Вызывается из game.js и по флагу, и по проигрышу. */
  async function finish(score) {
    if (!current) return;
    const slot = current.slot;
    if (!(root.License && root.License.loggedIn && root.License.loggedIn())) return;
    try {
      await rpc('submit_daily', { p_game_slug: GAME, p_slot: slot, p_score: score | 0 }, true);
    } catch (e) { /* не улетело — попытка не пропадёт, следующая отправит лучшее */ }
    // Свои строки обновляем сразу: игрок вернётся на экран и должен увидеть
    // новый результат, а не прошлый.
    try {
      const rows = await mineOf('world');
      myRows = {};
      (rows || []).forEach((r) => { myRows[r.slot] = r; });
    } catch (e) { /* не критично */ }
  }

  root.Daily = {
    open, hide, close: hide, play, replay, finish,
    cfgFor, todayUTC, SLOTS, MUTATORS,
    get current() { return current; },
  };
})();
