// ===============================================================
//  BYTE BLASTER — ВСТРОЕННЫЙ БРАУЗЕР
// ===============================================================
// Раньше любая ссылка выкидывала игрока наружу: в .exe открывался системный
// браузер поверх игры, на телефоне — приложение браузера, в вебе — новая
// вкладка. Магазин, кабинет и вики живут на нашем же сайте, и ради них уходить
// из игры незачем — теперь они открываются прямо поверх меню.
//
// Единственная точка входа: window.BBBrowser.open(url). Остальные модули
// (магазин, аккаунт, уведомления, обновления) зовут только её.
//
// Чего встроенный браузер НЕ делает и почему:
//   • файлы (.exe, .apk, .zip) — их отдаём системе: скачивание внутри iframe
//     либо не начнётся вовсе, либо уедет в невидимую папку;
//   • чужие сайты, запрещающие встраивание, — такие просто не отрисуются,
//     поэтому окно всегда показывает кнопку «Открыть в браузере», а если
//     страница молчит несколько секунд, подсказывает ею воспользоваться.
(function () {
  'use strict';

  const T = (k, ...a) => (typeof window.t === 'function' ? window.t(k, ...a) : k);

  // Файлы, которые заведомо не страница, а загрузка.
  const FILE_RE = /\.(exe|apk|zip|7z|rar|dmg|pkg|msi|appimage|tar|gz|iso)(\?|#|$)/i;

  let ov = null, frame = null, stylesDone = false;
  let waitTimer = 0;
  let current = '';

  function ensureStyles() {
    if (stylesDone) return;
    stylesDone = true;
    const css = document.createElement('style');
    css.textContent = `
      /* z-index выше экрана аккаунта (70) и выбора слотов (2500): браузер
         открывают ИЗ них, и он должен ложиться сверху, а не под. */
      #bbWeb{position:fixed;inset:0;z-index:3000;display:none;
        flex-direction:column;background:#04040f}
      #bbWeb .wbBar{display:flex;align-items:center;gap:8px;padding:8px 10px;
        background:linear-gradient(180deg,#0b1424,#050a14);border-bottom:2px solid #0ff5}
      #bbWeb .wbBtn{font-family:'Press Start 2P',monospace;
        font-size:calc(8px * var(--bbFix, 1));padding:9px 11px;background:#0ff1;
        color:#0ff;border:2px solid #0ff8;cursor:pointer;letter-spacing:1px;
        white-space:nowrap;transition:background .15s,box-shadow .15s}
      #bbWeb .wbBtn:hover{background:#0ff3;box-shadow:0 0 14px #0ff8}
      #bbWeb .wbBtn.wbClose{color:#f88;border-color:#f888;background:#f881}
      #bbWeb .wbBtn.wbClose:hover{background:#f883;box-shadow:0 0 14px #f886}
      /* Адрес показываем целиком, но ужимаем: он информирует, а не кликается.
         Игрок должен видеть, на каком сайте находится, — это защита от
         «куда меня увели» не хуже адресной строки настоящего браузера. */
      #bbWeb .wbUrl{flex:1;min-width:0;font-family:'Share Tech Mono',monospace;
        font-size:calc(12px * var(--bbFix, 1));color:#9fd;letter-spacing:1px;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
        padding:0 6px;direction:rtl;text-align:left}
      #bbWeb .wbHost{color:#0ff}
      #bbWeb iframe{flex:1;width:100%;border:0;background:#fff}
      /* Подсказка поверх пустой страницы: сайт запретил встраивание. */
      #bbWeb .wbHint{position:absolute;left:50%;bottom:26px;transform:translateX(-50%);
        display:none;max-width:90vw;padding:12px 16px;text-align:center;
        background:#04101acc;border:2px solid #0ff6;color:#9fd;
        font-family:'Share Tech Mono',monospace;font-size:calc(12px * var(--bbFix, 1));
        line-height:1.7}
      #bbWeb.waiting .wbHint{display:block}
      @media (max-width:640px){
        #bbWeb .wbBtn{font-size:calc(7px * var(--bbFix, 1));padding:8px 9px}
        #bbWeb .wbUrl{font-size:calc(10px * var(--bbFix, 1))}
      }`;
    document.head.appendChild(css);
  }

  /** Отдать ссылку системе: внешний браузер или новая вкладка. */
  function toSystem(url) {
    try {
      if (window.electronAPI && typeof window.electronAPI.openExternal === 'function') {
        window.electronAPI.openExternal(url);
        return;
      }
    } catch (e) { /* моста нет — ниже обычный путь */ }
    try { window.open(url, '_blank', 'noopener'); } catch (e) {}
  }

  function build() {
    ensureStyles();
    ov = document.createElement('div');
    ov.id = 'bbWeb';
    ov.innerHTML =
      '<div class="wbBar">' +
        '<button class="wbBtn" id="wbBack"></button>' +
        '<button class="wbBtn" id="wbReload"></button>' +
        '<span class="wbUrl" id="wbUrl"></span>' +
        '<button class="wbBtn" id="wbExternal"></button>' +
        '<button class="wbBtn wbClose" id="wbClose"></button>' +
      '</div>' +
      '<iframe id="wbFrame" referrerpolicy="no-referrer-when-downgrade" ' +
        'sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"></iframe>' +
      '<div class="wbHint" id="wbHint"></div>';
    document.body.appendChild(ov);
    frame = ov.querySelector('#wbFrame');

    ov.querySelector('#wbClose').onclick = close;
    ov.querySelector('#wbExternal').onclick = () => { toSystem(current); };
    ov.querySelector('#wbReload').onclick = () => { load(current); };
    // Историю внутри iframe читать нельзя (чужой origin), но назад по ней
    // ходить можно — браузер сам знает, где мы.
    ov.querySelector('#wbBack').onclick = () => {
      try { frame.contentWindow.history.back(); } catch (e) { load(current); }
    };

    // Игра слушает клавиши глобально: пока браузер открыт, ввод не должен
    // управлять роботом. Тот же приём, что на экране аккаунта.
    ['keydown', 'keyup', 'keypress'].forEach((type) => {
      ov.addEventListener(type, (e) => e.stopPropagation(), true);
    });

    // Загрузилась страница — снимаем подсказку про «не открывается» и
    // обновляем адрес: игрок мог уйти по ссылке на другую страницу.
    frame.addEventListener('load', () => {
      clearTimeout(waitTimer);
      ov.classList.remove('waiting');
      syncUrl();
    });

    // Наши страницы сами сообщают адрес при загрузке (см. site.js и studio.js
    // на сайтах). Читать location у чужого origin браузер не даёт, а знать,
    // где игрок находится, надо: иначе строка вечно показывала бы первый адрес.
    window.addEventListener('message', (e) => {
      if (!frame || e.source !== frame.contentWindow) return;   // не наша рамка
      const d = e.data;
      if (!d || d.type !== 'bb-nav' || typeof d.url !== 'string') return;
      if (!/^https?:/i.test(d.url)) return;
      current = d.url;
      paintUrl(d.url);
    });
  }

  /**
   * Подтянуть настоящий адрес из рамки. Получается только для страницы того же
   * origin (веб-сборка игры живёт на том же домене, что и сайт) — в остальных
   * случаях молча оставляем прежний и ждём сообщения от самой страницы.
   */
  function syncUrl() {
    try {
      const href = frame.contentWindow.location.href;
      if (href && href !== 'about:blank') { current = href; paintUrl(href); }
    } catch (e) { /* чужой origin — это нормально */ }
  }

  function labels() {
    ov.querySelector('#wbBack').textContent = '←';
    ov.querySelector('#wbReload').textContent = '⟳';
    ov.querySelector('#wbExternal').textContent = T('webOpenOutside');
    ov.querySelector('#wbClose').textContent = T('close');   // общий ключ, свой заводить незачем
    ov.querySelector('#wbHint').textContent = T('webBlocked');
  }

  /** Адрес в строке: домен подсвечен, остальное приглушено. */
  function paintUrl(url) {
    const box = ov.querySelector('#wbUrl');
    try {
      const u = new URL(url);
      box.innerHTML = '<span class="wbHost">' + esc(u.host) + '</span>' + esc(u.pathname + u.search);
    } catch (e) { box.textContent = url; }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function load(url) {
    current = url;
    paintUrl(url);
    clearTimeout(waitTimer);
    ov.classList.remove('waiting');
    frame.src = url;
    // Чужой сайт, запретивший встраивание, не даёт ни ошибки, ни события —
    // просто остаётся пустым. Через несколько секунд предлагаем открыть его
    // снаружи, иначе игрок смотрел бы в белый экран и не понимал, что делать.
    waitTimer = setTimeout(() => { ov.classList.add('waiting'); }, 6000);
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  }

  /* Аппаратная «Назад» на Android. Подписываемся ТОЛЬКО пока окно открыто и
     сразу отписываемся: пока слушатель висит, Capacitor перестаёт обрабатывать
     кнопку сам, и в остальной игре она перестала бы сворачивать приложение. */
  let backHandle = null;   // выданная плагином подписка
  let backWanted = false;  // нужна ли она прямо сейчас

  function grabBackButton() {
    backWanted = true;
    try {
      const App = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
      if (!App || typeof App.addListener !== 'function') return;
      // В разных версиях плагина addListener возвращает то объект, то обещание.
      Promise.resolve(App.addListener('backButton', () => { close(); })).then((h) => {
        // Окно могли закрыть, пока подписка ехала, — тогда сразу снимаем.
        if (backWanted) backHandle = h;
        else { try { if (h && h.remove) h.remove(); } catch (e) {} }
      }).catch(() => {});
    } catch (e) { /* не Android — такой кнопки просто нет */ }
  }

  function releaseBackButton() {
    backWanted = false;
    try { if (backHandle && backHandle.remove) backHandle.remove(); } catch (e) {}
    backHandle = null;
  }

  function close() {
    if (!ov) return;
    clearTimeout(waitTimer);
    ov.style.display = 'none';
    ov.classList.remove('waiting');
    // Пустой src останавливает звук и фоновую работу страницы: оставленный
    // ролик на сайте продолжал бы играть поверх музыки игры.
    frame.src = 'about:blank';
    window.removeEventListener('keydown', onKey, true);
    releaseBackButton();
    if (window.SFX && window.SFX.back) window.SFX.back();
  }

  /**
   * Открыть ссылку. Страницу — внутри игры, файл — системой.
   * opts.external === true заставляет отдать системе что угодно.
   */
  function open(url, opts) {
    const u = String(url || '').trim();
    if (!u) return;
    if (window.SFX && window.SFX.menu) window.SFX.menu();

    // Файлы и всё, что не http(s), — мимо встроенного окна.
    if ((opts && opts.external) || FILE_RE.test(u) || !/^https?:/i.test(u)) {
      toSystem(u);
      return;
    }

    if (!ov) build();
    labels();
    // Экраны игры не прячем: браузер ложится поверх, и по закрытии игрок
    // возвращается ровно туда, откуда нажал ссылку.
    ov.style.display = 'flex';
    load(u);
    window.addEventListener('keydown', onKey, true);
    grabBackButton();
  }

  window.BBBrowser = {
    open,
    close,
    isOpen: () => !!ov && ov.style.display === 'flex',
    /** Явно наружу — для кнопок вида «открыть в настоящем браузере». */
    external: toSystem,
  };

  console.log('✅ In-game browser loaded');
})();
