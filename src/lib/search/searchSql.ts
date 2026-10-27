import { or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { containsLikePattern } from '../sqlLike.js';
import {
  SEARCH_COMPACT_DROP, SEARCH_COMPACT_FOLD_FROM, SEARCH_COMPACT_FOLD_TO, SEARCH_FOLD_FROM, SEARCH_FOLD_TO, normalizeSearchText,
} from './searchText.js';

/**
 * v9.0.291 (TD-675) / v10.1.51 (OBS-R2-61): `normalizeSearchText` in SQL. A column or expression is lower-cased and its
 * Arabic «ي/ى/ك» and Persian and Arabic digits are folded with `translate()`, so it is compared with a search text that went
 * through `normalizeSearchText` (and `containsLikePattern` for LIKE). Shared by global search and the daily log list.
 */
export function foldedSearchSql(column: AnyColumn | SQL): SQL {
  return sql`translate(lower(coalesce(${column}, '')), ${SEARCH_FOLD_FROM}, ${SEARCH_FOLD_TO})`;
}

/** TD-1321: `compactSearchText` in SQL, compared with a search text that went through it (and `containsLikePattern`) */
export function compactFoldedSearchSql(column: AnyColumn | SQL): SQL {
  const folded = sql`translate(lower(coalesce(${column}, '')), ${SEARCH_FOLD_FROM + SEARCH_COMPACT_FOLD_FROM}, ${SEARCH_FOLD_TO + SEARCH_COMPACT_FOLD_TO})`;
  return sql`regexp_replace(${folded}, ${`[${SEARCH_COMPACT_DROP}]+`}, '', 'g')`;
}

/**
 * v11 phase 6.3p (U8): the one search condition of a server list or pick list. The search text goes through
 * `normalizeSearchText` and each column through `foldedSearchSql`, so a phone typed in Latin digits, an Arabic «ي» or «ك», or
 * a name without «آ» finds the row on every screen, as global search did; before, most lists compared the raw text with
 * ILIKE. Returns undefined for an empty search, so `and()` skips it.
 */
export function foldedContains(columns: ReadonlyArray<AnyColumn | SQL>, search: unknown): SQL | undefined {
  const pattern = foldedSearchPattern(search);
  if (!pattern) return undefined;
  return or(...columns.map(column => foldedLike(column, pattern)));
}

/** the LIKE pattern of a search text for `foldedLike`; undefined for an empty search */
export function foldedSearchPattern(search: unknown): string | undefined {
  const q = normalizeSearchText(search);
  return q ? containsLikePattern(q) : undefined;
}

/** one column against a `foldedSearchPattern`, for a condition `foldedContains` cannot build (inside EXISTS) */
export function foldedLike(column: AnyColumn | SQL, pattern: string): SQL {
  return sql`${foldedSearchSql(column)} LIKE ${pattern}`;
}
