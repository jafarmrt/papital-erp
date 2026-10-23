import crypto from 'node:crypto';
import request from 'supertest';
import type { PoolClient } from 'pg';
import { eq, sql } from 'drizzle-orm';
import { orm, pool } from '../../db/drizzle.js';
import { withRowAdvisoryLock } from '../../lib/advisoryLock.js';
import { messengerBots, messengerLinkCodes, userMessengerLinks, users } from '../../db/schema.js';
import { MessengerUpdatePoller, BOT_REPLIES, BOT_WRONG_CODE_LIMIT } from '../../services/messenger/messengerUpdatePoller.js';
import type { BotUpdate } from '../../services/messenger/messengerClient.js';
import { withIsolatedTestSchema } from '../setup/testDb.js';
import { createTestRole, createTestUser } from '../fixtures/factories.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, runCase } from './fiscalClosingTests.js';

/**
 * v10.1.38 (messenger notifications plan part 1, product-owner decision ت۱ الف): the staff bots of Bale and Telegram. The
 * system admin sets a bot's token, which is stored only encrypted and never answered; a user links their own account with
 * a one-time code sent to the bot; «/stop», a blocked bot and a new link close a link with their reason. Real Express routes
 * on PostgreSQL in an isolated schema, the bot API replaced by a fake `fetch`; each case is red on v10.1.36, which has no
 * such routes or tables.
 */

type Res = { status: number; body?: unknown };
export const brief = (res: Res) => `${res.status} ${JSON.stringify(res.body ?? null).slice(0, 240)}`;
export const codeOf = (res: Res) => String((res.body as { code?: unknown } | undefined)?.code ?? '');

export const TOKEN = '987654:FAKE-STAFF-BOT-TOKEN';
const OTHER_TOKEN = '555555:ANOTHER-STAFF-BOT-TOKEN';

export interface FakeBotApi {
  calls: Array<{ url: string; body: Record<string, unknown> }>;
  usernames: Record<string, string>;
  sendStatus: number;
  /** updates `getUpdates` answers (those at or after the offset sent) */
  updates: BotUpdate[];
  /** tokens whose `getUpdates` answers 502 */
  failingTokens: Set<string>;
  /** a 429 of `sendMessage` carries this `retry_after` */
  sendRetryAfter?: number;
}

/** Replaces `fetch` with a fake bot API for the time of `fn` */
export async function withFakeBotApi<T>(fn: (api: FakeBotApi) => Promise<T>): Promise<T> {
  const api: FakeBotApi = { calls: [], usernames: { [TOKEN]: 'papital_staff_bot', [OTHER_TOKEN]: 'papital_other_bot' }, sendStatus: 200, updates: [], failingTokens: new Set() };
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    api.calls.push({ url, body });
    const json = (status: number, payload: unknown) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
    const token = /\/bot([^/]+)\//.exec(url)?.[1] ?? '';
    if (url.endsWith('/getMe')) {
      return api.usernames[token] ? json(200, { ok: true, result: { username: api.usernames[token] } }) : json(401, { ok: false, description: 'Unauthorized' });
    }
    if (url.endsWith('/sendMessage')) {
      if (api.sendStatus === 429) return json(429, { ok: false, description: 'Too Many Requests', parameters: { retry_after: api.sendRetryAfter ?? 1 } });
      return api.sendStatus === 200 ? json(200, { ok: true, result: { message_id: 1 } }) : json(api.sendStatus, { ok: false, description: 'Forbidden: bot was blocked by the user' });
    }
    if (url.endsWith('/getUpdates')) {
      if (api.failingTokens.has(token)) return json(502, { ok: false, description: 'Bad Gateway' });
      const offset = Number(body.offset ?? 0);
      return json(200, { ok: true, result: api.updates.filter(u => u.update_id >= offset) });
    }
    return json(200, { ok: true, result: [] });
  }) as typeof fetch;
  try {
    return await fn(api);
  } finally {
    globalThis.fetch = original;
  }
}

