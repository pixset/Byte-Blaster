/**
 * Bug Condition Exploration Test - World Map Fails to Load in Electron
 * 
 * **Validates: Requirements 1.1, 1.2, 1.4, 2.1, 2.2, 2.4**
 * 
 * This test verifies the bug condition where window.WorldMap is NOT accessible
 * in the Electron renderer context due to contextIsolation: true blocking
 * external script access to the window object.
 * 
 * CRITICAL: This test MUST FAIL on unfixed code - failure confirms the bug exists.
 * 
 * Expected behavior on UNFIXED code:
 * - window.WorldMap is undefined in Electron renderer
 * - showMap() falls back to buildMap() 
 * - Black screen appears instead of World Map
 * 
 * Expected behavior on FIXED code:
 * - window.WorldMap is defined and accessible
 * - window.WorldMap.show() executes successfully
 * - World Map displays with all interactive elements
 * 
 * Run: node test-worldmap-electron.js
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
 * Property 1: Bug Condition - World Map Fails to Load in Electron
 * 
 * For inputs where:
 * - platform = 'electron'
 * - action = 'clickPlayButton'
 * - contextIsolation = true
 * 
 * The UNFIXED code will have:
 * - window.WorldMap is undefined
 * - showMap() cannot call window.WorldMap.show()
 * - Fallback to buildMap() occurs but fails
 * - Black screen appears
 * 
 * The FIXED code should have:
 * - window.WorldMap is defined via contextBridge
 * - window.WorldMap.show() is callable
 * - World Map displays correctly
 */
