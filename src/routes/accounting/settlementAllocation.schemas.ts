/**
 * v11 phase 6.1t (M11 / U2, decision ت۵۲-۵): the Zod schemas of putting a receipt, payment or cheque on the party's
 * documents in parts. The create forms of treasury and cheques take the same parts (`accounting.schemas.ts`).
 */
import { z } from 'zod';
import { decimalInput } from '../../middleware/validate.js';
import { MAX_SETTLEMENT_PARTS } from '../../lib/treasury/settlementAllocation.js';

/** the documents a receipt, payment or cheque settles, in parts (the service checks the rest) */
export const settlementParts = z.array(z.object({
  documentId: z.coerce.number().int().positive('سند هر سهم را از فهرست انتخاب کنید'),
  amount: decimalInput('مبلغ سهم')
    .refine(v => v !== undefined, 'مبلغ سهم الزامی است')
    .refine(v => v === undefined || Number(v) > 0, 'مبلغ هر سهم باید بزرگتر از صفر باشد'),
})).max(MAX_SETTLEMENT_PARTS);

const sourceParams = z.object({
  id: z.string().regex(/^\d+$/, 'شناسه باید عددی باشد'),
});

/** the parts of one recorded receipt, payment or cheque */
export const sourceAllocationsSchema = z.object({
  params: sourceParams,
});

/** the whole new set of parts; an empty list puts it all on account */
export const replaceSourceAllocationsSchema = z.object({
  params: sourceParams,
  body: z.object({
    allocations: settlementParts,
  }),
});
