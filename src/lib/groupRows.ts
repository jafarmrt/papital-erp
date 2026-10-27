/**
 * v11 phase 6.1ch (C7): rows grouped by a key in one pass, so a list joins its child rows in linear time. A `filter`
 * inside a `map` compares every child row with every parent row: an export of 30k invoices with 90k lines took 12 s.
 */
export function groupRowsBy<K, T>(rows: readonly T[], keyOf: (row: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}
