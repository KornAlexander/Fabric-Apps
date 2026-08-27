/**
 * A two-or-three way choice, asked at a moment that matters.
 *
 * Deliberately not a `window.confirm`: this is asked at the climax of a siege,
 * and a browser chrome dialog would break the frame the whole scene has been
 * building. It is also deliberately not dismissable by clicking away, because
 * every option here is a real decision and "I clicked outside" is not one of
 * them.
 */

export interface ChoiceOption<T extends string> {
  readonly id: T;
  readonly label: string;
  /** One line explaining what this costs, which is the actual decision. */
  readonly detail: string;
  /** Rendered in the accent colour, for the option the game recommends. */
  readonly primary?: boolean;
}

export interface ChoiceModal {
  ask<T extends string>(
    title: string,
    body: string,
    options: readonly ChoiceOption<T>[],
  ): Promise<T>;
  readonly open: () => boolean;
}

export function createChoiceModal(): ChoiceModal {
  const root = document.createElement('div');
  root.className = 'fe-choice';
  root.style.display = 'none';
  document.body.append(root);

  let showing = false;

  const ask = <T extends string>(
    title: string,
    body: string,
    options: readonly ChoiceOption<T>[],
  ): Promise<T> =>
    new Promise((resolve) => {
      showing = true;
      root.innerHTML = '';
      root.style.display = 'flex';

      const card = document.createElement('div');
      card.className = 'fe-choice-card';

      const heading = document.createElement('h2');
      heading.textContent = title;
      card.append(heading);

      const text = document.createElement('p');
      text.className = 'fe-choice-body';
      text.textContent = body;
      card.append(text);

      const list = document.createElement('div');
      list.className = 'fe-choice-options';

      for (const option of options) {
        const button = document.createElement('button');
        button.className = option.primary ? 'fe-choice-option primary' : 'fe-choice-option';

        const label = document.createElement('span');
        label.className = 'fe-choice-label';
        label.textContent = option.label;
        button.append(label);

        const detail = document.createElement('span');
        detail.className = 'fe-choice-detail';
        detail.textContent = option.detail;
        button.append(detail);

        button.addEventListener('click', () => {
          showing = false;
          root.style.display = 'none';
          root.innerHTML = '';
          resolve(option.id);
        });
        list.append(button);
      }

      card.append(list);
      root.append(card);

      // Focus the recommended option so Enter is a sane default and the
      // keyboard works at all, which matters because the rest of the game is
      // playable without the mouse.
      //
      // ⚠️ preventScroll. The recommended option is not always the first one,
      // and a plain focus() scrolls it into view, which on a short screen
      // pushes the question this dialog is asking off the top.
      const first = list.querySelector<HTMLButtonElement>('.primary') ??
        list.querySelector<HTMLButtonElement>('button');
      first?.focus({ preventScroll: true });
      root.scrollTop = 0;
    });

  return { ask, open: () => showing };
}
