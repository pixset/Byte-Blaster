// ===============================================
//  ACHIEVEMENTS SYSTEM
// ===============================================

(function() {
  'use strict';

  console.log('🏆 Loading Achievements system...');

  // i18n helper — always reads the current language at call time.
  function tt(key, fallback) {
    if (typeof window.t === 'function') {
      const v = window.t(key);
      if (v !== undefined && v !== key) return v;
    }
    return fallback !== undefined ? fallback : key;
  }
  function curLang() {
    return (typeof window.i18nLang === 'function') ? window.i18nLang() : 'en';
  }

  // ═══════════════════════════════════════════════
  //  ACHIEVEMENTS DATA
  // ═══════════════════════════════════════════════

  const ACHIEVEMENTS = [
    // Story Progress
    {id:'achievement_world_0', name:'Cyber Rookie', nameRu:'Кибер Новичок', desc:'Complete first 10 levels (Cyber City)', descRu:'Пройти первые 10 уровней (Кибер-Сити)', icon:'🏙', rarity:85},
    {id:'achievement_world_1', name:'Jungle Explorer', nameRu:'Исследователь Джунглей', desc:'Complete levels 11-20 (Neon Jungle)', descRu:'Пройти уровни 11-20 (Неоновые Джунгли)', icon:'🌿', rarity:65},
    {id:'achievement_world_2', name:'Lava Survivor', nameRu:'Выживший в Лаве', desc:'Complete levels 21-30 (Lava World)', descRu:'Пройти уровни 21-30 (Лавовый Мир)', icon:'🌋', rarity:45},
    {id:'achievement_world_3', name:'Ice Climber', nameRu:'Ледолаз', desc:'Complete levels 31-40 (Ice Caves)', descRu:'Пройти уровни 31-40 (Ледяные Пещеры)', icon:'❄', rarity:30},
    {id:'achievement_world_4', name:'Desert Wanderer', nameRu:'Странник Пустыни', desc:'Complete levels 41-50 (Desert Ruins)', descRu:'Пройти уровни 41-50 (Руины Пустыни)', icon:'🏜', rarity:20},
    {id:'achievement_world_5', name:'Space Cadet', nameRu:'Космический Кадет', desc:'Complete levels 51-60 (Space Station)', descRu:'Пройти уровни 51-60 (Космическая Станция)', icon:'🛸', rarity:15},
    {id:'achievement_world_6', name:'Forest Guardian', nameRu:'Страж Леса', desc:'Complete levels 61-70 (Dark Forest)', descRu:'Пройти уровни 61-70 (Тёмный Лес)', icon:'🌲', rarity:10},
    {id:'achievement_world_7', name:'Toxic Warrior', nameRu:'Токсичный Воин', desc:'Complete levels 71-80 (Toxic Zone)', descRu:'Пройти уровни 71-80 (Токсичная Зона)', icon:'☣', rarity:7},
    {id:'achievement_world_8', name:'Storm Master', nameRu:'Мастер Бури', desc:'Complete levels 81-90 (Storm Peaks)', descRu:'Пройти уровни 81-90 (Штормовые Пики)', icon:'⚡', rarity:5},
    {id:'achievement_world_9', name:'Fortress Conqueror', nameRu:'Покоритель Крепости', desc:'Complete levels 91-100 (Final Fortress)', descRu:'Пройти уровни 91-100 (Финальная Крепость)', icon:'🔱', rarity:3},

    // Boss Achievements
    {id:'achievement_boss_0', name:'Boss Slayer I', nameRu:'Убийца Боссов I', desc:'Defeat the first boss', descRu:'Победить первого босса', icon:'⚔', rarity:70},
    {id:'achievement_boss_5', name:'Boss Slayer II', nameRu:'Убийца Боссов II', desc:'Defeat 5 bosses', descRu:'Победить 5 боссов', icon:'⚔', rarity:25},
    {id:'achievement_boss_10', name:'Boss Slayer III', nameRu:'Убийца Боссов III', desc:'Defeat all 10 bosses', descRu:'Победить всех 10 боссов', icon:'⚔', rarity:3},

    // Skill Achievements
    {id:'achievement_perfect_run', name:'Perfect Run', nameRu:'Идеальный Забег', desc:'Complete a level with PERFECT rating', descRu:'Пройти уровень с рейтингом PERFECT', icon:'💯', rarity:40},
    {id:'achievement_perfectionist', name:'Perfectionist', nameRu:'Перфекционист', desc:'Get PERFECT on 10 levels', descRu:'Получить PERFECT на 10 уровнях', icon:'💯', rarity:8},
    {id:'achievement_speedrunner', name:'Speedrunner', nameRu:'Спидраннер', desc:'Complete a level in half the time', descRu:'Пройти уровень за половину времени', icon:'⏱', rarity:15},
    {id:'achievement_sharpshooter', name:'Sharpshooter', nameRu:'Снайпер', desc:'Kill 100 enemies with blaster', descRu:'Убить 100 врагов из бластера', icon:'🎯', rarity:30},
    {id:'achievement_stomper', name:'Stomper', nameRu:'Топтун', desc:'Kill 50 enemies by stomping', descRu:'Убить 50 врагов прыжком сверху', icon:'👟', rarity:35},
    {id:'achievement_coin_1000', name:'Coin Collector', nameRu:'Коллекционер Монет', desc:'Collect 1000 coins', descRu:'Собрать 1000 монет', icon:'💰', rarity:50},
    {id:'achievement_coin_5000', name:'Treasure Hunter', nameRu:'Охотник за Сокровищами', desc:'Collect 5000 coins', descRu:'Собрать 5000 монет', icon:'💰', rarity:15},
    {id:'achievement_coin_10000', name:'Millionaire', nameRu:'Миллионер', desc:'Collect 10000 coins', descRu:'Собрать 10000 монет', icon:'💰', rarity:5},

    // Survival Achievements
    {id:'achievement_no_death_10', name:'Survivor', nameRu:'Выживший', desc:'Complete 10 levels without losing a life', descRu:'Пройти 10 уровней без потери жизни', icon:'❤', rarity:20},
    {id:'achievement_no_death_world', name:'Immortal', nameRu:'Бессмертный', desc:'Complete a world without losing a life', descRu:'Пройти весь мир без потери жизни', icon:'❤', rarity:5},
    {id:'achievement_hardcore_unlock', name:'Hardcore Hero', nameRu:'Хардкорный Герой', desc:'Unlock Hardcore mode', descRu:'Разблокировать Hardcore режим', icon:'💀', rarity:3},
    {id:'achievement_hardcore_50', name:'Hardcore Master', nameRu:'Хардкорный Мастер', desc:'Complete 50 levels in Hardcore', descRu:'Пройти 50 уровней в Hardcore', icon:'💀', rarity:1},
    {id:'achievement_hardcore_100', name:'Hardcore Legend', nameRu:'Хардкорная Легенда', desc:'Complete all 100 levels in Hardcore', descRu:'Пройти все 100 уровней в Hardcore', icon:'💀', rarity:0.5},

    // Secret Achievements
    {id:'achievement_cheat_found', name:'Code Breaker', nameRu:'Взломщик Кодов', desc:'Find a secret cheat code', descRu:'Найти секретный чит-код', icon:'🔓', rarity:10, secret:true},
    {id:'achievement_2player', name:'Retro Gamer', nameRu:'Ретро Геймер', desc:'Play in 2-player mode', descRu:'Сыграть в 2-player режим', icon:'🎮', rarity:25},
    {id:'achievement_all_music', name:'Music Lover', nameRu:'Меломан', desc:'Listen to music from all 10 worlds', descRu:'Прослушать музыку всех 10 миров', icon:'🎵', rarity:12},
    {id:'achievement_all_cutscenes', name:'Lore Master', nameRu:'Мастер Лора', desc:'Watch all cutscenes', descRu:'Просмотреть все кат-сцены', icon:'📖', rarity:8},
    {id:'achievement_star_power', name:'Star Power', nameRu:'Звёздная Сила', desc:'Activate star power', descRu:'Активировать звёздную силу', icon:'⭐', rarity:30},

    // Exploration Achievements
    {id:'achievement_all_levels_unlocked', name:'Explorer', nameRu:'Исследователь', desc:'Unlock all levels in Adventure', descRu:'Разблокировать все уровни в Adventure', icon:'🗺', rarity:5},
    {id:'achievement_100_percent', name:'Completionist', nameRu:'Завершитель', desc:'Get 100% in Normal mode', descRu:'Получить 100% в Normal режиме', icon:'🏅', rarity:2},
    {id:'achievement_100_percent_hardcore', name:'True Master', nameRu:'Истинный Мастер', desc:'Get 100% in Hardcore mode', descRu:'Получить 100% в Hardcore режиме', icon:'🏅', rarity:0.3},

    // Infinite Mode Achievements
    {id:'achievement_infinite_10', name:'Infinite Beginner', nameRu:'Бесконечный Новичок', desc:'Reach level 10 in Infinite mode', descRu:'Достичь уровня 10 в Infinite режиме', icon:'♾', rarity:40},
    {id:'achievement_infinite_50', name:'Infinite Master', nameRu:'Бесконечный Мастер', desc:'Reach level 50 in Infinite mode', descRu:'Достичь уровня 50 в Infinite режиме', icon:'♾', rarity:5},
    {id:'achievement_infinite_100', name:'Infinite Legend', nameRu:'Бесконечная Легенда', desc:'Reach level 100 in Infinite mode', descRu:'Достичь уровня 100 в Infinite режиме', icon:'♾', rarity:1},
    {id:'achievement_score_100k', name:'High Scorer', nameRu:'Рекордсмен', desc:'Score 100,000 points', descRu:'Набрать 100,000 очков', icon:'🏆', rarity:20},
    {id:'achievement_score_500k', name:'Score Master', nameRu:'Мастер Очков', desc:'Score 500,000 points', descRu:'Набрать 500,000 очков', icon:'🏆', rarity:5},
    {id:'achievement_score_1m', name:'Score Legend', nameRu:'Легенда Очков', desc:'Score 1,000,000 points', descRu:'Набрать 1,000,000 очков', icon:'🏆', rarity:1},

    // Rainbow Shard / Secret World Achievements
    {id:'achievement_rainbow_1', name:'Glimmer of Truth', nameRu:'Проблеск Истины', desc:'Find your first Rainbow Shard', descRu:'Найти первый Радужный Осколок', icon:'🌈', rarity:20, secret:true},
    {id:'achievement_rainbow_10', name:'Prism Anomaly', nameRu:'Радужная Аномалия', desc:'Find all 10 Rainbow Shards', descRu:'Найти все 10 Радужных Осколков', icon:'🌈', rarity:2, secret:true},
    {id:'achievement_world_10', name:'Beyond the Grid', nameRu:'За Пределами Сети', desc:'Complete the secret Prism Anomaly world', descRu:'Пройти секретный мир Радужная Аномалия', icon:'🔮', rarity:1, secret:true},
    {id:'achievement_boss_prism', name:'Wraith Hunter', nameRu:'Охотник на Призрака', desc:'Defeat PRISM WRAITH', descRu:'Победить ПРИЗМА-ПРИЗРАКА', icon:'👻', rarity:1, secret:true},

    // More Skill / Collection Achievements
    {id:'achievement_shard_100', name:'Data Miner', nameRu:'Дата-Старатель', desc:'Collect 100 data-shards total', descRu:'Собрать 100 кристаллов данных', icon:'◆', rarity:25},
    {id:'achievement_shard_300', name:'Data Hoarder', nameRu:'Хранитель Данных', desc:'Collect all 300 data-shards', descRu:'Собрать все 300 кристаллов данных', icon:'◆', rarity:2},
    {id:'achievement_jump_1000', name:'Never Stop Jumping', nameRu:'Не Переставай Прыгать', desc:'Jump 1000 times', descRu:'Прыгнуть 1000 раз', icon:'🦘', rarity:35},
    {id:'achievement_freeze_25', name:'Cold Snap', nameRu:'Ледяной Щелчок', desc:'Freeze 25 enemies solid', descRu:'Заморозить 25 врагов', icon:'🧊', rarity:20},
    {id:'achievement_burn_25', name:'Playing With Fire', nameRu:'Игры с Огнём', desc:'Set 25 enemies ablaze', descRu:'Поджечь 25 врагов', icon:'🔥', rarity:20},
    {id:'achievement_net_play', name:'Not Alone', nameRu:'Не Один', desc:'Play a networked multiplayer match', descRu:'Сыграть в сетевом мультиплеере', icon:'📡', rarity:15},
  ];

  // ═══════════════════════════════════════════════
  //  STATE & STORAGE
  // ═══════════════════════════════════════════════

  let unlockedAchievements = [];

  // Persistent gameplay stats backing the non-trivial achievements
  // (cumulative coins, kills, perfect runs, sets of worlds/cutscenes seen, etc.).
  let stats = {
    coins: 0,
    blasterKills: 0,
    stompKills: 0,
    perfectLevels: 0,
    noDeathStreak: 0,
    deaths: 0,
    musicWorlds: [],
    cutscenes: [],
  };

  function loadAchievements() {
    // Проверяется не только разбор, но и форма: "null", число или объект тоже
    // проходят JSON.parse, а дальше по коду список открытых достижений
    // используется как массив (includes/push) — на таком значении экран
    // достижений падал бы. Списки внутри stats — по той же причине.
    try {
      const saved = localStorage.getItem('bbAchievements');
      const parsed = saved ? JSON.parse(saved) : null;
      if (Array.isArray(parsed)) unlockedAchievements = parsed;
      else if (parsed != null) console.warn('bbAchievements has an unexpected shape — starting with none unlocked.');
    } catch (e) {
      console.error('Failed to load achievements:', e);
    }
    try {
      const s = localStorage.getItem('bbAchStats');
      const parsed = s ? JSON.parse(s) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stats = Object.assign(stats, parsed);
      else if (parsed != null) console.warn('bbAchStats has an unexpected shape — starting from zero.');
    } catch (e) {
      console.error('Failed to load achievement stats:', e);
    }
    // Наборы (миры с музыкой, просмотренные катсцены) обязаны остаться
    // массивами: сохранение из другой сборки могло принести что угодно.
    ['musicWorlds', 'cutscenes'].forEach((k) => {
      if (!Array.isArray(stats[k])) stats[k] = [];
    });
  }

  function saveAchievements() {
    try {
      localStorage.setItem('bbAchievements', JSON.stringify(unlockedAchievements));
    } catch (e) {
      console.error('Failed to save achievements:', e);
    }
  }

  function saveStats() {
    try {
      localStorage.setItem('bbAchStats', JSON.stringify(stats));
    } catch (e) {}
  }

  // Add `delta` to a numeric stat (delta 0 = read-only) and return the new total.
  function addStat(key, delta) {
    if (typeof stats[key] !== 'number') stats[key] = 0;
    stats[key] += (delta || 0);
    if (delta) saveStats();
    return stats[key];
  }

  // Reset a numeric stat to a value (used e.g. for the no-death streak on death).
  function setStat(key, value) {
    stats[key] = value;
    saveStats();
    return value;
  }

  // Add a value to a stat that is a Set-like array; return the count of unique entries.
  function addToSet(key, value) {
    if (!Array.isArray(stats[key])) stats[key] = [];
    if (!stats[key].includes(value)) {
      stats[key].push(value);
      saveStats();
    }
    return stats[key].length;
  }

  function getStat(key) {
    return stats[key];
  }

  function isUnlocked(id) {
    return unlockedAchievements.includes(id);
  }

  function unlockAchievement(id) {
    if (isUnlocked(id)) return false;

    const achievement = ACHIEVEMENTS.find(a => a.id === id);
    if (!achievement) return false;

    unlockedAchievements.push(id);
    saveAchievements();

    // Show notification
    showAchievementNotification(achievement);

    console.log(`🏆 Achievement unlocked: ${achievement.name}`);
    return true;
  }

  function showAchievementNotification(achievement) {
    const lang = curLang();
    // Prefer a locale-file translation (key = achievement id, +'_desc' for the
    // description); fall back to the built-in EN/RU strings when a locale lacks them.
    const name = tt(achievement.id, lang === 'ru' ? achievement.nameRu : achievement.name);
    const desc = tt(achievement.id + '_desc', lang === 'ru' ? achievement.descRu : achievement.desc);
    const unlockText = tt('achievementUnlocked', 'ACHIEVEMENT UNLOCKED!');

    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: rgba(0, 0, 0, 0.95);
      border: 2px solid #ffd700;
      border-radius: 8px;
      padding: 16px 20px;
      min-width: 300px;
      max-width: 400px;
      z-index: 10000;
      font-family: 'Press Start 2P', monospace;
      box-shadow: 0 0 30px rgba(255, 215, 0, 0.5);
      animation: slideIn 0.5s ease-out;
    `;

    notification.innerHTML = `
      <div style="color: #ffd700; font-size: calc(10px * var(--bbText, 1)); margin-bottom: 8px; text-shadow: 0 0 10px #ffd700;">🏆 ${unlockText}</div>
      <div style="display: flex; align-items: center; gap: 12px;">
        <div style="font-size: calc(32px * var(--bbText, 1));">${achievement.icon}</div>
        <div style="flex: 1;">
          <div style="color: #fff; font-size: calc(11px * var(--bbText, 1)); margin-bottom: 4px;">${name}</div>
          <div style="color: #aaa; font-size: calc(7px * var(--bbText, 1)); font-family: 'Share Tech Mono', monospace; line-height: 1.4;">${desc}</div>
          <div style="color: #888; font-size: calc(6px * var(--bbText, 1)); margin-top: 4px;">${tt('achRarity')}: ${achievement.rarity}%</div>
        </div>
      </div>
    `;

    // Add animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideIn {
        from { transform: translateX(450px); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(450px); opacity: 0; }
      }
    `;
    document.head.appendChild(style);

    document.body.appendChild(notification);

    // Play the dedicated achievement fanfare (falls back to the powerup jingle).
    if (window.SFX && window.SFX.achievement) window.SFX.achievement();
    else if (window.SFX && window.SFX.powerup) window.SFX.powerup();

    // Remove after 5 seconds
    setTimeout(() => {
      notification.style.animation = 'slideOut 0.5s ease-in';
      setTimeout(() => notification.remove(), 500);
    }, 5000);
  }

  // ═══════════════════════════════════════════════
  //  UI - ACHIEVEMENTS MENU
  // ═══════════════════════════════════════════════

  let achievementsOverlay;

  function createAchievementsMenu() {
    achievementsOverlay = document.createElement('div');
    achievementsOverlay.id = 'achievementsOverlay';
    achievementsOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(4, 4, 15, 0.98);
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 4000;
    `;

    const container = document.createElement('div');
    container.style.cssText = `
      max-width: 1000px;
      width: 92%;
      max-height: 88vh;
      background: rgba(10, 10, 32, 0.95);
      padding: 20px 30px;
      border: 2px solid #ffd700;
      border-radius: 8px;
      display: flex;
      flex-direction: column;
    `;

    const title = tt('achTitle', 'ACHIEVEMENTS');
    const unlockedText = tt('achUnlockedCount', 'Unlocked');

    const unlockedCount = unlockedAchievements.length;
    const totalCount = ACHIEVEMENTS.length;

    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px;">
        <h2 style="color: #ffd700; font-family: 'Press Start 2P', monospace; font-size: calc(18px * var(--bbText, 1)); text-shadow: 0 0 10px #ffd700;">🏆 ${title}</h2>
        <div style="color: #ffd700; font-family: 'Share Tech Mono', monospace; font-size: calc(12px * var(--bbText, 1));">${unlockedCount} / ${totalCount} ${unlockedText}</div>
      </div>
      <div id="achievementsList" style="flex: 1; overflow-y: auto; padding-right: 10px;"></div>
      <div style="display: flex; justify-content: center; margin-top: 18px; padding-top: 14px; border-top: 1px solid #ffd70044;">
        <button id="closeAchievementsBtn" data-i18n="close" style="padding: 12px 24px; font-family: 'Press Start 2P', monospace; font-size: calc(11px * var(--bbText, 1)); background: #0a0a20; color: #ffd700; border: 2px solid #ffd700; border-radius: 4px; cursor: pointer; transition: all 0.2s;">CLOSE</button>
      </div>
    `;

    achievementsOverlay.appendChild(container);
    document.body.appendChild(achievementsOverlay);

    // Populate achievements list
    const list = document.getElementById('achievementsList');
    renderAchievementsList(list);

    // Close button
    document.getElementById('closeAchievementsBtn').onclick = hideAchievementsMenu;

    // Apply translations
    if (typeof window.applyI18nDOM === 'function') window.applyI18nDOM();
  }

  function renderAchievementsList(container) {
    const lang = curLang();
    container.innerHTML = '';

    for (const achievement of ACHIEVEMENTS) {
      const unlocked = isUnlocked(achievement.id);
      const name = tt(achievement.id, lang === 'ru' ? achievement.nameRu : achievement.name);
      const desc = tt(achievement.id + '_desc', lang === 'ru' ? achievement.descRu : achievement.desc);

      const item = document.createElement('div');
      item.style.cssText = `
        background: ${unlocked ? 'rgba(255, 215, 0, 0.1)' : 'rgba(20, 20, 40, 0.5)'};
        border: 1px solid ${unlocked ? '#ffd70088' : '#333'};
        border-radius: 6px;
        padding: 12px 16px;
        margin-bottom: 10px;
        display: flex;
        align-items: center;
        gap: 14px;
        transition: all 0.2s;
        opacity: ${unlocked ? '1' : '0.5'};
      `;

      if (unlocked) {
        item.style.cursor = 'pointer';
        item.onmouseenter = () => {
          item.style.background = 'rgba(255, 215, 0, 0.2)';
          item.style.borderColor = '#ffd700';
        };
        item.onmouseleave = () => {
          item.style.background = 'rgba(255, 215, 0, 0.1)';
          item.style.borderColor = '#ffd70088';
        };
      }

      const rarityColor = achievement.rarity >= 50 ? '#aaa' : achievement.rarity >= 20 ? '#4af' : achievement.rarity >= 5 ? '#a0f' : achievement.rarity >= 1 ? '#f80' : '#f44';

      item.innerHTML = `
        <div style="font-size: calc(36px * var(--bbText, 1)); filter: ${unlocked ? 'none' : 'grayscale(1) brightness(0.3)'};">${achievement.icon}</div>
        <div style="flex: 1;">
          <div style="color: ${unlocked ? '#ffd700' : '#555'}; font-family: 'Press Start 2P', monospace; font-size: calc(10px * var(--bbText, 1)); margin-bottom: 4px;">${unlocked || !achievement.secret ? name : tt('achSecretName', '???')}</div>
          <div style="color: ${unlocked ? '#ccc' : '#444'}; font-family: 'Share Tech Mono', monospace; font-size: calc(8px * var(--bbText, 1)); line-height: 1.4; margin-bottom: 4px;">${unlocked || !achievement.secret ? desc : tt('achSecretDesc', 'Secret achievement - unlock to reveal')}</div>
          <div style="color: ${rarityColor}; font-family: 'Share Tech Mono', monospace; font-size: calc(7px * var(--bbText, 1));">${tt('achRarity', 'Rarity')}: ${achievement.rarity}%</div>
        </div>
        ${unlocked ? '<div style="color: #0f0; font-size: calc(24px * var(--bbText, 1));">✓</div>' : ''}
      `;

      container.appendChild(item);
    }
  }

  function showAchievementsMenu() {
    if (!achievementsOverlay) {
      createAchievementsMenu();
    } else {
      // Refresh the list
      const list = document.getElementById('achievementsList');
      if (list) renderAchievementsList(list);
    }
    achievementsOverlay.style.display = 'flex';
  }

  function hideAchievementsMenu() {
    if (achievementsOverlay) {
      achievementsOverlay.style.display = 'none';
    }
  }

  // ═══════════════════════════════════════════════
  //  PUBLIC API
  // ═══════════════════════════════════════════════

  loadAchievements();

  window.Achievements = {
    unlock: unlockAchievement,
    isUnlocked: isUnlocked,
    showMenu: showAchievementsMenu,
    hideMenu: hideAchievementsMenu,
    getAll: () => ACHIEVEMENTS,
    getUnlocked: () => unlockedAchievements,
    // Stats API used by the game to drive progress-based achievements
    addStat: addStat,
    setStat: setStat,
    addToSet: addToSet,
    getStat: getStat,
    // Re-read unlocked achievements + stats from localStorage (after a slot switch)
    reload: loadAchievements,
  };

  console.log('✅ Achievements system loaded');

})();
