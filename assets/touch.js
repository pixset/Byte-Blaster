/* ══════════════════════════════════════════════════════════════════════════
   BYTE BLASTER — TOUCH CONTROLS (virtual gamepad)
   ─────────────────────────────────────────────────────────────────────────
   Adds an on-screen D-pad (◀ ▶) + JUMP / FIRE + pause for phones & tablets,
   in both the web build and the Capacitor/Android wrapper.

   How it plugs in: the game reads keyboard state from the global object `K`
   (K[ev.code] = true/false, see game.js). Each touch button simply writes the
   same key codes into `K`, so movement/jump/shoot work with zero changes to the
   game loop. The PAUSE button calls the global doEsc() (pause is handled by a
   dedicated Escape keydown listener, not via `K`).

   Movement styles (gameSettings.touchStyle):
     • 'arrows'     — ◀ ▶ buttons + a separate JUMP button.
     • 'joystick'   — full virtual stick: left/right + push-up = jump. No JUMP
                      button (jump lives in the stick).
     • 'joystickLR' — left/right-only stick + a separate JUMP button.

   The ◀ ▶ arrows are LINKED into one cluster by default (they move together).
   In the layout editor a SPLIT toggle lets the player position them separately
   (gameSettings.touchArrowsSplit). Button sizes can be tuned per control
   (gameSettings.touchScales[unit]) or all at once (gameSettings.touchScale).

   The FIRE button only appears when the player actually has something to shoot
   (a blaster pickup, or fire/ice mode) — see canShoot().

   Visibility: shown only while gState === 'playing' AND the device is touch-
   capable (or the player forces it on in Settings → Touch controls). Hidden in
   menus/cutscenes, where DOM buttons already respond to taps.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── Key-code sets per button ───────────────────────────────────────────────
  // Codes are resolved lazily so a player who rebinds P1 keys in Settings still
  // drives the same in-game action. We push BOTH the arrow keys (which solo mode
  // reads directly) and the bound P1 keys, so it works in solo and online co-op.
  function controls() {
    return (window.gameSettings && window.gameSettings.controls) || {};
  }
  function codesFor(action) {
    var c = controls();
    switch (action) {
      case 'left':  return ['ArrowLeft',  c.p1Left  || 'KeyA'];
      case 'right': return ['ArrowRight', c.p1Right || 'KeyD'];
      case 'jump':  return ['ArrowUp', 'Space', c.p1Jump || 'Space'];
      case 'fire':  return ['KeyZ', c.p1Shoot || 'KeyZ'];
      default:      return [];
    }
  }

  // True when the player currently has a way to shoot. Mirrors the SHOOT gate in
  // game.js updatePlayer(): only the blaster pickup or fire/ice mode fire a shot;
  // with no weapon the FIRE key does nothing, so the button is pointless.
  function canShoot() {
    try {
      return typeof player !== 'undefined' && player &&
             (player.blaster || player.fireMode || player.iceMode);
    } catch (_) { return false; }
  }

  // ── Writing into the game's key state ──────────────────────────────────────
  function setKeys(codes, down) {
    if (typeof K === 'undefined' || !K) return;     // game.js global
    for (var i = 0; i < codes.length; i++) K[codes[i]] = down;
  }
  // Release everything we might have pressed (anti-stuck-key safety net).
  function releaseAll() {
    var all = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'Space', 'KeyZ', 'KeyA', 'KeyD', 'KeyW'];
    var c = controls();
    ['p1Left', 'p1Right', 'p1Jump', 'p1Shoot'].forEach(function (k) { if (c[k]) all.push(c[k]); });
    setKeys(all, false);
    activePointers.clear();
    // Joystick reset
    joyKeys.left = joyKeys.right = joyKeys.jump = false;
    joyPointer = null;
    if (joyThumb) joyThumb.style.transform = 'translate(0,0)';
    if (joyEl) joyEl.classList.remove('is-active');
    // Visual reset
    var pressed = padEl ? padEl.querySelectorAll('.tp-btn.is-down') : [];
    for (var i = 0; i < pressed.length; i++) pressed[i].classList.remove('is-down');
  }

  // ── DOM ────────────────────────────────────────────────────────────────────
  var padEl = null;
  // Every control is an independent, individually-placeable element.
  var dirLeftEl = null;              // ◀ button (arrows mode)
  var dirRightEl = null;             // ▶ button (arrows mode)
  var fireEl = null;                 // FIRE button
  var jumpEl = null;                 // JUMP button
  var pauseEl = null;                // pause button (top-right)
  // pointerId -> { action, btn }
  var activePointers = new Map();

  // Layout-edit (drag-to-place) state.
  var editing = false;
  // dragEls = [{ el, sx, sy }] captured at pointerdown; a linked arrow grab drags
  // BOTH arrows so they stay together. dragId/startX/startY track the gesture.
  var dragEls = null, dragId = null, dragStartX = 0, dragStartY = 0;
  var selectedKey = null;            // which control the size stepper resizes

  // Joystick state (used only when touchStyle is a joystick variant).
  var joyEl = null, joyThumb = null, joyPointer = null;
  var joyKeys = { left: false, right: false, jump: false };
  var joyHome = null;                // saved inline anchor to restore after a floating drag
  // Floating joystick: the base jumps under the finger on touch and springs back
  // on release. Static (default): the base stays put and only the thumb moves.
  function joyIsFloat() { return !!(window.gameSettings && window.gameSettings.touchJoyFloat); }

  // Which movement control to render: 'arrows' (◀ ▶), 'joystick' (full stick,
  // up = jump) or 'joystickLR' (left/right only + JUMP button).
  function moveStyle() {
    var s = (window.gameSettings && window.gameSettings.touchStyle) || 'arrows';
    if (s === 'joystick' || s === 'joystickLR') return s;
    return 'arrows';
  }
  function isJoy() { var s = moveStyle(); return s === 'joystick' || s === 'joystickLR'; }
  function joyHasJump() { return moveStyle() === 'joystick'; }   // full stick only
  // The separate JUMP button exists for every style EXCEPT the full joystick
  // (where pushing the stick up jumps).
  function jumpExists() { return moveStyle() !== 'joystick'; }
  // Are the ◀ ▶ arrows positioned/sized as separate units?
  function arrowsSplit() { return !!(window.gameSettings && window.gameSettings.touchArrowsSplit); }

  function makeBtn(action, label, cls, i18nKey) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'tp-btn ' + cls;
    b.setAttribute('data-tp', action);
    b.setAttribute('aria-label', action);
    if (i18nKey) {
      // data-i18n lets applyI18nDOM() re-localise the label on language change;
      // we also set it now in case the pad is built after the language is set.
      b.setAttribute('data-i18n', i18nKey);
      b.textContent = (typeof window.t === 'function') ? window.t(i18nKey) : label;
    } else {
      b.innerHTML = label;   // pure symbols (◀ ▶ ⏸) — never translated
    }
    return b;
  }

  function buildPad() {
    if (padEl) return padEl;
    padEl = document.createElement('div');
    padEl.id = 'touchPad';
    padEl.className = 'hidden';

    // ◀ ▶ arrows, FIRE, JUMP, pause — each independent so the layout editor can
    // place every one separately. The joystick (built once) replaces the arrows
    // when that movement style is chosen.
    dirLeftEl  = makeBtn('left',  '◀', 'tp-dpad tp-arrow-l');
    dirRightEl = makeBtn('right', '▶', 'tp-dpad tp-arrow-r');
    fireEl = makeBtn('fire', 'FIRE', 'tp-action tp-fire', 'tpFire');
    jumpEl = makeBtn('jump', 'JUMP', 'tp-action tp-jump', 'tpJump');
    pauseEl = makeBtn('pause', '⏸', 'tp-pause');
    buildJoystick();                  // sets joyEl/joyThumb

    padEl.appendChild(dirLeftEl);
    padEl.appendChild(dirRightEl);
    padEl.appendChild(joyEl);
    padEl.appendChild(fireEl);
    padEl.appendChild(jumpEl);
    padEl.appendChild(pauseEl);
    document.body.appendChild(padEl);

    // Block long-press context menu / text selection on the whole pad.
    padEl.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    bindPressButton(dirLeftEl);
    bindPressButton(dirRightEl);
    bindPressButton(fireEl);
    bindPressButton(jumpEl);
    bindPressButton(pauseEl);
    applyStyle();                     // shows arrows or joystick + applies size
    applyLayout();

    // Global release: a finger sliding off a button or an OS pointercancel still
    // clears the key. Each pointerId maps to the button it started on.
    window.addEventListener('pointerup', endButtonPointer);
    window.addEventListener('pointercancel', endButtonPointer);
    // Joystick drag tracking (no-ops while the joystick is idle).
    window.addEventListener('pointermove', joyMove, { passive: false });
    window.addEventListener('pointerup', joyEnd);
    window.addEventListener('pointercancel', joyEnd);
    // Layout-edit drag tracking. The pointerdown listener is on window in the
    // CAPTURE phase so it intercepts (and cancels) button presses while editing.
    window.addEventListener('pointerdown', onEditPointerDown, true);
    window.addEventListener('pointermove', onEditPointerMove, { passive: false });
    window.addEventListener('pointerup', onEditPointerUp);
    window.addEventListener('pointercancel', onEditPointerUp);
    // Re-apply fractional custom positions when the viewport changes.
    window.addEventListener('resize', applyLayout);
    window.addEventListener('orientationchange', function () {
      applyLayout(); setTimeout(applyLayout, 250); setTimeout(applyLayout, 600);
    });
    return padEl;
  }

  // ── Custom button layout (drag-to-place) ────────────────────────────────────
  // Each movable unit is one control (or the linked ◀ ▶ pair). Positions are
  // stored as viewport fractions so they survive rotation / different screens.
  // layoutUnits() returns [key, element] pairs for the CURRENTLY-VISIBLE controls.
  function layoutUnits() {
    var u = [];
    if (isJoy()) {
      u.push(['joy', joyEl]);
    } else if (arrowsSplit()) {
      u.push(['left', dirLeftEl]);
      u.push(['right', dirRightEl]);
    } else {
      // Linked: the pair is anchored by the left arrow (key 'dpad'); the right
      // arrow is positioned next to it by applyLayout().
      u.push(['dpad', dirLeftEl]);
    }
    u.push(['fire', fireEl], ['pause', pauseEl]);
    if (jumpExists()) u.push(['jump', jumpEl]);
    return u;
  }

  // Map a DOM control to the size/selection key it belongs to. Linked arrows
  // share the 'dpad' key (resize together); split arrows are 'left' / 'right'.
  function keyForEl(el) {
    if (el === dirLeftEl)  return arrowsSplit() ? 'left' : 'dpad';
    if (el === dirRightEl) return arrowsSplit() ? 'right' : 'dpad';
    if (el === fireEl)  return 'fire';
    if (el === jumpEl)  return 'jump';
    if (el === pauseEl) return 'pause';
    if (el === joyEl)   return 'joy';
    return null;
  }

  // Gap (px) between the linked ◀ and ▶, scaled with the arrow size.
  function arrowGap() { return 16 * unitScale('dpad'); }

  // Apply saved positions (or clear inline styles to fall back to the CSS anchors).
  function applyLayout() {
    var lay = window.gameSettings && window.gameSettings.touchLayout;
    var vw = window.innerWidth, vh = window.innerHeight;
    layoutUnits().forEach(function (u) {
      var key = u[0], el = u[1];
      if (!el) return;
      var pos = lay && lay[key];
      if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
        setUnitPx(el, pos.x * vw, pos.y * vh);
      } else {
        el.style.left = '';
        el.style.top = '';
        el.style.right = '';
        el.style.bottom = '';
      }
    });
    // Linked arrows: keep ▶ glued to the right of ◀ (custom or default position).
    if (!isJoy() && !arrowsSplit() && dirLeftEl && dirRightEl) {
      var pos = lay && lay.dpad;
      if (pos && typeof pos.x === 'number') {
        var lw = dirLeftEl.offsetWidth || 0;
        setUnitPx(dirRightEl, pos.x * vw + lw + arrowGap(), pos.y * vh);
      } else {
        dirRightEl.style.left = ''; dirRightEl.style.top = '';
        dirRightEl.style.right = ''; dirRightEl.style.bottom = '';
      }
    }
  }
  function setUnitPx(el, x, y) {
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  }
  // Glue ▶ to the right of ◀ using their CURRENT on-screen position (not the
  // saved layout) — used after a size change mid-edit so a resize doesn't snap
  // every other button back to its saved/default spot.
  function reflowLinkedArrows() {
    if (isJoy() || arrowsSplit() || !dirLeftEl || !dirRightEl) return;
    var r = dirLeftEl.getBoundingClientRect();
    setUnitPx(dirRightEl, r.left + (dirLeftEl.offsetWidth || 0) + arrowGap(), r.top);
  }
  function saveLayout() {
    var vw = window.innerWidth, vh = window.innerHeight;
    // Merge into any existing layout so the OTHER movement style's saved positions
    // (e.g. arrows vs joystick) aren't wiped when only the current ones are saved.
    var lay = Object.assign({}, (window.gameSettings && window.gameSettings.touchLayout) || {});
    layoutUnits().forEach(function (u) {
      if (!u[1]) return;
      var r = u[1].getBoundingClientRect();
      lay[u[0]] = { x: r.left / vw, y: r.top / vh };
    });
    // Linked arrows store one anchor ('dpad'); clear any stale split positions so
    // they don't resurface if the player later splits then re-links.
    if (!isJoy() && !arrowsSplit()) { delete lay.left; delete lay.right; }
    if (window.gameSettings) window.gameSettings.touchLayout = lay;
    if (typeof window.saveGameSettings === 'function') window.saveGameSettings();
  }

  function onEditPointerDown(e) {
    if (!editing) return;
    var unit = e.target && e.target.closest ? e.target.closest('.tp-btn, .tp-joy') : null;
    if (!unit || unit.style.display === 'none') return;
    // Take over the gesture: no button press / joystick while arranging.
    e.preventDefault();
    e.stopPropagation();
    // Selection (drives the size stepper). Linked arrows select as the pair.
    selectUnit(keyForEl(unit));
    // A linked-arrow grab drags BOTH arrows together so they stay a cluster.
    var group = [unit];
    if ((unit === dirLeftEl || unit === dirRightEl) && !arrowsSplit()) {
      group = [dirLeftEl, dirRightEl];
    }
    dragEls = group.map(function (el) {
      var r = el.getBoundingClientRect();
      el.classList.add('tp-dragging');
      return { el: el, sx: r.left, sy: r.top };
    });
    dragId = e.pointerId;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
  }
  function onEditPointerMove(e) {
    if (!editing || dragId === null || e.pointerId !== dragId || !dragEls) return;
    e.preventDefault();
    var vw = window.innerWidth, vh = window.innerHeight;
    var dx = e.clientX - dragStartX, dy = e.clientY - dragStartY;
    // Clamp the whole group so no member leaves the viewport.
    var minDx = Infinity, maxDx = -Infinity, minDy = Infinity, maxDy = -Infinity;
    dragEls.forEach(function (d) {
      var w = d.el.offsetWidth, h = d.el.offsetHeight;
      minDx = Math.min(minDx, -d.sx);            maxDx = Math.max(maxDx, vw - w - d.sx);
      minDy = Math.min(minDy, -d.sy);            maxDy = Math.max(maxDy, vh - h - d.sy);
    });
    dx = Math.max(minDx, Math.min(dx, maxDx));
    dy = Math.max(minDy, Math.min(dy, maxDy));
    dragEls.forEach(function (d) { setUnitPx(d.el, d.sx + dx, d.sy + dy); });
  }
  function onEditPointerUp(e) {
    if (dragId === null || e.pointerId !== dragId) return;
    if (dragEls) dragEls.forEach(function (d) { d.el.classList.remove('tp-dragging'); });
    dragEls = null;
    dragId = null;
  }

  // Mark a control as selected for the size stepper (null = "all buttons").
  function selectUnit(key) {
    selectedKey = key;
    if (padEl) {
      var sel = padEl.querySelectorAll('.tp-selected');
      for (var i = 0; i < sel.length; i++) sel[i].classList.remove('tp-selected');
      if (key) {
        if (key === 'dpad') { if (dirLeftEl) dirLeftEl.classList.add('tp-selected'); if (dirRightEl) dirRightEl.classList.add('tp-selected'); }
        else {
          var el = ({ left: dirLeftEl, right: dirRightEl, fire: fireEl, jump: jumpEl, pause: pauseEl, joy: joyEl })[key];
          if (el) el.classList.add('tp-selected');
        }
      }
    }
    refreshSizeUI();
  }

  // Edit-mode chrome: a hint bar with size stepper, SPLIT/LINK arrows, DONE/RESET.
  var editBar = null;
  function unitLabel(key) {
    switch (key) {
      case 'dpad':  return '◀▶';
      case 'left':  return '◀';
      case 'right': return '▶';
      case 'fire':  return (typeof window.t === 'function') ? window.t('tpFire') : 'FIRE';
      case 'jump':  return (typeof window.t === 'function') ? window.t('tpJump') : 'JUMP';
      case 'pause': return '⏸';
      case 'joy':   return (typeof window.t === 'function') ? window.t('touchStyleJoystick') : 'JOY';
      default:      return (typeof window.t === 'function') ? window.t('ctrlSizeAll') : 'ALL';
    }
  }
  function refreshSizeUI() {
    if (!editBar) return;
    var lbl = editBar.querySelector('#tpSizeLbl');
    if (lbl) lbl.textContent = unitLabel(selectedKey) + '  ' + Math.round(curSel() * 100) + '%';
    var link = editBar.querySelector('#tpEditLink');
    if (link) {
      // The SPLIT/LINK toggle is only meaningful in arrows mode.
      link.style.display = isJoy() ? 'none' : '';
      link.textContent = (typeof window.t === 'function')
        ? window.t(arrowsSplit() ? 'ctrlArrowsLink' : 'ctrlArrowsSplit')
        : (arrowsSplit() ? '◀▶ LINK' : '◀▶ SPLIT');
    }
  }
  // Current scale for the selected unit (or the global "all" scale when none).
  function curSel() {
    if (selectedKey) return unitScale(selectedKey);
    return globalScale();
  }
  function showEditUI() {
    if (!editBar) {
      editBar = document.createElement('div');
      editBar.id = 'tpEditBar';
      var hint = document.createElement('div');
      hint.id = 'tpEditHint';
      hint.setAttribute('data-i18n', 'ctrlLayoutHint');
      hint.textContent = (typeof window.t === 'function') ? window.t('ctrlLayoutHint') : 'Tap a button to select, drag to move, then DONE';
      // Size row: − / label / + adjust the SELECTED control's size (or all).
      var sizeRow = document.createElement('div');
      sizeRow.id = 'tpEditSize';
      var minus = document.createElement('button'); minus.className = 'tpSizeBtn'; minus.textContent = '−';
      var sizeLbl = document.createElement('span'); sizeLbl.id = 'tpSizeLbl';
      var plus = document.createElement('button'); plus.className = 'tpSizeBtn'; plus.textContent = '+';
      minus.addEventListener('click', function(){ bump(-0.1); });
      plus.addEventListener('click', function(){ bump(0.1); });
      sizeRow.appendChild(minus); sizeRow.appendChild(sizeLbl); sizeRow.appendChild(plus);

      // ◀▶ SPLIT / LINK toggle (arrows mode only).
      var linkBtn = document.createElement('button');
      linkBtn.id = 'tpEditLink';
      linkBtn.className = 'tpEditAction';
      linkBtn.addEventListener('click', function () {
        if (!window.gameSettings) return;
        window.gameSettings.touchArrowsSplit = !arrowsSplit();
        if (typeof window.saveGameSettings === 'function') window.saveGameSettings();
        applyStyle();           // re-size arrows for the new split/link scale keys
        reflowLinkedArrows();   // glue the pair when linking; don't touch others
        // Re-select so the highlight/label follow the new split state.
        selectUnit(arrowsSplit() ? 'left' : 'dpad');
      });

      var row = document.createElement('div');
      row.id = 'tpEditBtns';
      var doneBtn = document.createElement('button');
      doneBtn.id = 'tpEditDone';
      doneBtn.setAttribute('data-i18n', 'ctrlLayoutDone');
      doneBtn.textContent = (typeof window.t === 'function') ? window.t('ctrlLayoutDone') : '✔ DONE';
      doneBtn.addEventListener('click', function () { endEdit(true); });
      var resetBtn = document.createElement('button');
      resetBtn.id = 'tpEditReset';
      resetBtn.setAttribute('data-i18n', 'ctrlResetLayout');
      resetBtn.textContent = (typeof window.t === 'function') ? window.t('ctrlResetLayout') : '↺ RESET LAYOUT';
      resetBtn.addEventListener('click', function () {
        if (window.gameSettings) {
          window.gameSettings.touchLayout = null;
          window.gameSettings.touchScale = 1;
          window.gameSettings.touchScales = null;
        }
        selectUnit(null);
        applyScale();
        applyLayout();
        refreshSizeUI();
      });
      row.appendChild(doneBtn);
      row.appendChild(resetBtn);
      editBar.appendChild(hint);
      editBar.appendChild(sizeRow);
      editBar.appendChild(linkBtn);
      editBar.appendChild(row);
      document.body.appendChild(editBar);
    }
    editBar.style.display = 'flex';
    refreshSizeUI();
    if (typeof window.applyI18nDOM === 'function') window.applyI18nDOM();
  }
  function hideEditUI() { if (editBar) editBar.style.display = 'none'; }

  // Resize the selected control (or all controls when none is selected).
  function bump(d) {
    if (!window.gameSettings) return;
    if (selectedKey) {
      var sc = window.gameSettings.touchScales || {};
      var s = Math.max(0.6, Math.min((sc[selectedKey] || globalScale()) + d, 2));
      sc[selectedKey] = Math.round(s * 100) / 100;
      window.gameSettings.touchScales = sc;
    } else {
      var g = Math.max(0.6, Math.min(globalScale() + d, 2));
      window.gameSettings.touchScale = Math.round(g * 100) / 100;
    }
    applyScale();          // resize only — never re-apply saved positions (would
                           // clobber buttons the player just dragged this session)…
    reflowLinkedArrows();  // …only re-glue linked ▶ to ◀, whose offset depends on
                           // ◀'s new width. Other buttons keep their live spots.
    refreshSizeUI();
  }

  function endEdit(save) {
    if (save) saveLayout();
    editing = false;
    selectUnit(null);
    if (padEl) padEl.classList.remove('tp-editing');
    hideEditUI();
    lastVisible = null;     // force the visibility loop to re-hide if not playing
    refresh();
  }

  // (Re)build the movement cluster to match the current touchStyle.
  function applyStyle() {
    if (!padEl) return;
    releaseAll();                       // never carry a held key across a swap
    var joy = isJoy();
    if (dirLeftEl)  dirLeftEl.style.display  = joy ? 'none' : '';
    if (dirRightEl) dirRightEl.style.display = joy ? 'none' : '';
    if (joyEl)      joyEl.style.display      = joy ? 'block' : 'none';
    applyScale();
    applyVisibility();
  }

  // JUMP exists for every style except the full joystick; FIRE only when the
  // player can actually shoot. While arranging, show every control that exists
  // so it can be positioned even with no weapon in hand.
  function applyVisibility() {
    if (!padEl) return;
    if (jumpEl) {
      var showJump = jumpExists();
      jumpEl.style.display = showJump ? '' : 'none';
      // Don't clear the jump KEY here — this runs every poll, and in the full
      // joystick style the stick owns jump (push up). Style swaps already release
      // held keys via applyStyle()→releaseAll(). Just drop the pressed visual.
      if (!showJump) jumpEl.classList.remove('is-down');
    }
    if (fireEl) {
      var showFire = editing || canShoot();
      fireEl.style.display = showFire ? '' : 'none';
      if (!showFire) { setKeys(codesFor('fire'), false); fireEl.classList.remove('is-down'); }
    }
  }

  // ── Per-control button sizing ───────────────────────────────────────────────
  // Each control's size = gameSettings.touchScales[key] if set, else the global
  // gameSettings.touchScale. The chosen multiplier is written to the element's
  // own --tp-scale, overriding the container default the CSS calc()s read.
  function globalScale() {
    var s = (window.gameSettings && parseFloat(window.gameSettings.touchScale)) || 1;
    return Math.max(0.6, Math.min(s, 2));
  }
  function unitScale(key) {
    var sc = window.gameSettings && window.gameSettings.touchScales;
    var v = sc && key ? sc[key] : undefined;
    if (typeof v === 'number') return Math.max(0.6, Math.min(v, 2));
    return globalScale();
  }
  function setElScale(el, key) { if (el) el.style.setProperty('--tp-scale', unitScale(key)); }
  function applyScale() {
    if (!padEl) return;
    padEl.style.setProperty('--tp-scale', globalScale());   // fallback for any unset
    var arrowKeyL = arrowsSplit() ? 'left' : 'dpad';
    var arrowKeyR = arrowsSplit() ? 'right' : 'dpad';
    setElScale(dirLeftEl, arrowKeyL);
    setElScale(dirRightEl, arrowKeyR);
    setElScale(fireEl, 'fire');
    setElScale(jumpEl, 'jump');
    setElScale(pauseEl, 'pause');
    setElScale(joyEl, 'joy');
  }

  function press(action, btn) {
    if (action === 'pause') {
      if (typeof doEsc === 'function') doEsc();
      return;
    }
    setKeys(codesFor(action), true);
    if (btn) btn.classList.add('is-down');
  }
  function release(action, btn) {
    if (action === 'pause') return;
    setKeys(codesFor(action), false);
    if (btn) btn.classList.remove('is-down');
  }

  function bindPressButton(btn) {
    var action = btn.getAttribute('data-tp');
    btn.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      // Audio unlock on first gesture (mirrors game.js _audioUnlock).
      if (typeof initAudio === 'function') { try { initAudio(); } catch (_) {} }
      activePointers.set(e.pointerId, { action: action, btn: btn });
      press(action, btn);
    });
  }
  function endButtonPointer(e) {
    var rec = activePointers.get(e.pointerId);
    if (!rec) return;
    activePointers.delete(e.pointerId);
    release(rec.action, rec.btn);
  }

  // ── Virtual joystick ───────────────────────────────────────────────────────
  // A fixed thumbstick in the lower-left. Dragging left/right presses the move
  // keys. In the FULL variant pushing up triggers jump (diagonal = move + jump);
  // in the left/right-only variant the vertical axis is ignored and a separate
  // JUMP button handles jumping.
  function buildJoystick() {
    joyEl = document.createElement('div');
    joyEl.className = 'tp-joy';
    joyThumb = document.createElement('div');
    joyThumb.className = 'tp-joy-thumb';
    joyEl.appendChild(joyThumb);
    joyEl.addEventListener('pointerdown', joyDown);
    return joyEl;
  }
  function setJoyKey(name, down) {
    if (joyKeys[name] === down) return;
    joyKeys[name] = down;
    setKeys(codesFor(name), down);
  }
  function joyDown(e) {
    e.preventDefault();
    if (editing) return;              // arranging: the editor owns the gesture
    if (typeof initAudio === 'function') { try { initAudio(); } catch (_) {} }
    joyPointer = e.pointerId;
    joyEl.classList.add('is-active');
    // Floating mode: remember the home anchor, then recentre the base on the
    // finger so the stick can be grabbed anywhere in its corner.
    if (joyIsFloat()) {
      joyHome = { left: joyEl.style.left, top: joyEl.style.top, right: joyEl.style.right, bottom: joyEl.style.bottom };
      setUnitPx(joyEl, e.clientX - joyEl.offsetWidth / 2, e.clientY - joyEl.offsetHeight / 2);
    }
    joyMove(e);
  }
  function joyMove(e) {
    if (!joyEl || joyEl.style.display === 'none') return;
    if (joyPointer === null || e.pointerId !== joyPointer || !joyEl) return;
    e.preventDefault();
    var r = joyEl.getBoundingClientRect();
    var R = r.width / 2;
    var dx = e.clientX - (r.left + R);
    var dy = e.clientY - (r.top + r.height / 2);
    var maxOff = R * 0.62;      // thumb travel limit
    // Floating: once the finger pulls past the rim, drag the base after it so the
    // whole stick "follows the finger". (Static keeps the base where it sits.)
    if (joyIsFloat()) {
      var d0 = Math.hypot(dx, dy);
      if (d0 > maxOff) {
        var over = d0 - maxOff;
        setUnitPx(joyEl, r.left + dx / d0 * over, r.top + dy / d0 * over);
        dx -= dx / d0 * over; dy -= dy / d0 * over;   // re-base on the moved centre
      }
    }
    var deadX = R * 0.28;       // horizontal deadzone
    var jumpY = R * 0.42;       // push up past this → jump (full variant only)
    setJoyKey('left',  dx < -deadX);
    setJoyKey('right', dx >  deadX);
    setJoyKey('jump',  joyHasJump() && dy < -jumpY);
    // Clamp the thumb inside the base for visual feedback.
    var dist = Math.hypot(dx, dy);
    if (dist > maxOff && dist > 0) { dx = dx / dist * maxOff; dy = dy / dist * maxOff; }
    joyThumb.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
  }
  function joyEnd(e) {
    if (joyPointer === null || e.pointerId !== joyPointer) return;
    joyPointer = null;
    if (joyEl) joyEl.classList.remove('is-active');
    if (joyThumb) joyThumb.style.transform = 'translate(0,0)';
    // Spring a floating base back to its home anchor.
    if (joyHome && joyEl) {
      joyEl.style.left = joyHome.left;     joyEl.style.top = joyHome.top;
      joyEl.style.right = joyHome.right;   joyEl.style.bottom = joyHome.bottom;
      joyHome = null;
    }
    setJoyKey('left', false);
    setJoyKey('right', false);
    setJoyKey('jump', false);
  }

  // ── Visibility loop ──────────────────────────────────────────────────────────
  // Чем игрок пользуется ПРЯМО СЕЙЧАС: 'touch' — пальцем, 'keys' — клавиатурой,
  // null — ещё ничем, решаем по устройству. Раньше здесь стояло
  // `'ontouchstart' in window || navigator.maxTouchPoints > 0`, то есть «у
  // устройства вообще есть сенсорный ввод». У ноутбука с сенсорным экраном это
  // правда — и человеку с клавиатурой выкатывался экранный джойстик поверх игры.
  var lastInput = null;

  function deviceLooksTouch() {
    if (typeof window.bbIsTouchDevice === 'function') return window.bbIsTouchDevice();
    // Запасной путь, если game.js почему-то не загрузился.
    try {
      if (typeof window.matchMedia === 'function') return window.matchMedia('(pointer: coarse)').matches;
    } catch (e) {}
    return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (navigator.msMaxTouchPoints > 0);
  }

  function mode() {
    var m = (window.gameSettings && window.gameSettings.touchControls) || 'auto';
    return (m === 'on' || m === 'off') ? m : 'auto';
  }
  function shouldEnable() {
    var m = mode();
    if (m === 'off') return false;
    if (m === 'on') return true;
    // 'auto': показываем то, чем играют. Планшет с клавиатурой и ноутбук с
    // сенсорным экраном — одно и то же железо с разными привычками, и гадать по
    // списку возможностей бессмысленно: надёжнее смотреть на последнее действие.
    if (lastInput === 'touch') return true;
    if (lastInput === 'keys') return false;
    return deviceLooksTouch();
  }
  function gameIsPlaying() {
    try { return typeof gState !== 'undefined' && gState === 'playing'; }
    catch (_) { return false; }
  }

  var lastVisible = null;
  function refresh() {
    if (!padEl) buildPad();
    // While arranging the layout the pad is forced visible regardless of state.
    if (editing) { padEl.classList.remove('hidden'); lastVisible = true; return; }
    var visible = shouldEnable() && gameIsPlaying();
    if (visible) applyVisibility();       // keep FIRE in sync with weapon pickups
    if (visible === lastVisible) return;
    lastVisible = visible;
    if (visible) {
      padEl.classList.remove('hidden');
      // Re-apply positions now the pad has real dimensions: a resize while hidden
      // measures the linked ▶ offset against a zero-width ◀, so fix it on show.
      applyLayout();
      // The HUD only appears once playing, which changes the space available to
      // the canvas. Force a re-fit so the game sizes correctly to the screen.
      if (typeof window.refitGame === 'function') window.refitGame();
    } else {
      padEl.classList.add('hidden');
      releaseAll();                       // never leave a key stuck on hide
    }
  }

  function start() {
    buildPad();
    refresh();
    setInterval(refresh, 120);            // cheap poll; gState has no event hook
    // Способ ввода может смениться посреди игры — планшет кладут в чехол с
    // клавиатурой, ноутбук-трансформер разворачивают экраном наружу. Поэтому
    // следим за обоими направлениями, а не только за появлением касаний.
    window.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch') { lastInput = 'touch'; refresh(); }
    }, { capture: true, passive: true });
    window.addEventListener('keydown', function (e) {
      // Нажатия по самим экранным кнопкам сюда не приходят — они шлют не
      // клавиши, а вызовы setJoyKey. Значит, настоящая клавиша = настоящая
      // клавиатура, и пад можно убрать.
      if (!e || !e.isTrusted || !e.key || e.key === 'Unidentified') return;
      if (lastInput !== 'keys') { lastInput = 'keys'; refresh(); }
    }, { capture: true, passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // Expose hooks Settings uses: refresh visibility/style, enter the drag-to-place
  // editor, and reset positions to the default corners.
  window.touchControls = {
    refresh: function () { applyStyle(); applyLayout(); lastVisible = null; refresh(); },
    applyScale: applyScale,
    editLayout: function () {
      if (!padEl) buildPad();
      editing = true;
      padEl.classList.add('tp-editing');
      padEl.classList.remove('hidden');
      applyStyle();                       // show every existing control to arrange
      applyLayout();
      selectUnit(null);
      showEditUI();
    },
    resetLayout: function () {
      if (window.gameSettings) window.gameSettings.touchLayout = null;
      if (typeof window.saveGameSettings === 'function') window.saveGameSettings();
      applyLayout();
    }
  };
})();
