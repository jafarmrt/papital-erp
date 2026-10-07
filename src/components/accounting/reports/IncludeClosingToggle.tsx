/**
 * v9.0.148 (TD-545، B03-03، تصمیم مالک محصول ت۳ الف): کادر «همراه اسناد اختتامیه» برای تراز آزمایشی، صورت سود و زیان،
 * ترازنامه و نسبت‌ها. بی تیک، اسناد اختتامیه‌ای که بستن سال در روز پایان گزارش صادر کرده شمرده نمی‌شوند و صورت‌های مالی
 * سال بسته‌شده (برای اظهارنامه و مجمع) دوباره بیرون می‌آیند؛ پیش‌تر این گزارش‌ها پس از بستن سال صفر بودند.
 */
export function IncludeClosingToggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label
      className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer"
      title="بی این گزینه، اسناد اختتامیه بستن سال در روز پایان گزارش شمرده نمی‌شوند و صورت‌های همان سال پیش از بستن دیده می‌شوند"
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
      />
      همراه اسناد اختتامیه
    </label>
  );
}
