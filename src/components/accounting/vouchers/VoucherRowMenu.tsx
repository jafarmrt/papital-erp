import React from 'react';
import { Edit3, Trash2, RotateCcw, History, GitFork, Lock } from 'lucide-react';
import type { JournalVoucher } from '../../../types';
import { voucherLockNote, voucherRowActions, type VoucherRowAction } from '../../../lib/accounting/voucherRowActions';

/**
 * v9.0.298 (TD-568، B03-26): منوی «...» ردیف سند حسابداری؛ کارها از `voucherRowActions` می‌آیند، همان قاعده‌های سرور.
 * سند منشأدار یا سند بستن سال به‌جای کارهای تغییر، دلیل قفل را نشان می‌دهد.
 */
interface VoucherRowMenuProps {
  voucher: JournalVoucher;
  onAction: (action: VoucherRowAction, voucher: JournalVoucher) => void;
  /** v10.0.21 (TD-965): بازگشت به پیش‌نویس فقط برای دارنده «تأیید و قطعی کردن سند حسابداری» */
  canApprove?: boolean;
}

const ITEM = 'w-full flex items-center gap-2 px-3 py-2 text-xs transition cursor-pointer';

const ACTION_VIEW: Record<VoucherRowAction, { label: string; className: string; icon: React.ReactNode }> = {
  edit: { label: 'ویرایش پیش‌نویس', className: 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60', icon: <Edit3 className="w-3.5 h-3.5 text-blue-500" /> },
  delete: { label: 'حذف پیش‌نویس', className: 'text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40', icon: <Trash2 className="w-3.5 h-3.5" /> },
  revert_to_draft: { label: 'بازگشت به پیش‌نویس', className: 'text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40', icon: <RotateCcw className="w-3.5 h-3.5 text-amber-500" /> },
  reverse: { label: 'صدور سند برگشتی (ابطال سند)', className: 'text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40', icon: <RotateCcw className="w-3.5 h-3.5 text-amber-500" /> },
  correct: { label: 'صدور سند اصلاحی جایگزین', className: 'text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/40', icon: <History className="w-3.5 h-3.5 text-purple-500" /> },
  workflow: { label: 'گردش کار تأیید سند', className: 'text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40', icon: <GitFork className="w-3.5 h-3.5 text-indigo-500" /> },
};

export function VoucherRowMenu({ voucher, onAction, canApprove = true }: VoucherRowMenuProps) {
  const actions = voucherRowActions(voucher, { canApprove });
  const changes = actions.filter(a => a !== 'workflow');
  const lockNote = voucherLockNote(voucher);
  return (
    <div
      className="absolute left-0 mt-1 w-56 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 py-1.5 z-40 animate-in fade-in zoom-in-95 text-right font-sans"
      onClick={(e) => e.stopPropagation()}
      role="menu"
    >
      {lockNote && (
        <div className="flex items-start gap-2 px-3 py-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
          <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{lockNote}</span>
        </div>
      )}
      {changes.map(action => (
        <button key={action} type="button" role="menuitem" onClick={() => onAction(action, voucher)} className={`${ITEM} ${ACTION_VIEW[action].className}`}>
          {ACTION_VIEW[action].icon}
          <span>{ACTION_VIEW[action].label}</span>
        </button>
      ))}
      <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
      <button type="button" role="menuitem" onClick={() => onAction('workflow', voucher)} className={`${ITEM} ${ACTION_VIEW.workflow.className}`}>
        {ACTION_VIEW.workflow.icon}
        <span>{ACTION_VIEW.workflow.label}</span>
      </button>
    </div>
  );
}
