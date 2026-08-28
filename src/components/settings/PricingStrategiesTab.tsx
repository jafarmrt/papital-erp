import React from 'react';
import { Tags, Trash2, Plus } from 'lucide-react';

interface PricingStrategiesTabProps {
  pricingStrategies: string[];
  setPricingStrategies: React.Dispatch<React.SetStateAction<string[]>>;
  isSaving: boolean;
  onSave: () => void;
}

export function PricingStrategiesTab({
  pricingStrategies,
  setPricingStrategies,
  isSaving,
  onSave
}: PricingStrategiesTabProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-xs p-6 max-w-4xl mx-auto text-right font-farsi">
      <h3 className="font-bold border-b border-slate-200 pb-3 mb-6 text-slate-800 flex items-center gap-2 text-base">
        <Tags size={18} /> سیاست‌های قیمتی
      </h3>
      <div className="mb-8">
        <p className="text-sm text-slate-600 mb-6 leading-relaxed">
          عناوین سیاست‌های قیمتی در صفحه «قیمت‌گذاری محصولات» به عنوان دسته‌های مرجع برای تعیین قیمت‌ها نمایش داده می‌شوند. شما می‌توانید قیمت کالاهای خود را بر اساس این سیاست‌ها تفکیک کنید.
        </p>

        <div className="space-y-3">
          {pricingStrategies.map((strategy, idx) => (
            <div key={idx} className="flex items-center gap-2 max-w-md">
              <input
                type="text"
                value={strategy}
                onChange={(e) => {
                  const newStr = [...pricingStrategies];
                  newStr[idx] = e.target.value;
                  setPricingStrategies(newStr);
                }}
                className="flex-1 border border-slate-300 rounded-lg px-3 py-2 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                placeholder="نام سیاست قیمتی..."
              />
              <button
                type="button"
                onClick={() => {
                  const newStr = pricingStrategies.filter((_, i) => i !== idx);
                  setPricingStrategies(newStr);
                }}
                className="p-2 text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition-colors cursor-pointer"
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setPricingStrategies([...pricingStrategies, ''])}
          className="mt-4 flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-4 py-2 rounded-lg transition-colors cursor-pointer"
        >
          <Plus size={16} /> افزودن سیاست قیمتی جدید
        </button>
      </div>

      <div className="flex justify-end pt-4 border-t border-slate-200">
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg font-bold text-xs shadow-xs transition-colors cursor-pointer"
        >
          {isSaving ? 'در حال ذخیره...' : 'ذخیره سیاست‌های قیمتی'}
        </button>
      </div>
    </div>
  );
}
