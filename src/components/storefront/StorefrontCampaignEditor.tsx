import { useId, useState } from 'react';
import { Save, Sparkles, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { JalaliDateInput } from '../common/JalaliDateInput';
import { useSaveCampaignMutation } from '../../hooks/queries/useStorefrontCampaignQueries';
import type { CampaignInput, CampaignRow } from '../../lib/storefront/storefrontCampaignContracts';
import {
  CAMPAIGN_BODY_MAX, CAMPAIGN_SOURCES, CAMPAIGN_SOURCE_TITLES, CAMPAIGN_SUMMARY_MAX, CAMPAIGN_TEMPLATES, campaignProblem, normalizedCampaign,
  type CampaignSource,
} from '../../lib/storefront/storefrontCampaignRules';
import { formatPersianNumber } from '../../utils/persianNumber';
import { errorMessageOf } from '../../utils';
import { StorefrontCampaignHeroPicker } from './StorefrontCampaignHeroPicker';
import { StorefrontCampaignProducts, type ChosenProduct } from './StorefrontCampaignProducts';

/**
 * v11 phase 8.5b: one campaign page of the site. The texts may start from a template (Yalda) whose words are placeholders
 * to rewrite; the page shows on the site only while it is on and between its two days. The form checks what it can before
 * sending (the same rules as the server); the server checks the image, the items, the collection and the code again.
 */
const field = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-base sm:text-sm';
const label = 'mb-1 block text-xs font-bold text-slate-700';
const check = 'flex min-h-11 items-center gap-2 text-sm text-slate-700';

const EMPTY: CampaignInput = {
  slug: '', title: '', summary: '', body: '', heroAssetId: null, source: 'collection', collection: '', itemIds: [], discountCode: '',
  startsOn: '', endsOn: '', homeBanner: false, isActive: true,
};

export function StorefrontCampaignEditor({ campaign, collections, onClose }: { campaign: CampaignRow | null; collections: string[]; onClose: () => void }) {
  const id = useId();
  const save = useSaveCampaignMutation();
  const [form, setForm] = useState<CampaignInput>(() => {
    if (!campaign) return { ...EMPTY };
    const { id: _id, version: _version, status: _status, hero: _hero, products: _products, ...input } = campaign;
    return input;
  });
  const [heroTitle, setHeroTitle] = useState(campaign?.hero?.title ?? '');
  const [chosen, setChosen] = useState<ChosenProduct[]>(() => campaign?.products.map(p => ({ itemId: p.itemId, code: p.code, name: p.name })) ?? []);
  const [shown, setShown] = useState(false);
  const set = <K extends keyof CampaignInput>(key: K, value: CampaignInput[K]) => setForm(f => ({ ...f, [key]: value }));

  const input: CampaignInput = { ...form, itemIds: form.source === 'products' ? chosen.map(c => c.itemId) : [] };
  const problem = campaignProblem(normalizedCampaign(input));
  const fromTemplate = (key: string) => {
    const template = CAMPAIGN_TEMPLATES.find(t => t.key === key);
    if (template) setForm(f => ({ ...f, ...template.values }));
  };

  const submit = () => {
    setShown(true);
    if (problem) return;
    save.mutate({ id: campaign?.id ?? null, version: campaign?.version ?? 0, input }, {
      onSuccess: (saved) => { toast.success(`صفحهٔ «${saved.title}» ذخیره شد.`); onClose(); },
      onError: (err) => toast.error(errorMessageOf(err)),
    });
  };

  return (
    <form aria-label={campaign ? `ویرایش صفحهٔ ${campaign.title}` : 'صفحهٔ ویژهٔ تازه'} className="space-y-4 rounded-2xl border border-sky-200 bg-sky-50/40 p-4 sm:p-5"
      onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-black text-slate-800">{campaign ? `ویرایش «${campaign.title}»` : 'صفحهٔ ویژهٔ تازه'}</h4>
        <button type="button" onClick={onClose} aria-label="بستن" className="rounded-lg p-2 text-slate-500 hover:bg-white"><X className="h-4 w-4" /></button>
      </div>
      {!campaign && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-600">شروع از الگو:</span>
          {CAMPAIGN_TEMPLATES.map(t => (
            <button key={t.key} type="button" onClick={() => fromTemplate(t.key)} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-sky-300 bg-white px-3.5 text-xs font-bold text-sky-800">
              <Sparkles className="h-3.5 w-3.5" />
              {t.title}
            </button>
          ))}
          <span className="text-xs text-slate-500">متن الگو موقت است؛ پیش از روشن کردن، آن را بازنویسی کنید.</span>
        </div>
      )}
      <fieldset disabled={save.isPending} className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor={`${id}-title`} className={label}>عنوان صفحه</label>
          <input id={`${id}-title`} className={field} value={form.title} onChange={e => set('title', e.target.value)} placeholder="یلدا با پاپیتال" />
        </div>
        <div>
          <label htmlFor={`${id}-slug`} className={label}>نشانی لاتین</label>
          <input id={`${id}-slug`} dir="ltr" className={field} value={form.slug} onChange={e => set('slug', e.target.value.toLowerCase())} placeholder="yalda" aria-describedby={`${id}-slug-hint`} />
          <p id={`${id}-slug-hint`} className="mt-1 text-xs text-slate-500"><bdi dir="ltr">/campaigns/{form.slug.trim() || 'yalda'}</bdi></p>
        </div>
        <div className="md:col-span-2">
          <label htmlFor={`${id}-summary`} className={label}>{`خلاصه (در فهرست‌ها و نتیجهٔ جست‌وجو؛ ${formatPersianNumber(form.summary.length)} از ${formatPersianNumber(CAMPAIGN_SUMMARY_MAX)})`}</label>
          <textarea id={`${id}-summary`} rows={2} className={field} value={form.summary} onChange={e => set('summary', e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <label htmlFor={`${id}-body`} className={label}>{`متن صفحه (${formatPersianNumber(form.body.length)} از ${formatPersianNumber(CAMPAIGN_BODY_MAX)})`}</label>
          <textarea id={`${id}-body`} rows={8} className={field} value={form.body} onChange={e => set('body', e.target.value)} aria-describedby={`${id}-body-hint`} />
          <p id={`${id}-body-hint`} className="mt-1 text-xs text-slate-500">یک خط خالی، بند تازه‌ای می‌سازد.</p>
        </div>
        <div className="md:col-span-2">
          <StorefrontCampaignHeroPicker value={form.heroAssetId} title={heroTitle} onChange={(assetId, title) => { set('heroAssetId', assetId); setHeroTitle(title); }} />
        </div>
        <fieldset className="space-y-2 md:col-span-2">
          <legend className={label}>محصولات صفحه</legend>
          <div role="radiogroup" aria-label="محصولات صفحه" className="flex flex-wrap gap-2">
            {CAMPAIGN_SOURCES.map(s => (
              <label key={s} className={`inline-flex min-h-11 cursor-pointer items-center rounded-xl border px-3 text-xs font-bold ${form.source === s ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700'}`}>
                <input type="radio" className="sr-only" name={`${id}-source`} checked={form.source === s} onChange={() => set('source', s as CampaignSource)} />
                {CAMPAIGN_SOURCE_TITLES[s]}
              </label>
            ))}
          </div>
          {form.source === 'collection' ? (
            <div>
              <label htmlFor={`${id}-collection`} className={label}>کالکشن</label>
              <select id={`${id}-collection`} className={field} value={form.collection} onChange={e => set('collection', e.target.value)}>
                <option value="">انتخاب کنید</option>
                {[...new Set([form.collection, ...collections].filter(Boolean))].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <p className="mt-1 text-xs text-slate-500">محصولات این کالکشن که روی سایت‌اند، به ترتیب فروشگاه نشان داده می‌شوند.</p>
            </div>
          ) : (
            <StorefrontCampaignProducts chosen={chosen} onChange={setChosen} />
          )}
        </fieldset>
        <div>
          <label htmlFor={`${id}-code`} className={label}>کد تخفیفی که روی صفحه دیده می‌شود (اختیاری)</label>
          <input id={`${id}-code`} dir="ltr" className={field} value={form.discountCode} onChange={e => set('discountCode', e.target.value.toUpperCase())} placeholder="YALDA1405" aria-describedby={`${id}-code-hint`} />
          <p id={`${id}-code-hint`} className="mt-1 text-xs leading-5 text-slate-500">کد باید در «کدهای تخفیف» ساخته شده باشد. سایت آن را فقط وقتی نشان می‌دهد که کد فعال و برای خریداران تکی باز است.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 md:col-span-2">
          <div>
            <label htmlFor={`${id}-starts`} className={label}>از روز (خالی یعنی از همین حالا)</label>
            <JalaliDateInput id={`${id}-starts`} className={field} value={form.startsOn} onChange={v => set('startsOn', v)} />
          </div>
          <div>
            <label htmlFor={`${id}-ends`} className={label}>تا پایان روز (خالی یعنی بی‌پایان)</label>
            <JalaliDateInput id={`${id}-ends`} className={field} value={form.endsOn} onChange={v => set('endsOn', v)} />
          </div>
        </div>
        <div className="flex flex-wrap gap-x-5 md:col-span-2">
          <label className={check}><input type="checkbox" checked={form.homeBanner} onChange={e => set('homeBanner', e.target.checked)} />در این روزها بالای صفحهٔ اصلی سایت بیاید</label>
          <label className={check}><input type="checkbox" checked={form.isActive} onChange={e => set('isActive', e.target.checked)} />صفحه روشن است</label>
        </div>
      </fieldset>
      {shown && problem && <p role="alert" className="text-xs text-rose-700">{problem.message}</p>}
      <button type="submit" disabled={save.isPending} className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50 sm:w-auto">
        <Save className="h-4 w-4" />
        {save.isPending ? 'در حال ذخیره…' : 'ذخیرهٔ صفحه'}
      </button>
    </form>
  );
}
