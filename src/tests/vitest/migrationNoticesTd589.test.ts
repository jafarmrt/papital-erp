import { describe, expect, it } from 'vitest';
import { migrationNoticeWarning } from '../../db/migrationNotices';
import { conditionalConstraintCause, conditionalConstraintsResultMessage, type ConditionalConstraintEntry } from '../../lib/system/conditionalConstraints';

// v9.0.427 (TD-589, B01-09): the notices a migration raises when unclean data leaves a constraint or index out go into the
// migrator's warnings; ordinary notices (an object created, "does not exist, skipping") do not.

describe('migration notices (TD-589)', () => {
  it('keeps a warning and a notice that says something was left out', () => {
    expect(migrationNoticeWarning({ severity: 'WARNING', message: 'TD-060: 1 orphan transactions.item_id rows — FK SKIPPED' }))
      .toBe('TD-060: 1 orphan transactions.item_id rows — FK SKIPPED');
    expect(migrationNoticeWarning({ severity: 'NOTICE', message: 'TD-246: duplicate codes, unique index not created' })).toBe('TD-246: duplicate codes, unique index not created');
    expect(migrationNoticeWarning({ severity: 'NOTICE', message: 'constraint chk_x left NOT VALID' })).toBe('constraint chk_x left NOT VALID');
  });

  it('drops an ordinary notice', () => {
    expect(migrationNoticeWarning({ severity: 'NOTICE', message: 'TD-060: FK fk_transactions_item_id created' })).toBeNull();
    expect(migrationNoticeWarning({ severity: 'NOTICE', message: 'index "idx_a" does not exist, skipping' })).toBeNull();
    expect(migrationNoticeWarning({ severity: 'WARNING', message: '  ' })).toBeNull();
    expect(migrationNoticeWarning({})).toBeNull();
  });
});

const entry = (state: 'ready' | 'blocked', blockers = 0): ConditionalConstraintEntry => ({
  name: 'uq_accounts_code_active', kind: 'unique_index', table: 'accounts', migration: '0012', label: 'یکتایی کد حساب‌های فعال',
  state, blockers, blockerUnit: 'کد مشترک میان حساب‌های فعال',
});

describe('conditional constraint text (TD-589)', () => {
  it('names the cause in Persian digits', () => {
    expect(conditionalConstraintCause(entry('blocked', 12))).toContain('۱۲ کد مشترک میان حساب‌های فعال');
    expect(conditionalConstraintCause(entry('ready'))).toContain('داده پاک است');
  });

  it('says what a preview and a build did', () => {
    const base = { missing: [entry('ready'), entry('blocked', 2)], blocked: ['b'], failed: [] };
    expect(conditionalConstraintsResultMessage({ ...base, applied: false, built: ['a'] })).toBe('۱ قید آماده ساختن است؛ ۱ قید پیش از اصلاح داده ساخته نمی‌شود.');
    expect(conditionalConstraintsResultMessage({ ...base, applied: true, built: ['a'] })).toBe('۱ قید ساخته شد؛ ۱ قید پیش از اصلاح داده ساخته نمی‌شود.');
    expect(conditionalConstraintsResultMessage({ missing: [], applied: true, built: [], blocked: [], failed: [] })).toContain('برقرارند');
  });
});
