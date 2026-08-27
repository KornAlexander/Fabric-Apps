/**
 * The warning that comes before a defence question.
 *
 * ⚠️ **The order was wrong and it made the question feel arbitrary.** An
 * incoming raid was detected in the preview turn and the modal opened
 * immediately, so the first thing a player saw was a question, with the only
 * clue being one line in the log panel. Being asked to defend against an attack
 * you have not been shown is indistinguishable from being quizzed at random,
 * and the entire design rests on the opposite: who is marching on you tells you
 * what you are about to be tested on.
 *
 * So the attack is shown first, at the place it is happening, in the attacker's
 * colour, and the question follows. The banner deliberately stays up while the
 * question is answered: the faction is the reason for the topic, and hiding it
 * at the moment of asking would throw that away again.
 *
 * ⚠️ It therefore sits ABOVE the question's backdrop in the stack. The backdrop
 * is 72% black with a blur, so anything beneath it is dimmed to a quarter and
 * out of focus, which for a banner whose whole job is to be read is the same as
 * not showing it.
 */

import { t } from '../i18n.js';

export interface RaidAlertDetail {
  /** Attacking faction's display name. */
  readonly faction: string;
  readonly colour: string;
  /** What of the player's is being hit, already phrased. */
  readonly target: string;
  /** What the question will be about, if it is known. */
  readonly topic?: string | undefined;
  /** Other raids landing this turn, beyond this one. */
  readonly alsoComing: number;
}

export interface RaidAlert {
  show(detail: RaidAlertDetail): void;
  hide(): void;
  readonly isOpen: () => boolean;
}

export function createRaidAlert(): RaidAlert {
  const root = document.createElement('div');
  root.className = 'fe-raid';
  root.hidden = true;
  root.setAttribute('role', 'status');
  document.body.append(root);

  let open = false;

  return {
    show(detail) {
      open = true;
      root.innerHTML = '';
      root.style.setProperty('--raid-colour', detail.colour);

      const flag = document.createElement('span');
      flag.className = 'fe-raid-flag';
      root.append(flag);

      const body = document.createElement('div');
      body.className = 'fe-raid-body';

      const head = document.createElement('div');
      head.className = 'fe-raid-head';
      head.textContent = t('{faction} is attacking', { faction: detail.faction });
      body.append(head);

      const line = document.createElement('div');
      line.className = 'fe-raid-target';
      /*
       * ⚠️ Two keys rather than one with a conditional "s".
       *
       * English pluralises by appending a letter and German does not: the
       * plural of Front is Fronten, so a translated string with an "s" glued
       * on by JavaScript cannot be right in both. Whichever language loses is
       * the one nobody proof-read.
       */
      line.textContent =
        detail.alsoComing > 0
          ? detail.alsoComing === 1
            ? t('{target}, and one more front', { target: detail.target })
            : t('{target}, and {n} more fronts', {
                target: detail.target,
                n: String(detail.alsoComing),
              })
          : detail.target;
      body.append(line);

      if (detail.topic) {
        const topic = document.createElement('div');
        topic.className = 'fe-raid-topic';
        // The whole point of the faction system, said out loud at the moment
        // it matters: this is why you are about to be asked this.
        topic.textContent = t('They will test you on: {topic}', { topic: detail.topic });
        body.append(topic);
      }

      root.append(body);
      root.hidden = false;
      // Restart the entry animation even if the banner was already up.
      root.classList.remove('in');
      void root.offsetWidth;
      root.classList.add('in');
    },

    hide() {
      open = false;
      root.hidden = true;
      root.classList.remove('in');
    },

    isOpen: () => open,
  };
}
