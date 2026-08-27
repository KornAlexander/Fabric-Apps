import { useI18n } from '@/i18n';
import { SCENES, type SceneEntry } from '@/twin3d/scenes';

interface Props {
  value: SceneEntry;
  onChange: (scene: SceneEntry) => void;
}

/**
 * The map switch — the whole scene changes with the selection.
 *
 * A `<select>` rather than a row of buttons because the list is meant to grow: two rivers are
 * ready and two more have terrain, and four tabs in a header that already carries a title, a
 * subtitle, a reach and three buttons would wrap.
 *
 * Not-ready scenes stay in the list, disabled, with the reason shown underneath when one is
 * highlighted — see the note in `scenes.ts` for why they are not simply hidden.
 */
export function SceneSwitch({ value, onChange }: Props) {
  const { t } = useI18n();

  return (
    <label className="ml-auto flex items-center gap-2 text-[0.7rem] text-stone-600 2xl:ml-0">
      <span className="sr-only">{t('scenes.label')}</span>
      <select
        data-testid="scene-switch"
        value={value.id}
        onChange={(e) => {
          const next = SCENES.find((s) => s.id === e.target.value);
          if (next?.ready) onChange(next);
        }}
        className="rounded border border-stone-300 bg-stone-50 px-2 py-1 text-[0.7rem] text-stone-700 hover:bg-stone-200 focus:outline-none focus:ring-1 focus:ring-stone-400"
      >
        {SCENES.map((scene) => (
          <option key={scene.id} value={scene.id} disabled={!scene.ready}>
            {t(scene.labelKey)}
            {scene.ready ? '' : ` — ${t(scene.blockedKey ?? 'scenes.blockedTerrainOnly')}`}
          </option>
        ))}
      </select>
    </label>
  );
}
