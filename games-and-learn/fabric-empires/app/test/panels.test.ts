// @vitest-environment jsdom
/**
 * ⚠️ Folding panels, and the two ways this could have been done wrong.
 *
 * The mobile audit measured the HUD column at 1542 px of content in a 371 px
 * window on a 390x844 phone: everything reachable, almost nothing visible.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { COLLAPSIBLE, createPanels, type PanelStore } from '../src/ui/panels.js';

function memoryStore(): PanelStore & { value?: string } {
  const held: { value?: string } = {};
  return {
    read: () => held.value,
    write: (json) => { held.value = json; },
    get value() { return held.value; },
  } as PanelStore & { value?: string };
}

function build(): void {
  document.body.innerHTML = `
    <div class="panel" id="tile"><div id="tile-name">Hover a tile</div></div>
    <div class="panel" id="research"><h2 id="res-title">Researching nothing</h2><div class="options"></div></div>
    <div class="panel" id="threats"><h2>Who is coming</h2><div id="threats-list"></div></div>
    <div class="panel" id="cities"><h2 id="cities-title">Cities</h2><div id="cities-list"></div></div>
    <div class="panel" id="log"><div class="entry">Your empire begins.</div></div>
    <div class="panel" id="help"><span>keys</span></div>
    <div class="panel" id="selection"><h2 id="sel-title">Nothing selected</h2></div>
  `;
}

beforeEach(build);

describe('folding the reference panels away', () => {
  it('closes them all on a narrow screen and opens them on a wide one', () => {
    createPanels({ store: memoryStore(), isNarrow: () => true }).apply();
    for (const { id } of COLLAPSIBLE) {
      expect(document.getElementById(id)!.classList.contains('collapsed'), id).toBe(true);
    }

    build();
    createPanels({ store: memoryStore(), isNarrow: () => false }).apply();
    for (const { id } of COLLAPSIBLE) {
      expect(document.getElementById(id)!.classList.contains('collapsed'), id).toBe(false);
    }
  });

  it('⚠️ never folds the panel the player acts through', () => {
    createPanels({ store: memoryStore(), isNarrow: () => true }).apply();
    const selection = document.getElementById('selection')!;
    expect(selection.classList.contains('collapsed')).toBe(false);
    expect(selection.querySelector('.panel-toggle')).toBeNull();
  });

  it('remembers what was opened', () => {
    const store = memoryStore();
    const first = createPanels({ store, isNarrow: () => true });
    first.apply();
    first.toggle('log');
    expect(store.read()).toContain('log');

    build();
    createPanels({ store, isNarrow: () => true }).apply();
    expect(document.getElementById('log')!.classList.contains('collapsed')).toBe(false);
  });

  /**
   * ⚠️ The obvious implementation wraps each panel's contents in a body element.
   * It breaks `log`, whose entries are appended to the PANEL, and it breaks it
   * silently: the log stops growing on screen while still growing in memory.
   */
  it('⚠️ still hides content appended after it was set up', () => {
    createPanels({ store: memoryStore(), isNarrow: () => true }).apply();
    const log = document.getElementById('log')!;
    const entry = document.createElement('div');
    entry.className = 'entry';
    log.append(entry);
    // The rule is about children, so a late arrival is covered by construction.
    expect(log.classList.contains('collapsed')).toBe(true);
    expect(entry.closest('.collapsed')).toBe(log);
  });

  /**
   * ⚠️ `research` and `cities` rewrite their own heading from state. A toggle
   * that copied the title into its own label would go stale the first time a
   * topic changed, and would look correct until then.
   */
  it('⚠️ does not copy a heading that the game rewrites', () => {
    createPanels({ store: memoryStore(), isNarrow: () => false }).apply();
    const research = document.getElementById('research')!;
    expect(research.querySelectorAll('h2')).toHaveLength(1);
    const title = research.querySelector('h2')!;
    title.textContent = 'Delta Lake';
    expect(research.textContent).not.toContain('Researching nothing');
  });

  it('gives a heading to the panels that have none, so a closed one still says what it is', () => {
    createPanels({ store: memoryStore(), isNarrow: () => true }).apply();
    for (const id of ['tile', 'log', 'help']) {
      const h2 = document.getElementById(id)!.querySelector('h2');
      expect(h2, `${id} would collapse to an unlabelled chevron`).not.toBeNull();
      expect(h2!.textContent!.length).toBeGreaterThan(0);
    }
  });

  it('translates the headings it injects', () => {
    createPanels({ store: memoryStore(), isNarrow: () => true, t: (k) => (k === 'Log' ? 'Verlauf' : k) }).apply();
    expect(document.getElementById('log')!.querySelector('h2')!.textContent).toBe('Verlauf');
  });

  it('reports the state through aria-expanded', () => {
    const panels = createPanels({ store: memoryStore(), isNarrow: () => true });
    panels.apply();
    const button = document.getElementById('log')!.querySelector('.panel-toggle')!;
    expect(button.getAttribute('aria-expanded')).toBe('false');
    panels.toggle('log');
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('is safe to apply twice, so nothing doubles up', () => {
    const panels = createPanels({ store: memoryStore(), isNarrow: () => true });
    panels.apply();
    panels.apply();
    expect(document.getElementById('log')!.querySelectorAll('.panel-toggle')).toHaveLength(1);
    expect(document.getElementById('log')!.querySelectorAll('h2')).toHaveLength(1);
  });
});
