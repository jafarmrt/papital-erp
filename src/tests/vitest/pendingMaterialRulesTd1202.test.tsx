import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import {
  MATERIAL_UNITS, materialUnitOptions, pendingMaterialCodeError, rawMaterialCategories,
} from '../../lib/pendingMaterials/materialRequestRules';
import { COMMON_UNITS } from '../../components/project/projectInventoryUtils';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args), isAbortError: () => false }));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, username: 'keeper' }, userPermissions: { permissions: ['pending_materials.view', 'pending_materials.approve'], isAdmin: false } }),
  useHasPermission: () => true,
}));
vi.mock('react-hot-toast', () => { const toast = { error: vi.fn(), success: vi.fn() }; return { default: toast, toast }; });
vi.mock('../../components/workflow/WorkflowStepperWidget', () => ({ WorkflowStepperWidget: () => null }));

import PendingMaterialsPage from '../../pages/PendingMaterialsPage';

afterEach(() => { cleanup(); fetchJson.mockReset(); });

const CATEGORIES = [
  { id: 1, name: 'گردنبند', prefix: 'N', type: 'product' },
  { id: 2, name: 'مهره حدید', prefix: 'B-H', type: 'raw_material' },
  { id: 3, name: 'بند چرمی و زنجیر', prefix: 'C', type: 'raw_material' },
];

/**
 * v10.0.143 (TD-1202, roles-b finding 8): the raw-material request form and the keeper's approval window share one unit
 * list, offer only raw-material categories, and the approval takes a code in the raw-material pattern with its
 * category's prefix (before, «XYZ-9» was accepted).
 */
describe('TD-1202 raw-material request rules', () => {
  it('shares one unit list between the request form and the approval window', () => {
    expect(COMMON_UNITS).toBe(MATERIAL_UNITS);
    for (const unit of ['ریسه', 'پک', 'طغره', 'جفت', 'گرم', 'ست']) expect(MATERIAL_UNITS).toContain(unit);
    expect(materialUnitOptions('واحد قدیمی')).toContain('واحد قدیمی');
    expect(materialUnitOptions('عدد')).toBe(MATERIAL_UNITS);
  });

  it('offers only raw-material categories', () => {
    expect(rawMaterialCategories(CATEGORIES).map(c => c.name)).toEqual(['مهره حدید', 'بند چرمی و زنجیر']);
  });

  it('checks the code pattern and the category prefix', () => {
    const beads = CATEGORIES[1];
    expect(pendingMaterialCodeError('XYZ-9', beads)).toMatch(/قالب کد/);
    expect(pendingMaterialCodeError('C-001', beads)).toMatch(/B-H/);
    expect(pendingMaterialCodeError('B-H-101', beads)).toBeNull();
    expect(pendingMaterialCodeError('b-h--101', beads)).toBeNull();
    expect(pendingMaterialCodeError('Q-101', null)).toBeNull();
    expect(pendingMaterialCodeError('', beads)).toBeNull();
  });

  it('lists raw-material categories in the approval window and blocks a code without the prefix', async () => {
    const request = { id: 9, code: 'XYZ-9', name: 'مهره آزمون', unit: 'ریسه', category: 'مهره حدید', status: 'pending', weightedAverageCost: 1000, reorderPoint: 0, projectTitle: 'پروژه', requestedBy: 'کاربر' };
    fetchJson.mockImplementation((url: string) => {
      if (url.startsWith('/pending-materials')) return Promise.resolve({ data: [request], total: 1, page: 1, limit: 50, statusCounts: { pending: 1, approved: 0, rejected: 0 } });
      if (url.startsWith('/categories')) return Promise.resolve(CATEGORIES);
      return Promise.resolve({});
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><PendingMaterialsPage user={{ id: 1, username: 'keeper' } as never} /></MemoryRouter></QueryClientProvider>);

    fireEvent.click(await screen.findByText('تأیید'));
    const categorySelect = screen.getByText('دسته‌بندی کالا *').parentElement?.querySelector('select') as HTMLSelectElement;
    expect(Array.from(categorySelect.options).map(o => o.value)).toEqual(['مهره حدید', 'بند چرمی و زنجیر']);
    const unitSelect = screen.getByText('واحد شمارش *').parentElement?.querySelector('select') as HTMLSelectElement;
    expect(Array.from(unitSelect.options).map(o => o.value)).toEqual([...MATERIAL_UNITS]);

    const submit = screen.getByText('تأیید و افزودن به انبار').closest('button') as HTMLButtonElement;
    expect(within(document.body).getByRole('alert').textContent).toMatch(/قالب کد/);
    expect(submit.disabled).toBe(true);

    const codeInput = screen.getByText('کد رسمی کالا در انبار *').parentElement?.querySelector('input') as HTMLInputElement;
    fireEvent.change(codeInput, { target: { value: 'B-H-101' } });
    expect(submit.disabled).toBe(false);
  });
});
