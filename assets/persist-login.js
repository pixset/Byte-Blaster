// ═══════════════════════════════════════════════════════════════════════════
//  ВХОД, КОТОРЫЙ ПЕРЕЖИВАЕТ ОБНОВЛЕНИЕ (только сборка .exe)
// ═══════════════════════════════════════════════════════════════════════════
//
// Аккаунт, лицензия и часы лежали только в localStorage — а это профиль
// Chromium, и пишется он на диск с задержкой. При обновлении игра закрывается
// принудительно, чтобы установщик мог заменить файлы, и последняя запись до
// диска не доезжает. Беда в том, что этой последней записью обычно оказывается
// свежая сессия: токен обновления одноразовый, потраченный старый уже
// недействителен, и следующий запуск получал от сервера отказ — игрока
// выбрасывало из аккаунта, хотя он ничего не нажимал.
//
// Здесь вход перекладывается в обычный файл рядом с сохранениями. Ключи входа
// пишутся немедленно, без всякой отложенной записи, а localStorage остаётся
// зеркалом — читают оттуда не только мы: апдейтер, например, берёт токен
// напрямую.
//
// В браузере и на Android модуль ничего не делает: там localStorage никуда не
// девается, а моста к файлам нет.
(function () {
  'use strict';

  const api = window.loginStore;
  if (!api || typeof api.all !== 'function') return;      // не настольная сборка
  if (!window.License || typeof window.License.setStorage !== 'function') return;

  // Что именно бережём. Список закрытый: складывать в защищённый файл всё
  // подряд незачем — настройки и прогресс сохраняются своими путями.
  const KEYS = [
    'pixset.license',   // подписанный токен прав
    'pixset.session',   // вход в аккаунт
    'pixset.clock',     // максимальное виденное время (защита от перевода часов)
    'pixset.device',    // отпечаток устройства
    'pixset.avatar',    // аватар для кнопки аккаунта
  ];

  const mem = api.all() || {};

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  // Ради чего всё затевалось: сессия и токен прав пишутся СРАЗУ. Меняются они
  // редко (раз в час), а потерять их — и есть та самая пропажа аккаунта.
  const NOW_KEYS = { 'pixset.session': 1, 'pixset.license': 1 };
  // Остальное можно отложить: часы обновляются на каждом обращении, и гонять
  // файл при каждом таком чихе смысла нет.
  let timer = 0;
  function flush() {
    if (timer) { clearTimeout(timer); timer = 0; }
    api.save(mem);
  }
  function schedule(key) {
    if (key && NOW_KEYS[key]) { flush(); return; }
    if (timer) return;
    timer = setTimeout(() => { timer = 0; api.save(mem); }, 400);
  }

  /* ── Сведение двух хранилищ при старте ─────────────────────────────────────
     Файл главнее: если он есть, значит игрок уже входил, и именно эти значения
     переживут следующее обновление. Чего в файле нет — забираем из браузерного
     хранилища (первый запуск после добавления этого модуля). */
  let dirty = false;
  KEYS.forEach((k) => {
    const fromFile = mem[k];
    const fromLS = lsGet(k);
    if (fromFile != null && fromFile !== fromLS) { lsSet(k, fromFile); }
    else if (fromFile == null && fromLS != null) { mem[k] = fromLS; dirty = true; }
  });
  if (dirty) schedule();

  window.License.setStorage({
    get(k) {
      if (Object.prototype.hasOwnProperty.call(mem, k) && mem[k] != null) return mem[k];
      // Ключ не из нашего списка (или появился позже) — работаем как раньше.
      const v = lsGet(k);
      if (v != null && KEYS.indexOf(k) !== -1) { mem[k] = v; schedule(k); }
      return v;
    },
    set(k, v) {
      if (KEYS.indexOf(k) !== -1) { mem[k] = v; schedule(k); }
      lsSet(k, v);   // зеркало: апдейтер и облачные сохранения читают напрямую
    },
    remove(k) {
      if (Object.prototype.hasOwnProperty.call(mem, k)) { delete mem[k]; schedule(k); }
      lsDel(k);
    },
  });

  // Закрытие окна — последний шанс дописать отложенное.
  window.addEventListener('pagehide', () => { try { flush(); } catch (e) {} });
})();
