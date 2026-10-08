import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DatabaseZap, RefreshCw, Wrench } from 'lucide-react';
import toast from 'react-hot-toast';
import { fetchJson } from '../../api';
import { errorMessageOf, formatPersianNumber } from '../../utils';
import { confirmAction } from '../ConfirmDialogHost';
import {
  conditionalConstraintCause, type ConditionalConstraintBuildResult, type ConditionalConstraintEntry,
} from '../../lib/system/conditionalConstraints';

/**
 * v9.0.427 (TD-589، B01-09، تصمیم ت۵ الف): قیدها و ایندکس‌های یکتای شرطی مهاجرت‌ها که روی داده ناپاک ساخته نشده‌اند، با
 * علت؛ مدیر سامانه پس از اصلاح داده آن‌ها را می‌سازد. نخست پیش‌نمایش، سپس تأیید و ساختن؛ داده هرگز عوض نمی‌شود.
 */
const QUERY_KEY = ['system', 'conditional-constraints'] as const;

export function ConditionalConstraintsCard() {
  const queryClient = useQueryClient();
  const [isBuilding, setIsBuilding] = useState(false);
  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: ({ signal }) => fetchJson<{ missing: ConditionalConstraintEntry[] }>('/system/conditional-constraints', { signal }),
  });
  const missing = Array.isArray(data?.missing) ? data.missing : [];
  const readyCount = missing.filter(e => e.state === 'ready').length;

  const handleBuild = async () => {
    try {
      setIsBuilding(true);
      const preview = await fetchJson<ConditionalConstraintBuildResult & { message?: string }>('/system/conditional-constraints/build', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apply: false }),
      });
      if (!preview || preview.built.length === 0) {
        toast.error(preview?.message || 'قیدی آماده ساختن نیست؛ نخست داده را اصلاح کنید.');
        return;
      }
      const ok = await confirmAction({
        title: 'ساختن قیدهای جاافتاده',
        message: `${preview.message ?? ''} ساختن قید داده‌ای را عوض نمی‌کند؛ روی جدول بزرگ ممکن است چند لحظه طول بکشد. ادامه می‌دهید؟`,
        confirmText: 'ساختن',
      });
      if (!ok) return;
      const result = await fetchJson<ConditionalConstraintBuildResult & { message?: string }>('/system/conditional-constraints/build', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apply: true }),
      });
      if (result?.failed?.length) toast.error(result.message || 'ساختن برخی قیدها شکست خورد.');
      else toast.success(result?.message || 'قیدها ساخته شدند.');
    } catch (err) {
      toast.error(errorMessageOf(err) || 'ساختن قیدهای جاافتاده انجام نشد؛ دوباره تلاش کنید.');
    } finally {
      setIsBuilding(false);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-xs p-6 space-y-4">
      <div className="flex items-center justify-between border-b border-slate-100 pb-4">
        <div className="flex items-center gap-2 text-slate-800">
          <DatabaseZap className="w-6 h-6 text-indigo-600" />
          <h3 className="font-bold text-lg m-0 p-0 border-0">قیدهای جاافتاده پایگاه‌داده</h3>
        </div>
        <button
          onClick={() => void refetch()}
          disabled={isFetching}
          className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 border border-slate-200 px-3 py-1.5 rounded-xl cursor-pointer hover:bg-slate-50 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          <span>به‌روزرسانی</span>
        </button>
      </div>
      <p className="text-xs text-slate-600 leading-6 m-0">
        مهاجرت‌ها برخی قیدها (پیوند ردیف‌ها به جدول مرجعشان، یکتایی شناسه صیاد، کد حساب و شماره سند، و الزام مقدار چند ستون) را فقط روی داده پاک
        می‌سازند یا تأیید می‌کنند. قیدی که ساخته یا تأیید نشده اینجا با علتش می‌آید؛ داده را اصلاح کنید و سپس قید را بسازید. این کار
        هیچ داده‌ای را عوض نمی‌کند.
      </p>
      {isLoading ? (
        <div className="text-sm text-slate-500">در حال بررسی...</div>
      ) : isError ? (
        <div role="alert" className="text-sm text-red-700">بررسی قیدها انجام نشد؛ دوباره تلاش کنید.</div>
      ) : missing.length === 0 ? (
        <div className="text-sm text-emerald-700">همه قیدها و ایندکس‌های یکتای شرطی مهاجرت‌ها برقرارند.</div>
      ) : (
        <ul className="space-y-2 m-0 p-0 list-none">
          {missing.map(entry => (
            <li key={entry.name} className={`border rounded-xl p-3 text-sm ${entry.state === 'blocked' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
              <div className="font-bold text-slate-800">{entry.label}</div>
              <div className="text-xs text-slate-600 mt-1">{conditionalConstraintCause(entry)}</div>
              <div className="text-[11px] text-slate-400 mt-1" dir="ltr">{entry.name}</div>
            </li>
          ))}
        </ul>
      )}
      {missing.length > 0 && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500">{formatPersianNumber(readyCount)} قید آماده ساختن</span>
          <button
            onClick={() => void handleBuild()}
            disabled={isBuilding || readyCount === 0}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-bold px-4 py-2 rounded-xl cursor-pointer"
          >
            <Wrench className="w-4 h-4" />
            <span>{isBuilding ? 'در حال ساختن...' : 'ساختن قیدهای جاافتاده'}</span>
          </button>
        </div>
      )}
    </div>
  );
}
