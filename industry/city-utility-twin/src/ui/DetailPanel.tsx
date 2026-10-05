import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { PickDetail } from '../map/worldScene';
import { author, createNote, KATEGORIEN } from '../agent/client';
import { categoryLabel, later, show, t, type Text } from '../i18n';
import { useLanguage } from '../i18n/useLanguage';

export interface DetailPanelProps {
  detail: PickDetail;
  onClose(): void;
  /** Called after a note was saved, so the notes layer can show it at once. */
  onNoteSaved(): void;
}

/**
 * What the source published about the clicked object.
 *
 * ⚠️ EVERY VALUE IS RENDERED AS TEXT, never as markup. These strings come from a third-party open
 * data service and are shown verbatim. React escapes them; nothing here may use
 * `dangerouslySetInnerHTML`, because that would turn somebody else's free-text field into script.
 */
export function DetailPanel({ detail, onClose, onNoteSaved }: DetailPanelProps) {
  useLanguage();
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    if (panel.current) panel.current.scrollTop = 0;
  }, [detail]);

  const accent = detail.accent === undefined
    ? 'var(--cp-accent)'
    : `#${detail.accent.toString(16).padStart(6, '0')}`;

  return (
    <aside
      id="detail"
      ref={panel}
      aria-label={t('detail.label')}
      aria-live="polite"
      style={{ borderLeftColor: accent }}
    >
      <button id="detail-close" type="button" aria-label={t('detail.close')} title={t('detail.closeShort')} onClick={onClose}>✕</button>
      {detail.subtitle ? <p id="detail-kind">{show(detail.subtitle)}</p> : null}
      <h2 id="detail-title">{show(detail.title)}</h2>
      <dl id="detail-fields">
        {detail.fields.length === 0
          ? <dd>{t('detail.noFields')}</dd>
          : detail.fields.map((field, index) => (
            <FieldRow key={index} label={field.label} value={field.value} />
          ))}
      </dl>
      <p id="detail-source">{t('detail.source', show(detail.source))}</p>
      {detail.layerId === 'baustellen' && detail.baustelleId
        // Keyed by the object, so opening another construction site starts with a closed form.
        ? <NoteForm key={detail.baustelleId} detail={detail} onSaved={onNoteSaved} />
        : null}
    </aside>
  );
}

function FieldRow({ label, value }: { label: Text; value: Text }) {
  return (
    <>
      <dt>{show(label)}</dt>
      <dd>{show(value)}</dd>
    </>
  );
}

/**
 * Offer to write a note, but only on a construction site.
 *
 * ⚠️ NOT ON THE OFFICIAL AIR-QUALITY OR FLIGHT LAYERS. A note is an annotation this app owns; the
 * measuring stations and the aircraft belong to their operators and there is nothing here for a
 * user to coordinate. Offering the button everywhere would invite the reading that anything on
 * this map can be edited.
 */
function NoteForm({ detail, onSaved }: { detail: PickDetail; onSaved(): void }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>(KATEGORIEN[0]);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatusText] = useState<Text>('');
  // ⚠️ Wrapped: a function passed straight to a state setter runs as an updater and would store
  // a string in today's language instead of the translation function.
  const setStatus = (next: Text) => setStatusText(() => next);
  const textArea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) textArea.current?.focus();
  }, [open]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const body = text.trim();
    if (!detail.baustelleId || !body) {
      setStatus(later('note.enterText'));
      return;
    }
    setSaving(true);
    setStatus(later('note.saving'));
    void createNote({
      baustelleId: detail.baustelleId,
      // The note stores the place as the user saw it, in case the feature id is reused later.
      ort: show(detail.title),
      easting: detail.easting ?? null,
      northing: detail.northing ?? null,
      kategorie: category,
      text: body,
    }).then(() => {
      const name = author();
      setStatus(name ? later('note.savedAs', name) : later('note.savedAnon'));
      setOpen(false);
      onSaved();
    }).catch((error: unknown) => {
      const why = error instanceof Error ? error.message : t('error.unknown');
      setStatus(later('note.notSaved', why));
    }).finally(() => setSaving(false));
  };

  if (!open) {
    return (
      <>
        <div id="detail-actions">
          <button
            id="detail-note"
            type="button"
            onClick={() => { setText(''); setStatus(''); setOpen(true); }}
          >
            {t('note.add')}
          </button>
        </div>
        {show(status) ? <p id="note-status" aria-live="polite">{show(status)}</p> : null}
      </>
    );
  }

  return (
    <form id="note-form" onSubmit={submit}>
      <label htmlFor="note-kategorie">{t('note.category')}</label>
      <select id="note-kategorie" value={category} onChange={(event) => setCategory(event.currentTarget.value)}>
        {KATEGORIEN.map((value) => <option key={value} value={value}>{categoryLabel(value)}</option>)}
      </select>
      <label htmlFor="note-text">{t('note.text')}</label>
      <textarea
        id="note-text"
        ref={textArea}
        rows={3}
        maxLength={2000}
        placeholder={t('note.placeholder')}
        value={text}
        onChange={(event) => setText(event.currentTarget.value)}
      />
      <p className="note-hint">{t('note.hint')}</p>
      <div className="note-actions">
        <button id="note-save" type="submit" disabled={saving}>{t('note.save')}</button>
        <button id="note-cancel" type="button" onClick={() => setOpen(false)}>{t('note.cancel')}</button>
      </div>
      <p id="note-status" aria-live="polite">{show(status)}</p>
    </form>
  );
}
