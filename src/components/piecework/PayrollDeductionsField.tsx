/**
 * v9.0.324 (TD-861، تصمیم ت۵ الف): کادر «سایر کسورات» فرم صدور فیش. پیش‌تر برچسب «(بیمه/مالیات...)» داشت، در حالی که سامانه
 * بیمه و مالیات حساب نمی‌کند، و مبلغ بی هیچ توضیحی به حساب ۳۲۰۲ می‌رفت. اکنون کسورات بالای صفر شرح می‌خواهد (سرور هم ۴۲۲ می‌دهد)
 * و شرح روی فیش و در ردیف سند می‌آید.
 */
interface PayrollDeductionsFieldProps {
  amount: number;
  onAmountChange: (val: number) => void;
  description: string;
  onDescriptionChange: (val: string) => void;
  currencyLabel: string;
}

/** کسورات بالای صفر بی شرح صادر نمی‌شود */
export const deductionsNeedDescription = (amount: number, description: string): boolean =>
  (amount || 0) > 0 && !description.trim();

export function PayrollDeductionsField({ amount, onAmountChange, description, onDescriptionChange, currencyLabel }: PayrollDeductionsFieldProps) {
  const missing = deductionsNeedDescription(amount, description);
  return (
    <div>
      <label htmlFor="payroll-deductions" className="block text-xs font-bold text-slate-700 mb-1">{`سایر کسورات (${currencyLabel})`}</label>
      <input
        id="payroll-deductions"
        type="number"
        min="0"
        value={amount}
        onChange={(e) => onAmountChange(Math.max(0, Number(e.target.value) || 0))}
        className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 font-mono"
      />
      {(amount || 0) > 0 && (
        <>
          <label htmlFor="payroll-deductions-description" className="block text-xs font-bold text-slate-700 mt-2 mb-1">شرح سایر کسورات</label>
          <input
            id="payroll-deductions-description"
            type="text"
            required
            maxLength={500}
            placeholder="بابت چه چیزی کسر می‌شود"
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800"
          />
          {missing && <p className="text-[10px] text-rose-700 mt-1 font-bold">برای «سایر کسورات» شرح بنویسید؛ فیش بی شرح صادر نمی‌شود.</p>}
        </>
      )}
    </div>
  );
}
