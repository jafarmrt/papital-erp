// @vitest-environment node
/**
 * v11 phase 8.1 (docs/roadmap/V11_STOREFRONT_START_PLAN.md): the storefront rules shared by the server, the ERP tab and
 * the site app: the card and IBAN checks, the addresses, the rial amounts, the stock status and the shipping quote.
 */
import { describe, expect, it } from 'vitest';
import {
  cardNumberError, ibanError, isProvince, maxOrderQuantity, normalizeIban, rialAmountText, shippingCodeError, shippingQuote,
  slugError, stockStatusOf, suggestedSlug, normalizeWhatsappNumber, whatsappNumberError, brandImageError, base64Bytes, type ShippingMethodRule,
} from '../../lib/storefront/storefrontRules';
import { sitePrice } from '../../services/storefront/storefrontItemData';

describe('storefront payment details', () => {
  it('accepts a 16-digit card with a valid check digit, in Persian digits and with separators', () => {
    expect(cardNumberError('6037991234567893')).toBeNull();
    expect(cardNumberError('۶۰۳۷-۹۹۱۲-۳۴۵۶-۷۸۹۳')).toBeNull();
    expect(cardNumberError('')).toBeNull();
  });

  it('refuses a card of another length or a wrong check digit', () => {
    expect(cardNumberError('603799123456789')).toContain('۱۶ رقم');
    expect(cardNumberError('6037991234567894')).toContain('درست نیست');
  });

  it('checks an Iranian IBAN with or without IR and reads it upper-case', () => {
    expect(ibanError('IR050170000000123456789012')).toBeNull();
    expect(ibanError('050170000000123456789012')).toBeNull();
    expect(normalizeIban('ir05 0170 0000 0012 3456 7890 12')).toBe('IR050170000000123456789012');
    expect(ibanError('IR060170000000123456789012')).toContain('درست نیست');
    expect(ibanError('IR0501700000001234')).toContain('۲۴ رقم');
    expect(ibanError('')).toBeNull();
  });
});

describe('storefront addresses and amounts', () => {
  it('takes lower-case latin words joined by single hyphens', () => {
    expect(slugError('yalda-box-2026')).toBeNull();
    expect(slugError('')).not.toBeNull();
    expect(slugError('Yalda')).not.toBeNull();
    expect(slugError('yalda--box')).not.toBeNull();
    expect(slugError('-yalda')).not.toBeNull();
    expect(slugError('a'.repeat(121))).not.toBeNull();
    expect(shippingCodeError('snapp-box')).toBeNull();
    expect(shippingCodeError('Snapp Box')).not.toBeNull();
  });

  it('suggests an address from the item code', () => {
    expect(suggestedSlug('PG-۱۲۳ / A')).toBe('pg-123-a');
    expect(suggestedSlug('---')).toBe('');
  });

  it('reads whole rial amounts with Persian digits and separators, never a fraction or a sign', () => {
    expect(rialAmountText('۱٬۲۰۰٬۰۰۰', { allowZero: false })).toBe('1200000');
    expect(rialAmountText('1,500,000', { allowZero: false })).toBe('1500000');
    expect(rialAmountText(250000, { allowZero: false })).toBe('250000');
    expect(rialAmountText('0', { allowZero: false })).toBeNull();
    expect(rialAmountText('0', { allowZero: true })).toBe('0');
    expect(rialAmountText('12.5', { allowZero: false })).toBeNull();
    expect(rialAmountText('-5', { allowZero: true })).toBeNull();
    expect(rialAmountText('1'.repeat(15), { allowZero: false })).toBeNull();
  });

  it('offers a price only in whole rials above zero', () => {
    expect(sitePrice('1200000.0000', 'IRR')).toBe('1200000');
    expect(sitePrice('1200000', null)).toBe('1200000');
    expect(sitePrice('1200000.5000', 'IRR')).toBeNull();
    expect(sitePrice('0', 'IRR')).toBeNull();
    expect(sitePrice('100', 'USD')).toBeNull();
  });

  it('knows the 31 provinces and the empty «every other province»', () => {
    expect(isProvince('تهران')).toBe(true);
    expect(isProvince('')).toBe(true);
    expect(isProvince('Tehran')).toBe(false);
  });
});

