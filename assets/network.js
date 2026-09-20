// ═══════════════════════════════════════════════════════════
//  BYTE BLASTER — NETWORK MODULE
//  Self-contained: no dependencies on game internals except
//  showMain(), hideAll(), mkPlayer(), twoPlayer, and the
//  game-start functions.
// ═══════════════════════════════════════════════════════════
(function(){
'use strict';

// Адреса релея. Встроенные — запасные: если студия задаст свои в Supabase
// (таблица app_config, ключ bb_relay_urls), игра переедет на них без пересборки
// и без обновления у игроков. Пустое значение, отсутствующая строка, недоступный
// Supabase, мусор вместо адреса — всё это молча оставляет встроенные.
//
// Порядок: сначала свой сервер, потом канал через Supabase (supabase:// — не
// настоящий WebSocket-адрес, а метка для assets/relay-supabase.js, который
// подменяет сокет), потом прежнее имя сервера.
//
// Сервер идёт первым там, где он открывается: он быстрее и ничего не стоит.
// Канал через Supabase нужен для стран, где подсеть Railway режут на уровне
// пакетов (переезд на свой домен не помог — фильтр смотрит на адрес, а не на
// имя). Плата за такой порядок — игроки расходятся по двум источникам, и
// комнаты одного не видны в списке другого. Чтобы код комнаты всё-таки
// работал между ними, вход по коду при ответе «нет такой комнаты» повторяется
// на следующем адресе — см. _tryJoinElsewhere().
const SERVER_URL_BUILTIN = 'wss://ws.byte-blaster-server.run.place';
const SERVER_URL_SUPABASE = 'supabase://zyjhvuhovimorpokiwty.supabase.co';
const SERVER_URL_FALLBACK = 'wss://byte-blaster-server-production.up.railway.app';
let SERVER_URL = SERVER_URL_BUILTIN;

/* ── Список адресов, а не один ───────────────────────────────────────────────
   У одного адреса нет запасного выхода: в России домен *.up.railway.app
   блокируется на уровне TLS-приветствия — TCP до сервера доходит, а соединение
   рвётся, как только клиент называет имя. Игрок при этом видит просто
   «нет связи», и сделать ничего не может: адрес зашит в его .exe.

   Поэтому адресов несколько. Игра пробует их по очереди, запоминает тот, что
   ответил, и в следующий раз начинает с него. Список можно менять из базы
   (app_config, ключи bb_relay_url и bb_relay_urls) — то есть переезд на новое
   имя доезжает до уже установленных сборок без обновления. */
let RELAY_LIST = [SERVER_URL_BUILTIN, SERVER_URL_SUPABASE, SERVER_URL_FALLBACK];
let _relayIdx = 0;
const _RELAY_OK_KEY = 'bb_relay_ok';       // последний адрес, который отвечал
const _RELAY_TRY_MS = 5000;                // сколько ждём открытия сокета

function _relayValid(v){
  if(typeof v !== 'string') return false;
  const s = v.trim();
  // Канал через Supabase записывается не как ws://, а особой меткой: за ней
  // стоит не сервер, а подменный сокет из assets/relay-supabase.js.
  if(window.BBSupabaseRelay && window.BBSupabaseRelay.matches(s)) return true;
  return /^wss?:\/\/[^\s]+$/i.test(s);
}

// Открыть соединение по адресу: обычный сокет или подменный — через Supabase.
function _openSocket(url){
  if(window.BBSupabaseRelay && window.BBSupabaseRelay.matches(url)){
    return window.BBSupabaseRelay.open(url);
  }
  return new WebSocket(url);
}

function _setRelayList(list){
  const seen = {}, out = [];
  // Встроенные адреса всегда в хвосте: даже с пустой или испорченной настройкой
  // в базе игроку остаётся куда подключиться.
  list.concat([SERVER_URL_BUILTIN, SERVER_URL_SUPABASE, SERVER_URL_FALLBACK]).forEach((raw) => {
    const v = String(raw || '').trim().replace(/\/+$/, '');
    if(!_relayValid(v) || seen[v]) return;
    seen[v] = true; out.push(v);
  });
  RELAY_LIST = out.length ? out : [SERVER_URL_BUILTIN];
  _relayIdx = 0;
  SERVER_URL = RELAY_LIST[0];
}

// Прошлый рабочий адрес идёт первым: если игрок уже нашёл живой путь, незачем
// заставлять его каждый запуск ждать таймаута на мёртвом. Там, где сервер
// закрыт, это экономит пять секунд на каждом входе в «Онлайн».
try{
  const ok = localStorage.getItem(_RELAY_OK_KEY);
  if(_relayValid(ok)) _setRelayList([ok]);
}catch(e){ /* приватный режим — просто начнём со встроенного */ }

const _CFG_URL = 'https://zyjhvuhovimorpokiwty.supabase.co';
const _CFG_KEY = 'sb_publishable_1bj04J3qsO1EqsKPQeSbmg_cBDEtreK';
(async function loadRelayFromConfig(){
  try{
    const res = await fetch(
      _CFG_URL + '/rest/v1/app_config?key=in.(bb_relay_url,bb_relay_urls)&select=key,value',
      { headers: { apikey: _CFG_KEY, Authorization: 'Bearer ' + _CFG_KEY } });
    if(!res.ok) return;
    const rows = await res.json();
    const byKey = {};
    (rows || []).forEach((r) => { byKey[r.key] = String(r.value || '').trim(); });
    // bb_relay_urls — несколько адресов через запятую или перевод строки:
    // основной и запасные. bb_relay_url оставлен ради старых записей.
    const list = (byKey.bb_relay_urls || '').split(/[\s,]+/).filter(Boolean);
    if(byKey.bb_relay_url) list.unshift(byKey.bb_relay_url);
    // Принимаем только настоящие WebSocket-адреса: опечатка в панели не должна
    // отправлять всех игроков в никуда.
    const good = list.filter(_relayValid);
    if(!good.length) return;
    const before = RELAY_LIST.join('|');
    _setRelayList(good);
    if(RELAY_LIST.join('|') === before) return;
    // Подключение могло уже подняться на прежнем адресе. Переезжаем сразу,
    // но только вне игры — рвать живую комнату из-за настройки нельзя.
    if(!window.netActive && _connectedUrl && _connectedUrl !== activeUrl()){
      try{ if(ws) ws.close(); }catch(e){}
      connect();
    }
  }catch(e){ /* нет сети или Supabase недоступен — остаёмся на встроенном */ }
})();
const MAX_NET_PLAYERS = 5;

// ── Colour presets ───────────────────────────────────────────────────────────
// Десятка цветов живёт в assets/robots.js — ОДНА на лобби и на аватары профиля.
// Раньше здесь был свой список, а в профиле свой: игрок выбирал робота в
// профиле и не узнавал его в комнате. Запасной набор нужен только на случай,
// когда robots.js не подключён (отдельные тестовые страницы игры).
const COLOR_PRESETS = (window.BB_ROBOTS || []).map(r => r.hsl).length
  ? window.BB_ROBOTS.map(r => r.hsl)
  : [{h:0,s:88,l:52},{h:26,s:95,l:52},{h:48,s:95,l:52},{h:128,s:72,l:44},
     {h:190,s:88,l:48},{h:218,s:88,l:52},{h:272,s:72,l:56},{h:330,s:85,l:62},
     {h:220,s:12,l:30},{h:24,s:48,l:36}];

// ── State ────────────────────────────────────────────────────────────────────
let ws        = null;
let myId      = null;
let myColor   = COLOR_PRESETS[0];
let myNick    = 'PLAYER';
let roomCode  = null;
let isHost    = false;
let isReady   = false;
let players   = [];   // [{id,nickname,color,ready,isHost}]
let roomMaxPlayers = MAX_NET_PLAYERS; // current room cap (from server)

// ── Lobby UI state ────────────────────────────────────────────────
let _uiView      = 'create';  // 'create' | 'find' — which connect sub-view is shown
let _myColorIdx  = 0;         // index into COLOR_PRESETS (persisted)
let _createPublic= true;      // create-room: OPEN(true=public) / CLOSED(false=private)
let _createMax   = MAX_NET_PLAYERS; // create-room: chosen player limit (2–5)

// LAN endpoint for the «LOCAL» source toggle. The Electron app auto-starts an
// embedded relay (see local-server.js) on port 3000, so the HOST reaches it at
// localhost. A LAN peer joining another machine's room types that machine's IP
// into the 'HOST ADDRESS' field; we persist it and connect there instead.
const LAN_PORT = 3000;
// Only the desktop (Electron) build runs the embedded LAN relay. The web build
// has no localhost relay it could reach, so its «LOCAL» source transparently
// uses the cloud relay instead — same-machine/LAN friends still play together by
// room code, just routed through the internet. (electronAPI is exposed by preload.)
const IS_DESKTOP = !!(window.electronAPI && typeof window.electronAPI.getLanInfo === 'function');
let _lanHost = 'localhost';
try { const _lh = localStorage.getItem('bb_net_lanhost'); if(_lh) _lanHost = _lh; } catch(e){}
function lanUrl(){
  if(!IS_DESKTOP) return SERVER_URL;   // web: no localhost relay — fall back to cloud
  const h=(_lanHost||'localhost').trim()||'localhost'; return 'ws://'+h+':'+LAN_PORT;
}
let _connectedUrl = null;     // URL the live socket is using (so we know when to reconnect)
let _lobbyMode = 'server';    // 'lan' | 'server' — source toggle + lobby header style
function activeUrl(){ return _lobbyMode === 'lan' ? lanUrl() : SERVER_URL; }

// Expose to global scope so main game loop can read/call them
Object.defineProperty(window,'netIsHost',{get:()=>isHost});
Object.defineProperty(window,'netWs',    {get:()=>ws});
window.netWsSend = (obj) => wsSend(obj);
let pingStart = 0;
let pingMs    = 0;
let pingTimer = null;

// Selected level for next game
let _netMode  = 'infinite';
let _netLevel = 1;
let _netSeed  = 0;
// Expose so main game loop can update them
Object.defineProperty(window,'_netLevel',{get:()=>_netLevel,set:(v)=>{_netLevel=v;}});
Object.defineProperty(window,'_netMode', {get:()=>_netMode, set:(v)=>{_netMode=v;}});
Object.defineProperty(window,'_netSeed', {get:()=>_netSeed, set:(v)=>{_netSeed=v;}});

// Remote players for in-game rendering
// netPlayers: Map<id, {x,y,vx,vy,facing,action,color,nickname,playerObj}>
window.netPlayers = new Map();
window.netActive  = false;  // true when a network game is running

// ── DOM refs ────────────────────────────────────────────────────────────────
const $lobby       = document.getElementById('netLobby');
const $connect     = document.getElementById('netConnect');
const $room        = document.getElementById('netRoom');
const $connStatus  = document.getElementById('netConnStatus');
const $roomCode    = document.getElementById('netRoomCode');
const $playerList  = document.getElementById('netPlayerList');
const $readyBtn    = document.getElementById('netReadyBtn');
const $startBtn    = document.getElementById('netStartBtn');
const $roomStatus  = document.getElementById('netRoomStatus');
const $chat        = document.getElementById('netChat');
const $chatInput   = document.getElementById('netChatInput');
const $pingEl      = document.getElementById('netPing');
const $gamePing    = document.getElementById('netGamePing');

// Lift all full-screen network overlays out of #stage to <body>. On mobile #stage
// carries a transform:scale() that fits the game canvas to the screen; any fixed
// overlay nested inside it gets shrunk into that letterbox (the "online tab does
// not scale" bug). At body level they cover the real viewport.
['netLobby','netLoading','netConnLost','netWaiting','netGamePing'].forEach(function(id){
  const el = document.getElementById(id);
  if (el && el.parentNode !== document.body) document.body.appendChild(el);
});

// Wrap the lobby's content (title + panels) in a single inner box, then scale
// THAT to fit the viewport — so the whole online screen shrinks proportionally
// on a phone instead of only being scrollable. Mirrors the save-slots picker.
(function setupLobbyScale(){
  if(!$lobby) return;
  let inner = document.getElementById('netLobbyInner');
  if(!inner){
    inner = document.createElement('div');
    inner.id = 'netLobbyInner';
    while($lobby.firstChild) inner.appendChild($lobby.firstChild);
    $lobby.appendChild(inner);
  }
  function fitLobby(){
    if(!inner || $lobby.style.display === 'none') return;
    inner.style.transform = 'none';
    const vv = window.visualViewport;
    const vpW = (vv && vv.width)  ? vv.width  : window.innerWidth;
    const vpH = (vv && vv.height) ? vv.height : window.innerHeight;
    const w = inner.offsetWidth, h = inner.offsetHeight;
    if(!w || !h) return;
    // offsetWidth/Height не учитывают zoom, а вьюпорт — реальный. Без деления
    // на множитель интерфейса подгонка «не видела» увеличения и ужимала лобби
    // ровно во столько же раз, во сколько игрок его увеличил.
    const uz = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--bbUI')) || 1;
    let k = Math.min((vpW * 0.96) / (w * uz), (vpH * 0.96) / (h * uz), 1);
    // READABILITY FLOOR. Scaling the whole lobby to fit meant every attempt to
    // make its buttons thumb-sized simply shrank k by the same factor — the
    // controls measured 23px tall on a phone no matter what the CSS said. Below
    // this floor we stop shrinking and let the lobby scroll instead: a control
    // you can scroll to and actually hit beats one that fits but cannot be hit.
    // «Играют пальцем?» — общий ответ из game.js (см. bbWantsTouchUI): у любого
    // ноутбука с сенсорным экраном прежняя проверка была истинной.
    const isTouch = (typeof window.bbWantsTouchUI === 'function')
      ? window.bbWantsTouchUI()
      : (('ontouchstart' in window) || navigator.maxTouchPoints > 0 ||
         (window.gameSettings && window.gameSettings.touchControls === 'on'));
    const FLOOR = isTouch ? 0.62 : 0.4;
    const floored = k < FLOOR;
    if (floored) k = FLOOR;
    inner.style.transform = 'scale(' + k + ')';
    // The overlay clips by default (see network.css). When we refuse to shrink
    // any further it has to scroll, and the content has to sit at the top so the
    // first thing on screen is the top of the panel, not its middle.
    $lobby.style.overflowY = floored ? 'auto' : 'hidden';
    $lobby.style.justifyContent = floored ? 'flex-start' : 'center';
    inner.style.transformOrigin = floored ? 'top center' : 'center center';
    // A scaled box still reserves its UNSCALED height in the scroll container,
    // leaving a large empty gap. Reserve the visual height instead.
    // Высоту резервируем видимую, а она с учётом увеличения — h * uz * k.
    inner.style.marginBottom = floored ? (-(h * uz * (1 - k)) + 'px') : '';
  }
  window._netFitLobby = fitLobby;
  // Re-fit on any content/size change (switching connect<->room, player list,
  // chat growth, rotation, URL bar show/hide).
  if(window.ResizeObserver){ try{ new ResizeObserver(fitLobby).observe(inner); }catch(e){} }
  let raf = 0;
  const onResize = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fitLobby); };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => { onResize(); setTimeout(onResize,250); setTimeout(onResize,600); });
  if(window.visualViewport){ window.visualViewport.addEventListener('resize', onResize); window.visualViewport.addEventListener('scroll', onResize); }
})();

// Best-effort: tell the server we're leaving when the page is actually being
// torn down (tab/app close). The server heartbeat is the real safety net, but
// this clears the room instantly in the common "closed the app" case. Fires on
// pagehide (terminal) — NOT visibilitychange, so a brief app-switch never drops
// the player from an active lobby.
window.addEventListener('pagehide', function(){
  try{ if(ws && ws.readyState===1 && roomCode){ wsSend({type:'leave_room'}); } }catch(e){}
});

