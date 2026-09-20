/* ===========================================================================
   Тест сохранения входа в аккаунт (assets/license.js).

   Зачем. Игрока выкидывало из аккаунта при каждом перезапуске: ник и лицензия
   оставались на месте (они лежат в подписанном токене), а сессия исчезала —
   и игра снова просила почту с паролем. Здесь проверяется, что сессия
   переживает всё, что не является прямым отказом сервера в токене.

   Запуск:  node test-license-session.js      (из папки Game, зависимостей нет)
   =========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, 'assets', 'license.js');

/** Свежий экземпляр модуля со своим хранилищем и своим поддельным fetch. */
function makeSdk(handler) {
  const store = new Map();
  const calls = [];

  const sandbox = {
    console, setTimeout, clearTimeout, Date, JSON, Math, Error, Number, String,
    parseInt, parseFloat, isNaN, Promise, Object, Array, TextDecoder,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    crypto: { subtle: {}, randomUUID: () => 'test-device' },
    navigator: { userAgent: 'node' },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    fetch: (url, opts) => {
      const body = JSON.parse(opts.body || '{}');
      calls.push({ url, body });
      return Promise.resolve(handler(url, body, calls.length));
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox);
  return { License: sandbox.window.License, store, calls };
}

const ok = (obj) => ({ ok: true, status: 200, json: () => Promise.resolve(obj) });
const fail = (status, obj) => ({ ok: false, status, json: () => Promise.resolve(obj || {}) });

const now = () => Math.floor(Date.now() / 1000);
/** Просроченная сессия — именно с ней игра стартует после перезапуска. */
const expiredSession = () => JSON.stringify({
  access_token: 'old', refresh_token: 'R1', expires_at: now() - 10,
  user: { email: 'p@example.com' },
});

let failed = 0;
function check(name, got, want) {
  const good = JSON.stringify(got) === JSON.stringify(want);
  if (!good) failed++;
  console.log((good ? '✔ ' : '✘ ') + name +
    (good ? '' : '\n    получено:  ' + JSON.stringify(got) +
                 '\n    ожидалось: ' + JSON.stringify(want)));
}
const sessionOf = (sdk) => {
  const raw = sdk.store.get('pixset.session');
  return raw ? JSON.parse(raw) : null;
};

(async () => {
  // ── 1. Ответ без expires_at: срок обязан досчитаться ──────────────────────
  {
    const sdk = makeSdk(() => ok({ access_token: 'A1', refresh_token: 'R2', expires_in: 3600 }));
    sdk.store.set('pixset.session', expiredSession());
    const t = await sdk.License.accessToken();
    const s = sessionOf(sdk);
    check('обновление вернуло новый токен', t, 'A1');
    check('срок досчитан из expires_in', typeof s.expires_at === 'number' && s.expires_at > now(), true);
    check('новый refresh-токен сохранён', s.refresh_token, 'R2');
  }

  // ── 2. Живая сессия обновления не требует ────────────────────────────────
  {
    const sdk = makeSdk(() => ok({ access_token: 'НЕ ДОЛЖНО ПОНАДОБИТЬСЯ' }));
    sdk.store.set('pixset.session', JSON.stringify({
      access_token: 'A0', refresh_token: 'R1', expires_at: now() + 3600,
    }));
    const t = await sdk.License.accessToken();
    check('живой токен отдан без запроса', t, 'A0');
    check('в сеть не ходили', sdk.calls.length, 0);
  }

  // ── 3. Гонка: три параллельных запроса — один поход в сеть ───────────────
  {
    const sdk = makeSdk((url, body, n) => {
      // Так ведёт себя Supabase: refresh-токен одноразовый.
      if (body.refresh_token === 'R1' && n === 1) {
        return ok({ access_token: 'A1', refresh_token: 'R2', expires_in: 3600 });
      }
      return fail(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token: Already Used' });
    });
    sdk.store.set('pixset.session', expiredSession());
    const [a, b, c] = await Promise.all([
      sdk.License.accessToken(), sdk.License.accessToken(), sdk.License.accessToken(),
    ]);
    check('все три вызова получили один токен', [a, b, c], ['A1', 'A1', 'A1']);
    check('запрос к серверу был один', sdk.calls.length, 1);
    check('сессия на месте', !!sessionOf(sdk), true);
  }

  // ── 4. «Already Used» в одиночку сессию не рушит ─────────────────────────
  {
    const sdk = makeSdk(() => fail(400, {
      error: 'invalid_grant', error_description: 'Invalid Refresh Token: Already Used',
    }));
    sdk.store.set('pixset.session', expiredSession());
    await sdk.License.accessToken();
    check('вход сохранён после «Already Used»', !!sessionOf(sdk), true);
    check('игрок всё ещё считается вошедшим', sdk.License.loggedIn(), true);
  }

  // ── 5. Упавший сервер и лимит запросов — вход остаётся ───────────────────
  for (const status of [500, 502, 503, 429]) {
    const sdk = makeSdk(() => fail(status, { message: 'oops' }));
    sdk.store.set('pixset.session', expiredSession());
    const t = await sdk.License.accessToken();
    check('ответ ' + status + ': вход сохранён', sdk.License.loggedIn(), true);
    check('ответ ' + status + ': токена нет, но это не выход', t, null);
  }

  // ── 6. Нет сети — вход остаётся ──────────────────────────────────────────
  {
    const sdk = makeSdk(() => { throw new Error('network down'); });
    sdk.store.set('pixset.session', expiredSession());
    const t = await sdk.License.accessToken();
    check('без сети вход сохранён', sdk.License.loggedIn(), true);
    check('без сети токена нет', t, null);
  }

  // ── 7. Сервер прямо отверг токен — вот тогда выходим ─────────────────────
  {
    const sdk = makeSdk(() => fail(400, {
      error: 'invalid_grant', error_description: 'Invalid Refresh Token: Token Not Found',
    }));
    sdk.store.set('pixset.session', expiredSession());
    await sdk.License.accessToken();
    check('отвергнутый токен — сессия удалена', sessionOf(sdk), null);
    check('игрок разлогинен', sdk.License.loggedIn(), false);
  }

  // ── 8. Вход тоже досчитывает срок ────────────────────────────────────────
  {
    const sdk = makeSdk((url) => {
      if (url.includes('grant_type=password')) {
        return ok({ access_token: 'A1', refresh_token: 'R1', expires_in: 3600 });
      }
      return fail(503, {});               // выдача прав недоступна — не важно
    });
    try { await sdk.License.login('p@example.com', 'secret'); } catch (e) { /* 503 ожидаем */ }
    const s = sessionOf(sdk);
    check('после входа сессия сохранена', !!s, true);
    check('после входа срок проставлен', typeof s.expires_at === 'number' && s.expires_at > now(), true);
  }

  console.log(failed ? '\n❌ провалов: ' + failed : '\n✅ все проверки прошли');
  process.exit(failed ? 1 : 0);
})();
