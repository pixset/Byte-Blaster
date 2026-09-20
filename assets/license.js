// Pixset License SDK — проверка лицензии в играх студии.
// Подключается как обычный <script> в Byte Blaster, Hearthhold и далее.
//
// Главный принцип: игра запускается БЕЗ интернета. Токен подписан ключом
// сервера, подпись проверяется локально через Web Crypto. Сеть нужна только
// чтобы продлить срок действия токена.
//
// Никаких внешних зависимостей: supabase-js тянется с CDN и в офлайне
// (Electron, Android в самолётном режиме) просто не загрузился бы.
(function () {
  'use strict';

  const SUPABASE_URL = 'https://zyjhvuhovimorpokiwty.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_1bj04J3qsO1EqsKPQeSbmg_cBDEtreK';

  // Публичный ключ подписи (SPKI, base64). Приватная половина — только на сервере.
  const PUBLIC_KEY_SPKI = 'MCowBQYDK2VwAyEA6Ikvs6jnDH38jJwUe1zxdwxArzAgryXd8PRdtkabJHw=';

  // Сколько дней играем после истечения токена, если сеть недоступна.
  // Упавший сервер не должен ломать честно купленную игру, поэтому запас
  // щедрый: вместе с трёхмесячным сроком токена это четыре месяца офлайна.
  const OFFLINE_GRACE_DAYS = 30;

  const K_TOKEN   = 'pixset.license';
  const K_SESSION = 'pixset.session';
  const K_CLOCK   = 'pixset.clock';
  const K_DEVICE  = 'pixset.device';
  const K_AVATAR  = 'pixset.avatar';
  // Сколько раз подряд сервер отказался обновлять сессию. Одного отказа мало,
  // чтобы выкидывать игрока, — см. _doRefresh.
  const K_AUTHFAIL = 'pixset.authfail';

  const dec = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  /* ── Хранилище ─────────────────────────────────────────────────────────
     По умолчанию localStorage. Оболочка может подменить на защищённое
     (Electron safeStorage, Capacitor Preferences) через License.setStorage. */
  let store = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
    remove: (k) => { try { localStorage.removeItem(k); } catch (e) {} },
  };

  /* ── Часы ──────────────────────────────────────────────────────────────
     Игрок может отмотать системное время назад, чтобы «оживить» истёкший
     токен. Запоминаем максимальное виденное время и не верим меньшему. */
  function now() {
    const sys = Math.floor(Date.now() / 1000);
    const seen = parseInt(store.get(K_CLOCK) || '0', 10);
    if (sys > seen) { store.set(K_CLOCK, String(sys)); return sys; }
    return seen;
  }

  /**
   * Убирает права, у которых вышел СВОЙ срок (`valid_until` — доступ по
   * промокоду на N дней).
   *
   * Офлайн-запас придуман для купленной игры: лежащий сервер не должен
   * отнимать её у игрока. Но к временному доступу тот же запас — подарок:
   * недельный код работал бы больше месяца, стоило просто не выходить в сеть.
   * Поэтому запас растягивает только бессрочные лицензии, а срочные кончаются
   * ровно тогда, когда написано в токене.
   *
   * Битую дату трактуем в пользу игрока: отнимать доступ из-за неразобранной
   * строки нельзя.
   */
  function dropExpired(payload) {
    if (!payload || !Array.isArray(payload.licences)) return payload;

    const t = now();
    const dead = payload.licences
      .filter((l) => {
        if (!l || !l.valid_until) return false;         // навсегда
        const till = Math.floor(Date.parse(l.valid_until) / 1000);
        return Number.isFinite(till) && till <= t;
      })
      .map((l) => l.game);

    if (!dead.length) return payload;

    const alive = Object.assign({}, payload);
    alive.games = (payload.games || []).filter((g) => dead.indexOf(g) === -1);
    alive.licences = payload.licences.filter((l) => dead.indexOf(l.game) === -1);
    return alive;
  }

  /* ── Подпись ───────────────────────────────────────────────────────── */
  let keyPromise = null;
  function publicKey() {
    if (!keyPromise) {
      keyPromise = crypto.subtle.importKey(
        'spki', dec(PUBLIC_KEY_SPKI), { name: 'Ed25519' }, false, ['verify'],
      );
    }
    return keyPromise;
  }

  async function verify(token) {
    if (!token || !token.payload || !token.signature) return null;
    try {
      const bytes = dec(token.payload);
      const ok = await crypto.subtle.verify(
        'Ed25519', await publicKey(), dec(token.signature), bytes,
      );
      if (!ok) return null;
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
      return null;   // битый токен или среда без Ed25519
    }
  }

  /* ── Состояние ─────────────────────────────────────────────────────── */
  let ent = null;       // проверенный payload или null
  // Последний ПОДЛИННЫЙ payload, даже если срок вышел совсем. Права он уже не
  // даёт, но помнит, кто вошёл: без него игрок, надолго оставшийся без сети,
  // видел бы вместо своего ника надпись «Аккаунт» — как будто его выкинуло.
  let lastKnown = null;
  let ready = false;    // init уже отработал
  // Почему в последний раз не удалось получить права. Нужен, чтобы игра
  // говорила «сервер недоступен» вместо «нет лицензии» — это разные вещи.
  let lastError = null;

  function readJSON(key) {
    const raw = store.get(key);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  /** Загружает локальный токен и проверяет подпись. Вызывать на старте игры. */
  async function init() {
    const token = readJSON(K_TOKEN);
    ent = null;

    if (token) {
      const payload = await verify(token);
      if (!payload) {
        store.remove(K_TOKEN);           // подделан или повреждён
      } else {
        // Подпись верна — значит это точно наш игрок, даже если срок вышел.
        // Токен НЕ удаляем: без сети его нечем заменить, а выбросив его, мы
        // потеряли бы и имя, и аватарку, и саму память о входе.
        lastKnown = payload;
        if (now() <= payload.expires_at + OFFLINE_GRACE_DAYS * 86400) ent = dropExpired(payload);
      }
    }

    ready = true;
    return ent;
  }

  /* ── Запросы к серверу ─────────────────────────────────────────────── */
  function authFetch(path, body, token) {
    const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_KEY };
    if (token) headers.Authorization = 'Bearer ' + token;
    return fetch(SUPABASE_URL + path, {
      method: 'POST', headers, body: JSON.stringify(body),
    });
  }

  /**
   * Записывает сессию, дополнив её сроком годности.
   *
   * REST-ответ GoTrue гарантирует только `expires_in` (секунды): `expires_at`
   * досчитывает клиентская библиотека, а мы ходим в API напрямую. Без него
   * проверка «токен ещё жив» ниже всегда давала false, и игра обновляла токен
   * при КАЖДОМ обращении — а раз refresh-токены одноразовые, лишние обновления
   * гарантированно приводили к отказу «Already Used».
   */
  function saveSession(data) {
    if (!data || !data.access_token) return null;
    if (!data.expires_at) {
      const life = Number(data.expires_in) || 3600;
      data.expires_at = Math.floor(Date.now() / 1000) + life;
    }
    store.set(K_SESSION, JSON.stringify(data));
    store.remove(K_AUTHFAIL);   // обновились — прошлый отказ больше не в счёт
    return data;
  }

  /* Вход по почте ИЛИ по нику.
     Почту многие заводят «для регистрации» и назавтра не помнят, а ник виден в
     игре каждый день. Ник в почту меняет серверная функция login-nick: отдавать
     наружу пару «ник → почта» нельзя — список ников публичный, и это раздавало
     бы чужие адреса. Сюда возвращается уже готовая сессия. */
  async function login(login, password) {
    const id = String(login || '').trim();
    const path = id.includes('@')
      ? '/auth/v1/token?grant_type=password'
      : '/functions/v1/login-nick';
    const body = id.includes('@') ? { email: id, password } : { login: id, password };

    const res = await authFetch(path, body);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      const e = new Error(data.error_description || data.msg || data.message || 'login_failed');
      e.code = data.error_code || data.error;
      throw e;
    }
    saveSession(data);
    return refresh();
  }

  function logout() {
    store.remove(K_SESSION);
    store.remove(K_TOKEN);
    store.remove(K_AVATAR);   // чужое лицо на кнопке после выхода — недопустимо
    ent = null;
    lastKnown = null;         // вышел по-настоящему — забываем и имя
  }

  function session() { return readJSON(K_SESSION); }
  function loggedIn() { return !!session(); }
  /** id игрока в базе. Нужен там, где запрос фильтруется по обеим сторонам
      пары (друзья): без него пришлось бы полагаться только на политику RLS. */
  function userId() { const s = session(); return (s && s.user && s.user.id) || null; }

  /* ── Обновление сессии ──────────────────────────────────────────────────
     Здесь игрока выкидывало из аккаунта при каждом перезапуске: ник и лицензия
     оставались (они в подписанном токене), а сессия исчезала, и игра снова
     просила почту с паролем. Причин было три, и все три ниже закрыты.

       1. Срок сессии не досчитывался (см. saveSession) — обновление шло на
          каждый чих.
       2. Обновления не были одиночными: старт игры, экран аккаунта и облачные
          сохранения могли одновременно отправить ОДИН И ТОТ ЖЕ refresh-токен.
          Он одноразовый: первый запрос выдавал новую сессию, второй получал
          «Already Used» — и стирал только что выданную. Теперь параллельные
          вызовы ждут один общий запрос.
       3. Сессия удалялась при ЛЮБОМ неуспешном ответе. Упавший сервер,
          лимит запросов, страница-заглушка провайдера — и честный вход
          потерян навсегда. Теперь удаляем, только когда сервер прямо говорит,
          что токен недействителен. */
  let _refreshing = null;   // общий запрос обновления для всех, кто ждёт

  /** Ответ, после которого сессию действительно надо забыть. */
  function _tokenRejected(status, body) {
    if (status !== 400 && status !== 401 && status !== 403) return false;
    const msg = String((body && (body.error_description || body.msg || body.message || body.error)) || '')
      .toLowerCase();
    // «Already Used» — это гонка запросов, а не потерянный вход: в хранилище
    // уже лежит сессия, которую выдал победивший запрос.
    if (msg.includes('already used')) return false;
    return true;
  }

  async function _doRefresh(refreshToken) {
    const res = await authFetch('/auth/v1/token?grant_type=refresh_token',
      { refresh_token: refreshToken });
    const data = await res.json().catch(() => null);

    if (!res.ok) {
      if (_tokenRejected(res.status, data)) {
        /* Отказ бывает и по нашей вине. Токен обновления одноразовый: если игру
           закрыли ровно между «получили новый» и «записали на диск» (а именно
           так закрывает игру установщик обновления), то на диске остаётся уже
           потраченный — и сервер честно его не признаёт. Выходить из аккаунта с
           первого раза за это слишком жестоко: даём вторую попытку в следующий
           запуск и только после неё забываем вход. */
        const strikes = (parseInt(store.get(K_AUTHFAIL) || '0', 10) || 0) + 1;
        if (strikes < 2) {
          store.set(K_AUTHFAIL, String(strikes));
          lastError = 'auth_retry';
          return null;
        }
        store.remove(K_AUTHFAIL);
        store.remove(K_SESSION);
        return null;
      }
      // Временная беда — вход сохраняем и попробуем в следующий раз.
      lastError = 'auth_' + res.status;
      const now = session();
      // Пока мы ходили в сеть, параллельный запрос мог обновить сессию.
      return (now && now.refresh_token !== refreshToken) ? now.access_token : null;
    }
    const saved = saveSession(data);
    return saved ? saved.access_token : null;
  }

  /** Обновляет access_token, если он протух. */
  async function accessToken() {
    const s = session();
    if (!s) return null;
    const alive = s.expires_at && s.expires_at - 60 > Math.floor(Date.now() / 1000);
    if (alive) return s.access_token;

    if (_refreshing) return _refreshing;
    _refreshing = _doRefresh(s.refresh_token)
      .catch(() => null)                       // нет сети — вход остаётся
      .finally(() => { _refreshing = null; });
    return _refreshing;
  }

  /**
   * Забирает свежий подписанный токен прав и сохраняет его.
   * Вызывать в фоне при старте: у активного игрока срок никогда не истечёт.
   */
  async function refresh() {
    const token = await accessToken();
    if (!token) return null;

    const res = await authFetch('/functions/v1/entitlements', {
      device_hash: deviceId(),
      platform: platform(),
      label: label(),
    }, token);
    if (!res.ok) {
      // 503 — ключ подписи на сервере настроен неверно. Это наша поломка:
      // лицензия у игрока есть, просто выдать её сейчас не можем.
      lastError = res.status === 503 ? 'server_unavailable' : 'entitlements_' + res.status;
      throw new Error(lastError);
    }

    const signed = await res.json();
    const payload = await verify(signed);
    if (!payload) throw new Error('bad_signature');

    store.set(K_TOKEN, JSON.stringify(signed));
    // Свежий токен истёкших лицензий не содержит — сервер их уже отсеял.
    // Фильтр всё равно применяем: игра может стоять открытой сутками, и на
    // долгой сессии срок способен выйти между двумя обновлениями.
    ent = dropExpired(payload);
    lastKnown = payload;
    ready = true;
    lastError = null;
    return payload;
  }

  /** Тихое обновление: нет сети — молча живём на локальном токене. */
  async function refreshQuietly() {
    try { return await refresh(); } catch (e) { return null; }
  }

  /* ── Ответы игре ───────────────────────────────────────────────────── */
  // ПРАВА даёт только действующий токен: растягивать их бесконечно нельзя,
  // иначе лицензия перестаёт что-либо значить.
  function hasGame(slug) {
    return !!(ent && ent.games && ent.games.indexOf(slug) !== -1);
  }
  /** Токен ещё в силе, но пора обновиться — повод для мягкого предупреждения. */
  function stale() { return !!ent && now() > ent.expires_at; }

  // А вот КТО ВОШЁЛ — берём и из просроченного токена. Отсутствие сети не
  // повод показывать игроку чужой безымянный интерфейс.
  function who() { return ent || lastKnown; }
  /** Данные показываются, но срок вышел: сеть недоступна дольше запаса. */
  function offlineStale() { return !ent && !!lastKnown; }

  function nickname() { const w = who(); return w && w.nickname ? w.nickname : null; }
  function email() {
    const w = who();
    if (w && w.email) return w.email;
    const s = session();
    return (s && s.user && s.user.email) || null;
  }
  function problem() { return lastError; }
  function isReady() { return ready; }

  /* ── Аватарка аккаунта ──────────────────────────────────────────────────
     Картинка хранится в profiles.avatar_url как data-URL — так же, как на
     сайте студии. В подписанный токен она намеренно не входит: это до 64 КБ,
     а токен ездит с каждым запросом и проверяется на каждом старте.

     Поэтому аватарка приезжает отдельным запросом и кешируется. Игра рисует
     кеш: она обязана показывать аккаунт и в самолётном режиме, а картинка —
     ровно тот случай, когда «слегка устаревшая» лучше, чем «никакой». */
  function accountAvatar() { return store.get(K_AVATAR) || null; }
  async function fetchAccountAvatar() {
    const uid = userId();
    if (!uid) return null;
    const token = await accessToken();
    if (!token) return accountAvatar();
    try {
      const res = await fetch(
        SUPABASE_URL + '/rest/v1/profiles?select=avatar_url&id=eq.' + encodeURIComponent(uid),
        { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + token } });
      if (!res.ok) return accountAvatar();   // сервер молчит — оставляем кеш
      const rows = await res.json();
      const url = rows && rows[0] ? rows[0].avatar_url : null;
      if (url) store.set(K_AVATAR, url);
      else store.remove(K_AVATAR);           // аватарку сняли на сайте
      return url || null;
    } catch (e) {
      return accountAvatar();                // нет сети — тоже кеш
    }
  }

  /* ── Данные для карточки профиля ───────────────────────────────────────
     Всё это приезжает внутри подписанного токена, поэтому профиль в игре
     полностью виден и без интернета. */
  // Карточка профиля — это тоже «кто вошёл», а не права: без сети она должна
  // показывать последние известные данные, а не пустые прочерки.
  function memberSince() { const w = who(); return (w && w.member_since) || null; }
  function country() { const w = who(); return (w && w.country) || null; }
  function deviceCount() { const w = who(); return w && typeof w.devices === 'number' ? w.devices : null; }
  function expiresAt() { const w = who(); return w && w.expires_at ? w.expires_at : null; }
  /** Подробности по конкретной игре: когда выдана лицензия и откуда. */
  function licence(slug) {
    if (!ent || !Array.isArray(ent.licences)) return null;
    return ent.licences.find((l) => l && l.game === slug) || null;
  }

  /**
   * Смена ника прямо из игры — он виден другим игрокам в сети, поэтому
   * менять его удобнее там, где играют, а не только на сайте.
   * Ограничение «раз в сутки» проверяет сервер.
   */
  async function setNickname(nickname) {
    const token = await accessToken();
    if (!token) throw new Error('not_logged_in');

    const res = await authFetch('/rest/v1/rpc/update_nickname', { p_nickname: nickname }, token);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const e = new Error((data && (data.message || data.hint)) || 'nickname_failed');
      e.code = data && data.message ? String(data.message) : '';
      throw e;
    }
    // Ник лежит в подписанном токене — перевыпускаем, иначе игра до суток
    // показывала бы старое имя.
    await refreshQuietly();
    return data;
  }

  /* ── Вспомогательное ───────────────────────────────────────────────── */
  function platform() {
    // По userAgent судить нельзя: строка с «Electron» встречается и у обычных
    // браузеров на его основе, и тогда веб-сборка выдаёт себя за настольную.
    // Надёжный признак нашей сборки — мост, который выставляет preload.
    if (typeof window !== 'undefined') {
      if (window.electronAPI && typeof window.electronAPI.quit === 'function') return 'windows';
      if (window.Capacitor) return 'android';
    }
    const ua = navigator.userAgent || '';
    if (/Android/i.test(ua)) return 'android';
    return 'web';
  }
  /**
   * Как устройство называется в списке «Устройства» на сайте.
   *
   * «PC (Windows)» ни о чём не говорит, когда таких строк несколько: непонятно,
   * какую отвязывать. Поэтому пишем то, что реально отличает устройства друг от
   * друга — модель телефона, название браузера, версию системы.
   */
  function label() {
    const ua = navigator.userAgent || '';
    const p = platform();

    if (p === 'android') {
      // Строка вида «Linux; Android 13; SM-A536E Build/…» — из неё берём
      // версию системы и модель. Модель у Xiaomi/Samsung уникальна, этого
      // достаточно, чтобы узнать свой телефон в списке.
      const ver = (/Android\s+([\d.]+)/.exec(ua) || [])[1];
      let model = (/Android[^;)]*;\s*([^;)]+?)(?:\s+Build\/|\)|;)/.exec(ua) || [])[1] || '';
      model = model.replace(/\s*(wv|Mobile|Tablet)\s*$/i, '').trim();
      const parts = [model || 'Android'];
      if (ver) parts.push('Android ' + ver);
      return parts.join(' · ');
    }

    if (p === 'windows') {
      // Наша сборка для ПК. Версию Windows из userAgent не узнать (там всегда
      // «Windows NT 10.0» и для 10, и для 11), поэтому не выдумываем.
      const arch = /WOW64|Win64|x64/i.test(ua) ? '64-бит' : '';
      return ['Приложение · Windows', arch].filter(Boolean).join(' · ');
    }

    return browserName(ua) + ' · ' + osName(ua);
  }

  /** Название и версия браузера. Порядок важен: все они притворяются Chrome. */
  function browserName(ua) {
    const rules = [
      [/YaBrowser\/([\d.]+)/, 'Яндекс.Браузер'],
      [/Edg(?:A|iOS)?\/([\d.]+)/, 'Edge'],
      [/OPR\/([\d.]+)/, 'Opera'],
      [/SamsungBrowser\/([\d.]+)/, 'Samsung Internet'],
      [/Vivaldi\/([\d.]+)/, 'Vivaldi'],
      [/Firefox\/([\d.]+)/, 'Firefox'],
      [/CriOS\/([\d.]+)/, 'Chrome'],
      [/Chrome\/([\d.]+)/, 'Chrome'],
      [/Version\/([\d.]+).*Safari/, 'Safari'],
    ];
    for (const [re, name] of rules) {
      const m = re.exec(ua);
      if (m) return name + ' ' + String(m[1]).split('.')[0];
    }
    return 'Браузер';
  }

  /** Система, на которой открыт браузер. */
  function osName(ua) {
    if (/Windows NT 10/.test(ua)) return 'Windows 10/11';
    if (/Windows NT/.test(ua)) return 'Windows';
    if (/Android\s+([\d.]+)/.test(ua)) return 'Android ' + RegExp.$1;
    if (/(iPhone|iPad|iPod)/.test(ua)) {
      const v = (/OS (\d+)[._]/.exec(ua) || [])[1];
      return (/iPad/.test(ua) ? 'iPad' : 'iPhone') + (v ? ' · iOS ' + v : '');
    }
    if (/Mac OS X/.test(ua)) return 'macOS';
    if (/CrOS/.test(ua)) return 'ChromeOS';
    if (/Linux/.test(ua)) return 'Linux';
    return 'неизвестная система';
  }
  /** Анонимный отпечаток. Никаких аппаратных идентификаторов. */
  function deviceId() {
    let id = store.get(K_DEVICE);
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID()
                              : String(Date.now()) + Math.random().toString(16).slice(2));
      store.set(K_DEVICE, id);
    }
    return id;
  }

  window.License = {
    init, login, logout, refresh, refreshQuietly,
    hasGame, stale, nickname, email, problem, loggedIn, isReady, userId,
    memberSince, country, deviceCount, expiresAt, licence, setNickname,
    accountAvatar, fetchAccountAvatar, offlineStale,
    platformLabel: label,
    // Нужен модулю облачных сохранений: он ходит в базу от имени игрока,
    // а продление просроченного токена — забота этого SDK.
    accessToken,
    setStorage(adapter) { store = adapter; },
    get storeUrl() { return 'https://pixset-studio.github.io/byte-blaster/buy/'; },
  };
})();
