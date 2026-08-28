/**
 * Consumer entry point.
 *
 * ⚠️ NO `I18nProvider`, AND THAT IS A DEBT RATHER THAN A DECISION. `src/i18n/de.json` and
 * `en.json` are held by another task, so adding consumer strings to them now would collide. The
 * strings in `src/consumer/` are therefore German inline, with real umlauts. When the i18n files
 * are free, move them and wrap this tree in `<I18nProvider>` exactly as `src/main.tsx` does.
 */

import { createRoot } from 'react-dom/client';

// Side-effect import, and the ordering matters for the same reason as in `src/main.tsx`: the
// module sets data-theme on <html> as it loads, which is what stops a dark-mode visitor seeing a
// white flash before the first paint.
import '@/theme';

import { ConsumerApp } from './ConsumerApp';

import '@/main.css';

createRoot(document.getElementById('root')!).render(<ConsumerApp />);
