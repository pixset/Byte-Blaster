// ===============================================================
//  BYTE BLASTER — УВЕДОМЛЕНИЯ
// ===============================================================
// Один канал на две вещи, потому что для игрока это одно и то же — «пришло
// сообщение»:
//
//   приглашение в комнату — друг зовёт поиграть; нажатие сразу заводит
//                           в его комнату;
//   объявление студии     — рассылка из админки на все устройства, где игра
//                           открыта.
//
// Как доставляется. Отдельного сервиса пушей у студии нет, поэтому игра сама
// спрашивает базу раз в полминуты, пока игрок в меню. Это честно работает
// везде, где игра запущена: в .exe, в браузере и в .apk. Уведомление приходит
// системное (если игрок его разрешил) либо всплывает прямо в игре, если она
// сейчас на экране — показывать системное поверх собственного окна незачем.
//
// Чего эта схема НЕ умеет: разбудить закрытую игру. Для этого нужен Web Push
// с VAPID-ключами и служба доставки (или FCM для Android) — отдельная работа
// с ключами, которых у меня нет.
(function () {
  'use strict';

  const T = (k, ...a) => (typeof window.t === 'function' ? window.t(k, ...a) : k);
  const POLL_MS = 30000;
  const SEEN_KEY = 'bbNotifySeen';     // id объявлений, которые уже показывали

  let timer = 0;
  let started = false;

  /* ── Показ ─────────────────────────────────────────────────────────────
     Всплывашка внутри игры: своя, а не системная, потому что системную поверх
     активного окна игрок всё равно не увидит. Живёт на body — внутри #stage её
     ужал бы transform сцены. */
  function styles() {
    if (document.getElementById('bbNotifyCSS')) return;
    const st = document.createElement('style');
    st.id = 'bbNotifyCSS';
    st.textContent = `
/* Плашка живёт СНАРУЖИ #stage, поэтому меряется через --bbFix, а не --bbText.
   --bbText компенсирует ужатие сцены трансформом; здесь ужимать нечего, и на
   телефоне эта компенсация (около ×2.4) раздувала плашку почти во весь экран.
   zoom:var(--bbUI) убран по той же причине — он множился со всем остальным. */
#bbNotify{position:fixed;left:0;right:0;bottom:0;z-index:10000;display:flex;
  flex-direction:column;align-items:center;gap:calc(7px * var(--bbFix, 1));
  padding:calc(10px * var(--bbFix, 1));pointer-events:none;
  font-family:'Press Start 2P',monospace}
#bbNotify .nt{pointer-events:auto;max-width:min(520px,92vw);background:#06061a;
  border:1px solid #0ff8;box-shadow:0 0 18px #0ff4;border-radius:calc(6px * var(--bbFix, 1));
  padding:calc(10px * var(--bbFix, 1)) calc(12px * var(--bbFix, 1));
  display:flex;align-items:center;gap:calc(10px * var(--bbFix, 1));
  animation:ntIn .28s cubic-bezier(.2,1.3,.4,1) both}
@keyframes ntIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){#bbNotify .nt{animation:none}}
#bbNotify .ntTxt{flex:1 1 auto;min-width:0}
#bbNotify .ntTitle{font-size:calc(9px * var(--bbFix, 1));color:#0ff;letter-spacing:1px;
  text-shadow:0 0 10px #0ff8;overflow-wrap:anywhere}
#bbNotify .ntBody{font-family:'Share Tech Mono',monospace;
  font-size:calc(12px * var(--bbFix, 1));color:#9fd;margin-top:calc(5px * var(--bbFix, 1));
  line-height:1.45;overflow-wrap:anywhere}
/* Кнопка мельче не делается: в неё надо попадать пальцем. */
#bbNotify .ntBtn{flex:0 0 auto;font-family:inherit;font-size:calc(9px * var(--bbFix, 1));
  padding:calc(9px * var(--bbFix, 1)) calc(13px * var(--bbFix, 1));min-height:calc(38px * var(--bbFix, 1));
  cursor:pointer;background:#0a0a20;color:#0ff;border:2px solid #0ff;
  border-radius:4px;letter-spacing:1px}
#bbNotify .ntBtn:hover{background:#0ff2;color:#fff}
#bbNotify .ntX{flex:0 0 auto;background:none;border:none;color:#5a7a9a;cursor:pointer;
  font-family:inherit;font-size:calc(10px * var(--bbFix, 1));padding:calc(6px * var(--bbFix, 1))}
#bbNotify .ntX:hover{color:#fff}`;
    document.head.appendChild(st);
  }

  function host() {
    styles();
    let h = document.getElementById('bbNotify');
    if (!h) { h = document.createElement('div'); h.id = 'bbNotify'; document.body.appendChild(h); }
    return h;
  }

  /**
   * Всплывашка в игре. `action` — подпись кнопки и что делать по нажатию;
   * без неё показывается просто сообщение.
   */
  function toast(title, body, action, ttl) {
    const h = host();
    const el = document.createElement('div');
    el.className = 'nt';
    el.innerHTML =
      '<div class="ntTxt"><div class="ntTitle"></div>' +
      (body ? '<div class="ntBody"></div>' : '') + '</div>' +
      (action ? '<button class="ntBtn"></button>' : '') +
      '<button class="ntX">✕</button>';
    el.querySelector('.ntTitle').textContent = title;
    if (body) el.querySelector('.ntBody').textContent = body;

    let dead = false;
    const close = () => { if (dead) return; dead = true; clearTimeout(t); el.remove(); };
    el.querySelector('.ntX').onclick = close;
    if (action) {
      const b = el.querySelector('.ntBtn');
      b.textContent = action.label;
      b.onclick = () => { close(); try { action.run(); } catch (e) {} };
    }
    h.appendChild(el);
    const t = setTimeout(close, ttl || 20000);
    return close;
  }

  /* ── Системные уведомления ─────────────────────────────────────────────
     Веб-API годится ровно на одной из трёх платформ, поэтому здесь три
     реализации за общим интерфейсом:

       .exe    страница загружена через loadFile, то есть с origin file://.
               Веб-уведомление оттуда до Windows не доходит: конструктор
               отрабатывает без ошибки, а тост не появляется. Показывает
               главный процесс через мост notifyAPI.
       .apk    в Android WebView Notification вообще не реализован —
               window.Notification там undefined. Нужен нативный плагин
               LocalNotifications и разрешение POST_NOTIFICATIONS (Android 13+).
       веб     обычный Notification, разрешение спрашивается по жесту игрока.

     Каждая реализация умеет одно и то же: сказать, поддерживается ли канал,
     вернуть состояние разрешения, спросить его и показать уведомление. */

  const capPlugin = (name) => {
    const C = window.Capacitor;
    return (C && C.Plugins && C.Plugins[name]) || null;
  };

  // Разрешение Android приходит асинхронно, поэтому держим последнее известное.
  let _capPerm = 'default';

  const backends = {
    /* Electron: разрешение не спрашивается — либо система умеет тосты, либо нет. */
    electron: {
      name: 'electron',
      supported: () => !!(window.notifyAPI && window.notifyAPI.show),
      permission: () => 'granted',
      ask: () => Promise.resolve('granted'),
      show(title, body, tag) {
        try { window.notifyAPI.show({ title, body: body || '', tag: tag || '' }); return true; }
        catch (e) { return false; }
      },
    },

    /* Android: спрашиваем через плагин, показываем немедленным «локальным»
       уведомлением. id обязателен и должен быть разным, иначе плагин молча
       перезаписывает предыдущее. */
    capacitor: {
      name: 'capacitor',
      supported: () => !!capPlugin('LocalNotifications'),
      permission: () => _capPerm,
      ask() {
        const p = capPlugin('LocalNotifications');
        if (!p) return Promise.resolve('unsupported');
        return p.requestPermissions()
          .then((r) => (_capPerm = r && r.display === 'granted' ? 'granted' : 'denied'))
          .catch(() => 'denied');
      },
      show(title, body, tag) {
        const p = capPlugin('LocalNotifications');
        if (!p) return false;
        p.schedule({
          notifications: [{
            id: (Date.now() % 2000000000),
            title: title,
            body: body || '',
            extra: { tag: tag || '' },
          }],
        }).catch(() => {});
        return true;
      },
    },

    web: {
      name: 'web',
      supported: () => typeof Notification !== 'undefined',
      permission: () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission),
      ask() {
        if (typeof Notification === 'undefined') return Promise.resolve('unsupported');
        if (Notification.permission !== 'default') return Promise.resolve(Notification.permission);
        try {
          // В старых движках requestPermission принимает колбэк и ничего не
          // возвращает, поэтому промис при необходимости строим сами.
          const r = Notification.requestPermission((p) => p);
          return (r && typeof r.then === 'function')
            ? r
            : new Promise((res) => setTimeout(() => res(Notification.permission), 300));
        } catch (e) { return Promise.resolve('denied'); }
      },
      show(title, body, tag, onClick) {
        try {
          const n = new Notification(title, { body: body || '', icon: 'icons/favicon-32x32.png' });
          n.onclick = () => { try { window.focus(); } catch (e) {} n.close(); if (onClick) onClick(); };
          return true;
        } catch (e) { return false; }
      },
    },
  };

  function backend() {
    if (backends.electron.supported()) return backends.electron;
    if (backends.capacitor.supported()) return backends.capacitor;
    return backends.web;
  }

  function canSystem() {
    const b = backend();
    return b.supported() && b.permission() === 'granted';
  }

  /* Клик по системному уведомлению должен доводить дело до конца, но у
     Electron и Android ответ приходит не в замыкание, а отдельным событием —
     поэтому держим действия по метке. */
  const pending = Object.create(null);
  function remit(tag) {
    const fn = pending[tag];
    delete pending[tag];
    if (fn) { try { fn(); } catch (e) {} }
  }
  if (window.notifyAPI && window.notifyAPI.onClick) window.notifyAPI.onClick(remit);

  /**
   * Системная плашка. По умолчанию — только когда окна игры не видно: поверх
   * активной игры это шум, там уместнее своя всплывашка. `force` нужен кнопке
   * проверки в настройках: там игрок как раз и хочет увидеть её немедленно.
   */
  function system(title, body, onClick, force) {
    if (!canSystem()) return false;
    if (!force && document.visibilityState === 'visible') return false;
    const b = backend();
    const tag = 'n' + Date.now() + Math.random().toString(36).slice(2, 6);
    if (onClick) pending[tag] = onClick;
    const ok = b.show(title, body, tag, onClick);
    if (!ok) delete pending[tag];
    return ok;
  }

  /**
   * Спросить разрешение. Зовём ТОЛЬКО по действию игрока: браузер и система
   * иначе запрос отклоняют, а на некоторых платформах ещё и запоминают отказ.
   * Кнопка живёт в Настройках → Общее.
   */
  function ask() {
    const b = backend();
    if (!b.supported()) return Promise.resolve('unsupported');
    return Promise.resolve(b.ask());
  }

  /** Что игра может показать прямо сейчас — для честной строки в настройках. */
  function permission() {
    const b = backend();
    return b.supported() ? b.permission() : 'unsupported';
  }

  /**
   * Проверка канала по кнопке из настроек. Раньше убедиться, что уведомления
   * живы, было нечем: пока никто не прислал приглашение, игра молчала, и это
   * не отличалось от поломки.
   */
  function test() {
    const title = T('notifyTestTitle');
    const body = T('notifyTestBody');
    const shown = system(title, body, null, true);
    // Системную показать не удалось (запрещены, не поддерживаются) — игрок
    // всё равно должен увидеть ответ на нажатие.
    if (!shown) toast(title, body, null, 8000);
    return shown;
  }

  /** Хочет ли игрок их видеть. Разрешение системы — отдельный вопрос. */
  function wanted() {
    return !(window.gameSettings && window.gameSettings.notifications === false);
  }

  /* ── Приглашение в комнату ─────────────────────────────────────────────
     Нажатие должно заводить в комнату, а не открывать лобби «где-то рядом»:
     код и источник у нас есть, остаётся отдать их сетевому модулю. */
  function joinRoom(code, source) {
    if (!window.NetPlay || typeof window.NetPlay.joinByCode !== 'function') return false;
    try { window.NetPlay.joinByCode(code, source); return true; } catch (e) { return false; }
  }

  function showInvite(inv) {
    const title = T('notifyInviteTitle');
    const body = T('notifyInviteBody', inv.from_nickname, inv.room_code);
    const go = () => joinRoom(inv.room_code, inv.source);
    if (!system(title, body, go)) toast(title, body, { label: T('notifyJoin'), run: go }, 60000);
  }

  function showAnnouncement(a) {
    // Ссылка из уведомления может вести куда угодно, в том числе на чужой
    // сайт. Встроенный браузер сам решит: страницу покажет внутри, файл и
    // сайт, запрещающий встраивание, отдаст системе.
    const go = a.url ? () => {
      if (window.BBBrowser) { window.BBBrowser.open(a.url); return; }
      try {
        if (window.electronAPI && window.electronAPI.openExternal) window.electronAPI.openExternal(a.url);
        else window.open(a.url, '_blank', 'noopener');
      } catch (e) {}
    } : null;
    if (!system(a.title, a.body, go)) {
      toast(a.title, a.body, go ? { label: T('notifyOpen'), run: go } : null, 30000);
    }
  }

  /* ── Опрос ─────────────────────────────────────────────────────────────
     Спрашиваем всегда, а вот показываем — по обстановке. Раньше опрос посреди
     уровня просто не выполнялся, и приглашение висело неувиденным до
     следующего такта уже в меню: друг звал, а игрок узнавал об этом через
     полминуты после выхода. Теперь оно приходит сразу, но ждёт своей очереди:

       играем, окно на экране   — копим и показываем на выходе в меню, чтобы
                                  всплывашка не лезла поверх уровня;
       играем, окно свёрнуто    — показываем системную сразу: игрок всё равно
                                  занят другим, и это именно то, ради чего
                                  уведомления и нужны;
       в меню                   — показываем сразу.

     Тихо переживает отсутствие сети и невыполненную миграцию — это фоновое
     дело, ошибок игроку тут показывать нечего. */
  const queued = [];

  function seenIds() {
    try { const v = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  function remember(id) {
    try {
      const list = seenIds();
      list.push(id);
      localStorage.setItem(SEEN_KEY, JSON.stringify(list.slice(-40)));
    } catch (e) {}
  }

  function inMenu() {
    try { return gState !== 'playing'; } catch (e) { return true; }
  }

  /** Показать сейчас или отложить до возвращения в меню. */
  function deliver(show) {
    if (inMenu() || document.visibilityState !== 'visible') show();
    else queued.push(show);
  }

  /** Вышли в меню — выкладываем всё, что накопилось за уровень. */
  function flush() {
    if (!inMenu()) return;
    while (queued.length) {
      const show = queued.shift();
      try { show(); } catch (e) {}
    }
  }

  async function poll() {
    if (!window.Friends || !wanted()) return;

    try {
      const anns = await window.Friends.announcements();
      const seen = seenIds();
      for (const a of anns) {
        if (seen.indexOf(a.id) >= 0) continue;
        remember(a.id);
        deliver(() => showAnnouncement(a));
      }
    } catch (e) { /* нет сети или миграция не применена */ }

    if (!(window.License && window.License.loggedIn())) return;
    try {
      const invs = await window.Friends.invites();
      for (const inv of invs) {
        window.Friends.inviteSeen(inv.id);
        deliver(() => showInvite(inv));
      }
    } catch (e) { /* то же самое */ }
  }

  /* Android отдаёт нажатие по уведомлению отдельным событием плагина, а не
     колбэком, и разрешение тоже надо спросить у системы — до этого мы не знаем,
     что показывать в строке состояния. */
  function initCapacitor() {
    const p = capPlugin('LocalNotifications');
    if (!p) return;
    if (p.checkPermissions) {
      p.checkPermissions()
        .then((r) => {
          _capPerm = r && r.display === 'granted' ? 'granted'
            : r && r.display === 'denied' ? 'denied' : 'default';
          if (typeof window._syncNotifyRow === 'function') window._syncNotifyRow();
        })
        .catch(() => {});
    }
    if (p.addListener) {
      p.addListener('localNotificationActionPerformed', (ev) => {
        const extra = ev && ev.notification && ev.notification.extra;
        if (extra && extra.tag) remit(extra.tag);
      });
    }
  }

  function start() {
    if (started) return;
    started = true;
    initCapacitor();
    // Первый опрос с задержкой: на старте и без него хватает работы.
    setTimeout(poll, 6000);
    timer = setInterval(poll, POLL_MS);
    // Вернулись к игре из другого окна — проверим сразу, не дожидаясь такта.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') { flush(); poll(); }
    });
    // Отдельного события «вышли в меню» в игре нет, а ждать общего такта —
    // это до полуминуты тишины после уровня. Проверка дешёвая: сравнение
    // строки и длины массива, только когда есть что показывать.
    setInterval(() => { if (queued.length) flush(); }, 1000);
  }

  window.Notify = {
    start, poll, toast, ask, canSystem, joinRoom, wanted, test, permission, flush,
    backend: () => backend().name,
    pending: () => queued.length,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else { start(); }
})();
