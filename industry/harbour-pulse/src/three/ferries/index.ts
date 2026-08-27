import { FERRY_SPEC as Borrowdale } from './Borrowdale';
import { FERRY_SPEC as EsmeTimbery } from './Esme_Timbery';
import { FERRY_SPEC as Fishburn } from './Fishburn';
import { FERRY_SPEC as FrancesBodkin } from './Frances_Bodkin';
import { FERRY_SPEC as Friendship } from './Friendship';
import { FERRY_SPEC as GoldenGrove } from './Golden_Grove';
import { FERRY_SPEC as JackMundey } from './Jack_Mundey';
import { FERRY_SPEC as JohnNutt } from './John_Nutt';
import { FERRY_SPEC as LaurenJackson } from './Lauren_Jackson';
import { FERRY_SPEC as MargaretOlley } from './Margaret_Olley';
import { FERRY_SPEC as MartinGreen } from './Martin_Green';
import { FERRY_SPEC as MayGibbs } from './May_Gibbs';
import { FERRY_SPEC as MeMel } from './Me-mel';
import { FERRY_SPEC as NormanSelfe } from './Norman_Selfe';
import { FERRY_SPEC as Queenscliff } from './Queenscliff';
import { FERRY_SPEC as RubyLangford } from './Ruby_Langford';
import { FERRY_SPEC as RuthPark } from './Ruth_Park';
import { FERRY_SPEC as Sirius } from './Sirius';
import { DEFAULT_FERRY_SPEC } from './types';
import type { FerryModelSpec } from './types';
import { FERRY_SPEC as VictorChang } from './Victor_Chang';

export type { FerryModelSpec } from './types';
export { DEFAULT_FERRY_SPEC } from './types';

/** Every researched real Sydney ferry, keyed by its `ferry_name` business key. */
export const FERRY_SPECS: Record<string, FerryModelSpec> = {
  [Borrowdale.name]: Borrowdale,
  [EsmeTimbery.name]: EsmeTimbery,
  [Fishburn.name]: Fishburn,
  [FrancesBodkin.name]: FrancesBodkin,
  [Friendship.name]: Friendship,
  [GoldenGrove.name]: GoldenGrove,
  [JackMundey.name]: JackMundey,
  [JohnNutt.name]: JohnNutt,
  [LaurenJackson.name]: LaurenJackson,
  [MargaretOlley.name]: MargaretOlley,
  [MartinGreen.name]: MartinGreen,
  [MayGibbs.name]: MayGibbs,
  [MeMel.name]: MeMel,
  [NormanSelfe.name]: NormanSelfe,
  [Queenscliff.name]: Queenscliff,
  [RubyLangford.name]: RubyLangford,
  [RuthPark.name]: RuthPark,
  [Sirius.name]: Sirius,
  [VictorChang.name]: VictorChang,
};

/** File stem used for the researched photo of each real ferry under `/ferries/`. */
const PHOTO_FILE: Record<string, string> = {
  [Borrowdale.name]: 'Borrowdale',
  [EsmeTimbery.name]: 'Esme_Timbery',
  [Fishburn.name]: 'Fishburn',
  [FrancesBodkin.name]: 'Frances_Bodkin',
  [Friendship.name]: 'Friendship',
  [GoldenGrove.name]: 'Golden_Grove',
  [JackMundey.name]: 'Jack_Mundey',
  [JohnNutt.name]: 'John_Nutt',
  [LaurenJackson.name]: 'Lauren_Jackson',
  [MargaretOlley.name]: 'Margaret_Olley',
  [MartinGreen.name]: 'Martin_Green',
  [MayGibbs.name]: 'May_Gibbs',
  [MeMel.name]: 'Me-mel',
  [NormanSelfe.name]: 'Norman_Selfe',
  [Queenscliff.name]: 'Queenscliff',
  [RubyLangford.name]: 'Ruby_Langford',
  [RuthPark.name]: 'Ruth_Park',
  [Sirius.name]: 'Sirius',
  [VictorChang.name]: 'Victor_Chang',
};

/** Voxel model spec for a ferry by name, falling back to a generic look. */
export function getFerrySpec(vesselName: string): FerryModelSpec {
  return FERRY_SPECS[vesselName] ?? { ...DEFAULT_FERRY_SPEC, name: vesselName };
}

/** URL of the real reference photo for a ferry, if one has been researched. */
export function ferryPhotoUrl(vesselName: string): string | null {
  const file = PHOTO_FILE[vesselName];
  return file ? `/ferries/${file}.jpg` : null;
}
