import http from 'node:http';

/**
 * v10.1.43 (messenger notifications plan part 4): a fake Bale / Telegram Bot API for the end-to-end test, started by
 * Playwright beside the server, which reaches it through `ERP_MESSENGER_TEST_API_BASE` (loopback only). It answers
 * `getMe`, `getUpdates` and `sendMessage` under `/<messenger>/bot<token>/<method>` and records every message sent; the
 * spec drives it through `/__control/*`: it queues a message a user "sends" to the bot and reads what the bots sent.
 */
export const FAKE_BOT_API_PORT = Number(process.env.E2E_FAKE_BOT_PORT || 3199);
export const FAKE_BOT_API_BASE = `http://127.0.0.1:${FAKE_BOT_API_PORT}`;

export interface SentMessage {
  messenger: string;
  chatId: string;
  text: string;
}

interface QueuedUpdate {
  update_id: number;
  message: { text: string; chat: { id: number; type: string; first_name: string } };
}

const updates: Record<string, QueuedUpdate[]> = {};
const sent: SentMessage[] = [];
let nextUpdateId = 1;

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8'); });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) as Record<string, unknown> : {});
      } catch {
        resolve({});
      }
    });
  });
}

function reply(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function botMethod(messenger: string, method: string, body: Record<string, unknown>, res: http.ServerResponse): Promise<void> {
  if (method === 'getMe') {
    reply(res, 200, { ok: true, result: { id: 1, is_bot: true, first_name: 'Papital E2E', username: `papital_e2e_${messenger}_bot` } });
    return;
  }
  if (method === 'getUpdates') {
    const offset = Number(body.offset ?? 0);
    const queue = updates[messenger] ?? [];
    updates[messenger] = queue.filter(u => u.update_id >= offset);
    reply(res, 200, { ok: true, result: updates[messenger] });
    return;
  }
  if (method === 'sendMessage') {
    sent.push({ messenger, chatId: String(body.chat_id ?? ''), text: String(body.text ?? '') });
    reply(res, 200, { ok: true, result: { message_id: sent.length } });
    return;
  }
  reply(res, 200, { ok: true, result: true });
}

const server = http.createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', FAKE_BOT_API_BASE);
    const body = req.method === 'POST' ? await readBody(req) : {};
    if (url.pathname === '/health') return reply(res, 200, { ok: true });
    if (url.pathname === '/__control/sent') return reply(res, 200, { sent });
    if (url.pathname === '/__control/updates' && req.method === 'POST') {
      const messenger = String(body.messenger ?? '');
      const update: QueuedUpdate = {
        update_id: nextUpdateId++,
        message: { text: String(body.text ?? ''), chat: { id: Number(body.chatId), type: 'private', first_name: String(body.firstName ?? 'E2E') } },
      };
      (updates[messenger] ??= []).push(update);
      return reply(res, 200, { ok: true, updateId: update.update_id });
    }
    const bot = /^\/(bale|telegram)\/bot[^/]+\/([A-Za-z]+)$/.exec(url.pathname);
    if (bot) return botMethod(bot[1], bot[2], body, res);
    reply(res, 404, { ok: false, description: 'Not Found' });
  })();
});

if (process.argv[1]?.endsWith('fakeBotApi.ts')) {
  server.listen(FAKE_BOT_API_PORT, '127.0.0.1', () => {
    console.log(`Fake Bot API listening on ${FAKE_BOT_API_BASE}`);
  });
}
