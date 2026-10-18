import type { Request } from 'express';
import { and, asc, eq, inArray, ne, or, isNull, sql } from 'drizzle-orm';
import { orm, type DbTransaction } from '../../db/drizzle.js';
import { birthdayGreetings, personnel, users } from '../../db/schema.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { logActivity } from '../../lib/auditLogger.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { createNotifications } from '../notifications/notificationCreator.js';
import {
  BIRTHDAY_GREETING_NOTIFICATION, BIRTHDAY_REACTION_EMOJI, birthdayGreetingLink, birthdayLink, COLLEAGUE_BIRTHDAY_NOTIFICATION,
  GREETING_MESSAGE_MAX, greetingMessageLength, monthDayLabel, scanRunsOfDay, upcomingBirthday,
  type BirthdayGreetingView, type DayScanRuns, type BirthdayReaction, type BirthdaysAnswer, type ColleagueBirthday, type UpcomingBirthday,
} from '../../lib/social/birthdays.js';
import { COLLEAGUE_FALLBACK_NAME } from '../../lib/social/presence.js';
import { runThrottledReminderScan } from '../../lib/workshop/reminderThrottle.js';

/**
 * v10.2 package 9 (group dashboard, parts A to C of the social dashboard proposal, owner's decisions of 24 Mehr 1405):
 * - the viewer's own birthday greets only the viewer (`myBirthdayToday`);
 * - colleagues' birthdays of today and the next seven days, day and month only, never the year, the age or the date;
 * - personnel who left («قطع همکاری»), were deleted or turned their birthday off are never shown;
 * - on the day, each user gets one bell notification per colleague's birthday, made when their bell asks;
 * - a colleague leaves one reaction or short message on today's birthday and the owner hears of it in the bell.
 * Notifications are of the bell-only category `social` and never go to a messenger. No amount is ever involved.
 */
export const BIRTHDAY_GREETING_AUDIT_ENTITY = 'تبریک تولد';
const LEFT_STATUS = 'قطع همکاری';

interface VisiblePerson {
  id: number;
  fullName: string;
  userId: number | null;
  avatarUrl: string;
  upcoming: UpcomingBirthday;
}

/** Live personnel who have not left and show their birthday, whose birthday falls in the window starting `todayIso` */
async function visibleUpcoming(todayIso: string): Promise<VisiblePerson[]> {
  const rows = await orm.select({
    id: personnel.id,
    fullName: personnel.fullName,
    birthDate: personnel.birthDate,
    userId: personnel.userId,
    avatarUrl: users.avatarUrl,
    userDeleted: users.isDeleted,
  }).from(personnel)
    .leftJoin(users, eq(users.id, personnel.userId))
    .where(and(
      eq(personnel.isDeleted, 0),
      eq(personnel.isBirthdayVisible, 1),
      or(isNull(personnel.employmentStatus), ne(personnel.employmentStatus, LEFT_STATUS)),
      ne(personnel.birthDate, ''),
    ))
    .orderBy(asc(personnel.id));
  const out: VisiblePerson[] = [];
  for (const r of rows) {
    const upcoming = upcomingBirthday(r.birthDate, todayIso);
    if (!upcoming) continue;
    const linked = r.userId !== null && r.userDeleted === 0 ? r.userId : null;
    out.push({ id: r.id, fullName: r.fullName, userId: linked, avatarUrl: linked ? (r.avatarUrl ?? '') : '', upcoming });
  }
  return out;
}

/** The viewer's own live personnel, if any */
async function myPersonnel(userId: number) {
  const [me] = await orm.select({ id: personnel.id, birthDate: personnel.birthDate, employmentStatus: personnel.employmentStatus })
    .from(personnel).where(and(eq(personnel.userId, userId), eq(personnel.isDeleted, 0))).orderBy(asc(personnel.id)).limit(1);
  return me ?? null;
}

async function greetingsOf(people: VisiblePerson[], viewerId: number): Promise<Map<number, BirthdayGreetingView[]>> {
  const today = people.filter(p => p.upcoming.daysAway === 0);
  const byPerson = new Map<number, BirthdayGreetingView[]>();
  if (today.length === 0) return byPerson;
  const rows = await orm.select({
    id: birthdayGreetings.id,
    personnelId: birthdayGreetings.personnelId,
    jalaliYear: birthdayGreetings.jalaliYear,
    senderUserId: birthdayGreetings.senderUserId,
    reaction: birthdayGreetings.reaction,
    message: birthdayGreetings.message,
    senderName: users.fullName,
    senderAvatarUrl: users.avatarUrl,
  }).from(birthdayGreetings)
    .innerJoin(users, eq(users.id, birthdayGreetings.senderUserId))
    .where(and(inArray(birthdayGreetings.personnelId, today.map(p => p.id)), eq(birthdayGreetings.isDeleted, 0), eq(users.isDeleted, 0)))
    .orderBy(asc(birthdayGreetings.id));
  const yearOf = new Map(today.map(p => [p.id, p.upcoming.jalaliYear]));
  for (const r of rows) {
    if (yearOf.get(r.personnelId) !== r.jalaliYear) continue;
    const list = byPerson.get(r.personnelId) ?? [];
    list.push({
      id: r.id,
      senderUserId: r.senderUserId,
      senderName: r.senderName?.trim() || COLLEAGUE_FALLBACK_NAME,
      senderAvatarUrl: r.senderAvatarUrl || '',
      reaction: (r.reaction as BirthdayReaction | null) ?? null,
      message: r.message ?? '',
      mine: r.senderUserId === viewerId,
    });
    byPerson.set(r.personnelId, list);
  }
  return byPerson;
}

