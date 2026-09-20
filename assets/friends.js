// ===============================================================
//  BYTE BLASTER — ДРУЗЬЯ И ПУБЛИЧНЫЙ ПРОГРЕСС
// ===============================================================
// То же, что на сайте студии, но из игры: позвать по нику, принять заявку,
// посмотреть, кто как продвинулся. Аккаунт один, поэтому список друзей везде
// один и тот же — добавили на сайте, видно в игре, и наоборот.
//
// Ходим в базу напрямую по REST, как cloudsave.js: supabase-js тянется с CDN и
// в офлайне (Electron, самолётный режим) просто не загрузился бы. Токен даёт
// License — он же продлевает просроченный.
//
// Что публикует игра: короткую сводку (уровни, звёзды, кристаллы, достижения,
// счёт, время), а не сохранение. Сохранение приватно и лежит в cloud_saves;
// сводка открыта — на неё и смотрят друзья.
(function () {
  'use strict';

  const SUPABASE_URL = 'https://zyjhvuhovimorpokiwty.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_1bj04J3qsO1EqsKPQeSbmg_cBDEtreK';
  const GAME = 'byte-blaster';

  async function token() {
    if (!window.License || !window.License.loggedIn()) return null;
    return window.License.accessToken ? window.License.accessToken() : null;
  }

  function headers(auth) {
    return {
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + auth,
      'Content-Type': 'application/json',
    };
  }

  /** Разбирает отказ так же, как cloudsave: код + текст, а не «нет связи». */
  async function fail(res, what) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body.message || body.error || body.hint || '';
    } catch (e) { /* тело не JSON */ }
    console.error('Friends ' + what + ': ' + res.status + ' ' + detail);
    const err = new Error(what + '_' + res.status);
    err.status = res.status;
    err.detail = detail;
    return err;
  }

  async function rpc(name, body) {
    const auth = await token();
    if (!auth) throw new Error('not_logged_in');
    const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + name, {
      method: 'POST', headers: headers(auth), body: JSON.stringify(body || {}),
    });
    if (!res.ok) throw await fail(res, name);
    return res.json().catch(() => null);
  }

  /* ── Список и заявки ────────────────────────────────────────────────── */
  async function list() {
    const auth = await token();
    if (!auth) throw new Error('not_logged_in');
    const res = await fetch(
      SUPABASE_URL + '/rest/v1/my_friends?select=id,nickname,avatar_url,kind,created_at'
      + '&order=created_at.desc', { headers: headers(auth) });
    if (!res.ok) throw await fail(res, 'list');
    return res.json();
  }

  const search = (q) => (String(q || '').trim().length < 2
    ? Promise.resolve([]) : rpc('search_players', { p_query: String(q).trim() }));
  const request = (nickname) => rpc('friend_request', { p_nickname: nickname });
  const accept = (requesterId) => rpc('friend_accept', { p_requester: requesterId });
  const profile = (nickname) => rpc('public_profile', { p_nickname: nickname });

  /** Убирает связь в любом состоянии: отказ, отмена заявки, удаление друга. */
  async function remove(otherId) {
    const auth = await token();
    if (!auth) throw new Error('not_logged_in');
    const me = window.License && window.License.userId && window.License.userId();
    const filter = me
      ? '?or=(and(requester.eq.' + me + ',addressee.eq.' + otherId + '),'
        + 'and(requester.eq.' + otherId + ',addressee.eq.' + me + '))'
      // Без своего id полагаемся на политику RLS: она и так пустит только к
      // своим связям, а лишние строки удалить не даст.
      : '?or=(requester.eq.' + otherId + ',addressee.eq.' + otherId + ')';
    const res = await fetch(SUPABASE_URL + '/rest/v1/friendships' + filter, {
      method: 'DELETE', headers: headers(auth),
    });
    if (!res.ok) throw await fail(res, 'remove');
  }

  /* ── Публикация своего прогресса ────────────────────────────────────── */
  // Снимок берём у экрана профиля: он уже умеет считать всё это по слотам и
  // достижениям, и второй такой же счётчик тут же с ним разошёлся бы.
  function snapshot() {
    if (!window.Profile || typeof window.Profile.snapshot !== 'function') return null;
    let s;
    try { s = window.Profile.snapshot(); } catch (e) { return null; }
    if (!s) return null;
    const kills = (s.stompKills | 0) + (s.blasterKills | 0)
                + (s.burnKills | 0) + (s.freezeKills | 0);
    const out = {
      levels: s.done | 0, levelsMax: s.total | 0,
      stars: s.stars | 0, starsMax: s.starsMax | 0,
      stars3: s.stars3 | 0,                     // уровней на все три звезды
      crystals: s.shards | 0, crystalsMax: s.shardsMax | 0,
      ach: s.ach | 0, achMax: s.achMax | 0,
      score: s.score | 0,
      playtime: s.playtime | 0,
      // Хардкор без своего максимума читался как голое число («хардкор 103»);
      // уровни в нём те же, поэтому потолок общий с кампанией.
      hardcore: s.doneHard | 0, hardcoreMax: s.total | 0,
      // ── Витрина пошире ────────────────────────────────────────────────
      // Всё это профиль уже считает; раньше наружу уходил только прогресс,
      // и карточка игрока выглядела одинаково у всех, кто дошёл до конца.
      coins: s.coins | 0,                       // собрано монет за всё время
      coinsLevels: s.coinsLevels | 0,           // из них — на уровнях кампании
      bestAdv: s.bestAdv | 0,                   // рекорд в кампании
      bestInf: s.bestInf | 0,                   // рекорд в бесконечном режиме
      bosses: s.bosses | 0, bossesMax: s.bossesMax | 0,
      bossesHard: s.bossesHard | 0,             // те же боссы, но в хардкоре
      worlds: s.worlds | 0, worldsMax: s.worldsMax | 0,
      rainbow: s.rainbow | 0, rainbowMax: 10,   // радужные осколки
      logs: s.logs | 0, logsMax: s.logsMax | 0, // прочитано сюжетного архива
      perfect: s.perfect | 0,                   // идеальных уровней
      streak: s.streak | 0,                     // серия без смертей
      deaths: s.deaths | 0,                     // сколько раз погиб за всё время
      // Боевой почерк: по чему видно, как именно игрок проходит игру.
      kills: kills,
      stompKills: s.stompKills | 0, blasterKills: s.blasterKills | 0,
      burnKills: s.burnKills | 0, freezeKills: s.freezeKills | 0,
      jumps: s.jumps | 0,
    };
    // Секретных выходов в игре давно нет (см. _persistAdvProgress в game.js) —
    // поле уехало бы на сайт вечным нулём и путало бы карточку.
    try {
      if (typeof window.Profile.completion === 'function') {
        const c = window.Profile.completion(s);
        out.completion = +c.toFixed(3);
        // Звание отправляем ключом (rank0…rank6): сайт покажет его на своём
        // языке, а не на том, на котором игрок в тот день играл.
        if (typeof window.Profile.rankKey === 'function') out.rank = window.Profile.rankKey(c);
      }
    } catch (e) { /* без общей доли обойдёмся */ }
    return out;
  }

  /** Отправляет сводку. Молча ничего не делает без входа — это фоновое дело. */
  async function publish() {
    const data = snapshot();
    if (!data) return false;
    try {
      await rpc('publish_game_stats', { p_game_slug: GAME, p_data: data });
      return true;
    } catch (e) { return false; }
  }

  /* ── Приглашения в комнату ──────────────────────────────────────────────
     Позвать можно только друга (проверяет сервер): код комнаты иначе стал бы
     способом рассылать что угодно кому угодно. Источник передаём вместе с
     кодом — гость обязан подключиться туда же, к облаку или к локальной сети,
     иначе код ничего не значит. */
  const invite = (nickname, roomCode, source) => rpc('invite_to_room', {
    p_nickname: nickname, p_game_slug: GAME,
    p_room_code: roomCode, p_source: source === 'local' ? 'local' : 'server',
  });

  /** Непрочитанные приглашения не старше десяти минут (фильтрует представление). */
  async function invites() {
    const auth = await token();
    if (!auth) return [];
    const res = await fetch(
      SUPABASE_URL + '/rest/v1/my_room_invites?select=id,room_code,source,created_at,from_nickname',
      { headers: headers(auth) });
    if (!res.ok) throw await fail(res, 'invites');
    return res.json();
  }

  /** Отмечает приглашение прочитанным, чтобы оно не всплыло второй раз. */
  async function inviteSeen(id) {
    const auth = await token();
    if (!auth) return;
    await fetch(SUPABASE_URL + '/rest/v1/room_invites?id=eq.' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: Object.assign(headers(auth), { Prefer: 'return=minimal' }),
      body: JSON.stringify({ seen_at: new Date().toISOString() }),
    }).catch(() => {});
  }

  /** Объявления студии. Читаются без входа — это рассылка, а не личное. */
  async function announcements() {
    const res = await fetch(
      SUPABASE_URL + '/rest/v1/announcements'
      + '?select=id,title,body,url,game_slug,created_at'
      + '&or=(game_slug.is.null,game_slug.eq.' + GAME + ')'
      + '&order=created_at.desc&limit=5',
      { headers: { apikey: SUPABASE_KEY } });
    if (!res.ok) throw await fail(res, 'announcements');
    return res.json();
  }

  window.Friends = {
    list, search, request, accept, remove, profile, publish, snapshot,
    invite, invites, inviteSeen, announcements,
  };
})();
