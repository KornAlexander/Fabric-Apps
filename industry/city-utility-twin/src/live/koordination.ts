import * as THREE from 'three';

import type { LiveLayer, PickDetail, WorldPlacement } from '../map/worldScene';
import { failure, type StatusReporter } from './source';
import { categoryLabel, later, locale, t, type Text } from '../i18n';
import { listNotes, type Note } from '../agent/client';

/**
 * Koordinationsnotizen: die einzige Ebene, deren Daten aus dieser Anwendung stammen.
 *
 * ⚠️ NICHT AMTLICH, UND DAS IST DER GANZE PUNKT DER TRENNUNG. Jede andere Ebene zeigt, was eine
 * Behörde oder ein Messnetz veröffentlicht hat. Diese zeigt, was Menschen in dieser Anwendung
 * dazugeschrieben haben. Die Baustellendaten der Landeshauptstadt werden ausschließlich gelesen;
 * eine Notiz verweist auf eine Baumaßnahme, ändert sie aber nicht und erscheint nie im offenen
 * Datensatz der Stadt.
 *
 * ⚠️ DIE OFFENEN DATEN NENNEN NICHT, WER GRÄBT. Genau diese Lücke füllen die Notizen: eine
 * Organisation kann festhalten, dass sie an derselben Stelle arbeitet oder arbeiten will. Was
 * hier steht, ist eine Aussage der schreibenden Person, kein amtlicher Vermerk.
 */

const DRAPE_OFFSET_M = 4;
const MARKER_HEIGHT_M = 90;
const MARKER_RADIUS_M = 26;

const COLOUR: Record<string, number> = {
  'Hinweis': 0x3d8bfd,
  'Konflikt vermutet': 0xff0000,
  'Eigene Maßnahme geplant': 0x9b5de5,
  'Abstimmung erfolgt': 0x2e9e5b,
};
const FALLBACK_COLOUR = 0x9aa3ab;

function detailFor(note: Note, colour: number): PickDetail {
  const fields: { label: Text; value: Text }[] = [];
  const add = (label: Text, value: Text | null | undefined) => {
    const text = typeof value === 'string' ? value.trim() : value;
    if (text) fields.push({ label, value: text });
  };

  const kategorie = note.kategorie;
  add(later('notes.field.category'), kategorie ? () => categoryLabel(kategorie) : null);
  add(later('notes.field.text'), note.text);
  if (note.zeitraumVon && note.zeitraumBis) add(later('field.period'), later('field.periodValue', note.zeitraumVon, note.zeitraumBis));
  else if (note.zeitraumVon) add(later('notes.field.from'), note.zeitraumVon);
  else if (note.zeitraumBis) add(later('notes.field.until'), note.zeitraumBis);
  add(
    later('notes.field.reference'),
    note.ort
      ? () => `${t('notes.roadworks', note.baustelleId)} · ${note.ort}`
      : later('notes.roadworks', note.baustelleId),
  );
  // ⚠️ "gemeldet", nicht "geprüft". Der Name kommt aus der Fabric-Sitzung im Browser und wird vom
  // Client geschickt; die Anwendung kann ihn nicht unabhängig nachweisen.
  add(later('notes.field.author'), note.autorGemeldet ?? later('notes.authorUnknown'));
  add(
    later('notes.field.channel'),
    note.quelleKanal === 'agent-entwurf' ? later('notes.channel.agent') : later('notes.channel.form'),
  );
  if (note.erstelltAm) {
    const at = new Date(note.erstelltAm);
    const raw = note.erstelltAm;
    add(later('notes.field.created'), Number.isNaN(at.valueOf()) ? raw : () => at.toLocaleString(locale()));
  }

  return {
    layerId: 'koordination',
    title: note.ort || later('notes.roadworks', note.baustelleId),
    subtitle: later('notes.subtitle'),
    accent: colour,
    fields,
    source: later('notes.source'),
  };
}

export interface KoordinationOptions {
  placement: WorldPlacement;
  onStatus: StatusReporter;
  /** Called when a refresh replaces the markers while one of them was selected. */
  onSelectionStale?: () => void;
}

export interface KoordinationLayer extends LiveLayer {
  /** Re-read the notes now, e.g. straight after one has been saved. */
  refresh(): Promise<void>;
}

