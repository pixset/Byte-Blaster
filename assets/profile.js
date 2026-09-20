// ===============================================================
//  BYTE BLASTER — PLAYER PROFILE
// ===============================================================
// One screen that replaces the two separate buttons that used to exist
// (ACHIEVEMENTS on the world map, LOG ARCHIVE on the main menu). It holds
// everything that belongs to the player rather than to a run:
//
//   OVERVIEW   avatar, callsign, rank, completion ring, headline numbers
//   STATS      every counter the game already tracks, grouped and labelled
//   ACHIEVEMENTS  the full list with unlocked state (data from achievements.js)
//   ARCHIVE    the cutscene gallery (data from logarchive.js)
//
// Avatars are real characters drawn by the game's own renderers — UNIT-7 via
// window.drawByteRobot in each of the multiplayer colour schemes, plus the
// cutscene portraits (Leila, ARCHON, PRISM). Nothing here re-draws a character
// by hand, so avatars always match how they look in game.
//
// The callsign is the SAME value the multiplayer lobby uses (`bb_net_nick`), so
// changing it here changes the name other players see — a profile that only
// renamed a cosmetic label would be a lie.
(function () {
  'use strict';

  const T = (k, ...a) => (typeof window.t === 'function' ? window.t(k, ...a) : k);
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    json(k, d) { try { return JSON.parse(localStorage.getItem(k) || 'null') || d; } catch (e) { return d; } },
  };

  const ACCENT = '#0ff';
  // Ники и ответы сервера попадают в innerHTML — экранируем. Свой ник игрок
  // задаёт сам, но чужой приходит из базы, и доверять ему нечего.
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ── Avatars ───────────────────────────────────────────────────────────────
  // Роботов ровно десять, и это тот же список, что в лобби мультиплеера
  // (assets/robots.js). Раньше здесь стояла своя восьмёрка оттенков, и робот,
  // выбранный аватаром, в комнате выглядел другим — теперь набор один.
  // Идентификатор аватара — 'r_' + id цвета, так что 'r_blue' и цвет №6 в
  // лобби это один и тот же робот.
  const ROBOT_LIST = window.BB_ROBOTS || [];
  const ROBOT_SCHEMES = ROBOT_LIST.map(r => ({ id: 'r_' + r.id, hsl: r.hsl }));
  const PORTRAITS = ['leila', 'archon', 'prism'];

  // Старые идентификаторы аватаров из прежнего набора. Без этой таблицы у
  // игрока, выбравшего когда-то белого или пурпурного робота, аватар молча
  // сбросился бы на первого в списке.
  const LEGACY_AVATARS = {
    unit7: 'r_blue',   r_red: 'r_red',   r_grn: 'r_green',
    r_amb: 'r_orange', r_mag: 'r_pink',  r_cyn: 'r_cyan',
    r_vio: 'r_violet', r_wht: 'r_black',
  };

  /** Подпись под аватаром: «ЮНИТ-7» у синего (он и есть герой игры), у
      остальных — номер по порядку: «ЮНИТ-02»… «ЮНИТ-10». Номер, а не название
      цвета: цвет и так виден, а слово пришлось бы переводить на все девяносто
      языков игры. */
  function avatarLabel(id) {
    if (id === 'leila') return T('avLeila');
    if (id === 'archon') return T('avArchon');
    if (id === 'prism') return T('avPrism');
    if (id === 'r_blue') return T('avUnit7');
    const i = ROBOT_SCHEMES.findIndex(s => s.id === id);
    return i >= 0 ? T('avUnitVariant') + '-' + String(i + 1).padStart(2, '0')
                  : T('avUnitVariant');
  }
  function isPortrait(id) { return PORTRAITS.indexOf(id) >= 0; }
  function schemeFor(id) {
    const r = ROBOT_SCHEMES.find(s => s.id === id);
    return r ? r.hsl : null;
  }

  // Draw one avatar into a canvas element. Robots use the game's own robot
  // renderer; the other three use the cutscene portrait renderer, which needs a
  // canvas *id*, so we give the target a temporary one.
  function paintAvatar(cv, id) {
    const c = cv.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, cv.width, cv.height);
    if (isPortrait(id)) {
      const prevId = cv.id;
      cv.id = '__avatarTarget';
      try { if (typeof window.csDrawPortrait === 'function') window.csDrawPortrait('__avatarTarget', id, false); }
      catch (e) {}
      cv.id = prevId;
      return;
    }
    if (typeof window.drawByteRobot !== 'function') return;
    // drawByteRobot anchors at the robot's FEET (it does translate(-w/2,-h)),
    // not at its centre — passing a mid-canvas y put the body in the top half
    // and left the legs looking cut off.
    const ROBOT_W = 24, ROBOT_H = 32, PAD = 6;
    const scale = Math.min(cv.width / (ROBOT_W + PAD * 2), cv.height / (ROBOT_H + PAD * 2));
    const feetY = cv.height / 2 + (ROBOT_H / 2) * scale;
    try { window.drawByteRobot(c, cv.width / 2, feetY, scale, schemeFor(id), 0, 1); }
    catch (e) {}
  }

  // ── Profile data ──────────────────────────────────────────────────────────
  function nick() {
    const n = LS.get('bb_net_nick', '');
    return (n && n.trim()) ? n.trim() : T('profileDefaultNick');
  }
  function setNick(v) {
    const clean = String(v || '').replace(/[^\p{L}\p{N} _.\-]/gu, '').slice(0, 16).trim();
    if (!clean) return false;
    LS.set('bb_net_nick', clean);
    // network.js re-reads this key via loadProfile() every time the lobby is
    // opened, so writing it here is enough for the change to reach multiplayer.
    // The lobby's own input is updated too in case it is already on screen.
    const inp = document.getElementById('netNick');
    if (inp) inp.value = clean;
    return true;
  }
  /** Выбранный аватар. Значение из прежнего набора переводим на новый — и
      сразу записываем, чтобы перевод случился один раз. */
  function avatar() {
    const id = LS.get('bb_avatar', 'r_blue');
    if (LEGACY_AVATARS[id]) { LS.set('bb_avatar', LEGACY_AVATARS[id]); return LEGACY_AVATARS[id]; }
    return id;
  }
  /** Выбор аватара-робота задаёт и цвет в мультиплеере: набор один, значит и
      робот один. Портреты (Лейла, АРХОН, ПРИЗМА) цвет в лобби не трогают —
      играть за них нельзя. Лобби перечитывает ключ при каждом открытии. */
  function setAvatar(id) {
    LS.set('bb_avatar', id);
    const i = ROBOT_SCHEMES.findIndex(s => s.id === id);
    if (i >= 0) LS.set('bb_net_color', String(i));
  }

  function stat(k) {
    try { return (window.Achievements && window.Achievements.getStat) ? (window.Achievements.getStat(k) || 0) : 0; }
    catch (e) { return 0; }
  }
  // Прогресс читается прямо из хранилища, а не из состояния игры, поэтому его
  // форму приходится проверять здесь заново: JSON.parse пропускает и число, и
  // объект без done, а этот экран считает по нему длины и суммы. Игра такое
  // значение чинит у себя в памяти (loadAdv в game.js), но в хранилище оно
  // остаётся — намеренно, чтобы битый файл не уехал в облако поверх целого.
  function prog(hard) {
    const raw = LS.json(hard ? 'bbAdvH' : 'bbAdv3', null);
    const p = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    return {
      max: (Number(p.max) >= 1) ? Math.floor(Number(p.max)) : 1,
      done: Array.isArray(p.done) ? p.done : [],
      stars: obj(p.stars), scores: obj(p.scores), shards: obj(p.shards),
      // Монеты по уровням игра сохраняет (recordLevelCoins), но сюда их не
      // возвращали — и «собрано на уровнях» в сводке всегда выходило нулём.
      coins: obj(p.coins),
    };
  }
  function obj(v) { return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}; }
  // Derived from the SAME stored progress the rest of this screen reads, rather
  // than from advTotalLevels() — that one reflects live in-game state, so the
  // profile could disagree with itself when opened before any level was loaded.
  function totalLevels() {
    // Demo build: the campaign is only the demo's levels, so completion is
    // measured against those — otherwise a finished demo would read "9%".
    if (window.Demo && window.Demo.on) return window.Demo.levels;
    const p = prog(false), ph = prog(true);
    const rainbow = obj(LS.json('bbRainbow', {}));
    const gotAll = Object.keys(rainbow).filter(k => rainbow[k]).length >= 10;
    const past100 = (p.max | 0) > 100 || (ph.max | 0) > 100 ||
      (p.done || []).some(n => n > 100) || (ph.done || []).some(n => n > 100);
    return (gotAll || past100) ? 110 : 100;
  }

  function sumValues(o) { let t = 0; for (const k in (o || {})) t += (o[k] || 0); return t; }

  function snapshot() {
    const p = prog(false), ph = prog(true);
    const rec = obj(LS.json('bbRecords', { infinite: 0, adventure: 0 }));
    const rainbow = obj(LS.json('bbRainbow', {}));
    const rainbowN = Object.keys(rainbow).filter(k => rainbow[k]).length;
    const ach = (window.Achievements && window.Achievements.getAll) ? window.Achievements.getAll() : [];
    const achUnlocked = (window.Achievements && window.Achievements.getUnlocked) ? window.Achievements.getUnlocked() : [];
    const cat = (window.LogArchive && window.LogArchive.catalogue) ? window.LogArchive.catalogue() : [];
    const total = totalLevels();
    return {
      done: p.done.length, total,
      doneHard: ph.done.length,
      stars: sumValues(p.stars), starsMax: total * 3,
      shards: sumValues(p.shards), shardsMax: total * 3,
      score: sumValues(p.scores),
      bestInf: rec.infinite | 0, bestAdv: rec.adventure | 0,
      rainbow: rainbowN,
      ach: (achUnlocked || []).length, achMax: (ach || []).length,
      logs: cat.filter(c => c.unlocked).length, logsMax: cat.length,
      // The live counter is authoritative while a session is running, but after
      // a slot switch (or before the first level of a session) the stored value
      // is the higher one — take whichever is larger so the profile never
      // reports less time than the player has actually played.
      playtime: Math.max(
        (typeof window.bbPlaytime === 'function') ? (window.bbPlaytime() | 0) : 0,
        parseInt(LS.get('bbPlaytime', '0'), 10) || 0),
      coins: stat('coins'), jumps: stat('jumps'),
      stompKills: stat('stompKills'), blasterKills: stat('blasterKills'),
      burnKills: stat('burnKills'), freezeKills: stat('freezeKills'),
      perfect: stat('perfectLevels'), streak: stat('noDeathStreak'),
      deaths: stat('deaths'),
      // Уровни, пройденные на все три звезды — это не то же самое, что сумма
      // звёзд: она копится и с двух-звёздочных прохождений.
      stars3: Object.keys(p.stars).filter((n) => (p.stars[n] | 0) >= 3).length
            + Object.keys(ph.stars).filter((n) => (ph.stars[n] | 0) >= 3).length,
      // Ниже — то, что не нужно считать отдельным счётчиком: всё уже лежит в
      // прогрессе, надо только сложить. Отдельные счётчики пришлось бы
      // расставлять по коду и они разошлись бы с реальным сохранением.
      coinsLevels: sumValues(p.coins) + sumValues(ph.coins),
      // Босс-уровень — каждый десятый; пройденные боссы видны прямо в списке.
      bosses: p.done.filter(n => n % 10 === 0).length,
      bossesHard: ph.done.filter(n => n % 10 === 0).length,
      bossesMax: Math.floor(total / 10),
      secrets: (Array.isArray(p.secrets) ? p.secrets.length : 0)
             + (Array.isArray(ph.secrets) ? ph.secrets.length : 0),
      // Мир засчитан, когда пройден хотя бы один его уровень.
      worlds: new Set(p.done.map(n => Math.floor((n - 1) / 10))).size, worldsMax: 11,
    };
  }

  // Overall completion: levels, stars, crystals, achievements and story, equally
  // weighted — so a player who only rushes levels is not shown as "100%".
  function completion(s) {
    const parts = [
      s.done / Math.max(1, s.total),
      s.stars / Math.max(1, s.starsMax),
      s.shards / Math.max(1, s.shardsMax),
      s.ach / Math.max(1, s.achMax),
      s.logs / Math.max(1, s.logsMax),
    ];
    return Math.max(0, Math.min(1, parts.reduce((a, b) => a + b, 0) / parts.length));
  }

  // In-fiction rank, driven by how far into GRID the player has actually got.
  const RANKS = [
    { at: 0.00, key: 'rank0' }, { at: 0.10, key: 'rank1' }, { at: 0.25, key: 'rank2' },
    { at: 0.45, key: 'rank3' }, { at: 0.65, key: 'rank4' }, { at: 0.85, key: 'rank5' },
    { at: 1.00, key: 'rank6' },
  ];
  // Ключ, а не готовая строка: сводка для сайта уходит на сервер один раз, а
  // читают её и по-русски, и по-английски — переводит уже тот, кто показывает.
  function rankKeyFor(c) {
    let r = RANKS[0];
    for (const x of RANKS) if (c >= x.at) r = x;
    return r.key;
  }
  function rankFor(c) { return T(rankKeyFor(c)); }

  function fmtTime(sec) {
    sec = sec | 0;
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    if (h > 0) return T('profileHM', h, m);
    return T('profileMS', m, sec % 60);
  }
  function fmtNum(n) { return String(n | 0).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

  // ── DOM ───────────────────────────────────────────────────────────────────
  let root = null, tabHost = null, paneHost = null, avatarCv = null, activeTab = 'overview';

  function css() {
    if (document.getElementById('bbProfileCSS')) return;
    const st = document.createElement('style');
    st.id = 'bbProfileCSS';
    st.textContent = `
/* Above the world map (z-index 3000) — the profile is opened FROM the map, so a
   lower value made it open invisibly underneath it. The screen it replaced
   (achievements) sat at 4000 for exactly this reason. Layer order in the game:
   settings 2000 < save slots 2500 < world map 3000 < profile 4000 < toasts 10000. */
#bbProfile{position:fixed;inset:0;z-index:4000;display:none;align-items:center;justify-content:center;
  background:radial-gradient(120% 120% at 50% 0%,#0b1030f2,#04040ff8);font-family:'Press Start 2P',monospace}
/* vw/vh делятся на масштаб интерфейса (--bbUI): окно увеличивается zoom-ом, и
   без деления «95% ширины экрана» стали бы 190%. Пиксельный предел не делим —
   ему как раз и положено расти вместе с интерфейсом. */
#bbProfile .pf-win{width:min(1000px,calc(95vw / var(--bbUI, 1)));height:min(660px,calc(92vh / var(--bbUI, 1)));display:flex;flex-direction:column;
  background:#06061a;border:2px solid ${ACCENT};box-shadow:0 0 34px #0ff4,inset 0 0 60px #0ff08}
/* flex-wrap: при увеличенном размере текста заголовок и кнопка перестают
   помещаться в строку на телефоне — пусть переносятся, а не вылезают. */
#bbProfile .pf-head{display:flex;align-items:center;justify-content:space-between;gap:14px;
  padding:14px 18px;border-bottom:1px solid #0ff3;flex:0 0 auto;flex-wrap:wrap}
#bbProfile .pf-title{font-size:calc(12px * var(--bbText, 1));color:${ACCENT};letter-spacing:4px;text-shadow:0 0 12px #0ff8;
  min-width:0;overflow-wrap:anywhere}
#bbProfile .pf-x{font-family:inherit;font-size:calc(8px * var(--bbText, 1));padding:9px 13px;background:#0a0a20;color:${ACCENT};
  border:2px solid ${ACCENT};cursor:pointer;letter-spacing:1px}
#bbProfile .pf-x:hover{background:#0ff2}
#bbProfile .pf-body{flex:1 1 auto;display:flex;min-height:0}
#bbProfile .pf-side{width:270px;flex:0 0 auto;border-right:1px solid #0ff3;padding:18px 16px;
  display:flex;flex-direction:column;align-items:center;gap:12px;overflow-y:auto;overflow-x:hidden}
#bbProfile .pf-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column}
#bbProfile .pf-tabs{display:flex;gap:6px;padding:12px 16px 0;flex:0 0 auto;flex-wrap:wrap}
/* max-width/перенос — на случай крупного текста: одна вкладка иначе шире
   колонки, и ряд вкладок вылезал за окно профиля. */
#bbProfile .pf-tab{font-family:inherit;font-size:calc(8px * var(--bbText, 1));letter-spacing:1px;padding:9px 12px;cursor:pointer;
  background:transparent;color:#5a7a9a;border:1px solid #0ff3;border-bottom:none;
  max-width:100%;overflow-wrap:anywhere}
#bbProfile .pf-tab.on{color:${ACCENT};background:#0ff1;border-color:${ACCENT};text-shadow:0 0 8px #0ff8}
#bbProfile .pf-pane{flex:1 1 auto;overflow-y:auto;padding:16px;border-top:1px solid #0ff3}
#bbProfile .pf-avwrap{position:relative;width:150px;height:150px;display:flex;align-items:center;justify-content:center}
/* Кольцо прогресса. width/height обязательны: canvas — заменяемый элемент, и
   при width:auto браузер берёт СОБСТВЕННЫЙ размер холста (300×300, он такой
   ради чёткости на плотных экранах), а не размер рамки — inset:0 в этом случае
   игнорируется. Кольцо получалось вдвое больше рамки и наезжало на позывной,
   звание и кнопки под ним. Проценты считаются от .pf-avwrap, поэтому мобильное
   правило min(150px,42vw) ниже продолжает работать. */
#bbProfile .pf-avring{position:absolute;inset:0;width:100%;height:100%}
#bbProfile .pf-av{width:104px;height:104px;image-rendering:pixelated}
#bbProfile .pf-nick{font-size:calc(11px * var(--bbText, 1));color:#fff;letter-spacing:2px;text-align:center;word-break:break-word}
#bbProfile .pf-rank{font-family:'Share Tech Mono',monospace;font-size:calc(11px * var(--bbText, 1));color:#f0f;letter-spacing:2px}
#bbProfile .pf-btn{font-family:inherit;font-size:calc(7px * var(--bbText, 1));letter-spacing:1px;padding:8px 10px;cursor:pointer;
  background:#0a0a20;color:${ACCENT};border:1px solid ${ACCENT};width:100%}
#bbProfile .pf-btn:hover{background:#0ff2}
#bbProfile .pf-input{font-family:'Share Tech Mono',monospace;font-size:calc(13px * var(--bbText, 1));letter-spacing:1px;width:100%;
  padding:8px;background:#020210;color:#fff;border:1px solid ${ACCENT};text-align:center}
#bbProfile .pf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px}
#bbProfile .pf-card{background:#0a0a1e;border:1px solid #0ff2;padding:11px 12px}
#bbProfile .pf-k{font-family:'Share Tech Mono',monospace;font-size:calc(10px * var(--bbText, 1));color:#5a7a9a;letter-spacing:1px}
#bbProfile .pf-v{font-size:calc(13px * var(--bbText, 1));color:#fff;margin-top:7px;letter-spacing:1px}
#bbProfile .pf-sec{font-size:calc(9px * var(--bbText, 1));color:#f0f;letter-spacing:2px;margin:16px 0 9px;line-height:1.6}
#bbProfile .pf-sec:first-child{margin-top:0}
#bbProfile .pf-avpick{display:grid;grid-template-columns:repeat(auto-fill,minmax(66px,1fr));gap:8px}
#bbProfile .pf-avopt{background:#0a0a1e;border:1px solid #0ff2;padding:5px;cursor:pointer;text-align:center}
#bbProfile .pf-avopt.on{border-color:${ACCENT};box-shadow:0 0 12px #0ff6;background:#0ff1}
#bbProfile .pf-avopt canvas{width:100%;height:auto;image-rendering:pixelated;display:block}
#bbProfile .pf-avopt span{font-family:'Share Tech Mono',monospace;font-size:calc(8px * var(--bbText, 1));color:#7ba;display:block;margin-top:4px}
#bbProfile .pf-ach{display:flex;gap:11px;align-items:flex-start;background:#0a0a1e;border:1px solid #0ff2;padding:11px}
#bbProfile .pf-ach.lock{opacity:.42}
#bbProfile .pf-ach .ic{font-size:calc(20px * var(--bbText, 1));line-height:1;flex:0 0 auto}
#bbProfile .pf-ach .nm{font-size:calc(9px * var(--bbText, 1));color:#fff;letter-spacing:1px}
#bbProfile .pf-ach .ds{font-family:'Share Tech Mono',monospace;font-size:calc(10px * var(--bbText, 1));color:#7ba;margin-top:5px;line-height:1.5}
#bbProfile .pf-logs{display:flex;gap:12px;min-height:0;height:100%}
#bbProfile .pf-loglist{width:44%;min-width:190px;overflow-y:auto;padding-right:6px}
#bbProfile .pf-logread{flex:1 1 auto;overflow-y:auto;font-family:'Share Tech Mono',monospace;font-size:calc(12px * var(--bbText, 1));
  line-height:1.9;color:#9cf;border-left:1px solid #0ff3;padding-left:14px}
#bbProfile .pf-logrow{display:block;width:100%;text-align:left;margin:2px 0;padding:7px 8px;cursor:pointer;
  font-family:'Share Tech Mono',monospace;font-size:calc(11px * var(--bbText, 1));letter-spacing:1px;background:transparent;
  border:1px solid #0ff3;color:#9cf}
#bbProfile .pf-logrow:hover:not(:disabled){background:#0ff1}
#bbProfile .pf-logrow:disabled{border-color:#3336;color:#445;cursor:default}
#bbProfile .pf-mini{width:100%;margin-top:6px;display:flex;flex-direction:column;gap:7px}
#bbProfile .pf-mini .row{display:flex;justify-content:space-between;align-items:baseline;gap:8px;
  font-family:'Share Tech Mono',monospace;font-size:calc(11px * var(--bbText, 1));color:#5a7a9a;letter-spacing:1px}
#bbProfile .pf-mini .row b{color:#fff;font-weight:normal}
/* Друзья: строка списка и мелкие кнопки при ней. */
#bbProfile .pf-frow{display:flex;align-items:center;gap:8px;margin:6px 0;flex-wrap:wrap}
#bbProfile .pf-fname{flex:1 1 120px;min-width:0;text-align:left;background:none;border:none;cursor:pointer;
  font-family:inherit;font-size:calc(10px * var(--bbText, 1));color:#fff;letter-spacing:1px;
  padding:8px 0;overflow-wrap:anywhere}
#bbProfile .pf-fname:hover{color:${ACCENT}}
#bbProfile .pf-fmini{width:auto;flex:0 0 auto;padding:8px 12px}
#bbProfile .pf-fadd{flex:1 1 140px;width:auto;text-align:left}
#bbProfile .pf-bar{height:7px;background:#0a0a20;border:1px solid #0ff3;margin-top:8px;overflow:hidden}
#bbProfile .pf-bar>i{display:block;height:100%;background:linear-gradient(90deg,#0af,#0ff);box-shadow:0 0 8px #0ff}
@media (max-width:760px){
  /* Stacked layout needs ONE scroll container, not two nested ones. With the
     side panel above the main panel, .pf-body kept its desktop overflow:hidden
     and the stacked content simply ran off the bottom of the window — measured
     at 842px past the viewport on a 375x667 phone. */
  #bbProfile .pf-body{flex-direction:column;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch}
  #bbProfile .pf-side{width:auto;flex:0 0 auto;border-right:none;border-bottom:1px solid #0ff3;overflow:visible}
  #bbProfile .pf-main{flex:1 0 auto;min-height:0}
  #bbProfile .pf-pane{overflow-y:visible;flex:0 0 auto}
  /* The avatar ring is a fixed 150px box; on a 375px screen the side panel's
     padding pushed it past the right edge. Cap it to the column width. */
  #bbProfile .pf-avwrap{width:min(150px,42vw);height:min(150px,42vw)}
  #bbProfile .pf-av{width:min(104px,30vw);height:min(104px,30vw)}
  #bbProfile .pf-logs{flex-direction:column;height:auto}
  #bbProfile .pf-loglist{width:auto;max-height:40vh}
  #bbProfile .pf-logread{border-left:none;border-top:1px solid #0ff3;padding-left:0;padding-top:10px}
}
/* Phones: the whole #stage is scaled down to fit (see fit() in settings.js), so
   a control sized for a 1280px design surface ends up a few physical pixels
   tall. These rules enlarge the controls AT DESIGN SIZE so that after the scale
   they are still big enough to hit with a thumb. */
@media (max-width:900px){
  #bbProfile .pf-tab{font-size:calc(13px * var(--bbText, 1));padding:14px 18px}
  #bbProfile .pf-x{font-size:calc(12px * var(--bbText, 1));padding:14px 18px}
  #bbProfile .pf-btn{font-size:calc(11px * var(--bbText, 1));padding:14px 12px}
  #bbProfile .pf-avopt{min-height:64px}
  #bbProfile .pf-logrow{padding:12px 10px}
}`;
    document.head.appendChild(st);
  }

  function build() {
    css();
    root = document.createElement('div');
    root.id = 'bbProfile';
    root.innerHTML =
      '<div class="pf-win">' +
        '<div class="pf-head">' +
          '<div class="pf-title">' + T('profileTitle') + '</div>' +
          '<button class="pf-x">' + T('profileClose') + '</button>' +
        '</div>' +
        '<div class="pf-body">' +
          '<div class="pf-side">' +
            '<div class="pf-avwrap">' +
              '<canvas class="pf-avring" width="300" height="300"></canvas>' +
              '<canvas class="pf-av" width="208" height="208"></canvas>' +
            '</div>' +
            '<div class="pf-nick"></div>' +
            '<div class="pf-rank"></div>' +
            '<div style="width:100%;display:flex;flex-direction:column;gap:7px;margin-top:4px">' +
              '<button class="pf-btn pf-editnick">' + T('profileEditNick') + '</button>' +
              '<button class="pf-btn pf-editav">' + T('profileEditAvatar') + '</button>' +
            '</div>' +
            '<div class="pf-mini"></div>' +
          '</div>' +
          '<div class="pf-main"><div class="pf-tabs"></div><div class="pf-pane"></div></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(root);
    root.querySelector('.pf-x').onclick = hide;
    root.addEventListener('click', e => { if (e.target === root) hide(); });
    root.querySelector('.pf-editnick').onclick = () => { activeTab = 'overview'; render(); setTimeout(startNickEdit, 0); };
    root.querySelector('.pf-editav').onclick = () => { activeTab = 'avatar'; render(); };
    tabHost = root.querySelector('.pf-tabs');
    paneHost = root.querySelector('.pf-pane');
    avatarCv = root.querySelector('.pf-av');
  }

  const TABS = [
    { id: 'overview', key: 'profileTabOverview' },
    { id: 'avatar', key: 'profileTabAvatar' },
    { id: 'stats', key: 'profileTabStats' },
    { id: 'ach', key: 'profileTabAch' },
    { id: 'logs', key: 'profileTabLogs' },
    { id: 'friends', key: 'profileTabFriends' },
  ];

  /* ── Друзья ──────────────────────────────────────────────────────────────
     Аккаунт один на игру и сайт, поэтому список здесь тот же, что на сайте
     студии: добавили там — видно тут. Сеть живёт в assets/friends.js, здесь
     только показ. Без входа в аккаунт вкладка честно говорит, что нужен вход,
     а не показывает пустой список. */
  let friendsCache = null;     // последний успешный список
  let friendsBusy = false;
  let friendView = null;       // открытая карточка друга (ник)

  function friendsAvailable() {
    return !!(window.Friends && window.License && window.License.loggedIn());
  }

  async function friendsReload() {
    if (!friendsAvailable()) { friendsCache = null; return; }
    friendsBusy = true;
    try { friendsCache = await window.Friends.list(); }
    catch (e) { friendsCache = { error: e }; }
    friendsBusy = false;
    if (isOpen() && activeTab === 'friends') render();
  }

  const KIND_ORDER = [
    { kind: 'incoming', key: 'friendsIncoming' },
    { kind: 'friend', key: 'friendsList' },
    { kind: 'outgoing', key: 'friendsOutgoing' },
  ];

  function paneFriends() {
    if (!friendsAvailable()) {
      return '<div class="pf-sec">' + T('profileTabFriends') + '</div>' +
             '<div class="pf-card"><div class="pf-k">' + esc(T('friendsNeedAccount')) + '</div></div>';
    }
    if (friendView) return paneFriendCard();

    const rows = [];
    if (friendsBusy && !friendsCache) rows.push('<div class="pf-k">' + esc(T('friendsLoading')) + '</div>');
    else if (friendsCache && friendsCache.error) {
      rows.push('<div class="pf-k">' + esc(T('friendsOffline')) + '</div>');
    } else {
      const list = Array.isArray(friendsCache) ? friendsCache : [];
      for (const g of KIND_ORDER) {
        const items = list.filter(f => f.kind === g.kind);
        if (!items.length) continue;
        rows.push('<div class="pf-sec">' + esc(T(g.key)) + '</div>');
        rows.push(items.map(f =>
          '<div class="pf-frow">' +
            '<button class="pf-fname" data-open="' + esc(f.nickname) + '">' + esc(f.nickname) + '</button>' +
            (f.kind === 'incoming'
              ? '<button class="pf-btn pf-fmini" data-accept="' + esc(f.id) + '">' + esc(T('friendsAccept')) + '</button>'
              : '') +
            '<button class="pf-btn pf-fmini" data-remove="' + esc(f.id) + '">' +
              esc(f.kind === 'friend' ? T('friendsRemove') : T('friendsCancel')) + '</button>' +
          '</div>').join(''));
      }
      if (!list.length) rows.push('<div class="pf-card"><div class="pf-k">' + esc(T('friendsEmpty')) + '</div></div>');
    }

    return '<div class="pf-sec">' + esc(T('friendsAdd')) + '</div>' +
      '<div class="pf-frow">' +
        '<input class="pf-input pf-fadd" id="pfFriendNick" maxlength="20" placeholder="' + esc(T('friendsNickHint')) + '">' +
        '<button class="pf-btn pf-fmini" id="pfFriendGo">' + esc(T('friendsInvite')) + '</button>' +
      '</div>' +
      '<div class="pf-k" id="pfFriendMsg" style="margin:6px 0 2px"></div>' +
      rows.join('');
  }

  /** Карточка друга: его прогресс в Byte Blaster, взятый из общей витрины. */
  function paneFriendCard() {
    const p = friendView;
    if (p.loading) return '<div class="pf-card"><div class="pf-k">' + esc(T('friendsLoading')) + '</div></div>';
    if (!p.data) {
      return '<button class="pf-btn" id="pfFriendBack">' + esc(T('back')) + '</button>' +
             '<div class="pf-card"><div class="pf-k">' + esc(T('friendsOffline')) + '</div></div>';
    }
    const games = Array.isArray(p.data.games) ? p.data.games : [];
    const bb = games.find(g => g.game_slug === 'byte-blaster');
    const d = (bb && bb.data) || null;
    const card = (k, v) => '<div class="pf-card"><div class="pf-k">' + esc(k) + '</div><div class="pf-v">' + esc(v) + '</div></div>';
    const body = d
      ? '<div class="pf-grid">' +
          card(T('profileLevels'), (d.levels | 0) + ' / ' + (d.levelsMax | 0)) +
          card(T('profileStars'), '★ ' + (d.stars | 0) + ' / ' + (d.starsMax | 0)) +
          card(T('profileCrystals'), '◆ ' + (d.crystals | 0) + ' / ' + (d.crystalsMax | 0)) +
          card(T('profileAch'), (d.ach | 0) + ' / ' + (d.achMax | 0)) +
          card(T('total'), (d.score | 0).toLocaleString()) +
          card(T('profilePlaytime'), fmtTime(d.playtime | 0)) +
        '</div>'
      : '<div class="pf-card"><div class="pf-k">' + esc(T('friendsNoStats')) + '</div></div>';

    return '<button class="pf-btn" id="pfFriendBack">' + esc(T('back')) + '</button>' +
           '<div class="pf-sec">' + esc(p.data.nickname || p.nick) + '</div>' + body;
  }

  function friendMsg(text) {
    const el = root && root.querySelector('#pfFriendMsg');
    if (el) el.textContent = text || '';
  }

  async function friendInvite(nick) {
    const clean = String(nick || '').trim();
    if (!clean) return;
    friendMsg(T('friendsLoading'));
    try {
      const res = await window.Friends.request(clean);
      friendMsg(res === 'accepted' ? T('friendsNowFriends', clean) : T('friendsSent', clean));
      await friendsReload();
    } catch (e) { friendMsg(friendError(e)); }
  }

  /** Отказ сервера в понятном виде. Отдельная функция: тексты идут из локалей. */
  function friendError(e) {
    const m = String((e && (e.detail || e.message)) || '').toLowerCase();
    if (m.includes('player_not_found')) return T('friendsNotFound');
    if (m.includes('cannot_add_self')) return T('friendsSelf');
    if (m.includes('could not find the function') || m.includes('schema cache')) return T('friendsNotReady');
    if (m.includes('not_logged_in')) return T('friendsNeedAccount');
    return T('friendsOffline');
  }

  function drawRing(pct) {
    const cv = root.querySelector('.pf-avring');
    const c = cv.getContext('2d');
    c.clearRect(0, 0, cv.width, cv.height);
    const cx = cv.width / 2, cy = cv.height / 2, r = cv.width / 2 - 10;
    c.lineWidth = 8; c.lineCap = 'round';
    c.strokeStyle = 'rgba(0,255,255,0.16)';
    c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
    if (pct > 0) {
      const g = c.createLinearGradient(0, 0, cv.width, cv.height);
      g.addColorStop(0, '#0af'); g.addColorStop(1, '#0ff');
      c.strokeStyle = g; c.shadowColor = '#0ff'; c.shadowBlur = 14;
      c.beginPath(); c.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct); c.stroke();
      c.shadowBlur = 0;
    }
  }

  function card(k, v) { return '<div class="pf-card"><div class="pf-k">' + k + '</div><div class="pf-v">' + v + '</div></div>'; }

  function paneOverview(s) {
    const c = completion(s);
    return '<div class="pf-sec">' + T('profileSecProgress') + '</div>' +
      '<div class="pf-grid">' +
        card(T('profileCompletion'), Math.round(c * 100) + '%' +
          '<div class="pf-bar"><i style="width:' + (c * 100).toFixed(1) + '%"></i></div>') +
        card(T('profileLevels'), s.done + ' / ' + s.total) +
        card(T('profileHardcore'), s.doneHard + ' / ' + s.total) +
        card(T('profileStars'), '★ ' + s.stars + ' / ' + s.starsMax) +
        card(T('profileCrystals'), '◆ ' + s.shards + ' / ' + s.shardsMax) +
        card(T('profileRainbow'), '🌈 ' + s.rainbow + ' / 10') +
      '</div>' +
      '<div class="pf-sec">' + T('profileSecRecords') + '</div>' +
      '<div class="pf-grid">' +
        card(T('profileTotalScore'), fmtNum(s.score)) +
        card(T('profileBestAdv'), fmtNum(s.bestAdv)) +
        card(T('profileBestInf'), fmtNum(s.bestInf)) +
        card(T('profilePlaytime'), fmtTime(s.playtime)) +
        card(T('profileAch'), s.ach + ' / ' + s.achMax) +
        card(T('profileLogs'), s.logs + ' / ' + s.logsMax) +
      '</div>';
  }

  function paneAvatar() {
    const cur = avatar();
    const ids = ROBOT_SCHEMES.map(r => r.id).concat(PORTRAITS);
    let h = '<div class="pf-sec">' + T('profileSecAvatar') + '</div><div class="pf-avpick">';
    for (const id of ids) {
      h += '<div class="pf-avopt' + (id === cur ? ' on' : '') + '" data-av="' + id + '">' +
             '<canvas width="120" height="140"></canvas><span>' + avatarLabel(id) + '</span></div>';
    }
    h += '</div>';
    h += '<div class="pf-sec">' + T('profileSecNick') + '</div>' +
      '<div style="max-width:340px"><input class="pf-input pf-nickinput" maxlength="16" value="' +
        String(nick()).replace(/"/g, '&quot;') + '"/>' +
      '<div style="font-family:\'Share Tech Mono\',monospace;font-size:calc(10px * var(--bbText, 1));color:#5a7a9a;margin-top:8px;line-height:1.6">' +
        T('profileNickHint') + '</div>' +
      '<button class="pf-btn pf-savenick" style="margin-top:10px">' + T('profileSaveNick') + '</button></div>';
    return h;
  }

  function paneStats(s) {
    return '<div class="pf-sec">' + T('profileSecCombat') + '</div>' +
      '<div class="pf-grid">' +
        card(T('statStomp'), fmtNum(s.stompKills)) +
        card(T('statBlaster'), fmtNum(s.blasterKills)) +
        card(T('statBurn'), fmtNum(s.burnKills)) +
        card(T('statFreeze'), fmtNum(s.freezeKills)) +
      '</div>' +
      '<div class="pf-sec">' + T('profileSecJourney') + '</div>' +
      '<div class="pf-grid">' +
        card(T('statCoins'), fmtNum(s.coins)) +
        card(T('statJumps'), fmtNum(s.jumps)) +
        card(T('statPerfect'), fmtNum(s.perfect)) +
        card(T('statStreak'), fmtNum(s.streak)) +
        card(T('profilePlaytime'), fmtTime(s.playtime)) +
        card(T('profileTotalScore'), fmtNum(s.score)) +
      '</div>';
  }

  function paneAch() {
    const all = (window.Achievements && window.Achievements.getAll) ? window.Achievements.getAll() : [];
    const un = (window.Achievements && window.Achievements.getUnlocked) ? window.Achievements.getUnlocked() : [];
    const set = new Set(un || []);
    const ru = (typeof window.i18nLang === 'function' && window.i18nLang() === 'ru');
    let h = '<div class="pf-sec">' + T('profileSecAch') + ' — ' + set.size + ' / ' + (all || []).length + '</div><div class="pf-grid">';
    for (const a of (all || [])) {
      const got = set.has(a.id);
      const nm = (ru && a.nameRu) ? a.nameRu : a.name;
      const ds = got ? ((ru && a.descRu) ? a.descRu : a.desc) : T('profileAchHidden');
      h += '<div class="pf-ach' + (got ? '' : ' lock') + '"><div class="ic">' + (got ? (a.icon || '🏆') : '🔒') + '</div>' +
           '<div><div class="nm">' + nm + '</div><div class="ds">' + ds + '</div></div></div>';
    }
    return h + '</div>';
  }

  function paneLogs() {
    const cat = (window.LogArchive && window.LogArchive.catalogue) ? window.LogArchive.catalogue() : [];
    const un = cat.filter(c => c.unlocked).length;
    let list = '';
    let lastWorld = null;
    for (const it of cat) {
      if (it.world !== lastWorld) {
        lastWorld = it.world;
        const title = it.world === -1 ? T('logSectionPrologue')
          : it.world === -2 ? T('logSectionFinale')
          : (window.LogArchive.worldTitle ? window.LogArchive.worldTitle(it.world) : '');
        list += '<div class="pf-sec" style="margin:12px 0 6px">' + title + '</div>';
      }
      const label = it.beat === 'intro' ? T('logSectionPrologue')
        : it.beat === 'ending' ? T('logSectionFinale')
        : T(window.LogArchive.beatKey ? window.LogArchive.beatKey(it.beat) : it.beat);
      list += '<button class="pf-logrow" data-log="' + it.id + '"' + (it.unlocked ? '' : ' disabled') + '>' +
              (it.unlocked ? '▸ ' : '🔒 ') + label + '</button>';
    }
    return '<div class="pf-sec">' + T('profileSecLogs') + ' — ' + un + ' / ' + cat.length + '</div>' +
      '<div class="pf-logs" style="height:calc(100% - 30px)">' +
        '<div class="pf-loglist">' + list + '</div>' +
        '<div class="pf-logread">' + T('logArchiveHint') + '</div>' +
      '</div>';
  }

  const SPEAKER_COLOUR = { unit7: '#0ff', leila: '#4f8', archon: '#f44', system: '#fa0', prism: '#f8f' };
  function showLog(id) {
    const lines = (window.CSCENES && window.CSCENES[id]) || [];
    const box = root.querySelector('.pf-logread');
    if (!box) return;
    let h = '';
    for (const l of lines) {
      h += '<div style="margin-bottom:14px">' +
        '<div style="font-family:\'Press Start 2P\',monospace;font-size:calc(7px * var(--bbText, 1));letter-spacing:2px;margin-bottom:5px;color:' +
        (SPEAKER_COLOUR[l.k] || '#fff') + '">' + (l.sp || '') + '</div>' +
        '<div>' + (l.text || '') + '</div></div>';
    }
    box.innerHTML = h || T('logArchiveHint');
    box.scrollTop = 0;
  }

  function startNickEdit() {
    activeTab = 'avatar';
    render();
    const inp = root.querySelector('.pf-nickinput');
    if (inp) { inp.focus(); inp.select(); }
  }

  function render() {
    const s = snapshot();
    // Side card
    root.querySelector('.pf-nick').textContent = nick();
    root.querySelector('.pf-rank').textContent = rankFor(completion(s));
    paintAvatar(avatarCv, avatar());
    drawRing(completion(s));
    const mini = root.querySelector('.pf-mini');
    if (mini) {
      const row = (k, v) => '<div class="row"><span>' + k + '</span><b>' + v + '</b></div>';
      mini.innerHTML =
        row(T('profileCompletion'), Math.round(completion(s) * 100) + '%') +
        '<div class="pf-bar"><i style="width:' + (completion(s) * 100).toFixed(1) + '%"></i></div>' +
        row(T('profileLevels'), s.done + '/' + s.total) +
        row(T('profileAch'), s.ach + '/' + s.achMax) +
        row(T('profileLogs'), s.logs + '/' + s.logsMax) +
        row(T('profilePlaytime'), fmtTime(s.playtime));
    }
    // Tabs
    tabHost.innerHTML = '';
    for (const t of TABS) {
      const b = document.createElement('button');
      b.className = 'pf-tab' + (t.id === activeTab ? ' on' : '');
      b.textContent = T(t.key);
      b.onclick = () => { if (window.SFX && window.SFX.menu) window.SFX.menu(); activeTab = t.id; render(); };
      tabHost.appendChild(b);
    }
    // Pane
    paneHost.innerHTML =
      activeTab === 'overview' ? paneOverview(s) :
      activeTab === 'avatar' ? paneAvatar() :
      activeTab === 'stats' ? paneStats(s) :
      activeTab === 'ach' ? paneAch() :
      activeTab === 'friends' ? paneFriends() : paneLogs();

    if (activeTab === 'friends') {
      const q = (sel) => paneHost.querySelector(sel);
      const go = q('#pfFriendGo'), inp = q('#pfFriendNick');
      if (go && inp) {
        go.onclick = () => friendInvite(inp.value);
        inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); friendInvite(inp.value); } };
      }
      const back = q('#pfFriendBack');
      if (back) back.onclick = () => { friendView = null; render(); };

      paneHost.querySelectorAll('[data-accept]').forEach((b) => {
        b.onclick = async () => {
          b.disabled = true;
          try { await window.Friends.accept(b.dataset.accept); } catch (e) { friendMsg(friendError(e)); }
          await friendsReload();
        };
      });
      paneHost.querySelectorAll('[data-remove]').forEach((b) => {
        b.onclick = async () => {
          b.disabled = true;
          try { await window.Friends.remove(b.dataset.remove); } catch (e) { friendMsg(friendError(e)); }
          await friendsReload();
        };
      });
      paneHost.querySelectorAll('[data-open]').forEach((b) => {
        b.onclick = async () => {
          friendView = { nick: b.dataset.open, loading: true, data: null };
          render();
          try { friendView = { nick: b.dataset.open, loading: false, data: await window.Friends.profile(b.dataset.open) }; }
          catch (e) { friendView = { nick: b.dataset.open, loading: false, data: null }; }
          if (isOpen() && activeTab === 'friends') render();
        };
      });
    }

    if (activeTab === 'avatar') {
      paneHost.querySelectorAll('.pf-avopt').forEach(el => {
        const id = el.dataset.av;
        paintAvatar(el.querySelector('canvas'), id);
        el.onclick = () => {
          if (window.SFX && window.SFX.menu) window.SFX.menu();
          setAvatar(id); render();
        };
      });
      const save = paneHost.querySelector('.pf-savenick');
      const inp = paneHost.querySelector('.pf-nickinput');
      if (save && inp) {
        const commit = () => {
          if (setNick(inp.value)) { if (window.SFX && window.SFX.powerup) window.SFX.powerup(); render(); }
          else { inp.value = nick(); }
        };
        save.onclick = commit;
        inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') commit(); };
      }
    }
    if (activeTab === 'logs') {
      paneHost.querySelectorAll('.pf-logrow').forEach(el => {
        if (el.disabled) return;
        el.onclick = () => { if (window.SFX && window.SFX.menu) window.SFX.menu(); showLog(el.dataset.log); };
      });
    }
  }

  function show(tab) {
    if (!root) build();
    activeTab = tab || 'overview';
    friendView = null;                 // всегда открываем список, а не чужую карточку
    render();
    root.style.display = 'flex';
    // Список друзей мог измениться, пока экран был закрыт: заявку принимают и
    // на сайте. Обновляем в фоне — экран уже показан со старым списком.
    if (friendsAvailable()) friendsReload();
  }
  function hide() { if (root) root.style.display = 'none'; }
  function isOpen() { return !!root && root.style.display === 'flex'; }

  document.addEventListener('keydown', e => {
    if (e.code === 'Escape' && isOpen()) { e.preventDefault(); e.stopPropagation(); hide(); }
  }, true);

  // Entry point is the world map's top-right button (see worldmap.js). There is
  // deliberately no main-menu button: the profile belongs next to the player's
  // progress, and two entry points to the same screen just crowded the menu.

  // paintAvatar наружу: кнопка аккаунта в углу рисует ту же аватарку, что и
  // профиль, вместо эмодзи-заглушки.
  window.Profile = { show, hide, isOpen, avatar, nick, snapshot, completion, rankKey: rankKeyFor, paintAvatar };
  console.log('✅ Profile loaded');
})();
