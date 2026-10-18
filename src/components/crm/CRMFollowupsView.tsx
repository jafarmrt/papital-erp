import { useEffect, useState } from 'react';
import { PhoneCall, Plus, Check, Video, MessageSquare, Mail, FileText, Search } from 'lucide-react';
import { CRMActivity, CRMLead } from '../../types';
import { useDebounce } from '../../hooks/useDebounce';
import { useCrmActivityPage } from '../../hooks/useCrmListPages';
import { CRM_ACTIVITY_PAGE_SIZE } from '../../lib/crm/crmListPages';
import { CrmPager } from './CrmPager';
import { formatPersianNumber, formatPersianDate } from '../../utils';
import { CRMFollowupsPanel } from './CRMFollowupsPanel';
import { ActivityRowActions } from './ActivityRowActions';
import { activityResultLabel } from '../../lib/crm/crmScreenText';
import { activityTypeLabel } from '../../lib/crm/activityTypes';

interface CRMFollowupsViewProps {
  activeTab: 'activities' | 'followups';
  /** v10.2 package 7 (OBS-R2-28): the page's date range; the book reads its pages from the server */
  fromDate?: string;
  toDate?: string;
  leads?: CRMLead[];
  onOpenActivityModal: () => void;
  onToggleFollowup: (act: CRMActivity) => void;
  /** v10.1.18 (N-02 بخش ۲): ویرایش و حذف اقدام */
  onEditActivity?: (act: CRMActivity) => void;
  onDeleteActivity?: (act: CRMActivity) => void;
  // V10-4.1: منبع مسئول تسک = پرسنل فعال
  personnelList?: any[];
}

