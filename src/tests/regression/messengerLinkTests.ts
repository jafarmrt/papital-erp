import request from 'supertest';
import { eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { messengerBots, messengerLinkCodes, userMessengerLinks } from '../../db/schema.js';
import { MessengerUpdatePoller, BOT_REPLIES } from '../../services/messenger/messengerUpdatePoller.js';
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
const brief = (res: Res) => `${res.status} ${JSON.stringify(res.body ?? null).slice(0, 240)}`;
const codeOf = (res: Res) => String((res.body as { code?: unknown } | undefined)?.code ?? '');

const TOKEN = '987654:FAKE-STAFF-BOT-TOKEN';
const OTHER_TOKEN = '555555:ANOTHER-BOT-TOKEN';

interface FakeBotApi {
  calls: Array<{ url: string; body: Record<string, unknown> }>;
  usernames: Record<string, string>;
  sendStatus: number;
}

/** Replaces `fetch` with a fake bot API for the time of `fn` */
async function withFakeBotApi<T>(fn: (api: FakeBotApi) => Promise<T>): Promise<T> {
  const api: FakeBotApi = { calls: [], usernames: { [TOKEN]: 'papital_staff_bot', [OTHER_TOKEN]: 'papital_other_bot' }, sendStatus: 200 };
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
      return api.sendStatus === 200 ? json(200, { ok: true, result: { message_id: 1 } }) : json(api.sendStatus, { ok: false, description: 'Forbidden: bot was blocked by the user' });
    }
    return json(200, { ok: true, result: [] });
  }) as typeof fetch;
  try {
    return await fn(api);
  } finally {
    globalThis.fetch = original;
  }
}

async function clientFor(permissions: string[] | 'admin') {
  const { getTestApp, getAdminSession, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
  const app = await getTestApp();
  let userId = 0;
  let s: { cookie: string; csrfToken: string };
  if (permissions === 'admin') {
    s = await getAdminSession();
  } else {
    const role = await createTestRole({ permissions });
    const user = await createTestUser({ role: role.code, fullName: 'مریم احمدی' });
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

async function inSandbox<T>(fn: () => Promise<T>): Promise<T> {
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

      const wrong = await MessengerUpdatePoller.handleMessage('bale', chatUpdate(1, 4242, code === '000000' ? '111111' : '000000'));
      if (wrong !== BOT_REPLIES.invalidCode) throw new Error(`a wrong code: ${wrong}`);
      const reply = await MessengerUpdatePoller.handleMessage('bale', chatUpdate(2, 4242, `/start ${code.split('').map(d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]).join('')}`));
      if (reply !== BOT_REPLIES.linked('مریم احمدی')) throw new Error(`link reply: ${reply}`);
      const again = await MessengerUpdatePoller.handleMessage('bale', chatUpdate(3, 9999, code));
      if (again !== BOT_REPLIES.invalidCode) throw new Error(`a used code must not link again: ${again}`);

      const mine = await user.get('/api/messenger/links/mine');
      const bale = (mine.body as { data: Array<{ messenger: string; linked: boolean; chatName: string }> }).data.find(l => l.messenger === 'bale');
      if (!bale?.linked || bale.chatName !== 'Maryam' || JSON.stringify(mine.body).includes('4242')) throw new Error(`mine: ${brief(mine)}`);
      const adminList = await admin.get('/api/messenger/links');
      if (adminList.status !== 200 || JSON.stringify(adminList.body).includes('4242') || !JSON.stringify(adminList.body).includes('مریم احمدی')) throw new Error(`admin list: ${brief(adminList)}`);

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

  return results;
}
