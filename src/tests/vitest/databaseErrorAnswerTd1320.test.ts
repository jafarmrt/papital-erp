import { describe, expect, it } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { DATABASE_ERROR_MESSAGE, normalizeError } from '../../errors/customErrors';
import { errorHandler, errorLogEntry } from '../../middleware/logger';

// TD-1320: a database error that no rule names (a negative OFFSET, a bad cast …) answers the code DATABASE_ERROR in
// every environment, with a Persian sentence in test and development and «خطای داخلی سرور» in production (as every 5xx
// there); before, a test or development answer carried «Failed query: <SQL> params: <values>» in its message and its
// stack. The log files keep the SQL, and the log entry and the terminal line name the database's own reason.
const SQL_TEXT = 'select "id" from "outbox_events" limit $1 offset $2';

function drizzleError(): DrizzleQueryError {
  const pgError = Object.assign(new Error('OFFSET must not be negative'), { severity: 'ERROR', code: '2201X' });
  return new DrizzleQueryError(SQL_TEXT, [50, -100], pgError);
}

const PRODUCTION_ANSWER = 'خطای داخلی سرور';

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

  it('names the database reason in the log entry and the terminal line, never in the answer', () => {
    // an exclusion violation (23P01) is no named rule: it is a DATABASE_ERROR
    const raw = Object.assign(new Error('conflicting key value violates exclusion constraint "chk_x"'), {
      severity: 'ERROR', code: '23P01', constraint: 'chk_x', table: 'production_projects',
    });
    const wrapped = new DrizzleQueryError(SQL_TEXT, [1], Object.assign(new Error('value too long for type character varying(5)'), {
      severity: 'ERROR', code: '22001', table: 'outbox_events',
    }));
    for (const [err, sqlState, part] of [[raw, '23P01', 'constraint chk_x'], [wrapped, '22001', 'table outbox_events']] as const) {
      const normalized = normalizeError(err);
      const entry = errorLogEntry(normalized, { method: 'POST', originalUrl: '/api/x' });
      expect((entry.database as { sqlState?: string } | undefined)?.sqlState).toBe(sqlState);
      expect(String(entry.message)).toContain(`SQLSTATE ${sqlState}`);
      expect(String(entry.message)).toContain(part);
      expect(String(entry.message)).not.toContain('params');
      // a 5xx with frames prints its stack on the terminal, so the reason is in its header too
      expect(String(entry.stack).split('\n')[0]).toContain(`SQLSTATE ${sqlState}`);
      expect(String(entry.stack).split('\n')[0]).toContain(part);
      const { body } = answerOf(err);
      expect(body.code).toBe('DATABASE_ERROR');
      expect(JSON.stringify(body)).not.toContain(sqlState);
      expect(JSON.stringify(body)).not.toContain('database');
    }
  });

  it('a Drizzle error without a database cause logs no reason taken from its SQL text', () => {
    const bare = new DrizzleQueryError(SQL_TEXT, [50, -100], new Error('socket hang up'));
    const entry = errorLogEntry(normalizeError(bare), { method: 'GET', originalUrl: '/api/x' });
    expect(entry.database).toBeUndefined();
    expect(String(entry.message)).not.toContain('outbox_events');
  });

  it('answers the generic server error in production, still with the code DATABASE_ERROR', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { body } = answerOf(drizzleError());
      expect(body.code).toBe('DATABASE_ERROR');
      expect(body.message).toBe(PRODUCTION_ANSWER);
      expect(JSON.stringify(body)).not.toContain('2201X');
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('leaves an ordinary error and a named database rule as they were', () => {
    expect(normalizeError(new Error('boom')).code).toBe('INTERNAL_ERROR');
    expect(normalizeError(new Error('boom')).message).toBe('boom');
    const unique = new DrizzleQueryError(SQL_TEXT, [], Object.assign(new Error('dup'), { severity: 'ERROR', code: '23505' }));
    expect(normalizeError(unique).code).toBe('UNIQUE_VIOLATION');
  });
});
