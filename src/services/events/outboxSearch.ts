import { inArray, or, sql, type SQL } from 'drizzle-orm';
import { outboxEvents } from '../../db/schema.js';
import { containsLikePattern } from '../../lib/sqlLike.js';
import { EVENT_AGGREGATE_LABELS, PUBLISHED_EVENT_TYPES } from '../../lib/events/eventTypeCatalog.js';

/**
 * OBS-R2-86 (TD-1323): the outbox tab's search, the fields the browser searched on its one page: the event id, type and
 * aggregate, the last error, the payload text and the Persian names of the type and the aggregate.
 */
export function outboxSearchCondition(search: string | undefined): SQL | undefined {
  const q = String(search ?? '').trim();
  if (!q) return undefined;
  const pattern = containsLikePattern(q.toLowerCase());
  const typesByLabel = PUBLISHED_EVENT_TYPES.filter(t => t.label.includes(q)).map(t => t.value);
  const aggregatesByLabel = Object.entries(EVENT_AGGREGATE_LABELS).filter(([, label]) => label.includes(q)).map(([key]) => key);
  return or(
    sql`lower(${outboxEvents.eventId}) LIKE ${pattern}`,
    sql`lower(${outboxEvents.eventType}) LIKE ${pattern}`,
    sql`lower(${outboxEvents.aggregateType}) LIKE ${pattern}`,
    sql`lower(${outboxEvents.aggregateId}) LIKE ${pattern}`,
    sql`lower(coalesce(${outboxEvents.lastError}, '')) LIKE ${pattern}`,
    sql`lower(coalesce(${outboxEvents.payload}::text, '')) LIKE ${pattern}`,
    typesByLabel.length > 0 ? inArray(outboxEvents.eventType, typesByLabel) : undefined,
    aggregatesByLabel.length > 0 ? sql`lower(btrim(${outboxEvents.aggregateType})) IN (${sql.join(aggregatesByLabel.map(a => sql`${a}`), sql`, `)})` : undefined,
  );
}
