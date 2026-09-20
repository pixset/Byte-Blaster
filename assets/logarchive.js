// ===============================================================
//  BYTE BLASTER — LOG ARCHIVE (cutscene gallery)
// ===============================================================
// The game ships 82 scenes and ~430 lines of dialogue, but every scene was
// gated behind `_csFired`, which is persisted to localStorage and never
// cleared. A player therefore saw each scene exactly once, ever, usually while
// impatient to get back to playing, and had no way to read any of it again.
//
// This module answers "which scenes exist and which has the player seen"; the
// screen that displays them is the ARCHIVE tab of the profile (profile.js).
// Only scenes the player has actually reached are readable — the rest show as
// locked, so the archive doubles as a "what have I missed" map of the story.
//
// It reads the same CSCENES table the cutscene engine uses, so it is always in
// the active language and never needs its own copy of the text.
(function () {
  'use strict';

  const T = (k, ...a) => (typeof window.t === 'function' ? window.t(k, ...a) : k);

  // Story order: prologue, then each world's beats in the order they fire
  // during play, then the two endings.
  const BEAT_ORDER = ['start', 'level3', 'level5', 'mid', 'level7', 'pre', 'boss', 'after'];
  const BEAT_KEY = {
    start: 'logBeatStart', level3: 'logBeatEarly', level5: 'logBeatMid',
    mid: 'logBeatTurn', level7: 'logBeatLate', pre: 'logBeatPre',
    boss: 'logBeatBoss', after: 'logBeatAfter',
  };

  function firedMap() {
    try { return JSON.parse(localStorage.getItem('bbCsFired') || '{}') || {}; }
    catch (e) { return {}; }
  }
  function sceneExists(id) {
    try { return !!(window.CSCENES && window.CSCENES[id] && window.CSCENES[id].length); }
    catch (e) { return false; }
  }
  function worldTitle(wi) {
    try {
      const idx = window.CS_WORLD_IDX && window.CS_WORLD_IDX[wi];
      if (idx && idx.big) return idx.big;
    } catch (e) {}
    try { return window.worldName(wi); } catch (e) {}
    return 'WORLD ' + (wi + 1);
  }

  // Build the full catalogue: [{id, world, beat, unlocked}]
  function catalogue() {
    const fired = firedMap();
    const out = [];
    const push = (id, world, beat) => {
      if (!sceneExists(id)) return;
      out.push({ id, world, beat, unlocked: !!fired[id] });
    };
    push('intro', -1, 'intro');
    for (let wi = 0; wi <= 10; wi++) {
      for (const b of BEAT_ORDER) push('w' + wi + '_' + b, wi, b);
    }
    push('ending', -2, 'ending');
    return out;
  }

  // UI lives in profile.js — this module just answers "what exists and what
  // has the player actually seen".
  window.LogArchive = { catalogue, beatKey: (b) => BEAT_KEY[b] || b, worldTitle, BEAT_ORDER };
  console.log('✅ Log archive (data) loaded');
})();