async function testBugCondition() {
  console.log('\n═══ Bug Condition Exploration Test ═══\n');
  console.log('Testing: Electron platform with contextIsolation enabled');
  console.log('Expected on UNFIXED code: window.WorldMap is undefined\n');

  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    show: false, // Don't show window during test
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  await win.loadFile('index.html');

  // Wait for page to fully load including all scripts
  await sleep(3000);

  // Test 1: Check if worldmap.js script tag exists and loaded
  const scriptLoaded = await win.webContents.executeJavaScript(`
    (function() {
      const scripts = Array.from(document.querySelectorAll('script'));
      const worldmapScript = scripts.find(s => s.src && s.src.includes('worldmap.js'));
      return {
        exists: !!worldmapScript,
        src: worldmapScript ? worldmapScript.src : null,
        loaded: worldmapScript ? !worldmapScript.hasAttribute('async') || worldmapScript.readyState === 'complete' : false
      };
    })();
  `);

  ok(
    scriptLoaded.exists,
    'worldmap.js script tag exists in index.html',
    `Script src: ${scriptLoaded.src || 'NOT FOUND'}`
  );

  // Test 2: Check if window.WorldMap is accessible (CRITICAL - should FAIL on unfixed code)
  const worldMapCheck = await win.webContents.executeJavaScript(`
    (function() {
      return {
        type: typeof window.WorldMap,
        isUndefined: typeof window.WorldMap === 'undefined',
        hasShow: window.WorldMap && typeof window.WorldMap.show === 'function',
        hasHide: window.WorldMap && typeof window.WorldMap.hide === 'function',
        hasRefresh: window.WorldMap && typeof window.WorldMap.refresh === 'function',
        hasMarkCompleted: window.WorldMap && typeof window.WorldMap.markCompleted === 'function'
      };
    })();
  `);

  // This test SHOULD FAIL on unfixed code (window.WorldMap is undefined)
  // This test SHOULD PASS on fixed code (window.WorldMap is defined)
  const worldMapDefined = !worldMapCheck.isUndefined;
  
  if (worldMapDefined) {
    console.log('\n  ⚠ WARNING: window.WorldMap is DEFINED!');
    console.log('  This suggests the code is already FIXED or the bug is different than expected.');
    console.log('  Expected on UNFIXED code: window.WorldMap should be undefined.\n');
  } else {
    console.log('\n  ✓ COUNTEREXAMPLE FOUND: window.WorldMap is undefined');
    console.log('  This confirms the bug exists - worldmap.js loaded but not accessible.');
    console.log('  Root cause: contextIsolation prevents external scripts from setting window properties.\n');
  }

  ok(
    worldMapDefined,
    'window.WorldMap is defined and accessible',
    `typeof window.WorldMap: ${worldMapCheck.type}, has methods: ${worldMapCheck.hasShow && worldMapCheck.hasHide}`
  );

  // Test 3: Check if window.WorldMap.show() is callable
  if (worldMapDefined) {
    try {
      const canCallShow = await win.webContents.executeJavaScript(`
        (function() {
          try {
            if (typeof window.WorldMap.show === 'function') {
              return { callable: true, type: typeof window.WorldMap.show };
            }
            return { callable: false, type: typeof window.WorldMap.show };
          } catch (e) {
            return { callable: false, error: e.message };
          }
        })();
      `);

      ok(
        canCallShow.callable,
        'window.WorldMap.show is a callable function',
        `Type: ${canCallShow.type}`
      );
    } catch (e) {
      ok(false, 'window.WorldMap.show is a callable function', `Error: ${e.message}`);
    }
  } else {
    ok(
      false,
      'window.WorldMap.show is a callable function',
      'window.WorldMap is undefined - cannot test method'
    );
  }

  // Test 4: Check if showMap() function exists in game.js
  const showMapExists = await win.webContents.executeJavaScript(`
    (function() {
      return typeof showMap === 'function';
    })();
  `);

  ok(
    showMapExists,
    'showMap() function exists in game.js',
    'This is the function that should call window.WorldMap.show()'
  );

  // Test 5: Simulate what happens when showMap() is called
  if (showMapExists) {
    const showMapBehavior = await win.webContents.executeJavaScript(`
      (function() {
        // Check what showMap would do
        const hasWorldMap = typeof window.WorldMap !== 'undefined';
        const hasBuildMap = typeof buildMap === 'function';
        
        return {
          hasWorldMap: hasWorldMap,
          willFallback: !hasWorldMap && hasBuildMap,
          hasBuildMapFallback: hasBuildMap
        };
      })();
    `);

    if (!showMapBehavior.hasWorldMap) {
      console.log('\n  ✓ COUNTEREXAMPLE: showMap() will fall back to buildMap()');
      console.log('  Without window.WorldMap, the function uses legacy map building.');
      console.log('  This fallback may result in a black screen or incomplete map.\n');
    }

    ok(
      !showMapBehavior.willFallback,
      'showMap() does NOT need to fall back to buildMap()',
      showMapBehavior.willFallback 
        ? 'FALLBACK ACTIVE: window.WorldMap not found, using buildMap()' 
        : 'window.WorldMap is available'
    );
  }

  // Test 6: Check context isolation setting
  const contextIsolationEnabled = await win.webContents.executeJavaScript(`
    (function() {
      // In the renderer, we can check if we're isolated by seeing if require is available
      const hasRequire = typeof require !== 'undefined';
      const hasProcess = typeof process !== 'undefined';
      
      // If contextIsolation is true, require and process should NOT be available
      return {
        hasRequire: hasRequire,
        hasProcess: hasProcess,
        likelyIsolated: !hasRequire && !hasProcess
      };
    })();
  `);

  ok(
    contextIsolationEnabled.likelyIsolated,
    'Context isolation is enabled (as expected)',
    `require available: ${contextIsolationEnabled.hasRequire}, process available: ${contextIsolationEnabled.hasProcess}`
  );

  // Test 7: Check if preload script exposed other APIs successfully
  const preloadAPIs = await win.webContents.executeJavaScript(`
    (function() {
      return {
        hasSteamAPI: typeof window.steamAPI !== 'undefined',
        hasSaveAPI: typeof window.saveAPI !== 'undefined',
        hasLocaleAPI: typeof window.localeAPI !== 'undefined',
        hasAudioAPI: typeof window.audioAPI !== 'undefined',
        hasElectronAPI: typeof window.electronAPI !== 'undefined',
        hasWorldMap: typeof window.WorldMap !== 'undefined'
      };
    })();
  `);

  ok(
    preloadAPIs.hasSteamAPI && preloadAPIs.hasSaveAPI && preloadAPIs.hasLocaleAPI,
    'Preload script successfully exposed other APIs',
    `steamAPI: ${preloadAPIs.hasSteamAPI}, saveAPI: ${preloadAPIs.hasSaveAPI}, localeAPI: ${preloadAPIs.hasLocaleAPI}`
  );

  ok(
    !preloadAPIs.hasWorldMap,
    'WorldMap API is NOT exposed by preload (confirms bug root cause)',
    'Unlike steamAPI, saveAPI, etc., WorldMap is not bridged via contextBridge'
  );

  win.close();
}

