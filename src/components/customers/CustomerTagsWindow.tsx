import React, { useState } from 'react';
import { Tag, Trash2, X } from 'lucide-react';
import { toast } from 'react-hot-toast';
import {
  CUSTOMER_TAG_COLORS, CUSTOMER_TAG_COLOR_LABELS, CUSTOMER_TAG_NAME_MAX, customerTagNameError, tagColorClass,
  type CustomerTagColor, type CustomerTagRow,
} from '../../lib/customers/customerTags';
import { useCustomerTagsQuery, useDeleteCustomerTagMutation, useSaveCustomerTagMutation } from '../../hooks/queries/useCustomerTagQueries';
import { OFFLINE_SUBMIT_TITLE, PHONE_SHEET_OVERLAY, PHONE_SHEET_PANEL, PHONE_TAP_TARGET } from '../../lib/pwa/phoneLayout';
import { useOnlineStatus } from '../../lib/pwa/useOnlineStatus';
import { formatPersianNumber } from '../../utils';
import { confirmAction } from '../ConfirmDialogHost';
import { DialogLayer } from '../common/DialogLayer';

const INPUT = 'border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none';

function ColorSelect({ value, onChange, label }: { value: CustomerTagColor; onChange: (c: CustomerTagColor) => void; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as CustomerTagColor)} className={INPUT}>
      {CUSTOMER_TAG_COLORS.map((c) => <option key={c} value={c}>{CUSTOMER_TAG_COLOR_LABELS[c]}</option>)}
    </select>
  );
}

function TagLine({ tag }: { tag: CustomerTagRow }): React.ReactElement {
  const online = useOnlineStatus();
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState<CustomerTagColor>(tag.color);
  const save = useSaveCustomerTagMutation();
  const remove = useDeleteCustomerTagMutation();
  const error = customerTagNameError(name);
  const changed = name.trim() !== tag.name || color !== tag.color;
  const busy = save.isPending || remove.isPending;

  const onSave = () => save.mutate({ id: tag.id, name: name.trim(), color, version: tag.version }, {
    onSuccess: () => toast.success('برچسب ذخیره شد.'),
  });
  const onDelete = async () => {
    const message = tag.customerCount > 0
      ? `برچسب «${tag.name}» از ${formatPersianNumber(tag.customerCount)} طرف حساب برداشته می‌شود. حذف شود؟`
      : `برچسب «${tag.name}» حذف شود؟`;
    if (await confirmAction({ title: 'حذف برچسب', message, confirmText: 'حذف', cancelText: 'انصراف' })) remove.mutate(tag.id);
  };

  return (
    <li data-tag-line={tag.id} className="flex flex-col sm:flex-row sm:items-center gap-2 p-2.5 rounded-xl border border-slate-200">
      <span className={`px-2 py-0.5 rounded-md border text-[11px] font-bold w-fit ${tagColorClass(color)}`}>{name.trim() || tag.name}</span>
      <input aria-label="نام برچسب" value={name} maxLength={CUSTOMER_TAG_NAME_MAX} onChange={(e) => setName(e.target.value)} className={`${INPUT} flex-1`} />
      <ColorSelect value={color} onChange={setColor} label="رنگ برچسب" />
      <span className="text-[11px] text-slate-500 whitespace-nowrap">{formatPersianNumber(tag.customerCount)} طرف حساب</span>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={onSave}
          disabled={!changed || Boolean(error) || busy || !online}
          title={online ? (error ?? undefined) : OFFLINE_SUBMIT_TITLE}
          className={`px-3 rounded-lg bg-blue-600 text-white text-xs font-bold disabled:opacity-40 ${PHONE_TAP_TARGET}`}
        >
          ذخیره
        </button>
        <button
          type="button"
          onClick={() => { void onDelete(); }}
          disabled={busy || !online}
          title={online ? 'حذف برچسب' : OFFLINE_SUBMIT_TITLE}
          aria-label={`حذف برچسب ${tag.name}`}
          className={`px-2.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-40 ${PHONE_TAP_TARGET}`}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </li>
  );
}

function NewTagForm(): React.ReactElement {
  const online = useOnlineStatus();
  const [name, setName] = useState('');
  const [color, setColor] = useState<CustomerTagColor>('blue');
  const save = useSaveCustomerTagMutation();
  const error = name.trim() ? customerTagNameError(name) : null;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const nameError = customerTagNameError(name);
    if (nameError) { toast.error(nameError); return; }
    save.mutate({ name: name.trim(), color }, {
      onSuccess: () => { setName(''); toast.success('برچسب ساخته شد.'); },
    });
  };
  return (
    <form onSubmit={submit} className="flex flex-col sm:flex-row gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200">
      <input
        aria-label="نام برچسب تازه"
        placeholder="نام برچسب، مثلاً عمده‌فروش"
        value={name}
        maxLength={CUSTOMER_TAG_NAME_MAX}
        onChange={(e) => setName(e.target.value)}
        className={`${INPUT} flex-1`}
      />
      <ColorSelect value={color} onChange={setColor} label="رنگ برچسب تازه" />
      <button
        type="submit"
        disabled={save.isPending || !online || Boolean(error)}
        title={online ? (error ?? undefined) : OFFLINE_SUBMIT_TITLE}
        className={`px-4 rounded-lg bg-emerald-600 text-white text-xs font-bold disabled:opacity-40 ${PHONE_TAP_TARGET}`}
      >
        افزودن برچسب
      </button>
    </form>
  );
}

/**
 * v10.1.23 (N-02 بخش ۳): پنجره «برچسب‌های طرف حساب» برای دارنده `customers.manage` (کلید هر سه نشانی نوشتن): ساخت، تغییر
 * نام و رنگ و حذف. حذف برچسب را از همه طرف حساب‌ها برمی‌دارد و پیش از آن شمارشان پرسیده می‌شود.
 */
export function CustomerTagsWindow({ onClose }: { onClose: () => void }): React.ReactElement {
  const { data: tags = [], isLoading, isError } = useCustomerTagsQuery();
  return (
    <div className={PHONE_SHEET_OVERLAY} role="dialog" aria-modal="true" aria-label="برچسب‌های طرف حساب">
      <DialogLayer onClose={onClose} />
      <div className={`${PHONE_SHEET_PANEL} bg-white max-w-2xl border border-slate-200 shadow-2xl overflow-hidden`}>
        <div className="px-5 py-3.5 border-b border-slate-200 flex justify-between items-center shrink-0 bg-slate-50/80">
          <h3 className="font-bold text-sm text-slate-800 flex items-center gap-2"><Tag size={16} className="text-blue-600" /> برچسب‌های طرف حساب</h3>
          <button type="button" onClick={onClose} aria-label="بستن" className={`px-2 rounded-lg text-slate-500 hover:bg-slate-200 ${PHONE_TAP_TARGET}`}><X size={18} /></button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">
          <NewTagForm />
          {isLoading && <p className="text-xs text-slate-500">در حال بارگذاری…</p>}
          {isError && <p className="text-xs text-rose-600" role="alert">فهرست برچسب‌ها خوانده نشد.</p>}
          {!isLoading && !isError && tags.length === 0 && <p className="text-xs text-slate-500">هنوز برچسبی نیست.</p>}
          <ul className="space-y-2">
            {tags.map((t) => <TagLine key={`${t.id}-${t.version}`} tag={t} />)}
          </ul>
        </div>
      </div>
    </div>
  );
}
