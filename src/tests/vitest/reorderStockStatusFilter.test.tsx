import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { filterReorderItems, type ReorderItem } from '../../lib/reorderAlerts/reorderItems';
import { ReorderFiltersBar } from '../../components/reorder/ReorderFiltersBar';

afterEach(() => cleanup());

const item = (id: number, code: string, stock: number): ReorderItem => ({
  id, code, name: `کالا ${code}`, type: 'raw_material', unit: 'عدد', category: 'سنگ', current_stock: stock, reorder_point: 5,
  weighted_average_cost: 1000, deficit: 5 - stock, deficit_value: (5 - stock) * 1000, is_zero_stock: stock <= 0,
});
const items = [item(1, 'C1', 0), item(2, 'C2', 3), item(3, 'C3', 5)];
const codes = (status: 'all' | 'zero' | 'below_reorder') =>
  filterReorderItems(items, { stockStatusFilter: status, selectedCategory: 'all', search: '' }).map(i => i.code);

// v9.0.382 (TD-827، یافته B07-11، تصمیم ت۸): «زیر نقطه سفارش» کالاهای دارای موجودی تا نقطه سفارش را نشان می‌دهد. پیش‌تر شرط
// وارونه بود و این گزینه همان کالاهای بی موجودی را نشان می‌داد (`below_reorder -> ["C1:0"]`).
describe('reorder alert stock status filter (TD-827)', () => {
  it('shows each status once', () => {
    expect(codes('all')).toEqual(['C1', 'C2', 'C3']);
    expect(codes('zero')).toEqual(['C1']);
    expect(codes('below_reorder')).toEqual(['C2', 'C3']);
  });

  it('labels the three options as decided', () => {
    render(
      <ReorderFiltersBar
        search="" onSearchChange={vi.fn()} stockStatusFilter="all" onStockStatusChange={vi.fn()} selectedCategory="all"
        onCategoryChange={vi.fn()} categories={[]} filteredCount={3} materialsCount={3} productsCount={0} onClear={vi.fn()}
      />,
    );
    const options = Array.from((screen.getByLabelText('وضعیت موجودی') as HTMLSelectElement).options).map(o => o.textContent);
    expect(options).toEqual(['همه', 'بی موجودی', 'زیر نقطه سفارش']);
  });
});
