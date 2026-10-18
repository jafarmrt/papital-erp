import type { Request } from 'express';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { personnel, users } from '../../db/schema.js';
import { businessTodayIsoDate, getDisplayTimezone } from '../../lib/businessClock.js';
import { logActivity } from '../../lib/auditLogger.js';
import { APP_VERSION } from '../../lib/version.js';
import { ValidationError } from '../../errors/customErrors.js';
import { lastSeenOf, presenceStatus, type PresenceColleague, type SocialPreferences, type WhatsNewAnswer } from '../../lib/social/presence.js';
import { v10Updates } from '../../data/changelogs/10.js';

/**
 * v10.2 package 9 (group dashboard, parts D and E of the social dashboard proposal): who is in the app, each user's own
 * birthday and presence choices, and the «تازه‌های این نسخه» card.
 */

/** `GET /social/presence`: colleagues seen in the last five minutes («برخط است») or today («امروز آمده»), never the page */
export async function listPresence(viewerId: number, nowMs = Date.now()): Promise<PresenceColleague[]> {
  const rows = await orm.select({ id: users.id, fullName: users.fullName, username: users.username, avatarUrl: users.avatarUrl })
    .from(users)
    .where(and(eq(users.isDeleted, 0), eq(users.isPresenceVisible, 1), ne(users.id, viewerId)))
    .orderBy(asc(users.id));
  const [todayIso, timeZone] = await Promise.all([businessTodayIsoDate(), getDisplayTimezone()]);
  const out: PresenceColleague[] = [];
  for (const r of rows) {
    const status = presenceStatus(lastSeenOf(r.id), nowMs, todayIso, timeZone);
    if (status) out.push({ userId: r.id, name: r.fullName || r.username, avatarUrl: r.avatarUrl || '', status });
  }
  return out.sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name, 'fa') : a.status === 'online' ? -1 : 1));
}

async function linkedPersonnel(userId: number) {
  const [row] = await orm.select({ id: personnel.id, isBirthdayVisible: personnel.isBirthdayVisible })
    .from(personnel).where(and(eq(personnel.userId, userId), eq(personnel.isDeleted, 0))).orderBy(asc(personnel.id)).limit(1);
  return row ?? null;
}

/** `GET /social/preferences` */
export async function getSocialPreferences(userId: number): Promise<SocialPreferences> {
  const [user] = await orm.select({ isPresenceVisible: users.isPresenceVisible }).from(users).where(eq(users.id, userId));
  const person = await linkedPersonnel(userId);
  return { showBirthday: person ? person.isBirthdayVisible === 1 : null, showPresence: (user?.isPresenceVisible ?? 1) === 1 };
}

/**
 * `PUT /social/preferences`: the user's own choices. Presence is on the user row (audit «پروفایل کاربر»); the birthday
 * flag is on the linked personnel (audit «پرسنل», its version raised so an open personnel form gets 409), each under its
 * row lock with the audit row in the same transaction. A repeat changes and writes nothing.
 */
export async function setSocialPreferences(userId: number, input: { showBirthday?: boolean; showPresence?: boolean }, req?: Request): Promise<SocialPreferences> {
  await orm.transaction(async (tx) => {
    const [user] = await tx.select({ id: users.id, isPresenceVisible: users.isPresenceVisible }).from(users).where(eq(users.id, userId)).for('update');
    if (!user) throw new ValidationError('کاربر پیدا نشد.', undefined, 'SOCIAL_USER_NOT_FOUND');
    if (input.showPresence !== undefined && (user.isPresenceVisible === 1) !== input.showPresence) {
      await tx.update(users).set({ isPresenceVisible: input.showPresence ? 1 : 0, updatedAt: sql`now()` }).where(eq(users.id, userId));
      await logActivity({
        tx, req, action: 'UPDATE', entity: 'پروفایل کاربر', entityId: userId,
        description: input.showPresence ? 'کاربر نمایش برخط بودنش به همکاران را روشن کرد' : 'کاربر نمایش برخط بودنش به همکاران را خاموش کرد',
        details: { before: { showPresence: user.isPresenceVisible === 1 }, after: { showPresence: input.showPresence } },
      });
    }
    if (input.showBirthday === undefined) return;
    const [person] = await tx.select({ id: personnel.id, isBirthdayVisible: personnel.isBirthdayVisible, fullName: personnel.fullName })
      .from(personnel).where(and(eq(personnel.userId, userId), eq(personnel.isDeleted, 0))).orderBy(asc(personnel.id)).limit(1).for('update');
    if (!person) {
      throw new ValidationError('حساب شما به پرونده پرسنلی وصل نیست؛ نمایش تولد از پرونده پرسنل تنظیم می‌شود.', undefined, 'SOCIAL_NO_PERSONNEL');
    }
    if ((person.isBirthdayVisible === 1) === input.showBirthday) return;
    await tx.update(personnel).set({
      isBirthdayVisible: input.showBirthday ? 1 : 0, updatedAt: sql`now()`, version: sql`${personnel.version} + 1`,
    }).where(eq(personnel.id, person.id));
    await logActivity({
      tx, req, action: 'UPDATE', entity: 'پرسنل', entityId: person.id,
      description: input.showBirthday ? `نمایش تولد ${person.fullName} به همکاران روشن شد` : `نمایش تولد ${person.fullName} به همکاران خاموش شد`,
      details: { changes: { isBirthdayVisible: { before: person.isBirthdayVisible === 1, after: input.showBirthday } }, source: 'profile' },
    });
  });
  return getSocialPreferences(userId);
}

export const WHATS_NEW_MAX_LINES = 4;

/** The entry of the running version in the active changelog, or null */
export function whatsNewEntry(version = APP_VERSION): { version: string; title: string; lines: string[] } | null {
  const key = `v${version.replace(/^v/, '')}`;
  const entry = v10Updates.find(e => e.version === key);
  if (!entry) return null;
  return { version: key, title: entry.title, lines: entry.changes.slice(0, WHATS_NEW_MAX_LINES) };
}

/** `GET /social/whats-new` */
export async function getWhatsNew(userId: number): Promise<WhatsNewAnswer | null> {
  const entry = whatsNewEntry();
  if (!entry) return null;
  const [user] = await orm.select({ seen: users.whatsNewSeenVersion }).from(users).where(eq(users.id, userId));
  return { ...entry, dismissed: user?.seen === entry.version };
}

/**
 * `POST /social/whats-new/dismiss`: the user closed the card of this version; it comes back with the next version. Like
 * reading a notification, this is the user's own display state and writes no audit row.
 */
export async function dismissWhatsNew(userId: number, version: string): Promise<WhatsNewAnswer | null> {
  const entry = whatsNewEntry();
  if (!entry || entry.version !== version) {
    throw new ValidationError('این کارت مال نسخهٔ دیگری است؛ صفحه را تازه کنید.', undefined, 'SOCIAL_WHATS_NEW_STALE');
  }
  await orm.update(users).set({ whatsNewSeenVersion: entry.version }).where(eq(users.id, userId));
  return getWhatsNew(userId);
}
