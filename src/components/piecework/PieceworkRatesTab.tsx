import React from 'react';
import { DollarSign, Save } from 'lucide-react';
import { PieceworkTask } from '../../types';
import { SearchableSelect } from '../SearchableSelect';
import { formatPersianPrice, formatCurrencyLabel } from '../../utils';
import { useAppCurrency } from '../../hooks/useAppCurrency';

interface PieceworkRatesTabProps {
  personnelSelectOptions: { value: string; label: string }[];
  selectedPersonnelForRates: number | '';
  onSelectPersonnel: (id: number | '') => void;
  tasksList: PieceworkTask[];
  customRatesMap: Record<number, number>;
  onSaveCustomRate: (taskId: number, rate: number) => void;
}

export function PieceworkRatesTab({
  personnelSelectOptions,
  selectedPersonnelForRates,
  onSelectPersonnel,
  tasksList,
  customRatesMap,
  onSaveCustomRate
}: PieceworkRatesTabProps) {
  const appCurrency = useAppCurrency();
  const curLbl = formatCurrencyLabel(appCurrency);
  return (
    <div className="space-y-4">
      {/* Personnel Selector Banner */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
            <DollarSign size={18} />
          </div>
          <div>
            <h3 className="text-xs font-black text-slate-900">تعیین نرخ‌های اختصاصی کارکرد</h3>
            <p className="text-[11px] text-slate-500">
              می‌توانید برای هر پرسنل، نرخ متفاوتی برای هر کار تعیین کنید (در غیر این صورت نرخ پایه اعمال می‌شود)
            </p>
          </div>
        </div>

        <div className="w-full sm:w-80">
          <SearchableSelect
            options={personnelSelectOptions}
            value={selectedPersonnelForRates ? String(selectedPersonnelForRates) : ''}
            onChange={(val) => onSelectPersonnel(val ? Number(val) : '')}
            placeholder="انتخاب پرسنل جهت تعیین نرخ..."
            maxResults={50}
            className="w-full text-xs font-bold"
          />
        </div>
      </div>

      {/* Rates Matrix */}
      {selectedPersonnelForRates ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-black">
                  <th className="p-3">عنوان کاری</th>
                  <th className="p-3">دسته‌بندی</th>
                  <th className="p-3 text-center">واحد</th>
                  <th className="p-3 text-center">{`نرخ پایه سامانه (${curLbl})`}</th>
                  <th className="p-3 text-center">{`نرخ اختصاصی این پرسنل (${curLbl})`}</th>
                  <th className="p-3 text-center">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-bold">
                {tasksList.map((task) => {
                  const hasCustom = customRatesMap[task.id] !== undefined;
                  const currentVal = hasCustom ? customRatesMap[task.id] : task.defaultRate;

                  return (
                    <tr key={task.id} className="hover:bg-slate-50/80 transition-all text-slate-700">
                      <td className="p-3 font-black text-slate-900">{task.title}</td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md text-[10px]">
                          {task.category || 'عمومی'}
                        </span>
                      </td>
                      <td className="p-3 text-center text-slate-600">{task.unit || 'عدد'}</td>
                      <td className="p-3 text-center font-mono text-slate-600">
                        {formatPersianPrice(task.defaultRate)}
                      </td>
                      <td className="p-3 text-center">
                        <input
                          type="number"
                          defaultValue={currentVal}
                          key={`${task.id}-${currentVal}`}
                          id={`custom-rate-${task.id}`}
                          className={`w-36 px-2.5 py-1 text-center font-mono rounded-lg border text-xs font-bold ${
                            hasCustom
                              ? 'bg-blue-50 border-blue-300 text-blue-900'
                              : 'bg-slate-50 border-slate-200 text-slate-700'
                          }`}
                        />
                      </td>
                      <td className="p-3 text-center">
                        <button
                          type="button"
                          onClick={() => {
                            const input = document.getElementById(`custom-rate-${task.id}`) as HTMLInputElement;
                            if (input) {
                              onSaveCustomRate(task.id, Number(input.value));
                            }
                          }}
                          className="px-3 py-1 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer transition-all"
                        >
                          <Save size={13} />
                          <span>ثبت نرخ</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center text-slate-400 font-bold text-xs">
          لطفاً از کادر بالا پرسنل مورد نظر را انتخاب کنید تا لیست عناوین کاری و نرخ‌های اختصاصی ایشان نمایش داده شود.
        </div>
      )}
    </div>
  );
}
