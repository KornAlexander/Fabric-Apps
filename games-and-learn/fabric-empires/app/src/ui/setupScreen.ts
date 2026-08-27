/**
 * The screen that comes before the world.
 *
 * ⚠️ It also earns its keep by covering the cold start. Section 22.2 measured
 * 8.1 seconds from load to playable on the enlarged map, and the worst thing
 * about the game was that all of it was a blank screen. A menu the player is
 * reading is the same wait, spent differently.
 */

import {
  FOCUS_OPTIONS,
  PACES,
  RIVAL_COUNTS,
  ROUGHNESS_LEVELS,
  WORLD_SHAPES,
  WORLD_SIZES,
  type FocusId,
  type PaceId,
  type RoughnessId,
  type WorldChoice,
  type WorldShapeId,
  type WorldSizeId,
} from '@fabric-empires/engine';
import { addImportedCampaign, allCampaigns } from '../courses.js';
import { createCoursePanel } from './coursePanel.js';
import { t } from '../i18n.js';

export interface SetupResult extends WorldChoice {
  readonly seed: string;
}

export interface SetupScreen {
  /** Show the screen and resolve when the player commits. */
  ask(defaults: SetupResult): Promise<SetupResult>;
  hide(): void;
  readonly isOpen: () => boolean;
}

