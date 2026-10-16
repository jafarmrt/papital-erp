import { isoToJalaliDate, jalaliMonthLabel } from '../../utils/calendarDate.js';
import { toPersianDigits } from '../../utils/persianNumber.js';

/**
 * v10.1.42 (messenger notifications plan part 3, ت۲ / ت۳ الف): the text of the two new notices, shared by the server and
 * its tests. Each says what it is about (the payslip's Jalali month, or the task and its record) and never an amount.
 */
export const MY_PAYSLIPS_LINK = '/my-payslips';
export const APPROVAL_INBOX_LINK = '/approval-inbox';

export interface Notice {
  title: string;
  message: string;
}

export interface PayslipNoticeInput {
  payrollNumber: string;
  endDate: string;
  isEidi?: number | boolean | null;
  isPrepayment?: number | boolean | null;
}

/** «فیش حقوق مهر ۱۴۰۵ شما تأیید شد»: the month (or the year of an eidi payslip) comes from the payslip's end date */
export function payslipApprovedNotice(pay: PayslipNoticeInput): Notice {
  const jalali = isoToJalaliDate(pay.endDate);
  const month = jalali ? jalaliMonthLabel(jalali.slice(0, 7)) : '';
  const number = toPersianDigits(String(pay.payrollNumber || '').trim());
  const numberPart = number ? `؛ شماره فیش ${number}` : '';
  if (Number(pay.isEidi) === 1) {
    const year = jalali ? ` سال ${toPersianDigits(jalali.slice(0, 4))}` : '';
    return { title: 'فیش عیدی شما تأیید شد', message: `فیش عیدی${year} شما تأیید شد${numberPart}.` };
  }
  const kind = Number(pay.isPrepayment) === 1 ? 'فیش پیش‌پرداخت حقوق' : 'فیش حقوق';
  return { title: 'فیش حقوق شما تأیید شد', message: `${kind}${month ? ` ${month}` : ''} شما تأیید شد${numberPart}.` };
}

export interface WorkflowTaskNoticeInput {
  taskTitle: string;
  entityLabel: string;
  reference: string;
}

/** «کار «تأیید فاکتور» برای سند فروش ۱۲۳ در کارتابل شما منتظر است» */
export function workflowTaskArrivedNotice(input: WorkflowTaskNoticeInput): Notice {
  const task = input.taskTitle.trim() || 'بررسی و تأیید';
  const reference = toPersianDigits(input.reference.trim());
  const subject = [input.entityLabel.trim(), reference].filter(Boolean).join(' ');
  return {
    title: 'کار تازه در کارتابل',
    message: `کار «${task}»${subject ? ` برای ${subject}` : ''} در کارتابل شما منتظر است.`,
  };
}
