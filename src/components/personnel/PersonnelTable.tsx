import React from 'react';
import {
  Search,
  Eye,
  Edit2,
  Trash2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  Copy,
  X,
  RotateCcw,
  ChevronRight,
  ChevronLeft,
  ChevronsRight,
  ChevronsLeft,
  Users
} from 'lucide-react';
import { Personnel } from '../../types';
import { formatPersianCode, formatPersianNumber } from '../../utils';
import { ActionMenu } from '../ActionMenu';
import toast from 'react-hot-toast';

interface PersonnelTableProps {
  personnelList: Personnel[];
  totalFilteredCount: number;
  totalAllCount: number;
  currentPage: number;
  pageSize: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  isLoading: boolean;
  searchQuery: string;
  onSearchChange: (val: string) => void;
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
  onResetFilters: () => void;
  onViewDetail: (p: Personnel) => void;
  onEdit: (p: Personnel) => void;
  onDelete: (p: Personnel) => void;
}

export function PersonnelTable({
  personnelList,
  totalFilteredCount,
  totalAllCount,
  currentPage,
  pageSize,
  totalPages,
  startIndex,
  endIndex,
  onPageChange,
  onPageSizeChange,
  isLoading,
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  onResetFilters,
  onViewDetail,
  onEdit,
  onDelete
}: PersonnelTableProps) {
  const isFiltered = Boolean(searchQuery.trim() || statusFilter !== 'all');

  return (
    <div className="space-y-4">
      {/* Filters & Search Toolbar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Search Input with quick clear and counter */}
        <div className="relative flex-1">
          <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            placeholder="جستجو بر اساس نام، کد پرسنلی، شماره تماس، شغل، کدملی، مهارت یا حساب..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-20 pr-9 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 placeholder:text-slate-400 outline-none focus:border-blue-500 focus:bg-white transition-all"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200/60 transition-all cursor-pointer"
              title="پاک کردن جستجو"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Status Filter Pills & Reset */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0 shrink-0">
          <span className="text-xs font-bold text-slate-500 shrink-0">وضعیت:</span>
          {[
            { id: 'all', label: 'همه' },
            { id: 'فعال', label: 'فعال' },
            { id: 'قطع همکاری', label: 'قطع همکاری' },
            { id: 'مرخصی', label: 'مرخصی' },
            { id: 'تعلیق', label: 'تعلیق' }
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => onStatusFilterChange(item.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
                statusFilter === item.id
                  ? 'bg-slate-900 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {item.label}
            </button>
          ))}

          {isFiltered && (
            <button
              type="button"
              onClick={onResetFilters}
              title="بازنشانی فیلترها"
              className="px-2.5 py-1.5 rounded-xl text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 flex items-center gap-1 shrink-0 transition-all cursor-pointer"
            >
              <RotateCcw size={13} />
              <span>بازنشانی</span>
            </button>
          )}
        </div>
      </div>

      {/* Active Filter Summary Bar */}
      {isFiltered && !isLoading && (
        <div className="px-4 py-2 bg-blue-50/60 border border-blue-100 rounded-xl flex items-center justify-between text-xs text-blue-800">
          <div className="flex items-center gap-2">
            <span className="font-bold">فیلترهای فعال:</span>
            {searchQuery && (
              <span className="bg-white px-2 py-0.5 rounded-md border border-blue-200 text-blue-900 font-semibold">
                عبارت: «{searchQuery}»
              </span>
            )}
            {statusFilter !== 'all' && (
              <span className="bg-white px-2 py-0.5 rounded-md border border-blue-200 text-blue-900 font-semibold">
                وضعیت: {statusFilter}
              </span>
            )}
            <span className="text-blue-600 font-bold">
              ({formatPersianNumber(totalFilteredCount)} پرسنل از مجموع {formatPersianNumber(totalAllCount)})
            </span>
          </div>

          <button
            onClick={onResetFilters}
            className="text-[11px] text-blue-700 hover:text-blue-900 underline font-bold cursor-pointer"
          >
            حذف فیلترها
          </button>
        </div>
      )}

      {/* Main Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-black">
                <th className="p-3">کد پرسنلی</th>
                <th className="p-3">نام و نام خانوادگی</th>
                <th className="p-3">عنوان شغلی</th>
                <th className="p-3">شماره تماس</th>
                <th className="p-3">کد ملی</th>
                <th className="p-3">وضعیت همکاری</th>
                <th className="p-3">حساب سامانه</th>
                <th className="p-3 text-center">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-400 font-bold">
                    در حال بارگذاری مشخصات پرسنل...
                  </td>
                </tr>
              ) : personnelList.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-10 text-center">
                    <div className="max-w-md mx-auto flex flex-col items-center justify-center gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center">
                        <Users size={24} />
                      </div>
                      <p className="text-sm font-bold text-slate-700">
                        {isFiltered
                          ? 'هیچ پرسنلی با مشخصات جستجو یا فیلتر انتخابی پیدا نشد.'
                          : 'هیچ رکورد پرسنلی در سامانه ثبت نشده است.'}
                      </p>
                      {isFiltered && (
                        <button
                          type="button"
                          onClick={onResetFilters}
                          className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer"
                        >
                          <RotateCcw size={14} />
                          پاک کردن جستجو و فیلترها
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                personnelList.map((p) => {
                  const isUser = !!p.userId;
                  return (
                    <tr key={p.id} className="hover:bg-slate-50/80 transition-all text-slate-700 font-bold">
                      <td className="p-3 font-mono text-slate-900">
                        {p.personnelCode ? formatPersianCode(p.personnelCode) : '---'}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-black shrink-0">
                            {p.fullName ? p.fullName.charAt(0) : 'پ'}
                          </div>
                          <div>
                            <span className="font-black text-slate-900 block">{p.fullName}</span>
                            <span className="text-[10px] text-slate-400 font-normal">
                              {p.gender || 'مشخص نشده'} | {p.nationality || 'ایرانی'}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="p-3 text-slate-800">
                        {p.jobTitle || '---'}
                      </td>
                      <td className="p-3 font-mono text-slate-800">
                        {p.phone ? formatPersianCode(p.phone) : '---'}
                      </td>
                      <td className="p-3 font-mono text-slate-600">
                        {p.nationalId ? formatPersianCode(p.nationalId) : '---'}
                      </td>
                      <td className="p-3">
                        {p.employmentStatus === 'فعال' && (
                          <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-[11px] font-black inline-flex items-center gap-1">
                            <CheckCircle2 size={12} />
                            فعال
                          </span>
                        )}
                        {p.employmentStatus === 'قطع همکاری' && (
                          <span className="px-2.5 py-1 bg-rose-50 text-rose-700 border border-rose-200 rounded-lg text-[11px] font-black inline-flex items-center gap-1">
                            <XCircle size={12} />
                            قطع همکاری
                          </span>
                        )}
                        {p.employmentStatus === 'مرخصی' && (
                          <span className="px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg text-[11px] font-black inline-flex items-center gap-1">
                            <Clock size={12} />
                            مرخصی
                          </span>
                        )}
                        {p.employmentStatus === 'تعلیق' && (
                          <span className="px-2.5 py-1 bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-[11px] font-black inline-flex items-center gap-1">
                            <AlertCircle size={12} />
                            تعلیق
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        {isUser ? (
                          <span className="px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-md text-[10px] font-bold">
                            کاربر: {p.username || 'سیستم'}
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400 font-normal">غیرکاربر</span>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => onViewDetail(p)}
                            title="مشاهده پرونده کامل"
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-all cursor-pointer"
                          >
                            <Eye size={16} />
                          </button>
                          <ActionMenu
                            items={[
                              {
                                label: 'ویرایش مشخصات',
                                icon: Edit2,
                                onClick: () => onEdit(p),
                              },
                              {
                                label: 'مشاهده پرونده پرسنلی',
                                icon: Eye,
                                onClick: () => onViewDetail(p),
                              },
                              ...(p.phone
                                ? [
                                    {
                                      label: `کپی شماره تماس (${p.phone})`,
                                      icon: Copy,
                                      onClick: () => {
                                        navigator.clipboard.writeText(p.phone || '');
                                        toast.success('شماره تماس کپی شد');
                                      },
                                    },
                                  ]
                                : []),
                              ...(p.personnelCode
                                ? [
                                    {
                                      label: `کپی کد پرسنلی (${p.personnelCode})`,
                                      icon: Copy,
                                      onClick: () => {
                                        navigator.clipboard.writeText(p.personnelCode || '');
                                        toast.success('کد پرسنلی کپی شد');
                                      },
                                    },
                                  ]
                                : []),
                              {
                                label: 'حذف پرسنل',
                                icon: Trash2,
                                variant: 'danger',
                                onClick: () => onDelete(p),
                              },
                            ]}
                            align="left"
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer Controls */}
        {totalFilteredCount > 0 && (
          <div className="p-3.5 bg-slate-50/90 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
            {/* Range info and page size selector */}
            <div className="flex flex-wrap items-center justify-between sm:justify-start gap-4 w-full sm:w-auto text-xs text-slate-600">
              <span className="font-bold text-slate-700">
                نمایش <span className="text-blue-600 font-mono">{formatPersianNumber(startIndex + 1)}</span> تا{' '}
                <span className="text-blue-600 font-mono">{formatPersianNumber(endIndex)}</span> از{' '}
                <span className="text-blue-600 font-mono">{formatPersianNumber(totalFilteredCount)}</span> پرسنل
              </span>

              <div className="flex items-center gap-1.5 mr-auto sm:mr-0">
                <span className="text-[11px] text-slate-500 font-medium">تعداد در صفحه:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    onPageSizeChange(Number(e.target.value));
                    onPageChange(1);
                  }}
                  className="px-2.5 py-1 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 cursor-pointer"
                >
                  <option value={10}>۱۰ نفر</option>
                  <option value={15}>۱۵ نفر</option>
                  <option value={25}>۲۵ نفر</option>
                  <option value={50}>۵۰ نفر</option>
                  <option value={100}>۱۰۰ نفر</option>
                </select>
              </div>
            </div>

            {/* Pagination Navigation Buttons */}
            {totalPages > 1 && (
              <div className="flex items-center gap-1.5 w-full sm:w-auto justify-center sm:justify-end overflow-x-auto pb-1 sm:pb-0">
                {/* First page button */}
                <button
                  type="button"
                  onClick={() => onPageChange(1)}
                  disabled={currentPage === 1}
                  className="p-2 bg-white border border-slate-200 rounded-xl text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 transition-all font-bold cursor-pointer"
                  title="صفحه اول"
                >
                  <ChevronsRight size={15} />
                </button>

                {/* Prev button */}
                <button
                  type="button"
                  onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 transition-all flex items-center gap-1 font-bold text-xs cursor-pointer"
                >
                  <ChevronRight size={15} />
                  قبلی
                </button>

                {/* Page number buttons */}
                <div className="flex items-center gap-1 px-1">
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                    .map((p, idx, arr) => {
                      const showEllipsis = idx > 0 && p - arr[idx - 1] > 1;
                      return (
                        <React.Fragment key={p}>
                          {showEllipsis && (
                            <span className="px-1 text-slate-400 font-mono text-xs">...</span>
                          )}
                          <button
                            type="button"
                            onClick={() => onPageChange(p)}
                            className={`min-w-8 h-8 px-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                              currentPage === p
                                ? 'bg-slate-900 text-white shadow-2xs font-mono'
                                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 font-mono'
                            }`}
                          >
                            {formatPersianNumber(p)}
                          </button>
                        </React.Fragment>
                      );
                    })}
                </div>

                {/* Next button */}
                <button
                  type="button"
                  onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 transition-all flex items-center gap-1 font-bold text-xs cursor-pointer"
                >
                  بعدی
                  <ChevronLeft size={15} />
                </button>

                {/* Last page button */}
                <button
                  type="button"
                  onClick={() => onPageChange(totalPages)}
                  disabled={currentPage === totalPages}
                  className="p-2 bg-white border border-slate-200 rounded-xl text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 transition-all font-bold cursor-pointer"
                  title="صفحه آخر"
                >
                  <ChevronsLeft size={15} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
