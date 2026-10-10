import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { allocationsForCostAccess, materialCostPerUnit, projectMaterialCost } from '../../lib/inventory/projectMaterialCost';

const fetchJson = vi.fn(async (_url: string) => ({ allocations: [] as unknown[] }));
vi.mock('../../api', () => ({ fetchJson: (url: string) => fetchJson(url) }));
vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await import('../../lib/rialDisplay');
  return { useRialDisplay: () => rialDisplayOf('IRR') };
});

import { ProjectMaterialCostNote } from '../../components/project/ProjectMaterialCostNote';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const TOTAL_LABEL = 'جمع بهای مواد تخصیص‌یافته به پروژه:';
const TOTAL_TEXT = '۱٬۶۶۰٬۰۰۰ ریال';
const PER_UNIT_TEXT = '۸۳٬۰۰۰ ریال';
const LEGACY_TEXT = 'تخصیص قدیمی بها ندارد';

// v10.0.90 (TD-1210): the delivery tab shows the project's material cost so the unit cost is written from the same tab
describe('project material cost (TD-1210)', () => {
  it('sums the cost of allocations that are not released and counts those without a cost', () => {
    const summary = projectMaterialCost([
      { status: 'allocated', cost: 1_000_000 },
      { status: 'consumed', cost: 660_000 },
      { status: 'released', cost: 500_000 },
      { status: 'allocated', cost: null },
    ]);
    expect(summary).toEqual({ total: 1_660_000, counted: 2, withoutCost: 1 });
  });

  it('gives a unit cost only for a positive quantity and total', () => {
    expect(materialCostPerUnit(1_660_000, 20)).toBe(83_000);
    expect(materialCostPerUnit(1_660_000, 0)).toBeNull();
    expect(materialCostPerUnit(0, 20)).toBeNull();
  });

  it('removes the cost for a reader without an item cost permission', () => {
    const rows = [{ id: 1, status: 'allocated', cost: 10 }];
    expect(allocationsForCostAccess(rows, true)).toEqual(rows);
    expect(allocationsForCostAccess(rows, false)).toEqual([{ id: 1, status: 'allocated' }]);
  });

  it('shows the total and the unit cost of a single-product project', async () => {
    fetchJson.mockResolvedValueOnce({ allocations: [{ status: 'allocated', cost: 1_000_000 }, { status: 'allocated', cost: 660_000 }, { status: 'allocated', cost: null }] });
    render(<ProjectMaterialCostNote projectId={7} singleProductQuantity={20} />);
    expect(await screen.findByText(TOTAL_LABEL)).toBeTruthy();
    expect(fetchJson).toHaveBeenCalledWith('/inventory/allocations?projectId=7');
    expect(screen.getByText(TOTAL_TEXT)).toBeTruthy();
    expect(screen.getByText(PER_UNIT_TEXT)).toBeTruthy();
    expect(screen.getByText(content => content.includes(LEGACY_TEXT))).toBeTruthy();
  });

  it('shows no unit cost for a project with several products and nothing without allocations', async () => {
    fetchJson.mockResolvedValueOnce({ allocations: [{ status: 'allocated', cost: 1_660_000 }] });
    const { unmount } = render(<ProjectMaterialCostNote projectId={7} singleProductQuantity={null} />);
    expect(await screen.findByText(TOTAL_TEXT)).toBeTruthy();
    expect(screen.queryByText(PER_UNIT_TEXT)).toBeNull();
    unmount();
    fetchJson.mockResolvedValueOnce({ allocations: [] });
    render(<ProjectMaterialCostNote projectId={8} singleProductQuantity={20} />);
    await vi.waitFor(() => expect(fetchJson).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(TOTAL_LABEL)).toBeNull();
  });
});
