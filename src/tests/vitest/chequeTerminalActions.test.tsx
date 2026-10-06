import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Cheque } from '../../types';

vi.mock('../../hooks/accounting/useChequeQueries', () => ({ useChequeReconciliationReport: () => ({ data: [], loading: false }) }));
vi.mock('../../hooks/useAppCurrency', () => ({ useAppCurrency: () => 'IRR' }));

import { ChequesTab } from '../../components/accounting/ChequesTab';

afterEach(cleanup);

const cheque = (id: number, chequeNumber: string, status: Cheque['status']): Cheque => ({
  id, type: 'received', chequeNumber, bankName: 'Test bank', issueDate: '2026-10-06', dueDate: '2026-10-06',
  amount: 6_000_000, currency: 'IRR', partyName: 'Test party', status,
} as Cheque);

const menuOf = (chequeNumber: string): string[] => {
  const row = screen.getAllByText(chequeNumber)[0].closest('tr');
  if (!row) throw new Error(`no row for cheque ${chequeNumber}`);
  fireEvent.click(row.querySelector('button[title="عملیات بیشتر"]') as HTMLButtonElement);
  const labels = Array.from(row.querySelectorAll('div.absolute button')).map(b => (b.textContent ?? '').trim());
  fireEvent.keyDown(document, { key: 'Escape' });
  return labels;
};

// v9.0.60 (TD-502، B04-06، تصمیم ت۹): چک در وضعیت پایانی (وصول‌شده، عودت‌شده، خرج‌شده) در منوی ردیف «تغییر وضعیت» و
// «حذف» ندارد؛ پیش‌تر منوی چک وصول‌شده هر دو را پیشنهاد می‌داد و سرور رد می‌کرد.
describe('cheque row menu in terminal statuses (TD-502)', () => {
  it('offers status change and delete only while the cheque has a next step', () => {
    render(
      <ChequesTab
        cheques={[cheque(1, '111001', 'passed'), cheque(2, '111002', 'returned'), cheque(3, '111003', 'spent'), cheque(4, '111004', 'received'), cheque(5, '111005', 'bounced')]}
        bankAccounts={[]} customers={[]} personnelList={[]} loading={false} onRefresh={() => undefined}
        onCreateCheque={async () => undefined} onUpdateStatus={async () => undefined} onDeleteCheque={async () => undefined}
      />
    );
    for (const terminal of ['111001', '111002', '111003']) {
      const labels = menuOf(terminal);
      expect(labels).toContain('تاریخچه گردش وضعیت');
      expect(labels).not.toContain('حذف چک');
      expect(labels).not.toContain('تغییر وضعیت چک');
    }
    for (const open of ['111004', '111005']) {
      const labels = menuOf(open);
      expect(labels).toContain('حذف چک');
      expect(labels).toContain('تغییر وضعیت چک');
    }
  });
});
