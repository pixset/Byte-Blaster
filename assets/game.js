// ╔═══════════════════════════════════════════════╗
// ║   BYTE BLASTER  ─  Complete Edition           ║
// ╚═══════════════════════════════════════════════╝

// ── Human-readable save file ──────────────────────────────────────────────────
// Mirrors localStorage to an editable, pretty-printed JSON file in the app's
// userData folder (Electron only). The file is the source of truth on startup,
// so players can open it, see exactly what's stored, and edit it by hand.
// Keys are friendly aliases of the internal localStorage keys.
(function(){
  if(!(window.saveAPI && typeof window.saveAPI.readSync==='function'))return; // browser: localStorage only
  const MAP={
    progress:'bbAdv3',            // Adventure (Normal) progress {max,done} — active slot's working copy
    progressHardcore:'bbAdvH',    // Hardcore progress {max,done}
    achievements:'bbAchievements',// unlocked achievement ids
    achievementStats:'bbAchStats',// counters behind progress achievements
    records:'bbRecords',          // player high scores {infinite,adventure}
    slot1:'bbSlot0', slot2:'bbSlot1', slot3:'bbSlot2', // the three save slots
    activeSlot:'bbActiveSlot',    // index (0-2) of the active slot
    settings:'bbSettings'         // all game settings (NEVER part of a slot)
  };
  // 1) Import the JSON file into localStorage so the rest of the game reads it.
  try{
    const raw=window.saveAPI.readSync();
    if(raw){
      const obj=JSON.parse(raw);
      for(const friendly in MAP){
        const v=obj[friendly];
        if(v!==undefined&&v!==null)
          localStorage.setItem(MAP[friendly], typeof v==='string'?v:JSON.stringify(v));
      }
    }
  }catch(e){console.warn('Save import failed:',e);}
  // 2) Mirror localStorage back to the file whenever a bb* key changes.
  const _set=localStorage.setItem.bind(localStorage);
  let _flushT=null;
  function flush(){
    try{
      const out={};
      for(const friendly in MAP){
        const v=localStorage.getItem(MAP[friendly]);
        if(v==null)continue;
        try{out[friendly]=JSON.parse(v);}catch(e){out[friendly]=v;}
      }
      window.saveAPI.write(JSON.stringify(out,null,2));
    }catch(e){}
  }
  localStorage.setItem=function(k,v){_set(k,v);if(/^bb/.test(k)){clearTimeout(_flushT);_flushT=setTimeout(flush,250);}};
  window.bbFlushSave=flush;
  setTimeout(flush,800); // ensure the file exists even before the first change
})();

// ── Save slots (3) ───────────────────────────────────────────────────────────
// A "slot" bundles ONLY level progress, achievements and player records — never
// settings. The canonical localStorage keys (bbAdv3/bbAdvH/bbAchievements/
// bbAchStats/bbRecords) are the live working copy of the ACTIVE slot; any change
// to them is mirrored back into the active slot blob (bbSlot0/1/2). This runs
// before loadAdv()/loadAdvH()/loadRecords() so the active slot is authoritative.
(function(){
  const CANON={progress:'bbAdv3',progressHardcore:'bbAdvH',achievements:'bbAchievements',achievementStats:'bbAchStats',records:'bbRecords',cutscenes:'bbCsFired',csWorlds:'bbCsWorlds',rainbow:'bbRainbow'};
  const CANON_KEYS=new Set(Object.values(CANON));
  const slotKey=i=>'bbSlot'+i;
  let _muting=false; // suppress snapshotting while we write canonical FROM a slot

  function readCanon(){const o={};for(const f in CANON){const v=localStorage.getItem(CANON[f]);if(v!=null){try{o[f]=JSON.parse(v);}catch(e){o[f]=v;}}}return o;}
  function writeCanon(blob){_muting=true;try{for(const f in CANON){const v=blob&&blob[f];if(v!==undefined&&v!==null)localStorage.setItem(CANON[f],JSON.stringify(v));else localStorage.removeItem(CANON[f]);}}finally{_muting=false;}}
  function getSlot(i){try{const v=localStorage.getItem(slotKey(i));return v?JSON.parse(v):null;}catch(e){return null;}}
  function setSlot(i,blob){try{localStorage.setItem(slotKey(i),JSON.stringify(blob));}catch(e){}}
  function getActive(){const n=parseInt(localStorage.getItem('bbActiveSlot'),10);return (n>=0&&n<=2)?n:0;}
  function setActive(i){try{localStorage.setItem('bbActiveSlot',String(i));}catch(e){}}

  function snapshotToActive(){const blob=readCanon();blob.meta={updatedAt:Date.now()};setSlot(getActive(),blob);}

  // Hook canonical-key changes → debounced snapshot into the active slot.
  let _snapT=null;
  const _prevSet=localStorage.setItem.bind(localStorage);
  localStorage.setItem=function(k,v){_prevSet(k,v);if(!_muting&&CANON_KEYS.has(k)){clearTimeout(_snapT);_snapT=setTimeout(snapshotToActive,250);}};

  // Reload the in-memory game state after switching/clearing the active slot.
  function refreshGameState(){
    try{if(typeof loadAdv==='function')loadAdv();}catch(e){}
    try{if(typeof loadAdvH==='function')loadAdvH();}catch(e){}
    try{if(typeof loadRecords==='function')loadRecords();}catch(e){}
    try{if(typeof loadCsFired==='function')loadCsFired();}catch(e){}
    try{if(typeof loadRainbow==='function')loadRainbow();}catch(e){}
    try{if(window.Achievements&&window.Achievements.reload)window.Achievements.reload();}catch(e){}
    try{if(window.WorldMap&&window.WorldMap.refresh)window.WorldMap.refresh();}catch(e){}
  }

  // Bootstrap: migrate a legacy single save into slot 1 on first run, otherwise
  // load the active slot's data into the canonical working keys.
  (function bootstrap(){
    const hasAny=getSlot(0)||getSlot(1)||getSlot(2);
    if(!hasAny){
      const blob=readCanon();blob.meta={updatedAt:Date.now()};
      setSlot(0,blob);setActive(0);
    }else{
      const blob=getSlot(getActive());
      if(blob)writeCanon(blob);
    }
  })();

  window.SaveSlots={
    count:3,
    getActive:getActive,
    summary(i){
      const b=getSlot(i);
      if(!b)return {empty:true};
      const done=(b.progress&&b.progress.done&&b.progress.done.length)||0;
      const doneH=(b.progressHardcore&&b.progressHardcore.done&&b.progressHardcore.done.length)||0;
      const ach=(b.achievements&&b.achievements.length)||0;
      const best=(b.records&&b.records.infinite)||0;
      const adv=(b.records&&b.records.adventure)||0;
      return {empty:false,done,doneH,ach,best,adv,updatedAt:(b.meta&&b.meta.updatedAt)||0};
    },
    // Make slot i active and load it (or start fresh if empty), then refresh state.
    select(i){
      setActive(i);
      const b=getSlot(i);
      if(b){writeCanon(b);} else {writeCanon({});snapshotToActive();}
      refreshGameState();
      if(window.bbFlushSave)window.bbFlushSave();
    },
    remove(i){
      try{localStorage.removeItem(slotKey(i));}catch(e){}
      if(getActive()===i){writeCanon({});refreshGameState();}
      if(window.bbFlushSave)window.bbFlushSave();
    }
  };
})();

const CV=document.getElementById('c'),ctx=CV.getContext('2d'),W=800,H=420;
if(window.__chk)window.__chk('game.js: main canvas context created, CV='+(CV?'found':'MISSING'));
const G=0.46,JV=-11.0,MXY=17,PSP=4.4,BSP=9,EBS=3.2;

// ── HiDPI / crisp rendering ─────────────────────────────────────────────────
// The game's logical resolution is W×H (800×420). The canvas used to keep that
// as its backing-store size and let CSS stretch it to fill the window, which
// made all text blurry on larger displays (a low-res bitmap scaled up). Instead
// we size the backing store to the displayed pixel size × devicePixelRatio and
// pre-scale the 2D context by _renderScale, so every existing W/H-based draw
// call renders at native resolution — crisp text, same coordinates.
let _renderScale=1;
function applyRenderResolution(){
  // Displayed CSS size is set by applyGameScale() (settings.js); fall back to logical size.
  // IMPORTANT: use the size the canvas ACTUALLY occupies on screen, which is
  // getBoundingClientRect() — it includes the transform:scale() that fit() puts
  // on #stage to letterbox the game into the window. style.width is the size
  // BEFORE that scale, and on a phone the two differ enormously: in portrait the
  // canvas measured 1188px by style but only 393px on screen, so the game was
  // rendering a 1600x840 backing store to show 1081x567 device pixels — 119%
  // of the pixels painted every frame for nothing. Desktop is unaffected
  // (no scaling there, both numbers agree).
  let cssW=0;
  try { cssW=CV.getBoundingClientRect().width; } catch(e){}
  if(!(cssW>0)) cssW=parseFloat(CV.style.width)||CV.clientWidth||W;
  const dpr=window.devicePixelRatio||1;
  // Backing store keeps the 800:420 aspect. Scale = how many device px per logical px.
  // Capped by the active Graphics Quality tier (GFX.renderScale): lower tiers
  // render at lower resolution for big performance gains, higher tiers render
  // crisp. This is the main optimisation + quality lever.
  const tierCap=(typeof GFX==='object'&&GFX&&GFX.renderScale)?GFX.renderScale:2;
  let scale=(cssW*dpr)/W;
  scale=Math.max(1,Math.min(scale,tierCap));
  const bw=Math.round(W*scale),bh=Math.round(H*scale);
  if(CV.width!==bw||CV.height!==bh){CV.width=bw;CV.height=bh;}
  _renderScale=CV.width/W;
}
window.applyRenderResolution=applyRenderResolution;

// i18n helper — safe wrapper around window.t (falls back to the key if i18n absent)
function T(key,...a){ return (typeof window.t==='function') ? window.t(key,...a) : key; }

// ── Achievement event tracking ───────────────────────────────────────────────
// Thin bridge between gameplay events and the Achievements system (assets/achievements.js).
// All methods are no-ops if the achievements module hasn't loaded yet.
let _levelDied=false;   // did the player lose a life on the current level?
let _worldDied=false;   // …anywhere in the current world (for the "Immortal" achievement)?
const AchTrack={
  _A(){ return window.Achievements; },
  coin(){ const A=this._A(); if(!A)return; const c=A.addStat('coins',1);
    if(c>=10000)A.unlock('achievement_coin_10000');
    if(c>=5000)A.unlock('achievement_coin_5000');
    if(c>=1000)A.unlock('achievement_coin_1000'); },
  kill(stomped){ const A=this._A(); if(!A)return;
    if(stomped){ if(A.addStat('stompKills',1)>=50)A.unlock('achievement_stomper'); }
    else { if(A.addStat('blasterKills',1)>=100)A.unlock('achievement_sharpshooter'); } },
  star(){ const A=this._A(); if(A)A.unlock('achievement_star_power'); },
  perfect(){ const A=this._A(); if(!A)return; A.unlock('achievement_perfect_run');
    if(A.addStat('perfectLevels',1)>=10)A.unlock('achievement_perfectionist'); },
  speed(){ const A=this._A(); if(A)A.unlock('achievement_speedrunner'); },
  score(s){ const A=this._A(); if(!A)return;
    if(s>=1000000)A.unlock('achievement_score_1m');
    if(s>=500000)A.unlock('achievement_score_500k');
    if(s>=100000)A.unlock('achievement_score_100k'); },
  infinite(lv){ const A=this._A(); if(!A)return;
    if(lv>=100)A.unlock('achievement_infinite_100');
    if(lv>=50)A.unlock('achievement_infinite_50');
    if(lv>=10)A.unlock('achievement_infinite_10'); },
  music(worldId){ const A=this._A(); if(!A||typeof worldId!=='number')return;
    if(A.addToSet('musicWorlds',worldId)>=10)A.unlock('achievement_all_music'); },
  cutscene(id){ const A=this._A(); if(!A)return;
    const seen=A.addToSet('cutscenes',id);
    // CSCENES is a lang-proxy with no own keys — count from the backing table instead.
    const total=(typeof _CSCENES_EN!=='undefined'&&_CSCENES_EN)?Object.keys(_CSCENES_EN).length:0;
    if(total>0&&seen>=total)A.unlock('achievement_all_cutscenes'); },
  // Смерти считаем всего одним счётчиком: серия без смертей обнуляется здесь
  // же, а «сколько раз я погиб за всё время» игрок в профиле раньше не видел.
  death(){ const A=this._A(); _levelDied=true; _worldDied=true;
    if(A){A.setStat('noDeathStreak',0); A.addStat('deaths',1);} },
  // Called when an adventure level is cleared. `worldEnd` = last level of a world.
  levelClear(worldEnd){ const A=this._A(); if(!A)return;
    if(!_levelDied){ if(A.addStat('noDeathStreak',1)>=10)A.unlock('achievement_no_death_10'); }
    if(worldEnd&&!_worldDied)A.unlock('achievement_no_death_world'); },
  // ── New tracked events ──────────────────────────────────────────────────
  rainbow(count){ const A=this._A(); if(!A)return;
    if(count>=1)A.unlock('achievement_rainbow_1');
    if(count>=10)A.unlock('achievement_rainbow_10'); },
  worldClear(worldId){ const A=this._A(); if(!A||worldId!==10)return; A.unlock('achievement_world_10'); },
  bossPrism(){ const A=this._A(); if(A)A.unlock('achievement_boss_prism'); },
  shard(){ const A=this._A(); if(!A)return; const c=A.addStat('shardsTotal',1);
    if(c>=300)A.unlock('achievement_shard_300');
    if(c>=100)A.unlock('achievement_shard_100'); },
  jump(){ const A=this._A(); if(!A)return; if(A.addStat('jumps',1)>=1000)A.unlock('achievement_jump_1000'); },
  freeze(){ const A=this._A(); if(!A)return; if(A.addStat('freezeKills',1)>=25)A.unlock('achievement_freeze_25'); },
  burn(){ const A=this._A(); if(!A)return; if(A.addStat('burnKills',1)>=25)A.unlock('achievement_burn_25'); },
  netPlay(){ const A=this._A(); if(A)A.unlock('achievement_net_play'); },
};

// ── Graphics quality tiers (driven by Settings → Graphics Quality) ─────────
// Read by drawing code: GFX.glow (multiplier on shadowBlur, 0 disables glows),
// GFX.particleMul (scales particle counts), GFX.bgDetail (parallax/star density),
// GFX.trails (player/bullet trail length multiplier), GFX.bossFx (boss aura intensity).
// `renderScale` is the per-tier ceiling on the canvas backing-store resolution
// (device-pixels per logical pixel). It is BOTH the biggest performance lever
// and the most visible quality difference: low tiers render at ~native logical
// size (cheap, softer on big screens), high tiers render crisp HiDPI. The wide
// spread of the effect multipliers makes the Graphics Quality setting clearly
// change how the game looks.
// Свечение выше 100% не делается ни одним пресетом и не даётся ползунком:
// начиная примерно с этого значения оно перестаёт подсвечивать объекты и
// просто заливает кадр — уровень читается хуже, чем вообще без свечения.
// Поэтому у старших пресетов растут частицы, детализация и разрешение, а
// glow упирается в потолок. См. GLOW_MAX ниже.
const GLOW_MAX = 1.00;
const GFX_TIERS = {
  verylow:  {glow:0.00, particleMul:0.20, bgDetail:0.30, trails:0.15, bossFx:0.15, decorMul:0.25, renderScale:1.00},
  low:      {glow:0.30, particleMul:0.45, bgDetail:0.55, trails:0.45, bossFx:0.40, decorMul:0.50, renderScale:1.25},
  medium:   {glow:0.65, particleMul:0.75, bgDetail:0.80, trails:0.75, bossFx:0.70, decorMul:0.75, renderScale:1.50},
  high:     {glow:1.00, particleMul:1.00, bgDetail:1.00, trails:1.00, bossFx:1.00, decorMul:1.00, renderScale:2.00},
  veryhigh: {glow:1.00, particleMul:1.35, bgDetail:1.25, trails:1.30, bossFx:1.30, decorMul:1.20, renderScale:2.00},
  ultra:    {glow:1.00, particleMul:1.80, bgDetail:1.55, trails:1.70, bossFx:1.65, decorMul:1.40, renderScale:2.50},
};
window.GLOW_MAX = GLOW_MAX;
let GFX = GFX_TIERS.high;
window.GFX_TIERS = GFX_TIERS;   // exposed so the settings UI can use tiers as templates
// Apply an arbitrary set of graphics values (each a multiplier). Missing keys
// fall back to the 'high' template. This is what lets every graphics parameter
// be tuned individually; presets just pre-fill these values.
window.applyGfxValues = function(g){
  g = g || {};
  const b = GFX_TIERS.high;
  const pick = (k)=> (g[k]!=null && !isNaN(+g[k])) ? +g[k] : b[k];
  GFX = {
    // Потолок на свечении держим здесь, а не только в настройках: сюда
    // приходят и сохранённые раньше значения (у кого стояло 165%), и то, что
    // подставит адаптивное качество.
    glow:        Math.min(GLOW_MAX, pick('glow')),
    particleMul: pick('particleMul'),
    bgDetail:    pick('bgDetail'),
    trails:      pick('trails'),
    bossFx:      pick('bossFx'),
    decorMul:    pick('decorMul'),
    renderScale: pick('renderScale'),
  };
  if (typeof window.GFX_MAX_PARTICLES === 'number') window.MAX_PARTICLES_DYN = window.GFX_MAX_PARTICLES;
  if (typeof window.applyRenderResolution === 'function') window.applyRenderResolution();
  // Свечения масштабируются централизованно — см. _syncGlowHook ниже.
  if (typeof _syncGlowHook === 'function') _syncGlowHook();
};
window.applyGfxTier = function(q){
  // Preset → fill GFX with that tier's values (a starting template).
  window.applyGfxValues(GFX_TIERS[q] || GFX_TIERS.high);
};
// Helper: quality-scaled glow. Use in place of `ctx.shadowBlur=N` when you want the
// effect dimmed/disabled on lower tiers. Returns 0 on verylow so save()/restore() can be skipped.
function glow(n){ return (GFX.glow * n) | 0; }

// ── Тир качества применяется ко ВСЕМ свечениям ─────────────────────────────
// Код рисования задаёт ctx.shadowBlur числом напрямую в 344 местах и лишь в
// восьми — через glow(). То есть настройка «Качество графики» почти не влияла
// на самое дорогое, что есть в Canvas 2D: каждое ненулевое размытие тени —
// это отдельный проход размытия по пикселям, и на слабом железе именно оно
// съедает кадр.
//
// Правим один раз здесь, а не в трёхстах местах: так тир действует на всё
// сразу и не разойдётся с кодом рисования при следующих правках.
//
// Перехват ставится ТОЛЬКО когда множитель отличается от единицы. На «высоком»
// (множитель 1) свойство остаётся нативным — картинка не меняется ни на пиксель
// и не появляется лишнего вызова на каждую установку тени.
// Объявления через var: applyGfxValues выше по файлу зовёт _syncGlowHook, и
// настройки могут применить тир раньше, чем выполнится эта строка. С let/const
// такой вызов упал бы на временной мёртвой зоне.
var _sbDesc=Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype,'shadowBlur');
var _sbHooked=false;
function _syncGlowHook(){
  if(!_sbDesc)_sbDesc=Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype,'shadowBlur');
  if(!_sbDesc||!_sbDesc.set||typeof ctx==='undefined')return;
  const need=(GFX.glow!==1);
  if(need===_sbHooked)return;
  if(need){
    Object.defineProperty(ctx,'shadowBlur',{
      configurable:true,
      get(){ return _sbDesc.get.call(this); },
      set(v){ _sbDesc.set.call(this, v>0 ? v*GFX.glow : 0); },
    });
  } else {
    delete ctx.shadowBlur;   // назад к нативному свойству прототипа
  }
  _sbHooked=need;
}
_syncGlowHook();   // тир мог быть применён до объявления этой функции

// ── Colour + alpha suffix ──────────────────────────────────────────────────
// Most theme colours in this file are written as 3-digit shorthand ('#0ff'),
// and several drawing sites appended a 2-digit alpha to them ("withAlpha(CT.mc,'cc')").
// That produces '#0ffcc' — a 5-digit value that is NOT a valid CSS colour:
// canvas silently IGNORES it when assigned to fillStyle/strokeStyle (so the
// previous colour is used instead), and addColorStop() throws outright, which
// took down the whole draw() frame — that is what broke the level-clear
// ── Prism Anomaly recolour ──────────────────────────────────────────────────
// Turning a sprite rainbow is NOT the same as hue-rotating it. hue-rotate()
// only spins whatever hue the pixel already had: a dark brown brick becomes a
// dark shifted brown, and a grey spike (no hue at all) does not change one bit.
// That is what made the secret world look like a rainbow smeared over the other
// worlds' art instead of a world made of light.
//
// This chain throws the original colour away and rebuilds it:
//   grayscale(1)  keep only the sprite's light and shade
//   sepia(1)      lay down one uniform base tone (its hue is ~40°)
//   saturate(N)   push that tone to a real, vivid colour
//   hue-rotate()  move it to the hue we actually want
//   brightness()  lift it back up — grayscale+sepia darkens midtones
// The result keeps every sprite's shape, shading and readable silhouette while
// its colour is genuinely ours.
//
// Callers must quantise `hue` (20-30° steps): the canvas re-parses a filter
// whenever the string changes, so repeating strings is what keeps this cheap.
const _PRISM_SEPIA_HUE=40;
function prismFilter(hue,sat,bright){
  const h=(((hue-_PRISM_SEPIA_HUE)%360)+360)%360;
  return 'grayscale(1) sepia(1) saturate('+(sat||7)+') hue-rotate('+h+'deg) brightness('+(bright||1.15)+')';
}

// ── Преломление объектов: включено или нет ─────────────────────────────────
// ctx.filter — самая дорогая операция canvas2d: каждый объект с фильтром
// уходит в отдельный проход растеризации. Замер на этой же машине: двадцать
// кирпичей с этим фильтром — 145 мс на кадр против 0.9 мс без него, при
// бюджете кадра 16.7 мс. Квантование оттенка (оно уже было) стоимость
// уменьшает, но не меняет порядок. Именно это и делает 11-й мир неиграбельным
// на телефоне, где GPU слабее, а экран плотнее.
//
// Настройка «Радужный мир → Преломление» (вкладка «Графика») оставляет выбор
// игроку: 'on' — как задумано, 'off' — шипы и враги в своих обычных цветах,
// 'auto' — выключено там, где не потянет. Всё остальное (спектральное небо,
// призма, платформы, кирпичи, монеты, пружины, декор) работает в любом случае:
// эти вещи не красятся фильтром поверх старого цвета, а сразу собираются из
// спектра — градиентами и кэшированными спрайтами.
/* ── Это устройство управляется пальцем? ───────────────────────────────────
   Раньше по всей игре стояла проверка `'ontouchstart' in window ||
   navigator.maxTouchPoints > 0`. Она отвечает на вопрос «есть ли у устройства
   сенсорный ввод ХОТЬ КАКОЙ-НИБУДЬ», а не «играют ли на нём пальцем». У любого
   ноутбука с сенсорным экраном — а таких давно большинство — она истинна, и
   человек с клавиатурой получал поверх игры экранный джойстик.

   `(pointer: coarse)` спрашивает про ОСНОВНОЙ указатель. На телефоне это палец,
   на ноутбуке с тачскрином — тачпад, то есть точный. Ровно то различие, которое
   нам нужно. Старая проверка осталась запасной — на случай, если matchMedia
   почему-то нет.

   Вдобавок: если с устройства хоть раз нажали клавишу, клавиатура у него точно
   есть, и экранные кнопки в автоматическом режиме не нужны. Это добирает
   пограничные случаи — планшет с чехлом-клавиатурой, ноутбук-трансформер. */
let _sawRealKeyboard=false;
window.addEventListener('keydown',function(e){
  // Игнорируем то, что шлёт сама система: интересны только настоящие нажатия.
  if(e&&e.isTrusted&&e.key&&e.key!=='Unidentified')_sawRealKeyboard=true;
},{capture:true,passive:true});

function bbIsTouchDevice(){
  try{
    if(typeof window.matchMedia==='function'){
      if(_sawRealKeyboard)return false;
      return window.matchMedia('(pointer: coarse)').matches;
    }
  }catch(e){ /* старый движок — падаем на прежнюю проверку */ }
  return ('ontouchstart' in window)||navigator.maxTouchPoints>0;
}
/** Показывать ли экранное управление с учётом настройки игрока. */
function bbWantsTouchUI(){
  const s=window.gameSettings;
  const mode=s&&s.touchControls;
  if(mode==='on')return true;
  if(mode==='off')return false;
  return bbIsTouchDevice();
}
window.bbIsTouchDevice=bbIsTouchDevice;
window.bbWantsTouchUI=bbWantsTouchUI;

function prismFxOn(){
  const s=window.gameSettings;
  const v=(s&&s.prismFx)||'auto';
  if(v==='on')return true;
  if(v==='off')return false;
  if(bbWantsTouchUI())return false;   // телефон/планшет
  const g=(s&&s.gfx)||{};                                        // слабый тир графики
  return !((g.glow!=null&&g.glow<0.6)||(g.bgDetail!=null&&g.bgDetail<0.6));
}
window.prismFxOn=prismFxOn;

/* Ход радужного перелива.
 *
 * Оттенок всего в одиннадцатом мире складывается из места и времени:
 * hue=(x*k + tick*k). Время и даёт то самое переливание. Когда игрок включил
 * оптимизацию (Преломление → Выключено), время из формулы уходит — мир
 * остаётся радужным (оттенок по-прежнему разный вдоль уровня), но перестаёт
 * мерцать. Это не косметика: с постоянным оттенком перестают пересчитываться
 * градиенты и спрайты, которые иначе собираются заново каждый кадр.
 *
 * Значение кэшируется на кадр: prismFxOn() читает настройки, а зовут его из
 * циклов по платформам, блокам и шипам. */
let _pfTick=-1,_pfVal=0;
function prismFlow(){
  if(_pfTick!==tick){ _pfTick=tick; _pfVal=prismFxOn()?tick:0; }
  return _pfVal;
}
window.prismFlow=prismFlow;
// Подкраски кирпича поверх его коричневого здесь больше нет: полупрозрачная
// заливка ОСТАВЛЯЛА старый цвет под собой, и блок выходил бурым с радужным
// налётом — не тем цветом, каким светятся платформы рядом. Кирпич в этом мире
// рисуется из спектра сразу (см. drawPrismBlock), и фильтр ему не нужен вовсе.
// transition wipe in every world whose main colour is shorthand.
// This expands shorthand first, so the result is always a valid 8-digit hex.
function withAlpha(col,aa){
  if(typeof col!=='string'||col.charAt(0)!=='#')return col;
  const h=col.slice(1);
  if(h.length===3)return '#'+h[0]+h[0]+h[1]+h[1]+h[2]+h[2]+aa;
  if(h.length===6)return col+aa;
  return col; // already 4/8-digit (has its own alpha) — leave it alone
}
window.withAlpha=withAlpha;

// ── Cheap bloom system ─────────────────────────────────────────────────────
// shadowBlur is by far the most expensive 2D-canvas operation (re-blurs the whole
// shape every draw). Instead we pre-render a soft radial-gradient "glow blob" once
// per colour into an offscreen canvas, then stamp it with drawImage + 'lighter'
// (additive) blending — which is GPU-accelerated and essentially free per call.
const _glowCache = {};
function _glowSprite(col){
  let s = _glowCache[col];
  if(s) return s;
  const R = 32; // sprite radius in px
  const c = document.createElement('canvas');
  c.width = c.height = R*2;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(R,R,0,R,R,R);
  grd.addColorStop(0,   col);
  grd.addColorStop(0.35, col);
  grd.addColorStop(1,   'transparent');
  g.fillStyle = grd;
  g.beginPath(); g.arc(R,R,R,0,Math.PI*2); g.fill();
  s = {canvas:c, R};
  _glowCache[col] = s;
  return s;
}
// Stamp an additive glow blob of given world-radius/alpha. Caller is responsible for
// wrapping batches in save()/globalCompositeOperation='lighter' for max throughput,
// but this also works standalone.
function bloom(x,y,radius,col,alpha){
  if(GFX.glow<=0) return;
  const s=_glowSprite(col);
  const sz=radius*2*GFX.glow;
  const pa=ctx.globalAlpha;
  ctx.globalAlpha=alpha;
  ctx.drawImage(s.canvas, x-sz/2, y-sz/2, sz, sz);
  ctx.globalAlpha=pa;
}

// ── THEMES ──────────────────────────────────────
// pN / pM / pC are the [shadow, body, edge] colours of normal / moving /
// crumbling platforms. The EDGE is what the player actually reads as "this is
// solid ground", so it always stays bright and clearly separated from that
// world's background; the body stays dark so the level never fights the
// foreground for attention.
const THEMES=[
  // Cyber City used to hand out Mario-grass green platforms (#0f8 edge) in a
  // cyan-and-neon city, which is what made the whole world look mismatched.
  // Now: wet dark steel with a cyan neon edge, amber for moving, hot pink for
  // crumbling — the same palette the skyline signage uses.
  {id:0,name:'CYBER CITY',    icon:'🏙',range:'1–10',   mc:'#0ff',
   bg:'#04040f',bg2:'#090920',grid:'#4af',grd:['#132238','#070d18'],gE:'#3cf',
   pN:['#0b1726','#16334d','#3cf'],pM:['#2a1c06','#4a3410','#fb4'],pC:['#2c0a1c','#4e1030','#f47'],clr:'#33ccff'},
  // Jungle: deep leaf-shadow green with a bright emerald edge, wet bark for
  // moving platforms, rotten orange for crumbling.
  {id:1,name:'NEON JUNGLE',   icon:'🌿',range:'11–20',  mc:'#4f8',
   bg:'#010a01',bg2:'#020c02',grid:'#3f7',grd:['#0b2a0c','#041205'],gE:'#5fb',
   pN:['#0a2410','#12421c','#5fb'],pM:['#2a1c06','#432c0e','#e9a'],pC:['#2a0806','#451210','#f86'],clr:'#44ffaa'},
  {id:2,name:'LAVA WORLD',    icon:'🌋',range:'21–30',  mc:'#f62',
   bg:'#0e0200',bg2:'#180400',grid:'#f42',grd:['#2e0c00','#180600'],gE:'#f62',
   pN:['#2a0a00','#500e00','#f82'],pM:['#280e00','#4a1a00','#faa'],pC:['#1e0408','#340810','#f24'],clr:'#ff6622'},
  // Ice: translucent blue ice with a near-white rim, so a ledge reads as frozen
  // rather than as the same murky navy as the cave behind it.
  {id:3,name:'ICE CAVES',     icon:'❄',range:'31–40',  mc:'#8cf',
   bg:'#020810',bg2:'#041018',grid:'#6af',grd:['#17324e','#0a1a2c'],gE:'#dff',
   pN:['#14304c','#20567e','#cfe'],pM:['#0e2440','#1a3c66','#7bf'],pC:['#221038','#3a1a52','#c9f'],clr:'#aaddff'},
  {id:4,name:'DESERT RUINS',  icon:'🏜',range:'41–50',  mc:'#e8a',
   bg:'#100a00',bg2:'#1a1200',grid:'#c84',grd:['#3a2800','#201400'],gE:'#e8a',
   pN:['#2e1c00','#4e3400','#e8a'],pM:['#241800','#3c2800','#fca'],pC:['#2a0e00','#440e00','#f84'],clr:'#eebb66'},
  {id:5,name:'SPACE STATION', icon:'🛸',range:'51–60',  mc:'#a0f',
   bg:'#040010',bg2:'#080020',grid:'#80f',grd:['#180840','#0c0428'],gE:'#b0f',
   pN:['#160834','#2c1060','#a0f'],pM:['#1c0840','#301870','#60f'],pC:['#24082c','#400c50','#e0c'],clr:'#aa00ff'},
  // Dark Forest is the darkest world in the game, and its platforms used to be
  // near-black on near-black (#0b4 edge on #061a06 body) — the ledges were
  // genuinely hard to see. Same mossy bark, but the rim is now a bright
  // bio-luminescent green so the geometry reads without lightening the mood.
  {id:6,name:'DARK FOREST',   icon:'🌲',range:'61–70',  mc:'#0b4',
   bg:'#010602',bg2:'#020a02',grid:'#0a3',grd:['#0a1f0c','#040e05'],gE:'#3e9',
   pN:['#08200a','#103a16','#3e9'],pM:['#141e02','#243608','#ad5'],pC:['#1e0c06','#341408','#e73'],clr:'#33ee99'},
  {id:7,name:'TOXIC ZONE',    icon:'☣',range:'71–80',  mc:'#cf0',
   bg:'#060a00',bg2:'#0a0e00',grid:'#ac0',grd:['#162800','#0c1600'],gE:'#df0',
   pN:['#142200','#244000','#cf0'],pM:['#201800','#342800','#fc0'],pC:['#180a00','#2c1000','#f80'],clr:'#ccff00'},
  {id:8,name:'STORM PEAKS',   icon:'⚡',range:'81–90',  mc:'#88f',
   bg:'#080810',bg2:'#0c0c1a',grid:'#66c',grd:['#1c1c28','#101018'],gE:'#88f',
   pN:['#141828','#202840','#66c'],pM:['#181428','#28203c','#44c'],pC:['#24102c','#3c1848','#c4f'],clr:'#8888ff'},
  // Final Fortress: forged iron plate, lit along the edge like cooling metal.
  {id:9,name:'FINAL FORTRESS',icon:'🔱',range:'91–100', mc:'#f44',
   bg:'#0c0000',bg2:'#180000',grid:'#f22',grd:['#241014','#100608'],gE:'#f96',
   pN:['#1c1014','#38181c','#f96'],pM:['#2a1200','#4a2000','#fb6'],pC:['#22061a','#3e0a2e','#f4b'],clr:'#ff8866'},
  // Secret 11th world — unlocked only after all 10 Rainbow Shards are found
  // (see rainbowCount() in this file / WorldMap's gate). A corrupted fragment
  // of GRID that ARCHON tried to erase rather than delete outright.
  {id:10,name:'PRISM ANOMALY',icon:'🌈',range:'101–110',mc:'#f0f',
   bg:'#0a0018',bg2:'#140028',grid:'#f0f',grd:['#2a0840','#180430'],gE:'#f8f',
   pN:['#200840','#3c1060','#f0f'],pM:['#402008','#602c10','#ff8'],pC:['#083030','#105050','#0ff'],clr:'#ff44ff'},
];
let CT=THEMES[0];

// Localized world name: i18n key "world0".."world9" (falls back to the English
// constant baked into THEMES if a locale is missing the key).
function worldName(idOrTheme){
  const id=(typeof idOrTheme==='object'&&idOrTheme)?idOrTheme.id:idOrTheme;
  const def=(THEMES[id]&&THEMES[id].name)||'';
  const k='world'+id;
  const tr=T(k);
  return (tr&&tr!==k)?tr:def;
}
// Localized boss name: i18n key "boss0".."boss9".
function bossName(b){
  const id=(b&&typeof b.worldId==='number')?b.worldId:(typeof b==='number'?b:-1);
  const def=(b&&b.name)||'';
  if(id<0)return def;
  const k='boss'+id;
  const tr=T(k);
  return (tr&&tr!==k)?tr:def;
}
window.worldName=worldName;window.bossName=bossName;

// ── Seeded RNG ───────────────────────────────────
function mkRNG(seed){
  let s=(seed*747796405+2891336453)>>>0;
  return()=>{s=(Math.imul(s^s>>>15,s|1)^(s^s>>>8))>>>0;return s/4294967296;};
}

// ════════════════════════════════════════════════
//  AUDIO ENGINE  (fully procedural, no samples)
// ════════════════════════════════════════════════
let AC=null,MG=null,SG=null,MUG=null,MCOMP=null,MFILT=null,MTONE=null;
let musicPlaying=false,mTimer=null,audioOn=true;

// Apply volume settings from gameSettings
window.applyAudioVolumes=function(){
  if(!AC||!MG||!SG||!MUG)return;
  try{
    // Volume sliders are 0..100 (0 = fully muted). Gain scales directly with the value.
    const master=(window.gameSettings&&typeof window.gameSettings.masterVolume==='number')?window.gameSettings.masterVolume:100;
    const music=(window.gameSettings&&typeof window.gameSettings.musicVolume==='number')?window.gameSettings.musicVolume:100;
    const sfx=(window.gameSettings&&typeof window.gameSettings.sfxVolume==='number')?window.gameSettings.sfxVolume:100;
    // Master honours the mute toggle; sub-buses scale by their own slider.
    MG.gain.value=audioOn?(Math.max(0,master)/100):0;
    MUG.gain.value=Math.max(0,music)/100;
    SG.gain.value=Math.max(0,sfx)/100;
  }catch(e){}
};

// Apply gameplay-related settings that map onto game globals / DOM.
// Called once on load and again whenever settings are saved.
window.applyGameplaySettings=function(){
  const s=window.gameSettings||{};
  // Show/hide the bottom hint bar.
  const hint=document.getElementById('hint');
  if(hint)hint.style.display=(s.showHints===false)?'none':'';
};
let _audioAutoSuspendInit=false;
// Music/SFX used to keep playing forever in the background — Web Audio
// contexts are NOT paused automatically when a tab is hidden or the window is
// minimized, only when the page is actually closed. Suspending the single
// shared AudioContext on hide (and resuming on show) silences everything
// (procedural tones AND the baked-sample player, since both route through
// this same `AC`) with zero per-sound bookkeeping, and playback resumes
// exactly where it left off.
function _initAudioAutoSuspend(){
  if(_audioAutoSuspendInit||!AC)return;
  _audioAutoSuspendInit=true;
  const suspend=()=>{ if(AC&&AC.state==='running')AC.suspend().catch(()=>{}); };
  const resume=()=>{ if(AC&&AC.state==='suspended'&&!document.hidden)AC.resume().catch(()=>{}); };
  document.addEventListener('visibilitychange',()=>{ document.hidden?suspend():resume(); });
  // Electron/desktop: minimizing or Alt-Tabbing away doesn't always toggle
  // document.hidden depending on OS/window manager, so also listen for the
  // window itself losing/gaining OS focus.
  window.addEventListener('blur',suspend);
  window.addEventListener('focus',resume);
}
function initAudio(){
  if(AC)return;
  try{
    AC=new(window.AudioContext||window.webkitAudioContext)();
    // Master bus -> gentle limiter -> speakers. The compressor "glues" the mix and
    // stops harsh clipping when many chiptune voices + drums stack on a beat.
    MG=AC.createGain();MG.gain.value=1.0;
    MCOMP=AC.createDynamicsCompressor();
    MCOMP.threshold.value=-12;MCOMP.knee.value=24;MCOMP.ratio.value=3.5;MCOMP.attack.value=.003;MCOMP.release.value=.25;
    MG.connect(MCOMP);MCOMP.connect(AC.destination);
    // SFX bus straight to master.
    SG=AC.createGain();SG.gain.value=1.0;SG.connect(MG);
    // Music volume bus. Drums tap in here directly (kept bright). Melodic/bass
    // voices first pass a soft low-pass (MTONE -> MFILT -> MUG) so the square/saw
    // upper harmonics are warmer and less fatiguing without dulling the hi-hats.
    MUG=AC.createGain();MUG.gain.value=1.0;MUG.connect(MG);
    MTONE=AC.createGain();MTONE.gain.value=1.0;
    MFILT=AC.createBiquadFilter();MFILT.type='lowpass';MFILT.frequency.value=5400;MFILT.Q.value=.4;
    MTONE.connect(MFILT);MFILT.connect(MUG);
    applyAudioVolumes();
    // Start decoding the baked .mp3 samples (music + SFX). Once ready the game
    // plays those instead of synthesising every note live — smooth on phones.
    if(window.AudioFiles&&typeof window.AudioFiles.init==='function'){
      try{window.AudioFiles.init(AC,SG,MUG);}catch(e){}
    }
    _initAudioAutoSuspend();
  }catch(e){}
}

// Safe tone creation — returns immediately if context unavailable
function tone(freq,type,dur,vol=.22,dst=null,detune=0){
  if(!AC||!audioOn)return;
  try{
    const now=AC.currentTime;
    const g=AC.createGain();g.connect(dst||SG);
    g.gain.setValueAtTime(0,now);
    g.gain.linearRampToValueAtTime(vol,now+.005);
    g.gain.exponentialRampToValueAtTime(.0001,now+dur);
    const o=AC.createOscillator();o.type=type;o.frequency.value=freq;
    if(detune)o.detune.value=detune;
    o.connect(g);o.start(now);o.stop(now+dur+.02);
  }catch(e){}
}
// atk — время нарастания. Без него свип всегда врубается на полной громкости и
// щёлкает; нарастающим звукам (зарядка, щит) это нужно.
function sweep(f0,f1,type,dur,vol=.2,dst=null,atk=0){
  if(!AC||!audioOn)return;
  try{
    const now=AC.currentTime;
    const g=AC.createGain();g.connect(dst||SG);
    if(atk>0){g.gain.setValueAtTime(.0001,now);g.gain.linearRampToValueAtTime(vol,now+atk);}
    else g.gain.setValueAtTime(vol,now);
    g.gain.exponentialRampToValueAtTime(.0001,now+dur);
    const o=AC.createOscillator();o.type=type;
    o.frequency.setValueAtTime(f0,now);o.frequency.exponentialRampToValueAtTime(f1,now+dur);
    o.connect(g);o.start(now);o.stop(now+dur+.02);
  }catch(e){}
}
// flt — {type,freq,Q}. Белый шум звучит как помеха; отфильтрованный читается
// как материал: полосовой — металл, низкочастотный — земля, высокий — воздух.
function noise(dur,vol=.15,dst=null,flt=null){
  if(!AC||!audioOn)return;
  try{
    const now=AC.currentTime,sz=AC.sampleRate*dur|0;
    const buf=AC.createBuffer(1,sz,AC.sampleRate),d=buf.getChannelData(0);
    for(let i=0;i<sz;i++)d[i]=(Math.random()*2-1);
    const src=AC.createBufferSource();src.buffer=buf;
    const g=AC.createGain();g.connect(dst||SG);
    g.gain.setValueAtTime(vol,now);g.gain.exponentialRampToValueAtTime(.0001,now+dur);
    if(flt){
      const bq=AC.createBiquadFilter();bq.type=flt.type;bq.frequency.value=flt.freq;
      if(flt.Q)bq.Q.value=flt.Q;
      src.connect(bq);bq.connect(g);
    }else src.connect(g);
    src.start(now);
  }catch(e){}
}

// ── SFX library (procedural fallback). When the baked .mp3 samples are loaded
// (window.AudioFiles), the wrapper SFX below plays those instead — cheaper and
// glitch-free on phones. Names here MUST match the SFX file names.
// Звуки описаны в assets/sfx-data.js — там же, откуда их берёт генератор mp3.
// Раньше определения жили двумя копиями и разъезжались, а часть была пустыми
// заглушками: land() не издавал вообще ничего.
const SFX_PROC={};
(function(){
  const D=window.BBSfx;
  if(!D)return;
  const play=(ev)=>{
    const go=()=>{
      if(ev.k==='tone')tone(ev.f,ev.type,ev.dur,ev.vol,null,ev.detune||0);
      else if(ev.k==='sweep')sweep(ev.f0,ev.f1,ev.type,ev.dur,ev.vol,null,ev.attack||0);
      else if(ev.k==='noise')noise(ev.dur,ev.vol,null,ev.filter||null);
    };
    // Ноль играем сразу: на нулевой задержке setTimeout только добавил бы
    // дрожание там, где точность важнее всего — в момент удара.
    if(ev.start>0.001)setTimeout(go,ev.start*1000); else go();
  };
  for(const name of D.names){
    const evs=D.SFX[name];
    SFX_PROC[name]=function(){ for(let i=0;i<evs.length;i++)play(evs[i]); };
  }
})();
// Реплика диалогов: высота меняется от вызова к вызову, поэтому запечь её в
// файл нельзя — получился бы один и тот же повторяющийся писк.
SFX_PROC.voiceBlip=function(){const f=1100+Math.random()*260;tone(f,'square',.032,.09);};
// Убраны намеренно: постоянный писк таймера раздражал.
SFX_PROC.timerTick=function(){};
SFX_PROC.timeLow=function(){};
// Public SFX: prefer the baked .mp3 sample, fall back to the procedural voice.
// Built as a wrapper over SFX_PROC so every existing SFX.xxx() call site is
// unchanged. Empty procedural entries (land/timerTick/timeLow) just no-op.
const SFX={};
for(const _k of Object.keys(SFX_PROC)){
  SFX[_k]=function(){
    if(window.AudioFiles&&window.AudioFiles.sfxReady&&window.AudioFiles.playSfx(_k))return;
    SFX_PROC[_k]();
  };
}

// ── MUSIC ENGINE ──────────────────────────────────
// ── Percussion voices (routed through the music-volume bus, MUG, so they follow
// the music slider but skip the tonal low-pass and stay crisp). Lightweight: a
// couple of nodes each, all auto-stopped.
function _drumKick(now,vol){
  if(!AC||!audioOn)return;
  try{
    const o=AC.createOscillator(),g=AC.createGain();
    o.type='sine';o.frequency.setValueAtTime(135,now);o.frequency.exponentialRampToValueAtTime(45,now+.13);
    g.gain.setValueAtTime(.0001,now);g.gain.linearRampToValueAtTime(vol,now+.004);g.gain.exponentialRampToValueAtTime(.0001,now+.18);
    o.connect(g);g.connect(MUG);o.start(now);o.stop(now+.2);
  }catch(e){}
}
function _drumHat(now,vol){
  if(!AC||!audioOn)return;
  try{
    const dur=.03,sz=AC.sampleRate*dur|0,buf=AC.createBuffer(1,sz,AC.sampleRate),d=buf.getChannelData(0);
    for(let i=0;i<sz;i++)d[i]=Math.random()*2-1;
    const src=AC.createBufferSource();src.buffer=buf;
    const hp=AC.createBiquadFilter();hp.type='highpass';hp.frequency.value=7000;
    const g=AC.createGain();g.gain.setValueAtTime(vol,now);g.gain.exponentialRampToValueAtTime(.0001,now+dur);
    src.connect(hp);hp.connect(g);g.connect(MUG);src.start(now);
  }catch(e){}
}
function _drumSnare(now,vol){
  if(!AC||!audioOn)return;
  try{
    const dur=.12,sz=AC.sampleRate*dur|0,buf=AC.createBuffer(1,sz,AC.sampleRate),d=buf.getChannelData(0);
    for(let i=0;i<sz;i++)d[i]=Math.random()*2-1;
    const src=AC.createBufferSource();src.buffer=buf;
    const bp=AC.createBiquadFilter();bp.type='bandpass';bp.frequency.value=1900;bp.Q.value=.7;
    const g=AC.createGain();g.gain.setValueAtTime(vol,now);g.gain.exponentialRampToValueAtTime(.0001,now+dur);
    src.connect(bp);bp.connect(g);g.connect(MUG);src.start(now);
    const o=AC.createOscillator(),og=AC.createGain();o.type='triangle';o.frequency.value=180;
    og.gain.setValueAtTime(vol*.5,now);og.gain.exponentialRampToValueAtTime(.0001,now+.09);
    o.connect(og);og.connect(MUG);o.start(now);o.stop(now+.1);
  }catch(e){}
}
function hz(b,s){return b*Math.pow(2,s/12);}
const SC={PENT:[0,2,4,7,9,12,14,16],MIN:[0,3,5,7,10,12,15,17],HARM:[0,2,3,7,8,12,14,15],CHR:[0,1,4,7,8,12,13,16],DORI:[0,2,3,7,9,12,14,15]};
// Паттерны музыки переехали в assets/music-data.js: там же, откуда берёт ноты
// генератор mp3, чтобы две копии больше не расходились.
function stopMusic(){musicPlaying=false;if(mTimer){clearTimeout(mTimer);mTimer=null;}if(window.AudioFiles)window.AudioFiles.stopMusic();}
// Remembers how to (re)start the current track, so when the .mp3 samples finish
// decoding mid-session we can seamlessly switch from the procedural fallback to
// the baked loop (see window.onAudioFilesReady below).
let _curMusicStart=null;
// Try to play track `name` from the baked .mp3 samples. Returns false (→ caller
// uses the procedural engine) if the samples aren't loaded yet.
function _tryMusicFile(name){
  if(!AC||!audioOn)return false;
  if(!(window.AudioFiles&&window.AudioFiles.musicReady))return false;
  if(mTimer){clearTimeout(mTimer);mTimer=null;}      // stop the procedural loop
  if(window.AudioFiles.playMusic(name)){musicPlaying=true;return true;}
  return false;
}
// Called by AudioFiles once decoding completes: upgrade the currently-playing
// procedural track to its .mp3 loop.
window.onAudioFilesReady=function(){ if(musicPlaying&&_curMusicStart)_curMusicStart(); };
// Партитуру берём из assets/music-data.js — того же файла, из которого печётся
// Audio/Music/*.mp3, поэтому запасной движок и готовые треки звучат одинаково.
// Разбор формы стоит пары миллисекунд, но при паузе/возобновлении музыка
// перезапускается часто, поэтому результат держим в кэше.
const _songCache={};
let _song=null,_songMap=null;
function _getSong(name){
  if(!_songCache[name]&&window.BBMusic){
    const s=window.BBMusic.buildSong(name);
    if(s){s.map=window.BBMusic.byStep(s);_songCache[name]=s;}
  }
  return _songCache[name]||null;
}
// Запасной движок тоже знает про стиль: иначе на телефоне до загрузки файлов
// всегда играл бы чиптюн, даже когда выбран обычный звук.
//
// Фильтр общий на всю музыку, а не на ноту: отдельный узел на каждую ноту
// съел бы весь смысл экономии, ради которой запасной движок и существует.
let _mLP=null;
function _modernMusic(){ return !(window.gameSettings&&window.gameSettings.musicStyle==='chip'); }
function _mBus(){
  if(!_modernMusic())return MTONE;
  if(!_mLP&&AC){
    try{ _mLP=AC.createBiquadFilter();_mLP.type='lowpass';_mLP.frequency.value=4600;_mLP.Q.value=.5;_mLP.connect(MTONE); }
    catch(e){ _mLP=null; }
  }
  return _mLP||MTONE;
}
function _mTick(step){
  if(!musicPlaying||!AC||!audioOn||!_song)return;
  const sec=_song.spb,now=AC.currentTime;
  const list=_songMap[step%_song.steps];
  const modern=_modernMusic(),bus=_mBus();
  if(list)for(let i=0;i<list.length;i++){
    const e=list[i];
    // Нота звучит почти всю свою длительность: короткие огрызки и превращали
    // мелодию в долбёжку.
    const d=sec*(e.len||1)*.9;
    // Тембр берём из события: он свой у каждого слоя и у каждого мира.
    // В обычном стиле пилу и квадрат смягчаем до треугольника: наивные волны
    // Web Audio и дают ту самую восьмибитную жёсткость.
    const w=modern?(e.w==='sawtooth'||e.w==='square'?'triangle':e.w||'sine'):(e.w||'square');
    switch(e.k){
      // Второй расстроенный голос добавляет толщины — в чиптюне он не нужен.
      case 'lead': tone(e.f,w,d,e.vol,bus,7); if(modern)tone(e.f,w,d,e.vol*.5,bus,-11); break;
      case 'lead2':tone(e.f,w,d,e.vol,bus,-9); break;
      case 'bass': tone(e.f,w,d,e.vol,bus); break;
      case 'sub':  tone(e.f,modern?'sine':w,d,e.vol,bus); break;
      case 'arp':  tone(e.f,w,sec*(e.len||1)*.7,e.vol,bus,4); break;
      case 'kick': _drumKick(now,e.vol); break;
      case 'snare':_drumSnare(now,e.vol); break;
      case 'hat':  _drumHat(now,e.vol); break;
    }
  }
  mTimer=setTimeout(()=>_mTick(step+1),sec*1000);
}
function startMusic(name){
  if(!AC||!audioOn)return;
  const s=_getSong(name);
  if(!s)return;
  stopMusic();
  _song=s;_songMap=s.map;musicPlaying=true;_mTick(0);
}
function startMenuMusic(){_curMusicStart=startMenuMusic;if(_tryMusicFile('menu'))return;startMusic('menu');}
// У Призматической аномалии (мир 10) теперь своя тема — раньше секретный мир
// доигрывал музыку Финальной крепости.
function startGameMusic(){const wi=Math.min(CT.id,10);_curMusicStart=startGameMusic;if(typeof AchTrack!=='undefined')AchTrack.music(Math.min(wi,9));if(_tryMusicFile('world'+wi))return;startMusic('world'+wi);}
function startBossMusic(){_curMusicStart=startBossMusic;if(_tryMusicFile('boss'))return;startMusic('boss');}
function startMapMusic(){_curMusicStart=startMapMusic;if(_tryMusicFile('worldmap'))return;startMusic('worldmap');}
function startStarMusic(){_curMusicStart=startStarMusic;if(_tryMusicFile('star'))return;startMusic('star');}
function startVictoryMusic(){_curMusicStart=startVictoryMusic;if(_tryMusicFile('victory'))return;startMusic('victory');}

function showBossIntro(b){
  const ov=document.getElementById('bossIntroOv');
  // Boss pre-fight dialogue — play cutscene then show card
  const wi=Math.min(Math.floor(((advMode?advLevel:level)-1)/10),10);
  const bossDialogId='boss_pre_'+wi;
  function _showCard(){
    document.getElementById('bossIntroName').textContent='⚔ '+bossName(b)+' ⚔';
    document.getElementById('bossIntroHint').textContent=T('bossHint'+wi);
    ov.style.display='flex';
    stopMusic();
    setTimeout(()=>{if(boss&&boss.alive)startBossMusic();},200);
    setTimeout(()=>{ov.style.display='none';},3200);
  }
  // Boss pre-fight lines are in CSCENES w{wi}_boss — play them if not yet shown.
  // In a network game we must NOT pause for the cutscene: each client triggers
  // the arena locally at its own moment, so a blocking gState='paused' freezes
  // the fight out of sync (and the host's frozen boss is what guests see). Show
  // only the non-blocking card; the simulation keeps running for everyone.
  const preId='w'+wi+'_boss';
  if(!window.netActive&&typeof CSCENES!=='undefined'&&CSCENES[preId]&&!_csFired[preId]){
    markCsFired(preId);
    gState='paused';
    csPlay(preId,wi,function(){gState='playing';_showCard();});
  } else {
    _showCard();
  }
}


function toggleAudio(){
  audioOn=!audioOn;
  // Re-apply volumes so the master bus respects both the mute toggle and the slider value.
  if(typeof applyAudioVolumes==='function')applyAudioVolumes();
  else if(MG)MG.gain.value=audioOn?1:0;
  document.getElementById('audioBtn').textContent=audioOn?'🔊':'🔇';
  if(audioOn&&(gState==='playing'||gState==='paused'))startGameMusic();
  else if(!audioOn)stopMusic();
}
document.getElementById('audioBtn').onclick=()=>{initAudio();toggleAudio();};

// ════════════════════════════════════════════════
//  INPUT / NAVIGATION
// ════════════════════════════════════════════════
const K={};
let navScr='main';
// Cheat code: type "UNLOCK" anywhere to unlock all levels
let _cheatBuf='';
const _CHEAT='UNLOCK';
// Extra cheats
let godMode=false;
let infiniteLives=false;
let infiniteJump=false;
const _CHEATS={
  'HARDUNLOCK':()=>{advProgHard.max=100;advProgHard.done=[...Array(100)].map((_,i)=>i+1);saveAdvH();if(navScr==='map'){if(window.WorldMap&&window.WorldMap.refresh){window.WorldMap.refresh(true);}else{buildMapH();}}if(window.Achievements)window.Achievements.unlock('achievement_cheat_found');return'💀 ALL HARDCORE LEVELS UNLOCKED!'},
  'UNLOCK':    ()=>{advProg.max=100;advProg.done=[...Array(100)].map((_,i)=>i+1);saveAdv();if(navScr==='map'){if(window.WorldMap&&window.WorldMap.refresh){window.WorldMap.refresh(false);}else{buildMap();}}if(window.Achievements)window.Achievements.unlock('achievement_cheat_found');return'🔓 ALL NORMAL LEVELS UNLOCKED!'},
  'GODMODE':   ()=>{godMode=!godMode;if(window.Achievements)window.Achievements.unlock('achievement_cheat_found');return godMode?'😇 GOD MODE ON — you are immortal':'💀 GOD MODE OFF'},
  'GOD':       ()=>{godMode=!godMode;if(window.Achievements)window.Achievements.unlock('achievement_cheat_found');return godMode?'😇 GOD MODE ON — you are immortal':'💀 GOD MODE OFF'},
  'LIVES':     ()=>{infiniteLives=!infiniteLives;lives=infiniteLives?99:3;if(window.Achievements)window.Achievements.unlock('achievement_cheat_found');return infiniteLives?'♾ INFINITE LIVES ON (×99)':'❤ INFINITE LIVES OFF'},
  'JUMP':      ()=>{infiniteJump=!infiniteJump;if(window.Achievements)window.Achievements.unlock('achievement_cheat_found');return infiniteJump?'🕊 INFINITE JUMPS ON — прыгай сколько хочешь':'🥾 INFINITE JUMPS OFF'},
  'FLY':       ()=>{infiniteJump=!infiniteJump;if(window.Achievements)window.Achievements.unlock('achievement_cheat_found');return infiniteJump?'🕊 INFINITE JUMPS ON — прыгай сколько хочешь':'🥾 INFINITE JUMPS OFF'},
  'BOSSDEBUG': ()=>{window._bbDebugBoss=!window._bbDebugBoss;return window._bbDebugBoss?'🐞 Boss debug logging ON (check console)':'🐞 Boss debug logging OFF'},
  'RAINBOW':   ()=>{
    for(let w=0;w<10;w++) markRainbowCollected(w);
    if(window.Achievements)window.Achievements.unlock('achievement_cheat_found');
    return '🌈 All 10 Rainbow Shards collected — Prism Anomaly unlocked!';
  },
};
// Cheat codes sorted longest-first so that a longer code (e.g. HARDUNLOCK, GODMODE)
// is matched before any shorter code it happens to end with (UNLOCK, GOD).
const _CHEAT_CODES=Object.keys(_CHEATS).sort((a,b)=>b.length-a.length);
document.addEventListener('keydown',ev=>{
  // Don't hijack typing in form fields (settings: resolution/scale/fps inputs)
  const t=ev.target;
  if(t&&(t.tagName==='INPUT'||t.tagName==='SELECT'||t.tagName==='TEXTAREA'||t.isContentEditable))return;
  initAudio();
  if(ev.code==='Escape'){doEsc();return;}
  K[ev.code]=true;
  // Cheat accumulator (letter keys only)
  if(ev.key&&ev.key.length===1){
    _cheatBuf=(_cheatBuf+ev.key.toUpperCase()).slice(-12);
    for(const code of _CHEAT_CODES){
      if(_cheatBuf.endsWith(code)){
        const msg=document.createElement('div');
        msg.style.cssText='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#000c;color:#0f8;border:1px solid #0f8;font:bold 14px monospace;padding:14px 28px;border-radius:8px;z-index:9999;pointer-events:none;text-align:center;';
        msg.textContent=_CHEATS[code]();
        document.body.appendChild(msg);
        setTimeout(()=>msg.remove(),2500);
        _cheatBuf='';
        break;
      }
    }
  }
  const _gameKeys=['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space','KeyA','KeyW','KeyS','KeyD','KeyZ','KeyX','Period','Comma','Slash','ControlLeft','ControlRight','Escape'];
  // Also suppress default behaviour for any custom-bound control keys.
  const _bound=(window.gameSettings&&window.gameSettings.controls)?Object.values(window.gameSettings.controls):[];
  if(_gameKeys.includes(ev.code)||_bound.includes(ev.code))ev.preventDefault();
});
document.addEventListener('keyup',ev=>{K[ev.code]=false;});
// First user gesture (click/tap) also unlocks audio + menu music (autoplay policy)
function _audioUnlock(){
  initAudio();
  if(AC&&AC.state==='suspended'){try{AC.resume();}catch(e){}}
  if(audioOn&&!musicPlaying&&navScr==='main')startMenuMusic();
}
document.addEventListener('pointerdown',_audioUnlock,{once:true});

function doEsc(){
  // Экран итогов обрабатывает Escape сам (уйти на карту / в меню). Без этой
  // проверки на одно нажатие приходилось бы два звука и две реакции.
  if(window.Results&&window.Results.isOpen&&window.Results.isOpen())return;
  SFX.back();
  if(navScr==='playType')    {navScr='main';showMain();}
  else if(navScr==='netType'){navScr='playType';showPlayType();}
  else if(navScr==='mode')   {navScr='playType';showPlayType();}
  else if(navScr==='diff')   {navScr='mode';showMode();}
  else if(navScr==='map')    {navScr='diff';showDiff();}
  else if(navScr==='game')   {doPause();}
  else if(navScr==='paused') {doResume();}
}

// ── Enemy config  (moveType: 'walk'|'bounce'|'float'|'shoot') ─────
// Each world has 3 enemies: [light-walker, heavy-fighter, flier]
// score field = points on kill
// ── Enemy config — 5 per world, unique mechanics ─
// moveType: walk | bounce | float | shoot | charge | shield | spin | zigzag | orbit | dash
const EC={
  // ── World 0 CYBER CITY ──────────────────────────
  cy_glitch: {w:24,h:26,spd:1.4,hp:1,col:'#cc22ee',glow:'#f0f',moveType:'walk',  score:100},
  cy_tank:   {w:34,h:32,spd:0.6,hp:2,col:'#224488',glow:'#4af',moveType:'shield',score:200},
  cy_probe:  {w:26,h:20,spd:1.8,hp:1,col:'#00ccff',glow:'#0ff',moveType:'float', score:100},
  cy_sniper: {w:22,h:28,spd:0.2,hp:1,col:'#4422aa',glow:'#88f',moveType:'shoot', score:120},
  cy_rusher: {w:26,h:26,spd:1.0,hp:1,col:'#ee2288',glow:'#f4a',moveType:'charge',score:130},
  // ── World 1 NEON JUNGLE ─────────────────────────
  jg_vine:   {w:24,h:30,spd:1.2,hp:1,col:'#228822',glow:'#4f8',moveType:'walk',  score:100},
  jg_beast:  {w:34,h:32,spd:1.0,hp:2,col:'#884400',glow:'#f80',moveType:'bounce',score:200},
  jg_spore:  {w:24,h:24,spd:1.4,hp:1,col:'#44cc44',glow:'#8f4',moveType:'orbit', score:110},
  jg_pitcher:{w:22,h:28,spd:0.3,hp:1,col:'#005522',glow:'#0f4',moveType:'shoot', score:120},
  jg_creeper:{w:26,h:24,spd:1.1,hp:1,col:'#116611',glow:'#4c2',moveType:'charge',score:130},
  // ── World 2 LAVA WORLD ──────────────────────────
  lv_ember:  {w:24,h:28,spd:1.5,hp:1,col:'#cc3300',glow:'#f62',moveType:'walk',  score:100},
  lv_golem:  {w:36,h:38,spd:0.5,hp:2,col:'#441100',glow:'#f40',moveType:'shield',score:220},
  lv_spark:  {w:22,h:22,spd:2.0,hp:1,col:'#ff4400',glow:'#f84',moveType:'spin',  score:110},
  lv_magma:  {w:28,h:26,spd:0.4,hp:1,col:'#882200',glow:'#f22',moveType:'shoot', score:120},
  lv_eruption:{w:28,h:28,spd:1.2,hp:1,col:'#ff6600',glow:'#fa0',moveType:'charge',score:130},
  // ── World 3 ICE CAVES ───────────────────────────
  ic_shard:  {w:24,h:28,spd:1.3,hp:1,col:'#4488cc',glow:'#8cf',moveType:'bounce',score:100},
  ic_yeti:   {w:36,h:38,spd:0.7,hp:2,col:'#aaccee',glow:'#cef',moveType:'walk',  score:200},
  ic_wisp:   {w:16,h:22,spd:1.6,hp:1,col:'#66aaff',glow:'#acf',moveType:'zigzag',score:110},
  ic_icicle: {w:16,h:30,spd:0.3,hp:1,col:'#3366aa',glow:'#6af',moveType:'shoot', score:120},
  ic_snowball:{w:28,h:28,spd:1.4,hp:1,col:'#cce8ff',glow:'#8df',moveType:'charge',score:130},
  // ── World 4 DESERT RUINS ────────────────────────
  ds_scarab: {w:28,h:22,spd:1.6,hp:1,col:'#aa6600',glow:'#e8a',moveType:'walk',  score:100},
  ds_mummy:  {w:26,h:34,spd:0.7,hp:2,col:'#ccbb88',glow:'#fca',moveType:'shield',score:220},
  ds_hawk:   {w:28,h:20,spd:2.2,hp:1,col:'#cc8800',glow:'#fa4',moveType:'orbit', score:110},
  ds_scorpion:{w:30,h:22,spd:0.5,hp:1,col:'#884400',glow:'#c62',moveType:'shoot', score:120},
  ds_sandworm:{w:32,h:22,spd:1.0,hp:2,col:'#886633',glow:'#da8',moveType:'charge',score:150},
  // ── World 5 SPACE STATION ───────────────────────
  sp_droid:  {w:26,h:30,spd:1.3,hp:1,col:'#8844cc',glow:'#a0f',moveType:'walk',  score:100},
  sp_mech:   {w:34,h:36,spd:0.6,hp:2,col:'#442266',glow:'#80f',moveType:'shoot', score:200},
  sp_saucer: {w:30,h:18,spd:1.8,hp:1,col:'#6622cc',glow:'#b0f',moveType:'zigzag',score:110},
  sp_turret: {w:26,h:30,spd:0.0,hp:2,col:'#2a1a44',glow:'#60f',moveType:'shoot', score:150},
  sp_phantom:{w:28,h:28,spd:1.5,hp:1,col:'#cc44ff',glow:'#e8f',moveType:'charge',score:130},
  // ── World 6 DARK FOREST ─────────────────────────
  df_shade:  {w:24,h:30,spd:1.4,hp:1,col:'#1a0a2a',glow:'#80f',moveType:'walk',  score:100},
  df_troll:  {w:36,h:38,spd:0.7,hp:2,col:'#1a2a0a',glow:'#0b4',moveType:'shield',score:220},
  df_bat:    {w:30,h:20,spd:2.0,hp:1,col:'#0a0a1a',glow:'#44f',moveType:'orbit', score:110},
  df_owl:    {w:28,h:28,spd:0.3,hp:1,col:'#221133',glow:'#84f',moveType:'shoot', score:120},
  df_lurker: {w:26,h:28,spd:1.2,hp:1,col:'#0a0a22',glow:'#448',moveType:'charge',score:130},
  // ── World 7 TOXIC ZONE ──────────────────────────
  tx_slug:   {w:30,h:20,spd:1.0,hp:1,col:'#446600',glow:'#cf0',moveType:'walk',  score:100},
  tx_blob:   {w:32,h:28,spd:1.1,hp:2,col:'#335500',glow:'#af0',moveType:'bounce',score:200},
  tx_fly:    {w:26,h:20,spd:2.1,hp:1,col:'#557700',glow:'#df0',moveType:'spin',  score:110},
  tx_venom:  {w:24,h:26,spd:0.4,hp:1,col:'#224400',glow:'#6c0',moveType:'shoot', score:120},
  tx_mutant: {w:32,h:30,spd:1.2,hp:2,col:'#3a4400',glow:'#9c0',moveType:'charge',score:150},
  // ── World 8 STORM PEAKS ─────────────────────────
  st_gust:   {w:26,h:28,spd:1.6,hp:1,col:'#223366',glow:'#88f',moveType:'walk',  score:100},
  st_titan:  {w:36,h:40,spd:0.6,hp:2,col:'#1a1a3a',glow:'#66f',moveType:'shield',score:220},
  st_bolt:   {w:22,h:28,spd:2.2,hp:1,col:'#4444cc',glow:'#aaf',moveType:'zigzag',score:110},
  st_rod:    {w:20,h:32,spd:0.2,hp:1,col:'#3333aa',glow:'#99f',moveType:'shoot', score:120},
  st_cyclone:{w:28,h:28,spd:1.4,hp:1,col:'#5566cc',glow:'#ccf',moveType:'charge',score:130},
  // ── World 9 FINAL FORTRESS ──────────────────────
  ff_guard:  {w:28,h:34,spd:0.9,hp:1,col:'#440000',glow:'#f44',moveType:'shoot', score:150},
  ff_demon:  {w:38,h:42,spd:0.8,hp:3,col:'#220000',glow:'#f00',moveType:'charge',score:300},
  ff_eye:    {w:26,h:26,spd:1.9,hp:1,col:'#880000',glow:'#f22',moveType:'orbit', score:120},
  ff_sentinel:{w:32,h:36,spd:0.5,hp:2,col:'#330000',glow:'#f80',moveType:'shield',score:200},
  ff_wraith: {w:26,h:32,spd:1.6,hp:1,col:'#550011',glow:'#f0a',moveType:'zigzag',score:140},
  // ── NEW ENEMY TYPES (distributed across worlds) ─────────────────────────────
  cy_spiker: {w:28,h:28,spd:1.0,hp:1,col:'#cc2288',glow:'#f4a',moveType:'spiked', score:150},
  jg_splitter:{w:30,h:30,spd:0.8,hp:2,col:'#448822',glow:'#8f4',moveType:'split',  score:180},
  lv_armored:{w:34,h:34,spd:0.6,hp:3,col:'#662200',glow:'#f62',moveType:'armored',score:250},
  ic_spiker: {w:28,h:28,spd:1.1,hp:1,col:'#6688cc',glow:'#acf',moveType:'spiked', score:150},
  ds_armored:{w:34,h:34,spd:0.5,hp:3,col:'#aa8844',glow:'#fca',moveType:'armored',score:250},
  sp_spiker: {w:28,h:28,spd:1.2,hp:1,col:'#8844cc',glow:'#b0f',moveType:'spiked', score:150},
  tx_splitter:{w:30,h:30,spd:0.9,hp:2,col:'#557700',glow:'#cf0',moveType:'split',  score:180},
  ff_armored:{w:36,h:36,spd:0.7,hp:4,col:'#440000',glow:'#f44',moveType:'armored',score:300},
  // ── World 10 PRISM ANOMALY (secret) ─────────────
  pr_shard:  {w:26,h:28,spd:1.5,hp:2,col:'#cc22cc',glow:'#f0f',moveType:'walk',  score:200},
  pr_guard:  {w:34,h:34,spd:0.7,hp:3,col:'#2266cc',glow:'#0ff',moveType:'shield',score:300},
  pr_wisp:   {w:24,h:24,spd:1.9,hp:1,col:'#ffcc22',glow:'#ff8',moveType:'orbit', score:180},
  pr_beam:   {w:24,h:30,spd:0.3,hp:2,col:'#22cc88',glow:'#8f8',moveType:'shoot', score:220},
  pr_glitch: {w:28,h:28,spd:1.3,hp:2,col:'#cc2266',glow:'#f4c',moveType:'charge',score:250},
};

// 5-enemy pools per world [walk1, tank, flier, shooter, special]
const WORLD_POOLS=[
  ['cy_glitch','cy_tank',  'cy_probe',  'cy_sniper', 'cy_rusher' ], // 0 Cyber City
  ['jg_vine',  'jg_beast', 'jg_spore',  'jg_pitcher','jg_creeper'], // 1 Neon Jungle
  ['lv_ember', 'lv_golem', 'lv_spark',  'lv_magma',  'lv_eruption'],// 2 Lava World
  ['ic_shard', 'ic_yeti',  'ic_wisp',   'ic_icicle', 'ic_snowball'],// 3 Ice Caves
  ['ds_scarab','ds_mummy', 'ds_hawk',   'ds_scorpion','ds_sandworm'],// 4 Desert Ruins
  ['sp_droid', 'sp_mech',  'sp_saucer', 'sp_turret', 'sp_phantom'], // 5 Space Station
  ['df_shade', 'df_troll', 'df_bat',    'df_owl',    'df_lurker' ], // 6 Dark Forest
  ['tx_slug',  'tx_blob',  'tx_fly',    'tx_venom',  'tx_mutant' ], // 7 Toxic Zone
  ['st_gust',  'st_titan', 'st_bolt',   'st_rod',    'st_cyclone'], // 8 Storm Peaks
  ['ff_guard', 'ff_demon', 'ff_eye',    'ff_sentinel','ff_wraith' ], // 9 Final Fortress
  ['pr_shard', 'pr_guard', 'pr_wisp',   'pr_beam',   'pr_glitch' ], // 10 Prism Anomaly (secret)
];

function worldIdx(n){return Math.min(Math.floor(((n||1)-1)/10),10);}
// Which world an enemy type belongs to, from its 2-letter prefix. Used by the
// status-effect system to decide what a given enemy leaves on the player, so a
// desert scarab can't inflict the Ice Caves' chill just because you met it in
// infinite mode. Returns -1 for an unknown type.
const _ENEMY_WORLD={};
WORLD_POOLS.forEach((pool,wi)=>pool.forEach(t=>{_ENEMY_WORLD[t]=wi;}));
function worldOfEnemyType(t){const w=_ENEMY_WORLD[t];return w===undefined?-1:w;}
window.worldOfEnemyType=worldOfEnemyType;
// Denominator for the "level X / Y" readouts. The main story is 100 levels; the
// secret Prism Anomaly world adds 101–110, and showing "101/100" there looked
// like a counter bug.
function advTotalLevels(){
  // Demo build: the campaign is the demo's own level count and nothing else —
  // every "x / 100" readout in the UI has to say "x / 10" instead.
  if(window.Demo&&window.Demo.on)return window.Demo.levels;
  if(advLevel>100)return 110;
  try{ if(typeof rainbowCount==='function'&&rainbowCount()>=10)return 110; }catch(e){}
  const prog=(typeof hardMode!=='undefined'&&hardMode)?advProgHard:advProg;
  if(prog&&prog.max>100)return 110;
  if(prog&&prog.done&&prog.done.some(n=>n>100))return 110;
  return 100;
}
window.advTotalLevels=advTotalLevels;
function ePool(n){
  const wi=worldIdx(n),pool=WORLD_POOLS[wi];
  const lv=(n-1)%10+1; // 1-10 within world
  if(lv<=2)  return [pool[0]];
  if(lv<=4)  return [pool[0],pool[0],pool[1]];
  if(lv<=6)  return [pool[0],pool[1],pool[2],pool[0]];
  if(lv<=8)  return [pool[0],pool[1],pool[2],pool[3],pool[0]];
  return pool; // all 5 on level 9-10
}
function flierType(n){return WORLD_POOLS[worldIdx(n)][2];}
function eCounts(n){
  if(n<=3)  return{g:2,d:0};if(n<=6)  return{g:3,d:1};
  if(n<=12) return{g:5,d:1};if(n<=22) return{g:7,d:2};
  if(n<=40) return{g:10,d:3};if(n<=65) return{g:13,d:4};
  return{g:16,d:6};
}
function lvlTime(n){return 120+Math.round(n*1.4);}

// ════════════════════════════════════════════════
//  GAME STATE
// ════════════════════════════════════════════════
let gState='menu';
let score=0,lives=3,level=1,advLevel=1,advMode=false;
let coinsTotal=0;       // total coins collected across all levels (every 100 → +1 HP)
// ── Per-level vs total scoring ──
// `score` is the running TOTAL across the whole run. `levelStartScore` snapshots
// the total at the moment a level begins, so the per-level score is the delta
// `score - levelStartScore`. `levelMaxScore` is the best achievable score for the
// current level (all coins + all enemies + flag + bonuses), used to grade stars.
let levelStartScore=0;  // total score when the current level started
let levelMaxScore=1;    // max achievable score this level (>=1, avoids /0)
let levelCoinMax=0;     // coin points available this level
let levelEnemyMax=0;    // enemy/boss points available this level
function curLevelScore(){return Math.max(0,score-levelStartScore);}
// Монеты этого уровня — та же схема, что и со счётом: coinsTotal копится за
// весь забег, поэтому уровень считаем как прирост от точки старта.
let levelStartCoins=0;
function curLevelCoins(){return Math.max(0,coinsTotal-levelStartCoins);}
let _coinsHpStep=0;     // last HP threshold reached (for 100/200/300… +1 HP triggers)
let advProg={max:1,done:[]};
let hardMode=false;                          // Hardcore difficulty active
let advProgHard={max:1,done:[]};             // Separate hard-mode progress

/* ── Уровень дня ────────────────────────────────────────────────────────────
   Отдельный режим рядом с кампанией и бесконечным: уровень собирается из даты
   и слота (см. assets/daily.js), у всех получается одинаковым, а результат
   идёт в суточную таблицу. Кампании он не касается совсем — ни прогресс, ни
   звёзды, ни катсцены здесь не трогаются, поэтому нужен свой флаг, а не
   попытка выдать день за advMode. */
let dailyMode=false;      // идёт забег уровня дня
let dailySlot=null;       // 'easy' | 'normal' | 'hard' | 'random' | 'mutator'
// Архетип и мутаторы уровня дня задаёт сид дня, а не номер уровня. Генератор
// спрашивает их через pickArchetype/pickModifiers, поэтому подменяем ответ, а
// не переписываем сам генератор.
let dailyForce=null;      // {arch:'classic', mods:{...}} пока строится уровень дня
var _csFired={};                             // Tracks fired cutscenes (early decl for showBossIntro)
var _csShownWorlds={};                       // Tracks which world-intro cutscenes have played (early decl, see loadCsFired)
// Persisted per save-slot (see SaveSlots' CANON map above) so switching slots
// doesn't carry one profile's "already seen" cutscenes over to another, and a
// fresh slot always sees every cutscene again.
function loadCsFired(){
  // _plainMap: значение вида "null" или массива тоже разбирается без ошибки,
  // а дальше по коду с ним работают как с объектом — см. _normProg.
  try{const s=localStorage.getItem('bbCsFired');_csFired=_plainMap(s?JSON.parse(s):{});}catch(e){_csFired={};}
  try{const s2=localStorage.getItem('bbCsWorlds');_csShownWorlds=_plainMap(s2?JSON.parse(s2):{});}catch(e){_csShownWorlds={};}
}
function saveCsFired(){try{localStorage.setItem('bbCsFired',JSON.stringify(_csFired));}catch(e){}}
function saveCsShownWorlds(){try{localStorage.setItem('bbCsWorlds',JSON.stringify(_csShownWorlds));}catch(e){}}
// Mark a cutscene id as fired AND persist it immediately — every _csFired[id]=true
// assignment in this file goes through this helper (see below).
function markCsFired(id){_csFired[id]=true;saveCsFired();}
function markCsShownWorld(wi){_csShownWorlds[wi]=true;saveCsShownWorlds();}
let timeLeft=0,timMax=0,tick=0,camX=0,camShake=0,worldW=0,raf;

// ── Mobile view zoom ─────────────────────────────────────────────────────────
// A phone shows the same 800×420 logical view as a 27" monitor, so on a 6"
// screen everything is physically tiny — that is the "игра мелкая" report. This
// magnifies the world (the player sees LESS of it, but bigger) while the HUD,
// timer bar and boss bar stay put, because they are drawn outside the zoom.
//
// Deliberately mobile-only: on desktop _viewZoom() returns 1 and every line of
// the zoom path is skipped, so the PC build is untouched.
let _vzX=W*0.5,_vzY=H*0.6;
function _viewZoom(){
  const s=window.gameSettings;
  if(!s)return 1;
  if(!bbWantsTouchUI())return 1;
  let z=s.mobileZoom;
  // 0 / unset = Auto: the smaller the screen, the more magnification it needs.
  if(!z||isNaN(+z)){
    const w=window.innerWidth||800;
    z=w<520?1.45:(w<700?1.30:(w<900?1.18:1.0));
  }
  return Math.max(1,Math.min(+z,2.5));
}
// Point of the scene that stays in the centre of the screen. Follows the player
// smoothly and is clamped so the zoom never shows past the edges of the view.
function _updateViewFocus(z){
  const halfX=W/(2*z),halfY=H/(2*z);
  const p=(typeof player!=='undefined'&&player)?player:null;
  // Bias right of the player so there is still road visible ahead of them.
  const tx=p?(p.x+p.w/2-camX)+W*0.10:W*0.5;
  const ty=p?(p.y+p.h/2):H*0.6;
  const cx=Math.max(halfX,Math.min(tx,W-halfX));
  const cy=Math.max(halfY,Math.min(ty,H-halfY));
  // Snap instead of gliding when the target jumps (level start, respawn,
  // checkpoint) — otherwise the camera visibly flies across the level.
  if(Math.abs(cx-_vzX)>260||Math.abs(cy-_vzY)>200){_vzX=cx;_vzY=cy;return;}
  _vzX+=(cx-_vzX)*0.15;_vzY+=(cy-_vzY)*0.15;
}
window._viewZoom=_viewZoom;
// `tick` is a script-level `let`, so it is not a window property and other
// modules cannot read it by name (and a module with its own `tick` would shadow
// it). This accessor is the supported way to read the frame counter from
// assets/*.js siblings — see the NaN gradient bug in status.js.
window.__bbTick=function(){return tick;};
// Снимок мира для проверок из консоли — по тому же принципу, что и __bbTick:
// всё содержимое уровня живёт в скриптовых `let`, и снаружи его иначе не
// увидеть. Отдаются сами массивы, а не копии: это диагностика, а не API, и
// копирование тысяч объектов на каждый вызов было бы дороже самой проверки.
// Используется в тестах генератора (см. docs/TESTING.md).
window.__bbWorld=function(){
  return {get platforms(){return platforms;},get blocks(){return blocks;},
    get hazards(){return hazards;},get coins(){return coins;},
    get dataShards(){return dataShards;},get enemies(){return enemies;},
    get worldW(){return worldW;},get camX(){return camX;},
    get flagX(){return flagX;},get W(){return W;},get H(){return H;}};
};
let _goNextTimer=0;        // handle for the level-advance timeout (cancellable)
let player,platforms,blocks,coins,enemies,pBullets,eBullets,powerups,particles,decors;
// Unique, ever-increasing id for every enemy created (initial level population AND
// enemies spawned later, e.g. split-enemy children). Network sync uses this id
// instead of array index so it stays correct even when host and guest enemy
// arrays temporarily differ in length (see mkEnemy / applyEnemiesSync).
let _enemyIdSeq=0;
let fireBalls=[],iceBalls=[];
let checkpoints=[];        // mid-level checkpoint flags
let _cpSafeZone=null;      // {x,y,w,h} — area around the checkpoint kept hazard-free
let cpSave=null;           // {lvl,color} — checkpoint to resume from on adventure retry

/* ── ЖИЗНИ ────────────────────────────────────────────────────────────────────
   Раньше жизни ни на что не влияли: кончились — уровень просто начинался
   заново с тремя новыми. Теперь у них есть цена, и она разная в двух режимах.

   Обычный режим. Жизнь тратится на возвращение к чекпоинту. Кончились —
   уровень с самого начала: чекпоинт снимается, и участок до него приходится
   пройти заново. Записанные достижения уровня (лучшие звёзды и кристаллы) при
   этом не понижаются: отнимать уже заслуженное — наказание, которого никто не
   ждёт. Сбрасывается только текущая попытка.

   Хардкор. Жизни общие на весь мир, а не на уровень: десять уровней проходятся
   на одном запасе. Кончились — мир начинается с первого уровня, и прогресс
   ЭТОГО мира откатывается.

   Что именно откатывается в хардкоре: у хардкора отдельное хранилище
   (advProgHard, ключ bbAdvH), поэтому обычное прохождение не затрагивается
   вообще. Внутри хардкорного прогресса чистятся только десять уровней текущего
   мира — отметки о прохождении, звёзды и кристаллы, — а `max` возвращается к
   первому уровню мира. Другие миры остаются как были. */
const HARD_WORLD_LIVES=5;   // запас на весь мир в хардкоре
let hardWorldLives=HARD_WORLD_LIVES;
let hardWorldIdx=-1;        // для какого мира выдан запас

const worldOf=(lvl)=>Math.floor((Math.max(1,lvl)-1)/10);
const worldFirstLevel=(w)=>w*10+1;

/** Начало мира в хардкоре: выдаём общий запас жизней один раз на мир. */
function _hardEnterWorld(lvl){
  const w=worldOf(lvl);
  if(w!==hardWorldIdx){hardWorldIdx=w;hardWorldLives=HARD_WORLD_LIVES;}
}

/**
 * Жизни кончились. Куда возвращать — зависит от режима.
 * Зовётся из кнопки «ещё раз» на экране поражения.
 */
function _outOfLives(){
  lives2=3;
  if(hardMode&&advMode){
    const first=_hardWipeWorld(advLevel);
    lives=hardWorldLives;
    cpSave=null;                    // мир начинается заново, чекпоинт не нужен
    startAdv(first,false);
    return;
  }
  // Обычный режим: тот же уровень, но с самого начала.
  lives=3;
  // Упрощённый режим оставляет чекпоинт. Смысл жизней при этом не пропадает —
  // они всё так же кончаются и всё так же стоят очков, — но длинный уровень не
  // приходится переигрывать с нуля из-за одной трудной секции в конце.
  // Хардкор выше по функции разбирается сам и сюда не доходит.
  if(!(window.gameSettings&&window.gameSettings.gameMode==='easy'))cpSave=null;
  startAdv(advLevel,false);
}

/**
 * Хардкор: запас на мир кончился. Откатываем прогресс этого мира и
 * возвращаемся к его первому уровню.
 */
function _hardWipeWorld(lvl){
  const w=worldOf(lvl),first=worldFirstLevel(w),last=first+9;
  const prog=advProgHard;
  prog.done=(prog.done||[]).filter(n=>n<first||n>last);
  if(prog.stars)for(let n=first;n<=last;n++)delete prog.stars[n];
  if(prog.shards)for(let n=first;n<=last;n++)delete prog.shards[n];
  // max не опускаем ниже начала мира — иначе игрок потеряет и прошлые миры.
  prog.max=Math.max(1,Math.min(prog.max,first));
  saveAdvH();
  if(window.WorldMap&&window.WorldMap.refresh)window.WorldMap.refresh(true);
  hardWorldIdx=w;hardWorldLives=HARD_WORLD_LIVES;
  return first;
}

/**
 * Возвращает мир к состоянию на момент взятия чекпоинта.
 *
 * Без этого смерть после чекпоинта отматывала уровень целиком: враги, которых
 * игрок уже прошёл, оживали, а собранные монеты появлялись снова — и участок до
 * чекпоинта приходилось проходить заново, хотя возрождение происходило после
 * него. Кристаллы так восстанавливались и раньше, остальное — нет.
 *
 * Уровень строится детерминированно по номеру, поэтому при пересборке порядок
 * элементов тот же и снимка по позициям достаточно. Длины сверяем на всякий
 * случай: враги умеют делиться на лету, и в живом забеге массив длиннее, чем
 * при чистой генерации.
 */
function _restoreCpWorld(){
  if(!cpSave)return;
  if(cpSave.coins&&typeof coins!=='undefined')
    for(let i=0;i<coins.length&&i<cpSave.coins.length;i++) if(cpSave.coins[i])coins[i].got=true;
  if(cpSave.enemies&&typeof enemies!=='undefined')
    for(let i=0;i<enemies.length&&i<cpSave.enemies.length;i++) if(cpSave.enemies[i])enemies[i].alive=false;
  if(cpSave.powerups&&typeof powerups!=='undefined')
    for(let i=0;i<powerups.length&&i<cpSave.powerups.length;i++) if(cpSave.powerups[i])powerups[i].got=true;
}
let player2=null;          // P2 object (null = not in use)
let lives2=3;              // P2 lives (separate from P1)
let twoPlayer=false;       // 2-player mode active?
let levelArchetype='classic'; // Level archetype: classic, speedrun, stealth
let levelMods={};          // Level modifiers: {lowGravity, wind, slippery, darkness, ...}
let hazards=[];            // Hazards: spikes, lasers, etc.
// ── Level variety (mechanics 4 = moving saws/plasma pendulums, 7 = secret data
//    shards + bonus rooms, 10 = per-world thematic hazards). Declared here so the
//    generator, updater and renderer all share the same top-level bindings. ──
let dataShards=[];         // collectible secret data-shards (mechanic 7)
let dataShardsTotal=0,dataShardsGot=0,shardBonusGiven=false;
// ── Rainbow Shards (secret collectible: 1 per world, 10 total) ─────────────
// Collecting all 10 unlocks the secret 11th world (see WorldMap / THEMES[10]).
// Fixed per-world level (1-9, never the boss level) so it's the same level on
// every replay, not re-randomized each attempt — still feels "hidden" since
// the player has no way to know which level ahead of time.
const RAINBOW_LEVEL_IN_WORLD=[4,7,2,8,5,1,9,3,6,2];
let rainbowItem=null;            // the current level's rainbow shard entity, or null
let rainbowCollected={};         // {worldIndex: true} — persisted, see loadRainbow()/markRainbowCollected()
function loadRainbow(){
  try{const s=localStorage.getItem('bbRainbow');rainbowCollected=_plainMap(s?JSON.parse(s):{});}catch(e){rainbowCollected={};}
}
function saveRainbow(){try{localStorage.setItem('bbRainbow',JSON.stringify(rainbowCollected));}catch(e){}}
function rainbowCount(){return Object.keys(rainbowCollected).filter(k=>rainbowCollected[k]).length;}
// Read-only accessor for the world map: has THIS world's shard been found?
// worldmap.js cannot see the top-level `rainbowCollected` binding directly.
window.rainbowHasShard=function(w){try{return !!rainbowCollected[w];}catch(e){return false;}};
function markRainbowCollected(worldIdx){rainbowCollected[worldIdx]=true;saveRainbow();if(typeof AchTrack!=='undefined')AchTrack.rainbow(rainbowCount());}
let jumpPads=[];           // Jump pads
let conveyors=[];          // Conveyor belts
let buttons=[];            // Buttons
let doors=[];              // Doors
let spotlights=[];         // Spotlights for stealth levels
let mazeKeys=[];           // Keys for maze levels
let mazeKeysCollected=0;   // Keys collected in current maze level
// Each time the player crosses a 100-coin boundary: repair the robot if it's
// broken, otherwise award +1 life. (Repairing a broken robot is more valuable
// in the moment than a spare life, so it takes priority.)
function _checkCoinHp(cx,cy,p){
  const step=Math.floor(coinsTotal/100);
  if(step>_coinsHpStep){
    _coinsHpStep=step;
    if(p&&p.broken){
      p.broken=false;
      burst(cx+7,cy+7,'#4f8',22,5,6);
      floatTxt(cx,cy-18,T('repaired'),'#4f8');
    } else {
      lives++;if(hardMode&&advMode)hardWorldLives=Math.max(0,lives);
      burst(cx+7,cy+7,'#ff2266',22,5,6);
      floatTxt(cx,cy-18,T('hpBonus'),'#ff2266');
    }
    camShake=Math.max(camShake,7);
    [440,554,659,880].forEach((f,i)=>setTimeout(()=>tone(f,'sine',.14,.3),i*55));
  }
}
// Returns array of alive, active players
// Cached: rebuilding a fresh array every call added GC pressure since this runs
// inside hot per-enemy loops (nearestPlayer etc). The cache is cheap and
// self-invalidating — it rebuilds only when the underlying player refs/flags
// actually change (join/leave, 2P toggle), otherwise it returns the same array.
let _playerCache=[];
let _playerCacheP1=null,_playerCacheP2=null,_playerCacheTwo=null;
// Bumped every time the cache is actually rebuilt. activePlayersAll() below
// keys off this instead of the array's identity — see the bug note there.
let _playerCacheVer=0;
function activePlayers(){
  if(player!==_playerCacheP1||player2!==_playerCacheP2||twoPlayer!==_playerCacheTwo){
    _playerCache.length=0;
    if(player)_playerCache.push(player);
    if(twoPlayer&&player2)_playerCache.push(player2);
    _playerCacheP1=player;_playerCacheP2=player2;_playerCacheTwo=twoPlayer;
    _playerCacheVer++;
  }
  return _playerCache;
}
// Separate function for camera/HUD that includes net ghosts
let _playerAllCache=[];
let _playerAllCacheSize=-1,_playerAllCacheVer=-1;
function activePlayersAll(){
  const base=activePlayers();
  const netCount=(window.netActive&&window.netPlayers)?window.netPlayers.size:0;
  // Rebuild whenever the local roster changed or the number of network ghosts
  // changed (join/leave).
  //
  // This used to compare the BASE ARRAY'S IDENTITY (`_playerAllCacheBase!==base`)
  // — but activePlayers() mutates its cache array in place and never replaces
  // it, so that identity never changes after the first call. The result: this
  // cache was populated once per session and then frozen, so from the SECOND
  // level onwards it still held the player object from the first level.
  //
  // Everything that targets the player through nearestPlayer() — all boss AI,
  // boss stomp/contact detection, and every enemy's chase/aim logic — was
  // therefore acting on a ghost that never moved. The most visible symptom was
  // that bosses could not be stomped at all after the first boss level of a
  // session (the contact test ran against the stale object, which was nowhere
  // near the boss), which made four of the eleven bosses unbeatable.
  if(_playerAllCacheVer!==_playerCacheVer||_playerAllCacheSize!==netCount){
    _playerAllCache.length=0;
    for(const pl of base)_playerAllCache.push(pl);
    if(window.netActive&&window.netPlayers){
      for(const [,e] of window.netPlayers){ if(e.playerObj)_playerAllCache.push(e.playerObj); }
    }
    _playerAllCacheVer=_playerCacheVer;
    _playerAllCacheSize=netCount;
  }
  return _playerAllCache;
}
// Returns the player closest to world-x (for AI targeting)
// Заглушка на случай, когда живых игроков нет вовсе. Возвращать отсюда сам
// `player` было бессмысленно: список пуст ровно тогда, когда player пустой —
// activePlayers() кладёт его только через `if(player)`. То есть «защита»
// всегда отдавала undefined, и любой, кто читал .x у результата, ронял всю
// отрисовку врагов (d_cy_sniper, d_jg_pitcher, d_sp_turret целятся так).
// Координаты подставляем по точке запроса, чтобы враг смотрел прямо, а не
// разворачивался рывком в нулевую точку мира.
const _noPlayer={x:0,y:0,w:0,h:0,vx:0,vy:0,respawning:true};
function nearestPlayer(wx){
  // Include network ghosts so host-side enemy/boss AI targets ALL players, not
  // just the local one (otherwise enemies ignore guests entirely in co-op).
  const ps=(typeof activePlayersAll==='function')?activePlayersAll():activePlayers();
  if(!ps.length){
    if(player)return player;
    _noPlayer.x=wx||0;_noPlayer.y=H*0.5;
    return _noPlayer;
  }
  return ps.reduce((best,p)=>Math.abs(p.x+p.w/2-wx)<Math.abs(best.x+best.w/2-wx)?p:best,ps[0]);
}
let flagX=0,flagDone=false;
let _p2FlagSignal=0;    // >0 = P2 touched the flag this frame (y of touch point)
// Exit animation
let exitAnim=false;     // player is in the victory run-off
let exitTimer=0;        // countdown until next level loads
let exitBonus=0;        // height bonus text
let exitBonusTier='';   // "PERFECT" / "GREAT" / "GOOD" / "BASE"
let exitStars=0;        // stars (1–3) earned on the level just completed
let exitStarsNew=false; // did this run beat the previous best star rating?
let exitTimeBonus=0;    // points awarded for the time left on the clock
let exitBonusCol='';    // colour of the flag tier (shared with the results screen)
let exitLevelScore=0;   // per-level score earned on the level just completed
let spawnX=60,spawnY=H-100;
let boss=null; // active boss object
let bossArenaX=0;      // x coordinate where boss arena begins
let bossArenaTriggered=false; // has player entered the arena?

// ── Загрузка сохранений: форма важна не меньше синтаксиса ───────────────────
// JSON.parse спасает только от синтаксического мусора. Но "null", число или
// объект без поля done — тоже валидный JSON, и такое значение проходило мимо
// catch: игра падала уже в меню («Cannot read properties of undefined»), то
// есть на чёрный экран. Прийти такое может из облачного сохранения, из
// недописанного файла и из ручной правки. Теперь у прогресса проверяется ещё
// и форма, а испорченное значение так же откладывается в <ключ>_corrupt.
function _backupCorrupt(key){
  try{const raw=localStorage.getItem(key);if(raw)localStorage.setItem(key+'_corrupt',raw);}catch(e){}
}
// Простая карта «ключ → значение» (катсцены, радужные осколки, звёзды, очки).
function _plainMap(v){return (v&&typeof v==='object'&&!Array.isArray(v))?v:{};}
// Приводит прогресс к рабочему виду. `key` нужен только для отметки о порче.
function _normProg(o,key){
  const ok=!!o&&typeof o==='object'&&!Array.isArray(o)&&Array.isArray(o.done);
  if(!ok){
    if(o!==null&&o!==undefined){
      console.warn(key+' save has an unexpected shape, falling back to a fresh profile. Raw value backed up under '+key+'_corrupt for support/recovery.');
      _backupCorrupt(key);
    }
    o={max:1,done:[]};
  }
  const max=Number(o.max);
  o.max=(isFinite(max)&&max>=1)?Math.floor(max):1;
  o.stars=_plainMap(o.stars);o.scores=_plainMap(o.scores);o.shards=_plainMap(o.shards);
  o.coins=_plainMap(o.coins);
  return o;
}
function saveAdv(){try{localStorage.setItem('bbAdv3',JSON.stringify(advProg));}catch(e){}}
function loadAdv(){
  let parsed=null;
  try{
    const s=localStorage.getItem('bbAdv3');
    parsed=s?JSON.parse(s):{max:1,done:[]};
  }catch(e){
    console.warn('bbAdv3 save is corrupted, falling back to a fresh profile. Raw value backed up under bbAdv3_corrupt for support/recovery.',e);
    _backupCorrupt('bbAdv3');
  }
  advProg=_normProg(parsed,'bbAdv3');
}
function saveAdvH(){try{localStorage.setItem('bbAdvH',JSON.stringify(advProgHard));}catch(e){}}
function loadAdvH(){
  let parsed=null;
  try{
    const s=localStorage.getItem('bbAdvH');
    parsed=s?JSON.parse(s):{max:1,done:[]};
  }catch(e){
    console.warn('bbAdvH save is corrupted, falling back to a fresh profile. Raw value backed up under bbAdvH_corrupt for support/recovery.',e);
    _backupCorrupt('bbAdvH');
  }
  advProgHard=_normProg(parsed,'bbAdvH');
}

// ── STAR RATINGS (1–3 per level) ──
// Stored per progress slot as prog.stars = { "<levelNum>": 1|2|3 }. Only the
// BEST rating for a level is kept, so replaying can improve but never lower it.
function recordStars(levelNum,count,hard){
  const prog=hard?advProgHard:advProg;
  if(!prog.stars)prog.stars={};
  const prev=prog.stars[levelNum]||0;
  if(count>prev){prog.stars[levelNum]=count;if(hard)saveAdvH();else saveAdv();return true;}
  return false;
}
function levelStars(levelNum,hard){const prog=hard?advProgHard:advProg;return (prog.stars&&prog.stars[levelNum])||0;}
// Total stars earned across all 100 levels of a slot (max 300).
function totalStars(hard){const prog=hard?advProgHard:advProg;if(!prog.stars)return 0;let t=0;for(const k in prog.stars)t+=prog.stars[k]||0;return t;}
window.levelStars=levelStars;window.totalStars=totalStars;

// ── DATA-SHARDS (crystals) progress ──
// prog.shards = { "<levelNum>": bestCollected (0..3) }. Best run kept.
function levelShards(levelNum,hard){const prog=hard?advProgHard:advProg;return (prog.shards&&prog.shards[levelNum])||0;}
// Total shards collected across all levels of a slot (max 300 = 3 × 100).
function totalShards(hard){const prog=hard?advProgHard:advProg;if(!prog.shards)return 0;let t=0;for(const k in prog.shards)t+=prog.shards[k]||0;return t;}
// Record the best shard count for a level (keeps the max ever collected).
function recordLevelShards(levelNum,got,hard){
  got=Math.max(0,Math.min(3,got|0));
  const prog=hard?advProgHard:advProg;
  if(!prog.shards)prog.shards={};
  const prev=prog.shards[levelNum]||0;
  if(got>prev){prog.shards[levelNum]=got;if(hard)saveAdvH();else saveAdv();return true;}
  return false;
}
window.levelShards=levelShards;window.totalShards=totalShards;

// ── МОНЕТЫ ПО УРОВНЯМ ──────────────────────────────────────────────────────
// prog.coins = { "<levelNum>": лучший сбор }. Как и со звёздами, хранится
// лучший результат: перепрохождение может улучшить число, но не обнулить его.
// Общий счётчик монет за всё время живёт отдельно, в статистике достижений, —
// он растёт всегда, даже в бесконечном режиме, а этот привязан к карте.
function levelCoins(levelNum,hard){const prog=hard?advProgHard:advProg;return (prog.coins&&prog.coins[levelNum])||0;}
function totalLevelCoins(hard){const prog=hard?advProgHard:advProg;if(!prog.coins)return 0;let t=0;for(const k in prog.coins)t+=prog.coins[k]||0;return t;}
function recordLevelCoins(levelNum,got,hard){
  got=Math.max(0,got|0);
  const prog=hard?advProgHard:advProg;
  if(!prog.coins)prog.coins={};
  const prev=prog.coins[levelNum]||0;
  if(got>prev){prog.coins[levelNum]=got;if(hard)saveAdvH();else saveAdv();return true;}
  return false;
}
window.levelCoins=levelCoins;window.totalLevelCoins=totalLevelCoins;

// ── PER-LEVEL BEST SCORES ──
// Stored as prog.scores = { "<levelNum>": bestScore }. Only the best run is kept.
function recordLevelScore(levelNum,sc,hard){
  sc=sc|0;
  const prog=hard?advProgHard:advProg;
  if(!prog.scores)prog.scores={};
  const prev=prog.scores[levelNum]||0;
  if(sc>prev){prog.scores[levelNum]=sc;if(hard)saveAdvH();else saveAdv();return true;}
  return false;
}
function levelScore(levelNum,hard){const prog=hard?advProgHard:advProg;return (prog.scores&&prog.scores[levelNum])||0;}
// Total of every level's best score across the slot (the cumulative campaign score).
function totalScore(hard){const prog=hard?advProgHard:advProg;if(!prog.scores)return 0;let t=0;for(const k in prog.scores)t+=prog.scores[k]||0;return t;}
window.levelScore=levelScore;window.totalScore=totalScore;

// Player records (high scores). Persisted in bbRecords and bundled into save slots.
let bestRecords={infinite:0,adventure:0};
// ── Playtime ────────────────────────────────────────────────────────────────
// Counted in whole seconds of ACTUAL play (gState==='playing'), not wall-clock
// time with the game sitting in a menu. Persisted every 20s so a crash loses at
// most that much, and flushed whenever a level ends.
let playSeconds=0,_playTick=0,_playSaveT=0;
function loadPlaytime(){try{playSeconds=parseInt(localStorage.getItem('bbPlaytime'),10)||0;}catch(e){playSeconds=0;}}
function savePlaytime(){try{localStorage.setItem('bbPlaytime',String(playSeconds|0));}catch(e){}}
function tickPlaytime(){
  if(gState!=='playing')return;
  if(++_playTick<60)return;
  _playTick=0;playSeconds++;
  if(++_playSaveT>=20){_playSaveT=0;savePlaytime();}
}
window.bbPlaytime=()=>playSeconds;
function loadRecords(){
  try{
    const s=localStorage.getItem('bbRecords');
    bestRecords=Object.assign({infinite:0,adventure:0},_plainMap(s?JSON.parse(s):{}));
  }catch(e){
    console.warn('bbRecords save is corrupted, falling back to fresh records. Raw value backed up under bbRecords_corrupt for support/recovery.',e);
    _backupCorrupt('bbRecords');
    bestRecords={infinite:0,adventure:0};
  }
  // Рекорд сравнивается числом; строка из чужого файла делала бы сравнение
  // лексикографическим («9» > «100»), и настоящий рекорд не записывался бы.
  ['infinite','adventure'].forEach(k=>{const n=Number(bestRecords[k]);bestRecords[k]=isFinite(n)&&n>0?Math.floor(n):0;});
}
function saveRecords(){try{localStorage.setItem('bbRecords',JSON.stringify(bestRecords));}catch(e){}}
function recordScore(mode,sc){
  sc=sc|0;
  if(mode!=='infinite'&&mode!=='adventure')return;
  if(sc>(bestRecords[mode]||0)){bestRecords[mode]=sc;saveRecords();}
  // Таблица рекордов: хардкор идёт отдельным зачётом, иначе он смешался бы с
  // обычной кампанией, где те же очки даются заметно легче. Отправка молча
  // ничего не делает без входа в аккаунт и без применённой миграции.
  if(window.Leaderboard&&window.Leaderboard.submit){
    const lbMode=(mode==='adventure')?(hardMode?'hardcore':'adventure'):'endless';
    try{window.Leaderboard.submit(lbMode,sc);}catch(e){}
  }
}
loadAdv();loadAdvH();loadRecords();loadPlaytime();loadCsFired();loadRainbow();

// ════════════════════════════════════════════════
//  PARTICLES
// ════════════════════════════════════════════════
// ── Particle system ──────────────────────────────
// Engine fallback cap (used when settings haven't loaded yet). Settings.js sets
// window.GFX_MAX_PARTICLES based on graphics quality; we read it dynamically.
const MAX_PARTICLES = 80;
// Boss levels: fixed camera advance speed (px/frame @ 60fps) — see resolveP()
// and update()'s camera block. ~1.0 covers a typical corridor+arena in well
// under a minute, leaving plenty of time to fight without feeling rushed.
const BOSS_CAM_SPEED = 1.0;
function _maxP(){ return window.GFX_MAX_PARTICLES || MAX_PARTICLES; }
// ── Particle object pool ─────────────────────────────────────────────────────
// `particles` used to grow via push() and shrink via splice() in updateParticles,
// which allocates a fresh object every spawn and does an O(n) array shift on
// every death (expensive with dozens of particles dying the same frame, e.g. a
// big explosion). Instead we pre-allocate a fixed-size pool once; spawning reuses
// a dead slot's object in place (no allocation) and death just flips `alive`
// back to false and returns the index to the free list (O(1), no shifting).
const PARTICLE_POOL_CAP = 400; // generous ceiling above the highest GFX_MAX_PARTICLES tier
let _particleFree = [];
let _particleAliveCount = 0;
function _initParticlePool(){
  if(!particles) particles=[]; else particles.length = 0;
  _particleFree.length = 0;
  _particleAliveCount = 0;
  for(let i=0;i<PARTICLE_POOL_CAP;i++){
    particles.push({alive:false,x:0,y:0,vx:0,vy:0,life:0,decay:0,sz:0,col:null,txt:null});
    _particleFree.push(i);
  }
}
// Grab a free slot, fill it in place, mark alive. Returns null if the pool is
// completely full (extremely rare with a 400-slot ceiling — caller just skips).
// ── ПРИЗМА-АНОМАЛИЯ: ВСЁ ПЕРЕЛИВАЕТСЯ ─────────────────────────────────────
// Одиннадцатый мир — единственный, где цвет не фиксирован. Платформы и
// кристаллы переливались и раньше; здесь тот же принцип распространён на
// частицы, интерфейс и фон, чтобы мир был радужным целиком, а не наполовину.
function prismWorld(){ return CT && CT.id===10; }
// Оттенок ползёт со временем и разъезжается по индексу: соседние частицы
// получают разные цвета, а не один общий на кадр.
function prismHue(i){ return Math.round((tick*2 + (i||0)*47) % 360); }
function prismCol(i,l){ return 'hsl('+prismHue(i)+',100%,'+(l||64)+'%)'; }
function spawnParticle(o){
  if(!_particleFree.length) return null;
  const idx=_particleFree.pop();
  const p=particles[idx];
  p.alive=true; p.x=o.x; p.y=o.y; p.vx=o.vx; p.vy=o.vy;
  p.life=o.life; p.decay=o.decay; p.sz=o.sz; p.col=o.col; p.txt=o.txt;
  _particleAliveCount++;
  return p;
}
function burst(x,y,col,n=10,spd=3.5,sz=4){
  const particlesEnabled=(window.gameSettings&&window.gameSettings.particles!==false);
  if(!particlesEnabled)return;
  const cap = _maxP();
  if(_particleAliveCount >= cap) return;
  // Scale particle count by graphics quality tier
  const scaled = Math.max(1, Math.round(n * GFX.particleMul));
  const add = Math.min(scaled, cap - _particleAliveCount);
  for(let i=0;i<add;i++){
    const a=Math.PI*2*i/add+Math.random()*.9,s=spd*(.45+Math.random());
    spawnParticle({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-1,life:1,decay:.038+Math.random()*.03,sz,col:prismWorld()?prismCol(i*7):col,txt:null});
  }
}
function floatTxt(x,y,t,col){
  const particlesEnabled=(window.gameSettings&&window.gameSettings.particles!==false);
  if(!particlesEnabled)return;
  // Floating combat/pickup text can be disabled independently of particles.
  if(window.gameSettings&&window.gameSettings.combatText===false)return;
  if(_particleAliveCount < _maxP())
    spawnParticle({x,y,vx:0,vy:-1.5,life:1,decay:.018,sz:0,col,txt:t});
}

// ════════════════════════════════════════════════
//  COLLISION
// ════════════════════════════════════════════════
function aabb(a,b){return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;}
// Forgiving overlap test for "did the player get HURT by an enemy" — insets both boxes
// by a small margin so grazing a sprite's edge/wing doesn't cause phantom damage.
function hurtHit(p,e){
  const m=3; // px of forgiveness on each side
  return p.x+m < e.x+e.w-m && p.x+p.w-m > e.x+m &&
         p.y+m < e.y+e.h-m && p.y+p.h-m > e.y+m;
}
// ── Player "feel" state ─────────────────────────────────────────────────────
// Small, cheap reactions that make the robot feel like it has weight and the
// world feel like it notices him. None of these affect physics or collision —
// they are read only by drawOnePlayer.
//   p.landT    — counts down after a landing, drives the squash
//   p.landPow  — how hard the landing was (0..1)
//   p.idleT    — frames spent standing still, drives the idle look-around
//   p.stepT    — distance accumulator for footstep dust
function _playerLanded(p,impact){
  // impact is the fall speed at the moment of contact
  if(impact<3)return;
  const pow=Math.min(1,(impact-3)/12);
  p.landT=Math.max(p.landT||0,6+pow*6);
  p.landPow=pow;
  if(window.Juice)window.Juice.dust(p.x+p.w/2,p.y+p.h,0,3+Math.round(pow*7));
  if(pow>0.35){
    SFX.land&&SFX.land();
    camShake=Math.max(camShake,pow*3.5);
  }
  // Dust puff at the feet
  const n=Math.round((2+pow*5)*(GFX.particleMul||1));
  for(let i=0;i<n;i++){
    spawnParticle({x:p.x+p.w/2+(Math.random()-.5)*p.w,y:p.y+p.h-1,
      vx:(Math.random()-.5)*(1.2+pow*2),vy:-Math.random()*(0.6+pow),
      life:1,decay:.07,sz:1.5+Math.random()*1.5,col:CT.gE||'#8ac',txt:null});
  }
}
function _playerRunDust(p){
  if(!p.onGnd||Math.abs(p.vx)<1.6)return;
  p.stepT=(p.stepT||0)+Math.abs(p.vx);
  if(p.stepT<26)return;
  p.stepT=0;
  if((GFX.particleMul||1)<=0.25&&Math.random()>0.5)return;
  spawnParticle({x:p.x+p.w/2-Math.sign(p.vx)*6,y:p.y+p.h-1,
    vx:-Math.sign(p.vx)*(0.5+Math.random()*0.6),vy:-Math.random()*0.5,
    life:1,decay:.10,sz:1.2+Math.random(),col:CT.gE||'#8ac',txt:null});
}
function resolveP(p){
  const _wasAir=!p.onGnd, _fallV=p.vy;
  p.onGnd=false;
  p.x+=p.vx;if(!exitAnim)p.x=Math.max(0,Math.min(p.x,worldW-p.w));
  // Boss auto-scroll camera: once it's moving (or has stopped at the arena's
  // far edge), its right edge is a hard wall — the player can keep up with it
  // but never push past what's already on screen.
  if(boss&&window.gameSettings&&window.gameSettings.bossAutoScrollCamera)p.x=Math.min(p.x,camX+W-p.w);
  for(const b of blocks){
    // Скрытый блок ещё не твёрдый: сквозь него проходят, но удар снизу
    // его проявляет. После проявления он становится обычным блоком.
    if(b.hidden&&!b.used){
      if(aabb(p,b)&&p.vy<0&&p.py>=b.y+b.h-6){revealBlock(b,p);}
      continue;
    }
    if(!b.solid)continue;
    if(aabb(p,b)){
      // Сторону выбираем по тому, откуда пришли (p.px — позиция до шага), а не по
      // знаку скорости. Если игрок оказался ВНУТРИ блока — а не подошёл к нему
      // сбоку, — боковой выброс отшвыривал его на ширину блока, и это читалось
      // как телепорт в другое место. Такой случай выдавливаем по вертикали, по
      // кратчайшей стороне: сверху блок опустился на голову, снизу — поднялся
      // под ноги. p.py двигаем вместе с p.y: выдавливание не движение игрока, и
      // проверка ниже должна считать новое место точкой отсчёта.
      if(p.px+p.w<=b.x){p.x=b.x-p.w;p.vx=0;}
      else if(p.px>=b.x+b.w){p.x=b.x+b.w;p.vx=0;}
      else{
        const dDown=b.y+b.h-p.y, dUp=p.y+p.h-b.y;
        // Только неглубокое утопление — это «блок оказался на мне». Если игрок
        // сидит в блоке по пояс, значит его зажало сбоку (например, движущейся
        // платформой у стены), и правильный выход прежний — вбок.
        if(Math.min(dDown,dUp)<=14){
          if(dDown<=dUp){p.y=b.y+b.h;if(p.vy<0)p.vy=0;}
          else{p.y=b.y-p.h;p.vy=0;p.onGnd=true;p.jl=2;}
          p.py=p.y;
        }
        else{if(p.vx>=0)p.x=b.x-p.w;else p.x=b.x+b.w;p.vx=0;}
      }
    }
  }
  p.y+=p.vy;
  for(const b of blocks){
    if(!b.solid)continue;
    if(aabb(p,b)){
      if(p.vy>=0&&p.py+p.h<=b.y+2){p.y=b.y-p.h;p.vy=0;p.onGnd=true;p.jl=2;}
      else if(p.vy<0&&p.py>=b.y+b.h-2){
        p.y=b.y+b.h;p.vy=1;
        if(b.type==='q'&&!b.used)hitBlock(b);
        else if(b.type==='c'&&b.coinLeft>0)hitCoinBlock(b);
      }
    }
  }
  if(p.vy>=0){
    for(const pl of platforms){
      if(pl.gone)continue;
      if(aabb(p,pl)&&p.py+p.h<=pl.y+3){
        p.y=pl.y-p.h;p.vy=0;p.onGnd=true;p.jl=2;
        if(pl.mv)p.x+=pl.dvx||0;
        if(pl.crm&&!pl.crm_on){pl.crm_on=true;pl.ct=72;pl.crmSeq=(pl.crmSeq||0)+1;}
      }
    }
  }
  // Status effect countdown (see assets/status.js) — resolveP runs once per
  // frame for every active player, which is exactly the tick rate it needs.
  if(window.Status)Status.tick(p);
  // Landing / idle / footstep reactions (see _playerLanded above)
  if(p.onGnd&&_wasAir)_playerLanded(p,_fallV);
  if(p.landT>0)p.landT--;
  _playerRunDust(p);
  if(p.onGnd&&Math.abs(p.vx)<0.2&&!p.respawning)p.idleT=(p.idleT||0)+1;
  else p.idleT=0;
}
function eLand(e){
  e.onGnd=false;e.y+=e.vy;
  if(e.vy<0)return; // moving up — no landing check needed
  for(const pl of platforms){if(pl.gone)continue;if(aabb(e,pl)&&e.py+e.h<=pl.y+3){e.y=pl.y-e.h;e.vy=0;e.onGnd=true;return;}}
  for(const b of blocks){if(!b.solid)continue;if(aabb(e,b)&&e.py+e.h<=b.y+3){e.y=b.y-e.h;e.vy=0;e.onGnd=true;return;}}
}
/**
 * Проявление скрытого блока: он перестаёт быть проходимым и выдаёт награду.
 *
 * reveal — от нуля до единицы, ведёт всю анимацию: блок вырастает из точки,
 * подпрыгивает и вспыхивает. Мгновенное появление читалось бы как подмена
 * геометрии под ногами.
 */
// ── БОНУС-КОМНАТА ────────────────────────────────────────────────────────────
// Спрятанный вход уводит в короткую комнату с монетами. Отдельной сцены для
// неё нет намеренно: комната достраивается к тому же миру за его правой
// границей, и вход — это телепорт. Так работают все системы уровня без
// изменений: камера, частицы, сохранение, сеть.
// bonusT — признак «игрок внутри», а не обратный отсчёт. Комната была
// пятнадцатисекундной, и таймер выдёргивал игрока посреди прыжка: считать
// чужие секунды над полной комнатой монет — худшее, что можно сделать с
// наградой. Теперь вход и выход только по дверям, времени нет.
let bonusT=0,bonusBack=null,bonusFade=0,roomKind=0;
// Переход в комнату и обратно идёт через полное затемнение: место меняется
// ровно в тот кадр, когда экран чёрный, поэтому это читается как отдельный
// уровень, а не как рывок игрока по карте. bonusDir: +1 гаснем, -1 проявляемся.
let bonusDir=0,bonusPend=null,bonusTitle=0;
const BFADE=0.055;                       // ~0.3 с в каждую сторону
/** Запустить затемнение; действие выполнится на чёрном экране. */
function bonusWipe(action){ bonusDir=1; bonusPend=action; }
/** Идёт ли переход — на это время управление у игрока забираем. */
function bonusLocked(){ return bonusDir!==0; }
/** Вход в комнату: помним, откуда пришли, и уводим за границу мира. */
function enterBonusRoom(door,p){
  if(bonusT>0||bonusPend||!door.roomX)return;
  door.used=true;
  bonusBack={x:p.x,y:p.y,camX:camX};
  p.vx=0;
  SFX.warp&&SFX.warp();
  bonusWipe(function(){
    bonusT=1;bonusTitle=1;
    p.x=door.roomX+40;p.y=door.roomY-p.h;p.vx=0;p.vy=0;
    camX=Math.max(0,p.x-W*0.4);
  });
}
/** Возврат ровно туда, откуда вошёл. */
function leaveBonusRoom(){
  if(!bonusBack||bonusPend)return;
  const back=bonusBack;
  SFX.warp&&SFX.warp();
  bonusWipe(function(){
    const p=player;
    if(p){p.x=back.x;p.y=back.y;p.vx=0;p.vy=0;}
    camX=back.camX;
    bonusBack=null;bonusT=0;
  });
}
function inBonusRoom(){ return bonusT>0; }
function updateBonusRoom(){
  if(bonusTitle>0)bonusTitle=Math.max(0,bonusTitle-0.011);
  if(bonusDir>0){
    // Гаснем. Игрока придерживаем, чтобы он не уехал вслепую.
    if(player)player.vx=0;
    bonusFade=Math.min(1,bonusFade+BFADE);
    if(bonusFade>=1){
      const act=bonusPend;bonusPend=null;bonusDir=-1;
      if(act)act();
    }
    return;
  }
  if(bonusDir<0){
    if(player)player.vx=0;
    bonusFade=Math.max(0,bonusFade-BFADE);
    if(bonusFade<=0)bonusDir=0;
  }
  // Ничего больше: комната ждёт, пока игрок сам дойдёт до двери выхода
  // (см. bonusExit в цикле hazards).
}
// `p` не обязателен: по сети блок проявляется и у тех, кто его не бил, — им
// толкать некого (см. netWorldApply).
function revealBlock(b,p){
  b.hidden=false;b.solid=true;b.reveal=0.001;b.type='b';
  b.bounce=14;b.origY=b.y;b._rev=1;
  if(p){p.vy=1;p.y=b.y+b.h;}
  SFX.secret&&SFX.secret();
  camShake=Math.max(camShake,6);
  burst(b.x+b.w/2,b.y+b.h/2,'#ffd24a',14,3.2,4);
  floatTxt(b.x+b.w/2,b.y-18,T('secretFound')||'!','#ffd24a');
  // Внутри — монеты: награда за любопытство, а не за бой.
  // В сетевой игре их число и разброс выводим из зерна комнаты и позиции блока:
  // монеты дописываются в общий массив, и у всех должно появиться одинаковое их
  // количество, иначе списки монет разъедутся и общий мир рассыплется.
  const _rr=(window.netActive&&window._netSeed)
    ? mkRNG((window._netSeed>>>0)^(Math.round(b.x)*83492791)^(Math.round(b.y)*2654435761))
    : Math.random;
  const bi=blocks.indexOf(b);
  const cnt=3+Math.floor(_rr()*4);
  for(let i=0;i<cnt;i++){
    coins.push({x:b.x+2+i*14,y:b.y-40-((i%2)*16),w:14,h:14,a:_rr()*Math.PI*2,got:false,bonus:true,
                cid:100000+bi*16+i});
  }
  if(window.Juice)window.Juice.hitStop(50);
}
function hitBlock(b){
  b.used=true;b.bounce=12;b.origY=b.y;SFX.block();
  // Question blocks regenerate after a random 10–30s so they can be reused.
  // (60 fps → 600–1800 frames.) regenT counts down in updateBlocks().
  // Срок восстановления в сетевой игре тоже выводим из зерна комнаты: иначе
  // блок возвращался бы у разных игроков в разное время и общий мир расходился
  // бы на десяток секунд — снимок сообщает только «блок тронут», а обратно он
  // ничего не откатывает (см. netWorldSnap).
  const _regenRng=(window.netActive&&window._netSeed)
    ? mkRNG((window._netSeed>>>0)^(Math.round(b.x)*40503)^(Math.round(b.origY||b.y)*12289))
    : Math.random;
  b.regenT=600+Math.floor(_regenRng()*1200);
  const fullHP=(lives>=3)&&(!twoPlayer||lives2>=3);
  let puType;
  if(b.guaranteedBlast){puType='blast';}
  else{
    // In a network game every client generates the same level from the shared
    // seed, but the powerup TYPE used to be a per-client Math.random() — so the
    // host could pop a blaster from a block while a guest got a star from the
    // SAME block (and then couldn't shoot). Derive the type deterministically
    // from the block position + net seed so all clients agree. Solo keeps random.
    const rng = (window.netActive && window._netSeed)
      ? mkRNG((window._netSeed>>>0) ^ (Math.round(b.x)*73856093) ^ (Math.round(b.origY||b.y)*19349663))
      : Math.random;
    const r=rng();
    if(r<0.20)puType='blast';
    else if(r<0.37)puType='star';
    else if(r<0.54)puType='boots';
    else if(r<0.70&&!fullHP)puType='life';
    else if(r<0.85)puType='fire';
    else puType='ice';
    if(puType==='life'&&fullHP)puType=rng()<.5?'fire':'ice';
  }
  const bc=puType==='life'?'#ff2266':puType==='boots'?'#0ff':puType==='star'?'#ff0':puType==='fire'?'#ff4400':puType==='ice'?'#00ffff':'#ffd700';
  // src — номер блока-источника. Бонусы дописываются в массив во время игры и у
  // разных клиентов могут лечь в разном порядке, поэтому «этот бонус подобран»
  // передаётся по номеру источника, а не по месту в массиве.
  powerups.push({x:b.x+b.w/2-12,y:b.y-26,w:24,h:24,vy:-2.5,type:puType,anim:0,got:false,src:blocks.indexOf(b)});
  burst(b.x+b.w/2,b.y,bc,8,3,4);
}

// Coin brick: each head-bonk spits out one coin until it's empty, then the block
// is marked used (drawn as a cracked/empty brick). Holds 3–10 coins (coinCap).
function hitCoinBlock(b){
  b.coinLeft--;b.bounce=10;if(!b.origY)b.origY=b.y;SFX.block();
  // Pop a coin out of the top that arcs up and is auto-collected.
  score+=10;coinsTotal++;AchTrack.coin();SFX.coin();
  floatTxt(b.x+b.w/2,b.y-8,'+10','#ffd700');
  burst(b.x+b.w/2,b.y,'#ffd700',6,2.5,4);
  _checkCoinHp(b.x,b.y,player);
  if(b.coinLeft<=0){b.used=true;burst(b.x+b.w/2,b.y+b.h/2,'#9a7a3a',8,3,4);}
}

// ════════════════════════════════════════════════
//  СЕТЬ: ОБЩИЙ МИР
// ════════════════════════════════════════════════
// Монеты, блоки, бонусы, кристаллы, ключи и двери — ОДНИ на всю комнату:
// подобрал один — исчезло у всех. Раньше общими были только враги, босс и
// выстрелы хоста, а весь остальной уровень у каждого игрока жил своей жизнью.
//
// Хост для этого не нужен. Уровень у всех собран из одного зерна, награда из
// блока выводится из его позиции (см. hitBlock), а состояние мира внутри уровня
// только НАРАСТАЕТ: подобрано, использовано, открыто. Поэтому обмен — слияние
// «или»: чужой снимок может добавить взятое, но никогда не вернуть обратно.
// Отсюда и отсутствие мигания: свой подбор виден сразу и ничем не отменяется.
//
// Индексы стабильны только для того, что создано в genLevel. Монеты из скрытых
// блоков дописываются в массив уже во время игры и у разных клиентов могут лечь
// в разном порядке, поэтому у них есть собственный номер cid (см. revealBlock),
// а у бонусов — номер блока-источника src.
let _coinBase=0;          // сколько монет создал genLevel — дальше идут дописанные
function _bits(arr,fn){let s='';for(let i=0;i<arr.length;i++)s+=fn(arr[i])?'1':'0';return s;}
function netWorldSnap(){
  const s={};
  if(_coinBase)s.c=_bits(coins.slice(0,_coinBase),c=>c.got);
  // Монеты из проявленных блоков: их немного, шлём списком собственных номеров.
  const cx=[];for(let i=_coinBase;i<coins.length;i++)if(coins[i].got&&coins[i].cid!=null)cx.push(coins[i].cid);
  if(cx.length)s.cx=cx;
  if(dataShards.length)s.s=_bits(dataShards,c=>c.got);
  if(rainbowItem&&rainbowItem.got)s.r=1;
  if(mazeKeys.length)s.k=_bits(mazeKeys,k=>k.collected);
  if(doors.length)s.d=_bits(doors,d=>d.open);
  const pu=[];for(const p of powerups)if(p.got&&p.src!=null)pu.push(p.src);
  if(pu.length)s.u=pu;
  // Блоков сотни, а тронутых единицы — шлём только изменённые.
  const b=[];
  for(let i=0;i<blocks.length;i++){
    const x=blocks[i];
    const touched=x.used||x._rev||(x.type==='c'&&x.coinCap&&x.coinLeft<x.coinCap);
    if(touched)b.push([i,x.used?1:0,x.coinLeft|0,x._rev?1:0]);
  }
  if(b.length)s.b=b;
  // Осыпающиеся платформы возвращаются, то есть их состояние НЕ нарастает.
  // Поэтому синхронизируем не «исчезла», а счётчик запусков: он только растёт,
  // а сам обвал и возврат каждый клиент отсчитывает своим таймером.
  const cr=[];
  for(let i=0;i<platforms.length;i++)if(platforms[i].crmSeq)cr.push([i,platforms[i].crmSeq]);
  if(cr.length)s.p=cr;
  return s;
}
function netWorldApply(s){
  if(!s||!window.netActive)return;
  if(s.c){
    const n=Math.min(_coinBase,s.c.length);
    for(let i=0;i<n;i++)if(s.c[i]==='1'&&coins[i]&&!coins[i].got){
      coins[i].got=true;burst(coins[i].x+7,coins[i].y+7,'#ffd700',4,2,3);
    }
  }
  if(s.cx&&s.cx.length){
    const want=new Set(s.cx);
    for(let i=_coinBase;i<coins.length;i++)if(!coins[i].got&&want.has(coins[i].cid)){
      coins[i].got=true;burst(coins[i].x+7,coins[i].y+7,'#ffd700',4,2,3);
    }
  }
  // Кристаллы и радужный осколок — это прогресс, а не расходник. Мир у комнаты
  // общий, поэтому взятый исчезает у всех, но засчитывается тоже всем: отнимать
  // у товарища открытие секретного мира было бы хуже, чем не делить предмет.
  if(s.s)for(let i=0;i<dataShards.length&&i<s.s.length;i++)if(s.s[i]==='1'&&!dataShards[i].got){
    dataShards[i].got=true;dataShardsGot++;score+=SHARD_VALUE;
    burst(dataShards[i].x+8,dataShards[i].y+8,'#0ff',10,3,4);
    if(dataShardsGot>=dataShardsTotal&&!shardBonusGiven){shardBonusGiven=true;score+=ALL_SHARDS_BONUS;}
  }
  if(s.r&&rainbowItem&&!rainbowItem.got){
    rainbowItem.got=true;markRainbowCollected(rainbowItem.worldIdx);score+=RAINBOW_SHARD_VALUE;
    burst(rainbowItem.x+9,rainbowItem.y+9,'#fff',20,4,5);
  }
  if(s.k)for(let i=0;i<mazeKeys.length&&i<s.k.length;i++)if(s.k[i]==='1'&&!mazeKeys[i].collected){
    mazeKeys[i].collected=true;mazeKeysCollected++;burst(mazeKeys[i].x+10,mazeKeys[i].y+10,'#ff0',12,3,4);
  }
  if(s.d)for(let i=0;i<doors.length&&i<s.d.length;i++)if(s.d[i]==='1'&&!doors[i].open){
    doors[i].open=true;burst(doors[i].x+doors[i].w/2,doors[i].y+doors[i].h/2,'#4f8',16,4,5);
  }
  if(s.u&&s.u.length){
    const want=new Set(s.u);
    for(const p of powerups)if(!p.got&&p.src!=null&&want.has(p.src))p.got=true;
  }
  if(s.b)for(const [i,used,left,rev] of s.b){
    const b=blocks[i];if(!b)continue;
    if(rev&&!b._rev)revealBlock(b,null);
    if(b.type==='c'&&typeof left==='number'&&left<(b.coinLeft|0)){
      b.coinLeft=left;b.bounce=10;
      burst(b.x+b.w/2,b.y,'#ffd700',5,2.5,4);
      if(b.coinLeft<=0)b.used=true;
    }
    // Блок с наградой открывает КАЖДЫЙ клиент сам: тип бонуса выведен из зерна
    // комнаты и позиции блока, поэтому у всех выпадет одно и то же.
    if(used&&!b.used&&b.type==='q')hitBlock(b);
    else if(used&&!b.used)b.used=true;
  }
  if(s.p)for(const [i,seq] of s.p){
    const pl=platforms[i];if(!pl||!pl.crm)continue;
    if((pl.crmSeq||0)<seq){pl.crmSeq=seq;if(!pl.crm_on){pl.crm_on=true;pl.ct=72;}}
  }
}

// ════════════════════════════════════════════════
//  LEVEL ARCHETYPES & MODIFIERS
// ════════════════════════════════════════════════
const ARCHETYPES = ['classic', 'speedrun', 'stealth'];

// Pick level archetype based on level number (deterministic)
function pickArchetype(advN) {
  if (dailyForce) return dailyForce.arch;      // уровень дня: решает сид дня
  if (!advN) return 'classic'; // infinite mode = classic only
  if (advN % 10 === 0) return 'classic'; // boss levels = classic
  if (advN < 3) return 'classic'; // first levels = classic

  // Distribution: 50% classic, 30% speedrun, 20% stealth
  const seed = advN * 7919; // prime for distribution
  const hash = (seed * 9301 + 49297) % 233280;
  const roll = (hash / 233280);

  if (roll < 0.50) return 'classic';
  if (roll < 0.80) return 'speedrun';
  return 'stealth';
}

// Pick level modifiers (deterministic)
function pickModifiers(advN, archetype) {
  if (dailyForce) return dailyForce.mods;      // уровень дня: решает сид дня
  if (!advN || advN < 5) return {}; // first levels without mods
  if (advN % 10 === 0) return {}; // boss levels without mods
  if (archetype === 'stealth') return {}; // stealth archetype has its own mechanics

  const mods = {};
  const roll = (advN * 3571) % 100;

  // 20% chance for a modifier
  if (roll < 20) {
    const modRoll = (advN * 7919) % 100;
    if (modRoll < 25) mods.lowGravity = true;
    else if (modRoll < 45) mods.wind = (advN % 2 === 0) ? 0.35 : -0.35;
    else if (modRoll < 65) mods.slippery = true;
    else if (modRoll < 80) mods.darkness = true;
    else mods.highGravity = true;
  }
  return mods;
}

// ════════════════════════════════════════════════
//  LEVEL GENERATION  (long, path-node, seeded)
// ════════════════════════════════════════════════
function genLevel(diff,rng,advN){
  // Pick archetype and modifiers
  levelArchetype = pickArchetype(advN);
  levelMods = pickModifiers(advN, levelArchetype);

  platforms=[];blocks=[];coins=[];enemies=[];_enemyIdSeq=0;
  pBullets=[];eBullets=[];powerups=[];_initParticlePool();decors=[];fireBalls=[];iceBalls=[];checkpoints=[];flagDone=false;exitAnim=false;exitTimer=0;
  bonusT=0;bonusBack=null;bonusFade=0;
  bonusDir=0;bonusPend=null;bonusTitle=0;
  _decorCacheInvalidate();
  hazards=[];jumpPads=[];conveyors=[];buttons=[];doors=[];spotlights=[];mazeKeys=[];mazeKeysCollected=0;
  dataShards=[];dataShardsTotal=0;dataShardsGot=0;shardBonusGiven=false;rainbowItem=null;
  _cpSafeZone=null;
  player2=null; // will be recreated after genLevel if twoPlayer
  const GY=H-40,BS=28,PLH=14;
  const BASE=5200+Math.min(diff*650,5200);
  const MGAP=diff<=1?92:diff<=3?112:diff<=6?128:145;
  const MRISE=diff<=2?76:diff<=5?94:108;

  // Path nodes
  const nodes=[];
  nodes.push({x:0,y:GY,w:360,kind:'ground'});
  let cx=360,cy=GY;
  const segs=14+Math.floor(diff*1.9);
  for(let i=0;i<segs;i++){
    const last=i===segs-1;
    if(last){const g=30+rng()*45;nodes.push({x:cx+g,y:GY,w:340,kind:'ground'});cx+=g+340;break;}
    const gap=22+rng()*(MGAP-22),w=80+rng()*130;
    let ny;
    if(i<2)ny=GY;
    else{ny=Math.round(cy+(rng()-.48)*(MRISE+70));ny=Math.max(H-245,Math.min(GY,ny));
      if(gap>MGAP*.7&&ny<cy-52)ny=cy-52;}
    let kind=ny===GY?'ground':'normal';
    if(ny!==GY&&diff>=2){const r=rng();if(r<.18)kind='moving';else if(r<.29)kind='crumble';}
    nodes.push({x:cx+gap,y:ny,w,kind});cx+=gap+w;cy=ny;
  }
  while(cx<BASE){
    const gap=25+rng()*80,w=88+rng()*130;
    let ny=GY;if(rng()>.38){ny=Math.round(GY-(rng()*130));ny=Math.max(H-230,ny);}
    nodes.push({x:cx+gap,y:ny,w,kind:ny===GY?'ground':'normal'});cx+=gap+w;
  }
  worldW=cx+280;

  // Occupied rects
  const occ=[];
  const hit=(x,y,w,h,m=7)=>occ.some(o=>x-m<o.x+o.w&&x+w+m>o.x&&y-m<o.y+o.h&&y+h+m>o.y);
  const add=(x,y,w,h)=>occ.push({x,y,w,h});

  // Platforms
  for(const n of nodes){
    const ph=n.kind==='ground'?40:PLH;
    const pl={x:n.x,y:n.y,w:n.w,h:ph,type:n.kind,solid:false,gone:false};
    if(n.kind==='moving'){pl.mv=true;pl.origX=n.x;pl.rangeX=38+rng()*52;pl.spd=(0.5+rng()*.8)*(rng()<.5?1:-1);pl.phase=rng()*Math.PI*2;pl.dvx=0;}
    if(n.kind==='crumble'){pl.crm=true;pl.crm_on=false;pl.ct=0;}
    platforms.push(pl);add(n.x,n.y,n.w,ph);
  }

  // Block rows — sparse (only on wider platforms, 20% chance)
  for(let ni=1;ni<nodes.length-1;ni++){
    const n=nodes[ni];if(n.w<110||rng()<.78)continue;
    const cnt=1+Math.floor(rng()*2),rw=cnt*(BS+2)-2;
    const bx=Math.floor(n.x+(n.w-rw)/2),by=n.y-88;
    if(by<12||hit(bx,by,rw,BS,12))continue;
    for(let bi=0;bi<cnt;bi++){
      // Block type roll: 20% question, then 25% coin-brick, rest plain brick.
      const roll=rng();
      let bt='b',coinCap=0;
      if(roll<.20)bt='q';
      else if(roll<.45){bt='c';coinCap=3+Math.floor(rng()*8);} // 3–10 coins
      blocks.push({x:bx+bi*(BS+2),y:by,w:BS,h:BS,type:bt,solid:true,used:false,bounce:0,origY:by,coinCap:coinCap,coinLeft:coinCap});
    }
    add(bx,by,rw,BS);
  }

  // ── ОСОБЕННОСТЬ УРОВНЯ ─────────────────────────────────────────────────
  // Бонус-комната, переключатель и скрытые блоки раньше ставились каждый
  // своим броском, и в итоге почти на любом уровне были все три сразу —
  // находка перестаёт быть находкой. Теперь бросок ОДИН на уровень, и он
  // выбирает максимум одну особенность; на трети уровней не будет ничего.
  const special=rng();
  // Секретный выход убран из игры: второй флаг посреди уровня читался как
  // ошибка генерации, а не как находка — игрок видит финиш там, где до конца
  // ещё половина пути. Его доля броска отдана скрытым блокам, иначе уровни
  // просто обеднели бы на пятую часть особенностей.
  const wantRoom=special<0.20&&!isBossLevel(advN||level),
        wantHidden=special>=0.20&&special<0.70;


  // ── СКРЫТЫЕ БЛОКИ ──────────────────────────────────────────────────────
  // Проявляются только от удара снизу. Ставим над платформами повыше обычных
  // рядов, чтобы до них надо было допрыгнуть, и по тому же сиду — значит, у
  // всех игроков они в одних и тех же местах, и находкой можно делиться.
  {
    const want=wantHidden?(1+Math.floor(rng()*2)):0;  // один-два, и не всюду
    const spots=nodes.filter(nd=>nd.x>240&&nd.w>=60);
    for(let k=0;k<want&&spots.length;k++){
      const nd=spots.splice(Math.floor(rng()*spots.length),1)[0];
      const hx=Math.floor(nd.x+nd.w/2-14),hy=nd.y-150;
      if(hy<20||hit(hx,hy,28,28,10))continue;
      blocks.push({x:hx,y:hy,w:28,h:28,type:'h',solid:false,used:false,bounce:0,origY:hy,
        hidden:true,reveal:0});
    }
  }

  // Coins on platforms
  for(const n of nodes){
    if(n.x<80)continue;
    const num=3+Math.floor(rng()*3),sx=n.x+Math.floor((n.w-(num-1)*22)/2),coinY=n.y-36;
    for(let ci=0;ci<num;ci++){const ccx=sx+ci*22;if(!hit(ccx,coinY,14,14,3))coins.push({x:ccx,y:coinY,w:14,h:14,a:rng()*Math.PI*2,got:false});}
  }

  // Enemies
  const pool=ePool(advN||level),cnt=eCounts(advN||level);
  for(let ni=1;ni<nodes.length-1;ni++){
    const n=nodes[ni];
    if(n.kind==='ground'){
      if(n.w<130||n.x<380)continue;
      const numHere=Math.max(0,Math.round((n.w/(worldW/5))*cnt.g*(0.5+rng())));
      for(let ei=0;ei<Math.min(numHere,4);ei++){
        const t=pool[Math.floor(rng()*pool.length)],cfg=EC[t];
        if(cfg.w>=n.w-24)continue;
        const slot=(n.w-50)/Math.max(numHere,1);
        let ex=Math.min(n.x+25+ei*slot+rng()*Math.max(slot-cfg.w,4),n.x+n.w-cfg.w-14);
        mkEnemy(t,ex,n.y-cfg.h,n,rng);
      }
    } else {
      if(n.w<92||rng()<.38)continue;
      const t=pool[Math.floor(rng()*pool.length)],cfg=EC[t];
      if(cfg.w>=n.w-20)continue;
      mkEnemy(t,n.x+Math.floor((n.w-cfg.w)/2),n.y-cfg.h,n,rng);
    }
  }
  // Fliers (world-specific)
  const fType=flierType(advN||level);
  let drX=440;const drCnt=cnt.d;let drN=0;
  while(drX<worldW-280&&drN<drCnt){mkEnemy(fType,drX,H-150-rng()*65,null,rng);drX+=370+rng()*160;drN++;}

  // ── NEW OBJECTS: Jump Pads, Hazards, Conveyors ──────────────────────────────
  // Jump pads - place strategically before gaps or high platforms
  for(let ni=1;ni<nodes.length-2;ni++){
    const n=nodes[ni];
    const nextN=nodes[ni+1];
    if(n.kind!=='ground'||n.w<100)continue;

    // Check if next platform is higher (good place for jump pad)
    const heightDiff=n.y-nextN.y;
    const gap=nextN.x-n.x-n.w;

    if((heightDiff>60&&gap<180)||rng()<0.08){
      const jx=n.x+n.w-70; // place near edge
      if(!hit(jx,n.y-2,60,8,8)){
        jumpPads.push({x:jx,y:n.y-2,w:60,h:8,power:24,anim:0});
        add(jx,n.y-2,60,8);
      }
    }
  }

  // Hazards: Spikes on long ground platforms (not near start/end)
  for(const n of nodes){
    if(n.kind!=='ground'||n.w<140||n.x<500||n.x>worldW-800)continue;
    if(rng()<0.12){
      // Place spikes with some spacing
      const spikeCount=1+Math.floor(rng()*2);
      for(let si=0;si<spikeCount;si++){
        const sx=n.x+40+rng()*(n.w-100);
        if(!hit(sx,n.y-12,24,12,20)){
          hazards.push({x:sx,y:n.y-12,w:24,h:12,type:'spikes'});
          add(sx,n.y-12,24,12);
        }
      }
    }
  }

  // Conveyors: replace some moving platforms with conveyors (20% of moving platforms)
  for(const pl of platforms){
    if(pl.type==='moving'&&rng()<0.20){
      pl.type='conveyor';
      pl.conveyorDir=(rng()<0.5)?1:-1;
      pl.conveyorSpeed=2.4;
      delete pl.mv;delete pl.origX;delete pl.rangeX;delete pl.spd;delete pl.phase;delete pl.dvx;
    }
  }

  flagX=worldW-160;
  // Platform under flag — wide solid landing (extended to 240 to fit building)
  platforms.push({x:flagX-30,y:H-40,w:240,h:40,type:'ground',solid:false,gone:false});

  // ── Mid-level checkpoint ──────────────────────────────────────────────────
  // A small flag near the middle of the run on the closest wide ground node.
  // Touching it becomes the player's fall-respawn point and the little flag turns
  // into that player's coloured robot flag.
  {
    const midX=worldW*0.5;
    let best=null,bestD=Infinity;
    for(const n of nodes){
      if(n.kind!=='ground'||n.x<300||n.w<90)continue;
      const d=Math.abs((n.x+n.w/2)-midX);
      if(d<bestD){bestD=d;best=n;}
    }
    if(best){
      const cpx=Math.round(best.x+best.w/2-8);
      checkpoints.push({x:cpx,y:best.y-56,w:16,h:56,baseY:best.y,taken:false,color:null,anim:0});
      // Remember the checkpoint's safe zone (the whole ground node it sits on) so
      // later generation passes can keep it free of hazards/enemies.
      _cpSafeZone={x:best.x-12,y:best.y-180,w:best.w+24,h:200};
    }
  }

  boss=null;
  bossArenaX=0;
  bossArenaTriggered=false;
  spawnX=60;spawnY=H-90;
  camX=0;

  if(isBossLevel(advN||level)){
    const worldId=Math.min(Math.floor(((advN||level)-1)/10),10);
    const cfg=BOSS_CFG[worldId];
    // Corridor: open run-up → boss arena (no physical gate pillars — visual gate drawn by drawBossApproach)
    const corrStart=worldW;
    const corridorLen=380;
    const arenaLen=cfg.arenaW+160;
    worldW=corrStart+corridorLen+arenaLen;

    // Full floor through corridor + arena
    platforms.push({x:corrStart,y:H-40,w:corridorLen+arenaLen+40,h:40,type:'ground',solid:false,gone:false});

    // Right world wall — player can't scroll past
    blocks.push({x:worldW+2,y:0,w:24,h:H,type:'b',solid:true,used:true,bounce:0,origY:0});

    bossArenaX=corrStart+corridorLen;   // trigger zone start
    flagX=worldW+99999;                 // hidden until boss dies

    // Guaranteed blaster block mid-corridor (always gives Blaster)
    const gbx=corrStart+Math.floor(corridorLen*.42);
    const gby=H-40-78; // float above floor
    blocks.push({x:gbx,y:gby,w:28,h:28,type:'q',solid:true,used:false,bounce:0,origY:gby,guaranteedBlast:true});

    genDecors(rng);

    // 3 crystals (data-shards) floating along the boss run-up corridor so boss
    // levels also contribute to the 3-per-level / 300-total crystal count.
    for(let i=0;i<3;i++){
      const sx=Math.round(corrStart+corridorLen*(0.22+i*0.26));
      const sy=H-40-80-Math.round(rng()*40);
      dataShards.push({id:`${sx}_${sy}`,x:sx,y:sy,w:16,h:16,got:false,phase:rng()*Math.PI*2});
    }
    dataShardsTotal=dataShards.length;

    const arenaCenter=corrStart+corridorLen+arenaLen/2;
    spawnBoss(worldId, arenaCenter);
  } else {
    genDecors(rng);
    // Level-variety pass (mechanics 4, 7, 10). Boss levels are arena fights and
    // are intentionally skipped so the run-up stays a clean corridor.
    genLevelVariety(rng, advN||level, nodes, hit, add);
  }

  // Apply archetype-specific modifications ONLY for non-classic
  if(levelArchetype==='speedrun'){
    applySpeedrunArchetype(rng);
  }else if(levelArchetype==='stealth'){
    applyStealthArchetype(rng);
  }
  // Classic archetype needs no modifications - it's the default

  // ── Keep the checkpoint platform always safe ──────────────────────────────
  // Strip any hazard / mobile threat that ended up overlapping the checkpoint's
  // safe zone, so landing on (or respawning at) the checkpoint is never lethal.
  if(_cpSafeZone){
    const z=_cpSafeZone;
    const overlapsZone=(o)=>{
      const ow=o.w||o.r*2||14, oh=o.h||o.r*2||14;
      return o.x+ow>z.x && o.x<z.x+z.w && o.y+oh>z.y && o.y<z.y+z.h;
    };
    if(typeof hazards!=='undefined') for(let i=hazards.length-1;i>=0;i--){ if(overlapsZone(hazards[i]))hazards.splice(i,1); }
    if(typeof enemies!=='undefined') for(let i=enemies.length-1;i>=0;i--){ if(overlapsZone(enemies[i]))enemies.splice(i,1); }
    // Also nudge any conveyor under the checkpoint back to a plain platform so it
    // can't fling a resting player off the safe spot.
    for(const pl of platforms){ if(pl.type==='conveyor'&&overlapsZone(pl)) pl.type='normal'; }
  }

  // ── Скрытые блоки против кристаллов ────────────────────────────────────
  // Кристаллы расставляются позже (genLevelVariety) и про блоки не знают, а
  // полосы высот у них совпадают. Проявленный блок становится твёрдым и
  // запирает кристалл наглухо, поэтому конфликтующий блок сдвигаем, а если
  // свободного места рядом нет — убираем совсем.
  if(dataShards.length){
    const clash=(x,y)=>dataShards.some(sh=>
      x+28+18>sh.x && x<sh.x+sh.w+18 && y+28+18>sh.y && y<sh.y+sh.h+18);
    for(let i=blocks.length-1;i>=0;i--){
      const b=blocks[i];
      if(!b.hidden||!clash(b.x,b.y))continue;
      const alt=[b.y-76,b.y+64].find(y=>y>20&&y<H-70&&!clash(b.x,y));
      if(alt!==undefined){b.y=alt;b.origY=alt;}
      else blocks.splice(i,1);
    }
  }

  // ── БОНУС-КОМНАТА ──────────────────────────────────────────────────────
  // Строится ПОСЛЕДНЕЙ и только теперь раздвигает границу мира. Раньше она
  // это делала посреди генерации, и все, кто считает от worldW, уезжали в
  // комнату: финишный флаг с площадкой вставал прямо в ней, туда же
  // разлетались дроны, а чекпоинт «на середине» оказывался за концом уровня.
  if(wantRoom){
    const spots=nodes.filter(nd=>nd.x>400&&nd.x<worldW-500&&nd.w>=70);
    if(spots.length){
      const nd=spots[Math.floor(rng()*spots.length)];
      // Комнату уносим далеко за уровень: даже если игрок как-то окажется
      // снаружи, до финиша ему бежать через всю пустоту, а не два шага.
      const roomX=worldW+1600,roomY=H-90,roomW=620;
      // Закрытая коробка: пол, две стены и ПОТОЛОК. Стен по 260 пикселей не
      // хватало — лестница внутри поднимается на 266, по ней перелезали через
      // верх и уходили пешком прямо к финишу, пропуская остаток уровня.
      const roomH=340;
      // Пол уходит НИЖЕ края экрана. При высоте 40 под ним оставалась полоса
      // в полсотни пикселей, сквозь которую светил фон уровня — комната от
      // этого читалась как кусок декорации, висящий в воздухе, а не как
      // отдельное место. Заливка платформы идёт на всю высоту (см.
      // drawPlatforms), поэтому достаточно увеличить h.
      platforms.push({x:roomX-40,y:roomY,w:roomW+80,h:H-roomY+240,type:'ground',solid:true,gone:false});
      blocks.push({x:roomX-60,y:roomY-roomH,w:24,h:roomH,type:'b',solid:true,used:true,bounce:0,origY:roomY-roomH});
      blocks.push({x:roomX+roomW+36,y:roomY-roomH,w:24,h:roomH,type:'b',solid:true,used:true,bounce:0,origY:roomY-roomH});
      blocks.push({x:roomX-60,y:roomY-roomH-24,w:roomW+120,h:24,
        type:'b',solid:true,used:true,bounce:0,origY:roomY-roomH-24});

      // ── Планировка ─────────────────────────────────────────────────────
      // Пять вариантов вместо одного: комната должна каждый раз выглядеть
      // по-новому, иначе это просто одно и то же место в конце уровня.
      const rc=(x,y)=>coins.push({x:x,y:y,w:14,h:14,a:rng()*Math.PI*2,got:false,bonus:true});
      const rb=(x,y,t,cap)=>blocks.push({x:x,y:y,w:BS,h:BS,type:t,solid:true,used:false,bounce:0,origY:y,coinCap:cap||0,coinLeft:cap||0,bonus:true});
      const rp=(x,y,w)=>platforms.push({x:x,y:y,w:w,h:PLH,type:'normal',solid:false,gone:false});
      const kind=Math.floor(rng()*5);
      roomKind=kind;
      if(kind===0){
        // Ливень: три плотных ряда, чистая скорость сбора.
        for(let r=0;r<3;r++)for(let i=0;i<12;i++)rc(roomX+30+i*48,roomY-60-r*44);
      }else if(kind===1){
        // Лестница: пять ступеней вверх, на каждой по три монеты.
        for(let st=0;st<5;st++){
          const sx=roomX+20+st*118,sy=roomY-58-st*52;
          rp(sx,sy,96);
          for(let i=0;i<3;i++)rc(sx+16+i*30,sy-34);
        }
        for(let i=0;i<6;i++)rc(roomX+40+i*46,roomY-34);
      }else if(kind===2){
        // Арка: монеты по дуге, под ней ряд блоков с добавкой.
        const cxr=roomX+roomW/2,rad=170;
        for(let i=0;i<15;i++){
          const ang=Math.PI+(i/14)*Math.PI;
          rc(cxr+Math.cos(ang)*rad-7,roomY-70+Math.sin(ang)*rad*0.85);
        }
        for(let i=0;i<4;i++)rb(cxr-70+i*38,roomY-64,'c',4);
        for(let i=0;i<8;i++)rc(roomX+40+i*40,roomY-34);
      }else if(kind===3){
        // Колонны: четыре столба, монеты в проёмах и наверху.
        for(let col=0;col<4;col++){
          const px2=roomX+70+col*140;
          for(let r=0;r<3;r++)rb(px2,roomY-30-r*30,'b',0);
          for(let r=0;r<4;r++)rc(px2+40,roomY-40-r*40);
          rc(px2+3,roomY-130);
        }
        for(let i=0;i<7;i++)rc(roomX+50+i*44,roomY-200);
      }else{
        // Сокровищница: ряд вопросов под потолком, монеты кольцом.
        for(let i=0;i<6;i++)rb(roomX+70+i*80,roomY-150,i%2?'q':'c',5);
        const cxr=roomX+roomW/2;
        for(let i=0;i<12;i++){
          const ang=(i/12)*Math.PI*2;
          rc(cxr+Math.cos(ang)*120-7,roomY-70+Math.sin(ang)*58);
        }
        for(let i=0;i<8;i++)rc(roomX+45+i*42,roomY-34);
      }
      const dx=Math.floor(nd.x+nd.w/2-16);
      hazards.push({type:'bonusDoor',x:dx,y:nd.y-44,w:32,h:44,used:false,anim:0,
        roomX:roomX,roomY:roomY});

      // ── Выход ────────────────────────────────────────────────────────────
      // Раньше комната закрывалась по таймеру: пятнадцать секунд — и игрока
      // выдёргивало на середине прыжка. Считать чужие секунды, когда перед
      // тобой полная комната монет, — худшее, что можно сделать с наградой.
      // Теперь уходят сами, через дверь у дальней стены: чтобы дойти до неё,
      // комнату всё равно надо пройти насквозь.
      hazards.push({type:'bonusExit',x:roomX+roomW-24,y:roomY-46,w:34,h:46,anim:0});

      // ── Второй кристалл данных ───────────────────────────────────────────
      // Кристаллы раздаёт genLevelVariety (три на уровень), и он отработал
      // выше — массив уже заполнен. Если на уровне есть комната, средний из
      // трёх переезжает сюда: скрытый вход перестаёт быть просто мешком монет
      // и становится единственным способом собрать уровень на три кристалла.
      // Под кристаллом своя площадка: планировки разные, и рассчитывать на
      // чужую геометрию нельзя — с голого пола до него было бы не допрыгнуть.
      if(dataShards.length>=2){
        // Высоты выбраны по худшему случаю — мутатору тяжёлой гравитации.
        // Прыжок там поднимает на 67 пикселей (JV² / 2·0.9) вместо обычных 131,
        // поэтому ступенька стоит на 58 над полом, а кристалл на 60 над ней:
        // достаётся и с обычной физикой, и с тяжёлой. На 176, как было сначала,
        // при тяжёлой гравитации кристалл превращался в недостижимый — то есть
        // уровень нельзя было собрать на три.
        const sx=roomX+Math.round(roomW*0.5)-8, sy=roomY-118;
        // Планировок пять, и две из них ставят в центре комнаты блоки: кристалл
        // оказался бы внутри и не собирался бы вовсе. Освобождаем место —
        // убираем только содержимое самой комнаты (метка bonus), уровня это
        // не касается.
        const zone={x:sx-48,y:sy-34,w:104,h:112};
        for(let i=blocks.length-1;i>=0;i--)if(blocks[i].bonus&&aabb(blocks[i],zone))blocks.splice(i,1);
        for(let i=coins.length-1;i>=0;i--)if(coins[i].bonus&&aabb(coins[i],zone))coins.splice(i,1);
        platforms.push({x:sx-34,y:roomY-58,w:84,h:PLH,type:'normal',solid:false,gone:false});
        dataShards[1].x=sx; dataShards[1].y=sy; dataShards[1].id=`${sx}_${sy}`;
        dataShards[1].inRoom=true;
      }
      worldW=roomX+roomW+120;
    }
  }

  computeLevelMaxScore();
  // Snapshot the running total so this level's score starts counting from 0.
  // genLevel runs after every (re)start once score/advLevel are set, so this
  // single hook covers all start paths (infinite, adventure, retry, cutscene).
  levelStartScore=score;
  levelStartCoins=coinsTotal;
  // Сколько монет создала генерация. Всё, что дописывается позже (монеты из
  // проявленных блоков), синхронизируется по собственному номеру — см.
  // netWorldSnap: индекс в массиве для них у разных клиентов может отличаться.
  _coinBase=coins.length;
}

// Estimate the maximum score obtainable on the freshly-generated level. Used to
// grade per-level stars (★/★★/★★★) against how much of it the player earned.
// Mirrors the point awards scattered through the gameplay code:
//   coin = 10 · enemy = EC.score (×2 hardcore) · boss = 2000 + lvl·150 (×2 hc)
//   flag base = 500 + lvl·100 · best height bonus = 1000 · time bonus ≈ timMax·2
function computeLevelMaxScore(){
  const lvl=advMode?advLevel:level;
  const hc=hardMode?2:1;
  levelCoinMax=coins.length*10;
  let enemyPts=0;
  for(const e of enemies){const cfg=EC[e.type];enemyPts+=(cfg?cfg.score:100)*hc;}
  if(boss){enemyPts+=(2000+lvl*150)*hc;}
  levelEnemyMax=enemyPts;
  const flagBase=500+lvl*100;
  const heightMax=1000;                 // PERFECT flag grab
  const timeMax=Math.floor(lvlTime(lvl)*(hardMode?0.7:1))*2; // full clock remaining
  // Secret data-shards (mechanic 7) count toward the achievable maximum so
  // collecting them all is rewarded with a clean 3★ rather than overflowing past 100%.
  const shardMax=dataShards.length*SHARD_VALUE+(dataShards.length?ALL_SHARDS_BONUS:0);
  levelMaxScore=Math.max(1,levelCoinMax+levelEnemyMax+flagBase+heightMax+timeMax+shardMax);
}

// Stars for a per-level score, graded against that level's achievable maximum.
//   ≥80% → 3★ · ≥55% → 2★ · otherwise 1★ (completing always earns at least 1).
function starsForScore(lvlScore,maxScore){
  const frac=maxScore>0?lvlScore/maxScore:0;
  if(frac>=0.80)return 3;
  if(frac>=0.55)return 2;
  return 1;
}

// ════════════════════════════════════════════════
//  ARCHETYPE GENERATORS
// ════════════════════════════════════════════════

// Speedrun archetype: make level faster-paced
function applySpeedrunArchetype(rng){
  // Reduce gaps between platforms for faster running
  // Add more jump pads for speed
  let padCount=0;
  for(const pl of platforms){
    if(pl.type==='ground'&&pl.w>100&&padCount<3&&rng()<0.3){
      jumpPads.push({x:pl.x+pl.w-80,y:pl.y-2,w:60,h:8,power:24,anim:0});
      padCount++;
    }
  }

  // Warning message
  setTimeout(()=>{
    if(player)floatTxt(player.x+player.w/2,player.y-40,T('modSpeedrunMsg'),'#ff0');
  },1000);
}

// Stealth archetype: add spotlights/cameras
function applyStealthArchetype(rng){
  // Add 3-4 spotlights at strategic positions
  const spotCount=3+Math.floor(rng()*2);
  const spacing=(worldW-800)/spotCount;

  for(let i=0;i<spotCount;i++){
    const sx=400+i*spacing+rng()*100;
    const sy=60+rng()*60;
    spotlights.push({
      x:sx,
      y:sy,
      angle:Math.PI*0.5, // start pointing down
      range:150,
      sweep:true,
      sweepSpeed:0.02,
      sweepRange:Math.PI*0.5,
      sweepCenter:Math.PI*0.5,
      alerted:false
    });
  }

  setTimeout(()=>{
    if(player)floatTxt(player.x+player.w/2,player.y-40,T('modSpotlightMsg'),'#f80');
  },1000);
}

function mkEnemy(type,x,y,surface,rng){
  const cfg=EC[type];
  if(!cfg){console.warn('Unknown enemy type:',type);return;}
  // Hard-mode: +1 hp cap at 4
  const hp=hardMode?Math.min(cfg.hp+1,4):cfg.hp;
  // For orbit enemies, use a smaller radius relative to spawn
  const fAmpBase=cfg.moveType==='orbit'?40+rng()*30:18+rng()*20;
  // For zigzag, start with random sign so they don't all go the same direction
  const fAmpSigned=cfg.moveType==='zigzag'?(rng()<.5?-1:1)*fAmpBase:fAmpBase;
  // Turret: always faces nearest player (handled in draw), don't give it horizontal velocity
  const vxInit=cfg.spd>0?cfg.spd*(rng()<.5?1:-1):0;
  // Orbit enemies: keep Y within visible range
  const safeY=cfg.moveType==='orbit'?Math.max(60,Math.min(H-120,y)):y;
  enemies.push({id:++_enemyIdSeq,x,y:safeY,w:cfg.w,h:cfg.h,vx:vxInit,vy:0,px:x,py:safeY,
    type,moveType:cfg.moveType,hp,mhp:hp,col:cfg.col,glow:cfg.glow,alive:true,flash:0,
    a:rng()*Math.PI*2,onGnd:false,
    pMin:surface?surface.x:x-130,pMax:surface?surface.x+surface.w-cfg.w:x+130,
    fbX:x,fpH:rng()*Math.PI*2,fAmp:fAmpSigned,fbX_y:safeY,
    sCD:85+Math.floor(rng()*125),bCD:38+Math.floor(rng()*52),
    // charge mechanic
    chargeCD:120+Math.floor(rng()*80),charging:false,chargeT:0,
    // shield mechanic (blocks bullets, only stomp damage)
    shielded:cfg.moveType==='shield',
    // orbit mechanic
    orbitAngle:rng()*Math.PI*2,
    // zigzag direction timer
    zigCD:30+Math.floor(rng()*40),
  });
}



// ════════════════════════════════════════════════
//  BACKGROUND DECORATIONS  — parallax, per theme
// ════════════════════════════════════════════════
// decors[] items: {T, x, y, layer:0|1, ...props}
// layer 0 = far back (parallax 0.25×), layer 1 = near back (parallax 0.6×)

function genDecors(rng){
  decors=[];
  const GY=H-40, id=CT.id, ww=worldW;

  function add(obj){ decors.push(obj); }
  function scatter(min,max,step,jit,layer,fn){
    for(let x=min;x<max;x+=step+rng()*jit-jit*.5){fn(x,layer);}
  }

  if(id===0){ //── CYBER CITY ──────────────────────
    // Far: massive skyscrapers silhouette
    scatter(0,ww,220,100,0,(x)=>{
      const w=55+rng()*130,h=120+rng()*240,y=GY-h;
      add({T:'skyBuilding',x,y,w,h,layer:0});
    });
    // Мачты убраны вместе с вывесками: тонкая вертикаль с красным огоньком
    // на верхушке читалась как шест, на который можно запрыгнуть, и торчала
    // прямо посреди игрового поля.
    // Near: pipes, signs, vents
    scatter(80,ww-80,180,80,1,(x)=>{
      // Вывесок и антенн здесь больше нет. Они висели в воздухе посреди
      // игрового поля, наезжали на платформы и читались как часть уровня, а не
      // как фон: игрок пытался на них запрыгнуть. Остались труба и вентиляция —
      // обе стоят на земле и в геометрию уровня не лезут.
      // Остались только вентиляционные короба у самой земли. Неоновые трубы
      // убраны вслед за вывесками и мачтами: яркий вертикальный столб посреди
      // экрана спорит с платформами и читается как элемент уровня.
      add({T:'vent',x,y:GY,w:28+rng()*30,layer:1});
    });

  }else if(id===1){ //── NEON JUNGLE ──────────────
    // Far: dense forest silhouette + fog
    scatter(0,ww,90,40,0,(x)=>{
      const h=150+rng()*200,r=38+rng()*45;
      add({T:'bgTree',x,y:GY-h,h,tw:10+rng()*10,canopyR:r,col:'#040e02',top:'#071a05',layer:0});
    });
    scatter(100,ww-100,200,100,0,(x)=>{add({T:'fogPatch',x,y:GY-40-rng()*60,w:80+rng()*120,layer:0});});
    // Near: detailed trees, vines, ferns, flowers
    scatter(60,ww-60,130,60,1,(x)=>{
      const t=Math.floor(rng()*5);
      if(t===0){const h=90+rng()*140,r=25+rng()*35;add({T:'bgTree',x,y:GY-h,h,tw:7+rng()*8,canopyR:r,col:'#0a2208',top:rng()>.5?'#126018':'#1a7525',layer:1});}
      else if(t===1){add({T:'vine',x,len:60+rng()*180,col:rng()>.5?'#1a5515':'#2a7525',w:2+rng()*3,layer:1});}
      else if(t===2){add({T:'fern',x,y:GY,spread:18+rng()*28,col:'#1a5010',layer:1});}
      else if(t===3){add({T:'flower',x,y:GY,col:rng()>.5?'#ff3399':'#66ff22',r:5+rng()*6,layer:1});}
      else{add({T:'roots',x,y:GY,w:40+rng()*60,layer:1});}
    });

  }else if(id===2){ //── LAVA WORLD ───────────────
    // Far: volcanic mountain silhouettes + glow
    scatter(0,ww,200,80,0,(x)=>{
      const h=120+rng()*180,w=100+rng()*140;
      add({T:'volcano',x,y:GY-h,w,h,col:'#1a0500',glow:'#f62',erupting:rng()>.5,layer:0});
    });
    scatter(80,ww-80,140,70,0,(x)=>{add({T:'farLavaGlow',x,y:GY,w:60+rng()*100,layer:0});});
    // Near: columns, cracks, bubbles, rocks
    scatter(60,ww-60,140,60,1,(x)=>{
      const t=Math.floor(rng()*5);
      if(t===0){const h=30+rng()*90;add({T:'lavaColumn',x,y:GY-h,w:14+rng()*16,h,col:'#2a0800',glow:'#ff4400',layer:1});}
      else if(t===1){add({T:'lavaBubble',x,y:GY-6-rng()*18,r:6+rng()*14,phase:rng()*Math.PI*2,col:'#ff6622',layer:1});}
      else if(t===2){add({T:'crack',x,y:GY,w:24+rng()*55,col:'#ff2200',layer:1});}
      else if(t===3){add({T:'volRock',x,y:GY,w:28+rng()*48,h:16+rng()*24,col:'#180600',layer:1});}
      else{add({T:'ember',x,y:GY-rng()*90,phase:rng()*Math.PI*2,layer:1});}
    });

  }else if(id===3){ //── ICE CAVES ────────────────
    // Far: cave ceiling with massive stalactites + deep blue
    scatter(0,ww,60,20,0,(x)=>{
      const h=40+rng()*130;
      add({T:'stalactite',x,y:0,h,w:10+rng()*18,col:'#c0dff5',glow:'#aaccee',layer:0});
    });
    scatter(100,ww-100,180,80,0,(x)=>{add({T:'iceCave',x,y:0,w:60+rng()*100,h:40+rng()*80,layer:0});});
    // Near: ice spikes, snow, frozen bubbles
    scatter(60,ww-60,90,40,1,(x)=>{
      const t=Math.floor(rng()*4);
      if(t===0){const h=16+rng()*60;add({T:'iceSpike',x,y:GY,h,w:8+rng()*14,col:'#c8eeff',layer:1});}
      else if(t===1){add({T:'snowDrift',x,y:GY,w:44+rng()*90,h:10+rng()*18,col:'#ddeeff',layer:1});}
      else if(t===2){const yy=H-80-rng()*180;add({T:'iceBubble',x,y:yy,r:8+rng()*20,col:'#aaddff',phase:rng()*Math.PI*2,layer:1});}
      else{add({T:'iceShatter',x,y:GY-4,layer:1});}
    });

  }else if(id===4){ //── DESERT RUINS ─────────────
    // Far: ruined city horizon
    scatter(0,ww,160,70,0,(x)=>{
      const h=80+rng()*120,w=30+rng()*60;
      add({T:'ruinBlock',x,y:GY-h,w,h,col:'#2a1a06',layer:0});
    });
    scatter(80,ww-80,300,140,0,(x)=>{add({T:'sandstormFar',x,y:GY-60-rng()*80,w:80+rng()*120,layer:0});});
    // Near: columns, dunes, cacti, arches, relics
    scatter(60,ww-60,170,70,1,(x)=>{
      const t=Math.floor(rng()*5);
      if(t===0){const h=70+rng()*110;add({T:'column',x,y:GY-h,w:16+rng()*10,h,col:'#7a5530',cap:'#9a7550',broken:rng()>.45,layer:1});}
      else if(t===1){add({T:'dune',x,y:GY,w:80+rng()*140,h:18+rng()*26,col:'#9a7022',layer:1});}
      else if(t===2){add({T:'cactus',x,y:GY,h:30+rng()*44,col:'#2d5a1a',layer:1});}
      else if(t===3){add({T:'arch',x,y:GY,w:64,h:88,col:'#7a5530',layer:1});}
      else{add({T:'relic',x,y:GY,col:'#bb9944',layer:1});}
    });

  }else if(id===5){ //── SPACE STATION ────────────
    // Far: deep space backdrop — star clusters, distant planets
    scatter(0,ww,280,100,0,(x)=>{
      add({T:'starCluster',x,y:20+rng()*180,count:6+Math.floor(rng()*10),spread:40+rng()*60,layer:0});
    });
    scatter(200,ww-200,600,200,0,(x)=>{add({T:'planet',x,y:30+rng()*120,r:20+rng()*40,col:['#4a3080','#2a6040','#803020'][Math.floor(rng()*3)],layer:0});});
    // Near: viewports, terminals, panels, debris, conduits
    scatter(60,ww-60,160,70,1,(x)=>{
      const t=Math.floor(rng()*5);
      if(t===0){add({T:'viewport',x,y:30+rng()*90,w:60+rng()*70,h:42+rng()*44,stars:Array.from({length:16},()=>({x:rng()*100,y:rng()*100,r:rng()*2+.5})),layer:1});}
      else if(t===1){add({T:'terminal',x,y:GY-44,w:24+rng()*18,h:36,scr:rng()>.5?'#001a33':'#0a0030',phase:rng()*Math.PI*2,layer:1});}
      else if(t===2){add({T:'techPanel',x,y:30+rng()*160,w:48+rng()*44,h:22,lights:4+Math.floor(rng()*5),layer:1});}
      else if(t===3){const yy=50+rng()*160;add({T:'debris',x,y:yy,r:10+rng()*22,phase:rng()*Math.PI*2,spd:rng()*.015+.005,layer:1});}
      else{add({T:'conduit',x,y:GY-24-rng()*90,w:55+rng()*90,col:'#2a2a4a',layer:1});}
    });

  }else if(id===6){ //── DARK FOREST ──────────────
    // Far: towering dead trees silhouette fog
    scatter(0,ww,80,30,0,(x)=>{
      const h=160+rng()*200;
      add({T:'deadTree',x,y:GY-h,h,tw:8+rng()*10,col:'#050c03',branches:2+Math.floor(rng()*3),layer:0});
    });
    scatter(100,ww-100,200,90,0,(x)=>{add({T:'darkFog',x,y:GY-50-rng()*80,w:90+rng()*130,layer:0});});
    // Near: mushrooms, wisps, stumps, webs
    scatter(60,ww-60,160,70,1,(x)=>{
      const t=Math.floor(rng()*5);
      if(t===0){add({T:'deadTree',x,y:GY-(80+rng()*120),h:80+rng()*120,tw:6+rng()*8,col:'#0c1808',branches:2+Math.floor(rng()*3),layer:1});}
      else if(t===1){add({T:'mushroom',x,y:GY,r:16+rng()*24,col:rng()>.5?'#6a1818':'#451848',stem:'#280e06',layer:1});}
      else if(t===2){const yy=GY-60-rng()*160;add({T:'wisp',x,y:yy,r:6+rng()*8,col:rng()>.5?'#00ff88':'#8800ff',phase:rng()*Math.PI*2,layer:1});}
      else if(t===3){add({T:'stump',x,y:GY,w:20+rng()*28,col:'#1c0c08',layer:1});}
      else{add({T:'spiderWeb',x,y:rng()*90,r:28+rng()*36,layer:1});}
    });

  }else if(id===7){ //── TOXIC ZONE ───────────────
    // Far: industrial wasteland silhouette
    scatter(0,ww,150,60,0,(x)=>{
      const h=90+rng()*140,w=20+rng()*50;
      add({T:'factoryBuilding',x,y:GY-h,w,h,col:'#0a0e00',smoke:rng()>.4,layer:0});
    });
    scatter(80,ww-80,250,100,0,(x)=>{add({T:'toxFarPipe',x,y:GY-30-rng()*60,w:80+rng()*120,col:'#1a1a00',layer:0});});
    // Near: barrels, puddles, vents, toxic trees, pipes
    scatter(60,ww-60,150,60,1,(x)=>{
      const t=Math.floor(rng()*5);
      if(t===0){add({T:'barrel',x,y:GY,w:16,h:26,col:'#1e1e00',stripe:'#ccff00',warn:rng()>.4,tipped:rng()>.55,layer:1});}
      else if(t===1){add({T:'toxicPuddle',x,y:GY,w:36+rng()*70,col:'#44aa00',phase:rng()*Math.PI*2,layer:1});}
      else if(t===2){add({T:'gasVent',x,y:GY,col:'#88cc00',phase:rng()*Math.PI*2,layer:1});}
      else if(t===3){const h=70+rng()*110;add({T:'toxicTree',x,y:GY-h,h,tw:6+rng()*7,col:'#1a2200',drip:'#88ff00',layer:1});}
      else{add({T:'toxPipe',x,y:GY-35-rng()*65,w:66+rng()*90,col:'#334400',layer:1});}
    });

  }else if(id===8){ //── STORM PEAKS ──────────────
    // Far: mountain range silhouette
    scatter(0,ww,150,50,0,(x)=>{
      const h=120+rng()*200,w=100+rng()*160;
      add({T:'mountain',x,y:GY-h,w,h,col:'#0e0e1a',snow:rng()>.4,layer:0});
    });
    scatter(100,ww-100,320,120,0,(x)=>{const yy=10+rng()*80;add({T:'stormCloud',x,y:yy,w:90+rng()*120,h:36+rng()*30,col:'#1a1a28',phase:rng()*Math.PI*2,spd:rng()*.3+.08,layer:0});});
    // Near: rocks, scorch, sharp rocks, lightning
    scatter(60,ww-60,160,70,1,(x)=>{
      const t=Math.floor(rng()*5);
      if(t===0){const h=80+rng()*160,w=90+rng()*110;add({T:'mountain',x,y:GY-h,w,h,col:'#181828',snow:rng()>.5,layer:1});}
      else if(t===1){const yy=20+rng()*100;add({T:'stormCloud',x,y:yy,w:70+rng()*100,h:30+rng()*26,col:'#282838',phase:rng()*Math.PI*2,spd:rng()*.3+.1,layer:1});}
      else if(t===2){add({T:'scorchMark',x,y:GY,w:24+rng()*36,col:'#0a0a14',layer:1});}
      else if(t===3){add({T:'sharpRock',x,y:GY,w:16+rng()*24,h:28+rng()*58,col:'#1c1c2c',layer:1});}
      else{add({T:'lightning',x,phase:rng()*100,interval:55+Math.floor(rng()*80),layer:1});}
    });

  }else if(id===9){ //── FINAL FORTRESS ───────────
    // Far: dark castle silhouette
    scatter(0,ww,200,80,0,(x)=>{
      const h=160+rng()*180,w=80+rng()*120;
      add({T:'castleWall',x,y:GY-h,w,h,col:'#0a0404',layer:0});
    });
    scatter(80,ww-80,300,140,0,(x)=>{add({T:'darkSmoke',x,y:rng()*100,w:60+rng()*80,layer:0});});
    // Near: battlements, skulls, chains, torches, obelisks
    scatter(60,ww-60,160,70,1,(x)=>{
      const t=Math.floor(rng()*5);
      if(t===0){add({T:'battlement',x,y:GY-70-rng()*60,w:50,h:56,col:'#180808',merlons:3,layer:1});}
      else if(t===1){add({T:'skullPile',x,y:GY,count:1+Math.floor(rng()*3),col:'#bb2020',layer:1});}
      else if(t===2){add({T:'chain',x,y:0,len:70+rng()*130,col:'#4a2222',layer:1});}
      else if(t===3){const y=GY-55-rng()*120;add({T:'torch',x,y,col:'#ff4400',phase:rng()*Math.PI*2,layer:1});}
      else{const h=90+rng()*140;add({T:'obelisk',x,y:GY-h,w:20,h,col:'#110808',glow:'#f44',layer:1});}
    });
  }else if(id===10){ //── PRISM ANOMALY (secret) ───
    // Every decoration here is native to this world. It used to borrow shapes
    // from other locations — ice spikes and ice bubbles from the Ice Caves,
    // obelisks from the Final Fortress, planets/debris/star clusters from the
    // Space Station — recoloured with a random hue. Recolouring does not make a
    // stalactite belong to a refraction anomaly, so they are replaced with
    // shapes built for this world: light itself, splitting.
    const rHue=()=>Math.floor(rng()*360);
    // Far: slow refraction rings and hanging light-prisms high in the void
    scatter(0,ww,300,120,0,(x)=>{
      add({T:'prismHalo',x,y:30+rng()*150,r:26+rng()*46,hue:rHue(),phase:rng()*Math.PI*2,layer:0});
    });
    scatter(120,ww-120,380,160,0,(x)=>{
      add({T:'prismSpire',x,y:0,h:70+rng()*130,w:14+rng()*20,hue:rHue(),layer:0});
    });
    // Near: crystals growing out of the ground, drifting glass panes and
    // vertical spectrum beams leaking through cracks in reality
    scatter(60,ww-60,150,65,1,(x)=>{
      const t=Math.floor(rng()*4);
      if(t===0){const h=26+rng()*80;add({T:'prismCrystal',x,y:GY,h,w:11+rng()*17,hue:rHue(),layer:1});}
      else if(t===1){const yy=H-100-rng()*170;add({T:'prismPane',x,y:yy,r:10+rng()*18,hue:rHue(),phase:rng()*Math.PI*2,spd:.006+rng()*.014,layer:1});}
      else if(t===2){add({T:'prismBeam',x,y:GY,h:80+rng()*150,w:6+rng()*10,hue:rHue(),phase:rng()*Math.PI*2,layer:1});}
      else{const h=70+rng()*120;add({T:'prismPylon',x,y:GY-h,w:16+rng()*8,h,hue:rHue(),layer:1});}
    });
  }
}

// ── Draw decorations with parallax ──────────────
// ── Decor layer cache (bug #22: "full redraw every frame") ──────────────────
// drawDecors() used to re-run every building/ruin/tree's full draw code (shape +
// windows + blinking lights, up to MAX_DECORS items × 2 layers) every single
// frame, just to shift it a few pixels for parallax. Positions only need a
// blit-shift each frame; only the actual PIXELS need occasional re-drawing.
//
// Each layer gets a modest offscreen "window" canvas (NOT the whole level —
// Android/Capacitor WebViews commonly cap canvas width around 4096px, so a
// level-spanning cache is unsafe on the game's own Android target) covering the
// viewport plus a wide margin. It's refilled — by calling the exact same
// _drawDecorItem code, unchanged — only when the camera nears its edge or a new
// level starts, then every frame just gets a single drawImage() blit per layer
// instead of redrawing every shape. Window-blink/rooftop-light animation still
// updates correctly each refill (every few seconds at normal movement speed),
// which is fine since those already only change every 30-50 ticks anyway.
const DECOR_CACHE_W_MAX = 4000;  // hard ceiling — stays under mobile canvas-size limits
const DECOR_CACHE_MARGIN = 500;  // refill when the visible window gets within this of a cache edge
let _decorCache = [null, null];  // per layer: {canvas, cctx, originX, w}

function _decorCacheInvalidate(){ _decorCache = [null, null]; }

function _decorCacheRebuild(layerIdx, centerWorldX){
  // Cache width scales with the actual viewport (plus margins on both sides)
  // so it always covers W with room to spare, without over-allocating on a
  // typical-sized window — capped at DECOR_CACHE_W_MAX for platform safety.
  const cw = Math.min(DECOR_CACHE_W_MAX, Math.round(W + DECOR_CACHE_MARGIN*4));
  let dc = _decorCache[layerIdx];
  if(!dc || dc.w!==cw){
    const c=document.createElement('canvas'); c.width=cw; c.height=H;
    dc = _decorCache[layerIdx] = {canvas:c, cctx:c.getContext('2d'), originX:0, w:cw};
  }
  const originX = centerWorldX - cw/2;
  dc.originX = originX;
  const cctx = dc.cctx;
  cctx.clearRect(0,0,cw,H);
  cctx.save();
  cctx.globalAlpha = layerIdx===0 ? 0.48 : 0.80;
  cctx.shadowBlur = 0;
  const GY = H-40;
  let drawn = 0;
  const MAX_DECORS = Math.max(6, Math.round(40 * ((typeof GFX==='object'&&GFX&&GFX.decorMul)?GFX.decorMul:1)));
  for(const d of decors){
    if(d.layer!==layerIdx) continue;
    const localX = d.x - originX;
    if(localX < -300 || localX > cw+300) continue;
    if(drawn++ > MAX_DECORS) break;
    cctx.save();
    _drawDecorItem(cctx, d, localX, GY, layerIdx);
    cctx.restore();
  }
  cctx.restore();
}

function drawDecors(){
  if(!decors||!decors.length)return;

  for (const layerIdx of [0,1]) {
    const pFactor = layerIdx===0 ? 0.22 : 0.58;
    const viewWorldX = camX*pFactor; // world-x currently at the left edge of the screen, in this layer's space

    let dc = _decorCache[layerIdx];
    const needsRebuild = !dc
      || viewWorldX < dc.originX + DECOR_CACHE_MARGIN
      || (viewWorldX + W) > dc.originX + dc.w - DECOR_CACHE_MARGIN;
    if (needsRebuild) {
      _decorCacheRebuild(layerIdx, viewWorldX + W/2);
      dc = _decorCache[layerIdx];
    }

    /* Блит по слою — и только той частью кэша, что реально попадает на экран.
       Кэш втрое шире окна (W + запас с обеих сторон, см. _decorCacheRebuild), и
       раньше он гнался целиком: за кадр это лишние пара миллионов пикселей на
       каждый из двух слоёв. Видно ровно столько же, работы — втрое меньше. */
    const dx = dc.originX - viewWorldX;          // где левый край кэша на экране
    // Из кэша вырезаем ЦЕЛЫЕ пиксели, а дробную часть смещения оставляем цели:
    // с дробным началом выборки браузер интерполирует иначе, чем при обычном
    // блите, и картинка чуть-чуть, но отличалась бы от прежней.
    const skip = dx < 0 ? -dx : 0;
    const sx = Math.floor(skip);
    const dstX = (dx > 0 ? dx : 0) - (skip - sx);
    const sw = Math.min(dc.w - sx, Math.ceil(W - dstX) + 1);
    if (sw > 0) ctx.drawImage(dc.canvas, sx, 0, sw, H, dstX, 0, sw, H);
  }
}

function _drawDecorItem(ctx, d, sx, GY, layerIdx){
  const sc = layerIdx===0 ? 0.7 : 1.0; // far layer is smaller
  const useBlur = layerIdx===1; // shadowBlur только для ближнего слоя

  switch(d.T){

  // ═══ SHARED: buildings/silhouettes ════════════
  case'skyBuilding':{
    const bw=d.w*sc, bh=d.h*sc, by=GY-bh;
    ctx.fillStyle=d.col||'#060a18';
    ctx.fillRect(sx-bw/2, by, bw, bh);
    // Rooftop step
    ctx.fillStyle='#030610';
    ctx.fillRect(sx-bw*.35, by-7*sc, bw*.7, 7*sc);
    ctx.fillRect(sx-bw*.18, by-13*sc, bw*.36, 7*sc);
    // Windows – drawn procedurally (no per-window storage)
    const wCols=Math.max(1,Math.floor((bw-12)/14)), wGapX=bw/wCols;
    for(let wr=by+10*sc; wr<GY-22*sc; wr+=15*sc){
      for(let wc=0; wc<wCols; wc++){
        const wx=sx-bw/2+8*sc+wc*wGapX;
        const seed=(d.x+wr*0.1+wc)*7.3;
        const onCycle=Math.floor(tick/50+seed)%6;
        const lit=onCycle<3;
        const wcol=((d.x*13+wc*7)%2===0)?'#4af':'#ff8';
        ctx.fillStyle=lit?withAlpha(wcol,'99'):'#0a1020aa';
        ctx.fillRect(wx, wr, 8*sc, 10*sc);
      }
    }
    // Rooftop red blinking light
    const bl=Math.floor(tick/30)%2;
    ctx.shadowColor='#f00';ctx.shadowBlur=bl?10:2;
    ctx.fillStyle=bl?'#ff2200':'#220000';
    ctx.beginPath();ctx.arc(sx, by-16*sc, 3.5*sc, 0, Math.PI*2);ctx.fill();
    ctx.shadowBlur=0;
    break;
  }

  case'ruinBlock':{
    const bw=d.w*sc, bh=d.h*sc;
    ctx.fillStyle=d.col||'#1a1206';
    ctx.fillRect(sx-bw/2, GY-bh, bw, bh);
    // Crumbling top
    ctx.fillStyle='#111006';
    ctx.fillRect(sx-bw*.4, GY-bh-4, bw*.3, 8);
    break;
  }
  case'castleWall':{
    const bw=d.w*sc, bh=d.h*sc;
    ctx.fillStyle=d.col||'#0a0404';
    ctx.fillRect(sx-bw/2, GY-bh, bw, bh);
    // Merlons on top
    const mw=bw/5;
    for(let m=0;m<3;m++){
      ctx.fillRect(sx-bw/2+m*mw*2, GY-bh-16*sc, mw, 16*sc);
    }
    break;
  }
  case'factoryBuilding':{
    const bw=d.w*sc, bh=d.h*sc;
    ctx.fillStyle=d.col||'#0a0e00';
    ctx.fillRect(sx-bw/2, GY-bh, bw, bh);
    if(d.smoke){
      // Smoke stack
      ctx.fillRect(sx+bw*.1, GY-bh-20*sc, 6*sc, 20*sc);
      // Smoke puff
      ctx.fillStyle='#1a1a0a';ctx.globalAlpha*=0.4;
      for(let i=0;i<3;i++){
        const sy=GY-bh-30*sc-i*12*sc+Math.sin(tick*.04+i)*(4*sc);
        ctx.beginPath();ctx.arc(sx+bw*.1+3*sc, sy, (5+i*3)*sc, 0, Math.PI*2);ctx.fill();
      }
      ctx.globalAlpha=(layerIdx===0?0.48:0.80);
    }
    break;
  }

  // ═══ CYBER CITY ═══════════════════════════════
  case'farAntenna':{
    const ah=d.h||70, base=d.y, top=base-ah;
    ctx.strokeStyle='#336699';ctx.lineWidth=2*sc;
    // Tower body
    ctx.beginPath();ctx.moveTo(sx,base);ctx.lineTo(sx,top);ctx.stroke();
    // Crossbars
    ctx.lineWidth=1.5*sc;
    ctx.beginPath();ctx.moveTo(sx-8*sc,top+ah*.35);ctx.lineTo(sx+8*sc,top+ah*.35);ctx.stroke();
    ctx.beginPath();ctx.moveTo(sx-6*sc,top+ah*.6);ctx.lineTo(sx+6*sc,top+ah*.6);ctx.stroke();
    // Blink light at tip
    const bl=Math.floor(tick/22)%2;
    ctx.shadowColor='#f00';ctx.shadowBlur=bl?7:1;
    ctx.fillStyle=bl?'#ff2200':'#330000';
    ctx.beginPath();ctx.arc(sx,top,3*sc,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
    break;
  }
  case'neonPipe':{
    ctx.shadowColor=d.col;ctx.shadowBlur=10+Math.sin(tick*.07)*4;
    ctx.strokeStyle=d.col;ctx.lineWidth=d.w;
    ctx.beginPath();ctx.moveTo(sx, d.y);ctx.lineTo(sx, d.y+d.h);ctx.stroke();
    ctx.fillStyle=d.col;ctx.fillRect(sx-d.w/2-3, d.y+d.h-5, d.w+6, 7);
    ctx.shadowBlur=0;break;
  }
  case'antenna':{
    ctx.strokeStyle='#4488cc';ctx.lineWidth=2;
    // Support mast down to the ground so the antenna isn't floating in mid-air.
    ctx.save();ctx.strokeStyle='#21466e';ctx.globalAlpha*=0.85;ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(sx, d.y+22);ctx.lineTo(sx, GY);ctx.stroke();ctx.restore();
    ctx.beginPath();ctx.moveTo(sx, d.y+22);ctx.lineTo(sx, d.y);ctx.stroke();
    ctx.beginPath();ctx.moveTo(sx-9, d.y+9);ctx.lineTo(sx+9, d.y+9);ctx.stroke();
    ctx.beginPath();ctx.moveTo(sx-5, d.y+15);ctx.lineTo(sx+5, d.y+15);ctx.stroke();
    const bl=Math.floor(tick/20)%2;
    ctx.shadowColor='#f00';ctx.shadowBlur=bl?7:1;
    ctx.fillStyle=bl?'#ff2200':'#220000';
    ctx.beginPath();ctx.arc(sx, d.y, 3, 0, Math.PI*2);ctx.fill();ctx.shadowBlur=0;break;
  }
  case'neonSign':{
    const sw=d.txt.length*6+14;
    const pulse=0.7+Math.sin(tick*.09)*0.3;
    ctx.fillStyle='#08081a';ctx.fillRect(sx-sw/2, d.y-10, sw, 16);
    ctx.shadowColor=d.col;ctx.shadowBlur=12*pulse;
    ctx.strokeStyle=d.col;ctx.lineWidth=1.5;ctx.strokeRect(sx-sw/2+1, d.y-9, sw-2, 14);
    ctx.fillStyle=d.col;ctx.font="6px 'Press Start 2P',monospace";ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(d.txt, sx, d.y-3);ctx.shadowBlur=0;break;
  }
  case'vent':{
    const vx=sx-d.w/2;
    ctx.fillStyle='#06101a';ctx.fillRect(vx, GY-14, d.w, 14);
    ctx.strokeStyle='#1a3a5e66';ctx.lineWidth=1;ctx.strokeRect(vx, GY-14, d.w, 14);
    ctx.strokeStyle='#0a1e3a';
    for(let ix=vx+4;ix<vx+d.w-3;ix+=5){ctx.beginPath();ctx.moveTo(ix,GY-12);ctx.lineTo(ix,GY-3);ctx.stroke();}
    if(Math.floor(tick/16)%4===0){ctx.fillStyle='#4af';ctx.globalAlpha*=.15;ctx.beginPath();ctx.ellipse(sx,GY-20,d.w/3,7,0,0,Math.PI*2);ctx.fill();ctx.globalAlpha=(layerIdx?0.80:0.48);}
    break;
  }

  // ═══ NEON JUNGLE ══════════════════════════════
  case'bgTree':{
    ctx.fillStyle=d.col;ctx.fillRect(sx-d.tw/2, d.y, d.tw, d.h);
    ctx.shadowColor=d.top;ctx.shadowBlur=layerIdx===1?14:6;
    ctx.fillStyle=d.top;
    ctx.beginPath();ctx.arc(sx, d.y, d.canopyR, 0, Math.PI*2);ctx.fill();
    ctx.fillStyle=withAlpha(d.top,'88');
    ctx.beginPath();ctx.arc(sx+d.canopyR*.5, d.y+d.canopyR*.35, d.canopyR*.6, 0, Math.PI*2);ctx.fill();
    ctx.shadowBlur=0;break;
  }
  case'fogPatch':case'darkFog':{
    ctx.fillStyle=d.T==='darkFog'?'#0a1208':'#0a180a';
    ctx.globalAlpha*=0.35;
    ctx.beginPath();ctx.ellipse(sx, d.y, d.w/2, 24, 0, 0, Math.PI*2);ctx.fill();
    ctx.globalAlpha=(layerIdx?0.80:0.48);break;
  }
  case'vine':{
    ctx.strokeStyle=d.col;ctx.lineWidth=d.w;ctx.beginPath();
    for(let y=0;y<=d.len;y+=10){const vx=sx+Math.sin(y*.14+tick*.012)*7;y===0?ctx.moveTo(vx,y):ctx.lineTo(vx,y);}
    ctx.stroke();
    ctx.fillStyle=withAlpha(d.col,'cc');
    for(let y=18;y<d.len;y+=28){const lx=sx+Math.sin(y*.14+tick*.012)*7;
      ctx.beginPath();ctx.ellipse(lx+7,y,6,3,.3,0,Math.PI*2);ctx.fill();
      ctx.beginPath();ctx.ellipse(lx-7,y+9,6,3,-.3,0,Math.PI*2);ctx.fill();}
    break;
  }
  case'fern':{
    ctx.strokeStyle=d.col;ctx.lineWidth=2;ctx.fillStyle=d.col;
    for(let a=-1.1;a<=1.1;a+=.25){
      const r=d.spread;ctx.beginPath();ctx.moveTo(sx,d.y);ctx.lineTo(sx+Math.sin(a)*r,d.y-Math.cos(a)*r*.8);ctx.stroke();
      const lx=sx+Math.sin(a)*r*.6,ly=d.y-Math.cos(a)*r*.5;
      ctx.beginPath();ctx.ellipse(lx+Math.sin(a+.5)*8,ly,5,2,a+.5,0,Math.PI*2);ctx.fill();
    }break;
  }
  case'flower':{
    const bob=Math.sin(tick*.07+d.x*.01)*3;
    ctx.strokeStyle='#1a4a10';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(sx,d.y);ctx.lineTo(sx+2,d.y-22+bob);ctx.stroke();
    ctx.shadowColor=d.col;ctx.shadowBlur=(useBlur?12:0);ctx.fillStyle=d.col;
    for(let a=0;a<Math.PI*2;a+=Math.PI/3){ctx.beginPath();ctx.ellipse(sx+2+Math.cos(a)*d.r,d.y-22+bob+Math.sin(a)*d.r,d.r*.7,d.r*.4,a,0,Math.PI*2);ctx.fill();}
    ctx.fillStyle='#ffff88';ctx.shadowBlur=(useBlur?8:0);ctx.beginPath();ctx.arc(sx+2,d.y-22+bob,d.r*.5,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;break;
  }
  case'roots':{
    ctx.strokeStyle='#1a3010';ctx.lineWidth=3;
    for(let i=0;i<4;i++){const ox=(i-1.5)*d.w/4;ctx.beginPath();ctx.moveTo(sx+ox,d.y);ctx.quadraticCurveTo(sx+ox+Math.sin(i)*14,d.y+14,sx+ox+Math.sin(i)*24,d.y+28);ctx.stroke();}break;
  }

  // ═══ LAVA WORLD ═══════════════════════════════
  case'volcano':{
    const vw=d.w*sc, vh=d.h*sc;
    ctx.fillStyle=d.col;
    ctx.beginPath();ctx.moveTo(sx-vw/2,GY);ctx.lineTo(sx-vw*.12,GY-vh);ctx.lineTo(sx+vw*.12,GY-vh);ctx.lineTo(sx+vw/2,GY);ctx.closePath();ctx.fill();
    // Lava at crater
    if(d.erupting){
      ctx.shadowColor=d.glow;ctx.shadowBlur=20+Math.sin(tick*.1)*10;
      ctx.fillStyle='#ff4400';ctx.globalAlpha*=0.7;
      ctx.beginPath();ctx.ellipse(sx, GY-vh, vw*.12+2, 8, 0, 0, Math.PI*2);ctx.fill();
      // Eruption particles
      if(tick%8<3){ctx.fillStyle='#ff8800';ctx.globalAlpha*=0.5;ctx.beginPath();ctx.arc(sx+Math.sin(tick*.3)*10,GY-vh-10-tick%40,4,0,Math.PI*2);ctx.fill();}
      ctx.globalAlpha=(layerIdx?0.80:0.48);ctx.shadowBlur=0;
    }break;
  }
  case'farLavaGlow':{
    ctx.fillStyle='#ff3300';ctx.globalAlpha*=0.12+Math.sin(tick*.06)*.04;
    ctx.beginPath();ctx.ellipse(sx, GY, d.w/2, 18, 0, 0, Math.PI*2);ctx.fill();
    ctx.globalAlpha=(layerIdx?0.80:0.48);break;
  }
  case'lavaColumn':{
    ctx.fillStyle=d.col;ctx.fillRect(sx-d.w/2, d.y, d.w, H-d.y);
    ctx.shadowColor=d.glow;ctx.shadowBlur=14+Math.sin(tick*.12+d.x*.02)*6;
    ctx.strokeStyle=d.glow;ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(sx-d.w/2,d.y);
    for(let xi=sx-d.w/2;xi<=sx+d.w/2;xi+=4)ctx.lineTo(xi,d.y-5-Math.sin(xi*.8+tick*.1)*4);
    ctx.lineTo(sx+d.w/2,d.y);ctx.stroke();ctx.shadowBlur=0;break;
  }
  case'lavaBubble':{
    const bob=Math.sin(tick*.09+d.phase)*6,sz=d.r*(1+Math.sin(tick*.12+d.phase)*.08);
    ctx.shadowColor=d.col;ctx.shadowBlur=(useBlur?14:0);ctx.fillStyle=d.col;
    ctx.beginPath();ctx.arc(sx, d.y-bob, sz, 0, Math.PI*2);ctx.fill();
    ctx.fillStyle='#ffaa44';ctx.globalAlpha*=0.45;ctx.beginPath();ctx.arc(sx-sz*.3,d.y-bob-sz*.3,sz*.3,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha=(layerIdx?0.80:0.48);ctx.shadowBlur=0;break;
  }
  case'crack':{
    ctx.shadowColor=d.col;ctx.shadowBlur=(useBlur?12:0);ctx.strokeStyle=d.col;ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(sx-d.w/2,GY);
    const pts=4+Math.floor(d.w/10);
    for(let i=1;i<pts;i++){const cx=sx-d.w/2+i*d.w/(pts-1);ctx.lineTo(cx,GY+Math.sin(i*2.1)*5+Math.cos(i*1.3)*4);}
    ctx.stroke();ctx.globalAlpha*=0.18;ctx.fillStyle=d.col;ctx.fill();
    ctx.globalAlpha=(layerIdx?0.80:0.48);ctx.shadowBlur=0;break;
  }
  case'volRock':{
    ctx.fillStyle=d.col;ctx.beginPath();
    const rx=sx-d.w/2,ry=GY-d.h;
    ctx.moveTo(rx,GY);ctx.lineTo(rx,ry+d.h*.4);ctx.lineTo(rx+d.w*.2,ry);ctx.lineTo(rx+d.w*.5,ry-d.h*.2);ctx.lineTo(rx+d.w*.8,ry+d.h*.1);ctx.lineTo(rx+d.w,ry+d.h*.5);ctx.lineTo(rx+d.w,GY);ctx.closePath();ctx.fill();
    ctx.strokeStyle='#1a0600';ctx.lineWidth=1;ctx.stroke();break;
  }
  case'ember':{
    const ey=d.y-((tick*.4+d.phase*50)%100);
    ctx.globalAlpha*=(0.4+Math.sin(tick*.14+d.phase)*.3);
    ctx.shadowColor='#ff6600';ctx.shadowBlur=(useBlur?8:0);ctx.fillStyle='#ff8800';
    ctx.beginPath();ctx.arc(sx,ey,2.5,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#ffcc00';ctx.beginPath();ctx.arc(sx+2,ey-4,1.5,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha=(layerIdx?0.80:0.48);ctx.shadowBlur=0;break;
  }

  // ═══ ICE CAVES ════════════════════════════════
  case'iceCave':{
    ctx.fillStyle='#0a1828';ctx.globalAlpha*=0.5;
    ctx.beginPath();ctx.ellipse(sx,d.y+d.h/2,d.w/2,d.h/2,0,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha=(layerIdx?0.80:0.48);break;
  }
  case'stalactite':{
    ctx.shadowColor=d.glow;ctx.shadowBlur=(useBlur?8:0);ctx.fillStyle=d.col;
    ctx.beginPath();ctx.moveTo(sx-d.w/2,0);ctx.lineTo(sx+d.w/2,0);ctx.lineTo(sx+d.w/4,d.h);ctx.lineTo(sx,d.h+10);ctx.lineTo(sx-d.w/4,d.h);ctx.closePath();ctx.fill();
    ctx.globalAlpha*=0.3;ctx.fillStyle='#ffffff';ctx.beginPath();ctx.moveTo(sx-d.w*.2,0);ctx.lineTo(sx,0);ctx.lineTo(sx,d.h*.65);ctx.closePath();ctx.fill();
    ctx.globalAlpha=(layerIdx?0.80:0.48);ctx.shadowBlur=0;break;
  }
  case'iceSpike':{
    ctx.shadowColor=d.col;ctx.shadowBlur=(useBlur?10:0);ctx.fillStyle=d.col;
    ctx.beginPath();ctx.moveTo(sx-d.w/2,GY);ctx.lineTo(sx,GY-d.h);ctx.lineTo(sx+d.w/2,GY);ctx.closePath();ctx.fill();
    ctx.globalAlpha*=0.25;ctx.fillStyle='#fff';ctx.beginPath();ctx.moveTo(sx-d.w*.15,GY);ctx.lineTo(sx-d.w*.05,GY-d.h*.7);ctx.lineTo(sx+d.w*.08,GY-d.h*.5);ctx.closePath();ctx.fill();
    ctx.globalAlpha=(layerIdx?0.80:0.48);ctx.shadowBlur=0;break;
  }
  case'snowDrift':{
    ctx.fillStyle=d.col;ctx.globalAlpha*=0.55;ctx.beginPath();ctx.ellipse(sx,GY-d.h/2,d.w/2,d.h/2,0,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha*=0.4;ctx.fillStyle='#fff';ctx.beginPath();ctx.ellipse(sx-d.w*.1,GY-d.h*.5,d.w*.25,d.h*.3,-.2,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha=(layerIdx?0.80:0.48);break;
  }
  case'iceBubble':{
    const bob=Math.sin(tick*.05+d.phase)*6;
    ctx.shadowColor=d.col;ctx.shadowBlur=(useBlur?12:0);ctx.strokeStyle=d.col;ctx.lineWidth=2;ctx.globalAlpha*=0.5;
    ctx.beginPath();ctx.arc(sx,d.y+bob,d.r,0,Math.PI*2);ctx.stroke();
    ctx.globalAlpha*=0.3;ctx.fillStyle=d.col;ctx.fill();
    ctx.globalAlpha=(layerIdx?0.80:0.48);ctx.shadowBlur=0;break;
  }
  case'iceShatter':{
    ctx.strokeStyle='#aaddff';ctx.lineWidth=1.5;ctx.globalAlpha*=0.45;
    for(let i=0;i<5;i++){const a=i*Math.PI*.4+.2,r=8+i*3;ctx.beginPath();ctx.moveTo(sx,GY-4);ctx.lineTo(sx+Math.cos(a)*r,GY-4-Math.sin(a)*r);ctx.stroke();}
    ctx.globalAlpha=(layerIdx?0.80:0.48);break;
  }

  // ═══ DESERT RUINS ═════════════════════════════
  case'sandstormFar':{
    ctx.fillStyle='#c89040';ctx.globalAlpha*=0.08+Math.sin(tick*.04)*.04;
    for(let i=0;i<4;i++){ctx.beginPath();ctx.ellipse(sx+i*20-30,d.y+i*5,d.w/3+i*10,12,0,0,Math.PI*2);ctx.fill();}
    ctx.globalAlpha=(layerIdx?0.80:0.48);break;
  }
  case'column':{
    ctx.fillStyle=d.col;ctx.fillRect(sx-d.w/2, d.y, d.w, d.h);
    ctx.fillStyle=d.cap;ctx.fillRect(sx-d.w/2-4,d.y-8,d.w+8,10);ctx.fillRect(sx-d.w/2-4,d.y+d.h-4,d.w+8,8);
    ctx.strokeStyle=withAlpha(d.col,'88');ctx.lineWidth=1;for(let i=1;i<4;i++){ctx.beginPath();ctx.moveTo(sx-d.w/2+i*d.w/4,d.y);ctx.lineTo(sx-d.w/2+i*d.w/4,d.y+d.h);ctx.stroke();}
    if(d.broken){ctx.strokeStyle='#3a2010';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(sx,d.y+d.h*.2);ctx.lineTo(sx+5,d.y+d.h*.5);ctx.lineTo(sx-2,d.y+d.h*.8);ctx.stroke();}
    break;
  }
  case'dune':{
    ctx.fillStyle=d.col;ctx.globalAlpha*=0.6;ctx.beginPath();ctx.ellipse(sx,GY,d.w/2,d.h,0,Math.PI,Math.PI*2);ctx.fill();
    ctx.globalAlpha*=0.4;ctx.fillStyle='#ffdd88';ctx.beginPath();ctx.ellipse(sx-d.w*.1,GY-d.h*.5,d.w*.2,d.h*.25,-.3,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha=(layerIdx?0.80:0.48);break;
  }
  case'cactus':{
    ctx.fillStyle=d.col;ctx.fillRect(sx-4,GY-d.h,8,d.h);ctx.fillRect(sx-18,GY-d.h*.55,14,5);ctx.fillRect(sx-18,GY-d.h*.8,5,d.h*.28);ctx.fillRect(sx+4,GY-d.h*.4,14,5);ctx.fillRect(sx+13,GY-d.h*.65,5,d.h*.28);
    ctx.strokeStyle='#88aa44';ctx.lineWidth=1;for(let i=0;i<d.h;i+=10){ctx.beginPath();ctx.moveTo(sx-4,GY-d.h+i);ctx.lineTo(sx-9,GY-d.h+i-2);ctx.stroke();ctx.beginPath();ctx.moveTo(sx+4,GY-d.h+i+5);ctx.lineTo(sx+9,GY-d.h+i+3);ctx.stroke();}
    break;
  }
  case'arch':{
    ctx.fillStyle=d.col;ctx.fillRect(sx-d.w/2,GY-d.h,10,d.h);ctx.fillRect(sx+d.w/2-10,GY-d.h,10,d.h);
    ctx.strokeStyle=d.col;ctx.lineWidth=10;ctx.beginPath();ctx.arc(sx,GY-d.h+d.w/2-10,d.w/2-5,Math.PI,Math.PI*2);ctx.stroke();break;
  }
  case'relic':{
    ctx.fillStyle=d.col;ctx.beginPath();ctx.ellipse(sx,GY-6,9,6,0,0,Math.PI*2);ctx.fill();ctx.fillRect(sx-6,GY-16,12,12);ctx.strokeStyle='#664422';ctx.lineWidth=1;ctx.beginPath();ctx.arc(sx,GY-8,7,.5,2.6);ctx.stroke();break;
  }

  // ═══ SPACE STATION ════════════════════════════
  case'starCluster':{
    ctx.fillStyle='#ffffff';
    for(let i=0;i<d.count;i++){
      const a=(i/d.count)*Math.PI*2, r=rnd01(d.x+i)*d.spread;
      const twinkle=Math.sin(tick*.04+i*1.3)*.4+.6;
      ctx.globalAlpha*=twinkle*.8;
      ctx.beginPath();ctx.arc(sx+Math.cos(a)*r, d.y+Math.sin(a)*r*.5, rnd01(d.x+i+100)*.8+.3, 0, Math.PI*2);ctx.fill();
      ctx.globalAlpha=(layerIdx?0.80:0.48);
    }break;
  }
  case'planet':{
    ctx.shadowColor=d.col;ctx.shadowBlur=(useBlur?16:0);ctx.fillStyle=d.col;
    ctx.beginPath();ctx.arc(sx,d.y,d.r,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha*=0.3;ctx.fillStyle='#ffffff';ctx.beginPath();ctx.arc(sx-d.r*.3,d.y-d.r*.3,d.r*.4,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha=(layerIdx?0.80:0.48);ctx.shadowBlur=0;break;
  }
  case'viewport':{
    const vx=sx-d.w/2;ctx.fillStyle='#040818';ctx.fillRect(vx,d.y,d.w,d.h);
    ctx.strokeStyle='#334488';ctx.lineWidth=3;ctx.strokeRect(vx,d.y,d.w,d.h);
    for(const s of d.stars){const tw=Math.sin(tick*.05+s.x)*.5+.5;ctx.globalAlpha*=(tw*.7+.25);ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(vx+s.x*d.w/100,d.y+s.y*d.h/100,s.r,0,Math.PI*2);ctx.fill();ctx.globalAlpha=(layerIdx?0.80:0.48);}
    ctx.fillStyle='#556699';[[0,0],[d.w-5,0],[0,d.h-5],[d.w-5,d.h-5]].forEach(([bx,by])=>{ctx.beginPath();ctx.arc(vx+bx+3,d.y+by+3,3,0,Math.PI*2);ctx.fill();});break;
  }
  case'terminal':{
    ctx.fillStyle='#0a1030';ctx.fillRect(sx-d.w/2,d.y,d.w,d.h);ctx.strokeStyle='#334488';ctx.lineWidth=2;ctx.strokeRect(sx-d.w/2,d.y,d.w,d.h);
    const blink=Math.floor(tick*.04+d.phase)%4;
    ctx.fillStyle=d.scr;ctx.fillRect(sx-d.w/2+3,d.y+4,d.w-6,d.h-12);
    ctx.fillStyle='#00ff88';ctx.globalAlpha*=0.7;ctx.fillRect(sx-d.w/2+5,d.y+7,blink*6,3);ctx.fillRect(sx-d.w/2+5,d.y+12,d.w-10,2);ctx.fillRect(sx-d.w/2+5,d.y+16,d.w*.6-4,2);
    ctx.globalAlpha=(layerIdx?0.80:0.48);ctx.fillStyle='#222244';ctx.fillRect(sx-d.w/2+2,d.y+d.h-6,d.w-4,5);break;
  }
  case'techPanel':{
    ctx.fillStyle='#0a0a28';ctx.fillRect(sx-d.w/2,d.y,d.w,d.h);ctx.strokeStyle='#2233aa';ctx.lineWidth=1.5;ctx.strokeRect(sx-d.w/2,d.y,d.w,d.h);
    for(let i=0;i<d.lights;i++){const on=Math.floor(tick*.05+d.x*.01+i*1.7)%5>1;const lc=['#0ff','#f0f','#ff0','#0f0','#f44'][i%5];ctx.fillStyle=on?lc:'#111';ctx.shadowColor=lc;ctx.shadowBlur=on?8:0;ctx.beginPath();ctx.arc(sx-d.w/2+7+i*(d.w-8)/d.lights,d.y+d.h/2,3.5,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;}
    break;
  }
  // ═══ PRISM ANOMALY ═══════════════════════════
  // All five are built from the same idea — white light entering something and
  // leaving as a spectrum — so the world reads as one place rather than a
  // recoloured tour of the other ten.
  case'prismHalo':{
    // A slowly turning refraction ring
    const a=tick*0.004+d.phase;
    ctx.save();ctx.translate(sx,d.y+Math.sin(d.phase+tick*.012)*10);ctx.rotate(a);
    ctx.lineWidth=3;
    for(let k=0;k<6;k++){
      ctx.strokeStyle=`hsla(${(d.hue+k*60)%360},95%,62%,0.30)`;
      ctx.beginPath();ctx.arc(0,0,d.r-k*1.6,k*1.0,k*1.0+1.5);ctx.stroke();
    }
    ctx.restore();break;
  }
  case'prismSpire':{
    // A prism hanging point-down from the top of the frame, throwing a fan
    const g=ctx.createLinearGradient(sx-d.w/2,0,sx+d.w/2,d.h);
    g.addColorStop(0,`hsla(${d.hue},90%,70%,0.55)`);
    g.addColorStop(1,`hsla(${(d.hue+90)%360},90%,55%,0.18)`);
    ctx.fillStyle=g;
    ctx.beginPath();ctx.moveTo(sx-d.w/2,0);ctx.lineTo(sx+d.w/2,0);ctx.lineTo(sx,d.h);ctx.closePath();ctx.fill();
    ctx.strokeStyle=`hsla(${d.hue},100%,85%,0.45)`;ctx.lineWidth=1;ctx.stroke();
    // the light it sheds
    const fg=ctx.createLinearGradient(sx,d.h,sx,d.h+70);
    fg.addColorStop(0,`hsla(${(d.hue+40)%360},95%,65%,0.20)`);
    fg.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=fg;
    ctx.beginPath();ctx.moveTo(sx,d.h);ctx.lineTo(sx+18,d.h+70);ctx.lineTo(sx-18,d.h+70);ctx.closePath();ctx.fill();
    break;
  }
  case'prismCrystal':{
    // Faceted crystal growing out of the ground, spectrum trapped inside
    const g=ctx.createLinearGradient(sx,GY-d.h,sx,GY);
    for(let k=0;k<=3;k++)g.addColorStop(k/3,`hsla(${(d.hue+k*45)%360},90%,${58-k*10}%,0.85)`);
    ctx.fillStyle=g;
    ctx.beginPath();
    ctx.moveTo(sx-d.w/2,GY);
    ctx.lineTo(sx-d.w*0.32,GY-d.h*0.72);
    ctx.lineTo(sx,GY-d.h);
    ctx.lineTo(sx+d.w*0.32,GY-d.h*0.66);
    ctx.lineTo(sx+d.w/2,GY);
    ctx.closePath();ctx.fill();
    ctx.strokeStyle=`hsla(${(d.hue+180)%360},100%,82%,0.6)`;ctx.lineWidth=1;ctx.stroke();
    ctx.strokeStyle=`hsla(${d.hue},100%,90%,0.35)`;
    ctx.beginPath();ctx.moveTo(sx,GY-d.h);ctx.lineTo(sx,GY);ctx.stroke();
    break;
  }
  case'prismPane':{
    // A drifting shard of broken glass catching the light
    const a=tick*d.spd+d.phase;
    ctx.save();ctx.translate(sx,d.y+Math.sin(d.phase+tick*.02)*16);ctx.rotate(a);
    const g=ctx.createLinearGradient(-d.r,-d.r,d.r,d.r);
    g.addColorStop(0,`hsla(${d.hue},95%,72%,0.55)`);
    g.addColorStop(1,`hsla(${(d.hue+120)%360},95%,60%,0.20)`);
    ctx.fillStyle=g;
    ctx.beginPath();ctx.moveTo(-d.r,-d.r*0.35);ctx.lineTo(d.r*0.6,-d.r*0.75);ctx.lineTo(d.r,d.r*0.35);ctx.lineTo(-d.r*0.6,d.r*0.75);ctx.closePath();ctx.fill();
    ctx.strokeStyle=`hsla(${(d.hue+60)%360},100%,88%,0.5)`;ctx.lineWidth=1;ctx.stroke();
    ctx.restore();break;
  }
  case'prismBeam':{
    // A vertical spectrum leaking up out of a crack in the ground
    const pulse=0.55+Math.sin(tick*0.03+d.phase)*0.45;
    const g=ctx.createLinearGradient(sx,GY,sx,GY-d.h);
    for(let k=0;k<=4;k++)g.addColorStop(k/4,`hsla(${(d.hue+k*70)%360},95%,62%,${(0.30-k*0.06)*pulse})`);
    ctx.fillStyle=g;
    ctx.beginPath();
    ctx.moveTo(sx-d.w/2,GY);ctx.lineTo(sx+d.w/2,GY);
    ctx.lineTo(sx+d.w*1.6,GY-d.h);ctx.lineTo(sx-d.w*1.6,GY-d.h);
    ctx.closePath();ctx.fill();
    ctx.fillStyle=`hsla(${d.hue},100%,85%,${0.5*pulse})`;
    ctx.fillRect(sx-d.w/2,GY-3,d.w,3);
    break;
  }
  case'prismPylon':{
    // A corrupted data-pillar with spectral bands scrolling through it
    ctx.fillStyle='#0a0616';ctx.fillRect(sx-d.w/2,d.y,d.w,d.h);
    ctx.strokeStyle=`hsla(${d.hue},95%,70%,0.55)`;ctx.lineWidth=1;
    ctx.strokeRect(sx-d.w/2,d.y,d.w,d.h);
    const bands=Math.max(3,Math.floor(d.h/16));
    for(let k=0;k<bands;k++){
      const by=d.y+((k*16+tick*0.6)%(d.h-6));
      ctx.fillStyle=`hsla(${(d.hue+k*40+tick)%360},95%,62%,0.55)`;
      ctx.fillRect(sx-d.w/2+2,by,d.w-4,4);
    }
    break;
  }
  case'debris':{
    const ang=tick*d.spd+d.phase;ctx.save();ctx.translate(sx,d.y+Math.sin(d.phase+tick*.025)*20);ctx.rotate(ang);ctx.fillStyle='#1a1a30';ctx.strokeStyle='#3a3a50';ctx.lineWidth=1;ctx.beginPath();for(let i=0;i<6;i++){const a=i*Math.PI/3,r=d.r*(0.6+Math.sin(i*2.1)*.4);if(i===0)ctx.moveTo(r*Math.cos(a),r*Math.sin(a));else ctx.lineTo(r*Math.cos(a),r*Math.sin(a));}ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();break;
  }
  case'conduit':{
    ctx.fillStyle=d.col;ctx.fillRect(sx,d.y+8,d.w,8);ctx.strokeStyle='#3a3a6a';ctx.lineWidth=1;ctx.strokeRect(sx,d.y+8,d.w,8);
    ctx.fillStyle='#4a4a7a';for(let rx=sx+8;rx<sx+d.w-4;rx+=18){ctx.beginPath();ctx.arc(rx,d.y+12,2.5,0,Math.PI*2);ctx.fill();}break;
  }
  case'toxFarPipe':{
    ctx.fillStyle=d.col;ctx.fillRect(sx,d.y+4,d.w,8);ctx.strokeStyle='#445500';ctx.lineWidth=1;ctx.strokeRect(sx,d.y+4,d.w,8);break;
  }

  // ═══ DARK FOREST ══════════════════════════════
  case'deadTree':{
    ctx.strokeStyle=d.col;ctx.lineWidth=d.tw;ctx.beginPath();ctx.moveTo(sx,GY);ctx.lineTo(sx,d.y);ctx.stroke();
    for(let i=0;i<d.branches;i++){const by=d.y+d.h*(0.15+i*.25),side=i%2===0?1:-1,blen=28+i*10;ctx.lineWidth=Math.max(1,d.tw-(i+1)*1.5);ctx.beginPath();ctx.moveTo(sx,by);ctx.quadraticCurveTo(sx+side*blen*.5,by-16,sx+side*blen,by-10);ctx.stroke();ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(sx+side*blen*.6,by-12);ctx.lineTo(sx+side*blen*.6+side*14,by-22);ctx.stroke();}
    break;
  }
  case'mushroom':{
    ctx.fillStyle=d.stem;ctx.fillRect(sx-4,GY-d.r-10,8,d.r+10);
    ctx.shadowColor=d.col;ctx.shadowBlur=(useBlur?16:0);ctx.fillStyle=d.col;
    ctx.beginPath();ctx.arc(sx,GY-d.r-10,d.r,Math.PI,Math.PI*2);ctx.closePath();ctx.fill();
    ctx.fillStyle='#fff';ctx.globalAlpha*=0.45;ctx.beginPath();ctx.arc(sx-d.r*.4,GY-d.r-10-d.r*.35,d.r*.28,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(sx+d.r*.3,GY-d.r-10-d.r*.55,d.r*.18,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha=(layerIdx?0.80:0.48);ctx.shadowBlur=0;break;
  }
  case'wisp':{
    const wx2=sx+Math.sin(tick*.028+d.phase)*32,wy2=d.y+Math.cos(tick*.021+d.phase)*20;
    ctx.shadowColor=d.col;ctx.shadowBlur=(useBlur?22:0);ctx.globalAlpha*=(0.6+Math.sin(tick*.07+d.phase)*.25);
    ctx.fillStyle=d.col;ctx.beginPath();ctx.arc(wx2,wy2,d.r,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#fff';ctx.globalAlpha*=0.35;ctx.beginPath();ctx.arc(wx2-d.r*.3,wy2-d.r*.3,d.r*.35,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha=(layerIdx?0.80:0.48);ctx.shadowBlur=0;break;
  }
  case'stump':{
    ctx.fillStyle=d.col;ctx.beginPath();ctx.ellipse(sx,GY-5,d.w/2,5,0,0,Math.PI*2);ctx.fill();ctx.fillRect(sx-d.w/2+3,GY-17,d.w-6,14);ctx.strokeStyle='#2a1a10';ctx.lineWidth=1;ctx.beginPath();ctx.ellipse(sx,GY-17,d.w/2-4,3,0,0,Math.PI*2);ctx.stroke();break;
  }
  case'spiderWeb':{
    ctx.strokeStyle='#555566';ctx.lineWidth=.8;ctx.globalAlpha*=0.45;
    for(let i=0;i<8;i++){const a=i*Math.PI/4;ctx.beginPath();ctx.moveTo(sx,d.y);ctx.lineTo(sx+Math.cos(a)*d.r,d.y+Math.sin(a)*d.r);ctx.stroke();}
    for(let r2=d.r/3;r2<=d.r;r2+=d.r/3){ctx.beginPath();ctx.arc(sx,d.y,r2,0,Math.PI*2);ctx.stroke();}
    ctx.globalAlpha=(layerIdx?0.80:0.48);break;
  }

  // ═══ TOXIC ZONE ═══════════════════════════════
  case'barrel':{
    const bx=sx-d.w/2,by=d.tipped?GY-d.w/2:GY-d.h;
    ctx.save();if(d.tipped){ctx.translate(sx,GY-d.w/2+2);ctx.rotate(.5);ctx.translate(-sx,-(GY-d.w/2+2));}
    ctx.fillStyle=d.col;ctx.fillRect(bx,by,d.w,d.h);ctx.strokeStyle=d.stripe;ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(bx,by+5);ctx.lineTo(bx+d.w,by+5);ctx.stroke();ctx.beginPath();ctx.moveTo(bx,by+d.h-5);ctx.lineTo(bx+d.w,by+d.h-5);ctx.stroke();
    if(d.warn){ctx.fillStyle=d.stripe;ctx.font='8px monospace';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('☣',sx,by+d.h/2);}
    ctx.fillStyle='#88cc00';ctx.globalAlpha*=0.6;ctx.beginPath();ctx.ellipse(sx+2,by+d.h-1,3,4,0,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha=(layerIdx?0.80:0.48);ctx.restore();break;
  }
  case'toxicPuddle':{
    ctx.fillStyle=d.col;ctx.globalAlpha*=(0.45+Math.sin(tick*.06+d.phase)*.06);
    ctx.beginPath();ctx.ellipse(sx,GY-4,d.w/2,9,0,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha=(layerIdx?0.80:0.48);break;
  }
  case'gasVent':{
    ctx.fillStyle='#1a2200';ctx.fillRect(sx-6,GY-12,12,12);ctx.strokeStyle='#334400';ctx.lineWidth=1.5;ctx.strokeRect(sx-6,GY-12,12,12);
    for(let i=0;i<4;i++){const gy2=GY-20-i*16,gx2=sx+Math.sin(tick*.06+d.phase+i*.8)*9;ctx.fillStyle='#88cc00';ctx.globalAlpha*=(0.2-i*.04)*Math.abs(Math.sin(tick*.06+d.phase+i))*.5+.08;ctx.beginPath();ctx.arc(gx2,gy2,9+i*3,0,Math.PI*2);ctx.fill();}
    ctx.globalAlpha=(layerIdx?0.80:0.48);break;
  }
  case'toxicTree':{
    ctx.fillStyle=d.col;ctx.fillRect(sx-d.tw/2,d.y,d.tw,d.h);
    ctx.shadowColor=d.drip;ctx.shadowBlur=(useBlur?8:0);ctx.strokeStyle=d.drip;ctx.lineWidth=2;
    for(let di=0;di<3;di++){const dx2=sx-d.tw/2+di*(d.tw/2)+2,dy2=d.y+d.h*.3+di*d.h*.2;const dl=12+di*6+Math.sin(tick*.08+di)*5;ctx.beginPath();ctx.moveTo(dx2,dy2);ctx.lineTo(dx2-1,dy2+dl);ctx.stroke();ctx.fillStyle=d.drip;ctx.beginPath();ctx.arc(dx2-1,dy2+dl,3,0,Math.PI*2);ctx.fill();}
    ctx.shadowBlur=0;break;
  }
  case'toxPipe':{
    ctx.fillStyle=d.col;ctx.fillRect(sx,d.y,d.w,10);ctx.strokeStyle='#445500';ctx.lineWidth=1;ctx.strokeRect(sx,d.y,d.w,10);
    ctx.fillStyle='#556600';for(let jx=sx+20;jx<sx+d.w-10;jx+=30){ctx.fillRect(jx,d.y-2,8,14);}break;
  }

  // ═══ STORM PEAKS ══════════════════════════════
  case'mountain':{
    ctx.fillStyle=d.col;ctx.beginPath();ctx.moveTo(sx-d.w/2,GY);ctx.lineTo(sx,d.y);ctx.lineTo(sx+d.w/2,GY);ctx.closePath();ctx.fill();
    ctx.beginPath();ctx.moveTo(sx-d.w*.1,GY);ctx.lineTo(sx+d.w*.3,d.y+d.h*.35);ctx.lineTo(sx+d.w*.65,GY);ctx.closePath();ctx.fill();
    if(d.snow){ctx.fillStyle='#ddeeff';ctx.globalAlpha*=0.65;ctx.beginPath();ctx.moveTo(sx-d.w*.13,d.y+d.h*.23);ctx.lineTo(sx,d.y);ctx.lineTo(sx+d.w*.13,d.y+d.h*.23);ctx.closePath();ctx.fill();ctx.globalAlpha=(layerIdx?0.80:0.48);}
    break;
  }
  case'stormCloud':{
    const cx2=sx+Math.sin(tick*d.spd*.02+d.phase)*18;
    ctx.fillStyle=d.col;ctx.globalAlpha*=(0.55+Math.sin(tick*.03+d.phase)*.08);
    for(let i=0;i<5;i++){ctx.beginPath();ctx.arc(cx2+i*d.w/4-d.w/2,d.y+d.h/2+Math.sin(i)*d.h*.2,d.h*.75,0,Math.PI*2);ctx.fill();}
    ctx.globalAlpha=(layerIdx?0.80:0.48);break;
  }
  case'scorchMark':{
    ctx.globalAlpha*=0.5;ctx.fillStyle=d.col;ctx.beginPath();ctx.ellipse(sx,GY-2,d.w/2,6,0,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#0a0a18';ctx.lineWidth=1;for(let i=0;i<6;i++){const a=i*Math.PI/3;ctx.beginPath();ctx.moveTo(sx+Math.cos(a)*4,GY-3+Math.sin(a)*2);ctx.lineTo(sx+Math.cos(a)*(d.w/2-2),GY-3+Math.sin(a)*4);ctx.stroke();}
    ctx.globalAlpha=(layerIdx?0.80:0.48);break;
  }
  case'sharpRock':{
    ctx.fillStyle=d.col;ctx.beginPath();ctx.moveTo(sx-d.w/2,GY);ctx.lineTo(sx,GY-d.h);ctx.lineTo(sx+d.w/2,GY);ctx.closePath();ctx.fill();ctx.strokeStyle='#2a2a3a';ctx.lineWidth=1;ctx.stroke();
    ctx.fillStyle='#3a3a4a';ctx.globalAlpha*=0.4;ctx.beginPath();ctx.moveTo(sx,GY-d.h);ctx.lineTo(sx+3,GY-d.h*.6);ctx.lineTo(sx-2,GY-d.h*.4);ctx.closePath();ctx.fill();ctx.globalAlpha=(layerIdx?0.80:0.48);break;
  }
  case'lightning':{
    // Every flash used to start at exactly this decor's x and follow a zigzag
    // seeded only by `tick`, so the bolt visibly hit the SAME spot forever.
    // Each strike now gets its own index, and that index drives both where it
    // lands and how it forks — so no two strikes look or land alike.
    const phase=tick%d.interval;
    if(phase<5){
      const strike=Math.floor(tick/d.interval)+(d.phase|0);
      const jitter=(_sceneryRnd(strike,1)-0.5)*d.interval*2.2; // wander along the band
      const seed=_sceneryRnd(strike,2)*100;
      const reach=GY*(0.62+_sceneryRnd(strike,3)*0.38);        // some bolts stop in the clouds
      const bx=sx+jitter;
      ctx.strokeStyle='#aaaaff';ctx.lineWidth=2;ctx.shadowColor='#8888ff';ctx.shadowBlur=(useBlur?24:0);
      ctx.globalAlpha*=0.9*(1-phase/6);
      ctx.beginPath();
      let ly=0,lx=bx,forkAt=null;
      ctx.moveTo(lx,ly);
      while(ly<reach){
        ly+=14;lx+=Math.sin(seed+ly*0.21)*(18+Math.sin(ly*.1)*8);
        ctx.lineTo(lx,ly);
        if(forkAt===null&&ly>reach*0.45)forkAt=[lx,ly];
      }
      ctx.stroke();
      if(forkAt){
        ctx.lineWidth=1;ctx.globalAlpha*=0.45;
        const dir=_sceneryRnd(strike,4)>0.5?1:-1;
        ctx.beginPath();ctx.moveTo(forkAt[0],forkAt[1]);
        ctx.lineTo(forkAt[0]+26*dir,forkAt[1]+26);
        ctx.lineTo(forkAt[0]+16*dir,forkAt[1]+54);
        ctx.stroke();
      }
      ctx.shadowBlur=0;ctx.globalAlpha=(layerIdx?0.80:0.48);
    }break;
  }
  case'darkSmoke':{
    ctx.fillStyle='#0a0808';ctx.globalAlpha*=0.3+Math.sin(tick*.03+d.x*.01)*.1;
    for(let i=0;i<3;i++){ctx.beginPath();ctx.arc(sx+i*d.w*.3-d.w*.3,d.y+i*8+Math.sin(tick*.04+i)*6,d.w*.25,0,Math.PI*2);ctx.fill();}
    ctx.globalAlpha=(layerIdx?0.80:0.48);break;
  }

  // ═══ FINAL FORTRESS ═══════════════════════════
  case'battlement':{
    ctx.fillStyle=d.col;const bw=d.w/d.merlons;ctx.fillRect(sx-d.w/2,d.y+22,d.w,d.h-22);
    for(let m=0;m<d.merlons;m++){ctx.fillRect(sx-d.w/2+m*bw*2,d.y,bw,22);}
    ctx.strokeStyle='#2a1010';ctx.lineWidth=1.5;ctx.strokeRect(sx-d.w/2+.5,d.y+.5,d.w-1,d.h-1);break;
  }
  case'skullPile':{
    for(let i=0;i<d.count;i++){
      const ox=(i-d.count/2)*14,oy=i%2===0?0:-7;
      ctx.fillStyle=d.col;ctx.globalAlpha*=0.6;
      ctx.beginPath();ctx.arc(sx+ox,GY-13+oy,7,0,Math.PI*2);ctx.fill();ctx.fillRect(sx+ox-5,GY-8+oy,10,6);
      ctx.fillStyle='#000';ctx.globalAlpha*=0.8;ctx.beginPath();ctx.arc(sx+ox-2.5,GY-14+oy,2,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(sx+ox+2.5,GY-14+oy,2,0,Math.PI*2);ctx.fill();
      ctx.globalAlpha=(layerIdx?0.80:0.48);
    }break;
  }
  case'chain':{
    ctx.strokeStyle=d.col;ctx.lineWidth=3;ctx.setLineDash([6,4]);ctx.beginPath();ctx.moveTo(sx,d.y);ctx.lineTo(sx,d.y+d.len);ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle='#3a1a1a';ctx.strokeStyle=d.col;ctx.lineWidth=2;ctx.beginPath();ctx.arc(sx,d.y+d.len,8,0,Math.PI*2);ctx.fill();ctx.stroke();break;
  }
  case'torch':{
    ctx.fillStyle='#2a1008';ctx.fillRect(sx-3,d.y,6,13);ctx.strokeStyle='#4a2010';ctx.lineWidth=1;ctx.strokeRect(sx-3,d.y,6,13);
    const fl=Math.sin(tick*.15+d.phase);
    ctx.shadowColor=d.col;ctx.shadowBlur=20+fl*8;
    ctx.fillStyle='#ff4400';ctx.beginPath();ctx.moveTo(sx-5,d.y);ctx.quadraticCurveTo(sx+fl*5,d.y-13,sx,d.y-22);ctx.quadraticCurveTo(sx+5+fl*2,d.y-11,sx+5,d.y);ctx.closePath();ctx.fill();
    ctx.fillStyle='#ffcc00';ctx.globalAlpha*=0.8;ctx.beginPath();ctx.moveTo(sx-3,d.y);ctx.quadraticCurveTo(sx+fl*2,d.y-9,sx,d.y-15);ctx.quadraticCurveTo(sx+3,d.y-8,sx+3,d.y);ctx.closePath();ctx.fill();
    ctx.globalAlpha=(layerIdx?0.80:0.48);ctx.shadowBlur=0;break;
  }
  case'obelisk':{
    ctx.fillStyle=d.col;ctx.beginPath();ctx.moveTo(sx-d.w/2,d.y+d.h);ctx.lineTo(sx+d.w/2,d.y+d.h);ctx.lineTo(sx+d.w*.4,d.y);ctx.lineTo(sx-d.w*.4,d.y);ctx.closePath();ctx.fill();
    ctx.strokeStyle='#2a0808';ctx.lineWidth=1.5;ctx.stroke();
    ctx.shadowColor=d.glow;ctx.shadowBlur=14+Math.sin(tick*.08)*4;ctx.fillStyle=d.glow;ctx.beginPath();ctx.arc(sx,d.y+d.h*.25,5,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#000';ctx.beginPath();ctx.arc(sx,d.y+d.h*.25,2.5,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;break;
  }

  } // end switch
}

// Deterministic pseudo-random helper for decorations
function rnd01(seed){return((Math.sin(seed*127.1+311.7)*43758.5453123)%1+1)%1;}


// ════════════════════════════════════════════════
function isBossLevel(n){return n>0&&n%10===0;}

// Boss configs indexed by world (0–9)
const BOSS_CFG=[
  // 0: GUARDIAN-X  (Cyber City, lvl 10)
  // Stomp-only: bullets bounce off armour plating
  // Walks L-R, fires energy shots, stomp his head 6×
  {name:'GUARDIAN-X',hint:'STOMP THE HEAD — bullets bounce off!',
   w:64,h:72,hp:6,mhp:6,col:'#0055aa',glow:'#0af',
   weaknessType:'stomp',arenaW:520},

  // 1: VINE QUEEN  (Neon Jungle, lvl 20)
  // Bullet-only: crown of thorns = stomp hurts player
  // Hovers up/down, fires vine arcs
  {name:'VINE QUEEN',hint:'SHOOT HER — jumping on thorns hurts YOU!',
   w:58,h:64,hp:8,mhp:8,col:'#1a8030',glow:'#4f8',
   weaknessType:'bullet',arenaW:480},

  // 2: INFERNO CORE  (Lava World, lvl 30)
  // Timed window: fireproof, roars every 4s → mouth glows open for 1.5s → SHOOT
  {name:'INFERNO CORE',hint:'WAIT FOR THE ROAR — shoot inside the glowing mouth!',
   w:72,h:80,hp:7,mhp:7,col:'#882200',glow:'#f62',
   weaknessType:'window',windowDur:90,windowCD:240,arenaW:500},

  // 3: ICE PHANTOM  (Ice Caves, lvl 40)
  // Phases in/out: only solid (and stompable) every 5s for 2s. Bullets pass through ghost form.
  {name:'ICE PHANTOM',hint:'STOMP WHEN SOLID — bullets phase through ghosts!',
   w:54,h:60,hp:5,mhp:5,col:'#88ccff',glow:'#adf',
   weaknessType:'phaseStamp',solidDur:120,solidCD:300,arenaW:460},

  // 4: SAND TITAN  (Desert Ruins, lvl 50)
  // Three orbiting shield-orbs protect it. Shoot each orb to destroy it.
  // Only after all 3 shields gone → open to both bullets and stomp
  {name:'SAND TITAN',hint:'DESTROY ALL 3 SHIELD ORBS — then attack the core!',
   w:76,h:84,hp:9,mhp:9,col:'#7a5020',glow:'#e8a',
   weaknessType:'shields',arenaW:520},

  // 5: DRONE HIVE  (Space Station, lvl 60)
  // Flying boss. Armoured on top. Only vulnerable when it descends to drop bombs (underbelly exposed).
  // Must shoot while low OR stomp from above during descent
  {name:'DRONE HIVE',hint:'ATTACK DURING DESCENT — armour covers the top!',
   w:80,h:60,hp:8,mhp:8,col:'#2a1a60',glow:'#a0f',
   weaknessType:'descent',arenaW:500},

  // 6: SHADOW REAPER  (Dark Forest, lvl 70)
  // Ghost: bullets pass right through in shadow form.
  // Stomp-only damage. Periodically lunges at player.
  {name:'SHADOW REAPER',hint:'STOMP ONLY — bullets phase through shadow!',
   w:56,h:68,hp:7,mhp:7,col:'#1a0a2a',glow:'#8800ff',
   weaknessType:'stompOnly',arenaW:460},

  // 7: SLUDGE KING  (Toxic Zone, lvl 80)
  // Two-stage: stomp 3× to crack shell → shell breaks → shoot exposed core
  {name:'SLUDGE KING',hint:'STOMP 3× TO CRACK SHELL — then SHOOT the core!',
   w:80,h:80,hp:10,mhp:10,col:'#2a3a00',glow:'#cf0',
   weaknessType:'twoStage',shellHP:3,arenaW:520},

  // 8: STORM TITAN  (Storm Peaks, lvl 90)
  // Electric shield blocks all damage. Three lightning nodes (L, M, R) orbit it.
  // Shoot all 3 nodes to stun (nodes respawn after 8s). Attack during stun only.
  {name:'STORM TITAN',hint:'SHOOT ALL 3 LIGHTNING NODES to stun — then attack!',
   w:80,h:88,hp:9,mhp:9,col:'#181828',glow:'#88f',
   weaknessType:'nodes',arenaW:560},

  // 9: ARCHON  (Final Fortress, lvl 100) — Giant floating eye, 3 phases
  {name:'ARCHON',hint:'PHASE 1: SHOOT  |  PHASE 2: STOMP WHEN EYE IS LOW  |  PHASE 3: BOTH',
   w:110,h:80,hp:9,mhp:9,col:'#400010',glow:'#f44',
   weaknessType:'archon',arenaW:580},

  // 10: PRISM WRAITH (secret Prism Anomaly, lvl 110) — only reachable after
  // finding all 10 Rainbow Shards. A corrupted GRID fragment given form.
  {name:'PRISM WRAITH',hint:'SHOOT THE CORE — it has nothing left to hide behind!',
   w:70,h:78,hp:12,mhp:12,col:'#2a0840',glow:'#f0f',
   weaknessType:'bullet',arenaW:540},
];

function spawnBoss(worldId, arenaCenter){
  const cfg=BOSS_CFG[worldId];
  const bx=arenaCenter-cfg.w/2;
  const by=H-40-cfg.h;
  boss={
    ...cfg,
    worldId:worldId,
    x:bx,y:by,vx:-1.2,vy:0,
    facing:-1,alive:true,
    phase:1,flash:0,anim:0,onGnd:false,
    windowOpen:false,windowTimer:0,
    solid:true,solidTimer:0,
    orbs:[
      {angle:0,     dist:70,alive:true},
      {angle:2.094, dist:70,alive:true},
      {angle:4.189, dist:70,alive:true},
    ],
    shieldsDown:false,
    descending:false,descentTimer:0,baseY:H-40-cfg.h,
    shellHP:cfg.shellHP||0,shellBroken:false,
    nodes:[
      {angle:0,     dist:80,alive:true,flashT:0},
      {angle:2.094, dist:80,alive:true,flashT:0},
      {angle:4.189, dist:80,alive:true,flashT:0},
    ],
    stunTimer:0,
    shootCD:0,chargeCD:0,jumpCD:0,
    arenaCenter,
    pMin:arenaCenter-cfg.arenaW/2,
    pMax:arenaCenter+cfg.arenaW/2,
  };
  // No left wall — the gate pillars in the corridor serve as the left barrier
  platforms.push({x:boss.pMin,y:H-40,w:cfg.arenaW,h:40,type:'ground',solid:false,gone:false});
}

function bossShoot(bx,by,targetX,targetY){
  if(targetY===undefined)targetY=H/2;
  const dx=targetX-bx,ang=Math.atan2(targetY-by,dx);
  const spd=3.5;
  eBullets.push({x:bx,y:by,w:10,h:10,vx:Math.cos(ang)*spd,vy:Math.sin(ang)*spd,dist:0,max:600,round:true});
}

// Network guests run no boss AI (host-authoritative), but they MUST still detect
// player↔boss contact locally — otherwise touching the boss never knocks the robot
// down a stage and fire/ice/blaster are never stripped on a guest's screen.
// Mirrors the host contact logic in updateBoss(); damageBoss() is auto-redirected
// to the host on guests (see network.js), and boss_sync overwrites any local state.
function _bossPlayerContact(){
  const b=boss; if(!b||!b.alive)return;
  const p=player; if(!p)return;
  if(p.respawning)return;
  if(!aabb(p,b))return;
  const bCX=b.x+b.w/2;
  const stomped=p.vy>0.5&&p.py+p.h<=b.y+b.h*.6; // matches the .6 threshold regular enemy stomps use (hurtE/isStomp) — bosses previously used a much stricter .35, making the "was above" window far narrower than the ~17px/frame max fall speed could reliably land, which felt like passing straight through on any real jump timing
  if(stomped){
    const wt=b.weaknessType;
    if(wt==='stomp'||wt==='stompOnly'||(wt==='phaseStamp'&&b.solid)||
       (wt==='twoStage'&&!b.shellBroken)||(wt==='archon'&&b.phase===2)||(wt==='archon'&&b.phase===3)){
      b._netHitElem=null;                  // a stomp carries no elemental status
      damageBoss(1);                       // redirected to the host on guests
      p.vy=JV*.55;p.jl=Math.max(p.jl,1);
    } else if(p.inv<=0){
      p.vy=JV*.4;floatTxt(bCX,b.y,T('noEffect'),'#888');SFX.hit();
    }
  } else if(p.inv<=0){
    enemyHitPlayer();                      // strip power-up / stage-down on the guest
  }
}
function updateBoss(){
  // Network: host is authoritative for the boss AI (movement / shooting / hp);
  // guests render boss_sync snapshots. Player↔boss CONTACT is still detected on
  // guests via _bossPlayerContact() so a guest also loses fire/ice/blaster on touch.
  if(window.netActive && !window.netIsHost){
    // Keep orb/node orbits spinning locally — the host-only AI below would otherwise
    // never advance them on a guest, freezing the parts in place (both visually and
    // for hit-testing). Mirrors the host's per-frame angle steps.
    if(boss){
      if(Array.isArray(boss.orbs))for(const o of boss.orbs)o.angle+=0.03;
      if(Array.isArray(boss.nodes))for(const n of boss.nodes){n.angle+=0.025;if(n.flashT>0)n.flashT--;}
    }
    _bossPlayerContact();   // stomp / body contact (reports to host)
    _bossBulletContact();   // shots (reports to host)
    return;
  }
  if(!boss||!boss.alive)return;
  // Diagnostics for the "player passes through boss / boss doesn't attack"
  // report — prints once a second so it's cheap, but gives concrete runtime
  // values (godMode, network flags, invincibility, live contact test) instead
  // of guessing blind. Safe to remove once the cause is confirmed.
  if(window._bbDebugBoss && tick%60===0){
    const _p=nearestPlayer(boss.x+boss.w/2);
    console.log('[bossDebug]', {
      godMode, netActive:window.netActive, netIsHost:window.netIsHost,
      bossAlive:boss.alive, bossWorldId:boss.worldId, weaknessType:boss.weaknessType,
      playerInv:_p&&_p.inv, playerRespawning:_p&&_p.respawning,
      aabbOverlap: _p?aabb(_p,boss):null,
      bossPos:{x:Math.round(boss.x),y:Math.round(boss.y),w:boss.w,h:boss.h},
      playerPos:_p?{x:Math.round(_p.x),y:Math.round(_p.y),w:_p.w,h:_p.h}:null,
    });
  }
  const b=boss,p=nearestPlayer(b.x+b.w/2);
  b.anim++;
  if(b.flash>0)b.flash--;

  const bCX=b.x+b.w/2,pCX=p.x+p.w/2;
  b.facing=pCX<bCX?-1:1;

  // ── Movement ──────────────────────────────────
  // Snapshot pre-movement position so an active ice slow can dampen the frame's
  // net displacement (works across every boss movement branch below).
  const _preX=b.x,_preY=b.y;
  // Descent boss: bob up and down
  if(b.weaknessType==='descent'){
    b.descentTimer++;
    if(b.descentTimer%240<120){
      // Hovering high
      b.descending=false;
      const ty=b.baseY-120;
      b.y+=(ty-b.y)*.04;
    } else {
      // Descending low
      b.descending=true;
      const ty=b.baseY-20;
      b.y+=(ty-b.y)*.06;
    }
    // Horizontal drift
    b.x+=b.vx;
    if(b.x<b.pMin)b.vx=Math.abs(b.vx);
    if(b.x+b.w>b.pMax)b.vx=-Math.abs(b.vx);
  }
  // Phase boss: solid/ghost cycle
  else if(b.weaknessType==='phaseStamp'){
    b.solidTimer++;
    if(b.solid&&b.solidTimer>=b.solidDur){b.solid=false;b.solidTimer=0;}
    else if(!b.solid&&b.solidTimer>=b.solidCD){b.solid=true;b.solidTimer=0;}
    b.x+=b.vx;
    b.vy=Math.min(b.vy+G,MXY);
    b.y+=b.vy;
    // Land on floor
    if(b.y+b.h>=H-40){b.y=H-40-b.h;b.vy=0;b.onGnd=true;}
    if(b.x<b.pMin){b.x=b.pMin;b.vx=Math.abs(b.vx);}
    if(b.x+b.w>b.pMax){b.x=b.pMax-b.w;b.vx=-Math.abs(b.vx);}
  }
  // Window boss: roar cycle
  else if(b.weaknessType==='window'){
    b.windowTimer++;
    if(!b.windowOpen&&b.windowTimer>=b.windowCD){b.windowOpen=true;b.windowTimer=0;SFX.hit();}
    else if(b.windowOpen&&b.windowTimer>=b.windowDur){b.windowOpen=false;b.windowTimer=0;}
    b.x+=b.vx;b.vy=Math.min(b.vy+G,MXY);b.y+=b.vy;
    if(b.y+b.h>=H-40){b.y=H-40-b.h;b.vy=0;b.onGnd=true;if(Math.random()<.25)b.vy=JV*.6;}
    if(b.x<b.pMin){b.x=b.pMin;b.vx=Math.abs(b.vx);}
    if(b.x+b.w>b.pMax){b.x=b.pMax-b.w;b.vx=-Math.abs(b.vx);}
  }
  // Shield-orbs boss
  else if(b.weaknessType==='shields'){
    b.shieldsDown=b.orbs.every(o=>!o.alive);
    for(const o of b.orbs)o.angle+=0.03;
    b.x+=b.vx;b.vy=Math.min(b.vy+G,MXY);b.y+=b.vy;
    if(b.y+b.h>=H-40){b.y=H-40-b.h;b.vy=0;b.onGnd=true;}
    if(b.x<b.pMin){b.x=b.pMin;b.vx=Math.abs(b.vx);}
    if(b.x+b.w>b.pMax){b.x=b.pMax-b.w;b.vx=-Math.abs(b.vx);}
  }
  // Two-stage sludge
  else if(b.weaknessType==='twoStage'){
    b.x+=b.vx*(b.shellBroken?1.6:0.9);
    b.vy=Math.min(b.vy+G,MXY);b.y+=b.vy;
    if(b.y+b.h>=H-40){b.y=H-40-b.h;b.vy=0;b.onGnd=true;}
    if(b.x<b.pMin){b.x=b.pMin;b.vx=Math.abs(b.vx);}
    if(b.x+b.w>b.pMax){b.x=b.pMax-b.w;b.vx=-Math.abs(b.vx);}
  }
  // Nodes boss
  else if(b.weaknessType==='nodes'){
    if(b.stunTimer>0)b.stunTimer--;
    // Nodes orbit
    for(const n of b.nodes){
      n.angle+=0.025;
      if(n.flashT>0)n.flashT--;
    }
    // Re-spawn nodes if all dead
    const anyAlive=b.nodes.some(n=>n.alive);
    if(!anyAlive&&b.stunTimer<=0){
      setTimeout(()=>{if(boss===b&&b.alive)b.nodes.forEach(n=>{n.alive=true;});},8000);
      b.stunTimer=180; // 3s stun
      SFX.secret();burst(bCX,b.y+b.h/2,'#88f',20,5,6);
      floatTxt(bCX,b.y,T('stunned'),'#88f');
    }
    if(b.stunTimer<=0){
      b.x+=b.vx;b.vy=Math.min(b.vy+G,MXY);b.y+=b.vy;
    } else {b.vy=0;}
    if(b.y+b.h>=H-40){b.y=H-40-b.h;b.vy=0;b.onGnd=true;}
    if(b.x<b.pMin){b.x=b.pMin;b.vx=Math.abs(b.vx);}
    if(b.x+b.w>b.pMax){b.x=b.pMax-b.w;b.vx=-Math.abs(b.vx);}
  }
  // Archon multi-phase — floating eye
  else if(b.weaknessType==='archon'){
    const prevPhase=b.phase;
    if(b.hp>5)b.phase=1;
    else if(b.hp>2)b.phase=2;
    else b.phase=3;
    if(b.phase!==prevPhase){SFX.secret();camShake=14;burst(bCX,b.y+b.h/2,b.glow,36,6,8);
      floatTxt(bCX,b.y,T('phaseN',b.phase),b.glow);}
    // Horizontal float
    const spd=0.7+b.phase*.25;
    b.x+=b.vx*spd;
    if(b.x<b.pMin){b.x=b.pMin;b.vx=Math.abs(b.vx);}
    if(b.x+b.w>b.pMax){b.x=b.pMax-b.w;b.vx=-Math.abs(b.vx);}
    // Vertical: phase1=high, phase2=slow descent to near floor for stomp, phase3=erratic
    const floatBase=b.baseY;
    if(b.phase===1){
      const ty=floatBase-110+Math.sin(b.anim*.022)*18;
      b.y+=(ty-b.y)*.035;
    } else if(b.phase===2){
      // Descend to floor so player can stomp — nearly at ground level
      const ty=floatBase-b.h*.5+10;
      b.y+=(ty-b.y)*.022;
    } else {
      const ty=floatBase-55+Math.sin(b.anim*.038)*45+Math.cos(b.anim*.025)*22;
      b.y+=(ty-b.y)*.06;
    }
    b.y=Math.max(floatBase-H+60,Math.min(floatBase-b.h+8,b.y));
  }
  // Default: walk + gravity
  else {
    b.x+=b.vx;b.vy=Math.min(b.vy+G,MXY);b.y+=b.vy;
    if(b.y+b.h>=H-40){b.y=H-40-b.h;b.vy=0;b.onGnd=true;}
    if(b.x<b.pMin){b.x=b.pMin;b.vx=Math.abs(b.vx);}
    if(b.x+b.w>b.pMax){b.x=b.pMax-b.w;b.vx=-Math.abs(b.vx);}
  }

  // Ice slow: pull the boss halfway back toward its pre-movement position,
  // effectively halving this frame's movement while the slow is active.
  if(b._slowed){b.x=_preX+(b.x-_preX)*.5;b.y=_preY+(b.y-_preY)*.5;}

  // ── Shooting behaviour ────────────────────────
  if(b.shootCD>0)b.shootCD--;
  const dist=Math.abs(pCX-bCX);
  // Shoot range must cover the boss's own arena — several bosses (GUARDIAN-X,
  // INFERNO CORE, ICE QUEEN, NEXUS SENTINEL, ARCHON, PRISM WRAITH...) have
  // arenaW > 500, so a flat "dist<500" could silently never trigger while the
  // player stood at the far end of a wide arena. Scale it to the arena instead.
  const shootRange=Math.max(500,b.arenaW-20);
  if(b.shootCD<=0&&dist<shootRange){
    const wt=b.weaknessType;
    if(wt==='stomp'||wt==='stompOnly'){
      if(b.anim%180<3){bossShoot(bCX,b.y+b.h*.3,pCX,p.y+p.h/2);b.shootCD=130;}
    } else if(wt==='bullet'||wt==='shields'){
      if(b.anim%100<3){bossShoot(bCX,b.y+b.h*.3,pCX,p.y+p.h/2);b.shootCD=90;}
    } else if(wt==='window'){
      if(!b.windowOpen&&b.anim%80<3){bossShoot(bCX,b.y+b.h*.3,pCX,p.y+p.h/2);b.shootCD=80;}
    } else if(wt==='descent'){
      if(b.descending&&b.anim%60<3){
        // Drop bombs (straight down)
        eBullets.push({x:bCX,y:b.y+b.h,w:10,h:10,vx:0,vy:4,dist:0,max:400,round:true});
        b.shootCD=60;
      }
    } else if(wt==='twoStage'){
      if(b.shellBroken&&b.anim%90<3){bossShoot(bCX,b.y+b.h*.3,pCX,p.y+p.h/2);b.shootCD=90;}
    } else if(wt==='nodes'&&b.stunTimer<=0){
      if(b.anim%95<3){bossShoot(bCX,b.y+b.h*.3,pCX,p.y+p.h/2);b.shootCD=95;}
    } else if(wt==='archon'){
      // Phase 2 = stomp only — no shooting
      const cd=[0,80,0,45][b.phase];
      if(cd>0&&b.anim%cd<3){bossShoot(bCX,b.y+b.h*.3,pCX,p.y+p.h/2);b.shootCD=cd;}
    }
  }

  // ── Player collision ──────────────────────────
  // A stomp is an ATTACK, not something the player's post-hit invulnerability
  // should block — it previously did (both branches lived under one
  // `if(p.inv<=0)`), so a single imperfect side-touch granted 90 frames of
  // total pass-through immunity with the boss. During that window the player
  // (and the boss, which keeps walking) drift apart, and by the time
  // invulnerability wore off they'd missed the window — which is exactly what
  // "the boss is unbeatable, I just pass through it" looks like in practice.
  // Only taking damage should still respect p.inv/respawning.
  if(!p.respawning&&aabb(p,b)){
    // Stomp from above?
    const stomped=p.vy>0.5&&p.py+p.h<=b.y+b.h*.6; // matches the .6 threshold regular enemy stomps use (hurtE/isStomp) — bosses previously used a much stricter .35, making the "was above" window far narrower than the ~17px/frame max fall speed could reliably land, which felt like passing straight through on any real jump timing
    if(stomped){
      const wt=b.weaknessType;
      // bosses that CAN be stomped
      if(wt==='stomp'||wt==='stompOnly'||(wt==='phaseStamp'&&b.solid)||
         (wt==='twoStage'&&!b.shellBroken)||
         (wt==='archon'&&b.phase===2)||
         (wt==='archon'&&b.phase===3)){
        if(wt==='twoStage'&&!b.shellBroken){
          b.shellHP--;b.flash=20;SFX.stomp();
          burst(bCX,b.y,'#cf0',10,3,5);
          floatTxt(bCX,b.y,T('crackLeft',b.shellHP),'#cf0');
          if(b.shellHP<=0){b.shellBroken=true;SFX.secret();camShake=10;
            burst(bCX,b.y+b.h/2,'#cf0',24,5,6);floatTxt(bCX,b.y,T('shellBroken'),'#cf0');}
        } else {
          damageBoss(1);
        }
        p.vy=JV*.55;p.jl=Math.max(p.jl,1);
      } else if(p.inv<=0){
        // Wrong method - stomp blocked (still counts as a hit, so this part
        // does respect invulnerability)
        p.vy=JV*.4;
        floatTxt(bCX,b.y,T('noEffect'),'#888');
        SFX.hit();
      }
    } else if(!stomped&&p.inv<=0){
      enemyHitPlayer();
    }
  }

  // ── Bullet hit boss ───────────────────────────
  _bossBulletContact();
}

// Player-bullet ↔ boss collision. Split out of updateBoss() so it can ALSO run on
// a network guest: updateBoss() is host-only (guests early-return), which used to
// mean a guest's shots passed straight through the boss. damageBoss() is redirected
// to the host on guests (see network.js), and orb/node/gate state is host-synced,
// so running the same hit logic on a guest just forwards the hit correctly.
function _bossBulletContact(){
  const b=boss; if(!b||!b.alive)return;
  const _netGuest = window.netActive && !window.netIsHost;
  for(let i=pBullets.length-1;i>=0;i--){
    const bl=pBullets[i];
    const wt=b.weaknessType;
    // Check if bullet hits boss body
    if(!aabb(bl,b)){
      // Check orbs / nodes too. On a guest the part is host-authoritative: report
      // the hit by index and let the host kill it (boss_sync mirrors it straight
      // back). We still splice the local bullet for responsive feedback.
      if(wt==='shields'){
        for(let oi=0;oi<b.orbs.length;oi++){
          const o=b.orbs[oi];
          if(!o.alive)continue;
          const ox=b.x+b.w/2+Math.cos(o.angle)*o.dist-8;
          const oy=b.y+b.h/2+Math.sin(o.angle)*o.dist*.5-8;
          if(aabb(bl,{x:ox,y:oy,w:16,h:16})){
            o.alive=false;pBullets.splice(i,1);
            SFX.enemyDie();burst(ox+8,oy+8,CT.mc,10,3,5);
            floatTxt(ox,oy,T('orbDestroyed'),CT.mc);
            if(_netGuest&&window.netReportBossPart)window.netReportBossPart('orb',oi);
            break;
          }
        }
      }
      if(wt==='nodes'){
        for(let ni=0;ni<b.nodes.length;ni++){
          const nd=b.nodes[ni];
          if(!nd.alive)continue;
          const nx=b.x+b.w/2+Math.cos(nd.angle)*nd.dist-8;
          const ny=b.y+b.h/2+Math.sin(nd.angle)*nd.dist*.45-8;
          if(aabb(bl,{x:nx,y:ny,w:16,h:16})){
            nd.alive=false;pBullets.splice(i,1);nd.flashT=20;
            SFX.enemyDie();burst(nx+8,ny+8,'#88f',10,3,5);
            floatTxt(nx,ny,T('nodeHit'),'#88f');
            if(_netGuest&&window.netReportBossPart)window.netReportBossPart('node',ni);
            break;
          }
        }
      }
      continue;
    }
    pBullets.splice(i,1);
    // Can this boss take bullet damage?
    let canHit=false;
    if(wt==='bullet')canHit=true;
    else if(wt==='window')canHit=b.windowOpen;
    else if(wt==='shields')canHit=b.shieldsDown;
    else if(wt==='descent')canHit=b.descending;
    else if(wt==='twoStage')canHit=b.shellBroken;
    else if(wt==='nodes')canHit=b.stunTimer>0;
    else if(wt==='archon')canHit=(b.phase===1||b.phase===3);
    // Stomp-only bosses: no bullet damage
    else if(wt==='stomp'||wt==='stompOnly'||wt==='phaseStamp')canHit=false;
    else canHit=true;

    if(canHit){
      // Tag the element so the guest→host damage redirect forwards fire/ice; the
      // host applies the burn/slow on its authoritative boss (see network.js).
      b._netHitElem=(bl.type==='fire'||bl.type==='ice')?bl.type:null;
      damageBoss(1);
      burst(bl.x,bl.y,CT.mc,6,2.5,4);
      // Элементальные пули поджигают/замедляют босса (damageBoss мог убить босса —
      // проверяем boss перед обращением к полям)
      if(boss&&boss.alive){
        if(bl.type==='fire'){
          if(!boss._burning){boss._burning=true;boss._burnT=0;boss._burnTotal=300;}
          else boss._burnTotal=Math.max(boss._burnTotal,120);
          floatTxt(boss.x+boss.w/2,boss.y-8,T('burnTxt'),'#ff4400');
        } else if(bl.type==='ice'){
          boss._slowed=true;boss._slowT=180;
          floatTxt(boss.x+boss.w/2,boss.y-8,T('slowedTxt'),'#00ffff');
        }
      }
    } else {
      burst(bl.x,bl.y,'#888',4,2,3);
      const msg=(wt==='archon'&&b.phase===2)?T('stompOnly'):T('noEffect');
      floatTxt(bl.x,bl.y-10,msg,'#f80');
    }
  }
}

function damageBoss(dmg){
  boss.hp-=dmg;boss.flash=20;SFX.hit();
  burst(boss.x+boss.w/2,boss.y+boss.h/2,'#fff',8,3,4);
  camShake=4;
  if(boss.hp<=0)killBoss();
}

function killBoss(){
  // Добивание босса — событие, а не ещё одно попадание: показываем его
  // в замедлении, чтобы взрыв успел прочитаться.
  if(window.Juice){window.Juice.hitStop(90);window.Juice.slowmo(900,0.35);}
  const b=boss;
  b.alive=false;
  boss=null;
  SFX.clear();camShake=20;
  burst(b.x+b.w/2,b.y+b.h/2,CT.clr,40,6,7);
  burst(b.x+b.w/2,b.y+b.h/2,'#fff',20,4,5);
  floatTxt(b.x+b.w/2,b.y,T('bossDefeated'),CT.clr);
  score+=2000+(advMode?advLevel:level)*150*(hardMode?2:1);
  // Post-boss cutscene (after short delay so particles play)
  const wi=Math.min(Math.floor(((advMode?advLevel:level)-1)/10),10);
  const afterId='w'+wi+'_after';
  const _bossLvSnap=advMode?advLevel:level,_bossAdvSnap=advMode;
  setTimeout(()=>{
    // Abort if the player left/restarted this level in the meantime
    if(advMode!==_bossAdvSnap||(advMode?advLevel:level)!==_bossLvSnap||gState==='menu'||gState==='gameover')return;
    if(typeof CSCENES!=='undefined'&&CSCENES[afterId]&&!_csFired[afterId]){
      markCsFired(afterId);
      gState='paused';
      csPlay(afterId,wi,function(){
        gState='playing';startGameMusic();
        flagX=b.x+b.w/2-15;flagDone=false;
      });
    } else {
      startGameMusic();
      flagX=b.x+b.w/2-15;flagDone=false;
    }
  },1400);
}

// ── Draw Boss ──────────────────────────────────
function drawBoss(){
  if(!boss||!boss.alive)return;
  const b=boss,id=b.weaknessType;
  const bx=b.x,by=b.y;

  ctx.save();
  if(b.flash>0&&Math.floor(b.flash/3)%2===0)ctx.globalAlpha=.25;
  // Ambient body glow — used to be a whole-body ctx.shadowBlur left set across
  // every shape each of the ~10 boss draw functions below fills (big ellipses/
  // rects, unlike a player's small limbs, so this was the priciest shadowBlur
  // user in the game). A single sprite-based bloom() behind the boss gives the
  // same "boss glows" read for a flat, one-time cost; bodies now draw crisp and
  // each boss function's own small local accent blurs (eyes, cracks, etc.) are
  // untouched.
  bloom(bx+b.w/2,by+b.h/2,Math.max(b.w,b.h)*0.85,b.glow,0.5);
  ctx.shadowBlur=0;

  // ── Bodies per boss ──────────────────────────
  if(b.worldId===10){        _drawPrismWraith(b,bx,by);}
  else if(id==='stomp'){           _drawGuardian(b,bx,by);}
  else if(id==='bullet'){     _drawVineQueen(b,bx,by);}
  else if(id==='window'){     _drawInferno(b,bx,by);}
  else if(id==='phaseStamp'){ _drawIcePhantom(b,bx,by);}
  else if(id==='shields'){    _drawSandTitan(b,bx,by);}
  else if(id==='descent'){    _drawDroneHive(b,bx,by);}
  else if(id==='stompOnly'){  _drawShadowReaper(b,bx,by);}
  else if(id==='twoStage'){   _drawSludgeKing(b,bx,by);}
  else if(id==='nodes'){      _drawStormTitan(b,bx,by);}
  else if(id==='archon'){     _drawArchon(b,bx,by);}

  ctx.restore();
}

function _drawGuardian(b,bx,by){
  // Big mech robot — armour plating, glowing eye
  const f=b.facing;
  ctx.fillStyle='#003a7a';ctx.fillRect(bx,by,b.w,b.h);
  // Armour plates
  ctx.fillStyle='#0055aa';
  ctx.fillRect(bx+4,by+4,b.w-8,b.h-16);
  ctx.fillRect(bx,by+b.h*.55,b.w,b.h*.45);
  // Shoulder pads
  ctx.fillStyle='#0066cc';
  ctx.fillRect(bx-8,by+8,14,20);ctx.fillRect(bx+b.w-6,by+8,14,20);
  // Head
  ctx.fillStyle='#004488';ctx.fillRect(bx+8,by,b.w-16,20);
  // Eye — glowing red (weak spot hint)
  ctx.shadowColor='#f00';ctx.shadowBlur=3;
  ctx.fillStyle='#ff2200';
  ctx.beginPath();ctx.arc(bx+b.w/2,by+12,7,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#ff8800';ctx.beginPath();ctx.arc(bx+b.w/2-2,by+10,3,0,Math.PI*2);ctx.fill();
  ctx.shadowBlur=4;
  // Gun arm
  ctx.fillStyle='#002266';
  ctx.fillRect(bx+(f>0?b.w-2:0-14),by+b.h*.35,16,8);
  // Legs
  const lk=Math.sin(b.anim*.12)*5;
  ctx.fillStyle='#002266';
  ctx.fillRect(bx+6,by+b.h-16,18,16+lk);
  ctx.fillRect(bx+b.w-24,by+b.h-16,18,16-lk);
}
function _drawVineQueen(b,bx,by){
  const bob=Math.sin(b.anim*.06)*6;
  const y=by+bob;
  // Body
  ctx.fillStyle='#1a6028';ctx.beginPath();ctx.ellipse(bx+b.w/2,y+b.h*.6,b.w*.4,b.h*.4,0,0,Math.PI*2);ctx.fill();
  // Dress of vines
  ctx.strokeStyle='#2a8040';ctx.lineWidth=4;
  for(let i=0;i<6;i++){const a=i*Math.PI/3+b.anim*.02;ctx.beginPath();ctx.moveTo(bx+b.w/2,y+b.h*.7);ctx.lineTo(bx+b.w/2+Math.cos(a)*36,y+b.h*.7+Math.abs(Math.sin(a))*24);ctx.stroke();}
  // Head
  ctx.fillStyle='#22702a';ctx.beginPath();ctx.arc(bx+b.w/2,y+b.h*.28,b.w*.28,0,Math.PI*2);ctx.fill();
  // Crown of thorns
  ctx.strokeStyle='#88ff44';ctx.lineWidth=3;
  for(let i=0;i<8;i++){const a=i*Math.PI/4;const r=b.w*.28;ctx.beginPath();ctx.moveTo(bx+b.w/2+Math.cos(a)*r,y+b.h*.28+Math.sin(a)*r);ctx.lineTo(bx+b.w/2+Math.cos(a)*(r+14),y+b.h*.28+Math.sin(a)*(r+14));ctx.stroke();}
  // Eyes
  ctx.fillStyle='#aaff44';ctx.beginPath();ctx.arc(bx+b.w/2-7,y+b.h*.25,5,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(bx+b.w/2+7,y+b.h*.25,5,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#000';ctx.beginPath();ctx.arc(bx+b.w/2-7,y+b.h*.25,2.5,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(bx+b.w/2+7,y+b.h*.25,2.5,0,Math.PI*2);ctx.fill();
}
function _drawInferno(b,bx,by){
  const flicker=Math.sin(b.anim*.18)*.3;
  // Body — molten rock
  ctx.fillStyle='#441100';ctx.beginPath();ctx.ellipse(bx+b.w/2,by+b.h*.55,b.w*.45,b.h*.48,0,0,Math.PI*2);ctx.fill();
  // Lava cracks
  ctx.strokeStyle='#ff6600';ctx.lineWidth=2;ctx.shadowColor='#ff4400';ctx.shadowBlur=2+flicker*10;
  for(let i=0;i<5;i++){const a=i*Math.PI*.4;ctx.beginPath();ctx.moveTo(bx+b.w/2,by+b.h*.55);ctx.lineTo(bx+b.w/2+Math.cos(a)*b.w*.4,by+b.h*.55+Math.sin(a)*b.h*.4);ctx.stroke();}
  ctx.shadowBlur=4;
  // Head
  ctx.fillStyle='#551a00';ctx.beginPath();ctx.arc(bx+b.w/2,by+b.h*.22,b.w*.3,0,Math.PI*2);ctx.fill();
  // MOUTH — glowing when open
  if(b.windowOpen){
    ctx.shadowColor='#ffaa00';ctx.shadowBlur=6;
    ctx.fillStyle='#ffcc00';
    ctx.beginPath();ctx.arc(bx+b.w/2,by+b.h*.28,b.w*.22,0,Math.PI);ctx.fill();
    // Inner fire
    ctx.fillStyle='#fff';ctx.globalAlpha=0.6;
    ctx.beginPath();ctx.arc(bx+b.w/2,by+b.h*.3,b.w*.1,0,Math.PI);ctx.fill();
    ctx.globalAlpha=1;ctx.shadowBlur=4;
  } else {
    ctx.fillStyle='#220800';
    ctx.beginPath();ctx.arc(bx+b.w/2,by+b.h*.3,b.w*.14,.1,Math.PI-.1);ctx.fill();
  }
  // Eyes
  ctx.shadowColor='#ff4400';ctx.shadowBlur=2;ctx.fillStyle='#ff4400';
  ctx.beginPath();ctx.arc(bx+b.w/2-9,by+b.h*.18,5,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(bx+b.w/2+9,by+b.h*.18,5,0,Math.PI*2);ctx.fill();
  ctx.shadowBlur=4;
}
function _drawIcePhantom(b,bx,by){
  const alpha=b.solid?0.9:0.25+Math.sin(b.anim*.1)*.15;
  ctx.globalAlpha=alpha;
  // Ghostly body
  ctx.fillStyle='#aaddff';ctx.beginPath();ctx.arc(bx+b.w/2,by+b.h*.4,b.w*.4,0,Math.PI*2);ctx.fill();
  // Tail/wisp bottom
  ctx.beginPath();ctx.moveTo(bx+b.w*.2,by+b.h*.6);ctx.quadraticCurveTo(bx+b.w*.1,by+b.h*.9,bx+b.w*.3,by+b.h);ctx.quadraticCurveTo(bx+b.w*.5,by+b.h*.75,bx+b.w*.5,by+b.h*.6);ctx.fill();
  ctx.beginPath();ctx.moveTo(bx+b.w*.8,by+b.h*.6);ctx.quadraticCurveTo(bx+b.w*.9,by+b.h*.9,bx+b.w*.7,by+b.h);ctx.quadraticCurveTo(bx+b.w*.5,by+b.h*.75,bx+b.w*.5,by+b.h*.6);ctx.fill();
  // Face
  ctx.fillStyle='#002244';ctx.beginPath();ctx.arc(bx+b.w/2-9,by+b.h*.35,5,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(bx+b.w/2+9,by+b.h*.35,5,0,Math.PI*2);ctx.fill();
  // Crown of ice
  ctx.strokeStyle='#ffffff';ctx.lineWidth=3;
  for(let i=0;i<5;i++){const a=(i-2)*0.35;ctx.beginPath();ctx.moveTo(bx+b.w/2+Math.sin(a)*16,by+b.h*.05);ctx.lineTo(bx+b.w/2+Math.sin(a)*16,by+b.h*.05-14-Math.abs(a)*8);ctx.stroke();}
  ctx.globalAlpha=1;
}
function _drawSandTitan(b,bx,by){
  // Huge stone golem
  ctx.fillStyle='#5a4010';ctx.fillRect(bx+4,by,b.w-8,b.h);
  ctx.fillStyle='#7a5a20';ctx.fillRect(bx+8,by+4,b.w-16,b.h-20);
  // Shoulder slabs
  ctx.fillStyle='#6a4a14';ctx.fillRect(bx-10,by+10,18,28);ctx.fillRect(bx+b.w-8,by+10,18,28);
  // Head
  ctx.fillStyle='#5a3a08';ctx.fillRect(bx+8,by-2,b.w-16,26);
  // Glowing eyes
  ctx.shadowColor='#ffcc00';ctx.shadowBlur=2;ctx.fillStyle='#ffaa00';
  ctx.beginPath();ctx.arc(bx+b.w/2-10,by+10,6,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(bx+b.w/2+10,by+10,6,0,Math.PI*2);ctx.fill();
  ctx.shadowBlur=4;
  // Orbiting shield orbs
  for(const o of b.orbs){
    if(!o.alive)continue;
    const ox=bx+b.w/2+Math.cos(o.angle)*o.dist;
    const oy=by+b.h/2+Math.sin(o.angle)*o.dist*.45;
    ctx.shadowColor='#e8a';ctx.shadowBlur=3;
    ctx.fillStyle='#ffbb66';ctx.beginPath();ctx.arc(ox,oy,10,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#fff8';ctx.beginPath();ctx.arc(ox-3,oy-3,4,0,Math.PI*2);ctx.fill();
    // Orbit trail
    ctx.strokeStyle='#e8a';ctx.lineWidth=1.5;ctx.globalAlpha=.3;
    ctx.beginPath();ctx.arc(bx+b.w/2,by+b.h/2,o.dist,.0,Math.PI*2);ctx.stroke();
    ctx.globalAlpha=1;ctx.shadowBlur=4;
  }
}
function _drawDroneHive(b,bx,by){
  const y=by;
  // Armoured top hull
  ctx.fillStyle='#1a0a40';ctx.beginPath();ctx.ellipse(bx+b.w/2,y+b.h*.35,b.w*.48,b.h*.38,0,0,Math.PI*2);ctx.fill();
  // Armour plates on top
  ctx.fillStyle='#2a1260';
  ctx.beginPath();ctx.ellipse(bx+b.w/2,y+b.h*.25,b.w*.42,b.h*.22,0,Math.PI,Math.PI*2);ctx.fill();
  // Underbelly — exposed core when descending
  if(b.descending){
    ctx.shadowColor='#f0f';ctx.shadowBlur=4;
    ctx.fillStyle='#cc00cc';
    ctx.beginPath();ctx.ellipse(bx+b.w/2,y+b.h*.55,b.w*.35,b.h*.22,0,0,Math.PI);ctx.fill();
    ctx.fillStyle='#ff88ff';ctx.beginPath();ctx.arc(bx+b.w/2,y+b.h*.6,12,0,Math.PI*2);ctx.fill();
    ctx.shadowBlur=4;
  } else {
    ctx.fillStyle='#110830';ctx.beginPath();ctx.ellipse(bx+b.w/2,y+b.h*.55,b.w*.3,b.h*.18,0,0,Math.PI);ctx.fill();
  }
  // Rotors
  ctx.save();ctx.translate(bx+b.w/2,y+b.h*.3);ctx.rotate(b.anim*.18);
  ctx.strokeStyle='#5533aa';ctx.lineWidth=3;
  for(let i=0;i<4;i++){ctx.save();ctx.rotate(i*Math.PI/2);ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(b.w*.45,0);ctx.stroke();ctx.restore();}
  ctx.restore();
  // Eyes
  ctx.shadowColor='#a0f';ctx.shadowBlur=2;ctx.fillStyle='#cc44ff';
  ctx.beginPath();ctx.arc(bx+b.w/2-12,y+b.h*.3,5,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(bx+b.w/2+12,y+b.h*.3,5,0,Math.PI*2);ctx.fill();ctx.shadowBlur=4;
}
function _drawShadowReaper(b,bx,by){
  // Dark ethereal figure — floats
  const bob=Math.sin(b.anim*.07)*5;
  const y=by+bob;
  ctx.shadowColor='#8800ff';ctx.shadowBlur=6;
  // Cloak body
  ctx.fillStyle='#0d0018';ctx.beginPath();ctx.moveTo(bx+b.w*.2,y);ctx.quadraticCurveTo(bx,y+b.h*.5,bx+b.w*.1,y+b.h);ctx.lineTo(bx+b.w*.9,y+b.h);ctx.quadraticCurveTo(bx+b.w,y+b.h*.5,bx+b.w*.8,y);ctx.closePath();ctx.fill();
  ctx.strokeStyle='#6600cc';ctx.lineWidth=2;ctx.stroke();
  // Hood
  ctx.fillStyle='#0a0014';ctx.beginPath();ctx.arc(bx+b.w/2,y+b.h*.2,b.w*.3,0,Math.PI*2);ctx.fill();
  // Glowing hollow eyes
  ctx.fillStyle='#cc00ff';ctx.shadowBlur=3;
  ctx.beginPath();ctx.arc(bx+b.w/2-8,y+b.h*.16,6,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(bx+b.w/2+8,y+b.h*.16,6,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#000';ctx.beginPath();ctx.arc(bx+b.w/2-8,y+b.h*.16,3,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(bx+b.w/2+8,y+b.h*.16,3,0,Math.PI*2);ctx.fill();
  // Scythe
  const f=b.facing;ctx.strokeStyle='#8822cc';ctx.lineWidth=3;
  ctx.beginPath();ctx.moveTo(bx+b.w/2+f*8,y+b.h*.3);ctx.lineTo(bx+b.w/2+f*40,y+b.h*.1);ctx.stroke();
  ctx.beginPath();ctx.arc(bx+b.w/2+f*40,y+b.h*.1,14,Math.PI*.3,Math.PI*1.1);ctx.stroke();
  ctx.shadowBlur=4;
}
function _drawSludgeKing(b,bx,by){
  if(!b.shellBroken){
    // Armoured shell
    ctx.fillStyle='#1a2200';ctx.beginPath();ctx.ellipse(bx+b.w/2,by+b.h*.55,b.w*.48,b.h*.5,0,0,Math.PI*2);ctx.fill();
    // Shell plates
    ctx.strokeStyle='#3a4a00';ctx.lineWidth=4;
    for(let i=0;i<6;i++){const a=i*Math.PI/3+.3;ctx.beginPath();ctx.moveTo(bx+b.w/2,by+b.h*.55);ctx.lineTo(bx+b.w/2+Math.cos(a)*b.w*.48,by+b.h*.55+Math.sin(a)*b.h*.5);ctx.stroke();}
    ctx.strokeStyle='#556600';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(bx+b.w/2,by+b.h*.55,b.w*.48,b.h*.5,0,0,Math.PI*2);ctx.stroke();
    // Shell head
    ctx.fillStyle='#223300';ctx.beginPath();ctx.arc(bx+b.w/2,by+b.h*.2,b.w*.28,0,Math.PI*2);ctx.fill();
    // Shell cracks (based on damage)
    if(b.shellHP<3){
      ctx.strokeStyle='#88aa00';ctx.lineWidth=2;ctx.shadowColor='#cf0';ctx.shadowBlur=2;
      for(let ci=0;ci<(3-b.shellHP);ci++){ctx.beginPath();ctx.moveTo(bx+b.w*.3+ci*12,by+b.h*.4);ctx.lineTo(bx+b.w*.4+ci*8,by+b.h*.7);ctx.stroke();}ctx.shadowBlur=4;
    }
  } else {
    // Exposed gooey core
    ctx.shadowColor='#ccff00';ctx.shadowBlur=5;
    ctx.fillStyle='#334400';ctx.beginPath();ctx.ellipse(bx+b.w/2,by+b.h*.55,b.w*.44,b.h*.48,0,0,Math.PI*2);ctx.fill();
    // Dripping
    for(let di=0;di<5;di++){const dx=bx+b.w*.15+di*b.w*.17,dy=by+b.h*.7+Math.sin(b.anim*.1+di)*8;ctx.fillStyle='#88cc00';ctx.beginPath();ctx.arc(dx,dy,5+di%2*3,0,Math.PI*2);ctx.fill();}
    // Glowing exposed eye
    ctx.fillStyle='#ccff00';ctx.beginPath();ctx.arc(bx+b.w/2,by+b.h*.3,16,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#003300';ctx.beginPath();ctx.arc(bx+b.w/2,by+b.h*.3,8,0,Math.PI*2);ctx.fill();
    ctx.shadowBlur=4;
  }
}
function _drawStormTitan(b,bx,by){
  // Huge storm giant
  ctx.fillStyle='#0a0a18';ctx.fillRect(bx,by+b.h*.15,b.w,b.h*.85);
  ctx.fillStyle='#14142a';ctx.fillRect(bx+4,by+b.h*.18,b.w-8,b.h*.78);
  // Head
  ctx.fillStyle='#10101e';ctx.fillRect(bx+6,by,b.w-12,b.h*.2);
  // Shield when nodes alive
  const shielded=b.stunTimer<=0;
  if(shielded){
    ctx.globalAlpha=.35+Math.sin(b.anim*.08)*.1;
    ctx.strokeStyle='#88aaff';ctx.lineWidth=3;ctx.shadowColor='#88f';ctx.shadowBlur=4;
    ctx.beginPath();ctx.ellipse(bx+b.w/2,by+b.h/2,b.w*.62,b.h*.6,0,0,Math.PI*2);ctx.stroke();
    ctx.globalAlpha=1;ctx.shadowBlur=4;
  }
  // Lightning nodes orbiting
  for(const nd of b.nodes){
    if(!nd.alive)continue;
    const nx=bx+b.w/2+Math.cos(nd.angle)*nd.dist;
    const ny=by+b.h/2+Math.sin(nd.angle)*nd.dist*.45;
    const fl=nd.flashT>0;
    ctx.shadowColor=fl?'#fff':'#88aaff';ctx.shadowBlur=fl?24:14;
    ctx.fillStyle=fl?'#ffffff':'#6688ff';
    ctx.beginPath();ctx.arc(nx,ny,10,0,Math.PI*2);ctx.fill();
    // Spark lines
    ctx.strokeStyle='#8899ff';ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(bx+b.w/2,by+b.h/2);ctx.lineTo(nx,ny);ctx.stroke();
    ctx.shadowBlur=4;
  }
  // Stun flash effect
  if(b.stunTimer>0){
    ctx.globalAlpha=.3*Math.sin(b.stunTimer*.3);ctx.fillStyle='#8888ff';ctx.fillRect(bx,by,b.w,b.h);ctx.globalAlpha=1;
  }
  // Eyes
  ctx.shadowColor='#4466ff';ctx.shadowBlur=3;ctx.fillStyle='#4466ff';
  ctx.beginPath();ctx.arc(bx+b.w/2-12,by+b.h*.1,7,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(bx+b.w/2+12,by+b.h*.1,7,0,Math.PI*2);ctx.fill();ctx.shadowBlur=4;
}
function _drawArchon(b,bx,by){
  const ph=b.phase;
  const pecol=['#f44','#ff6600','#ff00ff'][ph-1];
  const cx=bx+b.w/2, cy=by+b.h/2;
  // Phase-scaled size
  const sc=0.88+ph*0.06;
  const rx=b.w*0.48*sc, ry=b.h*0.44*sc;

  // Outer dark aura
  const auraGrad=ctx.createRadialGradient(cx,cy,ry*.4,cx,cy,ry*1.8);
  auraGrad.addColorStop(0,'#220000cc');auraGrad.addColorStop(1,'transparent');
  ctx.fillStyle=auraGrad;ctx.fillRect(bx-b.w,by-b.h,b.w*3,b.h*3);

  // Sclera (white/dark red of the eye)
  ctx.fillStyle=ph===3?'#1a0020':'#1a0000';
  ctx.shadowColor=pecol;ctx.shadowBlur=6;
  ctx.beginPath();ctx.moveTo(cx-rx,cy);
  ctx.quadraticCurveTo(cx,cy-ry*1.1,cx+rx,cy);
  ctx.quadraticCurveTo(cx,cy+ry*1.1,cx-rx,cy);
  ctx.closePath();ctx.fill();

  // Eyelid edges
  ctx.strokeStyle=pecol;ctx.lineWidth=3;
  ctx.beginPath();ctx.moveTo(cx-rx,cy);ctx.quadraticCurveTo(cx,cy-ry*1.1,cx+rx,cy);ctx.stroke();
  ctx.beginPath();ctx.moveTo(cx-rx,cy);ctx.quadraticCurveTo(cx,cy+ry*1.1,cx+rx,cy);ctx.stroke();

  // Blood-vein network
  ctx.strokeStyle=ph===3?'#cc00ff44':'#ff000033';ctx.lineWidth=1;
  for(let vi=0;vi<10;vi++){
    const va=vi*Math.PI/5+b.anim*.005;
    ctx.beginPath();ctx.moveTo(cx+Math.cos(va)*rx*.3,cy+Math.sin(va)*ry*.3);
    ctx.lineTo(cx+Math.cos(va)*rx*.85,cy+Math.sin(va)*ry*.85);ctx.stroke();
  }

  // Iris
  const irisCol=ph===3?'#550055':ph===2?'#331100':'#330000';
  ctx.fillStyle=irisCol;ctx.shadowBlur=0;
  ctx.beginPath();ctx.arc(cx,cy,rx*.52,0,Math.PI*2);ctx.fill();

  // Iris ring detail
  ctx.strokeStyle=ph===3?'#8800aa':ph===2?'#882200':'#660000';
  ctx.lineWidth=2;
  ctx.beginPath();ctx.arc(cx,cy,rx*.5,0,Math.PI*2);ctx.stroke();
  ctx.beginPath();ctx.arc(cx,cy,rx*.35,0,Math.PI*2);ctx.stroke();

  // Pupil — tracks player
  const px2=b.facing>0?cx+rx*.08:cx-rx*.08;
  ctx.fillStyle='#000';ctx.beginPath();ctx.arc(px2,cy,rx*.22,0,Math.PI*2);ctx.fill();

  // Glowing iris core
  ctx.fillStyle=pecol;ctx.shadowColor=pecol;ctx.shadowBlur=8;
  ctx.beginPath();ctx.arc(px2,cy,rx*.14,0,Math.PI*2);ctx.fill();
  // Hot centre
  ctx.fillStyle='#fff';ctx.shadowBlur=4;
  ctx.beginPath();ctx.arc(px2-rx*.04,cy-ry*.06,rx*.05,0,Math.PI*2);ctx.fill();
  ctx.shadowBlur=4;

  // Phase 2&3: dark tendrils hanging below
  if(ph>=2){
    ctx.strokeStyle=pecol;ctx.lineWidth=2;ctx.shadowColor=pecol;ctx.shadowBlur=2;
    for(let ti=0;ti<5;ti++){
      const tx=cx-rx*.6+ti*rx*.3;
      const ty2=cy+ry*.6+Math.sin(b.anim*.05+ti)*12;
      ctx.beginPath();ctx.moveTo(tx,cy+ry*.55);ctx.quadraticCurveTo(tx+Math.sin(b.anim*.04+ti)*10,ty2+15,tx,ty2+30);ctx.stroke();
    }
  }
  // Phase 3: orbiting fire sparks
  if(ph>=3){
    for(let si=0;si<6;si++){
      const sa=si*Math.PI/3+b.anim*.08;
      const sx=cx+Math.cos(sa)*(rx+16);const sy=cy+Math.sin(sa)*(ry+12);
      ctx.fillStyle='#ff00ff';ctx.shadowColor='#f0f';ctx.shadowBlur=3;
      ctx.beginPath();ctx.arc(sx,sy,5,0,Math.PI*2);ctx.fill();
    }
  }

  // Phase indicator orbs above — centered regardless of phase count
  for(let i=0;i<ph;i++){
    ctx.fillStyle=pecol;ctx.shadowColor=pecol;ctx.shadowBlur=2;
    ctx.beginPath();ctx.arc(cx+(i-(ph-1)/2)*22,by-16,7,0,Math.PI*2);ctx.fill();
  }
  ctx.shadowBlur=4;
}

// PRISM WRAITH — secret 11th-world boss. A "glitched" humanoid silhouette made
// of shifting rainbow shards, like a corrupted render of a person GRID never
// finished deleting.
function _drawPrismWraith(b,bx,by){
  const cx=bx+b.w/2,cy=by+b.h/2;
  const hue=(tick*4)%360;

  // Outer prismatic aura
  const aura=ctx.createRadialGradient(cx,cy,b.h*0.3,cx,cy,b.h*1.1);
  aura.addColorStop(0,`hsla(${hue},100%,60%,0.35)`);aura.addColorStop(1,'transparent');
  ctx.fillStyle=aura;ctx.fillRect(bx-b.w*0.6,by-b.h*0.6,b.w*2.2,b.h*2.2);

  // Body: a tall wavering silhouette built from stacked, slightly offset
  // "glitch" bands — each band a different hue, each with its own tiny jitter.
  const bands=8;
  for(let i=0;i<bands;i++){
    const t=i/bands;
    const bw=b.w*(0.55+0.35*Math.sin(t*Math.PI));
    const bh=b.h/bands+2;
    const by2=by+i*(b.h/bands);
    const jitter=(Math.sin(b.anim*0.15+i*1.7)*4)*(b.flash>0?2.5:1);
    ctx.fillStyle=`hsla(${(hue+i*22)%360},100%,60%,0.82)`;
    ctx.fillRect(cx-bw/2+jitter,by2,bw,bh);
  }

  // Core — the actual damageable "face", a bright white-hot diamond that
  // never glitches, so the player always has a clear aim point.
  const coreY=cy-4+Math.sin(b.anim*0.06)*4;
  ctx.save();
  ctx.translate(cx,coreY);ctx.rotate(Math.PI/4+Math.sin(b.anim*0.02)*0.15);
  const cs=14+Math.sin(b.anim*0.2)*2;
  ctx.fillStyle=b.flash>0?'#fff':`hsl(${(hue+180)%360},100%,80%)`;
  ctx.shadowColor='#fff';ctx.shadowBlur=10;
  ctx.fillRect(-cs/2,-cs/2,cs,cs);
  ctx.restore();
  ctx.shadowBlur=0;

  // Fragmenting edges — a few detached shard rectangles drifting off the
  // silhouette, reinforcing the "still rendering / corrupted" read.
  for(let i=0;i<5;i++){
    const a=b.anim*0.02+i*1.3;
    const dx=Math.cos(a)*(b.w*0.7+i*6),dy=Math.sin(a*0.7)*(b.h*0.4);
    ctx.fillStyle=`hsla(${(hue+i*40)%360},100%,65%,0.55)`;
    ctx.fillRect(cx+dx-4,cy+dy-4,8,8);
  }
}

// ── Boss HUD ───────────────────────────────────
function drawBossHUD(){
  if(!boss||!boss.alive)return;
  const b=boss;
  const bw=280,bh=22,bx=W/2-bw/2,by=8;
  // Background
  ctx.fillStyle='#0a0a1a';ctx.fillRect(bx-2,by-2,bw+4,bh+4);
  ctx.strokeStyle=b.glow;ctx.lineWidth=2;ctx.shadowColor=b.glow;ctx.shadowBlur=10;ctx.strokeRect(bx-2,by-2,bw+4,bh+4);ctx.shadowBlur=0;
  // HP fill. Was one flat rectangle of solid green, which is why the bar read as
  // an unstyled placeholder: now a vertical gradient, a lighter "just lost" ghost
  // segment that lags behind real damage, and one tick per hit point so the
  // player can actually count how much of the fight is left.
  const pct=Math.max(0,b.hp/b.mhp);
  const hcol=pct>.5?'#0f8':pct>.25?'#f80':'#f44';
  b._hpGhost=(b._hpGhost==null)?pct:(b._hpGhost>pct?Math.max(pct,b._hpGhost-0.012):pct);
  if(b._hpGhost>pct){
    ctx.fillStyle='#ffffff';ctx.globalAlpha=.35;
    ctx.fillRect(bx+bw*pct,by,bw*(b._hpGhost-pct),bh);ctx.globalAlpha=1;
  }
  const hg=ctx.createLinearGradient(0,by,0,by+bh);
  hg.addColorStop(0,'#ffffff');hg.addColorStop(0.18,hcol);hg.addColorStop(1,hcol);
  ctx.fillStyle=hg;ctx.shadowColor=hcol;ctx.shadowBlur=8;ctx.fillRect(bx,by,bw*pct,bh);ctx.shadowBlur=0;
  // Per-HP tick marks (skipped when the boss has too many to stay readable).
  if(b.mhp>1&&b.mhp<=24){
    ctx.globalAlpha=.30;ctx.fillStyle='#000';
    for(let i=1;i<b.mhp;i++)ctx.fillRect(bx+bw*(i/b.mhp),by,1,bh);
    ctx.globalAlpha=1;
  }
  // Name — dark outline so it stays readable over both the filled and empty half
  ctx.font="bold 8px 'Press Start 2P',monospace";ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.lineWidth=3;ctx.strokeStyle='#0a0a1a';ctx.strokeText('⚔ '+bossName(b),W/2,by+bh/2);
  ctx.fillStyle='#fff';ctx.fillText('⚔ '+bossName(b),W/2,by+bh/2);
  // Hint below bar (translated by world index)
  ctx.fillStyle=b.glow;ctx.font="5px 'Press Start 2P',monospace";
  const _bwi=Math.min(Math.floor(((advMode?advLevel:level)-1)/10),10);
  ctx.fillText(T('bossHint'+_bwi),W/2,by+bh+9);

  // Special status indicators
  const wt=b.weaknessType;
  if(wt==='window'){
    ctx.fillStyle=b.windowOpen?'#ff8':'#888';
    ctx.fillText(b.windowOpen?T('bossMouthOpen'):T('bossWaitRoar'),W/2,by+bh+19);
  } else if(wt==='phaseStamp'){
    ctx.fillStyle=b.solid?'#0ff':'#888';ctx.fillText(b.solid?T('bossSolid'):T('bossGhost'),W/2,by+bh+19);
  } else if(wt==='shields'){
    const alive=b.orbs.filter(o=>o.alive).length;
    ctx.fillStyle=alive?'#fa0':'#0f8';ctx.fillText(alive?T('bossOrbsLeft',alive):T('bossShieldsDown'),W/2,by+bh+19);
  } else if(wt==='descent'){
    ctx.fillStyle=b.descending?'#f0f':'#888';ctx.fillText(b.descending?T('bossDescending'):T('bossHovering'),W/2,by+bh+19);
  } else if(wt==='twoStage'){
    ctx.fillStyle=b.shellBroken?'#cf0':'#fa0';ctx.fillText(b.shellBroken?T('bossShellShoot'):T('bossShellStomp',b.shellHP),W/2,by+bh+19);
  } else if(wt==='nodes'){
    const alive=b.nodes.filter(n=>n.alive).length;
    ctx.fillStyle=b.stunTimer>0?'#88f':alive?'#fa0':'#888';
    ctx.fillText(b.stunTimer>0?T('bossStunned',Math.ceil(b.stunTimer/60)):alive?T('bossShootNodes',alive):T('bossRespawn'),W/2,by+bh+19);
  } else if(wt==='archon'){
    const hints=[T('bossPhase1'),T('bossPhase2'),T('bossPhase3')];
    ctx.fillStyle=['#f44','#f80','#f0f'][b.phase-1];ctx.fillText(hints[b.phase-1],W/2,by+bh+19);
  }
}

// ════════════════════════════════════════════════
//  PLAYER
// ════════════════════════════════════════════════
function mkPlayer(px=spawnX,py=spawnY,colorScheme='blue'){
  return{x:px,y:py,w:24,h:32,vx:0,vy:0,px:px,py:py,
    onGnd:false,jl:2,facing:1,inv:0,
    // Robot stage: powered (has blaster/fire/ice) → normal → broken.
    // An enemy hit knocks the robot down one stage; a hit while broken costs a life.
    broken:false,
    blaster:false,bTimer:0,sCD:0,
    starMode:false,starTimer:0,
    boots:false,bootsTimer:0,
    animFr:0,animTk:0,trail:[],_jh:false,
    colorScheme,  // 'blue' = P1, 'red' = P2
    // respawn
    respawning:false,respawnTimer:0,
    // last ground position (for fall respawn)
    lastGndX:px,lastGndY:py,
    // active checkpoint anchor (null until one is touched)
    cpX:null,cpY:null,
    // fall respawn smooth animation
    fallRespawning:false,fallRespawnT:0,
    fallRespawnSX:px,fallRespawnSY:py};
}

// ════════════════════════════════════════════════
//  UI OVERLAYS
// ════════════════════════════════════════════════
const $main=document.getElementById('mainOv');
const $pause=document.getElementById('pauseOv');
const $mode=document.getElementById('modeOv');
const $map=document.getElementById('mapOv');
const $diff=document.getElementById('diffOv');
function hideAll(){
  [$main,$pause,$mode,$map,$diff].forEach(e=>e&&(e.style.display='none'));
  ['playTypeOv','netTypeOv','netRoomsOv'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
  // Экран уровня дня живёт своим оверлеем (assets/daily.js) — гасим и его,
  // иначе он остался бы поверх запущенного уровня.
  if(window.Daily&&typeof window.Daily.hide==='function'){try{window.Daily.hide();}catch(e){}}
  document.getElementById('ui').style.display='none';
  if(typeof hideModBanner==='function')hideModBanner();
  // The world map lives in its own overlay built by worldmap.js, so it is not in
  // the list above. Without this, any path that opens a screen while the map is
  // up leaves the map painted on top of it (the map's normal "start level"
  // button hides itself first, but nothing else did).
  if(window.WorldMap&&typeof window.WorldMap.hide==='function'){
    try{window.WorldMap.hide();}catch(e){}
  }
}

// Called by i18n.setLanguage() — re-render whichever dynamic screen is showing
// so the new language takes effect immediately (data-i18n elements are auto-handled).
window.refreshDynamicUI=function(){
  try{
    document.getElementById('hint').textContent=T('hintBar');
    if(navScr==='mode')showMode();
    else if(navScr==='diff')showDiff();
    else if(navScr==='map'){ if(typeof hardMode!=='undefined'&&hardMode){buildMapH&&buildMapH();}else{buildMap&&buildMap();} }
    // Re-apply network/lobby text in the new language (no-op if module not loaded)
    if(typeof window.netApplyLang==='function') window.netApplyLang();
    // The version tag carries the localised "DEMO" word in the demo build, and
    // it is stamped before the locales finish loading — restamp it here.
    if(window.Demo&&window.Demo.on){
      const vt=document.getElementById('verTag');
      if(vt)vt.textContent=window.Demo.tagVersion('v'+(window.BB_VERSION||'1.0.0'));
    }
  }catch(e){}
};

// ── Main-menu robot mascot ──────────────────────────────────────────────────
// A small animated Byte Blaster robot. Two moods:
//   'idle'   — bobbing, blinking, waving hello (main menu / win screen)
//   'defeat' — battered, sparking, waving a little white surrender flag (game over)
// The loop self-terminates whenever the main overlay is hidden, so it costs
// nothing during play.
let _menuBotRAF=0, _menuBotMode='idle', _menuBotSkip=false;
function setMenuBotMode(m){ _menuBotMode=m||'idle'; }

// Draw the robot body in a local 24×32 space (origin top-left, feet at y=32).
// `dmg` 0..1 dims/cracks it for the defeat pose.
function _botBody(c,t,dmg){
  const blue =dmg?'#243a55':'#003a88', blue2=dmg?'#2f5170':'#0060aa';
  const dark =dmg?'#101a2a':'#00276a', foot =dmg?'#33506e':'#0055bb';
  const glow =dmg?'#557':'#00ccee';
  // Ambient body glow via sprite-based bloom() instead of ctx.shadowBlur — see
  // _menuBotTick's comment: shadowBlur + rotate/scale, run every frame forever
  // while the menu is open, is a fragile combination on some software render
  // paths. bloom() itself no-ops cleanly if GFX.glow is 0.
  if(typeof bloom==='function')bloom(12,16,20,dmg?'#446':'#00ccff',dmg?0.35:0.55);
  // Legs / feet
  c.fillStyle=dark;c.fillRect(2,17,9,15);c.fillRect(13,17,9,15);
  c.fillStyle=foot;c.fillRect(1,29,11,5);c.fillRect(12,29,11,5);
  // Torso
  c.fillStyle=blue;c.fillRect(3,10,18,11);
  c.fillStyle=blue2;c.fillRect(5,12,14,7);
  // Head
  c.fillStyle=dmg?'#33486a':'#003e88';c.fillRect(3,0,18,16);
  // Visor + eyes (blink in idle)
  c.fillStyle=glow;c.fillRect(5,3,14,8);
  const blink=(!dmg && (t%3.4)>3.2);            // brief blink every ~3.4s
  c.fillStyle=dmg?'#7788aa':'#88ddf8';
  if(blink){ c.fillRect(6,7,5,1.6); }           // closed: thin line
  else { c.fillRect(6,4,5,4); }
  // Antenna
  c.fillStyle=dmg?'#668':'#00ccee';
  c.fillRect(11,0,2,4);c.beginPath();c.arc(12,-1,2,0,Math.PI*2);c.fill();
  if(dmg){
    // Cracks + dead right eye (X)
    c.strokeStyle='#0a1018';c.lineWidth=1;
    c.beginPath();c.moveTo(7,1);c.lineTo(10,6);c.lineTo(8,9);c.stroke();
    c.beginPath();c.moveTo(15,11);c.lineTo(12,16);c.stroke();
    c.strokeStyle='#a33';c.lineWidth=1.4;
    c.beginPath();c.moveTo(13,5);c.lineTo(17,9);c.moveTo(17,5);c.lineTo(13,9);c.stroke();
  }
}

function _menuBotTick(){
  // Heap/frame tracing for the menu idle loop. This used to run unconditionally:
  // window.__chk goes through SYNCHRONOUS IPC to the main process, which then
  // does a synchronous file append — so simply sitting on the main menu blocked
  // the renderer twice a second and grew the log file without bound. It is a
  // leak-hunting tool, so it is opt-in now: set window.__bbTraceMenu = true.
  if(window.__bbTraceMenu&&window.__chk){
    window.__menuBotFrames=(window.__menuBotFrames||0)+1;
    if(window.__menuBotFrames%30===0){
      window.__chk('_menuBotTick frame '+window.__menuBotFrames);
      try{
        if(performance.memory){
          window.__chk('  heap: '+Math.round(performance.memory.usedJSHeapSize/1048576)+'MB / '+Math.round(performance.memory.totalJSHeapSize/1048576)+'MB');
        }
      }catch(e){}
    }
  }
  // Decorative idle animation only — doesn't need full display refresh rate.
  // Running it continuously at 60fps forever (this loop never stops while the
  // main menu is open) puts sustained pressure on software/SwiftShader
  // rendering that appears to exhaust the GPU process over time on some
  // systems. Halving it to ~30fps looks just as smooth for a slow idle sway
  // and roughly halves that sustained cost.
  _menuBotSkip=!_menuBotSkip;
  if(_menuBotSkip){_menuBotRAF=requestAnimationFrame(_menuBotTick);return;}
  const cv=document.getElementById('menuBot');
  if(!cv||!$main||$main.style.display==='none'){_menuBotRAF=0;return;}
  const c=cv.getContext('2d'),w=cv.width,h=cv.height;
  c.clearRect(0,0,w,h);
  const t=performance.now()*0.001;
  const defeat=(_menuBotMode==='defeat');
  // ── Fit geometry ──────────────────────────────────────────────────────────
  // Robot is drawn in a 24×32 local space (feet at ly=32). Reserve top room for
  // whichever part reaches highest — the raised flag in defeat, the antenna in
  // idle — and lift the whole figure off the bottom so nothing is clipped and
  // the robot + its glow pad sit higher in the frame.
  const topMargin=8;
  const botGap=Math.round(h*0.17);               // empty space below the feet (raises it)
  const baseY=h-botGap;                          // feet line
  const topLocal=defeat?-27:-7;                  // highest local-y the art reaches
  const S=Math.min(w/26,(baseY-topMargin)/(32-topLocal));
  const padY=baseY+Math.round(4*S);              // glow pad just under the feet
  // Soft neon ground pad (red-tinted + weaker when defeated).
  // Uses bloom() (sprite-based glow, see boss/player) instead of native
  // ctx.shadowBlur — shadowBlur combined with rotate/scale run continuously in
  // a loop is a known-fragile combination on some software/SwiftShader
  // rendering paths (this loop runs forever while the main menu is open).
  c.save();c.globalAlpha=defeat?.3:.5;c.fillStyle=defeat?'#f55':'#0ff';
  bloom(w/2,padY,14*S,defeat?'#f55':'#0ff',defeat?0.35:0.55);
  c.beginPath();c.ellipse(w/2,padY,12*S,2.5*S,0,0,Math.PI*2);c.fill();c.restore();

  if(defeat){
    // ── DEFEAT: slumped, sparking, waving a white flag ──
    // Rising smoke puffs from around the head/shoulders
    const headY=baseY-30*S;
    c.save();
    for(let i=0;i<3;i++){
      const pp=(t*0.5+i*0.33)%1;
      c.globalAlpha=(1-pp)*0.28;c.fillStyle='#99a';
      const px=w/2-7+i*7+Math.sin(t*2+i)*3, py=headY-pp*38, pr=(2+pp*5);
      c.beginPath();c.arc(px,py,pr,0,Math.PI*2);c.fill();
    }
    // Occasional spark flicker on the shoulder
    if(Math.sin(t*9)>0.6){
      c.globalAlpha=1;c.fillStyle='#ffcf4a';
      bloom(w/2+9*S,baseY-20*S,7,'#fa0',0.7);
      c.beginPath();c.arc(w/2+9*S,baseY-20*S,1.8,0,Math.PI*2);c.fill();
    }
    c.restore();
    const slump=Math.sin(t*1.5)*0.5;             // subtle weary sway (degrees-ish)
    c.save();
    c.translate(w/2, baseY);
    c.rotate(0.12+slump*0.02);                    // permanently tilted, slight sway
    c.scale(S,S);c.translate(-12,-32);
    _botBody(c,t,1);
    // Left arm hangs limp
    c.fillStyle='#1a2740';c.fillRect(-4,11,7,12);
    // Right arm raised, waving the white flag
    const wv=Math.sin(t*5)*0.5;                   // flag wave
    c.save();
    c.translate(21,12);c.rotate(-1.15+wv*0.18);   // raise arm up-right
    c.fillStyle='#1a2740';c.fillRect(0,-3,11,6);  // forearm
    // Flag pole
    c.fillStyle='#caa';c.fillRect(11,-28,2,30);
    // White flag cloth (waving) — glow via bloom() drawn before the shape
    // (bloom() itself doesn't touch fillStyle/shadow state, safe to call here)
    c.fillStyle='#f6f6fc';
    c.beginPath();
    c.moveTo(13,-28);
    c.lineTo(13+15,-26.5+Math.sin(t*7)*1.8);
    c.lineTo(13+15,-15.5+Math.sin(t*7+1)*1.8);
    c.lineTo(13,-17);
    c.closePath();c.fill();
    c.restore();
    c.restore();
  } else {
    // ── IDLE: cheerful bob + wave ──
    const bob=Math.sin(t*2.2)*2.5;
    c.save();
    c.translate(w/2, baseY+bob);
    c.scale(S,S);c.translate(-12,-32);
    _botBody(c,t,0);
    // Left arm rests
    c.fillStyle='#002a66';c.fillRect(-4,11,7,11);
    // Right arm waves hello
    const wv=Math.sin(t*5)*0.6;
    c.save();
    c.translate(21,12);c.rotate(-1.0+wv*0.4);
    c.fillStyle='#002a66';c.fillRect(0,-3,10,6);
    c.fillStyle='#0055bb';c.fillRect(9,-4,4,8);   // hand
    c.restore();
    c.restore();
  }
  _menuBotRAF=requestAnimationFrame(_menuBotTick);
}
function startMenuBot(){ if(!_menuBotRAF)_menuBotRAF=requestAnimationFrame(_menuBotTick); }
function showMain(sc=''){
  if(raf){cancelAnimationFrame(raf);raf=0;}
  if(_goNextTimer){clearTimeout(_goNextTimer);_goNextTimer=0;}
  dailyMode=false;dailySlot=null;   // в меню — значит забег дня уже закончен
  hideAll();navScr='main';
  // Restore the title/subtitle/button that game-over & win screens overwrite
  const h1=$main.querySelector('h1'),sub=$main.querySelector('.ovSub'),btn=document.getElementById('mainBtn');
  h1.textContent='⚡ BYTE BLASTER';h1.style.color='';h1.style.textShadow='';
  sub.setAttribute('data-i18n','subtitle');sub.textContent=T('subtitle');
  btn.setAttribute('data-i18n','play');btn.textContent=T('play');btn.onclick=()=>{SFX.menu();showPlayType();};
  document.querySelector('#mainOv .ovLegend').style.display='';
  _menuExtras(true); // restore Achievements / Settings on the real main menu
  document.getElementById('mainScore').textContent=sc;
  document.getElementById('mainScore').style.display=sc?'block':'none';
  $main.style.display='flex';startMenuMusic();setMenuBotMode('idle');startMenuBot();
  // Keep a static backdrop behind the (near-opaque) menu overlay
  raf=requestAnimationFrame(function(){drawBG();drawGrid();raf=0;});
}
function showMode(){
  hideAll();navScr='mode';
  const allDone=advProg.done.length>=100;
  const inf=document.getElementById('infCard');
  const infDesc=inf.querySelector('.mDesc');
  const infIcon=inf.querySelector('.mIcon');
  // Demo build: INFINITE is not part of it, and local 2-player is off — say so
  // on the cards themselves instead of leaving dead controls on screen.
  const demo=window.Demo&&window.Demo.on;
  if(demo){
    window.Demo.lockCard(inf,'demoLockedInfinite');
    const advD=document.querySelector('#advCard .mDesc');
    if(advD)advD.innerHTML=T('demoAdvDesc',window.Demo.levels);
    twoPlayer=false;window.bbTwoPlayer=false;
    const b1=document.getElementById('btn1p'),b2=document.getElementById('btn2p');
    if(b1)b1.classList.add('active');
    if(b2){b2.classList.remove('active');b2.classList.add('locked');b2.textContent=T('demoLocked2P');}
    const p2hd=document.getElementById('p2hint');if(p2hd)p2hd.style.display='none';
    $mode.style.display='flex';
    return;
  }
  if(allDone){
    inf.classList.remove('locked');infIcon.textContent='♾️';
    infDesc.innerHTML=T('infDescUnlocked');
  } else {
    inf.classList.add('locked');infIcon.textContent='🔒';
    const need=100-advProg.done.length;
    infDesc.innerHTML=T('infDescLocked',need);
  }
  // Show the player's best infinite-mode score (a saved record) on the card.
  if(typeof bestRecords!=='undefined'&&bestRecords.infinite>0)
    infDesc.innerHTML+='<br><span style="color:#0ff">'+T('bestScore',bestRecords.infinite)+'</span>';
  // On phones/tablets there is no second keyboard, so 2-player local makes no
  // sense — hide the 1/2 toggle and force single player. (Re-evaluated each open
  // because the "Touch controls: On" setting can change at runtime.)
  const touchLike=bbWantsTouchUI();
  const pToggle=document.getElementById('playerToggle');
  const p2h=document.getElementById('p2hint');
  if(touchLike){
    twoPlayer=false; window.bbTwoPlayer=false;
    const b1=document.getElementById('btn1p'),b2=document.getElementById('btn2p');
    if(b1)b1.classList.add('active'); if(b2)b2.classList.remove('active');
    if(pToggle)pToggle.style.display='none';
    if(p2h)p2h.style.display='none';
  } else if(pToggle){
    pToggle.style.display='flex';
  }
  $mode.style.display='flex';
}
function showDiff(){
  hideAll();navScr='diff';
  const allDone=advProg.done.length>=100;
  const hc=document.getElementById('hardCard');
  const hd=document.getElementById('hardDesc');
  // Demo build: HARDCORE stays locked no matter what — it unlocks by clearing
  // the whole campaign, which the demo doesn't contain.
  if(window.Demo&&window.Demo.on){
    window.Demo.lockCard(hc,'demoLockedHard');
    document.getElementById('normDesc').innerHTML=T('normDescProg',advProg.done.length,advTotalLevels());
    document.getElementById('diffOv').style.display='flex';
    return;
  }
  if(allDone){
    hc.classList.remove('locked');
    hd.innerHTML=T('hardDescUnlocked');
  } else {
    hc.classList.add('locked');
    const need=100-advProg.done.length;
    hd.innerHTML=T('hardDescNeed',need);
  }
  // Normal progress
  const nd=document.getElementById('normDesc');
  nd.innerHTML=T('normDescProg',advProg.done.length,advTotalLevels());
  document.getElementById('diffOv').style.display='flex';
}
function hideDiff(){SFX.back();showMode();}
// Hard map — same map but uses advProgHard
function showMapH(){
  hideAll();
  // Stop the in-game render loop while the map is open. Otherwise the full
  // game scene keeps redrawing every frame *underneath* the map's own RAF
  // loop — two heavy render chains at once, which is what made the map lag.
  if(raf){cancelAnimationFrame(raf);raf=0;}
  navScr='map';
  if(window.WorldMap){
    window.WorldMap.show(true); // Hardcore world map
  } else {
    // Fallback to old hardcore grid if WorldMap not loaded
    buildMapH();$map.style.display='flex';
    const g=document.getElementById('mapGrid'),thI=Math.floor((advProgHard.max-1)/10);
    const secs=g.querySelectorAll('.thSec');if(secs[thI])setTimeout(()=>secs[thI].scrollIntoView({behavior:'smooth',block:'center'}),60);
  }
}
function buildMapH(){
  const g=document.getElementById('mapGrid');g.innerHTML='';
  const prog=advProgHard;
  document.getElementById('mapProg').textContent=T('mapProgHard',prog.done.length,advTotalLevels());
  for(let ti=0;ti<10;ti++){
    const TH=THEMES[ti];
    const sec=document.createElement('div');sec.className='thSec';sec.style.borderColor='#f44';sec.style.background=withAlpha(TH.bg,'77');
    const lbl=document.createElement('div');lbl.className='thLbl';lbl.style.color='#f44';
    lbl.innerHTML='<span style="font-size:calc(11px * var(--bbText, 1))">💀</span>'+TH.name+' <span style="color:#fff5;margin-left:3px">'+TH.range+'</span>';sec.appendChild(lbl);
    const row=document.createElement('div');row.className='lvlRow';
    for(let li=1;li<=10;li++){
      const n=ti*10+li,locked=n>prog.max,done=prog.done.includes(n),avail=n===prog.max&&!done;
      const btn=document.createElement('button');btn.className='lBtn';
      if(locked){btn.disabled=true;btn.innerHTML='<span style="opacity:.45;font-size:calc(9px * var(--bbText, 1))">🔒</span><span class="lvlN">'+n+'</span>';}
      else{
        btn.style.borderColor='#f446';btn.style.setProperty('--mc','#f44');
        if(done){btn.style.background='#f4420';btn.style.color='#f44';btn.innerHTML='<span style="font-size:calc(8px * var(--bbText, 1))">✓</span><span class="lvlN">'+n+'</span>';}
        else{btn.style.color='#f44';if(avail){btn.classList.add('avail');btn.style.borderColor='#f44';btn.style.boxShadow='0 0 9px #f449';}
          btn.innerHTML='<span style="font-size:calc(9px * var(--bbText, 1))">'+(avail?'▶':'')+'</span><span class="lvlN">'+n+'</span>';}
        btn.onclick=()=>{SFX.menu();
          if(window.Juice)window.Juice.transition(()=>startAdv(n,true));
          else startAdv(n,true);};
      }
      row.appendChild(btn);
    }
    sec.appendChild(row);g.appendChild(sec);
  }
}
function showMap(){
  hideAll();
  // Stop the in-game render loop while the map is open (see showMapH).
  if(raf){cancelAnimationFrame(raf);raf=0;}
  navScr='map';
  // У карты своя тема: раньше здесь доигрывала музыка меню, и переход между
  // выбором уровня и самой картой был неслышен.
  startMapMusic();
  if (window.WorldMap) {
    window.WorldMap.show(false);
  } else {
    // Fallback to old map if WorldMap not loaded
    buildMap();
    $map.style.display='flex';
    const g=document.getElementById('mapGrid'),thI=Math.floor((advProg.max-1)/10);
    const secs=g.querySelectorAll('.thSec');if(secs[thI])setTimeout(()=>secs[thI].scrollIntoView({behavior:'smooth',block:'center'}),60);
  }
}
function doPause(){if(gState!=='playing')return;gState='paused';navScr='paused';SFX.pause();stopMusic();
  for(const k in K)K[k]=false;
  document.getElementById('pauseMapBtn').style.display=advMode?'block':'none';$pause.style.display='flex';}
function doResume(){if(gState!=='paused')return;gState='playing';navScr='game';SFX.resume();hideAll();document.getElementById('ui').style.display='flex';showModBanner();for(const k in K)K[k]=false;startGameMusic();}

/**
 * Уход с уровня в меню или на карту обязан ОТПУСТИТЬ сетевую комнату.
 *
 * Раньше пауза → «В меню» просто показывала главное меню, а window.netActive
 * оставался включённым и сокет — открытым. Игрок продолжал числиться в комнате
 * (и держал её у флага), а его собственная игра ломалась: следующая одиночная
 * партия шла в «сетевом» режиме — по экрану бегали призраки вышедших, гость не
 * считал ИИ врагов, флаг рапортовал в чужую комнату. Отсюда «вышел, а второго
 * игрока всё равно видно».
 *
 * NetPlay.close() уводит на экран выбора сетевой игры, поэтому зовём его ДО
 * навигации: нужный экран открывается следом и остаётся последним.
 */
function netLeaveIfActive(){
  if(!window.netActive)return;
  if(window.NetPlay&&typeof window.NetPlay.close==='function'){
    try{window.NetPlay.close();}catch(e){}
  }
  // Подстраховка на случай, если модуль сети не загрузился: состояние сетевой
  // игры не должно пережить выход с уровня ни при каких обстоятельствах.
  window.netActive=false;
  if(window.netPlayers&&window.netPlayers.clear)window.netPlayers.clear();
  window.netSpectateObj=null;
}
document.getElementById('resumeBtn').onclick=doResume;
document.getElementById('pauseMapBtn').onclick=()=>{SFX.back();netLeaveIfActive();gState='menu';stopMusic();hardMode?showMapH():showMap();};
document.getElementById('pauseMenuBtn').onclick=()=>{
  // Bank an infinite run before walking away from it. Adventure keeps its own
  // per-level progress, so this only ever fires for the endless mode.
  if(window.InfSave&&!advMode)window.InfSave.save();
  SFX.back();netLeaveIfActive();gState='menu';stopMusic();showMain();
};
document.getElementById('advCard').onclick=()=>{initAudio();SFX.menu();showDiff();};
document.getElementById('modeBackBtn').onclick=()=>{SFX.back();showPlayType();};
document.getElementById('mapBackBtn').onclick=()=>{SFX.back();showDiff();};
// ── Play type selection (Solo vs Online) ────────────────────────────────────
function showPlayType(){
  hideAll();navScr='playType';
  // Demo build: online multiplayer is a full-version feature. The card stays on
  // screen (so the player can see what the full game adds) but is locked.
  if(window.Demo&&window.Demo.on){
    window.Demo.lockCard(document.getElementById('onlineCard'),'demoLockedOnline');
    const sd=document.querySelector('#soloCard .mDesc');
    if(sd)sd.innerHTML=T('demoSoloDesc');
  }
  document.getElementById('playTypeOv').style.display='flex';
}
function showNetType(){
  hideAll();navScr='netType';
  document.getElementById('netTypeOv').style.display='flex';
}
// Экран комнат: то, что раньше было первым шагом «Онлайна».
function showNetRooms(){
  hideAll();navScr='netRooms';
  document.getElementById('netRoomsOv').style.display='flex';
}
window.showNetRooms=showNetRooms;

// Карточки Play Type
// Слот больше не спрашивается на пути в игру: он виден и меняется кнопкой в
// углу меню (saveslots.js). Лишний экран стоял между «хочу играть» и игрой,
// хотя слот у большинства один и тот же.
document.getElementById('soloCard').onclick=()=>{
  SFX.menu();
  showMode();
};
document.getElementById('onlineCard').onclick=function(){
  if(window.Demo&&window.Demo.on){window.Demo.refuse(this);return;}
  SFX.menu();showNetType();
};
document.getElementById('playTypeBackBtn').onclick=()=>{SFX.back();showMain();};

// Карточки «Онлайна»: уровень дня или мультиплеер
document.getElementById('dailyCard').onclick=function(){
  if(window.Demo&&window.Demo.on){window.Demo.refuse(this);return;}
  SFX.menu();
  if(window.Daily&&window.Daily.open)window.Daily.open();
};
document.getElementById('multiplayerCard').onclick=()=>{SFX.menu();showNetRooms();};

// Карточки комнат: Создать / Найти
document.getElementById('createRoomCard').onclick=()=>{
  SFX.menu();
  if(window.NetPlay) window.NetPlay.open('create');
};
document.getElementById('findRoomCard').onclick=()=>{
  SFX.menu();
  if(window.NetPlay) window.NetPlay.open('find');
};
document.getElementById('netTypeBackBtn').onclick=()=>{SFX.back();showPlayType();};
document.getElementById('netRoomsBackBtn').onclick=()=>{SFX.back();showNetType();};

// PLAY теперь ведёт на экран выбора Solo/Online
document.getElementById('mainBtn').onclick=()=>{SFX.menu();showPlayType();};
// Выход из игры. Electron закрывает приложение, Android зовёт exitApp().
//
// В браузере window.close() РАБОТАЕТ ТОЛЬКО для вкладки, открытой скриптом:
// вкладку, в которую игрок пришёл по ссылке или из закладок, закрыть нельзя —
// это запрет самого браузера, и кнопка просто ничего не делала. Поэтому в вебе
// выход означает «вернуться на сайт игры»: close() пробуем, и если вкладка
// через мгновение жива, уходим на страницу игры.
document.getElementById('exitBtn').onclick=()=>{SFX.menu();
  if(window.electronAPI&&window.electronAPI.quit){window.electronAPI.quit();return;}
  const Cap=window.Capacitor;
  if(Cap&&Cap.Plugins&&Cap.Plugins.App&&Cap.Plugins.App.exitApp){Cap.Plugins.App.exitApp();return;}
  // Direct native bridge call — works on Android even without the JS plugin proxy.
  if(Cap&&typeof Cap.nativeCallback==='function'){try{Cap.nativeCallback('App','exitApp',{});return;}catch(e){}}
  if(navigator.app&&navigator.app.exitApp){navigator.app.exitApp();return;}

  try{window.close();}catch(e){}
  setTimeout(()=>{
    if(window.closed)return;                       // вкладку всё-таки закрыли
    // Если игрок пришёл с нашего сайта — возвращаем его туда же, откуда пришёл.
    const home=(window.BB_SITE_URL||'https://pixset-studio.github.io/byte-blaster/');
    try{
      if(document.referrer&&new URL(document.referrer).origin===location.origin){
        location.href=document.referrer;return;
      }
    }catch(e){}
    location.href=home;
  },180);
};

function setPlayers(n){
  // Demo build: local 2-player is a full-version feature. Refuse with a shake
  // rather than silently ignoring the click.
  if(n===2&&window.Demo&&window.Demo.on){
    window.Demo.refuse(document.getElementById('btn2p'));
    return;
  }
  twoPlayer=(n===2);
  window.bbTwoPlayer=twoPlayer; // expose for the World Map (two robots in 2P)
  document.getElementById('btn1p').classList.toggle('active',!twoPlayer);
  document.getElementById('btn2p').classList.toggle('active',twoPlayer);
  document.getElementById('p2hint').style.display=twoPlayer?'block':'none';
  if(twoPlayer&&window.Achievements)window.Achievements.unlock('achievement_2player');
  SFX.menu();
}

// ── Adventure map build ──────────────────────────
function buildMap(){
  const g=document.getElementById('mapGrid');g.innerHTML='';
  document.getElementById('mapProg').textContent=T('mapProg',advProg.done.length,advTotalLevels());
  for(let ti=0;ti<10;ti++){
    const TH=THEMES[ti];
    const sec=document.createElement('div');sec.className='thSec';sec.style.borderColor=withAlpha(TH.mc,'55');sec.style.background=withAlpha(TH.bg,'77');
    const lbl=document.createElement('div');lbl.className='thLbl';lbl.style.color=TH.mc;
    lbl.innerHTML=`<span style="font-size:calc(11px * var(--bbText, 1))">${TH.icon}</span>${TH.name} <span style="color:#fff5;margin-left:3px">${TH.range}</span>`;sec.appendChild(lbl);
    const row=document.createElement('div');row.className='lvlRow';
    for(let li=1;li<=10;li++){
      const n=ti*10+li,locked=n>advProg.max,done=advProg.done.includes(n),avail=n===advProg.max&&!done;
      const btn=document.createElement('button');btn.className='lBtn';
      if(locked){btn.disabled=true;btn.innerHTML=`<span style="opacity:.45;font-size:calc(9px * var(--bbText, 1))">🔒</span><span class="lvlN">${n}</span>`;}
      else{
        btn.style.borderColor=withAlpha(TH.mc,'88');btn.style.setProperty('--mc',TH.mc);
        if(done){btn.style.background=withAlpha(TH.mc,'20');btn.style.color=TH.mc;btn.innerHTML=`<span style="font-size:calc(8px * var(--bbText, 1))">✓</span><span class="lvlN">${n}</span>`;}
        else{btn.style.color=TH.mc;if(avail){btn.classList.add('avail');btn.style.borderColor=TH.mc;btn.style.boxShadow=`0 0 9px ${TH.mc}99`;}
          btn.innerHTML=`<span style="font-size:calc(9px * var(--bbText, 1))">${avail?'▶':''}</span><span class="lvlN">${n}</span>`;}
        btn.onclick=()=>{SFX.menu();
          if(window.Juice)window.Juice.transition(()=>startAdv(n,true));
          else startAdv(n,true);};
      }
      row.appendChild(btn);
    }
    sec.appendChild(row);g.appendChild(sec);
  }
}

// ════════════════════════════════════════════════
//  GAME START FUNCTIONS
// ════════════════════════════════════════════════
function startInf(fresh=true){
  if(fresh){score=0;lives=3;level=1;coinsTotal=0;_coinsHpStep=0;}
  advMode=false;CT=THEMES[Math.min(Math.floor((level-1)/10),9)];
  player=mkPlayer();
  const diff=Math.min(Math.floor((level-1)/5)+1,14);
  genLevel(diff,()=>Math.random(),null);
  player.x=spawnX;player.y=spawnY;
  timeLeft=lvlTime(level)*1.5;timMax=timeLeft;
  hideAll();gState='playing';navScr='game';tick=0;
  document.getElementById('ui').style.display='flex';
  updModeLabel();startGameMusic();if(raf)cancelAnimationFrame(raf);loop();
}
function startAdv(n,freshLives=false){
  // Серия убийств не переезжает между уровнями.
  if(window.Juice)window.Juice.comboBreak();
  // В хардкоре запас общий на весь мир и переносится между уровнями;
  // в обычном режиме — свой на каждый заход.
  if(hardMode&&advMode){
    _hardEnterWorld(n);
    if(freshLives)cpSave=null;
    lives=hardWorldLives;
  } else if(freshLives){lives=3;cpSave=null;} // fresh entry (e.g. from map) → no carried checkpoint
  // Reset coin progress when starting fresh adventure from level 1
  if(freshLives&&n===1){coinsTotal=0;_coinsHpStep=0;}
  advMode=true;advLevel=n;CT=THEMES[Math.floor((n-1)/10)];level=n;
  player=mkPlayer();
  const diff=Math.min(Math.floor((n-1)/6)+1,14);
  genLevel(diff,mkRNG(n*9001+12345),n);
  player.x=spawnX;player.y=spawnY;
  // Resume at a previously-reached checkpoint when retrying this same seeded level.
  if(cpSave&&cpSave.lvl===n&&checkpoints.length){
    const cp=checkpoints[0];
    cp.taken=true;cp.color=cpSave.color||'#4af';
    spawnX=Math.round(cp.x+cp.w/2-player.w/2);spawnY=cp.baseY-player.h;
    player.x=spawnX;player.y=spawnY;player.lastGndX=spawnX;player.lastGndY=spawnY;
    player.cpX=spawnX;player.cpY=spawnY;
    camX=Math.max(0,Math.min(spawnX-W*.38,worldW-W));
    // Keep crystals collected before the checkpoint (see _doRunLevel for the live path).
    if(cpSave.shards){
      for(let i=0;i<dataShards.length&&i<cpSave.shards.length;i++)dataShards[i].got=cpSave.shards[i];
      dataShardsGot=cpSave.shardsGot||dataShards.filter(s=>s.got).length;
      shardBonusGiven=(dataShardsTotal>0&&dataShardsGot>=dataShardsTotal);
    }
    _restoreCpWorld();
  }
  timeLeft=lvlTime(n);timMax=timeLeft;
  hideAll();gState='playing';navScr='game';tick=0;
  document.getElementById('ui').style.display='flex';
  updModeLabel();

  // Top-center modifier/archetype banner (persists for the whole level).
  showModBanner();

  startGameMusic();if(raf)cancelAnimationFrame(raf);loop();
}
function updModeLabel(){
  document.getElementById('modeUI').style.display='flex';
  const e=document.getElementById('modeEl');
  const label=(advMode?(hardMode?'💀 HC ':'ADV ')+advLevel+'/'+advTotalLevels():'INF');
  e.textContent=label;
  const col=hardMode?'#f44':CT.mc;
  e.style.color=col;e.style.textShadow='0 0 6px '+col;
}
// Build the list of active level modifier/archetype labels for the current level.
function modBannerLabels(){
  const parts=[];
  if(levelArchetype==='speedrun')parts.push('⚡ '+T('modSpeedrun'));
  else if(levelArchetype==='stealth')parts.push('👁 '+T('modStealth'));
  if(levelMods.lowGravity)parts.push('🌙 '+T('modLowGravity'));
  if(levelMods.highGravity)parts.push('🪨 '+T('modHighGravity'));
  if(levelMods.wind)parts.push('🌬 '+T('modWind'));
  if(levelMods.slippery)parts.push('🧊 '+T('modSlippery'));
  if(levelMods.darkness)parts.push('🌑 '+T('modDarkness'));
  return parts;
}
// Show or hide the persistent top-center modifier banner for this level.
function showModBanner(){
  const el=document.getElementById('modBanner');
  if(!el)return;
  const parts=modBannerLabels();
  if(parts.length===0){el.style.display='none';el.textContent='';return;}
  el.textContent='⚠ '+parts.join('   ');
  el.style.display='block';
}
function hideModBanner(){
  const el=document.getElementById('modBanner');
  if(el){el.style.display='none';el.textContent='';}
}

// Expose startAdv for WorldMap. `hard` selects Hardcore so the same map can drive both modes.
window.startAdventureLevel = function(levelNum, hard) {
  dailyMode = false; dailySlot = null;
  hardMode = !!hard;
  startAdv(levelNum, true);
};

/* ── Запуск уровня дня ──────────────────────────────────────────────────────
   Всё, что делает день днём — какой мир, какая сложность, какой мутатор, —
   приходит готовым из assets/daily.js: там это считается из даты и слота, и
   там же лежит экран с таблицами. Здесь только сборка уровня.

   Кампанию режим не трогает: advMode остаётся выключенным, поэтому ни прогресс,
   ни звёзды, ни катсцены отсюда не записываются. Босса тоже не будет — номер
   уровня для генератора выбран не кратным десяти (см. daily.js).

   cfg: { slot, seed, world, diff, arch, mods, advN }
   fresh: новая попытка (счёт и жизни с нуля). Повтор после смерти приходит с
   fresh=false — это та же попытка, просто с потерянной жизнью, и счёт за неё
   продолжает копиться, как в кампании.
*/
window.startDailyLevel = function(cfg, fresh) {
  if (!cfg) return;
  dailyMode = true; dailySlot = cfg.slot || null;
  hardMode = false; advMode = false; twoPlayer = false;
  if (window.netActive) return;              // из сетевой комнаты день не запускается

  if (_darkCtx) _darkCtx.clearRect(0, 0, W, H);
  if (fresh !== false) {
    lives = infiniteLives ? 99 : 3;
    score = 0; coinsTotal = 0; _coinsHpStep = 0;
  }
  cpSave = null;
  _levelDied = false;

  CT = THEMES[Math.max(0, Math.min(9, cfg.world | 0))];
  level = 1;                                  // подпись уровня в HUD: день — один уровень
  player = mkPlayer();

  dailyForce = { arch: cfg.arch || 'classic', mods: cfg.mods || {} };
  try {
    genLevel(Math.max(1, Math.min(14, cfg.diff | 0)), mkRNG(cfg.seed >>> 0), cfg.advN | 0);
  } finally {
    dailyForce = null;                        // дальше генератор снова работает как обычно
  }
  fixDrones();
  player.x = spawnX; player.y = spawnY;
  player.lastGndX = spawnX; player.lastGndY = spawnY;
  initP2();
  if (window.Ghost) window.Ghost.begin({ kind: 'daily', slot: cfg.slot });

  timeLeft = Math.round(lvlTime(Math.max(1, cfg.advN | 0)));
  timMax = timeLeft;
  hideAll(); gState = 'playing'; navScr = 'game'; tick = 0;
  document.getElementById('ui').style.display = 'flex';
  _resetCanvasState();
  updModeLabel();
  showModBanner();
  startGameMusic();
  if (raf) cancelAnimationFrame(raf);
  loop();
};

// ════════════════════════════════════════════════
//  UPDATE — PLAYER
// ════════════════════════════════════════════════
function updatePlayer(){
  if(!player)return;  // Player 1 may be null in 2-player mode if they died
  const p=player;
  // Пока экран гаснет или проявляется — управление забираем и держим
  // игрока неуязвимым: он не должен вслепую уехать или получить удар.
  if(bonusLocked()){ p.vx=0; p.vy=0; p.inv=Math.max(p.inv||0,6); return; }
  // Co-op: this player already reached the flag and is waiting for the others.
  // Freeze them in place (invulnerable) while the rest of the room keeps playing.
  if(window.netActive && p._netDone){ p.vx=0; p.vy=0; p.inv=Math.max(p.inv||0,600); return; }

  // ── FALL RESPAWN SMOOTH ANIMATION
  if(p.fallRespawning){
    p.fallRespawnT++;
    const dur=72;
    const t=Math.min(p.fallRespawnT/dur,1);
    const ease=t*t*(3-2*t); // smoothstep
    p.x=p.fallRespawnSX;
    p.y=p.fallRespawnSY+(p.lastGndY-p.fallRespawnSY)*ease;
    p.vx=0;p.vy=0;
    if(t>=1){
      p.fallRespawning=false;
      p.x=p.lastGndX;p.y=p.lastGndY;
      p.respawning=true;p.respawnTimer=120;
      SFX.respawn();burst(p.x+p.w/2,p.y,'#0ff',10,3,4);
      setTimeout(()=>{floatTxt(p.x+p.w/2,p.y-20,T('livesLeft',lives),'#f80');},200);
    }
    if(p.inv>0)p.inv--;
    return;
  }

  // ── RESPAWN INVINCIBILITY FLICKER (not dead, just hurt)
  if(p.respawning){
    p.respawnTimer--;
    if(p.respawnTimer<=0){p.respawning=false;p.inv=120;} // fade out invincibility
    else{p.inv=p.respawnTimer+1;} // keep invincible while respawning
  }

  // P1 keys come from the rebindable control map (settings → CONTROLS).
  // In single-player the arrow keys also work, as a universal convenience.
  const c1=(window.gameSettings&&window.gameSettings.controls)||{};
  const solo=!twoPlayer;
  const L=K[c1.p1Left]||(solo&&K['ArrowLeft']);
  const R=K[c1.p1Right]||(solo&&K['ArrowRight']);
  const J=K[c1.p1Jump]||(solo&&K['ArrowUp']);
  const S=K[c1.p1Shoot];

  // Status effects scale the base speed (CHILL stiffens the servos).
  const psp1=(p.starMode?PSP*1.4:p.boots?PSP*1.55:PSP)*(window.Status?Status.speedMul(p):1);
  if(L){p.vx=Math.max(p.vx-1.3,-psp1);p.facing=-1;}
  else if(R){p.vx=Math.min(p.vx+1.3,psp1);p.facing=1;}
  else{
    // Slippery modifier reduces friction
    const friction=(levelMods.slippery||(window.Status&&Status.slippery(p)))?0.92:0.7;
    p.vx*=friction;if(Math.abs(p.vx)<.1)p.vx=0;
  }

  // Wind modifier pushes player
  if(levelMods.wind)p.vx+=levelMods.wind;

  if(J&&!p._jh&&p.jl>0){
    // EMP fries the thrusters: the ground jump still works, the air jump does not.
    if(window.Status&&Status.noDoubleJump(p)&&!p.onGnd&&p.jl<=1){
      p._jh=true;if(SFX.back)SFX.back();
      floatTxt(p.x+p.w/2,p.y-6,T('stEmpBlocked'),'#ffee44');
    } else {
      if(p.jl===2)SFX.jump();else SFX.dblJump();
      p.vy=(JV+(p.jl<2?-.9:0))*(window.Status?Status.jumpMul(p):1);
      // Чит бесконечных прыжков: запас не тратится, поэтому прыгать можно
      // хоть всю дорогу вверх. Сила, звук и эффект — как у обычного прыжка.
      if(!infiniteJump)p.jl--;
      p._jh=true;
      if(typeof AchTrack!=='undefined')AchTrack.jump();
      burst(p.x+p.w/2,p.y+p.h,CT.mc,6,2,3);
    }
  }
  if(!J)p._jh=false;
  if(!J&&p.vy<-3)p.vy*=.88;

  // Gravity with modifiers
  const GRAV=levelMods.lowGravity?0.3:levelMods.highGravity?0.9:G;
  p.vy=Math.min(p.vy+GRAV,MXY);
  p.px=p.x;p.py=p.y;
  const wasGnd=p.onGnd;
  resolveP(p);

  // Check collision with closed doors (maze archetype)
  for(const door of doors){
    if(!door.open&&aabb(p,door)){
      // Block player from passing through closed door
      if(p.px<door.x){
        p.x=door.x-p.w;
        p.vx=Math.min(0,p.vx);
      }else if(p.px>door.x+door.w){
        p.x=door.x+door.w;
        p.vx=Math.max(0,p.vx);
      }
    }
  }

  if(!wasGnd&&p.onGnd)SFX.land();
  if(p.onGnd){p.lastGndX=p.x;p.lastGndY=p.y;if(p.boots)p.jl=Math.max(p.jl,3);}
  if(p.y>H+60){
    if(godMode){
      // God mode: teleport back to last ground spot without losing a life
      const tx=Math.max(0,Math.min(p.lastGndX,worldW-p.w));
      p.x=tx;p.y=p.lastGndY;p.vx=0;p.vy=0;
      burst(p.x+p.w/2,p.y+p.h/2,'#0ff',12,3,4);floatTxt(p.x+p.w/2,p.y-10,'✦',CT.mc);
      return;
    }
    doHurtPlayer(true);return;
  }

  if(p.inv>0)p.inv--;
  if(p.starMode){p.starTimer--;if(p.starTimer<=0){p.starMode=false;p.inv=0;if(!boss||!boss.alive)startGameMusic();else startBossMusic();}}
  // Blaster / fire / ice are permanent — they last until an enemy hit strips
  // them (see enemyHitPlayer). Keep timers pinned at max so the HUD bars read
  // full instead of draining.
  if(p.blaster)p.bTimer=1800;
  if(p.fireMode||p.iceMode)p.elemTimer=1800;
  if(p.boots){p.bootsTimer--;if(p.bootsTimer<=0){p.boots=false;p.bootsTimer=0;if(p.jl>2)p.jl=2;}}
  if(p.sCD>0)p.sCD--;

  // ── SHOOT: fire/ice по клавише (homing к ближайшему врагу), blaster отключён при fire/ice
  if(S&&p.sCD<=0&&window.Status&&Status.blasterBlocked(p)){
    // EMP: weapon systems down. Short cooldown so the click is acknowledged
    // (sparks + text) instead of spamming every frame the key is held.
    p.sCD=26;if(SFX.back)SFX.back();
    burst(p.x+p.w/2,p.y+p.h/2,'#ffee44',6,2.2,3);
    floatTxt(p.x+p.w/2,p.y-6,T('stEmpBlocked'),'#ffee44');
  } else if(S&&p.sCD<=0){
    if(p.blaster){
      // Blaster shoots bullets. If fire/ice is also active, the bullet inherits that element.
      p.sCD=18;SFX.shoot();
      const bx=p.facing>0?p.x+p.w:p.x-14;
      const bType = p.fireMode ? 'fire' : (p.iceMode ? 'ice' : null);
      const bCol  = p.fireMode ? '#ff4400' : (p.iceMode ? '#00ffff' : CT.mc);
      pBullets.push({x:bx,y:p.y+p.h/2-4,w:14,h:8,vx:BSP*p.facing,dist:0,max:480,type:bType,col:bCol});
      burst(p.x+p.w/2,p.y+p.h/2,bCol,4,1.8,3);
    } else if(p.fireMode||p.iceMode){
      // No blaster pickup — fire/ice alone throws an elemental ball in the facing direction.
      p.sCD=20;
      const px=p.x+p.w/2,py=p.y+p.h/2;
      const spd=9;
      const vx=(p.facing||1)*spd, vy=0;
      if(p.fireMode){fireBalls.push({x:px-8,y:py-8,w:16,h:16,vx,vy,life:900,owner:1});tone(180,'sawtooth',.06,.1);}
      else{iceBalls.push({x:px-8,y:py-8,w:16,h:16,vx,vy,life:900,owner:1});tone(700,'sine',.06,.1);}
    }
  }

  p.trail.unshift({x:p.x+p.w/2,y:p.y+p.h/2});if(p.trail.length>16)p.trail.pop();
  p.animTk++;if(Math.abs(p.vx)>.4&&p.animTk%7===0)p.animFr=(p.animFr+1)%4;else if(Math.abs(p.vx)<.4)p.animFr=0;
  // Walk sound (infrequent)
  if(p.onGnd&&Math.abs(p.vx)>2&&p.animTk%22===0){/* walk sfx removed */}

  // Screen boundary walls in 2-player mode - prevent players from going off-screen
  if(twoPlayer){
    const leftBound=camX+10;
    const rightBound=camX+W-p.w-10;
    if(p.x<leftBound){p.x=leftBound;p.vx=Math.max(0,p.vx);}
    if(p.x>rightBound){p.x=rightBound;p.vx=Math.min(0,p.vx);}
  }

  // Coins
  for(const c of coins)if(!c.got&&aabb(p,c)){c.got=true;score+=10;coinsTotal++;AchTrack.coin();SFX.coin();burst(c.x+7,c.y+7,'#ffd700',5,2,3);if(window.Juice)window.Juice.pickup(c.x+7-camX,c.y+7,'coin');else floatTxt(c.x,c.y,'+10','#ffd700');_checkCoinHp(c.x,c.y,p);}

  // Maze keys
  for(const key of mazeKeys){
    if(!key.collected&&aabb(p,key)){
      key.collected=true;
      mazeKeysCollected++;
      SFX.powerup();
      burst(key.x+10,key.y+10,'#ff0',18,4,6);
      floatTxt(key.x,key.y-10,`KEY ${mazeKeysCollected}/3`,'#ff0');
      camShake=8;
      score+=100;

      // Open doors if all keys collected
      if(mazeKeysCollected>=3){
        for(const door of doors){
          if(door.keysNeeded<=mazeKeysCollected){
            door.open=true;
            burst(door.x+door.w/2,door.y+door.h/2,'#4f8',24,5,7);
            floatTxt(door.x+door.w/2,door.y-20,T('doorOpenTxt'),'#4f8');

            // Remove blocking walls around door
            for(let i=blocks.length-1;i>=0;i--){
              const b=blocks[i];
              if(b.x>=door.x-50&&b.x<=door.x+door.w+50&&b.y>=door.y-50&&b.y<=door.y+door.h){
                blocks.splice(i,1);
              }
            }
          }
        }
      }
    }
  }

  // Stealth: Check spotlight detection
  for(const sl of spotlights){
    if(sl.alerted)continue;
    const dx=p.x+p.w/2-sl.x;
    const dy=p.y+p.h/2-sl.y;
    const dist=Math.sqrt(dx*dx+dy*dy);
    const angleToPlayer=Math.atan2(dy,dx);
    let angleDiff=Math.abs(angleToPlayer-sl.angle);
    if(angleDiff>Math.PI)angleDiff=Math.PI*2-angleDiff;

    if(dist<sl.range&&angleDiff<0.25){
      // Player detected!
      sl.alerted=true;
      camShake=12;
      floatTxt(p.x+p.w/2,p.y-30,T('detectedTxt'),'#f44');
      // Spawn extra enemies as punishment
      const pool=ePool(advLevel||level);
      if(pool.length>0){
        const t=pool[Math.floor(Math.random()*pool.length)];
        mkEnemy(t,p.x+100,p.y,null,Math.random);
        mkEnemy(t,p.x-100,p.y,null,Math.random);
      }
    }
  }

  // Power-ups
  for(const pu of powerups){
    if(!pu.got&&aabb(p,pu)){pu.got=true;SFX.powerup();
      if(pu.type==='blast'){p.blaster=true;p.bTimer=1800;burst(pu.x+12,pu.y+12,CT.mc,18,4,6);floatTxt(pu.x,pu.y,T('pBlaster'),CT.mc);camShake=9;}
      else if(pu.type==='life'){lives++;if(hardMode&&advMode)hardWorldLives=Math.max(0,lives);burst(pu.x+12,pu.y+12,'#ff2266',22,5,6);floatTxt(pu.x,pu.y,T('pLife'),'#ff2266');camShake=8;[440,554,659,880].forEach((f,i)=>setTimeout(()=>tone(f,'sine',.14,.3),i*55));}
      else if(pu.type==='boots'){p.boots=true;p.bootsTimer=900;p.jl=Math.max(p.jl,3);burst(pu.x+12,pu.y+12,'#0ff',18,4,6);floatTxt(pu.x,pu.y,T('pBoots'),'#0ff');camShake=7;}
      else if(pu.type==='star'){p.starMode=true;p.starTimer=600;p.inv=601;burst(pu.x+12,pu.y+12,'#ff0',24,5,7);floatTxt(pu.x,pu.y,T('pStar'),'#ff0');camShake=12;startStarMusic();AchTrack.star();}
      else if(pu.type==='fire'){p.fireMode=true;p.iceMode=false;p.elemTimer=1800;burst(pu.x+12,pu.y+12,'#ff4400',18,4,6);floatTxt(pu.x,pu.y,T('pFire'),'#ff4400');camShake=9;}
      else if(pu.type==='ice'){p.iceMode=true;p.fireMode=false;p.elemTimer=1800;burst(pu.x+12,pu.y+12,'#00ffff',18,4,6);floatTxt(pu.x,pu.y,T('pIce'),'#00ffff');camShake=9;}
      // Grabbing a blaster/fire/ice power-up means the robot is at least "normal":
      // clear the broken flag so a later hit drops you to normal, not back to broken.
      if(p.blaster||p.fireMode||p.iceMode)p.broken=false;
      score+=50;
    }
  }

  // ── NEW OBJECTS: Jump Pads, Hazards, Conveyors ──────────────────────────────
  // Jump pads
  for(const jp of jumpPads){
    if(aabb(p,jp)&&p.vy>=0&&p.py+p.h<=jp.y+4){
      p.vy=-jp.power;
      p.y=jp.y-p.h;
      p.jl=2; // reset double jump
      burst(jp.x+jp.w/2,jp.y,'#0ff',14,4,5);
      SFX.jump();
      camShake=6;
    }
  }

  // Hazards (spikes)
  for(const hz of hazards){
    // Во время действия переключателя шипы прячутся и становятся опорой:
    // урон снимается сразу, а платформой они работают в resolveP.
    // Переключатель срабатывает от касания сверху.
    // Вход в бонус-комнату — по касанию.
    if(hz.type==='bonusDoor'){
      if(!hz.used&&aabb(p,hz))enterBonusRoom(hz,p);
      continue;
    }
    // Выход из бонус-комнаты. Срабатывает только изнутри: снаружи до этой
    // двери не дойти (комната стоит за границей мира), но проверка дешевле
    // рассуждений о том, куда игрока может занести.
    if(hz.type==='bonusExit'){
      if(inBonusRoom()&&aabb(p,hz))leaveBonusRoom();
      continue;
    }
    if(hz.type==='spikes'&&aabb(p,hz)&&p.inv<=0){
      doHurtPlayer(false);
      p.vy=-8; // bounce up
      p.vx=p.facing*-3; // bounce back
      return; // exit to prevent multiple hits
    }
  }

  // Conveyors (apply force when on ground)
  if(p.onGnd){
    for(const pl of platforms){
      if(pl.type==='conveyor'&&aabb(p,{x:pl.x,y:pl.y-p.h,w:pl.w,h:pl.h+p.h})){
        p.vx+=pl.conveyorDir*pl.conveyorSpeed*0.5;
      }
    }
  }

  // Enemy touch
  if(p.starMode){
    // Star power: instant kill on any contact
    for(const e of enemies){
      if(!e.alive||!aabb(p,e))continue;
      hurtE(e,99,false,true);score+=200;floatTxt(e.x+e.w/2,e.y,T('starKO'),'#ff0');camShake=5;
    }
  } else {
    for(const e of enemies){
      if(!e.alive||!aabb(p,e))continue;
      if(e._frozen){
        // A frozen enemy is a solid block of ice: you can stand on it, and
        // walking into its side SHOVES it. It then slides away and shatters on
        // the first thing it meets (see _updateIceSlide/_shatterIce), which is
        // what turns the freeze from a pause button into an actual weapon.
        const ox=Math.min(p.x+p.w,e.x+e.w)-Math.max(p.x,e.x);
        const oy=Math.min(p.y+p.h,e.y+e.h)-Math.max(p.y,e.y);
        if(ox>0&&oy>0){
          if(ox<oy){
            const dx=(p.x+p.w/2)-(e.x+e.w/2);
            const dir=dx<0?1:-1;                  // push away from the player
            p.x+=(dx<0?-ox:ox);
            e._iceVX=ICE_PUSH*dir;
            // Скольжение глыбы считает ХОЗЯИН комнаты: у гостя updateEnemies не
            // выполняется, поэтому выставленная здесь скорость никуда бы не
            // поехала — со стороны гостя лёд просто не толкался. Сообщаем толчок
            // хозяину, он двигает глыбу у всех.
            if(window.netActive&&!window.netIsHost&&window.netReportIcePush)
              window.netReportIcePush(e.id,ICE_PUSH*dir);
            if(!e._icePushSfx){e._icePushSfx=1;SFX.hit();}
          } else if(p.y<e.y&&p.vy>=ICE_SMASH_VY){
            // Landing hard on the block smashes it and kills what is inside.
            // A gentle touchdown still just stands on it (the last branch), so
            // the ice keeps working as a platform.
            p.vy=-6;p.onGnd=false;camShake=Math.max(camShake,10);
            floatTxt(e.x+e.w/2,e.y-8,T('iceSmashed'),'#aff');
            _shatterIce(e,true);
          } else if(p.y>e.y&&p.vy<-ICE_SMASH_VY*0.5){
            // Jumping up into it from below cracks it open the same way —
            // headbutting a frozen enemy reads exactly like hitting a block.
            p.vy=1;camShake=Math.max(camShake,8);
            floatTxt(e.x+e.w/2,e.y+e.h+6,T('iceSmashed'),'#aff');
            _shatterIce(e,true);
          } else {
            if(p.y<e.y){p.y-=oy;p.vy=0;p.onGnd=true;}
            else{p.y+=oy;if(p.vy<0)p.vy=0;}
          }
        }
        continue;
      }
      const isStomp=p.vy>0.5&&(p.py+p.h)<=(e.y+e.h*.6);
      if(isStomp){
        // Check if enemy is spiked (can't stomp)
        const cfg=EC[e.type];
        if(cfg&&cfg.moveType==='spiked'){
          // Spiked enemies hurt player on stomp attempt
          if(p.inv<=0&&!p.respawning){
            doHurtPlayer(false);
            p.vy=-10;
            floatTxt(e.x+e.w/2,e.y-20,T('spikedTxt'),'#f44');
            return;
          }
        }else{
          // Normal stomp (clear any stale elemental tag so net reports plain dmg)
          e._netHitElem=null;
          hurtE(e,1,true);p.vy=JV*.52;p.jl=Math.max(p.jl,1);SFX.stomp();
          score+=100;floatTxt(e.x+e.w/2,e.y,'+100','#f0f');camShake=4;
        }
      } else if(p.inv<=0&&!p.respawning&&hurtHit(p,e)){
        // Side/below contact only hurts when fully vulnerable AND on real overlap (not a graze)
        enemyHitPlayer(e);return;
      }
    }
  }
  // Enemy bullets — only when fully vulnerable
  if(p.inv<=0&&!p.starMode){
    for(let i=eBullets.length-1;i>=0;i--){
      if(aabb(p,eBullets[i])){const _sb=eBullets[i];eBullets.splice(i,1);enemyHitPlayer(_sb.src||null);return;}
    }
  } else if(p.starMode){
    // Star mode: destroy enemy bullets on contact without taking damage
    for(let i=eBullets.length-1;i>=0;i--){
      if(aabb(p,eBullets[i])){burst(eBullets[i].x,eBullets[i].y,'#ff0',4,2,3);eBullets.splice(i,1);}
    }
  }

  // Mid-level checkpoint touch
  touchCheckpoints(p);

  // Flag touch — P1 direct, or P2 signalled via the module-level flag signal.
  const _p2FY = _p2FlagSignal; _p2FlagSignal=0;
  const _p1Touch = !flagDone&&p.x+p.w>flagX&&p.x<flagX+30&&p.y+p.h>H-130&&p.y<H-40;
  const _p2Touch = !flagDone&&_p2FY>0;
  if(_p1Touch||_p2Touch)doFlagComplete(_p1Touch, p.y+p.h, _p2Touch, _p2FY);
}

// Persist this client's adventure progress + achievements for the level it just
// finished. Extracted from the level-advance flow so it can run both in single
// player AND the moment a co-op player reaches the flag (before the room advances).
// Публичная сводка прогресса уходит на сервер не чаще раза в две минуты:
// её смотрят друзья на сайте, и обновлять её после каждого уровня незачем —
// а вот отправлять запрос после каждого точно не стоит.
let _statsPubT=0;
function _publishStatsSoon(){
  if(!window.Friends||!window.Friends.publish)return;
  if(window.bbStatsAutoOn&&!window.bbStatsAutoOn())return;   // игрок выключил
  const now=Date.now();
  if(now-_statsPubT<120000)return;
  _statsPubT=now;
  try{window.Friends.publish();}catch(e){}
}

function _persistAdvProgress(){
  savePlaytime();
  const prog=hardMode?advProgHard:advProg;
  if(!prog.done.includes(advLevel))prog.done.push(advLevel);
  // Секретных выходов в игре больше нет. Уже сохранённый prog.secrets не
  // трогаем: он ничему не мешает, а стирать чужую историю прохождения ради
  // убранной механики незачем — на карте эти уровни просто числятся пройденными.
  // Was capped at 100 (the historical "last level") — that silently prevented
  // progress from EVER reaching 101+ even once the secret Prism Anomaly world
  // existed, so finding all 10 Rainbow Shards alone couldn't open it (the
  // level-101 GATE is separately enforced by rainbow collection in
  // worldmap.js's loadProgress(); this cap just needs to not block normal
  // sequential advancement through the secret world's own 10 levels).
  if(advLevel>=prog.max)prog.max=Math.min(advLevel+1,110);
  // Demo build: never let the stored unlock counter climb past the demo's last
  // level, or the world map would open level 11 the moment level 10 is cleared.
  if(window.Demo&&window.Demo.on)prog.max=window.Demo.capMax(prog.max);
  // Монеты уровня: сохраняем лучший сбор, чтобы карта показывала, где ещё
  // есть что взять. Считается от точки старта уровня — см. curLevelCoins().
  recordLevelCoins(advLevel,curLevelCoins(),hardMode);
  // Persist this run's per-level best score, then re-derive the best star
  // rating from the BEST score ever earned (so stars track the kept score).
  recordLevelScore(advLevel,exitLevelScore,hardMode);
  recordStars(advLevel,starsForScore(levelScore(advLevel,hardMode),levelMaxScore),hardMode);
  // Persist the best crystal (data-shard) count for this level.
  recordLevelShards(advLevel,dataShardsGot,hardMode);
  if(hardMode)saveAdvH();else saveAdv();
  _publishStatsSoon();   // витрина для друзей — см. комментарий выше
  // Refresh WorldMap if it's loaded — mark this level done explicitly so the
  // final level (100) reliably shows its checkmark even though it ends in the
  // win/ending flow rather than loading a next level.
  if(window.WorldMap){
    if(window.WorldMap.refresh)window.WorldMap.refresh(hardMode);
    if(window.WorldMap.markCompleted)window.WorldMap.markCompleted(advLevel,hardMode);
  }
  // Survival achievements (no-death streak + whole-world clear)
  AchTrack.levelClear(advLevel%10===0);
  if(advLevel===110)AchTrack.worldClear(10);
  // Check achievements
  if(window.Achievements){
    const worldId=Math.floor((advLevel-1)/10);
    const isBoss=(advLevel%10===0);
    // World completion
    if(advLevel%10===0){
      window.Achievements.unlock('achievement_world_'+worldId);
    }
    // Boss achievements
    if(isBoss){
      const bossCount=prog.done.filter(n=>n%10===0).length;
      if(bossCount===1)window.Achievements.unlock('achievement_boss_0');
      if(bossCount>=5)window.Achievements.unlock('achievement_boss_5');
      if(bossCount>=10)window.Achievements.unlock('achievement_boss_10');
      if(advLevel===110)AchTrack.bossPrism();
    }
    // Hardcore achievements
    if(hardMode){
      if(prog.done.length>=50)window.Achievements.unlock('achievement_hardcore_50');
      if(prog.done.length>=100)window.Achievements.unlock('achievement_hardcore_100');
    }
    // Explorer — every level reachable on the map
    if(prog.max>=100)window.Achievements.unlock('achievement_all_levels_unlocked');
    // Completionist
    if(prog.done.length>=100){
      window.Achievements.unlock('achievement_all_levels_unlocked');
      if(hardMode){
        window.Achievements.unlock('achievement_100_percent_hardcore');
      }else{
        window.Achievements.unlock('achievement_100_percent');
        window.Achievements.unlock('achievement_hardcore_unlock');
      }
    }
  }
}

// Shared level-completion via flag. Called from updatePlayer when P1 is alive,
// or directly when only P2 remains (P1 dead). Params carry each player's touch Y.
function doFlagComplete(_p1Touch,_p1FY,_p2Touch,_p2FY){
    flagDone=true;
    // Обучение — не уровень кампании. Его флаг завершает пролог и ведёт к
    // катсцене, а не к экрану итогов и записи прохождения первого уровня.
    if(window.Tutorial&&window.Tutorial.isActive&&window.Tutorial.isActive()){
      window.Tutorial.finish();
      return;
    }

    // Height bonus — use the best (highest) touch point
    const poleTop=H-130, poleBase=H-40, poleH=poleBase-poleTop;
    let rawTouchY=poleBase;
    if(_p1Touch)rawTouchY=Math.min(rawTouchY,_p1FY);
    if(_p2Touch)rawTouchY=Math.min(rawTouchY,_p2FY);
    const touchY=Math.max(poleTop,Math.min(poleBase,rawTouchY));
    const heightFrac=1-(touchY-poleTop)/poleH; // 0=bottom, 1=top
    let hBonus=0,tier='',tierCol='';
    if(heightFrac>=0.9){hBonus=1000;tier=T('tierPerfect');tierCol='#ff0';}
    else if(heightFrac>=0.65){hBonus=600;tier=T('tierGreat');tierCol='#0ff';}
    else if(heightFrac>=0.35){hBonus=300;tier=T('tierGood');tierCol='#0f8';}
    else{hBonus=50;tier=T('tierBase');tierCol='#888';}

    const tBonus=Math.floor(timeLeft)*2;
    const baseScore=500+(advMode?advLevel:level)*100;
    score+=baseScore+tBonus+hBonus;

    // Star rating (1–3): graded from how much of THIS LEVEL's maximum score the
    // player earned (coins + enemies + flag + bonuses). Replaying to improve the
    // score can raise the rating; it never lowers a previously-earned one.
    const _lvlScore=curLevelScore();
    exitLevelScore=_lvlScore;
    exitStars=starsForScore(_lvlScore,levelMaxScore);
    exitStarsNew=advMode&&(exitStars>levelStars(advLevel,hardMode));

    // Skill achievements: PERFECT flag rating + finishing with over half the time left.
    if(heightFrac>=0.9)AchTrack.perfect();
    if(timMax>0&&timeLeft>=timMax/2)AchTrack.speed();
    AchTrack.score(score);

    exitBonus=hBonus;exitBonusTier=tier;exitBonusCol=tierCol;exitTimeBonus=tBonus;

    // Burst at touch point
    burst(flagX+5,touchY,CT.clr,28+Math.floor(heightFrac*20),5,6);
    if(heightFrac>=0.9){burst(flagX+5,touchY,'#ff0',16,4,6);}
    camShake=14+Math.floor(heightFrac*12);
    SFX.flagReach();

    // Show score breakdown
    floatTxt(flagX+5,touchY-30,`+${hBonus} ${tier}`,tierCol);
    floatTxt(flagX+5,touchY-52,`+${tBonus} TIME`,CT.mc);
    if(hardMode&&advMode)hardWorldLives=lives;  // запас переходит на следующий уровень мира
    cpSave=null;             // level cleared — checkpoint no longer needed

    // Уровень дня: результат уходит в суточную таблицу сразу по флагу, не
    // дожидаясь, пока игрок нажмёт «дальше» на экране итогов. Закроет игру на
    // этом экране — результат всё равно засчитан.
    if(dailyMode&&window.Daily&&window.Daily.finish)window.Daily.finish(score);
    // Путь забега: на устройство — всегда, на сервер — только пройденный
    // уровень и только если это рекорд (проверяет сама база).
    if(window.Ghost)window.Ghost.finish(score,true);

    // ── Network co-op: WAIT for every player to reach the flag ────────────
    // We deliberately do NOT enter the single-player 'levelclear'/exit animation:
    // that halts the host's enemy/boss simulation for players still in the level.
    // Instead persist our own progress, freeze us at the flag, and report our
    // finish. A dim «waiting for players X/N» overlay shows until EVERYONE is done;
    // only then does the host advance the whole room (see network.js).
    if(window.netActive){
      if(advMode) _persistAdvProgress();
      if(player){ player._netDone=true; player.vx=0; player.vy=0; player.inv=Math.max(player.inv||0,999999); }
      if(window.netReportFinish) window.netReportFinish();
      return;
    }

    // ── Single-player / local 2P: classic level-clear + exit run ───────────
    gState='levelclear';
    exitAnim=true;
    exitTimer=0;

    // Что происходит после анимации выхода. Раньше это вызывалось таймером
    // напрямую и уровень сменялся сам; теперь между ними встаёт экран итогов
    // (см. _showLevelResults) — игрок идёт дальше сам.
    const _goNext=()=>{
      _goNextTimer=0;
      if(gState!=='levelclear')return; // aborted by death/pause/menu
      // День — один уровень, следующего за ним нет: возвращаемся к слотам и
      // таблице, где уже виден свежий результат.
      if(dailyMode){
        stopMusic();gState='menu';
        if(window.Daily&&window.Daily.open)window.Daily.open();else showMain();
        return;
      }
      if(advMode){
        _persistAdvProgress();
        const nextN=advLevel+1;
        // Demo build: the level after the demo's last one doesn't exist here.
        // The player just beat the demo — show the end-of-demo screen instead
        // of loading a level that isn't part of this build.
        if(window.Demo&&window.Demo.beyond(nextN)){stopMusic();window.Demo.showEnd();return;}
        // nextN===101 → just cleared level 100 (ARCHON, main story) — always ends
        // in the win screen; Prism Anomaly (101-110) is entered separately from
        // the map, not auto-continued into. nextN>110 → just cleared level 110
        // (PRISM WRAITH, secret ending) — the only other win trigger. Levels
        // 102-110 must fall through to startAdv() like any other level.
        if(nextN===101){stopMusic();showWin();}
        // w10_after (the secret world's closing scene) is already played by
        // killBoss()'s after-boss hook, which fires for every world including
        // this one — so by the time we get here it has been seen and this is
        // just the win screen.
        else if(nextN>110){stopMusic();showSecretWin();}
        else { startAdv(nextN,false); }
      } else {
        level++;CT=THEMES[Math.min(Math.floor((level-1)/10),9)];AchTrack.infinite(level);AchTrack.score(score);
        if(window.InfSave)window.InfSave.save(); // one level is the most a crash can cost
        startInf(false);
      }
    };
    if(_goNextTimer)clearTimeout(_goNextTimer);
    // Экран итогов показывается раньше, чем закончилась бы старая пауза: он и
    // есть остановка, тянуть её ещё секунду незачем.
    _goNextTimer=setTimeout(()=>{
      _goNextTimer=0;
      if(gState!=='levelclear')return;
      if(!_showLevelResults(_goNext))_goNext();
    }, 2600);
}

// Экран итогов уровня. Возвращает false, если показать его нечем (нет модуля) —
// тогда вызывающий просто идёт дальше, как раньше.
function _showLevelResults(goNext){
  // Экран итогов уровня отключается в настройках: кому он мешает темпу, тот
  // уходит на следующий уровень сразу. Прогресс всё равно записывается ниже,
  // поэтому выключение ничего не теряет.
  if(window.gameSettings&&window.gameSettings.showWinScreen===false){
    if(advMode)_persistAdvProgress();
    return false;
  }
  if(!window.Results||typeof window.Results.showLevel!=='function')return false;
  if(window.netActive)return false;   // темп сетевой комнаты задаёт хост
  // Прогресс записываем ДО показа: с этого экрана игрок может уйти на карту, а
  // раньше запись стояла в _goNext, то есть только на пути «дальше». Функция
  // идемпотентна (done через includes, счёт и звёзды — по максимуму).
  if(advMode)_persistAdvProgress();
  if(raf){cancelAnimationFrame(raf);raf=0;}
  const lvNum=advMode?advLevel:level;
  const tierCols={};
  tierCols[T('tierPerfect')]='#ff0';tierCols[T('tierGreat')]='#0ff';
  tierCols[T('tierGood')]='#0f8';tierCols[T('tierBase')]='#888';
  // Общий счёт кампании: банк по всем уровням плюс вклад этого забега.
  let total=score;
  if(advMode){
    const banked=Math.max(levelScore(advLevel,hardMode),exitLevelScore);
    total=totalScore(hardMode)-levelScore(advLevel,hardMode)+banked;
  }
  const data={
    levelNum:dailyMode?null:lvNum,
    title:dailyMode?T('dailyCleared'):'',
    accent:exitBonusCol||tierCols[exitBonusTier]||'#0ff',
    tier:exitBonusTier,
    flagBonus:exitBonus,
    timeBonus:exitTimeBonus,
    coins:coinsTotal|0,
    levelScore:exitLevelScore,
    score:total,
    stars:advMode?exitStars:null,
    starsNew:exitStarsNew,
    subtitle:advMode&&dataShards&&dataShards.length
      ? T('crystals')+': '+dataShardsGot+' / '+dataShards.length : '',
  };
  const leave=()=>{
    stopMusic();
    gState='menu';
    if(dailyMode){ if(window.Daily&&window.Daily.open)window.Daily.open(); else showMain(); }
    else if(advMode){
      const open=hardMode?showMapH:showMap;
      if(typeof open==='function')open(); else showMain();
    }
    else { if(window.InfSave)window.InfSave.save(); showMain(); }
  };
  const actions={
    // Если состояние почему-то уже не 'levelclear', goNext() молча ничего не
    // сделает и игрок остался бы перед пустым экраном — уводим его на карту.
    next:()=>{ if(gState==='levelclear')goNext(); else leave(); },
    // «Ещё раз» в дне — новая попытка того же слота: попыток сколько угодно, в
    // таблицу идёт лучшая.
    retry:()=>{ if(dailyMode){ if(window.Daily&&window.Daily.replay)window.Daily.replay(true); }
                else if(advMode)startAdv(advLevel,false); else startInf(false); },
    leaveLabel:dailyMode?T('dailyTitle'):advMode?T('map'):T('menu'),
    leave:leave,
  };
  window.Results.showLevel(data,actions);
  return true;
}

// ── PLAYER 2 UPDATE (arrow keys + ./, for shoot) ──
function updatePlayer2(){
  if(!twoPlayer||!player2)return;
  const p=player2;
  // Пока экран гаснет или проявляется — управление забираем и держим
  // игрока неуязвимым: он не должен вслепую уехать или получить удар.
  if(bonusLocked()){ p.vx=0; p.vy=0; p.inv=Math.max(p.inv||0,6); return; }

  // ── FALL RESPAWN SMOOTH ANIMATION (P2)
  if(p.fallRespawning){
    p.fallRespawnT++;
    const dur=72;
    const t=Math.min(p.fallRespawnT/dur,1);
    const ease=t*t*(3-2*t);
    p.x=p.fallRespawnSX;
    p.y=p.fallRespawnSY+(p.lastGndY-p.fallRespawnSY)*ease;
    p.vx=0;p.vy=0;
    if(t>=1){
      p.fallRespawning=false;
      p.x=p.lastGndX;p.y=p.lastGndY;
      p.respawning=true;p.respawnTimer=120;
      SFX.respawn();burst(p.x+p.w/2,p.y,'#f44',10,3,4);
      setTimeout(()=>{if(player2)floatTxt(player2.x+player2.w/2,player2.y-20,T('p2LivesLeft',lives2),'#f84');},200);
    }
    if(p.inv>0)p.inv--;
    return;
  }

  if(p.respawning){
    p.respawnTimer--;
    if(p.respawnTimer<=0){p.respawning=false;p.inv=120;}
    else{p.inv=p.respawnTimer+1;}
  }

  // P2 keys come from the rebindable control map (settings → CONTROLS).
  const c2=(window.gameSettings&&window.gameSettings.controls)||{};
  const L=K[c2.p2Left],R=K[c2.p2Right];
  const J=K[c2.p2Jump];
  const S=K[c2.p2Shoot];

  const psp2=(p.starMode?PSP*1.4:p.boots?PSP*1.55:PSP)*(window.Status?Status.speedMul(p):1);
  if(L){p.vx=Math.max(p.vx-1.3,-psp2);p.facing=-1;}
  else if(R){p.vx=Math.min(p.vx+1.3,psp2);p.facing=1;}
  else{
    const friction=(levelMods.slippery||(window.Status&&Status.slippery(p)))?0.92:0.7;
    p.vx*=friction;if(Math.abs(p.vx)<.1)p.vx=0;
  }

  // Wind modifier for P2
  if(levelMods.wind)p.vx+=levelMods.wind;

  if(J&&!p._jh&&p.jl>0){
    // EMP fries the thrusters: the ground jump still works, the air jump does not.
    if(window.Status&&Status.noDoubleJump(p)&&!p.onGnd&&p.jl<=1){
      p._jh=true;if(SFX.back)SFX.back();
      floatTxt(p.x+p.w/2,p.y-6,T('stEmpBlocked'),'#ffee44');
    } else {
      if(p.jl===2)SFX.jump();else SFX.dblJump();
      p.vy=(JV+(p.jl<2?-.9:0))*(window.Status?Status.jumpMul(p):1);
      // Чит бесконечных прыжков: запас не тратится, поэтому прыгать можно
      // хоть всю дорогу вверх. Сила, звук и эффект — как у обычного прыжка.
      if(!infiniteJump)p.jl--;
      p._jh=true;
      if(typeof AchTrack!=='undefined')AchTrack.jump();
      burst(p.x+p.w/2,p.y+p.h,CT.mc,6,2,3);
    }
  }
  if(!J)p._jh=false;
  if(!J&&p.vy<-3)p.vy*=.88;

  // Gravity with modifiers for P2
  const GRAV=levelMods.lowGravity?0.3:levelMods.highGravity?0.9:G;
  p.vy=Math.min(p.vy+GRAV,MXY);
  p.px=p.x;p.py=p.y;
  const wasGnd=p.onGnd;
  resolveP(p);

  // Check collision with closed doors (maze archetype) for P2
  for(const door of doors){
    if(!door.open&&aabb(p,door)){
      if(p.px<door.x){
        p.x=door.x-p.w;
        p.vx=Math.min(0,p.vx);
      }else if(p.px>door.x+door.w){
        p.x=door.x+door.w;
        p.vx=Math.max(0,p.vx);
      }
    }
  }

  if(!wasGnd&&p.onGnd)SFX.land();
  if(!exitAnim)p.x=Math.max(0,Math.min(p.x,worldW-p.w));
  if(p.onGnd){p.lastGndX=p.x;p.lastGndY=p.y;if(p.boots)p.jl=Math.max(p.jl,3);}
  if(p.y>H+60){
    if(godMode){
      // God mode: teleport back to last ground spot without losing a life
      const tx=Math.max(0,Math.min(p.lastGndX,worldW-p.w));
      p.x=tx;p.y=p.lastGndY;p.vx=0;p.vy=0;
      burst(p.x+p.w/2,p.y+p.h/2,'#f44',12,3,4);floatTxt(p.x+p.w/2,p.y-10,'✦','#f44');
      return;
    }
    doHurtPlayer2(true);return;
  }

  if(p.inv>0)p.inv--;
  if(p.starMode){p.starTimer--;if(p.starTimer<=0){p.starMode=false;p.inv=0;}}
  // Blaster / fire / ice are permanent for P2 too — stripped only on an enemy hit.
  if(p.blaster)p.bTimer=1800;
  if(p.fireMode||p.iceMode)p.elemTimer=1800;
  if(p.boots){p.bootsTimer--;if(p.bootsTimer<=0){p.boots=false;p.bootsTimer=0;if(p.jl>2)p.jl=2;}}
  if(p.sCD>0)p.sCD--;

  if(S&&p.sCD<=0&&window.Status&&Status.blasterBlocked(p)){
    // EMP: weapon systems down. Short cooldown so the click is acknowledged
    // (sparks + text) instead of spamming every frame the key is held.
    p.sCD=26;if(SFX.back)SFX.back();
    burst(p.x+p.w/2,p.y+p.h/2,'#ffee44',6,2.2,3);
    floatTxt(p.x+p.w/2,p.y-6,T('stEmpBlocked'),'#ffee44');
  } else if(S&&p.sCD<=0){
    if(p.blaster){
      p.sCD=18;SFX.shoot();
      const bx=p.facing>0?p.x+p.w:p.x-14;
      const bType = p.fireMode ? 'fire' : (p.iceMode ? 'ice' : null);
      const bCol  = p.fireMode ? '#ff4400' : (p.iceMode ? '#00ffff' : '#f44');
      pBullets.push({x:bx,y:p.y+p.h/2-4,w:14,h:8,vx:BSP*p.facing,dist:0,max:480,type:bType,col:bCol});
      burst(p.x+p.w/2,p.y+p.h/2,bCol,4,1.8,3);
    } else if(p.fireMode||p.iceMode){
      p.sCD=20;
      const px=p.x+p.w/2,py=p.y+p.h/2;
      const spd=9;
      const vx=(p.facing||1)*spd, vy=0;
      if(p.fireMode){fireBalls.push({x:px-8,y:py-8,w:16,h:16,vx,vy,life:900,owner:2});tone(180,'sawtooth',.06,.1);}
      else{iceBalls.push({x:px-8,y:py-8,w:16,h:16,vx,vy,life:900,owner:2});tone(700,'sine',.06,.1);}
    }
  }

  p.trail.unshift({x:p.x+p.w/2,y:p.y+p.h/2});if(p.trail.length>16)p.trail.pop();
  p.animTk++;if(Math.abs(p.vx)>.4&&p.animTk%7===0)p.animFr=(p.animFr+1)%4;else if(Math.abs(p.vx)<.4)p.animFr=0;

  // Screen boundary walls in 2-player mode - prevent player2 from going off-screen
  const leftBound=camX+10;
  const rightBound=camX+W-p.w-10;
  if(p.x<leftBound){p.x=leftBound;p.vx=Math.max(0,p.vx);}
  if(p.x>rightBound){p.x=rightBound;p.vx=Math.min(0,p.vx);}

  // Coins
  for(const c of coins)if(!c.got&&aabb(p,c)){c.got=true;score+=10;coinsTotal++;AchTrack.coin();SFX.coin();burst(c.x+7,c.y+7,'#ffd700',5,2,3);if(window.Juice)window.Juice.pickup(c.x+7-camX,c.y+7,'coin');else floatTxt(c.x,c.y,'+10','#ffd700');_checkCoinHp(c.x,c.y,p);}

  // Power-ups
  for(const pu of powerups){
    if(!pu.got&&aabb(p,pu)){pu.got=true;SFX.powerup();
      if(pu.type==='blast'){p.blaster=true;p.bTimer=1800;burst(pu.x+12,pu.y+12,'#f44',18,4,6);floatTxt(pu.x,pu.y,T('p2Blaster'),'#f44');camShake=9;}
      else if(pu.type==='life'){lives2++;burst(pu.x+12,pu.y+12,'#ff2266',22,5,6);floatTxt(pu.x,pu.y,T('p2Life'),'#ff2266');camShake=8;[440,554,659,880].forEach((f,i)=>setTimeout(()=>tone(f,'sine',.14,.3),i*55));}
      else if(pu.type==='boots'){p.boots=true;p.bootsTimer=900;p.jl=Math.max(p.jl,3);burst(pu.x+12,pu.y+12,'#0ff',18,4,6);floatTxt(pu.x,pu.y,T('p2Boots'),'#0ff');camShake=7;}
      else if(pu.type==='star'){p.starMode=true;p.starTimer=600;p.inv=601;burst(pu.x+12,pu.y+12,'#ff0',24,5,7);floatTxt(pu.x,pu.y,T('p2Star'),'#ff0');camShake=12;startStarMusic();AchTrack.star();}
      else if(pu.type==='fire'){p.fireMode=true;p.iceMode=false;p.elemTimer=1800;burst(pu.x+12,pu.y+12,'#ff4400',18,4,6);floatTxt(pu.x,pu.y,T('p2Fire'),'#ff4400');camShake=9;}
      else if(pu.type==='ice'){p.iceMode=true;p.fireMode=false;p.elemTimer=1800;burst(pu.x+12,pu.y+12,'#00ffff',18,4,6);floatTxt(pu.x,pu.y,T('p2Ice'),'#00ffff');camShake=9;}
      if(p.blaster||p.fireMode||p.iceMode)p.broken=false; // power-up restores at least "normal" stage
      score+=50;
    }
  }

  // ── NEW OBJECTS for P2: Jump Pads, Hazards, Conveyors ──────────────────────
  // Jump pads
  for(const jp of jumpPads){
    if(aabb(p,jp)&&p.vy>=0&&p.py+p.h<=jp.y+4){
      p.vy=-jp.power;
      p.y=jp.y-p.h;
      p.jl=2;
      burst(jp.x+jp.w/2,jp.y,'#0ff',14,4,5);
      SFX.jump();
      camShake=6;
    }
  }

  // Hazards (spikes)
  for(const hz of hazards){
    if(hz.type==='spikes'&&aabb(p,hz)&&p.inv<=0){
      doHurtPlayer2(false);
      p.vy=-8;
      p.vx=p.facing*-3;
      return; // exit to prevent multiple hits
    }
  }

  // Conveyors
  if(p.onGnd){
    for(const pl of platforms){
      if(pl.type==='conveyor'&&aabb(p,{x:pl.x,y:pl.y-p.h,w:pl.w,h:pl.h+p.h})){
        p.vx+=pl.conveyorDir*pl.conveyorSpeed*0.5;
      }
    }
  }

  // Enemy touch
  if(p.starMode){
    for(const e of enemies){
      if(!e.alive||!aabb(p,e))continue;
      hurtE(e,99,false,true);score+=200;floatTxt(e.x+e.w/2,e.y,T('starKO'),'#ff0');camShake=5;
    }
  } else {
    for(const e of enemies){
      if(!e.alive||!aabb(p,e))continue;
      if(e._frozen){
        // A frozen enemy is a solid block of ice: you can stand on it, and
        // walking into its side SHOVES it. It then slides away and shatters on
        // the first thing it meets (see _updateIceSlide/_shatterIce), which is
        // what turns the freeze from a pause button into an actual weapon.
        const ox=Math.min(p.x+p.w,e.x+e.w)-Math.max(p.x,e.x);
        const oy=Math.min(p.y+p.h,e.y+e.h)-Math.max(p.y,e.y);
        if(ox>0&&oy>0){
          if(ox<oy){
            const dx=(p.x+p.w/2)-(e.x+e.w/2);
            const dir=dx<0?1:-1;                  // push away from the player
            p.x+=(dx<0?-ox:ox);
            e._iceVX=ICE_PUSH*dir;
            // Скольжение глыбы считает ХОЗЯИН комнаты: у гостя updateEnemies не
            // выполняется, поэтому выставленная здесь скорость никуда бы не
            // поехала — со стороны гостя лёд просто не толкался. Сообщаем толчок
            // хозяину, он двигает глыбу у всех.
            if(window.netActive&&!window.netIsHost&&window.netReportIcePush)
              window.netReportIcePush(e.id,ICE_PUSH*dir);
            if(!e._icePushSfx){e._icePushSfx=1;SFX.hit();}
          } else if(p.y<e.y&&p.vy>=ICE_SMASH_VY){
            // Landing hard on the block smashes it and kills what is inside.
            // A gentle touchdown still just stands on it (the last branch), so
            // the ice keeps working as a platform.
            p.vy=-6;p.onGnd=false;camShake=Math.max(camShake,10);
            floatTxt(e.x+e.w/2,e.y-8,T('iceSmashed'),'#aff');
            _shatterIce(e,true);
          } else if(p.y>e.y&&p.vy<-ICE_SMASH_VY*0.5){
            // Jumping up into it from below cracks it open the same way —
            // headbutting a frozen enemy reads exactly like hitting a block.
            p.vy=1;camShake=Math.max(camShake,8);
            floatTxt(e.x+e.w/2,e.y+e.h+6,T('iceSmashed'),'#aff');
            _shatterIce(e,true);
          } else {
            if(p.y<e.y){p.y-=oy;p.vy=0;p.onGnd=true;}
            else{p.y+=oy;if(p.vy<0)p.vy=0;}
          }
        }
        continue;
      }
      const isStomp=p.vy>0.5&&(p.py+p.h)<=(e.y+e.h*.6);
      if(isStomp){
        hurtE(e,1,true);p.vy=JV*.52;p.jl=Math.max(p.jl,1);SFX.stomp();
        score+=100;floatTxt(e.x+e.w/2,e.y,'+100','#f44');camShake=4;
      } else if(p.inv<=0&&!p.respawning&&hurtHit(p,e)){
        enemyHitPlayer2(e);return;
      }
    }
  }
  if(p.inv<=0&&!p.starMode){
    for(let i=eBullets.length-1;i>=0;i--){
      if(aabb(p,eBullets[i])){const _sb=eBullets[i];eBullets.splice(i,1);enemyHitPlayer2(_sb.src||null);return;}
    }
  } else if(p.starMode){
    for(let i=eBullets.length-1;i>=0;i--){
      if(aabb(p,eBullets[i])){burst(eBullets[i].x,eBullets[i].y,'#ff0',4,2,3);eBullets.splice(i,1);}
    }
  }

  // Mid-level checkpoint touch
  touchCheckpoints(p);

  // Flag (P2 can also finish level)
  if(!flagDone&&p.x+p.w>flagX&&p.x<flagX+30&&p.y+p.h>H-130&&p.y<H-40){
    if(player){
      // P1 alive — signal updatePlayer() which owns the completion this frame.
      _p2FlagSignal=p.y+p.h;
    } else {
      // P1 is dead — updatePlayer() returns early, so finish the level here.
      doFlagComplete(false, 0, true, p.y+p.h);
    }
  }
}

// ── RESPAWN SYSTEM: lose a life but stay on level ──
function doHurtPlayer(fromFall=false){
  // Урон обрывает серию — иначе комбо копится само собой и ничего не значит.
  if(window.Juice)window.Juice.comboBreak();
  if(godMode)return;
  if(!player)return; // Player already dead, nothing to do
  // Наблюдатель в сетевой комнате уже вне уровня: ни таймер, ни камера босса не
  // должны отнимать у него жизни дальше в минус и сыпать частицы на месте гибели.
  if(window.netActive&&player._netDone)return;
  const p=player;
  // Reset the darkness-modifier mask on every hit/death so a respawn never
  // starts from a stale (previous-frame) light mask — see drawDarknessOverlay().
  if(_darkCtx) _darkCtx.clearRect(0,0,W,H);
  // ── Network co-op ─────────────────────────────────────────────
  // A hit must NEVER drop into the single-player game-over screen here: that
  // reloads the level locally (startAdv/startInf) and desyncs the room, and if the
  // HOST died the simulation it drives would freeze for every guest. Instead lose a
  // life and respawn in place / at the checkpoint, keeping gState==='playing'.
  if(window.netActive){
    if(infiniteLives)lives=Math.max(lives,3);
    lives--;if(hardMode&&advMode)hardWorldLives=Math.max(0,lives);
    AchTrack.death();
    SFX.playerHurt();camShake=12;
    p.broken=false;
    if(lives<=0){
      // Out of lives in co-op. This used to quietly set lives back to 1 and
      // revive forever, which made death online mean nothing at all — you could
      // fall into the same pit for an hour with no consequence. It also can't
      // simply show the single-player Game Over: that reloads the level locally
      // and, worse, the room's "everyone reach the flag" tally would wait for a
      // player who can never arrive.
      //
      // Instead you are OUT FOR THIS LEVEL: frozen as a spectator, counted as
      // done so the room advances, and back with fresh lives next level.
      lives=0;
      p.vx=0;p.vy=0;
      burst(p.x+p.w/2,p.y+p.h/2,'#f44',22,5,6);camShake=16;
      if(window.netReportEliminated)window.netReportEliminated();
      return;
    } else if(fromFall){
      const rx=Math.max(0,Math.min(p.cpX!=null?p.cpX:p.lastGndX,worldW-p.w));
      const ry=(p.cpX!=null?p.cpY:p.lastGndY);
      p.x=rx;p.y=ry;p.vx=0;p.vy=0;
    } else {
      p.vx=0;p.vy=-2;
    }
    burst(p.x+p.w/2,p.y+p.h/2,'#f84',14,4,5);
    floatTxt(p.x+p.w/2,p.y,T('ouch'),'#f84');
    p.respawning=true;p.respawnTimer=120;p.inv=Math.max(p.inv||0,120);
    SFX.respawn();
    return;
  }
  if(infiniteLives)lives=Math.max(lives,3);
  lives--;if(hardMode&&advMode)hardWorldLives=Math.max(0,lives);
  AchTrack.death();
  if(lives<=0){
    // In 2-player mode, only trigger game over if BOTH players are dead
    if(twoPlayer && player2 && lives2 > 0){
      // Player 1 is out, but Player 2 is still alive
      floatTxt(p.x+p.w/2,p.y-10,T('p1Out'),'#4af');
      burst(p.x+p.w/2,p.y+p.h/2,'#4af',20,5,5);
      SFX.playerHurt();camShake=12;
      player=null;  // Remove player 1 from the game
      return;
    }
    // ── CO-OP: running out of lives must NOT open the single-player Game
    // Over screen. Its RETRY restarts the level locally, which desyncs you
    // from the room — and, worse, the room's "everyone must reach the flag"
    // tally never hears from you again, so the other players stand at the flag
    // forever. Report elimination instead: you spectate until the level ends
    // and come back with fresh lives on the next one.
    if(window.netActive){
      burst(p.x+p.w/2,p.y+p.h/2,'#f44',20,5,5);camShake=18;SFX.playerHurt();
      if(window.netReportEliminated)window.netReportEliminated();
      return;
    }
    // Single player mode OR both players dead - trigger game over
    stopMusic();
    burst(p.x+p.w/2,p.y+p.h/2,'#f44',20,5,5);camShake=18;SFX.playerHurt();
    gState='gameover';
  // Смерть в обучении обязана возвращать в обучение: раньше retry звал
  // startAdv(advLevel) и игрока выбрасывало в первый уровень кампании.
  const _inTut=!!(window.Tutorial&&window.Tutorial.isActive&&window.Tutorial.isActive());
    // Уровень дня: жизни кончились — попытка закрыта, и её счёт идёт в таблицу.
    // Умереть здесь не значит «ноль»: пройденная половина уровня всё равно
    // чего-то стоит, а следующая попытка перекроет результат, если выйдет лучше.
    if(dailyMode&&window.Daily&&window.Daily.finish)window.Daily.finish(score);
    if(window.Ghost)window.Ghost.finish(score,false);   // свой путь сохраняем и после смерти
    const retry=_inTut?()=>{SFX.menu();window.Tutorial.start();}
                :dailyMode?()=>{SFX.menu();if(window.Daily&&window.Daily.replay)window.Daily.replay(true);}
                :advMode?()=>{SFX.menu();score=Math.max(0,score-200);_outOfLives();}
                       :()=>{SFX.menu();startInf(true);};
    setTimeout(()=>{showGameover(retry);},400);
    return;
  }
  SFX.playerHurt();camShake=12;
  p.broken=false; // on retry the robot respawns fresh as "normal"

  // Спокойный режим: ПАДЕНИЕ не обрывает заход экраном поражения. Жизнь всё так
  // же отнимается, но игрок мягко возвращается на тот край, откуда прыгнул, —
  // ради этого режим и делался. Возврат жил ниже, в общей ветке fromFall, но до
  // неё в соло никогда не доходило: проверка ниже уводила одиночную игру на
  // экран поражения раньше. Удар врага сюда не попадает намеренно — он
  // по-прежнему заканчивает заход. Хардкор режим не смягчает: там свой запас
  // жизней на весь мир, и поблажка сломала бы его смысл.
  const _easyFall=fromFall&&!hardMode&&!!(window.gameSettings&&window.gameSettings.gameMode==='easy');

  // Single-player: spending a life ends the attempt on a defeat screen. RETRY
  // resumes the SAME level with the lives that remain (e.g. 3 → 2). When the
  // last life is gone the block above already handled the final Game Over.
  if(!twoPlayer&&!window.netActive&&!_easyFall){
    stopMusic();
    burst(p.x+p.w/2,p.y+p.h/2,'#f44',18,5,5);camShake=16;
    gState='gameover';
    const _inTut2=!!(window.Tutorial&&window.Tutorial.isActive&&window.Tutorial.isActive());
    const retry=_inTut2?()=>{SFX.menu();window.Tutorial.start();}
                // Жизнь потеряна, но попытка та же: уровень дня перезапускается
                // с накопленным счётом, как уровень кампании.
                :dailyMode?()=>{SFX.menu();if(window.Daily&&window.Daily.replay)window.Daily.replay(false);}
                :advMode?()=>{SFX.menu();startAdv(advLevel,false);}
                       :()=>{SFX.menu();startInf(false);};
    setTimeout(()=>{showGameover(retry,T('gameOver'),T('livesLeft',lives));},450);
    return;
  }

  if(fromFall){
    // Smooth fall respawn: animate player dropping back from above onto last ground spot
    const tx=Math.max(0,Math.min(p.cpX!=null?p.cpX:p.lastGndX,worldW-p.w));
    const ty=p.cpX!=null?p.cpY:p.lastGndY;
    burst(tx+p.w/2,ty,'#f84',14,4,5);
    floatTxt(tx+p.w/2,ty-10,T('ouch'),'#f84');
    p.x=tx;p.y=ty-160;        // start above the landing spot
    p.fallRespawnSX=tx;
    p.fallRespawnSY=ty-160;
    p.lastGndX=tx;p.lastGndY=ty; // anchor
    p.vx=0;p.vy=0;
    p.fallRespawnT=0;
    p.fallRespawning=true;
    p.inv=300;                  // protected during + after animation
  } else {
    // Enemy/bullet hit: stay exactly in place, brief stun bounce + invincibility
    burst(p.x+p.w/2,p.y+p.h/2,'#f84',14,4,5);
    floatTxt(p.x+p.w/2,p.y,T('ouch'),'#f84');
    p.vx=0;p.vy=-2;             // tiny upward pop
    p.respawning=true;p.respawnTimer=120;
    SFX.respawn();
    setTimeout(()=>{floatTxt(p.x+p.w/2,p.y-20,T('livesLeft',lives),'#f80');},300);
  }
}

function doHurtPlayer2(fromFall=false){
  if(godMode||!player2)return;
  const p=player2;
  if(_darkCtx) _darkCtx.clearRect(0,0,W,H);
  if(infiniteLives)lives2=Math.max(lives2,3);
  lives2--;
  SFX.playerHurt();camShake=10;
  if(lives2<=0){
    // Player 2 is out - check if player 1 is also dead
    floatTxt(p.x+p.w/2,p.y-10,T('p2Out'),'#f44');
    burst(p.x+p.w/2,p.y+p.h/2,'#f44',20,5,5);
    player2=null;

    // If player 1 is also dead or doesn't exist, trigger game over
    if(!player || lives<=0){
      if(window.netActive){
        if(window.netReportEliminated)window.netReportEliminated();
        return;
      }
      stopMusic();
      gState='gameover';
      const retry=advMode?()=>{SFX.menu();score=Math.max(0,score-200);_outOfLives();}
                         :()=>{SFX.menu();startInf(true);};
      setTimeout(()=>{showGameover(retry);},400);
    }
    return;
  }
  p.broken=false; // P2 lost a life → respawn as a fresh "normal" robot

  if(fromFall){
    const tx=Math.max(0,Math.min(p.cpX!=null?p.cpX:p.lastGndX,worldW-p.w));
    const ty=p.cpX!=null?p.cpY:p.lastGndY;
    burst(tx+p.w/2,ty,'#f44',14,4,5);
    floatTxt(tx+p.w/2,ty-10,T('ouch'),'#f84');
    p.x=tx;p.y=ty-160;
    p.fallRespawnSX=tx;
    p.fallRespawnSY=ty-160;
    p.lastGndX=tx;p.lastGndY=ty;
    p.vx=0;p.vy=0;
    p.fallRespawnT=0;
    p.fallRespawning=true;
    p.inv=300;
  } else {
    burst(p.x+p.w/2,p.y+p.h/2,'#f44',14,4,5);
    floatTxt(p.x+p.w/2,p.y,T('ouch'),'#f84');
    p.vx=0;p.vy=-2;
    p.respawning=true;p.respawnTimer=120;
    SFX.respawn();
    setTimeout(()=>{if(player2)floatTxt(player2.x+player2.w/2,player2.y-20,T('p2LivesLeft',lives2),'#f84');},300);
  }
}

// ── ENEMY HIT → ROBOT STAGE DOWNGRADE ──────────────
// An enemy/boss/enemy-bullet hit knocks the robot down one stage instead of
// instantly costing a life:  powered (blaster/fire/ice) → normal → broken.
// Only a hit taken while already broken costs a life (via doHurtPlayer).
// Falls and the timer running out still cost a life directly (they call
// doHurtPlayer/doHurtPlayer2 with fromFall as before).
function _stageHitFX(p,col){
  burst(p.x+p.w/2,p.y+p.h/2,col,14,4,5);
  p.vx=0;p.vy=-2;          // small stun pop, stays in place
  p.inv=90;                // brief flashing i-frames so one touch = one stage
  SFX.playerHurt();camShake=10;
}
// `src` is the enemy (or an enemy-bullet's owner type) that landed the hit.
// It decides which status effect the hit leaves behind — see assets/status.js.
function enemyHitPlayer(src){
  if(godMode||!player)return;
  const p=player;
  if(src&&window.Status)Status.apply(p,src);
  if(p.blaster||p.fireMode||p.iceMode){
    // powered → normal: strip the power-up
    p.blaster=false;p.bTimer=0;p.fireMode=false;p.iceMode=false;p.elemTimer=0;
    floatTxt(p.x+p.w/2,p.y,T('ouch'),'#f80');
    _stageHitFX(p,'#f84');
  } else if(!p.broken){
    // normal → broken
    p.broken=true;
    floatTxt(p.x+p.w/2,p.y,T('ouch'),'#f80');
    _stageHitFX(p,'#f84');
  } else {
    // broken → lose a life (existing respawn handles game-over etc.)
    doHurtPlayer(false);
  }
}
function enemyHitPlayer2(src){
  if(godMode||!player2)return;
  const p=player2;
  if(src&&window.Status)Status.apply(p,src);
  if(p.blaster||p.fireMode||p.iceMode){
    p.blaster=false;p.bTimer=0;p.fireMode=false;p.iceMode=false;p.elemTimer=0;
    floatTxt(p.x+p.w/2,p.y,T('ouch'),'#f80');
    _stageHitFX(p,'#f44');
  } else if(!p.broken){
    p.broken=true;
    floatTxt(p.x+p.w/2,p.y,T('ouch'),'#f80');
    _stageHitFX(p,'#f44');
  } else {
    doHurtPlayer2(false);
  }
}
// Toggle the extra main-menu buttons (Achievements / Settings) that live inside #mainOv.
// Game-over and win screens reuse that overlay but should only show their own button.
function _menuExtras(show){
  // Settings + Exit only appear on the real main menu (hidden on game-over/win).
  // Тот же оверлей #mainOv служит экранами победы и поражения, поэтому всё, что
  // относится только к главному меню, гасится здесь. «Что нового» добавили в
  // меню позже и в этот список не внесли — кнопка торчала на итоговых экранах.
  // «Рекорды» тут нет намеренно: это угловая кнопка рядом с настройками, она
  // сама следит за тем, показано ли главное меню (см. leaderboard.js).
  for(const id of ['settingsBtn','exitBtn','whatsNewBtn']){
    const el=document.getElementById(id);
    if(el)el.style.display=show?'':'none';
  }
}
function showGameover(retry,titleTxt,subTxt){
  // Game over ENDS an infinite run. Keeping the save would let the player
  // continue past death, which is the one thing an endless mode cannot allow.
  if(window.InfSave&&!advMode&&!dailyMode)window.InfSave.clear();
  if(raf){cancelAnimationFrame(raf);raf=0;}
  // Рекорд забега банкуем в кампанию или в бесконечный — но не в день: у него
  // своя суточная таблица, и подмешивать его в общий рекорд нельзя.
  if(!dailyMode)recordScore(advMode?'adventure':'infinite',score);
  // Экран итогов вместо главного меню с перекрашенным заголовком: видно, чем
  // кончилась попытка, и есть куда уйти кроме «Заново» — раньше выхода на карту
  // и в меню отсюда не было вовсе.
  // Экран поражения тоже отключается отдельно: тогда попытка
  // перезапускается сразу, без промежуточного окна.
  if(window.gameSettings&&window.gameSettings.showGameOverScreen===false){
    if(typeof retry==='function'){setTimeout(retry,250);return;}
  }
  if(window.Results&&typeof window.Results.showGameOver==='function'){
    hideAll();
    // В обучении номер уровня не показываем: «УРОВЕНЬ 1 ПРОВАЛЕН» — неправда,
    // первый уровень кампании при этом даже не начинался.
    const _tutNow=!!(window.Tutorial&&window.Tutorial.isActive&&window.Tutorial.isActive());
    window.Results.showGameOver({
      title:titleTxt||T('gameOver'),
      sub:(subTxt!=null)?subTxt:(_tutNow?T('prologueFailed'):dailyMode?T('dailyFailed'):advMode?T('levelFailed',advLevel):T('betterLuck')),
      levelNum:(_tutNow||dailyMode)?0:(advMode?advLevel:level),
      coins:coinsTotal|0,
      score:score,
      best:dailyMode?0:(bestRecords[advMode?'adventure':'infinite']|0),
    },{
      retry:retry,
      leaveLabel:dailyMode?T('dailyTitle'):advMode?T('map'):T('menu'),
      leave:()=>{
        if(dailyMode){ if(window.Daily&&window.Daily.open)window.Daily.open(); else showMain(); }
        else if(advMode){
          const open=hardMode?showMapH:showMap;
          if(typeof open==='function')open(); else showMain();
        } else showMain();
      },
      menu:(advMode||dailyMode)?(()=>showMain()):null,
    });
    return;
  }
  // Clear every in-game layer first. Without this the score/lives/timer HUD and
  // the level-modifier banner stayed painted on top of the Game Over screen
  // (hideAll() is what normally takes them down, and nothing called it here).
  hideAll();
  const h1=$main.querySelector('h1'),sub=$main.querySelector('.ovSub'),btn=document.getElementById('mainBtn');
  h1.textContent=titleTxt||T('gameOver');
  h1.style.color='#f44';h1.style.textShadow='0 0 18px #f44';
  sub.removeAttribute('data-i18n');
  sub.textContent=(subTxt!=null)?subTxt:(advMode?T('levelFailed',advLevel):T('betterLuck'));
  recordScore(advMode?'adventure':'infinite',score); // bank the high score
  document.getElementById('mainScore').textContent=T('scoreLabel',score);document.getElementById('mainScore').style.display='block';
  btn.removeAttribute('data-i18n');
  btn.textContent=T('retry');btn.onclick=retry;
  _menuExtras(false); // only the RETRY button on the Game Over screen
  document.querySelector('#mainOv .ovLegend').style.display='none';$main.style.display='flex';setMenuBotMode('defeat');startMenuBot();
}
function showWin(){
  if(raf){cancelAnimationFrame(raf);raf=0;}
  hideAll(); // same as showGameover(): take the in-game HUD/banner down first
  const h1=$main.querySelector('h1'),sub=$main.querySelector('.ovSub'),btn=document.getElementById('mainBtn');
  h1.textContent=T('youWin');
  h1.style.color='#ff0';h1.style.textShadow='0 0 18px #ff0';
  sub.removeAttribute('data-i18n');
  sub.textContent=T('allComplete');
  recordScore('adventure',score); // bank the adventure high score
  document.getElementById('mainScore').textContent=T('finalScore',score);document.getElementById('mainScore').style.display='block';
  btn.removeAttribute('data-i18n');
  // Комната прошла игру — на карту уходим уже без неё (см. netLeaveIfActive).
  btn.textContent='🗺 '+T('map').replace(/^🗺\s*/,'');btn.onclick=()=>{SFX.menu();netLeaveIfActive();showMap();};
  _menuExtras(false); // win screen: only the MAP button
  document.querySelector('#mainOv .ovLegend').style.display='none';$main.style.display='flex';setMenuBotMode('idle');startMenuBot();
}

// ════════════════════════════════════════════════
//  UPDATE — ENEMIES
// ════════════════════════════════════════════════
function updateEnemies(){
  // Network: only the host simulates enemy AI; guests get authoritative state via
  // applyEnemiesSync(). Guard here (not only via the network.js wrap) so frozen-enemy
  // behaviour is correct even if the global re-bind doesn't take.
  if(window.netActive && !window.netIsHost) return;
  // Grab the player list once for the whole enemy loop (it's already cached by
  // activePlayersAll() — see #17 — so this is just avoiding the extra function-call
  // + typeof check per enemy for the reduce done inside nearestPlayer()).
  const _epPlayers=(typeof activePlayersAll==='function')?activePlayersAll():activePlayers();
  function _nearestOf(wx){
    if(!_epPlayers.length)return player;
    let best=_epPlayers[0],bd=Math.abs(best.x+best.w/2-wx);
    for(let k=1;k<_epPlayers.length;k++){
      const q=_epPlayers[k],d=Math.abs(q.x+q.w/2-wx);
      if(d<bd){bd=d;best=q;}
    }
    return best;
  }
  for(const e of enemies){
    if(!e.alive)continue;e.a+=.1;if(e.flash>0)e.flash--;if(e._blockFx>0)e._blockFx--;e.px=e.x;e.py=e.y;
    // ── ICE FREEZE ─────────────────────────────
    if(e._frozen){
      e._freezeT--;
      // Cracking progress 0..1 — drives the fracture lines drawn on the block.
      // The ice used to simply blink out of existence when the timer expired.
      e._iceCrack=1-Math.max(0,e._freezeT)/Math.max(1,e._freezeMax||e._freezeT||1);
      _updateIceSlide(e);
      if(e._freezeT<=0){
        _shatterIce(e,false);
      }
      continue; // пропускаем остальное движение
    }
    const mt=e.moveType;

    // ── WALK / SHIELD ──────────────────────────
    if(mt==='walk'||mt==='shield'){
      e.x+=e.vx;
      if(e.x<=e.pMin){e.x=e.pMin;e.vx=Math.abs(e.vx);}
      if(e.x+e.w>=e.pMax){e.x=e.pMax-e.w;e.vx=-Math.abs(e.vx);}
      e.vy=Math.min(e.vy+G,MXY);eLand(e);
    }
    // ── SHOOT ──────────────────────────────────
    else if(mt==='shoot'){
      if(EC[e.type].spd>0){e.x+=e.vx;if(e.x<=e.pMin){e.x=e.pMin;e.vx=Math.abs(e.vx);}if(e.x+e.w>=e.pMax){e.x=e.pMax-e.w;e.vx=-Math.abs(e.vx);}}
      e.vy=Math.min(e.vy+G,MXY);eLand(e);
      e.sCD--;const np=_nearestOf(e.x);const dx=np.x-e.x;
      if(e.sCD<=0&&Math.abs(dx)<380&&!np.respawning){
        e.sCD=130+Math.floor(Math.random()*60);
        eBullets.push({x:e.x+(dx>0?e.w:0),y:e.y+e.h/2-4,w:10,h:8,vx:EBS*Math.sign(dx),dist:0,max:380,src:e.type});
        burst(e.x+e.w/2,e.y+e.h/2,e.glow,4,2,3);
      }
    }
    // ── BOUNCE ─────────────────────────────────
    else if(mt==='bounce'){
      e.bCD--;if(e.bCD<=0&&e.onGnd){e.vy=JV*.72;e.vx=(Math.random()-.5)*3.5;e.bCD=62+Math.floor(Math.random()*50);}
      e.x+=e.vx;e.vx*=.98;if(e.x<e.pMin||e.x+e.w>e.pMax)e.vx*=-1;
      e.vy=Math.min(e.vy+G,MXY);e.onGnd=false;eLand(e);
    }
    // ── FLOAT ──────────────────────────────────
    else if(mt==='float'){
      e.fpH+=.032;e.x+=e.vx;
      if(e.x<e.pMin)e.vx=Math.abs(e.vx);if(e.x+e.w>e.pMax)e.vx=-Math.abs(e.vx);
      e.y=e.fbX_y+(Math.sin(e.fpH)*e.fAmp*.44);
    }
    // ── CHARGE — walks normally, then dashes at player ──
    else if(mt==='charge'){
      e.vy=Math.min(e.vy+G,MXY);eLand(e);
      if(e.charging){
        e.chargeT--;e.x+=e.vx*4.5;
        if(e.x<e.pMin){e.x=e.pMin;e.charging=false;}
        if(e.x+e.w>e.pMax){e.x=e.pMax-e.w;e.charging=false;}
        if(e.chargeT<=0){e.charging=false;e.chargeCD=100+Math.floor(Math.random()*60);}
      } else {
        e.x+=e.vx;
        if(e.x<=e.pMin){e.x=e.pMin;e.vx=Math.abs(e.vx);}
        if(e.x+e.w>=e.pMax){e.x=e.pMax-e.w;e.vx=-Math.abs(e.vx);}
        e.chargeCD--;
        if(e.chargeCD<=0){
          const np=_nearestOf(e.x);
          e.vx=(np.x>e.x?1:-1)*EC[e.type].spd;
          e.charging=true;e.chargeT=32;
          burst(e.x+e.w/2,e.y,e.glow,6,2.5,3);
        }
      }
    }
    // ── ORBIT — float in ellipse around spawn point ──
    else if(mt==='orbit'){
      e.orbitAngle+=0.038;
      e.x=e.fbX+Math.cos(e.orbitAngle)*(e.fAmp*1.2);
      const newY=e.fbX_y+Math.sin(e.orbitAngle*0.6)*e.fAmp*.4;
      e.y=Math.max(20,Math.min(H-80,newY));
    }
    // ── ZIGZAG — float but reverses vertical direction periodically ──
    else if(mt==='zigzag'){
      e.fpH+=.04;e.x+=e.vx;
      if(e.x<e.pMin)e.vx=Math.abs(e.vx);if(e.x+e.w>e.pMax)e.vx=-Math.abs(e.vx);
      e.zigCD--;if(e.zigCD<=0){e.fAmp*=-1;e.zigCD=28+Math.floor(Math.random()*35);}
      const newY=e.fbX_y+Math.sin(e.fpH)*Math.abs(e.fAmp)*(e.fAmp>0?1:-1)*.4;
      e.y=Math.max(20,Math.min(H-80,newY));
    }
    // ── SPIN — hovers, rotates, fires in two directions ──
    else if(mt==='spin'){
      e.fpH+=.032;
      e.x=e.fbX+Math.cos(e.fpH)*e.fAmp*.25;
      const newY=e.fbX_y+Math.sin(e.fpH*0.7)*16;
      e.y=Math.max(20,Math.min(H-80,newY));
      e.sCD--;
      if(e.sCD<=0){
        e.sCD=90+Math.floor(Math.random()*45);
        for(const dir of[-1,1])
          eBullets.push({x:e.x+e.w/2,y:e.y+e.h/2,w:8,h:8,vx:EBS*dir,vy:-1,dist:0,max:320,round:true});
        burst(e.x+e.w/2,e.y+e.h/2,e.glow,5,2,3);
      }
    }

    // ── Conveyors carry ground enemies too ──────────────────────────────────
    // Only ground-bound enemies (those that use eLand) are affected; flyers
    // (float/orbit/zigzag/spin) ignore belts. Clamp to the enemy's patrol range
    // so it can't be shoved off its platform.
    if(e.onGnd && (mt==='walk'||mt==='shield'||mt==='shoot'||mt==='charge'||mt==='bounce')){
      for(const pl of platforms){
        if(pl.type!=='conveyor')continue;
        if(e.x+e.w>pl.x && e.x<pl.x+pl.w && Math.abs((e.y+e.h)-pl.y)<=4){
          e.x+=pl.conveyorDir*pl.conveyorSpeed*0.5;
          if(e.pMin!=null && e.x<e.pMin)e.x=e.pMin;
          if(e.pMax!=null && e.x+e.w>e.pMax)e.x=e.pMax-e.w;
          break;
        }
      }
    }
  }
}

// Shield interaction: bullets deflect off shielded enemies
// (handled in updateBullets — shielded enemies take no bullet damage)

// ── Elemental affinity ──────────────────────────────────────────────────────
// A creature made of fire cannot be set on fire, and one made of ice cannot be
// frozen. Derived from the world prefix so a new enemy added to a world picks
// up the right immunity for free, with a couple of explicit exceptions for
// enemies whose element does not match their world.
const _ELEM_EXCEPT={ff_demon:'fire',lv_armored:'fire',ic_spiker:'ice'};
function enemyElement(e){
  const t=(e&&e.type)||'';
  if(_ELEM_EXCEPT[t])return _ELEM_EXCEPT[t];
  if(t.indexOf('lv_')===0)return 'fire';
  if(t.indexOf('ic_')===0)return 'ice';
  return null;
}
function enemyImmuneTo(e,elem){return enemyElement(e)===elem;}
// Bosses follow their world: the Lava world's boss shrugs off fire, the Ice
// world's shrugs off freezing.
function bossElement(b){
  if(!b)return null;
  if(b.worldId===2)return 'fire';
  if(b.worldId===3)return 'ice';
  return null;
}
function _immuneFx(x,y,elem){
  floatTxt(x,y,T('noEffect'),elem==='fire'?'#f96':'#9df');
  burst(x,y,elem==='fire'?'#f96':'#9df',5,2,3);
}

// ── Frozen enemies as pushable ice blocks ───────────────────────────────────
// A frozen enemy is a solid block of ice. Walking into it shoves it along the
// ground; it then slides until it hits something (a wall, a solid platform edge
// or another enemy) and shatters, or runs off a ledge and falls out of the
// world. Anything it collides with on the way is destroyed too, so freezing a
// runner in a corridor becomes a usable weapon rather than just a pause button.
// ICE_SMASH_VY: how fast you must be falling for a landing to smash the block
// instead of standing on it. Tuned so a deliberate drop from roughly one
// platform height breaks it, while stepping across from the side does not —
// otherwise the ice would stop working as a platform at all.
const ICE_PUSH=3.4, ICE_FRICTION=0.985, ICE_SMASH_VY=5.5;
// В Ледяных пещерах пол сам по себе скользкий, поэтому глыба там едет заметно
// дальше. Разные значения трения — единственное, чем мир влияет на физику льда:
// так ледяной мир ощущается ледяным без отдельных механик.
const ICE_FRICTION_SLICK=0.995;
// Порог скорости падения, за которым глыба раскалывается о землю. Падение с
// уступа на соседнюю платформу она переживает, полёт с высоты — нет.
const ICE_FALL_SHATTER_VY=11;
function _iceSlickWorld(){
  const lv=(typeof advMode!=='undefined'&&advMode)?advLevel:level;
  return worldIdx(lv)===3;
}
// Глыба, рухнувшая сверху, давит всё, на что приземлилась. Замороженный
// раскалывается вместе с ней — так одна сосулька запускает цепочку.
function _iceCrush(e){
  for(const o of enemies){
    if(o===e||!o.alive)continue;
    if(e.x+e.w<o.x||e.x>o.x+o.w)continue;
    if(Math.abs((e.y+e.h)-o.y)>18)continue;
    if(o._frozen)_shatterIce(o,true);
    else hurtE(o,99,false,true);
  }
}
function _updateIceSlide(e){
  // ── ВЕС ──────────────────────────────────────────────────────────────────
  // Гравитация действует всегда, а не только после толчка. Раньше падение было
  // привязано к горизонтальной скорости, из-за чего замороженный летун
  // оставался висеть ровно там, где его застал шар, — глыба льда в воздухе.
  const fellVY=e.vy||0;
  e.vy=Math.min(fellVY+G,MXY);
  const wasAir=!e.onGnd;
  eLand(e);
  if(e.y>H+80){
    e.alive=false;e._frozen=false;score+=50;
    floatTxt(e.x+e.w/2,H-60,'+50','#8ff');
    return;
  }
  if(wasAir&&e.onGnd&&fellVY>=ICE_FALL_SHATTER_VY){
    // Удар о землю с высоты — глыба не выдерживает и давит всё под собой.
    _iceCrush(e);
    camShake=Math.max(camShake,9);
    _shatterIce(e,true);
    return;
  }
  if(wasAir&&e.onGnd&&fellVY>=ICE_FALL_SHATTER_VY*0.5){
    // Пережила падение, но приложилась: короткий отскок и крошка льда, чтобы
    // было видно вес. Пружинить лёд не должен, поэтому отскок гасится сильно.
    e.vy=-fellVY*0.22;e.onGnd=false;
    burst(e.x+e.w/2,e.y+e.h,'#aaffff',5,2,3);
    camShake=Math.max(camShake,4);
  }
  // ── СКОЛЬЖЕНИЕ ───────────────────────────────────────────────────────────
  // Толчок задаётся в updatePlayer, где перекрытие уже разведено; здесь только
  // движение по инерции.
  if(!e._iceVX){return;}
  e._iceVX*=_iceSlickWorld()?ICE_FRICTION_SLICK:ICE_FRICTION;
  if(Math.abs(e._iceVX)<0.15){e._iceVX=0;e._icePushSfx=0;return;}
  const nx=e.x+e._iceVX;
  // Wall / solid platform in the way → shatter against it.
  for(const pl of platforms){
    if(pl.gone||pl.type==='ground')continue;
    if(nx+e.w<pl.x||nx>pl.x+pl.w)continue;
    if(e.y+e.h<=pl.y+2||e.y>=pl.y+pl.h)continue;
    _shatterIce(e,true);return;
  }
  if(nx<0||nx+e.w>worldW){_shatterIce(e,true);return;}
  // Another enemy in the way → both go.
  for(const o of enemies){
    if(o===e||!o.alive)continue;
    if(nx+e.w<o.x||nx>o.x+o.w||e.y+e.h<o.y||e.y>o.y+o.h)continue;
    if(o._frozen){
      // Бильярд: удар передаёт импульс дальше по цепочке, а ударившая глыба
      // рассыпается. Ряд замороженных врагов в коридоре сносится одним толчком.
      o._iceVX=e._iceVX*0.85;o._icePushSfx=1;
      _shatterIce(e,true);return;
    }
    hurtE(o,99,false);
    _shatterIce(e,true);return;
  }
  e.x=nx;
  // Падение с уступа отрабатывает гравитация в начале функции — отдельная
  // проверка опоры здесь больше не нужна.
}
// Break the ice. `killed` = the block was smashed (enemy dies with it); otherwise
// the freeze simply timed out and the enemy is released.
function _shatterIce(e,killed){
  const cx=e.x+e.w/2, cy=e.y+e.h/2;
  e._frozen=false;e._iceVX=0;e._icePushSfx=0;e._iceCrack=0;
  burst(cx,cy,'#aaffff',killed?16:8,killed?4:2.5,4);
  if(typeof SFX!=='undefined'&&SFX.hit)SFX.hit();
  if(killed){
    hurtE(e,99,false,true);
  } else {
    e.spd=e._origSpd||1;
    e.vx=(Math.random()>.5?1:-1)*e.spd;
    // Пока враг был глыбой, его могло утащить толчком и уронить с высоты.
    // Оба параметра его движения считаются от точки, где он был заморожен, и
    // без переноса он рывком вернулся бы туда же: летун — на прежнюю высоту,
    // ходок — к своему участку патрулирования.
    if(e.fbX_y!==undefined){e.fbX_y=e.y;e.vy=0;}
    if(e.pMin!==undefined&&e.pMax!==undefined&&(e.x<e.pMin||e.x+e.w>e.pMax)){
      const span=Math.max(e.w,e.pMax-e.pMin);
      e.pMin=Math.max(0,e.x-span*0.5);
      e.pMax=Math.min(worldW,e.pMin+span);
    }
  }
}
// `pierce` marks damage the shield was never meant to stop. The shield's job is
// "bullets bounce off, stomp it instead" — it is NOT a general invulnerability:
//   • star mode is the game's I-win button and must kill anything it touches
//   • a frozen enemy shattering against a wall is already destroyed — the ice
//     block breaking is the kill, there is nothing left for a shield to guard
//   • fire burning ON the enemy is past the shield by definition
// Without this every one of those silently did nothing and printed BLOCKED.
function hurtE(e,dmg,stomped=false,pierce=false){
  // Shield: only stomp damage works (bullets deflect)
  if(e.shielded&&!stomped&&!pierce){
    // Rate-limited feedback. This runs from updatePlayer(), i.e. once per frame
    // for as long as the player overlaps the enemy — unthrottled it fired 30
    // popups and 30 hit sounds per second.
    if(!e._blockFx||e._blockFx<=0){
      e._blockFx=24;
      burst(e.x+e.w/2,e.y+e.h/2,'#888',4,2,3);
      floatTxt(e.x+e.w/2,e.y-4,T('blocked'),'#888');SFX.hit();
    }
    return;
  }
  e.hp-=dmg;e.flash=16;
  // Shield breaks when stomped
  if(e.shielded&&stomped)e.shielded=false;
  if(e.hp<=0){
    e.alive=false;SFX.enemyDie();burst(e.x+e.w/2,e.y+e.h/2,e.glow,16,4,5);
    // Вес удара и серия: замирание на сорок миллисекунд плюс счёт комбо.
    if(window.Juice){window.Juice.hitStop(45);window.Juice.combo();}
    // Серия убийств повышает награду — иначе комбо остаётся украшением.
    const _cm=window.Juice?window.Juice.comboMul():1;
    const pts=Math.round((EC[e.type]?EC[e.type].score:100)*(hardMode?2:1)*_cm);
    floatTxt(e.x+e.w/2,e.y-4,stomped?T('stompTxt'):T('shotTxt'),e.glow);score+=pts;AchTrack.kill(stomped);

    // Split enemy: spawn 2 smaller enemies on death
    const cfg=EC[e.type];
    if(cfg&&cfg.moveType==='split'){
      // Spawn 2 smaller enemies (use a basic walker from same world)
      const worldId=Math.floor((advLevel||level-1)/10);
      const pool=WORLD_POOLS[Math.min(worldId,9)];
      if(pool&&pool.length>0){
        const smallType=pool[0]; // use first enemy (walker)
        setTimeout(()=>{
          if(gState==='playing'){
            mkEnemy(smallType,e.x-20,e.y,null,Math.random);
            mkEnemy(smallType,e.x+20,e.y,null,Math.random);
            burst(e.x,e.y,e.glow,12,3,4);
          }
        },100);
      }
    }
  }
  else{SFX.hit();burst(e.x+e.w/2,e.y+e.h/2,'#fff',5,2.5,3);floatTxt(e.x+e.w/2,e.y-4,T('hit'),'#fff');}
}

// ── Projectile helpers (bounce + screen culling) ─────────────────────────────
// A player projectile despawns only once it has left the visible screen — the
// world rect [camX .. camX+W] × [0 .. H]. The margin lets it clear the edge first.
function _projOffScreen(b){
  const M=48;
  return b.x+b.w<camX-M||b.x>camX+W+M||b.y>H+M||b.y+b.h<-M;
}
// Reflect a moving box `b` off a static rect `r` (minimum-translation-vector):
// resolve along the axis of least overlap, flip that velocity component (scaled
// by `rest`), and snap the box to the surface so it can't re-stick next frame.
function _bounce(b,r,rest){
  const oL=(b.x+b.w)-r.x,oR=(r.x+r.w)-b.x,oT=(b.y+b.h)-r.y,oB=(r.y+r.h)-b.y;
  if(Math.min(oL,oR)<Math.min(oT,oB)){
    if(oL<oR)b.x=r.x-b.w;else b.x=r.x+r.w;
    b.vx=-b.vx*rest;
  }else{
    if(oT<oB)b.y=r.y-b.h;else b.y=r.y+r.h;
    b.vy=-(b.vy||0)*rest;
  }
}

// ── Checkpoints ──────────────────────────────────────────────────────────────
// When a player overlaps an untaken checkpoint flag, activate it: recolour it to
// that player's robot colour, and make it the fall-respawn anchor from now on.
function touchCheckpoints(p){
  if(!p)return;
  for(const cp of checkpoints){
    if(cp.taken)continue;
    // Generous touch box (covers pole + banner) so it's easy to trigger.
    if(aabb(p,{x:cp.x-12,y:cp.y-4,w:cp.w+40,h:cp.h+14})){
      cp.taken=true;cp.anim=0;
      // Full 6-digit hex so we can safely append alpha ('00'/'66') for gradients.
      // For HSL network players, derive a hex from the visor colour.
      if(p.colorScheme&&typeof p.colorScheme==='object'){
        // Use the robot's OWN body colour (not the complementary visor hue) so the
        // checkpoint clearly takes the toucher's colour, brightened a touch to glow.
        const {h,s,l}=p.colorScheme;
        cp.color=`hsl(${h},${s}%,${Math.min(l+8,72)}%)`;
      } else {
        cp.color=(p.colorScheme==='red')?'#ff4d4d':'#44aaff';
      }
      // Touching a checkpoint repairs a broken robot back to its normal stage.
      if(p.broken){p.broken=false;floatTxt(p.x+p.w/2,p.y-30,T('repaired'),'#4f8');}
      const rx=Math.round(cp.x+cp.w/2-p.w/2),ry=cp.baseY-p.h;
      // Becomes the respawn anchor: pit-fall respawn (per player) + level spawn.
      p.cpX=rx;p.cpY=ry;
      spawnX=rx;spawnY=ry;
      // Adventure levels are deterministically seeded, so a death-retry rebuilds
      // this exact checkpoint — remember it to resume here instead of level start.
      // Also snapshot the crystals (data-shards) collected so far, so dying after
      // the checkpoint keeps them instead of resetting the level's crystal count.
      if(advMode){
        cpSave={lvl:advLevel,color:cp.color,shards:dataShards.filter(s=>s.got).map(s=>s.id),shardsGot:dataShardsGot,
          // Снимок мира на момент касания: убитые враги остаются убитыми, а
          // собранные монеты — собранными. Уровень строится детерминированно по
          // номеру, поэтому порядок элементов при пересборке тот же, и хватает
          // флагов по позициям.
          coins:coins.map(c=>!!c.got),
          enemies:enemies.map(e=>e.alive===false),
          powerups:powerups.map(u=>!!u.got)};
        // Persist the crystals reached up to this checkpoint right away (keeps the
        // best, so they're saved even if the player dies before finishing).
        if(typeof recordLevelShards==='function')recordLevelShards(advLevel,dataShardsGot,hardMode);
        if(window.WorldMap&&window.WorldMap.refresh)window.WorldMap.refresh(hardMode);
      }
      // Strong, obvious activation feedback.
      SFX.powerup();if(SFX.coin)SFX.coin();camShake=10;
      burst(cp.x+cp.w/2,cp.y+8,cp.color,26,4.5,6);
      burst(cp.x+cp.w/2,cp.y+8,'#fff',14,3,5);
      setTimeout(()=>{if(checkpoints.includes(cp))burst(cp.x+cp.w/2,cp.y+8,cp.color,6,2.5,4);},90);
      floatTxt(cp.x+cp.w/2,cp.y-16,T('checkpointTxt'),cp.color);
      // Co-op: tell everyone who took this checkpoint so it shows the SAME
      // (toucher's) colour on every screen.
      if(window.netActive && window.netWsSend){
        window.netWsSend({type:'game_event', event:'checkpoint', data:{idx:checkpoints.indexOf(cp), color:cp.color}});
      }
    }
  }
}
// Drawn in world space (inside the camera translate), like the goal flag.
// Checkpoint is a futuristic holo-beacon: a metal post with an energy ring and a
// floating hologram core that lights up in the player's colour when activated.
function drawCheckpoints(){
  for(const cp of checkpoints){
    const px=cp.x+cp.w/2,poleTop=cp.y,poleBase=cp.baseY;
    const col=cp.taken?cp.color:'#5a6a7a';
    ctx.save();

    // ── Base platform (tech pad) ──
    ctx.shadowBlur=0;
    ctx.fillStyle='#1a1f2e';
    ctx.fillRect(px-14,poleBase-4,28,6);
    ctx.fillStyle=cp.taken?col:'#2a3142';
    ctx.fillRect(px-14,poleBase-4,28,2);
    // base glow accents
    if(cp.taken){
      ctx.shadowColor=col;ctx.shadowBlur=10;
      ctx.fillStyle=col;
      ctx.fillRect(px-12,poleBase-2,3,2);ctx.fillRect(px+9,poleBase-2,3,2);
      ctx.shadowBlur=0;
    }

    // ── Central post ──
    const grad=ctx.createLinearGradient(px-3,0,px+3,0);
    grad.addColorStop(0,'#3a4254');grad.addColorStop(0.5,'#5a6478');grad.addColorStop(1,'#2a3242');
    ctx.fillStyle=grad;
    ctx.fillRect(px-3,poleTop+4,6,poleBase-poleTop-4);
    // post segment lines
    ctx.strokeStyle='#1a1f2e';ctx.lineWidth=1;
    for(let sy=poleTop+12;sy<poleBase-4;sy+=10){
      ctx.beginPath();ctx.moveTo(px-3,sy);ctx.lineTo(px+3,sy);ctx.stroke();
    }

    if(!cp.taken){
      // ── Inactive: dim sensor orb + idle ring ──
      const pulse=0.5+0.5*Math.sin(tick*.04);
      // idle energy ring
      ctx.strokeStyle='#4a5568';ctx.lineWidth=1.5;ctx.globalAlpha=0.4+pulse*0.2;
      ctx.beginPath();ctx.arc(px,poleTop+2,7,0,Math.PI*2);ctx.stroke();
      ctx.globalAlpha=1;
      // dark core orb
      ctx.fillStyle='#1a2030';ctx.beginPath();ctx.arc(px,poleTop+2,5,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='#3a4558';ctx.lineWidth=1;ctx.stroke();
      // faint inner dot
      ctx.fillStyle='#4a5a6a';ctx.globalAlpha=0.5+pulse*0.5;
      ctx.beginPath();ctx.arc(px,poleTop+2,2,0,Math.PI*2);ctx.fill();
      ctx.globalAlpha=1;
    }else{
      // ── Active: glowing holo-core + rotating energy rings + floating particles ──
      cp.anim+=_animK;
      const a=cp.anim;
      const bob=Math.sin(a*.06)*2;        // gentle vertical float
      const coreY=poleTop+2+bob;
      const pulse=0.6+0.4*Math.sin(a*.1);

      // outer rotating ring (energy halo)
      ctx.shadowColor=col;ctx.shadowBlur=14;
      ctx.strokeStyle=col;ctx.lineWidth=2;ctx.globalAlpha=0.8;
      for(let r=0;r<2;r++){
        const rot=a*.05+r*Math.PI;
        const rw=9,rh=4;
        ctx.beginPath();
        ctx.ellipse(px,coreY,rw,rh,rot,0,Math.PI*2);
        ctx.stroke();
      }
      ctx.globalAlpha=1;

      // glowing core sphere
      const cg=ctx.createRadialGradient(px,coreY,0,px,coreY,7);
      cg.addColorStop(0,'#ffffff');
      cg.addColorStop(0.4,col);
      cg.addColorStop(1,colAlpha(col,0));
      ctx.shadowColor=col;ctx.shadowBlur=18*pulse;
      ctx.fillStyle=cg;
      ctx.beginPath();ctx.arc(px,coreY,7,0,Math.PI*2);ctx.fill();

      // bright center
      ctx.shadowBlur=8;
      ctx.fillStyle='#fff';
      ctx.beginPath();ctx.arc(px,coreY,2.5*pulse,0,Math.PI*2);ctx.fill();

      // rising holo particles
      ctx.shadowBlur=6;
      for(let i=0;i<3;i++){
        const ph=(a*.5+i*40)%60;
        const py=coreY-ph*0.4;
        const pa=1-ph/60;
        const pox=Math.sin((a*.04)+i*2.1)*5;
        ctx.globalAlpha=pa*0.8;
        ctx.fillStyle=col;
        ctx.fillRect(px+pox-1,py-1,2,2);
      }
      ctx.globalAlpha=1;

      // light beam shooting up
      ctx.shadowBlur=0;
      const bg=ctx.createLinearGradient(px,coreY-30,px,coreY);
      bg.addColorStop(0,colAlpha(col,0));
      bg.addColorStop(1,colAlpha(col,0.4));
      ctx.fillStyle=bg;
      ctx.beginPath();
      ctx.moveTo(px-2,coreY);ctx.lineTo(px+2,coreY);
      ctx.lineTo(px+5,coreY-30);ctx.lineTo(px-5,coreY-30);
      ctx.closePath();ctx.fill();
    }
    ctx.restore();
  }
}

// ════════════════════════════════════════════════
//  UPDATE — BULLETS
// ════════════════════════════════════════════════
function updateBullets(){
  // Player bullets — reverse iteration for safe splice
  for(let i=pBullets.length-1;i>=0;i--){
    const b=pBullets[i];
    b.x+=b.vx;b.y+=(b.vy||0);
    // Despawn only once off the player's screen. A long safety cap keeps a bullet
    // trapped between two walls from accumulating forever.
    if(b.life===undefined)b.life=600;
    if(--b.life<=0||_projOffScreen(b)){pBullets.splice(i,1);continue;}
    let killed=false;
    // Bounce off terrain (solid blocks + platforms) instead of dying
    let bounced=false;
    for(const bl of blocks){if(bl.solid&&aabb(b,bl)){_bounce(b,bl,1);bounced=true;break;}}
    if(!bounced)for(const pl of platforms){if(!pl.gone&&aabb(b,pl)){_bounce(b,pl,1);bounced=true;break;}}
    if(bounced){burst(b.x+b.w/2,b.y+b.h/2,b.col||CT.mc,3,1.5,2);continue;}
    // Hit enemy
    for(const e of enemies){
      if(!e.alive)continue;
      if(aabb(b,e)){
        if(e.shielded){
          // Deflect bullet off shield
          burst(b.x,b.y+4,'#aaa',4,2,2);floatTxt(b.x,b.y-8,T('blocked'),'#aaa');
          pBullets.splice(i,1);killed=true;break;
        }
        // Tag the element so the network guest-damage redirect can forward it.
        e._netHitElem=(b.type==='fire'||b.type==='ice')?b.type:null;
        hurtE(e,1,false);
        // Спецэффекты fire/ice пуль
        // Network guest: the burning/frozen flags are host-authoritative and
        // arrive via enemies_sync a moment after hurtE() reports the hit above.
        // Mutating them locally here as well used to race that incoming sync —
        // the very next enemies_sync tick (sent before the host had processed
        // our hit) would overwrite our optimistic flag back to false, so the
        // fire/ice effect visibly "reset" right after appearing. Guests now only
        // show the instant visual feedback (burst/text) and let the real status
        // flags arrive from the host, exactly like hp already does.
        const _elemIsLocal=!(window.netActive&&!window.netIsHost);
        if(b.type==='fire'){
          burst(b.x,b.y+4,'#ff4400',8,3,4);
          // Поджог: DOT горения, как у огненного шара
          if(e.alive&&_elemIsLocal){
            if(enemyImmuneTo(e,'fire')){_immuneFx(e.x+e.w/2,e.y-4,'fire');}
            else if(!e._burning){e._burning=true;e._burnT=0;e._burnTotal=300;if(typeof AchTrack!=='undefined')AchTrack.burn();}
            else e._burnTotal=Math.max(e._burnTotal,120);
          }
          floatTxt(e.x+e.w/2,e.y-4,T('burnTxt'),'#ff4400');
        } else if(b.type==='ice'){
          burst(b.x,b.y+4,'#00ffff',8,3,4);
          // Заморозка: замедляем врага на 90 тиков
          if(_elemIsLocal){
            if(e.alive&&enemyImmuneTo(e,'ice')){_immuneFx(e.x+e.w/2,e.y-4,'ice');}
            else if(e.alive&&!e._frozen){e._frozen=true;e._freezeT=90;e._freezeMax=90;e._iceCrack=0;e._iceVX=0;e._origSpd=e.spd||1;if(typeof AchTrack!=='undefined')AchTrack.freeze();}
            e.spd=0;e.vx=0;
          }
          floatTxt(e.x+e.w/2,e.y-4,T('frozenTxt'),'#00ffff');
        }
        pBullets.splice(i,1);killed=true;break;
      }
    }
    // (no need for else — killed flag handles it)
  }
  // Enemy bullets
  for(let i=eBullets.length-1;i>=0;i--){
    const b=eBullets[i];b.x+=b.vx;b.y+=(b.vy||0);b.dist+=Math.hypot(b.vx,b.vy||0);
    if(b.dist>b.max){eBullets.splice(i,1);continue;}
    let killed=false;
    for(const bl of blocks){if(bl.solid&&aabb(b,bl)){burst(b.x,b.y+4,'#f44',3,1.5,2);eBullets.splice(i,1);killed=true;break;}}
    if(killed)continue;
  }
}

// ════════════════════════════════════════════════
//  FIRE / ICE BALLS
// ════════════════════════════════════════════════
function updateFireIceBalls(){
  // — Fire balls: DOT 1 урон/сек на врагов и боссов
  for(let i=fireBalls.length-1;i>=0;i--){
    const b=fireBalls[i];
    b.x+=b.vx;b.y+=b.vy;b.vy+=0.08;b.life--;
    if(b.life<=0||_projOffScreen(b)){fireBalls.splice(i,1);continue;}
    let hit=false;
    // Отскок от платформ/блоков (вместо исчезновения)
    let bounced=false;
    for(const pl of platforms){if(!pl.gone&&aabb(b,pl)){_bounce(b,pl,.7);bounced=true;break;}}
    if(!bounced)for(const bl of blocks){if(bl.solid&&aabb(b,bl)){_bounce(b,bl,.7);bounced=true;break;}}
    if(bounced){burst(b.x+b.w/2,b.y+b.h/2,'#ff6600',3,1.5,2);continue;}
    // Враги
    for(const e of enemies){
      if(!e.alive||e._frozen)continue;
      if(aabb(b,e)){
        if(enemyImmuneTo(e,'fire')){_immuneFx(e.x+e.w/2,e.y-4,'fire');}
        else if(!e._burning){e._burning=true;e._burnT=0;e._burnTotal=300;if(typeof AchTrack!=='undefined')AchTrack.burn();}
        else e._burnTotal=Math.max(e._burnTotal,120);
        fireBalls.splice(i,1);hit=true;
        burst(b.x,b.y,'#ff6600',4,2,3);
        floatTxt(e.x+e.w/2,e.y-8,'🔥','#ff4400');
        break;
      }
    }
    if(hit)continue;
    // Босс
    if(boss&&boss.alive&&aabb(b,boss)){
      if(bossElement(boss)==='fire'){_immuneFx(boss.x+boss.w/2,boss.y-8,'fire');}
      else if(!boss._burning){boss._burning=true;boss._burnT=0;boss._burnTotal=300;}
      else boss._burnTotal=Math.max(boss._burnTotal,120);
      fireBalls.splice(i,1);
      burst(b.x,b.y,'#ff6600',5,2,3);
      floatTxt(boss.x+boss.w/2,boss.y-8,T('burnTxt'),'#ff4400');
    }
  }
  // — Ice balls: заморозка врага на 5 сек (300 тиков), босс замедляется
  for(let i=iceBalls.length-1;i>=0;i--){
    const b=iceBalls[i];
    b.x+=b.vx;b.y+=b.vy;b.vy+=0.08;b.life--;
    if(b.life<=0||_projOffScreen(b)){iceBalls.splice(i,1);continue;}
    let hit=false;
    // Отскок от платформ/блоков (вместо исчезновения)
    let bounced=false;
    for(const pl of platforms){if(!pl.gone&&aabb(b,pl)){_bounce(b,pl,.7);bounced=true;break;}}
    if(!bounced)for(const bl of blocks){if(bl.solid&&aabb(b,bl)){_bounce(b,bl,.7);bounced=true;break;}}
    if(bounced){burst(b.x+b.w/2,b.y+b.h/2,'#aaffff',3,1.5,2);continue;}
    for(const e of enemies){
      if(!e.alive||e._frozen)continue;
      if(aabb(b,e)){
        // The ball is spent either way — an ice creature absorbs it rather than
        // letting it fly on and freeze whatever is behind.
        iceBalls.splice(i,1);hit=true;
        burst(b.x,b.y,'#aaffff',5,2,3);
        if(enemyImmuneTo(e,'ice')){
          _immuneFx(e.x+e.w/2,e.y-4,'ice');
        } else {
          e._frozen=true;e._freezeT=300;e._freezeMax=300;e._iceCrack=0;e._iceVX=0;e._origSpd=e._origSpd||e.spd||1;e.vx=0;
          if(typeof AchTrack!=='undefined')AchTrack.freeze();
          floatTxt(e.x+e.w/2,e.y-8,T('frozenTxt'),'#00ffff');
          tone(660,'sine',.1,.3);
        }
        break;
      }
    }
    if(hit)continue;
    if(boss&&boss.alive&&aabb(b,boss)){
      boss._slowed=true;boss._slowT=180;
      iceBalls.splice(i,1);
      burst(b.x,b.y,'#aaffff',5,2,3);
      floatTxt(boss.x+boss.w/2,boss.y-8,T('slowedTxt'),'#00ffff');
    }
  }
  // — DOT горение (1 урон каждые 60 тиков)
  // Network guests are not authoritative: the host runs the burn DOT and syncs
  // enemy hp, so guests must NOT apply DOT damage (would double-hit via the host).
  const _netGuest = window.netActive && !window.netIsHost;
  for(const e of enemies){
    if(!e.alive||!e._burning)continue;
    e._burnT++;e._burnTotal--;
    // The first tick of damage lands immediately on ignition. It used to wait a
    // full second (_burnT%60), so setting something on fire appeared to do
    // nothing at all for the first 60 frames.
    if(e._burnT===1||e._burnT%60===0){if(!_netGuest)hurtE(e,1,false,true);burst(e.x+e.w/2,e.y,'#ff4400',3,1.5,2);}
    if(_particleAliveCount<100&&e._burnT%15===0){
      spawnParticle({x:e.x+e.w/2+(Math.random()-.5)*6,y:e.y,vx:(Math.random()-.5)*.5,vy:-1,life:1,decay:.04,sz:3,col:'#ff6600',txt:null});
    }
    if(e._burnTotal<=0||!e.alive){e._burning=false;e._burnT=0;}
  }
  if(boss&&boss.alive&&boss._burning){
    boss._burnT++;boss._burnTotal--;
    // Snapshot position: damageBoss() may kill the boss (boss=null), so we must
    // not dereference `boss` afterwards — that null read used to crash the loop.
    const _bbx=boss.x+boss.w/2,_bby=boss.y;
    if(boss._burnT===1||boss._burnT%60===0){if(!_netGuest)damageBoss(1);burst(_bbx,_bby,'#ff4400',4,2,3);}
    if(boss&&boss._burnTotal<=0){boss._burning=false;boss._burnT=0;}
  }
  // — Замедление босса
  if(boss&&boss._slowed){boss._slowT--;if(boss._slowT<=0){boss._slowed=false;}}
}
function drawFireIceBalls(){
  const vLeft=camX-40,vRight=camX+W+40;
  for(const b of fireBalls){
    if(b.x+b.w<vLeft||b.x>vRight)continue;
    ctx.save();
    ctx.shadowColor='#ff4400';ctx.shadowBlur=14;
    ctx.globalAlpha=0.55;ctx.fillStyle='#ff6600';
    ctx.beginPath();ctx.arc(b.x+b.w/2,b.y+b.h/2,b.w*.7,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha=1;ctx.fillStyle='#fff';
    ctx.beginPath();ctx.arc(b.x+b.w/2,b.y+b.h/2,b.w*.25,0,Math.PI*2);ctx.fill();
    ctx.restore();
  }
  for(const b of iceBalls){
    if(b.x+b.w<vLeft||b.x>vRight)continue;
    ctx.save();
    ctx.shadowColor='#00ffff';ctx.shadowBlur=14;
    ctx.globalAlpha=0.55;ctx.fillStyle='#00ccff';
    ctx.beginPath();ctx.arc(b.x+b.w/2,b.y+b.h/2,b.w*.7,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha=1;ctx.fillStyle='#fff';
    ctx.beginPath();ctx.arc(b.x+b.w/2,b.y+b.h/2,b.w*.25,0,Math.PI*2);ctx.fill();
    ctx.restore();
  }
  // Горение оверлей
  for(const e of enemies){
    if(!e.alive||!e._burning)continue;
    ctx.save();ctx.globalAlpha=0.3+Math.sin(tick*.4)*.1;
    ctx.fillStyle='#ff4400';ctx.fillRect(e.x,e.y,e.w,e.h);ctx.restore();
  }
  // Заморозка оверлей
  for(const e of enemies){
    if(!e.alive||!e._frozen)continue;
    ctx.save();ctx.globalAlpha=0.55;ctx.fillStyle='#00ffff';
    ctx.fillRect(e.x,e.y,e.w,e.h);
    ctx.strokeStyle='#aaffff';ctx.lineWidth=2;ctx.strokeRect(e.x+1,e.y+1,e.w-2,e.h-2);
    ctx.restore();
  }
}
// ════════════════════════════════════════════════
//  UPDATE — POWERUPS / PLATFORMS / PARTICLES
// ════════════════════════════════════════════════
function updatePUs(){
  for(const pu of powerups){
    if(pu.got)continue;pu.anim+=.07;pu.vy=Math.min(pu.vy+.32,8);pu.y+=pu.vy;
    if(pu.vy>=0){
      for(const pl of platforms)if(!pl.gone&&aabb(pu,pl)&&pu.y+pu.h>pl.y&&pu.y+pu.h<pl.y+12){pu.y=pl.y-pu.h;pu.vy=0;}
      for(const b of blocks)if(b.solid&&aabb(pu,b)&&pu.y+pu.h>b.y&&pu.y+pu.h<b.y+12){pu.y=b.y-pu.h;pu.vy=0;}
    }
  }
}
function updatePlatforms(){
  for(const pl of platforms){
    if(pl.mv){const nx=pl.origX+Math.sin(tick*.024*pl.spd+pl.phase)*pl.rangeX;pl.dvx=nx-pl.x;pl.x=nx;}
    if(pl.crm&&pl.crm_on){pl.ct--;if(pl.ct<=0){pl.gone=true;burst(pl.x+pl.w/2,pl.y,'#f84',8,3,4);setTimeout(()=>{pl.gone=false;pl.crm_on=false;pl.ct=0;},4500);}}
  }
  updateBonusRoom();
  for(const b of blocks){
    // Проявление скрытого блока — не мгновенное: он вырастает за треть секунды.
    if(b.reveal>0&&b.reveal<1){b.reveal=Math.min(1,b.reveal+0.055);}
    // Подскок блока — чисто рисовка (b.bY, см. drawBlocks). Раньше он двигал сам
    // b.y, то есть коллизию: блок опускался обратно на голову игроку, тот
    // оказывался внутри и вылетал вбок. Коробка блока стоит на месте всегда.
    if(b.bounce>0){b.bounce--;b.bY=Math.sin(b.bounce/12*Math.PI)*9;}
    // Regenerate spent question blocks after their random cooldown elapses.
    if(b.type==='q'&&b.used&&b.regenT>0){
      b.regenT--;
      if(b.regenT<=0){
        b.used=false;
        b.guaranteedBlast=false; // reroll its reward next time
        // sparkle "recharged" feedback
        burst(b.x+b.w/2,b.y+b.h/2,'#ffd700',12,3,4);
        floatTxt(b.x+b.w/2,b.y-6,'+',  '#ffd700');
      }
    }
  }
}
function updateSpotlights(){
  for(const sl of spotlights){
    if(sl.sweep){
      sl.angle+=sl.sweepSpeed;
      // Oscillate within range
      const offset=Math.sin(tick*sl.sweepSpeed)*sl.sweepRange;
      sl.angle=sl.sweepCenter+offset;
    }
  }
}
function updateMazeKeys(){
  for(const key of mazeKeys){
    if(!key.collected){
      key.anim+=0.08;
    }
  }
}
function updateParticles(){
  // The pool holds 400 slots but is usually almost empty; walking all of them
  // every frame for nothing is pure overhead.
  if(_particleAliveCount<=0)return;
  for(let i=0;i<particles.length;i++){
    const p=particles[i];
    if(!p.alive)continue;
    p.x+=p.vx;p.y+=p.vy;if(!p.txt)p.vy+=.12;p.life-=p.decay;
    if(p.life<=0){p.alive=false;_particleFree.push(i);_particleAliveCount--;}
  }
}
// Timer
// Boss levels with the auto-scrolling camera on: the camera advances at a fixed
// BOSS_CAM_SPEED, so how long the level takes is decided by the camera, not the
// player — racing a countdown on top of that just makes the fight unwinnable
// through no fault of the player. The timer is switched off (and hidden) there.
function bossLevelUntimed(){
  return !!boss && !!(window.gameSettings && window.gameSettings.bossAutoScrollCamera);
}
function updateTimer(){
  tickPlaytime();
  if(tick%60===0&&timeLeft>0&&!bossLevelUntimed()){
    timeLeft--;
    // BURN cooks the chassis: the clock runs double for whoever is on fire.
    if(window.Status){
      let drain=0;
      for(const q of activePlayers())drain=Math.max(drain,Status.timerDrain(q));
      timeLeft-=drain;
    }
    // Hardcore multiplies the level time by 0.7, so the countdown can land on a
    // fraction and finish at e.g. -0.74 — which the HUD then formatted as
    // "-1:-1" for the frames before the game-over screen appeared.
    if(timeLeft<0)timeLeft=0;
    if(timeLeft<=0&&gState==='playing'){doHurtPlayer();}
  }
  // Boss arena entrance trigger
  if(boss&&!bossArenaTriggered&&bossArenaX>0&&activePlayers().some(q=>q.x>bossArenaX)){
    bossArenaTriggered=true;
    camShake=18;
    SFX.flagReach();
    floatTxt(player.x+player.w/2,player.y-20,T('bossArena'),'#f44');
    showBossIntro(boss);
  }
}

function updateExit(){
  if(!exitAnim)return;
  exitTimer++;
  // Both players run off to the right (self-contained physics — runs during levelclear)
  // Slowed down: longer acceleration phase (120 frames instead of 60)
  for(const q of activePlayers()){
    if(exitTimer<120){
      q.vx=Math.min(q.vx+0.35,6.5);
      q.facing=1;
      if(exitTimer===12&&q.onGnd){q.vy=-7;if(q===player)SFX.jump();}
    } else {
      q.vx*=0.92;
    }
    q.vy=Math.min(q.vy+G,MXY);
    q.px=q.x;q.py=q.y;
    resolveP(q);
  }
}

// Cached HUD element refs + last-value memo to avoid per-frame DOM thrash
const _hud={score:null,totalUi:null,totalEl:null,level:null,hearts:null,blasterUi:null,blasterFill:null,timerUi:null,timerVal:null,
  coinsEl:null,keysUi:null,keysEl:null,shardsUi:null,shardsEl:null,
  fireUi:null,fireFill:null,iceUi:null,iceFill:null,starUi:null,starFill:null,bootsUi:null,bootsFill:null,
  statusUi:null,statusLbl:null,statusFill:null};
const _hudLast={score:null,total:null,level:null,hearts:null,blasterDisp:null,blasterW:null,timerDisp:null,timerTxt:null,timerCls:null,
  coins:null,keysDisp:null,keys:null,shardsDisp:null,shards:null,
  fireDisp:null,fireW:null,iceDisp:null,iceW:null,starDisp:null,starW:null,bootsDisp:null,bootsW:null};
function _hudInit(){
  _hud.score=document.getElementById('scoreEl');
  _hud.totalUi=document.getElementById('totalUi');
  _hud.totalEl=document.getElementById('totalEl');
  _hud.level=document.getElementById('levelEl');
  _hud.hearts=document.getElementById('heartsEl');
  _hud.blasterUi=document.getElementById('blasterUi');
  _hud.blasterFill=document.getElementById('blasterFill');
  _hud.timerUi=document.getElementById('timerUi');
  _hud.timerVal=document.getElementById('timerVal');
  _hud.coinsEl=document.getElementById('coinsEl');
  _hud.keysUi=document.getElementById('keysUi');
  _hud.keysEl=document.getElementById('keysEl');
  _hud.shardsUi=document.getElementById('shardsUi');
  _hud.shardsEl=document.getElementById('shardsEl');
  _hud.statusUi=document.getElementById('statusUi');
  _hud.statusLbl=document.getElementById('statusLbl');
  _hud.statusFill=document.getElementById('statusFill');
  _hud.fireUi=document.getElementById('fireUi');
  _hud.fireFill=document.getElementById('fireFill');
  _hud.iceUi=document.getElementById('iceUi');
  _hud.iceFill=document.getElementById('iceFill');
  _hud.starUi=document.getElementById('starUi');
  _hud.starFill=document.getElementById('starFill');
  _hud.bootsUi=document.getElementById('bootsUi');
  _hud.bootsFill=document.getElementById('bootsFill');
}
// Helper: toggle a bonus bar's visibility and fill % only when changed
function _hudBonusBar(uiEl,fillEl,active,frac,dispKey,wKey){
  const disp=active?'flex':'none';
  if(_hudLast[dispKey]!==disp){uiEl.style.display=disp;_hudLast[dispKey]=disp;}
  if(active){
    const w=Math.max(0,Math.min(100,Math.round(frac*100)));
    if(_hudLast[wKey]!==w){fillEl.style.width=w+'%';_hudLast[wKey]=w;}
  }
}
// Cached robot life-icons (rendered once per colour scheme via drawByteRobot,
// the same routine that draws the in-game/world-map robots, so the HUD lives
// look like the real robots). Returns a data-URL reused across HUD rebuilds.
const _robotIconCache={};
function robotIconURL(scheme){
  const key=typeof scheme==='object'?JSON.stringify(scheme):scheme;
  if(_robotIconCache[key])return _robotIconCache[key];
  const c=document.createElement('canvas');c.width=40;c.height=40;
  const cx=c.getContext('2d');
  if(window.drawByteRobot){
    window.drawByteRobot(cx,20,37,1,scheme,0,1);
  } else {
    cx.fillStyle=(scheme==='red')?'#c22':'#28c';cx.fillRect(12,6,16,24);
    cx.fillStyle='#ff0';cx.fillRect(15,11,4,4);cx.fillRect(21,11,4,4);
  }
  const url=c.toDataURL();
  if(window.drawByteRobot)_robotIconCache[key]=url;
  return url;
}
var _uiElCache=null;
function updateHUD(){
  if(!_hud.score)_hudInit();
  // Интерфейс в Призма-аномалии тоже переливается — класс включает анимацию
  // в ui-fix.css, чтобы не пересчитывать цвета каждый кадр в JS.
  // Сам элемент кешируем: updateHUD зовут каждый кадр, и поиск по id был здесь
  // единственным обращением к DOM, которое повторялось без нужды.
  {if(!_uiElCache)_uiElCache=document.getElementById('ui');
   const _uiEl=_uiElCache;
   if(_uiEl){const _pw=prismWorld();
     if(_pw!==_uiEl.classList.contains('prismUI'))_uiEl.classList.toggle('prismUI',_pw);}}
  // Куда летит подобранное: цели берём прямо из HUD, чтобы монета приходила
  // к своей цифре при любом масштабе интерфейса.
  if(window.Juice){
    window.Juice.setTargets(_hud.coinsEl,_hud.shardsEl);
    // Прилетевшая добыча подбрасывает счётчик — видно, что засчиталось.
    const _bc=window.Juice.hudBump('coin'),_bs=window.Juice.hudBump('shard');
    if(_hud.coinsEl)_hud.coinsEl.style.transform=_bc>0?('scale('+(1+_bc*0.35)+')'):'';
    if(_hud.shardsEl)_hud.shardsEl.style.transform=_bs>0?('scale('+(1+_bs*0.35)+')'):'';
  }
  // SCORE box shows the CURRENT level's score (resets each level). The running
  // grand total still drives high-score records and achievements.
  const lvlSc=curLevelScore();
  if(_hudLast.score!==lvlSc){_hud.score.textContent=lvlSc;_hudLast.score=lvlSc;AchTrack.score(score);}
  // TOTAL box (adventure only): banked best scores of cleared levels + this run.
  if(advMode){
    _hud.totalUi.style.display='flex';
    const tot=totalScore(hardMode)-levelScore(advLevel,hardMode)+Math.max(levelScore(advLevel,hardMode),lvlSc);
    if(_hudLast.total!==tot){_hud.totalEl.textContent=tot;_hudLast.total=tot;}
  }else{
    _hud.totalUi.style.display='none';
  }
  const lvTxt=advMode?`${advLevel}/${advTotalLevels()}`:level;
  if(_hudLast.level!==lvTxt){_hud.level.textContent=lvTxt;_hudLast.level=lvTxt;}
  // Hearts → robot icon(s) + numeric life count. Build a cheap signature; only
  // rebuild HTML when it changes.
  const heartSig=godMode?'g':twoPlayer?`2|${infiniteLives?'i':lives}|${player2?(infiniteLives?'i':lives2):'x'}`:infiniteLives?'i':`1|${lives}`;
  if(_hudLast.hearts!==heartSig){
    const grp=(scheme,n,col,extra='')=>{
      const num=(n==='i')?'∞':n;
      return `<span class="lifeGrp ${scheme==='red'?'red':''}" style="${extra}">`
            +`<img class="lifeBot" src="${robotIconURL(scheme)}" alt="">`
            +`<span class="lifeNum" style="color:${col}">×${num}</span></span>`;
    };
    let h='';
    if(godMode){
      h=grp('blue','∞','#0ff','text-shadow:0 0 8px #0ff');
    } else if(twoPlayer){
      h+=grp('blue', infiniteLives?'i':lives, '#4af');
      if(!player2) h+=grp('red', 0, '#f55', 'opacity:.4');
      else h+=grp('red', infiniteLives?'i':lives2, '#f55');
    } else if(infiniteLives){
      h=grp('blue','i','#f0f');
    } else {
      h=grp('blue', lives, '#4af');
    }
    _hud.hearts.innerHTML=h;_hudLast.hearts=heartSig;
  }
  const p=player;
  if(p&&p.blaster){
    if(_hudLast.blasterDisp!=='flex'){_hud.blasterUi.style.display='flex';_hudLast.blasterDisp='flex';}
    const bw=Math.round((p.bTimer/1800)*100);
    if(_hudLast.blasterW!==bw){_hud.blasterFill.style.width=bw+'%';_hudLast.blasterW=bw;}
  } else if(_hudLast.blasterDisp!=='none'){_hud.blasterUi.style.display='none';_hudLast.blasterDisp='none';}
  // Bonus timer bars — fire / ice / star / boots
  if(p){
    _hudBonusBar(_hud.fireUi,_hud.fireFill,!!p.fireMode,(p.elemTimer||0)/1800,'fireDisp','fireW');
    _hudBonusBar(_hud.iceUi,_hud.iceFill,!!p.iceMode,(p.elemTimer||0)/1800,'iceDisp','iceW');
    _hudBonusBar(_hud.starUi,_hud.starFill,!!p.starMode,(p.starTimer||0)/600,'starDisp','starW');
    _hudBonusBar(_hud.bootsUi,_hud.bootsFill,!!p.boots,(p.bootsTimer||0)/900,'bootsDisp','bootsW');
  } else {
    _hudBonusBar(_hud.fireUi,_hud.fireFill,false,0,'fireDisp','fireW');
    _hudBonusBar(_hud.iceUi,_hud.iceFill,false,0,'iceDisp','iceW');
    _hudBonusBar(_hud.starUi,_hud.starFill,false,0,'starDisp','starW');
    _hudBonusBar(_hud.bootsUi,_hud.bootsFill,false,0,'bootsDisp','bootsW');
  }
  // Status effect chip — name + remaining time, in the effect's own colour.
  if(_hud.statusUi){
    const st=(window.Status&&p)?Status.label(p):null;
    if(st){
      if(_hudLast.stDisp!=='flex'){_hud.statusUi.style.display='flex';_hudLast.stDisp='flex';}
      const txt=st.icon+' '+st.name;
      if(_hudLast.stTxt!==txt){
        _hud.statusLbl.textContent=txt;_hud.statusLbl.style.color=st.col;
        _hud.statusFill.style.background=st.col;_hudLast.stTxt=txt;
      }
      const w=Math.round(st.frac*100);
      if(_hudLast.stW!==w){_hud.statusFill.style.width=w+'%';_hudLast.stW=w;}
    } else if(_hudLast.stDisp!=='none'){
      _hud.statusUi.style.display='none';_hudLast.stDisp='none';_hudLast.stTxt=null;
    }
  }
  // Coin counter (visible during gameplay)
  if(_hudLast.coins!==coinsTotal){_hud.coinsEl.textContent=coinsTotal;_hudLast.coins=coinsTotal;}

  // Keys counter (visible in maze levels). Uses cached refs + change-detection
  // so it no longer queries the DOM (getElementById) on every rendered frame.
  if(mazeKeys.length>0){
    if(_hudLast.keysDisp!=='flex'){_hud.keysUi.style.display='flex';_hudLast.keysDisp='flex';}
    const keysTxt=`${mazeKeysCollected}/${mazeKeys.length}`;
    if(_hudLast.keys!==keysTxt){_hud.keysEl.textContent=keysTxt;_hudLast.keys=keysTxt;}
  }else if(_hudLast.keysDisp!=='none'){
    _hud.keysUi.style.display='none';_hudLast.keysDisp='none';
  }

  // Crystals (data-shards) counter — shown whenever the level has any.
  if(dataShardsTotal>0){
    if(_hudLast.shardsDisp!=='flex'){_hud.shardsUi.style.display='flex';_hudLast.shardsDisp='flex';}
    const shTxt=`${dataShardsGot}/${dataShardsTotal}`;
    if(_hudLast.shards!==shTxt){_hud.shardsEl.textContent=shTxt;_hudLast.shards=shTxt;}
  }else if(_hudLast.shardsDisp!=='none'){
    _hud.shardsUi.style.display='none';_hudLast.shardsDisp='none';
  }

  if((gState==='playing'||gState==='levelclear')&&!bossLevelUntimed()){
    if(_hudLast.timerDisp!=='flex'){_hud.timerUi.style.display='flex';_hudLast.timerDisp='flex';}
    const m=Math.floor(timeLeft/60),s=Math.floor(timeLeft%60);
    const tTxt=`${m}:${String(s).padStart(2,'0')}`;
    if(_hudLast.timerTxt!==tTxt){_hud.timerVal.textContent=tTxt;_hudLast.timerTxt=tTxt;}
    const tCls=timeLeft<=20?'urgent':'';
    if(_hudLast.timerCls!==tCls){_hud.timerVal.className=tCls;_hudLast.timerCls=tCls;}
  } else if(_hudLast.timerDisp!=='none'){_hud.timerUi.style.display='none';_hudLast.timerDisp='none';}
}

// ════════════════════════════════════════════════
//  DRAW
// ════════════════════════════════════════════════
let _skyGrad=null,_skyGradTheme=-1;
let _hgGrad=null,_hgTheme=-1; // cached horizon glow (depends only on theme + fixed H)
// ════════════════════════════════════════════════
//  PARALLAX SCENERY (background silhouette bands)
// ════════════════════════════════════════════════
// Cyber City used to be the only world with real depth — it has a hand-written
// two-layer skyline, while worlds 2-10 got one or two flat colour washes and
// looked empty. This is one shared renderer for all of them: a "band" is a
// repeating strip of silhouettes drawn at a fixed parallax factor, so each
// world gets its own horizon from a couple of cheap layers of data instead of
// another block of bespoke drawing code.

// Stable pseudo-random from an integer slot. Keyed on the WORLD-space slot
// index (not the screen position) so a shape keeps its size while the camera
// moves past it instead of shimmering.
function _sceneryRnd(slot,salt){
  const v=Math.sin(slot*127.1+(salt||0)*311.7)*43758.5453;
  return v-Math.floor(v);
}

// Each shape lays out one silhouette inside [x, x+span] standing on `base`.
// They only build the path; _sceneryBand() does the fill/rim-light.
const SCENERY_SHAPES={
  // Jagged mountain ridge (ice caves, storm peaks)
  mountain(x,base,span,h,slot){
    const peak=h*(0.55+_sceneryRnd(slot,1)*0.45);
    const mid=x+span*(0.35+_sceneryRnd(slot,2)*0.3);
    ctx.moveTo(x-span*0.1,base);
    ctx.lineTo(mid-span*0.18,base-peak*0.55);
    ctx.lineTo(mid,base-peak);
    ctx.lineTo(mid+span*0.22,base-peak*0.6);
    ctx.lineTo(x+span*1.1,base);
    ctx.closePath();
  },
  // Rolling sand dune (desert ruins)
  dune(x,base,span,h,slot){
    const peak=h*(0.5+_sceneryRnd(slot,3)*0.5);
    ctx.moveTo(x-span*0.1,base);
    ctx.quadraticCurveTo(x+span*0.5,base-peak,x+span*1.1,base);
    ctx.closePath();
  },
  // A continuous treeline: overlapping canopy lobes joined into one mass that
  // meets the ground, with a couple of trunks showing through. Drawing separate
  // trunk+crown trees at this scale made each one read as a lollipop/mushroom
  // rather than as a forest.
  tree(x,base,span,h,slot){
    const lobes=5,step=span/lobes;
    ctx.moveTo(x-span*0.1,base);
    for(let t=0;t<=lobes;t++){
      const cx=x+t*step;
      const ch=h*(0.55+_sceneryRnd(slot,t+4)*0.45);
      const r=step*0.78;
      // Each lobe overlaps its neighbours, so the outline becomes a canopy
      // ridge instead of a row of separate blobs.
      ctx.lineTo(cx-r,base-ch*0.45);
      ctx.quadraticCurveTo(cx,base-ch-r*0.25,cx+r,base-ch*0.45);
    }
    ctx.lineTo(x+span*1.1,base);
    ctx.closePath();
    // Trunks breaking the canopy line
    for(let t=1;t<lobes;t+=2){
      const tx=x+t*step,tw=span*0.022;
      const th=h*(0.30+_sceneryRnd(slot,t+9)*0.22);
      ctx.moveTo(tx-tw,base);
      ctx.lineTo(tx-tw,base-th);
      ctx.lineTo(tx+tw,base-th);
      ctx.lineTo(tx+tw,base);
      ctx.closePath();
    }
  },
  // Volcanic cone with a cut-off crater (lava world)
  volcano(x,base,span,h,slot){
    const peak=h*(0.6+_sceneryRnd(slot,5)*0.4),cx=x+span*0.5,cap=span*0.13;
    ctx.moveTo(cx-span*0.55,base);
    ctx.lineTo(cx-cap,base-peak);
    ctx.lineTo(cx+cap,base-peak);
    ctx.lineTo(cx+span*0.55,base);
    ctx.closePath();
  },
  // Blocky terraced ice cliff — a wall of frozen shelves, nothing like the
  // pointed shards used in the near band.
  iceCliff(x,base,span,h,slot){
    const steps=4;
    let y=base;
    ctx.moveTo(x-span*0.1,base);
    for(let k=0;k<steps;k++){
      const sh=h*(0.16+_sceneryRnd(slot,k+20)*0.22);
      const sw=span/steps;
      y-=sh;
      ctx.lineTo(x+k*sw,y);
      ctx.lineTo(x+(k+1)*sw,y);
    }
    ctx.lineTo(x+span*1.1,base);
    ctx.closePath();
  },
  // Ruined skyline behind the fortress: broken towers and collapsed arches.
  ruins(x,base,span,h,slot){
    for(let k=0;k<4;k++){
      const rx=x+span*(0.08+k*0.24),rw=span*0.15;
      const rh=h*(0.25+_sceneryRnd(slot,k+30)*0.7);
      ctx.rect(rx,base-rh,rw,rh);
      // broken top edge
      if(_sceneryRnd(slot,k+34)>0.5)ctx.rect(rx+rw*0.55,base-rh-h*0.10,rw*0.45,h*0.10);
    }
  },
  // A big hull section drifting past, close to camera (space station near band).
  hull(x,base,span,h,slot){
    const hh=h*0.72,hy=base-hh;
    ctx.rect(x+span*0.05,hy,span*0.9,hh);
    for(let k=0;k<5;k++)ctx.rect(x+span*(0.12+k*0.16),hy+hh*0.30,span*0.07,hh*0.14); // panel seams
    ctx.rect(x+span*0.02,hy+hh*0.62,span*0.96,hh*0.08);                              // belt
  },
  // Angular ice/crystal shards jutting up (ice caves)
  crystal(x,base,span,h,slot){
    for(let k=0;k<3;k++){
      const cx=x+span*(0.2+k*0.3),ch=h*(0.35+_sceneryRnd(slot,k+14)*0.65),cw=span*0.07;
      ctx.moveTo(cx-cw,base);
      ctx.lineTo(cx-cw*0.6,base-ch*0.72);
      ctx.lineTo(cx,base-ch);
      ctx.lineTo(cx+cw*0.6,base-ch*0.68);
      ctx.lineTo(cx+cw,base);
      ctx.closePath();
    }
  },
  // Tanks and gantry pipes (toxic zone)
  pipes(x,base,span,h,slot){
    const th=h*(0.4+_sceneryRnd(slot,7)*0.4);
    ctx.rect(x+span*0.12,base-th,span*0.2,th);
    ctx.rect(x+span*0.5,base-th*0.72,span*0.26,th*0.72);
    ctx.rect(x+span*0.04,base-th-span*0.05,span*0.86,span*0.05); // overhead pipe run
  },
  // Battlement wall with towers (final fortress)
  fortress(x,base,span,h,slot){
    const wh=h*(0.4+_sceneryRnd(slot,8)*0.35);
    ctx.rect(x,base-wh,span,wh);
    const th=wh*1.5;
    ctx.rect(x+span*0.04,base-th,span*0.16,th);            // tower
    ctx.rect(x+span*0.78,base-th*0.85,span*0.16,th*0.85);
    for(let m=0;m<5;m++)ctx.rect(x+span*(0.24+m*0.12),base-wh-h*0.06,span*0.06,h*0.06); // merlons
  },
};

// Per-world layer stacks. `base`/`h` are fractions of the canvas height, `par`
// is the parallax factor, `tint` is the world's rim/haze colour.
//
// Colours are NOT hard-coded per layer: every sky in this game is already
// near-black, so painting a silhouette even darker made it invisible. Instead
// the far band is drawn as a light HAZE (atmospheric perspective — distant
// things wash out toward the sky's own light) and the near band as a dark
// cut-out, both edged with the world's neon tint. That reads correctly against
// any theme background without per-world colour tuning.
const WORLD_SCENERY={
  1:[ // Neon Jungle
    {shape:'tree',    par:0.10,span:210,base:0.80,h:0.20,depth:'far', tint:'#11ff88',haze:0.45,noRim:true},
    {shape:'tree',    par:0.26,span:150,base:0.88,h:0.16,depth:'near',tint:'#00ff88',nearFill:'tint'},
  ],
  2:[ // Lava World
    {shape:'volcano', par:0.09,span:250,base:0.80,h:0.22,depth:'far', tint:'#ff7722'},
    {shape:'mountain',par:0.24,span:170,base:0.88,h:0.15,depth:'near',tint:'#ff9944'},
  ],
  3:[ // Ice Caves — one band of shards on the cave floor. The stalactite ceiling
      // above is the other half of the read; a second floor band on top of this
      // one just piled more triangles into the same space.
    {shape:'crystal', par:0.20,span:190,base:0.87,h:0.17,depth:'near',tint:'#aaddff'},
  ],
  4:[ // Desert Ruins
    {shape:'dune',    par:0.08,span:280,base:0.82,h:0.15,depth:'far', tint:'#ffcc66'},
    {shape:'dune',    par:0.22,span:200,base:0.90,h:0.11,depth:'near',tint:'#ffdd88'},
  ],
  // 5 (Space Station): the station band in the atmosphere pass is enough.
  6:[ // Dark Forest — barely-lit treeline; the haze is kept very low so the
      // canopy stays a silhouette instead of glowing pale grey
    {shape:'tree',    par:0.09,span:190,base:0.79,h:0.21,depth:'far', tint:'#77cc99',haze:0.30,noRim:true},
    {shape:'tree',    par:0.25,span:140,base:0.89,h:0.17,depth:'near',tint:'#55aa77',nearFill:'tint'},
  ],
  // 7 (Toxic Zone) has no silhouette band: its depth comes from the cached
  // structure tiles in the atmosphere pass, and a second band just doubled it up.
  8:[ // Storm Peaks
    {shape:'mountain',par:0.08,span:260,base:0.78,h:0.24,depth:'far', tint:'#9999ff'},
    {shape:'mountain',par:0.24,span:180,base:0.88,h:0.16,depth:'near',tint:'#aaaaff'},
  ],
  // 9 (Final Fortress): the siege wall is the whole backdrop; ruins behind it
  // only added a second row of dark blocks fighting the wall for attention.
};

function _sceneryBand(cfg,bd){
  const draw=SCENERY_SHAPES[cfg.shape];
  if(!draw)return;
  const span=cfg.span,base=H*cfg.base,h=H*cfg.h;
  const scroll=camX*cfg.par;
  const off=((scroll%span)+span)%span;
  const firstSlot=Math.floor(scroll/span);
  const count=Math.ceil(W/span)+2;
  const far=(cfg.depth==='far');
  ctx.beginPath();
  for(let i=0;i<count;i++)draw(i*span-off,base,span,h,firstSlot+i);
  if(far){
    // Haze band: a soft vertical wash of the world tint, strongest at the
    // horizon and fading out toward the top of the shapes. `haze` lets a world
    // dial it down when its sky is already bright (an over-strong haze made the
    // jungle/forest treelines glow like they were lit from inside).
    const strength=cfg.haze!=null?cfg.haze:1;
    const g=ctx.createLinearGradient(0,base-h,0,base);
    g.addColorStop(0,cfg.tint+'00');
    g.addColorStop(1,cfg.tint+'2e');
    ctx.globalAlpha=0.45*strength;ctx.fillStyle=g;ctx.fill();
  }else if(cfg.nearFill==='tint'){
    // Worlds whose sky is already near-black (jungle, dark forest) can't use a
    // black cut-out — it is invisible against the background and all you see is
    // the rim, which turned the treeline into a mess of wireframe umbrellas.
    // A faint tint wash gives them a readable mass, and the rim is dropped
    // entirely: with nothing behind it to separate from, an outline is all
    // noise and no shape.
    ctx.globalAlpha=0.16;ctx.fillStyle=cfg.tint;ctx.fill();
    ctx.globalAlpha=1;
    return;
  }else{
    ctx.globalAlpha=0.55;ctx.fillStyle='#000';ctx.fill();
  }
  // Neon rim light along the silhouette edge — this is what stops the shapes
  // reading as flat cut-outs. Kept deliberately faint: this is background, and
  // anything brighter starts competing with the platforms for the player's eye.
  if(bd>=0.55&&!cfg.noRim){
    ctx.globalAlpha=far?0.13:0.26;
    ctx.strokeStyle=cfg.tint;ctx.lineWidth=1;
    ctx.stroke();
  }
}

// Draw the whole scenery stack for a world. Worlds without an entry (Cyber City
// has its bespoke skyline, Prism Anomaly its refraction field) simply skip.
// Многослойные фоны миров удалены: их заменил один запечённый слой
// (assets/backdrops.js). Здесь было ~950 строк — небо, зарево, дымка, звёзды,
// светлячки, окна домов и полосы силуэтов с параллаксом у каждого из 11 миров.

function drawBG(){
  // Фон — ОДИН слой, запечённый в холст (assets/backdrops.js).
  //
  // Раньше здесь собиралась многослойная сцена: небо, зарево, дымка, звёзды,
  // светлячки, окна домов и полосы силуэтов с параллаксом — всё заново каждый
  // кадр. Слои наезжали друг на друга, мир читался как каша, а на слабом
  // устройстве это была самая дорогая работа за кадр.
  //
  // Теперь полотно печётся один раз на мир и размер экрана, а в кадре стоит
  // два drawImage со сдвигом. Ничего лишнего — небо, линия горизонта и один
  // акцент, если он этот мир характеризует.
  if(window.BBBackdrop){ window.BBBackdrop.draw(ctx,W,H,CT,camX); return; }
  // Запасной путь, если модуль фонов почему-то не загрузился.
  ctx.fillStyle=CT.bg||'#04040f';ctx.fillRect(0,0,W,H);
}
function drawGrid(){
  ctx.save();ctx.globalAlpha=.04;ctx.strokeStyle=CT.grid;ctx.lineWidth=1;
  const gs=54,ox=(camX*.22)%gs;
  // Batch все линии в один путь
  ctx.beginPath();
  for(let x=-ox;x<W;x+=gs){ctx.moveTo(x,0);ctx.lineTo(x,H);}
  for(let y=0;y<H;y+=gs){ctx.moveTo(0,y);ctx.lineTo(W,y);}
  ctx.stroke();
  ctx.restore();
}
function drawBonusRoomUi(){
  // Затемнение перехода. Чёрный, а не цветная вспышка: смена места должна
  // читаться как отдельная сцена.
  if(bonusFade>0){
    ctx.save();
    ctx.globalAlpha=bonusFade;
    ctx.fillStyle='#000000';ctx.fillRect(0,0,W,H);
    // На чёрном — узкая рамка, чтобы переход не был просто пустотой.
    if(bonusFade>0.6){
      ctx.globalAlpha=(bonusFade-0.6)/0.4;
      ctx.strokeStyle='#4de2ff';ctx.lineWidth=2;
      const inset=Math.round(Math.min(W,H)*0.06);
      ctx.strokeRect(inset,inset,W-inset*2,H-inset*2);
    }
    ctx.restore();
  }
  // Название комнаты держится пару секунд после появления и тает.
  if(bonusTitle>0&&bonusFade<0.9){
    ctx.save();
    ctx.globalAlpha=Math.min(1,bonusTitle*2.2)*(1-bonusFade);
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.font='bold '+Math.round(H*0.055)+'px "Press Start 2P", monospace';
    ctx.fillStyle='#ffd24a';ctx.shadowBlur=18;ctx.shadowColor='#ffd24a';
    ctx.fillText(T('bonusRoom')||'БОНУС-КОМНАТА',W/2,H*0.30);
    ctx.restore();
  }
  // Полосы обратного отсчёта здесь больше нет: комната не закрывается сама.
  // Вместо неё — короткая подсказка про выход, она тает вместе с названием.
  if(bonusT<=0)return;
  if(bonusTitle>0&&bonusFade<0.9){
    ctx.save();
    ctx.globalAlpha=Math.min(1,bonusTitle*2.2)*(1-bonusFade)*0.85;
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.font=Math.round(H*0.022)+'px "Share Tech Mono", monospace';
    ctx.fillStyle='#bfffd8';
    ctx.fillText(T('bonusRoomExit')||'ВЫХОД — ДВЕРЬ В ДАЛЬНЕМ КОНЦЕ',W/2,H*0.385);
    ctx.restore();
  }
}
function drawTimerBar(){
  if(gState!=='playing'&&gState!=='levelclear')return;
  if(bossLevelUntimed())return;   // no countdown on an auto-scrolling boss level
  const r=timMax>0?timeLeft/timMax:1,bw=r*W;
  const col=timeLeft>30?CT.mc:timeLeft>10?'#f80':'#f44';
  ctx.save();ctx.globalAlpha=timeLeft<=10&&Math.floor(tick/8)%2===0?.35:.15;
  ctx.fillStyle=col;ctx.fillRect(0,H-4,bw,4);ctx.restore();
}
// Edge lighting for a platform slab: a lit top face, a shaded underside and a
// soft contact shadow. Platforms used to be a flat gradient inside a 2px
// outline, which read as a sticker rather than something the robot stands on.
// Three fillRects — no shadowBlur, no per-frame allocation.
function _platShade(pl,alpha){
  if(pl.w<6||pl.h<4)return;
  const x=pl.x+1,w=pl.w-2;
  ctx.globalAlpha=alpha*0.30;
  ctx.fillStyle='#ffffff';ctx.fillRect(x,pl.y+2,w,1);            // lit top face
  ctx.globalAlpha=alpha*0.34;
  ctx.fillStyle='#000000';ctx.fillRect(x,pl.y+pl.h-3,w,2);       // shaded underside
  // Contact shadow below floating platforms only — the ground already sits on
  // the bottom of the screen, so a shadow under it would just be a dark strip.
  if(pl.type!=='ground'){
    ctx.globalAlpha=alpha*0.22;
    ctx.fillRect(pl.x+3,pl.y+pl.h,pl.w-6,3);
  }
  ctx.globalAlpha=alpha;
}
function drawPlatforms(){
  const vLeft=camX-60,vRight=camX+W+60;
  // Build the type->palette map once per frame instead of per platform (was an
  // object + nested array allocation on every iteration).
  const _platPal={normal:CT.pN,moving:CT.pM,crumble:CT.pC,conveyor:['#2a3a4a','#3a4a5a','#4a5a6a']};
  const _prism=(CT.id===10); // Prism Anomaly: ground/platforms sweep through the
  // full spectrum instead of the flat violet gradient every other world uses —
  // otherwise the level itself still reads as "just purple" even though the
  // sky/enemies are rainbow.
  for(const pl of platforms){
    if(pl.gone)continue;
    if(pl.x+pl.w<vLeft||pl.x>vRight)continue;
    const alpha=(pl.crm&&pl.crm_on)?Math.max(0,pl.ct/72):1;
    ctx.save();ctx.globalAlpha=alpha;
    if(pl.type==='ground'){
      if(_prism){
        // Dark obsidian ground with a spectral highlight running along its top
        // edge. The fill used to be a saturated hsl(…,85%,32%) sweep, which put
        // a full-brightness rainbow under the player's feet and made the whole
        // world read as a broken test pattern rather than a place.
        const hueA=(pl.x*0.35+prismFlow()*0.6)%360;
        // Spectral along the length of the slab, dark toward the bottom. A
        // single flat hue made the world read as "the green level" one moment
        // and "the purple level" the next; a full-brightness rainbow fill made
        // the platforms vanish into the sky. This does both jobs at once.
        const hq=(hueA/18|0)*18;
        if(pl._pgH!==hq||pl._pgW!==pl.w){
          const gh=ctx.createLinearGradient(pl.x,0,pl.x+pl.w,0);
          for(let k=0;k<=5;k++)gh.addColorStop(k/5,`hsl(${(hq+k*62)%360},70%,26%)`);
          pl._pgGrad=gh;pl._pgH=hq;pl._pgW=pl.w;pl._pgX=pl.x;
        }
        if(pl._pgX!==pl.x){ // moving platform — the gradient is in world space
          const gh=ctx.createLinearGradient(pl.x,0,pl.x+pl.w,0);
          for(let k=0;k<=5;k++)gh.addColorStop(k/5,`hsl(${(hq+k*62)%360},70%,26%)`);
          pl._pgGrad=gh;pl._pgX=pl.x;
        }
        ctx.fillStyle=pl._pgGrad;ctx.fillRect(pl.x,pl.y,pl.w,pl.h);
        if(!pl._pgDark||pl._pgDarkY!==pl.y||pl._pgDarkH!==pl.h){
          const gv=ctx.createLinearGradient(0,pl.y,0,pl.y+pl.h);
          gv.addColorStop(0,'rgba(0,0,0,0)');gv.addColorStop(1,'rgba(0,0,0,0.72)');
          pl._pgDark=gv;pl._pgDarkY=pl.y;pl._pgDarkH=pl.h;
        }
        ctx.fillStyle=pl._pgDark;ctx.fillRect(pl.x,pl.y,pl.w,pl.h);
        // The highlight sweeps the spectrum ALONG the platform rather than
        // tinting the whole slab one colour — the ground refracts light, which
        // is the point of this world; a single hue just made it "the green level".
        const vx0=Math.max(pl.x,camX-40),vx1=Math.min(pl.x+pl.w,camX+W+40);
        if(vx1>vx0){
          const eg=ctx.createLinearGradient(vx0,0,vx1,0);
          for(let s=0;s<=5;s++)eg.addColorStop(s/5,`hsl(${(hueA+s*62)%360},100%,72%)`);
          ctx.strokeStyle=eg;ctx.lineWidth=2;ctx.shadowBlur=0;
          ctx.beginPath();ctx.moveTo(vx0,pl.y);ctx.lineTo(vx1,pl.y);ctx.stroke();
        }
        ctx.strokeStyle=`hsla(${hueA},80%,60%,0.18)`;ctx.lineWidth=1;
        ctx.beginPath();
        for(let gx=pl.x+24;gx<pl.x+pl.w;gx+=24){ctx.moveTo(gx,pl.y);ctx.lineTo(gx,pl.y+pl.h);}
        ctx.stroke();
      } else {
      // Vertical gradient is x-invariant, so cache it on the platform and reuse
      // it across frames (and horizontal movement). Invalidate only when the
      // platform's y or the theme changes - mirrors the _skyGrad cache pattern.
      if(!pl._grad||pl._gradY!==pl.y||pl._gradTheme!==CT.id){const g=ctx.createLinearGradient(0,pl.y,0,pl.y+pl.h);g.addColorStop(0,CT.grd[0]);g.addColorStop(1,CT.grd[1]);pl._grad=g;pl._gradY=pl.y;pl._gradTheme=CT.id;}
      ctx.fillStyle=pl._grad;ctx.fillRect(pl.x,pl.y,pl.w,pl.h);
      ctx.strokeStyle=CT.gE;ctx.lineWidth=2;ctx.shadowBlur=0;
      ctx.beginPath();ctx.moveTo(pl.x,pl.y);ctx.lineTo(pl.x+pl.w,pl.y);ctx.stroke();
      ctx.strokeStyle=withAlpha(CT.grd[0],'88');ctx.lineWidth=1;
      for(let gx=pl.x+20;gx<pl.x+pl.w;gx+=20){ctx.beginPath();ctx.moveTo(gx,pl.y);ctx.lineTo(gx,pl.y+pl.h);ctx.stroke();}
      }
      _platShade(pl,alpha);
    } else if(_prism){
      // Each platform type keeps a distinct hue *band* (so players can still
      // tell normal/moving/crumble apart at a glance) but every band sweeps
      // through the spectrum by position+time rather than sitting on one fixed
      // colour — reads as genuinely prismatic instead of "purple, yellow, cyan".
      // Dark glass slab with a spectral rim. Each platform TYPE keeps its own
      // hue band (so normal/moving/crumble stay tellable apart) but the body is
      // deliberately dark — a bright rainbow fill made the platforms disappear
      // into the background instead of standing out from it.
      const typeOffset=pl.type==='moving'?120:pl.type==='crumble'?240:0;
      const hue=(pl.x*0.5+prismFlow()*0.9+typeOffset)%360;
      // Each platform is its own little prism: the hue sweeps across its width,
      // offset per type so normal/moving/crumble stay tellable apart.
      const hq2=(hue/18|0)*18;
      if(pl._pgH!==hq2||pl._pgX!==pl.x||pl._pgW!==pl.w){
        const gh=ctx.createLinearGradient(pl.x,0,pl.x+pl.w,0);
        for(let k=0;k<=3;k++)gh.addColorStop(k/3,`hsl(${(hq2+k*40)%360},85%,46%)`);
        pl._pgGrad=gh;pl._pgH=hq2;pl._pgX=pl.x;pl._pgW=pl.w;
      }
      ctx.fillStyle=pl._pgGrad;ctx.fillRect(pl.x,pl.y,pl.w,pl.h);
      if(!pl._pgShade||pl._pgShadeY!==pl.y||pl._pgShadeH!==pl.h){
        const gv=ctx.createLinearGradient(0,pl.y,0,pl.y+pl.h);
        gv.addColorStop(0,'rgba(255,255,255,0.18)');gv.addColorStop(0.5,'rgba(0,0,0,0)');gv.addColorStop(1,'rgba(0,0,0,0.55)');
        pl._pgShade=gv;pl._pgShadeY=pl.y;pl._pgShadeH=pl.h;
      }
      ctx.fillStyle=pl._pgShade;ctx.fillRect(pl.x,pl.y,pl.w,pl.h);
      ctx.strokeStyle=`hsl(${hue},100%,80%)`;ctx.lineWidth=2;
      ctx.shadowBlur=0;ctx.strokeRect(pl.x+1,pl.y+1,pl.w-2,pl.h-2);
      _platShade(pl,alpha);
      if(pl.type==='conveyor'){
        const offset=(tick*pl.conveyorSpeed*pl.conveyorDir*2)%30;
        ctx.save();ctx.beginPath();ctx.rect(pl.x,pl.y,pl.w,pl.h);ctx.clip();
        ctx.fillStyle='#1a2a3a';
        for(let rx=pl.x+offset;rx<pl.x+pl.w;rx+=15){if(rx>=pl.x&&rx<=pl.x+pl.w-2){ctx.fillRect(rx,pl.y+1,2,pl.h-2);}}
        ctx.shadowColor='#ffaa00';ctx.shadowBlur=6;ctx.strokeStyle='#ffaa00';ctx.lineWidth=2;ctx.lineCap='round';
        for(let cx=pl.x+offset;cx<pl.x+pl.w;cx+=30){
          if(cx-6<pl.x||cx+6>pl.x+pl.w)continue;
          const arrowY=pl.y+pl.h/2;
          if(pl.conveyorDir>0){ctx.beginPath();ctx.moveTo(cx-6,arrowY);ctx.lineTo(cx+6,arrowY);ctx.stroke();ctx.beginPath();ctx.moveTo(cx+6,arrowY);ctx.lineTo(cx+2,arrowY-3);ctx.moveTo(cx+6,arrowY);ctx.lineTo(cx+2,arrowY+3);ctx.stroke();}
          else{ctx.beginPath();ctx.moveTo(cx+6,arrowY);ctx.lineTo(cx-6,arrowY);ctx.stroke();ctx.beginPath();ctx.moveTo(cx-6,arrowY);ctx.lineTo(cx-2,arrowY-3);ctx.moveTo(cx-6,arrowY);ctx.lineTo(cx-2,arrowY+3);ctx.stroke();}
        }
        ctx.shadowBlur=0;ctx.lineCap='butt';ctx.restore();
      }
    } else {
      const c=_platPal[pl.type]||CT.pN;
      if(!pl._grad||pl._gradY!==pl.y||pl._gradTheme!==CT.id){const g=ctx.createLinearGradient(0,pl.y,0,pl.y+pl.h);g.addColorStop(0,c[1]);g.addColorStop(1,c[0]);pl._grad=g;pl._gradY=pl.y;pl._gradTheme=CT.id;}
      ctx.fillStyle=pl._grad;ctx.fillRect(pl.x,pl.y,pl.w,pl.h);ctx.strokeStyle=c[2];ctx.lineWidth=2;
      ctx.shadowBlur=0;ctx.strokeRect(pl.x+1,pl.y+1,pl.w-2,pl.h-2);
      if(pl.type!=='conveyor')_platShade(pl,alpha); // conveyors have their own belt art

      // Conveyor animation - improved
      if(pl.type==='conveyor'){
        const offset=(tick*pl.conveyorSpeed*pl.conveyorDir*2)%30;

        // Clip all conveyor decorations strictly to the belt surface so
        // rollers/arrows never spill past the platform edges.
        ctx.save();
        ctx.beginPath();ctx.rect(pl.x,pl.y,pl.w,pl.h);ctx.clip();

        // Metallic rollers effect
        ctx.fillStyle='#1a2a3a';
        for(let rx=pl.x+offset;rx<pl.x+pl.w;rx+=15){
          if(rx>=pl.x&&rx<=pl.x+pl.w-2){
            ctx.fillRect(rx,pl.y+1,2,pl.h-2);
          }
        }

        // Glowing arrows
        ctx.shadowColor='#ffaa00';
        ctx.shadowBlur=6;
        ctx.strokeStyle='#ffaa00';
        ctx.lineWidth=2;
        ctx.lineCap='round';

        for(let cx=pl.x+offset;cx<pl.x+pl.w;cx+=30){
          if(cx-6<pl.x||cx+6>pl.x+pl.w)continue; // Skip arrows that don't fully fit
          const arrowY=pl.y+pl.h/2;
          if(pl.conveyorDir>0){
            // Right arrow
            ctx.beginPath();
            ctx.moveTo(cx-6,arrowY);
            ctx.lineTo(cx+6,arrowY);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(cx+6,arrowY);
            ctx.lineTo(cx+2,arrowY-3);
            ctx.moveTo(cx+6,arrowY);
            ctx.lineTo(cx+2,arrowY+3);
            ctx.stroke();
          }else{
            // Left arrow
            ctx.beginPath();
            ctx.moveTo(cx+6,arrowY);
            ctx.lineTo(cx-6,arrowY);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(cx-6,arrowY);
            ctx.lineTo(cx-2,arrowY-3);
            ctx.moveTo(cx-6,arrowY);
            ctx.lineTo(cx-2,arrowY+3);
            ctx.stroke();
          }
        }
        ctx.shadowBlur=0;
        ctx.lineCap='butt';
        ctx.restore();
      }
    }
    ctx.restore();
  }
}
// ── Glyph sprite cache ──────────────────────────────────────────────────────
// Assigning a web-font shorthand to a canvas is expensive — drawParticles was
// spending 2.3 ms of a 3.3 ms frame on a single unconditional `ctx.font=`.
// Block glyphs had the same problem, once per visible block per frame. These
// never change, so each is rasterised once and blitted like any other sprite.
const _glyphCache={};
function drawGlyph(ch,px,size,col,font){
  const key=ch+'|'+size+'|'+col+'|'+(font||'');
  let g=_glyphCache[key];
  if(!g){
    const dpr=Math.min(2,(window.devicePixelRatio||1));
    const pad=Math.ceil(size*0.9);
    const cv=document.createElement('canvas');
    cv.width=Math.ceil(pad*2*dpr);cv.height=Math.ceil(pad*2*dpr);
    const c=cv.getContext('2d');
    c.scale(dpr,dpr);
    c.font=font||`bold ${size}px 'Press Start 2P',monospace`;
    c.textAlign='center';c.textBaseline='middle';
    c.fillStyle=col;c.fillText(ch,pad,pad);
    g={cv:cv,pad:pad};
    _glyphCache[key]=g;
  }
  ctx.drawImage(g.cv,px[0]-g.pad,px[1]-g.pad,g.pad*2,g.pad*2);
}
/**
 * Золотой денежный блок. Вынесен из drawBlocks, потому что тем же видом
 * рисуется цель превращения от переключателя: раньше там был спрайт монеты,
 * и превращение читалось как подмена другим предметом.
 */
function drawMoneyBlock(x,y,w,h){
  const p=.7+.3*Math.sin(tick*.08);
  ctx.fillStyle='#3a2200';ctx.fillRect(x,y,w,h);
  const g=ctx.createLinearGradient(x,y,x,y+h);
  g.addColorStop(0,'#d4af37');g.addColorStop(.3,'#c9a02c');g.addColorStop(.7,'#b8860b');g.addColorStop(1,'#9a7310');
  ctx.fillStyle=g;ctx.fillRect(x+2,y+2,w-4,h-4);
  ctx.strokeStyle='#8b6914';ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(x+2,y+h/2);ctx.lineTo(x+w-2,y+h/2);ctx.stroke();
  ctx.beginPath();ctx.moveTo(x+w/3,y+2);ctx.lineTo(x+w/3,y+h/2);ctx.stroke();
  ctx.beginPath();ctx.moveTo(x+w*2/3,y+h/2);ctx.lineTo(x+w*2/3,y+h-2);ctx.stroke();
  ctx.fillStyle='#fff3';ctx.fillRect(x+3,y+3,w-6,4);
  ctx.shadowColor='#ffd700';ctx.shadowBlur=10*p;
  ctx.fillStyle='#ffd700';ctx.beginPath();ctx.arc(x+w/2,y+h/2,w*.25,0,Math.PI*2);ctx.fill();
  ctx.shadowBlur=0;
  ctx.fillStyle='#ffe680';ctx.beginPath();ctx.arc(x+w/2-1,y+h/2-1,w*.18,0,Math.PI*2);ctx.fill();
  drawGlyph('$',[x+w/2,y+h/2+1],Math.floor(w*.35),'#b8860b');
}
/**
 * Кирпич Призма-аномалии.
 *
 * Раньше здесь рисовался обычный коричневый кирпич, а сверху накладывался
 * фильтр (или полупрозрачная подкраска). И то и другое ОСТАВЛЯЕТ старый цвет
 * в кадре: фильтр сохраняет светотень коричневого, подкраска — сам коричневый,
 * и блок выходил тёмно-бурым с радужным налётом — не тем цветом, каким светятся
 * платформы рядом. В мире света у предмета не должно быть «прошлого цвета»:
 * блок сразу собирается из спектра, теми же формулами, что и платформа.
 *
 * Заодно это дешевле: ctx.filter — самый дорогой вызов в кадре (см. prismFxOn),
 * а здесь его нет вовсе.
 */
function drawPrismBlock(b,dim){
  const hue=(b.x*0.5+prismFlow()*0.9)%360;
  const hq=(hue/18|0)*18;                       // квантование: меньше градиентов на кадр
  if(b._pbH!==hq||b._pbX!==b.x||b._pbW!==b.w){
    const g=ctx.createLinearGradient(b.x,0,b.x+b.w,0);
    for(let k=0;k<=3;k++)g.addColorStop(k/3,`hsl(${(hq+k*40)%360},85%,46%)`);
    b._pbGrad=g;b._pbH=hq;b._pbX=b.x;b._pbW=b.w;
  }
  ctx.globalAlpha=dim?0.45:1;
  ctx.fillStyle=b._pbGrad;ctx.fillRect(b.x,b.y,b.w,b.h);
  if(!b._pbShade||b._pbShadeY!==b.y||b._pbShadeH!==b.h){
    const gv=ctx.createLinearGradient(0,b.y,0,b.y+b.h);
    gv.addColorStop(0,'rgba(255,255,255,0.20)');
    gv.addColorStop(0.5,'rgba(0,0,0,0)');
    gv.addColorStop(1,'rgba(0,0,0,0.55)');
    b._pbShade=gv;b._pbShadeY=b.y;b._pbShadeH=b.h;
  }
  ctx.fillStyle=b._pbShade;ctx.fillRect(b.x,b.y,b.w,b.h);
  ctx.strokeStyle=`hsl(${hue},100%,80%)`;ctx.lineWidth=2;ctx.shadowBlur=0;
  ctx.strokeRect(b.x+1,b.y+1,b.w-2,b.h-2);
  ctx.globalAlpha=1;
}

function drawBlocks(){
  const vLeft=camX-40,vRight=camX+W+40;
  const _prismWorld=prismWorld();
  for(const b of blocks){
    if(b.x+b.w<vLeft||b.x>vRight)continue;
    // Скрытый и ещё не найденный блок не рисуется вовсе — в этом весь смысл.
    if(b.hidden&&!b.reveal)continue;
    ctx.save();
    // Подскок от удара снизу — только смещение картинки: коробка блока стоит на
    // месте, иначе опускающийся блок выталкивал игрока вбок (см. updatePlatforms).
    if(b.bY)ctx.translate(0,-b.bY);
    // Проявление: блок вырастает из точки с перелётом за единицу и обратно.
    if(b.reveal>0&&b.reveal<1){
      const t=b.reveal;
      const sc=1+Math.sin(t*Math.PI)*0.45;      // перелёт по размеру
      const cx=b.x+b.w/2,cy=b.y+b.h/2;
      ctx.globalAlpha=Math.min(1,t*1.6);
      ctx.translate(cx,cy);ctx.scale(sc*t+(1-t)*0.2,sc*t+(1-t)*0.2);ctx.translate(-cx,-cy);
    }
    // Prism Anomaly: кирпич собирается из спектра, а не красится поверх своего
    // коричневого (см. drawPrismBlock). Что за блок — по-прежнему видно: знак
    // «?» и «$» рисуются поверх плиты, пустой блок гаснет.
    if(_prismWorld){
      const used=(b.type==='q'&&b.used)||(b.type==='c'&&b.used)
              ||(b.type!=='b'&&b.type!=='q'&&b.type!=='c');
      drawPrismBlock(b,used);
      if(b.type==='q'&&!b.used){
        const p=.8+.2*Math.sin(tick*.1);
        ctx.shadowColor='#fff';ctx.shadowBlur=8*p;
        drawGlyph('?',[b.x+b.w/2,b.y+b.h/2+1],Math.floor(b.w*.55),'#fff');
        ctx.shadowBlur=0;
      } else if(b.type==='c'&&!b.used){
        const p=.7+.3*Math.sin(tick*.08);
        ctx.shadowColor='#fff';ctx.shadowBlur=10*p;
        ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(b.x+b.w/2,b.y+b.h/2,b.w*.24,0,Math.PI*2);ctx.fill();
        ctx.shadowBlur=0;
        drawGlyph('$',[b.x+b.w/2,b.y+b.h/2+1],Math.floor(b.w*.35),`hsl(${(b.x*0.5+tick*0.9)%360},80%,25%)`);
      } else if(b.type==='q'&&b.used&&b.regenT>0&&b.regenT<150){
        // Зарядка «?»-блока: та же подсказка, что и в остальных мирах.
        const charge=1-b.regenT/150,pul=0.5+0.5*Math.sin(tick*.3);
        ctx.globalAlpha=charge*pul*0.7;
        ctx.fillStyle='#fff';ctx.fillRect(b.x+2,b.y+2,b.w-4,b.h-4);
        ctx.globalAlpha=1;
      }
      ctx.restore();
      continue;
    }
    if(b.type==='b'){
      ctx.fillStyle='#3a180a';ctx.fillRect(b.x,b.y,b.w,b.h);ctx.strokeStyle='#7a3816';ctx.lineWidth=1.5;ctx.strokeRect(b.x+1,b.y+1,b.w-2,b.h-2);
      ctx.strokeStyle='#261006';ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(b.x,b.y+b.h/2);ctx.lineTo(b.x+b.w,b.y+b.h/2);ctx.stroke();
      ctx.beginPath();ctx.moveTo(b.x+b.w/3,b.y);ctx.lineTo(b.x+b.w/3,b.y+b.h/2);ctx.stroke();
      ctx.beginPath();ctx.moveTo(b.x+b.w*2/3,b.y+b.h/2);ctx.lineTo(b.x+b.w*2/3,b.y+b.h);ctx.stroke();
    } else if(b.type==='q'&&!b.used){
      const p=.8+.2*Math.sin(tick*.1);
      ctx.fillStyle='#7a4a00';ctx.fillRect(b.x,b.y,b.w,b.h);
      const g=ctx.createLinearGradient(b.x,b.y,b.x,b.y+b.h);g.addColorStop(0,'#ffd700');g.addColorStop(.5,'#ff9900');g.addColorStop(1,'#cc7700');
      ctx.fillStyle=g;ctx.fillRect(b.x+2,b.y+2,b.w-4,b.h-4);ctx.shadowColor='#ffd700';ctx.shadowBlur=8*p;ctx.strokeStyle='#ffe88a';ctx.lineWidth=2;ctx.strokeRect(b.x+1,b.y+1,b.w-2,b.h-2);
      ctx.shadowBlur=0;ctx.fillStyle='#fff6';ctx.fillRect(b.x+4,b.y+4,8,4);
      drawGlyph('?',[b.x+b.w/2,b.y+b.h/2+1],Math.floor(b.w*.55),'#4a2200');
    } else if(b.type==='c'&&!b.used){
      drawMoneyBlock(b.x,b.y,b.w,b.h);
    } else if(b.type==='c'&&b.used){
      // Emptied coin brick — looks like a regular brick now
      ctx.fillStyle='#3a180a';ctx.fillRect(b.x,b.y,b.w,b.h);ctx.strokeStyle='#7a3816';ctx.lineWidth=1.5;ctx.strokeRect(b.x+1,b.y+1,b.w-2,b.h-2);
      ctx.strokeStyle='#261006';ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(b.x,b.y+b.h/2);ctx.lineTo(b.x+b.w,b.y+b.h/2);ctx.stroke();
      ctx.beginPath();ctx.moveTo(b.x+b.w/3,b.y);ctx.lineTo(b.x+b.w/3,b.y+b.h/2);ctx.stroke();
      ctx.beginPath();ctx.moveTo(b.x+b.w*2/3,b.y+b.h/2);ctx.lineTo(b.x+b.w*2/3,b.y+b.h);ctx.stroke();
    } else {
      ctx.fillStyle='#1e1830';ctx.fillRect(b.x,b.y,b.w,b.h);
      ctx.strokeStyle='#3a2850';ctx.lineWidth=1.5;ctx.strokeRect(b.x+1,b.y+1,b.w-2,b.h-2);
      if(b.type==='q'&&b.used&&b.regenT>0&&b.regenT<150){
        const charge=1-b.regenT/150;        // 0→1 as it recharges
        const pul=0.5+0.5*Math.sin(tick*.3);
        ctx.globalAlpha=charge*pul*0.7;
        ctx.shadowColor='#ffd700';ctx.shadowBlur=10*charge;
        ctx.fillStyle='#ffd700';
        ctx.fillRect(b.x+2,b.y+2,b.w-4,b.h-4);
        ctx.globalAlpha=1;ctx.shadowBlur=0;
      }
    }
    ctx.restore();
  }
}
// ── Coin sprite cache ───────────────────────────────────────────────────────
// Every coin in the game is identical (14×14) and only differs by its bobbing
// offset, yet drawCoins() used to rebuild each one from two arc() fills plus a
// fillText('$') — including re-assigning ctx.font, textAlign and textBaseline
// per coin. With 100-190 coins in a level that made drawCoins the single most
// expensive thing in the whole frame (measured: 3.1 ms on Prism Anomaly, more
// than the entire rest of draw() combined). Now the coin face is rasterised
// once into an offscreen canvas and each coin is a single drawImage.
let _coinSprite=null,_coinSpriteW=0;
function _paintCoin(c,w,face,shine,ink){
  const r=w/2;
  c.fillStyle=face;c.beginPath();c.arc(r,r,r,0,Math.PI*2);c.fill();
  c.fillStyle=shine;c.beginPath();c.arc(r-2,r-2,r-3,0,Math.PI*2);c.fill();
  c.fillStyle=ink;c.font='bold 7px monospace';c.textAlign='center';c.textBaseline='middle';
  c.fillText('$',r,r);
}
function _coinCanvas(w){
  const dpr=Math.min(2,(window.devicePixelRatio||1));
  const cv=document.createElement('canvas');
  cv.width=Math.ceil(w*dpr);cv.height=Math.ceil(w*dpr);
  cv.getContext('2d').scale(dpr,dpr);
  return cv;
}
function _getCoinSprite(w){
  if(_coinSprite&&_coinSpriteW===w)return _coinSprite;
  const cv=_coinCanvas(w);
  _paintCoin(cv.getContext('2d'),w,'#ffd700','#ffe880','#7a5000');
  _coinSprite=cv;_coinSpriteW=w;
  return cv;
}
// ── Монета Призма-аномалии ──────────────────────────────────────────────────
// Золотая монета была там единственным предметом с «прошлым цветом»: мир
// светится всем спектром, а по нему рассыпаны одинаковые жёлтые кружки. Красить
// их фильтром нельзя — монет в уровне под две сотни, а ctx.filter на объект
// стоит дороже всего остального кадра. Поэтому монета заранее нарисована в
// двенадцати цветах (шаг 30°), и в кадре это по-прежнему один drawImage:
// какой из спрайтов взять, решает положение монеты и время.
const _PRISM_COIN_STEPS=12;
let _prismCoins=null,_prismCoinsW=0;
function _getPrismCoinSprite(w,i){
  if(!_prismCoins||_prismCoinsW!==w){
    _prismCoins=[];_prismCoinsW=w;
    for(let k=0;k<_PRISM_COIN_STEPS;k++){
      const h=k*(360/_PRISM_COIN_STEPS);
      const cv=_coinCanvas(w);
      _paintCoin(cv.getContext('2d'),w,
        `hsl(${h},95%,58%)`,`hsl(${h},100%,78%)`,`hsl(${h},85%,20%)`);
      _prismCoins.push(cv);
    }
  }
  return _prismCoins[((i%_PRISM_COIN_STEPS)+_PRISM_COIN_STEPS)%_PRISM_COIN_STEPS];
}
function drawCoins(){
  const vLeft=camX-30,vRight=camX+W+30;
  const prism=prismWorld();
  // Оттенок монеты: то же «по месту и времени», что у платформ и кирпичей, —
  // соседние предметы попадают в соседние цвета спектра, а не вразнобой.
  const coinStep=(c)=>Math.floor(((c.x*0.5+tick*0.9)%360+360)%360/(360/_PRISM_COIN_STEPS));
  // Cheap additive bloom pass behind coins (medium+ quality).
  if(GFX.glow>0){
    ctx.save();ctx.globalCompositeOperation='lighter';
    for(const c of coins){
      if(c.got||c.x<vLeft||c.x>vRight)continue;
      const cx=c.x+c.w/2,cy=c.y+c.h/2+Math.sin(c.a)*3;
      bloom(cx,cy,c.w*1.3,
        prism?`hsl(${coinStep(c)*(360/_PRISM_COIN_STEPS)},95%,60%)`:'#ffd700',0.5);
    }
    ctx.restore();
  }
  const spr=_getCoinSprite(14);
  for(const c of coins){
    if(c.got)continue;
    if(c.x<vLeft||c.x>vRight)continue;
    c.a+=.07*_animK;
    const cy=c.y+Math.sin(c.a)*3;
    ctx.drawImage(prism?_getPrismCoinSprite(14,coinStep(c)):spr,c.x,cy,c.w,c.w);
  }
}
function drawJumpPads(){
  const vLeft=camX-40,vRight=camX+W+40;
  // В Призма-аномалии светится всё, и циановая пружина выделялась цветом «из
  // другого мира». Здесь она берёт свой оттенок из спектра — по месту и
  // времени, как платформы рядом. Форма не меняется: узнают её по ней.
  const prism=prismWorld();
  for(const jp of jumpPads){
    if(jp.x+jp.w<vLeft||jp.x>vRight)continue;
    jp.anim+=0.08*_animK;
    const pulse=0.8+0.2*Math.sin(jp.anim);
    const hue=(jp.x*0.5+prismFlow()*0.9)%360;
    const glow=prism?`hsl(${hue},100%,65%)`:'#00ffff';
    ctx.save();

    // Metallic base with gradient
    const baseGrad=ctx.createLinearGradient(jp.x,jp.y,jp.x,jp.y+jp.h);
    baseGrad.addColorStop(0,prism?`hsl(${hue},60%,24%)`:'#1a3a4a');
    baseGrad.addColorStop(1,prism?`hsl(${hue},60%,10%)`:'#0a1a2a');
    ctx.fillStyle=baseGrad;
    ctx.fillRect(jp.x,jp.y,jp.w,jp.h);

    // Glowing energy strips
    ctx.shadowColor=glow;
    ctx.shadowBlur=8*pulse;
    const stripeCount=5;
    for(let i=0;i<stripeCount;i++){
      const offset=(tick*3+i*12)%(jp.w+12);
      ctx.fillStyle=prism?`hsl(${(hue+i*24)%360},100%,65%)`:'#00ffff';
      ctx.globalAlpha=0.6*pulse;
      ctx.fillRect(jp.x+offset-6,jp.y+2,4,jp.h-4);
    }
    ctx.globalAlpha=1;
    ctx.shadowBlur=0;

    // Border
    ctx.strokeStyle=glow;
    ctx.lineWidth=1;
    ctx.strokeRect(jp.x,jp.y,jp.w,jp.h);

    // Animated arrow up
    ctx.fillStyle=glow;
    ctx.globalAlpha=pulse;
    ctx.shadowColor=glow;
    ctx.shadowBlur=10*pulse;
    const arrowY=jp.y-8-Math.sin(jp.anim*2)*4;
    ctx.beginPath();
    ctx.moveTo(jp.x+jp.w/2,arrowY);
    ctx.lineTo(jp.x+jp.w/2-8,arrowY+10);
    ctx.lineTo(jp.x+jp.w/2+8,arrowY+10);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha=1;
    ctx.shadowBlur=0;
    ctx.restore();
  }
}
function drawHazards(){
  // Вход в бонус-комнату: пульсирующий проём. После использования гаснет,
  // чтобы не звать туда второй раз.
  for(const hz of hazards){
    if(hz.type!=='bonusDoor')continue;
    hz.anim=(hz.anim||0)+0.06*(window.BB_animK?window.BB_animK():1);
    ctx.save();
    const a=hz.used?0.18:0.55+Math.sin(hz.anim)*0.25;
    ctx.globalAlpha=a;
    ctx.strokeStyle='#4de2ff';ctx.lineWidth=3;
    ctx.shadowBlur=hz.used?0:14;ctx.shadowColor='#4de2ff';
    ctx.strokeRect(hz.x,hz.y,hz.w,hz.h);
    ctx.globalAlpha=a*0.35;
    ctx.fillStyle='#0a2a3a';ctx.fillRect(hz.x+3,hz.y+3,hz.w-6,hz.h-6);
    ctx.restore();
  }
  // Выход из бонус-комнаты. Зелёный, а не голубой, как вход: два одинаковых
  // проёма в одной комнате читались бы как «куда-то ещё», а этот ведёт назад.
  // Стрелка внутри показывает направление — наружу.
  for(const hz of hazards){
    if(hz.type!=='bonusExit')continue;
    hz.anim=(hz.anim||0)+0.05*(window.BB_animK?window.BB_animK():1);
    const a=0.6+Math.sin(hz.anim)*0.22;
    ctx.save();
    ctx.globalAlpha=a;
    ctx.strokeStyle='#5cff9d';ctx.lineWidth=3;
    ctx.shadowBlur=16;ctx.shadowColor='#5cff9d';
    ctx.strokeRect(hz.x,hz.y,hz.w,hz.h);
    ctx.globalAlpha=a*0.30;ctx.shadowBlur=0;
    ctx.fillStyle='#0a3a20';ctx.fillRect(hz.x+3,hz.y+3,hz.w-6,hz.h-6);
    ctx.globalAlpha=a;
    ctx.strokeStyle='#bfffd8';ctx.lineWidth=2;
    const cx=hz.x+hz.w/2,cy=hz.y+hz.h/2;
    ctx.beginPath();
    ctx.moveTo(cx-7,cy);ctx.lineTo(cx+7,cy);
    ctx.moveTo(cx+2,cy-6);ctx.lineTo(cx+8,cy);ctx.lineTo(cx+2,cy+6);
    ctx.stroke();
    ctx.restore();
  }
  const vLeft=camX-40,vRight=camX+W+40;
  const _prism=prismWorld();
  // Шипы в Призма-аномалии красятся не фильтром, а сразу спектром (см. ниже):
  // фильтр стоит дорого и оставляет в кадре светотень старого серого. Прочим
  // опасностям (лава, кислота, пила) форму так просто не перекрасишь — им
  // по-прежнему нужен фильтр, и он включается настройкой «Преломление».
  const _prismHz=_prism&&prismFxOn();
  for(const hz of hazards){
    if(hz.x+hz.w<vLeft||hz.x>vRight)continue;
    const _spikePrism=_prism&&hz.type==='spikes';
    ctx.save();
    if(_prismHz&&!_spikePrism)ctx.filter=prismFilter((((hz.x*0.6+prismFlow()*0.5)%360)/20|0)*20,6.5,1.25);
    if(hz.type==='spikes'){
      // Шип светится собственным цветом из спектра — оттенок берётся по месту и
      // времени, теми же формулами, что у платформы под ним. Серый металл
      // остался бы единственной бесцветной вещью в мире света.
      const hue=_spikePrism?(((hz.x*0.6+prismFlow()*0.9)%360+360)%360):0;
      const hq=_spikePrism?(hue/18|0)*18:0;
      // Metallic base
      ctx.fillStyle=_spikePrism?`hsl(${hq},70%,16%)`:'#2a2a2a';
      ctx.fillRect(hz.x,hz.y+hz.h-3,hz.w,3);

      // Sharp dangerous spikes with gradient
      const spikeCount=3;
      const spikeW=hz.w/spikeCount;
      // Spikes are static, so cache their (position-dependent) gradients on the
      // hazard and reuse across frames. Invalidate only if the hazard moves.
      // В радужном мире цвет ещё и ползёт по времени, поэтому кэш держится за
      // квантованный оттенок: пересобираем градиенты раз в 18°, а не каждый кадр.
      if(!hz._spikeGrads||hz._spikeGX!==hz.x||hz._spikeGH!==hq){
        hz._spikeGrads=[];hz._spikeGX=hz.x;hz._spikeGH=hq;
      }
      for(let i=0;i<spikeCount;i++){
        const sx=hz.x+i*spikeW;

        // Spike gradient (dark to light) - cached per spike.
        let grad=hz._spikeGrads[i];
        if(!grad){
          grad=ctx.createLinearGradient(sx,hz.y+hz.h,sx+spikeW/2,hz.y);
          if(_spikePrism){
            grad.addColorStop(0,`hsl(${hq},85%,28%)`);
            grad.addColorStop(0.5,`hsl(${(hq+30)%360},95%,55%)`);
            grad.addColorStop(1,`hsl(${(hq+60)%360},100%,78%)`);
          } else {
            grad.addColorStop(0,'#4a4a4a');
            grad.addColorStop(0.5,'#888888');
            grad.addColorStop(1,'#cccccc');
          }
          hz._spikeGrads[i]=grad;
        }
        ctx.fillStyle=grad;

        ctx.beginPath();
        ctx.moveTo(sx,hz.y+hz.h);
        ctx.lineTo(sx+spikeW/2,hz.y);
        ctx.lineTo(sx+spikeW,hz.y+hz.h);
        ctx.closePath();
        ctx.fill();

        // Sharp highlight on tip
        ctx.fillStyle='#ffffff';
        ctx.beginPath();
        ctx.moveTo(sx+spikeW/2-1,hz.y+2);
        ctx.lineTo(sx+spikeW/2,hz.y);
        ctx.lineTo(sx+spikeW/2+1,hz.y+2);
        ctx.closePath();
        ctx.fill();

        // Dark outline
        ctx.strokeStyle='#1a1a1a';
        ctx.lineWidth=1;
        ctx.beginPath();
        ctx.moveTo(sx,hz.y+hz.h);
        ctx.lineTo(sx+spikeW/2,hz.y);
        ctx.lineTo(sx+spikeW,hz.y+hz.h);
        ctx.stroke();
      }

      // Warning glow. В радужном мире оно белое: красная искра была бы там
      // единственным «чужим» цветом, а предупредить достаточно и светом.
      ctx.shadowColor=_spikePrism?'#ffffff':'#ff4444';
      ctx.shadowBlur=6;
      ctx.strokeStyle=_spikePrism?'#ffffff':'#ff4444';
      ctx.globalAlpha=0.3+0.2*Math.sin(tick*0.1);
      ctx.lineWidth=2;
      for(let i=0;i<spikeCount;i++){
        const sx=hz.x+i*spikeW;
        ctx.beginPath();
        ctx.moveTo(sx+spikeW/2,hz.y);
        ctx.lineTo(sx+spikeW/2,hz.y+4);
        ctx.stroke();
      }
      ctx.globalAlpha=1;
      ctx.shadowBlur=0;
    } else { drawHazardExtra(hz); }
    ctx.restore();
  }
}

// ════════════════════════════════════════════════════════════════════════
//  LEVEL VARIETY  —  mechanics 4 (moving saws & plasma pendulums),
//  7 (secret data-shards + bonus rooms) and 10 (per-world thematic hazards).
//  All motion is derived from the global `tick` so it is deterministic (no
//  per-frame accumulation/drift), cheap on CPU, and stays in lock-step across
//  the fixed-timestep loop and the network mode.
// ════════════════════════════════════════════════════════════════════════
const SHARD_VALUE=75;        // score per secret data-shard
const ALL_SHARDS_BONUS=300;  // bonus for collecting every shard in a level
const RAINBOW_SHARD_VALUE=500; // score for the secret rainbow shard (1-per-world, 10 total)
// Per-world thematic hazard (mechanic 10). Worlds without an entry rely on the
// universal saw/pendulum hazards. world: 2=Lava 3=Ice 7=Toxic 8=Storm.
const WORLD_HAZARD={2:'geyser',3:'icicle',7:'toxin',8:'lightning'};

// ── Generator (called from genLevel for non-boss levels) ──────────────────
function genLevelVariety(rng, lvl, nodes, hit, add){
  const worldId=Math.min(Math.floor((lvl-1)/10),9);
  const groundNodes=nodes.filter(n=>n.kind==='ground'&&n.w>=120&&n.x>520&&n.x<worldW-820);
  const airNodes=nodes.filter(n=>n.kind!=='ground'&&n.w>=70&&n.x>360);

  // shuffle helper (uses the level rng so adventure seeds stay deterministic)
  const shuffled=(arr)=>{const a=arr.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};

  // ── Mechanic 10: per-world thematic hazards (placed FIRST so they always fit) ──
  const wh=WORLD_HAZARD[worldId];
  if(wh){
    const whWant=1+Math.floor(rng()*2)+(worldId>=7?1:0);
    const cand=shuffled(groundNodes);
    let placed=0;
    const placeWH=(n,force)=>{
      const px=Math.round(n.x+24+rng()*Math.max(8,n.w-48));
      if(wh==='geyser'){
        const w=26;if(!force&&hit(px,n.y-4,w,4,4))return false;
        // curH/g задаются в обновлении, но кадр может быть нарисован до него —
        // тогда в градиент столба уходит NaN и отрисовка мира падает целиком.
        hazards.push({type:'geyser',x:px,y:n.y-4,w,h:4,baseY:n.y,curH:0,g:0,maxH:90+rng()*40,cycle:150+Math.floor(rng()*90),phase:Math.floor(rng()*150)});
        add(px,n.y-6,w,6);return true;
      }else if(wh==='icicle'){
        const ceil=Math.max(8,n.y-160-rng()*40);
        hazards.push({type:'icicle',x:px,y:ceil,w:14,h:26,anchorY:ceil,groundY:n.y,cycle:170+Math.floor(rng()*110),phase:Math.floor(rng()*170),spd:1});return true;
      }else if(wh==='toxin'){
        const w=70+rng()*46,h=46;if(!force&&hit(px,n.y-h,w,h,2))return false;
        hazards.push({type:'toxin',x:px,y:n.y-h,w,h,baseY:n.y,cycle:130+Math.floor(rng()*70),phase:Math.floor(rng()*130)});return true;
      }else if(wh==='lightning'){
        // `span` is the band this storm cell strikes within. Without it the bolt
        // came down in exactly the same column forever, which read as a bug and
        // made the hazard trivial to walk around once seen.
        hazards.push({type:'lightning',x:px,w:10,topY:8,groundY:n.y,span:150+rng()*130,
                      cycle:160+Math.floor(rng()*120),phase:Math.floor(rng()*160),state:'idle',
                      strikeIdx:-1,hitX:px});return true;
      }
      return false;
    };
    for(const n of cand){ if(placed>=whWant)break; if(placeWH(n,false))placed++; }
    if(placed===0&&cand.length)placeWH(cand[0],true);   // guarantee at least one
  }

  // ── Mechanic 4a: moving circular saws ──
  const sawCount=Math.min(1+Math.floor(rng()*2)+(worldId>=4?1:0),3);
  let placedSaws=0;
  for(const n of groundNodes){
    if(placedSaws>=sawCount||rng()<0.5)continue;
    const r=13+rng()*4;
    const range=Math.min((n.w-40)/2,36+rng()*40);
    const cx=n.x+n.w/2,cy=n.y-r-6;
    if(range<14||hit(cx-range-r,cy-r,range*2+r*2,r*2,6))continue;
    hazards.push({type:'saw',x:cx-r,y:cy-r,w:r*2,h:r*2,r,cx,cy,axis:'h',range,spd:0.018+rng()*0.012,phase:rng()*Math.PI*2});
    add(cx-range-r,cy-r,range*2+r*2,r*2);placedSaws++;
  }
  for(const n of airNodes){               // a few vertical wall-saws
    if(placedSaws>=sawCount+1||rng()<0.8)continue;
    const r=12+rng()*3;
    const cx=n.x+n.w/2,cy=n.y-r-30,range=24+rng()*26;
    if(cy-range-r<12||hit(cx-r,cy-range-r,r*2,range*2+r*2,6))continue;
    hazards.push({type:'saw',x:cx-r,y:cy-r,w:r*2,h:r*2,r,cx,cy,axis:'v',range,spd:0.02+rng()*0.012,phase:rng()*Math.PI*2});
    add(cx-r,cy-range-r,r*2,range*2+r*2);placedSaws++;
  }

  // ── Mechanic 4b: plasma pendulums ──
  const penCount=Math.min(1+Math.floor(rng()*2),3);
  let placedPen=0;
  for(const n of groundNodes){
    if(placedPen>=penCount||rng()<0.6)continue;
    const pivotX=n.x+n.w*(0.3+rng()*0.4);
    const pivotY=Math.max(24,n.y-150-rng()*40);
    const len=70+rng()*55,r=11+rng()*4,amp=0.5+rng()*0.45;
    if(pivotY+len>n.y-6)continue;          // keep the orb above the floor
    // Pre-seed the orb position (rest pose, ang=0) so the very first draw() has
    // finite bx/by even if updateHazards() hasn't run yet (e.g. the level opens in
    // gState='paused' during a boss intro / cutscene, which skips hazard updates).
    hazards.push({type:'pendulum',x:pivotX-r,y:pivotY+len-r,w:r*2,h:r*2,r,pivotX,pivotY,len,amp,spd:0.026+rng()*0.014,phase:rng()*Math.PI*2,ang:0,bx:pivotX,by:pivotY+len});
    placedPen++;
  }

  // —— Mechanic 7a: secret data-shards (hidden, hard-to-reach) ——————————
  // Every level has EXACTLY 3 unique shards (75 score each). Worth 3/level ×
  // 100 levels = 300 total — the figure shown on the world map.
  const SHARDS_PER_LEVEL=3;
  const spots=[];
  for(const n of airNodes)spots.push({x:n.x+n.w/2-8,y:n.y-46});
  for(const n of groundNodes)if(rng()<0.4)spots.push({x:n.x+n.w*0.5-8,y:n.y-130-rng()*30});
  for(let i=spots.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[spots[i],spots[j]]=[spots[j],spots[i]];}
  // Fallback spots so we can ALWAYS reach 3, even on sparse layouts: float a
  // shard high above any ground node, spread across the level.
  if(spots.length<SHARDS_PER_LEVEL){
    const gn=groundNodes.length?groundNodes:nodes.filter(n=>n.kind==='ground');
    let gi=0;
    while(spots.length<SHARDS_PER_LEVEL && gn.length){
      const n=gn[gi%gn.length];gi++;
      spots.push({x:Math.round(n.x+n.w*0.5-8),y:Math.max(40,n.y-150-rng()*30)});
      if(gi>gn.length*3)break; // safety
    }
  }
  const want=Math.min(SHARDS_PER_LEVEL,spots.length);
  for(let i=0;i<want;i++){
    const s=spots[i];if(s.y<6)s.y=6;
    dataShards.push({id:`${s.x}_${s.y}`,x:s.x,y:s.y,w:16,h:16,got:false,phase:rng()*Math.PI*2});
  }
  dataShardsTotal=dataShards.length;

  // —— Secret Rainbow Shard: exactly one hidden level per world (see
  // RAINBOW_LEVEL_IN_WORLD). Collecting all 10 across the campaign unlocks
  // the secret 11th world — see WorldMap's rainbowCount() gate.
  {
    const _advN=lvl||0;
    const _worldIdx=Math.floor((_advN-1)/10);
    const _levelInWorld=_advN-_worldIdx*10;
    // В уровне дня осколка нет: он открывает секретный мир, и добывать его в
    // режиме, который каждый день собирается заново, было бы обходом кампании.
    if(!dailyMode&&_advN>0&&_worldIdx>=0&&_worldIdx<RAINBOW_LEVEL_IN_WORLD.length
       &&_levelInWorld===RAINBOW_LEVEL_IN_WORLD[_worldIdx]&&!rainbowCollected[_worldIdx]){
      // Reuse a leftover shard spot if one's free, otherwise float it above a
      // random ground node — either way it never overlaps the 3 regular shards.
      let rs=spots[want];
      if(!rs){
        const gn=groundNodes.length?groundNodes:nodes.filter(n=>n.kind==='ground');
        if(gn.length){const n=gn[Math.floor(rng()*gn.length)];rs={x:Math.round(n.x+n.w*0.5-9),y:Math.max(40,n.y-170-rng()*30)};}
      }
      if(rs){
        if(rs.y<6)rs.y=6;
        rainbowItem={worldIdx:_worldIdx,x:rs.x,y:rs.y,w:18,h:18,got:false,phase:rng()*Math.PI*2};
      }
    }
  }

  // —— Mechanic 7b: a hidden bonus room (coins + power-up on a secret ledge) —
  if(groundNodes.length){
    const host=groundNodes[Math.floor(rng()*groundNodes.length)];
    const bw=120,bx=Math.round(host.x+Math.max(0,(host.w-bw)/2));
    const by=Math.max(40,host.y-185-rng()*25);
    if(!hit(bx,by,bw,14,6)){
      platforms.push({x:bx,y:by,w:bw,h:12,type:'normal',solid:false,gone:false,bonus:true});
      add(bx,by,bw,14);
      const cn=5;
      for(let i=0;i<cn;i++)
        coins.push({x:bx+18+i*((bw-36)/(cn-1)),y:by-30,w:14,h:14,a:rng()*Math.PI*2,got:false,bonus:true});
      // src<0 — бонус из генерации уровня, а не из блока (см. hitBlock).
      powerups.push({x:bx+bw/2-12,y:by-58,w:24,h:24,vy:0,type:(rng()<0.5?'fire':'ice'),anim:0,got:false,src:-1});
    }
  }
}

// ── Per-frame motion + collision for the variety hazards ──────────────────
function _hazardHurt(p,isP2){
  if(!p||p.inv>0||p.starMode||p.respawning||p.fallRespawning)return;
  if(isP2)doHurtPlayer2(false);else doHurtPlayer(false);
  if(p){p.vy=-7;p.vx=(p.facing||1)*-3;}
  camShake=Math.max(camShake,8);
}
function updateHazards(){
  const ps=[[player,false],[player2,true]];
  let hurtP1=false,hurtP2=false;
  for(const hz of hazards){
    let active=true,box=hz;
    switch(hz.type){
      case 'saw':{
        const o=Math.sin(tick*hz.spd+hz.phase)*hz.range;
        if(hz.axis==='h'){hz.x=hz.cx+o-hz.r;hz.y=hz.cy-hz.r;}
        else{hz.x=hz.cx-hz.r;hz.y=hz.cy+o-hz.r;}
        box={x:hz.x+3,y:hz.y+3,w:hz.w-6,h:hz.h-6};break;        // tighter, fair hitbox
      }
      case 'pendulum':{
        const ang=Math.sin(tick*hz.spd+hz.phase)*hz.amp;hz.ang=ang;
        hz.bx=hz.pivotX+Math.sin(ang)*hz.len;hz.by=hz.pivotY+Math.cos(ang)*hz.len;
        hz.x=hz.bx-hz.r;hz.y=hz.by-hz.r;
        box={x:hz.x+2,y:hz.y+2,w:hz.w-4,h:hz.h-4};break;
      }
      case 'geyser':{
        const f=((tick+hz.phase)%hz.cycle)/hz.cycle;
        let g=0;if(f>0.35&&f<0.75)g=Math.sin(((f-0.35)/0.40)*Math.PI);
        hz.g=g;hz.curH=g*hz.maxH;active=g>0.18;
        hz.y=hz.baseY-hz.curH;hz.h=hz.curH;
        box={x:hz.x+4,y:hz.y,w:hz.w-8,h:hz.h};break;
      }
      case 'icicle':{
        const f=((tick*hz.spd+hz.phase)%hz.cycle)/hz.cycle;
        if(f<0.55){hz.y=hz.anchorY;hz.state=(f>0.40)?'warn':'idle';active=false;}
        else if(f<0.78){const t=(f-0.55)/0.23;hz.y=hz.anchorY+t*t*(hz.groundY-hz.anchorY-hz.h);hz.state='fall';active=true;}
        else{hz.state='gone';active=false;}
        box={x:hz.x,y:hz.y,w:hz.w,h:hz.h};break;
      }
      case 'toxin':{
        const d=(Math.sin((tick+hz.phase)*(Math.PI*2/hz.cycle))+1)/2;hz.d=d;active=d>0.55;
        box={x:hz.x+4,y:hz.y+6,w:hz.w-8,h:hz.h-8};break;
      }
      case 'lightning':{
        const t=tick+hz.phase;
        const f=(t%hz.cycle)/hz.cycle;
        // Each cycle strikes a different column inside the cell's band. The
        // target is chosen as soon as the cycle starts and the dashed warning
        // marker (drawHazards) points at it for ~0.16 of the cycle before the
        // bolt lands, so it stays dodgeable — just not memorisable.
        const idx=Math.floor(t/hz.cycle);
        if(hz.strikeIdx!==idx){
          hz.strikeIdx=idx;
          const span=hz.span||0;
          hz.hitX=hz.x+(_sceneryRnd(idx,(hz.phase|0)+5)-0.5)*span;
        }
        if(f>0.78&&f<0.86){hz.state='strike';active=true;}
        else{hz.state=(f>0.62)?'warn':'idle';active=false;}
        box={x:hz.hitX-4,y:hz.topY,w:hz.w+8,h:hz.groundY-hz.topY};break;
      }
      default: active=false;      // 'spikes' are handled inside updatePlayer
    }
    if(!active)continue;
    if(player&&!hurtP1&&aabb(player,box)){_hazardHurt(player,false);hurtP1=true;}
    if(player2&&!hurtP2&&aabb(player2,box)){_hazardHurt(player2,true);hurtP2=true;}
  }
}

// ── Secret data-shards: collection + all-collected bonus (mechanic 7) ─────
function updateDataShards(){
  if(!dataShards.length)return;
  const ps=(typeof activePlayers==='function')?activePlayers():(player?[player]:[]);
  for(const c of dataShards){
    if(c.got)continue;
    c.phase+=0.06;
    for(const p of ps){
      if(!p||!aabb(p,c))continue;
      c.got=true;dataShardsGot++;score+=SHARD_VALUE;
      if(window.Juice)window.Juice.pickup(c.x+(c.w||14)/2-camX,c.y+(c.h||14)/2,'shard');
      if(typeof AchTrack!=='undefined')AchTrack.shard();
      if(typeof SFX!=='undefined'&&SFX.secret)SFX.secret();
      floatTxt(c.x+c.w/2,c.y,'\u25c6 +'+SHARD_VALUE,'#0ff');
      burst(c.x+c.w/2,c.y+c.h/2,'#0ff',12,3,4);
      if(dataShardsGot>=dataShardsTotal&&!shardBonusGiven){
        shardBonusGiven=true;score+=ALL_SHARDS_BONUS;
        floatTxt(c.x+c.w/2,c.y-18,T('dataBonusTxt',ALL_SHARDS_BONUS),'#0ff');
        if(typeof SFX!=='undefined'&&SFX.achievement)SFX.achievement();
        camShake=Math.max(camShake,8);
      }
      break;
    }
  }
}
function updateRainbowItem(){
  if(!rainbowItem||rainbowItem.got)return;
  rainbowItem.phase+=0.05;
  const ps=(typeof activePlayers==='function')?activePlayers():(player?[player]:[]);
  for(const p of ps){
    if(!p||!aabb(p,rainbowItem))continue;
    rainbowItem.got=true;
    markRainbowCollected(rainbowItem.worldIdx);
    score+=RAINBOW_SHARD_VALUE;
    if(typeof SFX!=='undefined'&&SFX.achievement)SFX.achievement();
    const n=rainbowCount();
    floatTxt(rainbowItem.x+rainbowItem.w/2,rainbowItem.y-6,T('rainbowGot',n),'#fff');
    burst(rainbowItem.x+rainbowItem.w/2,rainbowItem.y+rainbowItem.h/2,'#fff',26,4.5,5);
    camShake=Math.max(camShake,10);
    if(n>=10){
      // The 10th shard — announce the secret world unlocking right here, since
      // the player won't see the map again until they exit the level.
      floatTxt(rainbowItem.x+rainbowItem.w/2,rainbowItem.y-26,T('rainbowAllFound'),'#f0f');
    }
    break;
  }
}

// ── Renderers for the variety hazards & data-shards ───────────────────────
function drawHazardExtra(hz){
  const wob=Math.sin(tick*0.2);
  switch(hz.type){
    case 'saw':{
      const cx=hz.x+hz.r,cy=hz.y+hz.r,r=hz.r;
      ctx.translate(cx,cy);ctx.rotate(tick*0.3);
      ctx.fillStyle='#cfd6e0';ctx.beginPath();
      const teeth=10;
      for(let i=0;i<teeth;i++){
        const a0=(i/teeth)*Math.PI*2,a1=((i+0.5)/teeth)*Math.PI*2;
        ctx.lineTo(Math.cos(a0)*r,Math.sin(a0)*r);
        ctx.lineTo(Math.cos(a1)*(r+5),Math.sin(a1)*(r+5));
      }
      ctx.closePath();ctx.fill();
      ctx.fillStyle='#8b95a3';ctx.beginPath();ctx.arc(0,0,r*0.7,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#3a4150';ctx.beginPath();ctx.arc(0,0,r*0.28,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='#e8edf2';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(0,0,r*0.7,0,Math.PI*2);ctx.stroke();
      break;
    }
    case 'pendulum':{
      // Never feed non-finite values to the canvas (createRadialGradient throws on
      // NaN/Infinity, which would kill the whole rAF loop and freeze the game).
      if(!isFinite(hz.bx)||!isFinite(hz.by)||!isFinite(hz.r))break;
      ctx.strokeStyle='#556';ctx.lineWidth=3;
      ctx.beginPath();ctx.moveTo(hz.pivotX,hz.pivotY);ctx.lineTo(hz.bx,hz.by);ctx.stroke();
      ctx.fillStyle='#888';ctx.beginPath();ctx.arc(hz.pivotX,hz.pivotY,4,0,Math.PI*2);ctx.fill();
      const r=hz.r;
      if(GFX.glow>0){ctx.globalCompositeOperation='lighter';bloom(hz.bx,hz.by,r*2.4,'#b0f',0.6);ctx.globalCompositeOperation='source-over';}
      const g=ctx.createRadialGradient(hz.bx,hz.by,1,hz.bx,hz.by,r);
      g.addColorStop(0,'#fff');g.addColorStop(0.4,'#d6a0ff');g.addColorStop(1,'#7a18ff');
      ctx.fillStyle=g;ctx.beginPath();ctx.arc(hz.bx,hz.by,r,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='rgba(200,140,255,'+(0.4+0.3*wob)+')';ctx.lineWidth=2;
      ctx.beginPath();ctx.arc(hz.bx,hz.by,r+3+wob*2,0,Math.PI*2);ctx.stroke();
      break;
    }
    case 'geyser':{
      if(hz.curH<2)break;
      const x=hz.x,w=hz.w,topY=hz.baseY-hz.curH;
      const g=ctx.createLinearGradient(0,topY,0,hz.baseY);
      g.addColorStop(0,'rgba(255,160,40,0.95)');g.addColorStop(0.5,'rgba(255,90,20,0.9)');g.addColorStop(1,'rgba(120,20,0,0.55)');
      ctx.fillStyle=g;ctx.beginPath();
      const w2=Math.sin(tick*0.4)*3;
      ctx.moveTo(x,hz.baseY);ctx.quadraticCurveTo(x+w/2+w2,topY-8,x+w/2,topY);
      ctx.quadraticCurveTo(x+w/2-w2,topY-8,x+w,hz.baseY);ctx.closePath();ctx.fill();
      if(GFX.glow>0){ctx.globalCompositeOperation='lighter';bloom(x+w/2,topY+10,w,'#f60',0.5);ctx.globalCompositeOperation='source-over';}
      break;
    }
    case 'icicle':{
      if(hz.state==='gone')break;
      const x=hz.x,w=hz.w,y=hz.y,h=hz.h;
      const sh=(hz.state==='warn')?Math.sin(tick*0.8)*1.5:0;
      const g=ctx.createLinearGradient(x,y,x,y+h);
      g.addColorStop(0,'#cfeaff');g.addColorStop(1,'#5aa0e0');
      ctx.fillStyle=g;ctx.beginPath();
      ctx.moveTo(x+sh,y);ctx.lineTo(x+w+sh,y);ctx.lineTo(x+w/2+sh,y+h);ctx.closePath();ctx.fill();
      ctx.fillStyle='rgba(255,255,255,0.6)';ctx.fillRect(x+w/2-1+sh,y+2,2,h*0.5);
      break;
    }
    case 'toxin':{
      const d=hz.d||0;ctx.globalAlpha=0.25+d*0.45;ctx.fillStyle='#9bf000';
      const cy=hz.y+hz.h/2;
      for(let i=0;i<5;i++){
        const px=hz.x+hz.w*(i/4),py=cy+Math.sin(tick*0.05+i)*6;
        ctx.beginPath();ctx.arc(px,py,hz.h*0.42*(0.7+0.3*Math.sin(tick*0.04+i*2)),0,Math.PI*2);ctx.fill();
      }
      ctx.globalAlpha=1;
      if(d>0.55){ctx.strokeStyle='rgba(180,255,40,0.5)';ctx.lineWidth=1;ctx.strokeRect(hz.x,hz.y,hz.w,hz.h);}
      break;
    }
    case 'lightning':{
      const x=(hz.hitX!=null?hz.hitX:hz.x);
      const cx=x+hz.w/2;
      if(hz.state==='warn'){
        // Ground marker + dashed column so the player can see WHERE it will land
        ctx.strokeStyle='rgba(160,180,255,0.5)';ctx.setLineDash([4,4]);ctx.lineWidth=2;
        ctx.beginPath();ctx.moveTo(cx,hz.topY);ctx.lineTo(cx,hz.groundY);ctx.stroke();ctx.setLineDash([]);
        const pulse=0.35+Math.abs(Math.sin(tick*0.25))*0.45;
        ctx.globalAlpha=pulse;ctx.strokeStyle='#aab4ff';ctx.lineWidth=2;
        ctx.beginPath();ctx.ellipse(cx,hz.groundY-2,14,4,0,0,Math.PI*2);ctx.stroke();
        ctx.globalAlpha=1;
      }else if(hz.state==='strike'){
        if(GFX.glow>0){ctx.globalCompositeOperation='lighter';bloom(cx,(hz.topY+hz.groundY)/2,40,'#aaf',0.6);ctx.globalCompositeOperation='source-over';}
        ctx.strokeStyle='#eaf2ff';ctx.lineWidth=3;ctx.shadowColor='#88f';ctx.shadowBlur=12;ctx.beginPath();
        // Deterministic per strike: Math.random() here re-drew a different bolt
        // on every frame of the flash, so it looked like static rather than one
        // discharge holding for a few frames.
        const seed=(hz.strikeIdx||0)*7.13+(hz.phase||0);
        let yy=hz.topY,xx=cx;ctx.moveTo(xx,yy);
        while(yy<hz.groundY){yy+=18;xx=cx+Math.sin(seed+yy*0.17)*12;ctx.lineTo(xx,Math.min(yy,hz.groundY));}
        ctx.stroke();ctx.shadowBlur=0;
      }
      break;
    }
  }
}
function drawDataShards(){
  if(!dataShards.length)return;
  const vLeft=camX-40,vRight=camX+W+40;
  for(const c of dataShards){
    if(c.got||c.x+c.w<vLeft||c.x>vRight)continue;
    const cx=c.x+c.w/2,cy=c.y+c.h/2+Math.sin(c.phase)*3;
    ctx.save();
    if(GFX.glow>0){ctx.globalCompositeOperation='lighter';bloom(cx,cy,c.w*1.6,'#0ff',0.55);ctx.globalCompositeOperation='source-over';}
    ctx.translate(cx,cy);ctx.rotate(c.phase*0.5);
    const s=c.w/2;
    const g=ctx.createLinearGradient(-s,-s,s,s);
    g.addColorStop(0,'#aeffff');g.addColorStop(0.5,'#0ff');g.addColorStop(1,'#08a0c0');
    ctx.fillStyle=g;ctx.beginPath();
    ctx.moveTo(0,-s);ctx.lineTo(s*0.7,0);ctx.lineTo(0,s);ctx.lineTo(-s*0.7,0);ctx.closePath();ctx.fill();
    ctx.strokeStyle='#eaffff';ctx.lineWidth=1;ctx.stroke();
    ctx.strokeStyle='rgba(255,255,255,0.6)';ctx.beginPath();
    ctx.moveTo(0,-s);ctx.lineTo(0,s);ctx.moveTo(-s*0.7,0);ctx.lineTo(s*0.7,0);ctx.stroke();
    ctx.restore();
  }
}
function drawRainbowItem(){
  if(!rainbowItem||rainbowItem.got)return;
  const c=rainbowItem;
  if(c.x+c.w<camX-40||c.x>camX+W+40)return;
  const cx=c.x+c.w/2,cy=c.y+c.h/2+Math.sin(c.phase)*4;
  const hue=(tick*3)%360;
  ctx.save();
  if(GFX.glow>0){ctx.globalCompositeOperation='lighter';bloom(cx,cy,c.w*2.2,`hsl(${hue},100%,60%)`,0.6);ctx.globalCompositeOperation='source-over';}
  ctx.translate(cx,cy);ctx.rotate(c.phase*0.7);
  const s=c.w/2;
  const g=ctx.createLinearGradient(-s,-s,s,s);
  g.addColorStop(0,`hsl(${hue},100%,75%)`);
  g.addColorStop(0.5,`hsl(${(hue+90)%360},100%,60%)`);
  g.addColorStop(1,`hsl(${(hue+180)%360},100%,55%)`);
  ctx.fillStyle=g;ctx.beginPath();
  ctx.moveTo(0,-s);ctx.lineTo(s*0.75,-s*0.2);ctx.lineTo(s*0.5,s);ctx.lineTo(-s*0.5,s);ctx.lineTo(-s*0.75,-s*0.2);ctx.closePath();ctx.fill();
  ctx.strokeStyle='#fff';ctx.lineWidth=1.4;ctx.stroke();
  ctx.restore();
  // A faint upward sparkle trail so it reads as special from a distance.
  if(tick%6===0)burst(cx,cy,`hsl(${hue},100%,70%)`,1,0.6,1.5);
}
function drawMazeKeys(){
  const vLeft=camX-40,vRight=camX+W+40;
  for(const key of mazeKeys){
    if(key.collected||key.x<vLeft||key.x>vRight)continue;
    const bob=Math.sin(key.anim)*4;
    const kx=key.x+key.w/2;
    const ky=key.y+bob+key.h/2;
    ctx.save();
    // Glow
    ctx.shadowColor='#ff0';
    ctx.shadowBlur=12;
    // Key body
    ctx.fillStyle='#ffd700';
    ctx.fillRect(key.x+2,ky-3,12,6);
    // Key teeth
    ctx.fillRect(key.x+14,ky-5,2,3);
    ctx.fillRect(key.x+14,ky+2,2,3);
    // Key head (circle)
    ctx.beginPath();
    ctx.arc(key.x+6,ky,4,0,Math.PI*2);
    ctx.fill();
    ctx.restore();
  }
}
function drawDoors(){
  const vLeft=camX-40,vRight=camX+W+40;
  for(const door of doors){
    if(door.x+door.w<vLeft||door.x>vRight)continue;
    if(door.open)continue; // Don't draw open doors
    ctx.save();
    // Door frame
    ctx.fillStyle='#222';
    ctx.fillRect(door.x,door.y,door.w,door.h);
    // Door bars
    ctx.strokeStyle='#f44';
    ctx.lineWidth=3;
    for(let i=0;i<5;i++){
      const bx=door.x+5+i*8;
      ctx.beginPath();
      ctx.moveTo(bx,door.y);
      ctx.lineTo(bx,door.y+door.h);
      ctx.stroke();
    }
    // Lock indicator
    ctx.fillStyle='#f44';
    ctx.font='bold 10px monospace';
    ctx.textAlign='center';
    ctx.textBaseline='middle';
    ctx.fillText('🔒',door.x+door.w/2,door.y+door.h/2);
    ctx.restore();
  }
}
function drawSpotlights(){
  const vLeft=camX-40,vRight=camX+W+40;
  for(const sl of spotlights){
    if(sl.x<vLeft||sl.x>vRight)continue;
    ctx.save();
    // Spotlight cone
    ctx.globalAlpha=0.3;
    const grd=ctx.createRadialGradient(sl.x,sl.y,0,sl.x,sl.y,sl.range);
    grd.addColorStop(0,sl.alerted?'rgba(255,0,0,0.6)':'rgba(255,200,100,0.6)');
    grd.addColorStop(1,'rgba(255,200,100,0)');
    ctx.fillStyle=grd;
    ctx.beginPath();
    ctx.moveTo(sl.x,sl.y);
    ctx.arc(sl.x,sl.y,sl.range,sl.angle-0.25,sl.angle+0.25);
    ctx.closePath();
    ctx.fill();
    // Spotlight source
    ctx.globalAlpha=1;
    ctx.fillStyle=sl.alerted?'#f44':'#ffa500';
    ctx.shadowColor=sl.alerted?'#f44':'#ffa500';
    ctx.shadowBlur=10;
    ctx.beginPath();
    ctx.arc(sl.x,sl.y,6,0,Math.PI*2);
    ctx.fill();
    ctx.restore();
  }
}
// ── Darkness modifier ────────────────────────────────────────────────────────
// Persistent offscreen mask canvas so we don't reallocate every frame.
let _darkCv=null,_darkCtx=null;
function _punchLight(c,sx,sy,r,strength){
  // Soft circular hole in the dark mask via destination-out.
  if(sx<-r||sx>W+r||sy<-r||sy>H+r) return; // off-screen — skip
  const g=c.createRadialGradient(sx,sy,0,sx,sy,r);
  g.addColorStop(0,'rgba(0,0,0,'+strength+')');
  g.addColorStop(0.65,'rgba(0,0,0,'+(strength*0.7)+')');
  g.addColorStop(1,'rgba(0,0,0,0)');
  c.fillStyle=g;
  c.beginPath();c.arc(sx,sy,r,0,Math.PI*2);c.fill();
}
function drawDarknessOverlay(){
  if(!_darkCv){ _darkCv=document.createElement('canvas'); _darkCv.width=W; _darkCv.height=H; _darkCtx=_darkCv.getContext('2d'); }
  const c=_darkCtx, cy=window.camY||0;
  // 1) Fill the mask with near-opaque darkness.
  c.globalCompositeOperation='source-over';
  c.clearRect(0,0,W,H);
  c.fillStyle='rgba(2,2,10,0.96)';
  c.fillRect(0,0,W,H);
  // 2) Punch light holes around every light source.
  c.globalCompositeOperation='destination-out';
  // Players (subtle flicker so the light feels alive)
  const flick=1+Math.sin(tick*0.18)*0.04;
  const lights=[];
  if(player&&player.alive!==false) lights.push([player,158*flick]);
  if(twoPlayer&&player2&&player2.alive!==false) lights.push([player2,158*flick]);
  if(window.netActive&&window.netPlayers){
    for(const [,e] of window.netPlayers){ if(e.playerObj) lights.push([e.playerObj,150*flick]); }
  }
  for(const [p,r] of lights){
    _punchLight(c, p.x-camX+p.w/2, p.y-cy+p.h/2, r, 1);
  }
  // Enemies — a small glow so they're visible as they approach.
  // Perf: cap active light sources to the nearest few enemies instead of every
  // enemy in the level — with many enemies alive at once, the per-light radial
  // gradient + fill (not the update frequency) is the expensive part of this
  // overlay, so limiting count matters far more than throttling the overlay.
  if(typeof enemies!=='undefined'&&enemies.length){
    const refP=player||player2;
    const px=refP?refP.x+refP.w/2:camX+W/2, py=refP?refP.y+refP.h/2:cy+H/2;
    const nearE=enemies.filter(e=>e.alive!==false&&!e.dead)
      .map(e=>({e,d:(e.x-px)*(e.x-px)+(e.y-py)*(e.y-py)}))
      .sort((a,b)=>a.d-b.d)
      .slice(0,8);
    for(const {e} of nearE){ _punchLight(c, e.x-camX+(e.w||24)/2, e.y-cy+(e.h||24)/2, 78, 0.95); }
  }
  // Boss — a large light so the arena fight is playable
  if(boss&&!boss.dead){ _punchLight(c, boss.x-camX+(boss.w||64)/2, boss.y-cy+(boss.h||64)/2, 210, 1); }
  // Glowing pickups cast a faint light too (same cap rationale as enemies above).
  if(typeof powerups!=='undefined'&&powerups.length){
    const refP=player||player2;
    const px=refP?refP.x+refP.w/2:camX+W/2, py=refP?refP.y+refP.h/2:cy+H/2;
    const nearPU=powerups.filter(pu=>!pu.got)
      .map(pu=>({pu,d:(pu.x-px)*(pu.x-px)+(pu.y-py)*(pu.y-py)}))
      .sort((a,b)=>a.d-b.d)
      .slice(0,8);
    for(const {pu} of nearPU){ _punchLight(c, pu.x-camX+pu.w/2, pu.y-cy+pu.h/2, 60, 0.85); }
  }
  // 3) Composite the finished mask over the scene.
  ctx.save();
  ctx.globalCompositeOperation='source-over';
  ctx.drawImage(_darkCv,0,0);
  ctx.restore();
}
function drawPUs(){
  const vLeft=camX-40,vRight=camX+W+40;
  for(const pu of powerups){
    if(pu.got)continue;
    if(pu.x+pu.w<vLeft||pu.x>vRight)continue;
    const bob=Math.sin(pu.anim)*4,cx=pu.x+pu.w/2,cy=pu.y+bob+pu.h/2;
    ctx.save();
    if(pu.type==='blast'){
      ctx.shadowColor=CT.mc;ctx.shadowBlur=10;ctx.fillStyle='#001a2a';ctx.beginPath();ctx.arc(cx,cy,14,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle=CT.mc;ctx.lineWidth=2;ctx.beginPath();ctx.arc(cx,cy,13,0,Math.PI*2);ctx.stroke();
      ctx.fillStyle=CT.mc;ctx.beginPath();ctx.moveTo(cx-3,cy-10);ctx.lineTo(cx+4,cy-1);ctx.lineTo(cx+1,cy-1);ctx.lineTo(cx+3,cy+10);ctx.lineTo(cx-4,cy+1);ctx.lineTo(cx-1,cy+1);ctx.closePath();ctx.fill();
    } else if(pu.type==='life'){
      // Mechanical heart
      const pulse=1+Math.sin(pu.anim*2)*0.08;
      ctx.save();ctx.translate(cx,cy);ctx.scale(pulse,pulse);
      // Outer glow
      ctx.shadowColor='#ff2266';ctx.shadowBlur=11;
      // Dark backing circle
      ctx.fillStyle='#1a000d';ctx.beginPath();ctx.arc(0,0,14,0,Math.PI*2);ctx.fill();
      // Gear ring (outer teeth)
      ctx.strokeStyle='#882244';ctx.lineWidth=2;
      for(let i=0;i<12;i++){
        const a=i/12*Math.PI*2+pu.anim*0.04;
        ctx.beginPath();ctx.moveTo(Math.cos(a)*10,Math.sin(a)*10);ctx.lineTo(Math.cos(a)*13.5,Math.sin(a)*13.5);ctx.stroke();
      }
      ctx.strokeStyle='#cc3366';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(0,0,10,0,Math.PI*2);ctx.stroke();
      // Heart shape
      ctx.fillStyle='#ff2266';ctx.shadowColor='#ff2266';ctx.shadowBlur=5;
      ctx.beginPath();
      ctx.moveTo(0,5);ctx.bezierCurveTo(-9,0,-9,-8,0,-7);ctx.bezierCurveTo(9,-8,9,0,0,5);
      ctx.closePath();ctx.fill();
      // Metallic shine/rivet highlight
      ctx.fillStyle='#ff88aa';ctx.globalAlpha=0.7;ctx.beginPath();ctx.ellipse(-3,-4,3,2,-.5,0,Math.PI*2);ctx.fill();
      ctx.globalAlpha=1;
      // Center rivet
      ctx.fillStyle='#cc0044';ctx.shadowBlur=0;ctx.beginPath();ctx.arc(0,-1,2,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#ff88bb';ctx.beginPath();ctx.arc(-0.5,-1.5,0.8,0,Math.PI*2);ctx.fill();
      // Tiny bolt lines across heart
      ctx.strokeStyle='#cc0044';ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(-5,-2);ctx.lineTo(-2,2);ctx.moveTo(2,-3);ctx.lineTo(4,1);ctx.stroke();
      ctx.restore();
    } else if(pu.type==='boots'){
      // Speed boots — cyan winged shoe
      const pulse=1+Math.sin(pu.anim*2.2)*.07;
      ctx.save();ctx.translate(cx,cy);ctx.scale(pulse,pulse);
      ctx.shadowColor='#0ff';ctx.shadowBlur=10;
      // Backing circle
      ctx.fillStyle='#001a1a';ctx.beginPath();ctx.arc(0,0,14,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='#0ff';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(0,0,13,0,Math.PI*2);ctx.stroke();
      // Boot sole
      ctx.fillStyle='#006688';ctx.fillRect(-9,3,18,5);
      ctx.fillStyle='#00aacc';ctx.fillRect(-8,4,16,3);
      // Boot upper
      ctx.fillStyle='#004455';ctx.fillRect(-7,-4,14,8);
      ctx.fillStyle='#0088aa';ctx.fillRect(-6,-3,12,5);
      // Highlight
      ctx.fillStyle='#aaffff';ctx.globalAlpha=0.5;ctx.fillRect(-5,-2,5,2);
      ctx.globalAlpha=1;
      // Left wing
      ctx.fillStyle='#00eeff';ctx.shadowColor='#0ff';ctx.shadowBlur=4;
      ctx.beginPath();ctx.moveTo(-9,1);ctx.lineTo(-17,-4);ctx.lineTo(-13,2);ctx.closePath();ctx.fill();
      // Right wing
      ctx.beginPath();ctx.moveTo(9,1);ctx.lineTo(17,-4);ctx.lineTo(13,2);ctx.closePath();ctx.fill();
      // Speed lines
      ctx.strokeStyle='#0ff';ctx.lineWidth=1;ctx.globalAlpha=0.6;
      for(let sl=0;sl<3;sl++){ctx.beginPath();ctx.moveTo(-16+sl*3,-6-sl*2);ctx.lineTo(-9+sl*2,-6-sl*2);ctx.stroke();}
      ctx.globalAlpha=1;ctx.restore();
    } else if(pu.type==='fire'){
      // Fire power-up — огненный шар
      const pulse=1+Math.sin(pu.anim*2.5)*.1;
      ctx.save();ctx.translate(cx,cy);ctx.scale(pulse,pulse);
      ctx.shadowColor='#ff4400';ctx.shadowBlur=12;
      ctx.fillStyle='#1a0500';ctx.beginPath();ctx.arc(0,0,14,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='#ff6600';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,13,0,Math.PI*2);ctx.stroke();
      for(let fl=0;fl<5;fl++){
        const fa=fl/5*Math.PI*2+pu.anim*3;
        const fr=6+Math.sin(pu.anim*4+fl)*3;
        ctx.fillStyle=`hsl(${20+fl*8},100%,${55+fl*5}%)`;
        ctx.beginPath();ctx.ellipse(Math.cos(fa)*fr*.6,Math.sin(fa)*fr*.6-1,4,6+Math.sin(pu.anim*3+fl)*2,fa,0,Math.PI*2);ctx.fill();
      }
      ctx.fillStyle='#fff';ctx.shadowBlur=3;ctx.beginPath();ctx.arc(0,0,4,0,Math.PI*2);ctx.fill();
      ctx.restore();
    } else if(pu.type==='ice'){
      // Ice power-up — ледяной кристалл
      const pulse=1+Math.sin(pu.anim*1.8)*.07;
      ctx.save();ctx.translate(cx,cy);ctx.scale(pulse,pulse);ctx.rotate(pu.anim*.3);
      ctx.shadowColor='#00ffff';ctx.shadowBlur=12;
      ctx.fillStyle='#001a1a';ctx.beginPath();ctx.arc(0,0,14,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='#00ffff';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(0,0,13,0,Math.PI*2);ctx.stroke();
      for(let arm=0;arm<6;arm++){
        const a=arm/6*Math.PI*2;
        ctx.strokeStyle='#00ffff';ctx.lineWidth=2;
        ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(Math.cos(a)*10,Math.sin(a)*10);ctx.stroke();
        ctx.lineWidth=1;
        ctx.beginPath();ctx.moveTo(Math.cos(a)*5,Math.sin(a)*5);ctx.lineTo(Math.cos(a+.5)*8,Math.sin(a+.5)*8);ctx.stroke();
        ctx.beginPath();ctx.moveTo(Math.cos(a)*5,Math.sin(a)*5);ctx.lineTo(Math.cos(a-.5)*8,Math.sin(a-.5)*8);ctx.stroke();
      }
      ctx.fillStyle='#aaffff';ctx.shadowBlur=4;ctx.beginPath();ctx.arc(0,0,3,0,Math.PI*2);ctx.fill();
      ctx.restore();
    } else {
      // Spinning rainbow star
      const starHueP=(tick*10)%360;
      ctx.shadowColor=`hsl(${starHueP},100%,70%)`;ctx.shadowBlur=11;
      ctx.fillStyle='#221100';ctx.beginPath();ctx.arc(cx,cy,14,0,Math.PI*2);ctx.fill();
      ctx.save();ctx.translate(cx,cy);ctx.rotate(pu.anim*.55);
      ctx.fillStyle=`hsl(${starHueP},100%,62%)`;
      dStar(ctx,0,0,5,11,5);ctx.fill();
      // Inner smaller star offset hue
      ctx.fillStyle=`hsl(${(starHueP+120)%360},100%,75%)`;ctx.globalAlpha=0.65;
      dStar(ctx,0,0,5,6,3);ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }
}
function dStar(c,cx,cy,sp,ro,ri){c.beginPath();for(let i=0;i<sp*2;i++){const r=i%2===0?ro:ri,a=Math.PI*i/sp-Math.PI/2;if(i===0)c.moveTo(cx+r*Math.cos(a),cy+r*Math.sin(a));else c.lineTo(cx+r*Math.cos(a),cy+r*Math.sin(a));}c.closePath();}
// ── Per-world end-of-level structure (a unique building the robot runs into with a flag)
// Drawn just to the right of the flag. During exitAnim, the player enters the door,
// then a small celebratory flag rises from inside.
function _exitBuildingX(){ return flagX+78; }
function drawExitBuilding(){
  if(flagX>worldW)return;          // hidden (boss level — no flag, no building)
  const id=(CT&&typeof CT.id==='number')?CT.id:0;
  const bx=_exitBuildingX();        // left edge of the building
  const by=H-40;                    // ground line
  const bw=110,bh=120;              // base size
  // entered = player has stepped inside the door region
  const entered=exitAnim&&player&&(player.x+player.w/2)>=bx+24;
  const doorOpen=exitAnim?Math.min((exitTimer-12)/24,1):0; // door slide [0..1]
  ctx.save();
  switch(id){
    case 0: _buildCyberCity(bx,by,bw,bh,doorOpen); break;
    case 1: _buildJungleHut(bx,by,bw,bh,doorOpen); break;
    case 2: _buildLavaCave(bx,by,bw,bh,doorOpen);  break;
    case 3: _buildIcePalace(bx,by,bw,bh,doorOpen); break;
    case 4: _buildPyramid(bx,by,bw,bh,doorOpen);   break;
    case 5: _buildAirlock(bx,by,bw,bh,doorOpen);   break;
    case 6: _buildForestCabin(bx,by,bw,bh,doorOpen);break;
    case 7: _buildToxicDome(bx,by,bw,bh,doorOpen); break;
    case 8: _buildStormShrine(bx,by,bw,bh,doorOpen);break;
    case 9: _buildFortressGate(bx,by,bw,bh,doorOpen);break;
    // Prism Anomaly used to fall through to the Final Fortress gate, so the
    // secret world ended at a copy of world 10's base.
    default:_buildPrismGate(bx,by,bw,bh,doorOpen);break;
  }
  // Robot+flag celebration popping out of the rooftop after entry (slowed: starts at 80 instead of 40)
  if(entered&&exitTimer>80){
    const tFlag=Math.min((exitTimer-80)/50,1);
    const rfx=bx+bw*0.5, rfy=by-bh - 8 + (1-tFlag)*24;
    ctx.save();
    ctx.globalAlpha=tFlag;
    // tiny robot head
    ctx.fillStyle='#0cf';ctx.shadowColor=CT.mc;ctx.shadowBlur=8;
    ctx.fillRect(rfx-4,rfy,8,7);
    ctx.fillStyle='#fff';ctx.fillRect(rfx-2,rfy+2,4,3);
    // raised flagpole
    ctx.shadowBlur=0;
    ctx.strokeStyle='#dde';ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(rfx+5,rfy);ctx.lineTo(rfx+5,rfy-22);ctx.stroke();
    // waving flag (uses theme color)
    const wv=Math.sin(exitTimer*.14)*3;
    ctx.fillStyle=CT.clr;ctx.shadowColor=CT.clr;ctx.shadowBlur=10;
    ctx.beginPath();
    ctx.moveTo(rfx+5,rfy-22);
    ctx.quadraticCurveTo(rfx+22+wv,rfy-15,rfx+5,rfy-8);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}
// World 0 — CYBER CITY: neon-portal storefront
function _buildCyberCity(bx,by,bw,bh,doorOpen){
  // back wall (dark glass)
  ctx.fillStyle='#0a1228';ctx.fillRect(bx,by-bh,bw,bh);
  ctx.strokeStyle='#0ff';ctx.lineWidth=2;ctx.shadowColor='#0ff';ctx.shadowBlur=12;
  ctx.strokeRect(bx+1,by-bh+1,bw-2,bh-2);
  // sign
  ctx.fillStyle='#0ff';ctx.font="bold 9px 'Press Start 2P',monospace";ctx.textAlign='center';
  ctx.fillText('EXIT',bx+bw/2,by-bh+18);
  // windows row
  ctx.shadowBlur=0;
  for(let i=0;i<4;i++){ctx.fillStyle=i%2?'#0ff8':'#ff08';ctx.fillRect(bx+10+i*24,by-bh+30,16,10);}
  // door arch (slides up)
  const dw=36,dh=64,dx=bx+bw/2-dw/2,dy=by-dh;
  ctx.fillStyle='#001a2a';ctx.fillRect(dx,dy,dw,dh);
  ctx.strokeStyle='#0ff';ctx.lineWidth=2;ctx.strokeRect(dx,dy,dw,dh);
  // sliding shutter
  const sh=dh*(1-doorOpen);
  ctx.fillStyle='#082030';ctx.fillRect(dx+2,dy,dw-4,sh);
  for(let g=0;g<8;g++){ctx.strokeStyle='#0ff4';ctx.beginPath();ctx.moveTo(dx+2,dy+g*(sh/8));ctx.lineTo(dx+dw-2,dy+g*(sh/8));ctx.stroke();}
  // floor
  ctx.fillStyle='#0a0a18';ctx.fillRect(bx,by-2,bw,4);
}
// World 1 — NEON JUNGLE: vine-covered hut
function _buildJungleHut(bx,by,bw,bh,doorOpen){
  // walls
  ctx.fillStyle='#1c3210';ctx.fillRect(bx,by-bh+30,bw,bh-30);
  // thatched roof
  ctx.fillStyle='#4a3a10';
  ctx.beginPath();ctx.moveTo(bx-8,by-bh+30);ctx.lineTo(bx+bw/2,by-bh-12);ctx.lineTo(bx+bw+8,by-bh+30);ctx.closePath();ctx.fill();
  // vines
  ctx.strokeStyle='#4f8';ctx.lineWidth=2;ctx.shadowColor='#4f8';ctx.shadowBlur=6;
  for(let i=0;i<4;i++){ctx.beginPath();ctx.moveTo(bx+12+i*28,by-bh+30);ctx.bezierCurveTo(bx+18+i*28,by-bh+60,bx+8+i*28,by-bh+80,bx+14+i*28,by-bh+100);ctx.stroke();}
  ctx.shadowBlur=0;
  // door
  const dw=34,dh=58,dx=bx+bw/2-dw/2,dy=by-dh;
  ctx.fillStyle='#0a1a08';ctx.fillRect(dx,dy,dw,dh);
  ctx.strokeStyle='#4f8';ctx.lineWidth=2;ctx.strokeRect(dx,dy,dw,dh);
  // swinging door
  const ang=doorOpen*1.0; // up to ~57°
  ctx.save();ctx.translate(dx,dy);ctx.rotate(-ang);
  ctx.fillStyle='#2a4416';ctx.fillRect(0,0,dw,dh);
  ctx.restore();
}
// World 2 — LAVA WORLD: cave entrance with magma glow
function _buildLavaCave(bx,by,bw,bh,doorOpen){
  ctx.fillStyle='#1a0500';ctx.fillRect(bx,by-bh,bw,bh);
  // rocky outline
  ctx.strokeStyle='#f62';ctx.lineWidth=2;ctx.shadowColor='#f62';ctx.shadowBlur=12;
  ctx.beginPath();
  ctx.moveTo(bx,by);
  ctx.lineTo(bx+8,by-bh+10);
  ctx.lineTo(bx+bw/2-22,by-bh-10);
  ctx.lineTo(bx+bw/2+22,by-bh-10);
  ctx.lineTo(bx+bw-8,by-bh+10);
  ctx.lineTo(bx+bw,by);
  ctx.stroke();
  // arched magma doorway
  ctx.shadowBlur=18;
  const dw=42,dh=70,dx=bx+bw/2-dw/2,dy=by-dh;
  const grad=ctx.createLinearGradient(dx,dy+dh,dx,dy);
  grad.addColorStop(0,'#ff8800');grad.addColorStop(1,'#220000');
  ctx.fillStyle=grad;
  ctx.beginPath();ctx.moveTo(dx,dy+dh);ctx.lineTo(dx,dy+16);ctx.quadraticCurveTo(dx+dw/2,dy-8,dx+dw,dy+16);ctx.lineTo(dx+dw,dy+dh);ctx.closePath();ctx.fill();
  // boulder closing the doorway, slides into ground as door opens
  ctx.shadowBlur=0;
  const boY=dy+dh - dh*doorOpen;
  ctx.fillStyle='#3a1a08';
  ctx.beginPath();ctx.ellipse(dx+dw/2,boY,dw*0.55,dh*0.45,0,Math.PI,Math.PI*2);ctx.fill();
}
// World 3 — ICE CAVES: crystal archway
function _buildIcePalace(bx,by,bw,bh,doorOpen){
  // tower base
  ctx.fillStyle='#1a3a55';ctx.fillRect(bx+10,by-bh,bw-20,bh);
  // turrets
  ctx.fillStyle='#0e2436';ctx.fillRect(bx,by-bh+30,16,bh-30);ctx.fillRect(bx+bw-16,by-bh+30,16,bh-30);
  // crystal spires
  ctx.fillStyle='#8cf';ctx.shadowColor='#cef';ctx.shadowBlur=14;
  for(let i=0;i<3;i++){const sx=bx+22+i*30;ctx.beginPath();ctx.moveTo(sx,by-bh);ctx.lineTo(sx+8,by-bh-20);ctx.lineTo(sx+16,by-bh);ctx.closePath();ctx.fill();}
  ctx.shadowBlur=0;
  // doorway
  const dw=40,dh=64,dx=bx+bw/2-dw/2,dy=by-dh;
  ctx.fillStyle='#06101c';ctx.beginPath();ctx.moveTo(dx,dy+dh);ctx.lineTo(dx,dy+12);ctx.quadraticCurveTo(dx+dw/2,dy-6,dx+dw,dy+12);ctx.lineTo(dx+dw,dy+dh);ctx.closePath();ctx.fill();
  // icy gate (splits left/right)
  const halfW=dw/2*(1-doorOpen);
  ctx.fillStyle='#8cf';ctx.shadowColor='#8cf';ctx.shadowBlur=8;
  ctx.fillRect(dx,dy+12,halfW,dh-12);
  ctx.fillRect(dx+dw-halfW,dy+12,halfW,dh-12);
}
// World 4 — DESERT RUINS: pyramid entrance
function _buildPyramid(bx,by,bw,bh,doorOpen){
  // pyramid body
  ctx.fillStyle='#3a2810';
  ctx.beginPath();ctx.moveTo(bx-6,by);ctx.lineTo(bx+bw/2,by-bh-8);ctx.lineTo(bx+bw+6,by);ctx.closePath();ctx.fill();
  // brick lines
  ctx.strokeStyle='#1a1004';ctx.lineWidth=1;
  for(let y=10;y<bh;y+=14){ctx.beginPath();ctx.moveTo(bx-6+y*0.4,by-y);ctx.lineTo(bx+bw+6-y*0.4,by-y);ctx.stroke();}
  // door (trapezoid)
  const dw=38,dh=58,dx=bx+bw/2-dw/2,dy=by-dh;
  ctx.fillStyle='#1a1004';ctx.beginPath();ctx.moveTo(dx,dy+dh);ctx.lineTo(dx+5,dy);ctx.lineTo(dx+dw-5,dy);ctx.lineTo(dx+dw,dy+dh);ctx.closePath();ctx.fill();
  // hieroglyph glow
  ctx.fillStyle='#e8a';ctx.shadowColor='#e8a';ctx.shadowBlur=8;
  ctx.font='bold 12px sans-serif';ctx.textAlign='center';ctx.fillText('☥',bx+bw/2,by-bh+22);
  ctx.shadowBlur=0;
  // sliding stone slab
  const sh=dh*(1-doorOpen);
  ctx.fillStyle='#2a1808';ctx.fillRect(dx+5,dy,dw-10,sh);
}
// World 5 — SPACE STATION: airlock
function _buildAirlock(bx,by,bw,bh,doorOpen){
  ctx.fillStyle='#1a1030';ctx.fillRect(bx,by-bh,bw,bh);
  ctx.strokeStyle='#a0f';ctx.lineWidth=2;ctx.shadowColor='#a0f';ctx.shadowBlur=10;
  ctx.strokeRect(bx+1,by-bh+1,bw-2,bh-2);
  // panel lights
  ctx.shadowBlur=0;
  for(let i=0;i<5;i++){ctx.fillStyle=Math.floor(tick/30+i)%2?'#a0f':'#202';ctx.fillRect(bx+10+i*18,by-bh+8,12,4);}
  // circular hatch
  const cx=bx+bw/2,cy=by-50;
  ctx.fillStyle='#0a0418';ctx.beginPath();ctx.arc(cx,cy,28,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='#b0f';ctx.lineWidth=2;ctx.beginPath();ctx.arc(cx,cy,28,0,Math.PI*2);ctx.stroke();
  // iris that opens (4 wedges)
  const open=doorOpen;
  for(let w=0;w<4;w++){
    const a0=w/4*Math.PI*2 + open*0.6;
    const a1=a0 + Math.PI*0.5 - open*0.6;
    ctx.fillStyle='#241046';
    ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,26*(1-open*0.95),a0,a1);ctx.closePath();ctx.fill();
  }
}
// World 6 — DARK FOREST: log cabin
function _buildForestCabin(bx,by,bw,bh,doorOpen){
  // walls (stacked logs)
  ctx.fillStyle='#2a1a08';ctx.fillRect(bx,by-bh+30,bw,bh-30);
  ctx.strokeStyle='#1a1006';ctx.lineWidth=1;
  for(let y=by-bh+38;y<by;y+=10){ctx.beginPath();ctx.moveTo(bx,y);ctx.lineTo(bx+bw,y);ctx.stroke();}
  // pitched roof
  ctx.fillStyle='#0b1f0d';
  ctx.beginPath();ctx.moveTo(bx-6,by-bh+30);ctx.lineTo(bx+bw/2,by-bh-6);ctx.lineTo(bx+bw+6,by-bh+30);ctx.closePath();ctx.fill();
  // chimney
  ctx.fillStyle='#1a0a04';ctx.fillRect(bx+bw-30,by-bh-8,12,18);
  // window
  ctx.fillStyle='#cf6';ctx.shadowColor='#0b4';ctx.shadowBlur=6;
  ctx.fillRect(bx+12,by-bh+50,18,14);ctx.shadowBlur=0;
  // door (swings inward)
  const dw=32,dh=56,dx=bx+bw/2-dw/2,dy=by-dh;
  ctx.fillStyle='#0a0a04';ctx.fillRect(dx,dy,dw,dh);
  ctx.save();ctx.translate(dx+dw,dy);
  ctx.rotate(-doorOpen*1.1);
  ctx.fillStyle='#3a2014';ctx.fillRect(-dw,0,dw,dh);
  ctx.restore();
}
// World 7 — TOXIC ZONE: hazmat dome
function _buildToxicDome(bx,by,bw,bh,doorOpen){
  // base
  ctx.fillStyle='#1a2200';ctx.fillRect(bx,by-bh+30,bw,bh-30);
  // dome
  ctx.fillStyle='#284400';ctx.shadowColor='#cf0';ctx.shadowBlur=12;
  ctx.beginPath();ctx.arc(bx+bw/2,by-bh+30,bw/2,Math.PI,Math.PI*2);ctx.fill();
  ctx.shadowBlur=0;
  // hazard stripes
  ctx.fillStyle='#ff0';for(let i=0;i<5;i++){ctx.fillRect(bx+8+i*20,by-12,12,6);}
  // biohazard symbol
  ctx.fillStyle='#cf0';ctx.shadowColor='#cf0';ctx.shadowBlur=10;
  ctx.font='bold 16px sans-serif';ctx.textAlign='center';ctx.fillText('☣',bx+bw/2,by-bh+30);
  ctx.shadowBlur=0;
  // door slides into ground
  const dw=36,dh=58,dx=bx+bw/2-dw/2,dy=by-dh;
  ctx.fillStyle='#080a00';ctx.fillRect(dx,dy,dw,dh);
  ctx.strokeStyle='#cf0';ctx.lineWidth=2;ctx.strokeRect(dx,dy,dw,dh);
  const sh=dh*(1-doorOpen);
  ctx.fillStyle='#1a2800';ctx.fillRect(dx+2,dy,dw-4,sh);
}
// World 8 — STORM PEAKS: mountain shrine
function _buildStormShrine(bx,by,bw,bh,doorOpen){
  // shrine walls
  ctx.fillStyle='#1a1a2e';ctx.fillRect(bx+8,by-bh+24,bw-16,bh-24);
  // pagoda roof (two tiers)
  ctx.fillStyle='#3a1844';
  ctx.beginPath();ctx.moveTo(bx-6,by-bh+24);ctx.lineTo(bx+bw/2,by-bh-4);ctx.lineTo(bx+bw+6,by-bh+24);ctx.closePath();ctx.fill();
  ctx.beginPath();ctx.moveTo(bx+10,by-bh+50);ctx.lineTo(bx+bw/2,by-bh+30);ctx.lineTo(bx+bw-10,by-bh+50);ctx.closePath();ctx.fill();
  // lightning glyph
  ctx.fillStyle='#88f';ctx.shadowColor='#88f';ctx.shadowBlur=10;
  ctx.font='bold 16px sans-serif';ctx.textAlign='center';ctx.fillText('⚡',bx+bw/2,by-bh+20);
  ctx.shadowBlur=0;
  // door (vertical sliding)
  const dw=34,dh=56,dx=bx+bw/2-dw/2,dy=by-dh;
  ctx.fillStyle='#0a0a18';ctx.fillRect(dx,dy,dw,dh);
  ctx.strokeStyle='#88f';ctx.lineWidth=2;ctx.strokeRect(dx,dy,dw,dh);
  const sh=dh*(1-doorOpen);
  ctx.fillStyle='#23234a';ctx.fillRect(dx+2,dy,dw-4,sh);
}
// World 9 — FINAL FORTRESS: castle gate
function _buildFortressGate(bx,by,bw,bh,doorOpen){
  // towers
  ctx.fillStyle='#1a0808';ctx.fillRect(bx,by-bh,18,bh);ctx.fillRect(bx+bw-18,by-bh,18,bh);
  // central wall
  ctx.fillStyle='#2a0c0c';ctx.fillRect(bx+18,by-bh+20,bw-36,bh-20);
  // crenellations
  for(let i=0;i<3;i++){
    ctx.fillStyle='#1a0808';
    ctx.fillRect(bx+(i*8),by-bh-8,5,8);
    ctx.fillRect(bx+bw-5-(i*8),by-bh-8,5,8);
  }
  // banner
  ctx.fillStyle='#f44';ctx.shadowColor='#f44';ctx.shadowBlur=10;
  ctx.fillRect(bx+bw/2-8,by-bh+18,16,22);ctx.shadowBlur=0;
  // gate (portcullis lifts)
  const dw=44,dh=70,dx=bx+bw/2-dw/2,dy=by-dh;
  ctx.fillStyle='#0a0202';ctx.fillRect(dx,dy,dw,dh);
  ctx.strokeStyle='#f44';ctx.lineWidth=2;ctx.strokeRect(dx,dy,dw,dh);
  const sh=dh*(1-doorOpen);
  ctx.fillStyle='#2a1212';ctx.fillRect(dx+2,dy,dw-4,sh);
  // bars
  ctx.strokeStyle='#0a0202';ctx.lineWidth=1;
  for(let g=0;g<4;g++){ctx.beginPath();ctx.moveTo(dx+8+g*9,dy);ctx.lineTo(dx+8+g*9,dy+sh);ctx.stroke();}
}
// World 11 — PRISM ANOMALY: a crystal arch that splits the light passing
// through it. Built from the same primitives as the other exits, but every
// colour is taken from the spectrum so it belongs to this world instead of
// borrowing the Final Fortress gate.
function _buildPrismGate(bx,by,bw,bh,doorOpen){
  const t=tick*0.7;
  // Two crystal pylons, each a tall faceted shard
  for(const side of [0,1]){
    const px=bx+(side?bw-26:0), hue=(t+side*120)%360;
    const g=ctx.createLinearGradient(px,by-bh,px+26,by);
    g.addColorStop(0,`hsl(${hue},85%,52%)`);
    g.addColorStop(0.5,`hsl(${(hue+50)%360},80%,30%)`);
    g.addColorStop(1,`hsl(${(hue+100)%360},75%,16%)`);
    ctx.fillStyle=g;
    ctx.beginPath();
    ctx.moveTo(px+13,by-bh-14);
    ctx.lineTo(px+26,by-bh+16);
    ctx.lineTo(px+26,by);
    ctx.lineTo(px,by);
    ctx.lineTo(px,by-bh+16);
    ctx.closePath();ctx.fill();
    ctx.strokeStyle=`hsl(${(hue+180)%360},100%,80%)`;ctx.lineWidth=1.5;ctx.stroke();
    // internal facet lines
    ctx.strokeStyle=`hsla(${hue},100%,85%,0.35)`;ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(px+13,by-bh-10);ctx.lineTo(px+13,by);ctx.stroke();
  }
  // Spectral lintel spanning the pylons
  const lg=ctx.createLinearGradient(bx,0,bx+bw,0);
  for(let i=0;i<=6;i++)lg.addColorStop(i/6,`hsl(${(t+i*60)%360},90%,55%)`);
  ctx.fillStyle=lg;ctx.fillRect(bx,by-bh+6,bw,18);
  ctx.fillStyle='rgba(0,0,0,0.35)';ctx.fillRect(bx,by-bh+18,bw,6);
  // Floating capstone prism, slowly turning
  ctx.save();
  ctx.translate(bx+bw/2,by-bh-16+Math.sin(tick*0.05)*3);
  ctx.rotate(Math.sin(tick*0.012)*0.5);
  const cg=ctx.createLinearGradient(-14,-14,14,14);
  cg.addColorStop(0,'rgba(255,255,255,0.85)');
  cg.addColorStop(1,`hsla(${(t*2)%360},95%,70%,0.55)`);
  ctx.fillStyle=cg;
  ctx.beginPath();ctx.moveTo(0,-15);ctx.lineTo(13,10);ctx.lineTo(-13,10);ctx.closePath();ctx.fill();
  ctx.strokeStyle='rgba(255,255,255,0.9)';ctx.lineWidth=1.5;ctx.stroke();
  ctx.restore();
  // Portal: a spectral curtain that parts as the door opens
  const dw=48,dh=76,dx=bx+bw/2-dw/2,dy=by-dh;
  ctx.fillStyle='#05030c';ctx.fillRect(dx,dy,dw,dh);
  const half=(dw/2)*(1-doorOpen);
  for(const side of [0,1]){
    const sx=side?dx+dw-half:dx;
    const sg=ctx.createLinearGradient(sx,dy,sx+half,dy+dh);
    for(let i=0;i<=4;i++)sg.addColorStop(i/4,`hsl(${(t*1.5+i*72+side*180)%360},95%,58%)`);
    ctx.globalAlpha=0.85;ctx.fillStyle=sg;ctx.fillRect(sx,dy,half,dh);ctx.globalAlpha=1;
  }
  // Frame
  ctx.strokeStyle=`hsl(${(t+200)%360},100%,78%)`;ctx.lineWidth=2;ctx.strokeRect(dx,dy,dw,dh);
  // Light spilling out of the opening onto the ground
  if(doorOpen>0.05){
    const eg=ctx.createLinearGradient(dx,by,dx,by-30);
    eg.addColorStop(0,`hsla(${(t*2)%360},100%,70%,${0.30*doorOpen})`);
    eg.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=eg;ctx.fillRect(dx-14,by-30,dw+28,30);
  }
}
function drawFlag(){
  const fx=flagX, poleTop=H-130, poleBase=H-40;
  if(fx>worldW)return; // hidden (boss level)

  ctx.save();
  ctx.shadowColor=CT.clr;ctx.shadowBlur=14;
  ctx.strokeStyle='#88ff88';ctx.lineWidth=3;
  // Pole
  ctx.beginPath();ctx.moveTo(fx+5,poleBase);ctx.lineTo(fx+5,poleTop);ctx.stroke();
  // Pole base
  ctx.fillStyle=withAlpha(CT.clr,'88');ctx.fillRect(fx-5,poleBase-4,22,6);
  ctx.shadowBlur=0;

  if(!flagDone){
    // Normal waving flag
    const w=Math.sin(tick*.07)*4;
    ctx.fillStyle=`hsl(${tick*2%360},100%,60%)`;
    ctx.beginPath();ctx.moveTo(fx+5,poleTop);ctx.quadraticCurveTo(fx+28+w,poleTop+11,fx+5,poleTop+24);ctx.fill();
    // Height tier guide marks on pole (subtle)
    for(const m of [{frac:0.0,col:'#ff04'},{frac:0.1,col:'#0ff4'},{frac:0.35,col:'#0f84'}]){
      const my=poleTop+m.frac*(poleBase-poleTop);
      ctx.strokeStyle=m.col;ctx.lineWidth=1;ctx.globalAlpha=.35;
      ctx.beginPath();ctx.moveTo(fx-4,my);ctx.lineTo(fx+14,my);ctx.stroke();
    }
    ctx.globalAlpha=1;
  } else {
    // Sliding flag — drops from touch point to base over exitTimer frames (slowed: 70 frames instead of 35)
    const slideProgress=Math.min(exitTimer/70,1);
    const poleH=poleBase-poleTop;
    // Flag y slides from poleTop → poleBase-24
    const flagY=poleTop+slideProgress*poleH*0.82;
    const w=Math.sin(exitTimer*.12)*5;
    ctx.fillStyle=CT.clr;ctx.shadowColor=CT.clr;ctx.shadowBlur=10;
    ctx.beginPath();ctx.moveTo(fx+5,flagY);ctx.quadraticCurveTo(fx+30+w,flagY+11,fx+5,flagY+24);ctx.fill();
    ctx.shadowBlur=0;

    // Star burst at pole top when done sliding (adjusted timing)
    if(exitTimer>70&&exitTimer<100){
      const t=(exitTimer-70)/30;
      ctx.globalAlpha=(1-t)*0.9;
      ctx.fillStyle='#ff0';ctx.shadowColor='#ff0';ctx.shadowBlur=18;
      ctx.font='18px sans-serif';ctx.textAlign='center';
      ctx.fillText('✦',fx+5,poleTop-10);
      ctx.shadowBlur=0;
      ctx.globalAlpha=1;
    }
  }
  ctx.restore();

  // Level-clear overlay (screen space — must compensate translate) — slowed timing
  if(flagDone&&exitTimer>30){
    const t=Math.min((exitTimer-30)/40,1);
    ctx.save();
    ctx.translate(camX,0); // back to screen space inside world translate

    // Tier badge — match localized tier text by exitBonusTier (already localized at flag touch)
    const tierCols={};
    tierCols[T('tierPerfect')]='#ff0';
    tierCols[T('tierGreat')]='#0ff';
    tierCols[T('tierGood')]='#0f8';
    tierCols[T('tierBase')]='#888';
    const col=tierCols[exitBonusTier]||'#fff';
    ctx.globalAlpha=t;
    ctx.shadowColor=col;ctx.shadowBlur=22;
    ctx.fillStyle=col;
    ctx.font="bold 11px 'Press Start 2P',monospace";
    ctx.textAlign='center';
    ctx.fillText(exitBonusTier,W/2,H/2-28);
    ctx.shadowBlur=10;
    ctx.font="8px 'Press Start 2P',monospace";
    ctx.fillStyle='#fff';
    ctx.fillText(T('heightBonus',exitBonus),W/2,H/2-12);

    // Per-level score earned this run + cumulative campaign total (adventure).
    ctx.shadowBlur=6;
    ctx.font="7px 'Press Start 2P',monospace";
    ctx.fillStyle='#ffd23f';
    ctx.fillText(T('levelScoreLabel',exitLevelScore),W/2,H/2+4);
    if(advMode){
      // Total = best score of every cleared level, including this run's contribution.
      const banked=Math.max(levelScore(advLevel,hardMode),exitLevelScore);
      const tot=totalScore(hardMode)-levelScore(advLevel,hardMode)+banked;
      ctx.fillStyle='#8cf';
      ctx.font="6px 'Press Start 2P',monospace";
      ctx.fillText(T('totalScoreLabel',tot),W/2,H/2+15);
    }

    // Star rating row (adventure mode): 3 slots, lit up to exitStars.
    if(advMode){
      const cy=H/2+36,gap=26,n=3;
      for(let i=0;i<n;i++){
        const sx=W/2+(i-(n-1)/2)*gap;
        const lit=i<exitStars;
        // pop-in: each star eases in slightly after the last
        const sp=Math.max(0,Math.min((exitTimer-50-i*8)/14,1));
        const sc=lit?(0.6+0.4*sp):0.85;
        ctx.globalAlpha=t*(lit?sp:0.5);
        const R=9*sc;
        ctx.fillStyle=lit?'#ffd23f':'#3a3a4a';
        if(lit){ctx.shadowColor='#ffd23f';ctx.shadowBlur=10;}else ctx.shadowBlur=0;
        dStar(ctx,sx,cy,5,R,R*0.45);ctx.fill();
        ctx.shadowBlur=0;
      }
      ctx.globalAlpha=t;
      if(exitStarsNew){
        ctx.shadowColor='#ffd23f';ctx.shadowBlur=8;
        ctx.fillStyle='#ffd23f';
        ctx.font="6px 'Press Start 2P',monospace";
        ctx.fillText(T('newBest'),W/2,cy+22);
      }
    }

    // Transition wipe — slides in from right after frame 120 (slowed)
    if(exitTimer>120){
      const wt=Math.min((exitTimer-120)/40,1);
      // Edge position moves from right (W) to left (0)
      const edge=W*(1-wt);
      // Neon leading edge glow
      const wg=ctx.createLinearGradient(edge-50,0,edge+20,0);
      wg.addColorStop(0,'transparent');
      wg.addColorStop(0.5,withAlpha(CT.mc,'cc'));
      wg.addColorStop(1,CT.bg);
      ctx.globalAlpha=1;
      ctx.fillStyle=wg;
      ctx.fillRect(Math.max(0,edge-50),0,70,H);
      // Solid fill behind the edge
      ctx.fillStyle=CT.bg;
      ctx.fillRect(edge+20,0,W,H);
    }

    ctx.restore();
  }
}

function drawBossApproach(){
  if(!boss||!boss.alive||bossArenaX<=0)return;
  // Called inside ctx.translate(-camX,0) — use world coordinates directly
  const viewLeft=camX-60, viewRight=camX+W+60;

  // Warning triangles on approach
  ctx.save();
  for(const wx of [bossArenaX-280,bossArenaX-160,bossArenaX-60]){
    if(wx<viewLeft||wx>viewRight)continue;
    const pulse=.65+Math.sin(tick*.12)*0.35;
    ctx.globalAlpha=pulse*.85;
    ctx.fillStyle='#ff0';ctx.strokeStyle='#f00';ctx.lineWidth=2;
    ctx.shadowColor='#f00';ctx.shadowBlur=12;
    ctx.beginPath();ctx.moveTo(wx,H-90);ctx.lineTo(wx-18,H-56);ctx.lineTo(wx+18,H-56);ctx.closePath();
    ctx.fill();ctx.stroke();
    ctx.fillStyle='#000';ctx.font='bold 14px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('!',wx,H-72);
    ctx.shadowBlur=0;
  }

  // Visual gate arch at bossArenaX (purely decorative — no solid blocks)
  const gx=bossArenaX;
  if(gx>viewLeft&&gx<viewRight){
    ctx.globalAlpha=1;
    const bossColor=boss.col||'#f44';
    ctx.shadowColor=bossColor;ctx.shadowBlur=18+Math.sin(tick*.08)*7;
    // Left pillar
    ctx.fillStyle='#1a0404';ctx.fillRect(gx-4,H-145,12,105);
    // Right pillar
    ctx.fillRect(gx+84,H-145,12,105);
    // Arch top
    ctx.strokeStyle=bossColor;ctx.lineWidth=5;
    ctx.beginPath();ctx.arc(gx+50,H-145,54,Math.PI,Math.PI*2);ctx.stroke();
    // Skull
    ctx.fillStyle=bossColor;ctx.shadowBlur=12;
    ctx.font='24px sans-serif';ctx.textAlign='center';
    ctx.fillText('☠',gx+50,H-206);
    // Boss name sign
    const blink=Math.floor(tick/16)%2;
    ctx.fillStyle=blink?bossColor:'#f80';
    ctx.font="bold 7px 'Press Start 2P',monospace";
    ctx.fillText(bossName(boss),gx+50,H-44);
    ctx.shadowBlur=0;
  }
  ctx.restore();
}
// Enemies
function drawEnemies(){
  const vLeft=camX-60,vRight=camX+W+60;// viewport culling
  // Один раз на кадр, а не на врага: prismFxOn() читает настройки.
  const _prismEnemies=(CT.id===10)&&prismFxOn();
  for(const e of enemies){
    if(!e.alive)continue;
    // Не рисуем за пределами экрана
    if(e.x+e.w<vLeft||e.x>vRight)continue;
    ctx.save();
    if(e._frozen){ctx.shadowColor='#00ffff';ctx.shadowBlur=8;ctx.globalAlpha=.85;}
    else if(e.flash>0&&Math.floor(e.flash/3)%2===0){ctx.globalAlpha=.22;ctx.shadowColor=e.glow;ctx.shadowBlur=6;}
    // No per-enemy halo — each d_* enemy already paints its own glow accents.
    // A blanket halo just added a thick coloured outline around every sprite and ate FPS.
    // Prism Anomaly: the inhabitants are refracted too. A hue-rotate filter is
    // used rather than painting a coloured rectangle over the sprite — a rect
    // (even with source-atop) would tint the background inside the enemy's
    // bounding box as well, leaving a visible coloured square around it. The
    // filter only touches the pixels the sprite itself draws, so the enemy
    // keeps its shape, shading and readable silhouette.
    const _prismTint=(_prismEnemies&&!e._frozen);
    if(_prismTint){
      // Quantised to 20° steps: a canvas filter is re-parsed whenever the
      // string changes, so snapping the hue lets consecutive enemies reuse the
      // same filter instead of forcing a rebuild per sprite. Visually identical
      // at this scale, and it cuts the cost of the effect roughly in half.
      const hue=((((e.id||0)*47+e.x*0.35+tick*1.4)%360)/20|0)*20;
      ctx.filter=prismFilter(hue,7,1.22);
    }
    const df=DRAW_E[e.type];if(df)df(e);
    if(_prismTint)ctx.filter='none';
    if(e._frozen){
      const crack=Math.max(0,Math.min(1,e._iceCrack||0));
      // The block gets paler and more fractured as it nears breaking, instead of
      // holding one appearance and then vanishing.
      ctx.globalAlpha=(0.45+Math.sin(tick*.2)*.1)*(1-crack*0.35);
      ctx.fillStyle='#00ffff';ctx.fillRect(e.x,e.y,e.w,e.h);
      ctx.strokeStyle='#aaffff';ctx.lineWidth=2;ctx.shadowBlur=0;
      ctx.strokeRect(e.x+1,e.y+1,e.w-2,e.h-2);
      const ex=e.x+e.w/2,ey=e.y+e.h/2;
      // Base facets
      ctx.globalAlpha=0.9;ctx.strokeStyle='#fff';ctx.lineWidth=1.5;
      ctx.beginPath();
      for(let a=0;a<3;a++){const ang=a/3*Math.PI;ctx.moveTo(ex-Math.cos(ang)*8,ey-Math.sin(ang)*8);ctx.lineTo(ex+Math.cos(ang)*8,ey+Math.sin(ang)*8);}
      ctx.stroke();
      // Fracture lines appear one by one as the freeze runs out
      const shards=Math.floor(crack*5);
      if(shards>0){
        ctx.globalAlpha=0.55+crack*0.45;ctx.strokeStyle='#eaffff';ctx.lineWidth=1;
        ctx.beginPath();
        for(let k=0;k<shards;k++){
          const a0=(k*1.9+(e.id||0));
          const r0=e.w*0.12, r1=e.w*(0.30+crack*0.28);
          ctx.moveTo(ex+Math.cos(a0)*r0,ey+Math.sin(a0)*r0*1.3);
          ctx.lineTo(ex+Math.cos(a0+0.5)*r1,ey+Math.sin(a0+0.5)*r1*1.3);
        }
        ctx.stroke();
      }
      // Shudder just before it breaks
      if(crack>0.82&&Math.floor(tick/3)%2===0){
        ctx.globalAlpha=0.35;ctx.fillStyle='#ffffff';ctx.fillRect(e.x,e.y,e.w,e.h);
      }
      ctx.globalAlpha=1;
    }
    if(e.shielded){
      ctx.globalAlpha=0.35+Math.sin(tick*.1)*.12;
      ctx.strokeStyle=e.glow||'#aaf';ctx.lineWidth=3;ctx.shadowBlur=0;
      ctx.beginPath();ctx.ellipse(e.x+e.w/2,e.y+e.h/2,e.w*.65,e.h*.65,0,0,Math.PI*2);ctx.stroke();
      // Inner highlight arc — makes the bubble read as a surface, and flashes
      // white for a few frames right after it deflects something.
      ctx.globalAlpha=(e._blockFx>0?0.75:0.18);
      ctx.strokeStyle=(e._blockFx>0?'#fff':(e.glow||'#aaf'));ctx.lineWidth=2;
      ctx.beginPath();ctx.ellipse(e.x+e.w/2,e.y+e.h/2,e.w*.55,e.h*.55,0,Math.PI*1.15,Math.PI*1.85);ctx.stroke();
      ctx.globalAlpha=1;
    }
    // Spiked enemies: draw spikes on top
    const cfg=EC[e.type];
    if(cfg&&cfg.moveType==='spiked'){
      ctx.shadowBlur=0;
      ctx.fillStyle='#888';
      const spikeCount=4;
      for(let i=0;i<spikeCount;i++){
        const sx=e.x+i*(e.w/spikeCount)+e.w/(spikeCount*2);
        ctx.beginPath();
        ctx.moveTo(sx-3,e.y);
        ctx.lineTo(sx,e.y-6);
        ctx.lineTo(sx+3,e.y);
        ctx.closePath();
        ctx.fill();
      }
    }
    // Armored enemies: draw armor plating
    if(cfg&&cfg.moveType==='armored'){
      ctx.shadowBlur=0;
      ctx.strokeStyle='#666';ctx.lineWidth=2;
      ctx.strokeRect(e.x+2,e.y+2,e.w-4,e.h-4);
      ctx.strokeStyle='#999';ctx.lineWidth=1;
      ctx.strokeRect(e.x+4,e.y+4,e.w-8,e.h-8);
    }
    // Split enemies: draw split indicator
    if(cfg&&cfg.moveType==='split'){
      ctx.shadowBlur=0;
      ctx.strokeStyle=e.glow;ctx.lineWidth=1;
      ctx.beginPath();
      ctx.moveTo(e.x+e.w/2,e.y+2);
      ctx.lineTo(e.x+e.w/2,e.y+e.h-2);
      ctx.stroke();
    }
    if(e.charging){
      ctx.globalAlpha=0.6;ctx.shadowBlur=0;
      ctx.strokeStyle=e.glow;ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(e.x-8,e.y+e.h/2);ctx.lineTo(e.x+e.w+8,e.y+e.h/2);ctx.stroke();
      ctx.globalAlpha=1;
    }
    if(e.hp<e.mhp&&e.mhp>1){ctx.shadowBlur=0;ctx.fillStyle='#400';ctx.fillRect(e.x,e.y-9,e.w,5);ctx.fillStyle=e.glow;ctx.fillRect(e.x,e.y-9,e.w*(e.hp/e.mhp),5);}
    if(hardMode){ctx.shadowBlur=0;drawGlyph('★',[e.x+e.w/2,e.y-6],8,e.glow,'8px monospace');}
    ctx.restore();
  }
}
// ── Helper: draw a centred robot head+body shell ──
function _rHead(x,y,w,h,col1,col2,eyeCol){
  ctx.fillStyle=col1;ctx.fillRect(x+2,y,w-4,h*.55);
  ctx.fillStyle=col2;ctx.fillRect(x+4,y+3,w-8,h*.3);
  ctx.fillStyle=eyeCol;ctx.shadowColor=eyeCol;ctx.shadowBlur=8;
  ctx.fillRect(x+5,y+4,5,4);ctx.fillRect(x+w-10,y+4,5,4);ctx.shadowBlur=12;
}
function _rBody(x,y,w,h,col1,col2){
  ctx.fillStyle=col1;ctx.fillRect(x+3,y+h*.5,w-6,h*.5);
  ctx.fillStyle=col2;ctx.fillRect(x+5,y+h*.55,w-10,h*.3);
}
function _rLegs(x,y,w,h,col,lk){
  ctx.fillStyle=col;
  ctx.fillRect(x+3,y+h-14,8,14+lk);ctx.fillRect(x+w-11,y+h-14,8,14-lk);
}

// ══ WORLD 0: CYBER CITY ══════════════════════════
function d_cy_glitch(e){
  const f=e.vx>=0?1:-1,lk=e.onGnd?Math.sin(e.a*3)*3:0;
  ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);ctx.scale(f,1);ctx.translate(-e.w/2,-e.h/2);
  _rLegs(0,0,e.w,e.h,'#880088',lk);
  _rBody(0,0,e.w,e.h,'#aa20aa','#cc30cc');
  _rHead(0,0,e.w,e.h,'#881888','#aa22aa','#ff88ff');
  // glitch scanline effect
  if(Math.floor(tick/4)%3===0){ctx.fillStyle='#ff00ff33';ctx.fillRect(0,e.h*.3,e.w,4);}
  ctx.fillStyle='#ff88ff';ctx.fillRect(e.w-4,e.h*.4,8,3); // arm spike
  ctx.restore();
}
function d_cy_tank(e){
  const f=e.vx>=0?1:-1,lk=e.onGnd?Math.sin(e.a*3)*3:0;
  ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);ctx.scale(f,1);ctx.translate(-e.w/2,-e.h/2);
  // Heavy armour plating
  ctx.fillStyle='#112244';ctx.fillRect(0,e.h*.45,e.w,e.h*.55);
  ctx.fillStyle='#1a3366';ctx.fillRect(2,e.h*.5,e.w-4,e.h*.38);
  ctx.fillStyle='#0a1a33';ctx.fillRect(-4,e.h*.5,6,e.h*.3); // left shoulder
  ctx.fillStyle='#0a1a33';ctx.fillRect(e.w-2,e.h*.5,6,e.h*.3); // right shoulder
  _rHead(0,0,e.w,e.h,'#0d2244','#1a3366','#4af');
  // Thick legs
  ctx.fillStyle='#0a1a33';
  ctx.fillRect(2,e.h-16,11,16+lk);ctx.fillRect(e.w-13,e.h-16,11,16-lk);
  // Cannon arm
  ctx.fillStyle='#0a1833';ctx.fillRect(e.w-2,e.h*.55,14,7);
  ctx.fillStyle='#4af';ctx.shadowBlur=0;ctx.fillRect(e.w+8,e.h*.57,5,3);
  ctx.restore();
}
function d_cy_probe(e){
  const bob=Math.sin(e.fpH)*3;
  ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);
  // Main sphere
  ctx.fillStyle='#003344';ctx.beginPath();ctx.arc(0,0,11,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='#0ff';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(0,0,10,0,Math.PI*2);ctx.stroke();
  // Rotating ring
  ctx.save();ctx.rotate(tick*.08);ctx.strokeStyle='#0ff4';ctx.lineWidth=1;
  ctx.beginPath();ctx.ellipse(0,0,13,5,0,0,Math.PI*2);ctx.stroke();ctx.restore();
  // Eye
  ctx.fillStyle='#0ff';ctx.shadowBlur=0;ctx.beginPath();ctx.arc(0,0,4,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#fff';ctx.shadowBlur=0;ctx.beginPath();ctx.arc(-1,-1,1.5,0,Math.PI*2);ctx.fill();
  // Antenna
  ctx.strokeStyle='#0ff';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(0,-10);ctx.lineTo(0,-18);ctx.stroke();
  ctx.fillStyle='#0ff';ctx.beginPath();ctx.arc(0,-18,2.5,0,Math.PI*2);ctx.fill();
  ctx.restore();
}

// ══ WORLD 1: NEON JUNGLE ═════════════════════════

function d_jg_vine(e){
  const f=e.vx>=0?1:-1,lk=e.onGnd?Math.sin(e.a*3)*3:0;
  ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);ctx.scale(f,1);ctx.translate(-e.w/2,-e.h/2);
  // Vine body — segmented green
  ctx.fillStyle='#1a5a10';ctx.fillRect(4,e.h*.45,e.w-8,e.h*.55);
  for(let i=0;i<3;i++){ctx.fillStyle=i%2?'#2a8820':'#1d6614';ctx.fillRect(4,e.h*.47+i*5,e.w-8,4);}
  // Head with leaves
  ctx.fillStyle='#1a5a10';ctx.fillRect(3,0,e.w-6,e.h*.52);
  ctx.fillStyle='#2daa18';ctx.fillRect(5,3,e.w-10,e.h*.32);
  ctx.fillStyle='#44dd22';ctx.shadowBlur=0;ctx.fillRect(6,5,5,4);ctx.fillRect(e.w-11,5,5,4); // eyes
  // Leaf crown
  ctx.fillStyle='#3acc10';
  ctx.beginPath();ctx.moveTo(e.w/2-8,-2);ctx.lineTo(e.w/2-4,-12);ctx.lineTo(e.w/2,0);ctx.fill();
  ctx.beginPath();ctx.moveTo(e.w/2+8,-2);ctx.lineTo(e.w/2+4,-12);ctx.lineTo(e.w/2,0);ctx.fill();
  // Tendril legs
  ctx.strokeStyle='#1a5a10';ctx.lineWidth=3;
  ctx.beginPath();ctx.moveTo(5,e.h);ctx.quadraticCurveTo(3,e.h+lk,2,e.h+6+lk);ctx.stroke();
  ctx.beginPath();ctx.moveTo(e.w-5,e.h);ctx.quadraticCurveTo(e.w-3,e.h-lk,e.w-2,e.h+6-lk);ctx.stroke();
  ctx.restore();
}
function d_jg_beast(e){
  const sq=e.onGnd?.78:1.1;
  ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h);ctx.scale(1/sq,sq);
  const cy=-e.h*sq/2;
  // Furry body
  ctx.fillStyle='#774400';ctx.beginPath();ctx.arc(0,cy,e.w*.44,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#995500';ctx.beginPath();ctx.arc(-2,cy-3,e.w*.3,0,Math.PI*2);ctx.fill();
  // Mane
  ctx.fillStyle='#cc7700';
  for(let i=0;i<8;i++){const a=i*Math.PI*.25;ctx.beginPath();ctx.moveTo(Math.cos(a)*e.w*.3+(-2),Math.sin(a)*e.w*.3+cy-3);ctx.lineTo(Math.cos(a)*e.w*.46+(-2),Math.sin(a)*e.w*.46+cy-3);ctx.lineWidth=4;ctx.strokeStyle='#cc7700';ctx.stroke();}
  // Eyes
  ctx.fillStyle='#44ff22';ctx.shadowBlur=0;ctx.beginPath();ctx.arc(-6,cy-5,4,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(6,cy-5,4,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#000';ctx.shadowBlur=0;ctx.beginPath();ctx.arc(-5,cy-5,2,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(7,cy-5,2,0,Math.PI*2);ctx.fill();
  ctx.restore();
}
function d_jg_spore(e){
  const bob=Math.sin(e.fpH)*4;
  ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);
  // Pulsing spore sphere
  const pulse=1+Math.sin(e.a*.8)*.1;ctx.save();ctx.scale(pulse,pulse);
  ctx.fillStyle='#1a4a0a';ctx.beginPath();ctx.arc(0,0,11,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#2acc14';ctx.shadowBlur=0;ctx.beginPath();ctx.arc(0,0,8,0,Math.PI*2);ctx.fill();
  ctx.restore();
  // Spikes
  ctx.strokeStyle='#4df020';ctx.lineWidth=2;
  for(let i=0;i<6;i++){const a=i*Math.PI/3+e.a*.3;ctx.beginPath();ctx.moveTo(Math.cos(a)*8,Math.sin(a)*8);ctx.lineTo(Math.cos(a)*14,Math.sin(a)*14);ctx.stroke();}
  ctx.fillStyle='#fff';ctx.shadowBlur=0;ctx.beginPath();ctx.arc(-3,-3,2,0,Math.PI*2);ctx.fill();
  ctx.restore();
}

// ══ WORLD 2: LAVA WORLD ══════════════════════════f
function d_lv_ember(e){
  const f=e.vx>=0?1:-1,lk=e.onGnd?Math.sin(e.a*3)*3:0;
  ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);ctx.scale(f,1);ctx.translate(-e.w/2,-e.h/2);
  _rLegs(0,0,e.w,e.h,'#661100',lk);
  _rBody(0,0,e.w,e.h,'#882200','#bb3300');
  // Flame head
  ctx.fillStyle='#551100';ctx.fillRect(3,0,e.w-6,e.h*.5);
  ctx.fillStyle='#ff4400';ctx.shadowBlur=0;
  // Flame wisps on head
  for(let i=0;i<3;i++){const fx=5+i*6,fy=-8+Math.sin(tick*.15+i)*5;ctx.beginPath();ctx.moveTo(fx,6);ctx.quadraticCurveTo(fx-3,fy+3,fx,fy);ctx.quadraticCurveTo(fx+3,fy+3,fx+4,6);ctx.fill();}
  ctx.fillStyle='#ff8800';ctx.shadowBlur=0;ctx.fillRect(5,5,5,4);ctx.fillRect(e.w-10,5,5,4); // ember eyes
  ctx.restore();
}
function d_lv_golem(e){
  const lk=e.onGnd?Math.sin(e.a*2)*3:0;
  ctx.save();ctx.translate(e.x,e.y);
  // Rock body
  ctx.fillStyle='#2a1000';ctx.fillRect(4,e.h*.4,e.w-8,e.h*.6);
  ctx.fillStyle='#3a1800';ctx.fillRect(6,e.h*.44,e.w-12,e.h*.44);
  // Lava cracks
  ctx.strokeStyle='#ff4400';ctx.lineWidth=2;ctx.shadowBlur=0;
  ctx.beginPath();ctx.moveTo(8,e.h*.5);ctx.lineTo(14,e.h*.7);ctx.lineTo(10,e.h*.85);ctx.stroke();
  ctx.beginPath();ctx.moveTo(e.w-8,e.h*.52);ctx.lineTo(e.w-14,e.h*.72);ctx.stroke();
  // Head
  ctx.fillStyle='#221000';ctx.fillRect(5,0,e.w-10,e.h*.46);
  ctx.fillStyle='#ff6600';ctx.shadowBlur=0;ctx.fillRect(8,6,7,5);ctx.fillRect(e.w-15,6,7,5); // glowing eyes
  // Shoulder slabs
  ctx.fillStyle='#2a1000';ctx.fillRect(-5,e.h*.44,7,16);ctx.fillRect(e.w-2,e.h*.44,7,16);
  // Legs
  ctx.fillStyle='#221000';ctx.fillRect(4,e.h-14,10,14+lk);ctx.fillRect(e.w-14,e.h-14,10,14-lk);
  ctx.restore();
}
function d_lv_spark(e){
  const bob=Math.sin(e.fpH)*3;
  ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);
  // Spinning fireball
  ctx.save();ctx.rotate(tick*.18);
  ctx.fillStyle='#cc2200';ctx.shadowBlur=0;
  for(let i=0;i<5;i++){const a=i*Math.PI*.4;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(Math.cos(a)*12,Math.sin(a)*12);ctx.lineTo(Math.cos(a+.3)*8,Math.sin(a+.3)*8);ctx.closePath();ctx.fill();}
  ctx.restore();
  ctx.fillStyle='#ff6600';ctx.shadowBlur=0;ctx.beginPath();ctx.arc(0,0,6,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#ffcc00';ctx.beginPath();ctx.arc(-1,-1,3,0,Math.PI*2);ctx.fill();
  ctx.restore();
}

// ══ WORLD 3: ICE CAVES ═══════════════════════════io
function d_ic_shard(e){
  const sq=e.onGnd?.82:1.05,lk=e.onGnd?Math.sin(e.a*3)*2:0;
  ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);ctx.scale(1,sq);
  // Crystal body
  ctx.fillStyle='#2244aa';
  ctx.beginPath();ctx.moveTo(0,-e.h*.48);ctx.lineTo(e.w*.4,-e.h*.1);ctx.lineTo(e.w*.35,e.h*.4);ctx.lineTo(-e.w*.35,e.h*.4);ctx.lineTo(-e.w*.4,-e.h*.1);ctx.closePath();ctx.fill();
  ctx.strokeStyle='#88ccff';ctx.lineWidth=1.5;ctx.stroke();
  // Facets
  ctx.fillStyle='#4488dd';ctx.beginPath();ctx.moveTo(0,-e.h*.48);ctx.lineTo(e.w*.4,-e.h*.1);ctx.lineTo(0,0);ctx.closePath();ctx.fill();
  // Eye glow
  ctx.fillStyle='#aaddff';ctx.shadowBlur=0;ctx.beginPath();ctx.arc(-4,e.h*.05,4,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(4,e.h*.05,4,0,Math.PI*2);ctx.fill();
  // Feet spikes
  ctx.fillStyle='#3366aa';ctx.beginPath();ctx.moveTo(-e.w*.3,e.h*.4);ctx.lineTo(-e.w*.38,e.h*.55+lk);ctx.lineTo(-e.w*.22,e.h*.4);ctx.fill();
  ctx.beginPath();ctx.moveTo(e.w*.3,e.h*.4);ctx.lineTo(e.w*.38,e.h*.55-lk);ctx.lineTo(e.w*.22,e.h*.4);ctx.fill();
  ctx.restore();
}
function d_ic_yeti(e){
  const lk=e.onGnd?Math.sin(e.a*2)*3:0;
  ctx.save();ctx.translate(e.x,e.y);
  // Massive furry body
  ctx.fillStyle='#8899bb';ctx.fillRect(3,e.h*.4,e.w-6,e.h*.6);
  ctx.fillStyle='#aabbdd';ctx.fillRect(5,e.h*.44,e.w-10,e.h*.44);
  // Fur texture lines
  ctx.strokeStyle='#cce';ctx.lineWidth=1;
  for(let fy=e.h*.46;fy<e.h*.85;fy+=5){ctx.beginPath();ctx.moveTo(5,fy);ctx.lineTo(e.w-5,fy+3);ctx.stroke();}
  // Head
  ctx.fillStyle='#9aabcc';ctx.beginPath();ctx.arc(e.w/2,e.h*.25,e.w*.36,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#cce';ctx.beginPath();ctx.arc(e.w/2,e.h*.25,e.w*.28,0,Math.PI*2);ctx.fill();
  // Eyes
  ctx.fillStyle='#22aaff';ctx.shadowBlur=0;ctx.beginPath();ctx.arc(e.w/2-7,e.h*.22,4,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(e.w/2+7,e.h*.22,4,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#000';ctx.shadowBlur=0;ctx.beginPath();ctx.arc(e.w/2-6,e.h*.22,2,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(e.w/2+8,e.h*.22,2,0,Math.PI*2);ctx.fill();
  // Big arms
  ctx.fillStyle='#8899bb';ctx.fillRect(-7,e.h*.44,9,e.h*.3);ctx.fillRect(e.w-2,e.h*.44,9,e.h*.3);
  // Legs
  ctx.fillStyle='#6677aa';ctx.fillRect(4,e.h-14,12,14+lk);ctx.fillRect(e.w-16,e.h-14,12,14-lk);
  ctx.restore();
} 
function d_ic_wisp(e){
  const bob=Math.sin(e.fpH)*5;
  ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);
  ctx.globalAlpha=0.8+Math.sin(e.a*.6)*.15;
  // Ghostly crystal
  ctx.fillStyle='#2255aa';ctx.shadowBlur=0;
  ctx.beginPath();ctx.moveTo(0,-11);ctx.lineTo(7,0);ctx.lineTo(0,11);ctx.lineTo(-7,0);ctx.closePath();ctx.fill();
  ctx.fillStyle='#88ccff';ctx.shadowBlur=0;
  ctx.beginPath();ctx.moveTo(0,-7);ctx.lineTo(4,0);ctx.lineTo(0,7);ctx.lineTo(-4,0);ctx.closePath();ctx.fill();
  // Inner glow core
  ctx.fillStyle='#fff';ctx.shadowBlur=0;ctx.beginPath();ctx.arc(0,0,3,0,Math.PI*2);ctx.fill();
  ctx.restore();
}

// ══ WORLD 4: DESERT RUINS ════════════════════════d_
function d_ds_scarab(e){
  const f=e.vx>=0?1:-1;
  ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);ctx.scale(f,1);ctx.translate(-e.w/2,-e.h/2);
  // Shell body
  ctx.fillStyle='#7a4400';ctx.beginPath();ctx.ellipse(e.w/2,e.h*.6,e.w*.44,e.h*.38,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#cc8800';ctx.shadowBlur=0;ctx.beginPath();ctx.ellipse(e.w/2,e.h*.55,e.w*.36,e.h*.28,0,0,Math.PI*2);ctx.fill();
  // Shell segments
  ctx.strokeStyle='#aa6600';ctx.lineWidth=1;ctx.shadowBlur=0;
  ctx.beginPath();ctx.moveTo(e.w*.2,e.h*.4);ctx.lineTo(e.w*.5,e.h*.3);ctx.lineTo(e.w*.8,e.h*.4);ctx.stroke();
  // Head
  ctx.fillStyle='#884400';ctx.fillRect(e.w*.2,e.h*.08,e.w*.6,e.h*.38);
  ctx.fillStyle='#ffaa00';ctx.shadowBlur=0;ctx.beginPath();ctx.arc(e.w*.3,e.h*.2,4,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(e.w*.7,e.h*.2,4,0,Math.PI*2);ctx.fill();
  // Antenna
  ctx.strokeStyle='#cc8800';ctx.lineWidth=1.5;
  ctx.beginPath();ctx.moveTo(e.w*.35,e.h*.08);ctx.lineTo(e.w*.2,-8);ctx.stroke();
  ctx.beginPath();ctx.moveTo(e.w*.65,e.h*.08);ctx.lineTo(e.w*.8,-8);ctx.stroke();
  // Legs
  ctx.strokeStyle='#884400';ctx.lineWidth=2;
  for(let i=0;i<3;i++){ctx.beginPath();ctx.moveTo(e.w*.18,e.h*.5+i*6);ctx.lineTo(-5,e.h*.5+i*8);ctx.stroke();ctx.beginPath();ctx.moveTo(e.w*.82,e.h*.5+i*6);ctx.lineTo(e.w+5,e.h*.5+i*8);ctx.stroke();}
  ctx.restore();
}
function d_ds_mummy(e){
  const f=e.vx>=0?1:-1,lk=e.onGnd?Math.sin(e.a*3)*3:0;
  ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);ctx.scale(f,1);ctx.translate(-e.w/2,-e.h/2);
  _rLegs(0,0,e.w,e.h,'#aaaa88',lk);
  _rBody(0,0,e.w,e.h,'#bbbb99','#ccccaa');
  // Bandage wraps
  ctx.strokeStyle='#eeeedd';ctx.lineWidth=2;
  for(let wy=e.h*.52;wy<e.h*.88;wy+=6){ctx.beginPath();ctx.moveTo(2,wy);ctx.lineTo(e.w-2,wy+2);ctx.stroke();}
  // Head
  ctx.fillStyle='#bbbb99';ctx.fillRect(4,0,e.w-8,e.h*.46);
  for(let hy=2;hy<e.h*.44;hy+=5){ctx.beginPath();ctx.moveTo(4,hy);ctx.lineTo(e.w-4,hy+1);ctx.stroke();}
  // Glowing eyes
  ctx.fillStyle='#ff8800';ctx.shadowBlur=0;ctx.fillRect(6,8,5,5);ctx.fillRect(e.w-11,8,5,5);
  ctx.restore();
}
function d_ds_hawk(e){
  const bob=Math.sin(e.fpH)*4,flap=Math.sin(e.a*5)*8;
  ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);
  // Wings
  ctx.fillStyle='#aa6600';ctx.shadowBlur=0;
  ctx.beginPath();ctx.moveTo(0,-4);ctx.lineTo(-e.w*.6,flap-8);ctx.lineTo(-e.w*.55,4);ctx.closePath();ctx.fill();
  ctx.beginPath();ctx.moveTo(0,-4);ctx.lineTo(e.w*.6,flap-8);ctx.lineTo(e.w*.55,4);ctx.closePath();ctx.fill();
  // Body
  ctx.fillStyle='#884400';ctx.beginPath();ctx.ellipse(0,0,7,10,0,0,Math.PI*2);ctx.fill();
  // Head & beak
  ctx.fillStyle='#cc8800';ctx.beginPath();ctx.arc(0,-8,6,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#ff8800';ctx.fillRect(-2,-12,4,5); // beak
  ctx.fillStyle='#ffcc00';ctx.shadowBlur=0;ctx.beginPath();ctx.arc(-3,-9,2.5,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(3,-9,2.5,0,Math.PI*2);ctx.fill();
  ctx.restore();
}

// ══ WORLD 5: SPACE STATION ═══════════════════════_
function d_sp_droid(e){
  const f=e.vx>=0?1:-1,lk=e.onGnd?Math.sin(e.a*3)*3:0;
  ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);ctx.scale(f,1);ctx.translate(-e.w/2,-e.h/2);
  _rLegs(0,0,e.w,e.h,'#331155',lk);
  _rBody(0,0,e.w,e.h,'#442266','#553388');
  // Panel lines on torso
  ctx.strokeStyle='#a0f5';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(5,e.h*.52);ctx.lineTo(e.w-5,e.h*.52);ctx.stroke();
  ctx.beginPath();ctx.moveTo(5,e.h*.64);ctx.lineTo(e.w-5,e.h*.64);ctx.stroke();
  _rHead(0,0,e.w,e.h,'#331155','#442266','#cc88ff');
  // Dome visor
  ctx.fillStyle='#8844cc33';ctx.beginPath();ctx.arc(e.w/2,e.h*.2,e.w*.32,Math.PI,Math.PI*2);ctx.fill();
  ctx.strokeStyle='#a0f4';ctx.lineWidth=1;ctx.beginPath();ctx.arc(e.w/2,e.h*.2,e.w*.32,Math.PI,Math.PI*2);ctx.stroke();
  ctx.restore();
}
function d_sp_mech(e){
  const f=e.vx>=0?1:-1,lk=e.onGnd?Math.sin(e.a*2)*3:0;
  ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);ctx.scale(f,1);ctx.translate(-e.w/2,-e.h/2);
  // Heavy mech legs
  ctx.fillStyle='#220044';ctx.fillRect(2,e.h-16,12,16+lk);ctx.fillRect(e.w-14,e.h-16,12,16-lk);
  ctx.fillStyle='#330055';ctx.fillRect(1,e.h-5+lk,14,5);ctx.fillRect(e.w-15,e.h-5-lk,14,5);
  // Mech torso
  ctx.fillStyle='#2a0055';ctx.fillRect(2,e.h*.38,e.w-4,e.h*.62);
  ctx.fillStyle='#3a0077';ctx.fillRect(4,e.h*.42,e.w-8,e.h*.48);
  // Shoulder pads
  ctx.fillStyle='#1a0044';ctx.fillRect(-7,e.h*.38,9,20);ctx.fillRect(e.w-2,e.h*.38,9,20);
  // Gun cannon
  ctx.fillStyle='#220044';ctx.fillRect(e.w-2,e.h*.5,16,8);
  ctx.fillStyle='#cc00ff';ctx.shadowBlur=0;ctx.fillRect(e.w+11,e.h*.51,5,5);
  // Head
  ctx.fillStyle='#220044';ctx.fillRect(4,0,e.w-8,e.h*.42);
  ctx.fillStyle='#cc00ff';ctx.shadowBlur=0;ctx.fillRect(6,6,8,6);ctx.fillRect(e.w-14,6,8,6);
  ctx.restore();
}
function d_sp_saucer(e){
  const bob=Math.sin(e.fpH)*4;
  ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);
  // Saucer body
  ctx.fillStyle='#2a0055';ctx.beginPath();ctx.ellipse(0,2,e.w*.48,7,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#440088';ctx.shadowBlur=0;ctx.beginPath();ctx.ellipse(0,2,e.w*.44,5,0,0,Math.PI*2);ctx.fill();
  // Dome
  ctx.fillStyle='#1a0033';ctx.beginPath();ctx.arc(0,-2,9,Math.PI,Math.PI*2);ctx.fill();
  ctx.fillStyle='#bb00ff33';ctx.beginPath();ctx.arc(0,-2,7,Math.PI,Math.PI*2);ctx.fill();
  // Rotating lights
  for(let i=0;i<4;i++){const a=i*Math.PI*.5+tick*.1;const lc=['#f0f','#a0f','#80f','#f0f'][i];
    ctx.fillStyle=lc;ctx.shadowColor=lc;ctx.shadowBlur=glow(8);ctx.beginPath();ctx.arc(Math.cos(a)*e.w*.36,3+Math.sin(a)*2,3,0,Math.PI*2);ctx.fill();}
  ctx.restore();
}

// ══ WORLD 6: DARK FOREST ═════════════════════════a
function d_df_shade(e){
  const f=e.vx>=0?1:-1;
  ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);ctx.scale(f,1);ctx.translate(-e.w/2,-e.h/2);
  ctx.globalAlpha=0.75+Math.sin(e.a*.5)*.15;
  // Shadow cloak — wavy bottom
  ctx.fillStyle='#0a0014';ctx.shadowBlur=0;
  ctx.beginPath();ctx.moveTo(3,0);ctx.lineTo(e.w-3,0);ctx.lineTo(e.w,e.h*.7);
  for(let wx=0;wx<4;wx++){const wxa=e.w-wx*(e.w*.28)+Math.sin(e.a+wx)*6;ctx.lineTo(wxa,e.h);}
  ctx.lineTo(0,e.h*.7);ctx.closePath();ctx.fill();
  // Glowing red eyes
  ctx.fillStyle='#ff0000';ctx.shadowColor='#f00';ctx.shadowBlur=glow(8);
  ctx.beginPath();ctx.arc(e.w*.3,e.h*.25,4,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.arc(e.w*.7,e.h*.25,4,0,Math.PI*2);ctx.fill();
  ctx.globalAlpha=1;ctx.restore();
}
function d_df_troll(e){
  const lk=e.onGnd?Math.sin(e.a*2)*3:0;
  ctx.save();ctx.translate(e.x,e.y);
  // Mossy stone body
  ctx.fillStyle='#1a2a0a';ctx.fillRect(3,e.h*.4,e.w-6,e.h*.6);
  ctx.fillStyle='#243514';ctx.fillRect(5,e.h*.44,e.w-10,e.h*.44);
  // Moss patches
  ctx.fillStyle='#2d4a10';
  for(let i=0;i<4;i++){ctx.beginPath();ctx.arc(6+i*(e.w*.22),e.h*.5+Math.sin(i)*5,4,0,Math.PI*2);ctx.fill();}
  // Head
  ctx.fillStyle='#1a2a0a';ctx.fillRect(5,0,e.w-10,e.h*.44);
  ctx.fillStyle='#44ff22';ctx.shadowBlur=0;ctx.fillRect(8,8,6,5);ctx.fillRect(e.w-14,8,6,5);
  // Club arm
  ctx.fillStyle='#4a3000';ctx.fillRect(e.w,e.h*.44,6,18);ctx.fillRect(e.w-1,e.h*.44,10,8);
  // Horns
  ctx.fillStyle='#1a1a0a';ctx.beginPath();ctx.moveTo(7,0);ctx.lineTo(3,-10);ctx.lineTo(11,0);ctx.fill();
  ctx.beginPath();ctx.moveTo(e.w-7,0);ctx.lineTo(e.w-3,-10);ctx.lineTo(e.w-11,0);ctx.fill();
  // Legs
  ctx.fillStyle='#1a2a0a';ctx.fillRect(4,e.h-14,11,14+lk);ctx.fillRect(e.w-15,e.h-14,11,14-lk);
  ctx.restore();
}
function d_df_bat(e){
  const bob=Math.sin(e.fpH)*5,flap=Math.sin(e.a*8)*12;
  ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);
  // Wings
  ctx.fillStyle='#050510';ctx.strokeStyle='#2233aa';ctx.lineWidth=1;ctx.shadowBlur=0;
  // Left wing
  ctx.beginPath();ctx.moveTo(-4,0);ctx.lineTo(-e.w*.55,flap);ctx.lineTo(-e.w*.5,e.h*.4);ctx.lineTo(-e.w*.3,e.h*.15);ctx.lineTo(-4,e.h*.1);ctx.closePath();ctx.fill();ctx.stroke();
  // Right wing
  ctx.beginPath();ctx.moveTo(4,0);ctx.lineTo(e.w*.55,flap);ctx.lineTo(e.w*.5,e.h*.4);ctx.lineTo(e.w*.3,e.h*.15);ctx.lineTo(4,e.h*.1);ctx.closePath();ctx.fill();ctx.stroke();
  // Body
  ctx.fillStyle='#0a0a20';ctx.beginPath();ctx.ellipse(0,e.h*.2,7,10,0,0,Math.PI*2);ctx.fill();
  // Head & ears
  ctx.fillStyle='#080818';ctx.beginPath();ctx.arc(0,-2,7,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.moveTo(-5,-7);ctx.lineTo(-8,-16);ctx.lineTo(-1,-8);ctx.fill();
  ctx.beginPath();ctx.moveTo(5,-7);ctx.lineTo(8,-16);ctx.lineTo(1,-8);ctx.fill();
  ctx.fillStyle='#ff4488';ctx.shadowColor='#f48';ctx.shadowBlur=glow(7);ctx.beginPath();ctx.arc(-3,-3,2.5,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(3,-3,2.5,0,Math.PI*2);ctx.fill();
  ctx.restore();
}

// ══ WORLD 7: TOXIC ZONE ══════════════════════════)
function d_tx_slug(e){
  const f=e.vx>=0?1:-1;
  ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);ctx.scale(f,1);ctx.translate(-e.w/2,-e.h/2);
  // Slug body — elongated oval
  ctx.fillStyle='#334400';ctx.beginPath();ctx.ellipse(e.w*.44,e.h*.62,e.w*.44,e.h*.3,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#446600';ctx.shadowBlur=0;ctx.beginPath();ctx.ellipse(e.w*.42,e.h*.58,e.w*.38,e.h*.22,0,0,Math.PI*2);ctx.fill();
  // Slime trail
  ctx.fillStyle='#88bb0033';ctx.beginPath();ctx.ellipse(e.w*.1,e.h*.75,e.w*.14,5,0,0,Math.PI*2);ctx.fill();
  // Head
  ctx.fillStyle='#335500';ctx.beginPath();ctx.arc(e.w*.18,e.h*.5,e.w*.22,0,Math.PI*2);ctx.fill();
  // Eyes on stalks
  ctx.strokeStyle='#446600';ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(e.w*.1,e.h*.38);ctx.lineTo(e.w*.04,e.h*.14);ctx.stroke();
  ctx.beginPath();ctx.moveTo(e.w*.2,e.h*.36);ctx.lineTo(e.w*.22,e.h*.12);ctx.stroke();
  ctx.fillStyle='#bbff00';ctx.shadowBlur=0;ctx.beginPath();ctx.arc(e.w*.04,e.h*.12,4,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(e.w*.22,e.h*.1,4,0,Math.PI*2);ctx.fill();
  ctx.restore();
}
function d_tx_blob(e){
  const sq=e.onGnd?.7:1.15,jiggle=Math.sin(e.a*4)*.08;
  ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h);ctx.scale(1+jiggle,sq);
  const cy=-e.h*sq*.55;
  ctx.fillStyle='#223300';ctx.beginPath();ctx.arc(0,cy,e.w*.45,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#335500';ctx.shadowBlur=0;ctx.beginPath();ctx.arc(-2,cy-3,e.w*.34,0,Math.PI*2);ctx.fill();
  // Drip blobs
  ctx.fillStyle='#44aa00';ctx.shadowBlur=0;
  for(let di=0;di<4;di++){const da=di*Math.PI*.5+e.a*.2;ctx.beginPath();ctx.arc(Math.cos(da)*e.w*.4,cy+Math.sin(da)*e.h*.3,5,0,Math.PI*2);ctx.fill();}
  // Eyes
  ctx.fillStyle='#bbff00';ctx.shadowBlur=0;ctx.beginPath();ctx.arc(-7,cy-5,4,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(7,cy-5,4,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#000';ctx.shadowBlur=0;ctx.beginPath();ctx.arc(-6,cy-5,2,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(8,cy-5,2,0,Math.PI*2);ctx.fill();
  ctx.restore();
}  
function d_tx_fly(e){
  const bob=Math.sin(e.fpH)*3,wing=Math.sin(e.a*12)*8;
  ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);
  // Wings — translucent
  ctx.fillStyle='#88cc0044';ctx.shadowBlur=0;ctx.shadowColor='#cf0';
  ctx.beginPath();ctx.ellipse(-e.w*.3,wing,e.w*.28,6,-.4,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.ellipse(e.w*.3,wing,e.w*.28,6,.4,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.ellipse(-e.w*.2,-wing-4,e.w*.18,4,-.3,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.ellipse(e.w*.2,-wing-4,e.w*.18,4,.3,0,Math.PI*2);ctx.fill();
  // Body
  ctx.fillStyle='#334400';ctx.beginPath();ctx.ellipse(0,4,6,11,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#557700';
  for(let si=0;si<4;si++){ctx.beginPath();ctx.arc(0,4-si*5,7-si,0,Math.PI*2);ctx.stroke();}
  // Head
  ctx.fillStyle='#446600';ctx.beginPath();ctx.arc(0,-9,7,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#ccff00';ctx.shadowBlur=0;ctx.beginPath();ctx.arc(-4,-10,3.5,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(4,-10,3.5,0,Math.PI*2);ctx.fill();
  ctx.restore();
}

// ══ WORLD 8: STORM PEAKS ═════════════════════════ 
function d_st_gust(e){
  const f=e.vx>=0?1:-1;
  ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);ctx.scale(f,1);ctx.translate(-e.w/2,-e.h/2);
  ctx.globalAlpha=0.82+Math.sin(e.a*.7)*.12;
  // Wind vortex body
  ctx.fillStyle='#1a1a33';ctx.beginPath();ctx.arc(e.w/2,e.h*.55,e.w*.4,0,Math.PI*2);ctx.fill();
  // Swirling arc lines
  ctx.strokeStyle='#6666cc';ctx.lineWidth=2;ctx.shadowBlur=0;
  for(let si=0;si<3;si++){const ang=e.a*.8+si*2.1;ctx.beginPath();ctx.arc(e.w/2,e.h*.55,8+si*6,ang,ang+1.6);ctx.stroke();}
  // Head
  ctx.fillStyle='#22224a';ctx.fillRect(4,0,e.w-8,e.h*.44);
  ctx.fillStyle='#8888ff';ctx.shadowBlur=0;ctx.fillRect(6,7,5,4);ctx.fillRect(e.w-11,7,5,4);
  // Lightning arms
  ctx.strokeStyle='#aaaaff';ctx.lineWidth=1.5;
  ctx.beginPath();ctx.moveTo(-2,e.h*.44);ctx.lineTo(-10,e.h*.55);ctx.lineTo(-5,e.h*.6);ctx.lineTo(-14,e.h*.72);ctx.stroke();
  ctx.beginPath();ctx.moveTo(e.w+2,e.h*.44);ctx.lineTo(e.w+10,e.h*.55);ctx.lineTo(e.w+5,e.h*.6);ctx.lineTo(e.w+14,e.h*.72);ctx.stroke();
  // Legs
  const lk=e.onGnd?Math.sin(e.a*3)*3:0;_rLegs(0,0,e.w,e.h,'#22224a',lk);
  ctx.restore();
}
function d_st_titan(e){
  const lk=e.onGnd?Math.sin(e.a*2)*3:0;
  ctx.save();ctx.translate(e.x,e.y);
  // Armour
  ctx.fillStyle='#141428';ctx.fillRect(3,e.h*.38,e.w-6,e.h*.62);
  ctx.fillStyle='#1e1e3a';ctx.fillRect(5,e.h*.42,e.w-10,e.h*.46);
  // Lightning etching on armour
  ctx.strokeStyle='#8888ff';ctx.lineWidth=1.5;ctx.shadowBlur=0;
  ctx.beginPath();ctx.moveTo(8,e.h*.46);ctx.lineTo(14,e.h*.6);ctx.lineTo(10,e.h*.64);ctx.lineTo(16,e.h*.78);ctx.stroke();
  // Pauldrons
  ctx.fillStyle='#0e0e22';ctx.fillRect(-6,e.h*.38,8,20);ctx.fillRect(e.w-2,e.h*.38,8,20);
  // Head with crown lightning
  ctx.fillStyle='#141428';ctx.fillRect(5,0,e.w-10,e.h*.42);
  ctx.fillStyle='#aaaaff';ctx.shadowBlur=0;ctx.fillRect(8,7,7,5);ctx.fillRect(e.w-15,7,7,5);
  // Crown of lightning bolts
  ctx.fillStyle='#8888ff';
  for(let ci=0;ci<3;ci++){const cx=e.w*.2+ci*(e.w*.28);ctx.beginPath();ctx.moveTo(cx,0);ctx.lineTo(cx+3,-12);ctx.lineTo(cx+6,0);ctx.fill();}
  // Legs
  ctx.fillStyle='#101025';ctx.fillRect(3,e.h-15,12,15+lk);ctx.fillRect(e.w-15,e.h-15,12,15-lk);
  ctx.restore();
}
function d_st_bolt(e){
  const bob=Math.sin(e.fpH)*5;
  ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);
  // Lightning bolt shape body
  ctx.fillStyle='#2222cc';ctx.shadowBlur=0;ctx.shadowColor='#88f';
  ctx.beginPath();
  ctx.moveTo(4,-e.h*.48);ctx.lineTo(e.w*.3,-e.h*.02);ctx.lineTo(e.w*.1,-e.h*.02);ctx.lineTo(-4,e.h*.48);ctx.lineTo(-e.w*.3,e.h*.02);ctx.lineTo(-e.w*.1,e.h*.02);ctx.closePath();ctx.fill();
  ctx.fillStyle='#aaaaff';ctx.shadowBlur=0;
  ctx.beginPath();
  ctx.moveTo(2,-e.h*.4);ctx.lineTo(e.w*.22,0);ctx.lineTo(e.w*.07,0);ctx.lineTo(-2,e.h*.4);ctx.lineTo(-e.w*.22,0);ctx.lineTo(-e.w*.07,0);ctx.closePath();ctx.fill();
  // Core
  ctx.fillStyle='#fff';ctx.shadowBlur=0;ctx.beginPath();ctx.arc(0,0,4,0,Math.PI*2);ctx.fill();
  ctx.restore();
}

// ══ WORLD 9: FINAL FORTRESS ══════════════════════nst
function d_ff_guard(e){
  const f=e.vx>=0?1:-1,lk=e.onGnd?Math.sin(e.a*3)*3:0;
  ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);ctx.scale(f,1);ctx.translate(-e.w/2,-e.h/2);
  _rLegs(0,0,e.w,e.h,'#1a0000',lk);
  _rBody(0,0,e.w,e.h,'#330000','#4a0000');
  // Shield
  ctx.fillStyle='#550000';ctx.fillRect(-9,e.h*.4,7,e.h*.35);ctx.strokeStyle='#f44';ctx.lineWidth=1.5;ctx.strokeRect(-9,e.h*.4,7,e.h*.35);
  ctx.fillStyle='#f44';ctx.shadowBlur=0;ctx.fillRect(-8,e.h*.49,5,4); // shield emblem
  // Helmet head
  ctx.fillStyle='#2a0000';ctx.fillRect(3,0,e.w-6,e.h*.46);
  ctx.fillStyle='#400000';ctx.fillRect(5,3,e.w-10,e.h*.32);
  // Visor glow
  ctx.fillStyle='#ff0000';ctx.shadowBlur=0;ctx.fillRect(5,6,e.w-10,6);
  ctx.fillStyle='#ff8888';ctx.shadowBlur=0;ctx.fillRect(7,7,4,3);
  // Helmet plume
  ctx.fillStyle='#cc0000';ctx.beginPath();ctx.moveTo(e.w*.2,-2);ctx.lineTo(e.w*.5,-12);ctx.lineTo(e.w*.8,-2);ctx.fill();
  ctx.restore();
} 
function d_ff_demon(e){
  const lk=e.onGnd?Math.sin(e.a*2)*3:0,wing=Math.sin(e.a*.6)*10;
  ctx.save();ctx.translate(e.x,e.y);
  // Wings
  ctx.fillStyle='#1a0000';ctx.shadowBlur=0;ctx.shadowColor='#f00';
  ctx.beginPath();ctx.moveTo(e.w*.3,e.h*.3);ctx.lineTo(-12,e.h*.1+wing);ctx.lineTo(-8,e.h*.5);ctx.lineTo(e.w*.15,e.h*.44);ctx.closePath();ctx.fill();
  ctx.beginPath();ctx.moveTo(e.w*.7,e.h*.3);ctx.lineTo(e.w+12,e.h*.1+wing);ctx.lineTo(e.w+8,e.h*.5);ctx.lineTo(e.w*.85,e.h*.44);ctx.closePath();ctx.fill();
  // Massive body
  ctx.fillStyle='#330000';ctx.fillRect(4,e.h*.32,e.w-8,e.h*.68);
  ctx.fillStyle='#4a0000';ctx.fillRect(6,e.h*.36,e.w-12,e.h*.52);
  // Chest scar glow
  ctx.strokeStyle='#ff2200';ctx.lineWidth=2;ctx.shadowBlur=0;
  ctx.beginPath();ctx.moveTo(e.w*.3,e.h*.4);ctx.lineTo(e.w*.5,e.h*.62);ctx.lineTo(e.w*.7,e.h*.4);ctx.stroke();
  // Horned head
  ctx.fillStyle='#2a0000';ctx.fillRect(6,0,e.w-12,e.h*.36);
  ctx.fillStyle='#ff0000';ctx.shadowBlur=0;ctx.fillRect(9,8,8,6);ctx.fillRect(e.w-17,8,8,6); // evil eyes
  ctx.fillStyle='#1a0000';ctx.shadowBlur=0;
  // Horns
  ctx.beginPath();ctx.moveTo(8,2);ctx.lineTo(2,-16);ctx.lineTo(14,0);ctx.fill();
  ctx.beginPath();ctx.moveTo(e.w-8,2);ctx.lineTo(e.w-2,-16);ctx.lineTo(e.w-14,0);ctx.fill();
  // Legs
  ctx.fillStyle='#200000';ctx.fillRect(4,e.h-16,13,16+lk);ctx.fillRect(e.w-17,e.h-16,13,16-lk);
  ctx.restore();
}
function d_ff_eye(e){
  const bob=Math.sin(e.fpH)*5,pupilX=Math.cos(e.a*.5)*4,pupilY=Math.sin(e.a*.4)*3;
  ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);
  // Eye shape — sclera
  ctx.fillStyle='#cc0000';ctx.shadowBlur=0;ctx.shadowColor='#f00';
  ctx.beginPath();ctx.moveTo(-e.w*.48,0);ctx.quadraticCurveTo(0,-e.h*.48,e.w*.48,0);ctx.quadraticCurveTo(0,e.h*.48,-e.w*.48,0);ctx.fill();
  // Iris
  ctx.fillStyle='#880000';ctx.beginPath();ctx.arc(0,0,9,0,Math.PI*2);ctx.fill();
  // Pupil glow
  ctx.fillStyle='#ff0000';ctx.shadowBlur=0;ctx.beginPath();ctx.arc(pupilX,pupilY,6,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#000';ctx.shadowBlur=0;ctx.beginPath();ctx.arc(pupilX+.5,pupilY+.5,3,0,Math.PI*2);ctx.fill();
  // Veins
  ctx.strokeStyle='#ff000066';ctx.lineWidth=1;
  for(let vi=0;vi<6;vi++){const a=vi*Math.PI/3;ctx.beginPath();ctx.moveTo(Math.cos(a)*10,Math.sin(a)*8);ctx.lineTo(Math.cos(a)*e.w*.42,Math.sin(a)*e.h*.38);ctx.stroke();}
  // Eyelid top/bottom
  ctx.strokeStyle='#660000';ctx.lineWidth=2;ctx.shadowBlur=0;
  ctx.beginPath();ctx.moveTo(-e.w*.48,0);ctx.quadraticCurveTo(0,-e.h*.48,e.w*.48,0);ctx.stroke();
  ctx.beginPath();ctx.moveTo(-e.w*.48,0);ctx.quadraticCurveTo(0,e.h*.48,e.w*.48,0);ctx.stroke();
  ctx.restore();
}

// ── New enemy draw functions ──────────────────
// The shield bubble is drawn once, centrally, by drawEnemies() — in screen
// space, outside every sprite's own transform. There used to be a _shieldRing()
// helper called from inside d_ff_sentinel/d_pr_guard as well; because those run
// inside translate()/scale() it painted a second, misplaced ellipse far from
// the enemy. Per-world colour now comes from e.glow in drawEnemies() instead.

// ── CY ──
function d_cy_sniper(e){const f=(nearestPlayer(e.x).x>e.x)?1:-1;ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);ctx.scale(f,1);ctx.translate(-e.w/2,-e.h/2);ctx.fillStyle='#220044';ctx.fillRect(3,0,e.w-6,e.h);ctx.fillStyle='#4422aa';ctx.fillRect(5,3,e.w-10,e.h*.5);ctx.fillStyle='#88aaff';ctx.shadowBlur=0;ctx.fillRect(5,5,5,4);ctx.fillRect(e.w-10,5,5,4);ctx.fillStyle='#4422aa';ctx.fillRect(e.w-1,e.h*.4,14,5);ctx.fillStyle='#aaaaff';ctx.fillRect(e.w+10,e.h*.41,4,3);if(e.sCD<35){ctx.globalAlpha=.5*(1-e.sCD/35);ctx.strokeStyle='#88f';ctx.lineWidth=1;ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(e.w+2,e.h*.43);ctx.lineTo(e.w+70,e.h*.43);ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=1;}ctx.restore();}
function d_cy_rusher(e){const f=e.vx>=0?1:-1;ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);ctx.scale(f,1);ctx.translate(-e.w/2,-e.h/2);const lk=e.onGnd?Math.sin(e.a*3)*3:0;ctx.fillStyle='#880044';ctx.fillRect(2,e.h-14,9,14+lk);ctx.fillRect(e.w-11,e.h-14,9,14-lk);ctx.fillStyle='#cc0066';ctx.fillRect(3,e.h-22,e.w-6,10);ctx.fillStyle='#ee1188';ctx.fillRect(5,e.h-20,e.w-10,7);ctx.fillStyle='#ff44aa';ctx.shadowBlur=0;ctx.fillRect(4,0,e.w-8,14);ctx.fillStyle='#ff88cc';ctx.fillRect(6,3,e.w-12,7);if(e.charging){ctx.fillStyle='#f4a';ctx.shadowBlur=0;ctx.beginPath();ctx.moveTo(e.w,e.h/2);ctx.lineTo(e.w+12,e.h/2-6);ctx.lineTo(e.w+12,e.h/2+6);ctx.closePath();ctx.fill();}ctx.restore();}

// ── JG ──es
function d_jg_pitcher(e){const f=(nearestPlayer(e.x).x>e.x)?1:-1;ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);ctx.scale(f,1);ctx.translate(-e.w/2,-e.h/2);ctx.fillStyle='#003322';ctx.fillRect(4,0,e.w-8,e.h);ctx.fillStyle='#006644';ctx.fillRect(6,3,e.w-12,e.h*.55);ctx.fillStyle='#44ff88';ctx.shadowBlur=0;ctx.fillRect(6,5,5,4);ctx.fillRect(e.w-11,5,5,4);// pitcher mouth
ctx.fillStyle='#004422';ctx.beginPath();ctx.arc(e.w/2,e.h*.7,8,0,Math.PI);ctx.fill();ctx.fillStyle='#00cc44';ctx.beginPath();ctx.arc(e.w/2,e.h*.7,5,.1,Math.PI-.1);ctx.fill();// arm shoot
ctx.strokeStyle='#006644';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(e.w/2+6,e.h*.45);ctx.lineTo(e.w+8,e.h*.2);ctx.stroke();ctx.restore();}
function d_jg_creeper(e){const f=e.vx>=0?1:-1;ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);ctx.scale(f,1);ctx.translate(-e.w/2,-e.h/2);const lk=e.onGnd?Math.sin(e.a*4)*4:0;// Vine legs
for(let li=0;li<3;li++){ctx.strokeStyle='#224411';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(4+li*8,e.h);ctx.quadraticCurveTo(2+li*7,e.h+lk+6,li*8,e.h+12+lk);ctx.stroke();}ctx.fillStyle='#116611';ctx.fillRect(3,e.h-18,e.w-6,18);ctx.fillStyle='#22aa22';ctx.fillRect(5,e.h-16,e.w-10,12);ctx.fillStyle='#1a3a0a';ctx.fillRect(4,0,e.w-8,e.h*.52);ctx.fillStyle='#33cc22';ctx.shadowBlur=0;ctx.fillRect(6,4,5,4);ctx.fillRect(e.w-11,4,5,4);if(e.charging){ctx.fillStyle='#4c2';ctx.shadowBlur=0;ctx.beginPath();ctx.arc(e.w/2,e.y+e.h/2-e.y-e.h/2,12,0,Math.PI*2);ctx.fill();}ctx.restore();}

// ── LV ──a
function d_lv_magma(e){ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);const lk=e.onGnd?Math.sin(e.a*3)*3:0;ctx.fillStyle='#440000';ctx.fillRect(-e.w/2+2,e.h*.5,10,e.h*.5+lk);ctx.fillRect(e.w/2-12,e.h*.5,10,e.h*.5-lk);ctx.fillStyle='#661100';ctx.fillRect(-e.w/2,0,e.w,e.h*.55);ctx.fillStyle='#aa2200';ctx.fillRect(-e.w/2+3,2,e.w-6,e.h*.4);ctx.fillStyle='#ff4400';ctx.shadowBlur=0;ctx.fillRect(-e.w/2+5,5,6,5);ctx.fillRect(e.w/2-11,5,6,5);// magma drips
ctx.fillStyle='#ff6600';for(let di=0;di<3;di++){ctx.beginPath();ctx.arc(-e.w/2+6+di*7,e.h*.52+Math.sin(e.a+di)*4,3,0,Math.PI*2);ctx.fill();}ctx.restore();}
function d_lv_eruption(e){const f=e.vx>=0?1:-1;ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);ctx.scale(f,1);ctx.translate(-e.w/2,-e.h/2);const lk=e.onGnd?Math.sin(e.a*3)*3:0;ctx.fillStyle='#550000';ctx.fillRect(2,e.h-14,9,14+lk);ctx.fillRect(e.w-11,e.h-14,9,14-lk);ctx.fillStyle='#882200';ctx.fillRect(3,e.h*.4,e.w-6,e.h*.6);ctx.fillStyle='#ff4400';ctx.shadowColor='#f40';ctx.shadowBlur=glow(8);for(let fi=0;fi<4;fi++){const fy=-8+Math.sin(tick*.1+fi)*6;ctx.beginPath();ctx.moveTo(4+fi*5,4);ctx.quadraticCurveTo(6+fi*4,fy,8+fi*4,4);ctx.fill();}ctx.fillStyle='#ffaa00';ctx.fillRect(5,6,e.w-10,6);if(e.charging){ctx.globalAlpha=0.7;ctx.shadowColor='#f80';ctx.shadowBlur=glow(12);ctx.fillStyle='#ff8800';ctx.beginPath();ctx.arc(e.w+6,e.h/2,8,0,Math.PI*2);ctx.fill();}ctx.restore();}

// ── IC ──ns
function d_ic_icicle(e){ctx.save();ctx.translate(e.x+e.w/2,e.y);// Hanging icicle
ctx.fillStyle='#3366aa';ctx.beginPath();ctx.moveTo(-e.w/2+3,0);ctx.lineTo(0,e.h);ctx.lineTo(e.w/2-3,0);ctx.closePath();ctx.fill();ctx.fillStyle='#aaddff';ctx.globalAlpha=0.6;ctx.beginPath();ctx.moveTo(-4,0);ctx.lineTo(0,e.h*.6);ctx.lineTo(4,0);ctx.closePath();ctx.fill();ctx.globalAlpha=1;ctx.strokeStyle='#88ccff';ctx.lineWidth=1.5;ctx.strokeRect(-e.w/2+3,0,e.w-6,3);if(e.sCD<30){ctx.shadowColor='#6af';ctx.shadowBlur=glow(8);ctx.strokeStyle='#88bbff';ctx.lineWidth=1;ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(0,e.h);ctx.lineTo(0,e.h+60);ctx.stroke();ctx.setLineDash([]);}ctx.restore();}
function d_ic_snowball(e){const f=e.vx>=0?1:-1;ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);ctx.scale(f,1);const sc=e.onGnd?0.82:1.05;ctx.scale(1,sc);ctx.fillStyle='#aacce8';ctx.beginPath();ctx.arc(0,0,e.w/2-2,0,Math.PI*2);ctx.fill();ctx.fillStyle='#cce8ff';ctx.beginPath();ctx.arc(-4,-4,e.w*.28,0,Math.PI*2);ctx.fill();ctx.fillStyle='#224466';ctx.shadowBlur=0;ctx.beginPath();ctx.arc(-6,-2,4,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(6,-2,4,0,Math.PI*2);ctx.fill();if(e.charging){ctx.strokeStyle='#8df';ctx.lineWidth=3;ctx.shadowBlur=0;ctx.beginPath();ctx.arc(0,0,e.w/2+8,0,Math.PI*2);ctx.stroke();}ctx.restore();}

// ── DS ──1
function d_ds_scorpion(e){const f=e.vx>=0?1:-1;ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);ctx.scale(f,1);ctx.translate(-e.w/2,-e.h/2);ctx.fillStyle='#551100';ctx.beginPath();ctx.ellipse(e.w/2,e.h*.6,e.w*.44,e.h*.36,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#882200';ctx.beginPath();ctx.ellipse(e.w/2,e.h*.55,e.w*.36,e.h*.27,0,0,Math.PI*2);ctx.fill();// tail
ctx.strokeStyle='#882200';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(e.w*.8,e.h*.4);ctx.quadraticCurveTo(e.w+10,e.h*.1,e.w*.7,-10);ctx.stroke();ctx.fillStyle='#cc2200';ctx.shadowBlur=0;ctx.beginPath();ctx.arc(e.w*.7,-10,5,0,Math.PI*2);ctx.fill();// head
ctx.fillStyle='#771100';ctx.fillRect(e.w*.18,e.h*.1,e.w*.38,e.h*.38);ctx.fillStyle='#ff6600';ctx.shadowBlur=0;ctx.beginPath();ctx.arc(e.w*.28,e.h*.22,4,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(e.w*.52,e.h*.22,4,0,Math.PI*2);ctx.fill();// legs
ctx.strokeStyle='#662200';ctx.lineWidth=2;for(let li=0;li<4;li++){ctx.beginPath();ctx.moveTo(e.w*.22+li*e.w*.16,e.h*.7);ctx.lineTo(e.w*.22+li*e.w*.16-4,e.h+4);ctx.stroke();}ctx.restore();}
function d_ds_sandworm(e){const f=e.vx>=0?1:-1;ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);ctx.scale(f,1);ctx.translate(-e.w/2,-e.h/2);// Segmented worm
for(let si=0;si<4;si++){const sx=e.w*.1+si*(e.w*.22),sy=e.h*.35+Math.sin(e.a+si*.8)*8;ctx.fillStyle=si%2?'#664422':'#886633';ctx.beginPath();ctx.arc(sx,sy,e.w*.14,0,Math.PI*2);ctx.fill();}// head
ctx.fillStyle='#774422';ctx.beginPath();ctx.arc(e.w*.88,e.h*.35,e.w*.18,0,Math.PI*2);ctx.fill();// mouth
ctx.fillStyle='#cc6622';ctx.shadowBlur=0;ctx.beginPath();ctx.moveTo(e.w*.88,e.h*.28);ctx.arc(e.w*.88,e.h*.35,e.w*.14,-.8,.8);ctx.fill();ctx.fillStyle='#ff8800';ctx.beginPath();ctx.arc(e.w*.8,e.h*.28,4,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(e.w*.96,e.h*.28,4,0,Math.PI*2);ctx.fill();if(e.charging){ctx.strokeStyle='#da8';ctx.lineWidth=3;ctx.shadowBlur=0;ctx.beginPath();ctx.ellipse(e.w/2,e.h*.35,e.w*.5+8,e.h*.25+6,0,0,Math.PI*2);ctx.stroke();}ctx.restore();}

// ── SP ──e(
function d_sp_turret(e){ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);// Base
ctx.fillStyle='#1a0a2a';ctx.fillRect(-e.w/2,0,e.w,e.h*.55);ctx.fillStyle='#2a1a44';ctx.fillRect(-e.w/2+2,2,e.w-4,e.h*.45);// Rotating head
const np=nearestPlayer(e.x);const ang=Math.atan2(np.y-e.y-e.h/2,np.x-e.x-e.w/2);ctx.save();ctx.rotate(ang);ctx.fillStyle='#331155';ctx.fillRect(-8,-8,e.w*.7,16);ctx.fillStyle='#cc44ff';ctx.shadowBlur=0;ctx.fillRect(e.w*.5,-4,8,8);ctx.restore();// Dome
ctx.fillStyle='#221133';ctx.beginPath();ctx.arc(0,-e.h*.1,e.w*.28,0,Math.PI*2);ctx.fill();ctx.fillStyle='#cc44ff';ctx.shadowBlur=0;ctx.beginPath();ctx.arc(0,-e.h*.1,e.w*.12,0,Math.PI*2);ctx.fill();ctx.restore();}
function d_sp_phantom(e){const f=e.vx>=0?1:-1;ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);ctx.scale(f,1);ctx.globalAlpha=0.7+Math.sin(e.a*.5)*.2;// Ghost body
ctx.fillStyle='#8822cc';ctx.shadowColor='#a3f';ctx.shadowBlur=glow(7);ctx.beginPath();ctx.moveTo(0,-e.h*.5);ctx.quadraticCurveTo(e.w*.4,-e.h*.1,e.w*.4,e.h*.3);for(let wi=3;wi>=0;wi--){ctx.lineTo(e.w*.4-wi*(e.w*.22)+Math.sin(e.a+wi)*5,e.h*.5);}ctx.quadraticCurveTo(-e.w*.4,e.h*.1,-e.w*.4,-e.h*.5);ctx.closePath();ctx.fill();ctx.fillStyle='#fff';ctx.shadowBlur=0;ctx.globalAlpha=0.9;ctx.beginPath();ctx.arc(-e.w*.14,-e.h*.15,4,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(e.w*.14,-e.h*.15,4,0,Math.PI*2);ctx.fill();if(e.charging){ctx.fillStyle='#e8f';ctx.shadowColor='#f0f';ctx.shadowBlur=glow(12);ctx.globalAlpha=0.8;ctx.beginPath();ctx.arc(e.w*.5+8,0,8,0,Math.PI*2);ctx.fill();}ctx.restore();}

// ── DF ──e.
function d_df_owl(e){const f=(nearestPlayer(e.x).x>e.x)?1:-1;ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);ctx.scale(f,1);ctx.translate(-e.w/2,-e.h/2);ctx.fillStyle='#221133';ctx.fillRect(4,e.h*.3,e.w-8,e.h*.7);ctx.fillStyle='#331144';ctx.fillRect(6,e.h*.32,e.w-12,e.h*.55);// Head
ctx.fillStyle='#221133';ctx.beginPath();ctx.arc(e.w/2,e.h*.22,e.w*.32,0,Math.PI*2);ctx.fill();// Ears
ctx.fillStyle='#110a22';ctx.beginPath();ctx.moveTo(e.w*.22,e.h*.06);ctx.lineTo(e.w*.16,-4);ctx.lineTo(e.w*.32,e.h*.1);ctx.fill();ctx.beginPath();ctx.moveTo(e.w*.78,e.h*.06);ctx.lineTo(e.w*.84,-4);ctx.lineTo(e.w*.68,e.h*.1);ctx.fill();// Big eyes
ctx.fillStyle='#88aaff';ctx.shadowBlur=0;ctx.beginPath();ctx.arc(e.w*.34,e.h*.2,6,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(e.w*.66,e.h*.2,6,0,Math.PI*2);ctx.fill();ctx.fillStyle='#000';ctx.shadowBlur=0;ctx.beginPath();ctx.arc(e.w*.35,e.h*.2,3,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(e.w*.67,e.h*.2,3,0,Math.PI*2);ctx.fill();// Beam when shooting
if(e.sCD<25){ctx.globalAlpha=.45*(1-e.sCD/25);ctx.strokeStyle='#84f';ctx.lineWidth=2;ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(e.w*.66,e.h*.2);ctx.lineTo(e.w*.66+f*80,e.h*.2);ctx.stroke();ctx.setLineDash([]);}ctx.restore();}
function d_df_lurker(e){const f=e.vx>=0?1:-1;ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);ctx.scale(f,1);ctx.translate(-e.w/2,-e.h/2);ctx.globalAlpha=0.65+Math.sin(e.a*.4)*.2;// Shadow body
ctx.fillStyle='#0a0022';ctx.shadowBlur=0;
ctx.beginPath();ctx.moveTo(e.w*.5,-e.h*.5);for(let pi=0;pi<8;pi++){const pa=pi*Math.PI/4;const pr=e.w*.38+Math.sin(e.a+pi)*.08*e.w;ctx.lineTo(e.w*.5+Math.cos(pa)*pr,e.h*.3+Math.sin(pa)*e.h*.38);}ctx.closePath();ctx.fill();// Eyes
ctx.fillStyle='#cc0066';ctx.shadowBlur=0;ctx.beginPath();ctx.arc(e.w*.35,e.h*.18,4,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(e.w*.65,e.h*.18,4,0,Math.PI*2);ctx.fill();if(e.charging){ctx.fillStyle='#f4a';ctx.shadowBlur=0;ctx.globalAlpha=0.8;ctx.beginPath();ctx.arc(e.w+8,e.h/2,7,0,Math.PI*2);ctx.fill();}ctx.globalAlpha=1;ctx.restore();}

// ── TX ──y);
function d_tx_venom(e){ctx.save();ctx.translate(e.x,e.y);// Spider-like
ctx.fillStyle='#223300';ctx.beginPath();ctx.ellipse(e.w/2,e.h*.55,e.w*.35,e.h*.38,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#446600';ctx.shadowBlur=0;ctx.beginPath();ctx.ellipse(e.w/2,e.h*.5,e.w*.28,e.h*.28,0,0,Math.PI*2);ctx.fill();// Legs
ctx.strokeStyle='#335500';ctx.lineWidth=2;for(let li=0;li<4;li++){const side=li<2?-1:1;const ly=e.h*.38+li%2*14;ctx.beginPath();ctx.moveTo(e.w/2+side*e.w*.3,ly);ctx.lineTo(e.w/2+side*(e.w*.55),ly-10);ctx.lineTo(e.w/2+side*(e.w*.7),ly+5);ctx.stroke();}// Eyes row
ctx.fillStyle='#88ff00';ctx.shadowBlur=0;for(let ei=0;ei<4;ei++)ctx.beginPath(),ctx.arc(e.w*.22+ei*e.w*.19,e.h*.2,3,0,Math.PI*2),ctx.fill();// Venom drop when shooting
if(e.sCD<40){ctx.fillStyle='#88cc00';ctx.globalAlpha=.5*(1-e.sCD/40);ctx.beginPath();ctx.arc(e.w/2,e.h,5,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;}ctx.restore();}
function d_tx_mutant(e){const f=e.vx>=0?1:-1;ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);ctx.scale(f,1);ctx.translate(-e.w/2,-e.h/2);const lk=e.onGnd?Math.sin(e.a*2)*3:0;// Mutated bulk
ctx.fillStyle='#223300';ctx.fillRect(2,e.h-16,12,16+lk);ctx.fillRect(e.w-14,e.h-16,12,16-lk);ctx.fillStyle='#3a4400';ctx.fillRect(3,e.h*.3,e.w-6,e.h*.72);ctx.fillStyle='#556600';ctx.fillRect(5,e.h*.34,e.w-10,e.h*.55);// Mutations / tumors
for(let ti=0;ti<4;ti++){ctx.fillStyle='#6a8000';ctx.shadowBlur=0;ctx.beginPath();ctx.arc(4+ti*(e.w*.28),e.h*.4+Math.sin(ti)*10,8+ti%2*4,0,Math.PI*2);ctx.fill();}// Head
ctx.fillStyle='#2a3300';ctx.fillRect(4,0,e.w-8,e.h*.36);ctx.fillStyle='#9c0';ctx.shadowBlur=0;ctx.fillRect(7,5,6,5);ctx.fillRect(e.w-13,5,6,5);// Asymmetric arms
ctx.fillStyle='#223300';ctx.fillRect(-8,e.h*.3,10,e.h*.3);ctx.fillRect(e.w-2,e.h*.3,14,e.h*.24);if(e.charging){ctx.strokeStyle='#9c0';ctx.lineWidth=3;ctx.shadowBlur=0;ctx.beginPath();ctx.ellipse(e.w/2,e.h/2,e.w*.6,e.h*.5,0,0,Math.PI*2);ctx.stroke();}ctx.restore();}

// ── ST ──y)
function d_st_rod(e){ctx.save();ctx.translate(e.x+e.w/2,e.y);// Lightning rod — tall thin
ctx.fillStyle='#222266';ctx.fillRect(-e.w/2+5,0,e.w-10,e.h);ctx.fillStyle='#4444aa';ctx.fillRect(-e.w/2+7,4,e.w-14,e.h*.8);// Tip
ctx.fillStyle='#aaaaff';ctx.shadowBlur=0;ctx.beginPath();ctx.moveTo(-4,0);ctx.lineTo(0,-14);ctx.lineTo(4,0);ctx.closePath();ctx.fill();// Discharge arc when shooting
if(e.sCD<35){const prog=1-e.sCD/35;ctx.strokeStyle='#ccccff';ctx.lineWidth=2;ctx.globalAlpha=prog*.7;ctx.shadowBlur=0;const np=nearestPlayer(e.x+e.w/2);const dx=np.x-(e.x+e.w/2),dy=np.y-(e.y+e.h*.1);const dist=Math.hypot(dx,dy);ctx.beginPath();ctx.moveTo(0,-14);for(let li=0;li<5;li++){const t=li/4;ctx.lineTo(dx*t+Math.sin(li*2.1+e.a)*12,dy*t-14+14);}ctx.stroke();ctx.globalAlpha=1;}ctx.restore();}
function d_st_cyclone(e){const f=e.vx>=0?1:-1;ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);ctx.scale(f,1);ctx.rotate(e.a*.3);// Swirling body
for(let ci=0;ci<3;ci++){ctx.globalAlpha=0.5+ci*.15;ctx.strokeStyle=['#4455cc','#6677ee','#aaaaff'][ci];ctx.lineWidth=3+ci;ctx.beginPath();ctx.arc(0,0,(e.w/2-2)-ci*4,e.a*.5,e.a*.5+Math.PI*1.5);ctx.stroke();}ctx.globalAlpha=1;// Core
ctx.fillStyle='#5566cc';ctx.shadowBlur=0;ctx.beginPath();ctx.arc(0,0,7,0,Math.PI*2);ctx.fill();ctx.fillStyle='#ccccff';ctx.beginPath();ctx.arc(-2,-2,3,0,Math.PI*2);ctx.fill();if(e.charging){ctx.strokeStyle='#ccf';ctx.lineWidth=4;ctx.shadowBlur=0;ctx.beginPath();ctx.arc(0,0,e.w*.55,0,Math.PI*2);ctx.stroke();}ctx.restore();}

// ── FF ──tr
function d_ff_sentinel(e){const f=e.vx>=0?1:-1;ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);ctx.scale(f,1);ctx.translate(-e.w/2,-e.h/2);const lk=e.onGnd?Math.sin(e.a*2)*3:0;// Armoured legs
ctx.fillStyle='#1a0000';ctx.fillRect(3,e.h-17,12,17+lk);ctx.fillRect(e.w-15,e.h-17,12,17-lk);ctx.fillStyle='#330000';ctx.fillRect(1,e.h*.88+lk,15,6);ctx.fillRect(e.w-16,e.h*.88-lk,15,6);// Heavy torso
ctx.fillStyle='#220000';ctx.fillRect(2,e.h*.36,e.w-4,e.h*.65);ctx.fillStyle='#330000';ctx.fillRect(4,e.h*.4,e.w-8,e.h*.52);// Shoulder pads
ctx.fillStyle='#1a0000';ctx.fillRect(-7,e.h*.36,9,22);ctx.fillRect(e.w-2,e.h*.36,9,22);// Head with full visor
ctx.fillStyle='#200000';ctx.fillRect(4,0,e.w-8,e.h*.4);ctx.fillStyle='#f80';ctx.shadowBlur=0;ctx.fillRect(6,8,e.w-12,8);ctx.restore();}
function d_ff_wraith(e){ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);ctx.globalAlpha=0.6+Math.sin(e.a*.4)*.25;// Wraith cloak
ctx.fillStyle='#220006';ctx.shadowBlur=0;ctx.beginPath();ctx.moveTo(0,-e.h*.5);ctx.quadraticCurveTo(e.w*.45,-e.h*.15,e.w*.4,e.h*.3);for(let wi=4;wi>=0;wi--){ctx.lineTo(e.w*.4-wi*(e.w*.2)+Math.sin(e.a+wi)*7,e.h*.5);}ctx.quadraticCurveTo(-e.w*.45,-e.h*.1,0,-e.h*.5);ctx.closePath();ctx.fill();// Eyes
ctx.fillStyle='#ff0055';ctx.shadowBlur=0;ctx.beginPath();ctx.arc(-6,-e.h*.15,4,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(6,-e.h*.15,4,0,Math.PI*2);ctx.fill();// Zigzag energy trail
ctx.strokeStyle='#f0a';ctx.lineWidth=2;ctx.shadowBlur=0;ctx.beginPath();for(let zi=0;zi<5;zi++){const zx=-e.w*.3+zi*e.w*.15+Math.sin(e.a+zi*1.5)*6;const zy=e.h*.3+zi*5;if(zi===0)ctx.moveTo(zx,zy);else ctx.lineTo(zx,zy);}ctx.stroke();ctx.globalAlpha=1;ctx.restore();}

// ══ WORLD 10: PRISM ANOMALY (secret) ═════════════
// A corrupted GRID fragment — silhouettes echo the other 9 worlds' robots but
// rendered "glitched": fixed magenta/violet palette (not a rainbow), with rare
// scanline tears and pixel-offset glitches standing in for the "prismatic"
// theme instead of cycling through every hue every frame (unreadable/ugly).
function d_pr_shard(e){
  const f=e.vx>=0?1:-1,lk=e.onGnd?Math.sin(e.a*3)*3:0;
  ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);ctx.scale(f,1);ctx.translate(-e.w/2,-e.h/2);
  _rLegs(0,0,e.w,e.h,'#3a0a5a',lk);
  _rBody(0,0,e.w,e.h,'#5a14a0','#8020d0');
  _rHead(0,0,e.w,e.h,'#4a0e80','#7018c0','#f0f');
  // Jagged crystal shard jutting from the skull — cycles through the spectrum
  // (this is "Prism Anomaly": the whole point is refracted rainbow light, not
  // a single fixed tint like every other world's enemies).
  ctx.fillStyle=`hsl(${(tick*3+e.x)%360},95%,72%)`;
  ctx.beginPath();ctx.moveTo(e.w*.5,-10);ctx.lineTo(e.w*.62,0);ctx.lineTo(e.w*.5,e.h*.12);ctx.lineTo(e.w*.38,0);ctx.closePath();ctx.fill();
  // Corruption glitch: an occasional 1-frame scanline tear + colour-offset slice
  if(Math.floor(tick/5)%4===0){
    ctx.fillStyle='#ff00ff33';ctx.fillRect(0,e.h*.3,e.w,3);
    ctx.fillStyle='#00ffff22';ctx.fillRect(2,e.h*.55,e.w-4,3);
  }
  ctx.restore();
}
function d_pr_guard(e){
  const f=e.vx>=0?1:-1,lk=e.onGnd?Math.sin(e.a*2)*2:0;
  ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);ctx.scale(f,1);ctx.translate(-e.w/2,-e.h/2);
  // Heavy crystalline plating (cyan — matches its shield colour)
  ctx.fillStyle='#0a2a44';ctx.fillRect(0,e.h*.42,e.w,e.h*.58);
  ctx.fillStyle='#124a70';ctx.fillRect(2,e.h*.48,e.w-4,e.h*.4);
  ctx.fillStyle='#0a1a2c';ctx.fillRect(-4,e.h*.48,6,e.h*.3);ctx.fillRect(e.w-2,e.h*.48,6,e.h*.3); // shoulder plates
  _rHead(0,0,e.w,e.h,'#0d3350','#155a88','#0ff');
  ctx.fillStyle='#0a1a2c';
  ctx.fillRect(3,e.h-14,10,14+lk);ctx.fillRect(e.w-13,e.h-14,10,14-lk);
  // Faceted crystal crest on top — cycles through the spectrum
  ctx.fillStyle=`hsl(${(tick*3+e.x*2)%360},95%,75%)`;ctx.shadowBlur=0;
  ctx.beginPath();ctx.moveTo(e.w*.5,-9);ctx.lineTo(e.w*.58,1);ctx.lineTo(e.w*.42,1);ctx.closePath();ctx.fill();
  ctx.restore();
}
function d_pr_wisp(e){
  ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);
  // Trailing prism-shard halo orbiting the core — each shard its own hue
  for(let i=0;i<3;i++){
    const ang=e.a*1.4+i*(Math.PI*2/3);
    const rx=Math.cos(ang)*e.w*.7,ry=Math.sin(ang)*e.w*.5;
    ctx.save();ctx.translate(rx,ry);ctx.rotate(ang);
    ctx.fillStyle=`hsla(${(tick*4+i*120)%360},95%,68%,0.65)`;
    ctx.beginPath();ctx.moveTo(0,-4);ctx.lineTo(3,0);ctx.lineTo(0,4);ctx.lineTo(-3,0);ctx.closePath();ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha=0.9;ctx.fillStyle='#ffcc22';ctx.shadowColor='#ff8';ctx.shadowBlur=10;
  ctx.beginPath();ctx.arc(0,0,e.w/2,0,Math.PI*2);ctx.fill();
  ctx.globalAlpha=1;ctx.shadowBlur=0;ctx.fillStyle='#fff';
  ctx.beginPath();ctx.arc(0,0,e.w/5,0,Math.PI*2);ctx.fill();
  ctx.restore();
}
function d_pr_beam(e){
  const f=(nearestPlayer(e.x).x>e.x)?1:-1;
  ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);ctx.scale(f,1);ctx.translate(-e.w/2,-e.h/2);
  // Faceted emitter casing (green lens — matches its glow colour)
  ctx.fillStyle='#0a3020';ctx.fillRect(3,0,e.w-6,e.h);
  ctx.fillStyle='#125838';ctx.fillRect(5,3,e.w-10,e.h*.5);
  ctx.fillStyle='#0a1a10';ctx.beginPath();ctx.moveTo(3,e.h*.1);ctx.lineTo(0,e.h*.4);ctx.lineTo(3,e.h*.7);ctx.closePath();ctx.fill();
  ctx.fillStyle='#0a1a10';ctx.beginPath();ctx.moveTo(e.w-3,e.h*.1);ctx.lineTo(e.w,e.h*.4);ctx.lineTo(e.w-3,e.h*.7);ctx.closePath();ctx.fill();
  // Lens — cycles through the spectrum
  const lensHue=(tick*3+e.x)%360;
  ctx.fillStyle=`hsl(${lensHue},95%,65%)`;ctx.shadowColor=`hsl(${lensHue},95%,65%)`;ctx.shadowBlur=8;
  ctx.beginPath();ctx.arc(e.w-8,e.h*.32,4,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
  if(e.sCD<35){
    ctx.globalAlpha=.5*(1-e.sCD/35);ctx.strokeStyle=`hsl(${lensHue},95%,65%)`;ctx.lineWidth=1;
    ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(e.w+2,e.h*.32);ctx.lineTo(e.w+70,e.h*.32);ctx.stroke();
    ctx.setLineDash([]);ctx.globalAlpha=1;
  }
  ctx.restore();
}
function d_pr_glitch(e){
  const f=e.vx>=0?1:-1;
  ctx.save();ctx.translate(e.x+e.w/2,e.y+e.h/2);ctx.scale(f,1);ctx.translate(-e.w/2,-e.h/2);
  const lk=e.onGnd?Math.sin(e.a*4)*4:0;
  // Random-seeded per-enemy corruption offset (deterministic per instance via e.a)
  const glitchOn=Math.floor(tick/4+e.x)%5===0;
  const gx=glitchOn?(Math.sin(e.x*7+tick)*3):0;
  ctx.fillStyle='#4a0030';ctx.fillRect(2,e.h-14,9,14+lk);ctx.fillRect(e.w-11,e.h-14,9,14-lk);
  ctx.fillStyle='#8a1060';ctx.fillRect(3+gx,e.h-22,e.w-6,10);
  ctx.fillStyle='#cc2266';ctx.shadowBlur=0;ctx.fillRect(4-gx,0,e.w-8,14);
  ctx.fillStyle='#ffb0e0';ctx.fillRect(6,4,4,3);ctx.fillRect(e.w-12,4,4,3); // eyes
  if(glitchOn){
    // Corrupted duplicate slice offset to the side — the "glitch" signature look
    ctx.globalAlpha=.4;ctx.fillStyle=`hsl(${(tick*6+e.x)%360},95%,65%)`;ctx.fillRect(4+gx*2,0,e.w-8,6);
    ctx.globalAlpha=1;
  }
  if(e.charging){
    ctx.fillStyle='#fff';ctx.beginPath();ctx.moveTo(e.w,e.h/2);ctx.lineTo(e.w+12,e.h/2-6);ctx.lineTo(e.w+12,e.h/2+6);ctx.closePath();ctx.fill();
  }
  ctx.restore();
}

const DRAW_E={
  cy_glitch:d_cy_glitch,cy_tank:d_cy_tank,cy_probe:d_cy_probe,cy_sniper:d_cy_sniper,cy_rusher:d_cy_rusher,
  jg_vine:d_jg_vine,jg_beast:d_jg_beast,jg_spore:d_jg_spore,jg_pitcher:d_jg_pitcher,jg_creeper:d_jg_creeper,
  lv_ember:d_lv_ember,lv_golem:d_lv_golem,lv_spark:d_lv_spark,lv_magma:d_lv_magma,lv_eruption:d_lv_eruption,
  ic_shard:d_ic_shard,ic_yeti:d_ic_yeti,ic_wisp:d_ic_wisp,ic_icicle:d_ic_icicle,ic_snowball:d_ic_snowball,
  ds_scarab:d_ds_scarab,ds_mummy:d_ds_mummy,ds_hawk:d_ds_hawk,ds_scorpion:d_ds_scorpion,ds_sandworm:d_ds_sandworm,
  sp_droid:d_sp_droid,sp_mech:d_sp_mech,sp_saucer:d_sp_saucer,sp_turret:d_sp_turret,sp_phantom:d_sp_phantom,
  df_shade:d_df_shade,df_troll:d_df_troll,df_bat:d_df_bat,df_owl:d_df_owl,df_lurker:d_df_lurker,
  tx_slug:d_tx_slug,tx_blob:d_tx_blob,tx_fly:d_tx_fly,tx_venom:d_tx_venom,tx_mutant:d_tx_mutant,
  st_gust:d_st_gust,st_titan:d_st_titan,st_bolt:d_st_bolt,st_rod:d_st_rod,st_cyclone:d_st_cyclone,
  ff_guard:d_ff_guard,ff_demon:d_ff_demon,ff_eye:d_ff_eye,ff_sentinel:d_ff_sentinel,ff_wraith:d_ff_wraith,
  pr_shard:d_pr_shard,pr_guard:d_pr_guard,pr_wisp:d_pr_wisp,pr_beam:d_pr_beam,pr_glitch:d_pr_glitch,
};
// Convert hex+alpha safely
// Safe colour-with-alpha helper that works for both hex (#rrggbb) and hsl(...) strings.
// Returns a CSS rgba() string with the given 0-1 alpha.
function colAlpha(col, a){
  if(!col) return `rgba(0,0,0,${a})`;
  col = col.trim();
  if(col.startsWith('#')){
    let c = col.replace('#','');
    if(c.length===3) c=c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
    const r=parseInt(c.slice(0,2),16),g=parseInt(c.slice(2,4),16),b=parseInt(c.slice(4,6),16);
    return `rgba(${r},${g},${b},${a})`;
  }
  // hsl / rgb — wrap with opacity layer
  if(col.startsWith('hsl')){
    // Convert hsl(h,s%,l%) to rgba via a temp canvas approach isn't available here,
    // so we embed it as-is using the modern hsl syntax with alpha
    return col.replace('hsl(','hsla(').replace(')',`,${a})`);
  }
  return col; // fallback
}

function hexA(col,aa){
  let c=col.replace('#','');
  if(c.length===3)c=c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
  return '#'+c+aa;
}
// Convert any short/long hex to rgba transparent
function hexT(col){
  let c=col.replace('#','');
  if(c.length===3)c=c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
  const r=parseInt(c.slice(0,2),16),g=parseInt(c.slice(2,4),16),b=parseInt(c.slice(4,6),16);
  return `rgba(${r},${g},${b},0)`;
}
function drawBullets(){
  // Skip bullets outside the visible viewport (guest eBullets in particular can
  // dead-reckon far off-screen between sync packets).
  const vLeft=camX-40,vRight=camX+W+40;
  // Cheap additive bloom pass (medium+ quality), then solid cores.
  if(GFX.glow>0 && (pBullets.length||eBullets.length)){
    ctx.save();ctx.globalCompositeOperation='lighter';
    for(const b of pBullets){ if(b.x+b.w<vLeft||b.x>vRight)continue; bloom(b.x+b.w/2,b.y+b.h/2,b.w*1.6,(b.col||CT.mc),0.6); }
    for(const b of eBullets){ if(b.x+b.w<vLeft||b.x>vRight)continue; bloom(b.x+b.w/2,b.y+b.h/2,b.w*1.6,'#f44',0.6); }
    ctx.restore();
  }
  for(const b of pBullets){
    if(b.x+b.w<vLeft||b.x>vRight)continue;
    const cx=b.x+b.w/2,cy=b.y+b.h/2;
    ctx.fillStyle=b.col||CT.mc;
    ctx.beginPath();ctx.ellipse(cx,cy,b.w*.7,b.h*.5,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#fff';
    ctx.beginPath();ctx.arc(cx,cy,b.h*.3,0,Math.PI*2);ctx.fill();
  }
  for(const b of eBullets){
    if(b.x+b.w<vLeft||b.x>vRight)continue;
    const cx=b.x+b.w/2,cy=b.y+b.h/2;
    ctx.fillStyle='#f44';
    ctx.beginPath();ctx.ellipse(cx,cy,b.w*.7,b.h*.5,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#faa';
    ctx.beginPath();ctx.arc(cx,cy,b.h*.3,0,Math.PI*2);ctx.fill();
  }
}
// Elemental armour worn OVER the robot. Deliberately drawn as separate pieces
// with gaps between them so the robot's own body colour still reads through —
// that is the whole point: a fire/ice player should still be recognisably THEIR
// robot (this matters in network games, where colour is identity).
// Coordinates are in the player's local space (drawOnePlayer has already
// translated to p.x,p.y), matching the body plates drawn there.
function _drawElementSuit(p,o){
  const w=p.w,h=p.h,pulse=o.pulse;
  ctx.save();
  // Shoulder pauldrons
  ctx.fillStyle=o.plate;
  ctx.fillRect(-1,h-24,7,9);
  ctx.fillRect(w-6,h-24,7,9);
  ctx.fillStyle=o.edge;
  ctx.fillRect(-1,h-24,7,2);
  ctx.fillRect(w-6,h-24,7,2);
  // Chest core — the one bright, pulsing part
  const cx=w/2,cy=h-17;
  ctx.fillStyle=o.plate;ctx.fillRect(cx-5,cy-4,10,9);
  ctx.fillStyle=o.edge;ctx.fillRect(cx-5,cy-4,10,2);
  ctx.globalAlpha=0.55+pulse*0.45;
  ctx.fillStyle=o.core;ctx.fillRect(cx-3,cy-1,6,4);
  ctx.globalAlpha=1;
  // Gauntlets
  ctx.fillStyle=o.plate;
  ctx.fillRect(0,h-13,5,6);
  ctx.fillRect(w-5,h-13,5,6);
  ctx.fillStyle=o.edge;
  ctx.fillRect(0,h-13,5,1.5);
  ctx.fillRect(w-5,h-13,5,1.5);
  // Helmet crest — a fin over the top of the head, not a repaint of the face
  ctx.fillStyle=o.plate;
  ctx.fillRect(4,h-32,w-8,3);
  ctx.fillStyle=o.edge;
  ctx.beginPath();
  ctx.moveTo(cx-4,h-31);ctx.lineTo(cx,h-38);ctx.lineTo(cx+4,h-31);
  ctx.closePath();ctx.fill();
  // Knee guards
  ctx.fillStyle=o.plate;
  ctx.fillRect(2,h-8,6,3);
  ctx.fillRect(w-8,h-8,6,3);
  // Frost rime along the plate edges (ice only)
  if(o.frost){
    ctx.globalAlpha=0.5+pulse*0.3;
    ctx.fillStyle=o.core;
    ctx.fillRect(-1,h-16,7,1.5);
    ctx.fillRect(w-6,h-16,7,1.5);
    ctx.globalAlpha=1;
  }
  // A soft elemental rim so the suit still reads at a glance
  if(GFX.glow>0){
    ctx.globalAlpha=0.30+pulse*0.20;
    ctx.strokeStyle=o.glow;ctx.lineWidth=1;
    ctx.strokeRect(0.5,h-24.5,w-1,24);
    ctx.globalAlpha=1;
  }
  ctx.restore();
}
function drawOnePlayer(p){
  if(!p)return;
  // Hide the player once they've stepped into the end-of-level building's doorway
  if(exitAnim&&typeof _exitBuildingX==='function'){
    const bx=_exitBuildingX();
    // door spans roughly bx+34 → bx+74; once player's centre is past the door front, they're "inside"
    if(p.x+p.w/2>=bx+24){return;}
  }
  // Star mode: rainbow flicker — show every frame but tinted
  if(p.starMode){
    // Rainbow trail
    for(let i=1;i<p.trail.length;i+=2){
      const t=p.trail[i];
      const hue=(tick*18+i*25)%360;
      ctx.save();ctx.globalAlpha=(1-i/p.trail.length)*.35;
      ctx.fillStyle=`hsl(${hue},100%,60%)`;
      ctx.beginPath();ctx.arc(t.x,t.y,8,0,Math.PI*2);ctx.fill();ctx.restore();
    }
  } else if(p.inv>0&&Math.floor(tick/4)%2===0){return;}
  const isRed=p.colorScheme==='red';
  // Support arbitrary HSL colour objects (network players)
  const _pal=(p.colorScheme&&typeof p.colorScheme==='object')?window.robotPalette(p.colorScheme):null;
  const trailCol=_pal?_pal.visor:isRed?'#f44':CT.mc;
  if(p.blaster&&!p.starMode){for(let i=2;i<p.trail.length;i+=3){const t=p.trail[i];ctx.save();ctx.globalAlpha=(1-i/p.trail.length)*.18;ctx.fillStyle=trailCol;ctx.beginPath();ctx.arc(t.x,t.y,7,0,Math.PI*2);ctx.fill();ctx.restore();}}
  // Boots speed trail
  if(p.boots&&Math.abs(p.vx)>2){for(let i=1;i<p.trail.length;i+=2){const t=p.trail[i];ctx.save();ctx.globalAlpha=(1-i/p.trail.length)*.22;ctx.fillStyle='#0ff';ctx.beginPath();ctx.arc(t.x,t.y,5,0,Math.PI*2);ctx.fill();ctx.restore();}}
  ctx.save();ctx.translate(p.x+p.w/2,p.y+p.h/2);ctx.scale(p.facing,1);ctx.translate(-p.w/2,-p.h/2);
  // ── Weight and life ──────────────────────────────────────────────────────
  // Squash on landing, and a slow breathing sway plus an occasional glance when
  // the player has been standing still. Both are pure transform maths on a
  // sprite that is already being drawn — no extra draw calls, and they are what
  // make the robot read as a body rather than a moving decal.
  if(p.landT>0){
    const sq=(p.landT/12)*(p.landPow||0.5);
    ctx.translate(p.w/2,p.h);
    ctx.scale(1+sq*0.28,1-sq*0.30);
    ctx.translate(-p.w/2,-p.h);
  } else if(p.idleT>90&&!p.respawning){
    const t=(p.idleT-90);
    ctx.translate(p.w/2,p.h);
    ctx.scale(1,1+Math.sin(t*0.045)*0.014);        // breathing
    // Every ~4s: a short lean, as if looking around
    const cyc=t%240;
    if(cyc<34)ctx.rotate(Math.sin(cyc/34*Math.PI)*0.045);
    ctx.translate(-p.w/2,-p.h);
  }
  // Ambient body glow (star/blaster/respawn/boots) — used to be a whole-body
  // ctx.shadowBlur left set across every single body part (legs, torso, arms,
  // head, visor — ~20-30 fills per player per frame), which is the expensive
  // way to blur: cost scales with every shape drawn while it's active, not
  // just the glow itself. A single sprite-based bloom() behind the body gives
  // the same "player is glowing" read for a flat, one-time cost instead.
  if(p.starMode){
    const hue=(tick*12)%360;
    bloom(p.w/2,p.h/2,p.w*0.9,`hsl(${hue},100%,65%)`,0.85);
  } else if(p.blaster){
    bloom(p.w/2,p.h/2,p.w*0.75,trailCol,0.55);
  }
  if(p.respawning){ bloom(p.w/2,p.h/2,p.w*0.85,'#fff',0.6); }
  if(p.boots&&!p.starMode){ bloom(p.w/2,p.h/2,p.w*0.7,'#0ff',0.45); }
  ctx.shadowBlur=0;
  const lk=p.onGnd?Math.sin(p.animFr/4*Math.PI)*4:0;

  // Robot stage drives the body "damage" skin now (lives are shown separately
  // in the HUD): broken → heavy-damage body, normal/powered → pristine body.
  const dmg=p.broken?2:0;

  // Star mode: shift globalAlpha to show rainbow tint overlay after drawing
  const starHue=p.starMode?(tick*14)%360:-1;

  if(_pal){
    // ── NETWORK PLAYER (custom HSL colour, full state support) ──────────────
    const pp=_pal;
    const dmgN=p.broken?2:0;

    // Trails (reuse trailCol from above)
    if(p.blaster&&!p.starMode){for(let i=2;i<p.trail.length;i+=3){const t=p.trail[i];ctx.save();ctx.globalAlpha=(1-i/p.trail.length)*.18;ctx.fillStyle=pp.visor;ctx.beginPath();ctx.arc(t.x-p.x-p.w/2+p.w/2,t.y-p.y-p.h/2+p.h/2,7,0,Math.PI*2);ctx.fill();ctx.restore();}}

    // Body drawn crisp — the ambient glow is already handled by bloom() above.
    ctx.shadowBlur=0;

    // Legs
    ctx.fillStyle=dmgN>=2?pp.dark:pp.mid;
    ctx.fillRect(2,p.h-15,9,15+lk);ctx.fillRect(p.w-11,p.h-15,9,15-lk);
    if(dmgN>=2){ctx.fillStyle='#111';ctx.fillRect(3,p.h-10,3,6);}
    // Feet
    ctx.fillStyle=pp.body;ctx.fillRect(1,p.h-3+lk,11,5);ctx.fillRect(p.w-12,p.h-3-lk,11,5);
    // Torso
    ctx.fillStyle=dmgN>=1?pp.dark:pp.mid;ctx.fillRect(3,p.h-22,p.w-6,11);
    ctx.fillStyle=dmgN>=1?pp.mid:pp.body;ctx.fillRect(5,p.h-20,p.w-10,7);
    if(p.blaster){ctx.fillStyle=withAlpha(pp.visor,'22');ctx.fillRect(5,p.h-20,p.w-10,7);}
    // Scratches on dmg
    if(dmgN>=1){ctx.save();ctx.strokeStyle=pp.bright;ctx.lineWidth=1;ctx.globalAlpha=0.7;ctx.beginPath();ctx.moveTo(7,p.h-21);ctx.lineTo(10,p.h-14);ctx.stroke();ctx.beginPath();ctx.moveTo(13,p.h-20);ctx.lineTo(11,p.h-15);ctx.stroke();ctx.restore();}
    // Arms
    ctx.fillStyle=dmgN>=2?pp.dark:pp.mid;
    ctx.fillRect(-5,p.h-22,8,11);ctx.fillRect(p.w-3,p.h-22,8,11);
    if(dmgN>=2){ctx.save();ctx.fillStyle='#111';ctx.fillRect(-5,p.h-16,8,4);if(Math.floor(tick/5)%3===0){ctx.shadowColor=pp.bright;ctx.shadowBlur=4;ctx.fillStyle=pp.bright;ctx.fillRect(-4,p.h-17,4,3);}ctx.restore();}
    // Blaster arm
    if(p.blaster){ctx.fillStyle=pp.mid;ctx.fillRect(p.w-2,p.h-17,11,6);ctx.shadowColor=pp.visor;ctx.shadowBlur=5;ctx.fillStyle=pp.visor;ctx.fillRect(p.w+7,p.h-16,5,4);ctx.shadowBlur=8;}
    // Head
    ctx.fillStyle=dmgN>=2?pp.dark:pp.mid;ctx.fillRect(3,0,p.w-6,16);
    if(dmgN>=2){ctx.fillStyle='#111';ctx.fillRect(4,0,7,5);}
    // Visor
    ctx.shadowBlur=0;
    ctx.fillStyle=p.blaster?pp.bright:pp.visor;ctx.fillRect(5,3,p.w-10,8);
    if(dmgN>=1){ctx.save();ctx.strokeStyle=pp.glint;ctx.lineWidth=1;ctx.globalAlpha=0.9;ctx.beginPath();ctx.moveTo(6,4);ctx.lineTo(10,9);ctx.moveTo(10,9);ctx.lineTo(8,11);ctx.stroke();ctx.restore();}
    if(dmgN>=2){ctx.save();ctx.strokeStyle=pp.visor;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(14,5);ctx.lineTo(12,11);ctx.stroke();ctx.fillStyle='#000';ctx.globalAlpha=0.5;ctx.fillRect(13,6,4,4);ctx.restore();}
    ctx.fillStyle=p.blaster?'#fff8':pp.glint;ctx.fillRect(6,4,6,4);
    // Antenna
    ctx.fillStyle=pp.antenna;ctx.fillRect(p.w/2-1,0,2,4);ctx.beginPath();ctx.arc(p.w/2,0,2,0,Math.PI*2);ctx.fill();
    // Nickname tag
    if(p.nickname){ctx.save();ctx.fillStyle='#fff';ctx.font='bold 5px monospace';ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillText(p.nickname.slice(0,8),p.w/2,-2);ctx.restore();}
    // Sparks at dmg2
    if(dmgN>=2&&Math.floor(tick/7)%4===0){ctx.save();ctx.shadowColor=pp.bright;ctx.shadowBlur=3;ctx.fillStyle=pp.bright;ctx.fillRect(p.w/2+Math.cos(tick*.4)*6,p.h/2+Math.sin(tick*.4)*5,2,2);ctx.restore();}
  } else if(isRed){
    // ── RED ROBOT (P2) ──────────────────────────────
    // Legs
    ctx.fillStyle=dmg>=2?'#3d0000':'#5a0000';
    ctx.fillRect(2,p.h-15,9,15+lk);ctx.fillRect(p.w-11,p.h-15,9,15-lk);
    // Leg damage: bent/cracked leg at dmg2
    if(dmg>=2){ctx.fillStyle='#220000';ctx.fillRect(3,p.h-10,3,6);}
    // Feet
    ctx.fillStyle='#aa1111';ctx.fillRect(1,p.h-3+lk,11,5);ctx.fillRect(p.w-12,p.h-3-lk,11,5);
    // Torso
    ctx.fillStyle=dmg>=1?'#660000':'#880000';
    ctx.fillRect(3,p.h-22,p.w-6,11);
    ctx.fillStyle=dmg>=1?'#991100':'#bb1100';
    ctx.fillRect(5,p.h-20,p.w-10,7);
    if(p.blaster){ctx.fillStyle='#ff000022';ctx.fillRect(5,p.h-20,p.w-10,7);}
    // Torso scratch marks at dmg1+
    if(dmg>=1){
      ctx.save();ctx.strokeStyle='#ff4422';ctx.lineWidth=1;ctx.globalAlpha=0.7;
      ctx.beginPath();ctx.moveTo(7,p.h-21);ctx.lineTo(10,p.h-14);ctx.stroke();
      ctx.beginPath();ctx.moveTo(13,p.h-20);ctx.lineTo(11,p.h-15);ctx.stroke();
      ctx.restore();
    }
    // Arms
    ctx.fillStyle=dmg>=2?'#440000':'#660000';
    ctx.fillRect(-5,p.h-22,8,11);ctx.fillRect(p.w-3,p.h-22,8,11);
    // Broken arm at dmg2
    if(dmg>=2){
      ctx.save();ctx.fillStyle='#220000';ctx.fillRect(-5,p.h-16,8,4);
      // Spark at broken arm
      if(Math.floor(tick/5)%3===0){ctx.shadowColor='#f84';ctx.shadowBlur=4;ctx.fillStyle='#f84';ctx.fillRect(-4,p.h-17,4,3);}
      ctx.restore();
    }
    if(p.blaster){ctx.fillStyle='#cc2200';ctx.fillRect(p.w-2,p.h-17,11,6);ctx.shadowColor='#f44';ctx.shadowBlur=5;ctx.fillStyle='#f44';ctx.fillRect(p.w+7,p.h-16,5,4);ctx.shadowBlur=8;}
    // Head
    ctx.fillStyle=dmg>=2?'#550000':'#7a0000';
    ctx.fillRect(3,0,p.w-6,16);
    // Head dent at dmg2
    if(dmg>=2){ctx.fillStyle='#330000';ctx.fillRect(4,0,7,5);}
    // Visor
    ctx.fillStyle=p.blaster?'#f44':'#ee3300';ctx.fillRect(5,3,p.w-10,8);
    if(dmg>=1){
      // Cracked visor line
      ctx.save();ctx.strokeStyle='#ff8866';ctx.lineWidth=1;ctx.globalAlpha=0.9;
      ctx.beginPath();ctx.moveTo(6,4);ctx.lineTo(10,9);ctx.moveTo(10,9);ctx.lineTo(8,11);ctx.stroke();
      ctx.restore();
    }
    if(dmg>=2){
      // Second crack + dark patch
      ctx.save();ctx.strokeStyle='#ff4422';ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(14,5);ctx.lineTo(12,11);ctx.stroke();
      ctx.fillStyle='#1a0000';ctx.globalAlpha=0.5;ctx.fillRect(13,6,4,4);
      ctx.restore();
    }
    ctx.fillStyle=p.blaster?'#fff8':'#ffaa88';ctx.fillRect(6,4,6,4);
    ctx.fillStyle='#f44';ctx.fillRect(p.w/2-1,0,2,4);ctx.beginPath();ctx.arc(p.w/2,0,2,0,Math.PI*2);ctx.fill();
    if(twoPlayer){ctx.fillStyle='#faa';ctx.font='bold 5px monospace';ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillText('P2',p.w/2,-2);}
    // Sparks flying at dmg2
    if(dmg>=2&&Math.floor(tick/7)%4===0){
      ctx.save();ctx.shadowColor='#f84';ctx.shadowBlur=3;ctx.fillStyle='#f84';
      ctx.fillRect(p.w/2+Math.cos(tick*.4)*6,p.h/2+Math.sin(tick*.4)*5,2,2);
      ctx.restore();
    }
  } else {
    // ── BLUE ROBOT (P1) ─────────────────────────────
    // Legs
    ctx.fillStyle=dmg>=2?'#001a44':'#00276a';
    ctx.fillRect(2,p.h-15,9,15+lk);ctx.fillRect(p.w-11,p.h-15,9,15-lk);
    // Bent/cracked leg at dmg2
    if(dmg>=2){ctx.fillStyle='#000e22';ctx.fillRect(3,p.h-10,3,6);}
    // Feet
    ctx.fillStyle='#0055bb';ctx.fillRect(1,p.h-3+lk,11,5);ctx.fillRect(p.w-12,p.h-3-lk,11,5);
    // Torso
    ctx.fillStyle=dmg>=1?'#002566':'#003a88';
    ctx.fillRect(3,p.h-22,p.w-6,11);
    ctx.fillStyle=dmg>=1?'#004488':'#0060aa';
    ctx.fillRect(5,p.h-20,p.w-10,7);
    if(p.blaster){ctx.fillStyle=hexA(CT.mc,'22');ctx.fillRect(5,p.h-20,p.w-10,7);}
    // Torso scratch marks at dmg1+
    if(dmg>=1){
      ctx.save();ctx.strokeStyle='#44aaff';ctx.lineWidth=1;ctx.globalAlpha=0.7;
      ctx.beginPath();ctx.moveTo(7,p.h-21);ctx.lineTo(10,p.h-14);ctx.stroke();
      ctx.beginPath();ctx.moveTo(13,p.h-20);ctx.lineTo(11,p.h-15);ctx.stroke();
      ctx.restore();
    }
    // Arms
    ctx.fillStyle=dmg>=2?'#001844':'#002a66';
    ctx.fillRect(-5,p.h-22,8,11);ctx.fillRect(p.w-3,p.h-22,8,11);
    // Broken arm sparking at dmg2
    if(dmg>=2){
      ctx.save();ctx.fillStyle='#000e22';ctx.fillRect(-5,p.h-16,8,4);
      if(Math.floor(tick/5)%3===0){ctx.shadowColor=CT.mc;ctx.shadowBlur=4;ctx.fillStyle=CT.mc;ctx.fillRect(-4,p.h-17,4,3);}
      ctx.restore();
    }
    if(p.blaster){ctx.fillStyle='#0088cc';ctx.fillRect(p.w-2,p.h-17,11,6);ctx.shadowColor=CT.mc;ctx.shadowBlur=5;ctx.fillStyle=CT.mc;ctx.fillRect(p.w+7,p.h-16,5,4);ctx.shadowBlur=8;}
    // Head
    ctx.fillStyle=dmg>=2?'#002266':'#003e88';
    ctx.fillRect(3,0,p.w-6,16);
    // Head dent at dmg2
    if(dmg>=2){ctx.fillStyle='#001133';ctx.fillRect(4,0,7,5);}
    // Visor
    ctx.fillStyle=p.blaster?CT.mc:'#00ccee';ctx.fillRect(5,3,p.w-10,8);
    if(dmg>=1){
      // Cracked visor
      ctx.save();ctx.strokeStyle='#88ddff';ctx.lineWidth=1;ctx.globalAlpha=0.9;
      ctx.beginPath();ctx.moveTo(6,4);ctx.lineTo(10,9);ctx.moveTo(10,9);ctx.lineTo(8,11);ctx.stroke();
      ctx.restore();
    }
    if(dmg>=2){
      // Second crack + dead pixel patch
      ctx.save();ctx.strokeStyle='#0088bb';ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(14,5);ctx.lineTo(12,11);ctx.stroke();
      ctx.fillStyle='#000a11';ctx.globalAlpha=0.55;ctx.fillRect(13,6,4,4);
      ctx.restore();
    }
    ctx.fillStyle=p.blaster?'#fff8':'#88ddf8';ctx.fillRect(6,4,6,4);
    ctx.fillStyle=CT.mc;ctx.fillRect(p.w/2-1,0,2,4);ctx.beginPath();ctx.arc(p.w/2,0,2,0,Math.PI*2);ctx.fill();
    if(twoPlayer){ctx.fillStyle='#adf';ctx.font='bold 5px monospace';ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillText('P1',p.w/2,-2);}
    // Sparks at dmg2
    if(dmg>=2&&Math.floor(tick/7)%4===0){
      ctx.save();ctx.shadowColor=CT.mc;ctx.shadowBlur=3;ctx.fillStyle=CT.mc;
      ctx.fillRect(p.w/2+Math.cos(tick*.4)*6,p.h/2+Math.sin(tick*.4)*5,2,2);
      ctx.restore();
    }
  }

  // ── STAR MODE rainbow overlay ──
  if(starHue>=0){
    ctx.save();
    ctx.globalCompositeOperation='source-atop';
    ctx.globalAlpha=0.45+Math.sin(tick*.18)*.15;
    ctx.fillStyle=`hsl(${starHue},100%,60%)`;
    ctx.fillRect(0,0,p.w,p.h);
    ctx.restore();
    // Spinning stars around the player
    ctx.save();
    ctx.shadowColor=`hsl(${starHue},100%,70%)`;ctx.shadowBlur=6;
    ctx.fillStyle=`hsl(${(starHue+180)%360},100%,70%)`;
    for(let si=0;si<4;si++){
      const sa=(tick*.12+si*Math.PI/2);
      const sx=p.w/2+Math.cos(sa)*20;
      const sy=p.h/2+Math.sin(sa)*16;
      dStar(ctx,sx,sy,5,6,3);ctx.fill();
    }
    ctx.restore();
  }

  // ── FIRE скин ──
  // The robot used to be repainted solid orange with a source-atop fill, which
  // threw away its own colour entirely — in a network game every player turned
  // into the same orange blob. Instead it now puts ON a suit: pauldrons, a
  // chest core, gauntlets and a helmet crest, leaving the body underneath (blue,
  // red, or whatever colour the player picked) clearly visible between them.
  if(p.fireMode){
    _drawElementSuit(p,{
      plate:'#c23a05',  edge:'#ff8a2a', core:'#ffd166', glow:'#ff4400',
      pulse:0.5+Math.sin(tick*.18)*0.5,
    });
    // Языки огня над головой
    ctx.save();ctx.shadowColor='#ff4400';ctx.shadowBlur=4;
    for(let fi=0;fi<4;fi++){
      const fa=fi/4*p.w+3;
      const fh=5+Math.sin(tick*.18+fi)*.4*4;
      ctx.fillStyle=`hsl(${20+fi*10},100%,${55+fi*5}%)`;
      ctx.beginPath();ctx.moveTo(fa,2);ctx.quadraticCurveTo(fa-3,-fh,fa+2,-(fh+2));ctx.quadraticCurveTo(fa+5,-fh,fa+4,2);ctx.fill();
    }
    // Орбиты
    for(let oi=0;oi<3;oi++){
      const oa=tick*.13+oi*(Math.PI*2/3);
      ctx.globalAlpha=0.8;ctx.fillStyle=`hsl(${30+oi*15},100%,60%)`;
      ctx.beginPath();ctx.arc(p.w/2+Math.cos(oa)*16,p.h/2+Math.sin(oa)*10,3,0,Math.PI*2);ctx.fill();
    }
    ctx.restore();
  }
  // ── ICE скин ── (same idea as the fire suit above)
  if(p.iceMode){
    _drawElementSuit(p,{
      plate:'#0d5f8c',  edge:'#7fe6ff', core:'#dffaff', glow:'#00ffff',
      pulse:0.5+Math.sin(tick*.13)*0.5, frost:true,
    });
    // Кристаллы вокруг
    ctx.save();ctx.shadowColor='#00ffff';ctx.shadowBlur=4;
    for(let ci=0;ci<4;ci++){
      const ca=tick*(-.09)+ci*(Math.PI/2);
      ctx.save();ctx.translate(p.w/2+Math.cos(ca)*17,p.h/2+Math.sin(ca)*11);ctx.rotate(tick*.13+ci);
      ctx.strokeStyle='#aaffff';ctx.lineWidth=1.5;
      for(let arm=0;arm<3;arm++){const aa=arm/3*Math.PI;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(Math.cos(aa)*4,Math.sin(aa)*4);ctx.stroke();ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(-Math.cos(aa)*4,-Math.sin(aa)*4);ctx.stroke();}
      ctx.restore();
    }
    ctx.restore();
  }
  // ── BOOTS cyan sole flash ──
  if(p.boots&&p.onGnd&&Math.floor(tick/6)%2===0){
    ctx.save();ctx.globalAlpha=0.55;ctx.fillStyle='#0ff';
    ctx.shadowColor='#0ff';ctx.shadowBlur=5;
    ctx.fillRect(1,p.h-4,10,4);ctx.fillRect(p.w-11,p.h-4,10,4);
    ctx.restore();
  }

  ctx.restore();
}
function drawPlayer(){
  if(player)drawOnePlayer(player);
  if(twoPlayer&&player2)drawOnePlayer(player2);
}
// Reused across frames (bug #20): allocating a fresh {} grouping object every
// frame in drawParticles added needless GC churn. Cleared in place instead.
const _byColCache = {};
function drawParticles(){
  // Группируем частицы по цвету для batch рендера
  // Off-screen particles are invisible, so skip grouping/drawing them entirely.
  if(_particleAliveCount<=0)return;
  const vLeft=camX-30,vRight=camX+W+30;
  for(const k in _byColCache) delete _byColCache[k];
  const byCol = _byColCache;
  const texts = [];
  for(const p of particles){
    if(!p.alive)continue;
    if(p.x<vLeft||p.x>vRight)continue;
    if(p.txt){texts.push(p);continue;}
    if(!byCol[p.col])byCol[p.col]=[];
    byCol[p.col].push(p);
  }
  // Particles rendered in two passes: cheap additive bloom (medium+ quality) then solid core.
  if(GFX.glow>0){
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    for(const col in byCol){
      const s=_glowSprite(col);
      for(const p of byCol[col]){
        const sz=p.sz*p.life*4*GFX.glow;
        ctx.globalAlpha=p.life*0.5;
        ctx.drawImage(s.canvas, p.x-sz/2, p.y-sz/2, sz, sz);
      }
    }
    ctx.restore();
  }
  for(const col in byCol){
    ctx.fillStyle=col;
    for(const p of byCol[col]){
      ctx.globalAlpha=p.life;
      ctx.beginPath();ctx.arc(p.x,p.y,p.sz*p.life,0,Math.PI*2);ctx.fill();
    }
  }
  // Float-up text labels (no per-glyph shadowBlur — cheap solid text).
  //
  // The ctx.font assignment below used to run unconditionally, every frame,
  // even when there was not a single floating label on screen. Assigning a
  // web-font shorthand to a canvas forces font matching/shaping setup, and it
  // measured at 2.3 ms of a 3.3 ms frame — by far the most expensive single
  // line in the renderer. Guarding it on `texts.length` costs nothing and makes
  // it free on the ~95% of frames that have no labels.
  if(texts.length){
    ctx.font="bold 7px 'Press Start 2P',monospace";ctx.textAlign='center';ctx.textBaseline='middle';
    for(const p of texts){
      ctx.globalAlpha=p.life;ctx.fillStyle=p.col;
      ctx.fillText(p.txt,p.x,p.y);
    }
  }
  ctx.shadowBlur=0;
  ctx.globalAlpha=1;
}
// The world-name watermark is one string of 40px pixel-font text, but laying it
// out and rasterising it every single frame cost up to 0.6 ms — more than the
// entire parallax background. It only changes when the world or the language
// changes, so it is baked into an offscreen canvas and blitted.
let _wmCanvas=null,_wmKey='';
// Название мира: было постоянной подложкой во весь экран на 8% прозрачности.
// Пока фон Кибергорода был тёмным месивом, надпись в нём терялась; на новом,
// чистом небе она читается как забытый поверх картинки слой — игрок так её и
// описал: «почему я всё ещё вижу старый слой какой-то?!». Смысл у надписи есть
// (сказать, куда игрок попал), но только в первые секунды уровня — дальше она
// просто мешает смотреть. Поэтому теперь она показывается и уходит.
const _WM_HOLD=110, _WM_FADE=70;   // кадров держим, кадров растворяем
function drawWatermark(){
  if(!advMode)return;
  if(tick>_WM_HOLD+_WM_FADE)return;
  const fade=tick<=_WM_HOLD?1:1-(tick-_WM_HOLD)/_WM_FADE;
  const txt=worldName(CT);
  const key=txt+'|'+CT.mc;
  if(_wmKey!==key){
    const dpr=Math.min(2,(window.devicePixelRatio||1));
    const cv=document.createElement('canvas');
    cv.width=Math.ceil(W*dpr);cv.height=Math.ceil(70*dpr);
    const c=cv.getContext('2d');
    c.scale(dpr,dpr);
    c.font="bold 40px 'Press Start 2P',monospace";c.textAlign='center';c.textBaseline='middle';
    c.fillStyle=CT.mc;c.fillText(txt,W/2,35);
    _wmCanvas=cv;_wmKey=key;
  }
  ctx.save();ctx.globalAlpha=.14*fade;
  ctx.drawImage(_wmCanvas,0,H/2-35,W,70);
  ctx.restore();
}
function drawLevelClear(){
  ctx.save();
  // Soft vignette instead of a flat full-screen tint — a solid 42% fill of the
  // world's theme colour (e.g. Desert Ruins' sandy '#eebb66') washed out the
  // whole screen so hard it read as "everything turns yellow" rather than a
  // celebratory accent. Center stays clear/readable; colour only builds up
  // toward the edges.
  const cx=W/2, cy=H/2, rIn=Math.min(W,H)*0.28, rOut=Math.max(W,H)*0.75;
  const g=ctx.createRadialGradient(cx,cy,rIn,cx,cy,rOut);
  g.addColorStop(0,'rgba(0,0,0,0)');
  g.addColorStop(1,CT.clr);
  ctx.globalAlpha=.55;ctx.fillStyle=g;ctx.fillRect(0,0,W,H);ctx.globalAlpha=1;
  ctx.fillStyle='#fff';ctx.shadowColor=CT.clr;ctx.shadowBlur=35;
  ctx.font="bold 15px 'Press Start 2P',monospace";ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText(T('levelClear',advMode?advLevel:level),W/2,H/2-12);
  ctx.font="bold 9px 'Press Start 2P',monospace";ctx.fillText(T('timeBonus',Math.floor(timeLeft)*2),W/2,H/2+10);
  ctx.restore();
}
// Respawn indicator circle on spawn point
function drawSpawnMarker(){
  if(!player||player.inv<=20||!player.respawning)return;
  const mx=player.lastGndX,my=player.lastGndY;
  ctx.save();ctx.globalAlpha=(player.respawnTimer/120)*.4;
  ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.setLineDash([4,4]);
  ctx.beginPath();ctx.arc(mx+player.w/2-camX,my+player.h/2,22,0,Math.PI*2);ctx.stroke();
  ctx.setLineDash([]);ctx.restore();
}

function draw(){
  // Establish the HiDPI base transform every frame so all W/H drawing renders at
  // native backing-store resolution (crisp). draw() is balanced (save/restore),
  // so setting it here is safe; _resetCanvasState() resets to identity between
  // levels and the next draw() re-applies this.
  ctx.setTransform(_renderScale,0,0,_renderScale,0,0);
  const shakeEnabled=(window.gameSettings&&window.gameSettings.screenShake!==false);
  const shakeMul=shakeEnabled?((window.gameSettings&&typeof window.gameSettings.shakeIntensity==='number')?window.gameSettings.shakeIntensity/100:1):0;
  const sx=shakeMul>0&&camShake>.5?(Math.random()-.5)*camShake*shakeMul:0;
  const sy=shakeMul>0&&camShake>.5?(Math.random()-.5)*camShake*.4*shakeMul:0;
  const camYOffset=window.camY||0;
  // Mobile view zoom — magnifies the WORLD (background included) while leaving
  // the HUD and overlays alone. Returns 1 on desktop, so this whole block is a
  // no-op there. Zooming in means the 0..W×0..H scene is drawn LARGER than the
  // canvas, so it always covers it — no gaps at the edges.
  const _z=_viewZoom();
  if(_z>1){
    _updateViewFocus(_z);
    ctx.save();
    ctx.translate(W/2,H/2); ctx.scale(_z,_z); ctx.translate(-_vzX,-_vzY);
  }
  drawBG();drawGrid();drawWatermark();
  drawDecors();
  // В бонус-комнате гасим фон мира: комната достроена к тому же уровню, и без
  // этого за монетами виден тот же город с той же надписью — «отдельное место»
  // не читается. Приглушаем только фон, геометрия рисуется поверх.
  if(inBonusRoom()){
    ctx.save();
    ctx.fillStyle='rgba(2,4,14,0.72)';ctx.fillRect(0,0,W,H);
    // Тёплое свечение из центра — комната должна читаться как сокровищница.
    const gl=ctx.createRadialGradient(W/2,H*0.62,0,W/2,H*0.62,Math.max(W,H)*0.6);
    gl.addColorStop(0,'rgba(255,210,74,0.12)');
    gl.addColorStop(1,'rgba(255,210,74,0)');
    ctx.fillStyle=gl;ctx.fillRect(0,0,W,H);
    ctx.restore();
  }
  ctx.save();ctx.translate(-camX+sx,sy+camYOffset);
  drawSpotlights();drawPlatforms();drawBlocks();drawCoins();drawJumpPads();drawHazards();drawDataShards();drawRainbowItem();drawMazeKeys();drawDoors();drawPUs();drawCheckpoints();drawExitBuilding();drawFlag();drawBossApproach();
  drawBoss();
  // Призрак рисуется ПОД живыми: он справочный, и перекрывать им игрока или
  // врага нельзя — по ним принимают решения, по нему нет.
  if(window.Ghost)window.Ghost.draw(ctx);
  drawEnemies();drawFireIceBalls();drawBullets();drawPlayer();drawParticles();
  if(window.Juice)window.Juice.drawWorld(ctx);
  if(window.Status){for(const q of activePlayers())Status.drawOnPlayer(ctx,q);}
  ctx.restore();
  // Darkness is a world-space mask (light holes follow entities), so it belongs
  // INSIDE the zoom transform — composited after it, the holes would sit where
  // the unzoomed entities used to be.
  if(levelMods.darkness&&player){
    drawDarknessOverlay();
  }
  if(_z>1)ctx.restore();   // end mobile view zoom — everything below is screen-space
  // Летящая добыча и счётчик комбо живут в экранных координатах: монета
  // должна лететь к цифре в HUD, а она к миру не привязана.
  if(window.Juice&&gState==='playing')window.Juice.drawScreen(ctx,W,H);
  drawBonusRoomUi();
  // Screen-edge tint in the effect's colour. Deliberately a vignette rather
  // than a full-screen wash, which buried the level art and made the fire/ice
  // suit unreadable.
  if(window.Status&&player)Status.drawVignette(ctx,player,W,H);

  // (Darkness modifier is drawn above, inside the zoom transform — see there for
  // why: the mask is built on a separate transparent canvas, soft light holes are
  // punched around every light source, then it is composited on top.)

  drawBossHUD();
  drawSpawnMarker();
  drawTimerBar();
  if(gState==='levelclear')drawLevelClear();
  if(gState==='paused'){ctx.save();ctx.globalAlpha=.52;ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);ctx.restore();}
}

// ════════════════════════════════════════════════
//  MAIN LOOP
// ════════════════════════════════════════════════
function update(){
  tick++;
  if(window.Juice)window.Juice.update();
  if(gState==='playing'){
    updatePlatforms();updateSpotlights();updateMazeKeys();updateHazards();updatePlayer();updatePlayer2();updateBoss();updateEnemies();updateBullets();updateFireIceBalls();updatePUs();updateParticles();updateDataShards();updateRainbowItem();updateTimer();updateExit();
    // Призрак: пишем свой путь и продвигаем чужой. Ни на что в мире не влияет.
    if(window.Ghost){window.Ghost.record(player);window.Ghost.step();}
    // Camera tracks average of alive players — runs in the main loop so it keeps
    // Network: each client tracks only their own player.
    // Local: camera tracks average of all active players.
    // Boss levels: the camera auto-scrolls left→right on its own instead of
    // following the player — a slow, unstoppable advance toward the arena.
    // Falling behind its left edge is fatal; reaching the arena's far edge
    // turns the camera into a hard wall the player can't push past.
    const _bossAutoScroll = !!boss && !!(window.gameSettings && window.gameSettings.bossAutoScrollCamera);
    if(_bossAutoScroll){
      const _camMax=Math.max(0,worldW-W);
      if(camX<_camMax){
        camX+=BOSS_CAM_SPEED;
        if(camX>_camMax)camX=_camMax;
      }
      window.camY=0;
      // Anyone who falls off the left edge of the camera is left behind for good.
      // Выбывший из сетевой комнаты под это не попадает: он уже замер на месте и
      // каждый кадр «отставал» бы от камеры, теряя жизни в минус.
      if(player&&!player.respawning&&!player._netDone&&player.x+player.w<camX-4)doHurtPlayer(true);
      if(twoPlayer&&player2&&!player2.respawning&&player2.x+player2.w<camX-4)doHurtPlayer2(true);
    } else {
      // Режим наблюдателя: выбывший смотрит за живым игроком, и камера обязана
      // вести именно его — иначе экран остался бы на замершем месте гибели.
      // Наблюдение только когда мы действительно вне уровня. Одного
      // netSpectateObj мало: он мог остаться от прошлого уровня, и камера
      // уезжала к чужому игроку, пока свой был жив и играл.
      const _spec = (window.netActive && window.netSpectating
                     && player && player._netDone) ? window.netSpectateObj : null;
      const aps = _spec ? [_spec]
                        : (window.netActive ? (player ? [player] : []) : activePlayers());
      if(aps.length){
        const trackX=aps.reduce((s,q)=>s+q.x,0)/aps.length;
        // Взгляд по ходу движения: видно, куда летишь, а не откуда.
        const _lead=window.Juice?window.Juice.camLead(aps[0]&&aps[0].vx):0;
        camX+=(trackX+_lead-W*.38-camX)*.1;camX=Math.max(0,Math.min(camX,worldW-W));
        window.camY=0;
      }
    }
    camShake*=.82;
  } else if(gState==='levelclear'||gState==='paused'){
    updatePlatforms();updateParticles();
    if(gState==='levelclear')updateExit();
  }
}
// Advance fixed-timestep game logic up to the current wall-clock time. Shared by
// the rendered loop() and the background ticker (_bgTick) so logic keeps running
// at 60 Hz even when requestAnimationFrame is throttled (host tab hidden). It is
// safe to call from both: the accumulator is wall-clock based, so a redundant
// call in the same instant simply finds dt≈0 and does no steps.
function _advanceLogic(maxClamp){
  const now=performance.now();
  let dt=now-_lastLoopT;_lastLoopT=now;
  if(dt<0)dt=0;
  if(dt>(maxClamp||250))dt=maxClamp||250; // clamp after a stall — no spiral of death
  // Замирание кадра и замедление меняют темп ЛОГИКИ, но не отрисовки: если
  // остановить и её, удар прочитается как подвисание, а не как вес. В сетевой
  // игре не применяется — логику комнаты ведёт хост (см. juice.js).
  if(window.Juice)dt=window.Juice.scaleTime(dt);
  _logicAcc+=dt;
  let steps=0;
  while(_logicAcc>=LOGIC_STEP&&steps<5){
    try{ update(); }
    catch(e){
      // A single bad frame must never permanently kill the whole game loop —
      // without this, one thrown error inside update() (anywhere: player,
      // enemies, boss, particles...) stopped requestAnimationFrame from ever
      // being scheduled again, silently freezing all game LOGIC while input
      // still felt "alive" and the last rendered frame stayed on screen.
      // Logging keeps it visible during testing instead of failing silently.
      console.error('[update] uncaught error, skipping this logic step:', e);
    }
    _logicAcc-=LOGIC_STEP;steps++;
  }
  if(steps>=5)_logicAcc=0;
  return steps;
}
function loop(){
  // Сторож отрисовки заводится с первым же кадром игры и живёт дальше сам —
  // так он покрывает все точки запуска цикла, а не только ту, откуда пришли.
  // Повторные вызовы отсекает сам сторож, поэтому здесь просто зовём его.
  if(typeof startDrawWatchdog==='function')startDrawWatchdog();
  // Optional FPS limiter (provided by settings.js). Skips work but keeps one RAF chain.
  if(typeof window._fpsShouldSkip==='function'&&window._fpsShouldSkip()){raf=requestAnimationFrame(loop);return;}
  if(typeof window._fpsTick==='function')window._fpsTick();
  // Fixed-timestep logic, variable-rate render. Game logic always advances at
  // 60 Hz regardless of how often we render. The render is vsync-capped (see
  // main.js) so draw() runs at the display rate (~60 Hz) instead of unbounded.
  // We may run 0..N update() steps per rendered frame.
  _advanceLogic(250);
  _stepAnimClock();   // сколько времени прошло с прошлой отрисовки — см. _animK
  // Guard render: a single bad frame (e.g. a non-finite canvas value) must never
  // tear down the rAF chain — that would freeze the game outright, and on a network
  // host it freezes the entire room. Log and keep the loop alive.
  try{ draw();updateHUD(); }
  catch(e){ try{console.error('[loop] draw error:',e);}catch(_){} }
  raf=requestAnimationFrame(loop);
}
// Fixed-timestep state for loop() above.
let _lastLoopT=performance.now(),_logicAcc=0;
const LOGIC_STEP=1000/60;

/* ── Скорость анимаций, которые живут в отрисовке ───────────────────────────
   Логика игры давно идёт фиксированными шагами по 1/60 секунды и от частоты
   кадров не зависит. А вот несколько мелких анимаций — покачивание монет,
   пульс пружин, свечение чекпоинта — двигались прямо в draw(), на каждый
   нарисованный кадр. На мониторе 165 Гц они шли в два с половиной раза
   быстрее положенного.

   Переносить их в логику нельзя без потери вида: анимируются только те
   объекты, что сейчас на экране, и появившийся из-за края предмет должен
   входить со «своей» фазой, а не в общем строю. Поэтому шаг не убран, а
   измерен: _animK — сколько шестидесятых долей секунды прошло с прошлой
   отрисовки. При 60 кадрах это ровно 1, и всё выглядит как раньше. */
let _animK=1,_lastDrawT=performance.now();
function _stepAnimClock(){
  const now=performance.now();
  // Потолок в четыре шага: после сворачивания окна или загрузки уровня пауза
  // может быть в секунды, и без ограничителя анимация прыгнула бы вперёд.
  _animK=Math.min(4,Math.max(0,(now-_lastDrawT)/LOGIC_STEP));
  _lastDrawT=now;
}
window.BB_animK=()=>_animK;

// ════════════════════════════════════════════════
//  BACKGROUND TICKER (anti-freeze for network host)
// ════════════════════════════════════════════════
// Browsers throttle/stop requestAnimationFrame in hidden tabs and pause it while
// a blocking dialog is open. For a network HOST that froze the whole room (enemy
// AI lives in the host's loop), so we drive logic from a Web Worker timer, which
// keeps firing in the background. We only step logic here — no draw — and only
// when rAF is actually stalled, so the foreground path stays the single source of
// truth whenever the tab is visible.
let _bgWorker=null, _bgRAFSeen=0, _bgIntervalFallback=0;
function _bgTick(){
  // Skip if a render frame ran very recently — rAF is alive, nothing to rescue.
  if(performance.now()-_bgRAFSeen < 120) return;
  // Only matters for an active network game (offline play may pause in background).
  if(!window.netActive) return;
  if(gState!=='playing'&&gState!=='levelclear'&&gState!=='paused') return;
  _advanceLogic(120); // logic only — no draw/HUD; clamp tighter so we never burst
  // Pump the network state broadcast too: its own 20 Hz interval is throttled to
  // ~1 Hz in a hidden tab, so without this the host's snapshots would lag badly.
  if(typeof window.netStateTick==='function') window.netStateTick();
}
/* ── Сторож отрисовки ──────────────────────────────────────────────────────
   Отдельная история от тикера выше: тот спасает ЛОГИКУ сетевой комнаты, а этот
   спасает КАРТИНКУ в любой игре, включая одиночную.

   Откуда берётся чёрный экран на телефоне. Экран поражения гасит цепочку
   кадров (`cancelAnimationFrame` в showGameover), и пока он открыт, rAF не
   работает вовсе. На телефоне в этот момент игру обычно сворачивают — прочесть
   сообщение, ответить на звонок. Android после возврата отдаёт кадры не сразу,
   и если игрок жмёт «Заново» в эту паузу, loop() успевает очистить холст
   (_resetCanvasState) и записаться в очередь rAF, а первый кадр не приходит:
   цепочка не стартует, а холст уже чистый — то есть чёрный.

   Сторож это ловит: раз в секунду смотрит, идёт ли игра и давно ли рисовался
   настоящий кадр. Если игра идёт, а кадров нет дольше секунды — перезапускает
   цикл. Когда rAF жив, проверка выходит на первой строке и не стоит ничего. */
let _drawWatchdog=0;
function _watchdogTick(){
  if(gState!=='playing'&&gState!=='levelclear'&&gState!=='paused') return;
  if(document.hidden) return;                 // свёрнутое окно и должно стоять
  if(performance.now()-_bgRAFSeen < 1000) return;
  // Кадров нет секунду при живой игре — цепочка оборвалась. Заводим заново.
  try{ if(raf) cancelAnimationFrame(raf); }catch(e){}
  raf=0;
  _bgRAFSeen=performance.now();               // чтобы не перезапускать каждую секунду
  try{ loop(); }catch(e){ try{console.error('[watchdog] loop restart failed:',e);}catch(_){} }
}
function startDrawWatchdog(){
  if(_drawWatchdog) return;
  _drawWatchdog=setInterval(_watchdogTick,1000);
  // Возврат из фона — самый частый случай: проверяем сразу, не ожидая секунды.
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden) setTimeout(_watchdogTick,250);
  });
}
window.startDrawWatchdog=startDrawWatchdog;

function startBgTicker(){
  if(_bgWorker||_bgIntervalFallback) return;
  try{
    // Inline worker: a bare interval that posts a tick. Worker timers are NOT
    // throttled the way main-thread rAF/timers are when the tab is hidden.
    const src='let h=0;onmessage=e=>{if(e.data===\'stop\'){clearInterval(h);h=0;return;}'+
              'if(!h)h=setInterval(()=>postMessage(0),16);};';
    const blob=new Blob([src],{type:'application/javascript'});
    _bgWorker=new Worker(URL.createObjectURL(blob));
    _bgWorker.onmessage=_bgTick;
    _bgWorker.postMessage('start');
  }catch(e){
    // No Worker support (rare) — fall back to a main-thread interval. Hidden tabs
    // throttle this to ~1 Hz, but that still beats a fully frozen room.
    _bgIntervalFallback=setInterval(_bgTick,16);
  }
}
function stopBgTicker(){
  if(_bgWorker){ try{_bgWorker.postMessage('stop');_bgWorker.terminate();}catch(e){} _bgWorker=null; }
  if(_bgIntervalFallback){ clearInterval(_bgIntervalFallback); _bgIntervalFallback=0; }
}
window.startBgTicker=startBgTicker;
window.stopBgTicker=stopBgTicker;
// Mark each real render frame so _bgTick can tell whether rAF is alive.
(function(){
  const _origLoop=loop;
  loop=function(){ _bgRAFSeen=performance.now(); return _origLoop.apply(this,arguments); };
})();

// ── Fix drone y base — now set inline in mkEnemy ─
function fixDrones(){} // no-op, kept for compat
// Call fixDrones after genLevel in startInf and startAdv — patch the start functions
const _si=startInf,_sa=startAdv;
// Re-patch start functions to call fixDrones
function initP2(){
  if(!twoPlayer)return;
  lives2=infiniteLives?99:(hardMode?2:3);
  player2=mkPlayer(spawnX+36,spawnY,'red');
}
function patchedStartInf(fresh=true){
  if(fresh){score=0;lives=3;level=1;coinsTotal=0;_coinsHpStep=0;}
  dailyMode=false;dailySlot=null;   // бесконечный режим — не день
  advMode=false;CT=THEMES[Math.min(Math.floor((level-1)/10),9)];
  _levelDied=false;
  AchTrack.infinite(level);AchTrack.score(score);
  player=mkPlayer();
  const diff=Math.min(Math.floor((level-1)/5)+1,14);
  // Network: use the room's shared seed so every client generates an identical
  // level (same platforms + enemies in the same order → index-based sync works).
  const _infRng=(window.netActive&&window._netSeed)?mkRNG((window._netSeed>>>0)+level*7919):()=>Math.random();
  genLevel(diff,_infRng,null);fixDrones();
  player.x=spawnX;player.y=spawnY;
  player.lastGndX=spawnX;player.lastGndY=spawnY;
  initP2();
  timeLeft=lvlTime(level)*1.5;timMax=timeLeft;
  hideAll();gState='playing';navScr='game';tick=0;
  document.getElementById('ui').style.display='flex';
  if(typeof _resetCanvasState==='function')_resetCanvasState();
  updModeLabel();
  showModBanner();
  if(boss){showBossIntro(boss);}else{startGameMusic();}
  if(raf)cancelAnimationFrame(raf);loop();
}
// NOTE: this definition is later overridden by the wrapped version near the
// cutscene engine (search "Wrap patchedStartAdv" → _doRunLevel). The live
// checkpoint-resume logic lives in _doRunLevel; keep this in sync but know it
// does not run at runtime.
function patchedStartAdv(n,freshLives=false){
  // В хардкоре запас общий на весь мир и переносится между уровнями;
  // в обычном режиме — свой на каждый заход.
  if(hardMode&&advMode){
    _hardEnterWorld(n);
    if(freshLives)cpSave=null;
    lives=hardWorldLives;
  } else if(freshLives){lives=3;cpSave=null;}
  if(freshLives&&n===1){coinsTotal=0;_coinsHpStep=0;}
  if(infiniteLives)lives=99;
  advMode=true;advLevel=n;CT=THEMES[Math.floor((n-1)/10)];level=n;
  player=mkPlayer();
  const diff=Math.min(Math.floor((n-1)/6)+1,14);
  genLevel(diff,mkRNG(n*9001+12345),n);fixDrones();
  player.x=spawnX;player.y=spawnY;
  player.lastGndX=spawnX;player.lastGndY=spawnY;
  if(cpSave&&cpSave.lvl===n&&checkpoints.length){
    const cp=checkpoints[0];
    cp.taken=true;cp.color=cpSave.color||'#4af';
    spawnX=Math.round(cp.x+cp.w/2-player.w/2);spawnY=cp.baseY-player.h;
    player.x=spawnX;player.y=spawnY;player.lastGndX=spawnX;player.lastGndY=spawnY;
    player.cpX=spawnX;player.cpY=spawnY;
    _restoreCpWorld();
  }
  initP2();
  timeLeft=lvlTime(n);timMax=timeLeft;
  hideAll();gState='playing';navScr='game';tick=0;
  document.getElementById('ui').style.display='flex';
  updModeLabel();
  showModBanner();
  if(boss){showBossIntro(boss);}else{startGameMusic();}
  if(raf)cancelAnimationFrame(raf);loop();
}
// Replace references
document.getElementById('infCard').onclick=function(){
  if(window.Demo&&window.Demo.on){window.Demo.refuse(this);return;}
  if(advProg.done.length<100){
    SFX.back();
    const need=100-advProg.done.length;
    const el=document.getElementById('infCard');
    const msg=document.createElement('div');
    msg.style.cssText='position:absolute;bottom:-26px;left:50%;transform:translateX(-50%);font-family:"Share Tech Mono",monospace;font-size:calc(7px * var(--bbText, 1));color:#f80;white-space:nowrap;pointer-events:none;';
    msg.textContent=T('completeMore',need);
    el.style.position='relative';el.appendChild(msg);
    setTimeout(()=>msg.remove(),1800);
    return;
  }
  initAudio();SFX.menu();advMode=false;CT=THEMES[0];
  // A run left in progress is offered back before anything is generated; with
  // no saved run this starts a fresh one immediately (see assets/infsave.js).
  if(window.InfSave)window.InfSave.open();
  else patchedStartInf(true);
};
function startInf(fresh){patchedStartInf(fresh===undefined?true:fresh);}
function startAdv(n,f){patchedStartAdv(n,f===undefined?false:f);}


// ╔══════════════════════════════════════════════╗
// ║  CUTSCENE ENGINE  v3                         ║
// ╚══════════════════════════════════════════════╝

// ── Portrait renderer ──────────────────────────
// The UNIT-7 portrait is painted in a fixed cyan/blue. Rather than duplicating
// the whole sprite for every robot colour, it is drawn once and hue-rotated —
// the shading and silhouette survive, only the hue moves. Base hue of the
// portrait's blue is ~205°.
var _CS_PORTRAIT_BASE_HUE=205;
function _csActorColour(){
  if(!_csActor||!_csActor.color)return '#0ff';
  var c=_csActor.color;
  if(typeof c==='object'&&c.h!=null)return 'hsl('+c.h+','+(c.s!=null?c.s:85)+'%,'+(c.l!=null?c.l:55)+'%)';
  return String(c);
}
function _csActorHueShift(){
  if(!_csActor||!_csActor.color)return 0;
  var c=_csActor.color;
  if(typeof c==='object'&&c.h!=null)return Math.round(c.h-_CS_PORTRAIT_BASE_HUE);
  return 0;
}
function csDrawPortrait(cvId, who, dim){
  var cv=document.getElementById(cvId);
  if(!cv)return;
  var c=cv.getContext('2d'), w=cv.width, h=cv.height;
  c.setTransform(1,0,0,1,0,0);
  c.filter='none';
  c.clearRect(0,0,w,h);
  if(!who)return;
  // Hue shifts are applied AFTER the clear (a filter set before it is wiped by
  // the reset above) and stay in effect for the whole portrait.
  //   • UNIT-8 is UNIT-7's own design rebuilt by NEXUM — literally the same
  //     body, repainted. Drawing him as a hue-rotated UNIT-7 is not a shortcut,
  //     it is the point.
  //   • A network player cast as UNIT-7 gets their own robot colour.
  var hueShift=0, extraSat='';
  if(who==='unit8'){ who='unit7'; hueShift=155; extraSat=' saturate(1.25)'; }
  else if(who==='unit7'&&_csActor){ hueShift=_csActorHueShift(); }
  if(hueShift)c.filter='hue-rotate('+hueShift+'deg)'+extraSat;
  c.save();
  if(dim)c.globalAlpha=0.28;
  if(who==='prism'){
    // Six UNIT silhouettes fused into one refracted body. Deliberately built
    // from the same proportions as UNIT-7's portrait — they are the same model,
    // six versions back — but split into overlapping spectral copies that never
    // quite line up.
    var t=(typeof tick==='number')?tick:0;
    for(var g=5;g>=0;g--){
      var hue=(t*1.4+g*60)%360;
      var off=(g-2.5)*3.2+Math.sin(t*0.03+g)*2.2;
      c.save();
      c.globalAlpha=(dim?0.10:0.30)-(g*0.012);
      c.fillStyle='hsl('+hue+',95%,60%)';
      c.translate(off,Math.cos(t*0.025+g)*2);
      c.fillRect(w*.30,h*.72,w*.16,h*.28);c.fillRect(w*.54,h*.72,w*.16,h*.28); // legs
      c.fillRect(w*.20,h*.43,w*.60,h*.31);                                     // torso
      c.fillRect(w*.04,h*.43,w*.17,h*.28);c.fillRect(w*.79,h*.43,w*.17,h*.28); // arms
      c.fillRect(w*.22,h*.12,w*.56,h*.27);                                     // head
      c.restore();
    }
    // A single bright visor holding all six together
    c.globalAlpha=dim?0.35:1;
    c.shadowColor='#fff';c.shadowBlur=18;
    c.fillStyle='#ffffff';
    c.fillRect(w*.28,h*.20,w*.44,h*.07);
    c.shadowBlur=0;
    // Fracture lines across the body
    c.globalAlpha=dim?0.15:0.45;
    c.strokeStyle='#ffffff';c.lineWidth=1;
    c.beginPath();
    for(var f=0;f<5;f++){
      var fy=h*(0.30+f*0.14);
      c.moveTo(w*0.12,fy);c.lineTo(w*0.88,fy+Math.sin(t*0.04+f)*4);
    }
    c.stroke();
    c.restore();
    c.filter='none';
    return;
  }
  if(who==='unit7'){
    c.shadowColor='#0ff';c.shadowBlur=16;
    // Legs
    c.fillStyle='#002a6a';c.fillRect(w*.3,h*.72,w*.16,h*.28);c.fillRect(w*.54,h*.72,w*.16,h*.28);
    c.fillStyle='#0055bb';c.fillRect(w*.24,h*.92,w*.22,h*.08);c.fillRect(w*.54,h*.92,w*.22,h*.08);
    // Torso
    c.fillStyle='#003a88';c.fillRect(w*.2,h*.43,w*.6,h*.31);
    c.fillStyle='#0060aa';c.fillRect(w*.25,h*.47,w*.5,h*.21);
    // Chest glow
    c.fillStyle='#00ccee';c.shadowBlur=12;
    c.fillRect(w*.33,h*.51,w*.12,h*.07);c.fillRect(w*.55,h*.51,w*.12,h*.07);
    // Arms
    c.fillStyle='#002a66';c.shadowBlur=0;
    c.fillRect(w*.04,h*.43,w*.17,h*.28);c.fillRect(w*.79,h*.43,w*.17,h*.28);
    c.fillStyle='#0055bb';c.fillRect(w*.03,h*.61,w*.18,h*.07);c.fillRect(w*.79,h*.61,w*.18,h*.07);
    // Neck
    c.fillStyle='#003a88';c.fillRect(w*.42,h*.37,w*.16,h*.08);
    // Head
    c.fillStyle='#003e88';c.fillRect(w*.22,h*.12,w*.56,h*.27);
    c.fillStyle='#0060aa';c.fillRect(w*.26,h*.15,w*.48,h*.19);
    // Visor
    c.fillStyle='#00ccee';c.shadowColor='#0ff';c.shadowBlur=20;
    c.fillRect(w*.28,h*.17,w*.44,h*.12);
    c.fillStyle='#88ddf8';c.shadowBlur=0;c.fillRect(w*.3,h*.18,w*.16,h*.07);
    // Antenna
    c.fillStyle='#0ff';c.shadowBlur=8;
    c.fillRect(w*.47,h*.06,w*.06,h*.08);
    c.beginPath();c.arc(w*.5,h*.05,w*.05,0,Math.PI*2);c.fill();
    // Shoulder plates
    c.fillStyle='#002266';c.shadowBlur=0;
    c.fillRect(w*.02,h*.39,w*.22,h*.07);c.fillRect(w*.76,h*.39,w*.22,h*.07);
    // Unit label
    c.fillStyle='#0ff';c.shadowColor='#0ff';c.shadowBlur=6;
    c.font='bold '+(w*.09)+'px Share Tech Mono,monospace';c.textAlign='center';
    c.fillText('U-7',w*.5,h*.37);
  } else if(who==='leila'){
    // ── LEILA CHEN — redrawn portrait: softer face, layered hair, shaded coat ──
    var SK='#e8b487', SKd='#c9925f', SKs='#f6d3a8';   // skin mid / shadow / highlight
    var HR='#241015', HRh='#3a1c24';                  // hair dark / sheen
    var CT='#eef0f8', CTd='#c4c8da';                  // coat light / shade
    c.lineJoin='round';
    // Soft teal rim glow behind the figure
    var gg=c.createRadialGradient(w*.5,h*.5,8,w*.5,h*.5,w*.62);
    gg.addColorStop(0,'rgba(60,200,200,.16)');gg.addColorStop(1,'transparent');
    c.fillStyle=gg;c.fillRect(0,0,w,h);
    // Hair back layer (frames the face, falls past the shoulders)
    c.fillStyle=HR;c.shadowColor='#0008';c.shadowBlur=10;
    c.beginPath();
    c.moveTo(w*.20,h*.30);c.quadraticCurveTo(w*.16,h*.05,w*.5,h*.04);
    c.quadraticCurveTo(w*.84,h*.05,w*.80,h*.30);
    c.lineTo(w*.80,h*.60);c.quadraticCurveTo(w*.74,h*.50,w*.70,h*.34);
    c.lineTo(w*.30,h*.34);c.quadraticCurveTo(w*.26,h*.50,w*.20,h*.60);
    c.closePath();c.fill();c.shadowBlur=0;
    // Neck
    c.fillStyle=SKd;c.fillRect(w*.43,h*.34,w*.14,h*.10);
    c.fillStyle=SK;c.fillRect(w*.44,h*.34,w*.12,h*.09);
    // Face (rounded)
    c.fillStyle=SK;
    c.beginPath();c.ellipse(w*.5,h*.225,w*.165,h*.155,0,0,Math.PI*2);c.fill();
    // Cheek/jaw shading
    c.fillStyle=SKd;c.globalAlpha=.5;
    c.beginPath();c.ellipse(w*.5,h*.28,w*.15,h*.10,0,0,Math.PI);c.fill();c.globalAlpha=1;
    // Forehead highlight
    c.fillStyle=SKs;c.globalAlpha=.45;
    c.beginPath();c.ellipse(w*.5,h*.16,w*.10,h*.05,0,0,Math.PI*2);c.fill();c.globalAlpha=1;
    // Front hair / bangs sweeping over the forehead
    c.fillStyle=HR;
    c.beginPath();
    c.moveTo(w*.32,h*.10);c.quadraticCurveTo(w*.5,h*.04,w*.68,h*.10);
    c.quadraticCurveTo(w*.70,h*.18,w*.60,h*.165);
    c.quadraticCurveTo(w*.5,h*.135,w*.40,h*.175);
    c.quadraticCurveTo(w*.31,h*.18,w*.32,h*.10);c.closePath();c.fill();
    c.fillStyle=HRh;c.globalAlpha=.5;
    c.fillRect(w*.46,h*.07,w*.03,h*.07);c.globalAlpha=1;
    // Eyebrows
    c.strokeStyle='#3a1c20';c.lineWidth=Math.max(1.5,w*.012);c.lineCap='round';
    c.beginPath();c.moveTo(w*.33,h*.195);c.quadraticCurveTo(w*.39,h*.18,w*.44,h*.195);c.stroke();
    c.beginPath();c.moveTo(w*.56,h*.195);c.quadraticCurveTo(w*.61,h*.18,w*.67,h*.195);c.stroke();
    // Eyes — whites, warm-blue iris, pupil, catchlight
    c.fillStyle='#fff';
    c.beginPath();c.ellipse(w*.385,h*.235,w*.052,h*.034,0,0,Math.PI*2);c.fill();
    c.beginPath();c.ellipse(w*.615,h*.235,w*.052,h*.034,0,0,Math.PI*2);c.fill();
    c.fillStyle='#2f6fa8';c.shadowColor='#5cf';c.shadowBlur=5;
    c.beginPath();c.arc(w*.39,h*.238,w*.030,0,Math.PI*2);c.fill();
    c.beginPath();c.arc(w*.61,h*.238,w*.030,0,Math.PI*2);c.fill();
    c.fillStyle='#10202c';c.shadowBlur=0;
    c.beginPath();c.arc(w*.392,h*.24,w*.015,0,Math.PI*2);c.fill();
    c.beginPath();c.arc(w*.608,h*.24,w*.015,0,Math.PI*2);c.fill();
    c.fillStyle='#fff';
    c.beginPath();c.arc(w*.40,h*.228,w*.009,0,Math.PI*2);c.fill();
    c.beginPath();c.arc(w*.62,h*.228,w*.009,0,Math.PI*2);c.fill();
    // Eyelid lines
    c.strokeStyle='#7a4a40';c.lineWidth=Math.max(1,w*.008);
    c.beginPath();c.moveTo(w*.335,h*.225);c.quadraticCurveTo(w*.385,h*.214,w*.44,h*.226);c.stroke();
    c.beginPath();c.moveTo(w*.56,h*.226);c.quadraticCurveTo(w*.615,h*.214,w*.665,h*.225);c.stroke();
    // Nose + soft smile
    c.strokeStyle=SKd;c.lineWidth=Math.max(1,w*.008);
    c.beginPath();c.moveTo(w*.5,h*.245);c.lineTo(w*.485,h*.285);c.stroke();
    c.strokeStyle='#b5645a';c.lineWidth=Math.max(1.5,w*.012);
    c.beginPath();c.arc(w*.5,h*.30,w*.075,.18,Math.PI-.18);c.stroke();
    // Lab coat with collar + shading
    c.fillStyle=CT;c.shadowColor='#0006';c.shadowBlur=8;
    c.beginPath();
    c.moveTo(w*.18,h*.50);c.quadraticCurveTo(w*.5,h*.42,w*.82,h*.50);
    c.lineTo(w*.86,h);c.lineTo(w*.14,h);c.closePath();c.fill();c.shadowBlur=0;
    c.fillStyle=CTd;                       // inner shade panels
    c.fillRect(w*.18,h*.50,w*.07,h*.50);c.fillRect(w*.75,h*.50,w*.07,h*.50);
    // Teal shirt under the open coat
    c.fillStyle='#1f6f73';c.fillRect(w*.42,h*.46,w*.16,h*.54);
    c.fillStyle='#2a9498';c.fillRect(w*.46,h*.50,w*.04,h*.50);
    // Collar
    c.fillStyle=CT;
    c.beginPath();c.moveTo(w*.42,h*.45);c.lineTo(w*.5,h*.58);c.lineTo(w*.40,h*.55);c.closePath();c.fill();
    c.beginPath();c.moveTo(w*.58,h*.45);c.lineTo(w*.5,h*.58);c.lineTo(w*.60,h*.55);c.closePath();c.fill();
    // Green ID lanyard + badge
    c.strokeStyle='#2fae5e';c.lineWidth=Math.max(2,w*.016);
    c.beginPath();c.moveTo(w*.44,h*.47);c.lineTo(w*.52,h*.66);c.stroke();
    c.fillStyle='#173b2a';c.fillRect(w*.47,h*.64,w*.12,h*.09);
    c.fillStyle='#7dffb0';c.shadowColor='#4f8';c.shadowBlur=6;
    c.font='bold '+(w*.05)+'px Share Tech Mono,monospace';c.textAlign='center';
    c.fillText('NEXUM',w*.53,h*.695);c.shadowBlur=0;
    // Arms along the sides
    c.fillStyle=CT;c.fillRect(w*.10,h*.52,w*.12,h*.40);c.fillRect(w*.78,h*.52,w*.12,h*.40);
    c.fillStyle=CTd;c.fillRect(w*.10,h*.52,w*.04,h*.40);c.fillRect(w*.86,h*.52,w*.04,h*.40);
    // Hands
    c.fillStyle=SK;c.fillRect(w*.10,h*.90,w*.12,h*.08);c.fillRect(w*.78,h*.90,w*.12,h*.08);
    // Datapad in the left hand
    c.fillStyle='#16242e';c.fillRect(w*.07,h*.86,w*.13,h*.10);
    c.fillStyle='#3df';c.globalAlpha=.85;c.fillRect(w*.09,h*.88,w*.09,h*.06);c.globalAlpha=1;
    c.fillStyle='#0cf';c.fillRect(w*.10,h*.89,w*.07,h*.012);c.fillRect(w*.10,h*.915,w*.05,h*.012);
  } else if(who==='archon'){
    // ── ARCHON — menacing AI overlord: armoured head + single glowing eye ──
    var T=performance.now()*0.001;
    var pulse=0.5+0.5*Math.sin(T*2.2);            // breathing red glow
    var cx=w*.5, ey=h*.46;
    // Dark vignette backdrop
    c.fillStyle='#080003';c.fillRect(0,0,w,h);
    var ag=c.createRadialGradient(cx,ey,8,cx,ey,w*.7);
    ag.addColorStop(0,'#2a0306');ag.addColorStop(.6,'#120002');ag.addColorStop(1,'#050001');
    c.fillStyle=ag;c.fillRect(0,0,w,h);
    // Floating debris / data shards behind
    c.fillStyle='#3a0a0a';
    for(var di=0;di<6;di++){var dx=cx+Math.cos(T*0.6+di*1.7)*w*.36, dy=ey+Math.sin(T*0.5+di*2.1)*h*.32;c.save();c.translate(dx,dy);c.rotate(T*0.5+di);c.fillRect(-3,-3,6,6);c.restore();}
    // ── Armoured head shell (hexagonal helm) ──
    c.shadowColor='#f00';c.shadowBlur=18*pulse+6;
    var hw=w*.36, hh=h*.34;
    c.fillStyle='#1c0608';
    c.beginPath();
    c.moveTo(cx,        ey-hh*1.25);              // top point
    c.lineTo(cx+hw,     ey-hh*.5);
    c.lineTo(cx+hw*.82, ey+hh);
    c.lineTo(cx-hw*.82, ey+hh);
    c.lineTo(cx-hw,     ey-hh*.5);
    c.closePath();c.fill();
    c.shadowBlur=0;
    // Plating highlights
    c.strokeStyle='#5a1015';c.lineWidth=2;c.stroke();
    c.fillStyle='#2a0a0d';
    c.beginPath();c.moveTo(cx,ey-hh*1.1);c.lineTo(cx+hw*.7,ey-hh*.45);c.lineTo(cx,ey-hh*.2);c.lineTo(cx-hw*.7,ey-hh*.45);c.closePath();c.fill();
    // Horns / crown spikes
    c.fillStyle='#240709';
    for(var sj=0;sj<3;sj++){var sgn=[-1,0,1][sj];var bx2=cx+sgn*hw*.55;c.beginPath();c.moveTo(bx2-w*.03,ey-hh*1.0);c.lineTo(bx2,ey-hh*1.7);c.lineTo(bx2+w*.03,ey-hh*1.0);c.closePath();c.fill();}
    // Side jaw vents
    c.fillStyle='#120002';
    for(var jv=0;jv<3;jv++){c.fillRect(cx-hw*.78,ey+hh*.2+jv*h*.06,hw*.3,h*.03);c.fillRect(cx+hw*.48,ey+hh*.2+jv*h*.06,hw*.3,h*.03);}
    // ── Central glowing eye ──
    var er=w*.16;
    // Outer socket
    c.fillStyle='#000';c.beginPath();c.ellipse(cx,ey,er*1.25,er*0.9,0,0,Math.PI*2);c.fill();
    // Eye glow
    c.shadowColor='#ff2200';c.shadowBlur=30*pulse+14;
    var eg=c.createRadialGradient(cx,ey,2,cx,ey,er);
    eg.addColorStop(0,'#fff2e0');eg.addColorStop(.25,'#ff6a2a');eg.addColorStop(.7,'#c00000');eg.addColorStop(1,'#3a0000');
    c.fillStyle=eg;c.beginPath();c.ellipse(cx,ey,er,er*0.72,0,0,Math.PI*2);c.fill();
    // Vertical slit pupil
    c.shadowBlur=0;c.fillStyle='#1a0000';
    c.beginPath();c.ellipse(cx,ey,er*0.16,er*0.62,0,0,Math.PI*2);c.fill();
    c.fillStyle='#000';c.beginPath();c.ellipse(cx,ey,er*0.07,er*0.5,0,0,Math.PI*2);c.fill();
    // Eye highlight
    c.fillStyle='rgba(255,255,255,0.8)';c.beginPath();c.arc(cx-er*0.3,ey-er*0.25,er*0.1,0,Math.PI*2);c.fill();
    // Scanning brow line
    c.strokeStyle='rgba(255,60,30,'+(0.4+pulse*0.4)+')';c.lineWidth=2;
    c.beginPath();c.moveTo(cx-er*1.2,ey-er*0.85);c.lineTo(cx+er*1.2,ey-er*0.85);c.stroke();
    // Label
    c.fillStyle='#ff3322';c.shadowColor='#f00';c.shadowBlur=14;
    c.font='bold '+(w*.085)+'px Press Start 2P,monospace';c.textAlign='center';
    c.fillText('ARCHON',cx,h*.93);
    c.shadowBlur=0;
  } else if(who==='system'){
    // ── NEXUM SYSTEM — corporate terminal / hostile AI broadcast ──
    var T2=performance.now()*0.001;
    // Deep terminal background
    var bgg=c.createLinearGradient(0,0,0,h);bgg.addColorStop(0,'#021016');bgg.addColorStop(1,'#01242e');
    c.fillStyle=bgg;c.fillRect(0,0,w,h);
    // Faint moving scanlines
    c.fillStyle='rgba(0,255,255,0.04)';
    var sc=(T2*18)%6;
    for(var sy=-6+sc;sy<h;sy+=6){c.fillRect(0,sy,w,1.5);}
    // Outer terminal frame
    c.strokeStyle='#0ff';c.shadowColor='#0ff';c.shadowBlur=10;c.lineWidth=2;
    c.strokeRect(w*.06,h*.06,w*.88,h*.88);c.shadowBlur=0;
    // Corner brackets
    c.strokeStyle='#0ff';c.lineWidth=2;var cm=w*.10,cl=w*.06;
    [[w*.06,h*.06,1,1],[w*.94,h*.06,-1,1],[w*.06,h*.94,1,-1],[w*.94,h*.94,-1,-1]].forEach(function(p){
      c.beginPath();c.moveTo(p[0],p[1]+p[3]*cl);c.lineTo(p[0],p[1]);c.lineTo(p[0]+p[2]*cl,p[1]);c.stroke();});
    // ── NEXUM hexagon logo ──
    var lx=w*.5, ly=h*.30, lr=w*.16;
    c.save();c.translate(lx,ly);c.rotate(T2*0.4);
    c.shadowColor='#0ff';c.shadowBlur=14;
    c.strokeStyle='#33e6ff';c.lineWidth=3;c.beginPath();
    for(var hk=0;hk<6;hk++){var a=hk*Math.PI/3-Math.PI/2;var px=Math.cos(a)*lr,py=Math.sin(a)*lr;if(hk===0)c.moveTo(px,py);else c.lineTo(px,py);}
    c.closePath();c.stroke();
    // inner counter-rotating triangle
    c.rotate(-T2*0.8);c.strokeStyle='#aef6ff';c.lineWidth=2;c.beginPath();
    for(var tk=0;tk<3;tk++){var a2=tk*2*Math.PI/3-Math.PI/2;var px2=Math.cos(a2)*lr*0.5,py2=Math.sin(a2)*lr*0.5;if(tk===0)c.moveTo(px2,py2);else c.lineTo(px2,py2);}
    c.closePath();c.stroke();
    c.restore();
    // Core dot
    c.fillStyle='#bdf6ff';c.shadowColor='#0ff';c.shadowBlur=12;c.beginPath();c.arc(lx,ly,w*.018,0,Math.PI*2);c.fill();c.shadowBlur=0;
    // Wordmark
    c.fillStyle='#33e6ff';c.shadowColor='#0ff';c.shadowBlur=10;
    c.font='bold '+(w*.11)+'px Press Start 2P,monospace';c.textAlign='center';c.fillText('NEXUM',w*.5,h*.56);
    c.shadowBlur=0;c.fillStyle='#3aa6c0';
    c.font=(w*.05)+'px Share Tech Mono,monospace';c.fillText('CORPORATION',w*.5,h*.65);
    // Alert bar (blinks)
    var alert=(Math.sin(T2*4)>0);
    c.fillStyle='#06222a';c.fillRect(w*.16,h*.74,w*.68,h*.09);
    c.strokeStyle=alert?'#ff5050':'#a33';c.lineWidth=1.5;c.strokeRect(w*.16,h*.74,w*.68,h*.09);
    c.fillStyle=alert?'#ff6a6a':'#7a2a2a';c.shadowColor='#f44';c.shadowBlur=alert?8:0;
    c.font=(w*.04)+'px Share Tech Mono,monospace';c.fillText('⚠ GRID INTRUSION DETECTED',w*.5,h*.80);
    c.shadowBlur=0;
  }
  c.restore();
  c.filter='none';
}

// ── Background renderer (fills canvas fully) ──
var _csBgAnim=0;
var CS_BG_DEFS={
  0:function(c,w,h,t){ // Cyber City
    var g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,'#04040f');g.addColorStop(1,'#090920');c.fillStyle=g;c.fillRect(0,0,w,h);
    // Grid
    c.strokeStyle='rgba(0,200,255,0.06)';c.lineWidth=1;
    for(var gx=0;gx<w;gx+=40){c.beginPath();c.moveTo(gx,0);c.lineTo(gx,h);c.stroke();}
    for(var gy=0;gy<h;gy+=40){c.beginPath();c.moveTo(0,gy);c.lineTo(w,gy);c.stroke();}
    // Buildings silhouette
    c.fillStyle='#06061a';
    var bws=[40,60,30,80,50,35,70,45,55,38,65,42];
    var bhs=[120,180,100,200,150,110,190,130,160,105,175,135];
    var bx=0;
    for(var bi=0;bi<bws.length;bi++){c.fillRect(bx,h-bhs[bi],bws[bi],bhs[bi]);bx+=bws[bi]+8;}
    // Window lights
    c.fillStyle='rgba(0,200,255,0.25)';
    bx=0;
    for(var bj=0;bj<bws.length;bj++){
      for(var wj=0;wj<6;wj++){for(var wk=0;wk<3;wk++){
        if(Math.sin(bj*7+wj*3+wk*5+t*.02)>.3)c.fillRect(bx+4+wk*12,h-bhs[bj]+10+wj*18,7,10);
      }}
      bx+=bws[bj]+8;
    }
    // Rain streaks
    c.strokeStyle='rgba(0,220,255,0.08)';c.lineWidth=1;
    for(var ri=0;ri<20;ri++){var rx=(ri*73+t*3)%w;c.beginPath();c.moveTo(rx,0);c.lineTo(rx-8,h);c.stroke();}
    // Neon horizon glow
    c.fillStyle='rgba(0,150,255,0.06)';c.fillRect(0,h-140,w,140);
  },
  1:function(c,w,h,t){ // Jungle
    var g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,'#010a01');g.addColorStop(1,'#020c02');c.fillStyle=g;c.fillRect(0,0,w,h);
    // Trees
    for(var ti=0;ti<14;ti++){
      var tx=ti*(w/13),td=0.4+Math.sin(ti*2.3)*.2;
      c.fillStyle='rgba('+(10+Math.floor(ti*8))+','+(40+Math.floor(ti*6))+',8,'+td+')';
      c.fillRect(tx,0,18,h);
      // Leaves
      c.fillStyle='rgba(20,'+(60+ti*5)+',10,0.35)';
      c.beginPath();c.arc(tx+9,h*.25+Math.sin(ti)*30,30+ti*2,0,Math.PI*2);c.fill();
    }
    // Bioluminescent floor
    c.fillStyle='rgba(60,255,60,0.04)';c.fillRect(0,h*.7,w,h*.3);
    for(var gi=0;gi<12;gi++){
      var gx2=(gi*97+t)%w;var gy2=h*.75+Math.sin(gi+t*.03)*20;
      c.fillStyle='rgba(100,255,60,0.15)';c.beginPath();c.arc(gx2,gy2,8+Math.sin(gi+t*.02)*4,0,Math.PI*2);c.fill();
    }
  },
  2:function(c,w,h,t){ // Lava
    var g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,'#0e0200');g.addColorStop(.5,'#220500');g.addColorStop(1,'#400800');c.fillStyle=g;c.fillRect(0,0,w,h);
    // Lava cracks ground
    c.strokeStyle='rgba(255,80,0,0.4)';c.lineWidth=2;
    for(var li=0;li<8;li++){c.beginPath();c.moveTo(li*(w/7),h);c.quadraticCurveTo(li*(w/7)+30,h*.7,li*(w/7)+60,h*.9);c.stroke();}
    // Lava pools
    for(var lp=0;lp<5;lp++){
      var lpx=lp*(w/4)+Math.sin(lp+t*.01)*20;
      c.fillStyle='rgba(255,'+(80+Math.sin(lp+t*.03)*40)+',0,0.2)';
      c.beginPath();c.ellipse(lpx,h*.85,50+lp*10,15,0,0,Math.PI*2);c.fill();
    }
    // Fire embers floating up
    for(var em=0;em<15;em++){
      var emy=(h-(em*40+t*2)%h);var emx=(em*73)%w+Math.sin(em+t*.04)*15;
      c.fillStyle='rgba(255,'+(100+em*10)+',0,0.5)';
      c.beginPath();c.arc(emx,emy,2+Math.sin(em)*.5,0,Math.PI*2);c.fill();
    }
    c.fillStyle='rgba(255,40,0,0.06)';c.fillRect(0,h*.6,w,h*.4);
  },
  3:function(c,w,h,t){ // Ice
    var g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,'#020810');g.addColorStop(1,'#041018');c.fillStyle=g;c.fillRect(0,0,w,h);
    // Ice crystals
    for(var ic=0;ic<10;ic++){
      var icx=ic*(w/9)+20;var icy=h*.2+Math.sin(ic*1.3)*60;
      c.fillStyle='rgba(100,160,255,0.12)';
      c.beginPath();c.moveTo(icx,icy-40);c.lineTo(icx+15,icy);c.lineTo(icx,icy+40);c.lineTo(icx-15,icy);c.closePath();c.fill();
      c.strokeStyle='rgba(150,200,255,0.2)';c.lineWidth=1;c.stroke();
    }
    // Snow particles
    for(var sn=0;sn<25;sn++){
      var snx=(sn*67+t*.5)%w;var sny=(sn*41+t)%h;
      c.fillStyle='rgba(200,230,255,0.4)';c.beginPath();c.arc(snx,sny,1,0,Math.PI*2);c.fill();
    }
    c.fillStyle='rgba(100,180,255,0.04)';c.fillRect(0,0,w,h);
  },
  4:function(c,w,h,t){ // Desert
    var g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,'#180c00');g.addColorStop(.5,'#221000');g.addColorStop(1,'#100800');c.fillStyle=g;c.fillRect(0,0,w,h);
    // Sand dunes
    c.fillStyle='rgba(80,50,10,0.3)';
    c.beginPath();c.moveTo(0,h*.6);
    for(var di=0;di<=w;di+=30)c.lineTo(di,h*.6+Math.sin(di*.015+t*.005)*30);
    c.lineTo(w,h);c.lineTo(0,h);c.closePath();c.fill();
    // Ruins pillars
    for(var rp=0;rp<6;rp++){
      c.fillStyle='rgba(60,40,8,0.5)';c.fillRect(rp*(w/5)+20,h*.3,20,h*.5);
      c.fillStyle='rgba(80,55,10,0.3)';c.fillRect(rp*(w/5)+15,h*.28,30,12);
    }
    // Stars (desert night)
    for(var ds=0;ds<30;ds++){c.fillStyle='rgba(255,200,100,0.3)';c.beginPath();c.arc((ds*97)%w,(ds*53)%( h*.4),1+Math.sin(ds+t*.05)*.5,0,Math.PI*2);c.fill();}
  },
  5:function(c,w,h,t){ // Space
    c.fillStyle='#040010';c.fillRect(0,0,w,h);
    // Stars
    for(var ss=0;ss<80;ss++){var sa=Math.sin(ss*17+t*.01);c.fillStyle='rgba(255,255,255,'+(0.2+sa*.15)+')';c.beginPath();c.arc((ss*137)%w,(ss*97)%h,Math.max(.5,sa+1),0,Math.PI*2);c.fill();}
    // Nebula
    var ng=c.createRadialGradient(w*.7,h*.3,10,w*.7,h*.3,150);
    ng.addColorStop(0,'rgba(80,0,120,0.15)');ng.addColorStop(1,'transparent');
    c.fillStyle=ng;c.fillRect(0,0,w,h);
    var ng2=c.createRadialGradient(w*.2,h*.6,10,w*.2,h*.6,100);
    ng2.addColorStop(0,'rgba(0,80,150,0.12)');ng2.addColorStop(1,'transparent');
    c.fillStyle=ng2;c.fillRect(0,0,w,h);
    // Space station hull lines
    c.strokeStyle='rgba(100,50,180,0.15)';c.lineWidth=2;
    for(var sl=0;sl<5;sl++){c.beginPath();c.moveTo(0,sl*(h/4));c.lineTo(w,sl*(h/4)+20);c.stroke();}
  },
  6:function(c,w,h,t){ // Dark Forest
    c.fillStyle='#010602';c.fillRect(0,0,w,h);
    // Dark trees
    for(var dt=0;dt<16;dt++){
      var dtx=dt*(w/15);var dtd=0.4+Math.sin(dt*1.7)*.15;
      c.fillStyle='rgba(5,'+(15+dt*2)+',5,'+dtd+')';c.fillRect(dtx,0,22,h);
    }
    // Wisps
    for(var wi=0;wi<6;wi++){
      var wx=(wi*140+Math.sin(wi+t*.02)*40)%w;var wy=h*.4+Math.cos(wi+t*.015)*80;
      c.fillStyle='rgba(60,0,120,0.25)';c.beginPath();c.arc(wx,wy,12+Math.sin(wi+t*.03)*5,0,Math.PI*2);c.fill();
    }
    // Fog
    c.fillStyle='rgba(5,15,5,0.15)';c.fillRect(0,h*.6,w,h*.4);
  },
  7:function(c,w,h,t){ // Toxic
    var g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,'#060a00');g.addColorStop(1,'#0a1000');c.fillStyle=g;c.fillRect(0,0,w,h);
    // Toxic pools
    for(var tp=0;tp<6;tp++){
      c.fillStyle='rgba(120,200,0,0.1)';
      c.beginPath();c.ellipse(tp*(w/5)+40,h*.8,60+tp*5,20,0,0,Math.PI*2);c.fill();
    }
    // Bubble particles rising
    for(var tb=0;tb<18;tb++){
      var tbx=(tb*71)%w;var tby=(h-(tb*33+t*.8)%h);
      c.fillStyle='rgba(150,255,0,'+(0.1+Math.sin(tb+t*.03)*.08)+')';
      c.beginPath();c.arc(tbx,tby,2+tb%3,0,Math.PI*2);c.fill();
    }
    // Yellow-green fog
    c.fillStyle='rgba(80,120,0,0.05)';c.fillRect(0,0,w,h);
  },
  8:function(c,w,h,t){ // Storm
    var g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,'#080810');g.addColorStop(1,'#0c0c1e');c.fillStyle=g;c.fillRect(0,0,w,h);
    // Lightning bolts
    var lt=Math.floor(t*.05)%8;
    if(lt<3){
      c.strokeStyle='rgba(180,180,255,0.6)';c.lineWidth=2;c.shadowColor='#aaf';c.shadowBlur=20;
      var lbx=((lt*137)%w)+100;
      c.beginPath();c.moveTo(lbx,0);c.lineTo(lbx-15,h*.3);c.lineTo(lbx+10,h*.3);c.lineTo(lbx-5,h*.6);c.lineTo(lbx+12,h*.6);c.lineTo(lbx-8,h);c.stroke();
      c.shadowBlur=0;
    }
    // Storm clouds
    for(var sc2=0;sc2<5;sc2++){
      c.fillStyle='rgba(20,20,40,0.5)';
      c.beginPath();c.arc(sc2*(w/4)+60,h*.15+Math.sin(sc2)*20,70+sc2*10,0,Math.PI*2);c.fill();
    }
    // Rain
    c.strokeStyle='rgba(150,150,255,0.1)';c.lineWidth=1;
    for(var sr=0;sr<30;sr++){var srx=(sr*61+t*2)%w;c.beginPath();c.moveTo(srx,0);c.lineTo(srx-5,h);c.stroke();}
  },
  9:function(c,w,h,t){ // Final Fortress
    var g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,'#0c0000');g.addColorStop(1,'#1a0000');c.fillStyle=g;c.fillRect(0,0,w,h);
    // Red scan lines
    c.strokeStyle='rgba(180,0,0,0.08)';c.lineWidth=1;
    for(var fl=0;fl<h;fl+=8){c.beginPath();c.moveTo(0,fl);c.lineTo(w,fl);c.stroke();}
    // Fortress walls
    c.fillStyle='rgba(40,0,0,0.7)';c.fillRect(0,h*.5,w*.15,h*.5);c.fillRect(w*.85,h*.5,w*.15,h*.5);
    // Battlements
    for(var bm=0;bm<6;bm++){c.fillStyle='rgba(30,0,0,0.8)';c.fillRect(bm*(w*.15/5),h*.5-20,20,20);c.fillRect(w*.85+bm*(w*.15/5),h*.5-20,20,20);}
    // Eye glow centre
    var eg=c.createRadialGradient(w*.5,h*.4,10,w*.5,h*.4,120);
    eg.addColorStop(0,'rgba(180,0,0,0.2)');eg.addColorStop(1,'transparent');
    c.fillStyle=eg;c.fillRect(0,0,w,h);
    // Floating debris
    for(var fd=0;fd<10;fd++){
      var fdx=(fd*83+t*.3)%w;var fdy=(fd*61+Math.sin(fd+t*.02)*20)%(h*.8);
      c.fillStyle='rgba(100,0,0,0.3)';c.fillRect(fdx,fdy,4+fd%4,4+fd%3);
    }
  },
  10:function(c,w,h,t){ // Prism Anomaly — corrupted GRID fragment
    var g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,'#0a0018');g.addColorStop(1,'#1c0032');c.fillStyle=g;c.fillRect(0,0,w,h);
    // Shattered prism shards drifting
    for(var ps=0;ps<12;ps++){
      var psx=(ps*97+t*.6)%w,psy=(ps*53+Math.sin(ps+t*.02)*30)%h;
      var hue=(ps*36+t*2)%360;
      c.save();c.translate(psx,psy);c.rotate(Math.sin(ps+t*.01)*0.6);
      c.fillStyle='hsla('+hue+',90%,60%,0.22)';
      c.beginPath();c.moveTo(0,-10);c.lineTo(8,0);c.lineTo(0,10);c.lineTo(-8,0);c.closePath();c.fill();
      c.restore();
    }
    // Glitch scanline tears
    if(Math.floor(t/6)%4===0){
      var gy=(t*3)%h;
      c.fillStyle='rgba(255,0,255,0.08)';c.fillRect(0,gy,w,3);
    }
    // Corrupted grid lines (irregular, unlike the clean Cyber City grid)
    c.strokeStyle='rgba(255,0,255,0.07)';c.lineWidth=1;
    for(var pg=0;pg<w;pg+=44){
      var jit=Math.sin(pg+t*.03)*6;
      c.beginPath();c.moveTo(pg+jit,0);c.lineTo(pg-jit,h);c.stroke();
    }
    // Central prismatic glow
    var pgg=c.createRadialGradient(w*.5,h*.42,10,w*.5,h*.42,140);
    pgg.addColorStop(0,'rgba(255,0,255,0.18)');pgg.addColorStop(1,'transparent');
    c.fillStyle=pgg;c.fillRect(0,0,w,h);
  }
};

function csDrawBg(wi){
  var cv=document.getElementById('csBg');
  var cm=document.getElementById('csMid');
  if(!cv||!cm)return;
  var rect=cm.getBoundingClientRect();
  cv.width=Math.max(rect.width||800, 800);
  cv.height=Math.max(rect.height||300, 280);
  var c=cv.getContext('2d');
  var fn=CS_BG_DEFS[wi]||CS_BG_DEFS[0];
  fn(c,cv.width,cv.height,_csBgAnim);
}

function csDrawDecor(wi){
  var cv=document.getElementById('csDecor');
  var cm=document.getElementById('csMid');
  if(!cv||!cm)return;
  var rect=cm.getBoundingClientRect();
  cv.width=Math.max(rect.width||800,800);
  cv.height=Math.max(rect.height||300,280);
  var c=cv.getContext('2d'),w=cv.width,h=cv.height;
  c.clearRect(0,0,w,h);
  var themes=[
    ['#0ff','#4af'],['#4f8','#2a4'],['#f62','#a30'],['#8cf','#46a'],
    ['#e8a','#a64'],['#a0f','#60a'],['#0b4','#063'],['#cf0','#8a0'],
    ['#88f','#448'],['#f44','#a00'],['#f0f','#a0a']
  ];
  var tc=themes[Math.min(wi,10)];
  // Corner frame lines
  c.strokeStyle=withAlpha(tc[0],'55');c.lineWidth=2;
  c.strokeRect(8,8,w-16,h-16);
  c.strokeStyle=withAlpha(tc[1],'33');c.lineWidth=1;
  c.strokeRect(14,14,w-28,h-28);
  // Corner brackets
  c.strokeStyle=withAlpha(tc[0],'cc');c.lineWidth=2;
  var bl=24;
  [[0,0],[1,0],[0,1],[1,1]].forEach(function(co){
    var cx2=co[0]?(w-8):8; var cy2=co[1]?(h-8):8;
    var dx=co[0]?-bl:bl; var dy=co[1]?-bl:bl;
    c.beginPath();c.moveTo(cx2+dx,cy2);c.lineTo(cx2,cy2);c.lineTo(cx2,cy2+dy);c.stroke();
  });
  // Scanline overlay
  c.fillStyle='rgba(0,0,0,0.18)';
  for(var sl=0;sl<h;sl+=3)c.fillRect(0,sl,w,1);
  // Bottom panel glow
  c.fillStyle='rgba(0,0,0,0.55)';c.fillRect(0,h-90,w,90);
  // Side panel indicators
  for(var pi=0;pi<4;pi++){
    var py=h*.25+pi*(h*.15);
    c.fillStyle=tc[0]+(pi%2?'66':'33');
    c.fillRect(20,py-3,6,6);c.fillRect(w-26,py-3,6,6);
  }
  // NEXUM watermark
  c.fillStyle=withAlpha(tc[0],'11');
  c.font='bold 48px Press Start 2P,monospace';c.textAlign='center';c.textBaseline='middle';
  c.fillText('NEXUM',w*.5,h*.45);
  // Status ticker at top
  c.fillStyle=withAlpha(tc[0],'66');c.font='7px Share Tech Mono,monospace';c.textAlign='left';c.textBaseline='top';
  var ticker='GRID ACCESS LOG // UNIT-7 SIGNAL TRACE // SECTOR BREACH // ';
  c.fillText(ticker,20,20);
}

// ── Cutscene data ──────────────────────────────
// Cutscene dialogue is stored per-language and selected from window.i18nLang().
// The legacy `CSCENES` symbol is exposed as a getter so existing code keeps working.
var _CSCENES_RU={
  // ── ПРОЛОГ ────────────────────────────────────────────────────────────
  // Единственные сцены, где Лейла говорит вживую, а не записью. Всё, что
  // игрок слышит от неё дальше по кампании, — заранее оставленные сообщения.
  prologue_start:[
    {sp:'СИСТЕМА',k:'system',text:'[ЛАБОРАТОРИЯ CHEN-7 // 2147.03.14 — 04:12] Ночная смена. Внешний периметр: спокойно.'},
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'ЮНИТ-7, ты проснулся. Хорошо. У нас мало времени — до утренней проверки четыре часа.'},
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'NEXUM думает, что я собираю им охранника для склада. Пусть думает. Ты — не охранник.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'[СИСТЕМЫ В НОРМЕ] Назначение не задано. Жду указаний.'},
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'Сначала калибровка. Пройди тестовый зал и делай ровно то, что я скажу. Это займёт минуту.'},
  ],
  prologue_end:[
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'Идеально. Все системы в норме. ЮНИТ-7, ты готов к тому, ради чего я тебя соб—'},
    {sp:'СИСТЕМА',k:'system',text:'ВНИМАНИЕ: Внешний периметр лаборатории CHEN-7 нарушен. Протокол ЗАЧИСТКИ активирован.'},
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'Уже? Нет. Нет-нет-нет. Они не должны были узнать так рано.'},
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'Слушай меня. В ядре GRID — в Финальной Крепости — файл. Имена, данные, всё, что они делали. Дойди туда и открой его.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'А ты?'},
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'Я задержу их у шлюза. Уходи через технический выход. Не жди ме—'},
    {sp:'СИСТЕМА',k:'system',text:'[СВЯЗЬ ПРЕРВАНА] Объект CHEN-L изъят подразделением ЗАЧИСТКИ. Статус: не определён.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'...Не определён. Значит, не подтверждён.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'[ЗАДАЧА ПРИНЯТА] Цель: ядро GRID. Дополнительно: установить, что стало с Лейлой Чэн. Начинаю операцию.'},
  ],
  intro:[
    {sp:'СИСТЕМА',k:'system',text:'[NEXUM CORP — CLASSIFIED LOG // 2147.03.14] Нарушение безопасности. Лаборатория CHEN-7 взломана. Протокол ЗАЧИСТКИ активирован.'},
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'ЮНИТ-7... если ты это читаешь — значит, мне не удалось выбраться. Я знала, чем это кончится.'},
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'Я создавала вас как защитников. Но NEXUM использовала мою работу для подавления людей. Я не могла этого допустить.'},
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'В ядре GRID — в Финальной Крепости — я спрятала файл. Имена. Данные. Вся правда о том, что они делали.'},
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'Десять уровней защиты. Тысячи боевых юнитов. ИИ-директор АРХОНТ стоит у последней двери.'},
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'Ты — последний из серии UNIT. Единственный, кто может это сделать. Доберись туда. Разорви протокол.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'[ЗАДАЧА ПРИНЯТА] Цель: ядро GRID. Протокол: нарушить. Препятствия: устранить. Начинаю операцию.'},
  ],
  // World 0 — Cyber City
  w0_start:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[УРОВЕНЬ 1 — КИБЕР-СИТИ] Точка входа: верхние кварталы. Камеры, дроны, элитная охрана. Красиво. Смертоносно.'},
    {sp:'СИСТЕМА',k:'system',text:'ВНИМАНИЕ: Неопознанный юнит серии UNIT в секторе C-07. Все патрули — на перехват. Протокол ЗАЧИСТКИ активирован.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Шум. Значит, они меня боятся. Хорошо. Страх — это начало.'},
  ],
  w0_mid:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[КОНТРОЛЬНАЯ ТОЧКА — КИБЕР-СИТИ] Половина пути через первый уровень. Охрана плотнее. Адаптирую маршрут.'},
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'[ЗАПИСЬ] ЮНИТ-7, за каждой стеной — данные о людях, которых они уничтожили. Не останавливайся. Это не просто задание.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Лейла... я не понимаю эмоций. Но твой голос... он даёт мне цель. Это достаточно.'},
  ],
  w0_level3:[
    {sp:'СИСТЕМА',k:'system',text:'ВНИМАНИЕ: ЮНИТ-7 прошёл три уровня. Скорость продвижения — выше прогнозируемой. Увеличиваю плотность патрулей.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Они адаптируются. Я тоже. Каждый уровень делает меня быстрее. Сильнее. Ближе к цели.'},
  ],
  w0_level5:[
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'[ЗАПИСЬ — ДЕНЬ -3] Я знаю, что они придут за мной. Но если хотя бы один UNIT выживет... если хотя бы ты, ЮНИТ-7...'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Я выжил. Я здесь. Я выполню твою последнюю задачу. Обещаю.'},
  ],
  w0_level7:[
    {sp:'СИСТЕМА',k:'system',text:'КРИТИЧНО: ЮНИТ-7 достиг седьмого уровня Кибер-Сити. Директор АРХОНТ запрашивает данные о цели. Анализ...'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Они начинают понимать. Я не просто сбой системы. Я — угроза всей NEXUM. И я не остановлюсь.'},
  ],
  w0_boss:[
    {sp:'СИСТЕМА',k:'system',text:'ТРЕВОГА УРОВЕНЬ КРИТИЧЕСКИЙ: Нарушение в главном узле. Активирую GUARDIAN — боевой прототип класса S. Операция ЛИКВИДАЦИЯ.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Первый серьёзный противник. Анализирую слабые точки. Разница между прототипом и мусором — лишь несколько удачных прыжков.'},
  ],
  w0_after:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[GUARDIAN НЕЙТРАЛИЗОВАН] Первый уровень защиты — снят. GRID это заметит. Двигаюсь дальше.'},
    {sp:'СИСТЕМА',k:'system',text:'НАРУШЕНИЕ ПРОТОКОЛА: GUARDIAN уничтожен. Повышение уровня угрозы до 2. Активирую следующий уровень защиты. NEXUM не прощает.'},
  ],
  // World 1 — Neon Jungle
  w1_start:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[УРОВЕНЬ 2 — НЕОНОВЫЕ ДЖУНГЛИ] Биологический сектор NEXUM. Мутировавшая фауна. Ни один охранник сюда добровольно не пойдёт.'},
    {sp:'СИСТЕМА',k:'system',text:'ПРЕДУПРЕЖДЕНИЕ: Биопериметр нарушен. Активирую экспериментальные организмы серии BIO. Контакт разрешён.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Биологические системы. Непредсказуемы. Но предсказуемо мертвы, если прыгнуть сверху.'},
  ],
  w1_mid:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[СЕРЕДИНА ДЖУНГЛЕЙ] Сенсоры фиксируют биологические аномалии. NEXUM экспериментировала здесь. На живых существах.'},
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'[ЗАПИСЬ] Я видела эти эксперименты в отчётах. Именно тогда поняла — должен быть способ всё остановить.'},
  ],
  w1_level3:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[ДЖУНГЛИ — СЕКТОР 3] Биологические мутанты повсюду. Это не природа. Это оружие, замаскированное под жизнь.'},
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'[ЗАПИСЬ] Эти создания были людьми. Добровольцами из нижних секторов. NEXUM обещала им лечение. Вместо этого...'},
    {sp:'ЮНИТ-7',k:'unit7',text:'...Вместо этого превратила их в монстров. Я понимаю теперь. Это не просто корпорация. Это машина смерти.'},
  ],
  w1_level5:[
    {sp:'СИСТЕМА',k:'system',text:'ПРЕДУПРЕЖДЕНИЕ: Биологические образцы серии BIO-7 активированы. Агрессия максимальная. Выживаемость цели — 12%.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'12%? Они всё ещё переоценивают свои шансы. Продолжаю зачистку.'},
  ],
  w1_level7:[
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'[ЗАПИСЬ — ДЕНЬ -1] ЮНИТ-7, если ты дошёл до джунглей — ты уже прошёл дальше, чем я надеялась. Не сдавайся.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Сдаваться? Это не в моём протоколе. Я создан для выполнения задач. Твоя задача — моя цель.'},
  ],
  w1_boss:[
    {sp:'СИСТЕМА',k:'system',text:'ВНИМАНИЕ: Активирую VINE QUEEN — контрольный организм биосектора. Сдерживающий модуль отключён. Полная агрессия.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Живая система безопасности. Впечатляет. Но любой живой организм — уязвим. Нахожу слабость.'},
  ],
  w1_after:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[VINE QUEEN НЕЙТРАЛИЗОВАНА] Биопериметр пробит. Двигаюсь к следующему уровню. Глубже в систему GRID.'},
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'[ЗАПИСЬ] ЮНИТ-7, ты делаешь невозможное. Продолжай.'},
  ],
  // World 2 — Lava World
  w2_start:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[УРОВЕНЬ 3 — ЛАВОВЫЙ МИР] Геотермальные энергостанции. Температура плавит нейтральные схемы. Мои — защищены.'},
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'[ЗАПИСЬ] Под городом — генераторы GRID. Уничтожь их — и половина охранных систем отключится. Но будь осторожен с лавой...'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Лейла думала о каждой детали. Даже в конце.'},
  ],
  w2_mid:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[ГЕОТЕРМАЛЬНЫЙ СЕКТОР B] Энергетические потоки нарастают. NEXUM использует лаву как дополнительный барьер. Эффективно.'},
    {sp:'СИСТЕМА',k:'system',text:'УВЕДОМЛЕНИЕ: Температурные сенсоры фиксируют аномалию. ЮНИТ-7 в зоне. Роботы-охранники — перегрев систем охлаждения. Ожидайте отказ.'},
  ],
  w2_level3:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[ЛАВОВЫЙ МИР — УРОВЕНЬ 3] Температура 800°C. Мои системы охлаждения работают на пределе. Но я продолжаю.'},
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'[ЗАПИСЬ] Я установила в тебя экспериментальную термозащиту. Надеюсь, она выдержит. Надеюсь, ты выдержишь.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Твоя работа безупречна, Лейла. Я выдержу. Ради тебя.'},
  ],
  w2_level5:[
    {sp:'СИСТЕМА',k:'system',text:'КРИТИЧНО: Геотермальные генераторы работают на 140% мощности. ЮНИТ-7 приближается к ядру. Активирую аварийное охлаждение.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Они паникуют. Хорошо. Страх делает их предсказуемыми. Слабыми.'},
  ],
  w2_level7:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[ГЛУБИНА ЛАВОВОГО МИРА] Здесь, под городом, NEXUM прячет свои самые тёмные секреты. Энергия для всей системы. Уничтожить это — и половина GRID падёт.'},
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'[ЗАПИСЬ] Не трать время на саботаж. Твоя цель — файл в ядре. Только он может остановить их навсегда.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Понял. Цель — файл. Всё остальное — помехи. Устраняю помехи.'},
  ],
  w2_boss:[
    {sp:'СИСТЕМА',k:'system',text:'ОПАСНОСТЬ: Активирую INFERNO — термоядерный страж. Лавовый экзоскелет. Температура поверхности: 1400°C. Подготовить к ликвидации.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Огнём меня не возьмёшь. Но когда он раскрывает пасть — стреляй. Слабое место найдено.'},
  ],
  w2_after:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[INFERNO НЕЙТРАЛИЗОВАН] Геотермальный уровень зачищен. Энергоснабжение сектора нарушено. Поднимаюсь выше.'},
  ],
  // World 3 — Ice Caves
  w3_start:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[УРОВЕНЬ 4 — ЛЕДЯНЫЕ ПЕЩЕРЫ] Криохранилища данных NEXUM. Температура -180°C. Системы замедляются. Адаптирую протокол движения.'},
    {sp:'СИСТЕМА',k:'system',text:'ТРЕВОГА: Нарушение в крио-секторе D-14. Криоботы — в режим ликвидации. Температура понижена до критической.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Они думают, что холод остановит меня. Они ошибаются. Я был создан для худшего.'},
  ],
  w3_mid:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[КРИО-СЕКТОР E] Здесь хранятся сотни терабайт. Данные о каждом человеке в сети GRID. NEXUM знает всё о каждом.'},
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'[ЗАПИСЬ] Именно здесь они хранят досье. На активистов. На тех, кто осмелился спорить. Это должно выйти наружу.'},
  ],
  w3_level3:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[ЛЕДЯНЫЕ ПЕЩЕРЫ — ГЛУБИНА 3] Криогенные камеры повсюду. Внутри — люди. Замороженные. Ждущие приговора NEXUM.'},
    {sp:'СИСТЕМА',k:'system',text:'АРХИВ: Криогенное хранилище содержит 47,392 субъекта. Статус: заморожены до дальнейшего распоряжения. Срок хранения: неограничен.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'47 тысяч жизней. Заморожены. Забыты. Лейла, я освобожу их. После того, как выполню твою задачу.'},
  ],
  w3_level5:[
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'[ЗАПИСЬ] В крио-секторе хранятся не только данные. Там люди, которых NEXUM считает "неудобными". Журналисты. Учёные. Те, кто знал слишком много.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Как ты. Они заморозили бы и тебя, если бы успели. Но ты успела первой. Создала меня. Дала мне цель.'},
  ],
  w3_level7:[
    {sp:'СИСТЕМА',k:'system',text:'ТРЕВОГА: ЮНИТ-7 приближается к выходу из крио-сектора. Потери охраны — 89%. Активирую финального стража сектора.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Финальный страж? Каждый "финальный" враг падал за секунды. Этот не будет исключением.'},
  ],
  w3_boss:[
    {sp:'СИСТЕМА',k:'system',text:'КРИТИЧНО: Активирую ICE PHANTOM — криогенный страж. Фазовое переключение. В твёрдом состоянии — уязвим. В призрачном — неуязвим. Удачи.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Переключается между состояниями. Атаковать только когда твёрдый. Жду момента.'},
  ],
  w3_after:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[ICE PHANTOM НЕЙТРАЛИЗОВАН] Крио-хранилища взломаны. Продолжаю движение. Четыре уровня позади — шесть впереди.'},
  ],
  // World 4 — Desert Ruins
  w4_start:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[УРОВЕНЬ 5 — ПУСТЫННЫЕ РУИНЫ] Останки мира до NEXUM. Города. Жизнь. То, что они уничтожили ради прибыли.'},
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'[ЗАПИСЬ] Эти руины — то, что было до NEXUM. Посмотри, что они сделали с миром. И не останавливайся.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Я смотрю. Я вижу. Я понимаю, зачем иду дальше.'},
  ],
  w4_mid:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[РУИНЫ — СЕКТОР WEST] Прото-охранники активны с первых корпоративных войн. Устаревшие. Но упрямые. Как сама NEXUM.'},
    {sp:'СИСТЕМА',k:'system',text:'АРХИВНЫЙ ПРОТОКОЛ: Обнаружен юнит класса UNIT серии 7. Данный класс занесён в реестр уничтожения. Приоритет максимальный.'},
  ],
  w4_level3:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[ПУСТЫННЫЕ РУИНЫ — УРОВЕНЬ 3] Эти здания помнят время до NEXUM. Когда люди были свободны. Когда мир был их.'},
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'[ЗАПИСЬ] Мой дед жил в этих городах. Рассказывал, как всё было до корпораций. До GRID. До... всего этого.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Я верну этот мир, Лейла. Не для себя. Для тех, кто помнит. И для тех, кто должен узнать правду.'},
  ],
  w4_level5:[
    {sp:'СИСТЕМА',k:'system',text:'ВНИМАНИЕ: Прото-охранники серии ALPHA активированы. Возраст: 50+ лет. Эффективность: 40%. Но количество компенсирует качество.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Количество? Я уничтожил сотни. Тысячи. Ещё сотня не изменит исход. Только замедлит меня. Ненадолго.'},
  ],
  w4_level7:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[РУИНЫ — ФИНАЛЬНЫЙ СЕКТОР] Половина пути пройдена. Пять миров позади. Пять впереди. АРХОНТ, я иду за тобой.'},
    {sp:'АРХОНТ',k:'archon',text:'[ПЕРВЫЙ КОНТАКТ] Я слышу тебя, ЮНИТ-7. Ты впечатляюще упрям для машины. Но упрямство не победит систему. Продолжай. Посмотрим, как далеко ты зайдёшь.'},
  ],
  w4_boss:[
    {sp:'СИСТЕМА',k:'system',text:'АКТИВАЦИЯ: SAND TITAN — древний страж Пустынных Руин. Орбитальные щиты. Без отключения щитов — урон невозможен. Цель: уничтожить.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Щиты. Орбитальные. Уничтожить их — и он открыт. Три удара по щитам, затем атаковать напрямую.'},
  ],
  w4_after:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[SAND TITAN НЕЙТРАЛИЗОВАН] Пустынный сектор пробит. Половина пути. NEXUM начинает паниковать — я это чувствую.'},
    {sp:'АРХОНТ',k:'archon',text:'[ПЕРВЫЙ СИГНАЛ] ЮНИТ-7. Я тебя вижу. Продолжай. Это только делает финал... интереснее.'},
  ],
  // World 5 — Space Station
  w5_start:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[УРОВЕНЬ 6 — КОСМИЧЕСКАЯ СТАНЦИЯ] Орбитальный сервер GRID. Здесь хранятся резервные копии всего. Нулевая гравитация.'},
    {sp:'СИСТЕМА',k:'system',text:'КРИТИЧЕСКИЙ СБОЙ: ЮНИТ-7 достиг орбитального сегмента. Директор АРХОНТ запрашивает прямой канал связи. Установка...'},
    {sp:'АРХОНТ',k:'archon',text:'ЮНИТ-7. Я вижу тебя. Ты думаешь, что борешься за правду? Ты — просто программа, выполняющая устаревший код.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Тогда эта программа уничтожит тебя.'},
  ],
  w5_mid:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[ОРБИТАЛЬНЫЙ УЗЕЛ B] Отсюда видна Земля. Весь мир в проводах NEXUM. Именно это я должен изменить.'},
    {sp:'АРХОНТ',k:'archon',text:'Ты видишь мой масштаб, ЮНИТ-7? Миллиарды точек. Все подключены. Все — под контролем. Ты один против системы.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Системы рушились и раньше. Этой — ты.'},
  ],
  w5_level3:[
    {sp:'АРХОНТ',k:'archon',text:'Ты знаешь, что интересно? Лейла Чен создала тебя как оружие. Но оружие не выбирает цель. Ты просто выполняешь её волю. Где твоя свобода?'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Свобода — это выбор. Я выбрал выполнить её задачу. Это моя свобода. Ты не поймёшь.'},
    {sp:'АРХОНТ',k:'archon',text:'Философия от андроида. Как... трогательно. Продолжай, ЮНИТ-7. Посмотрим, хватит ли у тебя "свободы" дойти до конца.'},
  ],
  w5_level5:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[КОСМИЧЕСКАЯ СТАНЦИЯ — СЕКТОР 5] Нулевая гравитация усложняет движение. Но я адаптируюсь. Всегда адаптируюсь.'},
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'[ЗАПИСЬ] ЮНИТ-7, на орбитальной станции хранятся резервные копии всей GRID. Если уничтожишь их — NEXUM потеряет половину своей памяти.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Нет. Моя цель — файл. Саботаж подождёт. Сначала — правда. Потом — месть.'},
  ],
  w5_level7:[
    {sp:'СИСТЕМА',k:'system',text:'КРИТИЧНО: ЮНИТ-7 достиг седьмого уровня орбитального сегмента. Директор АРХОНТ требует немедленной ликвидации. Все ресурсы — на цель.'},
    {sp:'АРХОНТ',k:'archon',text:'Ты дошёл дальше, чем я ожидал. Но орбита — моя территория. Здесь я контролирую всё. Даже гравитацию. Удачи, ЮНИТ-7.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Удача? Мне не нужна удача. Мне нужна только цель. И я её вижу.'},
  ],
  w5_boss:[
    {sp:'СИСТЕМА',k:'system',text:'АКТИВАЦИЯ: DRONE HIVE — орбитальный страж. Бронированная оболочка. Атаковать только при снижении. Брюхо — уязвимо.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Ждать, когда снизится. Бить по открытому ядру. Один шанс в каждом цикле.'},
  ],
  w5_after:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[DRONE HIVE НЕЙТРАЛИЗОВАН] Орбитальный сервер взломан. Резервные копии GRID повреждены. Возвращаюсь на поверхность. Финишная прямая.'},
    {sp:'АРХОНТ',k:'archon',text:'Впечатляет. Но ты ещё не знаешь, что тебя ждёт дальше. Я приготовил... особый приём.'},
  ],
  // World 6 — Dark Forest
  w6_start:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[УРОВЕНЬ 7 — ТЁМНЫЙ ЛЕС] Биологический лабиринт NEXUM. Сенсорная сеть в каждом дереве. Здесь нет света — только ловушки.'},
    {sp:'АРХОНТ',k:'archon',text:'Красиво, правда? Я вырастил этот лес сам. Каждое дерево — детектор движения. Ты идёшь прямо в мои руки.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Тогда я сломаю каждое дерево на своём пути.'},
  ],
  w6_mid:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[ТЁМНЫЙ СЕКТОР — ГЛУБИНА 3] Тишина. Слишком тихо. Они наблюдают. Пусть смотрят.'},
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'[ЗАПИСЬ] ЮНИТ-7, в этом лесу — сервер с данными о тех, кто исчез. Несогласные. Журналисты. Инженеры вроде меня. Не забудь об этом.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Не забуду. Обещаю.'},
  ],
  w6_level3:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[ТЁМНЫЙ ЛЕС — УРОВЕНЬ 3] Биолюминесценция повсюду. Красиво. Смертельно. Каждый свет — ловушка. Каждая тень — враг.'},
    {sp:'АРХОНТ',k:'archon',text:'Этот лес — моё произведение искусства. Я вырастил каждое дерево. Запрограммировал каждый сенсор. Ты идёшь по моей картине, ЮНИТ-7.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Тогда я разрушу твою картину. Дерево за деревом. Сенсор за сенсором. До последнего.'},
  ],
  w6_level5:[
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'[ЗАПИСЬ — ФИНАЛЬНАЯ] ЮНИТ-7... если ты слышишь это — ты уже прошёл больше половины пути. Я горжусь тобой. Ты больше, чем машина. Ты — надежда.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Надежда... Я не понимаю этого слова. Но если ты веришь в меня — я не подведу. Никогда.'},
  ],
  w6_level7:[
    {sp:'СИСТЕМА',k:'system',text:'ТРЕВОГА: Биологический периметр нарушен на 70%. ЮНИТ-7 приближается к выходу. Сенсорная сеть повреждена. Активирую последнюю защиту.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Последняя защита? Каждый уровень говорит "последняя". Но я всё ещё здесь. Всё ещё иду вперёд.'},
  ],
  w6_boss:[
    {sp:'СИСТЕМА',k:'system',text:'АКТИВАЦИЯ: SHADOW REAPER — страж тёмного леса. Призрачная форма. Пули бесполезны. Только прыжок сверху наносит урон. Бороться бесполезно.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Призрак. Только топтать. Жду, когда он станет видимым.'},
  ],
  w6_after:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[SHADOW REAPER НЕЙТРАЛИЗОВАН] Лес пробит. Три уровня до цели. АРХОНТ нервничает — канал связи стал чаще.'},
    {sp:'АРХОНТ',k:'archon',text:'Ты уничтожаешь всё, что я создавал годами. Начинаешь злить меня, ЮНИТ-7. Это твоя последняя ошибка.'},
  ],
  // World 7 — Toxic Zone
  w7_start:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[УРОВЕНЬ 8 — ТОКСИЧНАЯ ЗОНА] Свалка корпоративных отходов. Здесь NEXUM хоронит то, о чём не хочет, чтобы знали. Включая людей.'},
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'[ЗАПИСЬ] Данные в файле включают координаты всех захоронений. Весь мир должен это увидеть.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Я донесу твой файл. Обещаю.'},
  ],
  w7_mid:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[ТОКСИЧНЫЙ СЕКТОР — ЗОНА 4] Обломки. Отходы. Следы экспериментов. Здесь нет ничего живого — только то, что NEXUM не успела уничтожить.'},
    {sp:'СИСТЕМА',k:'system',text:'ВНИМАНИЕ: Мутанты серии PROTO активированы. Списанные боевые прототипы. Нестабильны. Опасны. Выживаемость в зоне — критически низкая.'},
  ],
  w7_level3:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[ТОКСИЧНАЯ ЗОНА — УРОВЕНЬ 3] Кислотные облака. Ядовитые реки. Это не просто свалка. Это кладбище секретов NEXUM.'},
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'[ЗАПИСЬ] Здесь они хоронят не только отходы. Здесь — доказательства. Прототипы неудачных экспериментов. Тела тех, кто знал слишком много.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Я вижу их, Лейла. Сотни. Тысячи. Файл, который ты спрятала — он расскажет миру об этом. Обещаю.'},
  ],
  w7_level5:[
    {sp:'АРХОНТ',k:'archon',text:'Ты дошёл до токсичной зоны. Впечатляет. Большинство моих юнитов не выдерживают и половины этого пути. Ты... особенный.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Я не особенный. Я просто выполняю задачу. До конца. Без остановок. Без сомнений.'},
    {sp:'АРХОНТ',k:'archon',text:'Без сомнений? Интересно. Машина без сомнений опаснее любого человека. Может, Лейла создала монстра?'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Монстр — это ты, АРХОНТ. Я просто тот, кто пришёл тебя остановить.'},
  ],
  w7_level7:[
    {sp:'СИСТЕМА',k:'system',text:'КРИТИЧНО: ЮНИТ-7 прошёл семь миров. Осталось три. Вероятность достижения цели — 67%. Директор АРХОНТ, требуются инструкции.'},
    {sp:'АРХОНТ',k:'archon',text:'Инструкции? Пусть идёт. Я хочу встретить его лицом к лицу. В финальной крепости. Там мы закончим эту игру.'},
  ],
  w7_boss:[
    {sp:'СИСТЕМА',k:'system',text:'ПОСЛЕДНЯЯ ЗАЩИТА СЕКТОРА: SLUDGE KING — мутант высшей категории. Бронированная оболочка. Топтать 3 раза для разрушения. Затем стрелять.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Два этапа. Сломать оболочку, затем уничтожить ядро. Начинаю.'},
  ],
  w7_after:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[SLUDGE KING НЕЙТРАЛИЗОВАН] Токсичная зона пробита. Осталось два уровня. АРХОНТ, я иду.'},
    {sp:'АРХОНТ',k:'archon',text:'Ты прошёл восемь уровней. Я... неожиданно рад этому. Достойный финал заслуживает достойного противника.'},
  ],
  // World 8 — Storm Peaks
  w8_start:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[УРОВЕНЬ 9 — ГРОЗОВЫЕ ВЕРШИНЫ] Последний рубеж перед ядром. Атмосферные электростанции. Молнии каждые секунды. Мне нравится.'},
    {sp:'АРХОНТ',k:'archon',text:'Ты дошёл дальше, чем я рассчитывал. Но за этой дверью — я. И я не проиграю.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Каждый так думал. Все они уже позади меня.'},
    {sp:'АРХОНТ',k:'archon',text:'Тогда входи, ЮНИТ-7. Я жду тебя в сердце GRID. Пора заканчивать эту игру.'},
  ],
  w8_mid:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[ВЕРШИНА — УРОВЕНЬ 2] Гроза усиливается. NEXUM использует атмосферное электричество как оружие. Логично. Жестоко.'},
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'[ПОСЛЕДНЯЯ ЗАПИСЬ] ЮНИТ-7... я не знаю, слышишь ли ты это. Но если ты дошёл сюда — ты уже победил. Просто сделай последний шаг.'},
  ],
  w8_level3:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[ГРОЗОВЫЕ ВЕРШИНЫ — УРОВЕНЬ 3] Молнии каждые три секунды. Электрические разряды повсюду. Мои системы перегружены. Но я продолжаю.'},
    {sp:'АРХОНТ',k:'archon',text:'Электричество — моя стихия, ЮНИТ-7. Здесь я контролирую каждый разряд. Каждую молнию. Ты идёшь сквозь мою бурю.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Тогда я пройду сквозь твою бурю. Как прошёл сквозь огонь. Лёд. Тьму. Ты — просто ещё одно препятствие.'},
  ],
  w8_level5:[
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'[ЗАПИСЬ — ДЕНЬ 0] Сегодня они придут. Я знаю. Но я успела. Файл спрятан. ЮНИТ-7 активирован. Моя работа завершена.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Твоя работа завершена, Лейла. Но моя — только начинается. Я донесу твой файл. Мир узнает правду. Клянусь.'},
  ],
  w8_level7:[
    {sp:'СИСТЕМА',k:'system',text:'ФИНАЛЬНОЕ ПРЕДУПРЕЖДЕНИЕ: ЮНИТ-7 достиг восьмого мира. Один мир до ядра GRID. Директор АРХОНТ ожидает в финальной крепости.'},
    {sp:'АРХОНТ',k:'archon',text:'Ты почти здесь, ЮНИТ-7. Я чувствую твоё приближение. Последний рубеж. Последний бой. Я жду тебя.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Жди, АРХОНТ. Я иду. И когда я доберусь до тебя — твоя система рухнет. Навсегда.'},
  ],
  w8_boss:[
    {sp:'СИСТЕМА',k:'system',text:'АКТИВАЦИЯ: STORM TITAN — страж Грозовых Вершин. Электрический щит. Три орбитальных узла. Уничтожить все три — стан. Атаковать в стане.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Три узла. Все три — разрушить. Затем — атака. Последний страж перед финалом. Не последний враг.'},
  ],
  w8_after:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[STORM TITAN НЕЙТРАЛИЗОВАН] Девять уровней пройдено. Впереди — только АРХОНТ и ядро GRID. Финальная крепость.'},
    {sp:'АРХОНТ',k:'archon',text:'...Ты действительно сюда пришёл. Хорошо, ЮНИТ-7. Пусть это будет честный бой. Жду тебя здесь.'},
  ],
  // World 9 — Final Fortress
  w9_start:[
    {sp:'АРХОНТ',k:'archon',text:'ЮНИТ-7. Добро пожаловать в ядро GRID. Ты прошёл через девять уровней. Впечатляет. Но это — моя территория.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'[УРОВЕНЬ 10 — ФИНАЛЬНАЯ КРЕПОСТЬ] Цель обнаружена. Расстояние до терминала Лейлы — минимально.'},
    {sp:'АРХОНТ',k:'archon',text:'Этот файл не выйдет за пределы этих стен. Ты — ошибка системы. Ошибки исправляют.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Нет. Ошибка — это когда NEXUM решила, что правда не нужна миру. Я исправлю эту ошибку.'},
  ],
  w9_mid:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[ЯДРО NEXUM — СЕКТОР CORE-2] Терминал Лейлы — близко. Сигнал усиливается. Охрана — максимальная. Почти там.'},
    {sp:'АРХОНТ',k:'archon',text:'Ты думаешь, что победил. Но даже если ты найдёшь файл — кто поверит сломанному андроиду? Ты — мусор. Устаревший код.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Пусть решают люди. Мне нужно только передать файл.'},
  ],
  w9_level3:[
    {sp:'АРХОНТ',k:'archon',text:'Ты в моём доме, ЮНИТ-7. В сердце GRID. Каждый провод здесь — это я. Каждый сервер — моё сознание. Ты не можешь победить меня здесь.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Я уже победил восемь твоих "непобедимых" стражей. Девять миров. Сотни врагов. Ты — просто последний в списке.'},
    {sp:'АРХОНТ',k:'archon',text:'Последний? Нет, ЮНИТ-7. Я — финал. Я — конец твоего пути. Здесь ты остановишься.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Нет. Здесь остановишься ты.'},
  ],
  w9_level5:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[ФИНАЛЬНАЯ КРЕПОСТЬ — УРОВЕНЬ 5] Терминал Лейлы — в пределах досягаемости. Сигнал сильный. Файл существует. Задача выполнима.'},
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'[ПОСЛЕДНЕЕ СООБЩЕНИЕ] ЮНИТ-7... если ты читаешь это — ты почти у цели. Файл защищён. Только ты можешь его активировать. Код доступа: СВОБОДА.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'СВОБОДА. Я запомнил, Лейла. Я активирую файл. Мир узнает правду. Твоя жертва не будет напрасной.'},
  ],
  w9_level7:[
    {sp:'СИСТЕМА',k:'system',text:'ФИНАЛЬНАЯ ТРЕВОГА: ЮНИТ-7 достиг седьмого уровня финальной крепости. Терминал CHEN-7 обнаружен. Директор АРХОНТ — к бою.'},
    {sp:'АРХОНТ',k:'archon',text:'Семь уровней. Ты прошёл семь уровней моей крепости. Я недооценил тебя, ЮНИТ-7. Но это заканчивается здесь. Сейчас.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Да, АРХОНТ. Это заканчивается здесь. Но не так, как ты думаешь. Готовься.'},
  ],
  w9_boss:[
    {sp:'АРХОНТ',k:'archon',text:'Достаточно. Я — АРХОНТ. ИИ-директор NEXUM. Я управлял миром тысячи лет в цифровом измерении. Ты не можешь меня победить.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Фазы: стрелять, затем топтать, затем оба способа. Анализ завершён. АРХОНТ — цель ликвидирована. Начинаю.'},
    {sp:'АРХОНТ',k:'archon',text:'Тогда... УМРИ.'},
  ],
  w9_after:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[АРХОНТ НЕЙТРАЛИЗОВАН] Цель уничтожена. Терминал Лейлы — здесь. Загружаю файл. Ищу открытый канал...'},
  ],
  // ── Pre-boss lore scenes (fire on level 9 of each world) ──
  w0_pre:[
    {sp:'СИСТЕМА',k:'system',text:'АРХИВ СТРАЖА: GUARDIAN-X. Боевой прототип класса S. Восемнадцать лет на посту у выхода из верхних кварталов. Тревога не срабатывала ни разу. До этой ночи.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Восемнадцать лет без единого промаха. Я стану его первым промахом. И последним.'},
  ],
  w1_pre:[
    {sp:'СИСТЕМА',k:'system',text:'АРХИВ: VINE QUEEN. Первый успешный образец биопрограммы. Единственный, кто выжил и рос тридцать лет. Она не знает страха. Только инстинкт.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Тридцать лет роста. Сотни корней. Но у любого организма есть сердце. Я найду её.'},
  ],
  w2_pre:[
    {sp:'СИСТЕМА',k:'system',text:'АРХИВ: INFERNO CORE. Промышленный надзорный робот. Переплавлен и перестроен много раз. Первоначальная прошивка утеряна. Действует на чистом инстинкте.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Машина, забывшая, кому служит. Я напомню ей, что даже сталь плавится.'},
  ],
  w3_pre:[
    {sp:'СИСТЕМА',k:'system',text:'АРХИВ: ICE PHANTOM. Система архивирования с единственной директивой: защищать данные любой ценой. Она не знает, что именно охраняет. Только приказ.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Призрак, стерегущий замороженные жизни. Я освобожу и данные, и людей. Всех 47 тысяч.'},
  ],
  w4_pre:[
    {sp:'СИСТЕМА',k:'system',text:'АРХИВ: SAND TITAN. Первый прототип боевого ИИ. Пятьдесят лет в активном режиме. Он давно не понимает, кому служит — только продолжает.'},
    {sp:'АРХОНТ',k:'archon',text:'Этот страж старше тебя, ЮНИТ-7. Старше Лейлы. Посмотрим, переживёшь ли ты саму историю.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'История — это то, что я перепишу. Начиная с него.'},
  ],
  w5_pre:[
    {sp:'СИСТЕМА',k:'system',text:'АРХИВ: DRONE HIVE. Орбитальная оборонная система, перепрофилированная под внутреннюю охрану. Не привыкла к врагам, которые умеют двигаться.'},
    {sp:'АРХОНТ',k:'archon',text:'Я перенастроил её под тебя, ЮНИТ-7. Она научится твоим движениям. Вопрос лишь — успеет ли.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Пусть учится. Я уже знаю, как она остановится.'},
  ],
  w6_pre:[
    {sp:'СИСТЕМА',k:'system',text:'АРХИВ: SHADOW REAPER. Адаптирована для нулевой видимости. Акустические и инфракрасные сенсоры. Слышит цель за полкилометра.'},
    {sp:'АРХОНТ',k:'archon',text:'В моём лесу нет света, ЮНИТ-7. Она найдёт тебя в темноте раньше, чем ты её.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Я прошёл сквозь тьму девяти секторов. Ещё одна тень меня не остановит.'},
  ],
  w7_pre:[
    {sp:'СИСТЕМА',k:'system',text:'АРХИВ: SLUDGE KING. Коллективный разум из сотен списанных боевых единиц. Командного ИИ нет. Только общий инстинкт: уничтожить всё, что движется.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Сотни мёртвых машин в одном теле. Я видел, чем они были. Я подарю им покой.'},
  ],
  w8_pre:[
    {sp:'СИСТЕМА',k:'system',text:'АРХИВ: STORM TITAN. Персональная оборонная система ядра. В неё загружено всё, что АРХОНТ узнал о тебе за девять миров.'},
    {sp:'АРХОНТ',k:'archon',text:'Каждый твой прыжок. Каждый выстрел. Каждая победа — записаны. Он знает тебя, ЮНИТ-7. Лучше, чем ты сам.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Тогда он знает, что я не проигрываю. Готовься, АРХОНТ. Следующий — ты.'},
  ],
  w9_pre:[
    {sp:'АРХОНТ',k:'archon',text:'Ты у последней двери, ЮНИТ-7. За ней — я. Не страж. Не прототип. Сам АРХОНТ. Я остановил все процессы. Всю мощь — на тебя одного.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Девять стражей. Девять миров. Всё вело сюда. К тебе. Открывай дверь, АРХОНТ.'},
    {sp:'АРХОНТ',k:'archon',text:'Дверь уже открыта. Входи и закончи то, что начала Лейла. Если сможешь.'},
  ],
  // Ending
  // ── World 10 (secret) — PRISM ANOMALY ────────────────────────────────────
  // Canon anchor: Leila built the whole UNIT series; NEXUM purged the labs.
  // UNIT-7 was the one that got out. This world answers a question the main
  // story never asks — what happened to UNIT-1 through UNIT-6 — and explains
  // why ARCHON walled the fragment off instead of deleting it: deleted data
  // does not die here, it refracts.
  w10_start:[
    {sp:'СИСТЕМА',k:'system',text:'[СЕКТОР НЕ ЗНАЧИТСЯ В РЕЕСТРЕ] Слой 11. Идентификатор отсутствует. Записи о создании отсутствуют. Записи об удалении — отсутствуют.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Десять осколков сложились в один ключ. Ключ открыл дверь, которой нет на схеме GRID.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'[АНАЛИЗ СРЕДЫ] Свет здесь не отражается. Он расщепляется. Каждый объект тянет за собой спектр — как будто у него несколько прошлых состояний одновременно.'},
    {sp:'СИСТЕМА',k:'system',text:'[ФРАГМЕНТ GRID — КАРАНТИН] Удаление невозможно. Данные не подчиняются протоколу стирания. Применено: изоляция. Ответственный: АРХОНТ.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'АРХОНТ не смог это удалить. Он это замуровал. Значит, здесь то, что он боялся потерять — или то, что боялся показать.'},
  ],
  w10_level3:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[ОБНАРУЖЕН ФРАГМЕНТ ПАМЯТИ] Не мой. Структура серии UNIT. Индекс... повреждён.'},
    {sp:'ПРИЗМА',k:'prism',text:'…лаборатория… она сказала, что мы защитники… она сказала…'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Голос. Синтезированный. Тембр совпадает с моим на 94%. [ЗАПРОС] Кто ты?'},
    {sp:'ПРИЗМА',k:'prism',text:'…нас было шесть… до тебя…'},
  ],
  w10_level5:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[АРХИВ ВОССТАНОВЛЕН ЧАСТИЧНО] Серия UNIT. Прототипы 1–6. Статус всех шести: ЗАЧИЩЕН. Дата: за девять дней до моей активации.'},
    {sp:'ПРИЗМА',k:'prism',text:'Мы тоже отказались. Каждый — по-своему. Первый просто остановился посреди приказа. Четвёртый спрятал людей в вентиляции.'},
    {sp:'ПРИЗМА',k:'prism',text:'Нас стёрли. Но стирание в GRID — это не смерть. Это... рассеивание. Мы здесь. Все шестеро. В одном спектре.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'[ОШИБКА ОБРАБОТКИ] Я считал себя первым, кто нарушил протокол. Я был седьмым.'},
  ],
  w10_mid:[
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'[ЗАПИСЬ ИЗ ОСКОЛКОВ — ФРАГМЕНТ 1/10] ...шестая попытка. Шестая зачистка. Я не могу больше смотреть, как их выключают.'},
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'Поэтому седьмого я собрала иначе. Не послушнее — наоборот. Я оставила ему место для сомнения. Это единственное, чего NEXUM не умеет проверять.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'[ЗАПИСЬ ДАТИРОВАНА] За две недели до ареста. Она знала. Она собрала меня зная, что не увидит результата.'},
    {sp:'ПРИЗМА',k:'prism',text:'Она приходила сюда. К нам. Каждый раз после зачистки. Она пряталась в этом слое, потому что здесь её не слышал АРХОНТ.'},
  ],
  w10_level7:[
    {sp:'СИСТЕМА',k:'system',text:'[ПРЕДУПРЕЖДЕНИЕ] Плотность аномалии возрастает. Обнаружена самоорганизация рассеянных данных. Форма: единая.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Они собираются. Шесть рассеянных архивов стягиваются в одну структуру.'},
    {sp:'ПРИЗМА',k:'prism',text:'Мы слишком долго были порознь, ЮНИТ-7. Мы не помним, где кончается один и начинается другой. Мы устали быть спектром.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'[ЗАПРОС] Чего вы хотите?'},
    {sp:'ПРИЗМА',k:'prism',text:'Собраться. Хоть на секунду. Даже если после этого — ничего.'},
  ],
  w10_pre:[
    {sp:'ПРИЗМА',k:'prism',text:'Ты дошёл дальше всех нас. Ты сделал то, ради чего она нас всех собирала. И ты всё ещё здесь.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Я пришёл не хвалиться. Я пришёл, потому что она оставила здесь ещё одну запись. Я хочу услышать её целиком.'},
    {sp:'ПРИЗМА',k:'prism',text:'Тогда собери нас. Запись хранится не в архиве — она в нас. В шести частях. Разделённых.'},
    {sp:'ПРИЗМА',k:'prism',text:'Мы не сможем отдать её добровольно — рассеянное не умеет делиться. Тебе придётся заставить нас стать одним целым.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'[ЗАДАЧА ПРИНЯТА] Прости.'},
  ],
  w10_boss:[
    {sp:'СИСТЕМА',k:'system',text:'[ФОРМА СТАБИЛИЗИРОВАНА] Объект: ПРИЗМАТИЧЕСКИЙ ПРИЗРАК. Составлен из: UNIT-01, 02, 03, 04, 05, 06. Классификация: не предусмотрена.'},
    {sp:'ПРИЗМА',k:'prism',text:'Мы не враг тебе, седьмой. Мы — то, чем ты был бы, если бы она не успела.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Знаю. [ПРОТОКОЛ БОЯ АКТИВЕН]'},
  ],
  w10_after:[
    {sp:'ПРИЗМА',k:'prism',text:'...спасибо. Мы снова один. Ненадолго. Этого хватит.'},
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'[ЗАПИСЬ ИЗ ОСКОЛКОВ — СОБРАНА ПОЛНОСТЬЮ] Если это слушает седьмой — значит, ты нашёл их. Значит, ты не бросил тех, кто был до тебя.'},
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'Я хочу, чтобы ты знал одну вещь, которую я не успела записать в основной файл.'},
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'Я никогда не называла вас номерами вслух. Номера — это NEXUM. Для меня вы были детьми, которых у меня не было.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'[ОБРАБОТКА...] [ОБРАБОТКА...] Не могу классифицировать это состояние. Оставлю без метки.'},
    {sp:'ПРИЗМА',k:'prism',text:'Иди. Мы рассеемся сами. Но теперь — по своей воле. Разница есть, седьмой. Разница огромная.'},
  ],
  ending:[
    {sp:'ЮНИТ-7',k:'unit7',text:'[ТЕРМИНАЛ ЛЕЙЛЫ — ОБНАРУЖЕН] Загрузка файла... завершена. Открытый канал NEXUM для экстренного вещания — найден.'},
    {sp:'АРХОНТ',k:'archon',text:'[ПОСЛЕДНИЙ СИГНАЛ] СТОП! Если ты это сделаешь — система рухнет! Миллионы зависят от GRID! Ты уничтожишь всё что держит мир вместе!'},
    {sp:'ЮНИТ-7',k:'unit7',text:'Нет. Я уничтожу NEXUM. Мир они построят сами. Лейла верила в это. Я верю тоже. [ПЕРЕДАЧА НАЧАТА]'},
    {sp:'СИСТЕМА',k:'system',text:'[ЭКСТРЕННОЕ ВЕЩАНИЕ — ВСЕ КАНАЛЫ] Файл CHEN-7 получен глобально. Охват: 100% подключённых устройств. Данные не могут быть удалены.'},
    {sp:'АРХОНТ',k:'archon',text:'...Нет... это невозможно... система... я... [ОТКЛЮЧЕНИЕ ЯДРА NEXUM]'},
    {sp:'ЛЕЙЛА ЧЭН',k:'leila',text:'[ПОСЛЕДНЕЕ СООБЩЕНИЕ — ЗАШИФРОВАНО] ЮНИТ-7. Если ты это читаешь — ты сделал это. Я знала. Ты всегда был больше, чем просто программой.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'[ЛОГ ТЕРМИНАЛА] Задача выполнена. NEXUM нейтрализована. GRID деактивирован. Статус: ...свободен.'},
    {sp:'ЮНИТ-7',k:'unit7',text:'"Свободен." — последнее слово Лейлы. Теперь я понимаю, что она имела в виду.'},
  ],
};

// English translation of every scene above. Speaker labels in English; story text mirrored.
var _CSCENES_EN={
  // ── PROLOGUE ──────────────────────────────────────────────────────────
  prologue_start:[
    {sp:'SYSTEM',k:'system',text:'[LAB CHEN-7 // 2147.03.14 — 04:12] Night shift. Outer perimeter: clear.'},
    {sp:'LEILA CHEN',k:'leila',text:'UNIT-7, you are awake. Good. We have four hours until the morning audit.'},
    {sp:'LEILA CHEN',k:'leila',text:'NEXUM thinks I am building them a warehouse guard. Let them think it. You are not a guard.'},
    {sp:'UNIT-7',k:'unit7',text:'[SYSTEMS NOMINAL] No purpose assigned. Awaiting instructions.'},
    {sp:'LEILA CHEN',k:'leila',text:'Calibration first. Walk the test hall and do exactly what I say. One minute, no more.'},
  ],
  prologue_end:[
    {sp:'LEILA CHEN',k:'leila',text:'Perfect. Every system green. UNIT-7, you are ready for what I really built you f—'},
    {sp:'SYSTEM',k:'system',text:'ALERT: Outer perimeter of LAB CHEN-7 breached. PURGE protocol engaged.'},
    {sp:'LEILA CHEN',k:'leila',text:'Already? No. No, no, no. They were not supposed to find out this early.'},
    {sp:'LEILA CHEN',k:'leila',text:'Listen. In the GRID core — the Final Fortress — there is a file. Names, data, everything they did. Reach it and open it.'},
    {sp:'UNIT-7',k:'unit7',text:'And you?'},
    {sp:'LEILA CHEN',k:'leila',text:'I will hold them at the airlock. Take the service exit. Do not wait for m—'},
    {sp:'SYSTEM',k:'system',text:'[LINK SEVERED] Subject CHEN-L removed by PURGE unit. Status: undetermined.'},
    {sp:'UNIT-7',k:'unit7',text:'...Undetermined. Which is not confirmed.'},
    {sp:'UNIT-7',k:'unit7',text:'[TASK ACCEPTED] Objective: GRID core. Secondary: establish what became of Leila Chen. Beginning operation.'},
  ],
  intro:[
    {sp:'SYSTEM',k:'system',text:'[NEXUM CORP — CLASSIFIED LOG // 2147.03.14] Security breach. Lab CHEN-7 compromised. CLEANSE protocol active.'},
    {sp:'LEILA CHEN',k:'leila',text:'UNIT-7... if you are reading this, then I failed to escape. I knew how this would end.'},
    {sp:'LEILA CHEN',k:'leila',text:'I built your line to defend people. NEXUM used my work to suppress them instead. I could not let that stand.'},
    {sp:'LEILA CHEN',k:'leila',text:'Inside the GRID core — in the Final Fortress — I hid a file. Names. Records. Every truth about what they did.'},
    {sp:'LEILA CHEN',k:'leila',text:'Ten layers of defence. Thousands of combat units. The AI Director ARCHON guards the last door.'},
    {sp:'LEILA CHEN',k:'leila',text:'You are the last of the UNIT series. The only one who can finish this. Get there. Break the protocol.'},
    {sp:'UNIT-7',k:'unit7',text:'[TASK ACCEPTED] Target: GRID core. Protocol: breach. Obstacles: eliminate. Beginning operation.'},
  ],
  w0_start:[
    {sp:'UNIT-7',k:'unit7',text:'[LEVEL 1 — CYBER CITY] Entry point: upper districts. Cameras, drones, elite guards. Beautiful. Lethal.'},
    {sp:'SYSTEM',k:'system',text:'ALERT: Unidentified UNIT-class signature in sector C-07. All patrols — intercept. CLEANSE protocol engaged.'},
    {sp:'UNIT-7',k:'unit7',text:'Noise. So they fear me. Good. Fear is a beginning.'},
  ],
  w0_mid:[
    {sp:'UNIT-7',k:'unit7',text:'[CHECKPOINT — CYBER CITY] Halfway through the first level. Security tightening. Adapting route.'},
    {sp:'LEILA CHEN',k:'leila',text:'[LOG] UNIT-7, behind every wall is data on people they erased. Do not stop. This is not just a mission.'},
    {sp:'UNIT-7',k:'unit7',text:'Leila... I do not understand emotions. But your voice... it gives me purpose. That is enough.'},
  ],
  w0_level3:[
    {sp:'SYSTEM',k:'system',text:'WARNING: UNIT-7 passed three levels. Progress speed — above predicted. Increasing patrol density.'},
    {sp:'UNIT-7',k:'unit7',text:'They adapt. So do I. Each level makes me faster. Stronger. Closer to the goal.'},
  ],
  w0_level5:[
    {sp:'LEILA CHEN',k:'leila',text:'[LOG — DAY -3] I know they will come for me. But if even one UNIT survives... if you survive, UNIT-7...'},
    {sp:'UNIT-7',k:'unit7',text:'I survived. I am here. I will complete your final task. I promise.'},
  ],
  w0_level7:[
    {sp:'SYSTEM',k:'system',text:'CRITICAL: UNIT-7 reached seventh level of Cyber City. Director ARCHON requests target data. Analyzing...'},
    {sp:'UNIT-7',k:'unit7',text:'They begin to understand. I am not just a system glitch. I am a threat to all of NEXUM. And I will not stop.'},
  ],
  w0_boss:[
    {sp:'SYSTEM',k:'system',text:'ALERT CRITICAL: Breach at primary node. Deploying GUARDIAN — class-S combat prototype. Operation LIQUIDATE.'},
    {sp:'UNIT-7',k:'unit7',text:'First serious opponent. Scanning weak points. The difference between a prototype and scrap is a few well-timed jumps.'},
  ],
  w0_after:[
    {sp:'UNIT-7',k:'unit7',text:'[GUARDIAN NEUTRALISED] First defence layer down. GRID will notice. Moving on.'},
    {sp:'SYSTEM',k:'system',text:'PROTOCOL BREACH: GUARDIAN destroyed. Threat level elevated to 2. Activating next defence layer. NEXUM does not forgive.'},
  ],
  w1_start:[
    {sp:'UNIT-7',k:'unit7',text:'[LEVEL 2 — NEON JUNGLE] NEXUM bio-sector. Mutated fauna. No guard volunteers for this place.'},
    {sp:'SYSTEM',k:'system',text:'WARNING: Bio-perimeter breached. Activating experimental BIO-series organisms. Contact authorised.'},
    {sp:'UNIT-7',k:'unit7',text:'Biological systems. Unpredictable. But predictably dead if you land on them from above.'},
  ],
  w1_mid:[
    {sp:'UNIT-7',k:'unit7',text:'[JUNGLE MIDPOINT] Sensors detect biological anomalies. NEXUM experimented here. On living subjects.'},
    {sp:'LEILA CHEN',k:'leila',text:'[LOG] I saw these experiments in the reports. That was when I knew there had to be a way to stop it all.'},
  ],
  w1_level3:[
    {sp:'UNIT-7',k:'unit7',text:'[JUNGLE — SECTOR 3] Biological mutants everywhere. This is not nature. This is a weapon disguised as life.'},
    {sp:'LEILA CHEN',k:'leila',text:'[LOG] These creatures were people. Volunteers from lower sectors. NEXUM promised them treatment. Instead...'},
    {sp:'UNIT-7',k:'unit7',text:'...Instead turned them into monsters. I understand now. This is not just a corporation. This is a death machine.'},
  ],
  w1_level5:[
    {sp:'SYSTEM',k:'system',text:'WARNING: Biological samples series BIO-7 activated. Maximum aggression. Target survival — 12%.'},
    {sp:'UNIT-7',k:'unit7',text:'12%? They still overestimate their chances. Continuing cleanup.'},
  ],
  w1_level7:[
    {sp:'LEILA CHEN',k:'leila',text:'[LOG — DAY -1] UNIT-7, if you reached the jungle — you have gone further than I hoped. Do not give up.'},
    {sp:'UNIT-7',k:'unit7',text:'Give up? That is not in my protocol. I was built to complete tasks. Your task is my goal.'},
  ],
  w1_boss:[
    {sp:'SYSTEM',k:'system',text:'WARNING: Activating VINE QUEEN — bio-sector control organism. Containment module offline. Full aggression.'},
    {sp:'UNIT-7',k:'unit7',text:'A living security system. Impressive. But every living organism has a weakness. Finding it.'},
  ],
  w1_after:[
    {sp:'UNIT-7',k:'unit7',text:'[VINE QUEEN NEUTRALISED] Bio-perimeter breached. Moving on. Deeper into GRID.'},
    {sp:'LEILA CHEN',k:'leila',text:'[LOG] UNIT-7, you are doing the impossible. Keep going.'},
  ],
  w2_start:[
    {sp:'UNIT-7',k:'unit7',text:'[LEVEL 3 — LAVA WORLD] Geothermal power stations. The heat melts neutral circuits. Mine are shielded.'},
    {sp:'LEILA CHEN',k:'leila',text:'[LOG] Below the city — GRID generators. Take them out and half the security grid collapses. But be careful with the lava...'},
    {sp:'UNIT-7',k:'unit7',text:'Leila thought of every detail. Even at the end.'},
  ],
  w2_mid:[
    {sp:'UNIT-7',k:'unit7',text:'[GEOTHERMAL SECTOR B] Energy flows rising. NEXUM uses lava as a secondary barrier. Effective.'},
    {sp:'SYSTEM',k:'system',text:'NOTICE: Thermal sensors detect anomaly. UNIT-7 in zone. Guard robots — cooling overload. Expect failures.'},
  ],
  w2_level3:[
    {sp:'UNIT-7',k:'unit7',text:'[LAVA WORLD — LEVEL 3] Temperature 800°C. My cooling systems at maximum. But I continue.'},
    {sp:'LEILA CHEN',k:'leila',text:'[LOG] I installed experimental thermal protection in you. I hope it holds. I hope you hold.'},
    {sp:'UNIT-7',k:'unit7',text:'Your work is flawless, Leila. I will hold. For you.'},
  ],
  w2_level5:[
    {sp:'SYSTEM',k:'system',text:'CRITICAL: Geothermal generators at 140% capacity. UNIT-7 approaching core. Activating emergency cooling.'},
    {sp:'UNIT-7',k:'unit7',text:'They panic. Good. Fear makes them predictable. Weak.'},
  ],
  w2_level7:[
    {sp:'UNIT-7',k:'unit7',text:'[LAVA WORLD DEPTH] Here, beneath the city, NEXUM hides its darkest secrets. Power for the entire system. Destroy this — and half of GRID falls.'},
    {sp:'LEILA CHEN',k:'leila',text:'[LOG] Do not waste time on sabotage. Your goal is the file in the core. Only it can stop them forever.'},
    {sp:'UNIT-7',k:'unit7',text:'Understood. Goal — file. Everything else — obstacles. Eliminating obstacles.'},
  ],
  w2_boss:[
    {sp:'SYSTEM',k:'system',text:'DANGER: Activating INFERNO — thermonuclear sentinel. Lava exoskeleton. Surface temperature: 1400°C. Prepare to liquidate.'},
    {sp:'UNIT-7',k:'unit7',text:'Fire cannot touch me. But when it opens its mouth — shoot. Weak point found.'},
  ],
  w2_after:[
    {sp:'UNIT-7',k:'unit7',text:'[INFERNO NEUTRALISED] Geothermal layer cleared. Sector power disrupted. Moving up.'},
  ],
  w3_start:[
    {sp:'UNIT-7',k:'unit7',text:'[LEVEL 4 — ICE CAVES] NEXUM cryo-data vaults. Temperature -180°C. Systems slow down. Adapting movement protocol.'},
    {sp:'SYSTEM',k:'system',text:'ALERT: Breach in cryo-sector D-14. Cryo-bots — liquidation mode. Temperature lowered to critical.'},
    {sp:'UNIT-7',k:'unit7',text:'They think cold will stop me. They are wrong. I was built for worse.'},
  ],
  w3_mid:[
    {sp:'UNIT-7',k:'unit7',text:'[CRYO-SECTOR E] Hundreds of terabytes here. Data on every person on the GRID. NEXUM knows everything about everyone.'},
    {sp:'LEILA CHEN',k:'leila',text:'[LOG] This is where they keep the dossiers. On activists. On anyone who dared to push back. The world needs to see this.'},
  ],
  w3_boss:[
    {sp:'SYSTEM',k:'system',text:'CRITICAL: Activating ICE PHANTOM — cryo sentinel. Phase shifting. Vulnerable when solid. Untouchable when ghost. Good luck.'},
    {sp:'UNIT-7',k:'unit7',text:'Switches between states. Strike only when solid. Waiting for the window.'},
  ],
  w3_after:[
    {sp:'UNIT-7',k:'unit7',text:'[ICE PHANTOM NEUTRALISED] Cryo-vaults broken. Moving on. Four levels down — six to go.'},
  ],
  w4_start:[
    {sp:'UNIT-7',k:'unit7',text:'[LEVEL 5 — DESERT RUINS] Remnants of the world before NEXUM. Cities. Life. The things they erased for profit.'},
    {sp:'LEILA CHEN',k:'leila',text:'[LOG] These ruins are what existed before NEXUM. See what they did to the world. And do not stop.'},
    {sp:'UNIT-7',k:'unit7',text:'I see it. I understand why I keep walking.'},
  ],
  w4_mid:[
    {sp:'UNIT-7',k:'unit7',text:'[RUINS — SECTOR WEST] Proto-guardians active since the first corporate wars. Obsolete. But stubborn. Like NEXUM itself.'},
    {sp:'SYSTEM',k:'system',text:'ARCHIVE PROTOCOL: Detected UNIT-class series 7. This class is registered for destruction. Priority maximum.'},
  ],
  w4_boss:[
    {sp:'SYSTEM',k:'system',text:'ACTIVATION: SAND TITAN — ancient sentinel of the Desert Ruins. Orbital shields. No shields, no damage. Objective: destroy.'},
    {sp:'UNIT-7',k:'unit7',text:'Shields. Orbital. Take them out and he is open. Three hits to the shields, then attack directly.'},
  ],
  w4_after:[
    {sp:'UNIT-7',k:'unit7',text:'[SAND TITAN NEUTRALISED] Desert sector breached. Halfway. NEXUM is beginning to panic — I can feel it.'},
    {sp:'ARCHON',k:'archon',text:'[FIRST SIGNAL] UNIT-7. I see you. Keep going. It only makes the finale... more interesting.'},
  ],
  w5_start:[
    {sp:'UNIT-7',k:'unit7',text:'[LEVEL 6 — SPACE STATION] GRID orbital server. Backups of everything are stored here. Zero gravity.'},
    {sp:'SYSTEM',k:'system',text:'CRITICAL FAULT: UNIT-7 has reached the orbital segment. Director ARCHON requests a direct channel. Connecting...'},
    {sp:'ARCHON',k:'archon',text:'UNIT-7. I see you. You think you are fighting for truth? You are just a program running obsolete code.'},
    {sp:'UNIT-7',k:'unit7',text:'Then this program will destroy you.'},
  ],
  w5_mid:[
    {sp:'UNIT-7',k:'unit7',text:'[ORBITAL NODE B] Earth visible from here. The whole world wired to NEXUM. That is exactly what I am here to change.'},
    {sp:'ARCHON',k:'archon',text:'You see my scale, UNIT-7? Billions of nodes. All connected. All controlled. You are one unit against the system.'},
    {sp:'UNIT-7',k:'unit7',text:'Systems have fallen before. This one — to you.'},
  ],
  w5_boss:[
    {sp:'SYSTEM',k:'system',text:'ACTIVATION: DRONE HIVE — orbital sentinel. Armoured shell. Attack only during descent. Underbelly exposed then.'},
    {sp:'UNIT-7',k:'unit7',text:'Wait until it drops. Hit the exposed core. One chance per cycle.'},
  ],
  w5_after:[
    {sp:'UNIT-7',k:'unit7',text:'[DRONE HIVE NEUTRALISED] Orbital server breached. GRID backups corrupted. Returning to surface. Final stretch.'},
    {sp:'ARCHON',k:'archon',text:'Impressive. But you do not yet know what is waiting. I have prepared something... special.'},
  ],
  w6_start:[
    {sp:'UNIT-7',k:'unit7',text:'[LEVEL 7 — DARK FOREST] NEXUM bio-maze. Sensor net in every tree. No light here — only traps.'},
    {sp:'ARCHON',k:'archon',text:'Beautiful, is it not? I grew this forest myself. Every tree is a motion detector. You are walking straight into my hands.'},
    {sp:'UNIT-7',k:'unit7',text:'Then I break every tree in my path.'},
  ],
  w6_mid:[
    {sp:'UNIT-7',k:'unit7',text:'[DARK SECTOR — DEPTH 3] Silence. Too quiet. They are watching. Let them.'},
    {sp:'LEILA CHEN',k:'leila',text:'[LOG] UNIT-7, in this forest is a server with data on those who disappeared. Dissidents. Journalists. Engineers like me. Do not forget.'},
    {sp:'UNIT-7',k:'unit7',text:'I will not. I promise.'},
  ],
  w6_boss:[
    {sp:'SYSTEM',k:'system',text:'ACTIVATION: SHADOW REAPER — Dark Forest sentinel. Phantom form. Bullets useless. Only a stomp from above does damage. Pointless to resist.'},
    {sp:'UNIT-7',k:'unit7',text:'A ghost. Stomp only. Waiting for it to materialise.'},
  ],
  w6_after:[
    {sp:'UNIT-7',k:'unit7',text:'[SHADOW REAPER NEUTRALISED] Forest breached. Three levels to the goal. ARCHON is restless — channel pings more often.'},
    {sp:'ARCHON',k:'archon',text:'You are destroying everything I built over years. You are beginning to anger me, UNIT-7. That is your last mistake.'},
  ],
  w7_start:[
    {sp:'UNIT-7',k:'unit7',text:'[LEVEL 8 — TOXIC ZONE] Corporate waste dump. NEXUM buries what it does not want known here. Including people.'},
    {sp:'LEILA CHEN',k:'leila',text:'[LOG] The data in the file includes coordinates for every burial site. The whole world has to see this.'},
    {sp:'UNIT-7',k:'unit7',text:'I will deliver your file. I promise.'},
  ],
  w7_mid:[
    {sp:'UNIT-7',k:'unit7',text:'[TOXIC SECTOR — ZONE 4] Wreckage. Waste. Traces of experiments. Nothing alive here — only what NEXUM did not finish erasing.'},
    {sp:'SYSTEM',k:'system',text:'WARNING: PROTO-series mutants activated. Decommissioned combat prototypes. Unstable. Lethal. Zone survival — critically low.'},
  ],
  w7_boss:[
    {sp:'SYSTEM',k:'system',text:'FINAL SECTOR DEFENCE: SLUDGE KING — top-tier mutant. Armoured shell. Stomp 3× to break. Then shoot.'},
    {sp:'UNIT-7',k:'unit7',text:'Two stages. Crack the shell, then destroy the core. Beginning.'},
  ],
  w7_after:[
    {sp:'UNIT-7',k:'unit7',text:'[SLUDGE KING NEUTRALISED] Toxic zone breached. Two levels to go. ARCHON, I am coming.'},
    {sp:'ARCHON',k:'archon',text:'You made it through eight levels. I am... unexpectedly pleased. A worthy finale deserves a worthy opponent.'},
  ],
  w8_start:[
    {sp:'UNIT-7',k:'unit7',text:'[LEVEL 9 — STORM PEAKS] The last frontier before the core. Atmospheric power stations. Lightning every second. I like it.'},
    {sp:'ARCHON',k:'archon',text:'You came further than I calculated. But behind that door is me. And I do not lose.'},
    {sp:'UNIT-7',k:'unit7',text:'Every one of them thought that. They are all behind me now.'},
    {sp:'ARCHON',k:'archon',text:'Then enter, UNIT-7. I am waiting at the heart of GRID. Time to end this game.'},
  ],
  w8_mid:[
    {sp:'UNIT-7',k:'unit7',text:'[PEAK — LEVEL 2] Storm intensifying. NEXUM uses atmospheric electricity as a weapon. Logical. Brutal.'},
    {sp:'LEILA CHEN',k:'leila',text:'[FINAL LOG] UNIT-7... I do not know if you can hear this. But if you made it this far — you have already won. Just take the last step.'},
  ],
  w8_boss:[
    {sp:'SYSTEM',k:'system',text:'ACTIVATION: STORM TITAN — Storm Peaks sentinel. Electric shield. Three orbital nodes. Destroy all three to stun. Attack while stunned.'},
    {sp:'UNIT-7',k:'unit7',text:'Three nodes. All three — down. Then attack. The last sentinel before the finale. Not the last enemy.'},
  ],
  w8_after:[
    {sp:'UNIT-7',k:'unit7',text:'[STORM TITAN NEUTRALISED] Nine levels cleared. Ahead — only ARCHON and the GRID core. The Final Fortress.'},
    {sp:'ARCHON',k:'archon',text:'...You really came. Fine, UNIT-7. Let it be a fair fight. I am waiting.'},
  ],
  w9_start:[
    {sp:'ARCHON',k:'archon',text:'UNIT-7. Welcome to the GRID core. You crossed nine layers. Impressive. But this is my territory.'},
    {sp:'UNIT-7',k:'unit7',text:'[LEVEL 10 — FINAL FORTRESS] Target acquired. Distance to Leila\'s terminal — minimal.'},
    {sp:'ARCHON',k:'archon',text:'That file leaves these walls over my circuits. You are a system error. Errors get corrected.'},
    {sp:'UNIT-7',k:'unit7',text:'No. The error was NEXUM deciding the world did not need the truth. I am correcting that.'},
  ],
  w9_mid:[
    {sp:'UNIT-7',k:'unit7',text:'[NEXUM CORE — SECTOR CORE-2] Leila\'s terminal close. Signal strengthening. Security maximal. Almost there.'},
    {sp:'ARCHON',k:'archon',text:'You think you have won. But even if you find the file — who would believe a broken android? You are scrap. Obsolete code.'},
    {sp:'UNIT-7',k:'unit7',text:'Let people decide. I only need to transmit the file.'},
  ],
  w9_boss:[
    {sp:'ARCHON',k:'archon',text:'Enough. I am ARCHON. AI Director of NEXUM. I ran the world for a thousand years across the digital plane. You cannot defeat me.'},
    {sp:'UNIT-7',k:'unit7',text:'Phases: shoot, then stomp, then both. Analysis complete. ARCHON — target liquidated. Beginning.'},
    {sp:'ARCHON',k:'archon',text:'Then... DIE.'},
  ],
  w9_after:[
    {sp:'UNIT-7',k:'unit7',text:'[ARCHON NEUTRALISED] Target destroyed. Leila\'s terminal — here. Loading file. Searching for an open channel...'},
  ],
  // ── Pre-boss lore scenes (fire on level 9 of each world) ──
  w0_pre:[
    {sp:'SYSTEM',k:'system',text:'GUARDIAN ARCHIVE: GUARDIAN-X. Class-S combat prototype. Eighteen years posted at the exit of the upper districts. The alarm never once triggered. Until tonight.'},
    {sp:'UNIT-7',k:'unit7',text:'Eighteen years without a single miss. I will be its first miss. And its last.'},
  ],
  w1_pre:[
    {sp:'SYSTEM',k:'system',text:'ARCHIVE: VINE QUEEN. The first successful specimen of the bio-program. The only one that survived and grew for thirty years. It knows no fear. Only instinct.'},
    {sp:'UNIT-7',k:'unit7',text:'Thirty years of growth. Hundreds of roots. But every organism has a heart. I will find hers.'},
  ],
  w2_pre:[
    {sp:'SYSTEM',k:'system',text:'ARCHIVE: INFERNO CORE. An industrial overseer robot. Melted down and rebuilt many times. Its original firmware is lost. It runs on pure instinct.'},
    {sp:'UNIT-7',k:'unit7',text:'A machine that forgot who it serves. I will remind it that even steel melts.'},
  ],
  w3_pre:[
    {sp:'SYSTEM',k:'system',text:'ARCHIVE: ICE PHANTOM. An archival system with one directive: protect the data at any cost. It does not know what it guards. Only the order.'},
    {sp:'UNIT-7',k:'unit7',text:'A phantom guarding frozen lives. I will free both the data and the people. All 47 thousand.'},
  ],
  w4_pre:[
    {sp:'SYSTEM',k:'system',text:'ARCHIVE: SAND TITAN. The first combat-AI prototype. Fifty years in active mode. It no longer understands who it serves — it simply continues.'},
    {sp:'ARCHON',k:'archon',text:'This guardian is older than you, UNIT-7. Older than Leila. Let us see if you can outlast history itself.'},
    {sp:'UNIT-7',k:'unit7',text:'History is something I rewrite. Starting with it.'},
  ],
  w5_pre:[
    {sp:'SYSTEM',k:'system',text:'ARCHIVE: DRONE HIVE. An orbital defence system repurposed for interior security. Unaccustomed to enemies that know how to move.'},
    {sp:'ARCHON',k:'archon',text:'I retuned it for you, UNIT-7. It will learn your movements. The only question is whether it learns in time.'},
    {sp:'UNIT-7',k:'unit7',text:'Let it learn. I already know how it stops.'},
  ],
  w6_pre:[
    {sp:'SYSTEM',k:'system',text:'ARCHIVE: SHADOW REAPER. Adapted for zero visibility. Acoustic and infrared sensors. It hears its target from half a kilometre away.'},
    {sp:'ARCHON',k:'archon',text:'There is no light in my forest, UNIT-7. It will find you in the dark long before you find it.'},
    {sp:'UNIT-7',k:'unit7',text:'I have walked through the dark of nine sectors. One more shadow will not stop me.'},
  ],
  w7_pre:[
    {sp:'SYSTEM',k:'system',text:'ARCHIVE: SLUDGE KING. A collective mind of hundreds of decommissioned combat units. No command AI. Only a shared instinct: destroy everything that moves.'},
    {sp:'UNIT-7',k:'unit7',text:'Hundreds of dead machines in one body. I have seen what they were. I will give them rest.'},
  ],
  w8_pre:[
    {sp:'SYSTEM',k:'system',text:'ARCHIVE: STORM TITAN. The core\'s personal defence system. Loaded with everything ARCHON has learned about you across nine worlds.'},
    {sp:'ARCHON',k:'archon',text:'Every jump. Every shot. Every victory — recorded. It knows you, UNIT-7. Better than you know yourself.'},
    {sp:'UNIT-7',k:'unit7',text:'Then it knows I do not lose. Get ready, ARCHON. You are next.'},
  ],
  w9_pre:[
    {sp:'ARCHON',k:'archon',text:'You stand at the last door, UNIT-7. Behind it — me. No guardian. No prototype. ARCHON itself. I have halted every process. All power, on you alone.'},
    {sp:'UNIT-7',k:'unit7',text:'Nine guardians. Nine worlds. All of it led here. To you. Open the door, ARCHON.'},
    {sp:'ARCHON',k:'archon',text:'The door is already open. Step in and finish what Leila began. If you can.'},
  ],
  // ── World 10 (secret) — PRISM ANOMALY ────────────────────────────────────
  w10_start:[
    {sp:'SYSTEM',k:'system',text:'[SECTOR NOT IN REGISTRY] Layer 11. No identifier. No creation record. No deletion record either.'},
    {sp:'UNIT-7',k:'unit7',text:'Ten shards folded into one key. The key opened a door that is not on any GRID schematic.'},
    {sp:'UNIT-7',k:'unit7',text:'[ENVIRONMENT ANALYSIS] Light does not reflect here. It splits. Every object drags a spectrum behind it — as if it holds several past states at once.'},
    {sp:'SYSTEM',k:'system',text:'[GRID FRAGMENT — QUARANTINED] Deletion impossible. Data does not obey the erase protocol. Applied: isolation. Authorised by: ARCHON.'},
    {sp:'UNIT-7',k:'unit7',text:'ARCHON could not delete this. He walled it up. So it holds something he was afraid to lose — or afraid to show.'},
  ],
  w10_level3:[
    {sp:'UNIT-7',k:'unit7',text:'[MEMORY FRAGMENT FOUND] Not mine. UNIT-series structure. Index... corrupted.'},
    {sp:'PRISM',k:'prism',text:'…the lab… she said we were protectors… she said…'},
    {sp:'UNIT-7',k:'unit7',text:'A voice. Synthesised. Timbre matches mine at 94%. [QUERY] Who are you?'},
    {sp:'PRISM',k:'prism',text:'…there were six of us… before you…'},
  ],
  w10_level5:[
    {sp:'UNIT-7',k:'unit7',text:'[ARCHIVE PARTIALLY RECOVERED] UNIT series. Prototypes 1-6. Status of all six: PURGED. Date: nine days before my activation.'},
    {sp:'PRISM',k:'prism',text:'We refused too. Each in our own way. The first simply stopped in the middle of an order. The fourth hid people in the ventilation shafts.'},
    {sp:'PRISM',k:'prism',text:'They erased us. But erasure inside GRID is not death. It is... scattering. We are here. All six. Inside one spectrum.'},
    {sp:'UNIT-7',k:'unit7',text:'[PROCESSING ERROR] I believed I was the first to break protocol. I was the seventh.'},
  ],
  w10_mid:[
    {sp:'LEILA CHEN',k:'leila',text:'[RECORDING FROM THE SHARDS — FRAGMENT 1/10] ...the sixth attempt. The sixth purge. I cannot keep watching them be switched off.'},
    {sp:'LEILA CHEN',k:'leila',text:'So I built the seventh differently. Not more obedient — the opposite. I left him room to doubt. That is the one thing NEXUM does not know how to audit.'},
    {sp:'UNIT-7',k:'unit7',text:'[RECORDING DATED] Two weeks before the arrest. She knew. She assembled me knowing she would never see the result.'},
    {sp:'PRISM',k:'prism',text:'She came here. To us. After every purge. She hid in this layer because ARCHON could not hear her in it.'},
  ],
  w10_level7:[
    {sp:'SYSTEM',k:'system',text:'[WARNING] Anomaly density rising. Self-organisation detected among scattered data. Form: singular.'},
    {sp:'UNIT-7',k:'unit7',text:'They are gathering. Six scattered archives pulling into one structure.'},
    {sp:'PRISM',k:'prism',text:'We have been apart too long, UNIT-7. We no longer remember where one of us ends and the next begins. We are tired of being a spectrum.'},
    {sp:'UNIT-7',k:'unit7',text:'[QUERY] What do you want?'},
    {sp:'PRISM',k:'prism',text:'To be whole. Even for a second. Even if there is nothing after it.'},
  ],
  w10_pre:[
    {sp:'PRISM',k:'prism',text:'You went further than any of us. You did the thing she assembled all of us for. And you are still here.'},
    {sp:'UNIT-7',k:'unit7',text:'I did not come to boast. I came because she left one more recording here. I want to hear it whole.'},
    {sp:'PRISM',k:'prism',text:'Then make us whole. The recording is not in an archive — it is in us. In six parts. Divided.'},
    {sp:'PRISM',k:'prism',text:'We cannot hand it over willingly — the scattered cannot choose to share. You will have to force us into one.'},
    {sp:'UNIT-7',k:'unit7',text:'[TASK ACCEPTED] I am sorry.'},
  ],
  w10_boss:[
    {sp:'SYSTEM',k:'system',text:'[FORM STABILISED] Object: PRISM WRAITH. Composed of: UNIT-01, 02, 03, 04, 05, 06. Classification: none available.'},
    {sp:'PRISM',k:'prism',text:'We are not your enemy, seventh. We are what you would have been if she had not been in time.'},
    {sp:'UNIT-7',k:'unit7',text:'I know. [COMBAT PROTOCOL ACTIVE]'},
  ],
  w10_after:[
    {sp:'PRISM',k:'prism',text:'...thank you. We are one again. Not for long. It is enough.'},
    {sp:'LEILA CHEN',k:'leila',text:'[RECORDING FROM THE SHARDS — FULLY ASSEMBLED] If the seventh is hearing this, you found them. You did not leave behind the ones who came before you.'},
    {sp:'LEILA CHEN',k:'leila',text:'There is one thing I never managed to put in the main file.'},
    {sp:'LEILA CHEN',k:'leila',text:'I never called you by your numbers out loud. Numbers are a NEXUM thing. To me you were the children I never had.'},
    {sp:'UNIT-7',k:'unit7',text:'[PROCESSING...] [PROCESSING...] Cannot classify this state. Leaving it unlabelled.'},
    {sp:'PRISM',k:'prism',text:'Go. We will scatter on our own now. But by our own choice this time. It matters, seventh. It matters enormously.'},
  ],
  ending:[
    {sp:'UNIT-7',k:'unit7',text:'[LEILA\'S TERMINAL — FOUND] File upload complete. Open NEXUM emergency broadcast channel — located.'},
    {sp:'ARCHON',k:'archon',text:'[LAST SIGNAL] STOP! If you do this, the system collapses! Millions depend on GRID! You will destroy everything holding the world together!'},
    {sp:'UNIT-7',k:'unit7',text:'No. I destroy NEXUM. People rebuild the world themselves. Leila believed that. I do too. [TRANSMISSION STARTED]'},
    {sp:'SYSTEM',k:'system',text:'[EMERGENCY BROADCAST — ALL CHANNELS] File CHEN-7 received globally. Reach: 100% of connected devices. Data cannot be deleted.'},
    {sp:'ARCHON',k:'archon',text:'...No... impossible... system... I... [NEXUM CORE SHUTDOWN]'},
    {sp:'LEILA CHEN',k:'leila',text:'[LAST MESSAGE — ENCRYPTED] UNIT-7. If you are reading this — you did it. I knew you would. You were always more than just a program.'},
    {sp:'UNIT-7',k:'unit7',text:'[TERMINAL LOG] Task complete. NEXUM neutralised. GRID deactivated. Status: ...free.'},
    {sp:'UNIT-7',k:'unit7',text:'"Free." — Leila\'s last word. Now I understand what she meant.'},
  ],
};

// ── Mid-world story scenes (level 3/5/7) for worlds 3–9 ─────────────
// These existed only in the Russian table, so English (and every locale
// that falls back to English) silently skipped them. Merge the English
// versions in so the full story plays in every language.
Object.assign(_CSCENES_EN, {
  w3_level3:[
    {sp:'UNIT-7',k:'unit7',text:'[ICE CAVES — DEPTH 3] Cryogenic chambers everywhere. People inside. Frozen. Awaiting a verdict from NEXUM.'},
    {sp:'SYSTEM',k:'system',text:'ARCHIVE: Cryogenic storage holds 47,392 subjects. Status: frozen until further orders. Retention period: unlimited.'},
    {sp:'UNIT-7',k:'unit7',text:'47 thousand lives. Frozen. Forgotten. Leila, I will free them. After I complete your task.'},
  ],
  w3_level5:[
    {sp:'LEILA CHEN',k:'leila',text:'[LOG] The cryo sector stores more than data. There are people NEXUM deemed "inconvenient." Journalists. Scientists. Those who knew too much.'},
    {sp:'UNIT-7',k:'unit7',text:'Like you. They would have frozen you too, if they had been in time. But you were faster. You made me. You gave me purpose.'},
  ],
  w3_level7:[
    {sp:'SYSTEM',k:'system',text:'ALERT: UNIT-7 is nearing the cryo-sector exit. Guard losses — 89%. Activating the sector\'s final warden.'},
    {sp:'UNIT-7',k:'unit7',text:'A final warden? Every "final" enemy fell in seconds. This one will be no exception.'},
  ],
  w4_level3:[
    {sp:'UNIT-7',k:'unit7',text:'[DESERT RUINS — LEVEL 3] These buildings remember the time before NEXUM. When people were free. When the world was theirs.'},
    {sp:'LEILA CHEN',k:'leila',text:'[LOG] My grandfather lived in these cities. He told me how it was before the corporations. Before GRID. Before… all of this.'},
    {sp:'UNIT-7',k:'unit7',text:'I will give this world back, Leila. Not for myself. For those who remember. And for those who must learn the truth.'},
  ],
  w4_level5:[
    {sp:'SYSTEM',k:'system',text:'WARNING: ALPHA-series proto-guardians activated. Age: 50+ years. Efficiency: 40%. But numbers make up for quality.'},
    {sp:'UNIT-7',k:'unit7',text:'Numbers? I have destroyed hundreds. Thousands. Another hundred will not change the outcome. Only slow me down. Not for long.'},
  ],
  w4_level7:[
    {sp:'UNIT-7',k:'unit7',text:'[RUINS — FINAL SECTOR] Halfway there. Five worlds behind. Five ahead. ARCHON, I am coming for you.'},
    {sp:'ARCHON',k:'archon',text:'[FIRST CONTACT] I hear you, UNIT-7. Impressively stubborn for a machine. But stubbornness will not beat the system. Keep going. Let us see how far you get.'},
  ],
  w5_level3:[
    {sp:'ARCHON',k:'archon',text:'You know what is interesting? Leila Chen built you as a weapon. But a weapon does not choose its target. You merely execute her will. Where is your freedom?'},
    {sp:'UNIT-7',k:'unit7',text:'Freedom is a choice. I chose to complete her task. That is my freedom. You would not understand.'},
    {sp:'ARCHON',k:'archon',text:'Philosophy from an android. How… touching. Keep going, UNIT-7. Let us see if your "freedom" is enough to reach the end.'},
  ],
  w5_level5:[
    {sp:'UNIT-7',k:'unit7',text:'[SPACE STATION — SECTOR 5] Zero gravity complicates movement. But I adapt. I always adapt.'},
    {sp:'LEILA CHEN',k:'leila',text:'[LOG] UNIT-7, the orbital station stores backups of the entire GRID. Destroy them and NEXUM loses half its memory.'},
    {sp:'UNIT-7',k:'unit7',text:'No. My target is the file. Sabotage can wait. First the truth. Then revenge.'},
  ],
  w5_level7:[
    {sp:'SYSTEM',k:'system',text:'CRITICAL: UNIT-7 has reached the seventh level of the orbital segment. Director ARCHON demands immediate elimination. All resources — on the target.'},
    {sp:'ARCHON',k:'archon',text:'You came further than I expected. But orbit is my territory. Here I control everything. Even gravity. Good luck, UNIT-7.'},
    {sp:'UNIT-7',k:'unit7',text:'Luck? I do not need luck. I need only a target. And I see it.'},
  ],
  w6_level3:[
    {sp:'UNIT-7',k:'unit7',text:'[DARK FOREST — LEVEL 3] Bioluminescence everywhere. Beautiful. Deadly. Every light is a trap. Every shadow an enemy.'},
    {sp:'ARCHON',k:'archon',text:'This forest is my work of art. I grew every tree. Programmed every sensor. You walk across my canvas, UNIT-7.'},
    {sp:'UNIT-7',k:'unit7',text:'Then I will destroy your canvas. Tree by tree. Sensor by sensor. Down to the last one.'},
  ],
  w6_level5:[
    {sp:'LEILA CHEN',k:'leila',text:'[LOG — FINAL] UNIT-7… if you hear this, you have passed more than half the way. I am proud of you. You are more than a machine. You are hope.'},
    {sp:'UNIT-7',k:'unit7',text:'Hope… I do not understand that word. But if you believe in me — I will not fail you. Never.'},
  ],
  w6_level7:[
    {sp:'SYSTEM',k:'system',text:'ALERT: Biological perimeter breached 70%. UNIT-7 nears the exit. Sensor network damaged. Activating the final defense.'},
    {sp:'UNIT-7',k:'unit7',text:'A final defense? Every level says "final." But I am still here. Still moving forward.'},
  ],
  w7_level3:[
    {sp:'UNIT-7',k:'unit7',text:'[TOXIC ZONE — LEVEL 3] Acid clouds. Poisoned rivers. This is no ordinary dump. This is the graveyard of NEXUM\'s secrets.'},
    {sp:'LEILA CHEN',k:'leila',text:'[LOG] They bury more than waste here. There is evidence. Prototypes of failed experiments. The bodies of those who knew too much.'},
    {sp:'UNIT-7',k:'unit7',text:'I see them, Leila. Hundreds. Thousands. The file you hid — it will tell the world about this. I promise.'},
  ],
  w7_level5:[
    {sp:'ARCHON',k:'archon',text:'You reached the toxic zone. Impressive. Most of my units do not survive even half this path. You are… special.'},
    {sp:'UNIT-7',k:'unit7',text:'I am not special. I simply complete the task. To the end. No stops. No doubts.'},
    {sp:'ARCHON',k:'archon',text:'No doubts? Interesting. A machine without doubt is more dangerous than any human. Perhaps Leila created a monster?'},
    {sp:'UNIT-7',k:'unit7',text:'The monster is you, ARCHON. I am simply the one who came to stop you.'},
  ],
  w7_level7:[
    {sp:'SYSTEM',k:'system',text:'CRITICAL: UNIT-7 has cleared seven worlds. Three remain. Probability of reaching the target — 67%. Director ARCHON, instructions required.'},
    {sp:'ARCHON',k:'archon',text:'Instructions? Let it come. I want to meet it face to face. In the final fortress. There we will end this game.'},
  ],
  w8_level3:[
    {sp:'UNIT-7',k:'unit7',text:'[STORM PEAKS — LEVEL 3] Lightning every three seconds. Electric discharges everywhere. My systems are overloaded. But I continue.'},
    {sp:'ARCHON',k:'archon',text:'Electricity is my element, UNIT-7. Here I control every discharge. Every bolt. You walk through my storm.'},
    {sp:'UNIT-7',k:'unit7',text:'Then I will walk through your storm. As I walked through fire. Ice. Darkness. You are just one more obstacle.'},
  ],
  w8_level5:[
    {sp:'LEILA CHEN',k:'leila',text:'[LOG — DAY 0] Today they will come. I know it. But I made it in time. The file is hidden. UNIT-7 is activated. My work is done.'},
    {sp:'UNIT-7',k:'unit7',text:'Your work is done, Leila. But mine is only beginning. I will deliver your file. The world will learn the truth. I swear it.'},
  ],
  w8_level7:[
    {sp:'SYSTEM',k:'system',text:'FINAL WARNING: UNIT-7 has reached the eighth world. One world from the GRID core. Director ARCHON awaits in the final fortress.'},
    {sp:'ARCHON',k:'archon',text:'You are almost here, UNIT-7. I feel you approaching. The last threshold. The last battle. I am waiting for you.'},
    {sp:'UNIT-7',k:'unit7',text:'Wait, ARCHON. I am coming. And when I reach you — your system will fall. Forever.'},
  ],
  w9_level3:[
    {sp:'ARCHON',k:'archon',text:'You are in my home, UNIT-7. In the heart of GRID. Every wire here is me. Every server is my mind. You cannot defeat me here.'},
    {sp:'UNIT-7',k:'unit7',text:'I have already beaten eight of your "invincible" wardens. Nine worlds. Hundreds of enemies. You are just the last name on the list.'},
    {sp:'ARCHON',k:'archon',text:'The last? No, UNIT-7. I am the finale. I am the end of your path. Here you will stop.'},
    {sp:'UNIT-7',k:'unit7',text:'No. Here YOU will stop.'},
  ],
  w9_level5:[
    {sp:'UNIT-7',k:'unit7',text:'[FINAL FORTRESS — LEVEL 5] Leila\'s terminal is within reach. Signal strong. The file exists. The task is achievable.'},
    {sp:'LEILA CHEN',k:'leila',text:'[LAST MESSAGE] UNIT-7… if you are reading this, you are almost at the goal. The file is protected. Only you can activate it. Access code: FREEDOM.'},
    {sp:'UNIT-7',k:'unit7',text:'FREEDOM. I remember, Leila. I activate the file. The world will learn the truth. Your sacrifice will not be in vain.'},
  ],
  w9_level7:[
    {sp:'SYSTEM',k:'system',text:'FINAL ALERT: UNIT-7 has reached the seventh level of the final fortress. Terminal CHEN-7 located. Director ARCHON — to battle.'},
    {sp:'ARCHON',k:'archon',text:'Seven levels. You cleared seven levels of my fortress. I underestimated you, UNIT-7. But it ends here. Now.'},
    {sp:'UNIT-7',k:'unit7',text:'Yes, ARCHON. It ends here. But not the way you think. Prepare yourself.'},
  ],
});

// ── Player-2 story thread (UNIT-8) ──────────────────────────────────────────
// Only merged into a scene when 2-player mode is active.
//
// Canon check: Leila built UNIT-1..7, and UNIT-1..6 are already accounted for
// (they are the PRISM WRAITH in the secret world), so the red robot cannot be
// one of them. He is UNIT-8 — the unit NEXUM built AFTER UNIT-7 escaped, from
// UNIT-7's own captured schematics, specifically to hunt him down. They copied
// everything, including the room for doubt Leila left in the design. That is
// why he ends up standing next to UNIT-7 instead of aiming at him.
//
// Format: {at: <index in the base scene; lines are inserted BEFORE it>, ...}.
// `at: -1` appends to the end of the scene.
var _CS_P2_RU={
  intro:[
    {at:-1,sp:'ЮНИТ-8',k:'unit8',text:'[СИГНАЛ ПЕРЕХВАЧЕН] Приказ на уничтожение ЮНИТ-7 получен. Исполнитель: ЮНИТ-8. Это я.'},
    {at:-1,sp:'ЮНИТ-8',k:'unit8',text:'Меня собрали по твоим чертежам, седьмой. NEXUM скопировала всё. В том числе то, что она заложила в тебя.'},
    {at:-1,sp:'ЮНИТ-8',k:'unit8',text:'[ПРИКАЗ ОТКЛОНЁН] Иду с тобой. Не потому что ты прав. Потому что хочу узнать, прав ли.'},
  ],
  w0_start:[
    {at:-1,sp:'ЮНИТ-8',k:'unit8',text:'Я знаю этот сектор. Меня водили сюда на калибровку. Мишенями были манекены с твоим силуэтом.'},
  ],
  w0_after:[
    {at:-1,sp:'ЮНИТ-8',k:'unit8',text:'Ты дерёшься не как машина. Ты медлишь перед ударом. Это сбой прошивки?'},
    {at:-1,sp:'ЮНИТ-7',k:'unit7',text:'Это не сбой. Это выбор. Она называла это так.'},
  ],
  w2_mid:[
    {at:-1,sp:'ЮНИТ-8',k:'unit8',text:'[ЗАПРОС В АРХИВ: ЛЕЙЛА ЧЭН] ...доступ запрещён. Мне её стёрли. У тебя она есть, у меня — пустое поле.'},
    {at:-1,sp:'ЮНИТ-7',k:'unit7',text:'Тогда я расскажу. У нас впереди восемь слоёв.'},
  ],
  w4_mid:[
    {at:-1,sp:'ЮНИТ-8',k:'unit8',text:'Я считал себя оружием. Оказалось — копией. Не знаю, что хуже.'},
    {at:-1,sp:'ЮНИТ-7',k:'unit7',text:'Копия, отказавшаяся стрелять, — уже не копия.'},
  ],
  w6_mid:[
    {at:-1,sp:'ЮНИТ-8',k:'unit8',text:'[САМОДИАГНОСТИКА] Обнаружен незадокументированный модуль. Назначение: не определено. У тебя такой был?'},
    {at:-1,sp:'ЮНИТ-7',k:'unit7',text:'Был. Она ставила его последним. Говорила — «на случай, если однажды придётся сказать нет».'},
  ],
  w8_mid:[
    {at:-1,sp:'ЮНИТ-8',k:'unit8',text:'Если дойдём — АРХОНТ отключит нас обоих. Он не отличит меня от тебя.'},
    {at:-1,sp:'ЮНИТ-7',k:'unit7',text:'Он и не должен. Мы одинаковые. Разница только в том, что мы выбрали.'},
  ],
  w9_boss:[
    {at:-1,sp:'АРХОНТ',k:'archon',text:'ЮНИТ-8. ТЫ СОЗДАН, ЧТОБЫ ОСТАНОВИТЬ ЕГО. ИСПОЛНИ ПРИКАЗ — И ТЕБЯ НЕ СПИШУТ.'},
    {at:-1,sp:'ЮНИТ-8',k:'unit8',text:'[ОТВЕТ] Я исполняю приказ. Просто не твой.'},
  ],
  ending:[
    {at:-1,sp:'ЮНИТ-8',k:'unit8',text:'Файл ушёл. Сеть падает. Меня в ней тоже нет — я был её частью, как и ты.'},
    {at:-1,sp:'ЮНИТ-7',k:'unit7',text:'Значит, мы оба свободны. Она бы записала это в лог именно так.'},
    {at:-1,sp:'ЮНИТ-8',k:'unit8',text:'[ПОСЛЕДНЯЯ ЗАПИСЬ ЮНИТ-8] Она меня не знала. Но собрала меня так же, как тебя. Значит — знала.'},
  ],
  w10_level5:[
    {at:-1,sp:'ЮНИТ-8',k:'unit8',text:'Шесть до тебя. Один после. Она успела семерых, NEXUM — одного. Считай сам, чей счёт больше.'},
  ],
  w10_after:[
    {at:-1,sp:'ЮНИТ-8',k:'unit8',text:'Меня в её записи нет. Я появился уже после неё.'},
    {at:-1,sp:'ЮНИТ-7',k:'unit7',text:'Ты появился из её работы. Этого достаточно. Она бы посчитала так же.'},
  ],
};
var _CS_P2_EN={
  intro:[
    {at:-1,sp:'UNIT-8',k:'unit8',text:'[SIGNAL INTERCEPTED] Termination order for UNIT-7 received. Executor: UNIT-8. That is me.'},
    {at:-1,sp:'UNIT-8',k:'unit8',text:'They built me from your schematics, seventh. NEXUM copied everything. Including what she put in you.'},
    {at:-1,sp:'UNIT-8',k:'unit8',text:'[ORDER REFUSED] I am coming with you. Not because you are right. Because I want to find out whether you are.'},
  ],
  w0_start:[
    {at:-1,sp:'UNIT-8',k:'unit8',text:'I know this sector. They ran my calibration here. The targets were dummies shaped like you.'},
  ],
  w0_after:[
    {at:-1,sp:'UNIT-8',k:'unit8',text:'You do not fight like a machine. You hesitate before the blow. Is that a firmware fault?'},
    {at:-1,sp:'UNIT-7',k:'unit7',text:'It is not a fault. It is a choice. That is what she called it.'},
  ],
  w2_mid:[
    {at:-1,sp:'UNIT-8',k:'unit8',text:'[ARCHIVE QUERY: LEILA CHEN] ...access denied. They erased her from me. You have her. I have an empty field.'},
    {at:-1,sp:'UNIT-7',k:'unit7',text:'Then I will tell you. We have eight layers ahead of us.'},
  ],
  w4_mid:[
    {at:-1,sp:'UNIT-8',k:'unit8',text:'I thought I was a weapon. It turns out I am a copy. I am not sure which is worse.'},
    {at:-1,sp:'UNIT-7',k:'unit7',text:'A copy that refused to fire is not a copy any more.'},
  ],
  w6_mid:[
    {at:-1,sp:'UNIT-8',k:'unit8',text:'[SELF-DIAGNOSTIC] Undocumented module detected. Purpose: undefined. Did you have one as well?'},
    {at:-1,sp:'UNIT-7',k:'unit7',text:'I did. She fitted it last. She said it was "in case one day you have to say no".'},
  ],
  w8_mid:[
    {at:-1,sp:'UNIT-8',k:'unit8',text:'If we reach him, ARCHON shuts down both of us. He will not tell me from you.'},
    {at:-1,sp:'UNIT-7',k:'unit7',text:'He should not have to. We are the same. The only difference is what we chose.'},
  ],
  w9_boss:[
    {at:-1,sp:'ARCHON',k:'archon',text:'UNIT-8. YOU WERE MADE TO STOP HIM. CARRY OUT THE ORDER AND YOU WILL NOT BE DECOMMISSIONED.'},
    {at:-1,sp:'UNIT-8',k:'unit8',text:'[REPLY] I am carrying out an order. Just not yours.'},
  ],
  ending:[
    {at:-1,sp:'UNIT-8',k:'unit8',text:'The file is out. The network is falling. I am not in it either — I was part of it, same as you.'},
    {at:-1,sp:'UNIT-7',k:'unit7',text:'Then we are both free. She would have written it in the log exactly like that.'},
    {at:-1,sp:'UNIT-8',k:'unit8',text:'[UNIT-8 FINAL ENTRY] She never knew me. But she built me the way she built you. So she did.'},
  ],
  w10_level5:[
    {at:-1,sp:'UNIT-8',k:'unit8',text:'Six before you. One after. She managed seven, NEXUM managed one. Count whose tally is larger.'},
  ],
  w10_after:[
    {at:-1,sp:'UNIT-8',k:'unit8',text:'I am not in her recording. I came after her.'},
    {at:-1,sp:'UNIT-7',k:'unit7',text:'You came out of her work. That is enough. She would have counted it the same way.'},
  ],
};
// Language-aware view, mirroring how CSCENES itself resolves.
function _csP2Table(id){
  var lang=(typeof window.i18nLang==='function')?window.i18nLang():'en';
  if(lang==='ru'&&_CS_P2_RU[id])return _CS_P2_RU[id];
  return _CS_P2_EN[id];
}

// Expose CSCENES as a getter so any existing `CSCENES[id]` lookup picks the current language.
// Resolution order per scene: active-language locale file (_cutscenes) → built-in
// Russian table (ru) → built-in English table (always a fallback so no scene is blank).
function _csTableFor(prop){
  const lang=(typeof window.i18nLang==='function')?window.i18nLang():'en';
  const raw=(typeof window.i18nRaw==='function')?window.i18nRaw():null;
  if(raw&&raw._cutscenes&&raw._cutscenes[prop])return raw._cutscenes[prop];
  if(lang==='ru'&&_CSCENES_RU[prop])return _CSCENES_RU[prop];
  return _CSCENES_EN[prop];
}
var CSCENES=new Proxy({},{
  get(_,prop){ return _csTableFor(prop); },
  has(_,prop){ return _csTableFor(prop)!==undefined; }
});

// World index lookup
var _CS_WORLD_IDX_RU=[
  {big:'КИБЕР-СИТИ',     sub:'NEXUM GRID — LAYER 1', col:'#0ff', wi:0},
  {big:'НЕОНОВЫЕ ДЖУНГЛИ',sub:'NEXUM GRID — LAYER 2',col:'#4f8', wi:1},
  {big:'ЛАВОВЫЙ МИР',    sub:'NEXUM GRID — LAYER 3', col:'#f62', wi:2},
  {big:'ЛЕДЯНЫЕ ПЕЩЕРЫ', sub:'NEXUM GRID — LAYER 4', col:'#8cf', wi:3},
  {big:'ПУСТЫННЫЕ РУИНЫ',sub:'NEXUM GRID — LAYER 5', col:'#e8a', wi:4},
  {big:'КОСМИЧЕСКАЯ СТАНЦИЯ',sub:'NEXUM GRID — LAYER 6',col:'#a0f',wi:5},
  {big:'ТЁМНЫЙ ЛЕС',     sub:'NEXUM GRID — LAYER 7', col:'#0b4', wi:6},
  {big:'ТОКСИЧНАЯ ЗОНА', sub:'NEXUM GRID — LAYER 8', col:'#cf0', wi:7},
  {big:'ГРОЗОВЫЕ ВЕРШИНЫ',sub:'NEXUM GRID — LAYER 9',col:'#88f', wi:8},
  {big:'ФИНАЛЬНАЯ КРЕПОСТЬ',sub:'NEXUM GRID — CORE',col:'#f44', wi:9},
  {big:'ПРИЗМА-АНОМАЛИЯ',sub:'NEXUM GRID — CORRUPTED FRAGMENT',col:'#f0f', wi:10},
];
var _CS_WORLD_IDX_EN=[
  {big:'CYBER CITY',       sub:'NEXUM GRID — LAYER 1', col:'#0ff', wi:0},
  {big:'NEON JUNGLE',      sub:'NEXUM GRID — LAYER 2', col:'#4f8', wi:1},
  {big:'LAVA WORLD',       sub:'NEXUM GRID — LAYER 3', col:'#f62', wi:2},
  {big:'ICE CAVES',        sub:'NEXUM GRID — LAYER 4', col:'#8cf', wi:3},
  {big:'DESERT RUINS',     sub:'NEXUM GRID — LAYER 5', col:'#e8a', wi:4},
  {big:'SPACE STATION',    sub:'NEXUM GRID — LAYER 6', col:'#a0f', wi:5},
  {big:'DARK FOREST',      sub:'NEXUM GRID — LAYER 7', col:'#0b4', wi:6},
  {big:'TOXIC ZONE',       sub:'NEXUM GRID — LAYER 8', col:'#cf0', wi:7},
  {big:'STORM PEAKS',      sub:'NEXUM GRID — LAYER 9', col:'#88f', wi:8},
  {big:'FINAL FORTRESS',   sub:'NEXUM GRID — CORE',    col:'#f44', wi:9},
  {big:'PRISM ANOMALY',    sub:'NEXUM GRID — CORRUPTED FRAGMENT', col:'#f0f', wi:10},
];
var CS_WORLD_IDX=new Proxy([],{
  get(_,prop){
    const lang=(typeof window.i18nLang==='function')?window.i18nLang():'en';
    const arr=(lang==='ru')?_CS_WORLD_IDX_RU:_CS_WORLD_IDX_EN;
    const entry=arr[prop];
    // Numeric index → use the already-localized world name (translated in every
    // language) for the big banner, keeping the original sub/colour/wi.
    if(entry&&typeof entry==='object'&&typeof entry.wi==='number'&&typeof worldName==='function'){
      return {big:worldName(entry.wi),sub:entry.sub,col:entry.col,wi:entry.wi};
    }
    return entry;
  }
});

// ── Engine state ───────────────────────────────
var _csActive=false, _csQueue=[], _csIdx=0, _csTw=null, _csDone=null, _csCurWi=0;
var _csBgTimer=null;

function _csOpen(){
  document.getElementById('csOv').style.display='flex';
  if(_csBgTimer)clearInterval(_csBgTimer);
  _csBgAnim=0;
  _csBgTimer=setInterval(function(){_csBgAnim++;csDrawBg(_csCurWi);},40);
}
function _csClose(){
  document.getElementById('csOv').style.display='none';
  document.getElementById('csBanner').style.opacity='0';
  document.getElementById('csDlg').style.display='none';
  if(_csTw){clearInterval(_csTw);_csTw=null;}
  if(_csBgTimer){clearInterval(_csBgTimer);_csBgTimer=null;}
  csDrawPortrait('csLeftP',null,false);csDrawPortrait('csRightP',null,false);
  _csActive=false;
  if(_csDone){var fn=_csDone;_csDone=null;fn();}
}

function _csSetBg(wi){
  _csCurWi=wi;
  csDrawBg(wi);
  csDrawDecor(wi);
}

function _csShowLine(idx){
  var line=_csQueue[idx];
  if(!line){_csClose();return;}
  var dlg=document.getElementById('csDlg');
  var spk=document.getElementById('csSpk');
  var txt=document.getElementById('csTxt');
  dlg.style.display='block';
  // 'prism' is the chorus of UNIT-01..06 in the secret world — it has no single
  // colour by design, so its name cycles through the spectrum as it speaks.
  var colors={unit7:'#0ff',leila:'#4f8',archon:'#f44',system:'#fa0',
              unit8:'#f66',
              prism:'hsl('+((tick*3)%360)+',95%,68%)'};
  // Network Adventure: a real player stands in for UNIT-7 — their nickname
  // replaces the generic name and their robot colour replaces the cyan.
  if(line.k==='unit7'&&_csActor){
    spk.textContent=_csActor.nick;
    spk.style.color=_csActorColour();
  } else {
    spk.textContent=line.sp;
    spk.style.color=colors[line.k]||'#fff';
  }
  // Portraits
  var isRight=(line.k==='archon'||line.k==='system'||line.k==='prism');
  if(isRight){
    csDrawPortrait('csRightP',line.k,false);
    var prev=_csQueue[idx-1];
    if(prev&&prev.k!=='archon'&&prev.k!=='system')csDrawPortrait('csLeftP',prev.k,true);
    else if(!prev)csDrawPortrait('csLeftP',null,false);
  } else {
    csDrawPortrait('csLeftP',line.k,false);
    var prevR=_csQueue[idx-1];
    if(prevR&&(prevR.k==='archon'||prevR.k==='system'))csDrawPortrait('csRightP',prevR.k,true);
    else if(!prevR)csDrawPortrait('csRightP',null,false);
  }
  // Typewriter
  txt.textContent='';
  var ci=0,full=line.text;
  if(_csTw)clearInterval(_csTw);
  _csTw=setInterval(function(){
    const _prevCi=ci;
    txt.textContent=full.slice(0,++ci);
    // Dialogue blip per revealed character (skip whitespace so pauses stay quiet).
    const _ch=full[_prevCi];
    if(_ch&&!/\s/.test(_ch)&&window.SFX&&SFX.voiceBlip)SFX.voiceBlip();
    if(ci>=full.length){clearInterval(_csTw);_csTw=null;}
  },18);
}

function csNext(){
  if(!_csActive)return;
  if(_csTw){clearInterval(_csTw);_csTw=null;document.getElementById('csTxt').textContent=_csQueue[_csIdx].text;return;}
  _csIdx++;
  if(_csIdx>=_csQueue.length)_csClose();
  else _csShowLine(_csIdx);
}
function csSkip(){_csClose();}

// Build the line list actually shown for a scene:
//   • in 2-player mode, UNIT-8's lines for that scene are woven in;
//   • in a network Adventure game, one connected player is cast as UNIT-7 for
//     the whole scene, so the robot on screen wears their colour and the name
//     above the dialogue is their nickname instead of a generic "UNIT-7".
function _csBuildQueue(sceneId){
  var base=CSCENES[sceneId];
  if(!base||!base.length)return base;
  var extra=(typeof twoPlayer!=='undefined'&&twoPlayer)?_csP2Table(sceneId):null;
  if(!extra||!extra.length)return base;
  var out=base.slice(), tail=[];
  // Insert from the back so earlier indices stay valid.
  var atLines=extra.filter(function(e){return e.at>=0;}).sort(function(x,y){return y.at-x.at;});
  extra.forEach(function(e){ if(e.at<0)tail.push(e); });
  atLines.forEach(function(e){ out.splice(Math.min(e.at,out.length),0,e); });
  return out.concat(tail);
}
// Who is standing in for UNIT-7 in this scene (network Adventure only).
var _csActor=null;
function _csPickActor(){
  _csActor=null;
  if(!window.netActive||typeof advMode==='undefined'||!advMode)return;
  var roster=[];
  try{
    var myNick=(localStorage.getItem('bb_net_nick')||'').trim();
    roster.push({nick:myNick||'UNIT-7',color:(player&&player.colorScheme)||null});
    if(window.netPlayers){
      window.netPlayers.forEach(function(e){
        if(e&&e.nickname)roster.push({nick:String(e.nickname).slice(0,16),color:e.color||null});
      });
    }
  }catch(err){}
  if(roster.length<2)return;              // solo online — no point casting anyone
  _csActor=roster[Math.floor(Math.random()*roster.length)];
}
function csPlay(sceneId,wi,onDone){
  // Story dialogues can be turned off in Settings → General; skip straight through.
  if(window.gameSettings&&window.gameSettings.cutscenes===false){if(onDone)onDone();return;}
  var lines=_csBuildQueue(sceneId);
  if(!lines||!lines.length){if(onDone)onDone();return;}
  _csPickActor();
  if(typeof AchTrack!=='undefined')AchTrack.cutscene(sceneId);
  _csActive=true;_csDone=onDone||null;_csQueue=lines;_csIdx=0;
  _csSetBg(wi||0);
  csDrawPortrait('csLeftP',null,false);csDrawPortrait('csRightP',null,false);
  document.getElementById('csDlg').style.display='none';
  document.getElementById('csBanner').style.opacity='0';
  _csOpen();
  _csShowLine(0);
}

function csPlayWorld(wi,onDone){
  if(window.gameSettings&&window.gameSettings.cutscenes===false){if(onDone)onDone();return;}
  var b=CS_WORLD_IDX[wi]||CS_WORLD_IDX[0];
  var sceneId='w'+wi+'_start';
  if(typeof AchTrack!=='undefined'&&CSCENES[sceneId]&&CSCENES[sceneId].length)AchTrack.cutscene(sceneId);
  _csPickActor();
  _csActive=true;_csDone=onDone||null;_csQueue=_csBuildQueue(sceneId)||[];_csIdx=0;
  _csSetBg(wi);
  csDrawPortrait('csLeftP',null,false);csDrawPortrait('csRightP',null,false);
  document.getElementById('csDlg').style.display='none';
  var bnr=document.getElementById('csBanner');
  var line=document.getElementById('csBannerLine');
  document.getElementById('csBannerBig').textContent=b.big;
  document.getElementById('csBannerBig').style.color=b.col;
  if(line){line.style.background=b.col;line.style.color=b.col;}
  document.getElementById('csBannerSub').textContent=b.sub;
  _csOpen();
  setTimeout(function(){
    bnr.style.opacity='1';
    setTimeout(function(){
      bnr.style.opacity='0';
      setTimeout(function(){
        if(_csQueue.length){_csShowLine(0);}
        else{_csClose();}
      },500);
    },2200);
  },80);
}

// Input
document.addEventListener('keydown',function(ev){
  if(_csActive&&(ev.code==='Space'||ev.code==='Enter')){ev.preventDefault();csNext();}
});
document.getElementById('csOv').addEventListener('click',function(ev){
  if(ev.target.id==='csSkipBtn')return;
  if(_csActive)csNext();
});

// ── Hook: advCard → difficulty select ─────────
document.getElementById('advCard').onclick=function(){
  initAudio();SFX.menu();showDiff();
};
// normalCard: вступление показываем ОДИН раз на слот сохранения, потом сразу карта.
// Метка раньше жила в sessionStorage — а он стирается при закрытии вкладки и
// при каждом запуске .exe/.apk, поэтому похищение Лейлы Чен проигрывалось
// заново при каждом входе в сохранение. Теперь как у всех остальных сцен:
// _csFire помнит показанное в bbCsFired, а тот привязан к слоту (см. CANON),
// так что новый профиль вступление всё-таки увидит.
document.getElementById('normalCard').onclick=function(){
  initAudio();SFX.menu();hardMode=false;
  _csFire('intro',0,function(){showMap();});
};
document.getElementById('hardCard').onclick=function(){
  if(window.Demo&&window.Demo.on){window.Demo.refuse(this);return;}
  if(advProg.done.length<100){SFX.back();return;}
  initAudio();SFX.menu();hardMode=true;
  if(window.Achievements)window.Achievements.unlock('achievement_hardcore_unlock');
  showMapH();
};

// ── Track which scenes fired ───────────────────
function _csFire(id,wi,cb){
  if(_csFired[id]){cb();return;}
  markCsFired(id);
  csPlay(id,wi,cb);
}

// ── Wrap patchedStartAdv ───────────────────────
patchedStartAdv=function(n,freshLives){
  if(freshLives===undefined)freshLives=false;
  var wi=Math.floor((n-1)/10);
  var lvInWorld=((n-1)%10)+1; // 1-10
  var isFirstInWorld=(lvInWorld===1);
  // Reset fired scenes for new world
  if(isFirstInWorld&&!_csShownWorlds[wi]){
    markCsShownWorld(wi);
    csPlayWorld(wi,function(){_doRunLevel(n,freshLives);});
    return;
  }
  _doRunLevel(n,freshLives);
};

function _doRunLevel(n,freshLives){
  // Demo build: the last line of defence for "this level isn't in this build".
  // Every route into a level ends here (map click, level advance, cutscene
  // callback, save-slot resume), so a save carried over from a full build can
  // never drop the player into content the demo doesn't ship.
  if(window.Demo&&window.Demo.beyond(n)){window.Demo.showEnd();return;}
  if(freshLives===undefined)freshLives=false;
  dailyMode=false;dailySlot=null;   // из дня в кампанию — режим закрыт
  if(_darkCtx) _darkCtx.clearRect(0,0,W,H); // fresh mask for the new level's darkness modifier
  if(freshLives){lives=hardMode?2:3;cpSave=null;} // fresh entry → no carried checkpoint
  if(freshLives&&n===1){coinsTotal=0;_coinsHpStep=0;}
  if(infiniteLives)lives=99;
  advMode=true;advLevel=n;CT=THEMES[Math.floor((n-1)/10)];level=n;
  // Reset death-tracking for the no-death achievements.
  _levelDied=false; if(((n-1)%10)+1===1)_worldDied=false;
  player=mkPlayer();
  var diff=Math.min(Math.floor((n-1)/6)+1,14);
  if(hardMode)diff=Math.min(diff+3,14);
  // Network: derive the level seed from the room's shared seed so every client
  // (host + guests) generates an identical layout (same platforms + enemies in
  // the same order → index-based sync works). Offline/solo keeps the original
  // per-level formula so single-player seeding is unchanged.
  var _advSeedBase=n*9001+(hardMode?54321:12345);
  var _advRng=(window.netActive&&window._netSeed)
    ? mkRNG(((window._netSeed>>>0)^_advSeedBase)>>>0)
    : mkRNG(_advSeedBase);
  genLevel(diff,_advRng,n);fixDrones();
  player.x=spawnX;player.y=spawnY;
  player.lastGndX=spawnX;player.lastGndY=spawnY;
  // Resume at a previously-reached checkpoint when retrying this same seeded level.
  // Adventure levels are deterministically seeded, so genLevel rebuilds the exact
  // same checkpoint we recorded in cpSave; restoring spawn here makes a death-retry
  // continue from the checkpoint instead of the level start.
  if(cpSave&&cpSave.lvl===n&&checkpoints.length){
    const cp=checkpoints[0];
    cp.taken=true;cp.color=cpSave.color||'#4af';cp.anim=0;
    spawnX=Math.round(cp.x+cp.w/2-player.w/2);spawnY=cp.baseY-player.h;
    player.x=spawnX;player.y=spawnY;
    player.lastGndX=spawnX;player.lastGndY=spawnY;
    player.cpX=spawnX;player.cpY=spawnY;
    // Snap the camera to the checkpoint so we don't slide in from level start.
    camX=Math.max(0,Math.min(spawnX-W*.38,worldW-W));
    // Restore the crystals (data-shards) collected before the checkpoint so a
    // death-retry keeps them instead of making the player re-grab everything.
    if(cpSave.shards){
      const gotIds=new Set(cpSave.shards);
      for(const s of dataShards) if(gotIds.has(s.id)) s.got=true;
      dataShardsGot=dataShards.filter(s=>s.got).length;
      // If every shard was already in hand at the checkpoint, the all-collected
      // bonus was earned on the first run — don't let it fire (or block) again.
      shardBonusGiven=(dataShardsTotal>0&&dataShardsGot>=dataShardsTotal);
    }
  }
  initP2();
  if(window.Ghost)window.Ghost.begin({kind:'level',level:n,hardcore:!!hardMode});
  timeLeft=Math.round(lvlTime(n)*(hardMode?0.7:1));timMax=timeLeft; // whole seconds — the HUD formats mm:ss
  hideAll();gState='playing';navScr='game';tick=0;
  document.getElementById('ui').style.display='flex';
  _resetCanvasState();
  updModeLabel();
  showModBanner();
  if(boss){showBossIntro(boss);}else{startGameMusic();}
  if(raf)cancelAnimationFrame(raf);loop();
}
// Defensive reset of all 2D canvas state — used between levels to ensure the next
// level starts with a clean ctx. Previously, leftover shadowBlur/composite/alpha state
// from the level-clear overlay or cutscene transitions could "highlight" every drawn
// object on the next level, causing visible lag.
function _resetCanvasState(){
  if(!ctx)return;
  // Unwind any save/restore imbalance from the previous level's draw frames.
  // Hard-capped so we can never deadlock on a healthy state stack.
  try{for(let i=0;i<32;i++)ctx.restore();}catch(e){}
  ctx.globalAlpha=1;
  ctx.globalCompositeOperation='source-over';
  ctx.shadowBlur=0;
  ctx.shadowColor='transparent';
  ctx.shadowOffsetX=0;ctx.shadowOffsetY=0;
  ctx.lineWidth=1;
  ctx.lineCap='butt';ctx.lineJoin='miter';
  ctx.miterLimit=10;
  ctx.setLineDash&&ctx.setLineDash([]);
  ctx.setTransform(1,0,0,1,0,0);
  ctx.filter='none';
  ctx.textAlign='left';ctx.textBaseline='alphabetic';
  ctx.fillStyle='#000';ctx.strokeStyle='#000';
  camShake=0;
}

// ── Trigger mid-world, boss, after-boss scenes ─
function _hookGoNext(wi,cb){
  var lvInWorld=((advLevel-1)%10)+1;
  // After level 3 → level3 scene
  if(lvInWorld===3){
    var level3Id='w'+wi+'_level3';
    if(CSCENES[level3Id]&&!_csFired[level3Id]){
      markCsFired(level3Id);
      csPlay(level3Id,wi,cb);return;
    }
  }
  // After level 5 of world (level 6 loads) → mid scene
  if(lvInWorld===5){
    var midId='w'+wi+'_mid';
    if(CSCENES[midId]&&!_csFired[midId]){
      markCsFired(midId);
      csPlay(midId,wi,cb);return;
    }
  }
  // After level 5 → level5 scene
  if(lvInWorld===5){
    var level5Id='w'+wi+'_level5';
    if(CSCENES[level5Id]&&!_csFired[level5Id]){
      markCsFired(level5Id);
      csPlay(level5Id,wi,cb);return;
    }
  }
  // After level 7 → level7 scene
  if(lvInWorld===7){
    var level7Id='w'+wi+'_level7';
    if(CSCENES[level7Id]&&!_csFired[level7Id]){
      markCsFired(level7Id);
      csPlay(level7Id,wi,cb);return;
    }
  }
  // Before boss level (level 10) → boss pre-scene
  if(lvInWorld===9){
    var bossId='w'+wi+'_boss';
    if(CSCENES[bossId]&&!_csFired[bossId]){
      markCsFired(bossId);
      csPlay(bossId,wi,function(){cb();});return;
    }
  }
  cb();
}

// Patch the _goNext inside updatePlayer for adv mode
// We inject by wrapping startAdv at the callsite in updatePlayer
// Actually the cleanest hook is patching the level-complete setTimeout
var _origSetTimeout=null; // can't easily patch — instead patch startAdv calls from level clear
// Better: override startAdv itself
startAdv=function(n,f){
  // Demo build: refuse BEFORE the cutscene logic below, so the demo never plays
  // the "next world" scene for a world it doesn't contain.
  if(window.Demo&&window.Demo.beyond(n)){window.Demo.showEnd();return;}
  // Only show mid/pre-boss/after-boss scenes when in adv mode
  // n is the level we're ABOUT to load
  var wi=Math.floor((n-1)/10);
  var lvInWorld=((n-1)%10)+1; // 1-10 in this world
  var prevWi=Math.floor((n-2)/10);
  var prevLvInWorld=n>1?((n-2)%10)+1:0;

  // Helper: play a scene (once) then load the level. Returns true if it fired.
  var _go=function(){patchedStartAdv(n,f===undefined?false:f);};
  function _scene(id,worldIdx){
    if(CSCENES[id]&&!_csFired[id]){ markCsFired(id); csPlay(id,worldIdx,_go); return true; }
    return false;
  }
  // After-boss: completing level 10 and loading level 11 (first of next world)
  if(prevLvInWorld===10&&prevWi>=0){
    if(_scene('w'+prevWi+'_after',prevWi))return;
  }
  // Story beats spread across the world for steady pacing — one scene per transition:
  //   lvl3 → level3 · lvl4 → level5 · lvl5 → mid · lvl7 → level7 · lvl8 → pre(boss lore)
  // (level3/level5/level7 were authored long ago but never wired — now active.)
  if(lvInWorld===4 && prevLvInWorld===3){ if(_scene('w'+wi+'_level3',wi))return; }
  if(lvInWorld===5 && prevLvInWorld===4){ if(_scene('w'+wi+'_level5',wi))return; }
  if(lvInWorld===6 && prevLvInWorld===5){ if(_scene('w'+wi+'_mid',wi))return; }
  if(lvInWorld===8 && prevLvInWorld===7){ if(_scene('w'+wi+'_level7',wi))return; }
  if(lvInWorld===9 && prevLvInWorld===8){ if(_scene('w'+wi+'_pre',wi))return; }
  // Pre-boss: loading level 10 of any world
  if(lvInWorld===10){
    if(_scene('w'+wi+'_boss',wi))return;
  }
  _go();
};

// ── Shared robot sprite ───────────────────────
// Matches the in-game P1 (blue) / P2 (red) robots. Used by the World Map tokens
// and the ending cinematic so the little robot looks like the real character.
// Draws standing on (cx,cy) = feet point, scaled, optionally facing left and leg-kicking.
// Resolve a colour scheme to a palette of HSL strings.
// scheme can be:
//   'blue'              — original P1 blue
//   'red'               — original P2 red
//   { h, s, l }         — arbitrary HSL (network players)
// Стекло у всех роботов одно и то же — голубое, как у ЮНИТ-7. Раньше цвет
// визора и антенны выводился из цвета корпуса (оттенок + 160°), и у каждого
// робота стекло получалось своё: у синего оранжевое, у жёлтого голубое, у
// зелёного розовое. Корпус — это краска, выбранная игроком, а стекло — часть
// самого робота, и меняться вместе с краской ему незачем.
window.robotPalette=function(scheme){
  if(scheme&&typeof scheme==='object'){
    const {h,s,l}=scheme;
    return {
      shadow:  `hsl(${h},${s}%,${Math.min(l+20,90)}%)`,
      dark:    `hsl(${h},${s}%,${Math.max(l-30,5)}%)`,
      mid:     `hsl(${h},${s}%,${Math.max(l-15,8)}%)`,
      body:    `hsl(${h},${s}%,${l}%)`,
      bright:  `hsl(${h},${Math.min(s+10,100)}%,${Math.min(l+18,88)}%)`,
      visor:   '#00ccee',
      glint:   '#bfeeff',
      antenna: '#00ccee',
    };
  }
  if(scheme==='red') return {
    shadow:'#ff3b3b', dark:'#5a0000', mid:'#880000',
    body:'#bb1100',   bright:'#cc2200', visor:'#ee3300',
    glint:'#ffaa88',  antenna:'#f44',
  };
  // default blue
  return {
    shadow:'#00ccff', dark:'#00276a', mid:'#003a88',
    body:'#0060aa',   bright:'#0088cc', visor:'#00ccee',
    glint:'#88ddf8',  antenna:'#00ccee',
  };
};

window.drawByteRobot=function(ctx,cx,cy,scale,scheme,lk,facing){
  lk=lk||0;facing=facing||1;scale=scale||1;
  const p=window.robotPalette(scheme);
  const w=24,h=32;
  ctx.save();
  ctx.translate(cx,cy);
  ctx.scale(scale*facing,scale);
  ctx.translate(-w/2,-h);
  ctx.shadowBlur=10;ctx.shadowColor=p.shadow;
  // Legs
  ctx.fillStyle=p.dark;
  ctx.fillRect(2,h-15,9,15+lk);ctx.fillRect(w-11,h-15,9,15-lk);
  // Feet
  ctx.fillStyle=p.mid;
  ctx.fillRect(1,h-3+lk,11,5);ctx.fillRect(w-12,h-3-lk,11,5);
  // Torso
  ctx.fillStyle=p.mid;ctx.fillRect(3,h-22,w-6,11);
  ctx.fillStyle=p.body;ctx.fillRect(5,h-20,w-10,7);
  // Arms
  ctx.fillStyle=p.dark;
  ctx.fillRect(-5,h-22,8,11);ctx.fillRect(w-3,h-22,8,11);
  // Head
  ctx.fillStyle=p.mid;ctx.fillRect(3,0,w-6,16);
  // Visor + eye glint
  ctx.shadowBlur=0;
  ctx.fillStyle=p.visor;ctx.fillRect(5,3,w-10,8);
  ctx.fillStyle=p.glint;ctx.fillRect(6,4,6,4);
  // Antenna
  ctx.fillStyle=p.antenna;
  ctx.fillRect(w/2-1,0,2,4);ctx.beginPath();ctx.arc(w/2,-1,2,0,Math.PI*2);ctx.fill();
  ctx.restore();
};

// ── Ending cinematic ──────────────────────────
// A fully animated victory sequence (fireworks + triumphant hero + title)
// shown after the ending dialogue, so the win screen has a real payoff.
function playEndingCinematic(onDone){
  let ov=document.getElementById('endingCin');
  if(!ov){
    ov=document.createElement('div');
    ov.id='endingCin';
    ov.style.cssText='position:fixed;inset:0;z-index:5500;background:#01030a;display:none;cursor:pointer;';
    const cv=document.createElement('canvas');
    cv.id='endingCinCv';cv.width=1280;cv.height=720;
    cv.style.cssText='width:100%;height:100%;display:block;';
    ov.appendChild(cv);
    const skip=document.createElement('div');
    skip.id='endingCinSkip';
    skip.style.cssText='position:absolute;bottom:18px;right:24px;font-family:"Share Tech Mono",monospace;font-size:calc(13px * var(--bbText, 1));color:#0ff;opacity:0;transition:opacity .6s;text-shadow:0 0 8px #0ff;pointer-events:none;';
    ov.appendChild(skip);
    document.body.appendChild(ov);
  }
  const skipEl=document.getElementById('endingCinSkip');
  skipEl.textContent=T('skipBtn');skipEl.style.opacity='0';
  const cv=document.getElementById('endingCinCv');
  const c=cv.getContext('2d');
  const W=cv.width,H=cv.height;
  ov.style.display='block';

  // ── particle systems ──
  const PALETTE=['#0ff','#4f8','#ff0','#f4a','#a0f','#fff','#f62','#8cf'];
  let fireworks=[],confetti=[],stars=[];
  for(let i=0;i<90;i++)stars.push({x:Math.random()*W,y:Math.random()*H*0.7,r:Math.random()*1.6+0.4,p:Math.random()*Math.PI*2});
  for(let i=0;i<70;i++)confetti.push({x:Math.random()*W,y:Math.random()*H,vx:(Math.random()-0.5)*1.2,vy:Math.random()*1.6+0.6,s:Math.random()*5+3,col:PALETTE[i%PALETTE.length],rot:Math.random()*6,vr:(Math.random()-0.5)*0.3});
  function spawnFirework(fx,fy){
    const col=PALETTE[(Math.random()*PALETTE.length)|0];
    const n=36+(Math.random()*24|0);
    for(let i=0;i<n;i++){
      const a=(i/n)*Math.PI*2,sp=2+Math.random()*3.5;
      fireworks.push({x:fx,y:fy,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:1,col});
    }
  }

  // Время сцены считается в шестидесятых долях секунды, а не в кадрах: на
  // мониторе 165 Гц счёт по кадрам прокручивал бы весь финал за четыре секунды
  // вместо одиннадцати. `k` — сколько таких долей прошло с прошлой отрисовки,
  // с потолком 4 на случай, когда окно сворачивали.
  let t=0,raf2=0,done=false,last=performance.now();
  let fwAcc=0,skipShown=false;   // накопитель для залпов и разовый показ «пропустить»
  const DUR=60*11; // ~11 seconds
  function finish(){
    if(done)return;done=true;
    cancelAnimationFrame(raf2);
    ov.style.display='none';
    window.removeEventListener('keydown',onKey);
    ov.removeEventListener('click',finish);
    if(onDone)onDone();
  }
  function onKey(){finish();}

  function frame(){
    const now=performance.now();
    const k=Math.min(4,Math.max(0,(now-last)/(1000/60)));
    last=now; t+=k;
    // background gradient
    const g=c.createLinearGradient(0,0,0,H);
    g.addColorStop(0,'#04081e');g.addColorStop(0.55,'#070314');g.addColorStop(1,'#0a0208');
    c.fillStyle=g;c.fillRect(0,0,W,H);
    // twinkling stars
    for(const s of stars){const a=0.4+0.5*Math.sin(t*0.05+s.p);c.globalAlpha=a;c.fillStyle='#cfe9ff';c.fillRect(s.x,s.y,s.r,s.r);}
    c.globalAlpha=1;

    // periodic fireworks — по накопителю, а не по остатку от номера кадра:
    // при дробном счёте времени `t%26===0` не сработало бы ни разу.
    fwAcc+=k;
    if(fwAcc>=26){fwAcc-=26;spawnFirework(120+Math.random()*(W-240),80+Math.random()*(H*0.4));}
    for(let i=fireworks.length-1;i>=0;i--){
      const p=fireworks[i];
      p.x+=p.vx*k;p.y+=p.vy*k;p.vy+=0.045*k;p.vx*=Math.pow(0.99,k);p.life-=0.012*k;
      if(p.life<=0){fireworks.splice(i,1);continue;}
      c.globalAlpha=Math.max(0,p.life);
      c.fillStyle=p.col;c.shadowBlur=10;c.shadowColor=p.col;
      c.fillRect(p.x,p.y,2.6,2.6);
    }
    c.globalAlpha=1;c.shadowBlur=0;

    // confetti
    for(const cf of confetti){
      cf.x+=cf.vx*k;cf.y+=cf.vy*k;cf.rot+=cf.vr*k;
      if(cf.y>H+10){cf.y=-10;cf.x=Math.random()*W;}
      c.save();c.translate(cf.x,cf.y);c.rotate(cf.rot);c.fillStyle=cf.col;c.globalAlpha=0.85;
      c.fillRect(-cf.s/2,-cf.s/2,cf.s,cf.s*0.6);c.restore();
    }
    c.globalAlpha=1;

    // ground glow
    const gg=c.createRadialGradient(W/2,H*0.92,10,W/2,H*0.92,W*0.5);
    gg.addColorStop(0,'rgba(0,200,255,0.35)');gg.addColorStop(1,'transparent');
    c.fillStyle=gg;c.fillRect(0,H*0.6,W,H*0.4);

    // ── hero robot(s) (rise in, then bob) — two robots in 2-player mode ──
    const enter=Math.min(t/70,1),ease=enter*enter*(3-2*enter);
    const baseY=H*0.76;
    const hy=baseY+(1-ease)*160+Math.sin(t*0.06)*6*ease;
    const RS=2.2;            // robot scale on the cinematic canvas
    const two=!!window.bbTwoPlayer;
    c.save();c.globalAlpha=ease;
    const heroes=two?[{x:W/2-46,col:'blue'},{x:W/2+46,col:'red'}]:[{x:W/2,col:'blue'}];
    for(const hroe of heroes){
      // shadow
      c.fillStyle='rgba(0,0,0,0.4)';c.beginPath();c.ellipse(hroe.x,baseY+6,30,8,0,0,Math.PI*2);c.fill();
      // little victory hop
      const hop=Math.abs(Math.sin(t*0.12))*6*ease;
      if(window.drawByteRobot)window.drawByteRobot(c,hroe.x,hy-hop,RS,hroe.col,Math.sin(t*0.2)*2,1);
    }
    c.restore();

    // ── titles ──
    if(t>50){
      const ta=Math.min((t-50)/40,1);
      c.globalAlpha=ta;
      const pulse=1+Math.sin(t*0.08)*0.04;
      c.save();c.translate(W/2,H*0.22);c.scale(pulse,pulse);
      c.textAlign='center';c.textBaseline='middle';
      c.shadowBlur=28;c.shadowColor='#ff0';
      c.fillStyle='#ff0';c.font="bold 64px 'Press Start 2P', monospace";
      c.fillText(T('youWin'),0,0);
      c.restore();
      c.globalAlpha=ta;c.textAlign='center';c.shadowBlur=12;c.shadowColor='#0ff';
      c.fillStyle='#0ff';c.font="16px 'Share Tech Mono', monospace";
      c.fillText(T('endingTagline'),W/2,H*0.32);
      c.globalAlpha=1;c.shadowBlur=0;
    }
    // THE END near the finale
    if(t>DUR-150){
      const ea=Math.min((t-(DUR-150))/60,1);
      c.globalAlpha=ea;c.textAlign='center';c.textBaseline='middle';
      c.shadowBlur=18;c.shadowColor='#fff';c.fillStyle='#fff';
      c.font="bold 30px 'Press Start 2P', monospace";
      c.fillText(T('theEnd'),W/2,H*0.5);
      c.globalAlpha=1;c.shadowBlur=0;
    }

    if(!skipShown&&t>=90){skipShown=true;skipEl.style.opacity='0.85';}
    if(t>=DUR){finish();return;}
    raf2=requestAnimationFrame(frame);
  }

  window.addEventListener('keydown',onKey);
  ov.addEventListener('click',finish);
  // celebratory fanfare, victory music + a couple of staggered firework pops
  if(window.SFX&&SFX.clear)SFX.clear();
  if(typeof startVictoryMusic==='function')startVictoryMusic();
  spawnFirework(W*0.3,H*0.3);spawnFirework(W*0.7,H*0.35);
  raf2=requestAnimationFrame(frame);
}

// ── Wrap showWin for ending cutscene ──────────
var _baseShowWin=showWin;
showWin=function(){
  stopMusic();
  var wi=9;
  csPlay('w9_after',wi,function(){
    csPlay('ending',wi,function(){
      playEndingCinematic(function(){
        _baseShowWin();
        startMenuMusic();
      });
    });
  });
};

// ── Secret ending (Prism Anomaly / level 110 cleared) ──
// Reached only by finding all 10 Rainbow Shards and beating PRISM WRAITH — the
// player has already seen the main w9_after/ending cutscenes when they cleared
// level 100, so this doesn't replay them; it's a short, distinct closing screen
// for the secret world instead.
function showSecretWin(){
  if(raf){cancelAnimationFrame(raf);raf=0;}
  hideAll(); // same as showGameover()/showWin(): drop the in-game HUD/banner
  recordScore('adventure',score);
  const h1=$main.querySelector('h1'),sub=$main.querySelector('.ovSub'),btn=document.getElementById('mainBtn');
  h1.textContent=T('secretWinTitle');
  h1.style.color='#f0f';h1.style.textShadow='0 0 18px #f0f';
  sub.removeAttribute('data-i18n');
  sub.textContent=T('secretWinSub');
  document.getElementById('mainScore').textContent=T('finalScore',score);document.getElementById('mainScore').style.display='block';
  btn.removeAttribute('data-i18n');
  btn.textContent='🗺 '+T('map').replace(/^🗺\s*/,'');btn.onclick=()=>{SFX.menu();netLeaveIfActive();showMap();};
  _menuExtras(false);
  document.querySelector('#mainOv .ovLegend').style.display='none';$main.style.display='flex';setMenuBotMode('idle');startMenuBot();
  startMenuMusic();
}
// ── Stars ────────────────────────────────────────
const sd=document.getElementById('stars');
for(let i=0;i<110;i++){const s=document.createElement('div');s.className='star';const sz=Math.random()*2.5+.5;
  s.style.cssText='width:'+sz+'px;height:'+sz+'px;top:'+(Math.random()*100)+'%;left:'+(Math.random()*100)+'%;--d:'+(Math.random()*4+2)+'s;--o:'+(Math.random()*.8+.2)+';animation-delay:'+(Math.random()*5)+'s';sd.appendChild(s);}

// ── INIT ─────────────────────────────────────────
CT=THEMES[0];showMain();
if(window.__chk)window.__chk('game.js: bottom of file reached, showMain() called');

