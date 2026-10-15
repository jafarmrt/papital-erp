import React, { useState } from 'react';
import { useCreateDelegationMutation } from '../../hooks/queries/useWorkflowQueries';
import { useDelegationScopesQuery, useDelegationUsersQuery } from '../../hooks/queries/useWorkflowDelegationQueries';
import { toStorageDate, getTodayJalaliDate, getFutureJalaliDate } from '../../utils';
import { JalaliDateInput } from '../common/JalaliDateInput';
import { toast } from 'react-hot-toast';
import { OFFLINE_SUBMIT_TITLE, PHONE_TAP_TARGET } from '../../lib/pwa/phoneLayout';
import { useOnlineStatus } from '../../lib/pwa/useOnlineStatus';

const FIELD = 'w-full px-3 py-2 text-xs bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl focus:outline-hidden focus:border-indigo-500 dark:text-white';
const LABEL = 'block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1';

/**
 * v10.1.14 (D-06 part C, OBS-R2-73): the one delegation form, used by the workflow page's delegation tab and the inbox's
 * «تفویض کارهایم». The deputy comes from `/users/list-simple` (the user may not delegate to themself) and the scope from
 * `/workflow/delegation-scopes`, so an approver without the design keys can fill it; the server refuses an overlapping
 * delegation with its message (decision ت۹).
 */
export function DelegationForm({ currentUserId, onDone, onCancel }: {
  currentUserId?: number;
  onDone?: () => void;
  onCancel?: () => void;
}): React.ReactElement {
  const { data: users = [] } = useDelegationUsersQuery();
  const { data: scopes = [] } = useDelegationScopesQuery();
  const createMutation = useCreateDelegationMutation();
  const online = useOnlineStatus();

  // v7.0.136 (TD-232): امروز و هفته بعد در منطقه زمانی کسب‌وکار؛ انتخاب با تقویم شمسی، مقدار ISO
  const today = toStorageDate(getTodayJalaliDate()) || '';
  const nextWeek = toStorageDate(getFutureJalaliDate(7)) || '';
  const [toUserId, setToUserId] = useState<number | ''>('');
  const [scope, setScope] = useState('ALL');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(nextWeek);
  const [reason, setReason] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!toUserId) {
      toast.error('کاربر جانشین را انتخاب کنید.');
      return;
    }
    if (!startDate || !endDate) {
      toast.error('تاریخ آغاز و پایان تفویض را انتخاب کنید.');
      return;
    }
    try {
      // TD-468 (یافته B14-26): روزهای انتخابی؛ سرور آغاز روز اول و پایان روز آخر را در منطقه زمانی توافقی می‌گیرد
      await createMutation.mutateAsync({ toUserId: Number(toUserId), scope, startDate, endDate, reason });
      setToUserId('');
      setScope('ALL');
      setStartDate(today);
      setEndDate(nextWeek);
      setReason('');
      onDone?.();
    } catch {
      // the mutation shows the server's message
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className={LABEL}>
          کاربر جانشین (دریافت‌کننده تفویض) <span className="text-rose-500">*</span>
        </label>
        <select value={toUserId} onChange={(e) => setToUserId(e.target.value ? Number(e.target.value) : '')} required className={FIELD}>
          <option value="">-- انتخاب کاربر جانشین --</option>
          {users.filter((u) => u.id !== currentUserId).map((u) => (
            <option key={u.id} value={u.id}>{u.full_name || u.username}</option>
          ))}
        </select>
      </div>

      <div>
        <label className={LABEL}>حوزه تفویض</label>
        <select value={scope} onChange={(e) => setScope(e.target.value)} className={FIELD}>
          {/* TD-467 (یافته B14-25، تصمیم ت۶ الف): فقط «همه» و گردش‌کارهای تعریف‌شده */}
          <option value="ALL">همه گردش‌کارها</option>
          {scopes.map((s) => (
            <option key={s.code} value={s.code}>گردش کار: {s.title}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={LABEL}>تاریخ آغاز تفویض <span className="text-rose-500">*</span></label>
          <JalaliDateInput value={startDate} onChange={setStartDate} className={FIELD} />
        </div>
        <div>
          <label className={LABEL}>تاریخ پایان تفویض <span className="text-rose-500">*</span></label>
          <JalaliDateInput value={endDate} onChange={setEndDate} className={FIELD} />
        </div>
      </div>

      <div>
        <label className={LABEL}>علت تفویض / توضیحات</label>
        <textarea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="مثال: مرخصی استحقاقی سالانه یا مأموریت کاری..."
          className={FIELD}
        />
      </div>
      <p className="text-[11px] text-gray-500 dark:text-gray-400">
        در هر بازه برای هر گردش کار یک جانشین دارید؛ تفویض هم‌پوشان پذیرفته نمی‌شود.
      </p>

      <div className="flex items-center justify-end gap-2 border-t border-gray-100 dark:border-gray-700 pt-3">
        {onCancel && (
          <button type="button" onClick={onCancel} className={`px-4 py-2 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors ${PHONE_TAP_TARGET}`}>
            انصراف
          </button>
        )}
        <button
          type="submit"
          disabled={createMutation.isPending || !online}
          title={online ? undefined : OFFLINE_SUBMIT_TITLE}
          className={`px-4 py-2 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-colors shadow-xs disabled:opacity-50 ${PHONE_TAP_TARGET}`}
        >
          {createMutation.isPending ? 'در حال ثبت...' : 'ثبت تفویض اختیار'}
        </button>
      </div>
    </form>
  );
}
