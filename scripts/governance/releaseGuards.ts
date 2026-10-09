/**
 * Release governance gates run by `npm run check:version` (scripts/check-version-sync.ts), so every
 * `npm run release:renumber` merge checks them too. Terminal output is English (AGENTS.md, owner rule t9).
 *
 * v10.0.21 (TD-981): a debt row is never both active (TECH_DEBT.md) and archived (TECH_DEBT_ARCHIVE.md), and no id
 * is listed twice in one of them; parallel merges used to bring archived rows back unnoticed.
 */

const debtIds = (src: string) => src.split('\n').map(l => l.match(/^\| (TD-\d+) \|/)?.[1]).filter((id): id is string => !!id);

function duplicates(ids: string[]): Array<[string, number]> {
  const count = new Map<string, number>();
  for (const id of ids) count.set(id, (count.get(id) ?? 0) + 1);
  return [...count].filter(([, n]) => n > 1);
}

export function findDebtRegistryViolations(debt: string, archive: string): string[] {
  const active = debtIds(debt);
  const archived = debtIds(archive);
  const archivedSet = new Set(archived);
  return [
    ...[...new Set(active)].filter(id => archivedSet.has(id)).map(id => `${id} is both active (TECH_DEBT.md) and archived (TECH_DEBT_ARCHIVE.md)`),
    ...duplicates(active).map(([id, n]) => `${id} appears ${n} times in TECH_DEBT.md`),
    ...duplicates(archived).map(([id, n]) => `${id} appears ${n} times in TECH_DEBT_ARCHIVE.md`),
  ];
}