/** `GET /social/birthdays` */
export async function listBirthdays(viewerId: number): Promise<BirthdaysAnswer> {
  const todayIso = await businessTodayIsoDate();
  const people = await visibleUpcoming(todayIso);
  const greetings = await greetingsOf(people, viewerId);
  const me = await myPersonnel(viewerId);
  const mine = me && me.employmentStatus !== LEFT_STATUS ? upcomingBirthday(me.birthDate, todayIso, 0) : null;
  const birthdays: ColleagueBirthday[] = people
    .sort((a, b) => a.upcoming.daysAway - b.upcoming.daysAway || a.fullName.localeCompare(b.fullName, 'fa'))
    .map(p => ({
      personnelId: p.id,
      name: p.fullName,
      avatarUrl: p.avatarUrl,
      label: monthDayLabel(p.upcoming.monthDay),
      daysAway: p.upcoming.daysAway,
      isToday: p.upcoming.daysAway === 0,
      isMine: me?.id === p.id,
      greetings: p.upcoming.daysAway === 0 ? (greetings.get(p.id) ?? []) : [],
    }));
  return { myBirthdayToday: mine !== null, birthdays };
}

const birthdayScans: DayScanRuns = { day: '', runs: new Map() };

/**
 * The bell's call: today's colleague birthdays of one user, at most once an hour, on the pool, never in a transaction.
 * A new business day starts every user's hour again (review N-7), so the bell shows today's birthdays right after midnight.
 */
export async function generateColleagueBirthdayNotificationsThrottled(userId: number, nowMs = Date.now(), todayIso?: string): Promise<number> {
  const runs = scanRunsOfDay(birthdayScans, todayIso ?? await businessTodayIsoDate());
  return runThrottledReminderScan(userId, nowMs, () => generateColleagueBirthdayNotifications(userId), runs);
}

/** One notification per colleague whose birthday is today; the unique index keeps it once, even after it is dismissed */
export async function generateColleagueBirthdayNotifications(userId: number): Promise<number> {
  const todayIso = await businessTodayIsoDate();
  const today = (await visibleUpcoming(todayIso)).filter(p => p.upcoming.daysAway === 0 && p.userId !== userId);
  if (today.length === 0) return 0;
  const made = await orm.transaction(tx => createNotifications(tx, today.map(p => ({
    userId,
    category: 'social' as const,
    type: COLLEAGUE_BIRTHDAY_NOTIFICATION,
    senderId: null,
    senderName: 'پیشخوان',
    title: '🎂 تولد همکار',
    message: `امروز تولد ${p.fullName} است؛ از پیشخوان تبریک بگویید.`,
    link: birthdayLink(p.id, p.upcoming.jalaliYear),
  })), { skipExisting: true }));
  return made.length;
}

export interface GreetingInput {
  reaction: BirthdayReaction | null;
  message: string;
}

/** Today's birthday of a live, visible personnel who has not left, read under its row lock; else 404 */
async function lockTodayBirthday(tx: DbTransaction, personnelId: number) {
  const [row] = await tx.select({
    id: personnel.id, fullName: personnel.fullName, birthDate: personnel.birthDate, userId: personnel.userId,
    isDeleted: personnel.isDeleted, isBirthdayVisible: personnel.isBirthdayVisible, employmentStatus: personnel.employmentStatus,
  }).from(personnel).where(eq(personnel.id, personnelId)).for('share');
  if (!row || row.isDeleted !== 0 || row.isBirthdayVisible !== 1 || row.employmentStatus === LEFT_STATUS) {
    throw new NotFoundError('این تولد پیدا نشد.', undefined, 'SOCIAL_BIRTHDAY_NOT_FOUND');
  }
  const todayIso = await businessTodayIsoDate();
  const upcoming = upcomingBirthday(row.birthDate, todayIso, 0);
  // review N-1: a birthday that is not today answers like a missing one, so personnel ids cannot be probed
  if (!upcoming) throw new NotFoundError('این تولد پیدا نشد.', undefined, 'SOCIAL_BIRTHDAY_NOT_FOUND');
  return { ...row, jalaliYear: upcoming.jalaliYear };
}

function normalizedGreeting(input: GreetingInput): GreetingInput {
  const message = String(input.message ?? '').trim();
  if (greetingMessageLength(message) > GREETING_MESSAGE_MAX) {
    throw new ValidationError(`پیام تبریک حداکثر ${GREETING_MESSAGE_MAX.toLocaleString('fa-IR')} نویسه است.`, undefined, 'SOCIAL_GREETING_TOO_LONG');
  }
  if (!input.reaction && !message) throw new ValidationError('یک واکنش بزنید یا پیامی بنویسید.', undefined, 'SOCIAL_GREETING_EMPTY');
  return { reaction: input.reaction ?? null, message };
}

