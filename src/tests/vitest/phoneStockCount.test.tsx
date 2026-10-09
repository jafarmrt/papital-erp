import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen, within } from '@testing-library/react';
import { PhysicalAuditSheetTab } from '../../components/inventory/PhysicalAuditSheetTab';
import { auditCountError, summarizeAudit, type AuditSheetItem } from '../../lib/inventoryAudit/auditSheet';
import { OFFLINE_SUBMIT_TITLE, PHONE_TAP_TARGET } from '../../lib/pwa/phoneLayout';
import { PHONE_WIDTH_QUERY } from '../../lib/pwa/usePhoneWidth';

// v10.0.19 (D-11, plan MOBILE_WORKSHOP_PLAN.md section 3.2): the stock count on a phone. One item per card below 768 px,
// the count field opens the decimal keypad and takes Persian digits (a number input dropped them), a Persian count is
// summed as its number (it used to count as zero), an invalid count blocks the save instead of counting as zero, and the
// save waits for the connection.

vi.mock('../../hooks/inventoryAudit/useInventoryAuditSave', () => ({
  useInventoryAuditSave: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { useAuditSheet } = await import('../../hooks/inventoryAudit/useAuditSheet');

const PERSIAN_TWELVE = '۱۲';
const ITEM_NAME = 'مهره کریستالی';

function sheetItem(physical: string): AuditSheetItem {
  return { id: 7, code: 'RM-7', name: ITEM_NAME, category: 'مهره', unit: 'عدد', system_stock_computed: 10, physical_stock: physical };
}

function renderTab(physical: string, onSubmit = vi.fn()) {
  const item = sheetItem(physical);
  const audited = physical.trim() === '' ? {} : { [item.id]: item };
  render(
    <PhysicalAuditSheetTab
      selectedLocation="A"
      locationLabel="انبار اصلی"
      warehouses={[{ id: 1, code: 'A', name: 'انبار اصلی' } as never]}
      warehousesFailed={false}
      onRequestLocationChange={() => undefined}
      nextRef="AUD-1"
      notes=""
      setNotes={() => undefined}
      searchQuery=""
      setSearchQuery={() => undefined}
      categoryFilter="all"
      setCategoryFilter={() => undefined}
      categories={['مهره']}
      filteredItems={[item]}
      auditedItemsMap={audited}
      submitting={false}
      errorMsg={null}
      successMsg={null}
      handlePhysicalChange={() => undefined}
      handleApplyCurrentStockAsPhysical={() => undefined}
      handleSubmitAudit={onSubmit}
    />,
  );
}

/** a phone-width screen: matchMedia answers the phone query */
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
  act(() => { window.dispatchEvent(new Event('online')); });
});

describe('stock count on a phone (D-11)', () => {
  it('reads Persian digits and refuses text and negative counts', () => {
    expect(auditCountError('')).toBeNull();
    expect(auditCountError(PERSIAN_TWELVE)).toBeNull();
    expect(auditCountError('۱۲٫۵')).toBeNull();
    expect(auditCountError('abc')).not.toBeNull();
    expect(auditCountError('-3')).not.toBeNull();
  });

  it('sums a Persian count as its number, not as zero', () => {
    const summary = summarizeAudit([sheetItem(PERSIAN_TWELVE)]);
    expect(summary.surplus).toBe(1);
    expect(summary.surplusQty).toBe(2);
  });

  it('keeps a Persian count in the field and opens the decimal keypad, on a phone and a computer', () => {
    for (const phone of [true, false]) {
      setPhoneScreen(phone);
      renderTab(PERSIAN_TWELVE);
      const input = screen.getByRole<HTMLInputElement>('textbox', { name: `شمار ${ITEM_NAME}` });
      expect(input.value).toBe(PERSIAN_TWELVE);
      expect(input.getAttribute('inputmode')).toBe('decimal');
      cleanup();
    }
  });

  it('shows one card per item on a phone and the table on a computer', () => {
    setPhoneScreen(true);
    renderTab('');
    const list = screen.getByRole('list', { name: 'کالاهای شمارش' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).getByText(ITEM_NAME)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    cleanup();
    setPhoneScreen(false);
    renderTab('');
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'کالاهای شمارش' })).toBeNull();
  });

  it('does not save while offline or while a count is not a number', () => {
    setPhoneScreen(true);
    renderTab(PERSIAN_TWELVE);
    const submit = () => screen.getAllByRole<HTMLButtonElement>('button', { name: /ثبت نهایی سند انبارگردانی/ });
    for (const button of submit()) {
      expect(button.disabled).toBe(false);
      expect(button.getAttribute('class')).toContain(PHONE_TAP_TARGET);
    }
    act(() => { window.dispatchEvent(new Event('offline')); });
    for (const button of submit()) {
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('title')).toBe(OFFLINE_SUBMIT_TITLE);
    }
    cleanup();
    renderTab('abc');
    for (const button of submit()) expect(button.disabled).toBe(true);
    expect(screen.getAllByText('شمار باید عدد باشد.').length).toBeGreaterThan(0);
  });

  it('refuses to open the save summary with an invalid count', () => {
    const { result } = renderHook(() => useAuditSheet({
      serverItems: [sheetItem('')], selectedLocation: 'A', locationLabel: 'انبار اصلی', nextRef: 'AUD-1',
      user: null, onLocationChange: () => undefined, reloadItems: () => undefined,
    }));
    act(() => { result.current.handlePhysicalChange(7, 'abc'); });
    act(() => { result.current.handleSubmitAudit(); });
    expect(result.current.pendingAuditSummary).toBeNull();
    expect(result.current.errorMsg).toContain(ITEM_NAME);
  });
});
