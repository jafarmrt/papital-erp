import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { stockPercentOf, stockStatusOf, toPurchaseModalItem, type ReorderItem } from '../../lib/reorderAlerts/reorderItems';
import { ReorderItemRow } from '../../components/reorder/ReorderItemRow';
import { MATERIALS_THEME } from '../../components/reorder/reorderSectionThemes';

afterEach(() => cleanup());

// A 10 in stock, 8 reserved, 5 on open purchases, reorder point 5 (the server row of v9.0.404)
const item: ReorderItem = {
  id: 1, code: 'R-1', name: 'مهره سفید', type: 'raw_material', unit: 'عدد', category: 'مهره', current_stock: 10, reserved_qty: 8,
  free_stock: 2, in_transit_qty: 5, reorder_point: 5, weighted_average_cost: 1000, deficit: 3, deficit_value: 3000, is_zero_stock: false,
};

// v9.0.404 (TD-843، تصمیم ت۷ «الف»): صفحه هشدار موجودی آزاد را نشان می‌دهد و با آن می‌سنجد (وضعیت، نوار، مودال سفارش) و
// «در راه» را فقط نمایش می‌دهد. پیش‌تر ستون «موجودی فعلی» موجودی کل بود.
describe('reorder alerts on free stock (TD-843)', () => {
  it('reads the status, the bar and the order form from free stock', () => {
    expect(stockStatusOf({ ...item, free_stock: 0 })).toBe('zero');
    expect(stockStatusOf(item)).toBe('below_reorder');
    expect(stockPercentOf(item)).toBe(40);
    expect(toPurchaseModalItem(item)).toMatchObject({ current_stock: 2, deficit: 3, orderQty: 3 });
  });

  it('shows free stock, the reserved quantity and the quantity in transit', () => {
    render(
      <table><tbody>
        <ReorderItemRow item={item} theme={MATERIALS_THEME} isSelected={false} onToggle={vi.fn()} onAction={vi.fn()} onEditReorderPoint={vi.fn()} />
      </tbody></table>,
    );
    expect(screen.getByText('۲ عدد')).toBeTruthy();
    expect(screen.getByText('موجودی ۱۰، رزروشده ۸')).toBeTruthy();
    // the reorder point and the quantity in transit
    expect(screen.getAllByText('۵ عدد', { selector: 'td' })).toHaveLength(2);
  });
});
