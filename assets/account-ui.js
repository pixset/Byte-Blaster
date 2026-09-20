// ===============================================================
//  BYTE BLASTER — ЭКРАН АККАУНТА PIXSET STUDIO
// ===============================================================
// Вход в аккаунт прямо из игры. После успешного входа лицензия подтягивается,
// Demo.on становится false, и интерфейс перезапускается уже полной версией.
//
// Модуль сам ничего не решает про демо: он только логинит и обновляет права,
// а вопросы «что заблокировано» по-прежнему задаются модулю Demo.
(function () {
  'use strict';

  const T = (k, ...a) => (typeof window.t === 'function' ? window.t(k, ...a) : k);

  let ov = null;
  let stylesDone = false;

  function ensureStyles() {
    if (stylesDone) return;
    stylesDone = true;
    const css = document.createElement('style');
    css.textContent = `
      #bbAcc{position:fixed;inset:0;z-index:70;display:none;flex-direction:column;
        align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;
        background:radial-gradient(ellipse at 50% 40%,#001a2a 0%,#04040f 70%);
        font-family:'Press Start 2P',monospace;overflow-y:auto}
      #bbAcc .acTitle{font-size:calc(16px * var(--bbFix, 1));color:#0ff;text-shadow:0 0 18px #0ff;letter-spacing:4px}
      #bbAcc .acSub{font-family:'Share Tech Mono',monospace;font-size:calc(12px * var(--bbFix, 1));color:#9fd;
        letter-spacing:1px;max-width:460px;line-height:1.9}
      #bbAcc input{font-family:'Share Tech Mono',monospace;font-size:calc(13px * var(--bbFix, 1));width:280px;max-width:80vw;
        padding:10px 12px;background:#020a12;border:2px solid #0ff6;color:#cfe;letter-spacing:1px}
      #bbAcc input:focus{outline:none;border-color:#0ff;box-shadow:0 0 14px #0ff4}
      #bbAcc .acBtn{font-family:'Press Start 2P',monospace;font-size:calc(9px * var(--bbFix, 1));padding:12px 20px;
        background:#0ff1;color:#0ff;border:2px solid #0ff;cursor:pointer;letter-spacing:2px;
        text-shadow:0 0 8px #0ff;transition:background .15s,box-shadow .15s}
      #bbAcc .acBtn:hover:not(:disabled){background:#0ff3;box-shadow:0 0 18px #0ff8}
      #bbAcc .acBtn:disabled{opacity:.45;cursor:wait}
      #bbAcc .acBtn.acBuy{color:#f0f;border-color:#f0f;background:#f0f1;text-shadow:0 0 8px #f0f}
      #bbAcc .acBtn.acBuy:hover{background:#f0f3;box-shadow:0 0 18px #f0f8}
      #bbAcc .acRow{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin-top:4px}
      #bbAcc .acMsg{font-family:'Share Tech Mono',monospace;font-size:calc(11px * var(--bbFix, 1));letter-spacing:1px;
        min-height:16px;max-width:460px;line-height:1.8}
      #bbAcc .acMsg.err{color:#f6a}
      #bbAcc .acMsg.ok{color:#6f9}
      /* Ряд карточек. Каждая тянется, но не расплывается: 340px — ширина, на
         которой строка «подпись … значение» ещё читается без переносов. */
      #bbAcc .acCards{display:flex;flex-wrap:wrap;gap:14px;align-items:stretch;
        justify-content:center;width:100%;max-width:1120px}
      #bbAcc .acCards:empty{display:none}
      #bbAcc .acCard{font-family:'Share Tech Mono',monospace;font-size:calc(12px * var(--bbFix, 1));color:#9fd;
        border:1px solid #0ff4;background:#0ff08;padding:12px 16px;text-align:left;
        flex:1 1 340px;min-width:280px;max-width:420px;line-height:1.9}
      /* Узкий экран — обратно в столбец: три колонки по 280px туда не влезут. */
      @media (max-width:980px){
        #bbAcc .acCards{flex-direction:column;align-items:center;max-width:460px}
        #bbAcc .acCard{flex:0 0 auto;width:100%;max-width:460px}
      }
      #bbAcc .acCard b{color:#0ff}
      #bbAcc .acCard .acDim{color:#7a94a8}
      #bbAcc .acCard .acLine:empty{display:none}
      /* Подпись слева, значение справа — так строки читаются столбиком,
         а длинная почта не разъезжает вёрстку. */
      #bbAcc .acCard .acLine{display:flex;gap:10px;justify-content:space-between;align-items:baseline}
      #bbAcc .acCard .acLine>b{text-align:right;word-break:break-word}
      #bbAcc .acCard .acLine.warn>b{color:#fc6}
      #bbAcc .acCard .acLine.good>b{color:#6f9}
      #bbAcc .acEdit{margin-left:8px;border:1px solid #0ff6;background:transparent;color:#0ff;
        font-family:'Share Tech Mono',monospace;font-size:calc(10px * var(--bbFix, 1));padding:1px 6px;cursor:pointer}
      #bbAcc .acEdit:hover{background:#0ff2}
      #bbAcc .acNick{margin-top:10px;padding-top:10px;border-top:1px solid #0ff3;
        display:flex;gap:8px;flex-wrap:wrap;align-items:center}
      #bbAcc .acNick input{width:180px;font-size:calc(12px * var(--bbFix, 1));padding:6px 8px}
      #bbAcc .acBtn.acMini{font-size:calc(7px * var(--bbFix, 1));padding:8px 10px}
      #bbAcc .acHint{flex-basis:100%;font-size:calc(10px * var(--bbFix, 1));color:#7a94a8;line-height:1.6}
      #bbAcc .acHint.err{color:#f6a}
      #bbAcc .acHint.ok{color:#6f9}
      #bbAcc .acCloud{margin-top:2px}
      /* Вторая половина карточки прогресса: линия вместо второй рамки. */
      #bbAcc .acPart{margin-top:14px;padding-top:12px;border-top:1px solid #0ff3}
      #bbAcc .acCloudTitle{font-family:'Press Start 2P',monospace;font-size:calc(8px * var(--bbFix, 1));color:#0ff;
        letter-spacing:1px;margin-bottom:8px;text-shadow:0 0 8px #0ff}
      #bbAcc .acCloud .acRow{justify-content:flex-start;margin-top:0}
      #bbAcc .acToggle{display:flex;align-items:center;gap:8px;margin-top:10px;
        font-size:calc(12px * var(--bbFix, 1));color:#9fd;cursor:pointer;user-select:none}
      #bbAcc .acToggle input{width:16px;height:16px;accent-color:#0ff;cursor:pointer}
      @media (max-width:640px){#bbAcc .acTitle{font-size:calc(12px * var(--bbFix, 1))}#bbAcc .acSub{font-size:calc(10px * var(--bbFix, 1))}}

      /* Кнопка в углу экрана. Прямой ребёнок body с position:fixed — иначе
         масштабирование игрового поля утащит её в леттербокс на телефоне. */
      #bbAccBtn{position:fixed;top:16px;left:16px;z-index:55;display:none;
        flex-direction:column;align-items:center;gap:7px;padding:13px 18px;
        background:#0ff1;border:2px solid #0ff8;cursor:pointer;
        transition:background .15s,box-shadow .15s,border-color .15s}
      #bbAccBtn:hover{background:#0ff3;border-color:#0ff;box-shadow:0 0 16px #0ff8}
      #bbAccBtn .abIcon{font-size:calc(28px * var(--bbFix, 1));line-height:1}
      #bbAccBtn .abAva{display:none;width:calc(30px * var(--bbFix, 1));
        height:calc(30px * var(--bbFix, 1));image-rendering:pixelated}
      #bbAccBtn .abText{font-family:'Press Start 2P',monospace;font-size:calc(9px * var(--bbFix, 1));
        letter-spacing:1px;color:#0ff;text-shadow:0 0 8px #0ff;max-width:118px;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #bbAccBtn.owned{border-color:#0f8a;background:#0f81}
      #bbAccBtn.owned .abText{color:#0f8;text-shadow:0 0 8px #0f8}
      @media (max-width:640px){
        #bbAccBtn{top:10px;left:10px;padding:9px 12px;gap:5px}
        #bbAccBtn .abIcon{font-size:calc(21px * var(--bbFix, 1))}
        #bbAccBtn .abText{font-size:calc(7px * var(--bbFix, 1));max-width:88px}
      }`;
    document.head.appendChild(css);
  }

  function build() {
    ensureStyles();
    ov = document.createElement('div');
    ov.id = 'bbAcc';
    ov.innerHTML =
      '<div class="acTitle" id="acTitle"></div>' +
      '<div class="acSub" id="acSub"></div>' +
      // Тип text, а не email: сюда можно вписать и ник, а с типом email
      // браузер такой ввод просто не принимал.
      '<input type="text" id="acEmail" autocomplete="username" placeholder="email">' +
      '<input type="password" id="acPass" autocomplete="current-password" placeholder="password">' +
      '<div class="acMsg" id="acMsg"></div>' +
      // «Назад» живёт в нижнем ряду вместе с остальными кнопками экрана: в
      // верхнем ряду она разрывала форму входа пополам, а на экране вошедшего
      // висела одна посреди пустоты.
      '<div class="acRow">' +
        '<button class="acBtn" id="acLoginBtn"></button>' +
        '<button class="acBtn acBuy" id="acBuyBtn"></button>' +
      '</div>' +
      // Три карточки стоят в ряд, а не столбиком: иначе на широком мониторе
      // экран уезжает вниз за край и до кнопок приходится прокручивать, хотя
      // справа и слева пусто. На узком экране ряд сам сворачивается в столбец.
      '<div class="acCards" id="acCards">' +
      // Профиль вошедшего игрока: что за аккаунт, что куплено, где ещё открыт.
      '<div class="acCard" id="acCard" style="display:none">' +
        '<div id="acFields"></div>' +
        // Смена ника: он виден другим игрокам в сети, поэтому правится прямо
        // здесь, а не только на сайте.
        '<div class="acNick" id="acNickEdit" style="display:none">' +
          '<input type="text" id="acNickInput" maxlength="20" autocomplete="off">' +
          '<button class="acBtn acMini" id="acNickSave"></button>' +
          '<button class="acBtn acMini" id="acNickCancel"></button>' +
          '<div class="acHint" id="acNickHint"></div>' +
        '</div>' +
      '</div>' +
      // Обе половины прогресса — в одной карточке: и сохранение, и витрина
      // говорят про одно и то же, просто одно приватно, а второе видят друзья.
      // Порознь они занимали две колонки и выглядели как несвязанные разделы.
      '<div class="acCard acCloud" id="acProgress" style="display:none">' +
        // Прогресс в аккаунте: сохранить, забрать, включить автосохранение.
        '<div id="acCloud">' +
          '<div class="acCloudTitle" id="acCloudTitle"></div>' +
          '<div class="acLine acDim" id="acCloudWhen"></div>' +
          '<div class="acRow" style="margin-top:8px">' +
            '<button class="acBtn acMini" id="acCloudSave"></button>' +
            '<button class="acBtn acMini" id="acCloudLoad"></button>' +
          '</div>' +
          '<label class="acToggle"><input type="checkbox" id="acCloudAuto">' +
            '<span id="acCloudAutoText"></span></label>' +
          '<div class="acHint" id="acCloudMsg"></div>' +
        '</div>' +
        // Витрина прогресса. Сохранение приватно, а это то, что видят друзья
        // на сайте; раньше оно уезжало только заодно с сохранением, поэтому у
        // игрока, не пользующегося облаком, профиль на сайте оставался пустым.
        '<div id="acStats" class="acPart">' +
          '<div class="acCloudTitle" id="acStatsTitle"></div>' +
          '<div class="acLine acDim" id="acStatsWhat"></div>' +
          '<div class="acRow" style="margin-top:8px">' +
            '<button class="acBtn acMini" id="acStatsPublish"></button>' +
          '</div>' +
          '<label class="acToggle"><input type="checkbox" id="acStatsAuto">' +
            '<span id="acStatsAutoText"></span></label>' +
          '<div class="acHint" id="acStatsMsg"></div>' +
        '</div>' +
      '</div>' +
      '</div>' +   // /acCards
      '<div class="acRow">' +
        '<button class="acBtn" id="acStatsBtn" style="display:none"></button>' +
        '<button class="acBtn" id="acSiteBtn" style="display:none"></button>' +
        '<button class="acBtn" id="acRefreshBtn" style="display:none"></button>' +
        '<button class="acBtn" id="acLogoutBtn" style="display:none"></button>' +
        '<button class="acBtn" id="acCloseBtn"></button>' +
      '</div>';
    document.body.appendChild(ov);

    ov.querySelector('#acLoginBtn').onclick = doLogin;
    ov.querySelector('#acBuyBtn').onclick = openStore;
    ov.querySelector('#acCloseBtn').onclick = close;
    ov.querySelector('#acLogoutBtn').onclick = doLogout;

    ov.querySelector('#acNickSave').onclick = saveNick;
    ov.querySelector('#acNickCancel').onclick = () => {
      ov.querySelector('#acNickEdit').style.display = 'none';
    };
    ov.querySelector('#acNickInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveNick();
      if (e.key === 'Escape') ov.querySelector('#acNickEdit').style.display = 'none';
    });

    ov.querySelector('#acCloudSave').onclick = cloudSave;
    ov.querySelector('#acCloudLoad').onclick = cloudLoad;
    ov.querySelector('#acCloudAuto').onchange = (e) => {
      window.CloudSave.setAuto(e.target.checked);
      cloudMsg(e.target.checked ? T('cloudAutoOn') : T('cloudAutoOff'), 'ok');
    };

    ov.querySelector('#acStatsPublish').onclick = publishStats;
    ov.querySelector('#acStatsAuto').onchange = (e) => {
      try { localStorage.setItem(STATS_AUTO_KEY, e.target.checked ? '1' : '0'); } catch (err) {}
      statsMsg(e.target.checked ? T('statsAutoOn') : T('statsAutoOff'), 'ok');
    };

    // Подробная статистика уже есть на экране профиля игрока — незачем
    // повторять её здесь, достаточно провести туда.
    ov.querySelector('#acStatsBtn').onclick = () => {
      close();
      if (window.Profile && typeof window.Profile.show === 'function') window.Profile.show();
    };

    // Ник, почта, удаление аккаунта — это редкие действия, им место на сайте,
    // а не в игровом меню. Отсюда просто открываем страницу профиля.
    ov.querySelector('#acSiteBtn').onclick = () => {
      openUrl('https://pixset-studio.github.io/byte-blaster/account/');
    };

    // Кнопка на случай, когда игру купили только что: заново спрашиваем права,
    // не дожидаясь фонового обновления.
    ov.querySelector('#acRefreshBtn').onclick = async () => {
      const btn = ov.querySelector('#acRefreshBtn');
      btn.disabled = true;
      msg(T('accChecking'));
      try {
        await window.License.refresh();
        if (window.License.hasGame('byte-blaster')) {
          msg(T('accFullUnlocked'), 'ok');
          setTimeout(() => location.reload(), 1200);
        } else {
          msg(T('accNoLicense'), 'err');
          render();
        }
      } catch (e) {
        msg(T('accOffline'), 'err');
      } finally { btn.disabled = false; }
    };
    ov.querySelector('#acPass').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doLogin();
    });
    // Игра слушает клавиши глобально: пока открыт экран, ввод не должен
    // управлять роботом.
    ['keydown', 'keyup', 'keypress'].forEach((type) => {
      ov.addEventListener(type, (e) => e.stopPropagation(), true);
    });
  }

  function msg(text, kind) {
    const el = ov.querySelector('#acMsg');
    el.textContent = text || '';
    el.className = 'acMsg' + (kind ? ' ' + kind : '');
  }

  // Кабинет и магазин — наши же страницы, и открываются они внутри игры.
  // Запасной путь на случай, если модуль браузера почему-то не загрузился:
  // лучше выкинуть игрока наружу, чем не открыть ссылку вовсе.
  function openUrl(url) {
    if (!url) return;
    if (window.BBBrowser) { window.BBBrowser.open(url); return; }
    if (window.SFX && window.SFX.menu) window.SFX.menu();
    try {
      if (window.electronAPI && typeof window.electronAPI.openExternal === 'function') {
        window.electronAPI.openExternal(url);
        return;
      }
    } catch (e) {}
    try { window.open(url, '_blank', 'noopener'); } catch (e) {}
  }

  function openStore() {
    openUrl((window.License && window.License.storeUrl) || window.BB_STORE_URL || '');
  }

  async function doLogin() {
    const email = ov.querySelector('#acEmail').value.trim();
    const pass = ov.querySelector('#acPass').value;
    if (!email || !pass) { msg(T('accNeedFields'), 'err'); return; }

    const btn = ov.querySelector('#acLoginBtn');
    btn.disabled = true;
    msg(T('accChecking'));
    try {
      await window.License.login(email, pass);
      ov.querySelector('#acPass').value = '';
      if (window.License.hasGame('byte-blaster')) {
        msg(T('accFullUnlocked'), 'ok');
        // Меню уже нарисовано с замками демо, и часть подписей заменена.
        // Перерисовать всё точечно — значит гоняться за каждой строкой; проще
        // и надёжнее перезапустить интерфейс. Игрок в меню, прогресс сохранён.
        setTimeout(() => location.reload(), 1400);
      } else {
        msg(T('accNoLicense'), 'err');
        render();
      }
    } catch (err) {
      const m = String(err && err.message || '').toLowerCase();
      if (m.indexOf('invalid') !== -1 || m.indexOf('credentials') !== -1) msg(T('accBadLogin'), 'err');
      else if (m.indexOf('email not confirmed') !== -1) msg(T('accNotConfirmed'), 'err');
      else if (m.indexOf('failed to fetch') !== -1) msg(T('accOffline'), 'err');
      else if (m.indexOf('server_unavailable') !== -1 || m.indexOf('entitlements_') !== -1) {
        // Вход прошёл, но права не выдались. Раньше игрок видел «что-то пошло
        // не так», а при следующем открытии — «нет лицензии», хотя она есть.
        msg(T('accRightsFailed'), 'err');
      } else msg(T('accError'), 'err');
      // Сессия сохранена даже при неудаче — показываем профиль, чтобы было
      // видно, под кем вошли, и была кнопка «проверить снова».
      render();
    } finally {
      btn.disabled = false;
    }
  }

  function doLogout() {
    window.License.logout();
    msg(T('accLoggedOut'), 'ok');
    // Из полной версии обратно в демо — по той же причине через перезапуск.
    setTimeout(() => location.reload(), 1200);
  }

  function render() {
    const owns = window.License && window.License.hasGame('byte-blaster');
    const inAcc = window.License && window.License.loggedIn();

    ov.querySelector('#acTitle').textContent = T('accTitle');
    // У временного доступа своя подпись: «спасибо за поддержку студии» тому,
    // кто пришёл по промокоду, говорить не за что, а вот про срок сказать надо.
    const tempLic = owns && licenceEndsAt();
    ov.querySelector('#acSub').textContent = tempLic ? T('accSubTemp')
                                          : owns ? T('accSubOwned')
                                          : inAcc ? T('accSubNoLicense')
                                                  : T('accSubGuest');
    // Подсказка в поле — на языке игры: войти можно и по нику.
    ov.querySelector('#acEmail').placeholder = T('accLoginPh');
    ov.querySelector('#acLoginBtn').textContent = T('accLogin');
    ov.querySelector('#acBuyBtn').textContent = T('accBuy');
    ov.querySelector('#acCloseBtn').textContent = T('accClose');
    ov.querySelector('#acLogoutBtn').textContent = T('accLogout');

    ov.querySelector('#acSiteBtn').textContent = T('accManage');
    ov.querySelector('#acRefreshBtn').textContent = T('accRecheck');
    ov.querySelector('#acStatsBtn').textContent = T('profileBtn');
    ov.querySelector('#acNickSave').textContent = T('save');
    ov.querySelector('#acNickCancel').textContent = T('cancel');

    // Вошедшему форма не нужна — ему нужен профиль, обновление прав и выход.
    ov.querySelector('#acEmail').style.display = inAcc ? 'none' : '';
    ov.querySelector('#acPass').style.display = inAcc ? 'none' : '';
    ov.querySelector('#acLoginBtn').style.display = inAcc ? 'none' : '';
    ov.querySelector('#acBuyBtn').style.display = owns ? 'none' : '';
    ov.querySelector('#acLogoutBtn').style.display = inAcc ? '' : 'none';
    ov.querySelector('#acSiteBtn').style.display = inAcc ? '' : 'none';
    // Экран профиля есть только в самой игре — гостю показывать нечего.
    ov.querySelector('#acStatsBtn').style.display =
      inAcc && window.Profile && typeof window.Profile.show === 'function' ? '' : 'none';
    ov.querySelector('#acNickEdit').style.display = 'none';
    // «Проверить снова» нужна и когда прав нет, и когда их не удалось получить.
    ov.querySelector('#acRefreshBtn').style.display = inAcc && !owns ? '' : 'none';

    renderCard(inAcc, owns);
    renderCloud(inAcc);
    renderStats(inAcc);

    // Карточка прогресса состоит из двух половин, и каждая может отсутствовать
    // (нет облака, нет витрины). Показываем её, только если есть хоть одна —
    // пустая рамка выглядела бы поломкой.
    const cloudOn = ov.querySelector('#acCloud').style.display !== 'none';
    const statsOn = ov.querySelector('#acStats').style.display !== 'none';
    ov.querySelector('#acProgress').style.display = (cloudOn || statsOn) ? 'block' : 'none';

    // У гостя карточек нет вовсе — прячем и сам ряд, иначе пустой контейнер
    // оставлял бы лишний отступ между формой входа и кнопками.
    ov.querySelector('#acCards').style.display = inAcc ? '' : 'none';
  }

  /**
   * Дата окончания доступа к игре — или null, если лицензия бессрочная.
   * Бессрочная — это покупка и ручная выдача; срок бывает только у промокода.
   */
  function licenceEndsAt() {
    const L = window.License;
    const lic = L && L.licence ? L.licence('byte-blaster') : null;
    return (lic && lic.valid_until) || null;
  }

  /** Дата в языке игры. Пустая строка, если сервер её не прислал. */
  function fmtDate(value) {
    if (!value) return '';
    const d = new Date(typeof value === 'number' ? value * 1000 : value);
    if (isNaN(d.getTime())) return '';
    try {
      return d.toLocaleDateString(window.currentLang || undefined,
        { year: 'numeric', month: 'long', day: 'numeric' });
    } catch (e) { return d.toISOString().slice(0, 10); }
  }

  /**
   * Карточка профиля: кто вошёл, что куплено, на скольких устройствах,
   * до какого числа действуют права и как идут дела в самой игре.
   * Все данные приезжают в подписанном токене, поэтому карточка полная и
   * без интернета.
   */
  function renderCard(inAcc, owns) {
    const card = ov.querySelector('#acCard');
    card.style.display = inAcc ? 'block' : 'none';
    if (!inAcc) return;

    const L = window.License;
    const nick = L.nickname();
    const mail = L.email();
    const problem = L.problem && L.problem();
    const lic = L.licence ? L.licence('byte-blaster') : null;
    const devices = L.deviceCount ? L.deviceCount() : null;

    const rows = [];
    const add = (label, value, kind) => {
      if (value === null || value === undefined || value === '') return;
      rows.push({ label, value, kind });
    };

    // Ник приходит вместе с правами. Пока их нет, показываем почту — это
    // лучше пустой строки: игрок хотя бы видит, под каким аккаунтом вошёл.
    add(T('accWho'), nick || mail || '—');
    if (nick && mail) add(T('accMail'), mail);

    // Права на руках важнее ответа сервера: подписанный токен действует и в
    // офлайне. «Неизвестно» уместно, только когда лицензии нет И спросить не
    // удалось — иначе владелец видел бы «неизвестно» при любом обрыве связи.
    add(T('accLicences'),
      owns ? T('accOwnedYes') : (problem ? T('accRightsUnknown') : T('accOwnedNo')),
      owns ? 'good' : (problem ? 'warn' : ''));

    if (lic) {
      const when = fmtDate(lic.granted_at);
      if (when) {
        const how = lic.source === 'manual' ? T('accGrantedManual')
          : lic.source === 'promo' ? T('accGrantedPromo')
            : T('accGrantedBuy');
        add(how, when);
      }
      // Доступ по промокоду кончается в известный день, и знать этот день
      // игрок должен заранее — иначе полная версия однажды просто исчезнет.
      // В последние дни строка становится жёлтой: это уже повод купить игру.
      const till = fmtDate(lic.valid_until);
      if (till) {
        const leftDays = Math.ceil((Date.parse(lic.valid_until) - Date.now()) / 86400000);
        add(T('accAccessUntil'), till, leftDays <= 3 ? 'warn' : '');
      }
    }

    add(T('accDevice'), L.platformLabel ? L.platformLabel() : '');
    if (devices) add(T('accDevices'), String(devices));
    add(T('accSince'), fmtDate(L.memberSince ? L.memberSince() : null));

    // Срок самого токена не показываем: у купленной игры лицензия бессрочна, а
    // токен — наша внутренняя кухня, игра продлевает его при запуске. Дата выше
    // относится к другому: к сроку самой лицензии, выданной промокодом.

    // Игровая часть профиля: то, ради чего в аккаунт и заходят.
    const snap = safeSnapshot();
    if (snap) {
      add(T('profileLevels'), snap.done + '/' + snap.total);
      if (typeof snap.percent === 'number') add(T('profileCompletion'), snap.percent + '%');
    }

    ov.querySelector('#acFields').innerHTML = rows.map((r) =>
      '<div class="acLine' + (r.kind ? ' ' + r.kind : '') + '">' +
        '<span>' + esc(r.label) + '</span><b>' + esc(r.value) + '</b>' +
      '</div>').join('') +
      // Владельцу неудача обновления не мешает играть — ему достаточно
      // спокойной пометки, а тревожную строку видит тот, у кого прав нет.
      (problem
        ? '<div class="acLine acDim">' + esc(owns ? T('accOffline') : T('accRightsFailed')) + '</div>'
        : (L.stale() ? '<div class="acLine acDim">' + esc(T('accStale')) + '</div>' : ''));

    // Кнопка смены ника подставляется в строку с ником: менять его без
    // лицензии тоже можно — это данные аккаунта, а не игры.
    const first = ov.querySelector('#acFields .acLine b');
    if (first && nick !== null) {
      const btn = document.createElement('button');
      btn.className = 'acEdit';
      btn.id = 'acNickBtn';
      btn.textContent = '✎';
      btn.title = T('accNickChange');
      btn.onclick = openNickEditor;
      first.appendChild(btn);
    }
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** Сводка прогресса из игрового профиля. Его может не быть — это не беда. */
  function safeSnapshot() {
    try {
      if (!window.Profile || typeof window.Profile.snapshot !== 'function') return null;
      const s = window.Profile.snapshot();
      if (!s) return null;
      const percent = typeof window.Profile.completion === 'function'
        ? Math.round(window.Profile.completion(s) * 100) : null;
      return { done: s.done, total: s.total, percent };
    } catch (e) { return null; }
  }

  /* ── Прогресс в аккаунте ───────────────────────────────────────────── */
  function cloudMsg(text, kind) {
    const el = ov.querySelector('#acCloudMsg');
    el.textContent = text || '';
    el.className = 'acHint' + (kind ? ' ' + kind : '');
  }

  /* ── Витрина прогресса ───────────────────────────────────────────────────
     Публикуется отдельно от сохранения и намеренно: сохранение приватно,
     а это короткая сводка, которую видят друзья на сайте. Раньше она уезжала
     только заодно с облачным сохранением, поэтому у игрока, который им не
     пользуется, профиль на сайте оставался пустым — что и выглядело как
     «публиковать прогресс нельзя». */
  const STATS_AUTO_KEY = 'bbStatsAuto';

  function statsAutoOn() {
    try { return localStorage.getItem(STATS_AUTO_KEY) !== '0'; } catch (e) { return true; }
  }

  function statsMsg(text, kind) {
    const el = ov && ov.querySelector('#acStatsMsg');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'acHint' + (kind ? ' ' + kind : '');
  }

  async function publishStats() {
    const btn = ov.querySelector('#acStatsPublish');
    btn.disabled = true;
    statsMsg(T('statsPublishing'));
    try {
      const ok = await window.Friends.publish();
      statsMsg(ok ? T('statsPublished') : T('statsFailed'), ok ? 'ok' : 'err');
    } catch (e) {
      statsMsg(T('statsFailed'), 'err');
    } finally { btn.disabled = false; }
  }

  function renderStats(inAcc) {
    const box = ov.querySelector('#acStats');
    const has = inAcc && !!window.Friends;
    box.style.display = has ? 'block' : 'none';
    if (!has) return;
    ov.querySelector('#acStatsTitle').textContent = T('statsTitle');
    ov.querySelector('#acStatsWhat').textContent = T('statsWhat');
    ov.querySelector('#acStatsPublish').textContent = T('statsPublish');
    ov.querySelector('#acStatsAutoText').textContent = T('statsAuto');
    ov.querySelector('#acStatsAuto').checked = statsAutoOn();
    statsMsg('');
  }

  // Наружу — чтобы игра могла публиковать сводку сама после уровня.
  window.bbStatsAutoOn = statsAutoOn;

  /** Показывает, когда и с какого устройства сохраняли в последний раз. */
  function renderCloud(inAcc) {
    const box = ov.querySelector('#acCloud');
    const has = inAcc && !!window.CloudSave;
    box.style.display = has ? 'block' : 'none';
    if (!has) return;

    ov.querySelector('#acCloudTitle').textContent = T('cloudTitle');
    ov.querySelector('#acCloudSave').textContent = T('save');
    ov.querySelector('#acCloudLoad').textContent = T('cloudLoad');
    ov.querySelector('#acCloudAutoText').textContent = T('cloudAuto');
    ov.querySelector('#acCloudAuto').checked = window.CloudSave.autoEnabled();
    cloudMsg('');

    const when = ov.querySelector('#acCloudWhen');
    when.textContent = T('accChecking');
    window.CloudSave.peek().then((row) => {
      if (!row) { when.textContent = T('cloudEmpty'); return; }
      const date = new Date(row.updated_at);
      const stamp = isNaN(date.getTime()) ? '' : date.toLocaleString(window.currentLang || undefined);
      when.textContent = T('cloudLast', stamp) + (row.device ? ' · ' + row.device : '');
    }).catch(() => { when.textContent = T('cloudOffline'); });
  }

  /**
   * Текст под кнопками. Отказ сервера и пропавшая сеть — разные беды, и
   * лечатся по-разному: одно ждёт связи, другое чинится нами.
   */
  function cloudError(e) {
    const status = e && e.status;
    if (status === 413 || /too_big/.test(String(e && e.detail))) return T('cloudTooBig');
    if (status === 401 || status === 403) return T('accRightsFailed');
    if (status) return T('accError');       // сервер ответил, но отказом
    return T('cloudOffline');               // до сервера вовсе не дошли
  }

  async function cloudSave() {
    const btn = ov.querySelector('#acCloudSave');
    btn.disabled = true;
    cloudMsg(T('cloudSaving'));
    try {
      await window.CloudSave.save();
      cloudMsg(T('cloudSavedOk'), 'ok');
      renderCloud(true);
    } catch (e) {
      cloudMsg(cloudError(e), 'err');
    } finally { btn.disabled = false; }
  }

  async function cloudLoad() {
    // Загрузка затирает прогресс этого устройства — спрашиваем прямо.
    if (!confirm(T('cloudLoadConfirm'))) return;

    const btn = ov.querySelector('#acCloudLoad');
    btn.disabled = true;
    cloudMsg(T('cloudLoading'));
    try {
      const when = await window.CloudSave.load();
      if (!when) { cloudMsg(T('cloudEmpty'), 'err'); return; }
      cloudMsg(T('cloudLoadedOk'), 'ok');
      // Прогресс уже лежит в хранилище, но игра прочитала его при запуске —
      // проще перезапустить интерфейс, чем обновлять каждый экран.
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      cloudMsg(cloudError(e), 'err');
    } finally { btn.disabled = false; }
  }

  /* ── Смена ника ────────────────────────────────────────────────────── */
  function openNickEditor() {
    const box = ov.querySelector('#acNickEdit');
    const input = ov.querySelector('#acNickInput');
    box.style.display = 'flex';
    input.value = window.License.nickname() || '';
    nickHint(T('accNickRules'));
    input.focus();
    input.select();
  }

  function nickHint(text, kind) {
    const el = ov.querySelector('#acNickHint');
    el.textContent = text || '';
    el.className = 'acHint' + (kind ? ' ' + kind : '');
  }

  async function saveNick() {
    const input = ov.querySelector('#acNickInput');
    const value = input.value.trim();
    const btn = ov.querySelector('#acNickSave');
    if (!value) { nickHint(T('accNickRules'), 'err'); return; }

    btn.disabled = true;
    nickHint(T('accChecking'));
    try {
      await window.License.setNickname(value);
      nickHint(T('accNickOk'), 'ok');
      setTimeout(() => {
        ov.querySelector('#acNickEdit').style.display = 'none';
        render();
        updateCornerButton();
      }, 900);
    } catch (err) {
      const m = String((err && err.message) || '').toLowerCase();
      if (m.indexOf('bad_nickname') !== -1) nickHint(T('accNickRules'), 'err');
      else if (m.indexOf('nickname_taken') !== -1) nickHint(T('accNickTaken'), 'err');
      else if (m.indexOf('nickname_too_soon') !== -1) nickHint(T('accNickSoon'), 'err');
      else if (m.indexOf('failed to fetch') !== -1) nickHint(T('accOffline'), 'err');
      else nickHint(T('accError'), 'err');
    } finally { btn.disabled = false; }
  }

  function open() {
    if (!ov) build();
    render();
    msg('');
    ov.style.display = 'flex';
    if (window.SFX && window.SFX.menu) window.SFX.menu();
    // Пока экран открыт, обновим права: игрок мог купить игру в браузере
    // минуту назад и вернуться в игру.
    if (window.License && window.License.loggedIn()) {
      window.License.refreshQuietly().then((p) => {
        if (p) render();
      });
    }
  }

  function close() {
    if (ov) ov.style.display = 'none';
    if (window.SFX && window.SFX.back) window.SFX.back();
  }

  function isOpen() { return !!ov && ov.style.display === 'flex'; }

  window.AccountUI = { open, close, isOpen };

  // ── Кнопка в левом верхнем углу ─────────────────────────────────────────
  // Живёт в углу главного меню, а не в общем столбце кнопок: аккаунт — это
  // статус игрока, а не пункт «что делать дальше».
  let cornerBtn = null;

  function buildCornerButton() {
    ensureStyles();
    cornerBtn = document.createElement('div');
    cornerBtn.id = 'bbAccBtn';
    // Аватарка вместо эмодзи, когда игрок вошёл и профиль доступен. Эмодзи
    // остаётся запасным вариантом: без входа рисовать нечего.
    cornerBtn.innerHTML = '<canvas class="abAva" width="64" height="64"></canvas>'
      + '<span class="abIcon">👤</span><span class="abText"></span>';
    cornerBtn.onclick = open;
    document.body.appendChild(cornerBtn);
    updateCornerButton();
    // Показываем только на главном меню. Опрос дешевле, чем вешать хуки на
    // каждый переход между экранами игры.
    setInterval(updateCornerButton, 400);
  }

  /**
   * Есть ли поверх меню другой экран во весь экран.
   *
   * Одного «видно главное меню» мало: настройки и профиль рисуются на body
   * поверх него, а сам mainOv при этом остаётся видимым — и кнопка аккаунта
   * висела над чужим экраном. Смотрим не список известных окон (их легко
   * забыть пополнить), а признак: перекрывает ли что-то экран целиком.
   */
  function coveredByScreen() {
    const mine = parseInt(getComputedStyle(cornerBtn).zIndex, 10) || 0;
    for (const el of document.body.children) {
      if (el === cornerBtn) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
      if ((parseInt(cs.zIndex, 10) || 0) <= mine) continue;
      const r = el.getBoundingClientRect();
      if (r.width >= innerWidth * 0.8 && r.height >= innerHeight * 0.8) return true;
    }
    return false;
  }

  // Состояние аккаунтной аватарки. Держим картинку загруженной один раз:
  // updateCornerButton зовут четыре раза в секунду, и создавать Image на
  // каждый опрос значило бы дёргать декодер вхолостую.
  let _accImg = null, _accSrc = null, _accFetched = false, _lastNick = null;

  /** Вписывает картинку в квадрат канваса по короткой стороне, без сплющивания. */
  function drawCover(cv, img) {
    const c = cv.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, cv.width, cv.height);
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    if (!side) throw new Error('empty_image');
    c.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2,
                side, side, 0, 0, cv.width, cv.height);
  }

  function updateCornerButton() {
    if (!cornerBtn) return;
    const main = document.getElementById('mainOv');
    const onMenu = !!main && getComputedStyle(main).display !== 'none'
      && !coveredByScreen();
    cornerBtn.style.display = onMenu ? 'flex' : 'none';
    if (!onMenu) return;

    const nick = window.License && window.License.nickname();
    const owns = window.License && window.License.hasGame('byte-blaster');
    cornerBtn.classList.toggle('owned', !!owns);
    cornerBtn.querySelector('.abText').textContent = nick || T('accMenuBtnShort');

    // Аватарка: нужен вход, доступный профиль и выбранная аватарка. Любое
    // условие не выполнено — остаётся эмодзи, а не пустой квадрат.
    const ava = cornerBtn.querySelector('.abAva');
    const emo = cornerBtn.querySelector('.abIcon');
    const P = window.Profile;
    let painted = false;

    // Смена аккаунта — повод сходить за картинкой заново.
    if (nick !== _lastNick) { _lastNick = nick; _accFetched = false; }
    if (nick && !_accFetched && window.License
        && typeof window.License.fetchAccountAvatar === 'function') {
      _accFetched = true;
      window.License.fetchAccountAvatar().catch(() => {});
    }

    // Кнопка представляет аккаунт Pixset Studio, поэтому его аватарка идёт
    // первой. Игровая — запасной вариант: картинки в аккаунте может не быть,
    // она может не успеть доехать или оказаться битой.
    const accUrl = (window.License && typeof window.License.accountAvatar === 'function')
      ? window.License.accountAvatar() : null;
    if (ava && nick && accUrl) {
      if (ava.dataset.drawn === accUrl) {
        painted = true;
      } else if (_accImg && _accSrc === accUrl && _accImg.complete && _accImg.naturalWidth) {
        try { drawCover(ava, _accImg); ava.dataset.drawn = accUrl; painted = true; }
        catch (e) { painted = false; }
      } else if (_accSrc !== accUrl) {
        // Грузим один раз на смену картинки; отрисуется на следующем опросе.
        _accSrc = accUrl;
        _accImg = new Image();
        _accImg.onerror = () => { _accSrc = null; _accImg = null; };
        _accImg.src = accUrl;
      }
    }

    if (!painted && ava && nick && P
        && typeof P.paintAvatar === 'function' && typeof P.avatar === 'function') {
      const id = P.avatar();
      if (id) {
        // Перерисовываем только при смене аватарки: опрос идёт четыре раза в
        // секунду, а рисование ручное.
        if (ava.dataset.drawn !== id) {
          try { P.paintAvatar(ava, id); ava.dataset.drawn = id; painted = true; }
          catch (e) { painted = false; }
        } else painted = true;
      }
    }
    if (ava) ava.style.display = painted ? 'block' : 'none';
    if (emo) emo.style.display = painted ? 'none' : 'block';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildCornerButton, { once: true });
  } else {
    buildCornerButton();
  }
})();
