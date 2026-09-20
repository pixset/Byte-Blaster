/**
 * Byte Blaster — Embedded LAN Relay Server (zero-dependency)
 * ----------------------------------------------------------
 * Same wire protocol as "Byte Blaster Server/server.js", but written with ONLY
 * Node built-ins (http + crypto) so it can be bundled inside the Electron app
 * and started automatically. This is what makes the in-game "LOCAL" room source
 * work: the app spins this up on ws://0.0.0.0:3000 so the host (and other players
 * on the same Wi-Fi/LAN) can create and join rooms without any external server.
 *
 * Pure relay: no game logic lives here. It manages rooms and forwards messages.
 *   - Host machine runs this automatically (started from main.js).
 *   - Same machine reaches it at  ws://localhost:3000
 *   - LAN peers reach it at       ws://<host-LAN-ip>:3000
 *
 * Run standalone for testing:  node local-server.js
 */
'use strict';

const http   = require('http');
const crypto = require('crypto');

const MAX_PLAYERS     = 5;
const ROOM_TTL_MS     = 1000 * 60 * 60; // empty rooms close after 1 hour
const HOST_TIMEOUT_MS = 6000;           // host-freeze failover window
const WS_GUID         = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// ── Minimal RFC 6455 WebSocket connection ──────────────────────────────────
// Wraps a raw TCP socket. Decodes client frames (masked) and encodes server
// frames (unmasked). Supports text, ping/pong and close, with continuation
// frames reassembled. Game messages are small JSON, but enemies_sync can reach
// a few KB, so 16- and 64-bit payload lengths are handled.
const OPEN = 1, CLOSING = 2, CLOSED = 3;

class WSConn {
  constructor(socket) {
    this.socket    = socket;
    this.readyState = OPEN;
    this._buf      = Buffer.alloc(0);
    this._handlers = { message: [], close: [], error: [] };
    this._fragOp   = 0;
    this._fragData = [];

    socket.on('data',  (d) => this._onData(d));
    socket.on('close', ()  => this._fire('close'));
    socket.on('error', (e) => { this._fire('error', e); });
  }

  on(ev, fn) { if (this._handlers[ev]) this._handlers[ev].push(fn); return this; }
  _fire(ev, arg) {
    if (ev === 'close' && this.readyState === CLOSED) return;
    if (ev === 'close') this.readyState = CLOSED;
    for (const fn of this._handlers[ev] || []) { try { fn(arg); } catch (e) { /* swallow */ } }
  }

  _onData(chunk) {
    this._buf = Buffer.concat([this._buf, chunk]);
    // Parse as many complete frames as the buffer holds.
    while (true) {
      if (this._buf.length < 2) return;
      const b0 = this._buf[0], b1 = this._buf[1];
      const fin    = (b0 & 0x80) !== 0;
      const opcode =  b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;

      if (len === 126) {
        if (this._buf.length < off + 2) return;
        len = this._buf.readUInt16BE(off); off += 2;
      } else if (len === 127) {
        if (this._buf.length < off + 8) return;
        const hi = this._buf.readUInt32BE(off);
        const lo = this._buf.readUInt32BE(off + 4);
        len = hi * 0x100000000 + lo; off += 8;
        if (len > 50 * 1024 * 1024) { this.close(); return; } // sanity cap
      }

      let mask = null;
      if (masked) {
        if (this._buf.length < off + 4) return;
        mask = this._buf.slice(off, off + 4); off += 4;
      }
      if (this._buf.length < off + len) return; // wait for full payload

      let payload = this._buf.slice(off, off + len);
      if (masked) {
        const out = Buffer.allocUnsafe(len);
        for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3];
        payload = out;
      }
      this._buf = this._buf.slice(off + len);

      // Control frames
      if (opcode === 0x8) { this.close(); return; }          // close
      if (opcode === 0x9) { this._sendFrame(0xA, payload); continue; } // ping → pong
      if (opcode === 0xA) { continue; }                       // pong (ignore)

      // Data frames (text 0x1 / binary 0x2 / continuation 0x0)
      if (opcode === 0x0) {
        this._fragData.push(payload);
      } else {
        this._fragOp = opcode;
        this._fragData = [payload];
      }
      if (fin) {
        const full = Buffer.concat(this._fragData);
        this._fragData = [];
        // Treat both text and binary as UTF-8 JSON.
        this._fire('message', full.toString('utf8'));
      }
    }
  }

  _sendFrame(opcode, data) {
    if (this.readyState !== OPEN) return;
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 127;
      header.writeUInt32BE(Math.floor(len / 0x100000000), 2);
      header.writeUInt32BE(len >>> 0, 6);
    }
    header[0] = 0x80 | opcode; // FIN + opcode (server frames are unmasked)
    try { this.socket.write(Buffer.concat([header, payload])); }
    catch (e) { this._fire('error', e); }
  }

  send(str) { this._sendFrame(0x1, str); }

  close() {
    if (this.readyState === CLOSED) return;
    if (this.readyState !== CLOSING) {
      this.readyState = CLOSING;
      try { this._sendFrame(0x8, Buffer.alloc(0)); } catch (e) { /* ignore */ }
    }
    try { this.socket.end(); } catch (e) { /* ignore */ }
    this._fire('close');
  }
}

