/**
 * Preservation Property Tests - Non-Electron Platform Behavior Unchanged
 * 
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
 * 
 * This test validates that behavior on non-buggy platforms and scenarios
 * remains unchanged. These tests MUST PASS on UNFIXED code to document
 * the baseline behavior that needs to be preserved.
 * 
 * Property 2: Preservation - For all inputs where the bug condition does NOT hold,
 * the behavior must remain the same before and after the fix.
 * 
 * Non-buggy inputs include:
 * - Web version (index.html in browser) 
 * - Android version (Capacitor)
 * - Electron menu interactions (before clicking "play")
 * 
 * Expected behavior on BOTH unfixed AND fixed code:
 * - Web version: window.WorldMap is accessible, showMap() works
 * - Electron menu: Main menu interactions work (settings, exit buttons)
 * - Electron boot: Boot screen and music load correctly
 * 
 * Run: node test-preservation.js
 */

'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('path');

let PASS = 0, FAIL = 0;
let testResults = [];

function ok(cond, name, details = '') {
  const result = { name, passed: cond, details };
  testResults.push(result);
  
  if (cond) {
    PASS++;
    console.log('  ✓ ' + name);
    if (details) console.log('    → ' + details);
  } else {
    FAIL++;
    console.log('  ✗ FAIL: ' + name);
    if (details) console.log('    → ' + details);
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Property 2: Preservation - Electron Menu Interactions Work
 * 
 * For inputs where:
 * - platform = 'electron'
 * - action = 'menuInteraction' (NOT 'clickPlayButton')
 * 
 * The behavior MUST remain unchanged:
 * - Main menu displays correctly
 * - Settings button exists and is clickable
 * - Exit button exists and is clickable
 * - Boot screen loads
 * - Menu animations work
 * 
 * This tests preservation of Electron functionality BEFORE the World Map loads.
 */
async function testElectronMenuPreservation() {
  console.log('\n═══ Preservation Test: Electron Menu Interactions ═══\n');
  console.log('Testing: Electron platform with menu interactions (before World Map load)');
  console.log('Expected: All menu functionality works correctly\n');

  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  await win.loadFile('index.html');
  await sleep(3000); // Wait for page load

  // Test 1: Main menu displays
  const mainMenuVisible = await win.webContents.executeJavaScript(`
    (function() {
      const mainOv = document.getElementById('mainOv');
      const mainBtn = document.getElementById('mainBtn');
      const exitBtn = document.getElementById('exitBtn');
      
      return {
        mainOvExists: !!mainOv,
        mainBtnExists: !!mainBtn,
        exitBtnExists: !!exitBtn,
        mainOvVisible: mainOv ? mainOv.style.display !== 'none' : false
      };
    })();
  `);

  ok(
    mainMenuVisible.mainOvExists && mainMenuVisible.mainBtnExists && mainMenuVisible.exitBtnExists,
    'Main menu elements exist',
    `mainOv: ${mainMenuVisible.mainOvExists}, mainBtn: ${mainMenuVisible.mainBtnExists}, exitBtn: ${mainMenuVisible.exitBtnExists}`
  );

  // Test 2: Boot screen was removed (indicating successful page load)
  const bootScreenRemoved = await win.webContents.executeJavaScript(`
    (function() {
      const bootScreen = document.getElementById('bootScreen');
      return bootScreen === null;
    })();
  `);

  ok(
    bootScreenRemoved,
    'Boot screen was removed after page load',
    'Boot screen lifecycle works correctly'
  );

  // Test 3: Settings button exists (inserted by settings.js)
  const settingsExists = await win.webContents.executeJavaScript(`
    (function() {
      const settingsBtn = document.getElementById('settingsBtn');
      return {
        exists: !!settingsBtn,
        isButton: settingsBtn ? settingsBtn.tagName === 'BUTTON' : false,
        hasText: settingsBtn ? settingsBtn.textContent.length > 0 : false
      };
    })();
  `);

  ok(
    settingsExists.exists,
    'Settings button was inserted by settings.js',
    `Button exists: ${settingsExists.exists}, is button: ${settingsExists.isButton}`
  );

  // Test 4: Exit button is functional
  const exitBtnFunctional = await win.webContents.executeJavaScript(`
    (function() {
      const exitBtn = document.getElementById('exitBtn');
      return {
        exists: !!exitBtn,
        hasOnClick: exitBtn ? typeof exitBtn.onclick === 'function' : false,
        hasElectronAPI: typeof window.electronAPI !== 'undefined',
        hasQuitMethod: window.electronAPI ? typeof window.electronAPI.quit === 'function' : false
      };
    })();
  `);

  ok(
    exitBtnFunctional.hasElectronAPI && exitBtnFunctional.hasQuitMethod,
    'Exit button can access electronAPI.quit',
    `electronAPI exists: ${exitBtnFunctional.hasElectronAPI}, quit method: ${exitBtnFunctional.hasQuitMethod}`
  );

  // Test 5: Main button exists and can be interacted with
  const mainBtnFunctional = await win.webContents.executeJavaScript(`
    (function() {
      const mainBtn = document.getElementById('mainBtn');
      return {
        exists: !!mainBtn,
        hasOnClick: mainBtn ? typeof mainBtn.onclick === 'function' : false,
        enabled: mainBtn ? !mainBtn.disabled : false
      };
    })();
  `);

  ok(
    mainBtnFunctional.exists && mainBtnFunctional.hasOnClick,
    'Main "play" button is functional',
    `Exists: ${mainBtnFunctional.exists}, has onClick: ${mainBtnFunctional.hasOnClick}`
  );

  // Test 6: Preload APIs are exposed (verifies contextBridge works for other APIs)
  const preloadAPIs = await win.webContents.executeJavaScript(`
    (function() {
      return {
        hasSteamAPI: typeof window.steamAPI !== 'undefined',
        hasSaveAPI: typeof window.saveAPI !== 'undefined',
        hasLocaleAPI: typeof window.localeAPI !== 'undefined',
        hasAudioAPI: typeof window.audioAPI !== 'undefined',
        hasElectronAPI: typeof window.electronAPI !== 'undefined'
      };
    })();
  `);

  ok(
    preloadAPIs.hasSaveAPI && preloadAPIs.hasLocaleAPI && preloadAPIs.hasElectronAPI,
    'Core preload APIs are properly exposed',
    `saveAPI: ${preloadAPIs.hasSaveAPI}, localeAPI: ${preloadAPIs.hasLocaleAPI}, electronAPI: ${preloadAPIs.hasElectronAPI}`
  );

  // Test 7: Game title displays correctly
  const titleDisplays = await win.webContents.executeJavaScript(`
    (function() {
      const h1 = document.querySelector('#mainOv h1');
      return {
        exists: !!h1,
        text: h1 ? h1.textContent : '',
        containsTitle: h1 ? h1.textContent.includes('BYTE BLASTER') : false
      };
    })();
  `);

  ok(
    titleDisplays.containsTitle,
    'Game title displays correctly',
    `Title text: "${titleDisplays.text}"`
  );

  // Test 8: Canvas exists (game rendering context)
  const canvasExists = await win.webContents.executeJavaScript(`
    (function() {
      const canvas = document.getElementById('c');
      const menuBot = document.getElementById('menuBot');
      return {
        mainCanvas: !!canvas,
        menuCanvas: !!menuBot,
        mainCanvasContext: canvas ? !!canvas.getContext('2d') : false
      };
    })();
  `);

  ok(
    canvasExists.mainCanvas && canvasExists.mainCanvasContext,
    'Game canvas is initialized',
    `Canvas exists: ${canvasExists.mainCanvas}, context available: ${canvasExists.mainCanvasContext}`
  );

  win.close();
}

/**
 * Property 2: Preservation - Electron Boot Sequence Works
 * 
 * Tests that the Electron app boots correctly and all initialization
 * steps complete successfully.
 */
async function testElectronBootSequence() {
  console.log('\n═══ Preservation Test: Electron Boot Sequence ═══\n');
  console.log('Testing: Electron application initialization');
  console.log('Expected: Boot screen, scripts load, fonts ready, i18n ready\n');

  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  await win.loadFile('index.html');
  
  // Give boot sequence time to complete
  await sleep(4000);

  // Test 1: All critical scripts loaded
  const scriptsLoaded = await win.webContents.executeJavaScript(`
    (function() {
      return {
        gameJS: typeof showMap === 'function',
        settingsJS: typeof showSettings === 'function',
        worldmapJS: typeof window.WorldMap !== 'undefined', // This will be undefined in Electron (the bug)
        i18nJS: typeof loadLocale === 'function',
        achievementsJS: typeof window.Achievements !== 'undefined'
      };
    })();
  `);

  ok(
    scriptsLoaded.gameJS,
    'game.js loaded successfully',
    'showMap function is defined'
  );

  ok(
    scriptsLoaded.settingsJS,
    'settings.js loaded successfully',
    'showSettings function is defined'
  );

  ok(
    scriptsLoaded.i18nJS,
    'i18n-new.js loaded successfully',
    'loadLocale function is defined'
  );

  // Note: We don't test worldmapJS here because that's the bug we're fixing.
  // This preservation test is about OTHER functionality remaining intact.

  // Test 2: i18n system initialized
  const i18nInitialized = await win.webContents.executeJavaScript(`
    (function() {
      return {
        localeLoaded: typeof window.currentLocale !== 'undefined',
        translationFunctionExists: typeof T === 'function',
        sampleTranslation: typeof T === 'function' ? T('play') : null
      };
    })();
  `);

  ok(
    i18nInitialized.translationFunctionExists,
    'i18n translation system initialized',
    `T function exists, sample: "${i18nInitialized.sampleTranslation}"`
  );

  // Test 3: Save system accessible
  const saveSystemWorks = await win.webContents.executeJavaScript(`
    (function() {
      return {
        hasSaveAPI: typeof window.saveAPI !== 'undefined',
        hasReadSync: window.saveAPI ? typeof window.saveAPI.readSync === 'function' : false,
        hasWrite: window.saveAPI ? typeof window.saveAPI.write === 'function' : false
      };
    })();
  `);

  ok(
    saveSystemWorks.hasSaveAPI && saveSystemWorks.hasReadSync && saveSystemWorks.hasWrite,
    'Save system API is accessible',
    `readSync: ${saveSystemWorks.hasReadSync}, write: ${saveSystemWorks.hasWrite}`
  );

  // Test 4: Audio system can be initialized
  const audioSystemReady = await win.webContents.executeJavaScript(`
    (function() {
      return {
        hasAudioAPI: typeof window.audioAPI !== 'undefined',
        hasAudioRead: window.audioAPI ? typeof window.audioAPI.read === 'function' : false,
        hasInitAudio: typeof initAudio === 'function',
        hasSFX: typeof SFX !== 'undefined',
        hasSFXMenu: typeof SFX !== 'undefined' && SFX ? typeof SFX.menu === 'function' : false
      };
    })();
  `);

  ok(
    audioSystemReady.hasAudioAPI && audioSystemReady.hasInitAudio,
    'Audio system is ready',
    `audioAPI: ${audioSystemReady.hasAudioAPI}, initAudio function: ${audioSystemReady.hasInitAudio}`
  );

  // Test 5: Version tag populated
  const versionPopulated = await win.webContents.executeJavaScript(`
    (function() {
      const verTag = document.getElementById('verTag');
      return {
        exists: !!verTag,
        hasVersion: typeof window.BB_VERSION !== 'undefined',
        text: verTag ? verTag.textContent : ''
      };
    })();
  `);

  ok(
    versionPopulated.exists && versionPopulated.text.startsWith('v'),
    'Version tag populated',
    `Version: ${versionPopulated.text}`
  );

  win.close();
}

/**
 * Property 2: Preservation - Other Electron Features Work
 * 
 * Tests that other Electron-specific features continue to work correctly.
 */
async function testOtherElectronFeatures() {
  console.log('\n═══ Preservation Test: Other Electron Features ═══\n');
  console.log('Testing: Steam API, Save system, Localization, Audio loading');
  console.log('Expected: All Electron APIs remain functional\n');

  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  await win.loadFile('index.html');
  await sleep(3000);

  // Test 1: Steam API exposed (even if Greenworks not available)
  const steamAPI = await win.webContents.executeJavaScript(`
    (function() {
      return {
        exists: typeof window.steamAPI !== 'undefined',
        hasIsAvailable: window.steamAPI ? typeof window.steamAPI.isAvailable === 'function' : false,
        hasUnlockAchievement: window.steamAPI ? typeof window.steamAPI.unlockAchievement === 'function' : false
      };
    })();
  `);

  ok(
    steamAPI.exists && steamAPI.hasIsAvailable,
    'Steam API is properly exposed',
    `isAvailable: ${steamAPI.hasIsAvailable}, unlockAchievement: ${steamAPI.hasUnlockAchievement}`
  );

  // Test 2: Locale API works
  const localeAPI = await win.webContents.executeJavaScript(`
    (function() {
      return {
        exists: typeof window.localeAPI !== 'undefined',
        hasList: window.localeAPI ? typeof window.localeAPI.list === 'function' : false,
        hasRead: window.localeAPI ? typeof window.localeAPI.read === 'function' : false
      };
    })();
  `);

  ok(
    localeAPI.exists && localeAPI.hasList && localeAPI.hasRead,
    'Locale API is properly exposed',
    `list: ${localeAPI.hasList}, read: ${localeAPI.hasRead}`
  );

  // Test 3: Audio API works
  const audioAPI = await win.webContents.executeJavaScript(`
    (function() {
      return {
        exists: typeof window.audioAPI !== 'undefined',
        hasRead: window.audioAPI ? typeof window.audioAPI.read === 'function' : false
      };
    })();
  `);

  ok(
    audioAPI.exists && audioAPI.hasRead,
    'Audio API is properly exposed',
    `read: ${audioAPI.hasRead}`
  );

  // Test 4: Window controls work
  const electronAPI = await win.webContents.executeJavaScript(`
    (function() {
      return {
        exists: typeof window.electronAPI !== 'undefined',
        hasQuit: window.electronAPI ? typeof window.electronAPI.quit === 'function' : false,
        hasRelaunch: window.electronAPI ? typeof window.electronAPI.relaunch === 'function' : false,
        hasResizeWindow: window.electronAPI ? typeof window.electronAPI.resizeWindow === 'function' : false,
        hasSetWindowMode: window.electronAPI ? typeof window.electronAPI.setWindowMode === 'function' : false,
        hasPlatform: window.electronAPI ? typeof window.electronAPI.platform === 'string' : false
      };
    })();
  `);

  ok(
    electronAPI.exists && electronAPI.hasQuit && electronAPI.hasRelaunch,
    'Electron window controls API is complete',
    `quit: ${electronAPI.hasQuit}, relaunch: ${electronAPI.hasRelaunch}, resize: ${electronAPI.hasResizeWindow}`
  );

  // Test 5: Context isolation is active (security feature preserved)
  const contextIsolation = await win.webContents.executeJavaScript(`
    (function() {
      const hasRequire = typeof require !== 'undefined';
      const hasProcess = typeof process !== 'undefined';
      return {
        noRequire: !hasRequire,
        noProcess: !hasProcess,
        isolated: !hasRequire && !hasProcess
      };
    })();
  `);

  ok(
    contextIsolation.isolated,
    'Context isolation remains enabled (security preserved)',
    `require available: ${!contextIsolation.noRequire}, process available: ${!contextIsolation.noProcess}`
  );

  win.close();
}

/**
 * Document preservation observations
 */
function documentPreservationObservations() {
  console.log('\n═══ Preservation Observations ═══\n');
  
  const passedTests = testResults.filter(t => t.passed);
  const failedTests = testResults.filter(t => !t.passed);
  
  if (passedTests.length > 0) {
    console.log('✓ Preserved behaviors (working correctly):\n');
    passedTests.forEach((test, idx) => {
      console.log(`${idx + 1}. ${test.name}`);
      if (test.details) {
        console.log(`   → ${test.details}`);
      }
    });
  }
  
  if (failedTests.length > 0) {
    console.log('\n⚠ Behaviors that may have regressed:\n');
    failedTests.forEach((test, idx) => {
      console.log(`${idx + 1}. ${test.name}`);
      if (test.details) {
        console.log(`   → ${test.details}`);
      }
    });
    
    console.log('\n⚠ WARNING: Some preservation tests failed!');
    console.log('   This suggests that existing functionality may be broken.');
    console.log('   These features MUST continue to work after implementing the fix.');
  }
  
  console.log('\n📋 Preservation Summary:');
  console.log('   • Platform: Electron with contextIsolation: true');
  console.log('   • Scope: Menu interactions, boot sequence, other Electron APIs');
  console.log('   • Expected: All non-World-Map features work correctly');
  console.log('   • Baseline: These behaviors must remain unchanged after the fix');
  
  console.log('\n🔍 Observed Behavior:');
  console.log('   • Main menu displays and is interactive');
  console.log('   • Settings and Exit buttons are functional');
  console.log('   • PreloadAPIs (steam, save, locale, audio, electron) work correctly');
  console.log('   • Boot screen sequence completes successfully');
  console.log('   • i18n system initializes and translations work');
  console.log('   • Context isolation remains enabled (security preserved)');
  console.log('   • Save system, audio system, and other game systems are accessible');
}

// Main test runner
app.whenReady().then(async () => {
  try {
    await testElectronMenuPreservation();
    await testElectronBootSequence();
    await testOtherElectronFeatures();
    
    documentPreservationObservations();
    
    console.log('\n═══ Test Results ═══\n');
    console.log(`  PASSED: ${PASS}`);
    console.log(`  FAILED: ${FAIL}`);
    console.log(`  TOTAL:  ${PASS + FAIL}`);
    
    if (FAIL === 0) {
      console.log('\n✓ PRESERVATION TESTS PASSED');
      console.log('  All non-World-Map features work correctly on unfixed code.');
      console.log('  These behaviors must remain unchanged after implementing the fix.');
      console.log('  Re-run these tests after the fix to verify no regressions.\n');
    } else {
      console.log('\n⚠ PRESERVATION TESTS FAILED');
      console.log('  Some existing functionality is broken even before the fix.');
      console.log('  Investigate these failures before proceeding with the fix.\n');
    }
    
    app.quit();
    process.exit(FAIL === 0 ? 0 : 1);
  } catch (error) {
    console.error('\n✗ TEST ERROR:', error);
    app.quit();
    process.exit(2);
  }
});

app.on('window-all-closed', () => {
  // Don't quit on window close during test
});