export function createSetupScreen(): SetupScreen {
  const root = document.createElement('div');
  root.className = 'fe-setup';
  root.style.display = 'none';
  document.body.append(root);

  let showing = false;

  function optionList<T extends string>(
    title: string,
    items: readonly { id: T; label: string; detail: string }[],
    selected: T,
    onPick: (id: T) => void,
  ): HTMLElement {
    const group = new Map<T, HTMLButtonElement>();
    const wrap = document.createElement('div');
    wrap.className = 'fe-setup-group';

    const heading = document.createElement('h3');
    heading.textContent = title;
    wrap.append(heading);

    const list = document.createElement('div');
    list.className = 'fe-setup-options';

    const paint = (active: T) => {
      for (const [id, button] of group) {
        button.classList.toggle('active', id === active);
        button.setAttribute('aria-pressed', String(id === active));
      }
    };

    for (const item of items) {
      const button = document.createElement('button');
      button.className = 'fe-setup-option';
      button.type = 'button';

      const label = document.createElement('span');
      label.className = 'fe-setup-label';
      label.textContent = t(item.label);
      button.append(label);

      const detail = document.createElement('span');
      detail.className = 'fe-setup-detail';
      detail.textContent = t(item.detail);
      button.append(detail);

      button.addEventListener('click', () => {
        onPick(item.id);
        paint(item.id);
      });

      group.set(item.id, button);
      list.append(button);
    }

    wrap.append(list);
    paint(selected);
    return wrap;
  }

  const ask = (defaults: SetupResult): Promise<SetupResult> =>
    new Promise((resolve) => {
      showing = true;
      root.innerHTML = '';
      root.style.display = 'flex';

      let shape: WorldShapeId = defaults.shape;
      let roughness: RoughnessId = defaults.roughness;
      let size: WorldSizeId = defaults.size;
      let focus: FocusId = defaults.focus;
      let rivals: number = defaults.rivals;
      let pace: PaceId = defaults.pace;
      let players: 1 | 2 = defaults.players;
      let courseP1: string = defaults.courseP1;
      let courseP2: string = defaults.courseP2;

      const card = document.createElement('div');
      card.className = 'fe-setup-card';

      const title = document.createElement('h1');
      title.textContent = 'Fabric Empires';
      card.append(title);

      const blurb = document.createElement('p');
      blurb.className = 'fe-setup-blurb';
      blurb.textContent = t(
        'The DP-600 outline is the tech tree. Rival factions each hold one branch of it: beat them and take what they know, or burn it and stay ignorant.',
      );
      card.append(blurb);

      /*
       * The first five minutes, on the screen everybody passes through.
       *
       * ⚠️ **The deployed URL is the only thing most people will ever see.**
       * The repository is private, so a README explaining the idea reaches
       * nobody, and the blurb above says what the game *is* without saying
       * what to *do*. Somebody who clicks Begin gets a hex map and has to
       * discover the three things that make this different from any other
       * strategy game by accident.
       *
       * Three lines, because a fourth would be a manual and nobody reads a
       * manual on the way into a game.
       */
      const tryThis = document.createElement('div');
      tryThis.className = 'fe-setup-try';
      const tryHead = document.createElement('h3');
      tryHead.textContent = t('If you only have five minutes');
      tryThis.append(tryHead);

      const tips = document.createElement('ul');
      const tip = (text: string): void => {
        const item = document.createElement('li');
        item.textContent = text;
        tips.append(item);
      };
      tip(t('Every advance is a question. Pick a topic, answer it, and the next units unlock.'));
      tip(t('Attack a walled city. You choose how to go in, and the defender chooses how to meet you.'));
      tip(t('At 100 percent readiness the Proctor sets a 40 question exam. Passing it wins the game.'));
      tryThis.append(tips);
      card.append(tryThis);

      const section = (label: string): HTMLElement => {
        const heading = document.createElement('h2');
        heading.className = 'fe-setup-section';
        heading.textContent = t(label);
        card.append(heading);
        return heading;
      };

      section(t('The world'));
      card.append(
        optionList(t('Shape'), WORLD_SHAPES, shape, (id) => {
          shape = id;
        }),
      );
      card.append(
        optionList(t('Land'), ROUGHNESS_LEVELS, roughness, (id) => {
          roughness = id;
        }),
      );
      card.append(
        optionList(t('Size'), WORLD_SIZES, size, (id) => {
          size = id;
        }),
      );

      section(t('The exam'));
      card.append(
        optionList(t('Focus'), FOCUS_OPTIONS, focus, (id) => {
          focus = id;
        }),
      );      card.append(
        optionList(
          t('Rivals'),
          RIVAL_COUNTS.map((n) => ({
            id: String(n),
            label: t('{n} rivals', { n }),
            detail:
              n === RIVAL_COUNTS[RIVAL_COUNTS.length - 1]
                ? t('Every branch of the outline has a faction holding it.')
                : t('{n} of the seven clusters come at you. A shorter war.', { n }),
          })),
          String(rivals),
          (id) => {
            rivals = Number(id);
          },
        ),
      );
      card.append(
        optionList(t('Pace'), PACES, pace, (id) => {
          pace = id;
        }),
      );

      // Players -----------------------------------------------------------
      section(t('Who is playing'));
      card.append(
        optionList(
          t('Seats'),
          [
            {
              id: '1',
              label: t('One player'),
              detail: t('You answer every question yourself.'),
            },
            {
              id: '2',
              label: t('Two players, together'),
              detail:
                t('One empire. Every battle asks you both at once, each from your own course.'),
            },
          ],
          String(players),
          (id) => {
            players = id === '2' ? 2 : 1;
            paintSeats();
          },
        ),
      );

      const courseGroup = document.createElement('div');
      courseGroup.className = 'fe-setup-seats';

      const repaintCourses = (): void => {
        courseGroup.replaceChildren();
        const worlds = allCampaigns().filter((c) => c.role === 'world');
        /*
         * ⚠️ Shown to a SOLO player too, now that the answer is used.
         *
         * This picker was hidden unless two people were playing, which was the
         * right call while it did nothing: `newGame` ignored it and built a
         * DP-600 world regardless, so offering a lone player a choice would
         * have been offering them a lie. It genuinely selects the world now,
         * so hiding it would instead be hiding the feature.
         *
         * Still suppressed when there is nothing to choose between. A list of
         * one is not a choice, it is a label.
         */
        if (worlds.length > 1 || players === 2) {
          courseGroup.append(
            optionList(
              players === 2 ? t('Player 1 answers with 1 2 3 4') : t('Your course'),
              worlds.map((c) => ({ id: c.id, label: c.course, detail: c.blurb })),
              courseP1,
              (id) => {
                courseP1 = id;
              },
            ),
          );
        }
        // ⚠️ Only player one's course may build the world, so the second seat
        // is offered every course including the question-only ones, which is
        // what every imported file is.
        if (players === 2) {
          courseGroup.append(
            optionList(
              t('Player 2 answers with A B C D'),
              allCampaigns().map((c) => ({ id: c.id, label: c.course, detail: c.blurb })),
              courseP2,
              (id) => {
                courseP2 = id;
              },
            ),
          );
        }
      };

      /*
       * Bring your own questions.
       *
       * ⚠️ Above the course pickers rather than below them, because it is the
       * thing that CHANGES what those pickers contain. Offered whether one or
       * two people are playing: a single player revising their own material is
       * the more obvious use of it, and hiding it inside the two-player section
       * would have made it look like a family feature.
       */
      const courses = createCoursePanel();
      courses.onImported((campaign) => {
        addImportedCampaign(campaign);
        // The new course is almost certainly why they came, so select it for
        // the second seat and switch to two players if they had not already.
        courseP2 = campaign.id;
        players = 2;
        repaintCourses();
        paintSeats();
      });
      card.append(courses.root);

      repaintCourses();
      card.append(courseGroup);

      const paintSeats = (): void => {
        // The course group's CONTENTS depend on the player count, not just its
        // visibility, so this is a repaint rather than a display toggle.
        repaintCourses();
      };
      paintSeats();

      // Seed --------------------------------------------------------------
      const seedGroup = document.createElement('div');
      seedGroup.className = 'fe-setup-group';
      const seedHeading = document.createElement('h3');
      seedHeading.textContent = t('The seed');
      seedGroup.append(seedHeading);

      const seedRow = document.createElement('div');
      seedRow.className = 'fe-setup-seed';
      const seedInput = document.createElement('input');
      seedInput.value = defaults.seed;
      seedInput.spellcheck = false;
      seedInput.setAttribute('aria-label', 'World seed');
      seedRow.append(seedInput);

      const seedNote = document.createElement('span');
      seedNote.className = 'fe-setup-detail';
      seedNote.textContent = t('Same seed and same choices, same world. Send one to a friend.');
      seedRow.append(seedNote);
      seedGroup.append(seedRow);
      card.append(seedGroup);

      // Commit -------------------------------------------------------------
      const play = document.createElement('button');
      play.className = 'fe-setup-play';
      play.type = 'button';
      play.textContent = t('Begin');
      const commit = () => {
        if (!showing) return;
        showing = false;
        root.style.display = 'none';
        root.innerHTML = '';
        resolve({
          shape,
          roughness,
          size,
          focus,
          rivals,
          pace,
          players,
          courseP1,
          courseP2,
          seed: seedInput.value.trim() || defaults.seed,
        });
      };
      play.addEventListener('click', commit);
      seedInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') commit();
      });
      card.append(play);

      root.append(card);
      /*
        ⚠️ preventScroll, then explicitly to the top.

        Focusing the play button is what makes Enter start the game, but a
        plain focus() scrolls it into view, and the button is the last thing
        on a card taller than the screen. Measured on the deployed build at
        900x700: the setup screen opened at scrollTop 1086 of 1786, so the
        title, the blurb and the whole "if you only have five minutes" box
        were above the fold. The first screen of the game opened halfway
        through itself.
      */
      play.focus({ preventScroll: true });
      root.scrollTop = 0;
    });

  return {
    ask,
    hide: () => {
      showing = false;
      root.style.display = 'none';
    },
    isOpen: () => showing,
  };
}
