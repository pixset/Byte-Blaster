/**
 * Byte Blaster — LAN relay protocol test suite.
 *
 * Boots the embedded zero-dependency relay (../local-server.js) on an ephemeral
 * port, then drives it with real browser-style WebSocket clients (the `ws`
 * library sends masked client frames, exactly like a browser) to verify:
 *   - the hand-rolled RFC6455 framing (handshake, masking, 16-bit lengths),
 *   - the full room/lobby/game protocol and host failover.
 *
 * Run:  node relay.test.js
 */
'use strict';
const WebSocket = require('ws');
const { startLocalRelay } = require('../local-server');

let PASS = 0, FAIL = 0;
function ok(cond, name) {
  if (cond) { PASS++; console.log('  \u2713 ' + name); }
  else { FAIL++; console.log('  \u2717 FAIL: ' + name); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// A thin client that records every message it receives, keyed by type.
function client(url) {
  const ws = new WebSocket(url);
  const inbox = [];
  ws.on('message', (d) => { try { inbox.push(JSON.parse(d.toString())); } catch (e) {} });
  ws._inbox = inbox;
  ws.sendJ = (o) => ws.send(JSON.stringify(o));
  ws.sendRaw = (s) => ws.send(s);
  ws.waitOpen = () => new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  // Wait until a message of `type` arrives (after an optional baseline index).
  ws.wait = async (type, timeoutMs = 1500, fromIdx = 0) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      for (let i = fromIdx; i < inbox.length; i++) if (inbox[i].type === type) return inbox[i];
      await sleep(10);
    }
    return null;
  };
  ws.count = (type) => inbox.filter(m => m.type === type).length;
  return ws;
}

