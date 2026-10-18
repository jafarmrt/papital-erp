import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PHONE_WIDTH_QUERY } from '../../lib/pwa/usePhoneWidth';
import { InvoiceLinesList, INVOICE_LINES_TEXT } from '../../components/invoices/create/InvoiceLinesList';
import { InvoiceTotalsPanel } from '../../components/invoices/create/InvoiceTotalsPanel';
import { InvoiceSubmitBar, INVOICE_SUBMIT_TEXT } from '../../components/invoices/create/InvoiceSubmitBar';
import { InvoiceHeaderFields } from '../../components/invoices/create/InvoiceHeaderFields';
import { INVOICE_LINE_TEXT } from '../../components/invoices/create/InvoiceLinePicker';
import type { InvoiceDocItem } from '../../lib/invoices/invoiceForm';
import type { Item } from '../../types';

const SRC = join(__dirname, '..', '..');
const FORM_DIR = join(SRC, 'components', 'invoices', 'create');
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{231A}-\u{23FF}]/u;

/** Persian section titles and texts of the invoice form (v10.2.4, option «ج») */
const TEXT = {
  sections: ['مشخصات سند', 'خریدار', 'اقلام فاکتور'],
  totals: 'جمع و مالیات',
  vat: 'مالیات بر ارزش افزوده دارد',
  payable: 'قابل پرداخت',
  lineName: 'گردنبند نقره',
  editing: 'در حال ویرایش پیش‌فاکتور',
  warehouse: 'انبار خروج',
} as const;

function formSources(): Array<{ file: string; text: string }> {
  const files = ['pages/CreateInvoicePage.tsx', ...readdirSync(FORM_DIR).filter(f => f.endsWith('.tsx')).map(f => `components/invoices/create/${f}`)];
  return files.map(file => ({ file, text: readFileSync(join(SRC, file), 'utf8') }));
}