/**
 * `PUT /social/birthdays/:personnelId/greeting`: the viewer's own reaction and message on today's birthday, created or
 * changed under the birthday person's row lock and the viewer's live row lock, with its audit row in the same
 * transaction. The owner gets one bell notification the first time a colleague greets them that year.
 */
export async function saveMyGreeting(senderUserId: number, personnelId: number, input: GreetingInput, req?: Request): Promise<BirthdaysAnswer> {
  const greeting = normalizedGreeting(input);
  await orm.transaction(async (tx) => {
    const person = await lockTodayBirthday(tx, personnelId);
    if (person.userId === senderUserId) {
      throw new ValidationError('تولد خودتان را نمی‌توانید تبریک بگویید.', undefined, 'SOCIAL_GREETING_SELF');
    }
    const [current] = await tx.select().from(birthdayGreetings)
      .where(and(eq(birthdayGreetings.personnelId, personnelId), eq(birthdayGreetings.jalaliYear, person.jalaliYear),
        eq(birthdayGreetings.senderUserId, senderUserId), eq(birthdayGreetings.isDeleted, 0)))
      .for('update');
    if (current) {
      if ((current.reaction ?? null) === greeting.reaction && current.message === greeting.message) return;
      await tx.update(birthdayGreetings).set({ reaction: greeting.reaction, message: greeting.message, updatedAt: sql`now()` })
        .where(eq(birthdayGreetings.id, current.id));
      await logActivity({
        tx, req, action: 'UPDATE', entity: BIRTHDAY_GREETING_AUDIT_ENTITY, entityId: current.id,
        description: `تبریک تولد ${person.fullName} ویرایش شد`,
        details: { personnelId, jalaliYear: person.jalaliYear, before: { reaction: current.reaction, message: current.message }, after: greeting },
      });
      return;
    }
    let inserted: { id: number } | undefined;
    try {
      [inserted] = await tx.insert(birthdayGreetings).values({
        personnelId, jalaliYear: person.jalaliYear, senderUserId, reaction: greeting.reaction, message: greeting.message,
      }).returning({ id: birthdayGreetings.id });
    } catch (err) {
      if ((err as { code?: string })?.code === '23505' || (err as { cause?: { code?: string } })?.cause?.code === '23505') {
        throw new ConflictError('تبریک شما هم‌زمان ثبت شد؛ صفحه را تازه کنید.', undefined, 'SOCIAL_GREETING_TAKEN');
      }
      throw err;
    }
    await logActivity({
      tx, req, action: 'CREATE', entity: BIRTHDAY_GREETING_AUDIT_ENTITY, entityId: inserted?.id,
      description: `تبریک تولد ${person.fullName} ثبت شد`,
      details: { personnelId, jalaliYear: person.jalaliYear, after: greeting },
    });
    if (person.userId) {
      const [sender] = await tx.select({ fullName: users.fullName }).from(users).where(eq(users.id, senderUserId));
      const senderName = sender?.fullName?.trim() || 'یک همکار';
      await createNotifications(tx, [{
        userId: person.userId,
        category: 'social',
        type: BIRTHDAY_GREETING_NOTIFICATION,
        senderId: senderUserId,
        senderName,
        title: `${greeting.reaction ? `${BIRTHDAY_REACTION_EMOJI[greeting.reaction]} ` : '🎂 '}تبریک تولد`,
        message: `${senderName} تولدتان را تبریک گفت.`,
        link: birthdayGreetingLink(personnelId, person.jalaliYear, senderUserId),
      }], { skipExisting: true });
    }
  });
  return listBirthdays(senderUserId);
}

/** `DELETE /social/birthdays/:personnelId/greeting`: the viewer removes their own greeting of today (soft delete) */
export async function deleteMyGreeting(senderUserId: number, personnelId: number, req?: Request): Promise<BirthdaysAnswer> {
  await orm.transaction(async (tx) => {
    const person = await lockTodayBirthday(tx, personnelId);
    const [current] = await tx.select().from(birthdayGreetings)
      .where(and(eq(birthdayGreetings.personnelId, personnelId), eq(birthdayGreetings.jalaliYear, person.jalaliYear),
        eq(birthdayGreetings.senderUserId, senderUserId), eq(birthdayGreetings.isDeleted, 0)))
      .for('update');
    if (!current) throw new NotFoundError('تبریکی از شما برای این تولد نیست.', undefined, 'SOCIAL_GREETING_NOT_FOUND');
    await tx.update(birthdayGreetings).set({ isDeleted: 1, updatedAt: sql`now()` }).where(eq(birthdayGreetings.id, current.id));
    await logActivity({
      tx, req, action: 'DELETE', entity: BIRTHDAY_GREETING_AUDIT_ENTITY, entityId: current.id,
      description: `تبریک تولد ${person.fullName} حذف شد`,
      details: { personnelId, jalaliYear: person.jalaliYear, before: { reaction: current.reaction, message: current.message } },
    });
  });
  return listBirthdays(senderUserId);
}