describe('storefront stock', () => {
  it('reads out, low and in stock with the threshold of the settings', () => {
    expect(stockStatusOf(0)).toBe('out');
    expect(stockStatusOf(-2)).toBe('out');
    expect(stockStatusOf(3)).toBe('low');
    expect(stockStatusOf(4)).toBe('in_stock');
    expect(stockStatusOf(5, 5)).toBe('low');
    expect(stockStatusOf(1, 0)).toBe('in_stock');
  });

  it('lets a buyer order whole units only', () => {
    expect(maxOrderQuantity(2.75)).toBe(2);
    expect(maxOrderQuantity(-1)).toBe(0);
    expect(maxOrderQuantity(Number.NaN)).toBe(0);
  });
});

describe('shipping quote', () => {
  const table: ShippingMethodRule = {
    pricing: 'table', flatRate: '0', isFreeShippingEligible: true,
    rates: [
      { province: 'تهران', maxWeightGrams: 1000, rate: '400000' },
      { province: 'تهران', maxWeightGrams: null, rate: '700000' },
      { province: '', maxWeightGrams: 2000, rate: '900000' },
    ],
  };
  const cart = (province: string, weightGrams: number, subtotal = '1000000') => ({ province, weightGrams, subtotal });

  it('picks the lightest row of the province that holds the weight, then the row of every other province', () => {
    expect(shippingQuote(table, cart('تهران', 800), '')).toEqual({ kind: 'cost', amount: '400000', free: false });
    expect(shippingQuote(table, cart('تهران', 5000), '')).toEqual({ kind: 'cost', amount: '700000', free: false });
    expect(shippingQuote(table, cart('فارس', 1500), '')).toEqual({ kind: 'cost', amount: '900000', free: false });
    expect(shippingQuote(table, cart('فارس', 2500), '')).toEqual({ kind: 'unavailable' });
  });

  it('is free above the threshold only for an eligible method', () => {
    expect(shippingQuote(table, cart('تهران', 800, '5000000'), '5000000')).toEqual({ kind: 'cost', amount: '0', free: true });
    expect(shippingQuote(table, cart('تهران', 800, '4999999'), '5000000')).toEqual({ kind: 'cost', amount: '400000', free: false });
    const flat: ShippingMethodRule = { pricing: 'flat', flatRate: '350000', isFreeShippingEligible: false, rates: [] };
    expect(shippingQuote(flat, cart('تهران', 800, '9000000'), '5000000')).toEqual({ kind: 'cost', amount: '350000', free: false });
  });

  it('leaves Snapp and courier to the buyer and pickup free', () => {
    expect(shippingQuote({ pricing: 'on_delivery', flatRate: '0', isFreeShippingEligible: false, rates: [] }, cart('تهران', 1), '')).toEqual({ kind: 'on_delivery' });
    expect(shippingQuote({ pricing: 'free', flatRate: '0', isFreeShippingEligible: false, rates: [] }, cart('تهران', 1), '')).toEqual({ kind: 'cost', amount: '0', free: true });
  });
});

describe('storefront WhatsApp number (8.3)', () => {
  it('keeps a mobile in the international form wa.me needs, from any common spelling', () => {
    for (const raw of ['09121234567', '۰۹۱۲ ۱۲۳ ۴۵۶۷', '+989121234567', '00989121234567', '989121234567']) {
      expect(normalizeWhatsappNumber(raw)).toBe('989121234567');
      expect(whatsappNumberError(raw)).toBeNull();
    }
  });

  it('allows no number and refuses a landline or a short number', () => {
    expect(normalizeWhatsappNumber('')).toBe('');
    expect(whatsappNumberError('')).toBeNull();
    expect(whatsappNumberError('02112345678')).not.toBeNull();
    expect(whatsappNumberError('0912123')).not.toBeNull();
  });
});

