/**
 * v9.0.159 (TD-532, B02-17, owner decision t5 A): one shared minimum password length (8) for every form and route. The
 * profile form accepted 4 characters, the user form and the restore form 6 (server 6), the setup page 6 (server 8): a
 * 7-character password went through the user form and setup, and the profile form sent 5 characters to a server that
 * wanted 8.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UserFormModal } from '../../components/users/UserFormModal';
import UserProfileModal from '../../components/UserProfileModal';
import SetupPage from '../../pages/SetupPage';
import { setCsrfToken } from '../../api';
import { MIN_PASSWORD_LENGTH, PASSWORD_TOO_SHORT_MESSAGE, passwordLengthError } from '../../lib/auth/passwordPolicy';
import type { Role, User } from '../../types';

const toastError = vi.fn();
vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { error: (msg: string) => toastError(msg), success: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { default: toast, toast, Toaster: () => null };
});

const SEVEN = 'abc1234';

function stubFetch() {
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: (init?.method || 'GET').toUpperCase() });
    return new Response(JSON.stringify({ success: true, id: 9 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  return calls;
}

const writes = (calls: Array<{ method: string }>) => calls.filter(c => c.method !== 'GET');
const flush = () => new Promise(r => setTimeout(r, 20));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); toastError.mockReset(); });

describe('password minimum length (TD-532)', () => {
  it('is one constant of eight characters with one Persian message', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
    expect(PASSWORD_TOO_SHORT_MESSAGE).toBe('رمز عبور باید دست‌کم ۸ نویسه داشته باشد.');
    expect(passwordLengthError(SEVEN)).toBe(PASSWORD_TOO_SHORT_MESSAGE);
    expect(passwordLengthError('abcd1234')).toBeNull();
  });

  it('the user form sends no seven-character password', async () => {
    setCsrfToken('test-csrf');
    const calls = stubFetch();
    const roles = [{ id: 3, code: 'accountant', name: 'حسابدار', permissions: [], isSystem: 0 }] as unknown as Role[];
    render(<UserFormModal isOpen onClose={() => {}} editingUser={null} rolesList={roles} onSuccess={() => {}} />);
    const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
    fireEvent.change(inputs[0], { target: { value: 'علی رضایی' } });
    fireEvent.change(inputs[1], { target: { value: 'ali' } });
    fireEvent.change(document.querySelector('input[type="password"]') as HTMLInputElement, { target: { value: SEVEN } });
    const select = document.querySelector('select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'accountant' } });
    fireEvent.submit(select.closest('form')!);
    await flush();
    expect(writes(calls)).toEqual([]);
    expect(toastError).toHaveBeenCalledWith(PASSWORD_TOO_SHORT_MESSAGE);
  });

  it('the profile form sends no password shorter than eight characters', async () => {
    setCsrfToken('test-csrf');
    const calls = stubFetch();
    const user = { id: 5, username: 'ali', full_name: 'علی', role: 'accountant' } as unknown as User;
    render(<UserProfileModal user={user} isOpen onClose={() => {}} onUserUpdate={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /تغییر کلمه عبور|امنیت|رمز/ }));
    const [current, next, confirm] = Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[];
    fireEvent.change(current, { target: { value: 'Old-pass-1' } });
    fireEvent.change(next, { target: { value: 'abc12' } });
    fireEvent.change(confirm, { target: { value: 'abc12' } });
    fireEvent.submit(next.closest('form')!);
    await flush();
    expect(writes(calls)).toEqual([]);
    expect(toastError).toHaveBeenCalledWith(PASSWORD_TOO_SHORT_MESSAGE);
  });

  it('the setup page stops a seven-character admin password with the same message', async () => {
    stubFetch();
    render(<SetupPage onLogin={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('مثال: علی رضایی'), { target: { value: 'مدیر سامانه' } });
    for (const input of Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[]) {
      fireEvent.change(input, { target: { value: SEVEN } });
    }
    fireEvent.submit(screen.getByPlaceholderText('مثال: علی رضایی').closest('form')!);
    await waitFor(() => expect(screen.getByText(PASSWORD_TOO_SHORT_MESSAGE)).toBeTruthy());
    expect(screen.queryByPlaceholderText('مثال: انبار مرکزی')).toBeNull();
  });
});
