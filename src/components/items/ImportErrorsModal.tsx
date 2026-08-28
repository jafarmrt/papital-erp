import React from 'react';
import { fetchJson } from '../../api';
import { toast } from 'react-hot-toast';
import { Category } from '../../types';

interface ImportErrorItem {
  rowIndex: number;
  name: string;
  code: string;
  error: string;
  parsed: any;
}

interface ImportErrorsModalProps {
  importErrors: ImportErrorItem[];
  setImportErrors: React.Dispatch<React.SetStateAction<ImportErrorItem[]>>;
  allCategories: Category[];
  type: 'product' | 'raw_material';
  onSuccessRefresh: () => void;
}

export function ImportErrorsModal({
  importErrors,
  setImportErrors,
  allCategories,
  type,
  onSuccessRefresh
}: ImportErrorsModalProps) {
  if (importErrors.length === 0) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="p-4 border-b flex justify-between items-center bg-slate-50 rounded-t-xl">
          <h2 className="font-bold text-red-600">گزارش خطاهای ایمپورت ({importErrors.length} خطا)</h2>
          <button onClick={() => setImportErrors([])} className="text-slate-500 hover:text-slate-700">✕</button>
        </div>
        <div className="p-4 overflow-auto flex-1">
          <p className="text-sm text-slate-600 mb-4">
            ردیف‌های زیر به دلیل خطا وارد نشدند. می‌توانید کد یا سایر مشخصات آن‌ها را ویرایش کرده و مجدداً تلاش کنید.
          </p>
          <div className="space-y-4">
            {importErrors.map((err, idx) => (
              <div key={idx} className="border border-red-200 bg-red-50 p-4 rounded-lg">
                <div className="flex flex-wrap gap-4 items-start">
                  <div className="flex-1 min-w-[200px]">
                    <label className="block text-xs font-medium text-slate-700 mb-1">نام کالا (ردیف {err.rowIndex})</label>
                    <input 
                      type="text" 
                      value={err.parsed?.name || ''} 
                      onChange={e => {
                        const newErrs = [...importErrors];
                        if (!newErrs[idx].parsed) newErrs[idx].parsed = {};
                        newErrs[idx].parsed.name = e.target.value;
                        setImportErrors(newErrs);
                      }} 
                      className="w-full border border-slate-300 rounded px-2 py-1 text-sm bg-white" 
                    />
                  </div>
                  <div className="w-32">
                    <label className="block text-xs font-medium text-slate-700 mb-1">کد کالا</label>
                    <input 
                      type="text" 
                      value={err.parsed?.code || ''} 
                      onChange={e => {
                        const newErrs = [...importErrors];
                        if (!newErrs[idx].parsed) newErrs[idx].parsed = {};
                        newErrs[idx].parsed.code = e.target.value;
                        setImportErrors(newErrs);
                      }} 
                      className="w-full border border-slate-300 rounded px-2 py-1 text-sm font-mono dir-ltr bg-white" 
                    />
                  </div>
                  <div className="w-48">
                    <label className="block text-xs font-medium text-slate-700 mb-1">دسته‌بندی</label>
                    <select 
                      value={err.parsed?.category || ''} 
                      onChange={e => {
                        const newErrs = [...importErrors];
                        if (!newErrs[idx].parsed) newErrs[idx].parsed = {};
                        newErrs[idx].parsed.category = e.target.value;
                        setImportErrors(newErrs);
                      }} 
                      className="w-full border border-slate-300 rounded px-2 py-1 text-sm bg-white"
                    >
                      <option value="">بدون دسته</option>
                      {(Array.isArray(allCategories) ? allCategories : []).filter((c: any) => c.type === type).map((c: any) => (
                        <option key={c.id} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="w-24">
                    <label className="block text-xs font-medium text-slate-700 mb-1">واحد</label>
                    <input 
                      type="text" 
                      value={err.parsed?.unit || ''} 
                      onChange={e => {
                        const newErrs = [...importErrors];
                        if (!newErrs[idx].parsed) newErrs[idx].parsed = {};
                        newErrs[idx].parsed.unit = e.target.value;
                        setImportErrors(newErrs);
                      }} 
                      className="w-full border border-slate-300 rounded px-2 py-1 text-sm bg-white" 
                    />
                  </div>
                </div>
                <div className="mt-3 text-sm text-red-600 font-bold bg-white px-2 py-1 rounded inline-block border border-red-200">
                  علت خطا: {err.error}
                </div>
                <div className="mt-3 flex justify-end">
                  <button 
                    onClick={async () => {
                      try {
                        await fetchJson('/items', { method: 'POST', body: JSON.stringify(err.parsed) });
                        toast.success(`کالا ${err.parsed?.name || ''} با موفقیت ثبت شد.`);
                        const newErrs = importErrors.filter((_, i) => i !== idx);
                        setImportErrors(newErrs);
                        onSuccessRefresh();
                      } catch (e) {
                        toast.error(e.message || 'مجدداً خطا رخ داد.');
                        const newErrs = [...importErrors];
                        newErrs[idx].error = e.message || 'خطای ناشناخته';
                        setImportErrors(newErrs);
                      }
                    }}
                    className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 shadow"
                  >
                    تلاش مجدد برای ثبت
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="p-4 border-t flex justify-end bg-slate-50 rounded-b-xl">
          <button onClick={() => setImportErrors([])} className="px-4 py-2 border rounded-lg hover:bg-white text-sm">بستن پنجره</button>
        </div>
      </div>
    </div>
  );
}

export default ImportErrorsModal;
