/**
 * v9.0.316 (TD-730، نیمه ووکامرس): ردیف خالی جدول‌های گزارش سفارش ووکامرس. خطای خواندن (مثلاً ۴۰۳ یا ۵۰۰) با پیام کارساز
 * نشان داده می‌شود؛ پیش‌تر خطا بلعیده می‌شد و جدول «هنوز هیچ سفارشی ثبت نشده است» می‌گفت.
 */
export function WcListEmptyRow({ colSpan, error, emptyText }: { colSpan: number; error?: string; emptyText: string }) {
  return (
    <tr>
      <td colSpan={colSpan} role={error ? 'alert' : undefined} className={`p-6 text-center ${error ? 'text-rose-600' : 'text-slate-400'}`}>
        {error ? `این فهرست خوانده نشد: ${error}` : emptyText}
      </td>
    </tr>
  );
}
