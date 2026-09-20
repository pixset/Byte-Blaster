/* ═══════════════════════════════════════════════════════════════════════════
   ПОДГОНКА ОКОН ПОД ЭКРАН
   ═══════════════════════════════════════════════════════════════════════════
   Окна игры (настройки, аккаунт, рекорды, «что нового», профиль, достижения)
   свёрстаны под удобный размер и масштабируются переменной --bbFix. На узком
   или низком экране этого не всегда хватает: содержимое вылезает за нижний
   край, а обрезанное окно выглядит как сломанное — до кнопок «Сохранить» уже
   не добраться. Ручной размер интерфейса делал то же самое: стоило поставить
   покрупнее, и половина настроек уходила за экран.

   Здесь два уровня защиты, именно в таком порядке:

     1. УМЕНЬШИТЬ. Окну назначается собственное значение --bbFix, меньше
        общего. Дети наследуют его, и окно ужимается целиком — вместе с
        отступами и кнопками, а не только текстом. Опускаемся до 0.55: ниже
        текст перестаёт читаться, и уменьшать дальше вредно.

     2. ПРОКРУТИТЬ. Если и на минимуме не помещается (длинные настройки на
        коротком экране), окно становится прокручиваемым. Прокрутка здесь
        именно запасной вариант: листать окно, которое могло бы поместиться
        целиком, — неудобно.

   Считаем только по высоте: по ширине окна и так тянутся резиновыми.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var MIN_SCALE = 0.55;
  var STEPS = [1, 0.9, 0.8, 0.72, 0.64, MIN_SCALE];

  // Окна, которые надо подгонять. Держим списком, а не «всеми fixed-элементами»:
  // подгонять HUD, сенсорные кнопки или всплывающие уведомления не нужно и вредно.
  // Только окна на уровне body — те, что не защищены масштабом сцены и потому
  // реально вылезают за экран (см. проверку на #stage в fitOne).
  var IDS = [
    'settingsOv', 'bbAcc', 'bbLb', 'bbWn', 'bbProfile', 'achievementsOverlay',
    'bbResults', 'bbDemoEnd', 'bbUpd', 'bbLogArchive', 'bbSlots', 'bbFriends',
  ];

  function vh() {
    // visualViewport точнее: на телефоне адресная строка съедает часть экрана,
    // и innerHeight про это не знает.
    return (window.visualViewport && window.visualViewport.height) || window.innerHeight || 0;
  }

  function shown(el) {
    if (!el) return false;
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    return el.offsetWidth > 0 && el.offsetHeight > 0;
  }

  /** Содержимое окна по высоте — по детям, а не по самому окну: сам контейнер
   *  почти всегда растянут на весь экран и о переполнении ничего не скажет. */
  function contentHeight(el) {
    var top = Infinity, bot = -Infinity, any = false;
    for (var i = 0; i < el.children.length; i++) {
      var c = el.children[i];
      if (!c.getBoundingClientRect) continue;
      var cs = getComputedStyle(c);
      if (cs.display === 'none' || cs.position === 'fixed') continue;
      var r = c.getBoundingClientRect();
      if (r.height <= 0) continue;
      any = true;
      if (r.top < top) top = r.top;
      if (r.bottom > bot) bot = r.bottom;
    }
    if (!any) return 0;
    return bot - top;
  }

  /**
   * Масштаб окна. Разные окна построены на разных переменных: угловые кнопки и
   * новые панели считают от --bbFix, окно профиля — от --bbUI, старые оверлеи —
   * от --bbText. Задаём все три НА САМОМ ОКНЕ: значение видно только его детям,
   * общие настройки игры не трогаются, а окно ужимается независимо от того, на
   * чём оно свёрстано. Без этого профиль игнорировал подгонку и открывался во
   * весь экран с обрезанным низом.
   */
  function setScale(el, k) {
    // База читается заново на каждой подгонке: игрок мог поменять размер
    // интерфейса в настройках, и кэш сделал бы окно глухим к этой правке.
    var base = el.__bbBase;
    if (!base) { base = el.__bbBase = readRootScales(); }
    el.style.setProperty('--bbFix', String(base.fix * k));
    el.style.setProperty('--bbUI', String(base.ui * k));
    el.style.setProperty('--bbText', String(base.text * k));
  }
  function clearScale(el) {
    el.__bbBase = null;
    el.style.removeProperty('--bbFix');
    el.style.removeProperty('--bbUI');
    el.style.removeProperty('--bbText');
  }
  function readRootScales() {
    var cs = getComputedStyle(document.documentElement);
    var num = function (name, dflt) {
      var v = parseFloat(cs.getPropertyValue(name));
      return (isFinite(v) && v > 0) ? v : dflt;
    };
    return { fix: num('--bbFix', 1), ui: num('--bbUI', 1), text: num('--bbText', 1) };
  }

  /** Не помещается ли окно. Два признака, и достаточно любого из них:
   *  1) габарит содержимого выше экрана — обычное переполнение;
   *  2) у самого окна scrollHeight больше clientHeight — так проявляется
   *     содержимое, обрезанное внутренним контейнером с max-height. */
  function overflows(el, limit) {
    if (contentHeight(el) > limit) return true;
    return el.scrollHeight > el.clientHeight + 2;
  }

  function fitOne(el) {
    if (!shown(el)) { clearScale(el); return; }

    // Окна ВНУТРИ #stage не трогаем. Сцена верстается в 1280×720 и целиком
    // вписывается в экран одним transform:scale — она по построению помещается
    // всегда. Ужимать её содержимое ещё раз значит уменьшать дважды, а включать
    // прокрутку — предлагать листать то, что и так видно целиком.
    var stage = document.getElementById('stage');
    if (stage && stage !== el && stage.contains(el)) { clearScale(el); return; }

    var limit = vh() - 8;                 // небольшой запас от краёв
    if (limit <= 0) return;

    // Шаг 1 — подобрать масштаб. Идём от крупного к мелкому и останавливаемся
    // на первом, при котором окно помещается: незачем ужимать сильнее нужного.
    var chosen = MIN_SCALE;
    for (var i = 0; i < STEPS.length; i++) {
      setScale(el, STEPS[i]);
      // Чтение размеров форсирует пересчёт раскладки — значение уже применено.
      if (!overflows(el, limit)) { chosen = STEPS[i]; break; }
      chosen = STEPS[i];
    }
    setScale(el, chosen);

    // Шаг 2 — если и на минимуме не влезло, разрешаем листать.
    var over = overflows(el, limit);
    if (over) {
      el.style.overflowY = 'auto';
      el.style.overscrollBehavior = 'contain';
      el.style.webkitOverflowScrolling = 'touch';
      // justify-content:center в flex-контейнере обрезает верх содержимого,
      // когда оно выше контейнера, — и до начала списка не долистать.
      var cs = getComputedStyle(el);
      if (cs.display.indexOf('flex') >= 0 && cs.justifyContent === 'center') {
        el.style.justifyContent = 'flex-start';
      }
      el.dataset.bbScrolled = '1';
    } else if (el.dataset.bbScrolled) {
      el.style.overflowY = '';
      el.style.justifyContent = '';
      delete el.dataset.bbScrolled;
    }
  }

  var pending = 0;
  function fitAll() {
    pending = 0;
    for (var i = 0; i < IDS.length; i++) {
      var el = document.getElementById(IDS[i]);
      if (el) { try { fitOne(el); } catch (e) {} }
    }
  }
  function schedule() {
    if (pending) return;
    // Таймер, а не requestAnimationFrame: подгонка нужна и тогда, когда кадры
    // не рисуются — вкладка в фоне, окно свёрнуто, вебвью не композитит. С rAF
    // окно в такой момент осталось бы неподогнанным до первого кадра.
    pending = setTimeout(fitAll, 16);
  }

  function start() {
    schedule();
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', function () {
      schedule(); setTimeout(schedule, 250); setTimeout(schedule, 700);
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', schedule);
    }
    // Окна показываются сменой style.display у себя или у родителя, поэтому
    // ловим правки атрибутов по всему документу и пересчитываем.
    if (window.MutationObserver) {
      new MutationObserver(schedule).observe(document.body, {
        attributes: true, attributeFilter: ['style', 'class'], subtree: true,
      });
    }
    // Размер интерфейса из настроек меняет --bbFix у :root — наши значения
    // перекрывают его, поэтому после любой правки пересчитываем заново.
    var reFit = function () { schedule(); setTimeout(schedule, 60); };
    document.addEventListener('click', reFit, true);
    document.addEventListener('change', reFit, true);
    // Мобильные вебвью сообщают итоговый размер с задержкой.
    [200, 600, 1200].forEach(function (t) { setTimeout(schedule, t); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.UIFit = { refresh: schedule };
})();
