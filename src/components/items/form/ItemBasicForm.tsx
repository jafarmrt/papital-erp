import React from 'react';
import { Item, Category } from '../../../types';
import { ItemFormData } from './types';
import { RefreshCw, CheckCircle2 } from 'lucide-react';

interface ItemBasicFormProps {
  form: ItemFormData;
  setForm: React.Dispatch<React.SetStateAction<ItemFormData>>;
  item: Item | null;
  categories: Category[];
  productYear: string;
  setProductYear: (val: string) => void;
  productCatPrefix: string;
  setProductCatPrefix: (val: string) => void;
  productTransferCode: string;
  setProductTransferCode: (val: string) => void;
  productDesignVar: string;
  setProductDesignVar: (val: string) => void;
  rawPrefix: string;
  setRawPrefix: (val: string) => void;
  rawNum: string;
  setRawNum: (val: string) => void;
  onCategoryChange: (catName: string) => void;
  onReserveProductCode?: () => Promise<void>;
  onReserveRawCode?: () => Promise<void>;
  productSerialReserved?: boolean;
  rawSerialReserved?: boolean;
}

const segmentInputCls = 'flex-1 min-w-0 text-center border border-slate-300 rounded-lg py-1.5 font-mono text-xs font-bold bg-white focus:ring-1 focus:ring-blue-500 outline-none';

