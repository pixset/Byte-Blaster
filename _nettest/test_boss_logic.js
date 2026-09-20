// Unit tests for the boss-fix logic. These pull the ACTUAL function bodies out of
// assets/game.js / assets/network.js and execute them against stubbed globals, so
// we exercise the shipped code rather than a re-implementation.
//   Run: node _nettest/test_boss_logic.js
// (intentionally NOT strict mode: direct eval() must leak the extracted function
//  declarations into this scope so we can call the shipped code.)
const fs = require('fs');
const path = require('path');

const gameSrc = fs.readFileSync(path.join(__dirname, '..', 'assets', 'game.js'), 'utf8');
const netSrc  = fs.readFileSync(path.join(__dirname, '..', 'assets', 'network.js'), 'utf8');

// Slice a brace-balanced block starting at the first `{` after `startIdx`.
function balancedFrom(src, startIdx) {
  const open = src.indexOf('{', startIdx);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(startIdx, j + 1); }
  }
  throw new Error('unbalanced block from ' + startIdx);
}
function extractFunction(src, name) {
  const m = new RegExp('function\\s+' + name + '\\s*\\(').exec(src);
  if (!m) throw new Error('function not found: ' + name);
  return balancedFrom(src, m.index);
}
function extractIfBlock(src, needle) {
  const i = src.indexOf(needle);
  if (i < 0) throw new Error('block not found: ' + needle);
  return balancedFrom(src, i);
}

const results = {};
function check(name, cond) { results[name] = !!cond; }