const ACTIVITY_TYPE_STYLES: Readonly<Record<string, { icon: typeof PhoneCall; class: string }>> = {
  call: { icon: PhoneCall, class: 'bg-blue-100 text-blue-800 border-blue-200' },
  meeting: { icon: Video, class: 'bg-purple-100 text-purple-800 border-purple-200' },
  whatsapp: { icon: MessageSquare, class: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  email: { icon: Mail, class: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
  quote: { icon: FileText, class: 'bg-amber-100 text-amber-800 border-amber-200' },
};
const DEFAULT_TYPE_STYLE = { icon: FileText, class: 'bg-slate-100 text-slate-800 border-slate-200' };

/** v10.2 package 7 (OBS-R2-32): the name comes from `activityTypeLabel`, shared with the dossier */
export function getActivityTypeBadge(type: string) {
  return { label: activityTypeLabel(type), ...(ACTIVITY_TYPE_STYLES[type] ?? DEFAULT_TYPE_STYLE) };
}

export function CRMFollowupsView({
  activeTab,
  fromDate,
  toDate,
  leads = [],
  onOpenActivityModal,
  onToggleFollowup,
  onEditActivity,
  onDeleteActivity,
  // V10-4.1: منبع مسئول تسک = پرسنل
  personnelList = []
}: CRMFollowupsViewProps) {
  // v10.2 package 7 (OBS-R2-28): search, type and page are applied on the server; the search waits for a pause
  const [actSearch, setActSearch] = useState('');
  const [actTypeFilter, setActTypeFilter] = useState<string>('all');
  const [actPage, setActPage] = useState(1);
  const debouncedSearch = useDebounce(actSearch, 300);
  const book = useCrmActivityPage(
    { fromDate, toDate, search: debouncedSearch, type: actTypeFilter, page: actPage, limit: CRM_ACTIVITY_PAGE_SIZE },
    activeTab === 'activities',
  );
  useEffect(() => setActPage(1), [fromDate, toDate, debouncedSearch]);
  const currentActPage = Math.min(actPage, book.totalPages);
  const paginatedActivities = book.data;

  if (activeTab === 'activities') {
    return (
      <div className="space-y-4">
        {/* Header Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200/80">
          <div className="flex items-center gap-2">
            <PhoneCall size={18} className="text-blue-600" />
            <div>
              <h3 className="font-black text-xs text-slate-800">
                دفترچه تمام تماس‌ها و اقدامات ({formatPersianNumber(book.total)} مورد)
              </h3>
              <p className="text-[11px] text-slate-500">
                فهرست تمام تماس‌های تلفنی، جلسات، پیام‌های واتساپ، ایمیل‌ها و یادداشت‌های ثبت شده
              </p>
            </div>
          </div>

          <button
            onClick={onOpenActivityModal}
            className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-xs shrink-0"
          >
            <Plus size={15} />
            ثبت تماس / اقدام جدید
          </button>
        </div>

        {/* Filter & Search Controls */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          {/* Type Filter Buttons */}
          <div className="flex flex-wrap items-center gap-1 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
            {[
              { id: 'all', label: 'همه' },
              { id: 'call', label: '📞 تماس' },
              { id: 'meeting', label: '👥 جلسه' },
              { id: 'whatsapp', label: '💬 واتساپ/پیام' },
              { id: 'email', label: '✉️ ایمیل' },
              { id: 'quote', label: '📑 پیش‌فاکتور' },
              { id: 'note', label: '📝 یادداشت' },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setActTypeFilter(t.id);
                  setActPage(1);
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                  actTypeFilter === t.id
                    ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Search Box */}
          <div className="relative w-full sm:w-64">
            <input
              type="text"
              placeholder="جست‌وجو در تماس‌ها و شرح مذاکرات..."
              value={actSearch}
              onChange={(e) => setActSearch(e.target.value)}
              className="w-full pr-9 pl-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:border-blue-500 transition-all"
            />
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2" />
          </div>
        </div>

        {book.error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-center justify-between gap-2" role="alert">
            <span>{book.error}</span>
            <button type="button" onClick={book.refetch} className="px-3 py-1 bg-white border border-rose-200 rounded-lg font-bold cursor-pointer">تلاش دوباره</button>
          </div>
        )}

        {/* Activities Table */}
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white" aria-busy={book.loading}>
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-100/80 text-slate-700 font-bold border-b border-slate-200">
              <tr>
                <th className="p-3 w-12 text-center">#</th>
                <th className="p-3">نوع اقدام</th>
                <th className="p-3">عنوان تماس / اقدام</th>
                <th className="p-3">شرح و خلاصه مذاکره</th>
                <th className="p-3">نتیجه</th>
                <th className="p-3">ثبت‌کننده</th>
                <th className="p-3">تاریخ انجام</th>
                <th className="p-3">پیگیری بعدی</th>
                <th className="p-3 w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {paginatedActivities.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-400">
                    {book.loading
                      ? 'در حال دریافت اقدام‌ها…'
                      : actSearch || actTypeFilter !== 'all'
                        ? 'هیچ اقدامی با این شرط‌ها یا عبارت جست‌وجو یافت نشد.'
                        : 'هنوز هیچ تماسی یا اقدامی ثبت نشده است.'}
                  </td>
                </tr>
              ) : (
                paginatedActivities.map((act, index) => {
                  const badge = getActivityTypeBadge(act.type);
                  const Icon = badge.icon;
                  const rowNum = (currentActPage - 1) * CRM_ACTIVITY_PAGE_SIZE + index + 1;

                  return (
                    <tr key={act.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-3 text-center text-slate-400 font-mono text-[11px]">{formatPersianNumber(rowNum)}</td>
                      <td className="p-3">
                        <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold flex items-center gap-1.5 w-fit border ${badge.class}`}>
                          <Icon size={12} />
                          {badge.label}
                        </span>
                      </td>
                      <td className="p-3 font-bold text-slate-900">{act.title}</td>
                      <td className="p-3 text-slate-600 max-w-xs truncate" title={act.description}>
                        {act.description || '-'}
                      </td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-700 font-semibold rounded-md text-[11px]">
                          {activityResultLabel(act.result) || '-'}
                        </span>
                      </td>
                      <td className="p-3 font-medium text-slate-700">{act.loggedBy || '-'}</td>
                      <td className="p-3 text-slate-500 font-mono text-[11px]">{formatPersianDate(act.activityDate)}</td>
                      <td className="p-3">
                        {act.nextFollowUpDate ? (
                          <div className="flex items-center gap-1.5">
                            <span className={`text-[11px] font-bold ${act.isFollowUpCompleted ? 'text-slate-400 line-through' : 'text-amber-800 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200'}`}>
                              {formatPersianDate(act.nextFollowUpDate)}: {act.nextFollowUpTask || 'پیگیری'}
                            </span>
                            <button
                              onClick={() => onToggleFollowup(act)}
                              className={`p-1 rounded-md transition-colors cursor-pointer ${
                                act.isFollowUpCompleted ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400 hover:text-emerald-600'
                              }`}
                              title={act.isFollowUpCompleted ? 'انجام شد (تغییر وضعیت)' : 'علامت زدن به‌عنوان انجام شده'}
                            >
                              <Check size={13} />
                            </button>
                          </div>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="p-3">
                        <ActivityRowActions activity={act} onEdit={onEditActivity} onDelete={onDeleteActivity} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <CrmPager page={currentActPage} totalPages={book.totalPages} total={book.total} limit={CRM_ACTIVITY_PAGE_SIZE} onPage={setActPage} disabled={book.loading} />
      </div>
    );
  }

  // v9.0.14 (TD-428): زبانه پیگیری‌ها از سرور (`CRMFollowupsPanel`)
  return <CRMFollowupsPanel leads={leads} onToggleFollowup={onToggleFollowup} personnelList={personnelList} onEditActivity={onEditActivity} onDeleteActivity={onDeleteActivity} />;
}

export default CRMFollowupsView;
