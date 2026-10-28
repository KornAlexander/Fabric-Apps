// Variance palette per user. IBCS default: favourable green, unfavourable red.
// 'cvd' replaces green with blue for red-green colour-vision deficiency,
// 'teal' is the DatenWG Kitchen teal. Applied as data-palette on <html>; the
// colours themselves live in global.css so charts read them via var().

export type PaletteId = 'ibcs' | 'cvd' | 'teal';

export const PALETTES: { id: PaletteId; label: string; hint: string }[] = [
  { id: 'ibcs', label: 'IBCS Grün / Rot', hint: 'Standard: günstig grün, ungünstig rot' },
  { id: 'cvd', label: 'Blau / Rot', hint: 'Für Rot-Grün-Sehschwäche: günstig blau statt grün' },
  { id: 'teal', label: 'Kitchen-Teal / Rot', hint: 'DatenWG-Teal statt Grün' },
];

export const DEFAULT_PALETTE: PaletteId = 'ibcs';

export const isPalette = (v: unknown): v is PaletteId => PALETTES.some((p) => p.id === v);

export function applyPalette(id: PaletteId, root: HTMLElement = document.documentElement): void {
  root.setAttribute('data-palette', id);
}

export const paletteLabel = (id: PaletteId) => PALETTES.find((p) => p.id === id)?.label ?? id;
