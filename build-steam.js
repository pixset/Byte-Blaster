// Собирает установщик для Windows (NSIS) через electron-builder.
//
// Раньше здесь работал electron-packager: он выдавал папку с распакованной
// игрой и .exe запуска, то есть «портативную» сборку, а не установщик.
// Настройки NSIS в package.json при этом не применялись вовсе — их читает
// electron-builder, которого никто не вызывал.
//
// Теперь на выходе один файл ByteBlaster-Setup-<версия>.exe: мастер установки
// с выбором папки, ярлыками, записью в «Программы и компоненты» и удалением.
//
// Список files/asar берётся из package.json — там же, где и остальная
// конфигурация сборки, чтобы не разъезжались две копии правил.

const fs = require('fs');
const os = require('os');
const path = require('path');
const builder = require('electron-builder');
const pkg = require('./package.json');
const { buildType, appName, outDirName } = require('./build/edition-info');

const isRelease = buildType === 'release';

// makensis.exe не умеет работать с путями, где есть кириллица, а проект лежит
// в папке «Проекты Pixset Studio» — сборка падала с ERR_ELECTRON_BUILDER_CANNOT_EXECUTE.
// Поэтому собираем во временную папку с латинским путём, а готовый установщик
// переносим в dist проекта.
const finalDir = path.join(__dirname, 'dist', outDirName('Steam'));
const asciiSafe = /^[\x20-\x7E]+$/.test(finalDir);
const workDir = asciiSafe ? finalDir : path.join(os.tmpdir(), 'byte-blaster-build');

/**
 * NSIS читает иконки, тексты лицензии и наш installer.nsh сам, обычными
 * файловыми функциями, и на кириллице в пути так же спотыкается. Поэтому
 * собираем папку ресурсов во временном месте с латинским путём.
 *
 * Возвращает { nsis, buildResources }: настройки для секции nsis и адрес
 * папки ресурсов, откуда electron-builder возьмёт license_*.txt и installer.nsh.
 */
function stageAssets() {
  const source = path.join(__dirname, 'build');
  if (asciiSafe) return { nsis: {}, buildResources: source };

  const dir = path.join(workDir, 'nsis-assets');
  fs.mkdirSync(dir, { recursive: true });

  // Ресурсы установщика: двуязычная лицензия и страница с галочками ярлыков.
  for (const name of ['license_ru.txt', 'license_en.txt', 'installer.nsh']) {
    const from = path.join(source, name);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dir, name));
    else console.warn('⚠ Не нашёл ресурс установщика: ' + name);
  }

  const nsis = {};
  const icon = path.join(__dirname, 'icons', 'installer.ico');
  if (fs.existsSync(icon)) {
    const dest = path.join(dir, 'installer.ico');
    fs.copyFileSync(icon, dest);
    nsis.installerIcon = dest;
    nsis.uninstallerIcon = dest;
    nsis.installerHeaderIcon = dest;
  }

  return { nsis, buildResources: dir };
}

function moveResults() {
  if (workDir === finalDir) return;
  fs.mkdirSync(finalDir, { recursive: true });
  for (const name of fs.readdirSync(workDir)) {
    if (!/\.(exe|blockmap|yml)$/i.test(name)) continue;   // сам установщик и его спутники
    fs.copyFileSync(path.join(workDir, name), path.join(finalDir, name));
  }
  console.log('📦 Установщик перенесён в ' + finalDir);

  // Во временной папке остаётся распакованная сборка на сотни мегабайт —
  // она больше не нужна, а копится с каждым запуском.
  try { fs.rmSync(workDir, { recursive: true, force: true }); }
  catch (e) { console.warn('⚠ Не удалось убрать ' + workDir + ': ' + e.message); }
}

// Каналы кроме релиза ставятся рядом с ним, а не поверх: свой идентификатор
// приложения и своё имя файла. Иначе бета затирала бы установленный релиз.
const suffix = isRelease ? '' : '-' + buildType.replace(/-/g, '');
const appId = pkg.build.appId + (isRelease ? '' : '.' + buildType.replace(/-/g, ''));

const staged = stageAssets();

const config = {
  ...pkg.build,
  appId,
  productName: appName,
  directories: { output: workDir, buildResources: staged.buildResources },
  win: {
    ...pkg.build.win,
    target: [{ target: 'nsis', arch: ['x64'] }],
    artifactName: 'ByteBlaster' + suffix + '-Setup-${version}.${ext}',
  },
  nsis: {
    ...pkg.build.nsis,
    ...staged.nsis,
    artifactName: 'ByteBlaster' + suffix + '-Setup-${version}.${ext}',
    shortcutName: appName,
    uninstallDisplayName: appName + ' ${version}',
  },
};

console.log('⚙ Тип сборки: ' + buildType + ' → ' + appName);
console.log('⚙ Идентификатор: ' + appId);

builder.build({
  targets: builder.Platform.WINDOWS.createTarget('nsis', builder.Arch.x64),
  config,
})
  .then((made) => {
    console.log('✅ Установщик готов:');
    for (const f of made) console.log('   ' + f);
    moveResults();
  })
  .catch((err) => {
    console.error('❌ Сборка установщика не удалась:', err && (err.stack || err.message));
    process.exit(1);
  });
