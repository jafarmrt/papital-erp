/**
 * v10.0.210 (TD-1087، طرح حقوق ت۵ الف): «مشمول بیمه» و «مشمول مالیات حقوق» پرونده پرسنل. فیش حقوق کسورات قانونی را فقط
 * برای پرسنل مشمول، از نرخ‌های سال پایان دوره، حساب می‌کند. پرسنل پیش از این نسخه هر دو را خاموش دارند.
 * v10.1.32 (TD-1282، تصمیم ت۳۴ الف): «مشمول عیدی»، پیش‌فرض روشن؛ برای پرسنل خاموش سهم عیدی و حق عیدی سال حساب نمی‌شود.
 */
export interface PersonnelStatutoryFlagValues {
  isInsuranceCovered: boolean;
  isTaxCovered: boolean;
  isEidiCovered: boolean;
}

export function PersonnelStatutoryFlags({ insurance, tax, eidi, onChange }: {
  insurance: boolean;
  tax: boolean;
  eidi: boolean;
  onChange: (flags: PersonnelStatutoryFlagValues) => void;
}) {
  const current: PersonnelStatutoryFlagValues = { isInsuranceCovered: insurance, isTaxCovered: tax, isEidiCovered: eidi };
  return (
    <div className="space-y-1.5">
      <span className="block text-xs font-bold text-slate-700">بیمه، مالیات حقوق و عیدی</span>
      <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
        <input type="checkbox" checked={insurance} onChange={(e) => onChange({ ...current, isInsuranceCovered: e.target.checked })} />
        مشمول بیمه
      </label>
      <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
        <input type="checkbox" checked={tax} onChange={(e) => onChange({ ...current, isTaxCovered: e.target.checked })} />
        مشمول مالیات حقوق
      </label>
      <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
        <input type="checkbox" checked={eidi} onChange={(e) => onChange({ ...current, isEidiCovered: e.target.checked })} />
        مشمول عیدی
      </label>
      <p className="text-[10px] text-slate-500">فیش حقوق بیمه و مالیات را فقط برای گزینه‌های روشن، از نرخ‌های سال پایان دوره فیش حساب می‌کند. برای کسی که «مشمول عیدی» خاموش است سهم عیدی حساب نمی‌شود و هشدار نرخ عیدی هم نمی‌آید.</p>
    </div>
  );
}
