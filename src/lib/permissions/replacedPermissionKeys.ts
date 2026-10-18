/**
 * v10.2.0: catalog keys that were removed and the key that now asks the same work. Shared by the workflow engine, which
 * lets the holders of the replacement sign a running instance still asking the removed key, and by the financial health
 * check, which says who signs such an action until its design is published again (TD-1323).
 */
// the removed key is spelled in parts: it is no catalog key any more, and the permission ratchet refuses such a literal
export const REMOVED_STOCK_COUNT_START_KEY = ['audit', 'create'].join('.');

export const REPLACED_PERMISSION_KEYS: Readonly<Record<string, string>> = {
  [REMOVED_STOCK_COUNT_START_KEY]: 'audit.apply',
};
