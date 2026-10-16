import type { Messenger } from '../../lib/messenger/messengerLinks.js';

/**
 * v10.1.38 (messenger notifications plan, part 1): the one client of the staff bots. Bale serves the same bot API as
 * Telegram at `tapi.bale.ai`, so one client sends to both. The token is part of the request address only: it is never
 * logged, never put in an error and never returned. Every call has a timeout and refuses a redirect.
 */
export const BOT_API_BASE: Readonly<Record<Messenger, string>> = {
  bale: 'https://tapi.bale.ai',
  telegram: 'https://api.telegram.org',
};

const DEFAULT_TIMEOUT_MS = 10_000;

export interface BotApiResult<T> {
  ok: boolean;
  /** HTTP status; 0 when the request never got an answer (network error, timeout) */
  status: number;
  result?: T;
  /** The API's own error text, or the network error's name (never the address) */
  description?: string;
}

export interface BotSendResult {
  ok: boolean;
  status: number;
  description?: string;
  /** 403: the user blocked the bot or never started it; their link is closed */
  blocked: boolean;
  /** a later attempt may succeed (network error, 429, 5xx) */
  retryable: boolean;
}

export interface BotUpdate {
  update_id: number;
  message?: {
    text?: string;
    chat: { id: number | string; type?: string; first_name?: string; last_name?: string; username?: string; title?: string };
  };
}

function botUrl(messenger: Messenger, token: string, method: string): string {
  return `${BOT_API_BASE[messenger]}/bot${token}/${method}`;
}

/** A network error's name only: an undici error may carry the request address, which holds the token */
function networkErrorText(err: unknown): string {
  if (err instanceof Error && err.name === 'TimeoutError') return 'timeout';
  if (err instanceof Error && err.name === 'AbortError') return 'aborted';
  return 'network error';
}

export async function callBotApi<T>(messenger: Messenger, token: string, method: string, body: Record<string, unknown> = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<BotApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(botUrl(messenger, token, method), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return { ok: false, status: 0, description: networkErrorText(err) };
  }
  let parsed: { ok?: boolean; result?: T; description?: string } = {};
  try {
    parsed = await response.json() as typeof parsed;
  } catch {
    parsed = {};
  }
  const ok = response.ok && parsed.ok === true;
  return { ok, status: response.status, result: ok ? parsed.result : undefined, description: ok ? undefined : String(parsed.description ?? `HTTP ${response.status}`) };
}

/** The bot's own username, or null when the token is not a working bot token */
export async function getBotUsername(messenger: Messenger, token: string): Promise<string | null> {
  const res = await callBotApi<{ username?: string }>(messenger, token, 'getMe');
  return res.ok ? String(res.result?.username ?? '') : null;
}

export async function sendBotMessage(messenger: Messenger, token: string, chatId: string, text: string): Promise<BotSendResult> {
  const res = await callBotApi(messenger, token, 'sendMessage', { chat_id: chatId, text, disable_web_page_preview: true });
  return {
    ok: res.ok,
    status: res.status,
    description: res.description,
    blocked: res.status === 403,
    retryable: !res.ok && (res.status === 0 || res.status === 429 || res.status >= 500),
  };
}

/** The bot's new messages after `offset` (no long polling: the poller asks again on its own interval) */
export async function getBotUpdates(messenger: Messenger, token: string, offset: number | undefined): Promise<BotApiResult<BotUpdate[]>> {
  const body: Record<string, unknown> = { timeout: 0, allowed_updates: ['message'] };
  if (offset !== undefined) body.offset = offset;
  return callBotApi<BotUpdate[]>(messenger, token, 'getUpdates', body);
}
