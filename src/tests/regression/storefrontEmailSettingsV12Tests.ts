import net from 'net';
import request from 'supertest';
import { and, desc, eq, like } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { activityLogs, appSettings } from '../../db/schema.js';
import { decryptSecret } from '../../lib/secretBox.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { STOREFRONT_EMAIL_SETTING_KEYS } from '../../lib/storefront/storefrontEmailContracts.js';
import { EMAIL_TEST_SMTP_ENV } from '../../services/storefront/storefrontEmailClient.js';

/**
 * v12 phase 8e (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §5, owner's decision 7): the settings of the site's email and
 * its test mail on real Express routes and PostgreSQL, against a fake mail server on this machine
 * (`ERP_EMAIL_TEST_SMTP`, honoured only in the database tests):
 *
 * - Email is off until it is turned on with a server name and a sender; a malformed name, port or sender is 422.
 * - The password is stored encrypted, never answered and never written to the audit row; the sender address is audited
 *   masked; a stale version is 409.
 * - A test mail reaches the server signed in with the stored user and password and carries the fixed subject and text.
 * - A stored password never follows a changed server or user name; a wrong password is a Persian refusal, never the
 *   server's own words; an inside address (and this machine on any other port) is refused at the save, and so is a user
 *   name without encryption (only this test's own server speaks plain).
 */

interface Session { cookie: string; csrfToken: string }
type Body = Record<string, unknown>;
interface Received { auth: string; from: string; to: string[]; data: string }

const USER = 'shop-mailer';
const PASSWORD = 'Mail-Secret-Pass-9431';

