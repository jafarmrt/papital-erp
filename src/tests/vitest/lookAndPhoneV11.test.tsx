import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { shouldRetryQuery } from '../../lib/queryRetry';
import { defaultTreasuryLedger, defaultTreasuryLedgerCode } from '../../lib/treasury/treasuryLedgerDefault';
import { stepperVisibleSteps } from '../../lib/workflow/stepperStepStatus';
import { ownReservationOf, proformaLineShortages, proformaShortageText } from '../../lib/invoices/proformaLineShortage';
import { addInvoiceLine, type InvoiceDocItem } from '../../lib/invoices/invoiceForm';
import { APP_SCROLL_ATTRIBUTE, scrollAppToTop } from '../../components/layout/appScroll';
import { InvoiceLinesList } from '../../components/invoices/create/InvoiceLinesList';
import type { Item } from '../../types';
import { InventoryAuditHeader } from '../../components/inventory/InventoryAuditHeader';
import { PHONE_WIDTH_QUERY } from '../../lib/pwa/usePhoneWidth';

// v11 phase 6.3b (look and phone, evaluation findings U13-U26): the guards of the pieces that have no page test.

afterEach(() => {
  cleanup();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

function setPhoneScreen(phone: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: phone && query === PHONE_WIDTH_QUERY, media: query, onchange: null,
    addEventListener: () => undefined, removeEventListener: () => undefined,
    addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const ROOT = join(__dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf-8');

describe('phone cards (U14): every cell of a carded list names its column or its role', () => {
  // the tables that carry `phone-cards`, and the row components that render their cells
  const CARDED = [
    'src/components/invoices/list/InvoiceListTable.tsx', 'src/components/invoices/list/InvoiceListRow.tsx',
    'src/components/invoices/list/InvoiceRowSettlementCell.tsx', 'src/components/invoices/list/InvoiceRowNotesCell.tsx',
    'src/components/invoices/list/InvoiceRowActions.tsx', 'src/components/accounting/treasury/TreasuryTransactionsTable.tsx',
    'src/components/accounting/JournalVouchersTab.tsx', 'src/components/items/ItemsTable.tsx',
    'src/components/procurement/ProcurementOrderList.tsx', 'src/components/procurement/RequisitionListPanel.tsx',
    'src/components/procurement/RequisitionRow.tsx', 'src/pages/CustomersPage.tsx',
  ];

  /** the `td` tags of the carded table (or of a row file), leaving out a plain table nested or written beside it */
  function cardedCells(path: string): { line: number; names: string[] }[] {
    const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const hasTable = /<table\b/.test(source.text);
    const cells: { line: number; names: string[] }[] = [];
    const attrsOf = (el: ts.JsxOpeningLikeElement) => el.attributes.properties.flatMap(p => (ts.isJsxAttribute(p) ? [p.name.getText(source)] : []));
    const classOf = (el: ts.JsxOpeningLikeElement) => {
      const cls = el.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(source) === 'className');
      return cls && ts.isJsxAttribute(cls) && cls.initializer ? cls.initializer.getText(source) : '';
    };
    const visit = (node: ts.Node, carded: boolean) => {
      let inside = carded;
      const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
      if (opening) {
        const tag = opening.tagName.getText(source);
        if (tag === 'table') inside = classOf(opening).includes('phone-cards');
        if (tag === 'td' && inside) cells.push({ line: source.getLineAndCharacterOfPosition(opening.getStart()).line + 1, names: attrsOf(opening) });
      }
      ts.forEachChild(node, child => visit(child, inside));
    };
    visit(source, !hasTable);
    return cells;
  }

  it.each(CARDED)('%s', (path) => {
    const cells = cardedCells(path);
    if (/<table\b/.test(read(path))) expect(read(path)).toContain('phone-cards');
    const bare = cells.filter(c => !c.names.some(n => n === 'data-label' || n === 'data-phone' || n === 'colSpan'));
    expect(bare.map(c => c.line)).toEqual([]);
  });

  it('the stylesheet turns a carded row into a card only on a phone', () => {
    const css = read('src/index.css');
    const block = css.slice(css.indexOf('@media (max-width: 639.98px)'));
    expect(block).toContain('table.phone-cards > thead');
    expect(block).toContain('td[data-label]::before');
    expect(block).toContain('td[data-phone="hide"]');
  });
});

describe('the app frame scrolls its page area (U13)', () => {
  it('moves the page area back to the top, and the window outside the frame', () => {
    const area = document.createElement('div');
    area.setAttribute(APP_SCROLL_ATTRIBUTE, '');
    area.scrollTo = vi.fn();
    document.body.appendChild(area);
    scrollAppToTop('auto');
    expect(area.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
    area.remove();
    const windowScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    scrollAppToTop();
    expect(windowScroll).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    windowScroll.mockRestore();
  });

  it('the layout marks the one element that scrolls and fills the visible height', () => {
    const layout = read('src/components/layout/AppLayout.tsx');
    expect(layout).toContain('data-app-scroll');
    expect(layout).toContain('h-dvh');
  });
});

describe('contrast and small text (U15)', () => {
  const SWEPT = [
    'src/components/invoices/list/InvoiceListRow.tsx', 'src/components/accounting/treasury/TreasuryTransactionsTable.tsx',
    'src/components/accounting/JournalVouchersTab.tsx', 'src/components/items/ItemsTable.tsx', 'src/pages/CustomersPage.tsx',
  ];
  it.each(SWEPT)('%s has no grey-400 text on white and no text under 11px', (path) => {
    const text = read(path);
    expect(text).not.toMatch(/(?<![:\w-])text-slate-400(?![\w/])/);
    expect(text).not.toMatch(/text-\[(?:8|9|10)px\]/);
  });
});

describe('a refused read is shown at once (U20)', () => {
  it('does not retry a client error, a sign-in or a permission refusal', () => {
    expect(shouldRetryQuery(0, { status: 404 })).toBe(false);
    expect(shouldRetryQuery(0, { status: 422, message: 'حساب شما به پرونده پرسنلی وصل نیست' })).toBe(false);
    expect(shouldRetryQuery(0, { code: 'UNAUTHORIZED' })).toBe(false);
    expect(shouldRetryQuery(0, { message: 'HTTP 403' })).toBe(false);
  });

  it('retries a server or network failure, a timeout and too many requests, three times', () => {
    expect(shouldRetryQuery(0, { status: 500 })).toBe(true);
    expect(shouldRetryQuery(2, new Error('Failed to fetch'))).toBe(true);
    expect(shouldRetryQuery(3, { status: 503 })).toBe(false);
    expect(shouldRetryQuery(1, { status: 408 })).toBe(true);
    expect(shouldRetryQuery(1, { status: 429 })).toBe(true);
  });
});

describe('the default ledger of a new treasury account (U19)', () => {
  it('names the standard subsidiary of each kind and currency', () => {
    expect(defaultTreasuryLedgerCode('bank', 'IRR')).toBe('1003');
    expect(defaultTreasuryLedgerCode('bank', 'USD')).toBe('1004');
    expect(defaultTreasuryLedgerCode('cash', 'IRR')).toBe('1001');
    expect(defaultTreasuryLedgerCode('cash', 'EUR')).toBe('1002');
    expect(defaultTreasuryLedgerCode('pos', 'IRR')).toBe('1005');
    expect(defaultTreasuryLedgerCode('petty_cash', 'IRR')).toBe('1006');
  });

  it('picks only a live account with that code', () => {
    const accounts = [
      { id: 1, code: '1003', isDeleted: 1 },
      { id: 2, code: '1003', isActive: 0 },
      { id: 3, code: '1003' },
      { id: 4, code: '1001' },
    ];
    expect(defaultTreasuryLedger(accounts, 'bank', 'IRR')?.id).toBe(3);
    expect(defaultTreasuryLedger(accounts.slice(0, 2), 'bank', 'IRR')).toBeNull();
    expect(defaultTreasuryLedger(accounts, 'pos', 'IRR')).toBeNull();
  });
});

describe('the workflow line shows an exit end only when reached (U22)', () => {
  const steps = [
    { id: 1, stepOrder: 1, stateType: 'initial', stateKey: 'draft' },
    { id: 2, stepOrder: 2, stateType: 'normal', stateKey: 'review' },
    { id: 3, stepOrder: 3, stateType: 'terminal', stateKey: 'approved' },
    { id: 4, stepOrder: 4, stateType: 'terminal', stateKey: 'rejected' },
    { id: 5, stepOrder: 5, stateType: 'terminal', stateKey: 'canceled' },
  ];
  const ids = (list: { id: number }[]) => list.map(s => s.id);

  it('hides the rejection and cancel ends of a process on its way', () => {
    expect(ids(stepperVisibleSteps(steps, steps[1], [{ fromStateId: 1, toStateId: 2 }]))).toEqual([1, 2, 3]);
  });

  it('shows the end the process reached', () => {
    expect(ids(stepperVisibleSteps(steps, steps[3], [{ fromStateId: 2, toStateId: 4 }]))).toEqual([1, 2, 3, 4]);
    expect(ids(stepperVisibleSteps(steps, steps[0], [{ fromStateId: 2, toStateId: 5 }, { fromStateId: 5, toStateId: 1 }]))).toEqual([1, 2, 3, 5]);
  });

  it('keeps the first end in order as the way through when no end carries those keys', () => {
    const plain = steps.map(s => ({ ...s, stateKey: `s${s.id}` }));
    expect(ids(stepperVisibleSteps(plain, plain[1], []))).toEqual([1, 2, 3]);
  });
});

describe('a proforma line above the sellable stock says so (U26)', () => {
  const item = (stock: Partial<Record<'current_stock' | 'reserved_stock' | 'stock_W1', number>>): Item =>
    ({ id: 9, code: 'K-9', name: 'ورق', unit: 'عدد', ...stock }) as unknown as Item;
  const line = (it: Item, quantity: number): InvoiceDocItem => ({ item: it, quantity, unitPrice: 100, discount: 0 });
  const proforma = { docType: 'invoice', status: 'proforma', headerLocation: 'W1' };

  it('flags a proforma line above what its warehouse can sell, and nothing on a final invoice', () => {
    const lines = [line(item({ current_stock: 5, reserved_stock: 2, stock_W1: 5 }), 10)];
    expect(proformaLineShortages(lines, proforma, new Map())).toEqual([{ requested: 10, sellable: 3 }]);
    expect(proformaLineShortages(lines, { ...proforma, status: 'final' }, new Map())).toEqual([null]);
    expect(proformaLineShortages([line(item({ current_stock: 5, stock_W1: 5 }), 5)], proforma, new Map())).toEqual([null]);
  });

  it('leaves a line read back from a stored proforma to the save warning', () => {
    expect(proformaLineShortages([line(item({}), 10)], proforma, new Map())).toEqual([null]);
  });

  it('does not count the edited proforma\'s own reservation against it', () => {
    const lines = [line(item({ current_stock: 5, reserved_stock: 4, stock_W1: 5 }), 4)];
    expect(proformaLineShortages(lines, proforma, new Map())).toEqual([{ requested: 4, sellable: 1 }]);
    expect(proformaLineShortages(lines, proforma, ownReservationOf(lines))).toEqual([null]);
  });

  it('a line added again takes the picker\'s stock figures', () => {
    const stored = line(item({}), 2);
    const merged = addInvoiceLine([stored], line(item({ current_stock: 3, stock_W1: 3 }), 2), 'W1');
    expect(merged).toHaveLength(1);
    expect(merged[0].quantity).toBe(4);
    expect(proformaLineShortages(merged, proforma, new Map())).toEqual([{ requested: 4, sellable: 3 }]);
  });

  it('the line table shows the note on the short line', () => {
    const lines = [line(item({ current_stock: 3, stock_W1: 3 }), 10)];
    render(<InvoiceLinesList lines={lines} currency="IRR" amountDecimals={0} warehouses={[]} onRemove={() => undefined}
      shortages={[{ requested: 10, sellable: 3 }]} />);
    expect(screen.getByTestId('line-stock-shortage').textContent).toBe(proformaShortageText({ requested: 10, sellable: 3 }, 'عدد'));
    expect(proformaShortageText({ requested: 10, sellable: 3 }, 'عدد')).toContain('قابل فروش ۳ عدد');
  });
});

describe('the count screen on a phone leads with counting (U24 follow-up)', () => {
  const TRANSFER = 'ثبت حواله انتقال انبار';
  const TOOLS = 'ابزارهای موجودی';
  const header = (onOpenTransfer = vi.fn()) => (
    <InventoryAuditHeader activeTab="new_audit" onTabChange={() => undefined} discrepancyItems={0}
      onOpenRebuild={() => undefined} onOpenTransfer={onOpenTransfer} />
  );

  it('puts the transfer in the tools menu on a phone', async () => {
    setPhoneScreen(true);
    const onOpenTransfer = vi.fn();
    render(header(onOpenTransfer));
    expect(screen.queryByText(TRANSFER)).toBeNull();
    const trigger = screen.getByTitle(TOOLS);
    expect(trigger.className).toContain('max-sm:min-h-11');
    await act(async () => { fireEvent.click(trigger); });
    await act(async () => { fireEvent.click(screen.getByText(TRANSFER)); });
    expect(onOpenTransfer).toHaveBeenCalledTimes(1);
  });

  it('keeps the transfer button on a wide screen', () => {
    setPhoneScreen(false);
    render(header());
    expect(screen.getByText(TRANSFER).closest('button')).toBeTruthy();
  });
});

describe('the links of the seeded notification rules open a page', () => {
  it('seeds the products and approval inbox links, and the old links lead there', () => {
    const seed = read('src/services/events/eventActionEngineService.ts');
    expect(seed).not.toMatch(/linkTemplate: '\/(items|workflow-inbox)'/);
    const routes = read('src/components/AppRoutes.tsx');
    expect(routes).toContain('<Route path="/items" element={<Navigate to="/products" replace />} />');
    expect(routes).toContain('<Route path="/workflow-inbox" element={<Navigate to="/approval-inbox" replace />} />');
  });
});
