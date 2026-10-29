import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithQuery } from './helpers/queryWrapper';

/**
 * v11 (owner request 7 Aban 1405): the amount boxes moved to the shared number field send an empty value for a wrong
 * entry («۱۲٬۵», a misplaced thousands separator). Each save that is not a natively validated form refuses it before
 * anything is sent, instead of saving 0 or the suggested amount; the same save goes through once the entry is right.
 */
const SHOWN = {
  misplaced: '۱۲٬۵',
  right: '۱۲٬۵۰۰',
  eidiYearlyCap: 'سقف سالانه عیدی هر نفر (ریال)',
  eidiPercent: 'درصد عیدی از کارکرد و حقوق ثابت هر فیش',
  saveEidi: /ذخیره روش عیدی سال/,
  eidiAmount: 'مبلغ عیدی (ریال؛ خالی یعنی مبلغ پیشنهادی)',
  eidiReason: 'شرح مبلغ دستی *',
  pickPersonnel: 'جست‌وجو و انتخاب پرسنل...',
  personnel: 'سارا',
  issueEidi: 'صدور فیش عیدی',
  customRate: 'نرخ اختصاصی برش',
  saveRate: 'ثبت نرخ',
  requisitionTitle: 'مثلاً: خرید ورق‌های برنجی و مهره‌های فلزی طرح بهار',
  itemName: 'نام کالا',
  priceEstimate: 'برآورد قیمت واحد ردیف ۱',
} as const;

const fetchJson = vi.hoisted(() => vi.fn());
vi.mock('../../api', () => ({ API_URL: '/api', fetchJson: (...args: unknown[]) => fetchJson(...args), isAbortError: () => false }));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ userPermissions: { permissions: [], isAdmin: true } }),
  useHasPermission: () => true,
}));
vi.mock('../../lib/pwa/useOnlineStatus', () => ({ useOnlineStatus: () => true }));

const { PayrollEidiRatesSection } = await import('../../components/settings/PayrollEidiRatesSection');
const { PayrollEidiModal } = await import('../../components/piecework/PayrollEidiModal');
const { PieceworkRatesTab } = await import('../../components/piecework/PieceworkRatesTab');
const { CreateRequisitionModal } = await import('../../components/procurement/CreateRequisitionModal');

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

const writes = (url: string) => fetchJson.mock.calls.filter(([u, opts]) => String(u).startsWith(url) && (opts as { method?: string } | undefined)?.method);
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

describe('a wrong amount is refused before it is saved', () => {
  it('the eidi rates are not saved with a misplaced separator in the yearly cap', async () => {
    fetchJson.mockImplementation(async (_url: string, opts?: { method?: string; body?: string }) => (opts?.method ? { ...JSON.parse(opts.body ?? '{}'), version: 1 } : []));
    renderWithQuery(<PayrollEidiRatesSection />);
    await waitFor(() => expect(field(SHOWN.eidiPercent).matches(':disabled')).toBe(false));
    fireEvent.change(field(SHOWN.eidiPercent), { target: { value: '8' } });
    fireEvent.change(field(SHOWN.eidiYearlyCap), { target: { value: SHOWN.misplaced } });
    // the field says what is wrong; the save refuses it (and the rates check refuses the empty cap as well)
    expect(field(SHOWN.eidiYearlyCap).validity.valid).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: SHOWN.saveEidi }));
    expect(writes('/piecework/eidi-rates')).toHaveLength(0);
    fireEvent.change(field(SHOWN.eidiYearlyCap), { target: { value: SHOWN.right } });
    fireEvent.click(screen.getByRole('button', { name: SHOWN.saveEidi }));
    await waitFor(() => expect(writes('/piecework/eidi-rates')).toHaveLength(1));
    expect(JSON.parse(String((writes('/piecework/eidi-rates')[0][1] as { body: string }).body)).yearlyCap).toBe('12500');
  });

  it('the eidi payslip is not issued with the suggested amount when the typed amount is wrong', async () => {
    fetchJson.mockImplementation(async (url: string, opts?: { method?: string }) => {
      if (opts?.method) return { payrollNumber: 'EP-1' };
      if (String(url).startsWith('/piecework/eidi-preview')) {
        return {
          fullName: SHOWN.personnel, period: { startIso: '2026-03-21', endIso: '2027-03-20', workedDays: 365 }, eidiCovered: true, draftWarning: null,
          suggestion: { method: 'fixed_amount', entitlement: '30000', remainingAccrual: '0', amount: '30000' },
        };
      }
      return [];
    });
    renderWithQuery(<PayrollEidiModal personnelSelectOptions={[{ value: '7', label: SHOWN.personnel }]} onClose={() => undefined} onIssued={() => undefined} />);
    fireEvent.click(screen.getByText(SHOWN.pickPersonnel));
    fireEvent.click(await screen.findByText(SHOWN.personnel));
    const issue = await screen.findByRole('button', { name: SHOWN.issueEidi });
    await waitFor(() => expect((issue as HTMLButtonElement).disabled).toBe(false));
    fireEvent.change(field(SHOWN.eidiAmount), { target: { value: SHOWN.misplaced } });
    fireEvent.click(issue);
    expect(writes('/piecework/eidi-payslips')).toHaveLength(0);
    fireEvent.change(field(SHOWN.eidiAmount), { target: { value: SHOWN.right } });
    fireEvent.change(field(SHOWN.eidiReason), { target: { value: 'x' } });
    fireEvent.click(issue);
    await waitFor(() => expect(writes('/piecework/eidi-payslips')).toHaveLength(1));
    expect(JSON.parse(String((writes('/piecework/eidi-payslips')[0][1] as { body: string }).body)).amount).toBe('12500');
  });

  it('a colleague’s own piecework rate is not saved with a misplaced separator', () => {
    const onSave = vi.fn();
    renderWithQuery(
      <PieceworkRatesTab personnelSelectOptions={[]} selectedPersonnelForRates={1} onSelectPersonnel={() => undefined}
        tasksList={[{ id: 3, title: 'برش', defaultRate: 1000 } as never]} customRatesMap={{}} onSaveCustomRate={onSave} />,
    );
    fireEvent.change(field(SHOWN.customRate), { target: { value: SHOWN.misplaced } });
    fireEvent.click(screen.getByText(SHOWN.saveRate));
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(field(SHOWN.customRate), { target: { value: SHOWN.right } });
    fireEvent.click(screen.getByText(SHOWN.saveRate));
    expect(onSave).toHaveBeenCalledWith(3, '12500');
  });

  it('a purchase requisition is not sent with a misplaced separator in a price estimate', async () => {
    fetchJson.mockImplementation(async () => ({ success: true, data: [] }));
    renderWithQuery(<CreateRequisitionModal isOpen onClose={() => undefined} onSuccess={() => undefined} />);
    fireEvent.change(screen.getByPlaceholderText(SHOWN.requisitionTitle), { target: { value: 'ورق' } });
    fireEvent.change(screen.getByPlaceholderText(SHOWN.itemName), { target: { value: 'ورق' } });
    fireEvent.change(field(SHOWN.priceEstimate), { target: { value: SHOWN.misplaced } });
    fireEvent.submit(field(SHOWN.priceEstimate).closest('form') as HTMLFormElement);
    expect(writes('/api/procurement/requisitions')).toHaveLength(0);
    fireEvent.change(field(SHOWN.priceEstimate), { target: { value: SHOWN.right } });
    fireEvent.submit(field(SHOWN.priceEstimate).closest('form') as HTMLFormElement);
    await waitFor(() => expect(writes('/api/procurement/requisitions')).toHaveLength(1));
  });
});
