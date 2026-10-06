/**
 * v9.0.82 (TD-880, permission model §4.2): the role form ticks a permission's requirements with it and unticks the
 * permissions that depend on a removed one, the same rule the server applies on save. It used to toggle each box alone,
 * so a role could be saved with «edit invoices» but without «view invoices».
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RoleFormModal } from '../../components/users/RoleFormModal';
import { setCsrfToken } from '../../api';
import { PERMISSION_CATALOG } from '../../lib/permissions/permissionCatalog';
import type { PermissionCategory, Role } from '../../types';

const catalog = PERMISSION_CATALOG as unknown as PermissionCategory[];

function box(key: string): HTMLInputElement {
  const label = Array.from(document.querySelectorAll('label')).find(l => l.textContent?.includes(`(${key})`));
  if (!label) throw new Error(`no checkbox for ${key}`);
  return label.querySelector('input[type="checkbox"]') as HTMLInputElement;
}

function stubFetch() {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: (init?.method || 'GET').toUpperCase(), body: typeof init?.body === 'string' ? init.body : undefined });
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  return calls;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('TD-880 role form permission dependencies', () => {
  it('ticks the view permission with an action and unticks the actions when the view is removed', () => {
    render(<RoleFormModal isOpen onClose={() => {}} editingRole={null} permCatalog={catalog} onSuccess={() => {}} />);
    fireEvent.click(box('documents.edit'));
    expect(box('documents.edit').checked).toBe(true);
    expect(box('documents.view').checked).toBe(true);

    fireEvent.click(box('accounting.treasury_no_voucher'));
    expect(box('accounting.treasury').checked).toBe(true);
    expect(box('accounting.view').checked).toBe(true);

    fireEvent.click(box('accounting.view'));
    expect(box('accounting.view').checked).toBe(false);
    expect(box('accounting.treasury').checked).toBe(false);
    expect(box('accounting.treasury_no_voucher').checked).toBe(false);
    expect(box('documents.edit').checked).toBe(true);
    expect(screen.getAllByText(/همراه این مجوز، «مشاهده فاکتورها» هم داده می‌شود/).length).toBeGreaterThan(0);
  });

  it('shows and saves the requirements an existing role lacks', async () => {
    setCsrfToken('test-csrf');
    const calls = stubFetch();
    const role = { id: 7, code: 'sales_desk', name: 'میز فروش', description: '', permissions: ['customers.manage'], isSystem: 0 } as Role;
    render(<RoleFormModal isOpen onClose={() => {}} editingRole={role} permCatalog={catalog} onSuccess={() => {}} />);
    expect(box('customers.view').checked).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('«مشاهده لیست مشتریان»');

    fireEvent.submit(box('customers.view').closest('form')!);
    await new Promise(r => setTimeout(r, 10));
    const put = calls.find(c => c.method === 'PUT');
    expect(JSON.parse(put?.body ?? '{}').permissions).toEqual(['customers.manage', 'customers.view']);
  });
});
