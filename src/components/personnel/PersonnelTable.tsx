import React from 'react';
import { Search, Eye, Edit2, Trash2, CheckCircle2, XCircle, Clock, AlertCircle } from 'lucide-react';
import { Personnel } from '../../types';
import { formatPersianCode } from '../../utils';

interface PersonnelTableProps {
  personnelList: Personnel[];
  isLoading: boolean;
  searchQuery: string;
  onSearchChange: (val: string) => void;
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
  onViewDetail: (p: Personnel) => void;
  onEdit: (p: Personnel) => void;
  onDelete: (p: Personnel) => void;
}

export function PersonnelTable({
  personnelList,
  isLoading,
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  onViewDetail,
  onEdit,
  onDelete
}: PersonnelTableProps) {
  return (
    <div className="space-y-4">
      {/* Filters & Search */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="جستجو براساس نام، کد پرسنلی، شماره تماس، شغل، کد ملی یا مهارت..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-3 pr-9 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 placeholder:text-slate-400 outline-none focus:border-blue-500 transition-all"
          />
        </div>

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
        </div>
      </div>

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
                  <td colSpan={8} className="p-8 text-center text-slate-400 font-bold">
                    هیچ رکورد پرسنلی یافت نشد.
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
                          <button
                            onClick={() => onEdit(p)}
                            title="ویرایش مشخصات"
                            className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-lg transition-all cursor-pointer"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            onClick={() => onDelete(p)}
                            title="حذف پرسنل"
                            className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition-all cursor-pointer"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