export async function createKoordinationLayer(
  options: KoordinationOptions,
): Promise<KoordinationLayer> {
  const { placement, onStatus } = options;

  const group = new THREE.Group();
  group.name = 'koordination';
  group.visible = false;
  placement.group.add(group);

  const abort = new AbortController();
  const owned: (THREE.BufferGeometry | THREE.Material)[] = [];
  let visible = false;
  let pending: Promise<void> | null = null;

  // A cone reads as a pin from above without pretending to be an object in the world.
  const geometry = new THREE.ConeGeometry(MARKER_RADIUS_M, MARKER_HEIGHT_M, 12);
  owned.push(geometry);

  const materials = new Map<number, THREE.MeshBasicMaterial>();
  const materialFor = (colour: number) => {
    let material = materials.get(colour);
    if (!material) {
      material = new THREE.MeshBasicMaterial({
        color: colour, transparent: true, opacity: 0.88, depthWrite: false,
      });
      materials.set(colour, material);
      owned.push(material);
    }
    return material;
  };

  const highlight = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false,
  });
  owned.push(highlight);
  let highlighted: THREE.Mesh | null = null;
  let selectedDetail: PickDetail | null = null;

  const clearMarkers = () => {
    for (const child of [...group.children]) group.remove(child);
    highlighted = null;
    if (selectedDetail) {
      selectedDetail = null;
      options.onSelectionStale?.();
    }
  };

  const draw = (notes: Note[]) => {
    clearMarkers();
    let drawn = 0;
    let withoutPlace = 0;
    const [minX, minZ, maxX, maxZ] = placement.worldBoundsM;

    for (const note of notes) {
      if (note.easting === null || note.northing === null) { withoutPlace++; continue; }
      const ground = placement.toWorldUtm(note.easting, note.northing);
      if (ground.x < minX || ground.x > maxX || ground.z < minZ || ground.z > maxZ) {
        withoutPlace++;
        continue;
      }
      const colour = COLOUR[note.kategorie] ?? FALLBACK_COLOUR;
      const mesh = new THREE.Mesh(geometry, materialFor(colour));
      // The cone's origin is its centre, so it is lifted by half its height to stand on the map.
      mesh.position.set(ground.x, ground.y + DRAPE_OFFSET_M + MARKER_HEIGHT_M / 2, ground.z);
      mesh.renderOrder = 3;
      mesh.userData.pick = detailFor(note, colour);
      mesh.userData.baseColour = colour;
      group.add(mesh);
      drawn++;
    }
    placement.invalidate();
    return { drawn, withoutPlace };
  };

  const load = async () => {
    if (pending) return pending;    pending = (async () => {
      try {
        const payload = await listNotes(abort.signal);
        if (abort.signal.aborted) return;
        if (!payload.verfuegbar) {
          clearMarkers();
          if (visible) {
            onStatus({
              state: 'error',
              text: later('notes.unavailable'),
              fetchedAt: null, count: 0,
            });
          }
          return;
        }
        const { drawn, withoutPlace } = draw(payload.eintraege ?? []);
        const at = new Date();
        const text = () => {
          const parts = drawn === 0 && withoutPlace === 0
            ? [t('notes.none')]
            : [t('notes.count', drawn)];
          if (withoutPlace > 0) parts.push(t('notes.withoutPlace', withoutPlace));
          parts.push(t('status.notOfficial'));
          return parts.join(' · ');
        };
        if (visible) {
          onStatus({ state: 'live', text, fetchedAt: at, count: drawn });
        }
      } catch (error) {
        if (abort.signal.aborted) return;
        clearMarkers();
        if (visible) {
          onStatus({
            state: 'error',
            text: failure(later('notes.name'), error),
            fetchedAt: null, count: 0,
          });
        }
      } finally {
        pending = null;
      }
    })();
    return pending;
  };

  const applyHighlight = (detail: PickDetail | null) => {
    if (highlighted) {
      highlighted.material = materialFor(highlighted.userData.baseColour as number);
      highlighted = null;
    }
    selectedDetail = detail && detail.layerId === 'koordination' ? detail : null;
    if (!detail || detail.layerId !== 'koordination') return;
    for (const child of group.children) {
      if (!(child instanceof THREE.Mesh) || child.userData.pick !== detail) continue;
      child.material = highlight;
      highlighted = child;
      break;
    }
    placement.invalidate();
  };

  return {
    id: 'koordination',
    setVisible(next) {
      visible = next;
      group.visible = next;
      if (next) {
        onStatus({ state: 'loading', text: later('notes.loading'), fetchedAt: null, count: 0 });
        void load();
      } else {
        onStatus({ state: 'idle', text: later('layer.off'), fetchedAt: null, count: 0 });
      }
    },
    async refresh() {
      if (!visible) return;
      // ⚠️ WAITS OUT AN IN-FLIGHT LOAD RATHER THAN JOINING IT. `load()` coalesces onto a pending
      // request, and that request may have read the notes table BEFORE the save that triggered
      // this refresh committed — so joining it returns the old list and the just-saved note
      // appears to have vanished. There is no poll behind this layer to correct it later.
      if (pending) await pending.catch(() => {});
      await load();
    },
    onPicked(detail) { applyHighlight(detail); },
    dispose() {
      abort.abort();
      clearMarkers();
      for (const resource of owned) resource.dispose();
      owned.length = 0;
      materials.clear();
      placement.group.remove(group);
    },
  };
}
