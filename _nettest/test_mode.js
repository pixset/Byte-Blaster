// Verifies the level_complete fix: an infinite room must stay infinite after a
// level is cleared (the old relay echoed mode:'adventure'). Run: node _nettest/test_mode.js
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
  const host = await wsClient(port), guest = await wsClient(port);
  let code=null, lc=null;
  host.on(m=>{ if(m.type==='room_created') code=m.code; if(m.type==='level_complete') lc=m; });

  await wait(80);
  // Host creates an INFINITE room — note: NO explicit select_level is sent, which is
  // exactly the case that used to fall back to 'adventure' on the server.
  host.send({type:'create_room', nickname:'H', color:{h:0,s:90,l:52}, isPublic:true, maxPlayers:2});
  await wait(80);
  guest.send({type:'join_room', code, nickname:'G', color:{h:222,s:90,l:56}});
  await wait(120);
  guest.send({type:'set_ready', ready:true});
  await wait(120);
  host.send({type:'start_game'}); // game_started defaults to infinite
  await wait(120);

  // Host signals the infinite level is done, advancing to level 2, mode infinite.
  lc=null;
  host.send({type:'level_complete', nextLevel:2, mode:'infinite'});
  await wait(150);
  results.levelCompleteReceived = !!lc;
  results.modeStaysInfinite = !!(lc && lc.mode === 'infinite');
  results.levelAdvanced = !!(lc && lc.nextLevel === 2);

  console.log(JSON.stringify(results,null,2));
  const ok = Object.values(results).every(Boolean);
  console.log(ok ? '\nMODE FIX OK ✅' : '\nFAILED ❌');
  process.exit(ok?0:1);
})();
