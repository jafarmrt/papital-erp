import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DailyLogsMentionsWidget } from '../../components/dashboard/DailyLogsMentionsWidget';
import { accessibleShortcutsFor } from '../../components/dashboard/CustomizableShortcuts';
import type { User } from '../../types';

afterEach(cleanup);

const CREATE_BUTTON = 'ثبت گزارش';

// v10.0.88 (TD-1223): a reader of daily logs without daily_logs.create is offered no «ثبت» on the dashboard
describe('daily log create entry points follow daily_logs.create (TD-1223)', () => {
  const me = { id: 7, username: 'ali', full_name: 'علی', role: 'viewer' } as unknown as User;

  it('the dashboard widget shows the create button only with the create permission', () => {
    render(<MemoryRouter><DailyLogsMentionsWidget user={me} logs={[]} /></MemoryRouter>);
    expect(screen.queryByText(CREATE_BUTTON)).toBeNull();
    cleanup();
    render(<MemoryRouter><DailyLogsMentionsWidget user={me} logs={[]} canCreate /></MemoryRouter>);
    expect(screen.getByText(CREATE_BUTTON)).toBeTruthy();
  });

  it('the daily log shortcut needs daily_logs.create, not only the page', () => {
    const ids = (permissions: string[]) => accessibleShortcutsFor({ permissions }).map(s => s.id);
    expect(ids(['daily_logs.view'])).not.toContain('daily_logs');
    expect(ids(['daily_logs.view', 'daily_logs.create'])).toContain('daily_logs');
    expect(accessibleShortcutsFor({ isAdmin: true }).map(s => s.id)).toContain('daily_logs');
  });
});
