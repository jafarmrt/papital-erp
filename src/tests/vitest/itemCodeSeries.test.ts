import { describe, expect, it } from 'vitest';
import { itemCodeSeries } from '../../services/items/itemCodeCounter';

describe('itemCodeSeries (TD-656)', () => {
  it('reads the product series key and serial like the code counter', () => {
    expect(itemCodeSeries('product', '1404-n-101-07')).toEqual({ scope: 'product', counterKey: '1404|N|101', serial: 7 });
  });

  it('reads a raw material prefix with one or two dashes before the serial', () => {
    expect(itemCodeSeries('raw_material', 'B-H-012')).toEqual({ scope: 'raw_material', counterKey: 'B-H', serial: 12 });
    expect(itemCodeSeries('raw_material', 'b-h--101')).toEqual({ scope: 'raw_material', counterKey: 'B-H', serial: 101 });
  });

  it('returns null for codes outside the series formats', () => {
    expect(itemCodeSeries('product', 'ABC')).toBeNull();
    expect(itemCodeSeries('raw_material', '12-34')).toBeNull();
    expect(itemCodeSeries('raw_material', 'NOSERIAL')).toBeNull();
  });
});
