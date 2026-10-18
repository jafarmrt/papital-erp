import type { TestCaseResult } from '../types.js';
import type { Harness, ShouldRun } from '../security/workflowTestHarness.js';
import { runReservationCases } from './stockReservationTests.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { birthMonthDay, jalaliOfIsoDay } from '../../lib/social/birthdays.js';
import { APP_VERSION } from '../../lib/version.js';

/**
 * v10.2 package 9 (group dashboard, SOCIAL_DASHBOARD_PROPOSAL parts A–E, TD-1300):
 * - Birthdays of live personnel who have not left and show theirs, today and the next seven days, day and month only;
 *   the owner's own greeting even when hidden from colleagues.
 * - Reactions and short greetings only on today's birthday, never one's own; the owner is notified once in the bell and
 *   never through a messenger; each sender edits and deletes only their own greeting, with an audit row.
 * - A colleague's birthday reaches the bell once; presence says only «online» or «today» and each user can turn it off;
 *   «تازه‌های این نسخه» is dismissed per user for the current version.
 * Through the real Express routes; red on v10.2.5, which had no /api/social routes.
 */
export async function runSocialDashboardTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  return runReservationCases(shouldRun, [
    ['reg_social_birthdays_visibility_td_1300',
      'v10.2 package 9: the birthday card lists live personnel who have not left and show their birthday, today and the next seven days, with day and month only; the owner of a hidden birthday is still greeted (TD-1300)',
      ['social', 'personnel', 'dashboard'], cleaned(visibilityCase)],
    ['reg_social_greetings_td_1300',
      'v10.2 package 9: a reaction or short greeting goes only on a colleague\'s birthday today, one live greeting per sender, the owner notified once in the bell and never through a messenger, edits and deletes own only with an audit row (TD-1300)',
      ['social', 'notifications', 'audit'], cleaned(greetingsCase)],
    ['reg_social_birthday_bell_td_1300',
      'v10.2 package 9: a colleague\'s birthday reaches the bell once on the day, never for a hidden or departed colleague nor for one\'s own birthday (TD-1300)',
      ['social', 'notifications'], cleaned(bellCase)],
    ['reg_social_presence_preferences_td_1300',
      'v10.2 package 9: presence lists only «online» or «today» and nothing else; each user turns their presence and birthday off for themselves, with an audit row (TD-1300)',
      ['social', 'users', 'personnel'], cleaned(presenceCase)],
    ['reg_social_birthday_withdrawn_td_1300',
      'v10.2 package 9 (review M-1, delta nits 2 and 4): a birthday turned off by its owner, of a personnel who left (form or Excel import), of a deleted personnel or whose birth date moved off today leaves every bell at once, the rows kept so the bell never makes them again (TD-1300)',
      ['social', 'notifications', 'personnel'], cleaned(withdrawnCase)],
    ['reg_social_whats_new_td_1300',
      'v10.2 package 9: the what\'s-new card shows the current version\'s changelog entry until the user dismisses it; another version is refused (TD-1300)',
      ['social', 'changelog'], cleaned(whatsNewCase)],
  ]);
}

const created: number[] = [];

/** Soft-deletes the personnel a case made, so their birthdays never reach the bell of later tests */
const cleaned = (run: (h: Harness, wrong: string[]) => Promise<string>) => async (h: Harness, wrong: string[]) => {
  try {
    return await run(h, wrong);
  } finally {
    if (created.length > 0) await h.q(`UPDATE personnel SET is_deleted = 1 WHERE id = ANY($1::int[])`, [created.splice(0)]);
  }
};

let serial = 0;
const unique = (label: string) => `${label}-${Date.now().toString().slice(-6)}-${++serial}`;
const codeOf = (res: { body?: unknown }) => String((res.body as { code?: unknown } | undefined)?.code ?? '');

