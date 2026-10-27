-- v11 phase 6.1j (S7, card ت۵۶-۷): voiding a stock document (receipt, production receipt, remittance, waste, transfer,
-- stock count) asks its own key documents.void_stock («باطل کردن سند انبار») instead of documents.delete («حذف فاکتور»).
-- Every role that holds «حذف فاکتور» gets the new key too, so nobody loses a void they could do before.
UPDATE roles
SET permissions = permissions || '["documents.void_stock"]'::jsonb
WHERE jsonb_typeof(permissions) = 'array'
  AND permissions @> '["documents.delete"]'::jsonb
  AND NOT permissions @> '["documents.void_stock"]'::jsonb;
