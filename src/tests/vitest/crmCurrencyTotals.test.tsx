import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Customer, CRMLead } from '../../types';
import { formatPersianPrice, formatCurrencyLabel } from '../../utils';
import { sumByCurrency } from '../../lib/crm/leadCurrencyTotals';

vi.mock('../../api', () => ({ fetchJson: () => Promise.resolve([]) }));

import { CRMStatsCards } from '../../components/crm/CRMStatsCards';
import { CustomerDossierDrawer } from '../../components/crm/CustomerDossierDrawer';

afterEach(() => cleanup());

const lineOf = (container: HTMLElement, currency: string) => Array.from(container.querySelectorAll(`[data-currency="${currency}"]`)).map(e => e.textContent ?? '');

// v9.0.11 (TD-422، تصمیم مالک محصول ت۷): ارزش پرونده‌های فروش فقط به تفکیک ارز؛ ۱٬۰۰۰ دلار با ۲٬۰۰۰٬۰۰۰ ریال جمع نمی‌شود
describe('CRM lead values per currency (TD-422)', () => {
  it('sums each currency on its own, rial first, with exact decimals', () => {
    const totals = sumByCurrency([
      { currency: 'USD', estimatedValue: 0.1 },
      { currency: ' usd ', estimatedValue: 0.2 },
      { currency: 'IRR', estimatedValue: 2_000_000 },
      { currency: '', estimatedValue: 500 },
      { currency: 'AED', estimatedValue: '40' },
    ]);
    expect(totals).toEqual([
      { currency: 'IRR', count: 2, value: 2_000_500 },
      { currency: 'AED', count: 1, value: 40 },
      { currency: 'USD', count: 2, value: 0.3 },
    ]);
  });

  it('shows the pipeline value of the CRM page per currency', () => {
    const { container } = render(
      <CRMStatsCards
        stats={{ activeLeadsCount: 2, pipelineByCurrency: [{ currency: 'IRR', count: 1, value: 2_000_000 }, { currency: 'USD', count: 1, value: 1000 }] }}
        onOpenLeadModal={() => undefined}
      />,
    );
    expect(lineOf(container, 'IRR')).toEqual([`${formatPersianPrice(2_000_000)} ${formatCurrencyLabel('IRR')}`]);
    expect(lineOf(container, 'USD')).toEqual([`${formatPersianPrice(1000)} ${formatCurrencyLabel('USD')}`]);
    expect(screen.queryByText(new RegExp(formatPersianPrice(2_001_000)))).toBeNull();
  });

  it('shows the pipeline and won values of a customer dossier per currency', () => {
    const customer = { id: 7, name: 'گالری فیروزه', partyType: 'customer', version: 1 } as Customer;
    const lead = (id: number, stage: string, currency: string, estimatedValue: number) =>
      ({ id, title: `پرونده ${id}`, customerId: 7, customerName: customer.name, stage, status: stage === 'won' ? 'won' : 'active', currency, estimatedValue }) as CRMLead;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <CustomerDossierDrawer
          customer={customer}
          onClose={() => undefined}
          allLeads={[lead(1, 'proposal', 'USD', 1000), lead(2, 'proposal', 'IRR', 2_000_000), lead(3, 'won', 'USD', 250.5)]}
          allActivities={[]}
          onOpenLeadDrawer={() => undefined}
          onOpenLeadModal={() => undefined}
          onOpenActivityModal={() => undefined}
        />
      </QueryClientProvider>,
    );
    expect(lineOf(container, 'IRR')).toEqual([`${formatPersianPrice(2_000_000)} ${formatCurrencyLabel('IRR')}`]);
    expect(lineOf(container, 'USD')).toEqual([
      `${formatPersianPrice(250.5, undefined, 2)} ${formatCurrencyLabel('USD')}`,
      `${formatPersianPrice(1250.5, undefined, 2)} ${formatCurrencyLabel('USD')}`,
    ]);
    expect(screen.queryByText(new RegExp(formatPersianPrice(2_001_250.5, undefined, 2)))).toBeNull();
  });
});
