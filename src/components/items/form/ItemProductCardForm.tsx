import React from 'react';
import type { ItemFormData } from './types';
import type { ProductCardFormData } from '../../../lib/media/productCardForm';

interface ItemProductCardFormProps {
  form: ItemFormData;
  setForm: React.Dispatch<React.SetStateAction<ItemFormData>>;
  isNew: boolean;
}

const inputClass = 'w-full px-3 py-2 border border-slate-300/80 rounded-xl bg-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/30';

/** v10.0.22 (N-05): کارت محصول کتابخانه تصاویر در فرم کالا (فقط محصول نهایی) */
export const ItemProductCardForm: React.FC<ItemProductCardFormProps> = ({ form, setForm, isNew }) => {
  const set = (key: keyof ProductCardFormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = e.target.value;
    setForm(prev => ({ ...prev, card: { ...prev.card, [key]: value } }));
  };
  return (
    <div className="p-3.5 border border-slate-200 rounded-xl bg-slate-50/70 space-y-3">
      <span className="text-xs font-bold text-slate-700 block border-b border-slate-200 pb-1.5">
        کارت محصول در کتابخانه تصاویر (اختیاری)
      </span>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label htmlFor="item-card-collections" className="block text-xs font-medium mb-1 text-slate-600">کالکشن‌ها (با «،» جدا کنید)</label>
          <input id="item-card-collections" className={inputClass} value={form.card.collections} onChange={set('collections')} />
        </div>
        <div>
          <label htmlFor="item-card-year" className="block text-xs font-medium mb-1 text-slate-600">سال طراحی</label>
          <input id="item-card-year" className={inputClass} inputMode="numeric" value={form.card.designYear} onChange={set('designYear')}
            placeholder={isNew ? 'خالی: از کد کالا' : ''} />
        </div>
        <div>
          <label htmlFor="item-card-transfer" className="block text-xs font-medium mb-1 text-slate-600">کد ترنسفر</label>
          <input id="item-card-transfer" className={inputClass} value={form.card.transferCode} onChange={set('transferCode')}
            placeholder={isNew ? 'خالی: از کد کالا' : ''} />
        </div>
        <div className="col-span-2">
          <label htmlFor="item-card-description" className="block text-xs font-medium mb-1 text-slate-600">توضیح محصول</label>
          <textarea id="item-card-description" rows={2} className={inputClass} value={form.card.productDescription} onChange={set('productDescription')} />
        </div>
        <div className="col-span-2">
          <label htmlFor="item-card-notes" className="block text-xs font-medium mb-1 text-slate-600">نکته‌های فنی</label>
          <textarea id="item-card-notes" rows={2} className={inputClass} value={form.card.technicalNotes} onChange={set('technicalNotes')} />
        </div>
      </div>
    </div>
  );
};
