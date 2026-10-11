import { describe, expect, it } from 'vitest';
import { normalizeCollections, parseDesignYear, productCardFromCode, PRODUCT_CARD_TEXT } from '../../lib/media/productCard';
import { productCardFormOf, productCardPayload } from '../../lib/media/productCardForm';

describe('product card of the media library (N-05 PR 2)', () => {
  it('normalizes collections: trims, folds spaces, drops empties and case-insensitive repeats', () => {
    expect(normalizeCollections(' Lotus ،  بهار  نو,lotus;;')).toEqual({ ok: true, value: ['Lotus', 'بهار نو'] });
    expect(normalizeCollections(['a', '', 'A', 'b'])).toEqual({ ok: true, value: ['a', 'b'] });
  });

  it('refuses more than 20 collections or a name above 60 characters', () => {
    expect(normalizeCollections(Array.from({ length: 21 }, (_, i) => `c${i}`))).toEqual({ ok: false, error: PRODUCT_CARD_TEXT.collectionsTooMany });
    expect(normalizeCollections(['x'.repeat(61)])).toEqual({ ok: false, error: PRODUCT_CARD_TEXT.collectionTooLong });
  });

  it('reads a design year with Persian digits and refuses other years', () => {
    expect(parseDesignYear('۱۴۰۴')).toEqual({ ok: true, value: 1404 });
    expect(parseDesignYear('')).toEqual({ ok: true, value: null });
    expect(parseDesignYear('2026').ok).toBe(false);
    expect(parseDesignYear('140').ok).toBe(false);
  });

  it('takes design year and transfer code from a product code', () => {
    expect(productCardFromCode(' 1404-N-101-01 ')).toEqual({ designYear: 1404, transferCode: '101' });
    expect(productCardFromCode('B-101')).toEqual({ designYear: null, transferCode: null });
    expect(productCardFromCode('2026-N-101-01')).toEqual({ designYear: null, transferCode: null });
  });

  it('round-trips the item form fields and sends empty fields as null', () => {
    const form = productCardFormOf({ collections: ['لوتوس', 'بهار'], designYear: 1403, transferCode: '101' });
    expect(form.collections).toBe('لوتوس، بهار');
    expect(productCardPayload({ ...form, technicalNotes: '  ' })).toEqual({
      collections: ['لوتوس', 'بهار'], design_year: '1403', transfer_code: '101', product_description: null, technical_notes: null,
    });
  });
});
