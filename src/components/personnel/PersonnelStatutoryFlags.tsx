/**
 * v10.0.210 (TD-1087، طرح حقوق ت۵ الف): «مشمول بیمه» و «مشمول مالیات حقوق» پرونده پرسنل. فیش حقوق کسورات قانونی را فقط
 * برای پرسنل مشمول، از نرخ‌های سال پایان دوره، حساب می‌کند. پرسنل پیش از این نسخه هر دو را خاموش دارند.
 */
export function PersonnelStatutoryFlags({ insurance, tax, onChange }: {
  insurance: boolean;
  tax: boolean;
  onChange: (flags: { isInsuranceCovered: boolean; isTaxCovered: boolean }) => void;
}) {
  return (
    <div className="space-y-1.5">
      <span className="block text-xs font-bold text-slate-700">بیمه و مالیات حقوق</span>
      <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
        <input type="checkbox" checked={insurance} onChange={(e) => onChange({ isInsuranceCovered: e.target.checked, isTaxCovered: tax })} />
        مشمول بیمه
      </label>
      <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
        <input type="checkbox" checked={tax} onChange={(e) => onChange({ isInsuranceCovered: insurance, isTaxCovered: e.target.checked })} />
        مشمول مالیات حقوق
      </label>
      <p className="text-[10px] text-slate-500">فیش حقوق بیمه و مالیات را فقط برای گزینه‌های روشن، از نرخ‌های سال پایان دوره فیش حساب می‌کند.</p>
    </div>
  );
}
