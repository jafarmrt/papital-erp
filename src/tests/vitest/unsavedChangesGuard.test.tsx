import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const confirmAction = vi.fn(async () => true);
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: () => confirmAction() }));
const notification = { id: 5, title: 'گزارش تازه', message: 'گزارش کار', type: 'workshop', link: '/workshop/review', is_read: 1, created_at: '2026-10-18 05:00:00' };
vi.mock('../../hooks/queries', () => ({
  useUnreadNotificationsCountQuery: () => ({ data: 0 }),
  useNotificationsQuery: () => ({ data: [notification], isLoading: false }),
  useMarkNotificationReadMutation: () => ({ mutate: vi.fn() }),
  useMarkAllNotificationsReadMutation: () => ({ mutate: vi.fn() }),
  useDeleteNotificationMutation: () => ({ mutate: vi.fn() }),
}));

import { GUARD_ENTRY_KEY, confirmLeaveIfDirty, leaveNavigateOptions, useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import NotificationBell from '../../components/NotificationBell';

// the browser's own traversal is left out: each test reads what the guard asked for
let backSpy: MockInstance<() => void>;
beforeEach(() => { backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => undefined); });
afterEach(() => { cleanup(); vi.clearAllMocks(); confirmAction.mockImplementation(async () => true); });

function Guarded({ dirty, children }: { dirty: boolean; children?: React.ReactNode }) {
  useUnsavedChangesGuard(dirty);
  const location = useLocation();
  return <><output data-testid="location">{location.pathname}</output>{children}</>;
}

const renderGuard = (dirty: boolean, children?: React.ReactNode) => {
  const tree = (value: boolean) => (
    <MemoryRouter initialEntries={['/projects/7']}>
      <Routes>
        <Route path="/projects/7" element={<Guarded dirty={value}>{children}</Guarded>} />
        <Route path="*" element={<p data-testid="elsewhere">elsewhere</p>} />
      </Routes>
    </MemoryRouter>
  );
  const view = render(tree(dirty));
  return { ...view, setDirty: (value: boolean) => view.rerender(tree(value)) };
};

const onGuardEntry = () => (window.history.state as Record<string, unknown> | null)?.[GUARD_ENTRY_KEY] === true;
const unloadPrevented = () => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};
const popState = () => window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));

// v10.2.1 (10.2 package 2, review H1 / M1 / L8): the guard of a page whose changes are not saved yet
describe('unsaved changes guard (10.2 package 2)', () => {
  it('asks the browser before closing only while changes are unsaved', async () => {
    const view = renderGuard(false);
    expect(unloadPrevented()).toBe(false);
    expect(await confirmLeaveIfDirty()).toBe(true);
    expect(confirmAction).not.toHaveBeenCalled();

    view.setDirty(true);
    expect(unloadPrevented()).toBe(true);
    expect(onGuardEntry()).toBe(true);
    expect(leaveNavigateOptions()).toEqual({ replace: true });

    view.setDirty(false);
    expect(unloadPrevented()).toBe(false);
    // saved on the page: the extra history entry is taken away again
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it('catches the back button, puts the entry back to stay and goes back to leave', async () => {
    renderGuard(true);
    expect(onGuardEntry()).toBe(true);
    // «back» left the extra entry: the browser now shows the page's own entry
    window.history.replaceState({}, '', window.location.href);
    confirmAction.mockImplementation(async () => false);
    popState();
    await waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onGuardEntry()).toBe(true));
    expect(backSpy).not.toHaveBeenCalled();

    window.history.replaceState({}, '', window.location.href);
    confirmAction.mockImplementation(async () => true);
    popState();
    await waitFor(() => expect(backSpy).toHaveBeenCalledTimes(1));
    // a second pop while leaving does not ask again
    popState();
    expect(confirmAction).toHaveBeenCalledTimes(2);
  });

  it('ignores a pop that lands on its own extra entry', () => {
    renderGuard(true);
    popState();
    expect(confirmAction).not.toHaveBeenCalled();
  });

  it('asks before a notification takes the user away and stays on the page when told to', async () => {
    renderGuard(true, <NotificationBell />);
    fireEvent.click(screen.getByTitle('اعلان‌ها و اشاره‌ها'));
    confirmAction.mockImplementation(async () => false);
    fireEvent.click(await screen.findByText('گزارش تازه'));
    await waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('location').textContent).toBe('/projects/7');

    fireEvent.click(screen.getByTitle('اعلان‌ها و اشاره‌ها'));
    confirmAction.mockImplementation(async () => true);
    fireEvent.click(await screen.findByText('گزارش تازه'));
    expect(await screen.findByTestId('elsewhere')).toBeTruthy();
  });

  it('follows a notification without asking when nothing is unsaved', async () => {
    renderGuard(false, <NotificationBell />);
    fireEvent.click(screen.getByTitle('اعلان‌ها و اشاره‌ها'));
    fireEvent.click(await screen.findByText('گزارش تازه'));
    expect(await screen.findByTestId('elsewhere')).toBeTruthy();
    expect(confirmAction).not.toHaveBeenCalled();
  });
});
