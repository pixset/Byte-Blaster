const fs = require('fs-extra');
const path = require('path');
const { edition, appName, outDirName } = require('./build/edition-info');

// The Android build (www/) needs exactly the same treatment as the web build,
// so the whole thing is a function: `node build-html.js` fills dist/, while
// sync-www.js reuses it to refresh www/ before `npx cap sync`.
function buildWeb(distDir) {

console.log('🌐 Building HTML version... (edition: ' + edition + ')');

// Clean and create dist directory
if (fs.existsSync(distDir)) {
  fs.removeSync(distDir);
}
fs.ensureDirSync(distDir);

// Files and directories to copy
const itemsToCopy = [
  'index.html',
  'preload.js',
  'assets',   // now also contains localisation/ and audio/ (Music + SFX .mp3s)
  'icons',
];

// Copy files
itemsToCopy.forEach(item => {
  const src = path.join(__dirname, item);
  const dest = path.join(distDir, item);

  if (fs.existsSync(src)) {
    fs.copySync(src, dest);
    console.log(`✓ Copied ${item}`);
  } else {
    console.warn(`⚠ ${item} not found, skipping`);
  }
});

// Восьмибитные mp3 в сборку не идут: этот стиль играет живой синтез, а копия
// файлов только удваивала бы музыку в .apk и выкладывала весь саундтрек на
// сайт в открытый доступ. Слушать их можно в assets/audio/Music/chip/.
const chipDir = path.join(distDir, 'assets', 'audio', 'Music', 'chip');
if (fs.existsSync(chipDir)) {
  fs.removeSync(chipDir);
  console.log('✓ Excluded 8-bit music (live synth plays it)');
}

// Regenerate the localisation manifest from whatever .json files are present,
// so the web build auto-discovers languages without the Electron file-system API.
const locDir = path.join(distDir, 'assets', 'localisation');
if (fs.existsSync(locDir)) {
  // Служебные выгрузки проверки переводов (_suspect_*, _pre_en, _cutscenes_en)
  // игра не читает (см. i18n-new.js) — в сборке им делать нечего, а на сайте
  // они лежали бы четырьмя десятками лишних файлов в открытом доступе.
  let junk = 0;
  for (const f of fs.readdirSync(locDir)) {
    if (f.startsWith('_') && f.endsWith('.json')) { fs.removeSync(path.join(locDir, f)); junk++; }
  }
  if (junk) console.log(`✓ Dropped ${junk} translation-audit file(s)`);

  const codes = fs.readdirSync(locDir)
    .filter(f => f.toLowerCase().endsWith('.json') && f.toLowerCase() !== 'index.json' && !f.startsWith('_'))
    .map(f => f.replace(/\.json$/i, ''));
  fs.writeFileSync(path.join(locDir, 'index.json'), JSON.stringify(codes) + '\n', 'utf8');
  console.log(`✓ Localisation manifest: [${codes.join(', ')}]`);
}

// Create a modified index.html for web (remove Electron-specific code)
const indexPath = path.join(distDir, 'index.html');
if (fs.existsSync(indexPath)) {
  let html = fs.readFileSync(indexPath, 'utf8');

  // Remove or comment out Electron-specific references
  html = html.replace(/window\.electronAPI/g, '(window.electronAPI || {})');

  fs.writeFileSync(indexPath, html, 'utf8');
  console.log('✓ Modified index.html for web');
}

// Create README
const readme = `# ${appName} (HTML Version)

This is the web/HTML version of ${appName}.

## How to run:
1. Open index.html in a modern web browser
2. Or serve it with a local web server:
   - Python: python -m http.server 8000
   - Node: npx http-server
   - PHP: php -S localhost:8000

## Note:
Some features may be limited compared to the Steam version (e.g., window controls, file system access).
`;

fs.writeFileSync(path.join(distDir, 'README.md'), readme, 'utf8');

console.log('✅ HTML build complete!');
console.log(`📁 Output: ${distDir}`);

}

module.exports = { buildWeb };

// Прямой запуск — обычная веб-сборка в dist.
if (require.main === module) {
  buildWeb(path.join(__dirname, 'dist', outDirName('HTML')));
}