async function main() {
  const { server, port } = await startLocalRelay({ port: 0, host: '127.0.0.1' });
  const URL = 'ws://127.0.0.1:' + port;
  console.log('Relay up on ' + URL + '\n');

  // ── 1. Connect handshake (validates the hand-written WS upgrade) ──────────
  console.log('[1] Connection + welcome');
  const A = client(URL); await A.waitOpen();
  const B = client(URL); await B.waitOpen();
  const ca = await A.wait('connected');
  const cb = await B.wait('connected');
  ok(ca && typeof ca.id === 'string', 'A receives connected{id}');
  ok(ca && ca.maxPlayers === 5, 'connected.maxPlayers === 5');
  ok(cb && cb.id && cb.id !== ca.id, 'B gets a distinct id');

  // ── 2. create_room ────────────────────────────────────────────────────────
  console.log('[2] create_room');
  A.sendJ({ type: 'create_room', nickname: 'HOSTY', color: { h: 0, s: 90, l: 52 }, isPublic: true, maxPlayers: 5 });
  const rc = await A.wait('room_created');
  ok(rc && /^[A-Z2-9]{6}$/.test(rc.code), 'room_created.code is 6 safe chars');
  ok(rc && rc.players.length === 1 && rc.players[0].isHost, 'host is in players[] and isHost');
  const CODE = rc.code;

  // ── 3. join_room + player_joined broadcast ────────────────────────────────
  console.log('[3] join_room');
  const baseA = A._inbox.length;
  B.sendJ({ type: 'join_room', code: CODE, nickname: 'GUESTY', color: { h: 222, s: 90, l: 56 } });
  const rj = await B.wait('room_joined');
  ok(rj && rj.code === CODE && rj.players.length === 2, 'B room_joined with 2 players');
  ok(rj && rj.hostId === rc.id, 'room_joined.hostId is the host');
  const pj = await A.wait('player_joined', 1500, baseA);
  ok(pj && pj.player.nickname === 'GUESTY', 'host sees player_joined(GUESTY)');

  // ── 4. set_color broadcast ────────────────────────────────────────────────
  console.log('[4] set_color');
  const baseA2 = A._inbox.length;
  B.sendJ({ type: 'set_color', color: { h: 135, s: 78, l: 45 } });
  const cc = await A.wait('color_changed', 1500, baseA2);
  ok(cc && cc.color.h === 135, 'host sees color_changed(h:135)');

  // ── 5. set_ready ──────────────────────────────────────────────────────────
  console.log('[5] set_ready');
  const baseA3 = A._inbox.length;
  B.sendJ({ type: 'set_ready', ready: true });
  const rch = await A.wait('ready_changed', 1500, baseA3);
  ok(rch && rch.players.find(p => p.nickname === 'GUESTY').ready === true, 'GUESTY shows ready');

  // ── 6. start_game (host only) ─────────────────────────────────────────────
  console.log('[6] start_game + not_host guard');
  const baseB = B._inbox.length;
  B.sendJ({ type: 'start_game' });           // guest cannot start
  const nh = await B.wait('error', 800, baseB);
  ok(nh && nh.reason === 'not_host', 'guest start_game → error not_host');
  A.sendJ({ type: 'select_level', mode: 'infinite', level: 3, seed: 12345 });
  await A.wait('level_selected');
  A.sendJ({ type: 'start_game' });
  const gsA = await A.wait('game_started');
  const gsB = await B.wait('game_started');
  ok(gsA && gsB, 'both clients get game_started');
  ok(gsA && gsA.seed === 12345 && gsA.level === 3, 'game_started carries shared seed+level');

  // ── 7. game_state relay (powerup fields) ──────────────────────────────────
  console.log('[7] game_state relay');
  const baseA4 = A._inbox.length;
  B.sendJ({ type: 'game_state', x: 100, y: 50, vx: 1, vy: 0, facing: 1, action: 'run', hp: 3, fireMode: true, blaster: true });
  const ps = await A.wait('player_state', 1500, baseA4);
  ok(ps && ps.x === 100 && ps.fireMode === true && ps.blaster === true, 'host receives B player_state with powerups');
  ok(ps && ps.id === rj.id, 'player_state tagged with sender id');

  // ── 8. host-authoritative sync gating ─────────────────────────────────────
  console.log('[8] enemies_sync authority');
  const baseB2 = B._inbox.length;
  // Build a big payload (200 enemies) to exercise the 16-bit length frame path.
  const enemies = Array.from({ length: 200 }, (_, i) => ({ x: i, y: i, vx: 0, hp: 3, al: 1, fl: 0, fz: 0, bn: 0, sh: 0, t: 'walk' }));
  A.sendJ({ type: 'enemies_sync', enemies });
  const es = await B.wait('enemies_sync', 1500, baseB2);
  ok(es && es.enemies.length === 200, 'guest receives 200-enemy sync (16-bit frame OK)');
  const baseA5 = A._inbox.length;
  B.sendJ({ type: 'enemies_sync', enemies });  // guest is NOT authoritative
  await sleep(200);
  ok(A.wait && (await A.wait('enemies_sync', 200, baseA5)) === null, 'guest enemies_sync is ignored (not relayed to host)');

  // ── 9. game_event + chat + ping ───────────────────────────────────────────
  console.log('[9] game_event / chat / ping');
  const baseB3 = B._inbox.length;
  A.sendJ({ type: 'game_event', event: 'coin', data: { n: 1 } });
  const ge = await B.wait('game_event', 1500, baseB3);
  ok(ge && ge.event === 'coin' && ge.id === rc.id, 'guest receives host game_event(coin)');
  const baseB4 = B._inbox.length;
  A.sendJ({ type: 'chat', text: 'hello <b>x</b>' });
  const ch = await B.wait('chat', 1500, baseB4);
  ok(ch && ch.text.indexOf('<') === -1, 'chat is sanitized (no angle brackets)');
  const baseA6 = A._inbox.length;
  A.sendJ({ type: 'ping' });
  const pong = await A.wait('pong', 1500, baseA6);
  ok(pong && typeof pong.ts === 'number', 'ping → pong{ts}');

  // ── 10. list_rooms ─────────────────────────────────────────────────────────
  console.log('[10] list_rooms (in-game rooms hidden)');
  const C = client(URL); await C.waitOpen(); await C.wait('connected');
  // The CODE room was started in step [6], so it is in-game and must NOT be listed.
  C.sendJ({ type: 'create_room', nickname: 'OPEN1', isPublic: true, maxPlayers: 4 });
  const rcOpen = await C.wait('room_created');
  const E = client(URL); await E.waitOpen(); await E.wait('connected');
  E.sendJ({ type: 'list_rooms' });
  const rl = await E.wait('rooms_list');
  ok(rl && Array.isArray(rl.rooms) && rl.rooms.some(r => r.code === rcOpen.code), 'joinable public room appears in rooms_list');
  ok(rl && !rl.rooms.some(r => r.code === CODE), 'in-game room is HIDDEN from rooms_list');

  // ── 11. invalid_json ────────────────────────────────────────────────────────
  console.log('[11] invalid_json');
  const baseC = C._inbox.length;
  C.sendRaw('{not json');
  const ij = await C.wait('error', 800, baseC);
  ok(ij && ij.reason === 'invalid_json', 'malformed message → error invalid_json');

  // ── 12. room_full ───────────────────────────────────────────────────────────
  console.log('[12] room_full (maxPlayers cap)');
  const H = client(URL); await H.waitOpen(); await H.wait('connected');
  H.sendJ({ type: 'create_room', nickname: 'CAP', isPublic: false, maxPlayers: 2 });
  const rc2 = await H.wait('room_created');
  const G1 = client(URL); await G1.waitOpen(); await G1.wait('connected');
  G1.sendJ({ type: 'join_room', code: rc2.code, nickname: 'G1' });
  await G1.wait('room_joined');
  const G2 = client(URL); await G2.waitOpen(); await G2.wait('connected');
  G2.sendJ({ type: 'join_room', code: rc2.code, nickname: 'G2' });
  const full = await G2.wait('error');
  ok(full && full.reason === 'room_full' && full.max === 2, 'third join → room_full(max:2)');

  // ── 13. host failover on leave (promoted_to_host) ────────────────────────────
  console.log('[13] host promotion on host disconnect');
  const baseB5 = B._inbox.length;
  A.close();
  const promo = await B.wait('promoted_to_host', 2000, baseB5);
  ok(promo, 'remaining player promoted_to_host when host leaves');

  // ── 14. room_not_found ───────────────────────────────────────────────────────
  console.log('[14] room_not_found');
  const D = client(URL); await D.waitOpen(); await D.wait('connected');
  D.sendJ({ type: 'join_room', code: 'ZZZZZZ', nickname: 'X' });
  const nf = await D.wait('error');
  ok(nf && nf.reason === 'room_not_found', 'join unknown code → room_not_found');

  // ── done ─────────────────────────────────────────────────────────────────────
  // ── 15. start_game requires ALL players ready ──
  console.log('[15] start_game blocked until everyone is ready');
  const RH = client(URL); await RH.waitOpen(); await RH.wait('connected');
  RH.sendJ({ type: 'create_room', nickname: 'RH', isPublic: false, maxPlayers: 2 });
  const rrc = await RH.wait('room_created');
  const RG = client(URL); await RG.waitOpen(); await RG.wait('connected');
  RG.sendJ({ type: 'join_room', code: rrc.code, nickname: 'RG' });
  await RG.wait('room_joined');
  const baseRH = RH._inbox.length;
  RH.sendJ({ type: 'start_game' });                 // guest not ready yet
  const nar = await RH.wait('error', 800, baseRH);
  ok(nar && nar.reason === 'not_all_ready', 'host start blocked while a player is not ready');
  RG.sendJ({ type: 'set_ready', ready: true });
  await RH.wait('ready_changed');
  const baseRH2 = RH._inbox.length;
  RH.sendJ({ type: 'start_game' });                 // now everyone ready
  const gst = await RH.wait('game_started', 1500, baseRH2);
  ok(gst, 'host can start once every player is ready');

  for (const c of [A, B, C, D, E, H, G1, G2, RH, RG]) { try { c.close(); } catch (e) {} }
  await sleep(100);
  server.close();

  console.log('\n──────────────────────────────');
  console.log(`RESULT: ${PASS} passed, ${FAIL} failed`);
  console.log('──────────────────────────────');
  process.exit(FAIL ? 1 : 0);
}

main().catch((e) => { console.error('Test harness crashed:', e); process.exit(2); });
