import { useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, Plus, Save, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useDeleteFormMutation, useFormEnabledMutation, useSaveFormMutation } from '../../../hooks/queries/useStorefrontFormQueries';
import type { FormDetail } from '../../../lib/storefront/storefrontFormContracts';
import {
  FORM_FIELDS_MAX, FORM_FIELD_KINDS, FORM_FIELD_KIND_TITLES, FORM_INTRO_MAX, FORM_KEY_MAX, FORM_SUBMIT_LABEL_DEFAULT, FORM_SUBMIT_LABEL_MAX, FORM_SUCCESS_DEFAULT,
  FORM_SUCCESS_MAX, FORM_TITLE_MAX, checkedForm, emptyField, type FormField, type FormFieldKind, type FormValues,
} from '../../../lib/storefront/storefrontFormRules';
import { formatPersianNumber } from '../../../utils/persianNumber';
import { errorMessageOf } from '../../../utils';
import { FormFieldCard } from './FormFieldCard';

/**
 * v12 phase 10f (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2 «۱۰و»): the editor of one form of the site: its words, its
 * fields in order, and the switch that puts it on the site. The rules the server checks with (`checkedForm`) run here
 * first. A form that is on the site changes there as soon as it is saved, so the screen says so; the switch and the
 * removal work on what is saved, under the form's version.
 */
const field = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm';
const label = 'block text-xs font-bold text-slate-700 mb-1';
const hint = 'mt-1 text-xs leading-6 text-slate-500';
const card = 'rounded-2xl border border-slate-200 bg-white p-5 space-y-3';
const iconButton = 'rounded-lg p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-30';

const same = (a: FormValues, b: FormValues): boolean => JSON.stringify(a) === JSON.stringify(b);

