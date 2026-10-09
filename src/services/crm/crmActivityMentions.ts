import { and, eq, inArray, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { notifications, roles, users } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { SYSTEM_ADMIN_ROLE } from '../../lib/permissions/permissionCatalog.js';

type Tx = Parameters<Parameters<typeof orm.transaction>[0]>[0];

/** The keys of `GET /crm/activities`: only their holders may read an activity, so only they hear of a mention */
export const CRM_ACTIVITY_READ_PERMISSIONS = ['crm.view', 'customers.view', 'customers.manage'] as const;

/**
 * v10.0.29 (TD-976): the users mentioned in a CRM activity are positive ids of existing, non-deleted users, the same
 * rule as a daily work log (TD-629). Before, any value was accepted, a text was matched by username or full name, and
 * the description was scanned for «@name» with `includes`, so «@علی» also mentioned «علی رضایی». The browser sends the
 * ids the text names (`detectMentionedUserIds`, TD-628). An unknown id refuses the save with 422.
 */
export async function resolveActivityMentions(tx: Tx, ids: number[] | undefined): Promise<number[]> {
  const unique = [...new Set(ids ?? [])].sort((a, b) => a - b);
  if (unique.length === 0) return [];
  const found = await tx.select({ id: users.id }).from(users)
    .where(and(inArray(users.id, unique), eq(users.isDeleted, 0)));
  const known = new Set(found.map(r => r.id));
  const missing = unique.filter(id => !known.has(id));
  if (missing.length > 0) {
    throw new ValidationError(`کاربر اشاره‌شده با شناسه ${missing.join('، ')} در سامانه نیست`, { missing }, 'CRM_MENTION_USER_NOT_FOUND');
  }
  return unique;
}

/** Mentioned users (other than the author) who may read CRM activities: the system admin or a role holding a read key */
export async function mentionReaders(tx: Tx, ids: number[], authorId: number | undefined): Promise<number[]> {
  const others = ids.filter(id => id !== authorId);
  if (others.length === 0) return [];
  const keys = sql.join(CRM_ACTIVITY_READ_PERMISSIONS.map(k => sql`${k}`), sql`, `);
  const rows = await tx.select({ id: users.id }).from(users)
    .leftJoin(roles, eq(roles.code, users.role))
    .where(and(
      inArray(users.id, others),
      eq(users.isDeleted, 0),
      sql`(${users.role} = ${SYSTEM_ADMIN_ROLE} OR coalesce(${roles.permissions}, '[]'::jsonb) ?| array[${keys}]::text[])`,
    ))
    .orderBy(users.id);
  return rows.map(r => r.id);
}

/** One mention notification per reader, written with the activity's own transaction */
export async function notifyActivityMentions(
  tx: Tx,
  activity: { id: number; title: string; mentions: number[] },
  actor: { id?: number; name: string },
): Promise<number[]> {
  const readers = await mentionReaders(tx, activity.mentions, actor.id);
  for (const userId of readers) {
    await tx.insert(notifications).values({
      userId,
      senderId: actor.id,
      senderName: actor.name,
      type: 'mention',
      title: 'اشاره به شما در اقدام ارتباط با مشتری',
      message: `${actor.name} در اقدام «${activity.title}» به شما اشاره کرد.`,
      link: `/crm?activityId=${activity.id}`,
      isRead: 0,
    });
  }
  return readers;
}
