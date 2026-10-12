/**
 * Reading rows through the Rayfin data client, the way it actually behaves.
 *
 * Two things about that client are easy to get wrong, and both only show
 * against the real database (found live on 2026-10-12, see
 * docs/FABRIC-USER-MANAGER-PLAN.md section 24):
 *
 * 1. `findMany`, `findFirst` and `findById` return nothing but the `id` of a
 *    row unless the fields are named with `select`. A read that maps
 *    `row.some_field` after a plain `findMany` gets `undefined` for every
 *    field, without any error.
 * 2. On the way out the client converts stored texts: "true" and "false"
 *    become booleans, and texts shaped like an ISO date become `Date`
 *    objects, in whatever column they stand.
 *
 * `readRows` covers the first: every field is named, and the table is read to
 * its end instead of stopping at the first page. The two helpers below cover
 * the second for the columns where it matters.
 */

interface RowQuery {
  where(conditions: Record<string, unknown>): RowQuery;
  orderBy(order: Record<string, 'asc' | 'desc'>): RowQuery;
  first(count: number): RowQuery;
  after(cursor: string): RowQuery;
  executePaginated(): Promise<unknown>;
}

interface Page<R> {
  items: R[];
  hasNextPage?: boolean;
  endCursor?: string | null;
}

export const ROW_LIMITS = { pageSize: 100, pages: 200 } as const;

/**
 * Every row of one table, with the named fields. Throws when the table cannot
 * be read to its end: a list that silently stops after one page would look
 * complete.
 */
export async function readRows<R>(table: unknown, fields: readonly string[], where?: Record<string, unknown>): Promise<R[]> {
  const source = table as { select(names: readonly string[]): RowQuery };
  const all: R[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < ROW_LIMITS.pages; page++) {
    let query = source.select(fields).orderBy({ id: 'asc' }).first(ROW_LIMITS.pageSize);
    if (where) query = query.where(where);
    if (cursor) query = query.after(cursor);
    const result = (await query.executePaginated()) as Page<R>;
    all.push(...result.items);
    if (!result.hasNextPage) return all;
    if (!result.endCursor || seen.has(result.endCursor)) throw new Error('paging-failed');
    seen.add(result.endCursor);
    cursor = result.endCursor;
  }
  throw new Error('paging-limit');
}

/**
 * A column that holds JSON text, as JSON text again. A stored `true` or
 * `false` arrives as a boolean; everything else arrives as it was stored.
 */
export function jsonText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return JSON.stringify(value);
  return undefined;
}

/** A text column as text, whatever the client turned it into. */
export function plainText(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  return String(value);
}
