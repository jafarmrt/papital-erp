/**
 * The code key and the name key of a warehouse item: the app's one rule for "the same item" (TD-653), read by the
 * project item match (`findProjectItemMatch`), the reservation and the duplicate item health check. JavaScript's `trim()`
 * removes every white space (a tab or a no-break space too) and `toUpperCase()` maps every letter case («ß» is «SS»).
 * 10.3 package 6 (TD-1386): moved here from `src/lib/projects/projectItemMatch.ts` so the items package reads them too.
 */

/** کلید کد کالا، همان کلید یکتایی کالا (TD-653) */
export const itemCodeKey = (code: unknown): string =>
  typeof code === 'string' || typeof code === 'number' ? String(code).trim().toUpperCase() : '';

/** کلید نام کالا، همان کلید یکتایی کالا (TD-653) */
export const itemNameKey = (name: unknown): string =>
  typeof name === 'string' || typeof name === 'number' ? String(name).trim().toLowerCase() : '';
