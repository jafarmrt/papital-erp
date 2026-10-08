import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { ProductionProject } from '../../types';

type FetchOpts = { signal?: AbortSignal };
const failing = new Set<string>();
const fetchJson = vi.fn(async (url: string, _opts?: FetchOpts): Promise<unknown> => {
  if ([...failing].some(prefix => url.startsWith(prefix))) throw Object.assign(new Error('x'), { message: 'دسترسی ندارید' });
  if (url.startsWith('/api/categories')) return [{ name: 'سنگ', prefix: 'STN' }];
  return [];
});
vi.mock('../../api', () => ({ fetchJson: (url: string, opts?: FetchOpts) => fetchJson(url, opts) }));
const toastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: (...args: unknown[]) => toastError(...args) },
  default: { success: vi.fn(), error: (...args: unknown[]) => toastError(...args) },
}));
vi.mock('../../hooks/useProjectPermissions', () => ({
  useProjectPermissions: () => ({
    canCreate: true, canEdit: true, canDelete: true, canAllocate: true, canConsumeAllocation: true, canReleaseAllocation: true, canRequestPurchase: true,
  }),
}));
vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await vi.importActual<typeof import('../../lib/rialDisplay')>('../../lib/rialDisplay');
  return { useAppCurrency: () => 'IRR', useRialDisplay: () => rialDisplayOf('IRR') };
});
vi.mock('../../hooks/usePieceworkPermissions', () => ({
  usePieceworkPermissions: () => ({ canManageTasks: false, canLog: true, canIssuePayroll: false, canPay: false }),
}));

import { useProjectInventory } from '../../hooks/useProjectInventory';
import ProjectScheduleTab from '../../components/project/ProjectScheduleTab';

afterEach(() => { cleanup(); vi.clearAllMocks(); failing.clear(); });

const project = {
  id: 7, version: 1, title: 'پروژه خطا', status: 'planned', start_date: '2026-08-23', stages: [],
  products: [{ id: 'p1', item_id: 50, item_name: 'گردنبند', item_code: 'NK-1', quantity: 3, unit: 'عدد' }],
} as unknown as ProductionProject;

const ROOT = join(__dirname, '..', '..');
const PACKAGE_11 = [
  'pages/ProjectsPage.tsx', 'components/ProjectModal.tsx', 'components/ProjectDetailModal.tsx', 'components/project/',
  'components/project-modal/', 'components/inventory/ProjectBomAllocationsTab.tsx', 'hooks/useProjectInventory.ts',
  'components/settings/WorkflowPresetsTab.tsx',
];
const filesUnder = (path: string): string[] => {
  const full = join(ROOT, path);
  return statSync(full).isDirectory() ? readdirSync(full).flatMap(name => filesUnder(join(path, name))) : [full];
};

// v9.0.422 (TD-766): package 11 catch blocks only logged, so a failed read looked like empty data
describe('package 11 read failures are shown (TD-766)', () => {
  it('reads error text with errorMessageOf, never err.message', () => {
    const offenders = PACKAGE_11.flatMap(filesUnder).filter(f => /\.tsx?$/.test(f) && /\berr\.message\b/.test(readFileSync(f, 'utf8')));
    expect(offenders.map(f => relative(ROOT, f))).toEqual([]);
  });

  it('says so when the next item code cannot be read instead of suggesting PREFIX001', async () => {
    failing.add('/api/items/next-code');
    const { result } = renderHook(() => useProjectInventory(project));
    await waitFor(() => expect(fetchJson.mock.calls.some(([url]) => url.startsWith('/api/categories'))).toBe(true));
    await waitFor(() => expect(result.current.handleCategoryChangeForCustom).toBeTypeOf('function'));
    await act(async () => { await result.current.handleCategoryChangeForCustom('سنگ'); });
    expect(result.current.customMaterialForm.itemCode).toBe('');
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('دسترسی ندارید'));
  });

  it('says so when the project work logs cannot be read', async () => {
    failing.add('/piecework/logs');
    render(<ProjectScheduleTab project={project} personnelList={[]} pieceworkTasksList={[]} onUpdate={vi.fn()} />);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('دسترسی ندارید'));
  });
});
