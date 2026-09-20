// ===============================================================
//  BYTE BLASTER — ЭКРАН ИТОГОВ УРОВНЯ И ПОРАЖЕНИЯ
// ===============================================================
// Отзыв игрока: «нет менюшки после смерти или прохождения уровня, что не даёт
// как будто чувство прогресса». Так и было:
//
//   • пройдя уровень, игрок видел четыре секунды анимации выхода — награда
//     (звёзды, бонусы, счёт) мелко пролетала прямо поверх игры, — и его тут же
//     без спроса забрасывало в следующий уровень;
//   • умерев, он попадал на главное меню с перекрашенным заголовком и
//     ЕДИНСТВЕННОЙ кнопкой «Заново»: ни счёта за попытку, ни выхода на карту.
//
// Здесь то же самое, но как остановка: панель с разбором награды, цифры
// набегают, звёзды загораются по очереди, и дальше игрок идёт сам — кнопкой
// или клавишей. Ничего не решается за него.
//
// Работает только в одиночной игре и в локальном коопе: в сетевой комнате темп
// задаёт хост, и остановить одного игрока значит остановить всех.
(function () {
  'use strict';

  const T = (k, ...a) => (typeof window.t === 'function' ? window.t(k, ...a) : k);
  const sfx = (n) => { try { if (window.SFX && window.SFX[n]) window.SFX[n](); } catch (e) {} };
  // «Играют пальцем?» — общий ответ из game.js (см. bbWantsTouchUI): у любого
  // ноутбука с сенсорным экраном прежняя проверка была истинной, и подсказка
  // по клавишам пропадала у тех, кто как раз с клавиатурой и играет.
  const isTouch = () => (typeof window.bbWantsTouchUI === 'function')
    ? window.bbWantsTouchUI()
    : (('ontouchstart' in window) || navigator.maxTouchPoints > 0 ||
       (window.gameSettings && window.gameSettings.touchControls === 'on'));

  let ov = null, onKeyBound = null, raf = 0;

  /* ── Стили ─────────────────────────────────────────────────────────────
     Лист подключается во время работы, то есть ПОСЛЕ ui-fix.css, поэтому
     мобильные размеры живут здесь же — иначе общая таблица до них не дотянется
     (та же причина, что и в infsave.js). Размеры шрифтов идут через --bbText,
     как и везде: настройка размера текста должна работать и на этом экране. */
  function styles() {
    if (document.getElementById('bbResCSS')) return;
    const st = document.createElement('style');
    st.id = 'bbResCSS';
    st.textContent = `
#bbResults{position:fixed;inset:0;z-index:2700;display:none;align-items:center;justify-content:center;
  padding:16px;background:radial-gradient(120% 120% at 50% 0%,#0b1030f2,#04040ff8);
  font-family:'Press Start 2P',monospace;overflow-y:auto}
/* 94vw делится на масштаб интерфейса: окно увеличивается zoom-ом (см.
   ui-fix.css), и без деления оно вышло бы за края экрана. */
#bbResults .rsWin{width:min(520px,calc(94vw / var(--bbUI, 1)));background:#06061a;border:2px solid var(--rsAccent,#0ff);
  box-shadow:0 0 34px #0ff4,inset 0 0 60px #0ff08;padding:22px 20px;text-align:center;
  animation:rsPop .28s cubic-bezier(.2,1.3,.4,1) both}
@keyframes rsPop{from{opacity:0;transform:scale(.9) translateY(14px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){#bbResults .rsWin{animation:none}}
#bbResults .rsTitle{font-size:calc(14px * var(--bbText, 1));color:var(--rsAccent,#0ff);letter-spacing:3px;
  text-shadow:0 0 16px var(--rsAccent,#0ff);line-height:1.6;overflow-wrap:anywhere}
#bbResults .rsSub{font-family:'Share Tech Mono',monospace;font-size:calc(12px * var(--bbText, 1));
  color:#9fd;letter-spacing:2px;margin-top:8px;overflow-wrap:anywhere}

/* Звёзды загораются по очереди — задержка задаётся из JS через --d. */
#bbResults .rsStars{display:flex;gap:14px;justify-content:center;margin:16px 0 4px}
#bbResults .rsStar{font-size:calc(26px * var(--bbText, 1));line-height:1;color:#2a2a3a}
#bbResults .rsStar.on{color:#ffd23f;text-shadow:0 0 14px #ffd23f;
  animation:rsStar .42s cubic-bezier(.2,1.5,.4,1) both;animation-delay:var(--d,0s)}
@keyframes rsStar{from{opacity:0;transform:scale(2.2) rotate(-25deg)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){#bbResults .rsStar.on{animation:none}}
#bbResults .rsBest{font-size:calc(8px * var(--bbText, 1));color:#ffd23f;letter-spacing:2px;
  text-shadow:0 0 10px #ffd23f;margin-top:2px}

#bbResults .rsRows{margin:16px auto 4px;text-align:left;max-width:340px}
#bbResults .rsRow{display:flex;justify-content:space-between;align-items:baseline;gap:12px;
  font-family:'Share Tech Mono',monospace;font-size:calc(12px * var(--bbText, 1));
  color:#5a7a9a;letter-spacing:1px;padding:6px 0;border-bottom:1px solid #0ff2}
#bbResults .rsRow:last-child{border-bottom:none}
#bbResults .rsRow b{color:#fff;font-weight:normal;white-space:nowrap}
#bbResults .rsRow.total b{color:#ffd23f}
#bbResults .rsRow span{min-width:0;overflow-wrap:anywhere}

#bbResults .rsBtns{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:18px}
#bbResults .rsBtn{font-family:'Press Start 2P',monospace;font-size:calc(9px * var(--bbText, 1));
  letter-spacing:1px;padding:12px 16px;cursor:pointer;background:#0a0a20;color:#4af;
  border:2px solid #4af;border-radius:4px;transition:all .15s;max-width:100%;overflow-wrap:anywhere}
#bbResults .rsBtn:hover{background:#4af2;color:#fff}
#bbResults .rsBtn.primary{color:var(--rsAccent,#0ff);border-color:var(--rsAccent,#0ff);
  box-shadow:0 0 14px #0ff4}
#bbResults .rsBtn.primary:hover{background:#0ff2;color:#fff}
#bbResults .rsHint{font-family:'Share Tech Mono',monospace;font-size:calc(10px * var(--bbText, 1));
  color:#456;letter-spacing:1px;margin-top:14px}

@media (max-width:900px){
  #bbResults .rsTitle{font-size:calc(18px * var(--bbText, 1))}
  #bbResults .rsSub{font-size:calc(14px * var(--bbText, 1))}
  #bbResults .rsRow{font-size:calc(14px * var(--bbText, 1));padding:9px 0}
  #bbResults .rsBtn{font-size:calc(13px * var(--bbText, 1));padding:18px 20px}
  /* Три звезды в ряд — единственное, что не переносится и не сжимается. При
     250% размера текста они вылезали за панель, поэтому у них свой потолок в
     долях ширины экрана: на 375px это ~49px на звезду, ряд помещается. */
  #bbResults .rsStar{font-size:min(calc(34px * var(--bbText, 1)), 13vw)}
}
@media (max-width:900px) and (max-height:460px){
  #bbResults .rsWin{padding:14px 16px}
  #bbResults .rsTitle{font-size:calc(14px * var(--bbText, 1))}
  #bbResults .rsStars{margin:10px 0 2px}
  #bbResults .rsBtn{padding:13px 16px}
}`;
    document.head.appendChild(st);
  }

  function build() {
    styles();
    ov = document.createElement('div');
    ov.id = 'bbResults';
    ov.innerHTML =
      '<div class="rsWin">' +
        '<div class="rsTitle" id="rsTitle"></div>' +
        '<div class="rsSub" id="rsSub"></div>' +
        '<div class="rsStars" id="rsStars" style="display:none"></div>' +
        '<div class="rsBest" id="rsBest" style="display:none"></div>' +
        '<div class="rsRows" id="rsRows"></div>' +
        '<div class="rsBtns" id="rsBtns"></div>' +
        '<div class="rsHint" id="rsHint"></div>' +
      '</div>';
    // На body, а не внутрь #stage: на телефоне сцена ужата transform-ом, и
    // оверлей внутри неё уехал бы в тот же «леттербокс».
    document.body.appendChild(ov);
    // Клик мимо окна ничего не делает: экран требует осознанного выбора.
  }

  /* ── Счётчики ──────────────────────────────────────────────────────────
     Цифры набегают от нуля. Это и есть та самая «анимация», которой не хватало:
     взгляд игрока в этот момент именно здесь. Один requestAnimationFrame на все
     строки сразу, не по таймеру на каждую. */
  let settleT = 0;
  function animateNumbers(nodes, dur) {
    cancelAnimationFrame(raf);
    clearTimeout(settleT);
    const done = () => nodes.forEach((n) => { n.el.textContent = n.fmt(n.to); });
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !nodes.length) { done(); return; }

    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);            // easeOutCubic
      nodes.forEach((n) => { n.el.textContent = n.fmt(Math.round(n.to * e)); });
      if (p < 1) raf = requestAnimationFrame(step);
      else { raf = 0; done(); }
    };
    raf = requestAnimationFrame(step);
    // Страховка: requestAnimationFrame не срабатывает во вкладке/окне, которое
    // браузер считает невидимым (свёрнутая игра, фоновая вкладка). Без неё игрок
    // вернулся бы к экрану, на котором все цифры — нули. Таймеры в этом режиме
    // тоже придушены, но выполняются, поэтому итог доедет в любом случае.
    settleT = setTimeout(() => { cancelAnimationFrame(raf); raf = 0; done(); }, dur + 250);
  }

  function row(label, value, cls) {
    return '<div class="rsRow' + (cls ? ' ' + cls : '') + '"><span>' + label +
           '</span><b data-to="' + value + '">0</b></div>';
  }

  /** Кнопки: [{ключ подписи, действие, основная ли}] */
  function buttons(list) {
    const host = ov.querySelector('#rsBtns');
    host.innerHTML = list.map((b, i) =>
      '<button class="rsBtn' + (b.primary ? ' primary' : '') + '" data-i="' + i + '">' + b.label + '</button>').join('');
    host.querySelectorAll('button').forEach((btn) => {
      btn.onclick = () => { sfx('menu'); const b = list[+btn.dataset.i]; hide(); b.run(); };
    });
  }

  function bindKeys(list) {
    unbindKeys();
    onKeyBound = (e) => {
      const hit = (name) => list.find((b) => b.key === name);
      let b = null;
      if (e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter') b = list.find((x) => x.primary);
      else if (e.code === 'KeyR') b = hit('retry');
      else if (e.code === 'Escape') b = hit('leave');
      if (!b) return;
      e.preventDefault();
      sfx('menu'); hide(); b.run();
    };
    window.addEventListener('keydown', onKeyBound);
  }
  function unbindKeys() {
    if (onKeyBound) window.removeEventListener('keydown', onKeyBound);
    onKeyBound = null;
  }

  function hide() {
    unbindKeys();
    cancelAnimationFrame(raf); raf = 0;
    clearTimeout(settleT); settleT = 0;
    if (ov) ov.style.display = 'none';
  }

  /** Общая часть показа: подставить содержимое, запустить счётчики и клавиши. */
  function open(opts) {
    if (!ov) build();
    if (typeof window.hideAll === 'function') window.hideAll();
    ov.style.setProperty('--rsAccent', opts.accent || '#0ff');
    ov.querySelector('#rsTitle').textContent = opts.title;
    ov.querySelector('#rsSub').textContent = opts.sub || '';
    ov.querySelector('#rsSub').style.display = opts.sub ? '' : 'none';

    const starsHost = ov.querySelector('#rsStars');
    const bestHost = ov.querySelector('#rsBest');
    if (opts.stars != null) {
      starsHost.style.display = '';
      starsHost.innerHTML = [0, 1, 2].map((i) =>
        '<div class="rsStar' + (i < opts.stars ? ' on' : '') + '" style="--d:' + (0.12 + i * 0.16) + 's">★</div>').join('');
      bestHost.style.display = opts.starsNew ? '' : 'none';
      bestHost.textContent = opts.starsNew ? T('newBest') : '';
    } else {
      starsHost.style.display = 'none';
      bestHost.style.display = 'none';
    }

    ov.querySelector('#rsRows').innerHTML = opts.rows.join('');
    buttons(opts.buttons);
    bindKeys(opts.buttons);

    // Подсказка по клавишам не нужна там, где клавиатуры нет.
    const hint = ov.querySelector('#rsHint');
    hint.textContent = isTouch() ? '' : T('resHint');
    hint.style.display = isTouch() ? 'none' : '';

    ov.style.display = 'flex';
    try { navScr = 'results'; } catch (e) {}

    const nodes = [];
    ov.querySelectorAll('#rsRows b[data-to]').forEach((el) => {
      nodes.push({ el, to: parseInt(el.dataset.to, 10) || 0, fmt: (v) => v.toLocaleString() });
    });
    animateNumbers(nodes, 620);
  }

  /* ── Уровень пройден ───────────────────────────────────────────────────
     `data` собирает game.js — здесь только показ. */
  function showLevel(data, actions) {
    const rows = [];
    rows.push(row(data.tier || T('total'), data.flagBonus));
    rows.push(row(T('resTimeBonus'), data.timeBonus));
    if (data.coins) rows.push(row(T('coins'), data.coins));
    rows.push(row(T('resLevelScore'), data.levelScore));
    rows.push(row(T('total'), data.score, 'total'));

    const list = [
      { label: T('resNext'), primary: true, run: actions.next },
      { label: T('retry'), key: 'retry', run: actions.retry },
      { label: actions.leaveLabel, key: 'leave', run: actions.leave },
    ];
    open({
      accent: data.accent || '#0ff',
      // Свой заголовок нужен уровню дня: «УРОВЕНЬ 1 ПРОЙДЕН» там было бы враньём —
      // номера у него нет, есть слот и дата.
      title: data.title || T('resCleared', data.levelNum),
      sub: data.subtitle || '',
      stars: data.stars != null ? data.stars : null,
      starsNew: !!data.starsNew,
      rows, buttons: list,
    });
  }

  /* ── Поражение ─────────────────────────────────────────────────────────
     Раньше здесь было главное меню с одной кнопкой «Заново» — уйти на карту
     или в меню было нельзя вовсе. */
  function showGameOver(data, actions) {
    const rows = [];
    if (data.levelNum) rows.push(row(T('level'), data.levelNum));
    if (data.coins) rows.push(row(T('coins'), data.coins));
    rows.push(row(T('total'), data.score, 'total'));
    if (data.best) rows.push(row(T('resBest'), data.best));

    const list = [
      { label: T('retry'), primary: true, key: 'retry', run: actions.retry },
      { label: actions.leaveLabel, key: 'leave', run: actions.leave },
    ];
    if (actions.menu) list.push({ label: T('menu'), run: actions.menu });

    open({
      accent: '#f55',
      title: data.title || T('gameOver'),
      sub: data.sub || '',
      rows, buttons: list,
    });
  }

  function isOpen() { return !!ov && ov.style.display !== 'none'; }

  window.Results = { showLevel, showGameOver, hide, isOpen };
})();