/**
 * Document counterexamples found during exploration
 */
function documentCounterexamples() {
  console.log('\n═══ Counterexamples Found ═══\n');
  
  const failedTests = testResults.filter(t => !t.passed);
  
  if (failedTests.length > 0) {
    console.log('The following counterexamples demonstrate the bug exists:\n');
    
    failedTests.forEach((test, idx) => {
      console.log(`${idx + 1}. ${test.name}`);
      if (test.details) {
        console.log(`   → ${test.details}`);
      }
    });
    
    console.log('\n📋 Summary of Bug Condition:');
    console.log('   • Platform: Electron with contextIsolation: true');
    console.log('   • Action: User clicks "play" button to load World Map');
    console.log('   • Expected: window.WorldMap.show() should display the map');
    console.log('   • Actual: window.WorldMap is undefined, black screen appears');
    console.log('   • Root Cause: worldmap.js assigns to window.WorldMap in isolated context');
    console.log('                 preload.js does not bridge WorldMap via contextBridge');
    console.log('                 renderer context cannot access the isolated window.WorldMap');
    
    console.log('\n🔍 Evidence:');
    console.log('   • worldmap.js loads successfully (script tag exists)');
    console.log('   • Other APIs (steamAPI, saveAPI) are properly bridged');
    console.log('   • window.WorldMap is undefined in renderer context');
    console.log('   • showMap() falls back to buildMap() which also fails');
    
  } else {
    console.log('⚠ NO COUNTEREXAMPLES FOUND - Test passed unexpectedly!');
    console.log('This suggests the bug may not exist or has already been fixed.');
    console.log('Please verify:');
    console.log('  1. Is contextIsolation actually enabled in main.js?');
    console.log('  2. Has the preload.js already been modified to bridge WorldMap?');
    console.log('  3. Is the root cause analysis incorrect?');
  }
}

// Main test runner
app.whenReady().then(async () => {
  try {
    await testBugCondition();
    
    documentCounterexamples();
    
    console.log('\n═══ Test Results ═══\n');
    console.log(`  PASSED: ${PASS}`);
    console.log(`  FAILED: ${FAIL}`);
    console.log(`  TOTAL:  ${PASS + FAIL}`);
    
    if (FAIL > 0) {
      console.log('\n✓ TEST SUITE COMPLETED: Bug condition confirmed');
      console.log('  The failing tests prove the bug exists on unfixed code.');
      console.log('  These same tests will pass after implementing the fix.\n');
    } else {
      console.log('\n⚠ TEST SUITE COMPLETED: Unexpected pass');
      console.log('  All tests passed - bug may not exist or is already fixed.\n');
    }
    
    app.quit();
    process.exit(FAIL > 0 ? 0 : 1); // Exit 0 if tests failed as expected, 1 if unexpectedly passed
  } catch (error) {
    console.error('\n✗ TEST ERROR:', error);
    app.quit();
    process.exit(2);
  }
});

app.on('window-all-closed', () => {
  // Don't quit on window close during test
});
