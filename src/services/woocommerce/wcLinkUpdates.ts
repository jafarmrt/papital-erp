import { inArray, sql, type SQL } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { wcProductLinks } from '../../db/schema.js';
import { chunked } from '../../lib/woocommerce/wcCatalog.js';

/**
 * 10.2 package 6 (review M-3): the links of a catalog refresh or a stock push are written with one UPDATE per batch of rows
 * instead of one per link. Each changed column is a `CASE id WHEN … THEN … END` over the batch's ids, every value cast to
 * its column type so PostgreSQL never sees an untyped parameter; the rows come from a read under the caller's lock.
 */
const LINK_UPDATE_BATCH = 500;

type CastType = 'int' | 'text' | 'timestamp' | 'jsonb';

export interface LinkRowUpdate {
  id: number;
  /** column values of this row; a column missing from a row keeps its stored value */
  values: Partial<Record<LinkColumn, string | number | null>>;
}

const LINK_COLUMNS = {
  siteSku: { column: wcProductLinks.siteSku, cast: 'text' },
  siteStock: { column: wcProductLinks.siteStock, cast: 'int' },
  siteManageStock: { column: wcProductLinks.siteManageStock, cast: 'int' },
  lastReadAt: { column: wcProductLinks.lastReadAt, cast: 'timestamp' },
  lastPushedAt: { column: wcProductLinks.lastPushedAt, cast: 'timestamp' },
  lastError: { column: wcProductLinks.lastError, cast: 'text' },
  failureCount: { column: wcProductLinks.failureCount, cast: 'int' },
  isDeleted: { column: wcProductLinks.isDeleted, cast: 'int' },
  siteType: { column: wcProductLinks.siteType, cast: 'text' },
  siteRegularPrice: { column: wcProductLinks.siteRegularPrice, cast: 'text' },
  priceError: { column: wcProductLinks.priceError, cast: 'text' },
  priceFailureCount: { column: wcProductLinks.priceFailureCount, cast: 'int' },
  skuError: { column: wcProductLinks.skuError, cast: 'text' },
  skuFailureCount: { column: wcProductLinks.skuFailureCount, cast: 'int' },
  // v11 phase 6.5 (part D): `sentTagIds` is written as JSON text
  siteImageId: { column: wcProductLinks.siteImageId, cast: 'int' },
  coverSentSha256: { column: wcProductLinks.coverSentSha256, cast: 'text' },
  imageError: { column: wcProductLinks.imageError, cast: 'text' },
  imageFailureCount: { column: wcProductLinks.imageFailureCount, cast: 'int' },
  sentTagIds: { column: wcProductLinks.sentTagIds, cast: 'jsonb' },
  sentCollections: { column: wcProductLinks.sentCollections, cast: 'text' },
  collectionError: { column: wcProductLinks.collectionError, cast: 'text' },
  collectionFailureCount: { column: wcProductLinks.collectionFailureCount, cast: 'int' },
} as const satisfies Record<string, { column: unknown; cast: CastType }>;

export type LinkColumn = keyof typeof LINK_COLUMNS;

function caseOf(rows: LinkRowUpdate[], name: LinkColumn): SQL {
  const { column, cast } = LINK_COLUMNS[name];
  const arms = rows
    .filter(r => name in r.values)
    .map(r => sql`WHEN ${r.id}::int THEN ${r.values[name] ?? null}::${sql.raw(cast)}`);
  return sql`CASE ${wcProductLinks.id} ${sql.join(arms, sql.raw(' '))} ELSE ${column} END`;
}

/** Writes the rows' values, one UPDATE per batch; `now` is the batch's `updated_at` */
export async function updateLinkRows(executor: DbExecutor, rows: LinkRowUpdate[], now: string): Promise<void> {
  for (const batch of chunked(rows, LINK_UPDATE_BATCH)) {
    const names = [...new Set(batch.flatMap(r => Object.keys(r.values) as LinkColumn[]))];
    const set: Record<string, SQL | string> = { updatedAt: now };
    for (const name of names) set[name] = caseOf(batch, name);
    await executor.update(wcProductLinks).set(set).where(inArray(wcProductLinks.id, batch.map(r => r.id)));
  }
}