// Shared stubs ----------------------------------------------------------------
function aabb(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
const SFX = { hit(){}, enemyDie(){}, stomp(){}, secret(){}, clear(){} };
function burst(){} function floatTxt(){}
const CT = { mc: '#0ff', clr: '#fff' };
function T(k){ return k; }

let reports = [];
let boss = null;
let pBullets = [];
// Mirror of the network.js damageBoss wrapper: on a guest it reports, on host it applies.
function damageBoss(dmg) {
  if (global.window.netActive && !global.window.netIsHost) {
    global.window.netReportBossHit(dmg, boss ? boss._netHitElem || null : null);
    return;
  }
  boss.hp -= dmg;
  if (boss.hp <= 0) boss.alive = false;
}
global.window = {
  netActive: false, netIsHost: false,
  netReportBossHit: (dmg, elem) => reports.push({ kind: 'hit_boss', dmg, elem }),
  netReportBossPart: (k, idx) => reports.push({ kind: 'hit_boss_part', part: k, idx }),
};

// Bring the real _bossBulletContact into scope (direct eval → defines in this scope).
eval(extractFunction(gameSrc, '_bossBulletContact'));

function mkBoss(extra) {
  return Object.assign({ x: 200, y: 100, w: 60, h: 60, hp: 5, alive: true }, extra);
}
function reset() { reports = []; pBullets = []; }

// ── BUG #1: guest can damage a bullet-weakness boss ──────────────────────────
global.window.netActive = true; global.window.netIsHost = false;
reset();
boss = mkBoss({ weaknessType: 'bullet' });
pBullets = [{ x: 220, y: 120, w: 8, h: 8, type: null }];
_bossBulletContact();
check('guest_bullet_boss_reports_hit', reports.length === 1 && reports[0].kind === 'hit_boss');
check('guest_bullet_consumed', pBullets.length === 0);
check('guest_no_local_hp_change', boss.hp === 5); // host owns hp

// ── Elemental tag is forwarded ───────────────────────────────────────────────
reset();
boss = mkBoss({ weaknessType: 'bullet' });
pBullets = [{ x: 220, y: 120, w: 8, h: 8, type: 'fire' }];
_bossBulletContact();
check('guest_fire_bullet_forwards_elem', reports.length === 1 && reports[0].elem === 'fire');

// ── Gating: window boss closed → no damage; open → damage ────────────────────
reset();
boss = mkBoss({ weaknessType: 'window', windowOpen: false });
pBullets = [{ x: 220, y: 120, w: 8, h: 8, type: null }];
_bossBulletContact();
check('guest_window_closed_no_report', reports.length === 0);
check('guest_window_closed_bullet_consumed', pBullets.length === 0);

reset();
boss = mkBoss({ weaknessType: 'window', windowOpen: true });
pBullets = [{ x: 220, y: 120, w: 8, h: 8, type: null }];
_bossBulletContact();
check('guest_window_open_reports', reports.length === 1 && reports[0].kind === 'hit_boss');

// ── Gating: twoStage / descent / nodes now driven by synced fields ───────────
reset();
boss = mkBoss({ weaknessType: 'twoStage', shellBroken: false });
pBullets = [{ x: 220, y: 120, w: 8, h: 8, type: null }];
_bossBulletContact();
check('guest_twoStage_intact_no_report', reports.length === 0);

reset();
boss = mkBoss({ weaknessType: 'nodes', stunTimer: 0, nodes: [] });
pBullets = [{ x: 220, y: 120, w: 8, h: 8, type: null }];
_bossBulletContact();
check('guest_nodes_unstunned_no_report', reports.length === 0);

reset();
boss = mkBoss({ weaknessType: 'nodes', stunTimer: 120, nodes: [] });
pBullets = [{ x: 220, y: 120, w: 8, h: 8, type: null }];
_bossBulletContact();
check('guest_nodes_stunned_reports', reports.length === 1);

// ── Orb destruction reports a part hit by index ──────────────────────────────
reset();
// orb at angle 0, dist 40 → ox = 200+30+40-8 = 262, oy = 100+30-8 = 122 (outside body)
boss = mkBoss({ weaknessType: 'shields', shieldsDown: false, orbs: [{ alive: true, angle: 0, dist: 40 }] });
pBullets = [{ x: 264, y: 124, w: 8, h: 8, type: null }];
_bossBulletContact();
check('guest_orb_hit_reports_part', reports.length === 1 && reports[0].kind === 'hit_boss_part' && reports[0].part === 'orb' && reports[0].idx === 0);

// ── HOST mode: damage is applied locally, nothing reported ───────────────────
global.window.netActive = false; global.window.netIsHost = false;
reset();
boss = mkBoss({ weaknessType: 'bullet', hp: 3 });
pBullets = [{ x: 220, y: 120, w: 8, h: 8, type: null }];
_bossBulletContact();
check('host_bullet_applies_local_dmg', boss.hp === 2 && reports.length === 0);

// ── HOST hit_boss_part handler (real block from network.js) ──────────────────
(() => {
  const blockSrc = extractIfBlock(netSrc, "if(isHost && msg.event === 'hit_boss_part'");
  const isHost = true;
  boss = { alive: true, orbs: [{ alive: true }, { alive: true }], nodes: [{ alive: true }] };
  let msg = { event: 'hit_boss_part', data: { kind: 'orb', idx: 1 } };
  eval(blockSrc);
  check('host_part_handler_kills_orb', boss.orbs[1].alive === false && boss.orbs[0].alive === true);
  msg = { event: 'hit_boss_part', data: { kind: 'node', idx: 0 } };
  eval(blockSrc);
  check('host_part_handler_kills_node', boss.nodes[0].alive === false && boss.nodes[0].flashT === 20);
})();

// ── BUG #2: pendulum draw guard against non-finite values ────────────────────
(() => {
  let crgCalls = 0, crgArgs = null;
  const ctxTarget = {
    createRadialGradient(...a) {
      for (const v of a) if (!Number.isFinite(v)) throw new TypeError('non-finite createRadialGradient');
      crgCalls++; crgArgs = a; return { addColorStop() {} };
    },
    createLinearGradient() { return { addColorStop() {} }; },
  };
  const ctx = new Proxy(ctxTarget, {
    get(t, p) { return (p in t) ? t[p] : () => {}; },
    set(t, p, v) { t[p] = v; return true; },
  });
  const tick = 10, GFX = { glow: 1 };
  function bloom() {}
  eval(extractFunction(gameSrc, 'drawHazardExtra'));

  // Sanity: the stubbed ctx really throws on non-finite (mirrors the browser).
  let stubThrows = false;
  try { ctxTarget.createRadialGradient(NaN, 0, 1, 0, 0, 5); } catch (e) { stubThrows = true; }
  check('crg_stub_rejects_nonfinite', stubThrows);

  // Bad hazard (bx/by undefined, like before updateHazards ran) → guard must skip.
  crgCalls = 0;
  let threw = false;
  try { drawHazardExtra({ type: 'pendulum', r: 12, pivotX: 100, pivotY: 50 }); }
  catch (e) { threw = true; }
  check('pendulum_undefined_no_throw', threw === false);
  check('pendulum_undefined_skips_gradient', crgCalls === 0);

  // Good hazard → gradient drawn with finite args, no throw.
  crgCalls = 0; threw = false;
  try { drawHazardExtra({ type: 'pendulum', r: 12, pivotX: 100, pivotY: 50, ang: 0, bx: 100, by: 120 }); }
  catch (e) { threw = true; }
  check('pendulum_finite_no_throw', threw === false);
  check('pendulum_finite_draws_gradient', crgCalls === 1 && crgArgs.every(Number.isFinite));
})();

// ── Source assertions: the fixes are present in the shipped files ────────────
check('src_pendulum_seeded_bxby', /type:'pendulum'[^}]*bx:pivotX[^}]*by:pivotY\+len/.test(gameSrc));
check('src_pendulum_finite_guard', /if\(!isFinite\(hz\.bx\)\|\|!isFinite\(hz\.by\)\|\|!isFinite\(hz\.r\)\)break;/.test(gameSrc));
check('src_loop_try_catch', /try\{\s*draw\(\);updateHUD\(\);\s*\}\s*catch/.test(gameSrc));
check('src_guest_runs_bullet_contact', /_bossBulletContact\(\);\s*\/\/ shots/.test(gameSrc));
check('src_bosssync_sends_gatefields', /descending:\s*!!boss\.descending/.test(netSrc) && /stunTimer:\s*boss\.stunTimer\|0/.test(netSrc));
check('src_bosssync_applies_gatefields', /boss\.descending = !!b\.descending/.test(netSrc));
check('src_netReportBossPart', /window\.netReportBossPart\s*=\s*function/.test(netSrc));

// ── Report ───────────────────────────────────────────────────────────────────
console.log(JSON.stringify(results, null, 2));
const failed = Object.entries(results).filter(([, v]) => !v).map(([k]) => k);
if (failed.length) { console.log('\n❌ FAILED: ' + failed.join(', ')); process.exit(1); }
console.log('\n✅ ALL BOSS-LOGIC CHECKS PASS (' + Object.keys(results).length + ')');
