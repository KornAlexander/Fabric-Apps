/**
 * Panels that can be folded away.
 *
 * ⚠️ **This exists because of a measurement, not a preference.** On a 390x844
 * phone the HUD is a single scrolling column under the map, and the mobile
 * audit measured its scroll container holding **1542 px of content in a 371 px
 * window**. Everything was reachable and almost nothing was visible: four
 * screens of scrolling to reach a button, on a device held in one hand.
 *
 * ⚠️ **Nothing here restructures the DOM, and that is deliberate.** The obvious
 * implementation wraps each panel's contents in a body element and toggles
 * that. It would break `log`, whose entries are appended to the panel itself
 * and would start landing outside the wrapper, and it would do so silently:
 * the log would simply stop growing on screen while continuing to grow in
 * memory. Collapsing is a CSS rule about children instead, so a panel that
 * gains a child later is still correct.
 *
 * ⚠️ **The visible title is never copied.** `research` and `cities` rewrite
 * their own `<h2>` from state, so a toggle that put the title in its own label
 * would be a second copy that goes stale the first time a topic changes. The
 * heading stays exactly where it was and the toggle sits beside it.
 */

/** Where the open/closed choices live, so they survive a reload. */
export const PANEL_STORE_KEY = 'fabric-empires:panels:v1';

/**
 * The panels worth folding, and the heading to give the ones that have none.
 *
 * ⚠️ `selection` is deliberately absent. It is the panel the player acts
 * through, so collapsing it would hide the buttons that play the game.
 *
 * `resources` and `controls` are absent for the same reason: they are the top
 * bar, they are one row, and a fold would cost more than it saves.
 */
export const COLLAPSIBLE: readonly { readonly id: string; readonly title?: string }[] = [
  { id: 'tile', title: 'Tile' },
  { id: 'research' },
  { id: 'threats' },
  { id: 'cities' },
  { id: 'log', title: 'Log' },
  { id: 'help', title: 'Keys' },
];

export interface PanelStore {
  read(): string | undefined;
  write(json: string): void;
}

/** localStorage, or a store that forgets, exactly like the save slot does. */
export function localPanelStore(key: string = PANEL_STORE_KEY): PanelStore {
  try {
    const probe = `${key}:probe`;
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
  } catch {
    let held: string | undefined;
    return { read: () => held, write: (json) => { held = json; } };
  }
  return {
    read: () => window.localStorage.getItem(key) ?? undefined,
    write: (json) => {
      try {
        window.localStorage.setItem(key, json);
      } catch {
        // A full or blocked store is not worth a broken interface.
      }
    },
  };
}

export interface PanelsOptions {
  readonly store?: PanelStore;
  /**
   * Whether the screen is the narrow one the CSS treats as mobile.
   *
   * ⚠️ Injected rather than read here so the default can be asserted for both
   * shapes under test, where `matchMedia` is a stub that always says no.
   */
  readonly isNarrow?: () => boolean;
  /** Translation, so the injected headings are not English on a German HUD. */
  readonly t?: (key: string) => string;
  readonly root?: ParentNode;
}

export interface Panels {
  /** Apply the stored (or default) state. Safe to call more than once. */
  apply(): void;
  isOpen(id: string): boolean;
  toggle(id: string): void;
}

const NARROW_QUERY = '(max-width: 760px), (max-height: 520px) and (orientation: landscape)';

export function createPanels(options: PanelsOptions = {}): Panels {
  const root = options.root ?? document;
  const store = options.store ?? localPanelStore();
  const translate = options.t ?? ((key: string) => key);
  const isNarrow =
    options.isNarrow ??
    (() => {
      try {
        return window.matchMedia(NARROW_QUERY).matches;
      } catch {
        return false;
      }
    });

  /*
   * ⚠️ The default is decided ONCE, not per call. Re-reading the media query
   * on every toggle would mean rotating a phone into landscape silently
   * reopening panels the player had closed.
   */
  const closedByDefault = isNarrow();

  let open: Record<string, boolean> = {};
  const stored = store.read();
  if (stored) {
    try {
      const parsed: unknown = JSON.parse(stored);
      if (parsed && typeof parsed === 'object') open = parsed as Record<string, boolean>;
    } catch {
      // A corrupt preference is not worth refusing to draw the interface for.
    }
  }

  const isOpen = (id: string): boolean => open[id] ?? !closedByDefault;

  const save = (): void => {
    store.write(JSON.stringify(open));
  };

  const paint = (id: string): void => {
    const panel = root.querySelector<HTMLElement>(`#${id}`);
    if (!panel) return;
    const shown = isOpen(id);
    panel.classList.toggle('collapsed', !shown);
    const button = panel.querySelector<HTMLButtonElement>('.panel-toggle');
    if (button) {
      button.setAttribute('aria-expanded', shown ? 'true' : 'false');
      // ⚠️ The chevron is content, not a background image: a CSS-only marker
      // is invisible to a screen reader and to anybody with images off.
      button.textContent = shown ? '\u2212' : '+';
    }
  };

  const toggle = (id: string): void => {
    open = { ...open, [id]: !isOpen(id) };
    save();
    paint(id);
  };

  const apply = (): void => {
    for (const entry of COLLAPSIBLE) {
      const panel = root.querySelector<HTMLElement>(`#${entry.id}`);
      if (!panel) continue;

      /*
       * Give it a heading if it has none.
       *
       * ⚠️ A collapsed panel that is only a chevron says nothing about what is
       * behind it. `help`, `tile` and `log` are plain content with no title, so
       * they get a fixed one. Fixed, because a heading derived from the content
       * would be the second copy this module exists to avoid.
       */
      if (entry.title && !panel.querySelector('h2')) {
        const heading = document.createElement('h2');
        heading.textContent = translate(entry.title);
        heading.dataset.i18n = entry.title;
        panel.prepend(heading);
      }

      if (!panel.querySelector('.panel-toggle')) {
        const button = document.createElement('button');
        button.className = 'panel-toggle';
        button.type = 'button';
        button.setAttribute('aria-controls', entry.id);
        const label = panel.querySelector('h2')?.textContent?.trim() ?? entry.id;
        button.setAttribute('aria-label', label);
        button.addEventListener('click', () => toggle(entry.id));
        panel.prepend(button);
      }

      panel.classList.add('foldable');
      paint(entry.id);
    }
  };

  return { apply, isOpen, toggle };
}
