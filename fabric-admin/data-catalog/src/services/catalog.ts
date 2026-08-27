/**
 * Catalog data client (Phase 3 + 4 read path).
 *
 * The catalog lives in `data_catalog_lh` and is exposed through the
 * "Data Catalog Model" Direct Lake semantic model. The app reads it by running
 * DAX `executeQueries` through the shared Fabric `fabric_proxy` UDF (reused from
 * pbi-fixer-app), authenticated with the signed-in user's Power BI token.
 *
 * `CatalogClient` is the interface the views depend on. Two implementations:
 *   - `DaxCatalogClient` — runs real DAX via an injected `runDax` transport.
 *   - `MockCatalogClient` — bundled sample rows for local dev + unit tests.
 */

export interface CatalogReport {
  reportId: string;
  reportName: string;
  workspaceName: string;
  folderPath: string;
  reportType: string;
  webUrl: string;
}

/** A KPI = a semantic-model object (measure / column / hierarchy) that is used
 *  in at least one report, with the number of distinct reports that use it. */
export interface CatalogKpi {
  tableName: string;
  objectName: string;
  objectType: string;
  reportCount: number;
}

/** A report that uses a given KPI. */
export interface CatalogUsageReport {
  reportId: string;
  reportName: string;
  workspaceName: string;
}

/** An object a given report consumes from its model. */
export interface CatalogReportObject {
  tableName: string;
  objectName: string;
  objectType: string;
}

export interface KpiKey {
  tableName: string;
  objectName: string;
  objectType: string;
}

/** An item (report or model) placed in the workspace/folder tree (Topic view). */
export interface CatalogTreeItem {
  workspaceName: string;
  folderPath: string;
  itemId: string;
  itemName: string;
  itemType: 'Report' | 'Model';
  webUrl: string;
}

/** A global-search hit across report/model/measure/column names and DAX text. */
export interface CatalogSearchHit {
  kind: 'Report' | 'Model' | 'Measure' | 'Column';
  name: string;
  context: string;
  /** 'Name' when the term matched an object name, 'DAX' when it matched a
   *  measure's expression. */
  matchedIn: 'Name' | 'DAX';
}

/** A node in the lineage graph — a model object (measure or column). Reports
 *  are represented separately as {@link CatalogUsageReport}. */
export interface LineageNode {
  type: 'Measure' | 'Column';
  datasetName: string;
  tableName: string;
  name: string;
}

/** The immediate neighbours of a focus node in the lineage graph. */
export interface LineageNeighbors {
  /** Downstream: model objects the focus measure references. */
  dependsOn: LineageNode[];
  /** Upstream: measures that reference the focus object. */
  usedByMeasures: LineageNode[];
  /** Upstream: reports that consume the focus object. */
  usedByReports: CatalogUsageReport[];
}

export interface CatalogClient {
  listReports(): Promise<CatalogReport[]>;
  listKpis(): Promise<CatalogKpi[]>;
  listReportsForKpi(kpi: KpiKey): Promise<CatalogUsageReport[]>;
  listReportObjects(reportId: string): Promise<CatalogReportObject[]>;
  listTopicItems(): Promise<CatalogTreeItem[]>;
  search(term: string): Promise<CatalogSearchHit[]>;
  listLineageMeasures(): Promise<LineageNode[]>;
  getLineage(focus: LineageNode): Promise<LineageNeighbors>;
}

/** A transport that runs a DAX query against the catalog model and returns the
 *  first result table's rows as `{ "[col]": value }` maps (the shape the Power
 *  BI `executeQueries` REST endpoint returns). */
export type RunDax = (dax: string) => Promise<Record<string, unknown>[]>;

/** Name of the semantic model the app queries. */
export const CATALOG_MODEL = 'Data Catalog Model';

/** Escape a value for embedding as a DAX string literal (double the quotes). */
export function daxStr(s: string): string {
  return `"${String(s).replace(/"/g, '""')}"`;
}

/** DAX for the Report-list view. */
export const REPORTS_DAX = String.raw`
EVALUATE
SELECTCOLUMNS(
    'cat_reports',
    "reportId", 'cat_reports'[id],
    "reportName", 'cat_reports'[name],
    "workspaceName", 'cat_reports'[workspace_name],
    "folderPath", 'cat_reports'[folder_path],
    "reportType", 'cat_reports'[report_type],
    "webUrl", 'cat_reports'[web_url]
)
ORDER BY [workspaceName], [reportName]
`.trim();