/** A Gregorian birth date in 2000 whose Jalali day and month are those of `offset` days after the business today */
async function birthIsoFor(offset: number): Promise<string> {
  const target = jalaliOfIsoDay(await businessTodayIsoDate(), offset);
  for (let d = Date.UTC(2000, 0, 1); d < Date.UTC(2001, 0, 1); d += 86_400_000) {
    const iso = new Date(d).toISOString().slice(0, 10);
    const md = birthMonthDay(iso);
    if (md && md.month === target.month && md.day === target.day) return iso;
  }
  return '';
}

interface PersonOptions { offset: number; visible?: boolean; status?: string; deleted?: boolean; userId?: number | null }

async function person(h: Harness, label: string, opts: PersonOptions): Promise<number> {
  const [row] = await h.q(
    `INSERT INTO personnel (full_name, birth_date, is_birthday_visible, employment_status, is_deleted, user_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [unique(label), await birthIsoFor(opts.offset), opts.visible === false ? 0 : 1, opts.status ?? 'فعال', opts.deleted ? 1 : 0, opts.userId ?? null],
  );
  created.push(Number(row.id));
  return Number(row.id);
}

interface BirthdayRow { personnelId: number; daysAway: number; isToday: boolean; isMine: boolean; label: string; greetings: Array<{ mine: boolean; reaction: string | null; message: string }> }
const rowsOf = (res: { body?: unknown }) => ((res.body as { birthdays?: BirthdayRow[] } | undefined)?.birthdays ?? []);

async function visibilityCase(h: Harness, wrong: string[]): Promise<string> {
  const viewer = await h.sessionWith([]);
  const hiddenOwner = await h.sessionWith([]);
  const today = await person(h, 'S9 today', { offset: 0 });
  const soon = await person(h, 'S9 soon', { offset: 3 });
  const hidden = await person(h, 'S9 hidden', { offset: 0, visible: false, userId: hiddenOwner.userId });
  const left = await person(h, 'S9 left', { offset: 0, status: 'قطع همکاری' });
  const deleted = await person(h, 'S9 deleted', { offset: 0, deleted: true });
  const far = await person(h, 'S9 far', { offset: 9 });

  const res = await h.get('/api/social/birthdays', viewer);
  if (res.status !== 200) return `birthdays answered ${res.status}`;
  const rows = rowsOf(res);
  const ids = new Set(rows.map(r => r.personnelId));
  if (!ids.has(today) || !ids.has(soon)) wrong.push('a visible birthday of today or in three days is missing');
  for (const [id, name] of [[hidden, 'hidden'], [left, 'departed'], [deleted, 'deleted'], [far, 'nine days away']] as const) {
    if (ids.has(id)) wrong.push(`the ${name} colleague is listed`);
  }
  const todayRow = rows.find(r => r.personnelId === today);
  if (!todayRow?.isToday || todayRow.daysAway !== 0) wrong.push('today\'s birthday is not marked today');
  if (rows.find(r => r.personnelId === soon)?.daysAway !== 3) wrong.push('the birthday in three days has another distance');
  const text = JSON.stringify(res.body);
  if (/"(?:birthDate|birth_date|year|jalaliYear|age)"\s*:/i.test(text)) wrong.push('the answer carries a birth date, year or age');
  if ((res.body as { myBirthdayToday?: boolean }).myBirthdayToday !== false) wrong.push('a viewer without personnel is greeted');

  const own = await h.get('/api/social/birthdays', hiddenOwner);
  if ((own.body as { myBirthdayToday?: boolean }).myBirthdayToday !== true) wrong.push('the owner of a hidden birthday is not greeted');
  if (rowsOf(own).some(r => r.personnelId === hidden)) wrong.push('the hidden birthday is listed to its own owner as a colleague card');
  return wrong.length ? wrong.join('; ') : 'listed: today and in three days; left out: hidden, departed, deleted, far; no year';
}

async function greetingsCase(h: Harness, wrong: string[]): Promise<string> {
  const sender = await h.sessionWith([]);
  const other = await h.sessionWith([]);
  const owner = await h.sessionWith([]);
  const birthday = await person(h, 'S9 greet', { offset: 0, userId: owner.userId });
  const later = await person(h, 'S9 greet later', { offset: 2 });
  await h.q(`INSERT INTO user_messenger_links (user_id, messenger, chat_id, chat_name) VALUES ($1, 'bale', $2, 'test')`, [owner.userId, unique('chat')]);

  const first = await h.put(`/api/social/birthdays/${birthday}/greeting`, { reaction: 'cake' }, sender);
  if (first.status !== 200) return `the first reaction answered ${first.status} ${codeOf(first)}`;
  const second = await h.put(`/api/social/birthdays/${birthday}/greeting`, { reaction: 'party', message: '  تولدت مبارک  ' }, sender);
  if (second.status !== 200) wrong.push(`editing the greeting answered ${second.status}`);
  const live = await h.q(`SELECT reaction, message FROM birthday_greetings WHERE personnel_id = $1 AND sender_user_id = $2 AND is_deleted = 0`, [birthday, sender.userId]);
  if (live.length !== 1 || live[0].reaction !== 'party' || live[0].message !== 'تولدت مبارک') wrong.push(`live greetings after an edit: ${JSON.stringify(live)}`);
  const mineRow = rowsOf(second).find(r => r.personnelId === birthday)?.greetings.find(g => g.mine);
  if (!mineRow) wrong.push('the answer does not mark the sender\'s own greeting');

  const notes = await h.q(`SELECT id FROM notifications WHERE user_id = $1 AND type = 'birthday_greeting'`, [owner.userId]);
  if (notes.length !== 1) wrong.push(`the owner got ${notes.length} greeting notifications instead of one`);
  const jobs = await h.q(`SELECT j.id FROM integration_delivery_jobs j JOIN user_messenger_links l ON l.id = j.target_id
    WHERE j.kind = 'messenger' AND l.user_id = $1`, [owner.userId]);
  if (jobs.length !== 0) wrong.push('a greeting notification was queued for a messenger');

  const self = await h.put(`/api/social/birthdays/${birthday}/greeting`, { reaction: 'heart' }, owner);
  if (self.status !== 422 || codeOf(self) !== 'SOCIAL_GREETING_SELF') wrong.push(`greeting oneself answered ${self.status} ${codeOf(self)}`);
  const notToday = await h.put(`/api/social/birthdays/${later}/greeting`, { reaction: 'heart' }, sender);
  // review N-1: a birthday that is not today answers like a missing one, so personnel ids cannot be probed
  if (notToday.status !== 404 || codeOf(notToday) !== 'SOCIAL_BIRTHDAY_NOT_FOUND') wrong.push(`a greeting before the day answered ${notToday.status} ${codeOf(notToday)}`);
  const empty = await h.put(`/api/social/birthdays/${birthday}/greeting`, { reaction: null, message: '   ' }, other);
  if (empty.status !== 422 || codeOf(empty) !== 'SOCIAL_GREETING_EMPTY') wrong.push(`an empty greeting answered ${empty.status} ${codeOf(empty)}`);
  const long = await h.put(`/api/social/birthdays/${birthday}/greeting`, { message: 'ا'.repeat(201) }, other);
  if (long.status !== 400) wrong.push(`a 201-letter message answered ${long.status}`);
  // review N-2: the limit counts code points after trimming, as the database does (char_length)
  const emoji = await h.put(`/api/social/birthdays/${birthday}/greeting`, { message: `  ${'🎂'.repeat(200)}  ` }, other);
  if (emoji.status !== 200) wrong.push(`a 200-emoji message with spaces answered ${emoji.status} ${codeOf(emoji)}`);
  const emojiLong = await h.put(`/api/social/birthdays/${birthday}/greeting`, { message: '🎂'.repeat(201) }, other);
  if (emojiLong.status !== 400) wrong.push(`a 201-emoji message answered ${emojiLong.status}`);
  if (emoji.status === 200) await h.del(`/api/social/birthdays/${birthday}/greeting`, other);
  const badReaction = await h.put(`/api/social/birthdays/${birthday}/greeting`, { reaction: 'fire' }, other);
  if (badReaction.status !== 400) wrong.push(`an unknown reaction answered ${badReaction.status}`);

  const foreign = await h.del(`/api/social/birthdays/${birthday}/greeting`, other);
  if (foreign.status !== 404) wrong.push(`deleting without an own greeting answered ${foreign.status}`);
  const removed = await h.del(`/api/social/birthdays/${birthday}/greeting`, sender);
  if (removed.status !== 200) wrong.push(`deleting the own greeting answered ${removed.status}`);
  const after = await h.q(`SELECT is_deleted FROM birthday_greetings WHERE personnel_id = $1 AND sender_user_id = $2`, [birthday, sender.userId]);
  if (after.length !== 1 || Number(after[0].is_deleted) !== 1) wrong.push('the greeting was not soft-deleted');
  const audit = await h.q(`SELECT action FROM activity_logs WHERE entity = 'تبریک تولد' AND user_id = $1 ORDER BY id`, [sender.userId]);
  const actions = audit.map(a => String(a.action));
  if (actions.join(',') !== 'CREATE,UPDATE,DELETE') wrong.push(`audit actions: ${actions.join(',')}`);

  const again = await h.put(`/api/social/birthdays/${birthday}/greeting`, { reaction: 'clap' }, sender);
  if (again.status !== 200) wrong.push(`greeting again after a delete answered ${again.status}`);
  const notesAfter = await h.q(`SELECT id FROM notifications WHERE user_id = $1 AND type = 'birthday_greeting' AND sender_id = $2`, [owner.userId, sender.userId]);
  if (notesAfter.length !== 1) wrong.push('greeting again notified the owner a second time');
  return wrong.length ? wrong.join('; ') : 'one live greeting per sender; self, before the day, empty and long refused; bell only; own delete audited';
}

async function bellCase(h: Harness, wrong: string[]): Promise<string> {
  const viewer = await h.sessionWith([]);
  const owner = await h.sessionWith([]);
  const visible = await person(h, 'S9 bell', { offset: 0 });
  const hidden = await person(h, 'S9 bell hidden', { offset: 0, visible: false });
  const left = await person(h, 'S9 bell left', { offset: 0, status: 'قطع همکاری' });
  const own = await person(h, 'S9 bell own', { offset: 0, userId: owner.userId });

  const res = await h.get('/api/notifications', viewer);
  if (res.status !== 200) return `the bell answered ${res.status}`;
  await h.get('/api/notifications/unread-count', viewer);
  const rows = await h.q(`SELECT link FROM notifications WHERE user_id = $1 AND type = 'colleague_birthday'`, [viewer.userId]);
  const links = rows.map(r => String(r.link));
  const forPerson = (id: number) => links.filter(l => l.startsWith(`/?birthday=${id}-`)).length;
  if (forPerson(visible) !== 1) wrong.push(`the visible birthday reached the bell ${forPerson(visible)} times`);
  if (forPerson(hidden) + forPerson(left) !== 0) wrong.push('a hidden or departed colleague reached the bell');

  await h.get('/api/notifications', owner);
  const ownRows = await h.q(`SELECT link FROM notifications WHERE user_id = $1 AND type = 'colleague_birthday' AND link LIKE $2`, [owner.userId, `/?birthday=${own}-%`]);
  if (ownRows.length !== 0) wrong.push('the owner was told about their own birthday as a colleague\'s');
  return wrong.length ? wrong.join('; ') : 'one bell notification for a visible colleague, none for hidden, departed or own';
}

/** The fallback name of a user without a full name, compared with the presence answer */
const COLLEAGUE_NAME = 'همکار';

async function withdrawnCase(h: Harness, wrong: string[]): Promise<string> {
  const viewer = await h.sessionWith([]);
  const manager = await h.sessionWith(['personnel.view', 'personnel.manage']);
  const owner = await h.sessionWith([]);
  const hidden = await person(h, 'S9 withdraw hidden', { offset: 0, userId: owner.userId });
  const leaving = await person(h, 'S9 withdraw left', { offset: 0 });
  const removed = await person(h, 'S9 withdraw deleted', { offset: 0 });
  const kept = await person(h, 'S9 withdraw kept', { offset: 0 });
  const imported = await person(h, 'S9 withdraw excel', { offset: 0 });
  const moved = await person(h, 'S9 withdraw moved date', { offset: 0 });
  const importCode = unique('S9X');
  await h.q(`UPDATE personnel SET personnel_code = $2 WHERE id = $1`, [imported, importCode]);

  if ((await h.get('/api/notifications', viewer)).status !== 200) return 'the bell did not answer';
  const greet = await h.put(`/api/social/birthdays/${hidden}/greeting`, { reaction: 'cake' }, viewer);
  if (greet.status !== 200) return `greeting answered ${greet.status} ${codeOf(greet)}`;
  const live = async (userId: number, id: number) => (await h.q(
    `SELECT id FROM notifications WHERE user_id = $1 AND link LIKE $2 AND dismissed_at IS NULL`, [userId, `/?birthday=${id}-%`])).length;
  for (const id of [hidden, leaving, removed, kept, imported, moved]) {
    if (await live(viewer.userId, id) !== 1) return `the bell has no notification for a birthday of today (${id})`;
  }
  if (await live(owner.userId, hidden) !== 1) return 'the owner has no greeting notification';

  const off = await h.put('/api/social/preferences', { showBirthday: false }, owner);
  if (off.status !== 200) wrong.push(`turning the birthday off answered ${off.status} ${codeOf(off)}`);
  const [left] = await h.q(`SELECT version FROM personnel WHERE id = $1`, [leaving]);
  const leave = await h.put(`/api/personnel/${leaving}`, { version: Number(left.version), employmentStatus: 'قطع همکاری' }, manager);
  if (leave.status !== 200) wrong.push(`marking the personnel as left answered ${leave.status} ${JSON.stringify(leave.body).slice(0, 200)}`);
  const del = await h.del(`/api/personnel/${removed}`, manager);
  if (del.status !== 200) wrong.push(`deleting the personnel answered ${del.status} ${JSON.stringify(del.body).slice(0, 200)}`);
  // delta review nits 2 and 4: the Excel import marking a personnel as left, and a birth date moved off today
  const excel = await h.post('/api/personnel/bulk-import', { rows: [{ personnelCode: importCode, fullName: 'S9 withdraw excel', employmentStatus: 'قطع همکاری' }] }, manager);
  if (excel.status !== 200) wrong.push(`the Excel import answered ${excel.status} ${JSON.stringify(excel.body).slice(0, 200)}`);
  const [movedRow] = await h.q(`SELECT version FROM personnel WHERE id = $1`, [moved]);
  const moveDate = await h.put(`/api/personnel/${moved}`, { version: Number(movedRow.version), birthDate: await birthIsoFor(5) }, manager);
  if (moveDate.status !== 200) wrong.push(`moving the birth date answered ${moveDate.status} ${JSON.stringify(moveDate.body).slice(0, 200)}`);

  if (await live(viewer.userId, hidden) !== 0) wrong.push('the bell still shows a birthday its owner turned off');
  if (await live(owner.userId, hidden) !== 0) wrong.push('the owner still has the greeting notification of a hidden birthday');
  if (await live(viewer.userId, leaving) !== 0) wrong.push('the bell still shows the birthday of a personnel who left');
  if (await live(viewer.userId, removed) !== 0) wrong.push('the bell still shows the birthday of a deleted personnel');
  if (await live(viewer.userId, imported) !== 0) wrong.push('the bell still shows the birthday of a personnel the Excel import marked as left');
  if (await live(viewer.userId, moved) !== 0) wrong.push('the bell still shows a birthday whose date was moved off today');
  if (await live(viewer.userId, kept) !== 1) wrong.push('a birthday that is still shown left the bell');
  const keptRows = await h.q(`SELECT id FROM notifications WHERE user_id = $1 AND link LIKE $2`, [viewer.userId, `/?birthday=${leaving}-%`]);
  if (keptRows.length !== 1) wrong.push('the withdrawn row was not kept');
  const count = await h.get('/api/notifications/unread-count', viewer);
  const listed = (((await h.get('/api/notifications', viewer)).body as Array<{ link?: string }> | { data?: Array<{ link?: string }> }));
  const links = (Array.isArray(listed) ? listed : (listed.data ?? [])).map(n => String(n.link ?? ''));
  if ([hidden, leaving, removed].some(id => links.some(l => l.startsWith(`/?birthday=${id}-`)))) wrong.push('the bell list still carries a withdrawn birthday');
  if (count.status !== 200) wrong.push(`the unread count answered ${count.status}`);
  return wrong.length ? wrong.join('; ') : 'turned off, left (form and Excel), deleted and re-dated birthdays left every bell; the rows kept; a shown birthday stays';
}

interface PresenceRow { userId: number; name: string; avatarUrl: string; status: string }

async function presenceCase(h: Harness, wrong: string[]): Promise<string> {
  const seen = await h.sessionWith([]);
  const viewer = await h.sessionWith([]);
  const unlinked = await h.sessionWith([]);
  const linked = await h.sessionWith([]);
  const linkedPerson = await person(h, 'S9 prefs', { offset: 5, userId: linked.userId });

  await h.get('/api/social/preferences', seen);
  const res = await h.get('/api/social/presence', viewer);
  const rows = ((res.body as { data?: PresenceRow[] }).data ?? []);
  const mine = rows.find(r => r.userId === seen.userId);
  if (mine?.status !== 'online') wrong.push(`a user who just made a request is ${mine?.status ?? 'missing'}`);
  if (rows.some(r => r.userId === viewer.userId)) wrong.push('the viewer is listed to themselves');
  const keys = new Set(rows.flatMap(r => Object.keys(r)));
  if ([...keys].some(k => !['userId', 'name', 'avatarUrl', 'status'].includes(k))) wrong.push(`presence carries other keys: ${[...keys].join(',')}`);

  // review N-5: a background poll of the browser is not the user's own request, and a user without a full name is «همکار»
  const { lastSeenOf } = await import('../../lib/social/presence.js');
  const { default: request } = await import('supertest');
  const quiet = await h.sessionWith([]);
  const before = lastSeenOf(quiet.userId);
  const poll = await request(h.app as Parameters<typeof request>[0]).get('/api/notifications/unread-count').set('Cookie', quiet.cookie).set('X-ERP-Background', '1');
  if (poll.status !== 200) wrong.push(`a background poll answered ${poll.status}`);
  if (lastSeenOf(quiet.userId) !== before) wrong.push('a background poll counted as presence');
  await h.q(`UPDATE users SET full_name = '' WHERE id = $1`, [quiet.userId]);
  await h.get('/api/social/preferences', quiet);
  if (lastSeenOf(quiet.userId) === before) wrong.push('the user\'s own request did not count as presence');
  const named = (((await h.get('/api/social/presence', viewer)).body as { data?: PresenceRow[] }).data ?? []).find(r => r.userId === quiet.userId);
  if (named?.name !== COLLEAGUE_NAME) wrong.push(`a user without a full name is shown as «${named?.name ?? 'missing'}»`);

  const off = await h.put('/api/social/preferences', { showPresence: false }, seen);
  if (off.status !== 200 || (off.body as { showPresence?: boolean }).showPresence !== false) wrong.push(`turning presence off answered ${off.status}`);
  const after = ((await h.get('/api/social/presence', viewer)).body as { data?: PresenceRow[] }).data ?? [];
  if (after.some(r => r.userId === seen.userId)) wrong.push('a user who turned presence off is still listed');

  const prefs = await h.get('/api/social/preferences', unlinked);
  if ((prefs.body as { showBirthday?: unknown }).showBirthday !== null) wrong.push('a user without personnel has a birthday switch');
  const noPersonnel = await h.put('/api/social/preferences', { showBirthday: false }, unlinked);
  if (noPersonnel.status !== 422 || codeOf(noPersonnel) !== 'SOCIAL_NO_PERSONNEL') wrong.push(`hiding a birthday without personnel answered ${noPersonnel.status} ${codeOf(noPersonnel)}`);
  const hide = await h.put('/api/social/preferences', { showBirthday: false }, linked);
  if (hide.status !== 200 || (hide.body as { showBirthday?: boolean }).showBirthday !== false) wrong.push(`hiding the own birthday answered ${hide.status}`);
  const [p] = await h.q(`SELECT is_birthday_visible FROM personnel WHERE id = $1`, [linkedPerson]);
  if (Number(p.is_birthday_visible) !== 0) wrong.push('the personnel birthday flag did not change');
  const strict = await h.put('/api/social/preferences', { showBirthday: true, extra: 1 }, linked);
  if (strict.status !== 400) wrong.push(`an unknown key answered ${strict.status}`);
  const audits = await h.q(`SELECT entity FROM activity_logs WHERE user_id IN ($1, $2) AND action = 'UPDATE' ORDER BY id`, [seen.userId, linked.userId]);
  const entities = audits.map(a => String(a.entity));
  if (!entities.includes('پروفایل کاربر') || !entities.includes('پرسنل')) wrong.push(`audit entities: ${entities.join(',')}`);
  return wrong.length ? wrong.join('; ') : 'online only after a request, no other keys; both switches are the user\'s own and audited';
}

interface WhatsNew { version: string; title: string; lines: string[]; dismissed: boolean }

async function whatsNewCase(h: Harness, wrong: string[]): Promise<string> {
  const reader = await h.sessionWith([]);
  const other = await h.sessionWith([]);
  const res = await h.get('/api/social/whats-new', reader);
  const data = (res.body as { data?: WhatsNew | null }).data;
  if (!data) return 'no whats-new entry for the current version';
  if (data.version.replace(/^v/, '') !== APP_VERSION.replace(/^v/, '') || !data.title || data.dismissed) wrong.push(`unexpected entry ${JSON.stringify(data)}`);
  if (data.lines.length > 4) wrong.push(`${data.lines.length} lines instead of at most four`);
  const stale = await h.post('/api/social/whats-new/dismiss', { version: '0.0.1' }, reader);
  if (stale.status !== 422 || codeOf(stale) !== 'SOCIAL_WHATS_NEW_STALE') wrong.push(`dismissing another version answered ${stale.status} ${codeOf(stale)}`);
  const dismiss = await h.post('/api/social/whats-new/dismiss', { version: data.version }, reader);
  if ((dismiss.body as { data?: WhatsNew }).data?.dismissed !== true) wrong.push('dismissing did not answer dismissed');
  const again = (await h.get('/api/social/whats-new', reader)).body as { data?: WhatsNew };
  if (again.data?.dismissed !== true) wrong.push('the card came back after it was dismissed');
  const otherView = (await h.get('/api/social/whats-new', other)).body as { data?: WhatsNew };
  if (otherView.data?.dismissed !== false) wrong.push('one user\'s dismissal hid the card for another');
  return wrong.length ? wrong.join('; ') : 'current version shown until dismissed, per user; another version refused';
}
