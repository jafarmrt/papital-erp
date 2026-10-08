import { afterEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
const toastError = vi.fn();
vi.mock('react-hot-toast', () => ({ toast: { error: (...args: unknown[]) => toastError(...args), success: () => undefined } }));

import { CreateRequisitionModal } from '../../components/procurement/CreateRequisitionModal';
import { describeOverOrders } from '../../services/procurement/requisitionOrder';
import { requisitionActionLabel } from '../../lib/procurement/requisitionFields';
import { apiFieldErrors } from '../../lib/apiFieldErrors';

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
  toastError.mockReset();
});

const ROOT = join(__dirname, '..', '..');
const PERSIAN = /[؀-ۿ]/;
const LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`|>[^<>{}]*</g;
const PACKAGE_10 = [
  'components/procurement/', 'hooks/procurement/', 'lib/procurement/', 'pages/ProcurementPage.tsx', 'routes/procurement.routes.ts',
  'routes/procurement.schemas.ts', 'services/procurement.service.ts', 'services/procurement/', 'components/project/CreatePurchaseOrderModal.tsx',
];
/** ت۵: «متریال» ← «مواد»، «کاتالوگ» ← «فهرست کالا»، «سند دوبل» ← «سند حسابداری»، «پک» ← «بسته»، «اکشن» ← «اقدام»، بی «(Requisitions)» */
const BANNED = /(?<![؀-ۿ])(متریال|کاتالوگ|دوبل|پک|اکشن)(?![؀-ۿ])|\(Requisitions\)/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

function persianTexts(file: string): Array<{ line: number; text: string }> {
  const found: Array<{ line: number; text: string }> = [];
  readFileSync(file, 'utf8').split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) return;
    const texts: string[] = [...(line.match(LITERAL) ?? [])];
    if (!/[<>{}'"`=;]/.test(line)) texts.push(line);
    for (const text of texts) if (PERSIAN.test(text)) found.push({ line: i + 1, text });
  });
  return found;
}

/**
 * v9.0.348 (TD-901، تصمیم ت۵ بسته ۱۰، مشاهده‌های O19 و O20): واژه‌ها و پیام‌های تدارکات. پیش‌تر رابط «متریال»، «کاتالوگ»،
 * «سند دوبل»، «پک»، «کلید اکشن» و «(Requisitions)» داشت، خطای اقدام گردش کار کلید انگلیسی آن را نشان می‌داد، پیام سفارش
 * بیش از درخواست رقم لاتین داشت و خطای فرم ثبت درخواست فقط در اعلان می‌آمد.
 */
describe('procurement wording and messages (TD-901)', () => {
  it('has none of the replaced words in package 10 Persian text', () => {
    const offenders = sourceFiles(ROOT)
      .filter(f => PACKAGE_10.some(p => relative(ROOT, f).replace(/\\/g, '/').startsWith(p)))
      .flatMap(f => persianTexts(f).filter(t => BANNED.test(t.text)).map(t => `${relative(ROOT, f)}:${t.line}: ${t.text}`));
    expect(offenders).toEqual([]);
  });

  it('names a workflow action by its Persian title, never its key', () => {
    expect(requisitionActionLabel('cancel_order')).toBe('لغو یا رد سفارش');
    expect(requisitionActionLabel('reopen', 'بازگشایی')).toBe('بازگشایی');
    expect(requisitionActionLabel('custom_step_key')).not.toContain('custom_step_key');
  });

  it('writes the over-order quantities in Persian digits', () => {
    const text = describeOverOrders([{ itemId: 9, itemName: 'سنگ فیروزه', requested: 10, orderedBefore: 8, ordering: 4.5, excess: 2.5 }]);
    expect(text).toBe('«سنگ فیروزه»: درخواست ۱۰، سفارش‌شده پیشین ۸، این سفارش ۴٫۵ (۲٫۵ بیش از درخواست)');
    expect(text).not.toMatch(/[0-9]/);
  });

  it('shows a form error under its own field, not only in a toast', () => {
    render(<CreateRequisitionModal isOpen onClose={() => undefined} onSuccess={() => undefined} />);
    fireEvent.click(screen.getByText('ثبت رسمی درخواست خرید'));
    const title = screen.getByLabelText(/عنوان درخواست خرید/);
    expect(title.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(String(title.getAttribute('aria-describedby')))?.textContent).toBe('عنوان درخواست خرید را وارد کنید');
    expect(fetchJson).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('puts the server validation message of a row under that row field', async () => {
    fetchJson.mockRejectedValue(Object.assign(new Error('Validation failed'), {
      status: 400,
      details: { issues: [{ path: 'body.items.0.requestedQty', message: 'مقدار درخواستی باید بیشتر از صفر باشد' }] },
    }));
    render(<CreateRequisitionModal isOpen onClose={() => undefined} onSuccess={() => undefined} />);
    fireEvent.change(screen.getByLabelText(/عنوان درخواست خرید/), { target: { value: 'خرید سنگ' } });
    fireEvent.change(screen.getByPlaceholderText('نام کالا'), { target: { value: 'سنگ فیروزه' } });
    fireEvent.click(screen.getByText('ثبت رسمی درخواست خرید'));
    await waitFor(() => expect(screen.queryByText('مقدار درخواستی باید بیشتر از صفر باشد')).not.toBeNull());
    const qty = screen.getByLabelText('مقدار درخواستی ردیف ۱');
    expect(qty.getAttribute('aria-invalid')).toBe('true');
    expect(toastError).not.toHaveBeenCalled();
    expect(apiFieldErrors({ details: { issues: [{ path: 'body.title', message: 'x' }] } })).toEqual({ title: 'x' });
  });
});
