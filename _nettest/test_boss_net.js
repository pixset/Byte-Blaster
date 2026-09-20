// Integration test: a guest's boss-damage reports (hit_boss / hit_boss_part) are
// forwarded by the embedded relay to the host, and NOT echoed back to the sender.
//   Run: node _nettest/test_boss_net.js
const { startLocalRelay } = require('../local-server.js');
const crypto = require('crypto');
const net = require('net');

// Minimal WS client (text frames, masked) — same shape as test_flow.js.
function wsClient(port) {
  return new Promise((resolve) => {
    const key = crypto.randomBytes(16).toString('base64');
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write('GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        'Sec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
    });
    let buf = Buffer.alloc(0), open = false; const handlers = [];
    const api = {
      send: (o) => {
        const p = Buffer.from(JSON.stringify(o)); const m = crypto.randomBytes(4);
        const masked = Buffer.allocUnsafe(p.length); for (let i = 0; i < p.length; i++) masked[i] = p[i] ^ m[i & 3];
        let h; if (p.length < 126) { h = Buffer.from([0x81, 0x80 | p.length]); }
        else { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0x80 | 126; h.writeUInt16BE(p.length, 2); }
        sock.write(Buffer.concat([h, m, masked]));
      },
      on: (fn) => handlers.push(fn),
    };
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!open) { const i = buf.indexOf('\r\n\r\n'); if (i < 0) return; buf = buf.slice(i + 4); open = true; resolve(api); }
      while (buf.length >= 2) {
        const op = buf[0] & 0x0f; let len = buf[1] & 0x7f; let off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        if (buf.length < off + len) return;
        const pl = buf.slice(off, off + len); buf = buf.slice(off + len);
        if (op === 0x1) { try { const msg = JSON.parse(pl.toString()); handlers.forEach(h => h(msg)); } catch {} }
      }
    });
  });
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const { port } = await startLocalRelay({ port: 0 });
  const results = {};

  const host = await wsClient(port);
  const guest = await wsClient(port);
  let code = null;
  const hostEvents = [];
  const guestEvents = [];

  host.on(m => { if (m.type === 'room_created') code = m.code; if (m.type === 'game_event') hostEvents.push(m); });
  guest.on(m => { if (m.type === 'game_event') guestEvents.push(m); });

  await wait(80);
  host.send({ type: 'create_room', nickname: 'HOST', color: { h: 0, s: 90, l: 52 }, isPublic: true, maxPlayers: 2 });
  await wait(80);
  guest.send({ type: 'join_room', code, nickname: 'GUEST', color: { h: 222, s: 90, l: 56 } });
  await wait(120);

  // Guest reports a boss body hit (fire bullet) and an orb destruction.
  guest.send({ type: 'game_event', event: 'hit_boss', data: { dmg: 1, elem: 'fire' } });
  guest.send({ type: 'game_event', event: 'hit_boss_part', data: { kind: 'orb', idx: 2 } });
  await wait(150);

  const hb = hostEvents.find(e => e.event === 'hit_boss');
  const hp = hostEvents.find(e => e.event === 'hit_boss_part');
  results.host_got_hit_boss      = !!(hb && hb.data && hb.data.dmg === 1 && hb.data.elem === 'fire');
  results.host_got_hit_boss_part = !!(hp && hp.data && hp.data.kind === 'orb' && hp.data.idx === 2);
  results.guest_not_echoed       = guestEvents.length === 0; // sender is excluded from broadcast

  console.log(JSON.stringify(results, null, 2));
  const ok = Object.values(results).every(Boolean);
  console.log(ok ? '\n✅ ALL BOSS-NET CHECKS PASS' : '\n❌ SOME CHECKS FAILED');
  process.exit(ok ? 0 : 1);
})();
