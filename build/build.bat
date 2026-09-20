@echo off
REM ============================================================
REM  Byte Blaster - Build
REM  Lives in build/ and operates from the project root (one
REM  level up), where package.json lives.
REM
REM  Flow: ALL questions are asked first (target, edition, version
REM  and - when relevant - the Android variant). After that the
REM  build runs unattended (no more prompts), the output folder(s)
REM  open in Explorer, and the window closes by itself on success.
REM  It only pauses if a build step failed, so the error stays
REM  on screen.
REM
REM  REMEMBERED ANSWERS: every question defaults to what you chose
REM  last time (stored in build/build-prefs.cmd, machine-local).
REM  Press ENTER to keep an answer. Pick [R] at the first prompt to
REM  repeat the whole previous build without being asked anything.
REM  Delete build-prefs.cmd to go back to the factory defaults.
REM
REM  Editions: FULL is the whole game; DEMO is the cut-down build
REM  (see docs/BUILD_GUIDE.md). They write to separate dist/
REM  folders - "Byte Blaster (...)" vs "Byte Blaster Demo (...)" -
REM  so building both in one run never overwrites anything.
REM ============================================================
setlocal EnableExtensions
cd /d "%~dp0.."
title Byte Blaster - Build

REM Node is required for the version bump and every build target.
where node >nul 2>&1
if errorlevel 1 ( echo [ERROR] Node.js not found in PATH. Install Node.js first. & echo. & pause & goto :eof )

REM ---- Factory defaults, then last session's answers on top ---------------
set "PREFS=%~dp0build-prefs.cmd"
set "choice=1"
set "echoice=1"
set "achoice=1"
set "APP_VERSION="
set "REPEAT="
if exist "%PREFS%" call "%PREFS%"

REM ================= PHASE 1 - ASK EVERYTHING UP FRONT =================
cls
echo ==================================================
echo                BYTE BLASTER - BUILD
echo ==================================================
echo.
echo    [1]  Windows .exe    (Steam / portable)
echo    [2]  Web (HTML)      (desktop + mobile)
echo    [3]  Android (.apk)
echo    [4]  All three
echo    [R]  Repeat last build - no further questions
echo    [0]  Exit
echo.
call :show_last
set "PREV=%choice%"
set "choice="
set /p "choice=Select an option [%PREV%]: "
if not defined choice set "choice=%PREV%"
if /i "%choice%"=="R" ( set "choice=%PREV%" & set "REPEAT=1" )
if "%choice%"=="0" goto :eof
if "%choice%"=="1" goto okchoice
if "%choice%"=="2" goto okchoice
if "%choice%"=="3" goto okchoice
if "%choice%"=="4" goto okchoice
echo.
echo  Invalid choice "%choice%".
echo.
pause
goto :eof
:okchoice

if defined REPEAT goto ready

REM ---- Build type ----
REM  Tip sborki - eto kanal, a ne obyom kontenta: polnuyu igru otkryvaet
REM  litsenziya na akkaunte Pixset Studio, bez neyo vezde igraetsya pervyy mir.
echo.
echo  Which build type?
echo    [1]  dev
echo    [2]  demo
echo    [3]  pre-alpha
echo    [4]  alpha
echo    [5]  beta
echo    [6]  release
set "PREV=%echoice%"
set "echoice="
set /p "echoice=Select [1-6] [%PREV%]: "
if not defined echoice set "echoice=%PREV%"

REM ---- Game version. package.json already holds the last built version, so
REM ---- that is the remembered value; ENTER keeps it. ----
set "CURVER="
for /f "delims=" %%v in ('node -p "require('./package.json').version" 2^>nul') do set "CURVER=%%v"
if not defined CURVER set "CURVER=1.0.0"
set "APP_VERSION="
set /p "APP_VERSION=Game version to build [%CURVER%]: "
if not defined APP_VERSION set "APP_VERSION=%CURVER%"

REM ---- Android output variant (only when Android is in the build) ----
if "%choice%"=="3" call :ask_android
if "%choice%"=="4" call :ask_android

:ready
REM Resolve the answers into the values PHASE 2 uses. Done here (not inside the
REM question block) so [R] gets exactly the same values without asking.
set "BUILDTYPE=dev"
if "%echoice%"=="2" set "BUILDTYPE=demo"
if "%echoice%"=="3" set "BUILDTYPE=pre-alpha"
if "%echoice%"=="4" set "BUILDTYPE=alpha"
if "%echoice%"=="5" set "BUILDTYPE=beta"
if "%echoice%"=="6" set "BUILDTYPE=release"
set "variant=debug"
if "%achoice%"=="2" set "variant=release"
if "%achoice%"=="3" set "variant=aab"
if not defined APP_VERSION (
  for /f "delims=" %%v in ('node -p "require('./package.json').version" 2^>nul') do set "APP_VERSION=%%v"
)
if not defined APP_VERSION set "APP_VERSION=1.0.0"

REM Remember these answers for next time (written before building, so they are
REM kept even if a build step fails).
call :save_prefs

echo.
echo --------------------------------------------------
echo  Building v%APP_VERSION% ^| build type: %BUILDTYPE% ^| target %choice%
echo  No more questions.
echo --------------------------------------------------

