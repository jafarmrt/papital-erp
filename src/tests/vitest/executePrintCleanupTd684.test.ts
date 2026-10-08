import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executePrint } from '../../utils/printHelper';

// v9.0.311 (TD-684، B16-20): پاک‌سازی چاپ یک بار اجرا می‌شود و کلاس و عنوان تازه‌تر را پاک نمی‌کند
beforeEach(() => {
  vi.useFakeTimers();
  // a blocking print like Chrome: afterprint fires before print() returns
  vi.spyOn(window, 'print').mockImplementation(() => { window.dispatchEvent(new Event('afterprint')); });
  document.title = 'سامانه';
  document.body.classList.remove('printing-doc');
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.classList.remove('printing-doc');
});

describe('executePrint cleanup (TD-684)', () => {
  it('runs the cleanup once and keeps the class of an open print window and a newer title', () => {
    document.body.classList.add('printing-doc'); // set by useDocumentPrint while the print modal is open
    const onAfterPrint = vi.fn();
    executePrint({ documentTitle: 'فاکتور ۱۲', onAfterPrint });
    document.title = 'فاکتور ۱۳';
    vi.advanceTimersByTime(2500);
    expect(onAfterPrint).toHaveBeenCalledTimes(1);
    expect(document.body.classList.contains('printing-doc')).toBe(true);
    expect(document.title).toBe('فاکتور ۱۳');
  });

  it('removes the class it added itself and restores the title', () => {
    executePrint({ documentTitle: 'گزارش' });
    vi.advanceTimersByTime(2500);
    expect(document.body.classList.contains('printing-doc')).toBe(false);
    expect(document.title).toBe('سامانه');
  });
});
