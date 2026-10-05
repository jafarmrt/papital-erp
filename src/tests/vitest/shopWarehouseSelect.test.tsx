import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ShopWarehouseSelect } from '../../components/settings/ShopWarehouseSelect';

afterEach(cleanup);

// v8.0.44 (TD-293، تصمیم مالک محصول — گزینه الف): تنظیم «انبار فروشگاه اینترنتی» در تب ووکامرس
describe('online shop warehouse select (TD-293)', () => {
  const warehouses = [
    { id: 1, code: 'WH1', name: 'انبار مرکزی', is_active: 1 },
    { id: 2, code: 'SHOP', name: 'انبار فروشگاه', is_active: 1 },
    { id: 3, code: 'OLD', name: 'انبار بسته', is_active: 0 },
  ];

  it('offers the default warehouse and the active warehouses only', () => {
    render(<ShopWarehouseSelect value="" onChange={() => undefined} warehouses={warehouses} />);
    const options = Array.from(screen.getByLabelText('انبار فروشگاه اینترنتی').querySelectorAll('option')).map(o => o.textContent);
    expect(options).toEqual(['انبار پیش‌فرض سیستم', 'انبار مرکزی (WH1)', 'انبار فروشگاه (SHOP)']);
  });

  it('reports the chosen warehouse code', () => {
    const onChange = vi.fn();
    render(<ShopWarehouseSelect value="" onChange={onChange} warehouses={warehouses} />);
    fireEvent.change(screen.getByLabelText('انبار فروشگاه اینترنتی'), { target: { value: 'SHOP' } });
    expect(onChange).toHaveBeenCalledWith('SHOP');
  });
});
