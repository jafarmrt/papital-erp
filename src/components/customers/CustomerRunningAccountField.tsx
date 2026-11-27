import { useId } from 'react';
import { UserCheck } from 'lucide-react';
import { usePersonnelListQuery } from '../../hooks/queries/usePersonnelQueries';
import { RUNNING_ACCOUNT_LABELS, type PartyRunningAccount } from '../../lib/accounting/runningAccount';

/**
 * v12 colleague and partner sales (docs/roadmap/V12_COLLEAGUE_SALES_START_PLAN.md §4.1): «این طرف حساب همکار یا شریک
 * است». A party linked to a colleague of the personnel has every final sales invoice on that person's running account
 * («حساب جاری همکار» 3208, or «حساب جاری شرکا» 4101 for a partner) instead of trade receivables, settled from it at once.
 */
export const RUNNING_ACCOUNT_FIELD_TEXT = {
  title: 'فروش به همکار یا شریک',
  personnel: 'همکار یا شریک',
  account: 'فاکتورها به کدام حساب برود',
  none: 'طرف حساب عادی (حساب‌های دریافتنی)',
  hint: 'هر فاکتور قطعی این طرف حساب به حساب جاری همان همکار می‌رود و از همان حساب تسویه می‌شود، پس در فهرست مطالبات نمی‌آید. فاکتورهایی که پیش‌تر صادر شده‌اند جابه‌جا نمی‌شوند.',
} as const;

interface Props {
  personnelId: number | '';
  runningAccount: PartyRunningAccount;
  onChange: (value: { personnelId: number | ''; runningAccount: PartyRunningAccount }) => void;
}

const SELECT = 'w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium';

export function CustomerRunningAccountField({ personnelId, runningAccount, onChange }: Props) {
  const fieldId = useId();
  const personnelQuery = usePersonnelListQuery();
  const people = Array.isArray(personnelQuery.data) ? personnelQuery.data : [];
  return (
    <div className="space-y-3 bg-slate-50/50 p-4 rounded-xl border border-slate-200">
      <h4 className="text-xs font-bold text-slate-700 border-b border-slate-200 pb-1.5 flex items-center gap-1.5">
        <UserCheck size={14} className="text-blue-600" />
        {RUNNING_ACCOUNT_FIELD_TEXT.title}
      </h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${fieldId}-account`} className="block text-xs font-bold mb-1 text-slate-700">{RUNNING_ACCOUNT_FIELD_TEXT.account}</label>
          <select id={`${fieldId}-account`} className={SELECT} value={runningAccount}
            onChange={e => {
              const next = e.target.value as PartyRunningAccount;
              onChange({ runningAccount: next, personnelId: next ? personnelId : '' });
            }}>
            <option value="">{RUNNING_ACCOUNT_FIELD_TEXT.none}</option>
            <option value="colleague">{RUNNING_ACCOUNT_LABELS.colleague}</option>
            <option value="partner">{RUNNING_ACCOUNT_LABELS.partner}</option>
          </select>
        </div>
        {runningAccount && (
          <div>
            <label htmlFor={`${fieldId}-personnel`} className="block text-xs font-bold mb-1 text-slate-700">{RUNNING_ACCOUNT_FIELD_TEXT.personnel} <span className="text-rose-500">*</span></label>
            <select id={`${fieldId}-personnel`} className={SELECT} required value={personnelId}
              onChange={e => onChange({ runningAccount, personnelId: e.target.value ? Number(e.target.value) : '' })}>
              <option value="">انتخاب کنید</option>
              {people.map(p => <option key={p.id} value={p.id}>{p.fullName}</option>)}
            </select>
          </div>
        )}
      </div>
      {runningAccount && <p className="text-[11px] text-slate-500 leading-relaxed">{RUNNING_ACCOUNT_FIELD_TEXT.hint}</p>}
    </div>
  );
}
