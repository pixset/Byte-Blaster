// Ad-hoc integration test: drives the embedded relay with two simulated players
// to verify (a) host cannot start until the guest is ready, and (b) ready_changed
// carries the players list. Run: node _nettest/test_flow.js
const { startLocalRelay } = require('../local-server.js');
const http = require('http');
const crypto = require('crypto');
const net = require('net');

// Minimal WS client (text frames only, masked) — enough for this test.
function wsClient(port){
  return new Promise((resolve)=>{
    const key = crypto.randomBytes(16).toString('base64');
    const sock = net.connect(port, '127.0.0.1', ()=>{
      sock.write(
        'GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'+
        'Sec-WebSocket-Key: '+key+'\r\nSec-WebSocket-Version: 13\r\n\r\n');
    });
    let buf=Buffer.alloc(0), open=false; const handlers=[];
    const api={ send:(o)=>{ const p=Buffer.from(JSON.stringify(o)); const m=crypto.randomBytes(4);
        const masked=Buffer.allocUnsafe(p.length); for(let i=0;i<p.length;i++)masked[i]=p[i]^m[i&3];
        let h; if(p.length<126){h=Buffer.from([0x81,0x80|p.length]);} else {h=Buffer.alloc(4);h[0]=0x81;h[1]=0x80|126;h.writeUInt16BE(p.length,2);}
        sock.write(Buffer.concat([h,m,masked])); },
      on:(fn)=>handlers.push(fn) };
    sock.on('data',(d)=>{
      buf=Buffer.concat([buf,d]);
      if(!open){ const i=buf.indexOf('\r\n\r\n'); if(i<0)return; buf=buf.slice(i+4); open=true; resolve(api); }
      while(buf.length>=2){
        const op=buf[0]&0x0f; let len=buf[1]&0x7f; let off=2;
        if(len===126){ if(buf.length<4)return; len=buf.readUInt16BE(2); off=4; }
        if(buf.length<off+len)return;
        const pl=buf.slice(off,off+len); buf=buf.slice(off+len);
        if(op===0x1){ try{ const msg=JSON.parse(pl.toString()); handlers.forEach(h=>h(msg)); }catch{} }
      }
    });
  });
}
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));

(async ()=>{
  const { port } = await startLocalRelay({ port: 0 });
  const log=[]; const results={};

  const host = await wsClient(port);
  const guest = await wsClient(port);
  let hostId=null, code=null, guestId=null;
  let hostReadyChanged=null, hostError=null, hostGameStarted=false;

  host.on(m=>{
    if(m.type==='room_created'){ code=m.code; hostId=m.id; }
    if(m.type==='ready_changed'){ hostReadyChanged=m; }
    if(m.type==='error'){ hostError=m.reason; }
    if(m.type==='game_started'){ hostGameStarted=true; }
  });
  guest.on(m=>{ if(m.type==='room_joined'){ guestId=m.id; } });

  await wait(100);
  host.send({type:'create_room', nickname:'HOST', color:{h:0,s:90,l:52}, isPublic:true, maxPlayers:2});
  await wait(100);
  guest.send({type:'join_room', code, nickname:'GUEST', color:{h:222,s:90,l:56}});
  await wait(150);

  // 1) Host tries to start while guest is NOT ready → must be rejected.
  hostError=null; hostGameStarted=false;
  host.send({type:'start_game'});
  await wait(150);
  results.startBlockedWhenNotReady = (hostError==='not_all_ready' && !hostGameStarted);

  // 2) Guest presses ready → host must receive ready_changed WITH players[] showing ready.
  guest.send({type:'set_ready', ready:true});
  await wait(150);
  results.readyChangedHasPlayers = !!(hostReadyChanged && Array.isArray(hostReadyChanged.players));
  results.guestMarkedReady = !!(hostReadyChanged && hostReadyChanged.players &&
      hostReadyChanged.players.find(p=>p.id===guestId && p.ready===true));

  // 3) Now host starts → must succeed.
  hostError=null; hostGameStarted=false;
  host.send({type:'start_game'});
  await wait(150);
  results.startAllowedWhenReady = (hostGameStarted && !hostError);

  // 4) list_rooms must NOT include the now in-game room.
  let listed=null;
  const lister = await wsClient(port);
  lister.on(m=>{ if(m.type==='rooms_list') listed=m.rooms; });
  await wait(80);
  lister.send({type:'list_rooms'});
  await wait(150);
  results.inGameRoomHidden = Array.isArray(listed) && !listed.find(r=>r.code===code);

  console.log(JSON.stringify(results,null,2));
  const ok = Object.values(results).every(Boolean);
  console.log(ok ? '\nALL SERVER CHECKS PASS ✅' : '\nSOME CHECKS FAILED ❌');
  process.exit(ok?0:1);
})();
