import React, { useState } from 'react';
import { PhoneCall, Plus, Check, Clock, Calendar, Video, MessageSquare, Mail, FileText, Search, ChevronRight, ChevronLeft, Filter, UserCheck, User, Briefcase } from 'lucide-react';
import { CRMActivity, CRMLead } from '../../types';
import { formatPersianNumber } from '../../utils';

interface CRMFollowupsViewProps {
  activeTab: 'activities' | 'followups';
  activities: CRMActivity[];
  leads?: CRMLead[];
  onOpenActivityModal: () => void;
  onToggleFollowup: (act: CRMActivity) => void;
  // V10-4.1: منبع مسئول تسک = پرسنل فعال
  personnelList?: any[];
}

export function getActivityTypeBadge(type: string) {
  switch (type) {
    case 'call':
      return { label: 'تماس تلفنی', icon: PhoneCall, class: 'bg-blue-100 text-blue-800 border-blue-200' };
    case 'meeting':
      return { label: 'جلسه', icon: Video, class: 'bg-purple-100 text-purple-800 border-purple-200' };
    case 'whatsapp':
      return { label: 'پیام/واتساپ', icon: MessageSquare, class: 'bg-emerald-100 text-emerald-800 border-emerald-200' };
    case 'email':
      return { label: 'ایمیل', icon: Mail, class: 'bg-indigo-100 text-indigo-800 border-indigo-200' };
    case 'quote':
      return { label: 'پیش‌فاکتور', icon: FileText, class: 'bg-amber-100 text-amber-800 border-amber-200' };
    case 'note':
      return { label: 'یادداشت', icon: FileText, class: 'bg-slate-100 text-slate-800 border-slate-200' };
    default:
      return { label: 'اقدام / کار', icon: FileText, class: 'bg-slate-100 text-slate-800 border-slate-200' };
  }
}