/** DAX for the KPI reverse index: every used object + distinct report count. */
export const KPIS_DAX = String.raw`
EVALUATE
SUMMARIZECOLUMNS(
    'cat_report_object_usage'[table_name],
    'cat_report_object_usage'[object_name],
    'cat_report_object_usage'[object_type],
    "reportCount", DISTINCTCOUNT('cat_report_object_usage'[report_id])
)
ORDER BY [reportCount] DESC, [object_name] ASC
`.trim();

/** DAX: reports that use a specific KPI (the reverse lookup), one row per report. */
export function reportsForKpiDax(kpi: KpiKey): string {
  return String.raw`
EVALUATE
SELECTCOLUMNS(
    SUMMARIZE(
        FILTER(
            'cat_report_object_usage',
            'cat_report_object_usage'[object_name] = ${daxStr(kpi.objectName)}
                && 'cat_report_object_usage'[table_name] = ${daxStr(kpi.tableName)}
                && 'cat_report_object_usage'[object_type] = ${daxStr(kpi.objectType)}
        ),
        'cat_report_object_usage'[report_id],
        'cat_report_object_usage'[report_name],
        'cat_report_object_usage'[report_workspace_name]
    ),
    "reportId", 'cat_report_object_usage'[report_id],
    "reportName", 'cat_report_object_usage'[report_name],
    "workspaceName", 'cat_report_object_usage'[report_workspace_name]
)
ORDER BY [workspaceName], [reportName]
`.trim();
}

/** DAX: the distinct model objects a specific report consumes. */
export function reportObjectsDax(reportId: string): string {
  return String.raw`
EVALUATE
SELECTCOLUMNS(
    SUMMARIZE(
        FILTER('cat_report_object_usage', 'cat_report_object_usage'[report_id] = ${daxStr(reportId)}),
        'cat_report_object_usage'[table_name],
        'cat_report_object_usage'[object_name],
        'cat_report_object_usage'[object_type]
    ),
    "tableName", 'cat_report_object_usage'[table_name],
    "objectName", 'cat_report_object_usage'[object_name],
    "objectType", 'cat_report_object_usage'[object_type]
)
ORDER BY [objectType], [objectName]
`.trim();
}

/** DAX for the Topic view: reports + models unioned with their workspace/folder. */
export const TOPIC_DAX = String.raw`
EVALUATE
UNION(
    SELECTCOLUMNS(
        'cat_reports',
        "workspaceName", 'cat_reports'[workspace_name],
        "folderPath", 'cat_reports'[folder_path],
        "itemId", 'cat_reports'[id],
        "itemName", 'cat_reports'[name],
        "itemType", "Report",
        "webUrl", 'cat_reports'[web_url]
    ),
    SELECTCOLUMNS(
        'cat_models',
        "workspaceName", 'cat_models'[workspace_name],
        "folderPath", 'cat_models'[folder_path],
        "itemId", 'cat_models'[dataset_id],
        "itemName", 'cat_models'[dataset_name],
        "itemType", "Model",
        "webUrl", ""
    )
)
ORDER BY [workspaceName], [folderPath], [itemType], [itemName]
`.trim();

/** DAX for Global search across report/model/measure/column names AND measure
 *  DAX expressions. `CONTAINSSTRING` is case-insensitive. */
export function searchDax(term: string): string {
  const t = daxStr(term);
  return String.raw`
EVALUATE
TOPN(
    300,
    UNION(
        SELECTCOLUMNS(
            FILTER('cat_reports', CONTAINSSTRING('cat_reports'[name], ${t})),
            "kind", "Report", "name", 'cat_reports'[name],
            "context", 'cat_reports'[workspace_name], "matchedIn", "Name"
        ),
        SELECTCOLUMNS(
            FILTER('cat_models', CONTAINSSTRING('cat_models'[dataset_name], ${t})),
            "kind", "Model", "name", 'cat_models'[dataset_name],
            "context", 'cat_models'[workspace_name], "matchedIn", "Name"
        ),
        SELECTCOLUMNS(
            FILTER(
                'cat_measures',
                CONTAINSSTRING('cat_measures'[measure_name], ${t})
                    || CONTAINSSTRING('cat_measures'[measure_expression], ${t})
            ),
            "kind", "Measure", "name", 'cat_measures'[measure_name],
            "context", 'cat_measures'[dataset_name] & " \u00b7 " & 'cat_measures'[table_name],
            "matchedIn", IF(CONTAINSSTRING('cat_measures'[measure_name], ${t}), "Name", "DAX")
        ),
        SELECTCOLUMNS(
            FILTER('cat_columns', CONTAINSSTRING('cat_columns'[column_name], ${t})),
            "kind", "Column", "name", 'cat_columns'[column_name],
            "context", 'cat_columns'[dataset_name] & " \u00b7 " & 'cat_columns'[table_name],
            "matchedIn", "Name"
        )
    )
)
ORDER BY [kind], [name]
`.trim();
}

