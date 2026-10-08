import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, FileText, GitPullRequest, HelpCircle, Send, XCircle } from 'lucide-react';
import { formatPersianNumber } from '../../utils';
import {
  SUBSYSTEM_UNKNOWN_LABEL, SUBSYSTEM_UNKNOWN_MESSAGES, subsystemStatusOf,
  type AccountingHealth, type OutboxHealth, type SubsystemStatus, type WorkflowHealth,
} from '../../lib/system/subsystemHealth';

/**
 * v9.0.358 (TD-593، B01-13): کارت‌های صف رویدادها، تراز اسناد و گردش کار صفحه سلامت. وضعیتی که سرور نتوانست بخواند
 * («نامعلوم») رنگ و متن خودش را دارد و پیام سرور را نشان می‌دهد؛ هرگز «روان» یا «همه اسناد فعال تراز هستند» نمی‌گوید.
 */

const CARD_TONES: Record<SubsystemStatus, string> = {
  ok: 'bg-emerald-50/50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800',
  warning: 'bg-amber-50/50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800',
  error: 'bg-rose-50/50 border-rose-200 dark:bg-rose-950/20 dark:border-rose-800',
  unknown: 'bg-slate-100 border-slate-300 border-dashed dark:bg-gray-900/60 dark:border-gray-600',
};

const BADGE_TONES: Record<SubsystemStatus, string> = {
  ok: 'bg-emerald-100 text-emerald-800',
  warning: 'bg-amber-100 text-amber-800',
  error: 'bg-rose-100 text-rose-800',
  unknown: 'bg-slate-200 text-slate-700',
};

const BADGE_ICONS: Record<SubsystemStatus, ReactNode> = {
  ok: <CheckCircle2 size={12} />,
  warning: <AlertTriangle size={12} />,
  error: <XCircle size={12} />,
  unknown: <HelpCircle size={12} />,
};

/** A count the server could not read is «نامعلوم», never 0 */
function countText(value: number | null | undefined, unit = ''): string {
  if (typeof value !== 'number') return SUBSYSTEM_UNKNOWN_LABEL;
  return unit ? `${formatPersianNumber(value)} ${unit}` : formatPersianNumber(value);
}

function SubsystemCard({ status, icon, title, badge, children }: {
  status: SubsystemStatus; icon: ReactNode; title: string; badge: string; children: ReactNode;
}) {
  return (
    <div className={`p-4 border rounded-xl transition-all ${CARD_TONES[status]}`} data-status={status}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 font-bold text-sm text-slate-800 dark:text-slate-100">
          {icon}
          <span>{title}</span>
        </div>
        <span className={`${BADGE_TONES[status]} text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1`}>
          {BADGE_ICONS[status]} {badge}
        </span>
      </div>
      {children}
    </div>
  );
}

function CountRow({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span className={`font-bold ${alert ? 'text-rose-600' : ''}`}>{value}</span>
    </div>
  );
}

function UnknownNote({ message }: { message: string }) {
  return <p className="text-xs text-slate-700 dark:text-slate-300 mb-2" role="status">{message}</p>;
}

function OutboxCard({ outbox }: { outbox?: OutboxHealth }) {
  const status = subsystemStatusOf(outbox);
  const badge = status === 'unknown' ? SUBSYSTEM_UNKNOWN_LABEL
    : status === 'ok' ? 'روان' : `${countText(outbox?.dlqCount)} ناموفق`;
  return (
    <SubsystemCard status={status} icon={<Send size={18} className="text-slate-600" />} title="صف رویدادها" badge={badge}>
      {status === 'unknown' && <UnknownNote message={outbox?.message || SUBSYSTEM_UNKNOWN_MESSAGES.outbox} />}
      <div className="space-y-1 text-xs text-slate-600 dark:text-slate-300 mb-2">
        <CountRow label="رویدادهای در صف ارسال:" value={countText(outbox?.pendingCount)} />
        <CountRow label="رویدادهای ناموفق:" value={countText(outbox?.dlqCount)} alert={(outbox?.dlqCount ?? 0) > 0} />
      </div>
    </SubsystemCard>
  );
}

function AccountingCard({ accounting }: { accounting?: AccountingHealth }) {
  const status = subsystemStatusOf(accounting);
  const unbalanced = accounting?.unbalancedVouchers ?? 0;
  return (
    <SubsystemCard
      status={status} icon={<FileText size={18} className="text-indigo-600" />} title="تراز اسناد حسابداری"
      badge={status === 'unknown' ? SUBSYSTEM_UNKNOWN_LABEL : countText(accounting?.totalVouchers, 'سند')}
    >
      {status === 'unknown' ? (
        <UnknownNote message={accounting?.message || SUBSYSTEM_UNKNOWN_MESSAGES.accounting} />
      ) : (
        <p className={`text-xs mb-2 ${unbalanced > 0 ? 'text-rose-600 font-bold' : 'text-slate-600 dark:text-slate-300'}`}>
          {unbalanced > 0
            ? `${formatPersianNumber(unbalanced)} سند ناتراز (اختلاف بدهکار و بستانکار بیش از ۰٫۰۱) یافت شد.`
            : 'همه اسناد فعال تراز هستند.'}
        </p>
      )}
    </SubsystemCard>
  );
}

function WorkflowCard({ workflow }: { workflow?: WorkflowHealth }) {
  const status = subsystemStatusOf(workflow);
  return (
    <SubsystemCard
      status={status} icon={<GitPullRequest size={18} className="text-purple-600" />} title="گردش کار و مهلت‌ها"
      badge={status === 'unknown' ? SUBSYSTEM_UNKNOWN_LABEL : countText(workflow?.activeInstances, 'در جریان')}
    >
      {status === 'unknown' && <UnknownNote message={workflow?.message || SUBSYSTEM_UNKNOWN_MESSAGES.workflow} />}
      <div className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
        <CountRow
          label="کارهای گذشته از مهلت:" value={countText(workflow?.overdueSlaTasks, 'کار')}
          alert={(workflow?.overdueSlaTasks ?? 0) > 0}
        />
      </div>
    </SubsystemCard>
  );
}

export function SubsystemHealthCards({ outbox, accounting, workflow }: {
  outbox?: OutboxHealth; accounting?: AccountingHealth; workflow?: WorkflowHealth;
}) {
  return (
    <>
      <OutboxCard outbox={outbox} />
      <AccountingCard accounting={accounting} />
      <WorkflowCard workflow={workflow} />
    </>
  );
}
