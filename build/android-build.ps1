<#
  Byte Blaster - Android (.apk) build pipeline.
  Driven by build/build.bat (option [3]). Windows PowerShell 5.1 compatible.
  NOTE: kept ASCII-only on purpose - PowerShell 5.1 reads BOM-less scripts as
  ANSI, which would corrupt non-ASCII characters.

  This script lives in build/. $PSScriptRoot = build/, so the project root
  (where package.json / capacitor.config.json live) is its parent.

  Steps:
    1. Ensure a JDK 17+ (download portable Temurin into build/.jdk if missing).
    2. Locate the Android SDK.
    3. Build the web bundle and copy it into <root>/www.
    4. Ensure Capacitor + the android/ project (cap add / cap sync).
    5. Patch compileSdk (use an installed platform), landscape orientation, icon.
    6. Assemble the APK (debug, or release signed with a keystore).
    7. Copy the result into dist/Byte Blaster (Android)/.
#>
param(
  [ValidateSet('debug','release','aab')]
  [string]$Variant = 'debug',
  [string]$AppVersion = '',
  [ValidateSet('','dev','demo','pre-alpha','alpha','beta','release')]
  [string]$Edition = ''
)

$ErrorActionPreference = 'Stop'
$BUILD = $PSScriptRoot                        # build/
$ROOT  = Split-Path -Parent $BUILD            # project root (Game/)
Set-Location $ROOT

# --- App version -------------------------------------------------------------
# The version stamped into the APK (versionName) and on the splash. Defaults to
# whatever is in package.json so a standalone run still works; build.bat passes
# the value the user chose so the .exe and .apk stay in sync.
function Get-PkgVersion {
  $pkg = Join-Path $ROOT 'package.json'
  if (Test-Path $pkg) {
    $t = Get-Content $pkg -Raw
    if ($t -match '"version"\s*:\s*"([^"]+)"') { return $Matches[1] }
  }
  return '1.0.0'
}
function To-VersionCode($v) {
  $p = $v -split '[.\-+]'
  $maj = 0; $min = 0; $pat = 0
  if ($p.Count -ge 1 -and $p[0] -match '^\d+$') { $maj = [int]$p[0] }
  if ($p.Count -ge 2 -and $p[1] -match '^\d+$') { $min = [int]$p[1] }
  if ($p.Count -ge 3 -and $p[2] -match '^\d+$') { $pat = [int]$p[2] }
  $code = $maj * 10000 + $min * 100 + $pat
  if ($code -lt 1) { $code = 1 }
  return $code
}
if (-not $AppVersion) { $AppVersion = Get-PkgVersion }
$verCode = To-VersionCode $AppVersion

# --- Build type --------------------------------------------------------------
# build.bat stamps assets/edition.js via set-edition.js before calling us, so
# that file is the source of truth; -Edition only overrides it on a standalone
# run. Каждый канал кроме release получает свой applicationId и подпись на
# иконке, чтобы стоять на устройстве рядом с релизом, а не поверх него.
function Get-Edition {
  $f = Join-Path $ROOT 'assets\edition.js'
  if (Test-Path $f) {
    $t = Get-Content $f -Raw
    if ($t -match 'BB_BUILD_TYPE\s*=\s*"([\w-]+)"') { return $Matches[1].ToLower() }
  }
  return 'dev'
}
if (-not $Edition) { $Edition = Get-Edition }
$isRelease = ($Edition -eq 'release')
$isDemo = ($Edition -eq 'demo')
# "pre-alpha" -> "Pre-Alpha"
$suffix = (($Edition -split '-') | ForEach-Object { $_.Substring(0,1).ToUpper() + $_.Substring(1) }) -join '-'
if ($isRelease) { $appLabel = 'Byte Blaster' } else { $appLabel = "Byte Blaster $suffix" }
$baseAppId = 'com.pixsetstudio.byteblaster'
$capCfg = Join-Path $ROOT 'capacitor.config.json'
if (Test-Path $capCfg) {
  $c = Get-Content $capCfg -Raw
  if ($c -match '"appId"\s*:\s*"([^"]+)"') {
    $baseAppId = $Matches[1] -replace '\.(demo|dev|prealpha|alpha|beta)$', ''
  }
}
if ($isRelease) { $appId = $baseAppId } else { $appId = "$baseAppId." + ($Edition -replace '-','') }

