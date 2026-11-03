import { useId, useState } from 'react';
import { Save, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { DecimalInput } from '../common/DecimalInput';
import { useSaveStorefrontProductMutation } from '../../hooks/queries/useStorefrontQueries';
import type { StorefrontProductAdminRow, StorefrontProductInput } from '../../lib/storefront/storefrontContracts';
import {
  PUBLISH_BLOCKER_MESSAGES, STOREFRONT_SEO_DESCRIPTION_MAX, STOREFRONT_SEO_TITLE_MAX, slugError,
} from '../../lib/storefront/storefrontRules';
import { formatPersianCode, formatPersianNumber } from '../../utils/persianNumber';
import { errorMessageOf } from '../../utils';

/**
 * v11 phase 8.1: publishing one item: its latin address on the site (papitalgallery.com/product/<address>), the title and
 * description search engines show (empty = the item's name and description), and its place in the shop's order. Name,
 * description, material, size, colour, weight and collections stay on the item card.
 */
const field = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm';
const label = 'block text-xs font-bold text-slate-700 mb-1';

export function StorefrontProductEditor({ row, onClose }: { row: StorefrontProductAdminRow; onClose: () => void }) {
  const id = useId();
  const save = useSaveStorefrontProductMutation();
  const [form, setForm] = useState<StorefrontProductInput>({
    published: row.published || !row.blocker, slug: row.slug, seoTitle: row.seoTitle, seoDescription: row.seoDescription,
    sortOrder: row.sortOrder, version: row.version ?? 0,
  });
  const set = <K extends keyof StorefrontProductInput>(key: K, value: StorefrontProductInput[K]) => setForm(f => ({ ...f, [key]: value }));
  const slugProblem = slugError(form.slug);

  const submit = () => {
    save.mutate({ itemId: row.itemId, input: form }, {
      onSuccess: (saved) => {
        toast.success(saved.published ? `«${row.name}» روی سایت است.` : `«${row.name}» روی سایت نیست.`);
        onClose();
      },
      onError: (err) => toast.error(errorMessageOf(err)),
    });
  };

  return (
    <form aria-label={`انتشار ${row.name}`} className="rounded-2xl border border-violet-200 bg-violet-50/40 p-5 space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-black text-slate-800">{row.name} <span dir="ltr" className="text-xs font-bold text-slate-500">{formatPersianCode(row.code)}</span></h4>
        <button type="button" onClick={onClose} aria-label="بستن" className="rounded-lg p-1 text-slate-500 hover:bg-white"><X className="w-4 h-4" /></button>
      </div>
      {row.blocker && <p className="text-xs font-bold text-amber-700">{PUBLISH_BLOCKER_MESSAGES[row.blocker]}</p>}
      <fieldset disabled={save.isPending} className="grid gap-3 md:grid-cols-2">
        <label className="inline-flex items-center gap-2 text-sm font-bold text-slate-700 md:col-span-2">
          <input type="checkbox" checked={form.published} disabled={Boolean(row.blocker) && !row.published} onChange={e => set('published', e.target.checked)} />
          روی سایت منتشر شود
        </label>
        <div>
          <label htmlFor={`${id}-slug`} className={label}>نشانی لاتین</label>
          <input id={`${id}-slug`} dir="ltr" className={field} value={form.slug} onChange={e => set('slug', e.target.value.toLowerCase())} />
          <p className="mt-1 text-xs text-slate-500" dir="ltr">papitalgallery.com/product/{form.slug || '…'}</p>
          {slugProblem && <p className="mt-1 text-xs text-rose-700">{slugProblem}</p>}
          {row.published && <p className="mt-1 text-xs text-slate-500">تغییر نشانی کالای منتشرشده، پیوندهای پیشین را می‌شکند.</p>}
        </div>
        <div>
          <label htmlFor={`${id}-sort`} className={label}>ترتیب در فروشگاه (کوچک‌تر، جلوتر)</label>
          <DecimalInput id={`${id}-sort`} className={field} grouped={false} value={form.sortOrder} min={0} step={1} onValueChange={v => set('sortOrder', Number(v) || 0)} />
        </div>
        <div className="md:col-span-2">
          <label htmlFor={`${id}-seo-title`} className={label}>
            عنوان در نتیجه جست‌وجو ({formatPersianNumber(form.seoTitle.length)} از {formatPersianNumber(STOREFRONT_SEO_TITLE_MAX)})
          </label>
          <input id={`${id}-seo-title`} className={field} maxLength={STOREFRONT_SEO_TITLE_MAX} value={form.seoTitle} placeholder={row.name} onChange={e => set('seoTitle', e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <label htmlFor={`${id}-seo-desc`} className={label}>
            توضیح در نتیجه جست‌وجو ({formatPersianNumber(form.seoDescription.length)} از {formatPersianNumber(STOREFRONT_SEO_DESCRIPTION_MAX)})
          </label>
          <textarea id={`${id}-seo-desc`} rows={2} className={field} maxLength={STOREFRONT_SEO_DESCRIPTION_MAX} value={form.seoDescription} onChange={e => set('seoDescription', e.target.value)} />
        </div>
      </fieldset>
      <button type="submit" disabled={save.isPending || Boolean(slugProblem)} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
        <Save className="w-4 h-4" />
        {save.isPending ? 'در حال ذخیره…' : 'ذخیره'}
      </button>
    </form>
  );
}
