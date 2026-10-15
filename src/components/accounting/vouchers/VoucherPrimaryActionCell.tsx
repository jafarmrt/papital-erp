import { CheckCircle2, Clock, GitFork, Lock, ShieldCheck } from 'lucide-react';
import { voucherPrimaryAction } from '../../../lib/accounting/voucherRowActions';

/** v10.0.121 (TD-1120): دکمه اصلی ردیف سند؛ «قفل دفاتر» فقط برای سند دائم (استخراج‌شده از JournalVouchersTab) */
export function VoucherPrimaryActionCell({ status, makerOfVoucher = false, inWorkflow = false, onApprove, onFinalize, onOpenWorkflow }: {
  status: string;
  /** v10.1.11 (TD-1263): the voucher's workflow runs; approving and finalizing happen there, not on this page */
  inWorkflow?: boolean;
  onOpenWorkflow?: () => void;
  /** v10.0.27 (TD-965): the viewer made or last edited this manual draft, so another user approves it */
  makerOfVoucher?: boolean;
  onApprove?: () => void;
  onFinalize?: () => void;
}) {
  const action = voucherPrimaryAction(status, { canApprove: Boolean(onApprove), canFinalize: Boolean(onFinalize) }, inWorkflow);
  if (action === 'in_workflow') {
    return (
      <button
        type="button"
        onClick={onOpenWorkflow}
        title="این سند در گردش کار تأیید است؛ تأیید و قطعی کردن آن از گردش کار انجام می‌شود"
        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60 rounded-lg border border-indigo-200 dark:border-indigo-800 transition cursor-pointer shadow-xs"
      >
        <GitFork className="w-3.5 h-3.5 text-indigo-600" />
        <span>در گردش کار</span>
      </button>
    );
  }
  if (status === 'draft' && makerOfVoucher) {
    return (
      <span
        title="سازنده یا آخرین ویرایشگر سند دستی آن را تأیید نمی‌کند؛ کاربر دیگری باید تأیید کند"
        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-300 bg-amber-50/60 dark:bg-amber-950/30 rounded-lg border border-amber-200/60 dark:border-amber-800/60"
      >
        <Clock className="w-3.5 h-3.5 text-amber-600" />
        <span>در انتظار تأیید دیگری</span>
      </span>
    );
  }
  if (action === 'approve' && onApprove) {
    return (
      <button
        onClick={onApprove}
        title="تایید حسابداری سند و انتقال به دفاتر رسمی"
        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-900/60 rounded-lg border border-blue-200 dark:border-blue-800 transition cursor-pointer shadow-xs"
      >
        <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />
        <span>تایید سند</span>
      </button>
    );
  }
  if (action === 'finalize' && onFinalize) {
    return (
      <button
        onClick={onFinalize}
        title="قطعی‌سازی و قفل سند در دفاتر رسمی"
        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/60 rounded-lg border border-emerald-200 dark:border-emerald-800 transition cursor-pointer shadow-xs"
      >
        <Lock className="w-3.5 h-3.5 text-emerald-600" />
        <span>قطعی‌سازی</span>
      </button>
    );
  }
  if (action === 'locked') {
    return (
      <span
        title="سند دائم در دفاتر کل قفل است و تغییر مستقیم نمی‌پذیرد"
        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/30 rounded-lg border border-emerald-200/60 dark:border-emerald-800/60"
      >
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
        <span>قفل دفاتر</span>
      </span>
    );
  }
  return null;
}
