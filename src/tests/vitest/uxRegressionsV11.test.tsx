/**
 * v11 phase 6.3a: user-interface regressions found by the phase 2 evaluation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DialogLayer } from '../../components/common/DialogLayer';
import { JalaliDateInput } from '../../components/common/JalaliDateInput';
import { NotFoundPage } from '../../components/NotFoundPage';
import { RequisitionRow } from '../../components/procurement/RequisitionRow';
import { requisitionActionsWithoutInstance } from '../../lib/procurement/requisitionActions';
import type { PurchaseRequisition } from '../../types';
import type { ProcurementAccess } from '../../hooks/procurement/useProcurementAccess';
import { InventoryAuditHeader } from '../../components/inventory/InventoryAuditHeader';
import { persianRequired } from '../../lib/ui/persianRequired';

vi.mock('../../contexts/AuthContext', () => ({ useHasAnyPermission: () => true, useHasPermission: () => true }));

vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await vi.importActual<typeof import('../../lib/rialDisplay')>('../../lib/rialDisplay');
  return { useAppCurrency: () => 'IRR', useRialDisplay: () => rialDisplayOf('IRR') };
});

const TITLE = 'پروژهٔ جدید';
const DATE_LABEL = 'تاریخ پایان';
const NOT_FOUND = 'این صفحه پیدا نشد';
const BACK_HOME = 'بازگشت به پیشخوان';
const HOME = 'پیشخوان آزمون';
const SPLIT = 'تفکیک و صدور فاکتور';
const COUNT_TAB = 'شمارش و ثبت انبارگردانی';
const REBUILD = 'بازسازی موجودی از روی کاردکس';
const STOCK_TOOLS = 'ابزارهای موجودی';
const USERNAME = 'نام کاربری';
const SPLIT_REASON = /کس دیگری با حق تأیید باید آن را تأیید کند/;

describe('v11 phase 6.3a (U11): Esc in the date calendar closes only the calendar', () => {
  afterEach(cleanup);

  it('the first Esc closes the open calendar and keeps the window, the next one closes the window', async () => {
    const onClose = vi.fn();
    render(
      <div role="dialog" aria-modal="true" aria-label={TITLE}>
        <DialogLayer onClose={onClose} />
        <label htmlFor="end">{DATE_LABEL}</label>
        <JalaliDateInput id="end" value="" onChange={() => undefined} />
      </div>,
    );
    const input = screen.getByLabelText(DATE_LABEL);
    await act(async () => { fireEvent.focus(input); fireEvent.click(input); });
    expect(document.querySelector('.rmdp-calendar')).not.toBeNull();
    await act(async () => { fireEvent.keyDown(input, { key: 'Escape' }); });
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector('.rmdp-calendar')).toBeNull();
    await act(async () => { fireEvent.keyDown(input, { key: 'Escape' }); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('v11 phase 6.3a (U12): an unknown address, /login and /setup never show an empty page', () => {
  afterEach(cleanup);

  it('an unknown address shows the not-found page with a way back; /login and /setup lead to the dashboard', async () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/components/AppRoutes.tsx'), 'utf8');
    expect(source).toMatch(/<Route path="\/login" element=\{<Navigate to="\/" replace \/>\} \/>/);
    expect(source).toMatch(/<Route path="\/setup" element=\{<Navigate to="\/" replace \/>\} \/>/);
    expect(source).toMatch(/<Route path="\*" element=\{<NotFoundPage \/>\} \/>/);
    render(
      <MemoryRouter initialEntries={['/no-such-page']}>
        <Routes>
          <Route path="/" element={<p>{HOME}</p>} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText(NOT_FOUND)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByText(BACK_HOME)); });
    expect(screen.getByText(HOME)).toBeTruthy();
  });
});

describe('v11 phase 6.3a (U10): the initiator sees the split button off with the reason', () => {
  afterEach(cleanup);

  const open: PurchaseRequisition = {
    id: 6, code: 'PR-1405-0006', title: 'open requisition', status: 'pending', priority: 'normal', notes: '', totalEstimatedAmount: 3000,
    items: [{ id: 'r2', itemId: 9, itemCode: 'RM-9', itemName: 'item', unit: 'unit', requestedQty: 3, orderedQty: 0, remainingQty: 3, unitPriceEstimate: 1000, linkedDocumentIds: [] }],
  };
  const access: ProcurementAccess = { canCreate: true, canManage: false, canOrder: true, canApprove: true, canReopen: false, canRunWorkflowAction: true, canDeliver: false };
  const row = (req: PurchaseRequisition, onSplit: () => void) => render(
    <table><tbody>
      <RequisitionRow req={req} access={access} isSelected={false} onToggleSelect={() => undefined} onView={() => undefined}
        onSplit={onSplit} onDelete={() => undefined} onShowOrders={() => undefined} />
    </tbody></table>,
  );

  it('a requisition the list marks keeps the button visible but off, and says why', () => {
    const onSplit = vi.fn();
    row({ ...open, initiatorCannotApprove: true }, onSplit);
    const button = screen.getByText(SPLIT).closest('button');
    expect(button?.disabled).toBe(true);
    expect(screen.getByText(SPLIT_REASON)).toBeTruthy();
    expect(button?.getAttribute('aria-describedby')).toBe('split-blocked-6');
    fireEvent.click(button as HTMLButtonElement);
    expect(onSplit).not.toHaveBeenCalled();
  });

  it('a requisition without a workflow offers its marked requester only the reject action in the detail window', () => {
    expect(requisitionActionsWithoutInstance('pending', true, true).map(a => a.actionKey)).toEqual(['reject_request']);
    expect(requisitionActionsWithoutInstance('pending', true).map(a => a.actionKey)).toEqual(['approve_request', 'reject_request']);
  });

  it('an unmarked requisition opens the split form as before', () => {
    const onSplit = vi.fn();
    row(open, onSplit);
    const button = screen.getByText(SPLIT).closest('button');
    expect(button?.disabled).toBe(false);
    expect(screen.queryByText(SPLIT_REASON)).toBeNull();
    fireEvent.click(button as HTMLButtonElement);
    expect(onSplit).toHaveBeenCalledTimes(1);
  });
});

describe('v11 phase 6.3a (U24): the count screen leads with counting, the rebuild sits in the three-dot menu', () => {
  afterEach(cleanup);

  it('the count tab comes first, the tabs wrap, and the rebuild shows only after the menu opens', async () => {
    const onOpenRebuild = vi.fn();
    render(<InventoryAuditHeader activeTab="new_audit" onTabChange={() => undefined} discrepancyItems={0} onOpenRebuild={onOpenRebuild} />);
    const tabs = screen.getByText(COUNT_TAB).closest('button')?.parentElement;
    expect(tabs?.querySelector('button')?.textContent).toContain(COUNT_TAB);
    expect(tabs?.className).toContain('flex-wrap');
    expect(screen.queryByText(REBUILD)).toBeNull();
    await act(async () => { fireEvent.click(screen.getByTitle(STOCK_TOOLS)); });
    await act(async () => { fireEvent.click(screen.getByText(REBUILD)); });
    expect(onOpenRebuild).toHaveBeenCalledTimes(1);
  });
});

describe('v11 phase 6.3a (U25): login and setup fields fill themselves and complain in Persian', () => {
  afterEach(cleanup);

  it('an empty required field says so in Persian, and typing clears it', () => {
    render(<form><input aria-label={USERNAME} {...persianRequired(USERNAME)} /></form>);
    const input = screen.getByLabelText(USERNAME) as HTMLInputElement;
    expect(input.checkValidity()).toBe(false);
    expect(input.validationMessage).toBe(`${USERNAME} را وارد کنید.`);
    fireEvent.input(input, { target: { value: 'admin' } });
    expect(input.checkValidity()).toBe(true);
  });

  it('a value filled without an input event, or set by the page, never stays refused', () => {
    render(<form><input aria-label={USERNAME} {...persianRequired(USERNAME)} /></form>);
    const input = screen.getByLabelText(USERNAME) as HTMLInputElement;
    expect(input.checkValidity()).toBe(false);
    // a password manager that fires only `change`
    fireEvent.change(input, { target: { value: 'admin' } });
    expect(input.checkValidity()).toBe(true);
    // a stale message on a filled field is dropped by the next check
    input.setCustomValidity(`${USERNAME} را وارد کنید.`);
    expect(input.checkValidity()).toBe(false);
    expect(input.checkValidity()).toBe(true);
  });

  it('the login and setup fields carry autocomplete hints and no bare required', () => {
    const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
    const login = read('src/pages/LoginPage.tsx');
    const setup = read('src/pages/SetupPage.tsx');
    expect(login).toContain('autoComplete="username"');
    expect(login).toContain('autoComplete="current-password"');
    expect(setup.match(/autoComplete="new-password"/g)).toHaveLength(2);
    for (const source of [login, setup]) expect(source).not.toMatch(/^\s*required\s*$/m);
  });
});
