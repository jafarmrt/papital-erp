/**
 * v9.0.390 (TD-620, B01-40): the factory reset card says what the reset does: roles are kept (TD-245) and the defaults
 * of a fresh install come back, event rules and webhook subscriptions included. On v9.0.389 it said the system roles
 * were reset and said nothing of the event rules, which stayed missing until a restart.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SystemOperationsTab } from '../../components/settings/SystemOperationsTab';
import { FACTORY_RESET_KEPT, FACTORY_RESET_RESTORED } from '../../lib/system/factoryReset';

vi.mock('../../api', () => ({ fetchJson: vi.fn(async () => ({ healthy: true, totalLogs: 0, criticalLogsCount: 0 })) }));

afterEach(cleanup);

describe('factory reset card (TD-620)', () => {
  it('says roles are kept and names the defaults the reset puts back', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><SystemOperationsTab onOpenClearModal={() => {}} /></QueryClientProvider>);
    const text = screen.getByText(/پیش‌فرض‌های نصب تازه/).textContent || '';
    expect(text).toContain(`${FACTORY_RESET_KEPT} پاک نمی‌شوند`);
    for (const item of FACTORY_RESET_RESTORED) expect(text).toContain(item);
    expect(text).toContain('قاعده‌های رویداد');
    expect(text).not.toContain('نقش‌های سیستمی');
    expect(text).not.toMatch(/دوبل|کدینگ/);
  });
});