// Update the in-game ping readout (top-right corner). Visible only during a
// network game; colour-coded by latency like the lobby ping.
function updateGamePing(){
  if(!$gamePing) return;
  if(window.netActive){
    $gamePing.style.display = 'block';
    $gamePing.textContent   = '📶 ' + pingMs + ' ms';
    $gamePing.style.color   = pingMs < 90 ? '#0f8' : (pingMs < 200 ? '#fc0' : '#f55');
  } else {
    $gamePing.style.display = 'none';
  }
}

// ── Saved profile (nickname + colour persist across sessions) ──────────────
function loadProfile(){
  try{
    const n = localStorage.getItem('bb_net_nick');
    if(n) myNick = sanitizeNick(n);
    const ci = parseInt(localStorage.getItem('bb_net_color'), 10);
    if(!isNaN(ci) && ci>=0 && ci<COLOR_PRESETS.length){ _myColorIdx = ci; myColor = COLOR_PRESETS[ci]; }
  }catch(e){ /* localStorage blocked — fall back to defaults */ }
}
function saveProfile(){
  try{
    localStorage.setItem('bb_net_nick', myNick);
    localStorage.setItem('bb_net_color', String(_myColorIdx));
  }catch(e){ /* ignore */ }
}

// ── Colour picker ────────────────────────────────────────────────────────────
function buildColorPicker(){
  const ring = document.getElementById('netColorPicker');
  ring.innerHTML = '';
  COLOR_PRESETS.forEach((col, i) => {
    const sw = document.createElement('div');
    sw.className = 'net-color-swatch' + (i===_myColorIdx?' selected':'');
    sw.style.background = `hsl(${col.h},${col.s}%,${col.l}%)`;
    sw.style.boxShadow  = `0 0 8px hsl(${col.h},${col.s}%,${col.l}%88)`;
    sw.dataset.idx = i;
    sw.onclick = () => {
      ring.querySelectorAll('.net-color-swatch').forEach(s=>s.classList.remove('selected'));
      sw.classList.add('selected');
      _myColorIdx = i;
      myColor = COLOR_PRESETS[i];
      saveProfile();
      // Аватар в профиле — тот же робот, что и в комнате: меняем заодно, но
      // только если игрок не выбрал себе портрет (Лейлу, АРХОН, ПРИЗМУ).
      try{
        const list = window.BB_ROBOTS;
        const cur  = localStorage.getItem('bb_avatar') || '';
        if(list && list[i] && (!cur || cur.slice(0,2) === 'r_')){
          localStorage.setItem('bb_avatar', 'r_' + list[i].id);
        }
      }catch(e){ /* localStorage закрыт — цвет всё равно сохранён */ }
      // Apply immediately to local player if in-game
      if(typeof player !== 'undefined' && player) player.colorScheme = myColor;
      // Update my own avatar in the player list
      const myEntry = players.find(p=>p.id===myId);
      if(myEntry){ myEntry.color = myColor; refreshPlayerList(); }
      // Notify others in room
      if(ws && ws.readyState===1 && roomCode){
        wsSend({type:'set_color', color:myColor});
      }
    };
    ring.appendChild(sw);
  });
}

// ── WebSocket ────────────────────────────────────────────────────────────────
let _reconnectTimer = null;
let _reconnectTries = 0;
let _manualClose    = false;  // true when WE close the socket (leave) — don't reconnect

function connect(){
  if(_reconnectTimer){ clearTimeout(_reconnectTimer); _reconnectTimer=null; }
  _manualClose = false;
  if(ws && ws.readyState < 2){ try{ ws.close(); }catch(e){} }
  $connStatus.textContent = T('netConnectingShort');
  $connStatus.classList.remove('net-error');
  let sock;
  const url = activeUrl();
  _connectedUrl = url;
  try{
    sock = ws = _openSocket(url);
  }catch(e){
    scheduleReconnect();
    return;
  }

  /* Заблокированный по имени адрес НЕ отказывает — он молчит: TCP открылся,
     а TLS-приветствие дальше не пропускают, и сокет висит до системного
     таймаута (это минуты). Поэтому ждём сами: не открылось за пять секунд —
     закрываем и берём следующий адрес из списка. */
  let _tryTimer = 0;
  if(_lobbyMode !== 'lan' && RELAY_LIST.length > 1){
    _tryTimer = setTimeout(() => {
      if(ws !== sock || sock.readyState === 1) return;
      _relayIdx = (_relayIdx + 1) % RELAY_LIST.length;
      SERVER_URL = RELAY_LIST[_relayIdx];
      try{ sock.close(); }catch(e){}
      // Следующая попытка — уже на новом адресе, без задержки: игрок и так ждёт.
      if(!_manualClose) connect();
    }, _RELAY_TRY_MS);
  }

  ws.onopen = () => {
    if(ws !== sock) return; // a newer socket superseded this one
    if(_tryTimer){ clearTimeout(_tryTimer); _tryTimer = 0; }
    _reconnectTries = 0;
    // Рабочий адрес запоминаем: со следующего запуска начинаем с него, а не с
    // того, который в этой стране всё равно не откроется.
    if(_lobbyMode !== 'lan'){
      try{ localStorage.setItem(_RELAY_OK_KEY, url); }catch(e){}
    }
    $connStatus.textContent = T('netConnected');
    $connStatus.classList.remove('net-error');
    hideConnLost();
    startPing();
  };

  ws.onmessage = (e) => {
    if(ws !== sock) return;
    let msg;
    try{ msg=JSON.parse(e.data); }catch{ return; }
    handleServerMsg(msg);
  };

  ws.onclose = () => {
    if(ws !== sock) return; // stale socket closing — don't touch the live one's UI/state
    if(_tryTimer){ clearTimeout(_tryTimer); _tryTimer = 0; }  // адрес уже отвалился сам
    stopPing();
    if(_manualClose) return;
    // Mid-game drop: can't silently rejoin a relay room — surface it. Also
    // drop netActive immediately (not just on the player's explicit "Return
    // to Lobby" click) — leaving it true with no working connection made
    // boss/enemy AI permanently think "I'm a guest, the host drives this"
    // (see updateBoss()'s network guard), i.e. bosses stopped attacking and
    // stopped colliding with the player until the room was properly left.
    if(window.netActive){
      window.netActive = false;
      showConnLost();
      return;
    }
    // Dropped while sitting in a room lobby: the relay forgets membership on
    // disconnect, so we can't silently rejoin. Bounce back to the connect screen.
    if(roomCode && $room.style.display !== 'none'){
      roomCode = null; isHost = false; isReady = false; players = [];
      $room.style.display = 'none';
      $connect.style.display = '';
    }
    $connStatus.textContent = T('netDisconnected');
    $connStatus.classList.add('net-error');
    if($lobby.style.display==='flex') scheduleReconnect();
  };

  ws.onerror = () => {
    if(ws !== sock) return;
    if(!window.netActive){
      $connStatus.textContent = T('netConnError');
      $connStatus.classList.add('net-error');
    }
  };
}

// Exponential-ish backoff, capped, so a downed server doesn't hammer the network.
function scheduleReconnect(){
  if(_manualClose) return;
  if(_reconnectTimer) return;
  _reconnectTries++;
  const delay = Math.min(1000 * Math.pow(1.6, Math.min(_reconnectTries, 6)), 12000);
  $connStatus.textContent = _reconnectTries > 1 ? T('netConnFailed') : T('netDisconnected');
  _reconnectTimer = setTimeout(()=>{ _reconnectTimer=null; connect(); }, delay);
}

function showConnLost(){
  const ov = document.getElementById('netConnLost');
  if(ov){ ov.style.display='flex'; netApplyLang(); }
}
function hideConnLost(){
  const ov = document.getElementById('netConnLost');
  if(ov) ov.style.display='none';
}

function wsSend(obj){
  // Запоминаем последний вход по коду: если этого кода на текущем сервере нет,
  // поищем комнату на остальных (см. _tryJoinElsewhere).
  if(obj && obj.type === 'join_room' && obj.code){
    if(!_lastJoin || _lastJoin.code !== obj.code) _lastJoin = { code: obj.code, tried: [] };
    const url = activeUrl();
    if(_lastJoin.tried.indexOf(url) < 0) _lastJoin.tried.push(url);
    _lastJoin.at = Date.now();
  }
  if(ws && ws.readyState===1) ws.send(JSON.stringify(obj));
}

/* ── Комната может жить на другом адресе ─────────────────────────────────────
   Игроки расходятся по источникам: у кого открывается свой сервер — идут туда,
   остальные попадают на канал через Supabase. Комнаты одного источника не
   видны в списке другого, и шесть символов кода сами по себе ничего не значат.

   Поэтому «нет такой комнаты» — не окончательный ответ: пробуем те адреса, где
   ещё не искали. Для игрока это выглядит как чуть более долгий вход, зато код
   друга срабатывает независимо от того, кому какой сервер доступен. */
let _lastJoin = null;

function _tryJoinElsewhere(){
  if(_lobbyMode === 'lan') return false;                 // локальная сеть — искать негде
  if(!_lastJoin || Date.now() - _lastJoin.at > 20000) return false;
  const next = RELAY_LIST.find(u => _lastJoin.tried.indexOf(u) < 0);
  if(!next) return false;

  _lastJoin.tried.push(next);
  _relayIdx = RELAY_LIST.indexOf(next);
  SERVER_URL = next;
  setRoomStatus(T('netLookElsewhere'));
  $connStatus.textContent = T('netLookElsewhere');
  $connStatus.classList.remove('net-error');

  _manualClose = false;
  if(ws){ try{ ws.close(); }catch(e){} }
  connect();

  const code = _lastJoin.code;
  let tries = 0;
  const t = setInterval(() => {
    if(ws && ws.readyState === 1){
      clearInterval(t);
      wsSend({type:'join_room', code, nickname:myNick, color:myColor});
    } else if(++tries > 40) clearInterval(t);
  }, 250);
  return true;
}

// ── Ping ─────────────────────────────────────────────────────────────────────
function startPing(){
  stopPing();
  pingTimer = setInterval(()=>{
    pingStart = Date.now();
    wsSend({type:'ping'});
  }, 3000);
}
function stopPing(){ if(pingTimer){ clearInterval(pingTimer); pingTimer=null; } }

// ── Server message handler ───────────────────────────────────────────────────
function handleServerMsg(msg){
  switch(msg.type){

    case 'rooms_list':
      renderPublicRooms(msg.rooms || []);
      break;

    case 'connected':
      myId = msg.id;
      break;

    case 'pong':
      pingMs = Date.now() - pingStart;
      $pingEl.textContent = pingMs + ' ms';
      // Colour by latency: green < 90ms, yellow < 200ms, red otherwise
      $pingEl.style.color = pingMs < 90 ? '#0f8' : (pingMs < 200 ? '#fc0' : '#f55');
      updateGamePing(); // keep the in-game readout in sync
      break;

    case 'room_created':
    case 'room_joined':
      roomCode = msg.code;
      isHost   = (msg.id===msg.hostId)||(msg.type==='room_created');
      myId     = msg.id;
      players  = msg.players || [];
      roomMaxPlayers = msg.maxPlayers || MAX_NET_PLAYERS;
      enterRoomScreen();
      break;

    case 'player_joined':
      players = msg.players || [];
      refreshPlayerList();
      updateStartBtn();
      addChat('★', T('netPlayerJoined', esc(msg.player.nickname)));
      netToast('👤', T('netPlayerJoined', msg.player.nickname), '#0f8');
      // Зашёл посреди уровня — решаем, пускать ли (см. _onJoinDuringGame).
      if(window.netActive) _onJoinDuringGame(msg.player);
      break;

    case 'player_left':
      {
        const gone = players.find(p=>p.id===msg.id);
        players = msg.players || [];
        refreshPlayerList();
        updateStartBtn();
        if(gone) addChat('★', T('netPlayerLeft', esc(gone.nickname)));
        if(gone) netToast('🚪', T('netPlayerLeft', gone.nickname), '#fc4');
        // Remove from live render map
        window.netPlayers.delete(msg.id);
        // Смотреть за ушедшим нельзя: панель наблюдателя переводит камеру на
        // следующего живого (или честно говорит, что смотреть не за кем).
        _specRefresh();
        // If we're mid-level waiting on finishers, a leaver must not block the
        // room: drop them from the tally and re-check whether everyone left is done.
        // Проверяем ВСЕГДА, а не только когда кто-то уже финишировал: раньше при
        // пустом счётчике выход игрока не пересчитывал «X из N», и оставшиеся
        // ждали ушедшего. Чистим и список дошедших до флага — иначе комната
        // уезжала дальше по уровню, который прошёл только тот, кого уже нет.
        if(isHost && window.netActive){
          _netFinished.delete(msg.id);
          _netCleared.delete(msg.id);
          _netPending.delete(msg.id);
          _hostBroadcastProgress();
        }
      }
      break;

    case 'ready_changed':
      players = msg.players || [];
      refreshPlayerList();
      updateStartBtn();
      break;

    case 'color_changed':
      const cp = players.find(p=>p.id===msg.id);
      if(cp){ cp.color=msg.color; refreshPlayerList(); }
      // Update live render if in-game
      const np = window.netPlayers.get(msg.id);
      if(np && np.playerObj){ np.playerObj.colorScheme=msg.color; }
      break;

    case 'promoted_to_host':
      isHost = true;
      $startBtn.style.display = 'block';
      const $lp2 = document.getElementById('netLevelPicker');
      if($lp2) $lp2.style.display = 'flex';
      setRoomStatus(T('netNowHost'));
      updateStartBtn();
      // Смена хоста посреди уровня: счётчик финишировавших живёт только у хоста,
      // и у нового он пуст. Те, кто уже дошёл до флага или выбыл, второй раз сами
      // об этом не скажут — комната зависала у флага навсегда. Просим всех
      // повторить своё состояние и добавляем себя.
      if(window.netActive){
        _netFinished = new Set(); _netCleared = new Set();
        if(_iFinished) _hostMarkFinished(myId, _iEliminated, true);
        wsSend({type:'game_event', event:'need_finish'});
      }
      break;

    // The server reassigned the host (e.g. the previous host's tab froze and the
    // freeze-watchdog handed authority to another player). Everyone gets this so
    // their player list / host marker stays correct. Crucially, if I *was* the
    // host and authority moved away from me, I must drop my host role now —
    // otherwise a recovered (un-frozen) old host would keep driving enemy/boss AI
    // and fight the new host for authority. The new host is told separately via
    // 'promoted_to_host'.
    case 'host_changed':
      if(Array.isArray(msg.players)) players = msg.players;
      if(msg.hostId && msg.hostId !== myId && isHost){
        isHost = false;
        if($startBtn) $startBtn.style.display = 'none';
        const $lp4 = document.getElementById('netLevelPicker');
        if($lp4) $lp4.style.display = 'none';
      }
      {
        const _nh = players.find(p=>p.id===msg.hostId);
        if(_nh) addChat('★', T('netNewHost', esc(_nh.nickname)));
      }
      refreshPlayerList();
      updateStartBtn();
      break;

    case 'level_selected':
      _netMode  = msg.mode  || 'infinite';
      _netLevel = msg.level || 1;
      _netSeed  = msg.seed  || 0;
      // Update level picker UI for host, and status for others
      updateLevelStatus();
      break;

    case 'level_complete': {
      // Повтор уровня после общего провала. Определяем по номеру, а не по
      // msg.retry: релей пересобирает сообщение и своих полей не сохраняет,
      // так что фикс не должен зависеть от версии сервера.
      const _curLvl = (typeof advMode!=='undefined' && advMode)
        ? (typeof advLevel!=='undefined'?advLevel:0)
        : (typeof level!=='undefined'?level:0);
      const _isRetry = !!msg.retry || ((msg.nextLevel||0) === _curLvl && _curLvl > 0);
      _netLevel = msg.nextLevel || _netLevel;
      // The co-op mode is fixed for the whole session (chosen before game_started)
      // and never changes between levels — only the level number advances. We do
      // NOT take msg.mode here: a buggy/old relay could echo the wrong mode (e.g.
      // 'adventure' for an infinite room) and wrongly flip the whole room. Keep our
      // current _netMode so infinite stays infinite. (Server is also fixed.)
      // Everyone reached the flag — clear the "waiting for players" state.
      _resetFinishState();
      // Show countdown and start next level for all clients
      showNetCountdown(_netMode, _netLevel, () => {
        window._netLevelAdvancing = false; // new level — allow it to be completed
        if(typeof hardMode!=='undefined') hardMode=false; // keep co-op deterministic
        // Тот, кто ждал в комнате (зашёл посреди уровня, а хост пускать не
        // разрешил), входит здесь — на границе уровней. Ему нужен полный запуск
        // сетевой игры, а не просто startAdv: иначе не будет ни чужих роботов,
        // ни рассылки состояния.
        if(!window.netActive){ startNetworkGame(players); return; }
        reviveForNewLevel();   // именно здесь, а не на отсчёте
        if(_netMode === 'adventure'){
          if(typeof startAdv === 'function') startAdv(_netLevel, false);
        } else {
          if(typeof level !== 'undefined') level = _netLevel;
          if(typeof startInf === 'function') startInf(false);
        }
        // Re-apply colours after level reload
        if(typeof player !== 'undefined' && player){
          player.colorScheme = myColor;
          player.nickname    = myNick;
        }
      }, _isRetry);
      break;
    }

    case 'game_started':
      players   = msg.players || [];
      _resetFinishState();
      _netMode  = msg.mode    || _netMode  || 'infinite';
      _netLevel = msg.level   || _netLevel || 1;
      _netSeed  = msg.seed    || _netSeed  || Date.now();
      showNetCountdown(_netMode, _netLevel, () => startNetworkGame(players));
      break;

    case 'player_state':
      updateRemotePlayer(msg);
      break;

    case 'enemies_sync':
      applyEnemiesSync(msg.enemies);
      break;

    case 'boss_sync':
      applyBossSync(msg.boss);
      break;

    case 'bullets_sync':
      applyBulletsSync(msg.bullets);
      break;

    case 'ebullets_sync':
      applyEBulletsSync(msg.bullets);
      break;

    case 'game_event':
      handleRemoteEvent(msg);
      break;

    case 'chat':
      const sender = players.find(p=>p.id===msg.id);
      addChat(esc(sender?sender.nickname:'???'), esc(msg.text));
      break;

    case 'error':
      handleError(msg.reason, msg.max);
      break;
  }
}

