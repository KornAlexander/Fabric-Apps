/**
 * Typed cheat words.
 *
 * ⚠️ THIS IS THE ONLY WAY THE SPORTS CAR EXISTS. Nothing in the interface offers it, no setting
 * enables it, and no URL parameter turns it on. That is the point of a cheat: it is a private joke
 * for whoever knows the word, and the demo a customer sees is the bus on the real road at the real
 * speed. `src/twin3d/shuttle.ts` explains at length why the honest vehicle matters; this does not
 * change it, it parks a different mesh on the same route for anyone who asks by name.
 */

/**
 * Watch for a word being typed and call back when it completes.
 *
 * ⚠️ IGNORES TYPING IN FIELDS, and that is not a nicety. This app has a chat box, a room search and
 * a free-text rule editor. Somebody writing "Vorlesung im Lambo-Saal" into the assistant would
 * otherwise fire the cheat mid-sentence, and the resulting Ferrari would be genuinely baffling.
 *
 * @returns an unsubscribe function.
 */
export function watchForCheat(word: string, onEntered: () => void): () => void {
  const target = word.toLowerCase();
  let buffer = '';

  const onKey = (event: KeyboardEvent) => {
    const el = event.target as HTMLElement | null;
    const tag = el?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return;
    // A modifier means they are driving the app, not typing a word: Ctrl+L is a browser shortcut
    // and must not contribute a letter to the buffer.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.length !== 1) return;

    // Keep only as much history as the word needs. A rolling window rather than a reset-on-miss
    // state machine, because "llambo" and "lamlambo" should both work: somebody mistyping the
    // first letter and carrying on is the normal case, and a strict machine would refuse it.
    buffer = (buffer + event.key.toLowerCase()).slice(-target.length);
    if (buffer === target) {
      buffer = '';
      onEntered();
    }
  };

  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
