import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const { admin } = vi.hoisted(() => ({ admin: { value: true } }));
vi.mock('../../contexts/AuthContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../contexts/AuthContext')>()),
  useIsSystemAdmin: () => admin.value,
}));
vi.mock('../../components/common/JalaliDateInput', () => ({
  JalaliDateInput: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input data-testid="date" value={value} onChange={e => onChange(e.target.value)} />
  ),
}));

import { DataExportCard } from '../../components/settings/DataExportCard';
import { dataExportRangeError, dataExportUrl } from '../../lib/system/dataExport';

// v9.0.356 (TD-592, decision t7 a): the export card asks for the audit log separately with a date range, the server names
// the zip file, and only the system admin (the guard of the route) sees the card.

afterEach(() => { cleanup(); admin.value = true; });

describe('data export card (TD-592)', () => {
  it('builds the download URL with the audit log only for a valid range', () => {
    expect(dataExportUrl({ activityLogs: false, from: '2026-10-01', to: '2026-10-08' })).toBe('/api/export-backup');
    expect(dataExportUrl({ activityLogs: true, from: '2026-10-01', to: '2026-10-08' }))
      .toBe('/api/export-backup?activityLogs=1&from=2026-10-01&to=2026-10-08');
    expect(dataExportRangeError({ activityLogs: true, from: '', to: '2026-10-08' })).not.toBeNull();
    expect(dataExportRangeError({ activityLogs: true, from: '2026-10-09', to: '2026-10-08' })).not.toBeNull();
  });

  it('offers the audit log with a range and lets the server name the file', () => {
    render(<DataExportCard />);
    const link = screen.getByText('دانلود خروجی داده‌ها').closest('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/api/export-backup');
    expect(link.getAttribute('download')).toBe('');

    fireEvent.click(screen.getByRole('checkbox'));
    const [from, to] = screen.getAllByTestId('date') as HTMLInputElement[];
    fireEvent.change(from, { target: { value: '2026-10-01' } });
    fireEvent.change(to, { target: { value: '2026-10-08' } });
    expect((screen.getByText('دانلود خروجی داده‌ها').closest('a') as HTMLAnchorElement).getAttribute('href'))
      .toBe('/api/export-backup?activityLogs=1&from=2026-10-01&to=2026-10-08');

    fireEvent.change(from, { target: { value: '2026-10-09' } });
    expect(screen.getByRole('alert').textContent).toContain('پیش از تاریخ آغاز');
    expect(screen.getByText('دانلود خروجی داده‌ها').closest('a')).toBeNull();
  });

  it('is not shown to a user who is not the system admin', () => {
    admin.value = false;
    const { container } = render(<DataExportCard />);
    expect(container.textContent).toBe('');
  });
});
