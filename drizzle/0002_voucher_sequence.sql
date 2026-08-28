CREATE SEQUENCE IF NOT EXISTS journal_voucher_number_seq START WITH 1 INCREMENT BY 1;

-- مقدار اولیه SEQUENCE را برابر max+1 تنظیم کن
SELECT setval(
  'journal_voucher_number_seq',
  COALESCE(
    (SELECT MAX(voucher_number) FROM journal_vouchers WHERE is_deleted = 0),
    1
  )
);
