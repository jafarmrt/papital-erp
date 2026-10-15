import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CRMActivity } from '../../types';

const granted = new Set<string>();
vi.mock('../../contexts/AuthContext', () => ({
  useHasPermission: (key: string) => granted.has(key),
  useAuth: () => ({ userPermissions: { permissions: [...granted], isAdmin: false } }),
}));
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));

import { lostReasonError } from '../../lib/crm/leadFields';
import { activityEditForm, activityEditPayload } from '../../lib/crm/activityEdit';
import { followupsUrl } from '../../lib/crm/crmFollowupsQuery';
import { conversionPercentOf, type FunnelReport } from '../../lib/crm/funnelReport';
import { ActivityRowActions } from '../../components/crm/ActivityRowActions';
import { LostReasonDialog } from '../../components/crm/LostReasonFields';
import { CRMFunnelReport, funnelReportUrl } from '../../components/crm/CRMFunnelReport';

const withClient = (node: ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>
);

afterEach(() => {
  cleanup();
  granted.clear();
  fetchJson.mockReset();
});

// v10.1.17 (N-02 part 2): activity edit and delete, lost reason, my follow-ups and the funnel report in the browser
describe('CRM activities, lost reason and funnel (N-02 part 2)', () => {
  it('requires a listed lost reason and a note for «other»', () => {
    expect(lostReasonError('', '')).not.toBeNull();
    expect(lostReasonError('cheap', '')).not.toBeNull();
    expect(lostReasonError('other', '  ')).not.toBeNull();
    expect(lostReasonError('other', 'مشتری منصرف شد')).toBeNull();
    expect(lostReasonError('price', '')).toBeNull();
  });

  it('builds the activity edit body with only the route keys and the loaded version', () => {
    const form = activityEditForm({ type: 'meeting', title: ' جلسه ', activityDate: '2026-03-21', nextFollowUpDate: '', mentions: ['3', 'x'] });
    expect(form.activityDate).toBe('1405/01/01');
    expect(form.mentions).toEqual([3]);
    const body = activityEditPayload(form, 4);
    expect(Object.keys(body).sort()).toEqual([
      'activityDate', 'assignedPersonnelId', 'assignedTo', 'description', 'mentions', 'nextFollowUpDate',
      'nextFollowUpTask', 'result', 'title', 'type', 'version',
    ]);
    expect(body).toMatchObject({ version: 4, title: 'جلسه', type: 'meeting' });
  });

  it('asks my follow-ups by default and every seller only with scope=all', () => {
    const base = { status: 'pending' as const, page: 1, limit: 12 };
    expect(followupsUrl(base)).toBe('/crm/followups?status=pending&page=1&limit=12');
    expect(followupsUrl({ ...base, assignedPersonnelId: 'all' })).toContain('scope=all');
    expect(followupsUrl({ ...base, assignedPersonnelId: '7' })).toContain('assignedPersonnelId=7');
  });

  it('computes stage conversion and the report address', () => {
    expect(conversionPercentOf(3, 1, 'lead')).toBe(33.33);
    expect(conversionPercentOf(0, 0, 'lead')).toBeNull();
    expect(conversionPercentOf(2, 2, 'won')).toBeNull();
    expect(funnelReportUrl({ from: '2026-03-21', to: '2026-10-15' }, 'all')).toBe('/crm/reports/funnel?fromDate=2026-03-21&toDate=2026-10-15');
    expect(funnelReportUrl({ from: '2026-03-21', to: '2026-10-15' }, '5')).toContain('assignedPersonnelId=5');
  });

  it('shows activity edit and delete only to crm.manage holders', () => {
    const act = { id: 9, title: 'تماس' } as CRMActivity;
    const { rerender } = render(<ActivityRowActions activity={act} onEdit={() => undefined} onDelete={() => undefined} />);
    expect(screen.queryByTestId('activity-actions-9')).toBeNull();
    granted.add('crm.manage');
    rerender(<ActivityRowActions activity={act} onEdit={() => undefined} onDelete={() => undefined} />);
    expect(screen.getByLabelText('ویرایش اقدام')).toBeTruthy();
    expect(screen.getByLabelText('حذف اقدام')).toBeTruthy();
  });

  it('records «lost» only after a reason, and «other» only with a note', () => {
    const onConfirm = vi.fn();
    render(<LostReasonDialog leadTitle="سفارش نمایشگاه" onCancel={() => undefined} onConfirm={onConfirm} />);
    const submit = screen.getByText('ثبت «از دست رفته»') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByText('سایر'));
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('شرح دلیل از دست رفتن'), { target: { value: 'تعطیلی کارگاه مشتری' } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(onConfirm).toHaveBeenCalledWith({ lostReason: 'other', lostReasonNote: 'تعطیلی کارگاه مشتری' });
  });

  it('shows each stage and the lost reasons of the server report', async () => {
    const report: FunnelReport = {
      fromDate: null, toDate: null, assignedPersonnelId: null,
      stages: [
        { stage: 'lead', entered: 4, advanced: 2, conversionPercent: 50, avgDays: 2.5, measured: 3 },
        { stage: 'qualified', entered: 2, advanced: 1, conversionPercent: 50, avgDays: 3, measured: 2 },
        { stage: 'proposal', entered: 1, advanced: 1, conversionPercent: 100, avgDays: 3, measured: 1 },
        { stage: 'won', entered: 1, advanced: 0, conversionPercent: null, avgDays: null, measured: 0 },
      ],
      lost: { count: 2, reasons: [{ reason: 'competitor', count: 1 }, { reason: 'price', count: 1 }] },
    };
    fetchJson.mockResolvedValue(report);
    render(withClient(<CRMFunnelReport personnelList={[{ id: 5, fullName: 'سارا' }]} />));
    expect(await screen.findByText('خرید از رقیب')).toBeTruthy();
    expect(String(fetchJson.mock.calls[0][0])).toMatch(/^\/crm\/reports\/funnel\?fromDate=/);
    expect(screen.getByTestId('funnel-stage-lead').textContent).toContain('۵۰٪');
    expect(screen.getByText('قیمت')).toBeTruthy();
  });
});
