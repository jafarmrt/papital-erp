import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ProcurementStatusCell } from '../../components/project/inventoryRowCells';

afterEach(() => { cleanup(); });

// v10.0.146 (TD-1214): the status of a row short of stock is never «available»
describe('project form fixes (TD-1214)', () => {
  it('TD-1214: a short row does not show «available» in its status', () => {
    render(<table><tbody><tr><ProcurementStatusCell status="available" onChange={() => undefined} shortfall={3} unit="pcs" /></tr></tbody></table>);
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('needs_procurement');
  });

  it('TD-1214: a row without a shortfall keeps its stored status', () => {
    render(<table><tbody><tr><ProcurementStatusCell status="available" onChange={() => undefined} shortfall={0} unit="pcs" /></tr></tbody></table>);
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('available');
  });
});