export function FormEditor({ detail, canManage, onBack, onDeleted }: { detail: FormDetail; canManage: boolean; onBack: () => void; onDeleted: () => void }) {
  const id = useId();
  const save = useSaveFormMutation(detail.id);
  const turn = useFormEnabledMutation(detail.id);
  const remove = useDeleteFormMutation();
  const [draft, setDraft] = useState<FormValues>(detail.form);
  /** the server's copy the edits on the screen started from, and its version: every request goes out under this version */
  const [base, setBase] = useState({ form: detail.form, version: detail.version, enabled: detail.enabled });
  /** this screen itself asked for the change of version that is on its way */
  const [own, setOwn] = useState(false);
  const [addKind, setAddKind] = useState<FormFieldKind>('shortText');
  const [asking, setAsking] = useState(false);

  const dirty = useMemo(() => !same(draft, base.form), [draft, base.form]);
  const outdated = detail.version !== base.version;
  // the server's copy replaces the screen's when this screen moved the version itself or nothing here is unsaved; a
  // colleague's newer version never overwrites unsaved edits (as in the page builder)
  const adopt = () => {
    setOwn(false);
    setBase({ form: detail.form, version: detail.version, enabled: detail.enabled });
    setDraft(detail.form);
  };
  const adoptEvent = useEffectEvent(() => { if (outdated && (own || !dirty)) adopt(); });
  useEffect(() => { adoptEvent(); }, [detail.version]);
  const stale = outdated && dirty && !own;

  const fields = Array.isArray(draft.fields) ? draft.fields : [];
  const problem = useMemo(() => checkedForm(draft, { forSite: base.enabled }).problem, [draft, base.enabled]);
  /** why the saved form cannot go on the site yet */
  const notReady = useMemo(() => checkedForm(base.form, { forSite: true }).problem, [base.form]);
  const busy = save.isPending || turn.isPending || remove.isPending;
  const disabled = !canManage || busy;

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => setDraft(d => ({ ...d, [key]: value }));
  const setField = (index: number, next: FormField) => set('fields', fields.map((f, i) => (i === index ? next : f)));
  const moveField = (from: number, to: number) => {
    const next = [...fields];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    set('fields', next);
  };

  // a request started from a button, the form's own submit or a second click runs once (AGENTS.md §6.4)
  const sending = useRef(false);
  const submit = () => {
    if (sending.current || !canManage || !dirty || problem || stale) return;
    sending.current = true;
    setOwn(true);
    save.mutate({ ...draft, version: base.version }, {
      onSuccess: () => toast.success(base.enabled ? 'فرم ذخیره شد و روی سایت هم عوض شد.' : 'فرم ذخیره شد.'),
      onError: (err) => { setOwn(false); toast.error(errorMessageOf(err)); },
      onSettled: () => { sending.current = false; },
    });
  };
  const setEnabled = (enabled: boolean) => {
    if (sending.current || dirty || outdated) return;
    sending.current = true;
    setOwn(true);
    turn.mutate({ enabled, version: base.version }, {
      onSuccess: (after) => {
        if (after.version === base.version) setOwn(false);
        toast.success(after.enabled ? 'فرم روی سایت آمد.' : 'فرم از روی سایت برداشته شد.');
      },
      onError: (err) => { setOwn(false); toast.error(errorMessageOf(err)); },
      onSettled: () => { sending.current = false; },
    });
  };
  const removeForm = () => {
    setAsking(false);
    if (sending.current || outdated) return;
    sending.current = true;
    remove.mutate({ id: detail.id, version: base.version }, {
      onSuccess: () => { toast.success('فرم حذف شد.'); onDeleted(); },
      onError: err => toast.error(errorMessageOf(err)),
      onSettled: () => { sending.current = false; },
    });
  };
  const confirmation = useRef<HTMLDivElement>(null);
  useEffect(() => { if (asking) confirmation.current?.focus(); }, [asking]);

  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700">
          <ArrowRight className="h-4 w-4" />
          همهٔ فرم‌ها
        </button>
        <h2 className="min-w-0 flex-1 truncate text-base font-black text-slate-800">{detail.title}</h2>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${base.enabled ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>{base.enabled ? 'روی سایت' : 'خاموش'}</span>
      </div>

      <fieldset disabled={disabled} className="space-y-5">
        <section aria-label="مشخصات فرم" className={card}>
          <h3 className="text-sm font-black text-slate-800">مشخصات فرم</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label htmlFor={`${id}-title`} className={label}>عنوان فرم</label>
              <input id={`${id}-title`} className={field} maxLength={FORM_TITLE_MAX} value={draft.title} onChange={e => set('title', e.target.value)} />
            </div>
            <div>
              <label htmlFor={`${id}-key`} className={label}>نام لاتین</label>
              <input id={`${id}-key`} dir="ltr" className={field} maxLength={FORM_KEY_MAX} value={draft.key} disabled={base.enabled} onChange={e => set('key', e.target.value)} />
              <p className={hint}>{base.enabled ? 'این فرم روی سایت است؛ نام لاتین آن تا برداشتن از روی سایت عوض نمی‌شود.' : 'حرف کوچک انگلیسی، رقم و خط تیره، مانند contact. بازدیدکننده آن را نمی‌بیند.'}</p>
            </div>
          </div>
          <div>
            <label htmlFor={`${id}-intro`} className={label}>متن بالای فرم (اختیاری)</label>
            <textarea id={`${id}-intro`} rows={3} className={field} maxLength={FORM_INTRO_MAX} value={draft.intro} onChange={e => set('intro', e.target.value)} />
            <p className={hint}>متن ساده؛ یک خط خالی بند تازه می‌سازد.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label htmlFor={`${id}-submit`} className={label}>نوشتهٔ دکمه</label>
              <input id={`${id}-submit`} className={field} maxLength={FORM_SUBMIT_LABEL_MAX} placeholder={FORM_SUBMIT_LABEL_DEFAULT} value={draft.submitLabel} onChange={e => set('submitLabel', e.target.value)} />
            </div>
            <div>
              <label htmlFor={`${id}-success`} className={label}>پیام پس از فرستادن</label>
              <input id={`${id}-success`} className={field} maxLength={FORM_SUCCESS_MAX} placeholder={FORM_SUCCESS_DEFAULT} value={draft.successMessage} onChange={e => set('successMessage', e.target.value)} />
            </div>
          </div>
        </section>

        <section aria-label="فیلدهای فرم" className="space-y-3">
          <h3 className="text-sm font-black text-slate-800">فیلدهای فرم</h3>
          {fields.length === 0 && <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-xs text-slate-500">این فرم هنوز فیلدی ندارد. نخستین فیلد را از پایین بیفزایید.</p>}
          <ol className="space-y-3">
            {fields.map((item, index) => {
              const name = `فیلد ${formatPersianNumber(index + 1)}`;
              const title = `${name}، ${FORM_FIELD_KIND_TITLES[item.kind]}`;
              return (
                <li key={item.id} aria-label={title} className={`${card} ${problem?.index === index ? 'border-rose-400' : ''}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 flex-1 text-sm font-black text-slate-800">{title}</p>
                    <button type="button" className={iconButton} disabled={index === 0} aria-label={`${title}: بالا`} onClick={() => moveField(index, index - 1)}><ArrowUp className="h-4 w-4" /></button>
                    <button type="button" className={iconButton} disabled={index === fields.length - 1} aria-label={`${title}: پایین`} onClick={() => moveField(index, index + 1)}><ArrowDown className="h-4 w-4" /></button>
                    <button type="button" className={`${iconButton} text-rose-600`} aria-label={`حذف ${title}`} onClick={() => set('fields', fields.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></button>
                  </div>
                  <FormFieldCard value={item} name={name} disabled={disabled} onChange={next => setField(index, next)} />
                </li>
              );
            })}
          </ol>
          {canManage && (
            <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-slate-200 bg-white p-3">
              <div>
                <label htmlFor={`${id}-add`} className={label}>فیلد تازه</label>
                <select id={`${id}-add`} className={field} value={addKind} onChange={e => setAddKind(e.target.value as FormFieldKind)}>
                  {FORM_FIELD_KINDS.map(kind => <option key={kind} value={kind}>{FORM_FIELD_KIND_TITLES[kind]}</option>)}
                </select>
              </div>
              <button type="button" disabled={fields.length >= FORM_FIELDS_MAX} onClick={() => set('fields', [...fields, emptyField(addKind, fields)])}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 disabled:opacity-40">
                <Plus className="h-4 w-4" />
                افزودن فیلد
              </button>
              <p className="text-xs text-slate-500">{`تا ${formatPersianNumber(FORM_FIELDS_MAX)} فیلد.`}</p>
            </div>
          )}
        </section>
      </fieldset>

      {stale && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="min-w-0 flex-1">همکار دیگری این فرم را در همین فاصله عوض کرده است. تغییرهای شما ذخیره نشده و روی نسخهٔ پیشین است.</p>
          <button type="button" onClick={adopt} className="rounded-lg bg-amber-800 px-3 py-1.5 font-bold text-white">خواندن نسخهٔ تازه و دور ریختن تغییرهای من</button>
        </div>
      )}
      {problem && <p role="alert" className="text-xs text-rose-700">{problem.message}</p>}
      {canManage && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={busy || !dirty || Boolean(problem) || stale} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
              <Save className="h-4 w-4" />
              {save.isPending ? 'در حال ذخیره…' : 'ذخیرهٔ فرم'}
            </button>
            <button type="button" disabled={busy || outdated} onClick={() => setAsking(true)} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3 text-xs font-bold text-rose-700 disabled:opacity-40">
              <Trash2 className="h-4 w-4" />
              حذف فرم
            </button>
          </div>
          {base.enabled && dirty && <p className="text-xs text-amber-800">این فرم روی سایت است؛ با «ذخیرهٔ فرم» همان‌جا هم عوض می‌شود.</p>}
          <section aria-label="فرم روی سایت" className="space-y-1 rounded-2xl border border-slate-200 bg-white p-4">
            <label className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <input type="checkbox" checked={base.enabled} disabled={busy || dirty || outdated || (!base.enabled && Boolean(notReady))} onChange={e => setEnabled(e.target.checked)} />
              این فرم روی سایت باشد
            </label>
            <p className="text-xs leading-6 text-slate-500">
              {dirty ? 'نخست فرم را ذخیره کنید.'
                : !base.enabled && notReady ? notReady.message
                  : base.enabled ? 'سایت این فرم را می‌گیرد و پاسخ‌هایش را می‌پذیرد.' : 'تا این کلید خاموش است، سایت این فرم را نشان نمی‌دهد و پاسخی برای آن نمی‌پذیرد.'}
            </p>
          </section>
          {asking && (
            <div ref={confirmation} tabIndex={-1} role="group" aria-label="تأیید حذف فرم" className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              <p className="min-w-0 flex-1">{`این فرم حذف می‌شود${base.enabled ? ' و از روی سایت هم برداشته می‌شود' : ''}.${dirty ? ' تغییرهای ذخیره‌نشدهٔ آن هم از میان می‌رود.' : ''}`}</p>
              <button type="button" disabled={busy} onClick={removeForm} className="rounded-lg bg-amber-800 px-3 py-1.5 font-bold text-white disabled:opacity-50">بله، حذف شود</button>
              <button type="button" onClick={() => setAsking(false)} className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 font-bold">انصراف</button>
            </div>
          )}
        </div>
      )}
    </form>
  );
}
