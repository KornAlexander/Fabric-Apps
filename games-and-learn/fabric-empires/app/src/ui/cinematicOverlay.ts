/**
 * The letterbox, the title card, and the way out.
 *
 * ⚠️ **Skippable from the first frame, and it says so.** A cutscene the player
 * cannot escape is the fastest way to make a four-second shot feel like a
 * minute, and these fire at exactly the moments someone replaying the game has
 * already seen. Escape, click or space, all of them, because the one a player
 * reaches for is the one that has to work.
 *
 * The bars are drawn here rather than by moving the camera, so the 3D scene
 * knows nothing about presentation and the shot stays a pure function of time.
 */

const STYLE = `
.fe-cine {
  position: fixed; inset: 0; z-index: 55; pointer-events: none;
  opacity: 0; transition: opacity 320ms ease;
  font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; color: #f2f5fa;
}
.fe-cine[data-open='true'] { opacity: 1; pointer-events: auto; cursor: pointer; }
.fe-cine-bar {
  position: absolute; left: 0; right: 0; height: 12vh; background: #05070b;
  transform: scaleY(0); transition: transform 420ms cubic-bezier(0.22, 1, 0.36, 1);
}
.fe-cine-bar.top { top: 0; transform-origin: top; }
.fe-cine-bar.bottom { bottom: 0; transform-origin: bottom; }
.fe-cine[data-open='true'][data-bars='true'] .fe-cine-bar { transform: scaleY(1); }
.fe-cine-text {
  position: absolute; left: 0; right: 0; bottom: 15vh; text-align: center;
  opacity: 0; transform: translateY(10px); transition: opacity 500ms ease, transform 500ms ease;
  text-shadow: 0 2px 18px rgba(0,0,0,0.9);
}
.fe-cine[data-open='true'] .fe-cine-text { opacity: 1; transform: translateY(0); }
.fe-cine-title {
  font-size: 34px; font-weight: 300; letter-spacing: 0.16em; text-transform: uppercase;
}
.fe-cine-sub { margin-top: 8px; font-size: 13px; color: #b9c7d6; letter-spacing: 0.05em; }
.fe-cine-skip {
  position: absolute; right: 22px; bottom: calc(12vh + 14px);
  font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #8ba2b8;
}
/* With no bars there is no 12vh of black to sit above. */
.fe-cine[data-bars='false'] .fe-cine-skip { bottom: 18px; }

/*
 * The interface gets out of the frame.
 *
 * ⚠️ Without this the shot is composed behind a research panel and a unit
 * card, which is the difference between a cinematic and a screenshot of a game
 * with black bars drawn on it. The panels fade rather than vanish so the
 * return is not a jolt.
 *
 * ⚠️ The battle banner is in here for the siege, and it costs nothing: the
 * banner outlives the shot, so fading it for three seconds delays the numbers
 * rather than hiding them. Left in, it parks a box of text across the middle
 * of the one frame where the ram reaches the gate.
 */
body.fe-cine-on .panel,
body.fe-cine-on .fe-battle {
  opacity: 0; pointer-events: none;
  transition: opacity 300ms ease;
}
.panel { transition: opacity 300ms ease; }
`;

export interface QuietOptions {
  /**
   * Draw the letterbox bars. Default true.
   *
   * ⚠️ False is for shots that fire *often*. The bars and the title card are
   * sized for a once-a-game moment; a siege happens several times a turn late
   * on, and stamping a title card over every one of them turns a flourish
   * into a tax. What a siege actually needs from this module is the panel
   * fade, so that is all it takes.
   */
  readonly bars?: boolean;
}

export interface CinematicOverlay {
  show(title: string, subtitle: string, options?: QuietOptions): void;
  hide(): void;
  /** Called when the player asks to skip. */
  onSkip(handler: () => void): void;
  readonly isOpen: boolean;
  dispose(): void;
}

export function createCinematicOverlay(): CinematicOverlay {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);

  const root = document.createElement('div');
  root.className = 'fe-cine';
  root.dataset.testid = 'cinematic';
  root.dataset.open = 'false';
  root.dataset.bars = 'true';
  root.innerHTML = `
    <div class="fe-cine-bar top"></div>
    <div class="fe-cine-bar bottom"></div>
    <div class="fe-cine-text">
      <div class="fe-cine-title" data-f="title"></div>
      <div class="fe-cine-sub" data-f="sub"></div>
    </div>
    <div class="fe-cine-skip">Esc to skip</div>
  `;
  document.body.append(root);

  let open = false;
  const handlers = new Set<() => void>();
  const fire = (): void => {
    if (!open) return;
    for (const handler of handlers) handler();
  };

  root.addEventListener('click', fire);
  const onKey = (e: KeyboardEvent): void => {
    if (!open) return;
    if (e.key === 'Escape' || e.key === ' ') {
      e.preventDefault();
      // Stop the map's own handlers seeing this: space ends the turn, and
      // ending a turn because someone skipped a cutscene would be a nasty
      // little surprise.
      e.stopImmediatePropagation();
      fire();
    }
  };
  window.addEventListener('keydown', onKey, { capture: true });

  return {
    show(title, subtitle, options) {
      open = true;
      const t = root.querySelector<HTMLElement>('[data-f="title"]');
      if (t) t.textContent = title;
      const s = root.querySelector<HTMLElement>('[data-f="sub"]');
      if (s) s.textContent = subtitle;
      root.dataset.bars = options?.bars === false ? 'false' : 'true';
      root.dataset.open = 'true';
      document.body.classList.add('fe-cine-on');
    },
    hide() {
      open = false;
      root.dataset.open = 'false';
      document.body.classList.remove('fe-cine-on');
    },
    onSkip(handler) {
      handlers.add(handler);
    },
    get isOpen() {
      return open;
    },
    dispose() {
      window.removeEventListener('keydown', onKey, { capture: true });
      document.body.classList.remove('fe-cine-on');
      root.remove();
      style.remove();
    },
  };
}
