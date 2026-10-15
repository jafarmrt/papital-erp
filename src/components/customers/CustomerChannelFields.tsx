import { Globe } from 'lucide-react';
import { emailError, instagramError, websiteError } from '../../lib/customers/contactChannels';

export interface CustomerChannelForm {
  website: string;
  email: string;
  instagram: string;
}

interface CustomerChannelFieldsProps {
  value: CustomerChannelForm;
  onChange: (next: CustomerChannelForm) => void;
}

const INPUT_CLASS = 'w-full border rounded-lg px-2.5 py-1.5 text-xs bg-white focus:ring-2 focus:ring-blue-500 outline-none text-left';

/**
 * v10.1.15 (N-02 بخش ۱): بخش «راه‌های ارتباط برخط» فرم طرف حساب. خطای هر فیلد با همان قاعده کارساز زیر خودش دیده
 * می‌شود؛ وب‌سایت بی `https://` و اینستاگرام با «@» یا نشانی کامل صفحه هم پذیرفته است.
 */
export function CustomerChannelFields({ value, onChange }: CustomerChannelFieldsProps) {
  const fields: Array<{ key: keyof CustomerChannelForm; label: string; placeholder: string; error: string | null; type: string }> = [
    { key: 'website', label: 'وب‌سایت', placeholder: 'papital.ir', error: websiteError(value.website), type: 'text' },
    { key: 'email', label: 'ایمیل', placeholder: 'info@papital.ir', error: emailError(value.email), type: 'email' },
    { key: 'instagram', label: 'اینستاگرام', placeholder: '@papital', error: instagramError(value.instagram), type: 'text' },
  ];
  return (
    <div className="space-y-3 bg-slate-50/50 p-4 rounded-xl border border-slate-200">
      <h4 className="text-xs font-bold text-slate-700 border-b border-slate-200 pb-1.5 flex items-center gap-1.5">
        <Globe size={14} className="text-blue-600" />
        راه‌های ارتباط برخط
      </h4>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {fields.map(f => (
          <div key={f.key}>
            <label htmlFor={`customer-channel-${f.key}`} className="block text-[10px] font-medium mb-1 text-slate-600">{f.label}</label>
            <input
              id={`customer-channel-${f.key}`}
              type={f.type}
              dir="ltr"
              value={value[f.key]}
              onChange={e => onChange({ ...value, [f.key]: e.target.value })}
              placeholder={f.placeholder}
              aria-invalid={f.error ? true : undefined}
              className={`${INPUT_CLASS} ${f.error ? 'border-rose-400' : 'border-slate-200'}`}
            />
            {f.error && <p className="mt-1 text-[10px] text-rose-600" role="alert">{f.error}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

/** نخستین خطای راه‌های ارتباط فرم، یا null */
export function customerChannelFormError(value: CustomerChannelForm): string | null {
  return websiteError(value.website) || emailError(value.email) || instagramError(value.instagram);
}
