
/**
 * v10.0.25 (N-05 PR 2): the item form's product card. The form holds text; the payload sends every card key, so an emptied
 * field clears its value, and a new product left without a design year or transfer code takes the ones its code carries
 * (the server's `withCodeCard`).
 */
export interface ProductCardFormData {
  collections: string;
  designYear: string;
  transferCode: string;
  productDescription: string;
  technicalNotes: string;
}

export const EMPTY_PRODUCT_CARD: ProductCardFormData = {
  collections: '', designYear: '', transferCode: '', productDescription: '', technicalNotes: '',
};

export function productCardFormOf(item: {
  collections?: string[] | null; designYear?: number | null; transferCode?: string | null;
  productDescription?: string | null; technicalNotes?: string | null;
}): ProductCardFormData {
  return {
    collections: (item.collections ?? []).join('، '),
    designYear: item.designYear ? String(item.designYear) : '',
    transferCode: item.transferCode ?? '',
    productDescription: item.productDescription ?? '',
    technicalNotes: item.technicalNotes ?? '',
  };
}

export function productCardPayload(card: ProductCardFormData) {
  return {
    collections: card.collections.split(/[،,;\n]/).map(c => c.trim()).filter(Boolean),
    design_year: card.designYear.trim() || null,
    transfer_code: card.transferCode.trim() || null,
    product_description: card.productDescription.trim() || null,
    technical_notes: card.technicalNotes.trim() || null,
  };
}
