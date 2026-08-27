import { describe, expect, it } from 'vitest';

import {
  DaxCatalogClient,
  daxStr,
  MockCatalogClient,
  REPORTS_DAX,
  referencedObjectsDax,
  referencingMeasuresDax,
  reportsForKpiDax,
  rowsToKpis,
  rowsToLineageMeasures,
  rowsToReports,
  rowsToSearchHits,
  rowsToTreeItems,
  searchDax,
} from '@/services/catalog';

describe('catalog client', () => {
  it('maps executeQueries rows (with [alias] key shape) to reports', () => {
    const rows = [
      {
        '[reportId]': 'r1',
        '[reportName]': 'Sales',
        '[workspaceName]': 'Demo',
        '[folderPath]': 'Finance',
        '[reportType]': 'PowerBIReport',
        '[webUrl]': 'https://app.powerbi.com/r1',
      },
    ];
    const [rep] = rowsToReports(rows);
    expect(rep.reportName).toBe('Sales');
    expect(rep.folderPath).toBe('Finance');
  });

  it('tolerates bare-alias keys and null values', () => {
    const [rep] = rowsToReports([{ reportName: 'X', folderPath: null }]);
    expect(rep.reportName).toBe('X');
    expect(rep.folderPath).toBe('');
  });

  it('maps KPI rows including numeric reportCount', () => {
    const [k] = rowsToKpis([
      {
        'cat_report_object_usage[table_name]': 'Measure',
        'cat_report_object_usage[object_name]': 'Ausgaben EUR',
        'cat_report_object_usage[object_type]': 'Measure',
        '[reportCount]': '3',
      },
    ]);
    expect(k.objectName).toBe('Ausgaben EUR');
    expect(k.reportCount).toBe(3);
  });

  it('daxStr escapes embedded double quotes', () => {
    expect(daxStr('a "b" c')).toBe('"a ""b"" c"');
  });

  it('reportsForKpiDax injects escaped KPI values', () => {
    const dax = reportsForKpiDax({
      tableName: 'Measure',
      objectName: 'Rev "net"',
      objectType: 'Measure',
    });
    expect(dax).toContain('"Rev ""net"""');
    expect(dax).toContain('[object_type] = "Measure"');
  });

  it('DaxCatalogClient runs the reports DAX through the transport', async () => {
    let captured = '';
    const client = new DaxCatalogClient(async (dax) => {
      captured = dax;
      return [{ '[reportName]': 'A', '[workspaceName]': 'WS' }];
    });
    const reports = await client.listReports();
    expect(captured).toBe(REPORTS_DAX);
    expect(reports[0].reportName).toBe('A');
  });

  it('MockCatalogClient reverse index: KPI -> reports', async () => {
    const c = new MockCatalogClient();
    const kpis = await c.listKpis();
    const shared = kpis.find((k) => k.objectName === 'Ausgaben EUR');
    expect(shared?.reportCount).toBe(2);
    const reports = await c.listReportsForKpi({
      tableName: 'Measure',
      objectName: 'Ausgaben EUR',
      objectType: 'Measure',
    });
    expect(reports.map((r) => r.reportName).sort()).toEqual([
      'HochschulInsights',
      'Sales Overview',
    ]);
  });

  it('MockCatalogClient report detail lists that report objects', async () => {
    const objs = await new MockCatalogClient().listReportObjects('2');
    expect(objs.every((o) => o.objectName)).toBe(true);
  });

  it('searchDax searches measure names AND DAX expressions', () => {
    const dax = searchDax('SUMX');
    expect(dax).toContain("CONTAINSSTRING('cat_measures'[measure_name], \"SUMX\")");
    expect(dax).toContain("CONTAINSSTRING('cat_measures'[measure_expression], \"SUMX\")");
    // reports, models and columns are covered too
    expect(dax).toContain("'cat_reports'[name]");
    expect(dax).toContain("'cat_columns'[column_name]");
  });

  it('rowsToTreeItems maps union rows', () => {
    const [it] = rowsToTreeItems([
      {
        '[workspaceName]': 'Demo',
        '[folderPath]': 'Finance',
        '[itemId]': 'x',
        '[itemName]': 'Model A',
        '[itemType]': 'Model',
        '[webUrl]': '',
      },
    ]);
    expect(it.itemType).toBe('Model');
    expect(it.itemName).toBe('Model A');
  });

  it('rowsToSearchHits maps DAX matches', () => {
    const [h] = rowsToSearchHits([
      { '[kind]': 'Measure', '[name]': 'Rev', '[context]': 'M · Sales', '[matchedIn]': 'DAX' },
    ]);
    expect(h.kind).toBe('Measure');
    expect(h.matchedIn).toBe('DAX');
  });

  it('MockCatalogClient topic items + search', async () => {
    const c = new MockCatalogClient();
    const items = await c.listTopicItems();
    expect(items.length).toBeGreaterThan(0);
    const hits = await c.search('Ausgaben');
    expect(hits.some((h) => h.name === 'Ausgaben EUR')).toBe(true);
    expect(await c.search('')).toEqual([]);
  });

  it('lineage DAX filters downstream + upstream within a model', () => {
    const down = referencedObjectsDax('My Model', 'Ausgaben EUR');
    expect(down).toContain('[dataset_name] = "My Model"');
    expect(down).toContain('[object_name] = "Ausgaben EUR"');
    expect(down).toContain('[referenced_object_type] IN {"Measure", "Column"}');
    const up = referencingMeasuresDax('My Model', 'Betrag', 'Column');
    expect(up).toContain('[referenced_object] = "Betrag"');
    expect(up).toContain('[referenced_object_type] = "Column"');
  });

  it('rowsToLineageMeasures maps measure nodes', () => {
    const [n] = rowsToLineageMeasures([
      { '[datasetName]': 'M', '[tableName]': 'T', '[name]': 'Rev' },
    ]);
    expect(n.type).toBe('Measure');
    expect(n.name).toBe('Rev');
  });

  it('MockCatalogClient lineage: focus measure -> depends on + used-by reports', async () => {
    const c = new MockCatalogClient();
    const measures = await c.listLineageMeasures();
    expect(measures.length).toBeGreaterThan(0);
    const focus = measures.find((m) => m.name === 'Ausgaben EUR')!;
    const lin = await c.getLineage(focus);
    expect(lin.dependsOn.some((d) => d.type === 'Column')).toBe(true);
    expect(lin.usedByReports.length).toBeGreaterThan(0);
  });
});
