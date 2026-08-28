import React from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { formatPersianNumber } from '../../utils';
import { PreviewRow } from './types';

interface ExcelPreviewStepProps {
  previewRows: PreviewRow[];
  filteredPreviewRows: PreviewRow[];
  totalRows: number;
  mismatchCount: number;
  duplicateBatchCount: number;
  duplicateDbCount: number;
  totalIssues: number;
  searchQuery: string;
  filterMode: 'all' | 'issues';
  onSearchChange: (query: string) => void;
  onFilterModeChange: (mode: 'all' | 'issues') => void;
  onCellEdit: (index: number, field: 'code' | 'name' | 'category', value: string) => void;
}

export const ExcelPreviewStep: React.FC<ExcelPreviewStepProps> = ({
  previewRows,
  filteredPreviewRows,
  totalRows,
  mismatchCount,
  duplicateBatchCount,
  duplicateDbCount,
  totalIssues,
  searchQuery,
  filterMode,
  onSearchChange,
  onFilterModeChange,
  onCellEdit
}) => {
  return (
    <div className="space-y-4">
      {/* Summary Badges Header */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-100 border border-slate-200 p-3 rounded-xl text-center">
          <span className="text-xs text-slate-500 block font-bold mb-0.5">کل ردیف‌ها</span>
          <span className="text-lg font-extrabold text-slate-800">{formatPersianNumber(totalRows)}</span>
        </div>
        
        <div className={`p-3 rounded-xl border text-center ${mismatchCount > 0 ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
          <span className={`text-xs block font-bold mb-0.5 ${mismatchCount > 0 ? 'text-amber-800' : 'text-slate-500'}`}>
            مغایرت کدینگ / پیشوند
          </span>
          <span className={`text-lg font-extrabold ${mismatchCount > 0 ? 'text-amber-700' : 'text-slate-700'}`}>
            {formatPersianNumber(mismatchCount)}
          </span>
        </div>

        <div className={`p-3 rounded-xl border text-center ${duplicateBatchCount + duplicateDbCount > 0 ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
          <span className={`text-xs block font-bold mb-0.5 ${duplicateBatchCount + duplicateDbCount > 0 ? 'text-red-800' : 'text-slate-500'}`}>
            نام‌های تکراری
          </span>
          <span className={`text-lg font-extrabold ${duplicateBatchCount + duplicateDbCount > 0 ? 'text-red-700' : 'text-slate-700'}`}>
            {formatPersianNumber(duplicateBatchCount + duplicateDbCount)}
          </span>
        </div>

        <div className={`p-3 rounded-xl border text-center ${totalIssues === 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}>
          <span className="text-xs text-slate-500 block font-bold mb-0.5">وضعیت کلی</span>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full inline-block mt-1 ${totalIssues === 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
            {totalIssues === 0 ? 'تایید شده و بدون خطا' : `${formatPersianNumber(totalIssues)} مورد نیاز به توجه`}
          </span>
        </div>
      </div>

      {/* Tools Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
        <div className="flex items-center gap-2 flex-1 min-w-[240px]">
          <input
            type="text"
            placeholder="جستجو در نام، کد یا دسته‌بندی..."
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            className="w-full text-xs px-3 py-2 border rounded-xl bg-white focus:outline-none focus:border-blue-500"
          />
          <div className="flex border rounded-xl overflow-hidden text-xs shrink-0">
            <button
              onClick={() => onFilterModeChange('all')}
              className={`px-3 py-1.5 font-bold transition-colors cursor-pointer ${filterMode === 'all' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}
            >
              همه ({formatPersianNumber(previewRows.length)})
            </button>
            <button
              onClick={() => onFilterModeChange('issues')}
              className={`px-3 py-1.5 font-bold transition-colors cursor-pointer ${filterMode === 'issues' ? 'bg-amber-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}
            >
              فقط هشدارها ({formatPersianNumber(totalIssues)})
            </button>
          </div>
        </div>
      </div>

      {/* Interactive Table */}
      <div className="border border-slate-200 rounded-xl overflow-x-auto max-h-[380px] overflow-y-auto">
        <table className="w-full text-xs text-right">
          <thead className="bg-slate-900 text-slate-200 sticky top-0 z-10">
            <tr>
              <th className="p-2.5 font-bold w-12 text-center">#</th>
              <th className="p-2.5 font-bold min-w-[180px]">نام محصول (قابل ویرایش)</th>
              <th className="p-2.5 font-bold min-w-[140px]">کد کالا (قابل ویرایش)</th>
              <th className="p-2.5 font-bold min-w-[120px]">دسته‌بندی</th>
              <th className="p-2.5 font-bold w-24 text-center">پیشوند متناظر</th>
              <th className="p-2.5 font-bold min-w-[240px]">بررسی و وضعیت کدینگ</th>
              <th className="p-2.5 font-bold w-20 text-center">عملیات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {filteredPreviewRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-slate-500">
                  هیچ کالایی متناسب با فیلتر یافت نشد.
                </td>
              </tr>
            ) : (
              filteredPreviewRows.map((r) => {
                const hasError = r.isDuplicateInBatch || r.isDuplicateInDb;
                const hasWarning = r.hasPrefixMismatch && !hasError;

                return (
                  <tr
                    key={r.index}
                    className={`hover:bg-slate-50 transition-colors ${
                      hasError ? 'bg-red-50/60' : hasWarning ? 'bg-amber-50/50' : ''
                    }`}
                  >
                    <td className="p-2.5 text-center text-slate-400 font-mono">
                      {formatPersianNumber(r.index + 1)}
                    </td>

                    {/* Name Input */}
                    <td className="p-2">
                      <div className="relative">
                        <input
                          type="text"
                          value={r.name}
                          onChange={e => onCellEdit(r.index, 'name', e.target.value)}
                          className={`w-full text-xs font-bold px-2.5 py-1.5 rounded-lg border transition-all ${
                            r.isDuplicateInBatch || r.isDuplicateInDb
                              ? 'border-red-400 bg-red-100/50 text-red-900 focus:ring-2 focus:ring-red-500'
                              : 'border-slate-300 focus:border-blue-500 focus:bg-white'
                          }`}
                          placeholder="نام کالا..."
                        />
                      </div>
                    </td>

                    {/* Code Input */}
                    <td className="p-2">
                      <input
                        type="text"
                        dir="ltr"
                        value={r.code}
                        onChange={e => onCellEdit(r.index, 'code', e.target.value)}
                        className={`w-full text-xs font-mono font-bold px-2.5 py-1.5 rounded-lg border transition-all ${
                          r.hasPrefixMismatch
                            ? 'border-amber-400 bg-amber-100/50 text-amber-900 focus:ring-2 focus:ring-amber-500'
                            : 'border-slate-300 focus:border-blue-500 focus:bg-white'
                        }`}
                        placeholder="کد کالا..."
                      />
                    </td>

                    {/* Category */}
                    <td className="p-2.5 font-medium text-slate-700">
                      {r.category || <span className="text-slate-400 italic">تعریف‌نشده</span>}
                    </td>

                    {/* Prefix */}
                    <td className="p-2.5 text-center">
                      {r.expectedPrefix ? (
                        <span className="px-2 py-0.5 font-mono text-xs font-bold rounded bg-slate-100 text-slate-700 border">
                          {r.expectedPrefix}
                        </span>
                      ) : (
                        <span className="text-slate-400 text-2xs">-</span>
                      )}
                    </td>

                    {/* Issues / Status */}
                    <td className="p-2.5">
                      {r.issues.length === 0 ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-bold bg-emerald-50 px-2 py-1 rounded-md text-2xs border border-emerald-200">
                          <CheckCircle2 size={12} />
                          کدینگ صحیح
                        </span>
                      ) : (
                        <div className="space-y-1">
                          {r.issues.map((msg, i) => (
                            <div
                              key={i}
                              className={`text-2xs font-bold flex items-center gap-1 px-2 py-0.5 rounded ${
                                msg.includes('تکراری')
                                  ? 'bg-red-100 text-red-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              <AlertTriangle size={12} className="shrink-0" />
                              {msg}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>

                    {/* Operations */}
                    <td className="p-2.5 text-center">
                      {/* Manual edit is supported directly in the input field */}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
