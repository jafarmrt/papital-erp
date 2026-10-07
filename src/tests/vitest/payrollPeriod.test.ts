import { describe, expect, it } from 'vitest';
import { fixedSalaryPeriodEnd, payrollPeriodFutureError, serviceEndOf } from '../../lib/payroll/payrollPeriod';

// v9.0.233 (TD-808, decision t4 «الف»): fixed salary up to the end of service; no payslip for a period that has not ended
describe('payroll period rules shared by the server and the payslip form (TD-808)', () => {
  it('reads the end of service only for a terminated personnel', () => {
    expect(serviceEndOf({ employmentStatus: 'قطع همکاری', endDate: '2026-08-22' })).toEqual({ kind: 'ended', endIso: '2026-08-22' });
    expect(serviceEndOf({ employmentStatus: 'قطع همکاری', endDate: '1405/05/31' })).toEqual({ kind: 'ended', endIso: '2026-08-22' });
    expect(serviceEndOf({ employmentStatus: 'قطع همکاری', endDate: '' })).toEqual({ kind: 'unknown' });
    expect(serviceEndOf({ employmentStatus: 'فعال', endDate: '2026-08-22' })).toEqual({ kind: 'open' });
  });

  it('caps the fixed-salary part of a period at the end of service', () => {
    const ended = { kind: 'ended', endIso: '2026-08-22' } as const;
    expect(fixedSalaryPeriodEnd('2026-08-07', '2026-09-06', ended)).toBe('2026-08-22');
    expect(fixedSalaryPeriodEnd('2026-08-23', '2026-09-22', ended)).toBeNull();
    expect(fixedSalaryPeriodEnd('2026-07-23', '2026-08-15', ended)).toBe('2026-08-15');
    expect(fixedSalaryPeriodEnd('2026-08-23', '2026-09-22', { kind: 'open' })).toBe('2026-09-22');
  });

  it('refuses a period that ends after today, with Persian digits', () => {
    expect(payrollPeriodFutureError('2026-10-07', '2026-10-07')).toBeNull();
    expect(payrollPeriodFutureError('2026-12-21', '2026-10-07')).toBe('پایان دوره فیش (۱۴۰۵/۰۹/۳۰) پس از امروز (۱۴۰۵/۰۷/۱۵) است؛ فیش دوره‌ای که هنوز تمام نشده صادر نمی‌شود.');
  });
});
