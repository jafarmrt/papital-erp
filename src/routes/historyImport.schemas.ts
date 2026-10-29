import { z } from 'zod';
import { TREASURY_IMPORT_MAX_ROWS } from '../lib/historyImport/treasuryHistoryImport.js';
import { STOCK_IMPORT_MAX_ROWS } from '../lib/historyImport/stockHistoryImport.js';

const TEXT_MAX = 1000;
const optionalId = z.coerce.number().int().positive().nullable().optional();

// v11 history import (tool 1): one resolved Excel row; the window has already turned each name into an id
const treasuryImportRowSchema = z.object({
  rowNo: z.coerce.number().int().positive(),
  sheet: z.string().trim().min(1).max(100),
  date: z.string().max(40),
  kind: z.enum(['receipt', 'payment', 'transfer', 'payslip', 'colleague_expense']),
  // tool 4: an expense a colleague paid from their own pocket moves no account of ours (0)
  bankAccountId: z.coerce.number().int().nonnegative('حساب نقد و بانک ردیف مشخص نیست'),
  toBankAccountId: optionalId,
  // the amount is read again by the service, which names the row in its message
  amount: z.union([z.string().max(40), z.number()]).transform(v => String(v)),
  partyType: z.enum(['customer', 'supplier', 'personnel', 'other']).optional(),
  partyId: optionalId,
  partyName: z.string().max(TEXT_MAX).optional(),
  purpose: z.enum(['advance', 'colleague_account', 'other']).nullable().optional(),
  contraAccountId: optionalId,
  personnelId: optionalId,
  invoiceRef: z.string().max(TEXT_MAX).optional(),
  costCenter: z.string().max(TEXT_MAX).optional(),
  projectId: optionalId,
  description: z.string().max(TEXT_MAX).optional(),
  settleOldest: z.boolean().optional(),
  duplicateAccepted: z.boolean().optional(),
}).strict().refine(row => (row.kind === 'colleague_expense') === (row.bankAccountId === 0), {
  message: 'حساب نقد و بانک ردیف مشخص نیست', path: ['bankAccountId'],
}).refine(row => row.kind !== 'colleague_expense' || (!!row.personnelId && !!row.contraAccountId), {
  message: 'همکار و حساب هزینهٔ ردیف مشخص نیست', path: ['personnelId'],
});

export const treasuryHistoryImportSchema = z.object({
  body: z.object({
    commit: z.boolean(),
    rows: z.array(treasuryImportRowSchema)
      .min(1, 'پرونده ردیفی برای ورود ندارد')
      .max(TREASURY_IMPORT_MAX_ROWS, `هر بار حداکثر ${TREASURY_IMPORT_MAX_ROWS.toLocaleString('fa-IR')} ردیف وارد می‌شود؛ پرونده را ماه به ماه بدهید`),
  }).strict(),
});


const decimalText = z.union([z.string().max(40), z.number()]).transform(v => String(v));
const warehouseCode = z.string().trim().max(100).nullable().optional();

// v11 history import (tools 2 and 3): one resolved warehouse or sales Excel row; the window has already turned each code and name into an id
const stockImportRowSchema = z.object({
  rowNo: z.coerce.number().int().positive(),
  sheet: z.string().trim().min(1).max(100),
  date: z.string().max(40),
  kind: z.enum(['opening', 'purchase', 'production', 'consumption', 'waste', 'transfer', 'sale', 'return']),
  itemCode: z.string().trim().min(1, 'کد کالای ردیف خالی است').max(100),
  // the quantity and cost are read again by the service, which names the row in its message
  quantity: decimalText,
  unitCost: decimalText.nullable().optional(),
  warehouse: warehouseCode,
  toWarehouse: warehouseCode,
  supplierId: optionalId,
  recipientPersonnelId: optionalId,
  invoiceRef: z.string().max(100).optional(),
  customerId: optionalId,
  unitPrice: decimalText.nullable().optional(),
  slipRef: z.string().max(TEXT_MAX).optional(),
  description: z.string().max(TEXT_MAX).optional(),
  duplicateAccepted: z.boolean().optional(),
}).strict();

export const stockHistoryImportSchema = z.object({
  body: z.object({
    commit: z.boolean(),
    rows: z.array(stockImportRowSchema)
      .min(1, 'پرونده ردیفی برای ورود ندارد')
      .max(STOCK_IMPORT_MAX_ROWS, `هر بار حداکثر ${STOCK_IMPORT_MAX_ROWS.toLocaleString('fa-IR')} ردیف وارد می‌شود؛ پرونده را ماه به ماه بدهید`),
  }).strict(),
});
