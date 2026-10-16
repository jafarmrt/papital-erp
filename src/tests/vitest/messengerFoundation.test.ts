import { afterEach, describe, expect, it, vi } from 'vitest';
import { botStartLink, isStopCommand, parseLinkCode } from '../../lib/messenger/messengerLinks';
import { BOT_API_BASE, callBotApi, getBotUsername, sendBotMessage } from '../../services/messenger/messengerClient';

/**
 * v10.1.37 (messenger notifications plan part 1): the link code a user sends to a staff bot is read in Latin, Persian or
 * Arabic digits, and the one bot API client sends to Bale (tapi.bale.ai) and Telegram with the same calls, never putting
 * the token in an error and marking a 403 as blocked.
 */
const TOKEN = '123456:SECRET-TOKEN';

describe('messenger link code (messenger plan part 1)', () => {
  it('reads a six-digit code from /start, plain digits and Persian or Arabic digits', () => {
    expect(parseLinkCode('/start 042913')).toBe('042913');
    expect(parseLinkCode('042913')).toBe('042913');
    expect(parseLinkCode('۰۴۲ ۹۱۳')).toBe('042913');
    expect(parseLinkCode('٠٤٢٩١٣')).toBe('042913');
  });

  it('refuses text without exactly six digits', () => {
    expect(parseLinkCode('hello')).toBeNull();
    expect(parseLinkCode('12345')).toBeNull();
    expect(parseLinkCode('1234567')).toBeNull();
    expect(parseLinkCode('/start')).toBeNull();
  });

  it('knows /stop with or without the bot name', () => {
    expect(isStopCommand('/stop')).toBe(true);
    expect(isStopCommand('/stop@papital_bot')).toBe(true);
    expect(isStopCommand('stop please')).toBe(false);
  });

  it('builds the bot address with the code for each messenger', () => {
    expect(botStartLink('telegram', '@papital_bot', '042913')).toBe('https://t.me/papital_bot?start=042913');
    expect(botStartLink('bale', 'papital_bot')).toBe('https://ble.ir/papital_bot');
    expect(botStartLink('bale', '')).toBe('');
  });
});

describe('messenger bot client (messenger plan part 1)', () => {
  afterEach(() => vi.unstubAllGlobals());

  const answer = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

  it('sends to Bale at tapi.bale.ai and to Telegram at api.telegram.org with the same method', async () => {
    const fetchMock = answer(200, { ok: true, result: { message_id: 1 } });
    vi.stubGlobal('fetch', fetchMock);
    await sendBotMessage('bale', TOKEN, '77', 'سلام');
    await sendBotMessage('telegram', TOKEN, '77', 'سلام');
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0][0]).toBe(`${BOT_API_BASE.bale}/bot${TOKEN}/sendMessage`);
    expect(BOT_API_BASE.bale).toBe('https://tapi.bale.ai');
    expect(calls[1][0]).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(JSON.parse(String(calls[0][1].body))).toMatchObject({ chat_id: '77', text: 'سلام' });
    expect(calls[0][1].redirect).toBe('manual');
  });

  it('marks a 403 as blocked and not retryable, a 429 or 5xx as retryable', async () => {
    vi.stubGlobal('fetch', answer(403, { ok: false, description: 'Forbidden: bot was blocked by the user' }));
    expect(await sendBotMessage('telegram', TOKEN, '1', 'x')).toMatchObject({ ok: false, blocked: true, retryable: false });
    vi.stubGlobal('fetch', answer(429, { ok: false, description: 'Too Many Requests' }));
    expect(await sendBotMessage('telegram', TOKEN, '1', 'x')).toMatchObject({ ok: false, blocked: false, retryable: true });
    vi.stubGlobal('fetch', answer(502, {}));
    expect(await sendBotMessage('bale', TOKEN, '1', 'x')).toMatchObject({ ok: false, retryable: true });
  });

  it('never puts the address (and so the token) in a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError(`fetch failed for https://api.telegram.org/bot${TOKEN}/getMe`); }));
    const res = await callBotApi('telegram', TOKEN, 'getMe');
    expect(res).toMatchObject({ ok: false, status: 0 });
    expect(JSON.stringify(res)).not.toContain('SECRET-TOKEN');
  });

  it('reads the bot username, and null for a refused token', async () => {
    vi.stubGlobal('fetch', answer(200, { ok: true, result: { username: 'papital_staff_bot' } }));
    expect(await getBotUsername('bale', TOKEN)).toBe('papital_staff_bot');
    vi.stubGlobal('fetch', answer(401, { ok: false, description: 'Unauthorized' }));
    expect(await getBotUsername('bale', TOKEN)).toBeNull();
  });
});
