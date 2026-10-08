import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { DocItemsTable } from '../../components/documents/DocItemsTable';
import { reservationSourceLabel } from '../../hooks/documents/stockDocumentItemActions';
import type { Item } from '../../types';

// v9.0.346 (TD-803, finding B08-34): Persian text of the sales and stock document UI has no transliteration from the
// review table, no English word, numbers inside messages in Persian digits, and the receipt summary says what the page does

const ROOT = join(__dirname, '..', '..');
const PERSIAN = /[؀-ۿ]/;
const DOCUMENT_UI = [
  'pages/CreateInvoicePage.tsx', 'pages/DocumentsPage.tsx', 'pages/InvoicesListPage.tsx', 'components/InvoicePrintView.tsx',
  'components/invoices/', 'components/documents/', 'hooks/documents/', 'hooks/invoices/', 'lib/invoices/',
];
/** the replacement table of the package 8 front-end review (§7): سامانه، رزروشده، شماره عطف، شرط‌های جستجو، گردش کار، خودکار، پایگاه داده، فهرست */
const REPLACED = /سیستم|فریز|رفرنس|فیلتر|ورکفلو|اتومات|سرور|ترنزیشن|دیتابیس|لیست/;
/** a Latin word (letters, then letters or digits, such as «A4») inside Persian text */
const LATIN_WORD = /(?<![\w.-])[A-Za-z][A-Za-z0-9]+/g;
/** quantities the stock and invoice messages print; each goes through formatPersianNumber */
const RAW_NUMBER = /(?:\$\{|\{)\s*(?:[\w.]+\.)?(?:loc|reserved|sellable|total|totalRequestedQty|maxAllowedForExit|reservedForOtherProjects|reservedForSelectedProject|locationStock|quantity|releasedQty|reservedQty|current_stock|length|vatRate|totalReservedItemsCount)\s*\}/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** a source line without comments */
function codeLine(raw: string): string {
  const line = raw.trim();
  if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*') || line.startsWith('{/*')) return '';
  return line.replace(/\s\/\/\s.*$/, '').replace(/\{\/\*.*?\*\/\}/g, '');
}

/** the Persian pieces of a line: text between quotes, JSX tags and braces, with template expressions and HTML entities removed */
function persianPieces(line: string): string[] {
  let text = line.replace(/&[a-z]+;/g, ' ');
  while (/\$\{[^{}]*\}/.test(text)) text = text.replace(/\$\{[^{}]*\}/g, ' ');
  return text.split(/['"`<>{}]/).filter(piece => PERSIAN.test(piece));
}

const files = sourceFiles(ROOT).filter(f => DOCUMENT_UI.some(p => relative(ROOT, f).replace(/\\/g, '/').startsWith(p)));
const lines = files.flatMap(file => readFileSync(file, 'utf8').split('\n').map((raw, i) => ({
  where: `${relative(ROOT, file)}:${i + 1}`,
  code: codeLine(raw),
}))).filter(l => PERSIAN.test(l.code));

const item = (over: Partial<Item>): Item => ({ id: 1, code: 'NK-1', name: 'گردنبند نقره', unit: 'عدد', current_stock: 12, ...over } as Item);

afterEach(cleanup);

describe('sales and stock document UI wording (TD-803)', () => {
  it('reads the document UI files', () => {
    expect(files.length).toBeGreaterThan(40);
    expect(lines.length).toBeGreaterThan(300);
  });

  it('uses the Persian words of the review table, never the transliterations', () => {
    const found = lines.filter(l => REPLACED.test(l.code)).map(l => `${l.where}: ${l.code}`);
    expect(found).toEqual([]);
  });

  it('has no English word inside Persian text', () => {
    const found = lines.flatMap(l => persianPieces(l.code)
      .flatMap(piece => piece.match(LATIN_WORD) ?? [])
      .map(word => `${l.where}: ${word}`));
    expect(found).toEqual([]);
  });

  it('prints message quantities in Persian digits', () => {
    const found = lines.filter(l => RAW_NUMBER.test(l.code)).map(l => `${l.where}: ${l.code}`);
    expect(found).toEqual([]);
    expect(reservationSourceLabel({ sourceType: 'project', projectCode: 'PRJ-7', projectTitle: 'پروژه آزمایشی', itemCode: 'NK-1', itemName: 'گردنبند', reservedQty: 4, unit: 'عدد' })).toBe('پروژه «PRJ-7» (۴ عدد)');
    expect(reservationSourceLabel({ sourceType: 'proforma', projectCode: 'PF-12', projectTitle: '', itemCode: 'NK-1', itemName: 'گردنبند', reservedQty: 1.5, unit: 'متر' })).toBe('پیش‌فاکتور «PF-12» (۱٫۵ متر)');
  });

  it('the receipt summary says stock changes on the final save and the voucher stays a draft', () => {
    render(
      <DocItemsTable
        actionType="in"
        docItems={[{ item: item({}), quantity: 2, unitPrice: 1000 }]}
        currencyLabel="USD"
        totalSum={2000}
        getItemReservationSummary={() => ({ reservedForOtherProjects: 0, reservedForSelectedProject: 0, maxAllowedForExit: 12, matchingReservations: [] })}
        onUpdateItemQty={() => undefined}
        onUpdateItemPrice={() => undefined}
        onRemove={() => undefined}
      />,
    );
    expect(screen.getByText('موجودی با ثبت نهایی به‌روزرسانی می‌شود؛ سند حسابداری تا تأیید حسابدار پیش‌نویس است.')).toBeTruthy();
    expect(screen.getByText('موجودی: ۱۲ عدد')).toBeTruthy();
    expect(screen.getByText('مبلغ کل ردیف (دلار)')).toBeTruthy();
    expect(screen.queryByText(/ورکفلو|مدیر مالی/)).toBeNull();
  });
});
