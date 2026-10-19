import { inArray, or, sql, type SQL } from 'drizzle-orm';
import { items } from '../../db/schema.js';

/**
 * The characters JavaScript's `trim()` removes (white space and line terminators), so the SQL keys below trim as
 * `itemCodeKey` / `itemNameKey` do; plain `btrim` removes only the space, and a code stored with a tab or a no-break space
 * kept its item out of the narrowed read
 */
export const JS_TRIM_CHARS = '\t\n\v\f\r                  　﻿';

/**
 * Code and name characters whose letter case JavaScript and the narrowed SQL key below map alike: the key compares under
 * the "C" collation, which maps only ASCII letters, so a code or name with a character outside ASCII and the Arabic script
 * (no letter case) and its joiners is read whatever its key; for every other item the SQL key equals `itemCodeKey` /
 * `itemNameKey`
 */
const KEY_UNSAFE_CHAR = '[^\\u0001-\\u007f\\u0600-\\u06ff\\u200c\\u200d\\ufb50-\\ufdff\\ufe70-\\ufefc]';

/** The refs' code keys (`itemCodeKey`) and name keys (`itemNameKey`), computed by the caller, and the item ids they carry */
export interface ItemRefKeys {
  codes: readonly string[];
  names: readonly string[];
  ids?: readonly number[];
}

/**
 * The condition on `items` of every live item that may be a ref's `findProjectItemMatch` among every item: the items the
 * refs carry by id, those whose code key or name key one of the refs holds, plus every item whose code or name holds a
 * character the SQL key may case-map unlike JavaScript («ß» is «SS» only in JavaScript, «İ» and «Σ» differ too). Undefined
 * when the refs name nothing. OBS-R2-45 (TD-1322) for the finalize; TD-1341 (N1) shares it with the reservation report, so
 * the report and «تکمیل رزرو» find the same item for a stored row. The keys come from the caller (`itemRefKeys` of
 * `src/lib/projects/projectItemMatch.ts`), since the items package does not import the projects package.
 */
export function itemRefKeyCondition(keys: ItemRefKeys): SQL | undefined {
  // a key holding NUL names no stored item (PostgreSQL text never holds it) and would refuse the query
  const storable = (key: string) => key !== '' && !key.includes('\u0000');
  const codes = [...new Set(keys.codes.filter(storable))];
  const names = [...new Set(keys.names.filter(storable))];
  const ids = [...new Set((keys.ids ?? []).filter(id => Number.isSafeInteger(id) && id > 0))];
  if (codes.length === 0 && names.length === 0 && ids.length === 0) return undefined;
  const conditions = [
    ids.length > 0 ? inArray(items.id, ids) : undefined,
    codes.length > 0 ? inArray(sql`upper(btrim(${items.code}, ${JS_TRIM_CHARS}) COLLATE "C")`, codes) : undefined,
    names.length > 0 ? inArray(sql`lower(btrim(${items.name}, ${JS_TRIM_CHARS}) COLLATE "C")`, names) : undefined,
    sql`${items.code} ~ ${KEY_UNSAFE_CHAR}`,
    sql`${items.name} ~ ${KEY_UNSAFE_CHAR}`,
  ].filter((c): c is SQL => c !== undefined);
  return or(...conditions);
}
