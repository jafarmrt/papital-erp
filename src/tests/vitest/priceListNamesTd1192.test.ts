import { describe, expect, it } from 'vitest';
import { priceListNamesError } from '../../lib/settings/settingValues';

// v10.0.95 (TD-1192): a price list name with a Latin comma or a repeated name is refused, not saved as extra lists
const RETAIL = 'قیمت خرده‌فروشی';

describe('priceListNamesError (TD-1192)', () => {
  it('accepts distinct names and ignores empty ones', () => {
    expect(priceListNamesError([RETAIL, 'عمده', ' ', ''])).toBeNull();
  });
  it('refuses a name with a Latin comma and names it', () => {
    expect(priceListNamesError([`${RETAIL}, ویژه`])).toContain(`${RETAIL}, ویژه`);
  });
  it('refuses a repeated name, ignoring spaces and letter case', () => {
    expect(priceListNamesError([RETAIL, ` ${RETAIL} `])).toContain(RETAIL);
    expect(priceListNamesError(['Retail', 'retail'])).not.toBeNull();
  });
  it('accepts a Latin comma in a name of the JSON list, still refusing a repeat (OBS-R1-71)', () => {
    expect(priceListNamesError([`${RETAIL}, ویژه`, 'عمده'], { allowLatinComma: true })).toBeNull();
    expect(priceListNamesError(['Retail', 'retail'], { allowLatinComma: true })).not.toBeNull();
  });
});
