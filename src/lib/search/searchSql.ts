import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
import {
  SEARCH_COMPACT_DROP, SEARCH_COMPACT_FOLD_FROM, SEARCH_COMPACT_FOLD_TO, SEARCH_FOLD_FROM, SEARCH_FOLD_TO,
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
