import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { and, eq, inArray } from 'drizzle-orm';
import { TestCaseResult } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { fileAttachments, integrationDeliveryJobs, journalVouchers, notifications, personnel, userMessengerLinks, users } from '../../db/schema.js';
import { runCase, type Harness, type Row, type ShouldRun } from './workflowTestHarness.js';

/**
 * v11 phase 6.2 (security, card ت۵۶-۸, findings X4 to X20 of the security evaluation): each case drives the real Express
 * routes and fails on the code before the phase.
 */

const errorText = (res: { body?: { error?: unknown; message?: unknown; code?: unknown } }) =>
  String(res.body?.error ?? res.body?.message ?? '');

const dataUrl = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString('base64')}`;
const PNG_BYTES = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const HTML_BYTES = Buffer.from('<html><body><script>alert(1)</script></body></html>', 'utf8');

async function draftVoucherWith(h: Harness, attachments: unknown[]): Promise<number> {
  const { VoucherService } = await import('../../services/accounting/voucher.service.js');
  const { ChartOfAccountsService } = await import('../../services/accounting/chartOfAccounts.service.js');
  const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
  await ChartOfAccountsService.seedStandardAccounts();
  const accounts = await ChartOfAccountsService.getAllAccounts();
  const debit = accounts.find(a => a.code === '1101') ?? accounts.find(a => a.accountType === 'asset');
  const credit = accounts.find(a => a.code === '6001') ?? accounts.find(a => a.accountType === 'revenue');
  if (!debit || !credit) throw new Error('accounts for the test voucher were not found');
  const created = await VoucherService.createJournalVoucher({
    date: await businessTodayIsoDate(), voucherType: 'general', status: 'draft', description: `X12 test ${h.tag}`,
    referenceModule: 'manual', referenceNumber: `X12-${h.tag}`, username: `uploader_${h.tag}`, attachments,
    items: [
      { accountId: debit.id, detailedType: 'other', detailedName: 'آزمون', debit: 100, credit: 0, description: 'بدهکار' },
      { accountId: credit.id, detailedType: 'other', detailedName: 'آزمون', debit: 0, credit: 100, description: 'بستانکار' },
    ],
  } as never) as { id: number };
  return created.id;
}

const storedAttachments = async (voucherId: number): Promise<Row[]> => {
  const [row] = await orm.select({ attachments: journalVouchers.attachments }).from(journalVouchers).where(eq(journalVouchers.id, voucherId));
  return Array.isArray(row?.attachments) ? row.attachments as unknown as Row[] : [];
};

export async function runSecurityHardeningV11Tests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('sec_cookie_hsts_v11_6_2', 'security', 'x11', 'x19', 'v11_6_2')) {
    await runCase(results, {
      id: 'sec_cookie_hsts_v11_6_2',
      name: 'v11 phase 6.2: the session cookie is SameSite=Lax and HSTS covers only this host without preload (X11, X19)',
      details: 'A login over HTTPS (X-Forwarded-Proto) sets auth_token with SameSite=Lax; before it was SameSite=None. The HTTPS answer carries Strict-Transport-Security max-age=31536000 without includeSubDomains or preload',
    }, async (h, wrong) => {
      const { createTestUser, TEST_PASSWORD } = await import('../fixtures/factories.js');
      const { resetLoginRateLimiter } = await import('../../app.js');
      const user = await createTestUser({ role: 'daily_logger' });
      try {
        const login = await request(h.app as never).post('/api/auth/login').set('X-Forwarded-Proto', 'https')
          .send({ username: user.username, password: TEST_PASSWORD });
        const cookie = ([] as string[]).concat(login.headers['set-cookie'] ?? []).find(c => c.startsWith('auth_token='));
        if (login.status !== 200 || !cookie) wrong.push(`the HTTPS login returned ${login.status} without an auth_token cookie`);
        else {
          if (!/;\s*SameSite=Lax/i.test(cookie)) wrong.push(`the session cookie is not SameSite=Lax: ${cookie.replace(/auth_token=[^;]+/, 'auth_token=…')}`);
          if (!/;\s*Secure/i.test(cookie)) wrong.push('the HTTPS session cookie is not Secure');
        }
        const hsts = String(login.headers['strict-transport-security'] ?? '');
        if (hsts !== 'max-age=31536000') wrong.push(`the HTTPS answer sends HSTS «${hsts}», not «max-age=31536000»`);
      } finally {
        await orm.delete(users).where(eq(users.id, user.id)).catch(() => undefined);
        resetLoginRateLimiter();
      }
    });
  }

  if (shouldRun('sec_attachment_hardening_v11_6_2', 'security', 'x11', 'x12', 'x16', 'x20', 'attachments', 'v11_6_2')) {
    await runCase(results, {
      id: 'sec_attachment_hardening_v11_6_2',
      name: 'v11 phase 6.2: a record file names its real uploader and type, is same-origin, and is gone with its deleted record (X11, X12, X16, X20)',
      details: 'A draft voucher saved with a client uploadedBy «Someone Else» and a 2020 date stores the session user and the server time; an edit sending a forged uploader for the stored file keeps the stored one, and so does an inline file of an older record (not yet moved to a file) sent back with a forged uploader; HTML bytes declared image/png are stored as application/octet-stream and download as an attachment; the file answer has CORP same-origin; after the voucher is deleted its file is 404 (before, only sales files and activities were checked)',
    }, async (h, wrong) => {
      const { VoucherService } = await import('../../services/accounting/voucher.service.js');
      const voucherId = await draftVoucherWith(h, [
        { id: 'x12png', name: 'receipt.png', url: dataUrl('image/png', PNG_BYTES), uploadedBy: 'Someone Else', uploadedAt: '2020-01-01T00:00:00.000Z' },
        { id: 'x16html', name: 'fake.png', url: dataUrl('image/png', HTML_BYTES) },
      ]);
      try {
        const list = await storedAttachments(voucherId);
        const png = list.find(a => a.name === 'receipt.png');
        const fake = list.find(a => a.name === 'fake.png');
        if (png?.uploadedBy !== `uploader_${h.tag}`) wrong.push(`a new file was stored with uploader «${String(png?.uploadedBy)}», not the session user`);
        if (!String(png?.uploadedAt ?? '').startsWith(new Date().toISOString().slice(0, 4))) wrong.push(`a new file was stored with the client time «${String(png?.uploadedAt)}»`);
        if (fake?.type !== 'application/octet-stream') wrong.push(`HTML bytes declared image/png were stored as «${String(fake?.type)}»`);

        // an older record still holding an inline file (the migration to files never ran on it)
        const inline = { id: 'x12inline', name: 'old.png', url: dataUrl('image/png', PNG_BYTES), uploadedBy: 'Old Uploader', uploadedAt: '2020-02-02T00:00:00.000Z' };
        await orm.update(journalVouchers).set({ attachments: [...list, inline] as never }).where(eq(journalVouchers.id, voucherId));
        await VoucherService.updateJournalVoucher(voucherId, { attachments: [{ ...png, uploadedBy: 'Someone Else' }, fake, { ...inline, uploadedBy: 'Someone Else' }] } as never);
        const afterEdit = await storedAttachments(voucherId);
        const kept = afterEdit.find(a => a.name === 'receipt.png');
        if (kept?.uploadedBy !== `uploader_${h.tag}` || kept?.uploadedAt !== png?.uploadedAt) {
          wrong.push(`an edit changed the stored uploader to «${String(kept?.uploadedBy)}» at «${String(kept?.uploadedAt)}»`);
        }
        const old = afterEdit.find(a => a.name === 'old.png');
        if (old?.uploadedBy !== 'Old Uploader' || old?.uploadedAt !== inline.uploadedAt || !String(old?.url ?? '').startsWith('/api/attachments/')) {
          wrong.push(`an edit sending back an inline file stored it as ${String(old?.url).slice(0, 20)} by «${String(old?.uploadedBy)}» at «${String(old?.uploadedAt)}», not by its original uploader`);
        }

        const pngRes = await h.get(String(png?.url));
        if (pngRes.status !== 200 || pngRes.headers['cross-origin-resource-policy'] !== 'same-origin') {
          wrong.push(`the file answered ${pngRes.status} with CORP «${String(pngRes.headers['cross-origin-resource-policy'])}», not same-origin`);
        }
        const fakeRes = await h.get(String(fake?.url));
        if (fakeRes.status !== 200 || !String(fakeRes.headers['content-disposition'] ?? '').startsWith('attachment')
          || fakeRes.headers['content-type'] !== 'application/octet-stream') {
          wrong.push(`the HTML file declared as an image answered ${fakeRes.status} ${String(fakeRes.headers['content-type'])} ${String(fakeRes.headers['content-disposition'])}`);
        }

        const deleted = await h.del(`/api/accounting/vouchers/${voucherId}`);
        if (deleted.status !== 200) wrong.push(`deleting the draft voucher returned ${deleted.status}: ${errorText(deleted)}`);
        else {
          const gone = await h.get(String(png?.url));
          if (gone.status !== 404) wrong.push(`the file of a deleted voucher answered ${gone.status}, not 404`);
        }
      } finally {
        const rows = await orm.select({ storagePath: fileAttachments.storagePath }).from(fileAttachments)
          .where(and(eq(fileAttachments.entityType, 'journal_voucher'), eq(fileAttachments.entityId, voucherId)));
        const { AttachmentStorageService } = await import('../../services/attachments/attachmentStorage.service.js');
        for (const r of rows) fs.rmSync(AttachmentStorageService.absolutePath(r.storagePath), { force: true });
      }
    });
  }

  if (shouldRun('sec_upload_bytes_avatar_v11_6_2', 'security', 'x16', 'profile', 'v11_6_2')) {
    await runCase(results, {
      id: 'sec_upload_bytes_avatar_v11_6_2',
      name: 'v11 phase 6.2: an image field takes only image bytes, and a profile picture is a new image or the user\'s own (X16)',
      details: 'HTML bytes sent as data:image/png to the profile are 422 IMAGE_FORMAT_INVALID and nothing is stored; a PNG declared as image/jpeg is stored as .png; another user\'s stored picture is refused with 400 and the user\'s own one is kept',
    }, async (h, wrong) => {
      const { AVATAR_INVALID_MESSAGE } = await import('../../lib/users/profileFields.js');
      const owner = await h.sessionWith(['documents.view']);
      const other = await h.sessionWith(['documents.view']);
      const avatarOf = async (userId: number) => String((await h.q('SELECT avatar_url FROM users WHERE id = $1', [userId]))[0]?.avatar_url ?? '');
      const stored: string[] = [];
      try {
        const html = await h.put('/api/users/profile', { avatar: dataUrl('image/png', HTML_BYTES) }, owner);
        if (html.status !== 422 || html.body?.code !== 'IMAGE_FORMAT_INVALID') wrong.push(`HTML bytes as a profile picture returned ${html.status} ${String(html.body?.code)}`);
        if (await avatarOf(owner.userId) !== '') wrong.push('HTML bytes were stored as a profile picture');

        const mislabeled = await h.put('/api/users/profile', { avatar: dataUrl('image/jpeg', PNG_BYTES) }, owner);
        const ownPath = await avatarOf(owner.userId);
        if (ownPath) stored.push(ownPath);
        if (mislabeled.status !== 200 || !/\.png$/.test(ownPath)) wrong.push(`a PNG declared as JPEG returned ${mislabeled.status} and was stored as «${ownPath}»`);

        const borrowed = await h.put('/api/users/profile', { avatar: ownPath }, other);
        if (borrowed.status !== 400 || !errorText(borrowed).includes(AVATAR_INVALID_MESSAGE)) wrong.push(`another user's picture as one's own returned ${borrowed.status} «${errorText(borrowed)}»`);
        if (await avatarOf(other.userId) !== '') wrong.push('another user\'s picture was stored');
        const kept = await h.put('/api/users/profile', { avatar: ownPath, full_name: `X16 ${h.tag}` }, owner);
        if (kept.status !== 200 || await avatarOf(owner.userId) !== ownPath) wrong.push(`keeping one's own picture returned ${kept.status}`);
      } finally {
        for (const p of stored) fs.rmSync(path.join(process.cwd(), 'public', p), { force: true });
      }
    });
  }

  if (shouldRun('sec_setup_token_outside_tests_v11_6_2', 'security', 'x18', 'setup', 'v11_6_2')) {
    await runCase(results, {
      id: 'sec_setup_token_outside_tests_v11_6_2',
      name: 'v11 phase 6.2: setup outside the test environment refuses a missing or built-in token (X18)',
      details: 'With NODE_ENV=development, POST /setup without ERP_SETUP_TOKEN, or with the built-in one sent as the token, is 401 with the «not configured» message; before, the built-in token was accepted outside production',
    }, async (h, wrong) => {
      const { SETUP_TOKEN_NOT_CONFIGURED_MESSAGE } = await import('../../lib/auth/setupRules.js');
      const { TEST_SETUP_TOKEN } = await import('../../services/auth/setupToken.js');
      const before = { env: process.env.NODE_ENV, token: process.env.ERP_SETUP_TOKEN };
      try {
        process.env.NODE_ENV = 'development';
        for (const configured of [undefined, TEST_SETUP_TOKEN]) {
          if (configured === undefined) delete process.env.ERP_SETUP_TOKEN;
          else process.env.ERP_SETUP_TOKEN = configured;
          const res = await request(h.app as never).post('/api/setup').set('x-setup-token', TEST_SETUP_TOKEN)
            .send({ username: `x18_${h.tag}`, password: 'abcd12345678', fullName: 'X18', companyName: 'X18' });
          if (res.status !== 401 || !errorText(res).includes(SETUP_TOKEN_NOT_CONFIGURED_MESSAGE)) {
            wrong.push(`setup with ERP_SETUP_TOKEN ${configured ? 'set to the built-in token' : 'unset'} returned ${res.status} «${errorText(res).slice(0, 120)}»`);
          }
        }
      } finally {
        process.env.NODE_ENV = before.env;
        if (before.token === undefined) delete process.env.ERP_SETUP_TOKEN;
        else process.env.ERP_SETUP_TOKEN = before.token;
        await h.q('DELETE FROM users WHERE username = $1', [`x18_${h.tag}`]);
      }
    });
  }

  if (shouldRun('sec_route_table_all_rows_v11_6_2', 'security', 'x14', 'routes', 'v11_6_2')) {
    await runCase(results, {
      id: 'sec_route_table_all_rows_v11_6_2',
      name: 'v11 phase 6.2: the route table lists the router.all webhooks as public ALL rows (X14)',
      details: 'buildRouteGuardTable has «ALL /api/woocommerce/webhook/order» and «ALL /api/events/webhook-echo», both unauthenticated, as authenticateToken lets them through; before, router.all routes were left out',
    }, async (h, wrong) => {
      const { buildRouteGuardTable } = await import('../../lib/routeGuardTable.js');
      const rows = buildRouteGuardTable(h.app as never);
      for (const key of ['ALL /api/woocommerce/webhook/order', 'ALL /api/events/webhook-echo']) {
        const row = rows.find(r => `${r.method} ${r.path}` === key);
        if (!row) wrong.push(`${key} is missing from the route table`);
        else if (row.authenticated) wrong.push(`${key} is listed as needing a login, though authenticateToken lets it through`);
      }
    });
  }

  if (shouldRun('sec_login_lock_answers_not_counted_v11_6_2', 'security', 'x15', 'login', 'v11_6_2')) {
    await runCase(results, {
      id: 'sec_login_lock_answers_not_counted_v11_6_2',
      name: 'v11 phase 6.2: one user\'s locked login does not close the login for others behind the same address, and every checked password counts (X15)',
      details: 'From one address, one user fails 5 times (the pair locks) and retries until the attempts pass the 30-failure address bucket; another user then logs in from the same address with 200. From another address, 30 wrong passwords over 6 user names (each fifth one answers 429 as it starts the pair lock) fill the bucket, so the next login is the address limiter\'s 429. Before, the lock answers counted against a 10-failure bucket and the office was locked out for 15 minutes',
    }, async (h, wrong) => {
      const { createTestUser, TEST_PASSWORD } = await import('../fixtures/factories.js');
      const { resetLoginRateLimiter } = await import('../../app.js');
      const { LOCKOUT_THRESHOLD, LOGIN_ADDRESS_MAX_FAILURES, resetFailedAttempts, resetPhantomLockouts } = await import('../../services/auth/loginSecurity.service.js');
      const office = '198.51.100.150';
      const sprayer = '198.51.100.151';
      const forgetful = await createTestUser({ role: 'daily_logger' });
      const colleague = await createTestUser({ role: 'daily_logger' });
      const login = (ip: string, username: string, password: string) => request(h.app as never).post('/api/auth/login')
        .set('X-Forwarded-For', ip).send({ username, password });
      resetLoginRateLimiter();
      resetPhantomLockouts();
      try {
        // 1) answers refused by the pair lock before any password check do not fill the address bucket
        const statuses: number[] = [];
        for (let i = 0; i < LOGIN_ADDRESS_MAX_FAILURES + 5; i++) statuses.push((await login(office, forgetful.username, 'wrong-password-x15')).status);
        if (!statuses.includes(429)) wrong.push(`${statuses.length} wrong passwords never locked the pair: ${statuses.join(',')}`);
        const other = await login(office, colleague.username, TEST_PASSWORD);
        if (other.status !== 200) wrong.push(`a colleague behind the same address got ${other.status} after one user's lock (${statuses.join(',')})`);

        // 2) a wrong password that starts a pair lock (429) still counts: 30 checked failures fill the bucket
        const spray: number[] = [];
        for (let i = 0; i < LOGIN_ADDRESS_MAX_FAILURES; i++) {
          spray.push((await login(sprayer, `x15_spray_${Math.floor(i / LOCKOUT_THRESHOLD)}_${h.tag}`, 'wrong-password-x15')).status);
        }
        const next = await login(sprayer, `x15_spray_next_${h.tag}`, 'wrong-password-x15');
        if (next.status !== 429 || next.body?.locked !== true) {
          wrong.push(`after ${LOGIN_ADDRESS_MAX_FAILURES} checked wrong passwords (${spray.join(',')}) the next login answered ${next.status} ${JSON.stringify(next.body)}, not the address limiter's 429`);
        }
      } finally {
        await resetFailedAttempts(forgetful.id, { username: forgetful.username, ip: office }).catch(() => undefined);
        await orm.delete(users).where(inArray(users.id, [forgetful.id, colleague.id])).catch(() => undefined);
        resetPhantomLockouts();
        resetLoginRateLimiter();
      }
    });
  }

  if (shouldRun('sec_role_removal_within_own_v11_6_2', 'security', 'x5', 'roles', 'v11_6_2')) {
    await runCase(results, {
      id: 'sec_role_removal_within_own_v11_6_2',
      name: 'v11 phase 6.2: a role administrator removes from a role only permissions they hold (X5)',
      details: 'A holder of roles.manage and documents.view empties a role that also has accounting.view: 403 GRANT_BEYOND_OWN_PERMISSIONS and the role keeps both; removing only documents.view goes through; deleting the role (it still has accounting.view) is 403 too and the role stays; before, any permission could be removed',
    }, async (h, wrong) => {
      const { createTestRole } = await import('../fixtures/factories.js');
      const { deleteTestRoles } = await import('../fixtures/roleCleanup.js');
      const { roles } = await import('../../db/schema.js');
      const manager = await h.sessionWith(['roles.manage', 'documents.view']);
      const target = await createTestRole({ permissions: ['accounting.view', 'documents.view'] });
      const permissionsOf = async () => ((await h.q('SELECT permissions FROM roles WHERE id = $1', [target.id]))[0]?.permissions ?? []) as string[];
      try {
        const emptied = await h.put(`/api/roles/${target.id}`, { name: target.name, permissions: [] }, manager);
        if (emptied.status !== 403 || emptied.body?.code !== 'GRANT_BEYOND_OWN_PERMISSIONS') wrong.push(`removing a permission the editor lacks returned ${emptied.status} ${String(emptied.body?.code)}`);
        if (!(await permissionsOf()).includes('accounting.view')) wrong.push('the refused edit removed accounting.view');
        const own = await h.put(`/api/roles/${target.id}`, { name: target.name, permissions: ['accounting.view'] }, manager);
        const after = await permissionsOf();
        if (own.status !== 200 || after.includes('documents.view') || !after.includes('accounting.view')) {
          wrong.push(`removing only the editor's own permission returned ${own.status} and left ${JSON.stringify(after)}`);
        }
        const deleted = await h.del(`/api/roles/${target.id}`, manager);
        if (deleted.status !== 403 || deleted.body?.code !== 'GRANT_BEYOND_OWN_PERMISSIONS') wrong.push(`deleting a role with a permission the editor lacks returned ${deleted.status} ${String(deleted.body?.code)}`);
        if ((await h.q('SELECT 1 FROM roles WHERE id = $1', [target.id])).length === 0) wrong.push('the refused delete removed the role');
      } finally {
        await deleteTestRoles(inArray(roles.id, [target.id])).catch(() => undefined);
      }
    });
  }

  if (shouldRun('sec_personnel_user_link_rights_v11_6_2', 'security', 'x6', 'personnel', 'payroll', 'v11_6_2')) {
    await runCase(results, {
      id: 'sec_personnel_user_link_rights_v11_6_2',
      name: 'v11 phase 6.2: linking a person to an account needs users.manage, goes through an unlink, is audited and told to both accounts (X6)',
      details: 'A holder of personnel.manage alone linking an account is 403 PERSONNEL_USER_LINK_FORBIDDEN, though editing other fields with the same link goes through; the admin moving a linked person straight to another account is 409 PERSONNEL_USER_RELINK_REFUSED; unlinking then linking goes through, with one audit row «پیوند حساب کاربری» per change and a notice to the account that loses the person and to the one that gains it, kept in the bell: none goes to a linked messenger, where the payslip category would read «فیش حقوق شما تأیید شد.»',
    }, async (h, wrong) => {
      const { personnelVersion } = await import('../fixtures/personnelVersion.js');
      const manager = await h.sessionWith(['personnel.view', 'personnel.manage']);
      const first = await h.sessionWith(['daily_logs.view']);
      const second = await h.sessionWith(['daily_logs.view']);
      const created = await h.post('/api/personnel', { firstName: 'پیوند', lastName: `X6 ${h.tag}` });
      const pid = Number(created.body?.id);
      const edit = async (body: Row, s = h.admin) => h.put(`/api/personnel/${pid}`, { version: await personnelVersion(pid), firstName: 'پیوند', lastName: `X6 ${h.tag}`, ...body }, s);
      const linkedTo = async () => (await h.q('SELECT user_id FROM personnel WHERE id = $1', [pid]))[0]?.user_id ?? null;
      const [messengerLink] = await orm.insert(userMessengerLinks)
        .values({ userId: first.userId, messenger: 'telegram', chatId: `x6-${h.tag}`, chatName: 'test' }).returning({ id: userMessengerLinks.id });
      try {
        if (created.status !== 201) throw new Error(`creating the person returned ${created.status}: ${errorText(created)}`);
        const byManager = await edit({ userId: first.userId }, manager);
        if (byManager.status !== 403 || byManager.body?.code !== 'PERSONNEL_USER_LINK_FORBIDDEN') wrong.push(`personnel.manage alone linking an account returned ${byManager.status} ${String(byManager.body?.code)}`);
        if (await linkedTo() !== null) wrong.push('the refused link was stored');

        const linked = await edit({ userId: first.userId });
        if (linked.status !== 200 || Number(await linkedTo()) !== first.userId) wrong.push(`the admin linking an account returned ${linked.status}`);
        const managerKeeps = await edit({ userId: first.userId, jobTitle: 'زرگر' }, manager);
        if (managerKeeps.status !== 200) wrong.push(`personnel.manage editing a field with the same link returned ${managerKeeps.status}: ${errorText(managerKeeps)}`);

        const moved = await edit({ userId: second.userId });
        if (moved.status !== 409 || moved.body?.code !== 'PERSONNEL_USER_RELINK_REFUSED') wrong.push(`moving the link straight to another account returned ${moved.status} ${String(moved.body?.code)}`);
        const unlinked = await edit({ userId: null });
        const relinked = await edit({ userId: second.userId });
        if (unlinked.status !== 200 || relinked.status !== 200 || Number(await linkedTo()) !== second.userId) {
          wrong.push(`unlinking then linking returned ${unlinked.status} and ${relinked.status}`);
        }

        const audits = await h.q(`SELECT description FROM activity_logs WHERE entity = 'پرسنل' AND entity_id = $1 AND description LIKE '%پیوند حساب کاربری%' ORDER BY id`, [String(pid)]);
        if (audits.length !== 3) wrong.push(`${audits.length} link audit rows, expected 3 (link, unlink, link): ${audits.map(a => String(a.description)).join(' | ')}`);
        const noticesOf = async (userId: number) => (await orm.select({ title: notifications.title }).from(notifications).where(eq(notifications.userId, userId))).map(n => n.title);
        const firstNotices = await noticesOf(first.userId);
        const secondNotices = await noticesOf(second.userId);
        if (firstNotices.length !== 2) wrong.push(`the first account got ${firstNotices.length} notices, expected the link and the unlink: ${firstNotices.join(' | ')}`);
        if (secondNotices.length !== 1) wrong.push(`the second account got ${secondNotices.length} notices, expected one: ${secondNotices.join(' | ')}`);
        const sent = await orm.select({ id: integrationDeliveryJobs.id }).from(integrationDeliveryJobs).where(and(eq(integrationDeliveryJobs.kind, 'messenger'), eq(integrationDeliveryJobs.targetId, messengerLink.id)));
        if (sent.length !== 0) wrong.push(`${sent.length} link notices were queued for the messenger, where they would read as an approved payslip`);
      } finally {
        await orm.delete(integrationDeliveryJobs).where(and(eq(integrationDeliveryJobs.kind, 'messenger'), eq(integrationDeliveryJobs.targetId, messengerLink.id))).catch(() => undefined);
        await orm.delete(userMessengerLinks).where(eq(userMessengerLinks.id, messengerLink.id)).catch(() => undefined);
        await orm.delete(notifications).where(inArray(notifications.userId, [first.userId, second.userId])).catch(() => undefined);
        if (pid > 0) await orm.delete(personnel).where(eq(personnel.id, pid)).catch(() => undefined);
      }
    });
  }

  return results;
}