function setPhoneScreen(phone: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: phone && query === PHONE_WIDTH_QUERY, media: query, onchange: null,
    addEventListener: () => undefined, removeEventListener: () => undefined,
    addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  cleanup();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

const line: InvoiceDocItem = {
  item: { id: 3, code: 'P-3', name: TEXT.lineName, unit: 'عدد' } as Item,
  quantity: 2, unitPrice: 1000, discount: 100,
};

describe('TD-1292 the sales invoice form is laid out like the other forms (option C of the form review)', () => {
  it('the invoice form shows no emoji: icons carry the meaning', () => {
    const offending = formSources().filter(({ text }) => EMOJI.test(text)).map(({ file }) => file);
    expect(offending).toEqual([]);
  });

  it('the page is built from the headed sections, in document, buyer, items order', () => {
    const page = readFileSync(join(SRC, 'pages/CreateInvoicePage.tsx'), 'utf8');
    const order = ['<InvoiceHeaderFields', '<InvoiceBuyerFields', '<InvoiceLinePicker', '<InvoiceLinesList', '<InvoiceTotalsPanel', '<InvoiceSubmitBar']
      .map(tag => page.indexOf(tag));
    expect(order.every(i => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const sections = formSources().map(({ text }) => text).join('\n');
    for (const title of TEXT.sections) expect(sections).toContain(`title="${title}"`);
  });

  it('on a desktop screen the lines are a table that scrolls sideways, with a named delete button per row', () => {
    setPhoneScreen(false);
    const onRemove = vi.fn();
    render(<InvoiceLinesList lines={[line]} currency="IRR" amountDecimals={0} warehouses={[]} onRemove={onRemove} />);
    const table = screen.getByRole('table');
    expect(table.parentElement?.className).toContain('overflow-x-auto');
    expect(screen.queryByRole('list')).toBeNull();
    fireEvent.click(within(table).getByRole('button', { name: INVOICE_LINES_TEXT.remove }));
    expect(onRemove).toHaveBeenCalledWith(0);
  });

  it('on a phone the lines are cards and no table is built', () => {
    setPhoneScreen(true);
    render(<InvoiceLinesList lines={[line]} currency="IRR" amountDecimals={0} warehouses={[]} onRemove={() => undefined} />);
    expect(screen.queryByRole('table')).toBeNull();
    const card = screen.getByRole('listitem');
    expect(within(card).getByText(TEXT.lineName)).toBeTruthy();
    expect(within(card).getByRole('button', { name: INVOICE_LINES_TEXT.remove }).className).toContain('min-h-[44px]');
  });

  it('an invoice without lines says so instead of an empty table', () => {
    render(<InvoiceLinesList lines={[]} currency="IRR" amountDecimals={0} warehouses={[]} onRemove={() => undefined} />);
    expect(screen.getByText(INVOICE_LINES_TEXT.empty)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('VAT stays optional: unticked, the totals show no VAT row and the rate field is not shown', () => {
    const onApply = vi.fn();
    render(
      <InvoiceTotalsPanel applyVat={false} onApplyVatChange={onApply} vatRate={10} onVatRateChange={() => undefined}
        serviceChargeField={null} gross={2000} discount={100} vatAmount={0} serviceCharge={0} payable={1900} currency="IRR" amountDecimals={0} />
    );
    expect(screen.getByRole('region', { name: TEXT.totals })).toBeTruthy();
    const vat = screen.getByRole('checkbox', { name: TEXT.vat }) as HTMLInputElement;
    expect(vat.checked).toBe(false);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText(TEXT.payable)).toBeTruthy();
    fireEvent.click(vat);
    expect(onApply).toHaveBeenCalledWith(true);
  });

  it('the main button comes first in the bar and the edit badge offers one cancel', () => {
    const onCancel = vi.fn();
    render(<form><InvoiceSubmitBar isEditing refNumber="PF-5" disabled={false} isSaving={false} onCancelEdit={onCancel} /></form>);
    const buttons = screen.getAllByRole('button');
    expect(buttons[0].textContent).toBe(INVOICE_SUBMIT_TEXT.saveEdit);
    expect(buttons[0].getAttribute('type')).toBe('submit');
    expect(screen.getAllByText(INVOICE_SUBMIT_TEXT.cancel)).toHaveLength(1);
    expect(screen.getByText(new RegExp(TEXT.editing))).toBeTruthy();
    fireEvent.click(screen.getByText(INVOICE_SUBMIT_TEXT.cancel));
    expect(onCancel).toHaveBeenCalled();
  });

  it('without a warehouse the warehouse title names the status message and no label points at something that is not a field', () => {
    render(
      <InvoiceHeaderFields status="proforma" onStatusChange={() => undefined} finalDisabled={false} finalOptionNote="" currency="IRR"
        onCurrencyChange={() => undefined} exchangeRate={0} onExchangeRateChange={() => undefined} warehouses={[]} location=""
        onLocationChange={() => undefined} multiWarehouseEdit={false} refNumber="PF-1" date="2026-10-18" onDateChange={() => undefined} />
    );
    expect(screen.getByRole('status', { name: TEXT.warehouse })).toBeTruthy();
    const labelled = Array.from(document.querySelectorAll('label[for]')).map(l => document.getElementById(l.getAttribute('for') ?? ''));
    expect(labelled.every(el => el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)).toBe(true);
  });

  it('the add-line button is a 44px tap target like the phone delete buttons', () => {
    const picker = readFileSync(join(FORM_DIR, 'InvoiceLinePicker.tsx'), 'utf8');
    const button = picker.slice(picker.lastIndexOf('<button', picker.indexOf('INVOICE_LINE_TEXT.add}')), picker.indexOf('INVOICE_LINE_TEXT.add}'));
    expect(INVOICE_LINE_TEXT.add.length).toBeGreaterThan(0);
    expect(button).toContain('min-h-[44px]');
  });
});
