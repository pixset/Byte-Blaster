// ===============================================================
//  BYTE BLASTER — «ЧТО НОВОГО»
// ===============================================================
// Экран истории версий. Раньше в главном меню на этом месте стояли настройки;
// они переехали в правый верхний угол — так же, как кнопка аккаунта слева.
//
// Тексты живут ЗДЕСЬ, а не читаются из docs/CHANGELOG.md: тот файл писан для
// разработки — он на 1100 строк, только по-русски и техническим языком. Здесь
// короткие формулировки для игрока, которые можно переводить.
//
// О версии 1.0.1 в репозитории не сохранилось ни changelog, ни заметок; то, что
// написано ниже, — со слов автора игры.
(function (root) {
  'use strict';

  const T = (k, d) => (typeof root.t === 'function' && root.t(k) !== k) ? root.t(k) : d;

  /* ── Данные ────────────────────────────────────────────────────────────
     add — добавлено, chg — изменено, fix — исправлено. Каждая строка это
     [ключ перевода, русский текст]: пока перевода нет, показывается русский. */
  const VERSIONS = [
    {
      v: '1.0.3',
      dateKey: 'wnDate103', date: 'сентябрь 2026',
      fresh: true,
      add: [
        ['wn103a1', 'Пролог: отдельный мир на карте, где Лейла Чэн обучает ЮНИТ-7 — и там же её похищают'],
        ['wn103a2', 'Бонус-комнаты: спрятанный вход ведёт в закрытую комнату с монетами, пять разных планировок'],
        ['wn103a4', 'Скрытые блоки: невидимы, пока не ударишь снизу'],
        ['wn103a5', 'Раздел «Что нового» — этот самый экран'],
        ['wn103a6', 'Таблица рекордов: кампания, бесконечный режим и хардкор — три отдельных зачёта'],
        ['wn103a7', 'Замороженные враги стали глыбами льда: падают, скользят, сносят друг друга цепочкой'],
        ['wn103a8', 'На карте мира видно, сколько монет собрано всего и на каждом уровне'],
        ['wn103a9', 'Кнопка аккаунта показывает вашу аватарку из профиля Pixset Studio'],
        ['wn103a10', 'Режим прохождения в настройках: спокойный сохраняет чекпоинт после всех жизней, а падение возвращает на край, откуда прыгнул'],
        ['wn103a11', 'Наблюдатель в сетевой игре: выбыл — смотришь за остальными, переключаешься между ними и можешь выйти не дожидаясь конца уровня'],
        ['wn103a12', 'Общий мир в сетевой игре: монеты, блоки, бонусы, кристаллы и ключи одни на всю комнату, а выстрелы каждого игрока видят все'],
        ['wn103a13', 'Стрелка к игроку за краем экрана — видно, кто убежал вперёд, кто отстал и насколько'],
        ['wn103a14', 'Уведомления в углу: кто зашёл в комнату и кто вышел'],
        ['wn103a15', 'Хост может разрешить входить в уже начатый уровень — иначе новичок ждёт следующего'],
        ['wn103a16', 'Уровень дня: пять испытаний, новые каждые сутки — лёгкое, среднее, сложное и два случайных. Попыток сколько угодно, в зачёт идёт лучшая'],
        ['wn103a17', 'Призрак лучшего забега бежит рядом: свой рекорд, лидер дня или лидер уровня. Включается в настройках, по умолчанию выключен'],
        ['wn103a18', 'Таблицы рекордов можно смотреть по миру, по своей стране или только среди друзей'],
        ['wn103a19', 'Вход в аккаунт по нику, а не только по почте'],
        ['wn103a20', 'Раздел «Онлайн» собрал уровень дня и совместную игру в одно место'],
      ],
      chg: [
        ['wn103c1', 'Настройки переехали в угол экрана, как кнопка аккаунта'],
        ['wn103c2', 'На экране загрузки видно проценты, этапы и сколько данных уже скачано'],
        ['wn103c3', 'Особенности уровня стали редкими: не больше одной на уровень, треть уровней без них'],
        ['wn103c4', 'Флагшток: чем выше схватишь флаг, тем больше очков'],
        ['wn103c5', 'Игра запускается быстрее: язык загружается один, а не все пятьдесят сразу'],
        ['wn103c6', 'Настройка качества графики теперь управляет всем свечением, а не его частью'],
        ['wn103c7', 'В публичном профиле игрока стало заметно больше цифр: рекорды, монеты, боссы, секреты, боевая статистика'],
        ['wn103c8', 'Комнаты мультиплеера работают и там, где прежний сервер недоступен: игра сама находит рабочий путь, а код комнаты срабатывает независимо от того, кому какой сервер открылся'],
        ['wn103c9', 'Свечение ограничено сотней процентов: выше оно не подсвечивало, а заливало картинку'],
        ['wn103c10', 'Счётчик кадров показывает честное число и время кадра, а рамка с подложкой убраны — он больше ничего не перекрывает'],
        ['wn103c11', 'В радужном мире цвет берут все объекты, а не почти все; при выключенном преломлении переливание замирает статичным градиентом и кадр обходится дешевле'],
      ],
      fix: [
        ['wn103f1', 'Финиш больше не появляется внутри бонус-комнаты'],
        ['wn103f2', 'Из бонус-комнаты нельзя выбраться через верх и убежать к финишу'],
        ['wn103f3', 'Скрытый блок не встаёт перед кристаллом и не запирает его'],
        ['wn103f4', 'Мир лавы больше не сбоит при отрисовке первого кадра'],
        ['wn103f5', 'Исправлено редкое падение отрисовки: на некоторых уровнях враги могли пропасть с экрана'],
        ['wn103f6', 'Кнопка «Что нового» больше не висит на экранах победы и поражения'],
        ['wn103f7', 'Гибель в прологе перезапускает пролог, а не бросает в первый уровень кампании'],
        ['wn103f8', 'Второй флаг посреди уровня убран: финиш на уровне снова один'],
        ['wn103f9', 'Частые удары снизу по блоку монет больше не отбрасывают игрока в сторону'],
        ['wn103f10', 'Выход игрока из сетевой комнаты больше не заставляет остальных ждать его у флага'],
        ['wn103f11', 'Смена хоста посреди уровня больше не подвешивает комнату навсегда'],
        ['wn103f12', 'Выход из комнаты в меню больше не оставляет чужих игроков в следующей одиночной игре'],
        ['wn103f13', 'Чужие игроки больше не ездят по уровню без анимации — у них работают шаг, приземление и покой'],
        ['wn103f14', 'После выхода из комнаты пропадают сенсорные кнопки'],
        ['wn103f15', 'Скорость анимаций больше не зависит от частоты кадров: на быстрых мониторах монеты, пружины, карта мира и заставки шли в два с половиной раза быстрее'],
        ['wn103f16', 'Призрак больше не пропадает посреди уровня, а неудачная попытка не затирает запись пройденного забега'],
        ['wn103f17', 'Установка обновления больше не выбрасывает из аккаунта'],
        ['wn103f18', 'Чужие игроки в сетевой игре двигаются плавно на мониторе любой частоты'],
      ],
    },
    {
      v: '1.0.2',
      dateKey: 'wnDate102', date: 'август 2026',
      add: [
        ['wn102a1', 'Секретный 11-й мир «Prism Anomaly»: 10 уровней, свой босс и развязка сюжета'],
        ['wn102a2', 'Радужные осколки — по одному в каждом мире, все десять открывают секретный мир'],
        ['wn102a3', 'Профиль оператора: аватары, позывной, звания, статистика и архив сюжетных сцен'],
        ['wn102a4', 'Статус-эффекты: горение, обледенение, ЭМИ-сбой и коррозия'],
        ['wn102a5', 'Версии для Android и для браузера'],
      ],
      chg: [
        ['wn102c1', 'Карта мира перерисована на canvas'],
        ['wn102c2', 'Полный перевод на 49 языков — целиком, а не частями'],
        ['wn102c3', 'Кадр стал в 2–3 раза дешевле, добавлено автоматическое качество'],
      ],
      fix: [
        ['wn102f1', 'Четыре босса были непроходимы в принципе — исправлено'],
        ['wn102f2', 'Чёрный экран при запуске .exe на части видеокарт'],
      ],
    },
    {
      v: '1.0.1',
      dateKey: 'wnDate101', date: 'июль 2026',
      chg: [
        ['wn101c1', 'Исправление ошибок и улучшение производительности. Больше в этой сборке ничего не менялось.'],
      ],
    },
    {
      v: '1.0.0',
      dateKey: 'wnDate100', date: 'июнь 2026',
      firstKey: 'wnFirstRelease', first: 'первый выпуск',
      add: [
        ['wn100a1', '100 уровней в 10 мирах, у каждого мира свой босс'],
        ['wn100a2', 'Совместная игра до 5 человек через сервер-посредник'],
        ['wn100a3', 'Достижения и слоты сохранений'],
        ['wn100a4', 'Бесконечный режим'],
      ],
    },
  ];

  /* ── Архив ──────────────────────────────────────────────────────────────
     Отдельная предрелизная линия 0.x: восемь однофайловых сборок, каждая
     открывалась двойным кликом. Даты — по времени создания файлов в папке
     Archive, состав проверен по самим файлам, а не по памяти.
     Номера идут по тому, что сборка добавила, а не подряд. */
  const ARCHIVE_NOTE = ['wnArchiveIntro',
    'Отдельная линия версий до первого выпуска — восемь сборок, каждая одним файлом HTML.'];
  const ARCHIVE = [
    ['0.1.0', '11 марта 2026', 'wnA010',
      'Прототип под названием NEON RUN: один бесконечный уровень, без карты, тем и боссов'],
    ['0.2.0', '11 марта 2026', 'wnA020',
      'Переименована в Byte Blaster: карта мира, 10 тематических миров, сохранение прогресса'],
    ['0.2.1', '11 марта 2026', 'wnA021', 'Доработанный бесконечный режим'],
    ['0.3.0', '12 марта 2026', 'wnA030', 'Боссы'],
    ['0.4.0-beta', '12 марта 2026', 'wnA04b', 'Локальный режим на двоих'],
    ['0.4.0', '17 марта 2026', 'wnA040',
      'Четыре типа бонусов вместо двух, музыка звезды, заблокированные карточки режимов'],
    ['0.5.0', '18 марта 2026', 'wnA050', 'Катсцены и второй набор тем'],
    ['0.6.0', '18 марта 2026', 'wnA060', 'Режим хардкора — последняя сборка до 1.0.0'],
  ];

  const GROUPS = [
    ['add', 'wnAdded', 'ДОБАВЛЕНО', '#4affa0'],
    ['chg', 'wnChanged', 'ИЗМЕНЕНО', '#0ff'],
    ['fix', 'wnFixed', 'ИСПРАВЛЕНО', '#ff9d4a'],
  ];

  /** Последняя версия, о которой игрок уже читал. */
  const SEEN_KEY = 'bbWhatsNewSeen';
  const latest = () => VERSIONS[0].v;
  function unread() {
    try { return localStorage.getItem(SEEN_KEY) !== latest(); } catch (e) { return false; }
  }
  function markRead() {
    try { localStorage.setItem(SEEN_KEY, latest()); } catch (e) {}
    const dot = document.getElementById('bbWnDot');
    if (dot) dot.style.display = 'none';
  }

  let ov = null, current = 0;

  function ensureStyles() {
    if (document.getElementById('bbWnCss')) return;
    const css = document.createElement('style');
    css.id = 'bbWnCss';
    css.textContent = `
      #bbWn{position:fixed;inset:0;z-index:72;display:none;flex-direction:column;
        background:#04040ff2;padding:calc(18px * var(--bbFix, 1));
        font-family:'Share Tech Mono',monospace}
      #bbWn h2{font-family:'Press Start 2P',monospace;color:#ffd24a;
        font-size:calc(15px * var(--bbFix, 1));text-shadow:0 0 14px #ffd24a;
        letter-spacing:3px;margin:0 0 calc(14px * var(--bbFix, 1));text-align:center}
      /* Две колонки на просторе, одна — на телефоне. */
      #bbWnBody{flex:1;display:grid;grid-template-columns:minmax(190px,260px) 1fr;
        gap:calc(14px * var(--bbFix, 1));min-height:0}
      #bbWnList{overflow-y:auto;border:2px solid #1a3a5a;background:#06061a;
        padding:calc(8px * var(--bbFix, 1))}
      #bbWnDetail{overflow-y:auto;border:2px solid #0ff8;background:#06061a;
        padding:calc(16px * var(--bbFix, 1))}
      .bbWnItem{padding:calc(11px * var(--bbFix, 1));cursor:pointer;border-left:4px solid transparent;
        transition:background .12s}
      .bbWnItem:hover{background:#0ff1}
      .bbWnItem.sel{background:#ffd24a1f;border-left-color:#ffd24a}
      .bbWnItem .v{font-family:'Press Start 2P',monospace;color:#0ff;
        font-size:calc(11px * var(--bbFix, 1))}
      .bbWnItem.sel .v{color:#ffd24a}
      .bbWnItem .d{color:#5a7a9a;font-size:calc(11px * var(--bbFix, 1));margin-top:5px}
      .bbWnItem .new{float:right;color:#ff4d6d;font-size:calc(10px * var(--bbFix, 1))}
      #bbWnDetail .vTitle{font-family:'Press Start 2P',monospace;color:#ffd24a;
        font-size:calc(14px * var(--bbFix, 1));text-shadow:0 0 12px #ffd24a;
        margin-bottom:calc(16px * var(--bbFix, 1))}
      #bbWnDetail .grp{font-family:'Press Start 2P',monospace;
        font-size:calc(10px * var(--bbFix, 1));letter-spacing:2px;
        margin:calc(16px * var(--bbFix, 1)) 0 calc(9px * var(--bbFix, 1))}
      #bbWnDetail ul{list-style:none;margin:0;padding:0}
      #bbWnDetail li{color:#c8dcf0;font-size:calc(13px * var(--bbFix, 1));
        line-height:1.65;padding-left:calc(17px * var(--bbFix, 1));position:relative;
        margin-bottom:calc(6px * var(--bbFix, 1))}
      #bbWnDetail li:before{content:'';position:absolute;left:0;top:calc(8px * var(--bbFix, 1));
        width:6px;height:6px;border-radius:50%;background:currentColor}
      #bbWnBack{align-self:center;margin-top:calc(14px * var(--bbFix, 1));
        font-family:'Press Start 2P',monospace;font-size:calc(10px * var(--bbFix, 1));
        background:#0a0a26;border:2px solid #5a7a9a;color:#5a7a9a;
        padding:calc(12px * var(--bbFix, 1)) calc(30px * var(--bbFix, 1));cursor:pointer}
      #bbWnBack:hover{border-color:#0ff;color:#0ff;box-shadow:0 0 14px #0ff6}
      /* Значок слева от подписи. Кнопки меню — flex, поэтому значок и текст
         сами встают в ряд; выравниваем по центру и даём отступ. */
      #whatsNewBtn .wnBtnIcon{display:inline-flex;align-items:center;
        margin-right:calc(9px * var(--bbFix, 1));vertical-align:middle}
      #whatsNewBtn .wnBtnIcon svg{width:calc(19px * var(--bbFix, 1));
        height:calc(19px * var(--bbFix, 1));display:block}
      /* Точка непрочитанного на кнопке в меню. */
      #bbWnDot{position:absolute;top:-7px;right:-7px;width:18px;height:18px;
        border-radius:50%;background:#ff4d6d;box-shadow:0 0 10px #ff4d6d;
        color:#fff;font-size:11px;line-height:18px;text-align:center;
        font-family:'Share Tech Mono',monospace}
      @media (max-width:760px){
        #bbWnBody{grid-template-columns:1fr;grid-template-rows:auto 1fr}
        #bbWnList{display:flex;gap:8px;overflow-x:auto;overflow-y:hidden}
        .bbWnItem{border-left:none;border-bottom:4px solid transparent;white-space:nowrap}
        .bbWnItem.sel{border-bottom-color:#ffd24a}
        .bbWnItem .d,.bbWnItem .new{display:none}
      }`;
    document.head.appendChild(css);
  }

  function build() {
    ensureStyles();
    ov = document.createElement('div');
    ov.id = 'bbWn';
    ov.innerHTML =
      '<h2 id="bbWnTitle">' + T('whatsNew', 'ЧТО НОВОГО') + '</h2>' +
      '<div id="bbWnBody"><div id="bbWnList"></div><div id="bbWnDetail"></div></div>' +
      '<button id="bbWnBack">' + T('back', 'НАЗАД') + '</button>';
    document.body.appendChild(ov);
    ov.querySelector('#bbWnBack').onclick = close;
    renderList();
    renderDetail();
  }

  function renderList() {
    const list = ov.querySelector('#bbWnList');
    list.innerHTML = '';
    VERSIONS.concat([{ v: T('wnArchive', 'Архив'), archive: true }]).forEach((entry, i) => {
      const el = document.createElement('div');
      el.className = 'bbWnItem' + (i === current ? ' sel' : '');
      // У первого выпуска показываем и месяц, и пометку: раньше пометка
      // вытесняла дату, и 1.0.0 оказывалась единственной версией без месяца.
      const sub = entry.archive ? T('wnArchiveSub', 'ранние сборки')
        : [T(entry.dateKey, entry.date), entry.first ? T(entry.firstKey, entry.first) : '']
            .filter(Boolean).join(' · ');
      el.innerHTML = '<span class="v">' + entry.v + '</span>' +
        (entry.fresh && unread() ? '<span class="new">' + T('wnNew', 'НОВОЕ') + '</span>' : '') +
        (sub ? '<div class="d">' + sub + '</div>' : '');
      el.onclick = () => {
        current = i;
        if (root.SFX && root.SFX.menu) root.SFX.menu();
        renderList(); renderDetail();
      };
      list.appendChild(el);
    });
  }

  function renderDetail() {
    const box = ov.querySelector('#bbWnDetail');
    if (current >= VERSIONS.length) {            // «Архив»
      let a = '<div class="vTitle">' + T('wnArchive', 'Архив') + '</div>' +
        '<div style="color:#8aa;font-size:calc(13px * var(--bbFix, 1));' +
        'line-height:1.6;margin-bottom:14px">' + T(ARCHIVE_NOTE[0], ARCHIVE_NOTE[1]) + '</div>';
      // Дата и номер в одну строку, описание — под ними: список читается как
      // хроника, а не как таблица, которую на телефоне пришлось бы прокручивать вбок.
      for (const [ver, date, key, def] of ARCHIVE) {
        a += '<div style="margin-bottom:13px">' +
          '<div><span style="font-family:\'Press Start 2P\',monospace;color:#0ff;' +
          'font-size:calc(11px * var(--bbFix, 1))">' + ver + '</span>' +
          '<span style="color:#5a7a9a;font-size:calc(12px * var(--bbFix, 1));' +
          'margin-left:12px">' + date + '</span></div>' +
          '<div style="color:#c8dcf0;font-size:calc(13px * var(--bbFix, 1));' +
          'line-height:1.55;margin-top:3px">' + T(key, def) + '</div></div>';
      }
      box.innerHTML = a;
      box.scrollTop = 0;
      return;
    }
    const e = VERSIONS[current];
    let html = '<div class="vTitle">' + T('wnVersion', 'Версия') + ' ' + e.v + '</div>';
    for (const [field, key, def, col] of GROUPS) {
      const items = e[field];
      if (!items || !items.length) continue;
      html += '<div class="grp" style="color:' + col + '">' + T(key, def) + '</div><ul>';
      for (const [ik, ru] of items)
        html += '<li style="color:' + col + '"><span style="color:#c8dcf0">' + T(ik, ru) + '</span></li>';
      html += '</ul>';
    }
    box.innerHTML = html;
    box.scrollTop = 0;
  }

  function open() {
    if (!ov) build();
    current = 0;
    renderList(); renderDetail();
    ov.style.display = 'flex';
    markRead();
  }
  function close() {
    if (root.SFX && root.SFX.back) root.SFX.back();
    if (ov) ov.style.display = 'none';
  }

  /* ── Кнопка в главном меню, на месте бывших настроек ────────────────── */
  function addMenuButton() {
    if (document.getElementById('whatsNewBtn')) return true;
    const mainOv = document.getElementById('mainOv');
    if (!mainOv) return false;
    // Стили нужны прямо сейчас, а не при первом открытии экрана: без них SVG
    // значка не имеет размеров и растягивается во всю кнопку. Раньше это было
    // видно ровно до того, как игрок впервые заглянет в «Что нового».
    ensureStyles();
    const startBtn = mainOv.querySelector('.ovBtn');
    if (!startBtn) return false;
    const b = document.createElement('button');
    b.id = 'whatsNewBtn';
    b.className = 'ovBtn';
    b.style.marginTop = '10px';
    b.style.position = 'relative';
    // Значок слева от подписи: свиток с загнутым уголком и строками текста —
    // список изменений. Рисованный, а не эмодзи: эмодзи в разных системах
    // выглядят по-разному и выпадают из шрифта меню.
    const icon = document.createElement('span');
    icon.className = 'wnBtnIcon';
    // width/height проставлены и атрибутами тоже — это страховка на случай,
    // если стили ещё не применились: SVG без заданного размера занимает всё
    // доступное место, и кнопка раздувается на пол-экрана.
    icon.innerHTML =
      '<svg viewBox="0 0 24 24" width="19" height="19" fill="none"' +
      ' stroke="currentColor" stroke-width="2"' +
      ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M5 3h9l5 5v13H5z"/><path d="M14 3v5h5"/>' +
      '<path d="M8 12h8"/><path d="M8 16h6"/></svg>';
    b.appendChild(icon);
    // Подпись — отдельный элемент с data-i18n. Если повесить атрибут на саму
    // кнопку, переводчик перезапишет её textContent и снесёт значок с точкой.
    const label = document.createElement('span');
    label.setAttribute('data-i18n', 'whatsNew');
    label.textContent = T('whatsNew', 'ЧТО НОВОГО');
    b.appendChild(label);
    if (unread()) {
      const dot = document.createElement('span');
      dot.id = 'bbWnDot';
      dot.textContent = '1';
      b.appendChild(dot);
    }
    b.onclick = function () {
      if (root.SFX && root.SFX.menu) root.SFX.menu();
      open();
    };
    startBtn.parentNode.insertBefore(b, startBtn.nextSibling);
    // Оверлей #mainOv служит ещё экранами победы и поражения, и там лишние
    // кнопки уже погашены. Кнопку вставляют с задержкой, поэтому она могла
    // появиться уже после этого и остаться видимой на итоговом экране.
    // Равняемся на «Выход»: он живёт по тем же правилам.
    const exit = document.getElementById('exitBtn');
    if (exit && exit.style.display === 'none') b.style.display = 'none';
    return true;
  }

  function ensureMenuButton() {
    if (addMenuButton()) return;
    const iv = setInterval(() => { if (addMenuButton()) clearInterval(iv); }, 100);
    setTimeout(() => clearInterval(iv), 6000);
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', ensureMenuButton, { once: true });
  else ensureMenuButton();

  root.WhatsNew = { open, close, unread, latest };
})(typeof globalThis !== 'undefined' ? globalThis : this);
