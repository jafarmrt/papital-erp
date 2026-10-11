import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DocItemsTable } from '../../components/documents/DocItemsTable';
import { StockSubmitBar } from '../../components/documents/stock/StockSubmitBar';
import { STOCK_VOUCHER_DRAFT_NOTE, stockInLabels } from '../../lib/documents/stockInLabels';
import type { Item } from '../../types';

// v10.0.239 (TD-1205, finding B-04): a sales return on the stock page is labelled as a return (customer, sale price,
// return summary and button), never as a purchase receipt; v10.0.240 (TD-1206, finding B-06): the voucher note names
// the approving permission, never the accountant role

const PURCHASE_SUBMIT = 'ثبت نهایی و صدور سند رسید خرید';
const RETURN_SUBMIT = 'ثبت نهایی و صدور سند برگشت از فروش';
const PURCHASE_SUMMARY = 'خلاصه رسید خرید مواد اولیه و کالا';
const PURCHASE_PRICE = 'قیمت خرید واحد (فی)';
const ACCOUNTANT_CLAIM = /تأیید حسابدار/;

const item = { id: 1, code: 'NK-1', name: 'گردنبند نقره', unit: 'عدد', current_stock: 12 } as Item;

function renderTable(docType?: string) {
  return render(
    <DocItemsTable
      actionType="in"
      docType={docType}
      docItems={[{ item, quantity: 2, unitPrice: 1000 }]}
      currencyLabel="IRR"
      totalSum={2000}
      getItemReservationSummary={() => ({ reservedForOtherProjects: 0, reservedForSelectedProject: 0, maxAllowedForExit: 12, matchingReservations: [] })}
      onUpdateItemQty={() => undefined}
      onUpdateItemPrice={() => undefined}
      onRemove={() => undefined}
    />,
  );
}

afterEach(cleanup);

describe('sales return labels on the stock page (TD-1205)', () => {
  it('labels a return with the customer, the sale price and a return summary', () => {
    renderTable('return');
    expect(screen.getByText(stockInLabels('return').unitPrice)).toBeTruthy();
    expect(screen.getByText(stockInLabels('return').summaryTitle)).toBeTruthy();
    expect(screen.queryByText(PURCHASE_PRICE)).toBeNull();
    expect(screen.queryByText(PURCHASE_SUMMARY)).toBeNull();
    expect(stockInLabels('return').party).not.toMatch(/تامین|تأمین/);
  });

  it('keeps the purchase receipt labels for a receipt', () => {
    renderTable('receipt');
    expect(screen.getByText(PURCHASE_PRICE)).toBeTruthy();
    expect(screen.getByText(PURCHASE_SUMMARY)).toBeTruthy();
  });

  it('the submit button of a return issues a return, not a purchase receipt', () => {
    render(<StockSubmitBar actionType="in" docType="return" itemCount={1} totalQuantitySum={2} disabled={false} isSaving={false} />);
    expect(screen.getByText(RETURN_SUBMIT)).toBeTruthy();
    expect(screen.queryByText(PURCHASE_SUBMIT)).toBeNull();
  });
});

describe('stock voucher draft note (TD-1206)', () => {
  it('names the approving permission, never the accountant', () => {
    renderTable('receipt');
    expect(STOCK_VOUCHER_DRAFT_NOTE).not.toMatch(ACCOUNTANT_CLAIM);
    expect(STOCK_VOUCHER_DRAFT_NOTE).toContain('تأیید و قطعی کردن سند حسابداری');
    expect(screen.getByText(new RegExp(STOCK_VOUCHER_DRAFT_NOTE))).toBeTruthy();
    expect(screen.queryByText(ACCOUNTANT_CLAIM)).toBeNull();
  });
});
