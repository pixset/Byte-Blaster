// Headless verification: decode every baked .mp3 in the SAME Chromium/WebAudio
// engine the game uses, to prove they play. Run:  npx electron tools/verify-audio-electron.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('about:blank');
  const dir = path.join(__dirname, '..', 'Audio');
  const files = [];
  for (const sub of ['Music', 'SFX'])
    for (const f of fs.readdirSync(path.join(dir, sub)).sort())
      files.push([sub + '/' + f, fs.readFileSync(path.join(dir, sub, f)).toString('base64')]);

  const script = `(async () => {
    const AC = new (window.AudioContext || window.webkitAudioContext)();
    const files = ${JSON.stringify(files)};
    const out = [];
    for (const [name, b64] of files) {
      try {
        const bin = atob(b64); const u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        const buf = await AC.decodeAudioData(u.buffer);
        out.push('OK   ' + name.padEnd(22) + buf.duration.toFixed(2) + 's  ' + buf.numberOfChannels + 'ch');
      } catch (e) { out.push('FAIL ' + name + '  ' + (e && e.message)); }
    }
    return out.join('\\n');
  })()`;

  try {
    const result = await win.webContents.executeJavaScript(script);
    console.log(result);
    const fails = (result.match(/^FAIL/gm) || []).length;
    console.log(fails ? ('\\n❌ ' + fails + ' file(s) failed to decode') : '\\n✅ All files decoded successfully in Chromium WebAudio');
    process.exitCode = fails ? 1 : 0;
  } catch (e) {
    console.error('verify error:', e);
    process.exitCode = 2;
  }
  app.quit();
});
