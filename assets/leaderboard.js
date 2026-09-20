// ═══════════════════════════════════════════════════════════════════════════
//  ТАБЛИЦА РЕКОРДОВ
//
//  Восемь досок в двух группах.
//
//  РЕЖИМЫ (кампания, бесконечный, хардкор) — очки за забег. Их шлёт сама игра
//  в таблицу leaderboard: это результат попытки, а не состояние аккаунта, и
//  правило «только вверх» живёт на сервере.
//
//  СОБРАНО (уровни, звёзды, кристаллы, монеты, достижения) — строится прямо из
//  витрины game_stats, которую игра и так публикует после каждого сохранения.
//  Заводить под это вторую копию чисел значило бы однажды получить две разные
//  правды об одном игроке.
//
//  Требуется миграция 0004_leaderboard.sql. Пока её нет, экран честно пишет,
//  что рекорды недоступны, — ничего не ломается.
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const root = window;
  const SUPABASE_URL = 'https://zyjhvuhovimorpokiwty.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_1bj04J3qsO1EqsKPQeSbmg_cBDEtreK';
  const GAME = 'byte-blaster';
  const MODES = ['adventure', 'endless', 'hardcore'];

  const T = (k, d) => (typeof root.t === 'function' && root.t(k) !== k) ? root.t(k) : d;
  const N = (v) => Number(v || 0).toLocaleString();

  // unit — подпись у числа справа. Без неё в столбце просто «67», и понять,
  // это кристаллы, звёзды или очки, можно лишь по выбранной вкладке.
  const BOARDS = [
    { id: 'adventure', kind: 'mode', key: 'lbAdventure', def: 'КАМПАНИЯ',
      unit: 'lbShScore',    unitDef: 'очк.' },
    { id: 'endless',   kind: 'mode', key: 'lbEndless',   def: 'БЕСКОНЕЧНЫЙ',
      unit: 'lbShScore',    unitDef: 'очк.' },
    { id: 'hardcore',  kind: 'mode', key: 'lbHardcore',  def: 'ХАРДКОР',
      unit: 'lbShScore',    unitDef: 'очк.' },
    { id: 'levels',    kind: 'stat', key: 'lbLevels',    def: 'УРОВНИ',
      unit: 'lbShLevels',   unitDef: 'ур.' },
    { id: 'stars',     kind: 'stat', key: 'lbStars',     def: 'ЗВЁЗДЫ',
      unit: 'lbShStars',    unitDef: 'зв.' },
    { id: 'crystals',  kind: 'stat', key: 'lbCrystals',  def: 'КРИСТАЛЛЫ',
      unit: 'lbShCrystals', unitDef: 'крист.' },
    { id: 'coins',     kind: 'stat', key: 'lbCoins',     def: 'МОНЕТЫ',
      unit: 'lbShCoins',    unitDef: 'мон.' },
    { id: 'ach',       kind: 'stat', key: 'lbAchTab',    def: 'ДОСТИЖЕНИЯ',
      unit: 'lbShAch',      unitDef: 'дост.' },
  ];

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
      const body = await res.text().catch(() => '');
      const e = new Error(res.status === 404 ? 'no_migration' : 'rpc_failed');
      e.status = res.status; e.body = body.slice(0, 200);
      throw e;
    }
    return res.json();
  }

  /* ── Отправка результата ─────────────────────────────────────────────── */
  const sent = {};
  async function submit(mode, score) {
    score = score | 0;
    if (MODES.indexOf(mode) === -1 || score <= 0) return false;
    if ((sent[mode] || 0) >= score) return false;   // то же число слать по кругу незачем
    try {
      await rpc('submit_score', { p_game_slug: GAME, p_mode: mode, p_score: score }, true);
      sent[mode] = score;
      return true;
    } catch (e) { return false; }
  }

  /* ── Охват ───────────────────────────────────────────────────────────────
     Одна и та же доска отвечает на три разных вопроса: «кто лучший в мире»,
     «кто лучший в моей стране» и «кто лучший из моих друзей». Последний обычно
     и есть тот, ради которого в таблицу заглядывают.

     Страна берётся из профиля и участвует, только если игрок показывает её
     всем: страновая доска публична, и тащить в неё скрытую страну нельзя
     (см. scope_users в миграции 0018). */
  const SCOPES = [
    { id: 'world',   key: 'scopeWorld',   def: 'МИР',    auth: false },
    { id: 'country', key: 'scopeCountry', def: 'СТРАНА', auth: true },
    { id: 'friends', key: 'scopeFriends', def: 'ДРУЗЬЯ', auth: true },
  ];
  let scope = 'world';

  const top      = (mode, limit) => rpc('top_scores', { p_game_slug: GAME, p_mode: mode, p_limit: limit || 50, p_scope: scope });
  const topStats = (field, limit) => rpc('top_stats', { p_game_slug: GAME, p_field: field, p_limit: limit || 50, p_scope: scope });
  async function myRank(mode) {
    const rows = await rpc('my_rank', { p_game_slug: GAME, p_mode: mode, p_scope: scope }, true);
    return (rows && rows[0]) || null;
  }
  async function myStatRank(field) {
    const rows = await rpc('my_stat_rank', { p_game_slug: GAME, p_field: field, p_scope: scope }, true);
    return (rows && rows[0]) || null;
  }

  /* ── Экран ───────────────────────────────────────────────────────────── */
  let ov = null, tab = 0, busy = false;

  function css() {
    if (document.getElementById('bbLbCss')) return;
    const s = document.createElement('style');
    s.id = 'bbLbCss';
    s.textContent = `
      #bbLb{position:fixed;inset:0;z-index:73;display:none;flex-direction:column;
        background:#04040ff2;padding:calc(16px * var(--bbFix, 1));
        font-family:'Share Tech Mono',monospace}
      #bbLb h2{font-family:'Press Start 2P',monospace;color:#ffd24a;
        font-size:calc(14px * var(--bbFix, 1));text-shadow:0 0 14px #ffd24a;
        letter-spacing:3px;margin:0 0 calc(10px * var(--bbFix, 1));text-align:center}
      .bbLbGroup{display:flex;gap:6px;justify-content:center;align-items:center;
        flex-wrap:wrap;margin-bottom:calc(8px * var(--bbFix, 1))}
      .bbLbGroup .cap{font-size:calc(9px * var(--bbFix, 1));color:#4a6a8a;
        letter-spacing:2px;margin-right:4px}
      .bbLbTab{background:#06061a;border:2px solid #1a3a5a;color:#6a8aaa;
        font-family:'Press Start 2P',monospace;font-size:calc(8px * var(--bbFix, 1));
        padding:calc(8px * var(--bbFix, 1)) calc(12px * var(--bbFix, 1));cursor:pointer;
        letter-spacing:1px}
      .bbLbTab.sel{border-color:#ffd24a;color:#ffd24a;box-shadow:0 0 12px #ffd24a55}
      #bbLbBody{flex:1;overflow-y:auto;border:2px solid #1a3a5a;background:#06061a;
        padding:calc(6px * var(--bbFix, 1));min-height:0}
      .bbLbRow{display:grid;grid-template-columns:auto 32px 1fr auto;align-items:center;
        gap:calc(9px * var(--bbFix, 1));padding:calc(6px * var(--bbFix, 1));
        border-bottom:1px solid #10203a}
      .bbLbRow.me{background:#0ff1;border-left:3px solid #0ff}
      .bbLbRow .r{color:#6a8aaa;min-width:30px;text-align:right;
        font-size:calc(11px * var(--bbFix, 1))}
      .bbLbRow .r.top1{color:#ffd24a}.bbLbRow .r.top2{color:#cfd8e8}.bbLbRow .r.top3{color:#d89a5a}
      .bbLbRow canvas{width:26px;height:26px;border:1px solid #1a3a5a;background:#02020a;
        image-rendering:pixelated;border-radius:2px}
      .bbLbWho{min-width:0}
      .bbLbWho .n{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
        color:#cfe;font-size:calc(11px * var(--bbFix, 1))}
      /* Мелкая строка под ником: по ней видно, ЧТО за игрок, а не только число,
         по которому отсортирована доска. */
      .bbLbWho .sub{display:block;color:#5f7a99;font-size:calc(9px * var(--bbFix, 1));
        margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .bbLbRow .s{color:#ffd24a;font-variant-numeric:tabular-nums;
        font-size:calc(13px * var(--bbFix, 1));text-align:right;white-space:nowrap}
      /* Подпись у числа: тусклее и мельче самого значения, чтобы читалось
         «67 кристаллов», а не два равнозначных куска. */
      .bbLbRow .s .u{color:#8a7a4a;font-style:normal;margin-left:5px;
        font-size:calc(9px * var(--bbFix, 1))}
      #bbLbMine{margin-top:calc(8px * var(--bbFix, 1));text-align:center;color:#8ac;
        font-size:calc(11px * var(--bbFix, 1))}
      #bbLbNote{color:#7a8a9a;text-align:center;padding:calc(24px * var(--bbFix, 1)) 10px;
        font-size:calc(12px * var(--bbFix, 1));line-height:1.7}
      #bbLbBack{margin-top:calc(10px * var(--bbFix, 1));align-self:center;
        background:#06061a;border:2px solid #1a3a5a;color:#8ac;
        font-family:'Press Start 2P',monospace;font-size:calc(10px * var(--bbFix, 1));
        padding:calc(11px * var(--bbFix, 1)) calc(28px * var(--bbFix, 1));cursor:pointer}
      #bbLbBack:hover{border-color:#0ff;color:#0ff;box-shadow:0 0 14px #0ff6}
      /* Телефон. Восемь вкладок, набранных широким пиксельным шрифтом, вставали
         по одной в ряд и съедали экран: спискy рекордов оставалось меньше трети.
         Здесь переходим на узкий моноширинный — влезает по две-три в ряд, —
         а подпись группы выносим отдельной строкой. */
      @media (max-width:520px){
        #bbLb{padding:calc(10px * var(--bbFix, 1))}
        #bbLb h2{font-size:calc(11px * var(--bbFix, 1));letter-spacing:2px;
          margin-bottom:calc(6px * var(--bbFix, 1))}
        .bbLbGroup{gap:5px;margin-bottom:calc(5px * var(--bbFix, 1))}
        .bbLbGroup .cap{width:100%;text-align:center;margin:0 0 1px;
          font-size:calc(8px * min(var(--bbFix, 1), 1.6))}
        /* Множитель размера текста игра поднимает на телефоне до ~2.4 — для
           обычных надписей это правильно, но восемь вкладок при таком масштабе
           встают по одной в ряд. Здесь ограничиваем его: читаемость остаётся,
           а список рекордов получает место. */
        .bbLbTab{font-family:'Share Tech Mono',monospace;
          font-size:calc(13px * min(var(--bbFix, 1), 1.6));letter-spacing:0;
          padding:calc(6px * var(--bbFix, 1)) calc(9px * var(--bbFix, 1));border-width:1px}
        .bbLbRow{grid-template-columns:auto 24px 1fr auto;gap:calc(7px * var(--bbFix, 1))}
        .bbLbRow canvas{width:22px;height:22px}
        #bbLbBack{font-size:calc(9px * var(--bbFix, 1));
          padding:calc(9px * var(--bbFix, 1)) calc(20px * var(--bbFix, 1));
          margin-top:calc(7px * var(--bbFix, 1))}
      }`;
    document.head.appendChild(s);
  }

  function build() {
    css();
    ov = document.createElement('div');
    ov.id = 'bbLb';
    ov.innerHTML =
      '<h2>' + T('lbTitle', 'ТАБЛИЦА РЕКОРДОВ') + '</h2>' +
      '<div id="bbLbTabsMode" class="bbLbGroup"></div>' +
      '<div id="bbLbTabsStat" class="bbLbGroup"></div>' +
      '<div id="bbLbScopes" class="bbLbGroup"></div>' +
      '<div id="bbLbBody"></div>' +
      '<div id="bbLbMine"></div>' +
      '<button id="bbLbBack">' + T('back', 'НАЗАД') + '</button>';
    document.body.appendChild(ov);
    ov.querySelector('#bbLbBack').onclick = close;
    renderTabs();
    renderScopes();
  }

  /** Кнопки охвата. Гостю доступен только мир: страну и друзей взять неоткуда. */
  function renderScopes() {
    const host = ov.querySelector('#bbLbScopes');
    if (!host) return;
    const authed = !!(root.License && root.License.loggedIn && root.License.loggedIn());
    if (!authed && scope !== 'world') scope = 'world';
    host.innerHTML = '<span class="cap">' + T('lbScope', 'ОХВАТ') + '</span>';
    SCOPES.forEach((sc) => {
      const el = document.createElement('button');
      el.className = 'bbLbTab' + (sc.id === scope ? ' sel' : '');
      el.textContent = T(sc.key, sc.def);
      if (sc.auth && !authed) {
        el.style.opacity = '0.4';
        el.title = T('lbNeedLogin', 'Войдите в аккаунт, чтобы попасть в таблицу.');
        el.onclick = () => { if (root.SFX && root.SFX.back) root.SFX.back(); };
      } else {
        el.onclick = () => {
          if (root.SFX && root.SFX.menu) root.SFX.menu();
          scope = sc.id; renderScopes(); load();
        };
      }
      host.appendChild(el);
    });
  }

  function renderTabs() {
    const hostMode = ov.querySelector('#bbLbTabsMode');
    const hostStat = ov.querySelector('#bbLbTabsStat');
    hostMode.innerHTML = '<span class="cap">' + T('lbModes', 'РЕЖИМЫ') + '</span>';
    hostStat.innerHTML = '<span class="cap">' + T('lbCollect', 'СОБРАНО') + '</span>';
    BOARDS.forEach((b, i) => {
      const el = document.createElement('button');
      el.className = 'bbLbTab' + (i === tab ? ' sel' : '');
      el.textContent = T(b.key, b.def);
      el.onclick = () => {
        if (root.SFX && root.SFX.menu) root.SFX.menu();
        tab = i; renderTabs(); load();
      };
      (b.kind === 'mode' ? hostMode : hostStat).appendChild(el);
    });
  }

  function note(text) {
    ov.querySelector('#bbLbBody').innerHTML = '<div id="bbLbNote">' + text + '</div>';
    ov.querySelector('#bbLbMine').textContent = '';
  }

  /** Мелкая строка под ником — три числа, кроме того, по которому сортируем. */
  function subLine(data, exceptField) {
    if (!data) return '';
    const parts = [];
    const add = (field, val, label) => {
      if (field === exceptField || !val) return;
      parts.push(N(val) + ' ' + label);
    };
    add('levels', data.levels, T('lbShLevels', 'ур.'));
    add('stars', data.stars, T('lbShStars', 'зв.'));
    add('coins', data.coins, T('lbShCoins', 'мон.'));
    add('ach', data.ach, T('lbShAch', 'дост.'));
    if (parts.length < 3 && data.playtime) {
      parts.push(Math.round(data.playtime / 3600) + ' ' + T('lbShTime', 'ч'));
    }
    return parts.slice(0, 3).join(' · ');
  }

  function drawAvatar(cv, url) {
    if (!url) return;
    const img = new Image();
    img.onload = () => {
      try {
        const c = cv.getContext('2d');
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        if (!side) return;
        c.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2,
                    side, side, 0, 0, cv.width, cv.height);
      } catch (e) {}
    };
    img.src = url;
  }

  async function load() {
    if (busy) return;
    busy = true;
    note(T('lbLoading', 'Загрузка…'));
    const board = BOARDS[tab];
    let rows;
    try {
      rows = board.kind === 'mode' ? await top(board.id, 50) : await topStats(board.id, 50);
    } catch (e) {
      note(T('lbOffline', 'Нет связи с сервером рекордов.'));
      busy = false; return;
    }
    if (!rows || !rows.length) {
      // Пустая доска друзей и пустая доска мира — разные новости: в первом
      // случае дело не в том, что никто не играл.
      note(scope === 'friends' ? T('lbEmptyFriends', 'Никто из друзей сюда ещё не попал.')
         : scope === 'country' ? T('lbEmptyCountry', 'Из вашей страны здесь пока никого.')
         : T('lbEmpty', 'Пока никто не отметился. Будьте первым.'));
      busy = false; return;
    }

    const me = (root.License && root.License.userId) ? root.License.userId() : null;
    const body = ov.querySelector('#bbLbBody');
    body.innerHTML = '';
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = 'bbLbRow' + (me && r.user_id === me ? ' me' : '');
      const rankCls = r.rank === 1 ? ' top1' : r.rank === 2 ? ' top2' : r.rank === 3 ? ' top3' : '';
      const value = (board.kind === 'mode') ? r.score : r.value;
      row.innerHTML =
        '<span class="r' + rankCls + '">' + r.rank + '</span>' +
        '<canvas width="26" height="26"></canvas>' +
        '<span class="bbLbWho"><span class="n"></span><span class="sub"></span></span>' +
        '<span class="s">' + N(value) +
          '<i class="u">' + T(board.unit, board.unitDef) + '</i></span>';
      row.querySelector('.n').textContent = r.nickname || '—';
      row.querySelector('.sub').textContent = subLine(r.data, board.id);
      drawAvatar(row.querySelector('canvas'), r.avatar_url);
      body.appendChild(row);
    }

    // Своё место: без него доска ничего не говорит тому, кто не попал в топ-50.
    const mine = ov.querySelector('#bbLbMine');
    mine.textContent = '';
    if (!(root.License && root.License.loggedIn && root.License.loggedIn())) {
      mine.textContent = T('lbNeedLogin', 'Войдите в аккаунт, чтобы попасть в таблицу.');
    } else {
      try {
        const r = board.kind === 'mode' ? await myRank(board.id) : await myStatRank(board.id);
        mine.textContent = r
          ? T('lbYourPlace', 'Ваше место: {0}').replace('{0}', r.rank + ' / ' + r.total)
          // В страновой доске «вас тут нет» чаще всего значит «страна скрыта в
          // профиле», а не «результата нет» — так и пишем, иначе непонятно.
          : (scope === 'country' ? T('scopeCountryHint',
              'Страна берётся из профиля. Если она скрыта, вас в этой таблице не будет.')
            : T('lbNotRanked', 'Вас пока нет в таблице'));
      } catch (e) { /* своё место — не главное, молчим */ }
    }
    busy = false;
  }

  function open() {
    if (!ov) build();
    ov.style.display = 'flex';
    renderTabs();
    renderScopes();
    load();
  }
  function close() {
    if (root.SFX && root.SFX.back) root.SFX.back();
    if (ov) ov.style.display = 'none';
  }

  /* ── Кнопка в правом верхнем углу, левее настроек ────────────────────── */
  // Устроена как кнопки аккаунта и настроек: прямой ребёнок body с
  // position:fixed. Внутри игрового поля её нельзя держать — transform на
  // #stage утаскивает такие элементы в леттербокс на телефоне.
  //
  // Положение по горизонтали считается от кнопки настроек, а не задаётся
  // числом: ширина той зависит от языка («SETTINGS» и «НАСТРОЙКИ» разной
  // длины), и любая константа рано или поздно наложилась бы на неё.
  let cornerBtn = null;

  function cornerCss() {
    if (document.getElementById('bbLbBtnCss')) return;
    const css = document.createElement('style');
    css.id = 'bbLbBtnCss';
    css.textContent = [
      '#bbLbBtn{position:fixed;top:16px;right:16px;z-index:55;display:none;',
      'flex-direction:column;align-items:center;gap:7px;padding:13px 18px;',
      'background:#ffd24a14;border:2px solid #ffd24a88;cursor:pointer;',
      'transition:background .15s,box-shadow .15s,border-color .15s}',
      '#bbLbBtn:hover{background:#ffd24a2e;border-color:#ffd24a;box-shadow:0 0 16px #ffd24a88}',
      '#bbLbBtn .lbIcon{width:calc(28px * var(--bbFix, 1));',
      'height:calc(28px * var(--bbFix, 1));display:block;color:#ffd24a;',
      'filter:drop-shadow(0 0 6px #ffd24a88)}',
      '#bbLbBtn:hover .lbIcon{filter:drop-shadow(0 0 10px #ffd24a)}',
      '#bbLbBtn .lbText{font-family:"Press Start 2P",monospace;',
      'font-size:calc(9px * var(--bbFix, 1));letter-spacing:1px;color:#ffd24a;',
      'text-shadow:0 0 8px #ffd24a;max-width:118px;overflow:hidden;',
      'text-overflow:ellipsis;white-space:nowrap}',
      '@media (max-width:640px){',
      '#bbLbBtn{top:10px;padding:9px 12px;gap:5px}',
      '#bbLbBtn .lbIcon{width:calc(21px * var(--bbFix, 1));height:calc(21px * var(--bbFix, 1))}',
      '#bbLbBtn .lbText{font-size:calc(7px * var(--bbFix, 1));max-width:88px}}',
      // На узком экране три подписанные кнопки в ряд не помещаются: аккаунт
      // слева и настройки справа занимают почти всю ширину, и «Рекорды»
      // наезжали на аккаунт. Подпись убираем — кубок узнаётся и без неё.
      '@media (max-width:520px){',
      '#bbLbBtn{padding:9px 10px}',
      '#bbLbBtn .lbText{display:none}}',
    ].join('');
    document.head.appendChild(css);
  }

  // Кубок: чаша, ручки, ножка и подставка.
  // Размеры продублированы атрибутами: SVG без них растягивается во всё
  // доступное место, если стили почему-то ещё не применились.
  const TROPHY_SVG =
    '<svg class="lbIcon" viewBox="0 0 24 24" width="28" height="28" fill="none"' +
    ' stroke="currentColor"' +
    ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M7 4h10v5a5 5 0 0 1-10 0V4z"/>' +
    '<path d="M7 6H4.5a2.5 2.5 0 0 0 2.5 2.5"/>' +
    '<path d="M17 6h2.5a2.5 2.5 0 0 1-2.5 2.5"/>' +
    '<path d="M12 14v3"/><path d="M9 20h6"/><path d="M10 17h4l1 3H9l1-3z"/></svg>';

  /** Перекрыт ли экран другим полноэкранным окном (настройки, профиль, новости). */
  function coveredByScreen() {
    const mine = parseInt(getComputedStyle(cornerBtn).zIndex, 10) || 0;
    for (const el of document.body.children) {
      if (el === cornerBtn) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
      if ((parseInt(cs.zIndex, 10) || 0) <= mine) continue;
      const r = el.getBoundingClientRect();
      if (r.width >= innerWidth * 0.8 && r.height >= innerHeight * 0.8) return true;
    }
    return false;
  }

  /** Ставит кнопку вплотную слева от настроек, с зазором. */
  function placeNextToSettings() {
    const set = document.getElementById('bbSetBtn');
    if (!set) return;
    const r = set.getBoundingClientRect();
    if (!r.width) return;                     // настройки ещё скрыты — позже
    const gap = innerWidth <= 640 ? 8 : 12;
    cornerBtn.style.right = Math.round(innerWidth - r.left + gap) + 'px';
    cornerBtn.style.top = Math.round(r.top) + 'px';
  }

  function updateCornerButton() {
    if (!cornerBtn) return;
    const main = document.getElementById('mainOv');
    const onMenu = !!main && getComputedStyle(main).display !== 'none' && !coveredByScreen();
    cornerBtn.style.display = onMenu ? 'flex' : 'none';
    if (!onMenu) return;
    placeNextToSettings();
    const label = cornerBtn.querySelector('.lbText');
    if (label) label.textContent = T('lbBtn', 'РЕКОРДЫ');
  }

  function addCornerButton() {
    if (document.getElementById('bbLbBtn')) return true;
    if (!document.body) return false;
    cornerCss();
    cornerBtn = document.createElement('div');
    cornerBtn.id = 'bbLbBtn';
    cornerBtn.setAttribute('role', 'button');
    cornerBtn.innerHTML = TROPHY_SVG + '<span class="lbText">' + T('lbBtn', 'РЕКОРДЫ') + '</span>';
    cornerBtn.onclick = function () {
      if (root.SFX && root.SFX.menu) root.SFX.menu();
      open();
    };
    document.body.appendChild(cornerBtn);
    // Тот же приём, что у кнопок аккаунта и настроек: опрос вместо подписки на
    // каждое место, где меню показывают или прячут.
    setInterval(updateCornerButton, 250);
    addEventListener('resize', placeNextToSettings);
    updateCornerButton();
    return true;
  }
  function ensureCornerButton() {
    if (addCornerButton()) return;
    const iv = setInterval(() => { if (addCornerButton()) clearInterval(iv); }, 100);
    setTimeout(() => clearInterval(iv), 6000);
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', ensureCornerButton, { once: true });
  else ensureCornerButton();

  root.Leaderboard = { submit, top, topStats, myRank, myStatRank, open, close, MODES, BOARDS };
})();
