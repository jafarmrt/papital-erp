import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DocumentDetailsPreview } from '../../components/approval/DocumentDetailsPreview';

// v10.0.92 (TD-1175): the warehouse approval window shows each outgoing line's source warehouse, stock and sellable quantity
const WAREHOUSE_NAME = 'انبار مرکزی';
const SOURCE_HEADER = 'انبار مبدأ';
const STOCK_CELL = '۵ / ۳';

afterEach(cleanup);

const doc = {
  id: 7, refNumber: 'R-7', buyerName: 'x', currency: 'IRR',
  items: [{ item_id: 11, location: 'main', item_name: 'item a', quantity: 8, unit_price: 1000 }],
};

describe('approval window line stock (TD-1175)', () => {
  it('shows the source warehouse and a short sellable quantity in red', () => {
    const lineStock = [{ itemId: 11, location: 'main', warehouseName: WAREHOUSE_NAME, requested: 8, locationStock: 5, reservedForOthers: 2, sellable: 3 }];
    render(<DocumentDetailsPreview docDetails={{ ...doc, lineStock }} isLoadingDoc={false} />);
    expect(screen.getByText(SOURCE_HEADER)).toBeTruthy();
    expect(screen.getByText(WAREHOUSE_NAME)).toBeTruthy();
    expect(screen.getByText(STOCK_CELL).className).toContain('text-rose-600');
  });
  it('an incoming document has no stock columns', () => {
    render(<DocumentDetailsPreview docDetails={doc} isLoadingDoc={false} />);
    expect(screen.queryByText(SOURCE_HEADER)).toBeNull();
  });
});