// ── Relay state + protocol (mirrors Byte Blaster Server/server.js) ──────────
function createRelay() {
  const rooms = new Map();

  function makeRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do { code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }
    while (rooms.has(code));
    return code;
  }
  function makePlayerId() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

  function send(ws, msg) { if (ws && ws.readyState === OPEN) ws.send(JSON.stringify(msg)); }
  function broadcast(room, msg, excludeId = null) {
    for (const [id, entry] of room.players) if (id !== excludeId) send(entry.ws, msg);
  }
  function playerList(room) {
    return Array.from(room.players.values()).map(p => ({
      id: p.id, nickname: p.nickname, color: p.color, ready: p.ready, isHost: p.id === room.hostId,
    }));
  }
  function roomSummary(room) {
    return {
      code: room.code, isPublic: room.isPublic,
      playerCount: room.players.size, maxPlayers: room.maxPlayers || MAX_PLAYERS,
      mode: room.selectedMode || null, level: room.selectedLevel || null,
      hostName: (room.players.get(room.hostId) || {}).nickname || '?',
    };
  }
  function findRoom(playerId) {
    for (const room of rooms.values()) if (room.players.has(playerId)) return room;
    return null;
  }
  function sanitize(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[<>&"']/g, '').trim().slice(0, 24);
  }
  function validColor(c) {
    if (!c || typeof c !== 'object') return { h: 0, s: 90, l: 52 }; // default = red (rainbow preset 0)
    return {
      h: Math.round(Math.min(360, Math.max(0, Number(c.h) || 0))),
      s: Math.round(Math.min(100, Math.max(0, Number(c.s) || 0))),
      l: Math.round(Math.min(100, Math.max(0, Number(c.l) || 0))),
    };
  }

  function removePlayer(playerId, immediate = false) {
    for (const [code, room] of rooms) {
      if (!room.players.has(playerId)) continue;
      const leaving = room.players.get(playerId);
      room.players.delete(playerId);
      room.lastActivity = Date.now();
      if (room.players.size === 0) {
        // Explicit leave deletes at once; disconnect keeps the 5s grace.
        if (immediate) { rooms.delete(code); return; }
        setTimeout(() => {
          if (rooms.has(code) && rooms.get(code).players.size === 0) rooms.delete(code);
        }, 5000);
        return;
      }
      if (room.hostId === playerId) {
        room.hostId = room.players.keys().next().value;
        send(room.players.get(room.hostId).ws, { type: 'promoted_to_host' });
      }
      broadcast(room, { type: 'player_left', id: playerId, players: playerList(room) });
      return;
    }
  }

  function reassignHost(room, reason) {
    let next = null;
    for (const [id, entry] of room.players) {
      if (id === room.hostId) continue;
      if (!next || entry.joinedAt < next.joinedAt) next = entry;
    }
    if (!next) return;
    room.hostId = next.id;
    room.lastHostMsg = Date.now();
    send(next.ws, { type: 'promoted_to_host' });
    broadcast(room, { type: 'host_changed', hostId: room.hostId, reason: reason || 'timeout', players: playerList(room) });
  }
  function checkHostTimeouts() {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (!room.inGame || room.players.size < 2) continue;
      if (now - (room.lastHostMsg || 0) > HOST_TIMEOUT_MS) reassignHost(room, 'timeout');
    }
  }

  function handleMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { send(ws, { type: 'error', reason: 'invalid_json' }); return; }
    const { type } = msg;

    if (type === 'list_rooms') {
      const list = [];
      for (const room of rooms.values())
        // Hide in-game rooms (can't be joined) and empty rooms (a just-vacated
        // room lingers under the grace timer and would show as a phantom 0/N).
        if (room.isPublic && !room.inGame && room.players.size > 0 && room.players.size < (room.maxPlayers || MAX_PLAYERS)) list.push(roomSummary(room));
      send(ws, { type: 'rooms_list', rooms: list });
      return;
    }

    if (type === 'create_room') {
      const code = makeRoomCode();
      const id = ws._playerId || makePlayerId();
      ws._playerId = id;
      const maxPlayers = Math.max(2, Math.min(MAX_PLAYERS, parseInt(msg.maxPlayers) || MAX_PLAYERS));
      const room = {
        code, isPublic: !!msg.isPublic, maxPlayers, players: new Map(),
        createdAt: Date.now(), lastActivity: Date.now(), hostId: id,
      };
      room.players.set(id, {
        id, ws, nickname: sanitize(msg.nickname) || 'Player 1',
        color: validColor(msg.color), ready: false, joinedAt: Date.now(),
      });
      rooms.set(code, room);
      send(ws, { type: 'room_created', code, id, isPublic: room.isPublic, maxPlayers: room.maxPlayers, players: playerList(room) });
      return;
    }

    if (type === 'join_room') {
      const code = (msg.code || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) { send(ws, { type: 'error', reason: 'room_not_found' }); return; }
      const cap = room.maxPlayers || MAX_PLAYERS;
      if (room.players.size >= cap) { send(ws, { type: 'error', reason: 'room_full', max: cap }); return; }
      const id = ws._playerId || makePlayerId();
      ws._playerId = id;
      const entry = {
        id, ws, nickname: sanitize(msg.nickname) || `Player ${room.players.size + 1}`,
        color: validColor(msg.color), ready: false, joinedAt: Date.now(),
      };
      room.players.set(id, entry);
      room.lastActivity = Date.now();
      send(ws, { type: 'room_joined', code, id, hostId: room.hostId, maxPlayers: cap, players: playerList(room) });
      broadcast(room, { type: 'player_joined', player: { id, nickname: entry.nickname, color: entry.color, ready: false, isHost: false }, players: playerList(room) }, id);
      return;
    }

    // Explicit leave: drop the player and delete an emptied room at once.
    if (type === 'leave_room') { removePlayer(ws._playerId, true); return; }

    const room = findRoom(ws._playerId);
    if (!room) { send(ws, { type: 'error', reason: 'not_in_room' }); return; }
    room.lastActivity = Date.now();

    switch (type) {
      case 'set_color': {
        const entry = room.players.get(ws._playerId);
        if (!entry) return;
        entry.color = validColor(msg.color);
        broadcast(room, { type: 'color_changed', id: ws._playerId, color: entry.color });
        return;
      }
      case 'set_ready': {
        const entry = room.players.get(ws._playerId);
        if (!entry) return;
        entry.ready = !!msg.ready;
        room.inGame = false;
        broadcast(room, { type: 'ready_changed', id: ws._playerId, ready: entry.ready, players: playerList(room) });
        return;
      }
      case 'level_complete': {
        if (ws._playerId !== room.hostId) return;
        room.selectedLevel = msg.nextLevel || room.selectedLevel;
        // Honour the host's mode (infinite rooms never set selectedMode, so the old
        // 'adventure' fallback wrongly switched them to adventure). Persist + default
        // to infinite.
        if (msg.mode) room.selectedMode = msg.mode;
        const out = { type: 'level_complete', nextLevel: room.selectedLevel, mode: room.selectedMode || 'infinite' };
        broadcast(room, out); send(ws, out);
        return;
      }
      case 'select_level': {
        if (ws._playerId !== room.hostId) { send(ws, { type: 'error', reason: 'not_host' }); return; }
        room.selectedMode  = msg.mode  || 'infinite';
        room.selectedLevel = msg.level || 1;
        room.selectedSeed  = msg.seed  || Date.now();
        const out = { type: 'level_selected', mode: room.selectedMode, level: room.selectedLevel, seed: room.selectedSeed };
        broadcast(room, out); send(ws, out);
        return;
      }
      case 'start_game': {
        if (ws._playerId !== room.hostId) { send(ws, { type: 'error', reason: 'not_host' }); return; }
        // Host may only start once EVERY other player has pressed "ready".
        {
          let allReady = true;
          for (const [id, p2] of room.players) { if (id !== room.hostId && !p2.ready) { allReady = false; break; } }
          if (room.players.size < 2 || !allReady) { send(ws, { type: 'error', reason: 'not_all_ready' }); return; }
        }
        for (const entry of room.players.values()) entry.ready = false;
        room.inGame = true;
        room.lastHostMsg = Date.now();
        broadcast(room, {
          type: 'game_started', mode: room.selectedMode || 'infinite',
          level: room.selectedLevel || 1, seed: room.selectedSeed || Date.now(), players: playerList(room),
        });
        return;
      }
      case 'game_state':
        broadcast(room, {
          type: 'player_state', id: ws._playerId,
          x: msg.x, y: msg.y, vx: msg.vx, vy: msg.vy, facing: msg.facing, action: msg.action, hp: msg.hp,
          blaster: !!msg.blaster, broken: !!msg.broken, starMode: !!msg.starMode,
          fireMode: !!msg.fireMode, iceMode: !!msg.iceMode, boots: !!msg.boots,
        }, ws._playerId);
        return;
      case 'enemies_sync':
        if (ws._playerId !== room.hostId) return;
        room.lastHostMsg = Date.now();
        broadcast(room, { type: 'enemies_sync', enemies: Array.isArray(msg.enemies) ? msg.enemies.slice(0, 200) : [] }, ws._playerId);
        return;
      case 'boss_sync':
        if (ws._playerId !== room.hostId) return;
        room.lastHostMsg = Date.now();
        broadcast(room, { type: 'boss_sync', boss: msg.boss || null }, ws._playerId);
        return;
      case 'bullets_sync':
        if (ws._playerId !== room.hostId) return;
        broadcast(room, { type: 'bullets_sync', bullets: Array.isArray(msg.bullets) ? msg.bullets.slice(0, 200) : [] }, ws._playerId);
        return;
      case 'ebullets_sync':
        if (ws._playerId !== room.hostId) return;
        broadcast(room, { type: 'ebullets_sync', bullets: Array.isArray(msg.bullets) ? msg.bullets.slice(0, 300) : [] }, ws._playerId);
        return;
      case 'game_event':
        broadcast(room, { type: 'game_event', id: ws._playerId, event: msg.event, data: msg.data || {} }, ws._playerId);
        return;
      case 'chat': {
        const text = sanitize(msg.text || '').slice(0, 120);
        if (!text) return;
        broadcast(room, { type: 'chat', id: ws._playerId, text });
        return;
      }
      case 'ping':
        send(ws, { type: 'pong', ts: Date.now() });
        return;
    }
  }

  return { rooms, handleMessage, removePlayer, makePlayerId, send, checkHostTimeouts };
}