// ── UI helpers ───────────────────────────────────────────────────────────────
function enterRoomScreen(){
  // Показываем пустой строкой, а не 'flex': инлайновый display перебивал бы
  // grid из медиазапроса, панель осталась бы одной колонкой, а вторая —
  // пустым местом справа. Проверки «!== 'none'» с пустой строкой работают.
  $connect.style.display = 'none';
  $room.style.display    = '';
  $roomCode.textContent  = roomCode;
  isReady = false;
  $readyBtn.textContent  = T('netReady');
  $readyBtn.style.borderColor = '';
  $readyBtn.style.color       = '';
  $startBtn.style.display = isHost ? 'block' : 'none';
  // Show level picker only for host
  const $lp = document.getElementById('netLevelPicker');
  if($lp) $lp.style.display = isHost ? 'flex' : 'none';
  updateLevelStatus();
  refreshPlayerList();
  if(typeof netApplyLang==='function') netApplyLang(); // refresh 'PLAYERS (max N)' for this room's cap
  if(isHost){ updateStartBtn(); }
  else { setRoomStatus(T('netWaitHost')); }
  // Clear chat from any previous room
  $chat.innerHTML = '';
  refreshFriendInvites();
}

/* ── Позвать друзей в эту комнату ────────────────────────────────────────
   Список тот же, что в профиле и на сайте: аккаунт один. Показываем блок
   только когда есть кого звать — пустой заголовок «пригласить друзей» в
   комнате выглядит как сломанная кнопка.

   Звать можно только друга, и это проверяет сервер (invite_to_room): иначе
   код комнаты стал бы способом рассылать приглашения кому угодно. */
function refreshFriendInvites(){
  const box  = document.getElementById('netFriendsBox');
  const list = document.getElementById('netFriendList');
  const stat = document.getElementById('netInviteStatus');
  if(!box || !list) return;
  box.style.display = 'none';
  list.innerHTML = '';
  if(stat) stat.textContent = '';
  if(!window.Friends || !window.License || !window.License.loggedIn()) return;

  window.Friends.list().then((all) => {
    const friends = (all || []).filter(f => f.kind === 'friend');
    if(!friends.length || !roomCode) return;
    box.style.display = 'flex';
    friends.forEach((f) => {
      const row = document.createElement('div');
      row.className = 'net-friend';
      const name = document.createElement('b');
      name.textContent = f.nickname;
      const btn = document.createElement('button');
      btn.className = 'net-btn secondary';
      btn.textContent = T('netInvite');
      btn.onclick = () => {
        btn.disabled = true;
        // Источник комнаты передаём вместе с кодом: гость обязан подключиться
        // туда же, иначе шесть символов кода ничего не значат.
        const src = (_lobbyMode === 'lan') ? 'local' : 'server';
        window.Friends.invite(f.nickname, roomCode, src)
          .then(() => { btn.textContent = T('netInvited');
                        if(stat) stat.textContent = T('netInviteSent', f.nickname); })
          .catch((e) => { btn.disabled = false;
                          if(stat) stat.textContent = T('netInviteFailed'); });
      };
      row.appendChild(name); row.appendChild(btn);
      list.appendChild(row);
    });
    if(window._netFitLobby) window._netFitLobby();
  }).catch(() => { /* нет сети или миграция не применена — блок просто не покажем */ });
}

function refreshPlayerList(){
  $playerList.innerHTML = '';
  const slots = Math.max(players.length, 2);
  for(let i=0; i<slots; i++){
    const p = players[i];
    const row = document.createElement('div');
    row.className = 'net-player-row';
    if(!p){
      const empty = document.createElement('span');
      empty.className = 'net-player-name';
      empty.style.color = '#4af4';
      empty.textContent = T('netEmptySlot');
      row.appendChild(empty);
      row.style.opacity = '0.4';
      $playerList.appendChild(row);
      continue;
    }
    if(p.ready) row.classList.add('is-ready');
    // Mini robot avatar
    const img = document.createElement('img');
    img.className = 'net-player-avatar';
    img.src = robotIconURL(p.color || 'blue');
    row.appendChild(img);

    const name = document.createElement('div');
    name.className = 'net-player-name';
    name.textContent = p.nickname;
    row.appendChild(name);

    if(p.id === myId){
      const tag = document.createElement('span');
      tag.className='net-player-tag you'; tag.textContent=T('netYou');
      row.appendChild(tag);
    }
    if(p.isHost){
      const tag = document.createElement('span');
      tag.className='net-player-tag host'; tag.textContent=T('netHostTag');
      row.appendChild(tag);
    }
    if(p.ready){
      const tag = document.createElement('span');
      tag.className='net-player-tag ready'; tag.textContent=T('netReadyTag');
      row.appendChild(tag);
    }
    $playerList.appendChild(row);
  }
}

// Пускать ли новых игроков в уже начатый уровень. Решает хост; настройка живёт
// на его стороне и переезжает между комнатами вместе с ним.
let _allowLateJoin = false;
try{ _allowLateJoin = localStorage.getItem('bb_net_latejoin') === '1'; }catch(e){}
function _syncLateJoinUI(){
  const row = document.getElementById('netAllowJoinRow');
  const box = document.getElementById('netAllowJoinBox');
  if(row) row.style.display = isHost ? 'flex' : 'none';
  if(box) box.checked = _allowLateJoin;
}
// Новый призрак для игрока, зашедшего в уже идущий уровень.
function _spawnGhost(p){
  if(!p || p.id === myId || window.netPlayers.has(p.id)) return;
  const pObj = mkPlayer(
    (typeof spawnX !== 'undefined' ? spawnX : 60),
    (typeof spawnY !== 'undefined' ? spawnY : 300),
    p.color || {h:210,s:80,l:55}
  );
  pObj.nickname   = p.nickname;
  pObj.isNetGhost = true;
  window.netPlayers.set(p.id, { playerObj: pObj, lastUpdate: Date.now() });
}
// Кто-то зашёл, пока уровень уже идёт.
function _onJoinDuringGame(pl){
  _spawnGhost(pl);
  // Снимок общего мира шлётся только при изменении, а у новичка уровень
  // нетронутый — заставляем себя отправить полный снимок, иначе он будет
  // собирать монеты, которые для остальных давно исчезли.
  _lastWorldJson = '';
  if(!isHost) return;
  if(_allowLateJoin){
    _netPending.delete(pl && pl.id);
    wsSend({type:'game_event', event:'late_join', data:{mode:_netMode, level:_netLevel, seed:_netSeed}});
  } else {
    if(pl && pl.id) _netPending.add(pl.id);
    wsSend({type:'game_event', event:'join_denied', data:{}});
    _hostBroadcastProgress();   // знаменатель изменился — пересчитываем зачёт
  }
}

function updateStartBtn(){
  _syncLateJoinUI();
  if(!isHost) return;
  const allReady = players.filter(p=>p.id!==myId).every(p=>p.ready);
  const enough   = players.length >= 2;
  $startBtn.disabled = !(allReady && enough);
  setRoomStatus(enough
    ? (allReady ? T('netAllReady') : T('netWaitReady'))
    : T('netNeed2'));
}

function setRoomStatus(txt, isErr=false){
  $roomStatus.textContent = txt;
  $roomStatus.classList.toggle('net-error', isErr);
}

