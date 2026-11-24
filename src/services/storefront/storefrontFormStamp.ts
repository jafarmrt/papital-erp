import crypto from 'crypto';
import type { FormField } from '../../lib/storefront/storefrontFormRules.js';

/**
 * v12 phase 10f (review of #505, M1 and L2): the stamp of a form as a visitor fills it in. The answers a visitor sends
 * are named by the form's field ids (f1, f2, …), which say which field only of one form as it was drawn, so every send
 * carries the stamp of the form it was written for and a send under another stamp is refused.
 *
 * The stamp is of the form itself and of what gives an answer its meaning: when the row was made, its key, its title
 * and each field's id, kind, name, «اجباری» and options. So a form made again under a freed key has another stamp
 * whatever its version, and a change that touches no field (the words above the form, the button, the switches that put
 * it on the site or open a sales lead) leaves the stamp, and a visitor who is writing, alone. It holds no row id and is
 * not a secret: it goes out with the form to every visitor.
 */
export const FORM_STAMP = /^[0-9a-f]{32}$/;

export function formStampOf(row: { createdAt: string; key: string; title: string; fields: unknown }): string {
  const fields = (Array.isArray(row.fields) ? row.fields as FormField[] : []).map(field => [field.id, field.kind, field.label, field.required === true, Array.isArray(field.options) ? field.options : []]);
  return crypto.createHash('sha256').update(JSON.stringify([Date.parse(row.createdAt), row.key, row.title, fields]), 'utf8').digest('hex').slice(0, 32);
}
