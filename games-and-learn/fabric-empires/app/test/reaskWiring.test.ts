import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/*
  That the app actually uses the no-repeat machinery.

  ⚠️ This file exists because the learn-layer tests cannot see it. They build
  their own presenter and prove the rule works; if `main.ts` forgot to pass the
  `retired` set, every one of them would still pass and the game would go on
  repeating questions exactly as before. The wiring is the part with no other
  witness.
*/

const main = readFileSync(resolve(process.cwd(), 'app/src/main.ts'), 'utf8');

describe('the app wires up question retirement', () => {
  it('keeps a session-scoped set', () => {
    expect(main).toContain('const retiredThisSession = new Set<string>();');
  });

  it('⚠️ hands it to the solo presenter', () => {
    const call = main.slice(main.indexOf('const soloPresenter = createQuestionPresenter('));
    expect(call.slice(0, 200)).toContain('retired: retiredThisSession');
  });

  it('⚠️ hands it to seat one as well, which shares the bank', () => {
    const call = main.slice(main.indexOf('seatOnePresenter = createQuestionPresenter('));
    expect(call.slice(0, 300)).toContain('retired: retiredThisSession');
  });

  it('⚠️ gives seat two its OWN sets, because it reads its own bank', () => {
    /*
     * Two independently authored banks have no shared id space. Sharing the
     * sets would let a Klasse 1 id retire a DP-600 question numbered the same,
     * which would look like a question silently going missing.
     */
    const call = main.slice(main.indexOf('secondSeat = createQuestionPresenter('));
    const body = call.slice(0, 400);
    expect(body).toContain('asked: new Set<string>()');
    expect(body).toContain('retired: new Set<string>()');
    expect(body).not.toContain('retiredThisSession');
  });

  it('⚠️ never persists retirement, or a topic answered once is never tested again', () => {
    /*
     * Mastery IS persisted, deliberately, and that is what carries knowledge
     * between sittings. Retirement must not be: it is only there to stop the
     * same question inside one sitting.
     *
     * ⚠️ Asserted per line mentioning the set, not over a slice of the file.
     * The first attempt sliced from the declaration to the next `const` and
     * swallowed the mastery tracker in between, which persists on purpose, so
     * the test failed on a line it was never about.
     */
    const mentions = main
      .split('\n')
      .filter((line) => line.includes('retiredThisSession') && !line.trim().startsWith('*'));

    expect(mentions.length).toBeGreaterThan(0);
    for (const line of mentions) {
      expect(line).not.toContain('localStorage');
      expect(line).not.toContain('saveGame');
      expect(line).not.toContain('slot');
    }
  });
});
