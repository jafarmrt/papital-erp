/**
 * v9.0.178 (TD-519, B02-04, owner decision t2 A): creating a user with a deleted user's username is refused with 409
 * USERNAME_OF_DELETED_USER. The new-user form then names the deleted user and offers restoring that same user as a
 * separate, explicit action (`POST /users/:id/restore` with the form's role and password); it used to revive the old
 * account silently.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UserFormModal } from '../../components/users/UserFormModal';
import { setCsrfToken } from '../../api';
import type { Role } from '../../types';

const rolesList = [
  { id: 2, code: 'sales_clerk', name: 'کارشناس فروش', permissions: ['customers.view'], isSystem: 0 },
] as unknown as Role[];

function stubFetch() {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method || 'GET').toUpperCase();
    calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : undefined });
    if (method === 'POST' && url.endsWith('/api/users')) {
      return new Response(JSON.stringify({
        error: 'این نام کاربری متعلق به کاربر حذف‌شده «علی رضایی» است؛ نام دیگری انتخاب کنید یا همان کاربر را بازگردانید.',
        code: 'USERNAME_OF_DELETED_USER',
        details: { deletedUser: { id: 8, username: 'ali', fullName: 'علی رضایی' } },
      }), { status: 409, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ id: 8 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  return calls;
}

function fillNewUser(username: string) {
  const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
  fireEvent.change(inputs[0], { target: { value: 'علی محمدی' } });
  fireEvent.change(inputs[1], { target: { value: username } });
  fireEvent.change(document.querySelector('select') as HTMLSelectElement, { target: { value: 'sales_clerk' } });
  fireEvent.change(document.querySelector('input[type="password"]') as HTMLInputElement, { target: { value: 'Tempor4ry!' } });
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('TD-519 a deleted user\'s username is restored only by an explicit action', () => {
  it('names the deleted user and restores that same user with the form\'s role and temporary password', async () => {
    setCsrfToken('test-csrf');
    const calls = stubFetch();
    const onSuccess = vi.fn();
    render(<UserFormModal isOpen onClose={() => {}} editingUser={null} rolesList={rolesList} onSuccess={onSuccess} />);
    fillNewUser('ali');
    fireEvent.submit(document.querySelector('form')!);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('کاربر حذف‌شده «علی رضایی»');
    expect(onSuccess).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'بازگرداندن «علی رضایی»' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    const restore = calls.find(c => c.method === 'POST' && c.url.endsWith('/api/users/8/restore'));
    expect(restore).toBeTruthy();
    expect(JSON.parse(restore!.body!)).toEqual({ role: 'sales_clerk', password: 'Tempor4ry!' });
  });

  it('drops the restore offer when the username changes', async () => {
    setCsrfToken('test-csrf');
    stubFetch();
    render(<UserFormModal isOpen onClose={() => {}} editingUser={null} rolesList={rolesList} onSuccess={() => {}} />);
    fillNewUser('ali');
    fireEvent.submit(document.querySelector('form')!);
    await screen.findByRole('alert');

    const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
    fireEvent.change(inputs[1], { target: { value: 'ali.mohammadi' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
