// ── Launch counter ───────────────────────────────────────────────────────────
// Reports ONE "the game was opened" event to the project's relay server, so the
// admin page can show how many people actually play. Deliberately minimal:
//
//   • what is sent: edition (full/demo), platform (web/android/desktop), UI
//     language. Nothing that identifies a person, no progress, no scores.
//   • sent once per session, never repeated.
//   • every failure is swallowed — an offline player or a sleeping server must
//     not affect the game in any way.
//
// Set window.BB_STATS_API before this file loads to point it elsewhere; set it
// to an empty string to disable reporting entirely.
(function () {
  'use strict';
  var API = (typeof window.BB_STATS_API === 'string')
    ? window.BB_STATS_API
    : 'https://ws.byte-blaster-server.run.place';
  if (!API) return;

  function platform() {
    // Capacitor exposes itself on the window inside the Android WebView;
    // Electron sets a preload bridge. Everything else is the browser build.
    if (window.Capacitor || /Android/i.test(navigator.userAgent) && window.location.protocol === 'file:') return 'android';
    if (window.electronAPI || window.saveAPI) return 'desktop';
    return 'web';
  }

  function report() {
    try {
      if (sessionStorage.getItem('bbLaunchSent')) return;
      sessionStorage.setItem('bbLaunchSent', '1');
    } catch (e) { /* private mode — send anyway, once per load */ }

    var body = {
      kind: 'game',
      build_type: String(window.BB_BUILD_TYPE || 'dev'),
      licensed: !!(window.License && window.License.hasGame('byte-blaster')),
      platform: platform(),
      lang: (window.gameSettings && window.gameSettings.language) || 'auto',
    };
    try {
      fetch(API + '/api/hit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(function () {});
    } catch (e) {}
  }

  // Wait for the menu to exist: reporting a launch that crashed on boot would
  // count players who never saw the game.
  if (document.readyState === 'complete') setTimeout(report, 2500);
  else window.addEventListener('load', function () { setTimeout(report, 2500); });

  /* ── «Сейчас играют» ─────────────────────────────────────────────────────
     Отметка раз в полминуты в таблицу presence (миграция 0018); сайты читают
     из неё счётчик. Считаются только вошедшие: анонимную отметку может прислать
     кто угодно сколько угодно раз, и число перестало бы что-то значить.

     Почему не через релей, который и так знает своих игроков: он живёт на
     Railway, а тот из России не открывается без VPN — счётчик на сайте был бы
     пустым ровно для основной аудитории. Supabase доступен, комнаты возьмём с
     релея отдельно, когда он ответит. */
  var SUPABASE_URL = 'https://zyjhvuhovimorpokiwty.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_1bj04J3qsO1EqsKPQeSbmg_cBDEtreK';

  function mode() {
    if (window.netActive) return 'multiplayer';
    if (window.dailyMode) return 'daily';
    if (typeof gState !== 'undefined' && gState === 'playing') return 'playing';
    return 'menu';
  }

  function ping() {
    if (document.hidden) return;                  // свёрнутую игру не считаем
    if (!(window.License && window.License.loggedIn && window.License.loggedIn())) return;
    var tk = window.License.accessToken ? window.License.accessToken() : null;
    Promise.resolve(tk).then(function (t) {
      if (!t) return;
      return fetch(SUPABASE_URL + '/rest/v1/rpc/presence_ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: 'Bearer ' + t },
        body: JSON.stringify({ p_game_slug: 'byte-blaster', p_mode: mode() }),
      });
    }).catch(function () { /* нет сети — счётчик не то, ради чего стоит шуметь */ });
  }

  setTimeout(ping, 4000);
  setInterval(ping, 30000);
})();
