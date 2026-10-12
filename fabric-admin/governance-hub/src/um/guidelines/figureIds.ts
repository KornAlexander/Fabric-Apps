/** The drawings of the guide. Kept apart so the content stays free of components. */
export const FIGURE_IDS = [
  'storage-modes',
  'logic-upstream',
  'cardinality',
  'schema-shapes',
  'shared-dimensions',
  'filter-direction',
  'dax-divide',
  'dax-var',
  'dax-switch',
  'measure-folders',
  'hidden-keys',
  'name-pairs',
  'measure-anatomy',
  'title-concept',
  'filter-pane',
  'canvas-share',
  'three-layers',
  'deviation-table',
  'page-density',
  'orientation',
  'time-deviations',
  'scenarios',
  'density',
  'kpi-card',
  'deviation-colors',
  'format-cards',
] as const;

export type FigureId = (typeof FIGURE_IDS)[number];

/**
 * Where each drawing is shown: with a topic (`2.5`) or right under one of its
 * rules (`2.5/7`, the seventh rule of the topic). One list for both languages,
 * so a drawing cannot sit in different places in German and English.
 */
export const FIGURE_PLACES: Record<string, FigureId[]> = {
  '1.1': ['storage-modes'],
  '1.4/1': ['logic-upstream'],
  '1.4/2': ['cardinality'],
  '2.1/7': ['schema-shapes', 'shared-dimensions'],
  '2.1/8': ['filter-direction'],
  '2.2/1': ['dax-divide'],
  '2.2/2': ['dax-var'],
  '2.2/3': ['dax-switch'],
  '2.3/1': ['measure-folders'],
  '2.4/1': ['hidden-keys'],
  '2.5/7': ['measure-anatomy'],
  '3.1/2': ['title-concept'],
  '3.1/3': ['filter-pane', 'canvas-share'],
  '3.1/5': ['three-layers', 'deviation-table'],
  '3.1/8': ['page-density'],
  '3.2/1': ['orientation'],
  '3.2/2': ['time-deviations'],
  '3.2/3': ['scenarios'],
  '3.2/4': ['density'],
  '3.2/5': ['kpi-card'],
  '3.2/6': ['deviation-colors'],
  // With the style guide's own rules, which an organization's answers do not change.
  '5.1': ['name-pairs'],
  '5.5/1': ['format-cards'],
};