/** DAX: pickable measures for the lineage explorer (model + table + name). */
export const LINEAGE_MEASURES_DAX = String.raw`
EVALUATE
SELECTCOLUMNS(
    'cat_measures',
    "datasetName", 'cat_measures'[dataset_name],
    "tableName", 'cat_measures'[table_name],
    "name", 'cat_measures'[measure_name]
)
ORDER BY [datasetName], [name]
`.trim();

/** DAX: distinct objects a measure references (downstream), within its model. */
export function referencedObjectsDax(datasetName: string, measureName: string): string {
  return String.raw`
EVALUATE
SELECTCOLUMNS(
    SUMMARIZE(
        FILTER(
            'cat_measure_dependencies',
            'cat_measure_dependencies'[dataset_name] = ${daxStr(datasetName)}
                && 'cat_measure_dependencies'[object_name] = ${daxStr(measureName)}
                && 'cat_measure_dependencies'[object_type] = "Measure"
                && 'cat_measure_dependencies'[referenced_object_type] IN {"Measure", "Column"}
        ),
        'cat_measure_dependencies'[referenced_table],
        'cat_measure_dependencies'[referenced_object],
        'cat_measure_dependencies'[referenced_object_type]
    ),
    "tableName", 'cat_measure_dependencies'[referenced_table],
    "name", 'cat_measure_dependencies'[referenced_object],
    "objectType", 'cat_measure_dependencies'[referenced_object_type]
)
ORDER BY [objectType], [name]
`.trim();
}

/** DAX: distinct measures that reference a given object (upstream), within a model. */
export function referencingMeasuresDax(
  datasetName: string,
  objectName: string,
  objectType: string
): string {
  return String.raw`
EVALUATE
SELECTCOLUMNS(
    SUMMARIZE(
        FILTER(
            'cat_measure_dependencies',
            'cat_measure_dependencies'[dataset_name] = ${daxStr(datasetName)}
                && 'cat_measure_dependencies'[referenced_object] = ${daxStr(objectName)}
                && 'cat_measure_dependencies'[referenced_object_type] = ${daxStr(objectType)}
                && 'cat_measure_dependencies'[object_type] = "Measure"
        ),
        'cat_measure_dependencies'[table_name],
        'cat_measure_dependencies'[object_name]
    ),
    "tableName", 'cat_measure_dependencies'[table_name],
    "name", 'cat_measure_dependencies'[object_name]
)
ORDER BY [name]
`.trim();
}

/** Pull a value from an executeQueries row, tolerating the `Model[alias]`,
 *  `[alias]`, or bare `alias` key shapes the endpoint may return. */
function pick(row: Record<string, unknown>, alias: string): string {
  for (const k of Object.keys(row)) {
    if (k === alias || k.endsWith(`[${alias}]`)) {
      const v = row[k];
      return v == null ? '' : String(v);
    }
  }
  return '';
}

