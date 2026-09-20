// Single place where the build scripts learn which build TYPE is currently
// stamped into assets/edition.js, and what to call its output. build.bat runs
// set-edition.js before each pass, so every script below sees the same answer.
//
//   release   → "Byte Blaster"           → dist/Byte Blaster (Steam|HTML|Android)/
//   beta      → "Byte Blaster Beta"      → dist/Byte Blaster Beta (…)/
//   dev       → "Byte Blaster Dev"       → dist/Byte Blaster Dev (…)/
//   demo      → "Byte Blaster Demo"      → dist/Byte Blaster Demo (…)/
//   pre-alpha → "Byte Blaster Pre-Alpha" → dist/Byte Blaster Pre-Alpha (…)/
//
// Разные типы никогда не перезаписывают вывод друг друга — на этом держится
// сборка нескольких каналов за один прогон.
const fs = require('fs');
const path = require('path');

const TYPES = ['dev', 'demo', 'pre-alpha', 'alpha', 'beta', 'release'];

const root = path.resolve(__dirname, '..');

function readSource() {
  try { return fs.readFileSync(path.join(root, 'assets', 'edition.js'), 'utf8'); }
  catch (e) { return ''; }
}

function readBuildType() {
  const m = readSource().match(/BB_BUILD_TYPE\s*=\s*"([\w-]+)"/);
  const t = m ? m[1].toLowerCase() : '';
  return TYPES.indexOf(t) !== -1 ? t : 'dev';
}

function readFreeLevels() {
  const m = readSource().match(/BB_FREE_LEVELS\s*=\s*(\d+)/);
  return m ? parseInt(m[1], 10) : 10;
}

// "pre-alpha" → "Pre-Alpha"
function pretty(type) {
  return type.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('-');
}

const buildType = readBuildType();
// Релиз выходит без суффикса: это и есть «просто игра».
const appName = buildType === 'release' ? 'Byte Blaster' : 'Byte Blaster ' + pretty(buildType);

// "Steam" | "HTML" | "Android" → the dist/ folder name for this build type.
function outDirName(target) { return appName + ' (' + target + ')'; }

module.exports = {
  buildType, appName, outDirName, freeLevels: readFreeLevels(), TYPES,
  // Совместимость со старыми вызовами в скриптах сборки.
  edition: buildType,
  isDemo: buildType === 'demo',
  demoLevels: readFreeLevels(),
};
