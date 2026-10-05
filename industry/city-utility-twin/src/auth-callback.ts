/**
 * MSAL redirect bridge.
 *
 * ⚠️ THE REDIRECT URI MUST BE THIS PAGE, NOT THE APP ROOT. MSAL 5 finishes a popup sign-in by
 * having the redirect page broadcast the raw authentication response over a same-origin
 * BroadcastChannel, which the opener is waiting on. When the redirect URI pointed at `/`, the
 * popup booted the whole 3D application instead of broadcasting; the opener timed out after its
 * default 60 seconds and `signIn()` resolved to null. Measured 2026-09-22: a sign-in that looked
 * like it had worked left no account in storage at all.
 *
 * ⚠️ NOTHING ELSE MAY RUN HERE. No map, no agent, no layers. This page exists to hand one
 * response back and close.
 */

import { broadcastResponseToMainFrame } from '@azure/msal-browser/redirect-bridge';
// Text only: the language resolver and the message table, no app code.
import { getLanguage, t } from './i18n';

const note = document.querySelector('p');
document.documentElement.lang = getLanguage();
document.title = t('auth.pending');
if (note) note.textContent = t('auth.pending');

broadcastResponseToMainFrame()
  .then(() => {
    if (note) note.textContent = t('auth.done');
  })
  .catch((error: unknown) => {
    // A failure here is visible to a human rather than silent, because the only person who ever
    // sees this page is the one who just tried to sign in.
    if (note) {
      note.textContent = t('auth.failed', error instanceof Error ? error.message : t('error.unknown'));
    }
  });