function pickNum(row: Record<string, unknown>, alias: string): number {
  const v = pick(row, alias);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function rowsToReports(rows: Record<string, unknown>[]): CatalogReport[] {
  return rows.map((r) => ({
    reportId: pick(r, 'reportId'),
    reportName: pick(r, 'reportName'),
    workspaceName: pick(r, 'workspaceName'),
    folderPath: pick(r, 'folderPath'),
    reportType: pick(r, 'reportType'),
    webUrl: pick(r, 'webUrl'),
  }));
}

export function rowsToKpis(rows: Record<string, unknown>[]): CatalogKpi[] {
  return rows.map((r) => ({
    tableName: pick(r, 'table_name') || pick(r, 'tableName'),
    objectName: pick(r, 'object_name') || pick(r, 'objectName'),
    objectType: pick(r, 'object_type') || pick(r, 'objectType'),
    reportCount: pickNum(r, 'reportCount'),
  }));
}

export function rowsToUsageReports(rows: Record<string, unknown>[]): CatalogUsageReport[] {
  return rows.map((r) => ({
    reportId: pick(r, 'reportId'),
    reportName: pick(r, 'reportName'),
    workspaceName: pick(r, 'workspaceName'),
  }));
}

export function rowsToReportObjects(rows: Record<string, unknown>[]): CatalogReportObject[] {
  return rows.map((r) => ({
    tableName: pick(r, 'tableName'),
    objectName: pick(r, 'objectName'),
    objectType: pick(r, 'objectType'),
  }));
}

export function rowsToTreeItems(rows: Record<string, unknown>[]): CatalogTreeItem[] {
  return rows.map((r) => ({
    workspaceName: pick(r, 'workspaceName'),
    folderPath: pick(r, 'folderPath'),
    itemId: pick(r, 'itemId'),
    itemName: pick(r, 'itemName'),
    itemType: (pick(r, 'itemType') as 'Report' | 'Model') || 'Report',
    webUrl: pick(r, 'webUrl'),
  }));
}

export function rowsToSearchHits(rows: Record<string, unknown>[]): CatalogSearchHit[] {
  return rows.map((r) => ({
    kind: (pick(r, 'kind') as CatalogSearchHit['kind']) || 'Report',
    name: pick(r, 'name'),
    context: pick(r, 'context'),
    matchedIn: (pick(r, 'matchedIn') as 'Name' | 'DAX') || 'Name',
  }));
}

export function rowsToLineageMeasures(rows: Record<string, unknown>[]): LineageNode[] {
  return rows.map((r) => ({
    type: 'Measure' as const,
    datasetName: pick(r, 'datasetName'),
    tableName: pick(r, 'tableName'),
    name: pick(r, 'name'),
  }));
}

function rowsToLineageNodes(
  rows: Record<string, unknown>[],
  datasetName: string,
  defaultType: 'Measure' | 'Column'
): LineageNode[] {
  return rows.map((r) => {
    const t = pick(r, 'objectType');
    return {
      type: t === 'Column' ? 'Column' : t === 'Measure' ? 'Measure' : defaultType,
      datasetName,
      tableName: pick(r, 'tableName'),
      name: pick(r, 'name'),
    };
  });
}

export class DaxCatalogClient implements CatalogClient {
  constructor(private readonly runDax: RunDax) {}

  async listReports(): Promise<CatalogReport[]> {
    return rowsToReports(await this.runDax(REPORTS_DAX));
  }
  async listKpis(): Promise<CatalogKpi[]> {
    return rowsToKpis(await this.runDax(KPIS_DAX));
  }
  async listReportsForKpi(kpi: KpiKey): Promise<CatalogUsageReport[]> {
    return rowsToUsageReports(await this.runDax(reportsForKpiDax(kpi)));
  }
  async listReportObjects(reportId: string): Promise<CatalogReportObject[]> {
    return rowsToReportObjects(await this.runDax(reportObjectsDax(reportId)));
  }
  async listTopicItems(): Promise<CatalogTreeItem[]> {
    return rowsToTreeItems(await this.runDax(TOPIC_DAX));
  }
  async search(term: string): Promise<CatalogSearchHit[]> {
    if (!term.trim()) return [];
    return rowsToSearchHits(await this.runDax(searchDax(term.trim())));
  }
  async listLineageMeasures(): Promise<LineageNode[]> {
    return rowsToLineageMeasures(await this.runDax(LINEAGE_MEASURES_DAX));
  }
  async getLineage(focus: LineageNode): Promise<LineageNeighbors> {
    const [dependsOnRows, usedByMeasureRows, usedByReports] = await Promise.all([
      focus.type === 'Measure'
        ? this.runDax(referencedObjectsDax(focus.datasetName, focus.name))
        : Promise.resolve<Record<string, unknown>[]>([]),
      this.runDax(referencingMeasuresDax(focus.datasetName, focus.name, focus.type)),
      this.listReportsForKpi({
        tableName: focus.tableName,
        objectName: focus.name,
        objectType: focus.type,
      }),
    ]);
    return {
      dependsOn: rowsToLineageNodes(dependsOnRows, focus.datasetName, 'Measure'),
      usedByMeasures: rowsToLineageNodes(usedByMeasureRows, focus.datasetName, 'Measure'),
      usedByReports,
    };
  }
}

const SAMPLE_REPORTS: CatalogReport[] = [
  {
    reportId: '1',
    reportName: 'HochschulInsights',
    workspaceName: 'Hochschul-Insights',
    folderPath: '',
    reportType: 'PowerBIReport',
    webUrl: 'https://app.powerbi.com/r1',
  },
  {
    reportId: '2',
    reportName: 'Sales Overview',
    workspaceName: 'Demo',
    folderPath: 'Finance/Monthly',
    reportType: 'PowerBIReport',
    webUrl: 'https://app.powerbi.com/r2',
  },
];

const SAMPLE_USAGE: { key: KpiKey; report: CatalogUsageReport }[] = [
  {
    key: { tableName: 'Measure', objectName: 'Drittmitteleinnahmen EUR', objectType: 'Measure' },
    report: { reportId: '1', reportName: 'HochschulInsights', workspaceName: 'Hochschul-Insights' },
  },
  {
    key: { tableName: 'Measure', objectName: 'Ausgaben EUR', objectType: 'Measure' },
    report: { reportId: '1', reportName: 'HochschulInsights', workspaceName: 'Hochschul-Insights' },
  },
  {
    key: { tableName: 'Measure', objectName: 'Ausgaben EUR', objectType: 'Measure' },
    report: { reportId: '2', reportName: 'Sales Overview', workspaceName: 'Demo' },
  },
  {
    key: { tableName: 'Hochschulfinanzen', objectName: 'Jahr', objectType: 'Column' },
    report: { reportId: '1', reportName: 'HochschulInsights', workspaceName: 'Hochschul-Insights' },
  },
];

function sameKpi(a: KpiKey, b: KpiKey): boolean {
  return a.tableName === b.tableName && a.objectName === b.objectName && a.objectType === b.objectType;
}

export class MockCatalogClient implements CatalogClient {
  async listReports(): Promise<CatalogReport[]> {
    return SAMPLE_REPORTS;
  }
  async listKpis(): Promise<CatalogKpi[]> {
    const map = new Map<string, CatalogKpi>();
    for (const u of SAMPLE_USAGE) {
      const id = `${u.key.tableName}|${u.key.objectName}|${u.key.objectType}`;
      const existing = map.get(id);
      if (existing) existing.reportCount += 1;
      else map.set(id, { ...u.key, reportCount: 1 });
    }
    return [...map.values()].sort((a, b) => b.reportCount - a.reportCount);
  }
  async listReportsForKpi(kpi: KpiKey): Promise<CatalogUsageReport[]> {
    return SAMPLE_USAGE.filter((u) => sameKpi(u.key, kpi)).map((u) => u.report);
  }
  async listReportObjects(reportId: string): Promise<CatalogReportObject[]> {
    return SAMPLE_USAGE.filter((u) => u.report.reportId === reportId).map((u) => ({
      tableName: u.key.tableName,
      objectName: u.key.objectName,
      objectType: u.key.objectType,
    }));
  }
  async listTopicItems(): Promise<CatalogTreeItem[]> {
    return SAMPLE_REPORTS.map((r) => ({
      workspaceName: r.workspaceName,
      folderPath: r.folderPath,
      itemId: r.reportId,
      itemName: r.reportName,
      itemType: 'Report' as const,
      webUrl: r.webUrl,
    }));
  }
  async search(term: string): Promise<CatalogSearchHit[]> {
    const q = term.trim().toLowerCase();
    if (!q) return [];
    const hits: CatalogSearchHit[] = [];
    for (const r of SAMPLE_REPORTS) {
      if (r.reportName.toLowerCase().includes(q))
        hits.push({ kind: 'Report', name: r.reportName, context: r.workspaceName, matchedIn: 'Name' });
    }
    for (const u of SAMPLE_USAGE) {
      if (u.key.objectName.toLowerCase().includes(q))
        hits.push({
          kind: u.key.objectType === 'Column' ? 'Column' : 'Measure',
          name: u.key.objectName,
          context: u.key.tableName,
          matchedIn: 'Name',
        });
    }
    return hits;
  }
  async listLineageMeasures(): Promise<LineageNode[]> {
    return SAMPLE_USAGE.filter((u) => u.key.objectType === 'Measure').map((u) => ({
      type: 'Measure' as const,
      datasetName: u.report.workspaceName,
      tableName: u.key.tableName,
      name: u.key.objectName,
    }));
  }
  async getLineage(focus: LineageNode): Promise<LineageNeighbors> {
    return {
      dependsOn:
        focus.name === 'Ausgaben EUR'
          ? [{ type: 'Column', datasetName: focus.datasetName, tableName: 'Hochschulfinanzen', name: 'Betrag' }]
          : [],
      usedByMeasures: [],
      usedByReports: await this.listReportsForKpi({
        tableName: focus.tableName,
        objectName: focus.name,
        objectType: focus.type,
      }),
    };
  }
}
