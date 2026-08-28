import React from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { formatPersianNumber } from '../../utils';
import { ImportResult } from './types';

interface ExcelResultStepProps {
  importResult: ImportResult;
}

export const ExcelResultStep: React.FC<ExcelResultStepProps> = ({ importResult }) => {
  return (
    <div className="border rounded-2xl p-6 bg-slate-50 space-y-4 animate-in fade-in">
      <div className="flex items-center gap-2 font-bold text-slate-800 text-base border-b pb-3">
        <CheckCircle2 size={22} className="text-emerald-600" />
        نتیجه نهایی پردازش اکسل و ثبت در پایگاه‌داده:
      </div>

      <div className="grid grid-cols-3 gap-4 text-center">
        <div className="bg-emerald-100/60 border border-emerald-200 p-4 rounded-xl">
          <span className="text-xs text-emerald-800 font-bold block mb-1">کالاهای جدید</span>
          <span className="text-2xl font-black text-emerald-700">
            {formatPersianNumber(importResult.createdCount)}
          </span>
        </div>
        <div className="bg-blue-100/60 border border-blue-200 p-4 rounded-xl">
          <span className="text-xs text-blue-800 font-bold block mb-1">کالاهای به‌روزرسانی‌شده</span>
          <span className="text-2xl font-black text-blue-700">
            {formatPersianNumber(importResult.updatedCount)}
          </span>
        </div>
        <div className="bg-purple-100/60 border border-purple-200 p-4 rounded-xl">
          <span className="text-xs text-purple-800 font-bold block mb-1">قیمت‌های تنظیم‌شده</span>
          <span className="text-2xl font-black text-purple-700">
            {formatPersianNumber(importResult.pricesCount)}
          </span>
        </div>
      </div>

      {/* Errors List */}
      {importResult.errors && importResult.errors.length > 0 && (
        <div className="mt-4 bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-700 space-y-2">
          <div className="font-bold flex items-center gap-1.5 text-red-800 text-sm">
            <AlertCircle size={16} />
            خطاهای پردازش ({formatPersianNumber(importResult.errors.length)} ردیف):
          </div>
          <ul className="list-disc list-inside max-h-40 overflow-y-auto space-y-1 pr-1">
            {importResult.errors.map((err, idx) => (
              <li key={idx}>
                ردیف {formatPersianNumber(err.row)}: {err.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
