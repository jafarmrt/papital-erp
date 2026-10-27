-- v11 phase 6.1t (M11 / U2, decision ت۵۲-۵): a receipt or payment, or a cheque, settles one or more documents in parts.
-- A part counts in the document's paid amount while its source is live (the treasury row completed and not reversed, the
-- cheque not bounced or returned); a replaced part keeps its row with is_deleted = 1. A treasury row linked to one document
-- through treasury_transactions.document_id keeps that link and has no parts.
CREATE TABLE IF NOT EXISTS settlement_allocations (
    id serial PRIMARY KEY,
    document_id integer NOT NULL,
    treasury_transaction_id integer,
    cheque_id integer,
    amount numeric(18,4) NOT NULL,
    created_by_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_deleted integer DEFAULT 0 NOT NULL,
    CONSTRAINT chk_settlement_allocations_amount CHECK ((amount > (0)::numeric)),
    CONSTRAINT chk_settlement_allocations_one_source CHECK (((treasury_transaction_id IS NULL) <> (cheque_id IS NULL))),
    CONSTRAINT chk_settlement_allocations_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1]))),
    CONSTRAINT fk_settlement_allocations_document FOREIGN KEY (document_id) REFERENCES documents(id),
    CONSTRAINT fk_settlement_allocations_treasury_transaction FOREIGN KEY (treasury_transaction_id) REFERENCES treasury_transactions(id),
    CONSTRAINT fk_settlement_allocations_cheque FOREIGN KEY (cheque_id) REFERENCES cheques(id),
    CONSTRAINT fk_settlement_allocations_created_by FOREIGN KEY (created_by_id) REFERENCES users(id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_settlement_allocations_document_id ON settlement_allocations USING btree (document_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_settlement_allocations_treasury_transaction_id ON settlement_allocations USING btree (treasury_transaction_id) WHERE (treasury_transaction_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_settlement_allocations_cheque_id ON settlement_allocations USING btree (cheque_id) WHERE (cheque_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_settlement_allocations_created_by_id ON settlement_allocations USING btree (created_by_id) WHERE (created_by_id IS NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_allocations_treasury_document ON settlement_allocations USING btree (treasury_transaction_id, document_id) WHERE ((is_deleted = 0) AND (treasury_transaction_id IS NOT NULL));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_allocations_cheque_document ON settlement_allocations USING btree (cheque_id, document_id) WHERE ((is_deleted = 0) AND (cheque_id IS NOT NULL));