export const ItemBasicForm: React.FC<ItemBasicFormProps> = ({
  form,
  setForm,
  item,
  categories,
  productYear,
  setProductYear,
  productCatPrefix,
  setProductCatPrefix,
  productTransferCode,
  setProductTransferCode,
  productDesignVar,
  setProductDesignVar,
  rawPrefix,
  setRawPrefix,
  rawNum,
  setRawNum,
  onCategoryChange,
  onReserveProductCode,
  onReserveRawCode,
  productSerialReserved = false,
  rawSerialReserved = false
}) => {
  return (
    <div className="space-y-4">
      {/* Name Input */}
      <div>
        <label className="block text-xs font-bold text-slate-700 mb-1">
          نام کالا / محصول <span className="text-red-500">*</span>
        </label>
        <input
          required
          type="text"
          value={form.name}
          onChange={e => setForm({ ...form, name: e.target.value })}
          className="w-full border border-slate-300/80 rounded-xl px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="مثال: گردنبند طرح پروانه"
        />
      </div>

      {/* Category & Type Selection */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">دسته‌بندی</label>
          <select
            value={form.category}
            onChange={e => onCategoryChange(e.target.value)}
            className="w-full border border-slate-300/80 rounded-xl px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500"
          >
            {categories
              .filter(c => c.type === form.type)
              .map(c => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">نوع کالا</label>
          <select
            disabled={!!item}
            value={form.type}
            onChange={e => {
              const newType = e.target.value as 'product' | 'raw_material';
              const firstCat = categories.find(c => c.type === newType);
              setForm({
                ...form,
                type: newType,
                category: firstCat?.name || '',
                unit: firstCat?.defaultUnit || 'عدد'
              });
            }}
            className="w-full border border-slate-300/80 rounded-xl px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
          >
            <option value="product">محصول نهایی</option>
            <option value="raw_material">ماده اولیه / قطعه</option>
          </select>
        </div>
      </div>

      {/* Dynamic Code Builder — V10-2.1: بخش‌بندی‌دار با برچسب و توضیح هر segment + رزرو اتمیک شماره سری */}
      <div>
        <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
          <label className="block text-xs font-bold text-slate-700">
            کد استاندارد سیستم <span className="text-red-500">*</span>
          </label>
          {!item && (
            <div className="flex items-center gap-2">
              {(form.type === 'product' ? productSerialReserved : rawSerialReserved) && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-md">
                  <CheckCircle2 size={11} />
                  شماره سری رزرو شد
                </span>
              )}
            </div>
          )}
        </div>

        {item ? (
          <>
            <input
              disabled
              type="text"
              value={form.code}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-mono text-left bg-slate-100 text-slate-600 outline-none"
              dir="ltr"
            />
            <p className="text-[10px] text-slate-400 mt-1">کد کالای ثبت‌شده قابل تغییر نیست.</p>
          </>
        ) : form.type === 'product' ? (
          <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-300/80 space-y-2" dir="ltr">
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={productYear}
                onChange={e => setProductYear(e.target.value)}
                className={`${segmentInputCls} w-16`}
                placeholder="1404"
              />
              <span className="text-slate-400 font-bold">-</span>
              <input
                type="text"
                value={productCatPrefix}
                onChange={e => setProductCatPrefix(e.target.value.toUpperCase())}
                className={`${segmentInputCls} w-12`}
                placeholder="N"
              />
              <span className="text-slate-400 font-bold">-</span>
              <input
                type="text"
                value={productTransferCode}
                onChange={e => setProductTransferCode(e.target.value)}
                className={`${segmentInputCls} w-16`}
                placeholder="101"
              />
              <span className="text-slate-400 font-bold">-</span>
              <input
                type="text"
                value={productDesignVar}
                onChange={e => setProductDesignVar(e.target.value)}
                className={`${segmentInputCls} w-14`}
                placeholder="01"
              />
            </div>
            {/* V10-2.1: برچسب هر segment برای جلوگیری از خطای ورود دستی */}
            <div className="flex items-start gap-1.5 text-center select-none">
              <span className="flex-1 w-16 text-[9px] leading-tight text-slate-500 font-medium" title="سال طراحی جلالی — از تاریخ امروز پر می‌شود">سال طراحی</span>
              <span className="w-2"></span>
              <span className="flex-1 w-12 text-[9px] leading-tight text-indigo-600 font-bold" title="حرف اختصاری دسته‌بندی — با انتخاب دسته خودکار پر می‌شود">حرف کتگوری</span>
              <span className="w-2"></span>
              <span className="flex-1 w-16 text-[9px] leading-tight text-slate-500 font-medium" title="کد ترنسفر مرتبط با طرح (سه‌رقمی)">کد ترنسفر</span>
              <span className="w-2"></span>
              <span className="flex-1 w-14 text-[9px] leading-tight text-emerald-700 font-bold" title="شماره سری تکرار این طرح — با دکمه «رزرو شماره بعدی» به‌صورت اتمیک اختصاص می‌یابد">شماره سری</span>
            </div>
            <button
              type="button"
              onClick={() => onReserveProductCode?.()}
              disabled={!onReserveProductCode || productSerialReserved}
              className={`w-full py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer inline-flex items-center justify-center gap-1.5 ${
                productSerialReserved
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 opacity-80'
                  : 'bg-white hover:bg-blue-50 text-blue-700 border border-blue-300 shadow-2xs'
              }`}
              dir="rtl"
              title="شماره سری بعدیِ آزاد را به‌صورت اتمیک از سرور دریافت و رزرو می‌کند (بدون تداخل با سایر کاربران)"
            >
              <RefreshCw size={12} />
              {productSerialReserved ? `سری «${productDesignVar}» رزرو شد` : 'رزرو شماره سری بعدی (اتمیک)'}
            </button>
          </div>
        ) : (
          <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-300/80 space-y-2" dir="ltr">
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={rawPrefix}
                onChange={e => setRawPrefix(e.target.value.toUpperCase())}
                className={`${segmentInputCls} w-24`}
                placeholder="B-H"
              />
              <span className="text-slate-400 font-bold">-</span>
              <input
                type="text"
                value={rawNum}
                onChange={e => setRawNum(e.target.value)}
                className={`${segmentInputCls} w-20`}
                placeholder="101"
              />
            </div>
            <div className="flex items-start select-none">
              <span className="w-24 text-[9px] leading-tight text-indigo-600 font-bold text-center" title="پیشوند اختصاصی دسته‌بندی ماده اولیه — با انتخاب دسته خودکار پر می‌شود">پیشوند کتگوری</span>
              <span className="w-2"></span>
              <span className="w-20 text-[9px] leading-tight text-emerald-700 font-bold text-center" title="شماره سری ماده اولیه — با دکمه «رزرو شماره بعدی» به‌صورت اتمیک اختصاص می‌یابد">شماره سری</span>
            </div>
            <button
              type="button"
              onClick={() => onReserveRawCode?.()}
              disabled={!onReserveRawCode || rawSerialReserved}
              className={`w-full py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer inline-flex items-center justify-center gap-1.5 ${
                rawSerialReserved
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 opacity-80'
                  : 'bg-white hover:bg-blue-50 text-blue-700 border border-blue-300 shadow-2xs'
              }`}
              dir="rtl"
              title="شماره سری بعدیِ آزاد را به‌صورت اتمیک از سرور دریافت و رزرو می‌کند (بدون تداخل با سایر کاربران)"
            >
              <RefreshCw size={12} />
              {rawSerialReserved ? `سری «${rawNum}» رزرو شد` : 'رزرو شماره سری بعدی (اتمیک)'}
            </button>
          </div>
        )}
        {!item && (
          <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">
            پیشنهاد: پیش از ثبت، از دکمه «رزرو شماره سری بعدی» استفاده کنید تا مطمئن شوید کد مورد نظر توسط دیگری مصرف نشده است.
          </p>
        )}
      </div>

      {/* Unit & Reorder point */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">واحد اندازه‌گیری</label>
          <input
            required
            type="text"
            placeholder="عدد، کیلوگرم، متر..."
            value={form.unit}
            onChange={e => setForm({ ...form, unit: e.target.value })}
            className="w-full border border-slate-300/80 rounded-xl px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">حد آستانه سفارش (آلارم)</label>
          <input
            type="number"
            min="0"
            step="any"
            value={form.reorder_point}
            onChange={e => setForm({ ...form, reorder_point: parseFloat(e.target.value) || 0 })}
            className="w-full border border-slate-300/80 rounded-xl px-3 py-2 text-left font-mono text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500"
            dir="ltr"
            placeholder="۱۰"
          />
        </div>
      </div>
    </div>
  );
};