REM ================= PHASE 2 - BUILD (UNATTENDED) =================
REM Persist the chosen version into package.json (-> .exe version) AND
REM assets/version.js (-> in-game tag). android-build.ps1 reads it for the .apk.
node "%~dp0set-version.js" "%APP_VERSION%"
if errorlevel 1 ( echo [ERROR] Failed to write version. & echo. & pause & goto :eof )

set "FAIL=0"
set "DID_EXE=0"
set "DID_WEB=0"
set "DID_APK=0"

REM set-edition.js stamps assets/edition.js, which every build script reads to
REM decide its output name - so build types never overwrite each other.
call :build_type %BUILDTYPE%

REM Leave the working tree on dev: after building a release, npm start should
REM run the ordinary working build, not one stamped as release.
node "%~dp0set-edition.js" dev >nul

REM ================= PHASE 3 - OPEN OUTPUT + CLOSE =================
echo.
if "%DID_EXE%"=="1" if exist "dist\Byte Blaster (Steam)"   start "" "dist\Byte Blaster (Steam)"
if "%DID_WEB%"=="1" if exist "dist\Byte Blaster (HTML)"    start "" "dist\Byte Blaster (HTML)"
if "%DID_APK%"=="1" if exist "dist\Byte Blaster (Android)" start "" "dist\Byte Blaster (Android)"

if "%FAIL%"=="1" (
  echo --------------------------------------------------
  echo  Finished WITH ERRORS - see the messages above.
  echo --------------------------------------------------
  echo.
  pause
) else (
  echo --------------------------------------------------
  echo  Build finished successfully. Closing...
  echo --------------------------------------------------
)
goto :eof

REM ============================================================
REM  Remembered answers
REM ============================================================
:show_last
if not exist "%PREFS%" ( echo  ^(first run - nothing remembered yet^) & echo. & exit /b 0 )
set "_ed=dev"
if "%echoice%"=="2" set "_ed=demo"
if "%echoice%"=="3" set "_ed=pre-alpha"
if "%echoice%"=="4" set "_ed=alpha"
if "%echoice%"=="5" set "_ed=beta"
if "%echoice%"=="6" set "_ed=release"
set "_av=debug"
if "%achoice%"=="2" set "_av=release"
if "%achoice%"=="3" set "_av=aab"
echo  Last time: target %choice% ^| build type %_ed% ^| android %_av%
:show_last_end
echo.
exit /b 0

:save_prefs
> "%PREFS%" echo @echo off
>>"%PREFS%" echo REM Written by build.bat - your last answers. Safe to delete.
>>"%PREFS%" echo set "choice=%choice%"
>>"%PREFS%" echo set "echoice=%echoice%"
>>"%PREFS%" echo set "achoice=%achoice%"
exit /b 0

REM ============================================================
REM  Question subroutines (run during PHASE 1 only)
REM ============================================================
:ask_android
echo.
echo  Android output:
echo    [1]  Debug APK         (quick test install on your phone)
echo    [2]  Release APK       (signed, for sideloading / sharing)
echo    [3]  Release .aab      (signed bundle to UPLOAD to Google Play)
set "PREV=%achoice%"
set "achoice="
set /p "achoice=Select [1/2/3] [%PREV%]: "
if not defined achoice set "achoice=%PREV%"
exit /b 0

REM ============================================================
REM  Per-edition pass (PHASE 2 - no prompts)
REM ============================================================
:build_type
set "ED=%~1"
echo.
echo ==================================================
echo  BUILD TYPE: %ED%
echo ==================================================
node "%~dp0set-edition.js" %ED%
if errorlevel 1 ( echo [ERROR] Failed to write build type. & set "FAIL=1" & exit /b 1 )

if "%choice%"=="1" call :do_exe
if "%choice%"=="2" call :do_web
if "%choice%"=="3" call :do_android
if "%choice%"=="4" ( call :do_exe & call :do_web & call :do_android )
exit /b 0

REM ============================================================
REM  Build subroutines (PHASE 2 - no prompts)
REM ============================================================
:do_exe
echo.
echo === Building Windows .exe (%ED%) ===
call :ensure_npm || ( set "FAIL=1" & exit /b 1 )
call npm run build:steam
if errorlevel 1 ( echo [ERROR] .exe build failed. & set "FAIL=1" & exit /b 1 )
set "DID_EXE=1"
exit /b 0

:do_web
echo.
echo === Building Web (HTML) (%ED%) ===
call :ensure_npm || ( set "FAIL=1" & exit /b 1 )
call npm run build:html
if errorlevel 1 ( echo [ERROR] Web build failed. & set "FAIL=1" & exit /b 1 )
set "DID_WEB=1"
exit /b 0

:do_android
echo.
echo === Building Android (%variant%) (%ED%) ===
call :ensure_npm || ( set "FAIL=1" & exit /b 1 )
echo  ^(first Android build downloads a JDK + Gradle - this can take a while^)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0android-build.ps1" -Variant %variant% -AppVersion "%APP_VERSION%" -Edition %ED%
if errorlevel 1 ( echo [ERROR] Android build failed. & set "FAIL=1" & exit /b 1 )
set "DID_APK=1"
exit /b 0

:ensure_npm
where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js / npm not found in PATH. Install Node.js first.
  exit /b 1
)
if not exist "node_modules" (
  echo Installing npm dependencies ^(first run^)...
  call npm install
  if errorlevel 1 ( echo [ERROR] npm install failed. & exit /b 1 )
)
exit /b 0
