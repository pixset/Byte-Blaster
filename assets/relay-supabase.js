// ═══════════════════════════════════════════════════════════════════════════
//  BYTE BLASTER — ЗАПАСНОЙ КАНАЛ МУЛЬТИПЛЕЕРА ЧЕРЕЗ SUPABASE
// ═══════════════════════════════════════════════════════════════════════════
//
// Зачем это есть. Сервер комнат живёт на Railway, а подсеть Railway в России
// режут на уровне пакетов: TCP до сервера доходит, TLS-приветствие обрывают.
// Переезд на свой домен не помог — фильтр смотрит на адрес, а не на имя.
// Supabase из России открывается: на нём уже работают аккаунты, рекорды и
// облачные сохранения. Значит игре нужен второй путь, и он здесь.
//
// Как это устроено. Модуль притворяется обычным WebSocket: у него есть
// readyState, send(), close() и onopen/onmessage/onclose/onerror. Внутри
// работает Realtime broadcast — пересылка сообщений между всеми, кто открыл
// один канал. Ровно то, чем занимался релей: он никогда не считал игру, только
// раздавал чужие пакеты. Всё остальное, что раньше знал сервер, разошлось:
//
//   • состав комнаты — игроки рассказывают о себе сами (_hello / _here / _bye);
//   • роль хозяина   — явный флаг в этих же сообщениях;
//   • «вывеска» комнаты (код, сколько игроков, началась ли игра) — таблица
//     bb_rooms, нужная для списка публичных комнат и проверки кода при входе.
//     Пакеты игры через базу НЕ идут.
//
// Почему состав не на presence, хотя presence именно для этого и придуман:
// замеры показали, что Realtime рассылает изменения присутствия пачками, и
// сосед узнаёт о вашем приходе или о нажатой «готовности» через одну–три
// секунды. Broadcast доходит за десятые доли. Presence всё равно включено — оно
// само убирает того, у кого оборвалась связь, и служит вторым источником
// состава, если наше «здравствуйте» потерялось.
//
// Что осталось за бортом честно. Сервер умел отбирать роль хозяина у зависшей
// вкладки: он видел, что поток enemies_sync замолчал, и передавал власть
// другому. Здесь общего судьи нет, поэтому такой перехват не воспроизводится:
// власть переходит, только когда прежний хозяин действительно ушёл — сам
// попрощался, оборвал связь или замолчал дольше двадцати секунд. Намертво
// зависшая, но подключённая вкладка хозяина подвесит комнату. Для запасного
// канала это приемлемо — на основном сервере сторож остался.
//
// Про расход. Бесплатный тариф Supabase считает сообщения Realtime, и каждый
// получатель — отдельное сообщение. Поэтому пакеты не летят по одному: всё,
// что игра успела наговорить за FLUSH_MS, уходит одной пачкой, а внутри пачки
// от повторяющихся состояний (позиция игрока, снимок врагов) остаётся только
// последнее. Это снижает счёт примерно вчетверо против отправки как есть.
(function () {
'use strict';

// Ключ публичный — тот же, что в license.js: он и рассчитан на то, чтобы
// лежать в клиенте. Права дают только функции bb_room_* и правила RLS.
const KEY   = 'sb_publishable_1bj04J3qsO1EqsKPQeSbmg_cBDEtreK';
const PROTO = 'supabase://';
const DEFAULT_HOST = 'zyjhvuhovimorpokiwty.supabase.co';

const MAX_PLAYERS = 5;

// Пачки. Вдвоём можно чаще — сообщений всё равно немного; вчетвером тот же
// темп стоил бы вчетверо дороже, поэтому реже.
const FLUSH_DUO  = 70;
const FLUSH_MANY = 110;

const BEAT_MS  = 15000;  // как часто хозяин отмечает комнату живой в базе
const HB_MS    = 20000;  // страховочный heartbeat, если игра давно не пинговала
const JOIN_GRACE_MS = 3000; // пока собираем состав, хозяина не переизбираем

// Состояния, у которых важно только последнее значение: в одной пачке
// хранить два снимка врагов бессмысленно.
const COALESCE = {
  player_state: 1, enemies_sync: 1, boss_sync: 1, bullets_sync: 1, ebullets_sync: 1,
};
// Их принимаем только от хозяина комнаты — так же, как проверял сервер.
const HOST_ONLY = {
  enemies_sync: 1, boss_sync: 1, bullets_sync: 1, ebullets_sync: 1,
  game_started: 1, level_selected: 1, level_complete: 1,
};

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без 0/O и 1/I

function makeCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}
function makeId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
function sanitize(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/[<>&"']/g, '').trim().slice(0, 24);
}
function validColor(c) {
  if (!c || typeof c !== 'object') return { h: 210, s: 80, l: 55 };
  return {
    h: Math.round(Math.min(360, Math.max(0, Number(c.h) || 0))),
    s: Math.round(Math.min(100, Math.max(0, Number(c.s) || 0))),
    l: Math.round(Math.min(100, Math.max(0, Number(c.l) || 0))),
  };
}
function sameColor(a, b) {
  if (!a || !b) return a === b;
  return a.h === b.h && a.s === b.s && a.l === b.l;
}

/**
 * Открыть «сокет». Возвращает объект с интерфейсом WebSocket — network.js
 * работает с ним, не зная, что под ним не сервер, а Supabase.
 */
function open(url) {
  const host    = (String(url || '').slice(PROTO.length).replace(/\/+$/, '')) || DEFAULT_HOST;
  const wsUrl   = 'wss://' + host + '/realtime/v1/websocket?apikey=' + encodeURIComponent(KEY) + '&vsn=1.0.0';
  const rpcUrl  = 'https://' + host + '/rest/v1/rpc/';

  const api = {
    readyState: 0,           // 0 CONNECTING, 1 OPEN, 2 CLOSING, 3 CLOSED
    onopen: null, onmessage: null, onclose: null, onerror: null,
    send: fromGame,
    close: closeAll,
  };

  const myId = makeId();
  let sock = null;
  let refN = 0;
  let closed = false;

  let topic   = null;           // realtime:bb:room:CODE
  let joinRef = null;           // ref нашего phx_join — по нему ждём подтверждения
  let joinOk  = false;          // канал открыт, можно слать пакеты
  let inRoom  = false;          // комната уже «объявлена» игре
  let room    = null;           // {code,isPublic,maxPlayers,inGame,mode,level}
  let hostId  = null;
  let hostLockUntil = 0;        // до этого времени не переизбираем хозяина

  // Присутствие. Ключ — id игрока, значение:
  //   n — ник, c — цвет, r — готовность, t — когда вошёл, h — «я хозяин».
  // Роль хозяина держится ЯВНЫМ флагом, а не выводится из времени входа: часы у
  // игроков идут вразнобой, и гость с отстающими часами выглядел бы «вошедшим
  // раньше» создателя комнаты и отобрал бы у него власть. Время осталось лишь
  // как способ выбрать преемника, когда хозяин ушёл, — и это решение у всех
  // одинаковое, потому что берётся из общего присутствия, а не с местных часов.
  let peers = new Map();
  let me = { n: 'PLAYER', c: { h: 210, s: 80, l: 55 }, r: false, t: Date.now(), h: false };

  let pending = [], pendingAt = Object.create(null), flushTimer = 0;
  let beatTimer = 0, beatSoonTimer = 0, hbTimer = 0;
  let lastHb = 0, pingRef = null;

  // ── Вспомогательное ────────────────────────────────────────────────────────

  const nextRef = () => String(++refN);

  /** Отдать игре сообщение так, будто его прислал сервер. */
  function emit(msg) {
    if (closed || !api.onmessage) return;
    // Через таймер, а не напрямую: иначе ответ на команду прилетал бы внутрь
    // того же вызова send(), и обработчик игры получил бы ответ раньше, чем
    // вернулось управление из отправки.
    setTimeout(() => {
      if (closed || !api.onmessage) return;
      try { api.onmessage({ data: JSON.stringify(msg) }); } catch (e) { /* обработчик игры сам виноват */ }
    }, 0);
  }

  function fail(reason, extra) {
    emit(Object.assign({ type: 'error', reason: reason }, extra || {}));
  }

  function rpc(fn, body) {
    return fetch(rpcUrl + fn, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).then((r) => (r.ok ? r.text() : Promise.reject(new Error('http ' + r.status))))
      .then((t) => (t ? JSON.parse(t) : null));
  }

  function raw(obj) {
    if (!sock || sock.readyState !== 1) return;
    try { sock.send(JSON.stringify(obj)); } catch (e) { /* сокет умер — заметим по onclose */ }
  }

  // ── Список игроков в том виде, в каком его слал сервер ─────────────────────
  // Порядок — по времени входа: он одинаков у всех, поэтому и хозяин
  // вычисляется одинаково без всякого сговора.

  function orderedIds() {
    const ids = Array.from(peers.keys());
    ids.sort((a, b) => {
      const ta = peers.get(a).t || 0, tb = peers.get(b).t || 0;
      if (ta !== tb) return ta - tb;
      return a < b ? -1 : (a > b ? 1 : 0);
    });
    return ids;
  }

  function playerList() {
    return orderedIds().map((id) => {
      const m = peers.get(id);
      return { id: id, nickname: m.n, color: m.c, ready: !!m.r, isHost: id === hostId };
    });
  }

  /** Пересчитать хозяина. Возвращает true, если он сменился. */
  function recalcHost() {
    const ids = orderedIds();
    // Кто объявил себя хозяином. Обычно ровно один; если из-за гонки их двое,
    // остаётся вошедший раньше — правило одинаковое у всех, поэтому спор
    // разрешается сам, без переговоров.
    const claimed = ids.filter((id) => peers.get(id).h);
    const next = claimed.length ? claimed[0] : (ids.length ? ids[0] : null);

    // Пока состав только собирается, доверяем тому, что сказала база: иначе
    // вошедший объявил бы хозяином первого, кто успел отозваться (а то и себя),
    // и в комнате оказалось бы два хозяина.
    if (Date.now() < hostLockUntil && hostId) {
      const declared = claimed.length ? claimed[0] : null;
      if (!declared || declared === hostId) return false;
      hostId = declared;   // настоящий хозяин объявился сам — верим ему
      return true;
    }

    const changed = next !== hostId;
    hostId = next;

    // Флаг в присутствии держим в согласии с расчётом: преемник объявляет себя
    // сам, а прежний хозяин снимает притязание, когда власть ушла к другому.
    const iAmHost = hostId === myId;
    if (topic && !!me.h !== iAmHost) { me.h = iAmHost; track(); }

    return changed;
  }

  // ── Присутствие ────────────────────────────────────────────────────────────

  function metaOf(entry) {
    const m = (entry && entry.metas && entry.metas[0]) || {};
    return { n: sanitize(m.n) || '?', c: validColor(m.c), r: !!m.r,
             t: Number(m.t) || 0, h: !!m.h };
  }

  function selfMeta() { return { n: me.n, c: me.c, r: me.r, t: me.t, h: me.h }; }

  function track() {
    if (!topic) return;
    raw({
      topic: topic, event: 'presence',
      payload: { type: 'presence', event: 'track', payload: selfMeta() },
      ref: nextRef(),
    });
    peers.set(myId, selfMeta());
    seenAt[myId] = Date.now();
  }

  /* ── Кто в комнате ──────────────────────────────────────────────────────────
     Состав ведём сами, обычными сообщениями (_hello / _here / _bye), а не
     присутствием Realtime. Причина выяснилась на замерах: сервер рассылает
     изменения присутствия пачками, и сосед узнаёт о вашем приходе или о
     нажатой «готовности» через одну–три секунды. Для лобби это выглядит как
     зависшая кнопка. Broadcast доходит за десятые доли секунды.

     Присутствие всё равно включено и полезно: во-первых, оно само отваливает
     того, у кого оборвалась связь (сказать «я ушёл» такой игрок уже не может),
     во-вторых, служит вторым источником состава, если наше «здравствуйте»
     потеряется. Плюс каждый повторяет «я тут» раз в несколько секунд — любое
     расхождение чинится само. */

  const HERE_MS = 6000;    // как часто повторяем «я тут»
  const GONE_MS = 20000;   // сколько молчания считаем уходом
  let seenAt = Object.create(null);
  let hereTimer = 0, goneTimer = 0;

  function announceHost(moved) {
    if (!moved || !inRoom) return;
    // Строку комнаты в базе ведёт хозяин. Раз власть перешла — вести её теперь
    // новому, иначе комната «умрёт» через полминуты прямо во время игры:
    // пропадёт из списка и из счётчиков на сайте.
    if (hostId === myId) { emit({ type: 'promoted_to_host' }); startBeat(); }
    else stopBeat();
    emit({ type: 'host_changed', hostId: hostId, reason: 'left', players: playerList() });
  }

  function peerUpsert(id, meta) {
    if (!id) return;
    seenAt[id] = Date.now();
    const old = peers.get(id);
    // Своё состояние авторитетно у нас: чужой (устаревший) снимок нас самих не
    // должен, например, снимать нашу готовность.
    peers.set(id, id === myId ? selfMeta() : meta);
    const hostMoved = recalcHost();
    if (!inRoom) return;
    const list = playerList();
    if (!old) {
      if (id !== myId) {
        emit({ type: 'player_joined',
               player: { id: id, nickname: meta.n, color: meta.c, ready: !!meta.r, isHost: id === hostId },
               players: list });
      }
    } else if (id !== myId) {
      if (!!old.r !== !!meta.r) emit({ type: 'ready_changed', id: id, ready: !!meta.r, players: list });
      if (!sameColor(old.c, meta.c)) emit({ type: 'color_changed', id: id, color: meta.c });
    }
    announceHost(hostMoved);
    beatSoon();
  }

  function peerDrop(id) {
    if (!id || id === myId || !peers.has(id)) return;
    peers.delete(id);
    delete seenAt[id];
    const hostMoved = recalcHost();
    if (!inRoom) return;
    emit({ type: 'player_left', id: id, players: playerList() });
    announceHost(hostMoved);
    beatSoon();
  }

  /** «Я тут» — свои данные всем. Заодно ответ на чужое «здравствуйте». */
  function sayHere() { queue({ type: '_here', me: selfMeta() }); }

  function startHere() {
    stopHere();
    hereTimer = setInterval(() => {
      if (peers.size > 1) sayHere();   // одному в комнате рассказывать некому
    }, HERE_MS);
    goneTimer = setInterval(() => {
      const now = Date.now();
      Array.from(peers.keys()).forEach((id) => {
        if (id === myId) return;
        if (now - (seenAt[id] || 0) > GONE_MS) peerDrop(id);
      });
    }, 4000);
  }
  function stopHere() {
    if (hereTimer) { clearInterval(hereTimer); hereTimer = 0; }
    if (goneTimer) { clearInterval(goneTimer); goneTimer = 0; }
  }

  function applyPresenceState(payload) {
    Object.keys(payload || {}).forEach((id) => peerUpsert(id, metaOf(payload[id])));
  }

  function applyPresenceDiff(payload) {
    const joins  = (payload && payload.joins)  || {};
    const leaves = (payload && payload.leaves) || {};
    // Обновление своего присутствия приходит как уход и приход одного и того же
    // ключа, поэтому «ушедшим» считаем только того, кто не пришёл тем же diff.
    Object.keys(leaves).forEach((id) => { if (!joins[id]) peerDrop(id); });
    Object.keys(joins).forEach((id) => peerUpsert(id, metaOf(joins[id])));
  }

  // ── Отправка пачками ───────────────────────────────────────────────────────

  function flushDelay() { return peers.size > 2 ? FLUSH_MANY : FLUSH_DUO; }

  function queue(msg) {
    if (!topic) return;
    if (COALESCE[msg.type]) {
      const at = pendingAt[msg.type];
      if (at != null) { pending[at] = msg; }
      else { pendingAt[msg.type] = pending.length; pending.push(msg); }
    } else {
      pending.push(msg);
    }
    if (!flushTimer) flushTimer = setTimeout(flush, flushDelay());
  }

  function flush() {
    flushTimer = 0;
    if (!pending.length || !topic) { pending = []; pendingAt = Object.create(null); return; }
    // Канал ещё подтверждается — придержим пачку, иначе она уйдёт в пустоту.
    if (!joinOk) { flushTimer = setTimeout(flush, 60); return; }
    const batch = pending;
    pending = []; pendingAt = Object.create(null);
    raw({
      topic: topic, event: 'broadcast',
      payload: { type: 'broadcast', event: 'b', payload: { f: myId, m: batch } },
      ref: nextRef(),
    });
  }

  /** Пришла чужая пачка. */
  function takeBatch(payload) {
    if (!payload || payload.f === myId || !Array.isArray(payload.m)) return;
    const from = payload.f;
    // Любое сообщение — доказательство, что игрок жив.
    if (peers.has(from)) seenAt[from] = Date.now();
    const fromHost = from === hostId;
    payload.m.forEach((msg) => {
      if (!msg || typeof msg.type !== 'string') return;

      // Служебное — про состав комнаты. Наверх, в игру, не отдаём.
      if (msg.type === '_hello') {
        peerUpsert(from, metaOf({ metas: [msg.me || {}] }));
        sayHere();                       // «здравствуйте» — отзываемся
        return;
      }
      if (msg.type === '_here') { peerUpsert(from, metaOf({ metas: [msg.me || {}] })); return; }
      if (msg.type === '_bye')  { peerDrop(from); return; }

      if (HOST_ONLY[msg.type] && !fromHost) return;
      if (msg.type === 'game_started' || msg.type === 'level_complete') {
        if (room) room.inGame = true;
        // Новый уровень начинается с чистой готовностью — так делал сервер.
        if (me.r) { me.r = false; track(); sayHere(); }
      }
      emit(msg);
    });
  }

  // ── Сердцебиение комнаты в базе ────────────────────────────────────────────
  // Пишет только хозяин: строка нужна для списка комнат и проверки кода, и
  // достаточно одного источника правды.

  function beatNow() {
    if (!room || hostId !== myId) return;
    rpc('bb_room_beat', {
      p_code: room.code, p_host_id: myId, p_host_name: me.n,
      p_count: peers.size || 1, p_in_game: !!room.inGame,
      p_mode: room.mode || null, p_level: room.level || null,
      p_public: !!room.isPublic, p_max: room.maxPlayers || MAX_PLAYERS,
    }).catch(() => { /* сеть моргнула — следующий удар через 15 секунд */ });
  }
  function beatSoon() {
    if (beatSoonTimer) return;
    beatSoonTimer = setTimeout(() => { beatSoonTimer = 0; beatNow(); }, 800);
  }
  function startBeat() {
    stopBeat();
    beatNow();
    beatTimer = setInterval(beatNow, BEAT_MS);
  }
  function stopBeat() {
    if (beatTimer) { clearInterval(beatTimer); beatTimer = 0; }
    if (beatSoonTimer) { clearTimeout(beatSoonTimer); beatSoonTimer = 0; }
  }

  // ── Канал комнаты ──────────────────────────────────────────────────────────

  function joinChannel(code) {
    topic = 'realtime:bb:room:' + code;
    peers = new Map();
    seenAt = Object.create(null);
    peers.set(myId, selfMeta());
    seenAt[myId] = Date.now();
    joinOk = false;
    joinRef = nextRef();
    raw({
      topic: topic, event: 'phx_join',
      payload: { config: {
        broadcast: { self: false, ack: false },
        // Без enabled сервер не присылает состав канала — только собственные
        // изменения, и вошедший не увидел бы, кто уже в комнате.
        presence: { key: myId, enabled: true },
        private: false,
      } },
      ref: joinRef,
    });
  }

  function leaveChannel() {
    if (!topic) return;
    // Сначала прощаемся сами — так соседи уберут нас сразу, а не через
    // неторопливое присутствие.
    queue({ type: '_bye' });
    flush();
    stopHere();
    raw({ topic: topic, event: 'presence',
          payload: { type: 'presence', event: 'untrack', payload: {} }, ref: nextRef() });
    raw({ topic: topic, event: 'phx_leave', payload: {}, ref: nextRef() });
    topic = null;
    joinRef = null; joinOk = false;
    me.h = false;
    peers = new Map();
    seenAt = Object.create(null);
    pending = []; pendingAt = Object.create(null);
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = 0; }
  }

  // ── Команды от игры ────────────────────────────────────────────────────────

  function fromGame(rawStr) {
    let m;
    try { m = JSON.parse(rawStr); } catch (e) { return; }
    if (!m || typeof m.type !== 'string') return;

    switch (m.type) {
      case 'list_rooms':  doList();      return;
      case 'create_room': doCreate(m);   return;
      case 'join_room':   doJoin(m);     return;
      case 'leave_room':  doLeave();     return;
      case 'ping':        doPing();      return;
    }

    if (!topic) { if (m.type !== 'ping') fail('not_in_room'); return; }

    switch (m.type) {
      case 'set_color':
        me.c = validColor(m.color);
        track(); sayHere();
        // Своё изменение показываем сразу, не дожидаясь круга по сети.
        emit({ type: 'color_changed', id: myId, color: me.c });
        return;

      case 'set_ready':
        me.r = !!m.ready;
        if (room) room.inGame = false;   // готовность жмут в лобби, значит игра кончилась
        track(); sayHere();
        emit({ type: 'ready_changed', id: myId, ready: me.r, players: playerList() });
        beatSoon();
        return;

      case 'select_level': {
        if (hostId !== myId) { fail('not_host'); return; }
        const out = { type: 'level_selected', mode: m.mode || 'infinite',
                      level: m.level || 1, seed: m.seed || Date.now() };
        if (room) { room.mode = out.mode; room.level = out.level; }
        queue(out); emit(out); beatSoon();
        return;
      }

      case 'start_game': {
        if (hostId !== myId) { fail('not_host'); return; }
        const list = playerList();
        const others = list.filter((p) => p.id !== myId);
        if (list.length < 2 || !others.every((p) => p.ready)) { fail('not_all_ready'); return; }
        if (room) room.inGame = true;
        if (me.r) { me.r = false; track(); sayHere(); }
        const out = {
          type: 'game_started',
          mode:  (room && room.mode)  || 'infinite',
          level: (room && room.level) || 1,
          seed:  Date.now(),
          players: list.map((p) => Object.assign({}, p, { ready: false })),
        };
        queue(out); flush(); emit(out); beatNow();
        return;
      }

      case 'level_complete': {
        if (hostId !== myId) return;   // сервер молча игнорировал не-хозяина
        const out = { type: 'level_complete',
                      nextLevel: m.nextLevel || (room && room.level) || 1,
                      mode: m.mode || (room && room.mode) || 'infinite',
                      retry: !!m.retry };
        if (room) { room.level = out.nextLevel; room.mode = out.mode; }
        queue(out); flush(); emit(out);
        return;
      }

      case 'chat': {
        const text = sanitize(m.text || '').slice(0, 120);
        if (!text) return;
        const out = { type: 'chat', id: myId, text: text };
        queue(out); emit(out);   // сервер слал чат всем, включая автора
        return;
      }

      case 'game_state':
        queue({
          type: 'player_state', id: myId,
          x: m.x, y: m.y, vx: m.vx, vy: m.vy,
          facing: m.facing, action: m.action, hp: m.hp,
          blaster: !!m.blaster, broken: !!m.broken, starMode: !!m.starMode,
          fireMode: !!m.fireMode, iceMode: !!m.iceMode, boots: !!m.boots,
        });
        return;

      case 'enemies_sync':
        if (hostId !== myId) return;
        queue({ type: 'enemies_sync', enemies: Array.isArray(m.enemies) ? m.enemies.slice(0, 200) : [] });
        return;

      case 'boss_sync':
        if (hostId !== myId) return;
        queue({ type: 'boss_sync', boss: m.boss || null });
        return;

      case 'bullets_sync':
        if (hostId !== myId) return;
        queue({ type: 'bullets_sync', bullets: Array.isArray(m.bullets) ? m.bullets.slice(0, 200) : [] });
        return;

      case 'ebullets_sync':
        if (hostId !== myId) return;
        queue({ type: 'ebullets_sync', bullets: Array.isArray(m.bullets) ? m.bullets.slice(0, 300) : [] });
        return;

      case 'game_event':
        queue({ type: 'game_event', id: myId, event: m.event, data: m.data || {} });
        return;

      default:
        return;   // неизвестное на сервере тоже уходило в никуда
    }
  }

  // ── Список комнат ──────────────────────────────────────────────────────────

  function doList() {
    rpc('bb_rooms_list', { p_limit: 30 }).then((rows) => {
      emit({ type: 'rooms_list', rooms: (rows || []).map((r) => ({
        code: r.code, isPublic: true,
        playerCount: r.player_count, maxPlayers: r.max_players,
        mode: r.mode || null, level: r.level || null,
        hostName: r.host_name || '?',
      })) });
    }).catch(() => emit({ type: 'rooms_list', rooms: [] }));
  }

  // ── Создать комнату ────────────────────────────────────────────────────────

  function doCreate(m) {
    me = { n: sanitize(m.nickname) || 'Player 1', c: validColor(m.color),
           r: false, t: Date.now(), h: true };
    const isPublic = !!m.isPublic;
    const maxP = Math.max(2, Math.min(MAX_PLAYERS, parseInt(m.maxPlayers, 10) || MAX_PLAYERS));

    const tryOnce = (left) => {
      const code = makeCode();
      return rpc('bb_room_open', {
        p_code: code, p_host_id: myId, p_host_name: me.n,
        p_public: isPublic, p_max: maxP,
      }).then((ok) => {
        if (ok === true) return code;
        if (left <= 0) throw new Error('codes exhausted');
        return tryOnce(left - 1);   // код занят живой комнатой — берём другой
      });
    };

    tryOnce(4).then((code) => {
      room = { code: code, isPublic: isPublic, maxPlayers: maxP, inGame: false, mode: null, level: null };
      hostId = myId;
      hostLockUntil = 0;
      joinChannel(code);
      inRoom = true;
      emit({ type: 'room_created', code: code, id: myId,
             isPublic: isPublic, maxPlayers: maxP, players: playerList() });
      startBeat();
    }).catch(() => fail('room_create_failed'));
  }

  // ── Войти по коду ──────────────────────────────────────────────────────────

  function doJoin(m) {
    const code = String(m.code || '').toUpperCase().trim();
    if (code.length !== 6) { fail('room_not_found'); return; }
    me = { n: sanitize(m.nickname) || 'Player', c: validColor(m.color),
           r: false, t: Date.now(), h: false };

    rpc('bb_room_info', { p_code: code }).then((rows) => {
      const r = rows && rows[0];
      if (!r) { fail('room_not_found'); return; }
      const cap = r.max_players || MAX_PLAYERS;
      if (r.player_count >= cap) { fail('room_full', { max: cap }); return; }

      room = { code: code, isPublic: !!r.is_public, maxPlayers: cap,
               inGame: !!r.in_game, mode: null, level: null };
      // Хозяина берём из базы: presence подъезжает не мгновенно, а решать,
      // кто главный, надо уже сейчас.
      hostId = r.host_id || null;
      hostLockUntil = Date.now() + JOIN_GRACE_MS;
      joinChannel(code);

      // Ждём, пока комната отзовётся на наше «здравствуйте».
      //
      // Нижняя граница нужна всегда: счётчик в базе обновляется хозяином раз в
      // несколько секунд и запросто отстаёт на одного человека. Полагаясь на
      // него одного, мы решали бы, что состав уже собран, и входили в комнату,
      // «не заметив» хозяина, — а следом назначали хозяином кого попало.
      //
      // Верхняя граница — на случай, если кто-то из списка уже мёртв и не
      // ответит никогда: входим с тем, что есть, остальные доедут сами.
      const want = Math.max(1, r.player_count || 1) + 1;
      const t0 = Date.now();
      (function waitRoom() {
        if (closed || !topic) return;
        const waited   = Date.now() - t0;
        const gotAll   = peers.size >= want && (!hostId || peers.has(hostId));
        if (waited < 700 || (!gotAll && waited < 1600)) { setTimeout(waitRoom, 80); return; }
        inRoom = true;
        emit({ type: 'room_joined', code: code, id: myId, hostId: hostId,
               maxPlayers: cap, players: playerList() });
      })();
    }).catch(() => fail('room_not_found'));
  }

  // ── Выйти ──────────────────────────────────────────────────────────────────

  function doLeave() {
    if (!topic) return;
    const wasHost = hostId === myId;
    const alone = peers.size <= 1;
    const code = room && room.code;
    stopBeat();
    leaveChannel();
    inRoom = false;
    room = null;
    hostId = null;
    // Комнату сносим, только если уходит её хозяин и в ней больше никого:
    // иначе оставшиеся продолжат играть, а их новый хозяин допишет строку сам.
    if (wasHost && alone && code) rpc('bb_room_close', { p_code: code, p_host_id: myId }).catch(() => {});
  }

  // ── Пинг ───────────────────────────────────────────────────────────────────
  // Меряем то же, что мерил бы сервер: время до Supabase и обратно. Служебный
  // heartbeat Phoenix для этого и нужен — он не тратит квоту сообщений.

  function doPing() {
    if (!sock || sock.readyState !== 1) return;
    pingRef = nextRef();
    lastHb = Date.now();
    raw({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: pingRef });
  }

  // ── Соединение ─────────────────────────────────────────────────────────────

  try {
    sock = new WebSocket(wsUrl);
  } catch (e) {
    api.readyState = 3;
    setTimeout(() => { if (api.onerror) api.onerror({ type: 'error' });
                       if (api.onclose) api.onclose({ code: 1006 }); }, 0);
    return api;
  }

  sock.onopen = () => {
    if (closed) { try { sock.close(); } catch (e) {} return; }
    api.readyState = 1;
    lastHb = Date.now();
    // Соединение с Realtime рвётся, если долго молчать. Игра пингует раз в три
    // секунды, пока открыто лобби, но во время матча может и не пинговать —
    // подстраховываемся своим редким ударом.
    hbTimer = setInterval(() => {
      if (Date.now() - lastHb < HB_MS) return;
      lastHb = Date.now();
      raw({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: nextRef() });
    }, 5000);
    if (api.onopen) { try { api.onopen({}); } catch (e) {} }
    emit({ type: 'connected', id: myId, maxPlayers: MAX_PLAYERS });
  };

  sock.onmessage = (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch (e) { return; }
    const ev2 = m.event;

    if (ev2 === 'phx_reply') {
      if (pingRef && m.ref === pingRef) { pingRef = null; emit({ type: 'pong', ts: Date.now() }); }
      if (joinRef && m.ref === joinRef) {
        joinRef = null;
        if (m.payload && m.payload.status === 'ok') {
          // Канал наш — объявляемся. «Здравствуйте» просит всех отозваться:
          // так состав комнаты собирается за доли секунды, не дожидаясь
          // неторопливой рассылки присутствия.
          joinOk = true;
          track();
          queue({ type: '_hello', me: selfMeta() });
          startHere();
          flush();
        } else {
          // Канал не открылся (например, проект на паузе) — для игры это то же
          // самое, что «комнаты нет»: пусть покажет ошибку, а не ждёт молча.
          fail('room_not_found');
        }
      }
      return;
    }
    if (m.topic !== topic) return;

    if (ev2 === 'presence_state') { applyPresenceState(m.payload); return; }
    if (ev2 === 'presence_diff')  { applyPresenceDiff(m.payload);  return; }
    if (ev2 === 'broadcast') {
      const p = m.payload || {};
      if (p.event === 'b') takeBatch(p.payload);
      return;
    }
  };

  sock.onerror = () => {
    if (closed) return;
    if (api.onerror) { try { api.onerror({ type: 'error' }); } catch (e) {} }
  };

  sock.onclose = (e) => {
    stopBeat();
    stopHere();
    if (hbTimer) { clearInterval(hbTimer); hbTimer = 0; }
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = 0; }
    api.readyState = 3;
    if (closed) return;
    closed = true;
    if (api.onclose) { try { api.onclose({ code: (e && e.code) || 1006 }); } catch (er) {} }
  };

  function closeAll() {
    if (closed) { api.readyState = 3; return; }
    api.readyState = 2;
    try { doLeave(); } catch (e) {}
    closed = true;
    stopBeat();
    stopHere();
    if (hbTimer) { clearInterval(hbTimer); hbTimer = 0; }
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = 0; }
    try { if (sock) sock.close(); } catch (e) {}
    api.readyState = 3;
  }

  return api;
}

window.BBSupabaseRelay = {
  matches(url) { return typeof url === 'string' && url.slice(0, PROTO.length) === PROTO; },
  open: open,
  PROTO: PROTO,
};

})();
