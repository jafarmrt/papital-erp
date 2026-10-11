import { useHasPermission } from '../contexts/AuthContext';
import {
  PIECEWORK_LOG_PERMISSION,
  PIECEWORK_PAY_PERMISSION,
  PIECEWORK_PAYROLL_APPROVE_PERMISSION,
  PIECEWORK_PAYROLL_PERMISSION,
  PIECEWORK_TASKS_PERMISSION,
} from '../lib/permissions/pieceworkPermissions';

/**
 * v9.0.320 (TD-805، B12P-02، تصمیم ت۲ الف): هر دکمه حقوق و دستمزد با کلید API خودش نمایش داده می‌شود (مدیر همیشه).
 * فقط برای نمایش است؛ سرور همان کلید را خودش می‌سنجد. پیش‌تر هیچ دکمه‌ای مجوز نمی‌پرسید و کاربر به ۴۰۳ می‌خورد.
 */
export function usePieceworkPermissions() {
  return {
    /** عنوان و دسته کاری، اکسل عناوین، نرخ پایه و اختصاصی، نرخ دستی کارکرد */
    canManageTasks: useHasPermission(PIECEWORK_TASKS_PERMISSION),
    /** ثبت، ویرایش و حذف کارکرد آزاد */
    canLog: useHasPermission(PIECEWORK_LOG_PERMISSION),
    /** صدور فیش پیش‌نویس، ثبت سند و ابطال فیش */
    canIssuePayroll: useHasPermission(PIECEWORK_PAYROLL_PERMISSION),
    /** v10.0.193 (TD-1083): تأیید فیش و بازگرداندن فیش تأییدشده بی پرداخت به پیش‌نویس */
    canApprovePayroll: useHasPermission(PIECEWORK_PAYROLL_APPROVE_PERMISSION),
    /** ثبت و ابطال پرداخت فیش */
    canPay: useHasPermission(PIECEWORK_PAY_PERMISSION),
  };
}
