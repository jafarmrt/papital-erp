import { afterEach, describe, expect, it } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ItemWarehouseStockForm } from '../../components/items/form/ItemWarehouseStockForm';
import type { ItemFormData } from '../../components/items/form/types';

// Package 5 ledger (OBS-R1-77): the item form keeps each warehouse's opening stock under the warehouse code only.
// On v10.0.26 it also wrote the warehouse id, so the browser's total (sum of the map) counted every quantity twice.
const WAREHOUSES = [{ id: 1, name: 'انبار مرکزی', code: 'A' }, { id: 2, name: 'فروشگاه', code: 'B' }];
let latest: ItemFormData | null = null;

function Harness() {
  const [form, setForm] = useState({ stocks: {} } as unknown as ItemFormData);
  latest = form;
  return <ItemWarehouseStockForm warehouses={WAREHOUSES} form={form} setForm={setForm} />;
}

afterEach(() => {
  cleanup();
  latest = null;
});

describe('item form opening stock key (OBS-R1-77)', () => {
  it('stores each warehouse quantity once, under its code', () => {
    render(<Harness />);
    const inputs = screen.getAllByPlaceholderText('0');
    fireEvent.change(inputs[0], { target: { value: '10' } });
    fireEvent.change(inputs[1], { target: { value: '4' } });
    expect(latest?.stocks).toEqual({ A: 10, B: 4 });
    expect(Object.values(latest?.stocks ?? {}).reduce((sum, v) => sum + Number(v), 0)).toBe(14);
  });
});
