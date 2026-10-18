import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MaterialStatusCell } from '../../components/project/inventoryRowCells';
import type { MaterialRowState } from '../../lib/projects/materialAvailability';

afterEach(() => { cleanup(); });

const AVAILABLE_TEXT = '✓ موجود';
const SHORT_TEXT = '⚠ کسری';

const shortState: MaterialRowState = { kind: 'short', itemId: 1, free: 2, issued: 0, shortQty: 3, unit: 'pcs' };
const availableState: MaterialRowState = { kind: 'available', itemId: 1, free: 9, issued: 0, unit: 'pcs' };

// v10.0.146 (TD-1214): the status of a row short of stock is never «available».
// v10.2.2 (TD-1290): the status comes from the free stock rule and is no longer a list, so «available» cannot be picked on a short row.
describe('project form fixes (TD-1214)', () => {
  it('TD-1214: a short row does not show «available» in its status, whatever was stored', () => {
    render(<table><tbody><tr><MaterialStatusCell state={shortState} status="ready" procurementStatus="pending" onProcurementChange={() => undefined} /></tr></tbody></table>);
    expect(screen.queryByText(AVAILABLE_TEXT)).toBeNull();
    expect(screen.getByText(SHORT_TEXT)).toBeTruthy();
    expect(screen.queryByRole('option', { name: /موجود/ })).toBeNull();
  });

  it('TD-1214: a row with enough free stock shows «available» and offers no order status', () => {
    render(<table><tbody><tr><MaterialStatusCell state={availableState} status="ready" onProcurementChange={() => undefined} /></tr></tbody></table>);
    expect(screen.getByText(AVAILABLE_TEXT)).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
