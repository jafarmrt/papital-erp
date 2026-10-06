import { useState } from 'react';
import { Clock, Search, ChevronRight, ChevronLeft } from 'lucide-react';
import type { CRMActivity, CRMLead } from '../../types';
import { formatPersianNumber } from '../../utils';
import { useDebounce } from '../../hooks/useDebounce';
import { useCrmFollowups } from '../../hooks/useCrmFollowups';
import type { FollowupStatusFilter } from '../../lib/crm/crmFollowupsQuery';
import { CRMFollowupCard } from './CRMFollowupCard';

interface PersonnelOption {
  id: number | string;
  fullName?: string;
}

interface CRMFollowupsPanelProps {
  leads?: CRMLead[];
  onToggleFollowup: (act: CRMActivity) => void;
  personnelList?: PersonnelOption[];
}

const PAGE_SIZE = 12;

/**
 * v9.0.14 (TD-428، تصمیم مالک محصول ت۵ الف): زبانه «پیگیری‌ها» از `GET /crm/followups` می‌خواند؛ وضعیت، مسئول، جست‌وجو و
 * صفحه در سرور اعمال می‌شوند. پیش‌تر از فهرست اقدام‌های ۳۰ روز اخیر (سقف ۲۰۰ ردیف) فیلتر می‌شد و پیگیری معوقِ اقدام
 * قدیمی‌تر دیده نمی‌شد.
 */
export function CRMFollowupsPanel({ leads = [], onToggleFollowup, personnelList = [] }: CRMFollowupsPanelProps) {
  const [status, setStatus] = useState<FollowupStatusFilter>('pending');
  const [seller, setSeller] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search);
  const { data: followups, total, totalPages, loading } = useCrmFollowups({
    status, assignedPersonnelId: seller, search: debouncedSearch, page, limit: PAGE_SIZE,
  });
  const currentPage = Math.min(page, totalPages);

  return (
    <div className="space-y-4">
      {/* Followups Header Banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-2xs">
        <div className="flex items-center gap-3">
          <Clock className="w-6 h-6 text-amber-600 shrink-0" />
          <div>
            <h4 className="font-bold text-xs text-amber-900">
              لیست کارهای پیگیری و تماس‌های معوقه ({formatPersianNumber(total)} مورد)
            </h4>
            <p className="text-[11px] text-amber-700 mt-0.5">
              همه پیگیری‌ها و یادآوری‌ها همراه با تاریخ سررسید. پس از تماس، دکمه «تکمیل پیگیری» را جهت ثبت نتیجه فشار دهید.
            </p>
          </div>
        </div>
      </div>

      {/* Filter Controls for Followups */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200">
        <div className="flex flex-wrap items-center gap-2">
          {/* Status filter buttons */}
          <button
            onClick={() => {
              setStatus('pending');
              setPage(1);
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
              status === 'pending'
                ? 'bg-amber-600 text-white border-amber-600 shadow-2xs'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            معوق و نیازمند پیگیری
          </button>
          <button
            onClick={() => {
              setStatus('completed');
              setPage(1);
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
              status === 'completed'
                ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            تکمیل شده
          </button>
          <button
            onClick={() => {
              setStatus('all');
              setPage(1);
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
              status === 'all'
                ? 'bg-slate-800 text-white border-slate-800 shadow-2xs'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            همه موارد
          </button>

          {/* Seller / Assignee filter — V10-4.1: منبع پرسنل */}
          {personnelList.length > 0 && (
            <select
              value={seller}
              onChange={(e) => {
                setSeller(e.target.value);
                setPage(1);
              }}
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:border-amber-500 cursor-pointer"
            >
              <option value="all">همه مسئولان پیگیری</option>
              {personnelList.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.fullName}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Search input for followups */}
        <div className="relative w-full sm:w-64">
          <input
            type="text"
            placeholder="جست‌وجو در پیگیری‌ها و عنوان…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full pr-9 pl-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-amber-500 transition-all"
          />
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2" />
        </div>
      </div>

      {/* Followups Cards Grid */}
      {followups.length === 0 ? (
        <div className="p-12 text-center text-slate-400 text-xs bg-slate-50 rounded-2xl border border-dashed border-slate-200 space-y-1">
          <Clock className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="font-bold text-slate-600">{loading ? 'در حال دریافت پیگیری‌ها…' : 'هیچ کارهای پیگیری با این فیلتر یا مشخصات یافت نشد.'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {followups.map((act) => (
            <CRMFollowupCard key={act.id} act={act} leads={leads} onToggleFollowup={onToggleFollowup} />
          ))}
        </div>
      )}

      {/* Followups Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between bg-white p-3 rounded-xl border border-slate-200 text-xs mt-4">
          <span className="text-slate-500">
            نمایش {formatPersianNumber((currentPage - 1) * PAGE_SIZE + 1)} تا {formatPersianNumber(Math.min(currentPage * PAGE_SIZE, total))} از {formatPersianNumber(total)} مورد
          </span>

          <div className="flex items-center gap-1">
            <button
              disabled={currentPage === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="p-1.5 border rounded-lg bg-slate-50 hover:bg-slate-100 disabled:opacity-40 text-slate-700 cursor-pointer"
            >
              <ChevronRight size={16} />
            </button>
            <span className="px-3 font-bold text-slate-800">
              صفحه {formatPersianNumber(currentPage)} از {formatPersianNumber(totalPages)}
            </span>
            <button
              disabled={currentPage === totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="p-1.5 border rounded-lg bg-slate-50 hover:bg-slate-100 disabled:opacity-40 text-slate-700 cursor-pointer"
            >
              <ChevronLeft size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