export function CRMFollowupsView({
  activeTab,
  activities,
  leads = [],
  onOpenActivityModal,
  onToggleFollowup,
  // V10-4.1: منبع مسئول تسک = پرسنل
  personnelList = []
}: CRMFollowupsViewProps) {
  // Search & Filters for Activities
  const [actSearch, setActSearch] = useState('');
  const [actTypeFilter, setActTypeFilter] = useState<string>('all');
  const [actPage, setActPage] = useState(1);
  const actPageSize = 20;

  // Search & Filters for Followups
  const [folSearch, setFolSearch] = useState('');
  const [folStatusFilter, setFolStatusFilter] = useState<'pending' | 'completed' | 'all'>('pending');
  const [folSellerFilter, setFolSellerFilter] = useState<string>('all');
  const [folPage, setFolPage] = useState(1);
  const folPageSize = 12;

  // Filter Activities tab
  const filteredActivities = activities.filter((act) => {
    if (actTypeFilter !== 'all' && act.type !== actTypeFilter) return false;
    if (actSearch.trim()) {
      const q = actSearch.trim().toLowerCase();
      const matchTitle = (act.title || '').toLowerCase().includes(q);
      const matchDesc = (act.description || '').toLowerCase().includes(q);
      const matchUser = (act.loggedBy || '').toLowerCase().includes(q);
      const matchResult = (act.result || '').toLowerCase().includes(q);
      if (!matchTitle && !matchDesc && !matchUser && !matchResult) return false;
    }
    return true;
  });

  const actTotalPages = Math.ceil(filteredActivities.length / actPageSize) || 1;
  const currentActPage = Math.min(actPage, actTotalPages);
  const paginatedActivities = filteredActivities.slice(
    (currentActPage - 1) * actPageSize,
    currentActPage * actPageSize
  );

  // Filter Followups tab
  const allFollowups = activities.filter((a) => a.nextFollowUpDate && a.nextFollowUpDate.trim().length > 0);
  const filteredFollowups = allFollowups.filter((act) => {
    if (folStatusFilter === 'pending' && act.isFollowUpCompleted) return false;
    if (folStatusFilter === 'completed' && !act.isFollowUpCompleted) return false;
    // V10-4.1: فیلتر مسئول روی id پرسنل (با fallback به snapshot متنی برای رکوردهای قدیمی)
    if (folSellerFilter !== 'all') {
      const selectedPerson = personnelList.find((p: any) => String(p.id) === folSellerFilter);
      const matchesId = act.assignedPersonnelId != null && String(act.assignedPersonnelId) === folSellerFilter;
      const matchesLegacyName = !matchesId && !!selectedPerson && act.assignedTo === selectedPerson.fullName;
      if (!matchesId && !matchesLegacyName) return false;
    }

    if (folSearch.trim()) {
      const q = folSearch.trim().toLowerCase();
      const matchTask = (act.nextFollowUpTask || '').toLowerCase().includes(q);
      const matchTitle = (act.title || '').toLowerCase().includes(q);
      const matchDesc = (act.description || '').toLowerCase().includes(q);
      const matchLogged = (act.loggedBy || '').toLowerCase().includes(q);
      const matchAssign = (act.assignedTo || '').toLowerCase().includes(q);
      if (!matchTask && !matchTitle && !matchDesc && !matchLogged && !matchAssign) return false;
    }
    return true;
  });

  const folTotalPages = Math.ceil(filteredFollowups.length / folPageSize) || 1;
  const currentFolPage = Math.min(folPage, folTotalPages);
  const paginatedFollowups = filteredFollowups.slice(
    (currentFolPage - 1) * folPageSize,
    currentFolPage * folPageSize
  );

  if (activeTab === 'activities') {
    return (
      <div className="space-y-4">
        {/* Header Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200/80">
          <div className="flex items-center gap-2">
            <PhoneCall size={18} className="text-blue-600" />
            <div>
              <h3 className="font-black text-xs text-slate-800">
                دفترچه تمام تماس‌ها و اقدامات ({formatPersianNumber(filteredActivities.length)} مورد)
              </h3>
              <p className="text-[11px] text-slate-500">
                لیست تمام تماس‌های تلفنی، جلسات، پیام‌های واتساپ، ایمیل‌ها و یادداشت‌های ثبت شده
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
              placeholder="جستجو در تماس‌ها و شرح مذاکرات..."
              value={actSearch}
              onChange={(e) => {
                setActSearch(e.target.value);
                setActPage(1);
              }}
              className="w-full pr-9 pl-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:border-blue-500 transition-all"
            />
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2" />
          </div>
        </div>

        {/* Activities Table */}
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
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
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {paginatedActivities.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-400">
                    {actSearch || actTypeFilter !== 'all'
                      ? 'هیچ اقدمی با این فیلتر یا عبارت جستجو یافت نشد.'
                      : 'هنوز هیچ تماسی یا اقدامی ثبت نشده است.'}
                  </td>
                </tr>
              ) : (
                paginatedActivities.map((act, index) => {
                  const badge = getActivityTypeBadge(act.type);
                  const Icon = badge.icon;
                  const rowNum = (currentActPage - 1) * actPageSize + index + 1;

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
                          {act.result || '-'}
                        </span>
                      </td>
                      <td className="p-3 font-medium text-slate-700">{act.loggedBy || '-'}</td>
                      <td className="p-3 text-slate-500 font-mono text-[11px]">{act.activityDate || '-'}</td>
                      <td className="p-3">
                        {act.nextFollowUpDate ? (
                          <div className="flex items-center gap-1.5">
                            <span className={`text-[11px] font-bold ${act.isFollowUpCompleted ? 'text-slate-400 line-through' : 'text-amber-800 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200'}`}>
                              {act.nextFollowUpDate}: {act.nextFollowUpTask || 'پیگیری'}
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
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Activities Pagination */}
        {actTotalPages > 1 && (
          <div className="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
            <span className="text-slate-500">
              نمایش {formatPersianNumber((currentActPage - 1) * actPageSize + 1)} تا {formatPersianNumber(Math.min(currentActPage * actPageSize, filteredActivities.length))} از {formatPersianNumber(filteredActivities.length)} مورد
            </span>

            <div className="flex items-center gap-1">
              <button
                disabled={currentActPage === 1}
                onClick={() => setActPage((p) => Math.max(1, p - 1))}
                className="p-1.5 border rounded-lg bg-white hover:bg-slate-100 disabled:opacity-40 text-slate-700 cursor-pointer"
              >
                <ChevronRight size={16} />
              </button>
              <span className="px-3 font-bold text-slate-800">
                صفحه {formatPersianNumber(currentActPage)} از {formatPersianNumber(actTotalPages)}
              </span>
              <button
                disabled={currentActPage === actTotalPages}
                onClick={() => setActPage((p) => Math.min(actTotalPages, p + 1))}
                className="p-1.5 border rounded-lg bg-white hover:bg-slate-100 disabled:opacity-40 text-slate-700 cursor-pointer"
              >
                <ChevronLeft size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Followups Tab
  return (
    <div className="space-y-4">
      {/* Followups Header Banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-2xs">
        <div className="flex items-center gap-3">
          <Clock className="w-6 h-6 text-amber-600 shrink-0" />
          <div>
            <h4 className="font-bold text-xs text-amber-900">
              لیست کارهای پیگیری و تماس‌های معوقه ({formatPersianNumber(filteredFollowups.length)} مورد)
            </h4>
            <p className="text-[11px] text-amber-700 mt-0.5">
              تمام تسک‌ها و یادآوری‌های پیگیری همراه با تاریخ سررسید. پس از تماس، دکمه «تکمیل پیگیری» را جهت ثبت نتیجه فشار دهید.
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
              setFolStatusFilter('pending');
              setFolPage(1);
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
              folStatusFilter === 'pending'
                ? 'bg-amber-600 text-white border-amber-600 shadow-2xs'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            معوق و نیازمند پیگیری
          </button>
          <button
            onClick={() => {
              setFolStatusFilter('completed');
              setFolPage(1);
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
              folStatusFilter === 'completed'
                ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            تکمیل شده
          </button>
          <button
            onClick={() => {
              setFolStatusFilter('all');
              setFolPage(1);
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
              folStatusFilter === 'all'
                ? 'bg-slate-800 text-white border-slate-800 shadow-2xs'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            همه موارد
          </button>

          {/* Seller / Assignee filter — V10-4.1: منبع پرسنل */}
          {personnelList.length > 0 && (
            <select
              value={folSellerFilter}
              onChange={(e) => {
                setFolSellerFilter(e.target.value);
                setFolPage(1);
              }}
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:border-amber-500 cursor-pointer"
            >
              <option value="all">همه مسئولین تسک</option>
              {personnelList.map((p: any) => (
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
            placeholder="جستجو در تسک‌ها و عنوان..."
            value={folSearch}
            onChange={(e) => {
              setFolSearch(e.target.value);
              setFolPage(1);
            }}
            className="w-full pr-9 pl-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-amber-500 transition-all"
          />
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2" />
        </div>
      </div>

      {/* Followups Cards Grid */}
      {paginatedFollowups.length === 0 ? (
        <div className="p-12 text-center text-slate-400 text-xs bg-slate-50 rounded-2xl border border-dashed border-slate-200 space-y-1">
          <Clock className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="font-bold text-slate-600">هیچ کارهای پیگیری با این فیلتر یا مشخصات یافت نشد.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {paginatedFollowups.map((act) => {
            const leadObj = leads?.find((l) => l.id === act.leadId);
            const displayCustomerName = act.customerName || (act as any).customer_name || leadObj?.customerName || leadObj?.company || '';
            const displayLeadTitle = act.leadTitle || (act as any).lead_title || leadObj?.title || act.title;

            return (
              <div
                key={act.id}
                className={`bg-white rounded-2xl border p-4 shadow-2xs transition-all relative space-y-2.5 ${
                  act.isFollowUpCompleted ? 'border-slate-200 bg-slate-50/50 opacity-70' : 'border-amber-300 shadow-xs'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="px-2.5 py-1 bg-amber-100 text-amber-900 text-[11px] font-mono font-bold rounded-lg flex items-center gap-1 border border-amber-200">
                    <Calendar size={13} />
                    {act.nextFollowUpDate}
                  </span>

                  <button
                    onClick={() => onToggleFollowup(act)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1 cursor-pointer ${
                      act.isFollowUpCompleted
                        ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-2xs'
                    }`}
                  >
                    <Check size={14} />
                    {act.isFollowUpCompleted ? 'انجام شده' : 'تکمیل پیگیری'}
                  </button>
                </div>

                {/* Customer and Lead Badges */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  {displayCustomerName ? (
                    <span className="px-2 py-0.5 bg-blue-50 text-blue-800 border border-blue-200/80 text-[10px] font-bold rounded-md flex items-center gap-1" title="نام مشتری">
                      <User size={11} className="text-blue-600" />
                      مشتری: {displayCustomerName}
                    </span>
                  ) : null}
                  {displayLeadTitle ? (
                    <span className="px-2 py-0.5 bg-purple-50 text-purple-800 border border-purple-200/80 text-[10px] font-bold rounded-md flex items-center gap-1" title="نام پرونده فروش">
                      <Briefcase size={11} className="text-purple-600" />
                      پرونده: {displayLeadTitle}
                    </span>
                  ) : null}
                </div>

                <div>
                  <h4 className="font-black text-xs text-slate-900 mb-0.5">
                    {act.nextFollowUpTask || act.title}
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    اقدام مربوطه: <span className="font-bold text-slate-700">{act.title}</span>
                  </p>
                </div>

                {act.description && (
                  <div className="p-2.5 bg-slate-50 rounded-xl text-[11px] text-slate-600 border border-slate-100 leading-relaxed">
                    {act.description}
                  </div>
                )}

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
                  <span>ثبت: {act.loggedBy || 'فروشنده'}</span>
                  {act.assignedTo && (
                    <span className="font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200 flex items-center gap-1">
                      <UserCheck size={11} />
                      مسئول: {act.assignedTo}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Followups Pagination */}
      {folTotalPages > 1 && (
        <div className="flex items-center justify-between bg-white p-3 rounded-xl border border-slate-200 text-xs mt-4">
          <span className="text-slate-500">
            نمایش {formatPersianNumber((currentFolPage - 1) * folPageSize + 1)} تا {formatPersianNumber(Math.min(currentFolPage * folPageSize, filteredFollowups.length))} از {formatPersianNumber(filteredFollowups.length)} مورد
          </span>

          <div className="flex items-center gap-1">
            <button
              disabled={currentFolPage === 1}
              onClick={() => setFolPage((p) => Math.max(1, p - 1))}
              className="p-1.5 border rounded-lg bg-slate-50 hover:bg-slate-100 disabled:opacity-40 text-slate-700 cursor-pointer"
            >
              <ChevronRight size={16} />
            </button>
            <span className="px-3 font-bold text-slate-800">
              صفحه {formatPersianNumber(currentFolPage)} از {formatPersianNumber(folTotalPages)}
            </span>
            <button
              disabled={currentFolPage === folTotalPages}
              onClick={() => setFolPage((p) => Math.min(folTotalPages, p + 1))}
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

export default CRMFollowupsView;
