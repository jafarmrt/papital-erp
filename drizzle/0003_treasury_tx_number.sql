CREATE SEQUENCE IF NOT EXISTS treasury_tx_number_seq START WITH 1 INCREMENT BY 1;

-- Data cleanup for duplicate transaction_numbers if any exist among active records
DO $$
DECLARE
  r RECORD;
  new_num INT;
  new_tx_num TEXT;
BEGIN
  FOR r IN (
    SELECT id, type, transaction_number,
           ROW_NUMBER() OVER (PARTITION BY transaction_number ORDER BY id) as rn
    FROM treasury_transactions
    WHERE is_deleted = 0
  ) LOOP
    IF r.rn > 1 THEN
      SELECT nextval('treasury_tx_number_seq') INTO new_num;
      new_tx_num := (CASE WHEN r.type = 'receipt' THEN 'REC' ELSE 'PAY' END) || '-' || LPAD(new_num::text, 6, '0');
      UPDATE treasury_transactions SET transaction_number = new_tx_num WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

-- Synchronize sequence value safely (minimum 1)
SELECT setval(
  'treasury_tx_number_seq',
  GREATEST(
    COALESCE(
      (SELECT COUNT(*) FROM treasury_transactions WHERE is_deleted = 0),
      1
    ),
    1
  )
);

-- Create unique index for active transaction numbers
CREATE UNIQUE INDEX IF NOT EXISTS idx_uniq_tt_number_active 
  ON treasury_transactions(transaction_number) 
  WHERE is_deleted = 0;
