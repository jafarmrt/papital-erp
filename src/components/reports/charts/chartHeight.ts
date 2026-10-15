/** v10.1.15 (D-03 بخش ۴): بلندی نمودار، بیرون از فایل کتابخانه تا جای خالی پیش از بار شدن نمودار هم‌اندازه آن باشد */
export function chartHeight(orientation: 'vertical' | 'horizontal', count: number): number {
  return orientation === 'vertical' ? 240 : Math.max(120, count * 30 + 40);
}
