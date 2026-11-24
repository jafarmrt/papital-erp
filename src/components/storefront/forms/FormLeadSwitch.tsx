import { useRef } from 'react';
import toast from 'react-hot-toast';
import { useFormMakesLeadMutation } from '../../../hooks/queries/useStorefrontFormQueries';
import { errorMessageOf } from '../../../utils';

/**
 * v12 phase 10f: «پروندهٔ فروش هم بساز» of one form of the site: while it is on, every answer to the form also opens a
 * sales lead of the CRM with the source «وبسایت» (as «هدیهٔ سازمانی» does). The switch is sent its target state under
 * the form's version, and works on the saved form.
 */
export function FormLeadSwitch({ formId, makesLead, version, disabled }: { formId: number; makesLead: boolean; version: number; /** the form has unsaved edits, or a request is on its way */ disabled: boolean }) {
  const turn = useFormMakesLeadMutation(formId);
  const sending = useRef(false);
  const set = (enabled: boolean) => {
    if (sending.current || disabled) return;
    sending.current = true;
    turn.mutate({ enabled, version }, {
      onSuccess: after => toast.success(after.makesLead ? 'پاسخ‌های این فرم از این پس پروندهٔ فروش هم می‌سازند.' : 'پاسخ‌های این فرم دیگر پروندهٔ فروش نمی‌سازند.'),
      onError: err => toast.error(errorMessageOf(err)),
      onSettled: () => { sending.current = false; },
    });
  };
  return (
    <section aria-label="پروندهٔ فروش" className="space-y-1 rounded-2xl border border-slate-200 bg-white p-4">
      <label className="flex items-center gap-2 text-sm font-bold text-slate-800">
        <input type="checkbox" checked={makesLead} disabled={disabled || turn.isPending} onChange={e => set(e.target.checked)} />
        پروندهٔ فروش هم بساز
      </label>
      <p className="text-xs leading-6 text-slate-500">
        هر پاسخ به این فرم، جز پیامی که در «پیام‌های سایت» می‌آید، یک پروندهٔ فروش تازه با منبع «وبسایت» هم در ارتباط با مشتری می‌سازد. نخستین «متن کوتاه» نام و نخستین «شمارهٔ همراه» شمارهٔ آن پرونده می‌شود و همهٔ پاسخ‌ها در یادداشت پرونده نوشته می‌شود؛ پس هر همکاری که پرونده‌های فروش را می‌بیند آن‌ها را می‌خواند، و با برداشتن پیام از «پیام‌های سایت» از پرونده پاک نمی‌شود.
      </p>
    </section>
  );
}