// ── HTTP + WebSocket upgrade wiring ─────────────────────────────────────────
function startLocalRelay(opts = {}) {
  const port = (opts.port != null) ? opts.port : (process.env.PORT || 3000);
  const host = opts.host || '0.0.0.0';
  const relay = createRelay();

  const httpServer = http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/' )) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        rooms: relay.rooms.size,
        players: [...relay.rooms.values()].reduce((n, r) => n + r.players.size, 0),
      }));
      return;
    }
    if (req.method === 'GET' && req.url === '/health') { res.writeHead(200); res.end('OK'); return; }
    res.writeHead(404); res.end();
  });

  httpServer.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) { socket.destroy(); return; }
    const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
    );
    socket.setNoDelay(true);

    const ws = new WSConn(socket);
    ws._playerId = relay.makePlayerId();
    ws.on('message', (data) => relay.handleMessage(ws, data));
    ws.on('close',   ()     => relay.removePlayer(ws._playerId));
    relay.send(ws, { type: 'connected', id: ws._playerId, maxPlayers: MAX_PLAYERS });
  });

  // Background timers (host-freeze failover + stale-room cleanup).
  const t1 = setInterval(relay.checkHostTimeouts, 1000);
  const t2 = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of relay.rooms)
      if (room.players.size === 0 && now - room.lastActivity > ROOM_TTL_MS) relay.rooms.delete(code);
  }, 10 * 60 * 1000);
  if (t1.unref) t1.unref();
  if (t2.unref) t2.unref();

  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => {
      httpServer.removeListener('error', reject);
      const bound = (httpServer.address() && httpServer.address().port) || port;
      resolve({ server: httpServer, relay, port: bound, host });
    });
  });
}

module.exports = { startLocalRelay, createRelay, WSConn, MAX_PLAYERS };

// Allow `node local-server.js` for standalone testing.
if (require.main === module) {
  startLocalRelay()
    .then(({ port }) => console.log('Byte Blaster LAN relay listening on port ' + port))
    .catch((e) => { console.error('Failed to start LAN relay:', e.message); process.exit(1); });
}
