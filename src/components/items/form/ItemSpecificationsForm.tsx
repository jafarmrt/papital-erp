import React from 'react';
import { ItemFormData, PREDEFINED_COLORS, PREDEFINED_MATERIALS } from './types';

interface ItemSpecificationsFormProps {
  form: ItemFormData;
  setForm: React.Dispatch<React.SetStateAction<ItemFormData>>;
  parseMultiValue: (val: string) => string[];
  formatMultiValue: (arr: string[]) => string;
  onImageChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const ItemSpecificationsForm: React.FC<ItemSpecificationsFormProps> = ({
  form,
  setForm,
  parseMultiValue,
  formatMultiValue,
  onImageChange
}) => {
  return (
    <div className="space-y-4">
      <div className="p-3.5 border border-slate-200 rounded-xl bg-slate-50/70 space-y-3">
        <span className="text-xs font-bold text-slate-700 block border-b border-slate-200 pb-1.5">
          مشخصات فنی و گزینه‌ها (اختیاری)
        </span>
        <div className="grid grid-cols-2 gap-4">
          {/* Color multi selector */}
          <div className="col-span-2">
            <label className="block text-xs font-medium mb-1 text-slate-600">
              رنگ‌ها (امکان انتخاب چند رنگ)
            </label>
            <div className="p-2.5 border border-slate-300/80 rounded-xl bg-white space-y-2">
              <div className="flex flex-wrap gap-1.5 min-h-[26px] items-center">
                {parseMultiValue(form.color).map((c, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200"
                  >
                    {c}
                    <button
                      type="button"
                      onClick={() => {
                        const current = parseMultiValue(form.color);
                        const updated = current.filter((_, idx) => idx !== i);
                        setForm({ ...form, color: formatMultiValue(updated) });
                      }}
                      className="hover:text-red-600 font-bold mr-1 text-xs cursor-pointer"
                    >
                      ×
                    </button>
                  </span>
                ))}
                {parseMultiValue(form.color).length === 0 && (
                  <span className="text-xs text-slate-400">رنگی انتخاب نشده است</span>
                )}
              </div>
              <div className="flex items-center gap-1.5 pt-1.5 border-t border-slate-100">
                <select
                  value=""
                  onChange={e => {
                    if (!e.target.value) return;
                    const current = parseMultiValue(form.color);
                    if (!current.includes(e.target.value)) {
                      const updated = [...current, e.target.value];
                      setForm({ ...form, color: formatMultiValue(updated) });
                    }
                  }}
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-slate-50 outline-none flex-1"
                >
                  <option value="">+ افزودن رنگ از لیست...</option>
                  {PREDEFINED_COLORS.filter(c => !parseMultiValue(form.color).includes(c)).map(c => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="رنگ جدید..."
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1 outline-none w-28 bg-white"
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const val = e.currentTarget.value.trim();
                      const current = parseMultiValue(form.color);
                      if (val && !current.includes(val)) {
                        const updated = [...current, val];
                        setForm({ ...form, color: formatMultiValue(updated) });
                        e.currentTarget.value = '';
                      }
                    }
                  }}
                />
              </div>
            </div>
          </div>

          {/* Material multi selector */}
          <div className="col-span-2">
            <label className="block text-xs font-medium mb-1 text-slate-600">
              جنس (امکان انتخاب چند جنس)
            </label>
            <div className="p-2.5 border border-slate-300/80 rounded-xl bg-white space-y-2">
              <div className="flex flex-wrap gap-1.5 min-h-[26px] items-center">
                {parseMultiValue(form.material).map((m, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200"
                  >
                    {m}
                    <button
                      type="button"
                      onClick={() => {
                        const current = parseMultiValue(form.material);
                        const updated = current.filter((_, idx) => idx !== i);
                        setForm({ ...form, material: formatMultiValue(updated) });
                      }}
                      className="hover:text-red-600 font-bold mr-1 text-xs cursor-pointer"
                    >
                      ×
                    </button>
                  </span>
                ))}
                {parseMultiValue(form.material).length === 0 && (
                  <span className="text-xs text-slate-400">جنسی انتخاب نشده است</span>
                )}
              </div>
              <div className="flex items-center gap-1.5 pt-1.5 border-t border-slate-100">
                <select
                  value=""
                  onChange={e => {
                    if (!e.target.value) return;
                    const current = parseMultiValue(form.material);
                    if (!current.includes(e.target.value)) {
                      const updated = [...current, e.target.value];
                      setForm({ ...form, material: formatMultiValue(updated) });
                    }
                  }}
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-slate-50 outline-none flex-1"
                >
                  <option value="">+ افزودن جنس از لیست...</option>
                  {PREDEFINED_MATERIALS.filter(m => !parseMultiValue(form.material).includes(m)).map(m => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="جنس جدید..."
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1 outline-none w-28 bg-white"
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const val = e.currentTarget.value.trim();
                      const current = parseMultiValue(form.material);
                      if (val && !current.includes(val)) {
                        const updated = [...current, val];
                        setForm({ ...form, material: formatMultiValue(updated) });
                        e.currentTarget.value = '';
                      }
                    }
                  }}
                />
              </div>
            </div>
          </div>

          {/* Weight */}
          <div>
            <label className="block text-xs font-medium mb-1 text-slate-600">وزن (گرم)</label>
            <input
              type="number"
              min="0"
              step="any"
              value={form.weight || ''}
              onChange={e => setForm({ ...form, weight: e.target.value })}
              className="w-full border border-slate-300/80 rounded-xl px-3 py-1.5 text-sm font-mono text-left bg-white outline-none focus:ring-1 focus:ring-blue-500"
              dir="ltr"
              placeholder="مثال: 5.5"
            />
          </div>

          {/* Size */}
          <div>
            <label className="block text-xs font-medium mb-1 text-slate-600">اندازه (میلی‌متر)</label>
            <input
              type="text"
              value={form.size || ''}
              onChange={e => setForm({ ...form, size: e.target.value })}
              className="w-full border border-slate-300/80 rounded-xl px-3 py-1.5 text-sm font-mono text-left bg-white outline-none focus:ring-1 focus:ring-blue-500"
              dir="ltr"
              placeholder="مثال: 10x20"
            />
          </div>
        </div>
      </div>

      {/* Image Upload */}
      <div>
        <label className="block text-xs font-bold text-slate-700 mb-1">
          تصویر کالا (اختیاری - تصویر به‌صورت خودکار فشرده و بهینه می‌شود)
        </label>
        <input
          type="file"
          accept="image/*"
          onChange={onImageChange}
          className="w-full border border-slate-300/80 rounded-xl px-3 py-2 text-xs bg-white text-slate-600 file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
        />
        {form.thumbnail && (
          <div className="mt-2.5 flex items-center gap-3 bg-slate-50 p-2 rounded-xl border border-slate-200">
            <img
              src={form.thumbnail}
              alt="پیش‌نمایش"
              className="w-12 h-12 object-cover rounded-lg shadow-2xs border border-slate-200"
            />
            <span className="text-xs text-slate-500 font-medium">تصویر بارگذاری شد</span>
          </div>
        )}
      </div>
    </div>
  );
};
