import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { getSellableStock } from '../../lib/stockAvailability';
import { ITEM_PICK_WITH_RESERVED_URL, PICK_LIST_URLS } from '../../lib/permissions/pickLists';

// v10.0.251 (TD-1135): the sales invoice item picker read the plain pick list, which has no reservation, so «رزرو» was always 0
describe('reserved quantity in the sales invoice item picker (TD-1135)', () => {
  it('reads the pick list with reserved=1', () => {
    expect(ITEM_PICK_WITH_RESERVED_URL).toBe(`${PICK_LIST_URLS.items}?reserved=1`);
    const page = fs.readFileSync(path.resolve(__dirname, '../../pages/CreateInvoicePage.tsx'), 'utf8');
    expect(page).toContain('fetchUrl={ITEM_PICK_WITH_RESERVED_URL}');
    expect(page).not.toContain('fetchUrl={PICK_LIST_URLS.items}');
  });

  it('takes the reservation of a pick row into the sellable quantity', () => {
    const pick = { id: 1, current_stock: 10, stocks: { MAIN: 10 }, stock_MAIN: 10, reserved_stock: 3 };
    expect(getSellableStock(pick, 'MAIN')).toEqual({ loc: 10, total: 10, reserved: 3, sellable: 7 });
  });
});
