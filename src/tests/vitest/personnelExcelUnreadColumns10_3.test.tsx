import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as xlsx from 'xlsx';
import { PersonnelExcelModal } from '../../components/personnel/PersonnelExcelModal';

// 10.3 package 6 (TD-1386): a re-imported personnel export says which of its columns the import does not read
vi.mock('../../api', () => ({ fetchJson: vi.fn(async () => ({ rows: [] })), isAbortError: () => false }));
const toastFn = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ toast: toastFn, default: toastFn }));
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: async () => true }));

afterEach(cleanup);

function sheetFile(rows: Record<string, unknown>[]): File {
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(rows), 'پرسنل');
  const binary = xlsx.write(wb, { type: 'binary', bookType: 'xlsx' }) as string;
  const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
  return new File([bytes], 'personnel.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

async function upload(rows: Record<string, unknown>[]) {
  render(<PersonnelExcelModal isOpen onClose={() => {}} onSuccess={() => {}} existingPersonnel={[]} />);
  const input = document.getElementById('personnel-excel-file-input') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [sheetFile(rows)] } });
  await waitFor(() => expect(screen.getByText(/کل ردیف‌های فایل/)).toBeTruthy());
}

describe('10.3 package 6: the personnel Excel preview names the columns it does not read', () => {
  it('names the salary and flag columns of a re-imported export in the preview', async () => {
    await upload([{ 'کد پرسنلی': 'P-1', 'نام و نام خانوادگی': 'رضا رضایی', 'حقوق ماهانه': 90000000, 'مشمول بیمه': 'خیر', 'مشمول عیدی': 'بله' }]);
    const notice = screen.getByRole('status').textContent ?? '';
    expect(notice).toContain('«حقوق ماهانه»');
    expect(notice).toContain('«مشمول بیمه»');
    expect(notice).toContain('«مشمول عیدی»');
    expect(notice).toContain('خوانده نمی‌شوند');
  });

  // review of #380: the read columns follow the same header rule, so a header typed with Arabic «ي» is read, not dropped
  it('reads a column whose header has Arabic «ي» or a zero-width non-joiner', async () => {
    await upload([{ 'کد پرسنلی': 'P-3', 'نام و نام خانوادگی': 'سارا احمدی', 'عنوان شغلي': 'زرگر' }]);
    expect(screen.getByText('زرگر')).toBeTruthy();
  });

  it('shows no notice for a sheet without those columns', async () => {
    await upload([{ 'کد پرسنلی': 'P-2', 'نام و نام خانوادگی': 'مینا محمدی', 'ملیت': 'ایرانی' }]);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
