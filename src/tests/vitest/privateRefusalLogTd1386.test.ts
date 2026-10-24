import { describe, expect, it } from 'vitest';
import { BadRequestError, PrivateRefusalError, normalizeError } from '../../errors/customErrors';
import { errorLogEntry } from '../../middleware/logger';

// 10.3 package 6 (TD-1386, review of #380): a payslip refusal names the personnel and amounts. The user reads the whole
// message; the error log entry keeps its code, route and stack frames only, the stack's first line included.
const MESSAGE = 'کسر مساعده (۳۰۰٬۰۰۰ ریال) از مانده مساعده تسویه‌نشده رضا کریمی (۰ ریال) بیشتر است.';
const PLAIN = 'شماره فیش نامعتبر است';
const REQ = { method: 'POST', originalUrl: '/api/piecework/payrolls/generate' };

describe('private_refusal_log_td_1386', () => {
  it('keeps the text of a private refusal out of the log entry', () => {
    const normalized = normalizeError(new PrivateRefusalError(MESSAGE, 400, 'PAYROLL_ADVANCE_DEDUCTION_EXCEEDS_BALANCE'));
    expect(normalized.message).toBe(MESSAGE);
    expect(normalized.statusCode).toBe(400);
    const entry = errorLogEntry(normalized, REQ);
    const text = JSON.stringify(entry);
    expect(text).not.toContain('رضا کریمی');
    expect(text).not.toContain('۳۰۰٬۰۰۰');
    expect(entry.userMessage).toBeUndefined();
    expect(entry.code).toBe('PAYROLL_ADVANCE_DEDUCTION_EXCEEDS_BALANCE');
    expect(entry.url).toBe('/api/piecework/payrolls/generate');
    expect(String(entry.errorStack)).toMatch(/^\w+ \(PAYROLL_ADVANCE_DEDUCTION_EXCEEDS_BALANCE\)\n\s+at /);
  });

  it('logs any other refusal as before', () => {
    const entry = errorLogEntry(normalizeError(new BadRequestError(PLAIN)), REQ);
    expect(entry.userMessage).toBe(PLAIN);
    expect(String(entry.errorStack)).toContain(PLAIN);
  });
});