function Info($m) { Write-Host "[android] $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "[android] $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "[android] ERROR: $m" -ForegroundColor Red; exit 1 }

Info "Build type: $Edition ($appLabel / $appId)"

# Write UTF-8 WITHOUT a BOM. Set-Content -Encoding UTF8 emits a BOM on PS 5.1,
# which breaks Gradle/Groovy (variables.gradle) and is undesirable in XML.
function Write-TextNoBom($path, $content) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $enc)
}

# --- 1. JDK 17+ --------------------------------------------------------------
function Get-JavaMajor($javaExe) {
  # Prefer the JDK's 'release' file: no process spawn, and immune to the PS 5.1
  # quirk where `java -version` (which prints to stderr) merged with 2>&1 under
  # $ErrorActionPreference='Stop' raises a NativeCommandError -> the old code
  # caught it, returned 0, and re-downloaded a JDK that was already present.
  try {
    $jhome = Split-Path -Parent (Split-Path -Parent $javaExe)   # <jdk>/bin/java.exe -> <jdk>
    $rel = Join-Path $jhome 'release'
    if (Test-Path $rel) {
      $m = Select-String -Path $rel -Pattern 'JAVA_VERSION="([^"]+)"' -ErrorAction SilentlyContinue |
             Select-Object -First 1
      if ($m) {
        $ver = $m.Matches[0].Groups[1].Value
        if ($ver -match '^(\d+)\.(\d+)') { if ([int]$Matches[1] -eq 1) { return [int]$Matches[2] } else { return [int]$Matches[1] } }
        if ($ver -match '^(\d+)') { return [int]$Matches[1] }
      }
    }
  } catch {}
  # Fallback: parse `java -version` via cmd so PowerShell never wraps its stderr.
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $out = ''
  try { $out = (cmd /c "`"$javaExe`" -version 2>&1") | Out-String } catch { $out = '' }
  $ErrorActionPreference = $old
  if ($out -match 'version "(\d+)\.(\d+)') {
    $a = [int]$Matches[1]; $b = [int]$Matches[2]
    if ($a -eq 1) { return $b }   # "1.8.0" -> 8
    return $a                     # "17.0.x" -> 17
  }
  if ($out -match 'version "(\d+)"') { return [int]$Matches[1] }
  return 0
}

function Ensure-Jdk {
  $candidates = @()
  if ($env:JAVA_HOME) { $candidates += $env:JAVA_HOME }
  $localJdk = Join-Path $BUILD '.jdk'
  if (Test-Path $localJdk) {
    Get-ChildItem $localJdk -Directory -ErrorAction SilentlyContinue |
      ForEach-Object { $candidates += $_.FullName }
  }
  foreach ($base in @("$env:ProgramFiles\Eclipse Adoptium", "$env:ProgramFiles\Java",
                      "$env:ProgramFiles\Microsoft", "$env:ProgramFiles\Zulu")) {
    if (Test-Path $base) {
      Get-ChildItem $base -Directory -ErrorAction SilentlyContinue |
        ForEach-Object { $candidates += $_.FullName }
    }
  }
  foreach ($c in $candidates) {
    $j = Join-Path $c 'bin\java.exe'
    if ((Test-Path $j) -and ((Get-JavaMajor $j) -ge 17)) {
      Info "Using JDK at $c"
      return $c
    }
  }

  Warn "No JDK 17+ found. Downloading portable Temurin JDK 17 (~190 MB, one time)..."
  # A leftover Gradle daemon (java.exe) can lock JDK files and make detection
  # fail; stop stray java processes and clear any partial download first.
  Get-Process java -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
  New-Item -ItemType Directory -Force -Path $localJdk | Out-Null
  Get-ChildItem $localJdk -Filter '*.zip' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
  $zip = Join-Path $localJdk 'temurin17.zip'
  $url = 'https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk'
  $oldPref = $ProgressPreference; $ProgressPreference = 'SilentlyContinue'
  try { Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing }
  catch { Die "Failed to download JDK 17: $($_.Exception.Message)" }
  $ProgressPreference = $oldPref
  Info "Extracting JDK..."
  Expand-Archive -Path $zip -DestinationPath $localJdk -Force
  Remove-Item $zip -Force
  $jdk = Get-ChildItem $localJdk -Directory |
           Where-Object { Test-Path (Join-Path $_.FullName 'bin\java.exe') } |
           Select-Object -First 1
  if (-not $jdk) { Die "JDK extraction failed (no bin\java.exe found in build/.jdk)." }
  Info "Installed JDK at $($jdk.FullName)"
  return $jdk.FullName
}

$javaHome = Ensure-Jdk
$env:JAVA_HOME = $javaHome
$env:PATH = (Join-Path $javaHome 'bin') + ';' + $env:PATH

# --- 2. Android SDK ----------------------------------------------------------
$sdk = $env:ANDROID_HOME
if (-not $sdk) { $sdk = $env:ANDROID_SDK_ROOT }
if (-not $sdk) { $sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not (Test-Path (Join-Path $sdk 'platform-tools'))) {
  Die "Android SDK not found at '$sdk'. Install it via Android Studio, or set ANDROID_HOME."
}
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:PATH = (Join-Path $sdk 'platform-tools') + ';' +
            (Join-Path $sdk 'cmdline-tools\latest\bin') + ';' + $env:PATH
Info "Android SDK: $sdk"

# Pick the highest installed platform so Gradle does not try to fetch a missing one.
$platDir = Join-Path $sdk 'platforms'
$compileSdk = 35
if (Test-Path $platDir) {
  $nums = Get-ChildItem $platDir -Directory -ErrorAction SilentlyContinue |
            ForEach-Object { if ($_.Name -match 'android-(\d+)') { [int]$Matches[1] } } |
            Sort-Object -Descending
  if ($nums -and $nums.Count -gt 0) { $compileSdk = $nums[0] }
}
Info "compileSdk/targetSdk = $compileSdk"

# --- 3. Web bundle -> www/ ---------------------------------------------------
Info "Building web bundle..."
& npm run build:html
if ($LASTEXITCODE -ne 0) { Die "Web build failed." }
$webOut = Join-Path $ROOT ('dist\' + $appLabel + ' (HTML)')
if (-not (Test-Path $webOut)) { Die "Web build output not found at '$webOut'." }
$www = Join-Path $ROOT 'www'
if (Test-Path $www) { Remove-Item $www -Recurse -Force }
New-Item -ItemType Directory -Force -Path $www | Out-Null
Copy-Item (Join-Path $webOut '*') $www -Recurse -Force
Info "Copied web bundle into www/"

# --- 4. Capacitor + android/ project -----------------------------------------
if ((-not (Test-Path (Join-Path $ROOT 'node_modules\@capacitor\cli'))) -or
    (-not (Test-Path (Join-Path $ROOT 'node_modules\@capacitor\app')))) {
  Info "Installing npm dependencies (Capacitor + App plugin)..."
  & npm install
  if ($LASTEXITCODE -ne 0) { Die "npm install failed." }
}
if (-not (Test-Path (Join-Path $ROOT 'android'))) {
  Info "Creating android project (cap add android)..."
  & npx cap add android
  if ($LASTEXITCODE -ne 0) { Die "cap add android failed." }
} else {
  Info "Syncing web assets (cap sync android)..."
  & npx cap sync android
  if ($LASTEXITCODE -ne 0) { Die "cap sync android failed." }
}

# Gradle держит собственную копию ассетов и НЕ удаляет из неё файлы, которых
# больше нет в www: cap sync только докладывает. Из-за этого удалённая музыка
# продолжала уезжать в .apk и он весил вдвое больше положенного. Чистим копию,
# чтобы слияние ассетов собралось заново.
foreach ($stale in @(
  'android\app\build\intermediates\assets',
  'android\app\build\intermediates\compressed_assets'
)) {
  $p = Join-Path $ROOT $stale
  if (Test-Path $p) { Remove-Item $p -Recurse -Force -ErrorAction SilentlyContinue }
}

# local.properties so Gradle finds the SDK.
$sdkEsc = $sdk -replace '\\', '\\'
Write-TextNoBom (Join-Path $ROOT 'android\local.properties') "sdk.dir=$sdkEsc"

# The project path may contain non-ASCII characters (e.g. a Cyrillic folder name).
# AGP refuses to build such paths unless this override is set. Append it once.
$gp = Join-Path $ROOT 'android\gradle.properties'
if (Test-Path $gp) {
  $gpText = Get-Content $gp -Raw
  if ($gpText -notmatch 'android\.overridePathCheck') {
    $gpText = $gpText.TrimEnd() + "`r`nandroid.overridePathCheck=true`r`n"
    Write-TextNoBom $gp $gpText
    Info "Enabled android.overridePathCheck (non-ASCII project path)"
  }
}

# --- 5a. Patch compileSdk / targetSdk to an installed platform ---------------
$varsFile = Join-Path $ROOT 'android\variables.gradle'
if (Test-Path $varsFile) {
  $v = Get-Content $varsFile -Raw
  $v = $v -replace 'compileSdkVersion = \d+', "compileSdkVersion = $compileSdk"
  $v = $v -replace 'targetSdkVersion = \d+',  "targetSdkVersion = $compileSdk"
  Write-TextNoBom $varsFile $v
  Info "Patched variables.gradle"
}

# --- 5a2. Stamp the app version into build.gradle (versionName / versionCode) --
$bg = Join-Path $ROOT 'android\app\build.gradle'
if (Test-Path $bg) {
  $b = Get-Content $bg -Raw
  $b = $b -replace 'versionCode\s+\d+', "versionCode $verCode"
  $b = $b -replace 'versionName\s+"[^"]*"', "versionName ""$AppVersion"""
  # Edition identity: always rewritten from the BASE id, so switching
  # full -> demo -> full within one session never stacks suffixes.
  $b = $b -replace 'applicationId\s+"[^"]*"', "applicationId ""$appId"""
  Write-TextNoBom $bg $b
  Info "Stamped APK version -> $AppVersion (versionCode $verCode), applicationId $appId"
}

# --- 5a3. Launcher label -----------------------------------------------------
$stringsXml = Join-Path $ROOT 'android\app\src\main\res\values\strings.xml'
if (Test-Path $stringsXml) {
  $x = Get-Content $stringsXml -Raw
  $x = $x -replace '(<string name="app_name">)[^<]*(</string>)', ('${1}' + $appLabel + '${2}')
  $x = $x -replace '(<string name="title_activity_main">)[^<]*(</string>)', ('${1}' + $appLabel + '${2}')
  Write-TextNoBom $stringsXml $x
  Info "App label -> $appLabel"
}

# --- 5b. Force landscape orientation on the main activity --------------------
$manifest = Join-Path $ROOT 'android\app\src\main\AndroidManifest.xml'
if (Test-Path $manifest) {
  $m = Get-Content $manifest -Raw
  if ($m -notmatch 'screenOrientation') {
    $m = $m -replace '(android:name="[^"]*MainActivity")', '$1 android:screenOrientation="sensorLandscape"'
    Write-TextNoBom $manifest $m
    Info "Set landscape orientation"
  }
}

# --- 5c. App icon (generated from icons/android-chrome-512x512.png) ----------
function Build-Icons {
  $src = Join-Path $ROOT 'icons\android-chrome-512x512.png'
  if (-not (Test-Path $src)) { Warn "Source icon not found - keeping default icon."; return }
  Add-Type -AssemblyName System.Drawing
  $orig = [System.Drawing.Image]::FromFile($src)

  $resBg = '#04040F'
  $launcher   = @{ 'mdpi'=48; 'hdpi'=72; 'xhdpi'=96; 'xxhdpi'=144; 'xxxhdpi'=192 }
  $foreground = @{ 'mdpi'=108;'hdpi'=162;'xhdpi'=216;'xxhdpi'=324;'xxxhdpi'=432 }
  $resRoot = Join-Path $ROOT 'android\app\src\main\res'

  function Resize-Fill($image, $size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.DrawImage($image, 0, 0, $size, $size)
    $g.Dispose()
    return $bmp
  }
  # Foreground: icon centred at ~58% on a transparent canvas (adaptive safe zone).
  function Resize-Foreground($image, $size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    $inner = [int]($size * 0.58)
    $off = [int](($size - $inner) / 2)
    $g.DrawImage($image, $off, $off, $inner, $inner)
    $g.Dispose()
    return $bmp
  }

  foreach ($dpi in $launcher.Keys) {
    $dir = Join-Path $resRoot ("mipmap-" + $dpi)
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $b1 = Resize-Fill $orig $launcher[$dpi]
    $b1.Save((Join-Path $dir 'ic_launcher.png'),       [System.Drawing.Imaging.ImageFormat]::Png)
    $b1.Save((Join-Path $dir 'ic_launcher_round.png'), [System.Drawing.Imaging.ImageFormat]::Png)
    $b1.Dispose()
    $b2 = Resize-Foreground $orig $foreground[$dpi]
    $b2.Save((Join-Path $dir 'ic_launcher_foreground.png'), [System.Drawing.Imaging.ImageFormat]::Png)
    $b2.Dispose()
  }
  $orig.Dispose()

  # Adaptive icon (API 26+) referencing our foreground + a solid background colour.
  $anydpi = Join-Path $resRoot 'mipmap-anydpi-v26'
  New-Item -ItemType Directory -Force -Path $anydpi | Out-Null
  $adaptive = @'
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
'@
  Write-TextNoBom (Join-Path $anydpi 'ic_launcher.xml')       $adaptive
  Write-TextNoBom (Join-Path $anydpi 'ic_launcher_round.xml') $adaptive

  $valuesDir = Join-Path $resRoot 'values'
  New-Item -ItemType Directory -Force -Path $valuesDir | Out-Null
  $colorXml = @"
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">$resBg</color>
</resources>
"@
  Write-TextNoBom (Join-Path $valuesDir 'ic_launcher_background.xml') $colorXml
  Info "Generated app icons"
}
Build-Icons

# --- 6. Assemble APK ---------------------------------------------------------
$distDir = Join-Path $ROOT ('dist\' + $appLabel + ' (Android)')
New-Item -ItemType Directory -Force -Path $distDir | Out-Null
if ($isRelease) { $apkBase = 'ByteBlaster' } else { $apkBase = "ByteBlaster-$suffix" }
Set-Location (Join-Path $ROOT 'android')
$gradlew = Join-Path $ROOT 'android\gradlew.bat'

if ($Variant -eq 'debug') {
  Info "Assembling DEBUG apk (first build downloads Gradle - be patient)..."
  & $gradlew assembleDebug --no-daemon
  if ($LASTEXITCODE -ne 0) { Die "Gradle assembleDebug failed." }
  $apk = Join-Path $ROOT 'android\app\build\outputs\apk\debug\app-debug.apk'
  if (-not (Test-Path $apk)) { Die "Debug APK not produced." }
  $dest = Join-Path $distDir ($apkBase + '-debug.apk')
  Copy-Item $apk $dest -Force
  Info "DONE -> $dest"
}
elseif ($Variant -eq 'aab') {
  # Play Store bundle (.aab): gradle signs it directly via keystore.properties
  # (apksigner only works on APKs). This is what you upload to Google Play; Play
  # re-signs with the app-signing key, which removes the "unverified app" notice
  # for end users installing from the Store.
  $keystore = Join-Path $BUILD 'byteblaster.keystore'
  if (-not (Test-Path $keystore)) {
    Warn "No keystore found. Creating one now (remember this password!)."
    $pw1 = Read-Host "Set keystore password" -AsSecureString
    $pwPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
                 [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw1))
    $keytool = Join-Path $javaHome 'bin\keytool.exe'
    & $keytool -genkeypair -v -keystore $keystore -alias byteblaster `
        -keyalg RSA -keysize 2048 -validity 10000 `
        -storepass $pwPlain -keypass $pwPlain `
        -dname "CN=Pixset Studio, OU=Games, O=Pixset Studio, C=US"
    if ($LASTEXITCODE -ne 0) { Die "keytool failed to create keystore." }
  } else {
    $pw1 = Read-Host "Keystore password" -AsSecureString
    $pwPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
                 [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw1))
  }

  # Write android/keystore.properties so build.gradle attaches the signing config
  # to bundleRelease. storeFile is relative to the android/ folder.
  $propsPath = Join-Path $ROOT 'android\keystore.properties'
  $storeRel = '../build/byteblaster.keystore'
  $lines = @(
    "storeFile=$storeRel",
    "storePassword=$pwPlain",
    "keyAlias=byteblaster",
    "keyPassword=$pwPlain"
  )
  Set-Content -Path $propsPath -Value $lines -Encoding ASCII

  Info "Bundling RELEASE .aab (signed via gradle)..."
  & $gradlew bundleRelease --no-daemon
  $bundleExit = $LASTEXITCODE
  # Remove the secrets file immediately, success or fail.
  Remove-Item $propsPath -Force -ErrorAction SilentlyContinue
  if ($bundleExit -ne 0) { Die "Gradle bundleRelease failed." }

  $aab = Join-Path $ROOT 'android\app\build\outputs\bundle\release\app-release.aab'
  if (-not (Test-Path $aab)) { Die ".aab not produced." }
  $dest = Join-Path $distDir ($apkBase + '-release.aab')
  Copy-Item $aab $dest -Force
  Info "DONE -> $dest"
  Info "Upload this .aab to Google Play Console (Production/Internal testing)."
}
else {
  # Release: build unsigned, then sign with a keystore via apksigner.
  $keystore = Join-Path $BUILD 'byteblaster.keystore'
  if (-not (Test-Path $keystore)) {
    Warn "No keystore found. Creating one now (remember this password!)."
    $pw1 = Read-Host "Set keystore password" -AsSecureString
    $pwPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
                 [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw1))
    $keytool = Join-Path $javaHome 'bin\keytool.exe'
    & $keytool -genkeypair -v -keystore $keystore -alias byteblaster `
        -keyalg RSA -keysize 2048 -validity 10000 `
        -storepass $pwPlain -keypass $pwPlain `
        -dname "CN=Pixset Studio, OU=Games, O=Pixset Studio, C=US"
    if ($LASTEXITCODE -ne 0) { Die "keytool failed to create keystore." }
  } else {
    $pw1 = Read-Host "Keystore password" -AsSecureString
    $pwPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
                 [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw1))
  }

  Info "Assembling RELEASE apk (unsigned)..."
  & $gradlew assembleRelease --no-daemon
  if ($LASTEXITCODE -ne 0) { Die "Gradle assembleRelease failed." }
  $unsigned = Join-Path $ROOT 'android\app\build\outputs\apk\release\app-release-unsigned.apk'
  if (-not (Test-Path $unsigned)) {
    $alt = Join-Path $ROOT 'android\app\build\outputs\apk\release\app-release.apk'
    if (Test-Path $alt) { $unsigned = $alt } else { Die "Release APK not produced." }
  }

  $bt = Get-ChildItem (Join-Path $sdk 'build-tools') -Directory |
          Sort-Object Name -Descending | Select-Object -First 1
  if (-not $bt) { Die "No build-tools found for zipalign/apksigner." }
  $zipalign  = Join-Path $bt.FullName 'zipalign.exe'
  $apksigner = Join-Path $bt.FullName 'apksigner.bat'

  $aligned = Join-Path $distDir 'aligned-unsigned.apk'
  $final   = Join-Path $distDir ($apkBase + '-release.apk')
  if (Test-Path $aligned) { Remove-Item $aligned -Force }
  Info "Zipaligning..."
  & $zipalign -f -p 4 $unsigned $aligned
  if ($LASTEXITCODE -ne 0) { Die "zipalign failed." }
  Info "Signing..."
  & $apksigner sign --ks $keystore --ks-key-alias byteblaster `
      --ks-pass "pass:$pwPlain" --key-pass "pass:$pwPlain" `
      --out $final $aligned
  if ($LASTEXITCODE -ne 0) { Die "apksigner failed." }
  Remove-Item $aligned -Force -ErrorAction SilentlyContinue
  & $apksigner verify $final | Out-Null
  Info "DONE -> $final"
}

Set-Location $ROOT
exit 0
