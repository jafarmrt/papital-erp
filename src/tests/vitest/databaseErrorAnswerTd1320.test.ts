import { describe, expect, it } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { DATABASE_ERROR_MESSAGE, normalizeError } from '../../errors/customErrors';
import { errorHandler, errorLogEntry } from '../../middleware/logger';

// TD-1320: a database error that no rule names (a negative OFFSET, a bad cast …) answers a Persian sentence with the
// code DATABASE_ERROR in every environment; before, a test or development answer carried «Failed query: <SQL>
// params: <values>» in its message and its stack. The log files keep the SQL.
const SQL_TEXT = 'select "id" from "outbox_events" limit $1 offset $2';

function drizzleError(): DrizzleQueryError {
  const pgError = Object.assign(new Error('OFFSET must not be negative'), { severity: 'ERROR', code: '2201X' });
  return new DrizzleQueryError(SQL_TEXT, [50, -100], pgError);
}

function answerOf(err: unknown): { status: number; body: Record<string, unknown> } {
  const out = { status: 0, body: {} as Record<string, unknown> };
  const res = {
    headersSent: false,
    status(code: number) { out.status = code; return res; },
    json(body: Record<string, unknown>) { out.body = body; return res; },
  };
  errorHandler(err, { method: 'GET', originalUrl: '/api/events/outbox?page=-1', headers: {} }, res, () => undefined);
  return out;
}

describe('database_error_answer_td_1320', () => {
  it('answers a Drizzle query error without its SQL text, parameters or stack', () => {
    const { status, body } = answerOf(drizzleError());
    expect(status).toBe(500);
    expect(body.code).toBe('DATABASE_ERROR');
    expect(body.message).toBe(DATABASE_ERROR_MESSAGE);
    expect(JSON.stringify(body)).not.toContain('outbox_events');
    expect(JSON.stringify(body)).not.toContain('Failed query');
    expect(body.stack).toBeUndefined();
  });

  it('answers a raw node-postgres error the same way', () => {
    const raw = Object.assign(new Error('invalid input syntax for type integer: "abc"'), { severity: 'ERROR', code: '22P02' });
    const { body } = answerOf(raw);
    expect(body.code).toBe('DATABASE_ERROR');
    expect(JSON.stringify(body)).not.toContain('invalid input syntax');
  });

  it('keeps the SQL text for the log files', () => {
    const entry = errorLogEntry(normalizeError(drizzleError()), { method: 'GET', url: '/api/events/outbox' });
    expect(String(entry.errorStack)).toContain('outbox_events');
  });

  it('leaves an ordinary error and a named database rule as they were', () => {
    expect(normalizeError(new Error('boom')).code).toBe('INTERNAL_ERROR');
    expect(normalizeError(new Error('boom')).message).toBe('boom');
    const unique = new DrizzleQueryError(SQL_TEXT, [], Object.assign(new Error('dup'), { severity: 'ERROR', code: '23505' }));
    expect(normalizeError(unique).code).toBe('UNIQUE_VIOLATION');
  });
});