describe('storefront logo and browser icon (8.3)', () => {
  const decode = (b64: string): Uint8Array => Buffer.from(b64, 'base64');
  const svg = (text: string) => `data:image/svg+xml;base64,${Buffer.from(text).toString('base64')}`;
  const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const png = (bytes: number) => `data:image/png;base64,${Buffer.concat([PNG_HEAD, Buffer.alloc(bytes - PNG_HEAD.length, 7)]).toString('base64')}`;

  it('takes no image, a small PNG, WEBP and JPEG, and a plain SVG as drawing programs save it', () => {
    expect(brandImageError('', 'logo', decode)).toBeNull();
    expect(brandImageError(png(1000), 'favicon', decode)).toBeNull();
    expect(brandImageError(`data:image/webp;base64,${Buffer.from('RIFF\0\0\0\0WEBPVP8 ').toString('base64')}`, 'logo', decode)).toBeNull();
    expect(brandImageError(`data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]).toString('base64')}`, 'logo', decode)).toBeNull();
    expect(brandImageError(svg('<svg xmlns="http://www.w3.org/2000/svg"><use href="#a"/><circle r="4"/></svg>'), 'logo', decode)).toBeNull();
    const illustrator = '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">'
      + '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><style>.cls-1{fill:url(#g);}</style></defs>'
      + '<image xlink:href="data:image/png;base64,iVBORw0KGgo="/><rect class="cls-1" style="fill:url(#g)"/><settings/></svg>';
    expect(brandImageError(svg(illustrator), 'logo', decode)).toBeNull();
  });

  it('refuses another type, a too large file, and bitmap bytes that are not the declared type', () => {
    expect(brandImageError('data:text/html;base64,PGgxPg==', 'logo', decode)).not.toBeNull();
    expect(brandImageError('https://example.com/logo.png', 'logo', decode)).not.toBeNull();
    expect(brandImageError(png(101 * 1024), 'favicon', decode)).not.toBeNull();
    expect(brandImageError(png(101 * 1024), 'logo', decode)).toBeNull();
    const html = Buffer.from('<html><script>alert(1)</script></html>').toString('base64');
    for (const type of ['png', 'jpeg', 'webp']) expect(brandImageError(`data:image/${type};base64,${html}`, 'logo', decode)).not.toBeNull();
  });

  it('refuses an SVG with active content or outside links, however it is spelled', () => {
    for (const bad of [
      '<svg><script>alert(1)</script></svg>', '<svg onload="x()"></svg>', '<svg><a href="javascript:x"/></svg>',
      '<svg><image href="https://tracker.example/a.png"/></svg>', '<svg><foreignObject/></svg>',
      '<svg><s:script xmlns:s="http://www.w3.org/2000/svg">alert(1)</s:script></svg>',
      '<svg><a><animate attributeName="href" values="javascript&#58;alert(1)"/></a></svg>',
      '<svg><a><set attributeName="href" to="https://x.example"/></a></svg>',
      '<svg><style>@import url(https://x.example/a.css);</style></svg>',
      '<svg><rect style="fill:url(https://x.example/a.svg#p)"/></svg>',
      '<svg><image xlink:href="https://x.example/a.png"/></svg>',
      '<!DOCTYPE svg [<!ENTITY x "javascript">]><svg/>',
      '<svg><a x:onclick="y()"/></svg>',
    ]) {
      expect(brandImageError(svg(bad), 'logo', decode), bad).not.toBeNull();
    }
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<svg><script>alert(1)</script></svg>', 'utf16le')]);
    expect(brandImageError(`data:image/svg+xml;base64,${utf16.toString('base64')}`, 'logo', decode)).not.toBeNull();
  });

  it('counts the decoded bytes of base64 without decoding', () => {
    for (const n of [0, 1, 2, 3, 100, 1001]) expect(base64Bytes(Buffer.alloc(n).toString('base64'))).toBe(n);
  });
});
