import { afterEach, describe, expect, it } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ProjectProductsForm } from '../../components/project-modal/ProjectProductsForm';
import type { ProductRow } from '../../components/project-modal/types';

afterEach(() => { cleanup(); });

const QTY_LABEL = 'تعداد / تیراژ';

function ProductsHarness() {
  const [rows, setRows] = useState<ProductRow[]>([{ id: 'r1', item_id: null, item_code: '', item_name: '', customer_code: '', quantity: 1, unit: 'pcs', needs_assembly: false } as unknown as ProductRow]);
  return (
    <>
      <ProjectProductsForm productsList={rows} activeItemsList={[]} getOptionalStageNames={() => []} onAddProductRow={() => undefined} onRemoveProductRow={() => undefined}
        onUpdateProductRow={(idx, field, value) => setRows(prev => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)))} />
      <output data-testid="stored-qty">{String(rows[0].quantity)}</output>
    </>
  );
}

const quantityInput = () => (screen.getByText(QTY_LABEL).parentElement?.parentElement?.querySelector('input') as HTMLInputElement);

// v10.0.145 (TD-1213): the project quantity field shows what the user types
describe('project form fixes (TD-1213)', () => {
  it('TD-1213: the quantity field can be emptied and then takes the typed number', () => {
    render(<ProductsHarness />);
    fireEvent.change(quantityInput(), { target: { value: '' } });
    expect(quantityInput().value).toBe('');
    fireEvent.change(quantityInput(), { target: { value: '20' } });
    expect(quantityInput().value).toBe('20');
    expect(screen.getByTestId('stored-qty').textContent).toBe('20');
  });

  it('TD-1213: a zero quantity is shown as typed, never turned into 1', () => {
    render(<ProductsHarness />);
    fireEvent.change(quantityInput(), { target: { value: '0' } });
    expect(quantityInput().value).toBe('0');
    expect(screen.getByTestId('stored-qty').textContent).not.toBe('1');
  });
});
