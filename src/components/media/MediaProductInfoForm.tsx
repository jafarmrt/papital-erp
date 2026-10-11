import { useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';
import { toPersianDigits } from '../../utils';
import { mediaErrorMessage, updateMediaProductInfo, type MediaProductItem } from '../../lib/media/mediaApi';
import { PRODUCT_CARD_LIMITS, PRODUCT_CARD_TEXT, normalizeCollections, parseCardText, parseDesignYear } from '../../lib/media/productCard';

interface Props {
  item: MediaProductItem;
  onCancel: () => void;
  onSaved: (item: MediaProductItem) => void;
}

const inputClass = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

/** Edit form of the product card (media.manage or products.edit); the item version guards a concurrent edit */
export function MediaProductInfoForm({ item, onCancel, onSaved }: Props) {
  const [collections, setCollections] = useState(item.collections.join('، '));
  const [designYear, setDesignYear] = useState(item.designYear ? toPersianDigits(String(item.designYear)) : '');
  const [transferCode, setTransferCode] = useState(item.transferCode ?? '');
  const [description, setDescription] = useState(item.productDescription ?? '');
  const [notes, setNotes] = useState(item.technicalNotes ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsedCollections = normalizeCollections(collections);
    const parsedYear = parseDesignYear(designYear);
    const parsedTransfer = parseCardText(transferCode, PRODUCT_CARD_LIMITS.transferCode, PRODUCT_CARD_TEXT.transferCodeTooLong);
    const parsedDescription = parseCardText(description, PRODUCT_CARD_LIMITS.text, PRODUCT_CARD_TEXT.textTooLong);
    const parsedNotes = parseCardText(notes, PRODUCT_CARD_LIMITS.text, PRODUCT_CARD_TEXT.textTooLong);
    for (const r of [parsedCollections, parsedYear, parsedTransfer, parsedDescription, parsedNotes]) {
      if (!r.ok) {
        setError(r.error);
        return;
      }
    }
    if (!parsedCollections.ok || !parsedYear.ok || !parsedTransfer.ok || !parsedDescription.ok || !parsedNotes.ok) return;
    setIsSaving(true);
    setError(null);
    try {
      const saved = await updateMediaProductInfo(item.id, {
        version: item.version,
        collections: parsedCollections.value,
        designYear: parsedYear.value,
        transferCode: parsedTransfer.value,
        productDescription: parsedDescription.value,
        technicalNotes: parsedNotes.value,
      });
      toast.success('مشخصات محصول ذخیره شد.');
      onSaved(saved);
    } catch (err: unknown) {
      setError(mediaErrorMessage(err, 'ذخیره مشخصات محصول ناموفق بود.'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={e => void submit(e)} className="space-y-3" aria-label="ویرایش مشخصات محصول">
      <label className="block space-y-1">
        <span className="text-xs font-bold text-slate-600">کالکشن‌ها (با «،» جدا کنید)</span>
        <input className={inputClass} value={collections} onChange={e => setCollections(e.target.value)} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-xs font-bold text-slate-600">سال طراحی</span>
          <input className={inputClass} inputMode="numeric" value={designYear} onChange={e => setDesignYear(e.target.value)} placeholder="۱۴۰۴" />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-bold text-slate-600">کد ترنسفر</span>
          <input className={inputClass} value={transferCode} maxLength={PRODUCT_CARD_LIMITS.transferCode} onChange={e => setTransferCode(e.target.value)} />
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-xs font-bold text-slate-600">توضیح محصول</span>
        <textarea className={inputClass} rows={3} value={description} maxLength={PRODUCT_CARD_LIMITS.text} onChange={e => setDescription(e.target.value)} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-bold text-slate-600">نکته‌های فنی</span>
        <textarea className={inputClass} rows={3} value={notes} maxLength={PRODUCT_CARD_LIMITS.text} onChange={e => setNotes(e.target.value)} />
      </label>
      {error && <p role="alert" className="text-xs font-semibold text-rose-600">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} disabled={isSaving} className="px-4 h-9 rounded-lg border border-slate-200 text-sm font-bold text-slate-600">انصراف</button>
        <button type="submit" disabled={isSaving} className="px-4 h-9 rounded-lg bg-blue-600 text-white text-sm font-bold disabled:opacity-50">
          {isSaving ? 'در حال ذخیره...' : 'ذخیره'}
        </button>
      </div>
    </form>
  );
}
