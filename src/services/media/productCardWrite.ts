import { ValidationError } from '../../errors/customErrors.js';
import {
  PRODUCT_CARD_LIMITS, PRODUCT_CARD_TEXT, normalizeCollections, parseCardText, parseDesignYear, productCardFromCode,
  type ProductCardResult,
} from '../../lib/media/productCard.js';

/**
 * v10.0.17 (N-05 PR 2): the product card fields of an item write (item form, Excel import, media library product page).
 * A key missing from the input keeps the stored value; an empty value clears it; an invalid value refuses the write with
 * 422 `PRODUCT_CARD_INVALID` naming the field, before anything is written.
 */
export interface ProductCardInput {
  collections?: unknown;
  design_year?: unknown;
  transfer_code?: unknown;
  product_description?: unknown;
  technical_notes?: unknown;
}

export interface ProductCardValues {
  collections?: string[];
  designYear?: number | null;
  transferCode?: string | null;
  productDescription?: string | null;
  technicalNotes?: string | null;
}

export const PRODUCT_CARD_INPUT_KEYS = ['collections', 'design_year', 'transfer_code', 'product_description', 'technical_notes'] as const;

function take<T>(result: ProductCardResult<T>): T {
  if (!result.ok) throw new ValidationError(result.error, undefined, 'PRODUCT_CARD_INVALID');
  return result.value;
}

/** Only the keys present in the input, ready for `items` insert or update */
export function productCardValues(input: ProductCardInput): ProductCardValues {
  const out: ProductCardValues = {};
  if (input.collections !== undefined) out.collections = take(normalizeCollections(input.collections ?? []));
  if (input.design_year !== undefined) out.designYear = take(parseDesignYear(input.design_year));
  if (input.transfer_code !== undefined) {
    out.transferCode = take(parseCardText(input.transfer_code, PRODUCT_CARD_LIMITS.transferCode, PRODUCT_CARD_TEXT.transferCodeTooLong));
  }
  if (input.product_description !== undefined) {
    out.productDescription = take(parseCardText(input.product_description, PRODUCT_CARD_LIMITS.text, PRODUCT_CARD_TEXT.textTooLong));
  }
  if (input.technical_notes !== undefined) {
    out.technicalNotes = take(parseCardText(input.technical_notes, PRODUCT_CARD_LIMITS.text, PRODUCT_CARD_TEXT.textTooLong));
  }
  return out;
}

/**
 * The product card of a new item: the values sent, and for a product without a design year or transfer code the ones its
 * code carries (`productCardFromCode`, the rule migration 0097 filled existing products with).
 */
export function newItemProductCard(type: string, code: string, input: ProductCardInput): ProductCardValues {
  return withCodeCard(type, code, productCardValues(input));
}

/** Card values of a new item completed from its code (product only); shared by the item form and the Excel import */
export function withCodeCard(type: string, code: string, card: ProductCardValues): ProductCardValues {
  const values = { ...card };
  if (type !== 'product') return values;
  const fromCode = productCardFromCode(code);
  // an empty field of the item form (null) counts as missing for a new product
  if (values.designYear == null && fromCode.designYear !== null) values.designYear = fromCode.designYear;
  if (values.transferCode == null && fromCode.transferCode !== null) values.transferCode = fromCode.transferCode;
  return values;
}
