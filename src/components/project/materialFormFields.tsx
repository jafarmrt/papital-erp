/**
 * v7.0.140: فیلدهای مشترک فرم ماده اولیه — پیش‌تر در مودال تأیید «مواد در انتظار» (PendingMaterialsPage) و
 * مودال ماده اولیه سفارشی پروژه (AddMaterialModal) تکرار شده بود. هر فرم state خودش را نگه می‌دارد.
 */
const STRONG_INPUT = 'w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-800 focus:ring-2 focus:ring-amber-500 focus:outline-none';
const NUMBER_INPUT = 'w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono font-bold text-slate-800 focus:ring-2 focus:ring-amber-500 focus:outline-none';
const PLAIN_INPUT = 'w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800 focus:outline-none';
const LABEL = 'font-bold text-slate-700 text-xs';

/** عنوان ماده اولیه (دو ستون، الزامی) */
export function MaterialNameField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="sm:col-span-2 space-y-1">
      <label className={LABEL}>{label}</label>
      <input type="text" required value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={STRONG_INPUT} />
    </div>
  );
}

export function MaterialUnitSelect({ value, onChange, units }: { value: string; onChange: (v: string) => void; units: readonly string[] }) {
  return (
    <div className="space-y-1">
      <label className={LABEL}>واحد شمارش *</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={STRONG_INPUT}>
        {units.map(u => (
          <option key={u} value={u}>{u}</option>
        ))}
      </select>
    </div>
  );
}

/** عدد نامنفی (مقدار، قیمت، نقطه سفارش، وزن) */
export function MaterialNumberField({ label, value, onChange, bold = true }: { label: string; value: number; onChange: (v: number) => void; bold?: boolean }) {
  return (
    <div className="space-y-1">
      <label className={LABEL}>{label}</label>
      <input
        type="number"
        min="0"
        step="any"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={bold ? NUMBER_INPUT : 'w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono text-slate-800 focus:outline-none'}
      />
    </div>
  );
}

/** رنگ، جنس و سایز / ابعاد */
export function MaterialAttributeFields({ color, material, size, onChange }: {
  color: string;
  material: string;
  size: string;
  onChange: (field: 'color' | 'material' | 'size', value: string) => void;
}) {
  const fields: Array<['color' | 'material' | 'size', string, string]> = [
    ['color', 'رنگ', color],
    ['material', 'جنس', material],
    ['size', 'سایز / ابعاد', size],
  ];
  return (
    <>
      {fields.map(([key, label, value]) => (
        <div key={key} className="space-y-1">
          <label className={LABEL}>{label}</label>
          <input type="text" value={value} onChange={(e) => onChange(key, e.target.value)} className={PLAIN_INPUT} />
        </div>
      ))}
    </>
  );
}
