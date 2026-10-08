// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import winston from 'winston';
import { errorHandler, errorLogEntry, logger, PERSIAN_TERMINAL_MARKER, terminalLine } from '../../middleware/logger';
import { normalizeError, ValidationError } from '../../errors/customErrors';

const PERSIAN = /[\u0600-\u06FF]/;
const USER_MESSAGE = 'مقدار واردشده معتبر نیست';

function fakeResponse() {
  const res = { headersSent: false, statusCode: 0, body: undefined as unknown, status(code: number) { res.statusCode = code; return res; }, json(b: unknown) { res.body = b; return res; } };
  return res;
}

afterEach(() => vi.restoreAllMocks());

// v9.0.450 (TD-625, B01-45): the terminal line of an error is English; the message for the user stays in the response
// and in the log files only
describe('error log lines on the terminal (TD-625)', () => {
  it('logs a business error with its status, code and route, and keeps the user message out of the terminal line', () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    const res = fakeResponse();
    errorHandler(new ValidationError(USER_MESSAGE), { method: 'POST', url: '/api/documents?draft=1', originalUrl: '/api/documents?draft=1', headers: {} }, res, () => undefined);

    const entry = spy.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(entry.message).toBe('HTTP 422 VALIDATION_ERROR POST /api/documents');
    expect(entry.stack).toBeUndefined();
    expect(entry.userMessage).toBe(USER_MESSAGE);
    expect(res.statusCode).toBe(422);
    expect((res.body as { message: string }).message).toBe(USER_MESSAGE);
  });

  it('keeps an English message and the stack frames of a server error, and replaces a Persian message line', () => {
    const english = errorLogEntry(normalizeError(new Error('boom')), { method: 'GET', url: '/api/items' });
    expect(english.message).toBe('HTTP 500 INTERNAL_ERROR GET /api/items: boom');
    expect(String(english.stack)).toMatch(/^Error \(INTERNAL_ERROR\): boom\n\s+at /);

    const persian = errorLogEntry(normalizeError(new Error(USER_MESSAGE)), { method: 'GET', url: '/api/items' });
    expect(String(persian.message)).not.toMatch(PERSIAN);
    expect(String(persian.stack)).not.toMatch(PERSIAN);
    expect(String(persian.errorStack)).toContain(USER_MESSAGE);
  });

  it('prints every Persian run of a log line as an English marker on the console, never the Persian text', () => {
    expect(terminalLine('warn: [Kardex Rebuild] Item 5 skipped: بازسازی کاردکس کالای «۱۲» رد شد. code KX-1'))
      .toBe(`warn: [Kardex Rebuild] Item 5 skipped: ${PERSIAN_TERMINAL_MARKER} code KX-1`);
    expect(terminalLine('info: plain English 42')).toBe('info: plain English 42');

    const consoleTransport = logger.transports.find(t => t instanceof winston.transports.Console)!;
    const info = consoleTransport.format!.transform({ level: 'warn', message: `[WooCommerce] ${USER_MESSAGE} #7`, [Symbol.for('level')]: 'warn' }) as Record<symbol, string>;
    const printed = info[Symbol.for('message')];
    expect(printed).toContain('[WooCommerce]');
    expect(printed).toContain(PERSIAN_TERMINAL_MARKER);
    expect(printed).not.toMatch(PERSIAN);
  });
});