export async function clientFor(permissions: string[] | 'admin', fullName = 'مریم احمدی') {
  const { getTestApp, getAdminSession, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
  const app = await getTestApp();
  let userId = 0;
  let s: { cookie: string; csrfToken: string };
  if (permissions === 'admin') {
    s = await getAdminSession();
  } else {
    const role = await createTestRole({ permissions });
    const user = await createTestUser({ role: role.code, fullName });
    userId = user.id;
    s = await loginTestUserWithSession(app, user.username);
  }
  return {
    userId,
    get: (url: string) => request(app).get(url).set('Cookie', s.cookie),
    post: (url: string, body: unknown = {}) => request(app).post(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body as object),
    put: (url: string, body: unknown) => request(app).put(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body as object),
    del: (url: string) => request(app).delete(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken),
  };
}

const chatUpdate = (updateId: number, chatId: number, text: string): BotUpdate => ({
  update_id: updateId,
  message: { text, chat: { id: chatId, type: 'private', first_name: 'Maryam' } },
});

/**
 * Whether an answer exposes a chat id: a value equal to it (number or text) or a chat id field. 10.3: a substring check
 * of the whole answer also matched a generated username whose timestamp held the same digits (testuser_17927424…).
 */
const exposesChatId = (body: unknown, chatId: number): boolean => {
  if (body === chatId || body === String(chatId)) return true;
  if (Array.isArray(body)) return body.some(v => exposesChatId(v, chatId));
  if (typeof body !== 'object' || body === null) return false;
  return Object.entries(body).some(([key, v]) => /chat_?id/i.test(key) || exposesChatId(v, chatId));
};

export async function inSandbox<T>(fn: () => Promise<T>): Promise<T> {
  return withIsolatedTestSchema(async () => {
    MessengerUpdatePoller.reset();
    try {
      return await fn();
    } finally {
      const { cleanupHttpTestUsers } = await import('../fixtures/httpTestHelper.js');
      await cleanupHttpTestUsers();
    }
  });
}

export async function runMessengerLinkTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const flowId = 'reg_messenger_link_flow';
  if (shouldRun(flowId, 'messenger')) {
    await runCase(results, flowId, 'v10.1.38: the system admin sets a staff bot (stored encrypted, never answered); a user links with a one-time code sent to the bot, the code works once, «/stop» closes the link and the profile says why', async () => inSandbox(() => withFakeBotApi(async (api) => {
      const admin = await clientFor('admin');
      const refused = await admin.put('/api/messenger/bots/bale', { token: 'not-a-token' });
      if (refused.status !== 422 || codeOf(refused) !== 'MESSENGER_TOKEN_INVALID') throw new Error(`a refused token must be 422: ${brief(refused)}`);
      if ((await orm.select().from(messengerBots)).length !== 0) throw new Error('a refused token wrote a row');
      if (api.calls.length !== 0) throw new Error('a token not in the bot token shape was sent to the bot API');
      const unknown = await admin.put('/api/messenger/bots/bale', { token: '111111:UNKNOWN-BOT-TOKEN-ABCDEFG' });
      if (unknown.status !== 422 || codeOf(unknown) !== 'MESSENGER_TOKEN_INVALID') throw new Error(`a token the bot API refuses must be 422: ${brief(unknown)}`);

      const saved = await admin.put('/api/messenger/bots/bale', { token: TOKEN });
      if (saved.status !== 200 || (saved.body as { botUsername?: string }).botUsername !== 'papital_staff_bot') throw new Error(`save: ${brief(saved)}`);
      const listed = await admin.get('/api/messenger/bots');
      if (JSON.stringify(listed.body).includes('FAKE-STAFF-BOT-TOKEN') || JSON.stringify(saved.body).includes('FAKE-STAFF-BOT-TOKEN')) throw new Error('the token left the server');
      const [stored] = await orm.select().from(messengerBots).where(eq(messengerBots.messenger, 'bale'));
      if (!stored?.token.startsWith('enc:v1:')) throw new Error(`the token must be stored encrypted, got ${stored?.token.slice(0, 8)}`);

      const user = await clientFor([]);
      const noBot = await user.post('/api/messenger/links/telegram/code');
      if (noBot.status !== 422 || codeOf(noBot) !== 'MESSENGER_BOT_NOT_CONFIGURED') throw new Error(`a messenger without a bot gives no code: ${brief(noBot)}`);
      const issued = await user.post('/api/messenger/links/bale/code');
      const code = String((issued.body as { code?: string }).code ?? '');
      if (issued.status !== 201 || !/^\d{6}$/.test(code)) throw new Error(`code: ${brief(issued)}`);
      const [codeRow] = await orm.select().from(messengerLinkCodes);
      if (!codeRow || codeRow.codeHash.includes(code)) throw new Error('the code must be stored as a hash');
      if (codeRow.codeHash === crypto.createHash('sha256').update(`bale:${code}`).digest('hex')) throw new Error('the code hash must be keyed, not a plain sha256');

      const wrong = await MessengerUpdatePoller.handleMessage('bale', chatUpdate(1, 4242, code === '000000' ? '111111' : '000000'));
      if (wrong !== BOT_REPLIES.invalidCode) throw new Error(`a wrong code: ${wrong}`);
      const reply = await MessengerUpdatePoller.handleMessage('bale', chatUpdate(2, 4242, `/start ${code.split('').map(d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]).join('')}`));
      if (reply !== BOT_REPLIES.linked('مریم احمدی')) throw new Error(`link reply: ${reply}`);
      const again = await MessengerUpdatePoller.handleMessage('bale', chatUpdate(3, 9999, code));
      if (again !== BOT_REPLIES.invalidCode) throw new Error(`a used code must not link again: ${again}`);

      const mine = await user.get('/api/messenger/links/mine');
      const bale = (mine.body as { data: Array<{ messenger: string; linked: boolean; chatName: string }> }).data.find(l => l.messenger === 'bale');
      if (!bale?.linked || bale.chatName !== 'Maryam' || exposesChatId(mine.body, 4242)) throw new Error(`mine: ${brief(mine)}`);
      const adminList = await admin.get('/api/messenger/links');
      if (adminList.status !== 200 || exposesChatId(adminList.body, 4242) || !JSON.stringify(adminList.body).includes('مریم احمدی')) throw new Error(`admin list: ${brief(adminList)}`);

      const tested = await user.post('/api/messenger/links/bale/test');
      const sent = api.calls.filter(c => c.url.endsWith('/sendMessage')).at(-1);
      if (tested.status !== 200 || String(sent?.body.chat_id) !== '4242' || !String(sent?.body.text).includes('مریم احمدی')) throw new Error(`test message: ${brief(tested)}`);

      const stopped = await MessengerUpdatePoller.handleMessage('bale', chatUpdate(4, 4242, '/stop'));
      if (stopped !== BOT_REPLIES.stopped) throw new Error(`stop: ${stopped}`);
      const after = await user.get('/api/messenger/links/mine');
      const baleAfter = (after.body as { data: Array<{ messenger: string; linked: boolean; lastUnlink: { reason: string } | null }> }).data.find(l => l.messenger === 'bale');
      if (baleAfter?.linked || baleAfter?.lastUnlink?.reason !== 'stop') throw new Error(`after stop: ${brief(after)}`);
      return 'token encrypted and never answered; code links once; /stop closes with its reason';
    })));
  }

  const guardId = 'reg_messenger_bot_admin_only';
  if (shouldRun(guardId, 'messenger')) {
    await runCase(results, guardId, 'v10.1.38: only the system admin reads or sets the staff bots and the list of linked users; settings.manage alone is 403', async () => inSandbox(() => withFakeBotApi(async () => {
      const manager = await clientFor(['settings.manage']);
      for (const res of [await manager.get('/api/messenger/bots'), await manager.put('/api/messenger/bots/bale', { token: TOKEN }), await manager.get('/api/messenger/links')]) {
        if (res.status !== 403) throw new Error(`expected 403: ${brief(res)}`);
      }
      return 'settings.manage refused';
    })));
  }

  const blockedId = 'reg_messenger_link_closed_by_block_relink_and_bot_change';
  if (shouldRun(blockedId, 'messenger')) {
    await runCase(results, blockedId, 'v10.1.38: a 403 on the test message closes the link as blocked; linking a chat to another user closes the first user\'s link; another bot closes every link of its messenger', async () => inSandbox(() => withFakeBotApi(async (api) => {
      const admin = await clientFor('admin');
      await admin.put('/api/messenger/bots/telegram', { token: TOKEN });
      const first = await clientFor([]);
      const second = await clientFor([]);
      const link = async (client: Awaited<ReturnType<typeof clientFor>>, chatId: number, updateId: number) => {
        const issued = await client.post('/api/messenger/links/telegram/code');
        const code = String((issued.body as { code?: string }).code ?? '');
        const reply = await MessengerUpdatePoller.handleMessage('telegram', chatUpdate(updateId, chatId, code));
        if (reply !== BOT_REPLIES.linked('مریم احمدی')) throw new Error(`link: ${reply}`);
      };
      await link(first, 100, 1);
      api.sendStatus = 403;
      const blocked = await first.post('/api/messenger/links/telegram/test');
      if (blocked.status !== 409 || codeOf(blocked) !== 'MESSENGER_BLOCKED') throw new Error(`blocked: ${brief(blocked)}`);
      const [closed] = await orm.select().from(userMessengerLinks).where(eq(userMessengerLinks.userId, first.userId));
      if (closed?.isActive !== 0 || closed.unlinkReason !== 'blocked') throw new Error(`blocked link: ${JSON.stringify(closed)}`);
      api.sendStatus = 200;

      await link(first, 100, 2);
      await link(second, 100, 3);
      const firstLinks = await orm.select().from(userMessengerLinks).where(eq(userMessengerLinks.userId, first.userId));
      if (firstLinks.some(l => l.isActive === 1) || !firstLinks.some(l => l.unlinkReason === 'relinked')) throw new Error(`relink: ${JSON.stringify(firstLinks)}`);

      const changed = await admin.put('/api/messenger/bots/telegram', { token: OTHER_TOKEN });
      if (changed.status !== 200) throw new Error(`bot change: ${brief(changed)}`);
      const secondLinks = await orm.select().from(userMessengerLinks).where(eq(userMessengerLinks.userId, second.userId));
      if (secondLinks.some(l => l.isActive === 1) || secondLinks[0]?.unlinkReason !== 'bot_changed') throw new Error(`bot change: ${JSON.stringify(secondLinks)}`);
      const unlinked = await second.del('/api/messenger/links/telegram');
      if (unlinked.status !== 409 || codeOf(unlinked) !== 'MESSENGER_NOT_LINKED') throw new Error(`unlink without a link: ${brief(unlinked)}`);
      return 'blocked, relinked and bot_changed each close a link';
    })));
  }

  const pollId = 'reg_messenger_poller_offset_backoff_and_code_cap';
  if (shouldRun(pollId, 'messenger')) {
    await runCase(results, pollId, 'v10.1.38: the update offset is stored per bot and survives a restart; a failing bot backs off 5 s, doubling, without holding up the other bot and reads again after a success; thirty wrong codes in ten minutes from any chats stop the bot reading codes until the window ends', async () => inSandbox(() => withFakeBotApi(async (api) => {
      const admin = await clientFor('admin');
      await admin.put('/api/messenger/bots/bale', { token: TOKEN });
      await admin.put('/api/messenger/bots/telegram', { token: OTHER_TOKEN });
      const offsetOf = async (messenger: 'bale' | 'telegram') => Number((await orm.select().from(messengerBots).where(eq(messengerBots.messenger, messenger)))[0]?.updateOffset);
      const updateCalls = (token: string) => api.calls.filter(c => c.url.endsWith('/getUpdates') && c.url.includes(token));

      api.updates = [chatUpdate(41, 700, 'سلام')];
      if (await MessengerUpdatePoller.pollOnce() !== 2) throw new Error('both bots should read the update once');
      if (await offsetOf('bale') !== 42) throw new Error(`stored offset: ${await offsetOf('bale')}`);
      MessengerUpdatePoller.reset();
      const handledAfterRestart = await MessengerUpdatePoller.pollOnce();
      if (handledAfterRestart !== 0 || Number(updateCalls(TOKEN).at(-1)?.body.offset) !== 42) throw new Error(`after a restart the update was read again (${handledAfterRestart}, offset ${String(updateCalls(TOKEN).at(-1)?.body.offset)})`);
      api.updates = [];

      const t0 = Date.now();
      api.failingTokens.add(TOKEN);
      await MessengerUpdatePoller.pollMessenger('bale', t0);
      const failed = updateCalls(TOKEN).length;
      await MessengerUpdatePoller.pollMessenger('bale', t0 + 1_000);
      if (updateCalls(TOKEN).length !== failed) throw new Error('a failing bot was called again within its 5 s wait');
      const otherBefore = updateCalls(OTHER_TOKEN).length;
      await MessengerUpdatePoller.pollMessenger('telegram', t0 + 1_000);
      if (updateCalls(OTHER_TOKEN).length !== otherBefore + 1) throw new Error('the other bot waited for the failing one');
      await MessengerUpdatePoller.pollMessenger('bale', t0 + 5_000);
      await MessengerUpdatePoller.pollMessenger('bale', t0 + 14_000);
      if (updateCalls(TOKEN).length !== failed + 1) throw new Error('the second wait must be 10 s');
      api.failingTokens.clear();
      await MessengerUpdatePoller.pollMessenger('bale', t0 + 15_000);
      await MessengerUpdatePoller.pollMessenger('bale', t0 + 15_001);
      if (updateCalls(TOKEN).length !== failed + 3) throw new Error('a success must end the wait');

      const user = await clientFor([]);
      const issued = await user.post('/api/messenger/links/bale/code');
      const code = String((issued.body as { code?: string }).code ?? '');
      const wrong = code === '000000' ? '111111' : '000000';
      await MessengerUpdatePoller.handleMessage('bale', chatUpdate(50, 801, wrong));
      await MessengerUpdatePoller.handleMessage('bale', chatUpdate(51, 802, wrong));
      const [counted] = await orm.select().from(messengerBots).where(eq(messengerBots.messenger, 'bale'));
      if (counted?.wrongCodesCount !== 2 || !counted.wrongCodesSince) throw new Error(`wrong codes of two chats: ${JSON.stringify(counted)}`);
      await orm.update(messengerBots).set({ wrongCodesCount: BOT_WRONG_CODE_LIMIT }).where(eq(messengerBots.messenger, 'bale'));
      const paused = await MessengerUpdatePoller.handleMessage('bale', chatUpdate(52, 803, code));
      if (paused !== BOT_REPLIES.codesPaused) throw new Error(`the right code must wait while codes are paused: ${paused}`);
      if ((await orm.select().from(userMessengerLinks)).length !== 0) throw new Error('a code linked while codes were paused');
      await orm.update(messengerBots).set({ wrongCodesSince: sql`now() - interval '11 minutes'` }).where(eq(messengerBots.messenger, 'bale'));
      const linked = await MessengerUpdatePoller.handleMessage('bale', chatUpdate(53, 803, code));
      if (linked !== BOT_REPLIES.linked('مریم احمدی')) throw new Error(`after the window the code must link: ${linked}`);
      return 'offset 42 stored and kept after reset; backoff 5 s then 10 s, other bot unaffected; 30 wrong codes pause codes for the window';
    })));
  }

  const removalId = 'reg_messenger_bot_removal_closes_links';
  if (shouldRun(removalId, 'messenger')) {
    await runCase(results, removalId, 'v10.1.38: removing a bot closes its links (bot_changed) and starts its offset again, so a later bot never inherits them; a code is not issued to a deleted user and the admin list leaves out the links of deleted users', async () => inSandbox(() => withFakeBotApi(async () => {
      const admin = await clientFor('admin');
      await admin.put('/api/messenger/bots/bale', { token: TOKEN });
      const linkUser = async (client: Awaited<ReturnType<typeof clientFor>>, chatId: number) => {
        const issued = await client.post('/api/messenger/links/bale/code');
        return MessengerUpdatePoller.handleMessage('bale', chatUpdate(chatId, chatId, String((issued.body as { code?: string }).code ?? '')));
      };
      const first = await clientFor([]);
      await linkUser(first, 900);
      await orm.update(messengerBots).set({ updateOffset: 77 }).where(eq(messengerBots.messenger, 'bale'));
      const removed = await admin.put('/api/messenger/bots/bale', { token: '' });
      if (removed.status !== 200) throw new Error(`remove: ${brief(removed)}`);
      const [closed] = await orm.select().from(userMessengerLinks).where(eq(userMessengerLinks.userId, first.userId));
      if (closed?.isActive !== 0 || closed.unlinkReason !== 'bot_changed') throw new Error(`a removed bot left its link: ${JSON.stringify(closed)}`);
      await admin.put('/api/messenger/bots/bale', { token: OTHER_TOKEN });
      const [row] = await orm.select().from(messengerBots).where(eq(messengerBots.messenger, 'bale'));
      if (Number(row?.updateOffset) !== 0) throw new Error(`a new bot kept the old offset ${String(row?.updateOffset)}`);
      if ((await orm.select().from(userMessengerLinks).where(eq(userMessengerLinks.isActive, 1))).length !== 0) throw new Error('the new bot inherited a link');

      const second = await clientFor([]);
      await linkUser(second, 901);
      await orm.update(users).set({ isDeleted: 1 }).where(eq(users.id, second.userId));
      const list = await admin.get('/api/messenger/links');
      if (JSON.stringify(list.body).includes(`"userId":${second.userId}`)) throw new Error(`the admin list shows a deleted user: ${brief(list)}`);
      const bots = await admin.get('/api/messenger/bots');
      const baleView = (bots.body as { data?: Array<{ messenger: string; activeLinks: number }> }).data?.find(b => b.messenger === 'bale');
      if (baleView?.activeLinks !== 0) throw new Error(`a deleted user's link was counted: ${brief(bots)}`);
      return 'removal closed the link and reset the offset; deleted users left out of the admin list and count';
    })));
  }

  const followId = 'reg_messenger_poller_review_followups';
  if (shouldRun(followId, 'messenger')) {
    await runCase(results, followId, 'v10.1.41: wrong codes sent at the same time are all counted against the bot; a bot backing off takes no pool connection; a connection whose advisory unlock failed is closed, never returned to the pool', async () => inSandbox(() => withFakeBotApi(async (api) => {
      const admin = await clientFor('admin');
      await admin.put('/api/messenger/bots/bale', { token: TOKEN });
      const wrongCount = 20;
      await Promise.all(Array.from({ length: wrongCount }, (_, i) => MessengerUpdatePoller.handleMessage('bale', chatUpdate(60 + i, 1000 + i, '000000'))));
      const [counted] = await orm.select().from(messengerBots).where(eq(messengerBots.messenger, 'bale'));
      if (counted?.wrongCodesCount !== wrongCount) throw new Error(`concurrent wrong codes lost: ${String(counted?.wrongCodesCount)} of ${wrongCount}`);

      const originalConnect = pool.connect;
      let connects = 0;
      const releasedWith: Array<boolean | Error | undefined> = [];
      // only the promise form (the lock helpers); pool.query passes a callback and keeps the real connect
      const patchedConnect = async () => {
        connects += 1;
        const client: PoolClient = await (originalConnect as () => Promise<PoolClient>).call(pool);
        const query = client.query.bind(client);
        const release = client.release.bind(client);
        client.query = ((text: unknown, ...rest: unknown[]) => (typeof text === 'string' && text.includes('pg_advisory_unlock')
          ? Promise.reject(new Error('connection lost'))
          : (query as (...args: unknown[]) => unknown)(text, ...rest))) as typeof client.query;
        client.release = ((err?: boolean | Error) => {
          releasedWith.push(err);
          client.query = query;
          release(true);
        }) as typeof client.release;
        return client;
      };
      pool.connect = ((...args: unknown[]) => (args.length > 0
        ? (originalConnect as (...a: unknown[]) => unknown).apply(pool, args)
        : patchedConnect())) as unknown as typeof pool.connect;
      try {
        const t0 = Date.now();
        api.failingTokens.add(TOKEN);
        await MessengerUpdatePoller.pollMessengerExclusive('bale', t0);
        connects = 0;
        await MessengerUpdatePoller.pollMessengerExclusive('bale', t0 + 1_000);
        if (connects !== 0) throw new Error(`a bot backing off took ${connects} pool connection(s)`);
        releasedWith.length = 0;
        await withRowAdvisoryLock(99_901, 1, async () => 'held');
        if (releasedWith.length !== 1 || releasedWith[0] !== true) throw new Error(`a failed unlock returned its connection to the pool: ${JSON.stringify(releasedWith)}`);
      } finally {
        pool.connect = originalConnect;
      }
      return `${wrongCount} concurrent wrong codes counted; no connection while backing off; failed unlock closed the connection`;
    })));
  }

  return results;
}