/** A mail server that speaks just enough SMTP for one mail per connection, signing in with PLAIN */
async function fakeMailServer() {
  const received: Received[] = [];
  const server = net.createServer((socket) => {
    let buffer = '';
    let inData = false;
    const current: Received = { auth: '', from: '', to: [], data: '' };
    socket.write('220 fake.mail ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      while (true) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end < 0) return;
          current.data = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          inData = false;
          received.push({ ...current, to: [...current.to] });
          socket.write('250 2.0.0 queued\r\n');
          continue;
        }
        const nl = buffer.indexOf('\r\n');
        if (nl < 0) return;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        const verb = line.split(' ')[0].toUpperCase();
        if (verb === 'EHLO' || verb === 'HELO') socket.write('250-fake.mail\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n');
        else if (verb === 'AUTH') {
          const plain = Buffer.from(line.split(' ')[2] ?? '', 'base64').toString('utf8');
          current.auth = plain;
          socket.write(plain === `\u0000${USER}\u0000${PASSWORD}` ? '235 2.7.0 ok\r\n' : '535 5.7.8 bad credentials for shop-mailer\r\n');
        } else if (verb === 'MAIL') { current.from = line; socket.write('250 ok\r\n'); }
        else if (verb === 'RCPT') { current.to.push(line); socket.write('250 ok\r\n'); }
        else if (verb === 'DATA') { inData = true; socket.write('354 go\r\n'); }
        else if (verb === 'QUIT') { socket.end('221 bye\r\n'); return; }
        else if (verb === 'RSET' || verb === 'NOOP') socket.write('250 ok\r\n');
        else socket.write('502 no\r\n');
      }
    });
    socket.on('error', () => undefined);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as net.AddressInfo).port;
  return { received, port, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

export async function runStorefrontEmailSettingsV12Tests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_storefront_email_settings_v12_p8e';
  if (!shouldRun(id, 'v12', 'phase8', 'storefront', 'email', 'security')) return results;

  const name = 'v12 phase 8e: site email settings: off until whole, the password encrypted and never answered or audited, the sender and user audited masked, a stale save 409; a test mail signs in and arrives; a stored password never follows a new server; a refused sign-in is a Persian refusal; an inside address and a plain sign-in are refused at the save';
  const tStart = Date.now();
  const savedSettings = await orm.select().from(appSettings).where(like(appSettings.key, 'sf\\_email\\_%'));
  const savedEnv = process.env[EMAIL_TEST_SMTP_ENV];
  const mail = await fakeMailServer();
  try {
    process.env[EMAIL_TEST_SMTP_ENV] = `127.0.0.1:${mail.port}`;
    await orm.delete(appSettings).where(like(appSettings.key, 'sf\\_email\\_%'));
    invalidateSettingsCache();
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const app = await getTestApp();
    const admin: Session = await getAdminSession();
    const erp = {
      get: (url: string) => request(app).get(url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken),
      put: (url: string, body: Body) => request(app).put(url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body),
      post: (url: string, body: Body = {}) => request(app).post(url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body),
    };
    const wrong: string[] = [];
    const tag = String(Date.now()).slice(-7);
    const sender = `shop.${tag}@papital-test.example`;
    const base = {
      enabled: false, host: '', port: mail.port, security: 'none', username: '', password: '', clearPassword: false, fromAddress: '', fromName: 'پاپیتال',
    };

    // 1) off and empty at first; turning it on without a server or a sender, or with a malformed one, is 422
    let view = (await erp.get('/api/storefront/email/settings')).body.data;
    if (view?.enabled !== false || view?.ready !== false || view?.password?.configured !== false) wrong.push(`first view: ${JSON.stringify(view)}`);
    const refusals: Array<[string, Body, string]> = [
      ['no server', { ...base, enabled: true, fromAddress: sender }, 'STOREFRONT_EMAIL_NEEDS_HOST'],
      ['no sender', { ...base, enabled: true, host: '127.0.0.1' }, 'STOREFRONT_EMAIL_NEEDS_FROM'],
      ['a server with a scheme', { ...base, host: 'smtp://mail.example.com' }, 'STOREFRONT_EMAIL_HOST_INVALID'],
      ['a malformed sender', { ...base, fromAddress: 'shop@' }, 'STOREFRONT_EMAIL_FROM_INVALID'],
      ['a user without a password', { ...base, enabled: true, host: '127.0.0.1', fromAddress: sender, username: USER }, 'STOREFRONT_EMAIL_NEEDS_PASSWORD'],
      ['a header in the sender name', { ...base, fromName: 'x\r\nBcc: a@b.c' }, 'STOREFRONT_EMAIL_FROM_NAME_INVALID'],
    ];
    for (const [label, body, code] of refusals) {
      const res = await erp.put('/api/storefront/email/settings', { ...body, version: view.version });
      if (res.status !== 422 || res.body.code !== code) wrong.push(`${label}: ${res.status} ${res.body.code}`);
    }

    // 2) a whole save: on and ready, the password encrypted, never answered, never audited; the sender audited masked
    const saved = await erp.put('/api/storefront/email/settings', {
      ...base, enabled: true, host: '127.0.0.1', username: USER, password: PASSWORD, fromAddress: sender, version: view.version,
    });
    view = saved.body.data;
    if (saved.status !== 200 || view?.ready !== true || view?.password?.configured !== true || view?.password?.readable !== true) wrong.push(`save: ${saved.status} ${JSON.stringify(saved.body)}`);
    if (JSON.stringify(saved.body).includes(PASSWORD)) wrong.push('the answer carries the password');
    const [stored] = await orm.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, STOREFRONT_EMAIL_SETTING_KEYS.password));
    if (!stored?.value || stored.value.includes(PASSWORD) || decryptSecret(stored.value) !== PASSWORD) wrong.push('the password is not stored encrypted');
    const [audit] = await orm.select({ details: activityLogs.details }).from(activityLogs)
      .where(and(eq(activityLogs.entity, 'فروشگاه سایت'), eq(activityLogs.entityId, 'email'))).orderBy(desc(activityLogs.id)).limit(1);
    const auditText = JSON.stringify(audit?.details ?? '');
    if (!audit || auditText.includes(PASSWORD) || auditText.includes(sender) || auditText.includes(USER) || !auditText.includes('papital-test.example')) wrong.push(`audit row: ${auditText.slice(0, 300)}`);
    const stale = await erp.put('/api/storefront/email/settings', { ...base, enabled: false, version: view.version - 1 });
    if (stale.status !== 409) wrong.push(`a stale save: ${stale.status}`);

    // 3) a test mail signs in with the stored user and password and arrives with the fixed subject and text
    const to = `buyer.${tag}@papital-test.example`;
    const sent = await erp.post('/api/storefront/email/test', { to });
    if (sent.status !== 200 || sent.body.data?.sent !== true) wrong.push(`test mail: ${sent.status} ${JSON.stringify(sent.body)}`);
    const got = mail.received.at(-1);
    if (!got || got.auth !== `\u0000${USER}\u0000${PASSWORD}` || !got.to.some(r => r.includes(to)) || !got.from.includes(sender)) wrong.push(`the mail server got ${JSON.stringify(got)}`);
    if (got && !/Subject: =\?UTF-8\?/i.test(got.data)) wrong.push('the test mail has no encoded Persian subject');
    const badTo = await erp.post('/api/storefront/email/test', { to: 'not-an-address' });
    if (badTo.status !== 422 || badTo.body.code !== 'STOREFRONT_EMAIL_TO_INVALID') wrong.push(`a malformed recipient: ${badTo.status}`);

    // 4) the stored password never follows a new server or user name
    const moved = await erp.put('/api/storefront/email/settings', {
      ...base, enabled: true, host: 'mail.papital-test.example', security: 'starttls', username: USER, fromAddress: sender, version: view.version,
    });
    if (moved.status !== 422 || moved.body.code !== 'STOREFRONT_EMAIL_PASSWORD_FOR_OTHER_SERVER') wrong.push(`a new server with the stored password: ${moved.status} ${moved.body.code}`);

    // 5) a refused sign-in is a Persian sentence, never the server's own words
    const badPass = await erp.put('/api/storefront/email/settings', {
      ...base, enabled: true, host: '127.0.0.1', username: USER, password: 'wrong-pass-0000', fromAddress: sender, version: view.version,
    });
    view = badPass.body.data;
    const refused = await erp.post('/api/storefront/email/test', { to });
    if (refused.body.data?.sent !== false || !/نام کاربری یا رمز/.test(refused.body.data?.error ?? '') || /shop-mailer|535/.test(JSON.stringify(refused.body))) {
      wrong.push(`a refused sign-in: ${JSON.stringify(refused.body)}`);
    }

    // 6) an inside address, and this machine on another port, are refused at the save; a user name without encryption too
    for (const host of ['10.20.30.40', '127.0.0.1']) {
      const res = await erp.put('/api/storefront/email/settings', {
        ...base, enabled: false, host, port: mail.port + 1, username: '', clearPassword: true, fromAddress: sender, version: view.version,
      });
      if (res.status !== 422 || res.body.code !== 'STOREFRONT_EMAIL_HOST_INSIDE') wrong.push(`${host} saved: ${res.status} ${res.body.code}`);
    }
    const plain = await erp.put('/api/storefront/email/settings', {
      ...base, enabled: false, host: 'mail.papital-test.example', username: USER, password: PASSWORD, fromAddress: sender, version: view.version,
    });
    if (plain.status !== 422 || plain.body.code !== 'STOREFRONT_EMAIL_PLAIN_SIGN_IN') wrong.push(`a user name without encryption: ${plain.status} ${plain.body.code}`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'email was off and empty; on without a server or sender, a scheme in the server, a malformed sender, a user without a password and a header in the sender name were each 422; a whole save was ready with the password encrypted, absent from the answer and the audit row, and the sender and user name audited masked; a stale save was 409; a test mail signed in with the stored user and password and arrived with an encoded Persian subject; a malformed recipient was 422; a new server with the stored password was 422; a refused sign-in was a Persian sentence without the server\'s words; an inside address, this machine on another port and a user name without encryption were refused at the save',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? `${err.message} ${err.stack ?? ''}` : String(err),
    }));
  } finally {
    await mail.close().catch(() => undefined);
    if (savedEnv === undefined) delete process.env[EMAIL_TEST_SMTP_ENV];
    else process.env[EMAIL_TEST_SMTP_ENV] = savedEnv;
    await orm.delete(appSettings).where(like(appSettings.key, 'sf\\_email\\_%')).catch(() => undefined);
    if (savedSettings.length > 0) await orm.insert(appSettings).values(savedSettings).catch(() => undefined);
    invalidateSettingsCache();
  }
  return results;
}
