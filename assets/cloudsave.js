// ===============================================================
//  BYTE BLASTER — СОХРАНЕНИЯ В АККАУНТЕ
// ===============================================================
// Прогресс живёт в localStorage: у браузера, .exe и телефона он свой. Этот
// модуль умеет положить его в аккаунт и забрать обратно — так игра продолжается
// на другом устройстве.
//
// Решение всегда за игроком: по умолчанию ничего никуда не уходит, и даже
// загрузка из облака спрашивает подтверждение, потому что затирает текущий
// прогресс. Автосохранение включается отдельно и работает тихо.
(function () {
  'use strict';

  const SUPABASE_URL = 'https://zyjhvuhovimorpokiwty.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_1bj04J3qsO1EqsKPQeSbmg_cBDEtreK';
  const GAME = 'byte-blaster';

  const AUTO_KEY = 'bbCloudAuto';     // включено ли автосохранение
  const SEEN_KEY = 'bbCloudSeen';     // отметка последней синхронизации
  const AUTO_DELAY_MS = 20000;        // копим изменения, а не шлём каждое

  // Что уезжает в облако: прогресс, слоты, достижения, профиль.
  // Всё, что игра держит под своим префиксом, кроме служебных отметок —
  // они привязаны к устройству и на другом только помешают.
  const SKIP = new Set([
    'bbCloudAuto', 'bbCloudSeen',       // сам механизм синхронизации
    'bbUpdateCheck', 'bbUpdateSkip',    // когда проверяли обновление
    'bbLaunchSent',                     // отметка телеметрии запуска
    'bbNetLanHost', 'bb_net_lanhost',   // адрес в локальной сети
  ]);

  const SETTINGS_KEY = 'bbSettings';

  /* ── Настройки: что принадлежит устройству, а что игроку ────────────────
     Раньше bbSettings уезжал в облако целиком, и загрузка сохранения на
     телефоне привозила туда разрешение окна, режим окна, тир графики и
     раскладку клавиатуры с ПК — экранные кнопки пропадали, качество прыгало,
     масштаб ломался. Теперь ключи настроек делятся на две части:

       • DEVICE_SETTINGS — привязаны к железу и экрану. Никогда не уезжают в
         облако и никогда не перезаписываются загрузкой.
       • всё остальное (язык, катсцены, громкость, тряска, подсказки…) —
         предпочтения игрока, они как раз и должны переезжать. */
  const DEVICE_SETTINGS = new Set([
    // экран и окно
    'resolution', 'customResolution', 'gameScale', 'mobileZoom', 'windowMode',
    'textScale',
    // производительность
    'graphicsQuality', 'gfx', 'particles', 'fpsLimit', 'showFPS', 'vsync',
    'adaptiveQuality',
    // управление
    'controls',
    'touchControls', 'touchStyle', 'touchArrowsSplit', 'touchJoyFloat',
    'touchLayout', 'touchScale', 'touchScales',
  ]);

  function isOurs(key) {
    if (!/^bb/.test(key)) return false;
    if (SKIP.has(key)) return false;
    if (/_corrupt$/.test(key)) return false;   // спасённые битые данные
    return true;
  }

  function parseSettings(raw) {
    try {
      const o = JSON.parse(raw);
      return (o && typeof o === 'object' && !Array.isArray(o)) ? o : null;
    } catch (e) { return null; }
  }

  /** Настройки без всего, что относится к конкретному устройству. */
  function portableSettings(raw) {
    const o = parseSettings(raw);
    if (!o) return null;
    const out = {};
    for (const k in o) if (!DEVICE_SETTINGS.has(k)) out[k] = o[k];
    return out;
  }

  /**
   * Настройки этого устройства + предпочтения из облака.
   * Локальные значения экрана, графики и управления остаются нетронутыми,
   * даже если в сохранении они есть (старые сохранения полны ими).
   */
  function mergeSettings(localRaw, cloudRaw) {
    const cloud = parseSettings(cloudRaw);
    if (!cloud) return null;                    // нечего накладывать
    const local = parseSettings(localRaw) || {};
    const merged = Object.assign({}, local);
    for (const k in cloud) if (!DEVICE_SETTINGS.has(k)) merged[k] = cloud[k];
    // Ключи устройства берём строго местные — включая те, которых тут ещё нет.
    DEVICE_SETTINGS.forEach((k) => {
      if (k in local) merged[k] = local[k];
      else delete merged[k];
    });
    return JSON.stringify(merged);
  }

  /** Слепок прогресса с этого устройства. */
  function collect() {
    const blob = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!isOurs(k)) continue;
      if (k === SETTINGS_KEY) {
        const p = portableSettings(localStorage.getItem(k));
        if (p) blob[k] = JSON.stringify(p);
        continue;
      }
      blob[k] = localStorage.getItem(k);
    }
    return blob;
  }

  /** Разворачивает слепок обратно в localStorage. */
  function apply(blob) {
    if (!blob || typeof blob !== 'object') return 0;
    let n = 0;
    // Сначала убираем то, чего в сохранении нет: иначе пройденные уровни с
    // этого устройства «просочились» бы в загруженный прогресс. Настройки —
    // исключение: их отсутствие в облаке не повод обнулять местные.
    const stale = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (isOurs(k) && k !== SETTINGS_KEY && !(k in blob)) stale.push(k);
    }
    stale.forEach((k) => { try { localStorage.removeItem(k); } catch (e) {} });

    for (const k in blob) {
      if (!isOurs(k)) continue;
      try {
        if (k === SETTINGS_KEY) {
          const merged = mergeSettings(localStorage.getItem(k), blob[k]);
          if (merged === null) continue;        // в облаке мусор — не трогаем
          localStorage.setItem(k, merged);
        } else {
          localStorage.setItem(k, blob[k]);
        }
        n++;
      } catch (e) {}
    }
    return n;
  }

  /* ── Сеть ──────────────────────────────────────────────────────────── */
  async function token() {
    if (!window.License || !window.License.loggedIn()) return null;
    // License сам обновит просроченный токен доступа.
    return window.License.accessToken ? window.License.accessToken() : null;
  }

  function headers(auth) {
    return {
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + auth,
      'Content-Type': 'application/json',
    };
  }

  function deviceName() {
    try {
      return (window.License && window.License.platformLabel && window.License.platformLabel())
        || 'устройство';
    } catch (e) { return 'устройство'; }
  }

  /**
   * Разбирает отказ сервера. Раньше любая ошибка превращалась в «нет связи»,
   * и настоящая причина (например, отказ базы) оставалась невидимой.
   */
  async function fail(res, what) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body.message || body.error || body.hint || '';
    } catch (e) { /* тело не JSON — обойдёмся кодом */ }

    console.error('CloudSave ' + what + ': ' + res.status + ' ' + detail);
    const err = new Error(what + '_' + res.status);
    err.status = res.status;
    err.detail = detail;
    return err;
  }

  /** Кладёт прогресс в аккаунт. Возвращает время сохранения. */
  async function save() {
    const auth = await token();
    if (!auth) throw new Error('not_logged_in');

    const body = {
      game_slug: GAME,
      data: collect(),
      device: deviceName(),
    };

    const res = await fetch(SUPABASE_URL + '/rest/v1/cloud_saves?on_conflict=user_id,game_slug', {
      method: 'POST',
      headers: Object.assign(headers(auth), {
        Prefer: 'resolution=merge-duplicates,return=representation',
      }),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await fail(res, 'save');

    const rows = await res.json().catch(() => []);
    const when = (rows && rows[0] && rows[0].updated_at) || new Date().toISOString();
    try { localStorage.setItem(SEEN_KEY, when); } catch (e) {}

    // Заодно обновляем публичную сводку для друзей. Она открыта всем, а само
    // сохранение приватно — поэтому это отдельная запись, а не часть блоба.
    // Ошибку глушим: витрина не должна ронять сохранение прогресса.
    try { if (window.Friends && window.Friends.publish) window.Friends.publish(); } catch (e) {}

    return when;
  }

  /** Что лежит в аккаунте: null, если сохранения ещё нет. */
  async function peek() {
    const auth = await token();
    if (!auth) throw new Error('not_logged_in');

    const res = await fetch(
      SUPABASE_URL + '/rest/v1/cloud_saves?game_slug=eq.' + GAME
      + '&select=updated_at,device', { headers: headers(auth) });
    if (!res.ok) throw await fail(res, 'peek');

    const rows = await res.json();
    return (rows && rows[0]) || null;
  }

  /**
   * Забирает прогресс из аккаунта и заменяет им местный.
   * Вызывающий обязан спросить игрока: для этого устройства действие
   * необратимо — прежний прогресс пропадёт.
   */
  async function load() {
    const auth = await token();
    if (!auth) throw new Error('not_logged_in');

    const res = await fetch(
      SUPABASE_URL + '/rest/v1/cloud_saves?game_slug=eq.' + GAME
      + '&select=data,updated_at', { headers: headers(auth) });
    if (!res.ok) throw await fail(res, 'load');

    const rows = await res.json();
    if (!rows || !rows.length) return null;

    apply(rows[0].data);
    try { localStorage.setItem(SEEN_KEY, rows[0].updated_at); } catch (e) {}
    return rows[0].updated_at;
  }

  /* ── Автосохранение ────────────────────────────────────────────────── */
  let timer = null;
  let hooked = false;

  function autoOn() {
    try { return localStorage.getItem(AUTO_KEY) === '1'; } catch (e) { return false; }
  }

  function setAuto(on) {
    try { localStorage.setItem(AUTO_KEY, on ? '1' : '0'); } catch (e) {}
    if (on) hook(); else clearTimeout(timer);
  }

  /**
   * Ловим запись прогресса и через паузу отправляем слепок. Пауза нужна, чтобы
   * пройденный уровень не превращался в десяток запросов подряд.
   */
  function hook() {
    if (hooked) return;
    hooked = true;

    const original = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function (k, v) {
      original(k, v);
      if (!autoOn() || !isOurs(k)) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        save().catch(() => { /* нет сети — попробуем в следующий раз */ });
      }, AUTO_DELAY_MS);
    };

    // Уход из игры — последний шанс сохранить накопленное.
    window.addEventListener('pagehide', () => {
      if (!autoOn()) return;
      clearTimeout(timer);
      save().catch(() => {});
    });
  }

  if (autoOn()) hook();

  window.CloudSave = {
    save, load, peek, collect, apply,
    autoEnabled: autoOn,
    setAuto,
    lastSeen() { try { return localStorage.getItem(SEEN_KEY); } catch (e) { return null; } },
  };
})();
