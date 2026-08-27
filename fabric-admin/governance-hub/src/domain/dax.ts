/**
 * DAX query construction for the Governance Model (PLAN.md §19).
 *
 * **Security posture.** Every identifier is validated against the schema
 * catalogue and every literal is escaped, so a query cannot be built from
 * unvalidated input at all. This is construction-time safety, not
 * escaping-as-an-afterthought: `buildSelect` throws rather than emitting a
 * query it cannot vouch for (OWASP A03).
 *
 * Pure — no network. The service layer executes what this produces.
 */
import {
  columnsOf,
  hasColumn,
  isGovTable,
  type GovTableName,
} from './govSchema';

export class DaxValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DaxValidationError';
  }
}

/** DAX escapes a double quote by doubling it. */
export function daxString(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export interface DaxFilter {
  column: string;
  /** Only equality and non-equality — enough for every read this app makes. */
  operator: '=' | '<>';
  value: string;
}

export interface SelectOptions {
  table: string;
  columns: string[];
  filters?: DaxFilter[];
  orderBy?: string;
  orderDesc?: boolean;
  topN?: number;
}

/** Hard ceiling on a single read, so one query can never pull a whole tenant. */
export const MAX_TOP_N = 10000;

function assertTable(table: string): GovTableName {
  if (!isGovTable(table)) {
    throw new DaxValidationError(`unknown table: ${table}`);
  }
  return table;
}

function assertColumn(table: GovTableName, column: string): string {
  if (!hasColumn(table, column)) {
    throw new DaxValidationError(`unknown column: ${table}.${column}`);
  }
  return column;
}

/**
 * Build an `EVALUATE` over one governance table.
 *
 * Column aliases are the plain column names, so the caller can read a row by
 * the same name it asked for.
 */
export function buildSelect(options: SelectOptions): string {
  const table = assertTable(options.table);

  if (options.columns.length === 0) {
    throw new DaxValidationError('at least one column is required');
  }
  const columns = options.columns.map((c) => assertColumn(table, c));

  const projection = columns
    .map((c) => `${daxString(c)}, '${table}'[${c}]`)
    .join(', ');

  let expression = `SELECTCOLUMNS('${table}', ${projection})`;

  const filters = options.filters ?? [];
  if (filters.length > 0) {
    const predicates = filters
      .map((f) => {
        const column = assertColumn(table, f.column);
        if (f.operator !== '=' && f.operator !== '<>') {
          throw new DaxValidationError(`unsupported operator: ${f.operator}`);
        }
        return `'${table}'[${column}] ${f.operator} ${daxString(f.value)}`;
      })
      .join(', ');
    expression = `SELECTCOLUMNS(FILTER('${table}', ${predicates}), ${projection})`;
  }

  if (options.orderBy) {
    const orderColumn = assertColumn(table, options.orderBy);
    expression = `${expression} ORDER BY [${orderColumn}] ${options.orderDesc ? 'DESC' : 'ASC'}`;
  }

  if (options.topN !== undefined) {
    if (!Number.isInteger(options.topN) || options.topN <= 0) {
      throw new DaxValidationError(`topN must be a positive integer: ${options.topN}`);
    }
    if (options.topN > MAX_TOP_N) {
      throw new DaxValidationError(`topN exceeds ${MAX_TOP_N}`);
    }
    // TOPN must wrap the table expression, before ORDER BY is applied.
    const base = options.orderBy
      ? expression.slice(0, expression.lastIndexOf(' ORDER BY'))
      : expression;
    const tail = options.orderBy ? expression.slice(expression.lastIndexOf(' ORDER BY')) : '';
    expression = `TOPN(${options.topN}, ${base})${tail}`;
  }

  return `EVALUATE ${expression}`;
}

/** `COUNTROWS` for a table, used by the summary cards. */
export function buildCount(table: string): string {
  const name = assertTable(table);
  return `EVALUATE ROW("count", COUNTROWS('${name}'))`;
}

/**
 * Read a value out of an `executeQueries` row.
 *
 * Power BI returns columns as either the bare alias or `'Table'[alias]`
 * depending on the query shape, so both are accepted.
 */
export function daxValue(row: Record<string, unknown>, alias: string): string {
  for (const key of Object.keys(row)) {
    if (key === alias || key.endsWith(`[${alias}]`)) {
      const value = row[key];
      return value == null ? '' : String(value);
    }
  }
  return '';
}

/** Map raw rows onto the requested columns, dropping model-shaped key noise. */
export function mapRows(
  rows: Record<string, unknown>[],
  columns: string[]
): Record<string, string>[] {
  return rows.map((row) => {
    const mapped: Record<string, string> = {};
    for (const column of columns) mapped[column] = daxValue(row, column);
    return mapped;
  });
}

/** Convenience: every column of a table, in catalogue order. */
export function allColumns(table: string): string[] {
  return [...columnsOf(assertTable(table))];
}
