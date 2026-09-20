// bugfixes.js — минимальная безопасная версия
// Все критичные исправления fire/ice уже встроены в index.html

console.log('✔ bugfixes.js loaded (minimal safe version)');

// Защита от смерти после флага (BUG #6)
window.addEventListener('load', function() {
  if (typeof window.doHurtPlayer === 'function') {
    const _orig6a = window.doHurtPlayer;
    window.doHurtPlayer = function() {
      if (window.exitAnim) return;
      return _orig6a.apply(this, arguments);
    };
  }
  if (typeof window.doHurtPlayer2 === 'function') {
    const _orig6b = window.doHurtPlayer2;
    window.doHurtPlayer2 = function() {
      if (window.exitAnim) return;
      if (window.godMode) return;
      if (window.infiniteLives) { if (window.lives2 !== undefined) window.lives2 = Math.max(window.lives2, 3); return; }
      return _orig6b.apply(this, arguments);
    };
  }

  // NOTE: the Game Over "retry" action is wired directly in index.html
  // (doHurtPlayer → showGameover(retry)). For adventure mode it calls
  // startAdv(advLevel, false), which preserves cpSave so the player resumes
  // from their last checkpoint rather than the level start. Do not override it
  // here with startAdv(..., true) — that would wipe the checkpoint.

  console.log('✔ Safe patches applied');
});
