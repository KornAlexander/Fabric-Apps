import type { FlyTelemetry } from '../three/flyControls.js';

/**
 * The drone's instrument panel.
 *
 * ⚠️ **The units are hexes, not metres.** The module this reads from calls
 * everything `...Ms` and `...M` because it was written for digital twins whose
 * world really is in metres. This one is not: a hex radius is one world unit,
 * and there is no scale anywhere that says how many metres that is. So the
 * panel says "hex/s" and "hex", which is both true and the unit the player is
 * already thinking in. Printing "m/s" would have been free and wrong.
 *
 * It writes straight into the DOM from the render loop rather than rebuilding
 * anything, because sixty updates a second of five numbers should not allocate.
 *
 * There is no button here to turn the drone on. The keys are the control, and
 * what this panel is for is saying that they exist and, once flying, which
 * behaviour the mouse currently has - because engaging changes what dragging
 * and the wheel do.
 */

const STYLE = `
.fe-drone {
  /*
   * Top centre, which is the only band of this screen that nothing else uses:
   * the resource bar ends before it, the seed panel starts after it, and both
   * bottom corners already belong to the selection panel and the log. The
   * panel sat bottom-left first and covered the selected unit.
   */
  position: fixed; left: 50%; top: 70px; z-index: 30;
  min-width: 250px; padding: 10px 12px;
  background: rgba(9, 14, 22, 0.82); border: 1px solid rgba(120, 170, 230, 0.28);
  border-radius: 8px; backdrop-filter: blur(6px);
  font: 12px/1.35 ui-sans-serif, system-ui, sans-serif; color: #dce8f6;
  opacity: 0; transform: translate(-50%, -6px); pointer-events: none;
  transition: opacity 140ms ease, transform 140ms ease;
}
.fe-drone[data-flying='true'] { opacity: 1; transform: translate(-50%, 0); }
.fe-drone-head { display: flex; align-items: center; gap: 7px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; font-size: 10px; color: #9fc3e8; }
.fe-drone-dot { width: 7px; height: 7px; border-radius: 50%; background: #4ade80; box-shadow: 0 0 8px #4ade80; }
.fe-drone-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 9px 0 8px; }
.fe-drone-grid div { display: flex; flex-direction: column; gap: 2px; }
.fe-drone-grid span { font-size: 9px; letter-spacing: 0.05em; text-transform: uppercase; color: #7f96ad; }
.fe-drone-grid strong { font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; }
.fe-drone-cruise { display: flex; align-items: center; gap: 8px; }
.fe-drone-cruise > span:first-child { font-size: 9px; letter-spacing: 0.05em; text-transform: uppercase; color: #7f96ad; }
.fe-drone-bar { flex: 1; height: 4px; border-radius: 2px; background: rgba(255,255,255,0.12); overflow: hidden; }
.fe-drone-bar div { height: 100%; width: 0%; background: linear-gradient(90deg, #4ade80, #8ab4ff); }
.fe-drone-cruise > span:last-child { font-variant-numeric: tabular-nums; font-size: 11px; min-width: 58px; text-align: right; }
.fe-drone p { margin: 8px 0 0; font-size: 10px; line-height: 1.5; color: #8ba2b8; }
.fe-drone kbd {
  font: inherit; font-weight: 600; color: #cfe0f2;
  background: rgba(255,255,255,0.09); border-radius: 3px; padding: 0 3px;
}
`;

export interface DroneHud {
  /** Push a frame of telemetry into the panel. Safe to call every frame. */
  update(telemetry: FlyTelemetry): void;
  dispose(): void;
}

export function createDroneHud(): DroneHud {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);

  const root = document.createElement('div');
  root.className = 'fe-drone';
  root.dataset.testid = 'drone-hud';
  root.dataset.flying = 'false';
  root.innerHTML = `
    <div class="fe-drone-head"><span class="fe-drone-dot"></span><span>Free flight</span></div>
    <div class="fe-drone-grid">
      <div><span>Alt</span><strong data-f="alt">-</strong></div>
      <div><span>AGL</span><strong data-f="agl">-</strong></div>
      <div><span>Speed</span><strong data-f="speed">-</strong></div>
      <div><span>Hdg</span><strong data-f="hdg">-</strong></div>
    </div>
    <div class="fe-drone-cruise">
      <span>Cruise</span>
      <div class="fe-drone-bar"><div data-f="bar"></div></div>
      <span data-f="cruise">-</span>
    </div>
    <p><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> fly &middot; <kbd>E</kbd> up, <kbd>Q</kbd> down &middot;
    <kbd>R</kbd><kbd>F</kbd> circle what you are looking at &middot; drag or arrows to look &middot;
    wheel sets speed &middot; <kbd>Shift</kbd> boost &middot; <kbd>Esc</kbd> back to the map</p>
  `;
  document.body.append(root);

  const field = (name: string) => root.querySelector<HTMLElement>(`[data-f="${name}"]`);
  const alt = field('alt');
  const agl = field('agl');
  const speed = field('speed');
  const hdg = field('hdg');
  const cruise = field('cruise');
  const bar = field('bar');

  return {
    update(t) {
      root.dataset.flying = String(t.engaged);
      // Read by the browser test. Pixels are useless for "has it actually
      // moved" when the water and the trees animate whatever the camera does.
      root.dataset.speed = t.speedMs.toFixed(2);
      root.dataset.alt = t.altitudeM.toFixed(2);
      root.dataset.heading = t.headingDeg.toFixed(1);
      if (!t.engaged) return;

      if (alt) alt.textContent = `${t.altitudeM.toFixed(1)} hex`;
      // A null AGL is off the edge of the map, and says so rather than
      // guessing at sea level.
      if (agl) agl.textContent = t.aglM == null ? 'off map' : `${t.aglM.toFixed(1)} hex`;
      if (speed) speed.textContent = `${t.speedMs.toFixed(1)} hex/s`;
      if (hdg) hdg.textContent = `${Math.round(t.headingDeg)}\u00b0`;
      if (cruise) cruise.textContent = `${t.cruiseMs.toFixed(1)} hex/s`;
      if (bar) bar.style.width = `${Math.round(t.cruise * 100)}%`;
    },

    dispose() {
      root.remove();
      style.remove();
    },
  };
}
