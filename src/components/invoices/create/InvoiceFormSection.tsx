import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface InvoiceFormSectionProps {
  icon: LucideIcon;
  title: string;
  /** یک جمله کوتاه زیر سرتیتر بخش */
  hint?: ReactNode;
  /** کنار سرتیتر (مثل شمار ردیف‌ها) */
  aside?: ReactNode;
  children: ReactNode;
}

/**
 * v10.2.2 (گزینه «ج» بازبینی فرم فاکتور): بخش سرتیتردار فرم فاکتور و پیش‌فاکتور، همان سرتیتر فرم سند انبار
 * (نشانه، عنوان پررنگ و خط زیر آن).
 */
export function InvoiceFormSection({ icon: Icon, title, hint, aside, children }: InvoiceFormSectionProps) {
  return (
    <section className="space-y-4" aria-label={title}>
      <div className="border-b border-slate-100 pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-slate-800">
            <Icon size={18} className="text-blue-600 shrink-0" aria-hidden="true" />
            <h3 className="font-bold text-sm">{title}</h3>
          </div>
          {aside}
        </div>
        {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
      </div>
      {children}
    </section>
  );
}
