// ============================================================================
//  SAMPLE AUDIO LAYER — plays the baked assets/audio/Music + assets/audio/SFX .mp3 files.
// ----------------------------------------------------------------------------
//  The game's original audio is fully procedural: every 16th-note spawns ~10
//  WebAudio nodes via setTimeout. On phones that stutters badly and steals main-
//  thread time from the renderer. Pre-rendered .mp3 loops (tools/gen-audio.js)
//  play through ONE buffer source — near-zero per-frame cost — so the music is
//  smooth and the game runs lighter. Falls back to the procedural engine if the
//  files are missing or fail to decode.
//
//  Files are loaded as base64 over the Electron IPC bridge (window.audioAPI) when
//  running under file://, or via fetch() on the web / Capacitor (https) build.
// ============================================================================
(function () {
  'use strict';

  // Список берём из assets/music-data.js — того же файла, из которого генератор
  // печёт mp3. Раньше он был вписан руками и при добавлении трека его забывали.
  const MUSIC = (window.BBMusic && Object.keys(window.BBMusic.TRACKS)) || [];
  // Список берём из assets/sfx-data.js, чтобы добавленный звук не приходилось
  // дописывать ещё и сюда — раньше рассинхрон приводил к молчащим эффектам.
  const SFX = (window.BBSfx && window.BBSfx.names) || [];

  let AC = null, sfxBus = null, musicBus = null;
  const sfxBuf = {}, musicBuf = {}, loopPt = {};
  let curSrc = null, curName = null, initStarted = false;

  /* ── Сколько уже скачано ───────────────────────────────────────────────
     Через fetch читаем потоком и считаем байты: это единственное место, где
     игра реально что-то качает (музыка обычного стиля в веб-сборке).
     Под Electron байты приходят одним куском по IPC — там прогресс сводится к
     «идёт/готово», и врать про мегабайты мы не будем. */
  const progressSubs = [];
  function onProgress(fn) { progressSubs.push(fn); return () => {
    const i = progressSubs.indexOf(fn); if (i >= 0) progressSubs.splice(i, 1); }; }
  function emitProgress(info) { for (const f of progressSubs) { try { f(info); } catch (e) {} } }

  /** fetch с подсчётом байтов. total = 0, если сервер не прислал длину. */
  async function fetchCounted(url, label, opts) {
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(String(res.status) + " " + url);
    const total = +(res.headers.get("content-length") || 0);
    if (!res.body || !res.body.getReader) {
      const ab = await res.arrayBuffer();
      emitProgress({ label, loaded: ab.byteLength, total: ab.byteLength, done: true });
      return ab;
    }
    const reader = res.body.getReader();
    const chunks = []; let loaded = 0;
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      chunks.push(r.value); loaded += r.value.length;
      emitProgress({ label, loaded, total, done: false });
    }
    const out = new Uint8Array(loaded); let off = 0;
    for (const ch of chunks) { out.set(ch, off); off += ch.length; }
    emitProgress({ label, loaded, total: total || loaded, done: true });
    return out.buffer;
  }

  // Read a file's bytes: IPC base64 under file://, else fetch (web / Capacitor).
  async function readBytes(rel) {
    if (window.audioAPI && typeof window.audioAPI.read === 'function') {
      const b64 = await window.audioAPI.read(rel);
      if (!b64) throw new Error('audioAPI returned null for ' + rel);
      const bin = atob(b64), len = bin.length, bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
      return bytes.buffer;
    }
    return await fetchCounted(rel, rel.split('/').pop().replace(/\.mp3$/, ''));
  }

  // decodeAudioData returns a promise in modern engines; wrap the callback form too.
  function decode(arrayBuf) {
    return new Promise((resolve, reject) => {
      const p = AC.decodeAudioData(arrayBuf, resolve, reject);
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    });
  }

  // Find the non-silent span of a decoded buffer so looping skips the MP3 codec's
  // leading/trailing padding silence — giving a clean, near-seamless loop.
  function findLoop(buf) {
    const ch = buf.getChannelData(0), n = ch.length, thr = 0.004;
    let s = 0, e = n - 1;
    while (s < n && Math.abs(ch[s]) < thr) s++;
    while (e > s && Math.abs(ch[e]) < thr) e--;
    if (s >= e) { s = 0; e = n - 1; }
    return [s / buf.sampleRate, (e + 1) / buf.sampleRate];
  }

  /* ── Где лежит музыка ──────────────────────────────────────────────────
     Обычный стиль лежит в самой сборке — готовыми mp3.

     Восьмибитный не лежит нигде и НИОТКУДА НЕ КАЧАЕТСЯ: его целиком играет
     живой синтез из assets/music-data.js. Раньше набор ехал с сайта при первом
     включении, но это значило, что вся музыка игры лежит в открытом доступе и
     скачивается одной ссылкой. Теперь на сайте её нет, а «8 бит» работает
     сразу, без сети и без ожидания: чиптюн — родной звук этого движка, для
     него синтез и писался.

     Готовые mp3 обоих стилей по-прежнему печёт tools/gen-audio.js — их можно
     послушать в assets/audio/Music/. Просто chip/ в сборки не попадает. */
  function musicStyle() {
    const s = window.gameSettings && window.gameSettings.musicStyle;
    return s === 'chip' ? 'chip' : 'modern';
  }
  const musicPath = (name) => 'assets/audio/Music/modern/' + name + '.mp3';

  async function loadSfx(name) {
    const ab = await readBytes('assets/audio/SFX/' + name + '.mp3');
    sfxBuf[name] = await decode(ab);
  }

  /* Музыку декодируем по одному треку и держим в памяти только нужное.
     Секунда музыки после декода — это ~190 КБ (48 кГц, Float32), а треков
     четверть часа: разом это под три сотни мегабайт, чего телефон не переживёт.
     Поэтому кэш на два трека: играющий и предыдущий, чтобы возврат в меню не
     упирался в повторный декод. */
  const CACHE_LIMIT = 2;
  const order = [];
  const decoding = {};

  function remember(name) {
    const i = order.indexOf(name);
    if (i >= 0) order.splice(i, 1);
    order.push(name);
    while (order.length > CACHE_LIMIT) {
      // Играющий трек выбрасывать нельзя, но и терять из учёта тоже: раньше он
      // просто уходил из очереди и оставался в памяти навсегда. Ищем самый
      // старый из тех, что можно освободить.
      const idx = order.findIndex((n) => n !== curName);
      if (idx < 0) break;
      const drop = order.splice(idx, 1)[0];
      delete musicBuf[drop]; delete loopPt[drop];
    }
  }

  async function loadMusic(name) {
    // У восьмибитного стиля файлов нет вовсе — его целиком играет живой синтез
    // (см. _mTick в game.js). Отвечаем «нечего декодировать», и вызывающий сам
    // включит синтез, тем же путём, что и при отсутствующем mp3.
    if (musicStyle() === 'chip') return null;
    if (musicBuf[name]) { remember(name); return musicBuf[name]; }
    if (decoding[name]) return decoding[name];
    const key = musicStyle() + '/' + name;
    decoding[name] = (async () => {
      const bytes = await readBytes(musicPath(name));
      const buf = await decode(bytes);
      // Стиль могли переключить, пока файл декодировался — тогда результат
      // уже не тот, что нужен.
      if (key !== musicStyle() + '/' + name) return null;
      musicBuf[name] = buf; loopPt[name] = findLoop(buf);
      remember(name);
      return buf;
    })();
    try { return await decoding[name]; } finally { delete decoding[name]; }
  }

  /** Сменили стиль в настройках — весь кэш музыки протух. */
  function reloadStyle() {
    for (const k of Object.keys(musicBuf)) delete musicBuf[k];
    for (const k of Object.keys(loopPt)) delete loopPt[k];
    order.length = 0;
    const again = curName;
    stopMusic();
    if (again && typeof window.onAudioFilesReady === 'function') {
      try { window.onAudioFilesReady(); } catch (e) {}
    }
  }

  // Звуки декодируем сразу: их сорок с лишним, но все короткие — вместе это
  // единицы мегабайт, и задержка на первом ударе была бы слышна.
  async function init(ac, sBus, mBus) {
    if (initStarted) return;
    initStarted = true;
    AC = ac; sfxBus = sBus; musicBus = mBus;
    const results = await Promise.allSettled(SFX.map(loadSfx));
    const failed = results.filter(r => r.status === 'rejected').length;
    API.sfxReady = SFX.every(n => sfxBuf[n]);
    // Музыка теперь грузится по требованию, поэтому «готовность» значит не
    // «всё декодировано», а «файлы вообще есть».
    API.musicReady = MUSIC.length > 0;
    API.ready = API.musicReady || API.sfxReady;
    if (failed) console.warn('🔊 AudioFiles: ' + failed + ' звук(ов) не загрузились — для них останется синтез.');
    else console.log('✅ AudioFiles: звуки декодированы, музыка грузится по требованию.');
    if (API.musicReady && typeof window.onAudioFilesReady === 'function') {
      try { window.onAudioFilesReady(); } catch (e) {}
    }
  }

  function stopMusic() {
    if (curSrc) { try { curSrc.stop(); } catch (e) {} try { curSrc.disconnect(); } catch (e) {} curSrc = null; }
    curName = null;
  }

  // Loop `name` through the music bus. Returns false if the sample isn't available
  // (caller then uses the procedural engine). If decoding is still in flight the
  // request is remembered and started when ready.
  function playMusic(name) {
    if (!AC) return false;
    const buf = musicBuf[name];
    if (!buf) {
      // Ещё не декодирован: запускаем декод и отвечаем «не могу». Игра включит
      // живой синтез, а когда файл будет готов — onAudioFilesReady пересадит её
      // на него, тем же путём, что и раньше при старте.
      loadMusic(name).then((b) => {
        if (b && typeof window.onAudioFilesReady === 'function') {
          try { window.onAudioFilesReady(); } catch (e) {}
        }
      }).catch(() => {});
      return false;
    }
    if (curName === name && curSrc) return true; // already playing this track
    stopMusic();
    const src = AC.createBufferSource();
    src.buffer = buf;
    const lp = loopPt[name] || [0, buf.duration];
    src.loop = true; src.loopStart = lp[0]; src.loopEnd = lp[1];
    src.connect(musicBus);
    try { src.start(0, lp[0]); } catch (e) { try { src.start(); } catch (e2) { return false; } }
    curSrc = src; curName = name;
    return true;
  }

  function playSfx(name) {
    const buf = sfxBuf[name];
    if (!buf || !AC) return false;
    const src = AC.createBufferSource();
    src.buffer = buf;
    src.connect(sfxBus);
    try { src.start(); } catch (e) { return false; }
    return true;
  }

  const API = {
    ready: false, musicReady: false, sfxReady: false,
    init, playMusic, playSfx, stopMusic, reloadStyle,
    hasMusic: (n) => !!musicBuf[n],
    hasSfx: (n) => !!sfxBuf[n],
    style: musicStyle,
    // Подписка на закачку: {label, loaded, total, done}. Срабатывает только в
    // веб-сборке, где mp3 обычного стиля идут по сети; в .exe и .apk они лежат
    // рядом, а восьмибитный стиль не качается никогда.
    onProgress,
    // Для проверок: сколько треков реально держим в памяти.
    cached: () => Object.keys(musicBuf).length,
  };
  window.AudioFiles = API;
})();
