import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DaxValidationError,
  MAX_TOP_N,
  allColumns,
  buildCount,
  buildSelect,
  daxString,
  daxValue,
  mapRows,
} from '@/domain/dax';
import { GOV_TABLES, columnsOf, isGovTable, tablesForModule } from '@/domain/govSchema';
import { MODULE_IDS } from '@/modules';

const ROOT = resolve(import.meta.dirname, '../..');

describe('governance schema catalogue', () => {
  it('assigns every table to a real module or core', () => {
    for (const [name, def] of Object.entries(GOV_TABLES)) {
      const owners: string[] = [...MODULE_IDS, 'core'];
      expect(owners, name).toContain(def.module);
    }
  });

  it('adds provenance columns to actual-state tables but not to the core ledgers', () => {
    expect(columnsOf('gov_actual_workspaces')).toContain('run_id');
    expect(columnsOf('gov_actual_workspaces')).toContain('scanned_at');
    // Core ledgers carry their own timestamps and are not a collector product.
    expect(columnsOf('gov_runs')).not.toContain('scanned_at');
    expect(columnsOf('gov_audit')).not.toContain('run_id');
    expect(columnsOf('gov_dry_runs')).not.toContain('scanned_at');
  });

  it('groups tables by owning module', () => {
    expect(tablesForModule('agent')).toEqual([
      'gov_actual_agents',
      'gov_actual_agent_blueprints',
    ]);
    expect(tablesForModule('core')).toEqual(['gov_runs', 'gov_audit', 'gov_dry_runs']);
  });

  it('rejects unknown table names', () => {
    expect(isGovTable('gov_actual_workspaces')).toBe(true);
    expect(isGovTable('users; DROP TABLE')).toBe(false);
  });

  /**
   * The TypeScript catalogue and the Python bootstrap are two descriptions of
   * one schema. If they drift, the app queries columns the collectors never
   * wrote — and the failure looks like "the collector is broken".
   */
  it('matches the tables the bootstrap notebook creates', () => {
    const source = readFileSync(join(ROOT, 'bootstrap', 'gov_bootstrap.py'), 'utf8');
    const declared = new Set(
      [...source.matchAll(/"(gov_actual_[a-z_]+)"/g)].map((m) => m[1])
    );
    const inSchema = Object.keys(GOV_TABLES).filter((t) => t.startsWith('gov_actual_'));

    for (const table of inSchema) {
      expect(declared.has(table), `${table} missing from gov_bootstrap.py`).toBe(true);
    }
    for (const table of declared) {
      expect(inSchema, `${table} missing from govSchema.ts`).toContain(table);
    }
  });

  it('matches the columns the bootstrap notebook creates', () => {
    const source = readFileSync(join(ROOT, 'bootstrap', 'gov_bootstrap.py'), 'utf8');
    for (const table of Object.keys(GOV_TABLES)) {
      if (!table.startsWith('gov_actual_')) continue;
      // Grab the `actual(...)` argument list that follows the table name.
      const block = source.slice(source.indexOf(`"${table}"`));
      const args = block.slice(block.indexOf('actual('), block.indexOf('),\n        ),'));
      const declared = [...args.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
      for (const column of GOV_TABLES[table as keyof typeof GOV_TABLES].columns) {
        expect(declared, `${table}.${column} missing from gov_bootstrap.py`).toContain(
          column
        );
      }
    }
  });

  it('is included in the semantic model notebook', () => {
    const source = readFileSync(join(ROOT, 'bootstrap', 'gov_create_model.py'), 'utf8');
    for (const table of Object.keys(GOV_TABLES)) {
      expect(source, `${table} missing from gov_create_model.py`).toContain(`"${table}"`);
    }
  });
});

describe('DAX construction', () => {
  it('builds a validated projection', () => {
    const dax = buildSelect({
      table: 'gov_actual_workspaces',
      columns: ['workspace_id', 'workspace_name'],
    });
    expect(dax).toContain("EVALUATE SELECTCOLUMNS('gov_actual_workspaces'");
    expect(dax).toContain(`"workspace_id", 'gov_actual_workspaces'[workspace_id]`);
  });

  describe('refuses to build what it cannot vouch for', () => {
    it('rejects an unknown table', () => {
      expect(() =>
        buildSelect({ table: 'gov_secrets', columns: ['x'] })
      ).toThrow(DaxValidationError);
    });

    it('rejects an unknown column', () => {
      expect(() =>
        buildSelect({ table: 'gov_actual_workspaces', columns: ['password'] })
      ).toThrow(DaxValidationError);
    });

    it('rejects an injected identifier rather than escaping it', () => {
      // The point of an allow-list: this never becomes a quoting question.
      expect(() =>
        buildSelect({
          table: 'gov_actual_workspaces',
          columns: ["workspace_id'] ) EVALUATE ROW(\"x\",1) --"],
        })
      ).toThrow(DaxValidationError);
    });

    it('rejects an injected filter column', () => {
      expect(() =>
        buildSelect({
          table: 'gov_actual_workspaces',
          columns: ['workspace_id'],
          filters: [{ column: 'nope', operator: '=', value: 'x' }],
        })
      ).toThrow(DaxValidationError);
    });

    it('requires at least one column', () => {
      expect(() =>
        buildSelect({ table: 'gov_actual_workspaces', columns: [] })
      ).toThrow(DaxValidationError);
    });

    it('bounds topN', () => {
      const base = { table: 'gov_actual_workspaces', columns: ['workspace_id'] };
      expect(() => buildSelect({ ...base, topN: 0 })).toThrow(DaxValidationError);
      expect(() => buildSelect({ ...base, topN: 1.5 })).toThrow(DaxValidationError);
      expect(() => buildSelect({ ...base, topN: MAX_TOP_N + 1 })).toThrow(
        DaxValidationError
      );
    });
  });

  it('escapes quotes in filter values instead of trusting them', () => {
    const dax = buildSelect({
      table: 'gov_actual_workspaces',
      columns: ['workspace_id'],
      filters: [{ column: 'workspace_name', operator: '=', value: 'He said "hi"' }],
    });
    expect(dax).toContain('"He said ""hi"""');
    expect(daxString('a"b')).toBe('"a""b"');
  });

  it('applies filters, ordering and topN together in a valid order', () => {
    const dax = buildSelect({
      table: 'gov_actual_agents',
      columns: ['agent_id', 'name'],
      filters: [{ column: 'is_shadow', operator: '=', value: 'true' }],
      orderBy: 'name',
      topN: 50,
    });
    expect(dax).toContain('FILTER(');
    expect(dax).toContain('TOPN(50,');
    // ORDER BY has to sit outside TOPN, not inside it.
    expect(dax.indexOf('TOPN(')).toBeLessThan(dax.indexOf('ORDER BY'));
    expect(dax.trimEnd().endsWith('ORDER BY [name] ASC')).toBe(true);
  });

  it('builds a count query', () => {
    expect(buildCount('gov_runs')).toBe(
      `EVALUATE ROW("count", COUNTROWS('gov_runs'))`
    );
    expect(() => buildCount('nope')).toThrow(DaxValidationError);
  });

  it('exposes every catalogue column', () => {
    expect(allColumns('gov_actual_agents')).toContain('is_ownerless');
    expect(allColumns('gov_actual_agents')).toContain('run_id');
  });
});

describe('row mapping', () => {
  it('reads both bare and table-qualified aliases', () => {
    expect(daxValue({ name: 'A' }, 'name')).toBe('A');
    expect(daxValue({ "'gov_actual_agents'[name]": 'B' }, 'name')).toBe('B');
  });

  it('turns a missing or null value into an empty string, never "null"', () => {
    expect(daxValue({}, 'name')).toBe('');
    expect(daxValue({ name: null }, 'name')).toBe('');
  });

  it('maps rows onto exactly the requested columns', () => {
    const mapped = mapRows(
      [{ "'t'[a]": 1, "'t'[b]": 'x', noise: 'drop me' }],
      ['a', 'b']
    );
    expect(mapped).toEqual([{ a: '1', b: 'x' }]);
  });
});
