/**
 * v9.0.53 (TD-517, B02-02): the new-user form preselects no role. It used to take the first role of `GET /roles`
 * (the system admin, seeded first), so a manager who filled only the username and password created a system admin.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { UserFormModal } from '../../components/users/UserFormModal';
import { setCsrfToken } from '../../api';
import type { Role } from '../../types';

const seedOrderRoles = [
  { id: 1, code: 'admin', name: 'مدیر سیستم', permissions: [], isSystem: 1 },
  { id: 2, code: 'manager', name: 'مدیر عمومی', permissions: [], isSystem: 1 },
  { id: 3, code: 'accountant', name: 'حسابدار', permissions: [], isSystem: 1 },
] as unknown as Role[];

function stubFetch() {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: (init?.method || 'GET').toUpperCase(), body: typeof init?.body === 'string' ? init.body : undefined });
    return new Response(JSON.stringify({ id: 9 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  return calls;
}

function fillAccount() {
  const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
  fireEvent.change(inputs[0], { target: { value: 'علی رضایی' } });
  fireEvent.change(inputs[1], { target: { value: 'ali' } });
  fireEvent.change(document.querySelector('input[type="password"]') as HTMLInputElement, { target: { value: 'Passw0rd-123' } });
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('TD-517 new-user form role', () => {
  it('starts with no role selected, and a form without a role sends nothing', async () => {
    setCsrfToken('test-csrf');
    const calls = stubFetch();
    render(<UserFormModal isOpen onClose={() => {}} editingUser={null} rolesList={seedOrderRoles} onSuccess={() => {}} />);
    const select = document.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('');
    fillAccount();
    fireEvent.submit(select.closest('form')!);
    await new Promise(r => setTimeout(r, 10));
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(0);
  });

  it('lists the system admin last with a warning, and sends the role the manager picked', async () => {
    setCsrfToken('test-csrf');
    const calls = stubFetch();
    render(<UserFormModal isOpen onClose={() => {}} editingUser={null} rolesList={seedOrderRoles} onSuccess={() => {}} />);
    const select = document.querySelector('select') as HTMLSelectElement;
    const values = Array.from(select.options).map(o => o.value);
    expect(values[0]).toBe('');
    expect(values[values.length - 1]).toBe('admin');
    expect(values.filter(v => v === 'admin')).toHaveLength(1);

    fireEvent.change(select, { target: { value: 'admin' } });
    expect(screen.getByText(/دسترسی کامل دارد/)).toBeTruthy();

    fireEvent.change(select, { target: { value: 'accountant' } });
    fillAccount();
    fireEvent.submit(select.closest('form')!);
    await vi.waitFor(() => expect(calls.some(c => c.method === 'POST')).toBe(true));
    const post = calls.find(c => c.method === 'POST')!;
    expect(post.url).toBe('/api/users');
    expect(JSON.parse(post.body!).role).toBe('accountant');
  });
});
