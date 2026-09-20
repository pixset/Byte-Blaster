// Verifies the room-cleanup fix (bug 1 "ghost rooms"):
//  (a) list_rooms never shows an empty (0-player) room;
//  (b) an explicit leave_room from the only player deletes the room at once, so
//      it disappears from the public list immediately (no 5s grace ghost).
// Run: node _nettest/test_leave.js
const { startLocalRelay } = require('../local-server.js');
const crypto = require('crypto');
const net = require('net');

function wsClient(port){
  return new Promise((resolve)=>{
    const key = crypto.randomBytes(16).toString('base64');
    const sock = net.connect(port, '127.0.0.1', ()=>{
      sock.write('GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'+
        'Sec-WebSocket-Key: '+key+'\r\nSec-WebSocket-Version: 13\r\n\r\n');
    });
    let buf=Buffer.alloc(0), open=false; const handlers=[];
    const api={ send:(o)=>{ const p=Buffer.from(JSON.stringify(o)); const m=crypto.randomBytes(4);
        const x=Buffer.allocUnsafe(p.length); for(let i=0;i<p.length;i++)x[i]=p[i]^m[i&3];
        let h; if(p.length<126){h=Buffer.from([0x81,0x80|p.length]);} else {h=Buffer.alloc(4);h[0]=0x81;h[1]=0x80|126;h.writeUInt16BE(p.length,2);}
        sock.write(Buffer.concat([h,m,x])); }, on:(fn)=>handlers.push(fn) };
    sock.on('data',(d)=>{ buf=Buffer.concat([buf,d]);
      if(!open){ const i=buf.indexOf('\r\n\r\n'); if(i<0)return; buf=buf.slice(i+4); open=true; resolve(api); }
      while(buf.length>=2){ const op=buf[0]&0x0f; let len=buf[1]&0x7f; let off=2;
        if(len===126){ if(buf.length<4)return; len=buf.readUInt16BE(2); off=4; }
        if(buf.length<off+len)return; const pl=buf.slice(off,off+len); buf=buf.slice(off+len);
        if(op===0x1){ try{ handlers.forEach(h=>h(JSON.parse(pl.toString()))); }catch{} } } });
  });
}
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));

(async ()=>{
  const { port } = await startLocalRelay({ port: 0 });
  const results={};
  const host = await wsClient(port);
  let code=null;
  host.on(m=>{ if(m.type==='room_created') code=m.code; });

  await wait(80);
  host.send({type:'create_room', nickname:'H', color:{h:0,s:90,l:52}, isPublic:true, maxPlayers:2});
  await wait(120);

  // Sanity: a populated public room IS listed.
  const lister = await wsClient(port);
  let listed=null; lister.on(m=>{ if(m.type==='rooms_list') listed=m.rooms; });
  await wait(60);
  lister.send({type:'list_rooms'});
  await wait(120);
  results.roomListedWhilePopulated = Array.isArray(listed) && !!listed.find(r=>r.code===code);

  // Host explicitly leaves → room should be gone from the list at once.
  host.send({type:'leave_room'});
  await wait(150);
  listed=null;
  lister.send({type:'list_rooms'});
  await wait(150);
  results.roomGoneImmediatelyAfterLeave = Array.isArray(listed) && !listed.find(r=>r.code===code);

  console.log(JSON.stringify(results,null,2));
  const ok = Object.values(results).every(Boolean);
  console.log(ok ? '\nLEAVE/GHOST FIX OK ✅' : '\nFAILED ❌');
  process.exit(ok?0:1);
})();
