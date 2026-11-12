// @vitest-environment node
/**
 * v11 phase 8.2a (docs/roadmap/V11_STOREFRONT_8_2_START_PLAN.md §4–§5): the order rules shared by the server, the ERP
 * orders page and the site app: the buyer's mobile, postal code, card digits and bank reference in any digits, the cart
 * lines, the text fields, tomans, and the fulfilment steps.
 */
import { describe, expect, it } from 'vitest';
import {
  EXPIRING_ORDER_STATUSES, NEXT_FULFILMENT, OPEN_ORDER_STATUSES, ORDER_LINES_MAX, ORDER_STATUSES, ORDER_STATUS_TITLES, PAYMENT_METHODS,
  PAYMENT_METHOD_TITLES, RETAIL_LINE_CAP_MESSAGE, RETAIL_LINE_QUANTITY_MAX, cartLinesError, cleanText, retailLineOverCap, isIranProvince, payableWith, isOrderStatus, isPaymentMethod, normalizeCardLast4, normalizeMobile, normalizePostalCode, normalizeReference, tomanText,
} from '../../lib/storefront/storefrontOrderRules';

describe('normalizeMobile', () => {
  it('reads every common way of writing an Iranian mobile, in Persian or Latin digits', () => {
    for (const raw of ['09121234567', '+989121234567', '00989121234567', '989121234567', '9121234567', '۰۹۱۲ ۱۲۳ ۴۵۶۷', '0912-123-4567']) {
      expect(normalizeMobile(raw)).toBe('09121234567');
    }
  });
  it('refuses a landline, a short number and text', () => {
    for (const raw of ['02112345678', '0912123456', '091212345678', 'abc', '']) expect(normalizeMobile(raw)).toBeNull();
  });
});

describe('postal code, card digits and reference', () => {
  it('reads a ten-digit postal code with spaces, hyphens or Persian digits', () => {
    expect(normalizePostalCode('۱۲۳۴۵-۶۷۸۹۰')).toBe('1234567890');
    expect(normalizePostalCode('12345 6789')).toBeNull();
  });
  it('takes exactly four card digits', () => {
    expect(normalizeCardLast4('۱۲۳۴')).toBe('1234');
    expect(normalizeCardLast4('123')).toBeNull();
    expect(normalizeCardLast4('12345')).toBeNull();
  });
  it('takes a reference of 4 to 40 Latin letters, digits or hyphens and nothing that could carry markup', () => {
    expect(normalizeReference('۱۲۳ ۴۵۶')).toBe('123456');
    expect(normalizeReference('AB-12')).toBe('AB-12');
    expect(normalizeReference('123')).toBeNull();
    expect(normalizeReference('12<script>')).toBeNull();
    expect(normalizeReference('1'.repeat(41))).toBeNull();
  });
});

describe('cartLinesError', () => {
  it('accepts distinct items with whole quantities 1..99', () => {
    expect(cartLinesError([{ slug: 'a', quantity: 1 }, { slug: 'b', quantity: 99 }])).toBeNull();
  });
  it('refuses an empty cart, a repeated item, a zero, a fraction, 100 and too many lines', () => {
    expect(cartLinesError([])).not.toBeNull();
    expect(cartLinesError([{ slug: 'a', quantity: 1 }, { slug: 'a', quantity: 2 }])).not.toBeNull();
    for (const quantity of [0, -1, 1.5, 100]) expect(cartLinesError([{ slug: 'a', quantity }])).not.toBeNull();
    const many = Array.from({ length: ORDER_LINES_MAX + 1 }, (_, i) => ({ slug: `s${i}`, quantity: 1 }));
    expect(cartLinesError(many)).not.toBeNull();
  });
});

describe('text, provinces, tomans and steps', () => {
  it('folds spaces, keeps paragraph breaks only when asked, and refuses empty or long text', () => {
    expect(cleanText('  علی   رضایی \n ', 80)).toBe('علی رضایی');
    expect(cleanText('خط ۱\n\n\n\nخط ۲', 80, { multiline: true })).toBe('خط ۱\n\nخط ۲');
    expect(cleanText('   ', 80)).toBeNull();
    expect(cleanText('x'.repeat(81), 80)).toBeNull();
  });
  it('knows the provinces by their Persian names only', () => {
    expect(isIranProvince('تهران')).toBe(true);
    expect(isIranProvince('Tehran')).toBe(false);
  });
  it('shows whole rials as tomans', () => {
    expect(tomanText('13000000')).toBe('1300000');
    expect(tomanText('5')).toBe('0');
    expect(tomanText('0')).toBe('0');
    expect(tomanText('x')).toBe('');
  });
  it('titles every status and moves paid (or confirmed) → shipped → delivered only', () => {
    for (const status of ORDER_STATUSES) expect(ORDER_STATUS_TITLES[status]).toBeTruthy();
    expect(isOrderStatus('paid')).toBe(true);
    expect(isOrderStatus('refunded')).toBe(false);
    expect(NEXT_FULFILMENT).toEqual({ paid: 'shipped', confirmed: 'shipped', shipped: 'delivered' });
  });
});

describe('storefront order rules, 8.2b part 2', () => {
  it('ships a confirmed on-account order like a paid one, and expires an unconfirmed one like an unpaid one', () => {
    expect(NEXT_FULFILMENT.confirmed).toBe('shipped');
    expect(EXPIRING_ORDER_STATUSES).toEqual(['awaiting_payment', 'awaiting_approval']);
    expect(OPEN_ORDER_STATUSES).toContain('awaiting_approval');
    expect(PAYMENT_METHODS.every(m => PAYMENT_METHOD_TITLES[m])).toBe(true);
    expect(isPaymentMethod('on_account')).toBe(true);
    expect(isPaymentMethod('credit')).toBe(false);
  });
});


describe('the retail cap (v12 phase 7, site review 2.10)', () => {
  it('lets a retail buyer order five of an item and names the first line above it', () => {
    expect(RETAIL_LINE_QUANTITY_MAX).toBe(5);
    expect(retailLineOverCap([{ slug: 'a', quantity: 5 }, { slug: 'b', quantity: 1 }])).toBeNull();
    expect(retailLineOverCap([{ slug: 'a', quantity: 1 }, { slug: 'b', quantity: 6 }, { slug: 'c', quantity: 9 }])).toBe('b');
  });
  it('says the cap in Persian digits and points to the shop for more', () => {
    expect(RETAIL_LINE_CAP_MESSAGE).toContain('۵');
    expect(RETAIL_LINE_CAP_MESSAGE).toContain('با فروشگاه تماس بگیرید');
  });
});

// v12 phase 8a (site review 2.4): the one sum the checkout's summary and the placed order both show
describe('payableWith', () => {
  it('adds a costed method, never a paid-on-delivery one, after the discount', () => {
    expect(payableWith('4350000', '0', { kind: 'cost', amount: '500000' })).toBe('4850000');
    expect(payableWith('4350000', '435000', { kind: 'cost', amount: '500000' })).toBe('4415000');
    expect(payableWith('4350000', '435000', { kind: 'on_delivery', amount: '900000' })).toBe('3915000');
    expect(payableWith('4350000', '0', { kind: 'cost', amount: '0' })).toBe('4350000');
  });

  it('keeps whole rial past the safe range of a JavaScript number', () => {
    expect(payableWith('9007199254740993', '1', { kind: 'cost', amount: '10' })).toBe('9007199254741002');
  });
});