// Escape user-supplied text before it goes into innerHTML.
function esc(s){
  return String(s==null?'':s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function addChat(who, text){
  const msg = document.createElement('div');
  msg.className = 'net-chat-msg';
  // `who` / `text` are pre-escaped by callers; system messages pass safe glyphs.
  msg.innerHTML = `<span class="who">${who}:</span> ${text}`;
  $chat.appendChild(msg);
  // Cap chat history so the box can't grow unbounded
  while($chat.children.length > 60) $chat.removeChild($chat.firstChild);
  $chat.scrollTop = $chat.scrollHeight;
}

function handleError(reason, max){
  // A 'not_in_room' is a benign race (e.g. a keepalive sent between leaving and
  // rejoining); it does not mean the socket is down, so never surface it as a
  // connection error.
  if(reason === 'not_in_room') return;
  // Кода нет ЗДЕСЬ — возможно, комната на другом источнике. Ошибку покажем
  // только когда обойдём все адреса.
  if(reason === 'room_not_found' && _tryJoinElsewhere()) return;
  const map = {
    room_not_found: 'netErrRoomNotFound',
    room_full:      'netErrRoomFull',
    not_host:       'netErrNotHost',
    not_in_room:    'netErrNotInRoom',
    not_all_ready:  'netErrNotAllReady',
  };
  const txt = map[reason]
    ? T(map[reason], max || roomMaxPlayers || MAX_NET_PLAYERS)
    : T('netErrGeneric', reason);
  $connStatus.textContent = txt;
  $connStatus.classList.add('net-error');
  setRoomStatus(txt, true);
}

// ── Game start / sync ────────────────────────────────────────────────────────

// Spawn offsets so up to 5 players don't stack on the same pixel
const SPAWN_OFFSETS = [0, 36, -36, 72, -72];

// Show 3-2-1-GO countdown then call onDone()
let _countdownIv = null;
// ── Co-op: wait for ALL players to finish the level ─────────────────────
// When a player reaches the flag they freeze and a dim overlay shows «waiting for
// players X/N». The host tallies finishers and only advances the whole room once
// everyone is done. This keeps the host simulating enemies for players still in
// the level (we never drop the host into the single-player 'levelclear' state).
let _netFinished = new Set();
// Кто из них реально дошёл до флага. Выбывшие по жизням тоже освобождают
// комнату, но уровень они не прошли — если флага не коснулся НИКТО, комната
// не должна ехать дальше по сюжету (в соло-комнате это выглядело так, будто
// смерть засчитывается за прохождение).
let _netCleared = new Set();
// Whether OUR local player has reached the flag this level. The "waiting for
// players" overlay must only dim the screen for players who already finished —
// players still in the level keep playing and must NOT see it, even though the
// host broadcasts the X/N progress to everyone.
let _iFinished = false;
function _resetFinishState(){
  _netFinished = new Set(); _netCleared = new Set();
  _netPending = new Set();   // новый уровень — ждавшие входят вместе со всеми
  _iFinished = false; _iEliminated = false;
  window._netLevelAdvancing = false;
  _restoreWaitingChrome();
  hideNetWaiting();
  stopSpectate();   // новый уровень — снова играем, а не смотрим
}

/**
 * Оживление выбывших. Раньше стояло в _resetFinishState, а та вызывается ДО
 * отсчёта «3-2-1» — жизни возвращались ещё на затемнении, и на экране гибели
 * игрок уже числился живым, хотя уровень не перезапустился. Теперь зовём это
 * ровно там, где уровень действительно начинается заново.
 */
function reviveForNewLevel(){
  try { if(typeof lives !== 'undefined' && lives <= 0) lives = 3; } catch(e){}
  try { if(typeof lives2 !== 'undefined' && lives2 <= 0) lives2 = 3; } catch(e){}
  try { if(typeof player !== 'undefined' && player) player._netDone = false; } catch(e){}
}

function showNetWaiting(count, total){
  const ov = document.getElementById('netWaiting');
  if(!ov) return;
  const t = document.getElementById('netWaitingTxt');
  if(t) t.textContent = T('netWaitingPlayers', count, total);
  if(typeof window.applyI18nDOM==='function') window.applyI18nDOM();
  ov.style.display = 'flex';
}
function hideNetWaiting(){
  const ov = document.getElementById('netWaiting');
  if(ov) ov.style.display = 'none';
}

// Called from game.js when OUR local player reaches the flag.
window.netReportFinish = function(){
  if(!window.netActive) return;
  _iFinished = true;
  // Дошёл до флага — тоже наблюдатель. Раньше здесь висело затемнение «ждём
  // игроков», и человек, прошедший уровень первым, минуту смотрел в серый
  // экран вместо того, чтобы болеть за остальных.
  startSpectate();
  if(isHost) _hostMarkFinished(myId);
  else wsSend({type:'game_event', event:'finish'});
};

// A player who runs out of lives is OUT FOR THIS LEVEL. They count as
// "done" for the room's tally — otherwise the survivors stand at the flag
// waiting for someone who can never reach it — and they come back with fresh
// lives when the next level starts. This is the whole reason a co-op death
// cannot use the single-player Game Over screen (see doHurtPlayer in game.js).
// Кто зашёл посреди уровня и ждёт следующего (хост не пустил). В зачёте
// «дошли X из N» они не участвуют — иначе комната ждала бы у флага человека,
// который в этом уровне вообще не играет.
let _netPending = new Set();
let _iEliminated = false;
window.netReportEliminated = function(){
  if(!window.netActive || _iEliminated) return;
  _iEliminated = true;
  _iFinished  = true;                 // stop blocking the room
  if(typeof player !== 'undefined' && player){
    player._netDone = true; player.vx = 0; player.vy = 0;
    player.inv = Math.max(player.inv||0, 999999);
  }
  if(typeof stopMusic === 'function') stopMusic();
  startSpectate();
  if(isHost) _hostMarkFinished(myId, true);
  else {
    // Признак кладём в data: релей пересобирает game_event и сохраняет только
    // id/event/data — поле верхнего уровня до хоста не доедет.
    wsSend({type:'game_event', event:'finish', eliminated:true, data:{eliminated:true}});
  }
  if(typeof addChat === 'function') addChat('☠', T('netPlayerEliminated', esc(myNick||'?')));
};

// ── Всплывающие уведомления ──────────────────────────────────────────────────
// Кто зашёл и кто вышел. Раньше об этом сообщал только чат в лобби — во время
// игры чат не виден, и состав комнаты менялся молча.
function netToast(icon, text, col){
  const box = document.getElementById('netToasts');
  if(!box) return;
  const el = document.createElement('div');
  el.style.cssText = "font-family:'Press Start 2P',monospace;font-size:calc(9px * var(--bbFix, 1));"
    + 'letter-spacing:1px;padding:calc(7px * var(--bbFix, 1)) calc(11px * var(--bbFix, 1));'
    + 'border-radius:calc(4px * var(--bbFix, 1));background:#04040fe6;border:1px solid ' + (col||'#0ff') + '66;'
    + 'color:' + (col||'#0ff') + ';text-shadow:0 0 8px ' + (col||'#0ff') + '55;'
    + 'opacity:0;transform:translateX(-12px);transition:opacity .18s,transform .18s;'
    + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
  el.textContent = icon + ' ' + text;
  box.appendChild(el);
  requestAnimationFrame(()=>{ el.style.opacity='1'; el.style.transform='none'; });
  // Больше пяти строк подряд — это уже стена, самые старые убираем сразу.
  while(box.children.length > 5) box.removeChild(box.firstChild);
  setTimeout(()=>{
    el.style.opacity='0'; el.style.transform='translateX(-12px)';
    setTimeout(()=>{ if(el.parentNode) el.parentNode.removeChild(el); }, 250);
  }, 4000);
}

// ── Наблюдатель ──────────────────────────────────────────────────────────────
// Выбывший на этом уровне не сидит перед затемнением: камера ведёт кого-то из
// живых, стрелками (или кнопками на панели) его можно менять, а кнопка выхода
// отпускает из комнаты, не дожидаясь конца уровня. Комнату выбывший уже
// отпустил (см. netReportEliminated), поэтому остальные играют как играли.
let _specIdx = 0;
let _specBound = false;
// Кого можно смотреть: живые игроки комнаты, кроме себя. Порядок берём из
// списка комнаты, а не из Map — он одинаков между кадрами, и «следующий» не
// прыгает случайно при каждом переключении.
function _specList(){
  const out = [];
  if(!window.netPlayers) return out;
  const order = players.length ? players.map(p=>p.id) : Array.from(window.netPlayers.keys());
  for(const id of order){
    if(id === myId) continue;
    const e = window.netPlayers.get(id);
    if(!e || !e.playerObj) continue;
    // Смотреть можно только за теми, кто ЕЩЁ ИГРАЕТ. Выбывший замер на месте
    // гибели, дошедший — стоит у флага; водить за ними камеру бессмысленно.
    if(e.playerObj._netDone) continue;
    const p = players.find(pl=>pl.id===id);
    out.push({ id, name: (p && p.nickname) || e.playerObj.nickname || '?', obj: e.playerObj });
  }
  return out;
}
// Пересобрать панель под текущий состав комнаты. Зовётся и при выходе игрока:
// смотреть за ушедшим нельзя, камера должна сама перейти к следующему.
function _specRefresh(){
  const bar = document.getElementById('netSpectate');
  if(!bar) return;
  // Наблюдаем, если ВЫШЛИ ИЗ УРОВНЯ — выбыли по жизням или дошли до флага.
  // Проверка идёт и по _netDone у своего робота: без неё оставшийся включённым
  // режим наблюдения уводил камеру к чужому игроку, пока ты сам ещё играешь.
  const alive = (typeof player !== 'undefined' && player && !player._netDone);
  const out = window.netActive && _iFinished && !alive;
  if(!out){
    bar.style.display='none';
    window.netSpectateObj=null; window.netSpectating=false;
    return;
  }
  window.netSpectating = true;
  bar.style.display = 'flex';
  // Заголовок честно говорит, почему ты смотришь: выбыл или уже прошёл.
  const title = document.getElementById('netSpecTitle');
  const note  = document.getElementById('netSpecNote');
  if(title){
    // Счёт «сколько уже вне уровня» дописан к заголовку, а не отдельной строкой:
    // на телефоне каждая лишняя строка заметно поднимает плашку над экраном.
    title.textContent = (_iEliminated ? T('netEliminatedTitle') : T('netWaitingTitle'))
      + (_specTallyTxt ? '  ·  ' + _specTallyTxt : '');
    title.style.color = _iEliminated ? '#f55' : '#0ff';
    title.style.textShadow = '0 0 10px ' + (_iEliminated ? '#f00' : '#0ff');
  }
  if(note) note.textContent = _iEliminated ? T('netEliminatedSub') : T('netWaitingSub');
  bar.style.borderColor = _iEliminated ? '#f4446d' : '#0ff6';
  const list = _specList();
  const nm   = document.getElementById('netSpecName');
  const prev = document.getElementById('netSpecPrev');
  const next = document.getElementById('netSpecNext');
  if(!list.length){
    // Смотреть не за кем: остальные тоже выбыли или вышли. Камера остаётся там,
    // где была, — резкий скачок в угол уровня был бы хуже пустого кадра.
    window.netSpectateObj = null;
    if(nm) nm.textContent = T('netSpecNobody');
    _specArrows(prev, next, false);
  } else {
    _specIdx = ((_specIdx % list.length) + list.length) % list.length;
    const t = list[_specIdx];
    window.netSpectateObj = t.obj;
    if(nm) nm.textContent = '👁 ' + t.name;
    _specArrows(prev, next, list.length > 1);
  }
}
// Стрелки прячем через display, а не visibility: у .net-btn стоит
// transition:all, а переход visibility доигрывает шаг только в конце — и при
// частом обновлении панели «скрытая» стрелка так и оставалась кликабельной.
function _specArrows(prev, next, show){
  if(prev) prev.style.display = show ? '' : 'none';
  if(next) next.style.display = show ? '' : 'none';
}
function _specStep(d){
  _specIdx += d; _specRefresh();
  if(typeof SFX !== 'undefined' && SFX.menu) SFX.menu();
}
function startSpectate(){
  _specIdx = 0;
  if(!_specBound){
    _specBound = true;
    const prev = document.getElementById('netSpecPrev');
    const next = document.getElementById('netSpecNext');
    const out  = document.getElementById('netSpecLeave');
    if(prev) prev.onclick = () => _specStep(-1);
    if(next) next.onclick = () => _specStep(1);
    if(out)  out.onclick  = () => leaveRoom();
    // Клавиши вешаем один раз на весь сеанс, а работают они только пока мы
    // действительно выбыли — иначе стрелки отобрали бы управление у живого.
    window.addEventListener('keydown', function(e){
      if(!_iEliminated || !window.netActive) return;
      const k = e.key;
      if(k==='ArrowLeft'||k==='a'||k==='A'||k==='ф'||k==='Ф') _specStep(-1);
      else if(k==='ArrowRight'||k==='d'||k==='D'||k==='в'||k==='В') _specStep(1);
      else return;
      e.preventDefault();
    });
  }
  _specRefresh();
}
function stopSpectate(){
  window.netSpectateObj = null;
  window.netSpectating = false;
  _specTallyTxt = '';
  const bar = document.getElementById('netSpectate');
  if(bar) bar.style.display = 'none';
}
// Счёт «сколько уже освободили комнату» — выбывшему он тоже нужен: по нему
// видно, сколько ещё ждать до следующего уровня.
/** Разметить чужих роботов: кто вне уровня и кто из них выбыл по жизням. */
function _applyOutFlags(outIds, elimIds){
  if(!window.netPlayers) return;
  const out = new Set(outIds || []), el = new Set(elimIds || []);
  let changed = false;
  for(const [id, e] of window.netPlayers){
    if(!e.playerObj) continue;
    const d = out.has(id), m = el.has(id);
    if(e.playerObj._netDone !== d || e.playerObj._netElim !== m) changed = true;
    e.playerObj._netDone = d;
    e.playerObj._netElim = m;
  }
  if(changed) _specRefresh();
}

let _specTallyTxt = '';
function _specTally(count, total){
  if(!_iFinished) return;
  _specTallyTxt = count + '/' + total;
  _specRefresh();
}
// Put the overlay's own wording back for the ordinary "waiting at the flag" case.
function _restoreWaitingChrome(){
  const title = document.getElementById('netWaitingTitle');
  const sub   = document.getElementById('netWaitingSub');
  if(title){ title.textContent = T('netWaitingTitle'); title.style.color = ''; title.style.textShadow = ''; }
  if(sub) sub.textContent = T('netWaitingSub');
}

function _hostMarkFinished(id, eliminated, quiet){
  if(!isHost) return;
  if(!eliminated) _netCleared.add(id);
  if(!_netFinished.has(id)){
    _netFinished.add(id);
    // Выбывшему «добрался до флага» не пишем — про него уже сказано, что у него
    // закончились жизни, и два противоречивых сообщения подряд путают.
    if(eliminated && !quiet){
      // Про выбывание сообщаем всей комнате отдельным событием — так же
      // заметно, как про вход и выход. Чат во время игры не виден.
      const pe = players.find(pl=>pl.id===id);
      const nm = pe ? pe.nickname : (id===myId ? (myNick||'?') : '?');
      netToast('☠', T('netPlayerEliminated', nm), '#f55');
      if(ws && ws.readyState===1) wsSend({type:'game_event', event:'player_out', data:{name:nm}});
    }
    if(eliminated || quiet){ _hostBroadcastProgress(); return; }
    const p = players.find(pl=>pl.id===id);
    const name = p ? p.nickname : (id===myId ? (myNick||'?') : '?');
    addChat('★', T('netPlayerFinished', esc(name)));
    _hostBroadcastProgress(name);
    return;
  }
  _hostBroadcastProgress();
}
// Broadcast the current X/N progress to everyone and advance if all are done.
function _hostBroadcastProgress(finisherName){
  if(!isHost) return;
  // Ждущих следующего уровня в знаменателе нет — см. _netPending.
  const total = Math.max(1, (players.length || 1) - _netPending.size);
  const count = Math.min(_netFinished.size, total);
  if(count <= 0) return;
  // Only show the overlay to ourselves if WE'VE finished (the host may still be
  // playing while other players reach the flag). Выбывшему затемнение не
  // показываем — он смотрит за живыми, счёт идёт строкой на панели наблюдателя.
  // Затемнение «ждём игроков» больше не показываем никому: и выбывший, и
  // дошедший до флага теперь наблюдают за живыми, а счёт идёт строкой на
  // панели наблюдателя.
  _specTally(count, total);
  // Кто уже вне уровня и кто именно выбыл. Списки едут ЗДЕСЬ, а не в game_state:
  // релей пересобирает game_state по фиксированному набору полей и всё лишнее
  // выбрасывает — добавленные туда признаки до других игроков не доезжали.
  const outIds  = Array.from(_netFinished);
  const elimIds = outIds.filter(id => !_netCleared.has(id));
  if(ws && ws.readyState===1) wsSend({type:'game_event', event:'finish_progress',
    data:{count, total, name:finisherName||null, out:outIds, elim:elimIds}});
  _applyOutFlags(outIds, elimIds);
  if(count < total) return;
  // Все освободили комнату. Если до флага не добрался никто — уровень провален,
  // и комната переигрывает его же, а не уезжает дальше.
  if(_netCleared.size === 0) _hostRetryRoom();
  else _hostAdvanceRoom();
}
// Провал уровня всей комнатой → перезапуск того же уровня.
// Идёт по тому же каналу level_complete, что и обычный переход: релей просто
// ретранслирует сообщение, менять сервер не нужно.
function _hostRetryRoom(){
  if(!isHost || window._netLevelAdvancing) return;
  window._netLevelAdvancing = true;
  const adv = (typeof advMode!=='undefined' && advMode);
  const cur = adv ? (typeof advLevel!=='undefined'?advLevel:1)
                  : (typeof level!=='undefined'?level:1);
  _netLevel = cur;
  if(ws && ws.readyState===1) wsSend({type:'level_complete', nextLevel:cur, mode:_netMode, retry:true});
}
// Everyone finished → host drives the whole room to the next level (or win).
function _hostAdvanceRoom(){
  if(!isHost || window._netLevelAdvancing) return;
  window._netLevelAdvancing = true;
  const adv  = (typeof advMode!=='undefined' && advMode);
  const next = adv ? ((typeof advLevel!=='undefined'?advLevel:1)+1)
                   : ((typeof level!=='undefined'?level:1)+1);
  const mode = adv ? 'adventure' : 'infinite';
  // Room-wide win: right after level 100 (ARCHON, main story) or right after
  // level 110 (PRISM WRAITH, secret ending). Levels 101-109 must continue
  // normally — see the matching fix in game.js's _goNext for why.
  if(adv && (next===101 || next>110)){
    // Final level cleared by the whole room — win for everyone.
    if(ws && ws.readyState===1) wsSend({type:'game_event', event:'won'});
    hideNetWaiting();
    if(next>110 && typeof showSecretWin==='function') showSecretWin();
    else if(typeof showWin==='function') showWin();
    return;
  }
  _netLevel = next; _netMode = mode;
  if(ws && ws.readyState===1) wsSend({type:'level_complete', nextLevel:next, mode});
}

function showNetCountdown(mode, level, onDone, isRetry){
  const $loading = document.getElementById('netLoading');
  const $title   = document.getElementById('netLoadTitle');
  const $count   = document.getElementById('netLoadCount');
  const $sub     = document.getElementById('netLoadSub');
  $title.textContent = mode === 'adventure' ? T('netAdvLvlTitle', level) : T('netInfModeTitle');
  // При повторе игрок должен понимать, что уровень не пройден, а переигран —
  // иначе тот же номер уровня выглядит как баг.
  if($sub) $sub.textContent = isRetry ? T('netLevelFailedSub') : T('netGetReadySub');
  $loading.style.display = 'flex';
  if(_countdownIv) clearInterval(_countdownIv);
  let n = 3;
  $count.textContent = n;
  $count.style.animation = 'none'; void $count.offsetWidth; $count.style.animation = 'netCountPop .4s ease-out';
  _countdownIv = setInterval(() => {
    n--;
    if(n > 0){
      $count.textContent = n;
      $count.style.animation = 'none'; void $count.offsetWidth; $count.style.animation = 'netCountPop .4s ease-out';
    } else {
      clearInterval(_countdownIv); _countdownIv = null;
      $count.textContent = T('netGo');
      $count.style.animation = 'none'; void $count.offsetWidth; $count.style.animation = 'netCountPop .4s ease-out';
      setTimeout(() => { $loading.style.display = 'none'; onDone(); }, 600);
    }
  }, 900);
}

function startNetworkGame(allPlayers){
  $lobby.style.display = 'none';
  window.netActive = true;
  if(typeof AchTrack!=='undefined')AchTrack.netPlay();
  window._netLevelAdvancing = false;
  window.netPlayers.clear();
  window._netShots.clear();
  _lastWorldJson = ''; _lastShotCount = 0;
  updateGamePing(); // reveal the in-game ping readout

  // Disable local 2P — network handles multiplayer
  if(typeof twoPlayer !== 'undefined') twoPlayer = false;

  // Co-op always uses normal difficulty: the lobby has no hardcore toggle, and
  // hardMode changes the adventure seed AND difficulty, so a client still flagged
  // hardcore from an earlier single-player run would generate a DIFFERENT level
  // and break index-based enemy sync. Force it off so all clients gen identically.
  if(typeof hardMode!=='undefined') hardMode=false;

  // Launch the correct mode using the shared params
  // For adventure: startAdv uses mkRNG(n*9001+12345) — deterministic, same for all players
  // For infinite: set level number first so all players get same difficulty/theme
  if(_netMode === 'adventure'){
    if(typeof startAdv === 'function') startAdv(_netLevel, true);
  } else {
    // Sync level so infinite starts at same difficulty for everyone
    if(typeof level !== 'undefined') level = _netLevel;
    if(typeof startInf === 'function') startInf(true);
  }

  // After startAdv/startInf: player is spawned, spawnX/spawnY are set
  if(typeof player !== 'undefined' && player){
    player.colorScheme = myColor;
    player.nickname    = myNick;
  }

  // Create ghost objects for every remote player
  const myIdx = allPlayers.findIndex(p => p.id === myId);
  allPlayers.forEach((p, i) => {
    if(p.id === myId) return;
    const offsetX = SPAWN_OFFSETS[Math.abs(i - myIdx)] || (i * 36);
    const pObj = mkPlayer(
      (typeof spawnX !== 'undefined' ? spawnX : 60) + offsetX,
      (typeof spawnY !== 'undefined' ? spawnY : 300),
      p.color || {h:210,s:80,l:55}
    );
    pObj.nickname   = p.nickname;
    pObj.isNetGhost = true;
    window.netPlayers.set(p.id, { playerObj: pObj, lastUpdate: Date.now() });
  });

  startStateLoop();
  // Keep game logic ticking even if this tab gets hidden / a dialog opens. The
  // host's enemy/boss AI lives in the game loop, so a frozen host froze the whole
  // room; the background ticker (Web Worker driven) prevents that.
  if(typeof window.startBgTicker==='function') window.startBgTicker();
}

let _stateInterval = null;
let _netTickDiv = 0; // for sending enemies/bullets at lower rate than position
let _netKeyframeDiv = 0; // counts sync ticks to schedule periodic full-state "keyframes"
// Per-enemy id → last full state actually sent to guests. Used to compute
// deltas (see _deltaOf) so unchanged fields aren't re-sent every tick.
let _lastSentEnemy = new Map();
let _lastShotCount = 0;         // сколько снарядов ушло в прошлый раз (см. 'shots')
let _lastWorldJson = '';        // последний отправленный снимок общего мира
let _lastSentBoss = null;       // last full boss state sent (null = none sent yet this "boss session")
let _lastSentBossAlive = null;  // tri-state: null=unknown yet, true/false=last sent boss-alive flag
let _lastSyncedEnemiesRef = null; // identity of the `enemies` array we last built caches for (see _stateTick)

// Generic delta encoder for an id-keyed entity: compares `full` against the
// last state sent for this id and returns an object containing only the
// fields that changed (always including `id`), or null if nothing changed at
// all (caller should then omit this entity from the payload entirely). First
// time an id is seen, the complete object is sent and cached.
function _deltaOf(id, full, cache){
  const prev = cache.get(id);
  if(!prev){ cache.set(id, {...full}); return full; }
  let out = null;
  for(const k in full){
    if(k==='id') continue;
    if(full[k] !== prev[k]){
      if(!out) out = {id};
      out[k] = full[k];
      prev[k] = full[k];
    }
  }
  return out;
}
// Same idea for the single boss object (no id — there's only ever one boss).
function _bossDeltaOf(full){
  if(!_lastSentBoss){ _lastSentBoss = {...full}; return full; }
  let out = null;
  for(const k in full){
    if(full[k] !== _lastSentBoss[k]){
      if(!out) out = {};
      out[k] = full[k];
      _lastSentBoss[k] = full[k];
    }
  }
  return out;
}
let _lastStateSend = 0;
// One iteration of the state broadcast. Normally driven by a 20 Hz setInterval,
// but ALSO callable from the background ticker (game.js) so that when this tab is
// hidden — and the interval is throttled to ~1 Hz — the host still pumps enemy/
// boss snapshots at full rate and the room doesn't freeze. `_lastStateSend`
// throttles the combined callers to one send per ~50 ms.
function _stateTick(){
    if(!window.netActive || !ws || ws.readyState!==1) return;
    if(typeof player==='undefined' || !player) return;
    const _now = Date.now();
    if(_now - _lastStateSend < 45) return; // ~20 Hz cap across both drivers
    _lastStateSend = _now;

    _netTickDiv++;

    // Enemy ids restart from 1 every new level (see game.js genLevel()), so a
    // stale delta-cache entry from the PREVIOUS level could wrongly suppress a
    // field for a same-numbered enemy in the new one. `enemies` is a brand new
    // array object every genLevel() call, so a reference change is a reliable,
    // zero-maintenance signal that a (re)generation happened — retries and
    // checkpoint restarts included, not just moving to a new level number.
    if(typeof enemies!=='undefined' && enemies!==_lastSyncedEnemiesRef){
      _lastSyncedEnemiesRef = enemies;
      _lastSentEnemy.clear();
      _lastSentBoss = null;
      _lastSentBossAlive = null;
      // Новый уровень — новый мир: старый снимок и чужие снаряды к нему не
      // относятся, иначе на первых кадрах монеты «подобрались» бы сами.
      _lastWorldJson = '';
      _lastShotCount = 0;
      window._netShots.clear();
    }

    // ── Player state (20 Hz) ─────────────────────────────────────────────────
    wsSend({
      type:    'game_state',
      x:       Math.round(player.x),
      y:       Math.round(player.y),
      vx:      +player.vx.toFixed(2),
      vy:      +player.vy.toFixed(2),
      facing:  player.facing,
      action:  player.onGnd ? (Math.abs(player.vx)>0.5?'run':'idle') : 'jump',
      hp:      typeof lives!=='undefined' ? lives : 3,
      // powerup states
      blaster: !!player.blaster,
      broken:  !!player.broken,
      starMode:!!player.starMode,
      fireMode:!!player.fireMode,
      iceMode: !!player.iceMode,
      boots:   !!player.boots,
    });

    // ── Host: sync enemies + boss + bullets every 3 ticks (~7 Hz) ────────────
    // Enemies are synced by stable id (see applyEnemiesSync / hit_enemy in
    // handleRemoteEvent — NOT array index, which breaks once split-enemy
    // children make the two clients' arrays diverge in length/order).
    //
    // Delta-sync: most enemy fields (hp, alive, frozen, burning, shielded,
    // type) change rarely — re-sending them every tick for every enemy is
    // wasted bandwidth/JSON work. We only include a field in the payload when
    // it differs from what was last sent for that id, and skip an enemy
    // entirely once nothing about it has changed. A full snapshot (every
    // field, every enemy) still goes out periodically as a "keyframe" so a
    // late-joining guest or any missed state self-heals within a couple of
    // seconds instead of staying wrong until that exact field happens to
    // change again.
    if(isHost && _netTickDiv % 3 === 0){
      _netKeyframeDiv++;
      const forceKeyframe = (_netKeyframeDiv % 20 === 0); // ~ every 3s at 7Hz
      if(forceKeyframe) _lastSentEnemy.clear();
      if(typeof enemies!=='undefined'){
        const list = [];
        for(const e of enemies){
          const full = {
            id: e.id,
            x:  Math.round(e.x), y: Math.round(e.y),
            vx: +(e.vx||0).toFixed(2),
            hp: e.hp,
            al: e.alive ? 1 : 0,
            fl: e.flash|0,
            fz: e._frozen ? 1 : 0,
            bn: e._burning ? 1 : 0,
            sh: e.shielded ? 1 : 0,
            t:  e.type, // needed so guests can build stubs for host-spawned extras (split enemies)
          };
          const d = _deltaOf(e.id, full, _lastSentEnemy);
          if(d) list.push(d);
        }
        // Only send the message at all if there's something to say — an empty
        // enemies_sync every 150ms for a level with no state changes (e.g. all
        // enemies dead/off-screen) is itself wasted traffic.
        if(list.length) wsSend({type: 'enemies_sync', enemies: list});
      }
      // Boss authoritative state (null when no boss / dead)
      if(typeof boss!=='undefined'){
        if(!boss || !boss.alive){
          // "Boss is gone" is a one-time transition, not a per-tick value — only
          // send it once (delta against the cached previous null-ness), instead
          // of an unconditional null every tick even outside boss levels.
          if(_lastSentBossAlive !== false){
            wsSend({type: 'boss_sync', boss: null});
            _lastSentBossAlive = false;
          }
        } else {
          // Boss just (re)appeared (was dead/absent last tick) — force a full
          // snapshot so the guest's freshly-spawned local boss object gets every
          // field immediately instead of waiting for fields to individually change.
          if(_lastSentBossAlive !== true || forceKeyframe) _lastSentBoss = null;
          _lastSentBossAlive = true;
          const full = {
            x: Math.round(boss.x), y: Math.round(boss.y),
            hp: boss.hp,
            facing: boss.facing,
            phase: boss.phase,
            flash: boss.flash|0,
            anim:  boss.anim|0,
            orbs:  Array.isArray(boss.orbs)?boss.orbs.map(o=>o.alive?1:0):null,
            nodes: Array.isArray(boss.nodes)?boss.nodes.map(n=>n.alive?1:0):null,
            shieldsDown: !!boss.shieldsDown,
            solid: !!boss.solid,
            windowOpen: !!boss.windowOpen,
            descending: !!boss.descending,
            shellBroken: !!boss.shellBroken,
            stunTimer: boss.stunTimer|0,
          };
          const toSend = _bossDeltaOf(full);
          if(toSend) wsSend({type: 'boss_sync', boss: toSend});
        }
      }
      // Enemy bullets (host authoritative) — guests must see them to dodge/render
      if(typeof eBullets!=='undefined'){
        wsSend({
          type:    'ebullets_sync',
          bullets: eBullets.map(b=>({
            x:   Math.round(b.x),
            y:   Math.round(b.y),
            vx:  +(b.vx||0).toFixed(2),
            vy:  +(b.vy||0).toFixed(2),
            w:   b.w, h: b.h,
            round: b.round ? 1 : 0,
          })),
        });
      }
    }

    // ── Выстрелы: свои показываем всем ───────────────────────────────────────
    // Раньше по комнате расходились только снаряды хоста (bullets_sync, который
    // релей и пропускал лишь от него) — гости стреляли «в пустоту», их огня не
    // видел никто. Теперь свой огонь шлёт каждый, включая огненные и ледяные
    // шары, и в комнате видно всю стрельбу. Идёт через game_event, потому что
    // его релей передаёт от любого игрока — сервер менять не нужно.
    if(_netTickDiv % 3 === 0){
      const shots = [];
      const pack = (arr, kind) => {
        if(!arr) return;
        for(const b of arr) shots.push([Math.round(b.x), Math.round(b.y), kind, b.col || null]);
      };
      pack(typeof pBullets !=='undefined' ? pBullets  : null, 0);
      pack(typeof fireBalls!=='undefined' ? fireBalls : null, 1);
      pack(typeof iceBalls !=='undefined' ? iceBalls  : null, 2);
      // Пустой список отправляем ОДИН раз после последнего выстрела — иначе на
      // чужих экранах повисли бы застывшие снаряды.
      if(shots.length || _lastShotCount){
        _lastShotCount = shots.length;
        wsSend({type:'game_event', event:'shots', data:{b: shots.slice(0, 80)}});
      }
    }

    // ── Общий мир: монеты, блоки, бонусы, кристаллы, ключи ───────────────────
    // Слияние «или» (см. netWorldSnap в game.js), поэтому шлёт КАЖДЫЙ и хост тут
    // не нужен. Отправляем только при изменении: пока никто ничего не подобрал,
    // трафика нет вовсе.
    if(_netTickDiv % 3 === 0 && typeof netWorldSnap === 'function'){
      try{
        const snap = netWorldSnap();
        const js = JSON.stringify(snap);
        if(js !== _lastWorldJson){
          _lastWorldJson = js;
          wsSend({type:'game_event', event:'world', data: snap});
        }
      }catch(e){}
    }
}
// Let the background ticker pump state too (see _stateTick comment).
window.netStateTick = _stateTick;

function startStateLoop(){
  if(_stateInterval) clearInterval(_stateInterval);
  _lastStateSend = 0;
  _stateInterval = setInterval(_stateTick, 50); // 20 Hz (foreground driver)
}

function stopStateLoop(){
  if(_stateInterval){ clearInterval(_stateInterval); _stateInterval=null; }
  window.netStateTick = null;
}

// Update a remote player's object with received state.
// Position is stored as a *target* and smoothed per-frame in interpolateGhosts()
// so motion stays fluid even though updates arrive at only ~20 Hz.
function updateRemotePlayer(msg){
  const entry = window.netPlayers.get(msg.id);
  if(!entry) return;
  const p = entry.playerObj;
  if(!p) return;
  // First packet: snap straight to position (avoid a long slide from spawn).
  if(entry.tx === undefined){ p.x = msg.x; p.y = msg.y; }
  entry.tx  = msg.x;
  entry.ty  = msg.y;
  p.vx      = msg.vx || 0;
  p.vy      = msg.vy || 0;
  if(msg.facing) p.facing = msg.facing;
  // На земле или в прыжке. Отправитель это уже считал и слал в поле action, но
  // раньше его никто не читал: у чужого робота onGnd всегда оставался false,
  // поэтому ноги у него не переставлялись и он ездил по уровню как камень.
  p.onGnd = (msg.action !== 'jump');
  // Признаки «вне уровня» и «выбыл» сюда НЕ кладём: релей пересобирает
  // game_state по своему списку полей и всё лишнее отбрасывает. Их рассылает
  // хозяин в finish_progress — см. _applyOutFlags.
  // Sync all powerup/damage states so rendering is identical
  p.blaster  = !!msg.blaster;
  p.broken   = !!msg.broken;
  p.starMode = !!msg.starMode;
  p.fireMode = !!msg.fireMode;
  p.iceMode  = !!msg.iceMode;
  p.boots    = !!msg.boots;
  entry.lastUpdate = Date.now();
}

// Called once per render frame: ease each ghost toward its last known target and
// keep its motion trail fresh. Large gaps snap (teleport / respawn), small gaps lerp.
/* Сглаживание считалось «на кадр»: 30% пути к цели за отрисовку. На частом
   экране кадров втрое больше, и чужой робот дёргался к цели почти мгновенно —
   вместо плавного хода получался телепорт с рывками. Доля пересчитывается по
   времени: за одну шестидесятую секунды она по-прежнему 30%, а за более
   короткий кадр — соответственно меньше. */
let _lerpLastT = performance.now();
function _lerpShare(perFrame){
  const now = performance.now();
  const k = Math.min(4, Math.max(0, (now - _lerpLastT) / (1000 / 60)));
  _lerpLastT = now;
  return 1 - Math.pow(1 - perFrame, k);
}

function interpolateGhosts(){
  const share = _lerpShare(0.30);
  for(const [, entry] of window.netPlayers){
    const p = entry.playerObj;
    if(!p || entry.tx === undefined) continue;
    const dx = entry.tx - p.x, dy = entry.ty - p.y;
    if(Math.abs(dx) > 220 || Math.abs(dy) > 220){
      p.x = entry.tx; p.y = entry.ty;          // teleport: snap
    } else {
      p.x += dx * share;                        // smooth follow
      p.y += dy * share;
      if(Math.abs(dx) < 0.4) p.x = entry.tx;
      if(Math.abs(dy) < 0.4) p.y = entry.ty;
    }
    // Motion trail
    if(!p.trail) p.trail = [];
    if(Math.abs(p.vx) > 0.5 || Math.abs(p.vy) > 0.5) p.trail.unshift({x:p.x+p.w/2, y:p.y+p.h/2});
    if(p.trail.length > 12) p.trail.length = 12;

    // ── Оживление чужого робота ──────────────────────────────────────────────
    // Позиция приходит с сети, а вот счётчики анимации у чужого робота не вёл
    // никто: шаг ног, приседание при приземлении, дыхание в покое — всё это
    // считает updatePlayer, который для чужих не выполняется. Отсюда и
    // «ездят как камни». Считаем то же самое здесь, раз в кадр.
    //
    // Скорость для походки берём по фактическому смещению за кадр, а не из
    // присланного vx: пакеты идут 20 раз в секунду, и между ними робот ещё
    // доезжает до цели — по vx ноги замирали бы рывками.
    const moved = Math.abs(p.x - (entry.px !== undefined ? entry.px : p.x)) * 60 / 16.7;
    entry.px = p.x;
    p.animTk = (p.animTk||0) + 1;
    if(moved > 0.4 || Math.abs(p.vx) > 0.4){
      if(p.animTk % 7 === 0) p.animFr = ((p.animFr||0) + 1) % 4;
    } else p.animFr = 0;
    // Приземление: короткое приседание, как у своего робота.
    if(p.onGnd && entry.wasAir){ p.landT = Math.max(p.landT||0, 8); p.landPow = 0.5; }
    entry.wasAir = !p.onGnd;
    if(p.landT > 0) p.landT--;
    // Покой: дыхание и редкий взгляд по сторонам включаются после 90 кадров.
    if(p.onGnd && moved < 0.2 && Math.abs(p.vx) < 0.2) p.idleT = (p.idleT||0) + 1;
    else p.idleT = 0;
  }
}

// Стрелка к игроку, ушедшему за край экрана. Без неё в кооперативе непонятно,
// кто убежал вперёд, а кто отстал, и половина разговоров сводится к «ты где?».
// Рисуется внутри мировой системы координат (вызов стоит в обёртке drawPlayer),
// поэтому край экрана — это camX и camX+W.
// Значок робота 14×16 в цвете игрока — та же схема, что и у большого спрайта
// (ноги, корпус, голова, визор), только сведённая к нескольким прямоугольникам.
// По нему видно, КТО именно за краем, а не просто «там кто-то есть».
function _miniRobot(x, y, pal, faceRight){
  const b = pal ? pal.body   : '#2a4a6a';
  const m = pal ? pal.mid    : '#3a6a9a';
  const v = pal ? pal.visor  : '#0ff';
  ctx.fillStyle = m;
  ctx.fillRect(x+2,  y+11, 4, 5);   // ноги
  ctx.fillRect(x+8,  y+11, 4, 5);
  ctx.fillStyle = b;
  ctx.fillRect(x+1,  y+15, 5, 2);   // ступни
  ctx.fillRect(x+8,  y+15, 5, 2);
  ctx.fillStyle = m;
  ctx.fillRect(x+1,  y+6,  12, 6);  // корпус
  ctx.fillStyle = b;
  ctx.fillRect(x+2,  y+7,  10, 4);
  ctx.fillStyle = m;
  ctx.fillRect(x-1,  y+6,  3,  5);  // руки
  ctx.fillRect(x+12, y+6,  3,  5);
  ctx.fillRect(x+2,  y,    10, 7);  // голова
  ctx.fillStyle = v;
  ctx.fillRect(x+3,  y+2,  8,  3);  // визор
  // Блик со стороны, куда игрок смотрит — робот читается как повёрнутый.
  ctx.fillRect(faceRight ? x+9 : x+3, y+2, 2, 3);
}

function _drawOffscreenMarkers(){
  if(typeof ctx === 'undefined' || typeof camX === 'undefined') return;
  for(const [, e] of window.netPlayers){
    const p = e.playerObj;
    if(!p) continue;
    const cx = p.x + p.w/2;
    const left  = cx < camX + 40;
    const right = cx > camX + W - 40;
    if(!left && !right) continue;
    // Дошедшего до флага не отмечаем вовсе: он стоит на финише, и «где он» —
    // не вопрос. Выбывший отмечается ИНАЧЕ: это метка места гибели, а не живой
    // игрок. Раньше по нему рисовалась обычная стрелка с расстоянием, и она
    // звала туда, где давно никого нет.
    const dead = !!(p._netDone && p._netElim);
    if(p._netDone && !dead) continue;

    const pal = (p.colorScheme && typeof p.colorScheme === 'object' && window.robotPalette)
      ? window.robotPalette(p.colorScheme) : null;
    const col = dead ? '#f55' : (pal ? pal.visor : '#0ff');
    const ax = left ? camX + 12 : camX + W - 12;
    const ay = Math.max(30, Math.min(H - 30, p.y + p.h/2));
    ctx.save();
    // Живая стрелка пульсирует и зовёт; метка гибели тусклая и неподвижная —
    // она сообщает, а не торопит.
    ctx.globalAlpha = dead ? 0.42 : (0.6 + 0.25*Math.sin(tick*0.12));
    ctx.fillStyle = col;
    ctx.beginPath();
    if(left){ ctx.moveTo(ax-8,ay); ctx.lineTo(ax+5,ay-8); ctx.lineTo(ax+5,ay+8); }
    else    { ctx.moveTo(ax+8,ay); ctx.lineTo(ax-5,ay-8); ctx.lineTo(ax-5,ay+8); }
    ctx.closePath(); ctx.fill();
    const rx = left ? ax + 9 : ax - 23;
    if(dead){
      // Череп вместо робота и без расстояния: расстояние до мертвеца не нужно.
      ctx.globalAlpha = 0.65;
      ctx.font = '14px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = col;
      ctx.fillText('☠', rx + 7, ay + 6);
    } else {
      ctx.globalAlpha = 1;
      _miniRobot(rx, ay - 8, pal, !left);
      ctx.font = '6px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = col;
      ctx.fillText(Math.round(Math.abs(cx - (camX + W/2)) / 10) + 'm', rx + 7, ay + 18);
    }
    ctx.restore();
  }
}

// Non-host: receive authoritative enemy state from host (ID-based).
// Both clients generate an identical initial enemy array from the shared seed
// (same ids in the same order), but the array can grow independently on each
// side afterwards (e.g. split-enemy children only spawn host-side — see
// hurtE()'s split branch and the guest hurtE redirect below). Matching by the
// enemy's own `id` instead of its array index keeps sync correct even while
// the two arrays temporarily differ in length or ordering.
function applyEnemiesSync(list){
  if(!list||isHost) return;
  if(typeof enemies==='undefined'||!enemies) return;
  const byId=new Map();
  for(const e of enemies){ if(e && e.id!=null) byId.set(e.id, e); }
  for(let i=0;i<list.length;i++){
    const ne=list[i];
    let e=byId.get(ne.id);
    if(!e){
      // Host knows about an enemy we don't have locally yet (e.g. a split-enemy
      // child spawned host-side after our last sync). Build a drawable stub from
      // the enemy config so it renders + can be hit; it keeps the host's id.
      const cfg=(typeof EC!=='undefined')?EC[ne.t]:null;
      e={id:ne.id, type:ne.t, moveType:cfg?cfg.moveType:'walk',
         col:cfg?cfg.col:'#f4a', glow:cfg?cfg.glow:'#f4a',
         w:cfg?cfg.w:24, h:cfg?cfg.h:24,
         vy:0, onGnd:false, a:0, fpH:0, fAmp:0, orbitAngle:0,
         px:ne.x, py:ne.y};
      enemies.push(e);
      byId.set(ne.id, e);
    }
    // Delta-sync: a message may only contain the FEW fields that actually
    // changed since the last one (see _deltaOf in _stateTick) — apply only
    // the fields that are present, leaving everything else exactly as it was.
    // A full snapshot (all fields present) applies exactly the same way, so
    // this code doesn't need to know which kind of message it received.
    if(ne.x!==undefined)  e.x  = ne.x;
    if(ne.y!==undefined)  e.y  = ne.y;
    if(ne.vx!==undefined) e.vx = ne.vx;
    if(ne.hp!==undefined) e.hp = ne.hp;
    if(ne.al!==undefined) e.alive    = !!ne.al;
    if(ne.fl!==undefined) e.flash    = ne.fl|0;
    if(ne.fz!==undefined) e._frozen  = !!ne.fz;
    if(ne.bn!==undefined) e._burning = !!ne.bn;
    if(ne.sh!==undefined) e.shielded = !!ne.sh;
  }
}

// Non-host: receive authoritative boss state from host.
function applyBossSync(b){
  if(isHost) return;
  if(typeof boss==='undefined') return;
  if(!b){
    // Host says boss is gone/dead — play a local death flourish then clear it
    if(boss){
      const bx=boss.x, bw=boss.w; // remember position before we null the boss
      if(typeof burst==='function'){
        burst(boss.x+boss.w/2, boss.y+boss.h/2, (typeof CT!=='undefined'&&CT.clr)||'#fff', 40, 6, 7);
        burst(boss.x+boss.w/2, boss.y+boss.h/2, '#fff', 20, 4, 5);
      }
      if(typeof camShake!=='undefined') camShake = 20;
      boss.alive=false; boss=null;
      // Boss levels park the exit flag off-world (flagX=worldW+99999) until the
      // boss dies; the host reveals it inside killBoss(), which guests never run.
      // Reveal it here too — otherwise the guest can never reach the flag and the
      // whole room hangs forever waiting on them. (flagX/worldW/flagDone are
      // game.js globals shared across the page's classic scripts.)
      if(typeof flagX!=='undefined' && typeof worldW!=='undefined' && flagX>worldW){
        flagX = bx + bw/2 - 15;
        flagDone = false;
      }
    }
    return;
  }
  if(!boss) return; // guest hasn't spawned boss locally yet; wait until it does
  // Delta-sync: only present fields are applied (see _bossDeltaOf in
  // _stateTick) — a full snapshot (right after the boss spawns, or every
  // periodic keyframe) has every field, a delta only has what changed.
  if(b.x!==undefined)      boss.x      = b.x;
  if(b.y!==undefined)      boss.y      = b.y;
  if(b.hp!==undefined)     boss.hp     = b.hp;
  if(b.facing!==undefined) boss.facing = b.facing;
  if(b.phase!==undefined)  boss.phase  = b.phase;
  if(b.flash!==undefined)  boss.flash  = b.flash|0;
  if(b.anim!==undefined)   boss.anim   = b.anim|0;
  if(b.shieldsDown!==undefined) boss.shieldsDown = !!b.shieldsDown;
  if(b.solid!==undefined)       boss.solid       = !!b.solid;
  if(b.windowOpen!==undefined)  boss.windowOpen  = !!b.windowOpen;
  if(b.descending!==undefined)  boss.descending  = !!b.descending;
  if(b.shellBroken!==undefined) boss.shellBroken = !!b.shellBroken;
  if(b.stunTimer!==undefined)   boss.stunTimer   = b.stunTimer|0;
  if(b.orbs && Array.isArray(boss.orbs)){
    for(let i=0;i<boss.orbs.length&&i<b.orbs.length;i++) boss.orbs[i].alive = !!b.orbs[i];
  }
  if(b.nodes && Array.isArray(boss.nodes)){
    for(let i=0;i<boss.nodes.length&&i<b.nodes.length;i++) boss.nodes[i].alive = !!b.nodes[i];
  }
}

// Чужие выстрелы: id игрока → {t, list}. Заполняется событием 'shots' (шлёт
// каждый, см. _stateTick) и рисуется поверх своих снарядов.
window._netShots = new Map();
// Старый канал: снаряды хоста отдельным типом сообщения. Оставлен на случай
// игрока со сборкой прошлой версии — он ещё шлёт bullets_sync, и его огонь
// должен быть виден. Свои сборки этот тип больше не отправляют.
function applyBulletsSync(list){
  if(isHost) return;
  window._netShots.set('legacy-host', {t: Date.now(), list: (list||[]).map(b=>[b.x,b.y,0,b.col||null])});
}

// Non-host: receive enemy bullets from host. We replace the local eBullets
// array so collision (against the local player) and rendering both work.
function applyEBulletsSync(list){
  if(isHost) return;
  if(typeof eBullets==='undefined') return;
  eBullets.length = 0;
  for(const b of (list||[])){
    eBullets.push({x:b.x,y:b.y,w:b.w||10,h:b.h||10,vx:b.vx||0,vy:b.vy||0,dist:0,max:99999,round:!!b.round});
  }
}

function handleRemoteEvent(msg){
  if(msg.event === 'died'){
    const entry = window.netPlayers.get(msg.id);
    if(entry && entry.playerObj){ entry.playerObj.alive = false; }
    // Spawn death particles at remote player's last position
    if(entry && typeof burst==='function'){
      burst(entry.playerObj.x+12, entry.playerObj.y+16, '#f44', 12, 3.5, 4);
    }
  }
  if(msg.event === 'respawn'){
    const entry = window.netPlayers.get(msg.id);
    if(entry && entry.playerObj){ entry.playerObj.alive = true; }
  }
  // A remote player took a checkpoint — recolour it to THEIR colour on our screen
  // too, so every client sees the same checkpoint colour (the toucher's).
  if(msg.event === 'checkpoint' && msg.data){
    const d = msg.data;
    if(typeof checkpoints!=='undefined' && checkpoints[d.idx]){
      const cp = checkpoints[d.idx];
      cp.taken = true; cp.anim = 0; if(d.color) cp.color = d.color;
      if(typeof burst==='function'){ burst(cp.x+cp.w/2, cp.y+8, cp.color||'#4af', 18, 4, 5); }
    }
  }
  // ── A player reached the flag → add them to the finish tally. The room only
  //    advances once EVERYONE has finished (see _hostMarkFinished). Host only.
  if(isHost && msg.event === 'finish'){
    // `eliminated` distinguishes "ran out of lives" from "reached the flag":
    // выбывший освобождает комнату, но уровень не прошёл.
    const _elim  = !!(msg.eliminated || (msg.data && msg.data.eliminated));
    // resync — это повтор по запросу нового хоста, а не новое событие: чат о нём
    // молчит, иначе после смены хоста в него сыпались бы старые сообщения.
    const _quiet = !!(msg.data && msg.data.resync);
    if(_elim && !_quiet){
      const p = players.find(pl=>pl.id===msg.id);
      addChat('☠', T('netPlayerEliminated', esc(p ? p.nickname : '?')));
    }
    _hostMarkFinished(msg.id, _elim, _quiet);
  }
  // Host broadcasts X/N progress to everyone, but only players who themselves
  // already reached the flag should see the dim "waiting" overlay — players still
  // in the level keep playing without it.
  if(msg.event === 'finish_progress' && msg.data){
    _specTally(msg.data.count|0, msg.data.total|0);
    _applyOutFlags(msg.data.out, msg.data.elim);
    if(!isHost && msg.data.name) addChat('★', T('netPlayerFinished', esc(msg.data.name)));
  }
  // Новый хост пересобирает список финишировавших: свои Set'ы у него пустые, а
  // те, кто уже дошёл до флага или выбыл, второй раз об этом не сообщат — без
  // этого комната навсегда зависала у флага после смены хоста.
  // Хост пустил нас в уже идущий уровень: собираем его как обычную сетевую игру
  // (тем же зерном и номером), а не через startAdv — иначе не было бы ни чужих
  // роботов, ни рассылки состояния.
  if(msg.event === 'late_join' && msg.data && !window.netActive && roomCode){
    _netMode  = msg.data.mode  || _netMode;
    _netLevel = msg.data.level || _netLevel;
    _netSeed  = msg.data.seed  || _netSeed;
    showNetCountdown(_netMode, _netLevel, () => startNetworkGame(players));
  }
  // Хост не пускает в идущий уровень — ждём в комнате до следующего (см.
  // level_complete: клиент вне игры входит там же, где остальные его начинают).
  if(msg.event === 'join_denied' && !window.netActive && roomCode){
    setRoomStatus(T('netJoinDenied'));
    netToast('⏳', T('netJoinDenied'), '#fc4');
  }
  // Кто-то выбыл — уведомление в углу у всех, кроме хозяина: он показал его сам.
  if(msg.event === 'player_out' && msg.data){
    netToast('☠', T('netPlayerEliminated', msg.data.name || '?'), '#f55');
  }
  // Чужие выстрелы и общий мир — см. _stateTick.
  if(msg.event === 'shots' && msg.data){
    window._netShots.set(msg.id, {t: Date.now(), list: Array.isArray(msg.data.b) ? msg.data.b : []});
  }
  if(msg.event === 'world' && msg.data && typeof netWorldApply === 'function'){
    try{ netWorldApply(msg.data); }catch(e){}
  }
  if(msg.event === 'need_finish' && _iFinished){
    if(isHost) _hostMarkFinished(myId, _iEliminated, true);
    else wsSend({type:'game_event', event:'finish', data:{eliminated:_iEliminated, resync:true}});
  }
  // Final level cleared by the whole room → win for everyone.
  if(msg.event === 'won'){
    hideNetWaiting();
    const _wasSecret=(typeof advLevel!=='undefined' && advLevel>=110);
    if(_wasSecret && typeof showSecretWin==='function') showSecretWin();
    else if(typeof showWin === 'function') showWin();
  }
  // ── Host-authoritative damage from a guest's attack ──────────────────────
  // Guests can't kill enemies locally (host owns hp). They report the hit and
  // the host applies it via hurtE/damageBoss; the result syncs back to all.
  if(isHost && msg.event === 'hit_enemy' && msg.data){
    const d = msg.data;
    const e = (typeof enemies!=='undefined' && enemies) ? enemies.find(en=>en && en.id===d.id) : null;
    if(e && e.alive){
      if(typeof hurtE==='function') hurtE(e, d.dmg||1, !!d.stomp, !!d.pc);
      // Apply elemental status the same way local bullets do
      if(e.alive && d.elem==='fire'){ if(!e._burning){e._burning=true;e._burnT=0;e._burnTotal=300;} }
      if(e.alive && d.elem==='ice'){  if(!e._frozen){e._frozen=true;e._freezeT=90;e._origSpd=e.spd||1;} e.vx=0; }
    }
  }
  // Толчок глыбы от гостя — двигает её хозяин, результат уезжает всем в enemies_sync.
  if(isHost && msg.event === 'ice_push' && msg.data){
    const e = (typeof enemies!=='undefined' && enemies) ? enemies.find(en=>en && en.id===msg.data.id) : null;
    if(e && e.alive && e._frozen){
      e._iceVX = msg.data.vx || 0;
      if(!e._icePushSfx){ e._icePushSfx = 1; if(typeof SFX!=='undefined'&&SFX.hit) SFX.hit(); }
    }
  }
  if(isHost && msg.event === 'hit_boss' && msg.data){
    const d = msg.data;
    if(typeof boss!=='undefined' && boss && boss.alive){
      if(typeof damageBoss==='function') damageBoss(d.dmg||1);
      if(boss && boss.alive && d.elem==='fire'){ if(!boss._burning){boss._burning=true;boss._burnT=0;boss._burnTotal=300;} }
      if(boss && boss.alive && d.elem==='ice'){  boss._slowed=true;boss._slowT=180; }
    }
  }
  // A guest destroyed a boss part (orb/node) — apply it on the authoritative boss.
  // The result rides back to everyone in the next boss_sync.
  if(isHost && msg.event === 'hit_boss_part' && msg.data){
    const d = msg.data;
    if(typeof boss!=='undefined' && boss && boss.alive){
      const arr = d.kind==='orb' ? boss.orbs : (d.kind==='node' ? boss.nodes : null);
      if(Array.isArray(arr) && arr[d.idx] && arr[d.idx].alive){
        arr[d.idx].alive = false;
        if(d.kind==='node') arr[d.idx].flashT = 20;
      }
    }
  }
}

// Гость толкнул замороженного врага. Само скольжение считает хозяин (у гостя
// ИИ врагов выключен), поэтому отправляем ему только направление толчка.
window.netReportIcePush = function(id, vx){
  if(!window.netActive || isHost) return;
  wsSend({type:'game_event', event:'ice_push', data:{id:id, vx:+(+vx).toFixed(2)}});
};

// Guest helper: report a hit on enemy `id` (stable identity, not array index) to the host.
window.netReportEnemyHit = function(id, dmg, stomp, elem, pierce){
  if(!window.netActive || isHost) return;
  // `pc` = pierce: damage a shield was never meant to stop (star mode, ice
  // shatter, burn tick). Without it the host would block a guest's star kill.
  wsSend({type:'game_event', event:'hit_enemy',
          data:{id:id, dmg:dmg||1, stomp:!!stomp, elem:elem||null, pc:!!pierce}});
};
window.netReportBossHit = function(dmg, elem){
  if(!window.netActive || isHost) return;
  wsSend({type:'game_event', event:'hit_boss', data:{dmg:dmg||1, elem:elem||null}});
};
// Guest helper: report destruction of a boss part (orb / node) by index. The host
// owns the part state and syncs it back via boss_sync.
window.netReportBossPart = function(kind, idx){
  if(!window.netActive || isHost) return;
  wsSend({type:'game_event', event:'hit_boss_part', data:{kind:kind, idx:idx|0}});
};

// ── Button wiring ────────────────────────────────────────────────────────────
// Toggle helper: highlight a button as active (coloured) or inactive (secondary).
function _tog(btn, on, col){
  if(!btn) return;
  col = col || '#0ff';
  btn.classList.toggle('secondary', !on);
  btn.style.borderColor = on ? col : '';
  btn.style.color       = on ? col : '';
}

// Read + persist the nickname from the input. Called before every create/join.
function commitNick(){
  myNick = sanitizeNick(document.getElementById('netNick').value);
  const el = document.getElementById('netNick');
  if(el) el.value = myNick;
  saveProfile();
  return myNick;
}
document.getElementById('netNick').addEventListener('change', commitNick);

// ── CREATE-ROOM view ─────────────────────────────────────────────────────
function applyVisUI(){
  _tog(document.getElementById('netVisOpenBtn'),   _createPublic,  '#0f8');
  _tog(document.getElementById('netVisClosedBtn'), !_createPublic, '#fc3');
  const hint = document.getElementById('netVisHint');
  if(hint){
    hint.textContent = _createPublic ? T('netOpenHint') : T('netClosedHint');
    hint.style.color = _createPublic ? '#4af9' : '#fc3';
  }
}
function applyMaxUI(){
  document.querySelectorAll('#netMaxRow .net-max-btn').forEach(b => {
    _tog(b, parseInt(b.dataset.max,10)===_createMax, '#0ff');
  });
}
document.getElementById('netVisOpenBtn').onclick   = () => { _createPublic = true;  applyVisUI(); };
document.getElementById('netVisClosedBtn').onclick = () => { _createPublic = false; applyVisUI(); };
document.querySelectorAll('#netMaxRow .net-max-btn').forEach(b => {
  b.onclick = () => { _createMax = parseInt(b.dataset.max,10) || MAX_NET_PLAYERS; applyMaxUI(); };
});
document.getElementById('netDoCreateBtn').onclick = () => {
  commitNick();
  wsSend({type:'create_room', nickname:myNick, color:myColor, isPublic:_createPublic, maxPlayers:_createMax});
};

// ── FIND-ROOM view ──────────────────────────────────────────────────────
function applySrcUI(){
  _tog(document.getElementById('netSrcServerBtn'),       _lobbyMode==='server', '#f0f');
  _tog(document.getElementById('netSrcLocalBtn'),        _lobbyMode==='lan',    '#0f8');
  _tog(document.getElementById('netCreateSrcServerBtn'), _lobbyMode==='server', '#f0f');
  _tog(document.getElementById('netCreateSrcLocalBtn'),  _lobbyMode==='lan',    '#0f8');
  refreshLanHostUI();
}

// LAN-only: show the host-address input (so a peer can target the host's IP) and
// list this machine's own LAN IPs (so the host can read them out to friends).
function refreshLanHostUI(){
  // Web: «LOCAL» routes through the cloud relay, so the LAN host-address input is
  // meaningless — hide it and show a one-line hint that local play uses the
  // online server in the browser. (Both create + find views carry a hint span.)
  const showHint = (!IS_DESKTOP && _lobbyMode === 'lan');
  document.querySelectorAll('.net-local-web-hint').forEach(el => {
    el.style.display = showHint ? 'block' : 'none';
    if(showHint) el.textContent = T('netLocalWebHint');
  });

  const row = document.getElementById('netLanHostRow');
  if(!row) return;
  const show = (IS_DESKTOP && _lobbyMode === 'lan' && _uiView === 'find');
  row.style.display = show ? 'flex' : 'none';
  if(!show) return;
  const inp = document.getElementById('netLanHost');
  if(inp && document.activeElement !== inp) inp.value = _lanHost || 'localhost';
  // Populate our own LAN IPs (Electron only).
  const ipsEl = document.getElementById('netLanIps');
  if(ipsEl && window.electronAPI && typeof window.electronAPI.getLanInfo === 'function'){
    window.electronAPI.getLanInfo().then(info => {
      if(!info) return;
      const ips = (info.ips || []);
      ipsEl.textContent = ips.length
        ? T('netLanYourIp', ips.join(', '))
        : T('netLanNoIp');
    }).catch(()=>{});
  }
}
function commitLanHost(){
  const inp = document.getElementById('netLanHost');
  if(!inp) return;
  const v = (inp.value || '').trim() || 'localhost';
  if(v === _lanHost) return;
  _lanHost = v;
  try { localStorage.setItem('bb_net_lanhost', _lanHost); } catch(e){}
  // Reconnect to the new endpoint if we're in LAN mode.
  if(_lobbyMode === 'lan'){
    _manualClose = false;
    if(ws){ try{ ws.close(); }catch(e){} }
    connect();
    if(_uiView === 'find') setTimeout(loadPublicRooms, 600);
  }
}
// Switch the room source (cloud vs LAN). Reconnects to the right endpoint and
// reloads the room list so the player sees rooms from the chosen source.
function setSource(mode){
  if(_lobbyMode === mode){ if(_uiView === 'find') loadPublicRooms(); return; }
  _lobbyMode = mode;
  applySrcUI();
  netApplyLang();
  const refreshList = (_uiView === 'find');
  if(!ws || ws.readyState > 1 || _connectedUrl !== activeUrl()){
    _manualClose = false;
    if(ws){ try{ ws.close(); }catch(e){} }
    connect();
    if(refreshList) setTimeout(loadPublicRooms, 600);
  } else if(refreshList){
    loadPublicRooms();
  }
}
document.getElementById('netSrcServerBtn').onclick       = () => setSource('server');
document.getElementById('netSrcLocalBtn').onclick        = () => setSource('lan');
document.getElementById('netCreateSrcServerBtn').onclick = () => setSource('server');
document.getElementById('netCreateSrcLocalBtn').onclick  = () => setSource('lan');

document.getElementById('netReloadRoomsBtn').onclick = loadPublicRooms;
(function(){
  const lh = document.getElementById('netLanHost');
  if(lh){ lh.addEventListener('change', commitLanHost); lh.addEventListener('blur', commitLanHost); }
})();

function loadPublicRooms(){
  const $list = document.getElementById('netRoomsList');
  if($list) $list.innerHTML = `<div class="net-status">${esc(T('netLoadingRooms'))}</div>`;
  wsSend({type:'list_rooms'});
}

function renderPublicRooms(roomArr){
  const $list = document.getElementById('netRoomsList');
  if(!$list) return;
  if(!roomArr.length){
    $list.innerHTML = `<div class="net-status" style="color:#4af4">${esc(T('netNoRooms'))}</div>`;
    return;
  }
  $list.innerHTML = '';
  roomArr.forEach(r => {
    const row = document.createElement('div');
    row.className = 'net-pub-room';
    const modeStr = r.mode
      ? (r.mode==='adventure' ? T('netRoomMetaAdv', r.level) : T('netRoomMetaInf'))
      : T('netRoomMetaNotSet');
    row.innerHTML = `
      <div class="net-pub-room-info">
        <div class="net-pub-room-host">👤 ${esc(r.hostName)}</div>
        <div class="net-pub-room-meta">${esc(modeStr)} &nbsp;·&nbsp; ${esc(T('netRoomCodeWord'))}: ${esc(r.code)}</div>
      </div>
      <div class="net-pub-room-count">${r.playerCount}/${r.maxPlayers}</div>
    `;
    row.onclick = () => {
      commitNick();
      wsSend({type:'join_room', code:r.code, nickname:myNick, color:myColor});
    };
    $list.appendChild(row);
  });
}

document.getElementById('netJoinBtn').onclick = () => {
  commitNick();
  const code = document.getElementById('netCodeInput').value.toUpperCase().trim();
  if(code.length!==6){ $connStatus.textContent=T('netEnterCode'); $connStatus.classList.add('net-error'); return; }
  wsSend({type:'join_room', code, nickname:myNick, color:myColor});
};

$readyBtn.onclick = () => {
  isReady = !isReady;
  $readyBtn.textContent = isReady ? T('netUnready') : T('netReady');
  $readyBtn.style.borderColor = isReady ? '#0f0' : '';
  $readyBtn.style.color       = isReady ? '#0f0' : '';
  wsSend({type:'set_ready', ready:isReady});
};

$startBtn.onclick = () => {
  // Client-side guard mirroring the server check: never request a start unless
  // there are ≥2 players and EVERY other player is ready. The button is normally
  // disabled in that case too, but guarding here also protects against any state
  // desync and against an older relay that doesn't enforce readiness server-side.
  const allReady = players.filter(p=>p.id!==myId).every(p=>p.ready);
  if(players.length < 2 || !allReady){
    setRoomStatus(players.length < 2 ? T('netNeed2') : T('netWaitReady'), true);
    return;
  }
  wsSend({type:'start_game'});
};

// ── Level picker (host only) ────────────────────────────────────────────────
let _hostMode = 'infinite';

document.getElementById('netModeAdv').onclick = () => {
  _hostMode = 'adventure';
  _netLevel = parseInt(document.getElementById('netLvlInput').value)||1;
  document.getElementById('netLvlRow').style.display = 'flex';
  document.getElementById('netModeAdv').style.borderColor = '#0ff';
  document.getElementById('netModeAdv').style.color = '#0ff';
  document.getElementById('netModeInf').style.borderColor = '';
  document.getElementById('netModeInf').style.color = '';
  wsSend({type:'select_level', mode:'adventure', level:_netLevel, seed:Date.now()});
};

document.getElementById('netModeInf').onclick = () => {
  _hostMode = 'infinite';
  document.getElementById('netLvlRow').style.display = 'none';
  document.getElementById('netModeInf').style.borderColor = '#0ff';
  document.getElementById('netModeInf').style.color = '#0ff';
  document.getElementById('netModeAdv').style.borderColor = '';
  document.getElementById('netModeAdv').style.color = '';
  wsSend({type:'select_level', mode:'infinite', level:1, seed:Date.now()});
};

document.getElementById('netLvlInput').oninput = () => {
  const _max = (typeof window.advTotalLevels === 'function') ? window.advTotalLevels() : 100;
  const n = Math.min(_max, Math.max(1, parseInt(document.getElementById('netLvlInput').value)||1));
  _netLevel = n;
  wsSend({type:'select_level', mode:'adventure', level:n, seed:Date.now()});
};

function updateLevelStatus(){
  const $s = document.getElementById('netLevelStatus');
  if(!$s) return;
  if(_netMode === 'adventure'){
    $s.textContent = T('netAdvLevelStatus', _netLevel);
    $s.style.color = '#0ff';
  } else if(_netMode === 'infinite'){
    $s.textContent = T('netInfSelectedStatus');
    $s.style.color = '#0f8';
  } else {
    $s.textContent = T('netChooseMode');
    $s.style.color = '#ff0';
  }
  // Reflect the active mode on the picker buttons too
  const adv = document.getElementById('netModeAdv');
  const inf = document.getElementById('netModeInf');
  if(adv && inf){
    const onAdv = _netMode === 'adventure';
    adv.style.borderColor = onAdv ? '#0ff' : '';
    adv.style.color       = onAdv ? '#0ff' : '';
    inf.style.borderColor = _netMode === 'infinite' ? '#0ff' : '';
    inf.style.color       = _netMode === 'infinite' ? '#0ff' : '';
    const lvlRow = document.getElementById('netLvlRow');
    if(lvlRow) lvlRow.style.display = onAdv ? 'flex' : 'none';
  }
}

document.getElementById('netLeaveBtn').onclick = () => {
  leaveRoom();
};

{
  const _ljBox = document.getElementById('netAllowJoinBox');
  if(_ljBox) _ljBox.onchange = () => {
    _allowLateJoin = !!_ljBox.checked;
    try{ localStorage.setItem('bb_net_latejoin', _allowLateJoin ? '1' : '0'); }catch(e){}
  };
  _syncLateJoinUI();
}

document.getElementById('netBackBtn').onclick = () => {
  $lobby.style.display = 'none';
  if(typeof showNetType==='function') showNetType();
  else if(typeof showMain==='function') showMain();
};

document.getElementById('netConnLostBtn').onclick = () => {
  hideConnLost();
  leaveRoom();
};

$chatInput.onkeydown = (e) => {
  if(e.key==='Enter' && $chatInput.value.trim()){
    wsSend({type:'chat', text:$chatInput.value.trim().slice(0,80)});
    $chatInput.value='';
  }
};

function leaveRoom(){
  _manualClose = true;
  if(_reconnectTimer){ clearTimeout(_reconnectTimer); _reconnectTimer=null; }
  stopStateLoop();
  if(typeof window.stopBgTicker==='function') window.stopBgTicker();
  stopPing();
  hideConnLost();
  _resetFinishState();   // clear any "waiting for players" overlay/tally
  // Выход из комнаты — это и выход С УРОВНЯ. Без сброса состояния игра
  // оставалась в 'playing': на телефоне не пропадали сенсорные кнопки (они
  // показываются ровно по этому признаку, см. touch.js), а игровой цикл
  // продолжал считать уровень под меню.
  try{
    if(typeof gState !== 'undefined' && (gState==='playing' || gState==='paused' || gState==='levelclear')){
      gState = 'menu';
      if(typeof stopMusic === 'function') stopMusic();
      if(typeof hideAll === 'function') hideAll();
    }
  }catch(e){}
  window.netActive = false;
  window.netPlayers.clear();
  window._netShots.clear();
  _lastWorldJson = ''; _lastShotCount = 0;
  updateGamePing(); // hide the in-game ping readout
  _netMode = 'infinite'; _netLevel = 1; _netSeed = 0;
  // Tell the relay to drop us NOW so the room is deleted immediately instead of
  // lingering under the disconnect grace timer (which showed it as a ghost room).
  if(ws && ws.readyState===1 && roomCode){ try{ wsSend({type:'leave_room'}); }catch(e){} }
  roomCode = null; isHost = false; isReady = false; players = [];
  if(ws){ try{ ws.close(); }catch(e){} ws=null; }
  $room.style.display    = 'none';
  $connect.style.display = '';
  $lobby.style.display   = 'none';
  if(typeof showNetType==='function') showNetType();
  else if(typeof showMain==='function') showMain();
  setTimeout(connect, 300);
}

// ── Public API ───────────────────────────────────────────────────────────────
// Re-apply all network UI text in the active language. Safe to call any time.
function netApplyLang(){
  // Lobby header (mode-dependent)
  const h2 = document.getElementById('netLobbyTitle');
  if(h2){
    if(_lobbyMode === 'lan'){
      h2.textContent = T('netLobbyLocal');
      h2.style.color = '#0f8'; h2.style.textShadow = '0 0 14px #0f8';
    } else {
      h2.textContent = T('netLobbyOnline');
      h2.style.color = '#f0f'; h2.style.textShadow = '0 0 14px #f0f';
    }
  }
  // Players-count label
  const pl = document.getElementById('netPlayersLabel');
  if(pl) pl.textContent = T('netPlayersMax', roomMaxPlayers);
  // Re-seed connect-screen toggle UI (labels/hints depend on language).
  if($connect && $connect.style.display !== 'none'){
    if(typeof applyVisUI==='function' && _uiView==='create'){ applyVisUI(); applyMaxUI(); }
    if(typeof applySrcUI==='function'){ applySrcUI(); }
  }
  // Ready button reflects current state
  if($readyBtn) $readyBtn.textContent = isReady ? T('netUnready') : T('netReady');
  // Connection-lost overlay
  const clT = document.getElementById('netConnLostTitle');
  const clS = document.getElementById('netConnLostSub');
  const clB = document.getElementById('netConnLostBtn');
  if(clT) clT.textContent = T('netConnLost');
  if(clS) clS.textContent = T('netConnLostSub');
  if(clB) clB.textContent = T('netReturnLobby');
  // Loading sub-text
  const ls = document.getElementById('netLoadSub');
  if(ls) ls.textContent = T('netGetReadySub');
  // Re-render dynamic lists/statuses
  if($room && $room.style.display !== 'none'){
    refreshPlayerList();
    updateLevelStatus();
    if(isHost) updateStartBtn();
    else setRoomStatus(T('netWaitHost'));
  }
}
window.netApplyLang = netApplyLang;

window.NetPlay = {
  // view: 'create' | 'find'. Create always hosts on the cloud server; Find lets
  // the player toggle between server (cloud) and local (LAN) room sources.
  open(view='create'){
    _uiView = (view === 'find') ? 'find' : 'create';

    loadProfile();
    buildColorPicker();
    const nickEl = document.getElementById('netNick');
    if(nickEl) nickEl.value = myNick;

    // Show the right sub-view and seed its toggle UI.
    const cv = document.getElementById('netCreateView');
    const fv = document.getElementById('netFindView');
    if(cv) cv.style.display = _uiView==='create' ? 'flex' : 'none';
    if(fv) fv.style.display = _uiView==='find'   ? 'flex' : 'none';
    if(_uiView === 'create'){ applyVisUI(); applyMaxUI(); applySrcUI(); }
    else { applySrcUI(); }

    netApplyLang();
    if(typeof window.applyI18nDOM==='function') window.applyI18nDOM();
    $connect.style.display = '';
    $room.style.display    = 'none';
    $lobby.style.display   = 'flex';
    if(window._netFitLobby){ window._netFitLobby(); [60,200,500].forEach(t=>setTimeout(window._netFitLobby,t)); }

    // (Re)connect to the endpoint for the active source, then list rooms in Find.
    if(!ws || ws.readyState > 1 || _connectedUrl !== activeUrl()){
      _manualClose = false;
      if(ws){ try{ ws.close(); }catch(e){} }
      connect();
      if(_uiView === 'find') setTimeout(loadPublicRooms, 600);
    } else if(_uiView === 'find'){
      loadPublicRooms();
    }
  },
  close: leaveRoom,
  isActive(){ return window.netActive; },

  /**
   * Войти в комнату по коду. Нужен уведомлению о приглашении: нажатие должно
   * заводить игрока прямо в комнату друга, а не открывать лобби «где-то рядом».
   *
   * `source` обязателен вместе с кодом: комната живёт либо на облачном relay,
   * либо в локальной сети, и один и тот же код в другом источнике не значит
   * ничего. Подключение может быть ещё не поднято (игрок в главном меню),
   * поэтому отправку ставим в очередь до открытия сокета.
   */
  joinByCode(code, source){
    const clean = String(code || '').toUpperCase().trim();
    if(clean.length !== 6) return false;
    this.open('find');
    // В приглашении источник называется 'local' (так его понимает база),
    // а внутри лобби тот же режим зовётся 'lan'.
    if(source === 'local') setSource('lan');
    else if(source === 'server') setSource('server');
    const input = document.getElementById('netCodeInput');
    if(input) input.value = clean;

    const send = () => wsSend({type:'join_room', code:clean, nickname:myNick, color:myColor});
    if(ws && ws.readyState === 1) send();
    else {
      // Сокет ещё открывается — ждём, но не вечно: если за десять секунд не
      // поднялся, игрок остаётся в лобби с уже вписанным кодом и жмёт «войти».
      let tries = 0;
      const t = setInterval(() => {
        if(ws && ws.readyState === 1){ clearInterval(t); send(); }
        else if(++tries > 40) clearInterval(t);
      }, 250);
    }
    return true;
  },
};

// ── Util ─────────────────────────────────────────────────────────────────────
function sanitizeNick(s){
  return (s||'').replace(/[^A-Za-z0-9_ ]/g,'').trim().slice(0,16).toUpperCase() || 'PLAYER';
}

// ── Patch startAdv/startInf to apply network colour ──────────────────────────
setTimeout(() => {
  if(typeof drawPlayer !== 'function') return;
  const _origDrawPlayer = drawPlayer;
  window.drawPlayer = function(){
    // Guarantee the local robot always wears the colour the player picked. The
    // local player object can be re-created on level loads, so re-assert it every
    // frame in network mode (cheap) — this fixes "others see my colour but I don't".
    if(window.netActive && typeof player!=='undefined' && player && myColor && typeof myColor==='object'){
      player.colorScheme = myColor;
    }
    _origDrawPlayer();
    if(!window.netActive) return;
    interpolateGhosts();
    for(const [, entry] of window.netPlayers){
      if(entry.playerObj) drawOnePlayer(entry.playerObj);
    }
    _drawOffscreenMarkers();
  };

  // Wrap startAdv
  if(typeof startAdv === 'function'){
    const _origStartAdv = startAdv;
    window.startAdv = function(n, f){
      _origStartAdv(n, f);
      if(window.netActive && typeof player !== 'undefined' && player){
        player.colorScheme = myColor;
        player.nickname    = myNick;
      }
    };
  }

  // Wrap startInf
  if(typeof startInf === 'function'){
    const _origStartInf = startInf;
    window.startInf = function(f){
      _origStartInf(f);
      if(window.netActive && typeof player !== 'undefined' && player){
        player.colorScheme = myColor;
        player.nickname    = myNick;
      }
    };
  }

  // Чужие выстрелы поверх своих. Раньше здесь рисовались только снаряды хоста и
  // только у гостей — теперь видно огонь ЛЮБОГО игрока, включая огненные и
  // ледяные шары (kind 1 и 2). Записи старше секунды выбрасываем: игрок мог
  // выйти или зависнуть, и его снаряды не должны остаться висеть в воздухе.
  if(typeof drawBullets === 'function'){
    const _origDrawBullets = drawBullets;
    window.drawBullets = function(){
      _origDrawBullets();
      if(!window.netActive) return;
      const now = Date.now();
      for(const [id, entry] of window._netShots){
        if(now - entry.t > 1000){ window._netShots.delete(id); continue; }
        for(const b of entry.list){
          const kind = b[2]|0;
          const cx = (b[0]||0) + (kind ? 8 : 6), cy = (b[1]||0) + (kind ? 8 : 4);
          if(kind){
            // Стихийный шар: светящийся сгусток, огонь оранжевый, лёд голубой.
            const col = kind===1 ? '#ff6a1a' : '#7ce8ff';
            ctx.fillStyle = col;
            ctx.beginPath();ctx.arc(cx,cy,6,0,Math.PI*2);ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.beginPath();ctx.arc(cx,cy,2.4,0,Math.PI*2);ctx.fill();
          } else {
            ctx.fillStyle = b[3] || '#0cf';
            ctx.beginPath();ctx.ellipse(cx,cy,8*.7,4*.5,0,0,Math.PI*2);ctx.fill();
            ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(cx,cy,4*.3,0,Math.PI*2);ctx.fill();
          }
        }
      }
    };
  }

  // Non-host: disable local enemy AI (host is authoritative)
  if(typeof updateEnemies === 'function'){
    const _origUpdateEnemies = updateEnemies;
    window.updateEnemies = function(){
      if(window.netActive && !isHost) return;
      _origUpdateEnemies();
    };
  }

  // NOTE: updateBoss() is deliberately NOT wrapped here. game.js's updateBoss has
  // its own host/guest split: on a guest it skips the authoritative AI but STILL
  // runs _bossPlayerContact() (stomp) and _bossBulletContact() (shots) so the
  // guest can damage the boss (reported to the host via the damageBoss redirect
  // below). A blanket "return on guest" wrapper here used to swallow that guest
  // branch entirely — which made every non-host player pass through the boss and
  // be unable to hurt it. The boss AI is already gated inside game.js, so the
  // host stays authoritative without this wrapper.

  // ── Guest damage redirect ───────────────────────────────────────────────────
  // On a guest, hp is owned by the host. When the guest's bullet/stomp hits an
  // enemy, report the hit to the host (which applies it and syncs hp back) and
  // suppress the local hp mutation so the two don't fight. Visual feedback (the
  // hit flash / particles) still comes back through enemies_sync.
  if(typeof hurtE === 'function'){
    const _origHurtE = hurtE;
    // NOTE: this wrapper must forward EVERY argument. It used to take only
    // (e, dmg, stomped) and drop the rest, which silently swallowed hurtE()'s
    // `pierce` flag — so star-mode kills and ice shatters were blocked by
    // enemy shields even in single player, because the wrapper is installed
    // unconditionally 300 ms after load.
    window.hurtE = function(e, dmg, stomped, pierce){
      if(window.netActive && !isHost){
        if(e && e.id!=null){
          // Determine element from the in-flight bullet context isn't available
          // here, so pass null; fire/ice status is applied host-side on its own
          // bullet collisions. Stomp/plain shots are the common case.
          window.netReportEnemyHit(e.id, dmg, stomped, e._netHitElem||null, pierce);
        }
        return; // host is authoritative — no local hp change
      }
      return _origHurtE(e, dmg, stomped, pierce);
    };
  }
  if(typeof damageBoss === 'function'){
    const _origDamageBoss = damageBoss;
    window.damageBoss = function(dmg){
      if(window.netActive && !isHost){
        window.netReportBossHit(dmg, (typeof boss!=='undefined'&&boss)?boss._netHitElem||null:null);
        return; // host authoritative
      }
      return _origDamageBoss(dmg);
    };
  }
}, 300);

})();
