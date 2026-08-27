/*
 * Shared mobile / responsive helper for the IBCS mini-games.
 *
 * Every game renders to a fixed-resolution canvas (900x600). On desktop and
 * inside the Rayfin <iframe> host that native size is kept; on phones and
 * tablets the canvas element is scaled with CSS to fill the available viewport
 * while preserving its 3:2 aspect ratio, so the games are playable in mobile
 * landscape without changing any of the internal drawing maths.
 *
 * For the platformer (which is otherwise keyboard-only) the helper can also draw
 * an on-screen touch gamepad. Each button simply dispatches the same
 * KeyboardEvents the game already listens for on the canvas, so no game logic
 * needs to change — touch input flows through the exact same code path as a
 * physical keyboard.
 *
 * Usage:
 *   IBCSMobile.makeResponsive(canvas);                       // scaling only
 *   IBCSMobile.makeResponsive(canvas, { touchControls: true }); // + gamepad
 */
(function (global) {
  'use strict';

  var doc = global.document;

  function isTouch() {
    return 'ontouchstart' in global ||
      (global.navigator && global.navigator.maxTouchPoints > 0);
  }

  function isPortrait() {
    return global.innerHeight > global.innerWidth;
  }

  // True only for real phones. Deliberately stricter than isTouch(): touchscreen
  // laptops/desktops report maxTouchPoints > 0 but must NOT get the rotate-device
  // nag — only actual mobiles should. Uses the UA-CH mobile flag / UA string, and
  // falls back to (coarse pointer AND a phone-sized screen).
  function isPhone() {
    var nav = global.navigator || {};
    var ua = nav.userAgent || '';
    if (/Mobi|Android|iPhone|iPod|IEMobile|BlackBerry|Opera Mini|Windows Phone/i.test(ua)) return true;
    if (nav.userAgentData && nav.userAgentData.mobile === true) return true;
    var coarse = !!(global.matchMedia && global.matchMedia('(pointer: coarse)').matches);
    var small = Math.min(global.innerWidth || 0, global.innerHeight || 0) <= 560;
    return coarse && small;
  }

  // Scale the canvas element (CSS pixels) to fit the viewport, preserving the
  // canvas's intrinsic aspect ratio. Never enlarges past the point where it
  // would overflow either axis.
  function fit(canvas) {
    var W = canvas.width || 900;
    var H = canvas.height || 600;
    var vw = global.innerWidth;
    var vh = global.innerHeight;
    var scale = Math.min(vw / W, vh / H);
    if (!isFinite(scale) || scale <= 0) scale = 1;
    canvas.style.width = Math.round(W * scale) + 'px';
    canvas.style.height = Math.round(H * scale) + 'px';
  }

  // A full-screen overlay nudging the player to rotate the device. Shown on
  // touch devices held in the wrong orientation for the current game.
  function buildOrientationHint(orientation) {
    var toPortrait = orientation === 'portrait';
    var el = doc.createElement('div');
    el.id = 'ibcsOrientationHint';
    el.setAttribute('role', 'alert');
    el.setAttribute('aria-label', toPortrait
      ? 'Rotate your device to portrait mode to play.'
      : 'Rotate your device to landscape mode to play.');
    el.style.cssText =
      'position:fixed;inset:0;z-index:9999;display:none;flex-direction:column;' +
      'align-items:center;justify-content:center;text-align:center;gap:14px;' +
      "background:#0a0a1a;color:#cfe0ff;font-family:'Segoe UI',system-ui,sans-serif;padding:24px";
    el.innerHTML =
      '<div style="font-size:46px" aria-hidden="true">\uD83D\uDD04</div>' +
      '<div style="font-size:20px;font-weight:600">Rotate your device</div>' +
      '<div style="font-size:14px;opacity:0.7;max-width:300px">' +
      'This game is best played in ' + (toPortrait ? 'portrait' : 'landscape') +
      '. Turn your phone ' + (toPortrait ? 'upright' : 'sideways') + ' to start.</div>';
    return el;
  }

  function buildTouchControls(canvas) {
    var KEY_LABELS = {
      ArrowLeft: '\u25C0', ArrowRight: '\u25B6', ArrowUp: '\u25B2',
      ArrowDown: '\u25BC', Space: 'JUMP', KeyF: 'HIT', KeyR: '\u21BA', KeyS: '\u2630',
    };

    function send(type, code) {
      var ev;
      try {
        ev = new KeyboardEvent(type, { code: code, key: code, bubbles: true });
      } catch (_) {
        // Legacy fallback for browsers without the KeyboardEvent constructor.
        ev = doc.createEvent('Event');
        ev.initEvent(type, true, true);
        ev.code = code;
        ev.key = code;
      }
      canvas.dispatchEvent(ev);
    }

    function mkBtn(code, extraStyle) {
      var b = doc.createElement('button');
      b.type = 'button';
      b.textContent = KEY_LABELS[code] || code;
      b.setAttribute('aria-label', code);
      b.style.cssText =
        'pointer-events:auto;-webkit-user-select:none;user-select:none;' +
        '-webkit-tap-highlight-color:transparent;touch-action:none;' +
        'border:1px solid rgba(96,168,255,0.5);border-radius:14px;' +
        'background:rgba(20,30,55,0.55);color:#dce8ff;font:600 18px system-ui;' +
        'width:64px;height:64px;display:flex;align-items:center;justify-content:center;' +
        (extraStyle || '');
      var down = function (e) {
        e.preventDefault();
        b.style.background = 'rgba(96,168,255,0.45)';
        send('keydown', code);
      };
      var up = function (e) {
        e.preventDefault();
        b.style.background = 'rgba(20,30,55,0.55)';
        send('keyup', code);
      };
      b.addEventListener('touchstart', down, { passive: false });
      b.addEventListener('touchend', up, { passive: false });
      b.addEventListener('touchcancel', up, { passive: false });
      b.addEventListener('mousedown', down);
      b.addEventListener('mouseup', up);
      b.addEventListener('mouseleave', function (e) { if (e.buttons) up(e); });
      return b;
    }

    var pad = doc.createElement('div');
    pad.id = 'ibcsTouchPad';
    pad.style.cssText =
      'position:fixed;inset:0;z-index:50;pointer-events:none;display:none';

    // Left cluster: a small d-pad (left / right with up / down stacked).
    var left = doc.createElement('div');
    left.style.cssText =
      'position:absolute;left:14px;bottom:16px;display:grid;gap:8px;' +
      'grid-template-columns:repeat(3,64px);grid-template-rows:repeat(2,64px)';
    var up = mkBtn('ArrowUp', 'grid-column:2;grid-row:1');
    var down = mkBtn('ArrowDown', 'grid-column:2;grid-row:2');
    var lft = mkBtn('ArrowLeft', 'grid-column:1;grid-row:2');
    var rgt = mkBtn('ArrowRight', 'grid-column:3;grid-row:2');
    left.appendChild(up); left.appendChild(lft); left.appendChild(down); left.appendChild(rgt);

    // Right cluster: action buttons.
    var right = doc.createElement('div');
    right.style.cssText =
      'position:absolute;right:14px;bottom:16px;display:flex;gap:12px;align-items:flex-end';
    var jump = mkBtn('Space', 'width:80px;height:80px;border-radius:50%');
    var hit = mkBtn('KeyF', 'width:64px;height:64px;border-radius:50%;margin-bottom:8px');
    right.appendChild(hit); right.appendChild(jump);

    // Utility buttons (top-right): restart and level-select, useful on the
    // game-over and title screens where no movement is needed.
    var util = doc.createElement('div');
    util.style.cssText =
      'position:absolute;right:14px;top:14px;display:flex;gap:10px';
    util.appendChild(mkBtn('KeyS', 'width:48px;height:48px;border-radius:10px;font-size:20px'));
    util.appendChild(mkBtn('KeyR', 'width:48px;height:48px;border-radius:10px;font-size:20px'));

    pad.appendChild(left);
    pad.appendChild(right);
    pad.appendChild(util);

    // The gamepad is hidden by default; a small floating toggle button reveals
    // it on demand so the controls never cover the game unless the player asks
    // for them. Useful on touch-capable laptops where the auto-overlay was
    // intrusive during normal keyboard play.
    var visible = false;
    var portrait = false;

    var toggle = doc.createElement('button');
    toggle.type = 'button';
    toggle.id = 'ibcsPadToggle';
    toggle.setAttribute('aria-label', 'Toggle on-screen controls');
    toggle.setAttribute('aria-pressed', 'false');
    toggle.textContent = '\uD83C\uDFAE';
    toggle.style.cssText =
      'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:51;' +
      'pointer-events:auto;-webkit-tap-highlight-color:transparent;cursor:pointer;' +
      'touch-action:manipulation;width:52px;height:52px;border-radius:50%;' +
      'border:1px solid rgba(96,168,255,0.5);background:rgba(20,30,55,0.7);' +
      'color:#dce8ff;font-size:24px;display:none;align-items:center;justify-content:center';

    function render() {
      pad.style.display = (visible && !portrait) ? 'block' : 'none';
      toggle.style.background = visible
        ? 'rgba(96,168,255,0.45)' : 'rgba(20,30,55,0.7)';
      toggle.setAttribute('aria-pressed', visible ? 'true' : 'false');
    }
    toggle.addEventListener('click', function () {
      visible = !visible;
      render();
    });

    return {
      pad: pad,
      toggle: toggle,
      refresh: function (isPortrait) {
        portrait = isPortrait;
        toggle.style.display = isPortrait ? 'none' : 'flex';
        render();
      },
    };
  }

  function makeResponsive(canvas, opts) {
    opts = opts || {};
    if (!canvas || !doc || !doc.body) return { update: function () {} };

    var hint = buildOrientationHint(opts.orientation);
    doc.body.appendChild(hint);

    var controls = null;
    if (opts.touchControls && isTouch()) {
      controls = buildTouchControls(canvas);
      doc.body.appendChild(controls.pad);
      doc.body.appendChild(controls.toggle);
    }

    function update() {
      fit(canvas);
      var portrait = isPortrait();
      // Only nag REAL phones to rotate (portrait games want portrait; the rest
      // want landscape). Desktops — even touchscreen ones — are never nagged.
      var wrongOrient = isPhone() && (opts.orientation === 'portrait' ? !portrait : portrait);
      hint.style.display = wrongOrient ? 'flex' : 'none';
      if (controls) controls.refresh(isTouch() && portrait);
    }

    global.addEventListener('resize', update);
    global.addEventListener('orientationchange', function () {
      // Some browsers report stale dimensions during the rotation animation.
      setTimeout(update, 250);
    });
    if (doc.fonts && doc.fonts.ready && doc.fonts.ready.then) {
      doc.fonts.ready.then(update);
    }
    update();
    return { update: update };
  }

  global.IBCSMobile = {
    makeResponsive: makeResponsive,
    isTouch: isTouch,
    fit: fit,
  };
})(typeof window !== 'undefined' ? window : globalThis);
