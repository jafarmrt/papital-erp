import { describe, expect, it } from 'vitest';
import { payslipApprovedNotice, workflowTaskArrivedNotice } from '../../lib/notifications/notificationNotices';

/**
 * v10.1.42 (messenger notifications plan part 3, ت۲): the payslip and inbox task notices say what they are about in
 * Persian digits and never carry an amount.
 */
const LATIN_DIGIT = /[0-9]/;

describe('approved payslip notice', () => {
  it('names the Jalali month of the end date and the payslip number', () => {
    const notice = payslipApprovedNotice({ payrollNumber: 'PAY-1405-0012', endDate: '2026-10-22' });
    expect(notice.title).toBe('فیش حقوق شما تأیید شد');
    expect(notice.message).toBe('فیش حقوق مهر ۱۴۰۵ شما تأیید شد؛ شماره فیش PAY-۱۴۰۵-۰۰۱۲.');
    expect(notice.message.replace('PAY', '')).not.toMatch(LATIN_DIGIT);
  });

  it('says eidi and prepayment payslips apart', () => {
    expect(payslipApprovedNotice({ payrollNumber: '', endDate: '2027-03-20', isEidi: 1 }).message).toBe('فیش عیدی سال ۱۴۰۵ شما تأیید شد.');
    expect(payslipApprovedNotice({ payrollNumber: '', endDate: '2026-11-21', isPrepayment: 1 }).message).toBe('فیش پیش‌پرداخت حقوق آبان ۱۴۰۵ شما تأیید شد.');
  });
});

describe('inbox task notice', () => {
  it('names the task and the record, in Persian digits', () => {
    const notice = workflowTaskArrivedNotice({ taskTitle: 'تأیید انبار', entityLabel: 'سند', reference: '1405-123' });
    expect(notice).toEqual({ title: 'کار تازه در کارتابل', message: 'کار «تأیید انبار» برای سند ۱۴۰۵-۱۲۳ در کارتابل شما منتظر است.' });
  });

  it('keeps a readable sentence without a title or a reference', () => {
    expect(workflowTaskArrivedNotice({ taskTitle: ' ', entityLabel: '', reference: '' }).message).toBe('کار «بررسی و تأیید» در کارتابل شما منتظر است.');
  });
});
