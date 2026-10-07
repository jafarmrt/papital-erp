import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DailyLogsMentionsWidget } from '../../components/dashboard/DailyLogsMentionsWidget';
import type { DailyWorkLog, User } from '../../types';

afterEach(cleanup);

// v9.0.241 (TD-638, finding B13-13): the dashboard widget reads the API field `mentions`, not «@name» in the text
describe('dashboard mentions widget (TD-638)', () => {
  const me = { id: 7, username: 'ali', full_name: 'علی', role: 'viewer' } as unknown as User;

  it('a log whose `mentions` holds my id is shown on the dashboard', () => {
    const log = { id: 1, userId: 3, username: 'author', title: 'کار', content: 'کار انجام شد', date: '2026-10-05', mentions: [7], tags: [] } as unknown as DailyWorkLog;
    render(<MemoryRouter><DailyLogsMentionsWidget user={me} logs={[log]} /></MemoryRouter>);
    expect(screen.getByText('کار انجام شد')).toBeTruthy();
  });

  it('a Persian «@name» in the text without my id is not a mention of a user with a prefix name', () => {
    const log = { id: 2, userId: 3, username: 'author', title: 'کار', content: '@علی رضایی لطفاً پیگیری کن', date: '2026-10-05', mentions: [9], tags: [] } as unknown as DailyWorkLog;
    render(<MemoryRouter><DailyLogsMentionsWidget user={me} logs={[log]} /></MemoryRouter>);
    expect(screen.queryByText('@علی رضایی لطفاً پیگیری کن')).toBeNull();
  });
});
