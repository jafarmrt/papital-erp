# Changelog — Papital Workshop ERP

All notable development history is preserved in **Git history** (`git log`). This file
provides a concise, human-readable archive of the pre-1.0 era and the release policy
going forward.

## Release policy (V10 onward)

| Channel | File | Version series |
|---|---|---|
| Client-bundled update center | `src/data/changelogs/0.ts` | baseline `v1.0.0` entry |
| Client-bundled update center (archive) | `src/data/changelogs/archive_1_6.ts` | condensed `1.x.y` – `6.x.y` series (`v1.x` - `v6.0.28`), replaced `1.ts` … `6.ts` in v7.0.11 |
| Client-bundled update center (archive) | `src/data/changelogs/7.ts` | closed `7.x.y` series (`v7.0.0` – `v7.0.140`), frozen in v8.0.0 (fingerprint checked by `npm run check:version`) |
| Client-bundled update center (archive) | `src/data/changelogs/8.ts` | closed `8.x.y` series (`v8.0.0` – `v8.0.128`), frozen in v9.0.0 (fingerprint checked by `npm run check:version`) |
| Client-bundled update center (active) | `src/data/changelogs/9.ts` | current `9.x.y` release series (`v9.0.0` onward); short entries, important points only (v7.0.54) |
| Root archive (this file) | `CHANGELOG.md` | summary of the pre-reset history & milestones |

---

## Version 9.x Series (Active — see `src/data/changelogs/9.ts`)

### v9.0.143 — Action Buttons by Permission
- **Action Buttons by Permission:** the customers page, sales file delete and the stock form item button follow the API permission, not the role code (TD-893).

### v9.0.142 — Piecework Read Scope
- **Piecework Read Scope:** every personnel's work logs and special rates need a piecework permission; a project reads only its own logs (TD-892).

### v9.0.141 — Item Price Read Scope
- **Item Price Read Scope:** the invoice form reads the sale prices of the chosen item; all prices need the products permission (TD-891).

### v9.0.140 — Document Read Scope
- **Document Read Scope:** the full document list needs a document permission; the stock count page reads only its own documents (TD-890).

### v9.0.139 — Project Pick List for Forms
- **Project Pick List for Forms:** forms of other sections pick projects from a short list; the full project list needs the projects permission (TD-889).

### v9.0.138 — Item Pick List for Forms
- **Item Pick List for Forms:** forms of other sections pick items from a list without the average cost; the full item list needs the products permission (TD-888).

### v9.0.137 — Customer Pick List for Forms
- **Customer Pick List for Forms:** forms of other sections pick parties from a list without notes; the full customer list needs the customers view permission (TD-887).

### v9.0.136 — System Admin Role Ticks Are Fixed
- **System Admin Role Ticks Are Fixed:** the system admin role lists every permission, locked; its permissions cannot be edited (TD-886).

### v9.0.135 — Only the System Admin Role Is Fixed
- **Only the System Admin Role Is Fixed:** former default roles are ordinary roles that the admin edits and deletes (TD-885).

### v9.0.134 — Fresh Install With the System Admin Only
- **Fresh Install With the System Admin Only:** a fresh production install gets its base data at boot and only the system admin role; other roles come from role templates (TD-526).

### v9.0.133 — Seed Inserts Only What Is Missing
- **Seed Inserts Only What Is Missing:** the boot seed no longer restores permissions, categories, settings or account natures an admin changed (TD-591).

### v9.0.132 — Menu From Permissions Only
- **Menu From Permissions Only:** the per-role menu hiding is removed; a role sees exactly the pages its permissions open (TD-884).

### v9.0.131 — One Page-Access Table
- **One Page-Access Table:** menu, page routes, dashboard shortcuts and settings tabs read one table checked against the API guards (TD-668).

### v9.0.130 — Users and Roles Page by Permission
- **Users and Roles Page by Permission:** the page and menu open for user and role managers, and the forms offer only what the user may grant (TD-525).

### v9.0.129 — No Self-Escalation by User and Role Managers
- **No Self-Escalation:** a non-admin user or role manager no longer edits its own role, grants keys it lacks, or takes over an account stronger than its own (TD-520).

### v9.0.128 — Workflow Steps by Permission and Exact Role
- **Workflow Steps by Permission and Exact Role:** a step role matches only that role and the system admin and who signs is the step's required permission; designs keep only defined roles and catalog keys, and migration 0065 lists the steps another role used to sign (TD-542).

### v9.0.127 — Notification Recipients by Permission
- **Notification Recipients:** event-rule notifications and the won-lead notice go to the holders of a catalog permission instead of fixed role codes; the rule editor picks the permission from the catalog (TD-883).

### v9.0.126 — Personnel Bank Details by Permission
- **Personnel Bank Details:** unmasked card, Sheba and account numbers of personnel and payslips need a catalog permission; the role code manager and «*» no longer open them, and migration 0064 grants the keys to the roles that saw them before (TD-882).

### v9.0.125 — Document Permissions by Type
- **Document Permissions:** a document is recorded and finalized with the permission of its type and status, never the role code; the new documents.finalize finalizes sales documents, and migration 0063 grants it to the roles that finalized before (TD-541, TD-771).

### v9.0.124 — Update Checks Startup on the Configured Port
- **Update Port:** `update.sh` waits for `/health/startup` on `PORT` from `.env` (written by `install.sh`, read by the server; an `APP_PORT` environment variable still wins, default 3000). Before, a server installed on another port reported "Update NOT completed" after a good update and was offered a backup restore. `setup-domain.sh` reads the port the same way (not covered by a test: it needs root, apt and certbot).

### v9.0.123 — Failed Build During Update Keeps the Previous Build
- **Update Build Failure:** `update.sh` keeps a copy of `dist/` before `npm run build` and puts it back when the build fails, then stops without restarting the service. From the moment the source changes, any failure prints the rollback steps once (an `EXIT` trap), and the backup step warns that restoring it erases every change made after it, so it is only for a version that has accepted no writes. Before, a failed build left `dist/server.cjs` missing and printed no rollback steps.

### v9.0.122 — Private Backup Files
- **Private Backups:** `scripts/backup.sh` writes under `umask 077` and makes the backup directory `0700`, so the dump, manifest and uploads archive are `0600` whatever the caller's umask; `scripts/go-live-verify.sh` fails a backup directory or any backup file other users can read (older backups are listed there to `chmod` by hand). Before, every local user could read payslips and attachments from the backups.

### v9.0.121 — Test Data Cleanup Guarded and Marker-Only
- **Test Data Cleanup (P1):** `npm run db:cleanup-test` runs only with `NODE_ENV` set to `test` or `development` and `ERP_ALLOW_TEST_CLEANUP=1` (checked before connecting), previews by default inside a rolled-back transaction and deletes only with `--force`, and then only `ERP-TEST-MARKER` rows that nothing else refers to. Kardex, treasury, users, audit logs, counters and sequences are never touched. Before, it deleted real payslips, reversal vouchers, items and users on a production database.

### v9.0.120 — Package 1 Data Infrastructure and Deployment Documentation
- **Stability Audit, Package 1 (Data Infrastructure, Startup, Deployment and Tooling):** `docs/audit/STABILITY_AUDIT_V9.md` gets the package 1 section with the owner decisions t1 to t9 (t9: all terminal output in English); its proven findings are registered as open rows TD-581 to TD-625 (TD-583 unused, B01-03 was fixed as TD-472; TD-591 and TD-594 are opened by package 2 M5 and package 16). Two P1: the test-data cleanup script deletes real data without an environment guard, and unknown paths grow the `/metrics` label set without bound. Documentation only; no behaviour change.

### v9.0.119 — Financial Ratios Show No Made-Up Score Before Data
- **Ratios Score (P3):** before any data arrived, or after an error, the ratios page showed a health score of 75 out of 100 and «critical» statuses; it now shows no score, status or value until the server answers (TD-575, `financialRatiosNoScore.test.tsx`).

### v9.0.118 — Account Card Prints the Opening Row Once and Names the Account
- **Account Card View (P3):** the account card printed the «opening balance» row twice (its own and the server's) and its title lacked the account name; the card now shares one contract with the server, prints the opening row once and names the account (TD-574, `ledgerViewOpeningRow.test.tsx`).

### v9.0.117 — Group and General Account Cards Roll Up Their Sub-Accounts
- **Account Card Roll-Up (P2):** clicking a group or general row of the trial balance opened an empty account card with a zero balance, because the card read only that account's own rows; the card of a group or general account now carries the rows and balances of all its sub-accounts (TD-570, `reg_account_card_rolls_up_sub_accounts_td_570`).

### v9.0.116 — Balance Sheet and Ratios Take a Date, the Income Statement Its Own Period
- **Statement Dates (P2):** the balance sheet and the financial ratios were always as of today and the income statement silently took the trial balance dates; each statement now has its own date fields in its header and shows its date or period (TD-566, `financialStatementDates.test.tsx`).

### v9.0.115 — The Voucher List Pages Through Every Voucher
- **Voucher List (P1):** the accounting voucher list loaded only the newest 20 vouchers and ran its counters, search, filters and batch approval on those 20; page, search and filters now run on the server, which also returns each status count (TD-565, `reg_voucher_list_paging_and_status_counts_td_565`, `voucherListServerPaging.test.tsx`).

### v9.0.114 — Income Statement and Balance Sheet Show the Server Figures
- **Financial Statements (P1):** the income statement showed a revenue total of 0, a 0% margin and no expense rows, and the balance sheet showed no asset, liability or period-profit rows, because the views read keys the server never sends; both now share one contract with the server (TD-563, `financialStatementsView.test.tsx`).

### v9.0.113 — Package 3 Accounting and Money Core Audit Documentation
- **Stability Audit, Package 3 (Accounting and Money Core):** `docs/audit/STABILITY_AUDIT_V9.md` gets the accounting section; its 38 proven findings are registered as open rows TD-543 to TD-580 (nine P1: closing the running or next year and closing years out of order, statements of a closed year showing zero, deleting an account that has postings, ledger reports open to document and customer viewers, the party ledger matching any id or a contained name, the income statement and balance sheet reading keys the server never sends, the manual voucher form dropping the row currency, and the voucher list showing only the newest 20). Documentation only; no behaviour change.

### v9.0.112 — Warehouse Deactivation Lock and Reactivation
- **Warehouse deactivation:** it waits for in-flight movements and refuses a warehouse that got stock, the last active warehouse stays active, and the system admin can reactivate an inactive warehouse (TD-490, `reg_warehouse_deactivation_td_490`).

### v9.0.111 — Inventory Layer in the System Reconciliation Scan
- **System reconciliation scan:** the inventory layer check warns when the stock integrity report finds discrepancies or negative Kardex balances instead of always reporting healthy (TD-495, `reg_system_inventory_check_td_495`).

### v9.0.110 — Reserved Warehouse Code
- **Warehouse code `default`:** a new warehouse can no longer take a code the Kardex reads as the default warehouse, a void reversal writes the real default code, and a legacy one is listed by the health check (TD-482, `reg_warehouse_reserved_code_td_482`).

### v9.0.109 — Merge-Time Renumbering Tool for Parallel Lanes
- **Release Renumbering:** `npm run release:renumber -- origin/master` (`scripts/release-renumber.ts`) merges the base without committing, resolves the conflicts of the release files, moves the branch's own versions, migrations (file, journal idx, tag and a later `when`) and audit report sections after those of the base, rewrites only lines the branch added, sorts the active changelog, sets the four version locations, recounts TECH_DEBT.md and runs `check:version` and the migration plan test (TD-473, `releaseRenumber.test.ts`).

### v9.0.108 — Treasury Running Balance After a Void
- **Treasury Running Balance After a Void (P3, product-owner decision):** the treasury list's running balance counts a voided row on its date and its reversal on the void date, and no legacy cheque-method row, so the last row equals the bank balance. Before, after voiding a receipt of 250,000 every later row showed 250,000 less (TD-860, `reg_treasury_running_balance_void_td_860`).

### v9.0.107 — Route Guards Ask Permissions Only
- **Route Guards:** no route guard takes a role code any more; system maintenance is for the system admin only, warehouses and the fiscal-year close get their own permissions, and migration 0062 turns access seed roles had only by their code into logged ticks (TD-516).

### v9.0.106 — Treasury Forms and Export
- **Treasury Forms and Export (P3):** a receipt or payment for an account without a ledger account is stopped in the form, treasury and cheque dates use the Jalali date input, and the treasury Excel export has Persian labels and a Jalali file date. Before, the form promised a voucherless save the server refused, and the date field showed «2026/10/07» in the Jalali calendar (TD-515, Vitest `treasuryFormWording.test.tsx`).

### v9.0.105 — Cheque History and Status Wording
- **Cheque History and Status Wording (P3):** the cheque history window shows the stored step notes, messages name statuses in Persian, and the status filter offers «در خزانه / صندوق». Before, notes never showed and messages said «bounced» / «passed» (TD-513, `reg_cheque_status_messages_persian_td_513`).

### v9.0.104 — Cheque Audit Before and After
- **Cheque Audit Before and After (P3):** a cheque status change or delete records the previous and new status in Persian, the bank account and the vouchers it issued or voided. Before, the audit held only `{"status":"in_collection"}` or `{"chequeId":6}` (TD-512, `reg_cheque_audit_before_after_td_512`).

### v9.0.103 — Bank Reconciliation Rows
- **Bank Reconciliation Rows (P3):** reconciling a row of another bank or a voided row is refused with the list, only changed rows are written and audited, and the reconciliation time is the server UTC time. Before, three ids (bank A, bank B, voided) gave `{"updated": 2}` and the voided row was reconciled (TD-511, `reg_treasury_reconcile_rows_td_511`).

### v9.0.102 — Paged Treasury List
- **Paged Treasury List (P2):** bank balances are summed in SQL and the treasury page reads one server page with its total and running balance. Before, every request read all approved ledger rows (200,000 rows, 1,639 ms for 15 banks) and the page loaded all 20,000 transactions (15.88 MB) (TD-509, `reg_treasury_list_paging_and_bank_balances_td_509`).

### v9.0.101 — Treasury Amount Input
- **Treasury Amount Input (P3):** treasury, transfer and cheque amounts, opening balances and exchange rates accept Persian digits and thousands separators, text gets a Persian message, and the currency must be a supported one. Before, «۲۵۰۰۰۰۰» and «2,500,000» were refused with an English NaN message (TD-514, `reg_treasury_decimal_inputs_td_514`).

### v9.0.100 — Bank Ledger and Cheque Bank Links
- **Bank Ledger and Cheque Bank Links (P3):** a bank account links only to an active subsidiary account under cash and bank (general 10), and a cheque only to an active bank account. Before, a bank on a missing account or on trade receivables 1201 and a cheque on a missing bank were saved (TD-510, `reg_bank_ledger_and_cheque_bank_td_510`).

### v9.0.99 — Bank Account Currency
- **Bank Account Currency (P2):** the bank account form takes a currency (rial, dollar, euro, dirham, pound) and the currency is fixed after the account's first transaction, cheque or opening balance. Before, a currency edit returned success and was silently ignored, so a foreign account could be made only through the API (TD-508, `reg_bank_account_currency_td_508`).

### v9.0.98 — Cheque and Treasury Dates
- **Cheque and Treasury Dates (P2):** a cheque issue or action date after today and a non-existent day such as 1404/12/30 in a receipt, payment, transfer or cheque action are refused; the cheque status form sends the action date. Before, 1404/12/30 was posted on 1 Farvardin 1405 in the next fiscal year (TD-506, TD-669, `reg_cheque_and_treasury_dates_td_506`).

### v9.0.97 — Bank Pick List for Forms
- **Bank Account Readers (P2):** forms that only pick a bank account read a pick list without account, card or Sheba numbers or balances; the full list goes only to treasury readers. Before, warehouse and document users read every number and balance (TD-505, `reg_bank_account_options_td_505`).
### v9.0.96 — Warehouse UI Wording, Export Names and Warehouse Chart
- **Warehouse UI:** decided Persian terms, Persian digits and surplus/shortage labels on the count sheet, Persian export file names with a failure message, and a warehouse chart that counts items instead of adding units (TD-496, `reg_warehouse_item_count_td_496`).

### v9.0.95 — Deleted Transfer Codes Are Gone and Can Be Saved Again
- **Transfer Codes:** a deleted design answers 404, saving its code again revives it instead of a 409, and the page lists every code (TD-493, `reg_transfer_code_lifecycle_td_493`).

### v9.0.94 — Stock Movement Chart Counts the Kardex Ledger
- **Stock Movement Chart:** transfers between warehouses, voided documents and rows dated after the current month no longer enter the in/out chart (TD-492, `reg_movement_trend_ledger_td_492`).

### v9.0.93 — Item Opening Voucher From Opening Kardex Rows
- **Item Opening Voucher:** the opening voucher is worth the item's opening Kardex rows with or without the item workflow, no Kardex row is repriced, and mismatched opening vouchers are listed by the health check (TD-481, `reg_item_opening_voucher_value_td_481`).

### v9.0.92 — Initial Kardex Backfill Never Reprices Its Rows
- **Kardex Backfill:** a second run of the initial Kardex backfill no longer reprices its earlier zero-cost rows with the WAC of the day, so the Kardex replay keeps the live WAC (TD-488, `reg_kardex_backfill_no_rewrite_td_488`).

### v9.0.91 — Kardex Rebuild Writes Only for Changed Items
- **Kardex Rebuild:** an item whose warehouse stock already matches its Kardex gets no version bump, outbox event or audit row; only changed items do (TD-491, `reg_kardex_rebuild_quiet_td_491`).

### v9.0.90 — Kardex Rebuild Keeps WAC; WAC Correction Posts a Voucher
- **Kardex Rebuild and WAC Correction:** the rebuild only rebuilds quantities and lists items whose WAC differs from the Kardex; correcting the WAC is a separate action with its own permission that issues a draft voucher for the value difference against 7012 (TD-487, `reg_kardex_wac_correction_td_487`).

### v9.0.89 — Inventory Integrity Table Reads the Server Report
- **Inventory Integrity Tab:** the table and Excel export read the report the server sends (one shared type), so discrepant items are listed and exported instead of an always-empty table (TD-485, Vitest `inventoryIntegrityReport.test.tsx`).

### v9.0.88 — Integrity Report WAC Uses the Kardex Replay
- **Inventory Integrity Report:** the WAC check compares the live WAC with the same Kardex replay the rebuild and invariant I13 use, so an item that ran out and was bought again at another price is no longer reported as mismatched (TD-486, `reg_integrity_report_replay_wac_td_486`).

### v9.0.87 — One Permission Check and Permission Ratchets
- **Permission Check:** `can()` and `requirePermission` ask catalog permission keys only (an unknown key or a role code fails when the router is built); `npm run ratchet:permissions` keeps role-code literals and stray permission keys from growing (TD-881).

### v9.0.86 — Role Permissions Carry Their Requirements
- **Permission Dependencies:** the permission catalog is one shared file where every action requires its section's view; saving a role adds the missing requirements and the role form ticks them (TD-880).

### v9.0.85 — Spent Cheques Need a Supplier
- **Spent Cheque Supplier (P1):** spending a cheque needs a supplier picked from the list and posts to that supplier's detail; before, the form sent only a typed name and the voucher missed the supplier's account card (TD-498, `reg_cheque_spent_needs_supplier_td_498`).

### v9.0.84 — Cheque Vouchers Follow the Party Type
- **Cheque Party Account (P1):** a cheque voucher posts to the account and detail of its party type (personnel by purpose, misc to a chosen account) and its bounce and return follow it; before, a personnel cheque landed on the customer with the same id (TD-497, `reg_cheque_voucher_follows_party_type_td_497`).

### v9.0.83 — Treasury Links Are Checked
- **Treasury Links (P2):** a receipt or payment is refused when its document is missing, voided, of the other direction or of another party, or its party id is not in the table of its type; before, a receipt from one customer settled another customer's invoice (TD-501, `reg_treasury_document_and_party_links_td_501`).

### v9.0.82 — Misc Receipts and Payments Take a Chosen Account
- **Misc Counter Account (P2):** a misc receipt or payment and a personnel «other» payment post to the counter account the user chooses, and a personnel payment requires its purpose; before, they went to trade receivables and wages payable (TD-507, `reg_treasury_misc_contra_account_td_507`).
### v9.0.81 — Clear Errors for Transfers and Kardex Rebuild
- **Inventory Errors:** a transfer accepts a warehouse code or name in any case, and transfer and Kardex rebuild errors answer 422 or 404 with Persian messages instead of 500; the running Kardex of a missing item is 404 (TD-494, `reg_inventory_business_errors_td_494`).

### v9.0.80 — Warehouse Transfers Are Documents
- **Transfer Document:** every warehouse transfer is a numbered «حواله انتقال» document with its lines and linked Kardex rows, listed with source and destination, printable and voidable without changing WAC (TD-489, `reg_warehouse_transfer_document_td_489`).

### v9.0.79 — No Future-Dated Stock Movements
- **Future Stock Dates:** a stock movement dated after the business today is refused for every user, a transfer date is normalized (Jalali accepted, text 422), and earlier future-dated Kardex rows are listed by the financial health check (TD-483, `reg_stock_movement_future_date_td_483`).

### v9.0.78 — Persian Validation Messages
- **Validation Messages:** every 400 validation message is a Persian sentence naming the field and what to change, with Persian digits; schema-written messages are kept (TD-529, `persianValidationMessages.test.ts`).

### v9.0.77 — Login and Logout Only From the Application Itself
- **Session Endpoints:** login, logout and setup accept only the application's own origin, and logout of a valid session needs its CSRF header, so a forged form on another site can no longer log a user out or into another account (TD-528, `sec_session_endpoints_same_origin_td_528`).

### v9.0.76 — Test-Prefixed Usernames Are Refused and Listed
- **Synthetic Usernames:** `POST /users` and `/setup` refuse usernames starting with `test_`, `e2e_` or `testuser_` (422); user lists show every active user and the financial health check lists existing ones (TD-521, `sec_synthetic_username_refused_td_521`).

### v9.0.75 — Last System Admin Keeps the Admin Role
- **Last Admin:** editing a user can no longer move the last active system admin out of the admin role (409); edits and deletes of users run under one admin-set lock, so two concurrent changes cannot both remove an admin (TD-524, `sec_last_admin_role_change_td_524`).

### v9.0.74 — Session End Clears the Browser Cache
- **Session Cache:** logout and a 401 clear the React Query cache, so the next user of the same browser never sees the previous user's cached data (TD-518, `sessionCacheClear.test.tsx`).

### v9.0.73 — New-User Form Preselects No Role
- **New-User Role:** the new-user form opens with an empty «choose a role» option and sends nothing until a role is picked; the system admin is listed last with a full-access warning (TD-517, `userFormRole.test.tsx`).

### v9.0.72 — Package 2 Access and Audit Log Documentation
- **Stability Audit, Package 2 (Authentication, Access and Audit Log):** `docs/audit/STABILITY_AUDIT_V9.md` gets the package 2 section with the approved permission model; its 27 proven findings are registered as open rows TD-516 to TD-542 (four P1: role codes in route guards, the new-user form preselecting the system admin, the browser cache surviving logout, and a deleted username reviving the old account). Documentation only; no behaviour change.

### v9.0.71 — Opening Balance Edit Waits for Approval
- **Opening Balance Approval (P2):** editing the opening balance of a treasury account whose approval workflow is still open is refused with 409; before, the edit issued the opening voucher at once, bypassing the approval (TD-504, `reg_opening_balance_edit_refused_while_approval_pending_td_504`).

### v9.0.70 — Deleting a Bank Account Voids Its Opening Voucher
- **Bank Account Delete (P2):** deleting a treasury account now voids its opening and opening-adjustment vouchers in the same transaction (draft removed, approved reversed) and is refused with 409 when one is permanent; before, the opening voucher stayed and the bank ledger kept a balance no account explained (TD-503, `reg_bank_delete_voids_opening_voucher_td_503`).

### v9.0.69 — Cheques With a Permanent Voucher Are Not Deleted
- **Cheque Delete (P2):** deleting a cheque whose voucher is permanent is refused with 409 naming the voucher; before, the cheque was deleted and the permanent voucher stayed in the ledger with no cheque behind it. The cheque menu no longer offers status change or delete in a terminal status (TD-502, `reg_cheque_with_permanent_voucher_not_deleted_td_502`, Vitest `chequeTerminalActions.test.tsx`).

### v9.0.68 — Invoice Settlement After a Voided Receipt
- **Invoice Settlement (P1):** an invoice whose receipt was voided and then received again now shows the new receipt as paid; before, the void was subtracted twice and the invoice stayed «unpaid» while the customer's ledger was settled (TD-500, `reg_invoice_settled_after_void_and_rereceipt_td_500`).

### v9.0.67 — Treasury Reversal Rows Can No Longer Be Voided
- **Treasury Void (P0):** voiding the reversal row of a voided receipt or payment is refused with 409 and the button is gone; before, it put the money back in the bank with no voucher and without the no-voucher permission. Legacy revived rows are listed by the financial health check, and new bank invariants I15/I16 compare each bank with its ledger (TD-499, `reg_treasury_reversal_void_refused_td_499`, `inv_td_499_bank_invariants_hold`).

### v9.0.66 — Package 4 Treasury and Cheques Audit Documentation
- **Stability Audit, Package 4 (Treasury and Cheques):** `docs/audit/STABILITY_AUDIT_V9.md` gets the treasury section; its 19 proven findings are registered as open rows TD-497 to TD-515 (one P0: voiding the reversal row of a voided receipt put the money back in the bank with no voucher). Documentation only; no behaviour change.

### v9.0.65 — Workflow UI and Messages Fully Persian
- **Workflow Wording:** workflow UI and messages follow the owner glossary (decision t10), with Persian role and entity names and digits; `WF_*` codes go only into the error `code` field (TD-470, Vitest `workflowWording.test.ts`, `sec_workflow_error_code_td_470`).

### v9.0.64 — Workflow Approvals Refresh Domain Lists
- **Workflow Cache Refresh:** an approval invalidates documents, procurement, accounting and inventory queries, and design and position saves refetch the definition detail (TD-469, Vitest `workflowQueryInvalidation.test.tsx`).

### v9.0.63 — Workflow Times in UTC, Delegations Cover Whole Days
- **Workflow Timestamps and Delegation Days:** workflow API responses send server timestamps with `Z` (`withUtcTimestamps`), and a day-only delegation covers whole business days (TD-468, `sec_workflow_utc_timestamps_td_468`).

### v9.0.62 — Delegation Scope Is All or a Defined Workflow
- **Delegation Scope:** a delegation scope is `ALL` / `*` or a defined workflow code, else 422; the form offers only these (TD-467, decision t6, `sec_workflow_delegation_scope_td_467`).

### v9.0.61 — Workflow Stepper Shows the Rial Amount
- **Stepper Amount Currency:** the workflow stepper shows the context amount in IRR and a foreign document's own amount beside it (TD-466, Vitest `WorkflowStepperWidget.test.tsx`).

### v9.0.60 — Inbox Card Shows Amount, Delegation, Step and Starter
- **Inbox Card Fields:** inbox rows carry `currentStepTitle` from the instance snapshot, `instance.startedByName` and a numeric IRR `amount`; the card reads them and `delegationInfo` (TD-465, `sec_workflow_inbox_card_fields_td_465`).

### v9.0.59 — Inbox Ignores Late Responses of Another Task
- **Task Preview Belongs to Its Task:** the inbox reads the task's document or requisition through `useApprovalTaskEntity`, aborting the previous request and ignoring late responses (TD-464, Vitest `approvalInboxPage.test.tsx`).

### v9.0.58 — Inbox Chooses Among Several Reject Actions
- **Reject Choice in the Inbox:** inbox rows carry the reject actions of the current step and the task modal sends the chosen `transitionId` when there are several (TD-463, `sec_workflow_inbox_reject_choice_td_463`).

### v9.0.57 — Inbox Clears a Cancelled Decision
- **Approval Inbox Decision Reset:** closing the task modal or opening another task resets the decision, comment and chosen reject action (TD-462, Vitest `approvalInboxPage.test.tsx`).

### v9.0.56 — Changing the Stock-Count Warehouse Clears the Counts
- **Stock-Count Warehouse Change:** switching the warehouse after entering counts asks first and clears the counts on confirmation, so counts of one warehouse are never posted for another (TD-484, Vitest `stockCountSheet.test.tsx`).

### v9.0.55 — The Stock-Count Sheet Reads the Real Book Stock
- **Stock-Count Sheet:** the sheet selects warehouses by code and reads each item's book stock of that warehouse (code or name accepted, unknown 422), so «copy + submit» can no longer zero a warehouse; a count whose shown book stock changed before posting is refused with 409 and the sheet reloads (TD-480, `reg_stock_count_sheet_book_stock_td_480`).

### v9.0.54 — Package 6 Inventory and Kardex Audit Documentation
- **Stability Audit, Package 6 (Inventory and Kardex):** `docs/audit/STABILITY_AUDIT_V9.md` gets the inventory section; its 17 proven findings are registered as open rows TD-480 to TD-496 (one P0: the stock-count sheet can zero the whole stock of a warehouse). Documentation only; no behaviour change.

### v9.0.53 — node_modules No Longer Tracked by Git
- **Deployment:** the `node_modules` symlink committed in v9.0.25 is removed, `.gitignore` uses `/node_modules` (also matches a symlink), and `update.sh` untracks a leftover symlink entry before `git pull`; servers on v9.0.25+ run `git rm -q --cached node_modules` once before updating (TD-472, B01-03, `node_modules_never_tracked_td_472`).

### v9.0.52 — CI Actions on Node 24 and a Pinned Ubuntu Runner
- **CI Maintenance:** `actions/checkout`, `actions/setup-node` and `actions/upload-artifact` move from v4 (Node 20) to v7 (Node 24) and every job runs on `ubuntu-24.04` instead of the moving `ubuntu-latest` label (TD-471, `ci_actions_node24_runner_pinned_td_471`).

### v9.0.51 — Workflow Tables Get Foreign Keys and Indexes
- **Workflow Referential Integrity:** migration 0059 adds foreign keys between the workflow tables (NOT VALID, validated only on clean data; instance children cascade), the instance-by-entity and by-instance indexes and a unique definition version; the health check lists gaps as `workflow_reference_integrity` (TD-461, `sec_workflow_db_constraints_td_461`).

### v9.0.50 — Workflow Write Routes Validate Their Bodies
- **Workflow Route Bodies:** `/transition`, `/definitions`, `/positions` and `/delegations` validate their bodies with Zod (400, Persian); `/positions` needs the definition id and moves only that definition's steps in one transaction with an audit row (TD-459, `sec_workflow_route_bodies_td_459`).

### v9.0.49 — SLA Analytics Read Each Instance's Own Snapshot
- **SLA Analytics from the Snapshot:** a running instance's step title and SLA come from its own definition snapshot and it is counted under the current step with the same key, so re-saving a design no longer marks it unknown and overdue (TD-457, `sec_workflow_sla_from_snapshot_td_457`).

### v9.0.48 — Invalid Workflow Rules Are Refused and Fail Closed
- **Workflow Rule Validation:** a transition rule is validated on save (422), and a stored node that is neither a rule nor a group evaluates closed with a Persian reason; an empty expression still means no condition (TD-456, `sec_workflow_rule_validation_td_456`).

### v9.0.47 — Designer Saves Keep the Step Order
- **Workflow Step Order:** saving a design keeps each step's `stepOrder` (a missing one takes the step's list position) and the designer reads, assigns and edits it (TD-454, `sec_workflow_step_order_td_454`).

### v9.0.46 — Default Workflows Are Seeded Only When Missing, at Startup
- **Workflow Seed:** default definitions are created only when their code is missing and only at startup; listing definitions, starting an instance and creating a requisition no longer seed, and the manual sync route is removed (TD-453, `sec_workflow_seed_keeps_edited_definition_td_453`).

### v9.0.45 — Workflow Designs Are Validated Before Saving
- **Workflow Design Validation:** a definition is saved only with exactly one initial step, at least one terminal step, unique keys and resolvable actions, no exit from a terminal step except `rejected` (422 otherwise); renaming a step key in the designer keeps its actions (TD-452, `sec_workflow_design_validation_td_452`).

### v9.0.44 — Roleless Step Reminders Only to Workflow Approvers
- **SLA Reminder Recipients:** a roleless (`ALL`) task's due reminder goes only to admins and holders of `workflow.approve` / `workflow.execute` (plus their active delegates) (TD-460, `sec_workflow_sla_reminder_recipients_td_460`).

### v9.0.43 — Workflow SLA Analytics No Longer Fails
- **SLA Analytics Route:** every `WorkflowEngineService` facade method is bound to its own class, so `GET /workflow/analytics/sla` answers instead of a 500 (TD-450, `sec_workflow_sla_analytics_route_td_450`).

### v9.0.42 — Instances View Removed From the Approval Inbox
- **Instances View Removed:** `GET /workflow/inbox` and the inbox «instances» view are removed; the approval inbox has only the tasks view (TD-449, `sec_workflow_instances_inbox_removed_td_449`).

### v9.0.41 — Approval Inbox Tabs Show Their Own Tasks
- **Inbox Tabs:** `GET /workflow/tasks/my-tasks` serves pending, overdue (`due_at < now()` in SQL), delegated and completed (the user's own actions from history, paginated in SQL); `/tasks/stats` counts each with the same rule; status, page and limit are validated (TD-448, `sec_workflow_inbox_tabs_td_448`).

### v9.0.40 — Voiding or Deleting an Entity Closes Its Workflow
- **Workflow Closes on Void:** voiding a document or deleting a draft voucher, item, bank account or purchase requisition terminates its running workflow in the same transaction (tasks canceled, one history row); migration 0058 closes the open workflows of entities deleted earlier (TD-447, `sec_workflow_void_closes_instance_td_447`).

### v9.0.39 — Only Unfinalized Sales Documents Enter the Approval Workflow
- **Document Approval Scope:** only an invoice or proforma in draft or proforma status starts the approval workflow, in its own create transaction; finalizing outside the workflow and migration 0057 close the open instances of final documents (TD-446, `sec_workflow_document_auto_start_td_446`).

### v9.0.38 — Workflow Widget Requires the Entity's Read Permission
- **Workflow Widget Read Scope:** `GET /workflow/instance/:entityType/:entityId` also requires the entity's own read permission (document, journal voucher, item, bank account, purchase requisition), else 403 (TD-458, `sec_workflow_instance_entity_read_td_458`).

### v9.0.37 — One Open Workflow Instance per Entity
- **Single Open Instance:** `startInstance` serializes starts on an entity with a transaction advisory lock and the partial unique index `uq_workflow_instances_open_entity` (migration 0056, created only on clean data) backs it; duplicates are listed by the financial health check (TD-455, `sec_workflow_single_open_instance_td_455`).

### v9.0.36 — Workflow Start Failures Are Not Swallowed
- **Workflow Start Failures (P1):** `maybeStartWorkflow` returns null only when no active definition exists and otherwise throws, so a broken active definition rejects the bank account or item instead of issuing its opening voucher without approval; item creation and its workflow start share one transaction (TD-451, `sec_workflow_start_failure_td_451`).

### v9.0.35 — Document Workflow Steps Guarded by Permissions
- **Document Workflow Permissions (P1):** the default document workflow's warehouse and accounting steps require `warehouse.out` / `accounting.vouchers` (direct approval `workflow.admin`), an untouched installed definition is upgraded, and a step that runs a domain action requires the entity's own permission from the signer (TD-445, `sec_workflow_document_steps_permission_td_445`).

### v9.0.34 — Workflow Signer Permissions From the Role
- **Workflow Signer Permissions (P1):** the engine reads the signer's role permissions itself, so the department posting-permission rule (TD-374) works and the inbox, its counts and task execution follow the same rule as the document widget; `workflow.manage` / `workflow.admin` no longer sign other roles' steps (TD-444, `sec_workflow_signer_permissions_td_444`).

### v9.0.33 — Workflow Start Scoped to the Definition's Entity Type
- **Workflow Start Scope (P0):** `POST /workflow/start` and `startInstance` accept only an active definition whose entity type is the entity's own, on an existing entity; a mismatched instance created earlier no longer advances or shows in the document widget (TD-443, `sec_workflow_start_entity_scope_td_443`).

### v9.0.32 — Package 14 Workflow Audit Documentation
- **Stability Audit, Package 14 (Workflow and Approvals):** `docs/audit/STABILITY_AUDIT_V9.md` gets the workflow section; its 28 proven findings are registered as open rows TD-443 to TD-470 (one P0: starting any workflow on any entity approves a journal voucher without permission). Documentation only; no behaviour change.

### v9.0.31 — Persian Wording in the Personnel UI
- **Personnel Wording:** The personnel pages no longer show «(Update Existing)», «(IBAN)», «اکانت» or «کلیپ‌بورد»; a Vitest check keeps English words out of the Persian personnel UI (TD-440, `personnelWording.test.ts`).

### v9.0.30 — Personnel Edit Optimistic Lock
- **Personnel Edit Lock:** Saving a personnel form opened before someone else's save is refused with a conflict message instead of silently erasing the other change (owner decision D5; TD-442, `reg_personnel_edit_occ_td_442`).

### v9.0.29 — Personnel With Open Business Is Not Deleted
- **Personnel Delete Guard:** A personnel with an unsettled payroll, a work log without a payroll, an account balance or a draft voucher is no longer deleted; the refusal lists the reasons and suggests «قطع همکاری» (owner decision D4; TD-441, `reg_personnel_delete_guard_td_441`).

### v9.0.28 — Unique Personnel Code
- **Personnel Code:** A personnel code is unique among active personnel regardless of letter case and surrounding spaces, now also under concurrent saves (partial unique index, migration 0054); old duplicates are listed by the financial health check (owner decision D6; TD-439, `reg_personnel_code_unique_td_439`).

### v9.0.27 — Personnel Monthly Salary Validated
- **Personnel Salary:** The monthly salary on the personnel form now rejects text and negative values instead of saving 0 or a negative salary; Persian digits and thousands separators are accepted (TD-438, `reg_personnel_salary_decimal_input_td_438`).

### v9.0.26 — Personnel Audit Rows Carry Before and After
- **Personnel Audit:** Creating, editing, deleting and importing personnel now records the changed values (before/after) and the user's IP in the activity log, one row per person; the Nobitex password is never logged (TD-437, `reg_personnel_audit_snapshot_td_437`).

### v9.0.25 — Personnel Excel Import Keeps Empty Cells
- **Personnel Excel Import:** With «به‌روزرسانی», an empty gender, employment-status or nationality cell no longer resets an existing employee to «مرد», «فعال» and «ایرانی»; defaults apply only to new personnel (owner decision D3; TD-436, `reg_personnel_import_keeps_status_td_436`).

### v9.0.24 — One Active Personnel per User
- **Personnel User Link:** A system user is linked to at most one active personnel and only when the user exists; a second link is refused under the user's row lock and by the partial unique index of migration 0053, so «فیش‌های من» never shows another employee's payslip; legacy duplicates are only listed by the health check (owner decision D2; TD-435, `sec_personnel_user_link_unique_td_435`).

### v9.0.23 — Personnel List Field Scope
- **Personnel Field Scope:** The personnel list and detail give pick-list readers (projects, CRM, accounting, warehouse, piecework) only names, code, job title and status; the dossier needs `personnel.view` / `personnel.manage`, the salary the payroll-amount permissions, and the Nobitex password appears only in the detail (owner decision D1; TD-434, `sec_personnel_field_scope_td_434`).

### v9.0.22 — Package 12 Personnel Audit Documentation
- **Stability Audit, Package 12 (Personnel):** `docs/audit/STABILITY_AUDIT_V9.md` gets the personnel section; its 7 proven findings are registered as open rows TD-434 to TD-440 (two P1 salary-data leaks). Documentation only; no behaviour change.

### v9.0.21 — Party Bank Details Scope
- **Party Bank Details Scope:** A party's bank details reach only admins and holders of `customers.view`, `customers.manage` or an `accounting.*` permission; the customer list, its export and «تبدیل به مشتری» drop them for other readers (owner decision ت۶; TD-433, `sec_party_bank_info_scope_td_433`).

### v9.0.20 — CRM Wording in the Persian UI
- **CRM Wording:** Persian UI text says «ارتباط با مشتری» instead of «CRM», and package-9 text uses «پیگیری»، «پرونده فروش» and «اشاره» instead of transliterations (owner decision ت۷; TD-432, Vitest `crmWording.test.ts`).

### v9.0.19 — CRM Follow-up Explicit Actions
- **CRM Follow-up Actions:** The two-way `toggle-followup` is replaced by `complete-followup` and `reopen-followup` with a target state, under the activity row lock and with an audit row per change (`setFollowupCompleted`; TD-430, package-9 finding B09-15).

### v9.0.18 — Sales Lead Input Validation
- **Sales Lead Input:** Lead amounts and probabilities go through `decimalInput`; the amount is non-negative, the probability an integer 0 to 100, and stage, status and currency come from fixed lists (`src/lib/crm/leadFields.ts`; TD-427, package-9 finding B09-12).

### v9.0.17 — CRM Activity Parents Exist
- **CRM Activity Parents:** A CRM activity is saved only when its sales lead and party exist and are not deleted; otherwise 422 (`resolveActivityParents`; TD-426, package-9 finding B09-11).

### v9.0.16 — Sales Lead Delete Guards
- **Sales Lead Delete:** Deleting a sales lead runs under its row lock: a missing lead is 404, a lead with an active document is refused with 409, and activities of deleted leads leave the stats, lists and due reminders (`deleteLead`, `liveLeadActivityCondition`; TD-425, package-9 finding B09-10).

### v9.0.15 — CRM Customer Filter by Party Id
- **CRM Customer Filter:** The CRM customer filter sends the party id; the server returns that party's leads and legacy leads without an id whose customer or company name equals the party name exactly (`leadCustomerCondition`; TD-429, package-9 finding B09-14).

### v9.0.14 — Open CRM Follow-Ups From the Server
- **Open Follow-Ups:** The follow-ups tab, the dashboard «today and overdue» widget and the tab badge read open follow-ups from `GET /crm/followups` with no activity-date range and with pagination; the stats counter uses the same condition (`listFollowups`, `countDueFollowups`; TD-428, package-9 finding B09-13, product-owner decision).

### v9.0.13 — One Proforma Per Lead Under Concurrency
- **Single Proforma Per Lead:** Issuing a proforma for a sales lead locks the lead row inside the document transaction, so concurrent requests can no longer create several proformas for one lead; the lead link and its note are written in the same transaction (`lockLeadForNewProforma`, `markLeadProforma`; TD-424, package-9 finding B09-09).

### v9.0.12 — Voiding a Lead Proforma Reopens a Won Lead
- **Lead Proforma Void:** Voiding the proforma of a sales lead, or the invoice finalized from it, releases the lead inside the void transaction and moves a won lead back to the proposal stage (`releaseLeadOfVoidedDocument`; TD-423, package-9 finding B09-08).

### v9.0.11 — CRM Lead Values Per Currency
- **CRM Stats Per Currency:** The CRM stats card and the customer dossier show the pipeline, won and per-stage lead values per currency; amounts of different currencies are no longer added together (`getCrmStats`, `sumByCurrency`; TD-422, package-9 finding B09-07, product-owner decision).

### v9.0.10 — Customer Delete Refused With Open Items
- **Customer Delete Guard:** Deleting a party is refused (409, Persian reasons) while it has a nonzero approved balance in any currency, draft voucher rows, a draft or proforma document under its name, an active sales lead, an open project or an open cheque; the check runs under the customer row lock (`assertCustomerDeletable`; TD-431, package-9 finding B09-16, product-owner decision).

### v9.0.9 — Excel Import Keeps the Party Type
- **Party Type in Customer Excel Import:** An empty type cell leaves an existing party's type unchanged and makes a new party a customer; supplier is read with or without hamza and «هر دو (مشتری و تامین‌کننده)» as both (`parsePartyTypeCell`, shared by the server and the preview) (TD-421, package-9 finding B09-06).

### v9.0.8 — Unique Active Customer Names
- **Customer Name Uniqueness:** Migration 0052 adds the partial unique index `uq_customers_name_active` on `lower(btrim(name))` of active parties, created only when existing data has no duplicate (old rows are never renamed or merged; the financial health check lists duplicates as `customer_name_uniqueness`). The form, the sales lead link and the Excel import check the same key, and a race ends in the same Persian duplicate-name error (TD-420, package-9 finding B09-05).

### v9.0.7 — Customer Phone Matching by Key
- **Customer Phone Identity:** The sales lead link, the customer form's duplicate check and the customer Excel import compare phones with `phoneMatchKey` (the WooCommerce key of TD-296): spaces, +98 / 0098, Persian digits and a leading zero dropped by Excel no longer create a second customer for one number. Existing duplicates are left as they are (TD-419, package-9 finding B09-04).

### v9.0.6 — Customer Dossier Documents by Exact Buyer
- **Customer Dossier:** The «پیش‌فاکتورها و اسناد» tab loads `GET /customers/:id/documents`: only sales documents (invoice, proforma, return) whose buyer name equals the party's current name exactly, instead of a text search over number, buyer, notes, user, phone and city. Each row shows its own type and status (TD-417, package-9 finding B09-02).

### v9.0.5 — Sales Leads No Longer Change an Existing Customer
- **CRM ↔ Customer Master:** Creating, editing or converting a sales lead only links a customer (by id, then exact phone, then exact name) or creates a new one; it never rewrites an existing customer's name, phone or contact person, so the customer's optimistic lock and the `customers.manage` permission can no longer be bypassed. A differing phone or company name is noted once in the lead's notes (TD-418, package-9 finding B09-03).

### v9.0.4 — Party Account Card by Id
- **Party Balance:** The customers page «تراز مالی» card and the customer dossier load the account card from `GET /customers/:id/account-card`, which selects customer and supplier voucher rows by the party's detailed id; legacy rows without an id match the current name exactly. A similarly named party is no longer added in, and renaming a party no longer empties its card (TD-416, package-9 finding B09-01).

### v9.0.3 — Package 9 Audit Documentation (Customers & CRM)
- **Stability Audit, Package 9:** `docs/audit/STABILITY_AUDIT_V9.md` opens with the customers and CRM section; its 16 proven findings are registered as open rows TD-416 to TD-431 (two P1). The phase-1 baseline and the series targets the product owner confirmed are recorded in the roadmap. Documentation only; no behaviour change.

### v9.0.2 — Workflow Auto-Actions Inside the Approval Transaction
- **Workflow Approval Atomicity:** What a workflow transition does to its entity (invoice finalize, item and treasury opening vouchers, journal voucher status, purchase requisition status and goods receipt) now runs in the transition's own transaction; a failing action refuses the approval with its real error. The in-process `workflowEventBus` and its duplicate `publishEvent` bridge are removed; workflow events go through the outbox only (TD-415, phase-2 finding A02-01).

### v9.0.1 — Test Runner Security Upgrade (vitest 5)
- **Security Gate:** `vitest` upgraded from 3.2.7 to 5.0.3 (dev-only). The CI audit gate was red on every branch because of two critical advisories in `tinypool@1.1.1` (GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr) and one moderate advisory in `@vitest/mocker` (GHSA-82fw-gwwq-j7x9); the new chain has no `tinypool` and a patched mocker (TD-414).

### v9.0.0 — Closure of Version 8 & Launch of Version 9
- **Version 8 Closure:** Concluded and archived the v8.x series (`v8.0.0` through `v8.0.128`). `V8_MASTER_ROADMAP.md` is archived with a closing report; 129 debt rows (TD-250 – TD-413) were recorded and all are resolved or closed by product-owner decision (TD-369 closed as an accepted risk); `src/data/changelogs/8.ts` is frozen.
- **Version 9 Mission:** `V9_MASTER_ROADMAP.md` — package-by-package stability audit (architecture and layering, data integrity, concurrency, security, error handling, performance, code quality, tests, UI) of the modules V8 did not cover as areas; stability over rewrites. New debt rows start at TD-414.
- **Governance:** `npm run check:version` now also rejects any change to the closed 8.x series; release paperwork moved to the generic `npm run release` (`scripts/release.ts`, reads the active series), and changes land only through a branch and a draft pull request (`AGENTS.md` §24).

---

## Version 8.x Series (Archived at v8.0.128)

### v8.0.128 — پاکسازی تست‌ها و ابزارهای بلااستفاده
- - سوئیت stress (دو سناریوی آن کد برنامه را اجرا نمی‌کرد)، سرویس‌های فقط‌تستی SystemRecoveryService و DataReconciliationService، شابلون ماژول v4، اسکریپت‌های قدیمی (start/stop/clean-install، db:baseline، setup:init، create-local-db)، فایل‌های AI Studio، دو سند قدیمی، سه وابستگی و خروجی‌های بی‌استفاده حذف شدند؛ رفتار برنامه تغییری نکرد.

### v8.0.127 — کلید ووکامرس روی HTTPS فقط در هدر
- کلید و رمز API ووکامرس روی HTTPS دیگر در آدرس درخواست (و لاگ وب‌سرور فروشگاه) نمی‌آیند و فقط در هدر می‌روند (TD-408).

### v8.0.126 — سفارش حذف‌شده ووکامرس نیازمند بررسی می‌شود
- سفارشی که در ووکامرس به سطل زباله برود یا حذف شود «نیازمند بررسی حسابدار» می‌شود و فاکتورش دست نمی‌خورد (TD-407).

### v8.0.125 — آمار گزارش کار بی گزارش‌های محرمانه
- TD-406: آمار گزارش کار فقط گزارش‌هایی را می‌شمارد که کاربر در فهرست می‌بیند.

### v8.0.124 — گام درخواست خرید بی بازنویسی
- TD-405: اقدام درخواست خرید گام گردش‌کار را بی انتقال و بی تاریخچه از وضعیت درخواست بازنویسی نمی‌کند.

### v8.0.123 — مبلغ ریالی در قاعده‌های گردش‌کار
- TD-404: قاعده مبلغ گردش‌کار مبلغ قابل پرداخت ریالی سند را با مالیات، هزینه خدمات و تسعیر می‌سنجد.

### v8.0.122 — قفل خوش‌بینانه ویرایش طرف حساب
- TD-403: ویرایش طرف حساب و درون‌ریزی اکسل با نسخه کهنه رد می‌شود و روی ویرایش دیگری نمی‌نویسد.

### v8.0.121 — حذف پروژه با تخصیص باز رد می‌شود
- - TD-412: پروژه‌ای که تخصیص مواد باز دارد تا آزادسازی تخصیص‌ها حذف نمی‌شود.

### v8.0.120 — پرداخت حقوق بدون روش چک
- - TD-411: روش «چک» از پرداخت حقوق حذف شد؛ پرداخت چکی رد می‌شود.

### v8.0.119 — فاکتور پیش‌فاکتور با تاریخ نهایی‌سازی
- - TD-410: فاکتورِ حاصل از پیش‌فاکتور تاریخ روز نهایی‌سازی را می‌گیرد؛ شماره و تاریخ پیش‌فاکتور در یادداشت می‌ماند.

### v8.0.118 — ثبت خزانه بی‌سند فقط با مجوز جدا
- - TD-409: دریافت، پرداخت، انتقال و چک «بدون سند حسابداری» فقط با مجوز جدا ثبت و در بررسی سلامت مالی فهرست می‌شوند.

### v8.0.117 — سند فیش حقوق با مبالغ دقیق
- TD-402: سند حسابداری فیش حقوق مبالغ را با محاسبه اعشاری دقیق می‌گیرد، نه عدد جاوااسکریپت.

### v8.0.116 — ارزش انبار سلامت مالی فقط به بهای تمام‌شده
- TD-401: بررسی سلامت مالی کالای بی میانگین موزون را صفر و جدا می‌شمارد و قیمت فهرست فروش را ارزش انبار نمی‌گیرد.

### v8.0.115 — سند حواله و ضایعات به بهای کاردکس
- TD-400: سند حسابداری حواله و ضایعات بهای ردیف‌های خروج کاردکس همان سند را می‌گیرد و همگام‌سازی دوباره پیش‌نویس عددش را عوض نمی‌کند.

### v8.0.114 — نام حساب ۶۰۰۱ و حساب جدای ضایعات
- TD-413: ۶۰۰۱ «بهای تمام‌شده کالای فروش‌رفته» نام گرفت و سند ضایعات حساب نگاشت‌شده «ضایعات و افت کیفی» (۶۰۰۴) را بدهکار می‌کند.

### v8.0.113 — مشاهده‌های ممیزی در دفتر بدهی فنی
- ۱۴ مشاهده بی‌ردیف گزارش‌های ممیزی به‌عنوان بدهی باز ثبت شد، پنج مورد با تصمیم مالک محصول (فقط مستندات).

### v8.0.112 — مبلغ قابل پرداخت در کارتابل تأیید و پرونده مشتری
- TD-389: کارتابل تأیید و پرونده مشتری مبلغ قابل پرداخت سرور را با مالیات و هزینه خدمات نشان می‌دهند.

### v8.0.111 — پیش‌نویس فاکتور پس از ثبت برنمی‌گردد
- TD-388: پیش‌نویس سرور فاکتور فروش پس از ثبت دوباره ساخته نمی‌شود و پیوند پرونده CRM را نگه می‌دارد.

### v8.0.110 — صدور مستقیم رسید از هشدار نقطه سفارش
- TD-387: «صدور مستقیم سند» از نقطه سفارش رسید را با شماره سرور و نام تأمین‌کننده ثبت می‌کند؛ پیش‌تر همیشه رد می‌شد.

### v8.0.109 — نرخ اختصاصی پرسنل در فرم ثبت کارکرد
- TD-386: فرم ثبت کارکرد نرخ اختصاصی پرسنل را پیشنهاد می‌دهد و فقط نرخ دستی را می‌فرستد.

### v8.0.108 — ارقام فارسی در مبلغ‌های حقوق و شماره چک
- TD-385: مبلغ و نرخ با ارقام فارسی یا عربی دیگر صفر نمی‌شود و متن نامعتبر خطا می‌گیرد؛ شماره چک و صیادی لاتین ذخیره می‌شوند.

### v8.0.107 — قیمت فهرست قیمت فقط به ارز خود فاکتور
- TD-384: فرم فاکتور فروش فقط قیمت‌های همان ارز را پیشنهاد می‌دهد و ارز فاکتور دارای ردیف عوض نمی‌شود.

### v8.0.106 — فاکتور ارزی در فرم و چاپ با اعشار نمایش داده می‌شود
- TD-383: فرم فاکتور فروش و فاکتور چاپی مبالغ ارزی را با دو رقم اعشار و جمع چاپی را از مبلغ قابل پرداخت سرور نشان می‌دهند.

### v8.0.105 — مالیات فاکتور ارزی به سِنت گرد می‌شود
- TD-382: مالیات درصدی فاکتور ارزی به کوچک‌ترین واحد ارز گرد می‌شود، نه به دلار کامل.

### v8.0.104 — مبلغ مالیات فاکتور را سرور از درصد حساب می‌کند
- TD-381: مبلغ مالیاتی که با درصد نمی‌خواند رد می‌شود و فرم فاکتور فروش فقط درصد را می‌فرستد.

### v8.0.103 — تخفیف ردیف حداکثر برابر مبلغ همان ردیف
- TD-380: تخفیف ردیف بیشتر از مقدار × قیمت واحد رد می‌شود؛ مازاد تخفیف دیگر از درآمد ردیف‌های دیگر کم نمی‌شود و بدهکاری مشتری با مبلغ فاکتور می‌خواند. ده یافته حوزه L ثبت شد.

### v8.0.102 — A Workflow Step Can Exclude the Initiator
- The workflow designer has a per-transition «آغازکننده تأیید نکند» option (off by default); when set, the user who started the process, directly or through a delegate, cannot run that step and does not see its task, while colleagues of the role and admins can.

### v8.0.101 — Receiving an Unapproved Requisition Approves It in the Receiver's Name
- Receiving goods on a purchase requisition that is not yet approved now runs the approval step in the receiver's name, with their role checked and the approval recorded in the history; a receiver without approval rights is refused and nothing enters stock.

### v8.0.100 — A Transition's Required Permission Is Enforced
- A workflow transition with a required permission now runs, and is offered, only for an admin or a user whose role or own permissions include it; the workflow designer shows and keeps the field instead of clearing it on save.

### v8.0.99 — Requisition Workflow Actions Follow the Current Step
- A purchase requisition action with no transition from its current workflow step is refused (409) instead of changing the status directly, so a received requisition can no longer be reopened, ordered and received into stock again; a rejected workflow continues only through a transition drawn out of its rejected step, such as reopen.

### v8.0.98 — Only the Delegator or an Admin Revokes a Delegation
- A delegate can no longer revoke the delegation given to them (403, and the revoke button is hidden); invalid delegation input returns 422 and a missing delegation or user 404 instead of a server error.

### v8.0.97 — A Delegate Does the Delegator's Role Tasks
- During an active delegation and within its scope, the delegate sees and runs the delegator's role tasks; the signature is recorded in the delegator's name with the delegate as signer, and neither of them can sign the same step twice.

### v8.0.96 — All-Members Approval Means Every Member of the Role
- An AND_ALL workflow step now passes only when every active user of the step's required role has signed (a one-member role passes with that member); a step without a role asks for the K set in the designer.

### v8.0.95 — No Deadlock Between Inbox Tasks and Direct Transitions
- Running an inbox task while the same step is executed from the document widget no longer deadlocks: the task locks the workflow instance before the task, in the same order as a direct transition.

### v8.0.94 — View Permissions No Longer Approve Workflow Steps
- A workflow step that requires the warehouse or accountant role can no longer be approved with a view or treasury permission alone, and production roles no longer count as managers; the role itself, a role of the same department or that department's posting permission is required.

### v8.0.93 — Step Signatures Restart When a Workflow Returns
- When a workflow comes back to a step after a rejection or return, the signatures of that step start from zero: the same user can resubmit, and an old signature no longer fills the quorum.

### v8.0.92 — Running Workflows Keep Their Tasks After a Design Edit
- After a workflow design is saved again, a running instance still gets the tasks and deadline of its next step from its own version snapshot instead of dropping out of the inbox.

### v8.0.91 — Multi-Signature Tasks Stay Open Until the Quorum
- A K-of-N or all-members approval task stays in every signer's inbox until the quorum is met; a partial or repeated signature no longer closes it, and the signer sees how many signatures are collected.

### v8.0.90 — Inbox Tasks Run Their Own Transition
- Approving a workflow task runs that task's own transition instead of the first forward transition of the step, and rejecting runs only a reject transition of the current step; a step without one refuses the rejection instead of approving it.

### v8.0.89 — Upgrade From v7.0.137 Passes Vouchers Refused by 0044
- Migration 0047 backfills source_cheque_id through erp_update_with_unvalidated_checks, so a voucher whose date 0044 refused to convert (closed fiscal year) no longer violates its NOT VALID date constraint and roll back the whole upgrade from v7.0.137; databases that ran the old 0047 are unaffected.

### v8.0.88 — Upgrade Rehearsal on a Restored Copy
- scripts/upgrade-rehearsal.sh (and update.sh --rehearse, before the restart) restores the latest backup into a drill database, runs the new migrations on it and compares ledger totals per account, stock per item and warehouse, bank balances and the financial health check before and after; the live database is never touched.

### v8.0.87 — Restore Apply Builds a New Database and Swaps It In
- RESTORE_MODE=apply no longer restores over the live database: it restores into a new database, verifies it like a drill, refuses while sessions are connected, swaps names and keeps the previous database and uploads directory; attachment files are restored too.

### v8.0.86 — Restore Drill Works With the Installed Database Role
- The role install.sh creates has no CREATEDB: restore.sh now creates, drops and renames databases through RESTORE_ADMIN_URL or sudo -u postgres, restores as the application role and stops with guidance before changing anything when neither is available.

### v8.0.85 — Restore Drill Compares Content With the Backup Manifest
- backup.sh writes the dump and a content manifest (rows and content hash of every table, every constraint) from one exported snapshot; the restore drill compares the restored database with it and checks sequences, attachment files and the migration level. The always-green recovery check was removed.

### v8.0.84 — Backups Run From Cron and Include Attachments
- scripts/backup.sh finds the application directory from its own location, reads DATABASE_URL and ATTACHMENTS_DIR from its .env and archives public/uploads, so a cron line backs up the database and the attachment files; attachment records without an attachment directory fail the backup.

### v8.0.83 — update.sh Waits for Startup and the Built Version
- update.sh reports success only when /health/startup answers (migrations and seed finished) and /health shows the built version (scripts/verify-startup.sh); on failure it prints the rollback steps with the previous commit and the pre-deployment backup.

### v8.0.82 — Migrations Run Without the Request Timeout, One at a Time
- Migrations run on a dedicated connection without the 60 s request statement timeout (MIGRATION_STATEMENT_TIMEOUT, default 0) under advisory lock 91008: the 0044 date migration no longer dies on large voucher tables and two concurrent runs queue instead of failing.

### v8.0.81 — Skipped Migrations and Newer Databases Stop Startup
- Before running, the migrator compares the code journal with __drizzle_migrations: a migration whose `when` is older than the last applied one (Drizzle skipped it silently) or a database newer than the build stops startup with the migration named; a journal lint checks strictly increasing `when` values.

### v8.0.80 — Atomic Project Codes
- - Automatic project codes (PRJ-<year>-<number>) come from an atomic yearly counter in `document_ref_counters` instead of `COUNT(*) + 1`, so concurrent project creation no longer fails on a duplicate code; a custom code is checked under the same lock.

### v8.0.79 — Idempotency Keys Keep Only Successful Responses
- The browser derives the Idempotency-Key from the submission's content and keeps it until a definitive answer, so a resubmission after a lost response returns the first result; the server stores only successful responses, refuses a key reused for another path or body, and extends the key's lock while a long request runs.

### v8.0.78 — Bank Account Maintenance Under Locks
- Editing a bank account locks its row, so two concurrent opening-balance edits no longer double the difference; treasury account codes come from an atomic counter per prefix and a duplicate custom code is refused; deleting a bank account runs under its lock and is refused while it has transactions or cheques.

### v8.0.77 — No Second Pool Connection Inside Transactions
- The first voucher of a new fiscal year, document voids, purchase requisitions and bank accounts with an opening balance now finish with a single free pool connection: the fiscal year row, audit log and workflow start run in the same transaction and a stale timezone cache no longer waits for the database.

### v8.0.76 — Work Logs Stay Consistent With Their Payroll
- Editing or deleting a work log now locks it and checks the payroll link under that lock, so a change racing with payroll issue either lands before the payroll or is refused after it; a work log whose payroll was deleted can be edited again.

### v8.0.75 — Dead-Letter Events Are Replayed Once
- Replaying a dead-letter event now runs under a lock on that event: a concurrent replay, dismissal or outbox requeue of the same event is refused, and an event already replayed is not replayed again, so webhooks and SMS are not sent twice.

### v8.0.74 — Bank Balance Sync Uses Treasury Transactions
- The bank balance sync now rebuilds each balance under the bank locks from the opening balance, treasury transactions and cleared cheques and only reports the difference from the general ledger (product-owner decision); draft vouchers and a concurrent payment no longer corrupt the balance.

### v8.0.73 — Bank Transfers Are Voided as a Whole
- Voiding either side of a bank-to-bank transfer now voids both sides, restores both balances and voids the shared voucher once (product-owner decision); the remaining side of an old half-voided transfer can be voided.

### v8.0.72 — Project Delivery Over Plan Needs a Reason
- Delivering a project's products to stock beyond the planned quantity now needs a recorded reason (product-owner decision), concurrent deliveries are counted under the project lock, and a cancelled project or an item outside the project is refused.

### v8.0.71 — Requisition Receipt Enters Stock Once
- Receiving a purchase requisition now runs in one transaction under the requisition lock: concurrent or later ordering no longer brings the goods in twice, a received or rejected requisition cannot be received or ordered again, a failed order finalization refuses the receipt, and the received quantity comes from the documents.

### v8.0.70 — Reversed Vouchers Keep Their Reversal
- A draft voucher can no longer be reversed or corrected, and a voucher with an active reversal can no longer go back to draft or be deleted, which used to leave an orphan reversal in the ledger.

### v8.0.69 — Deleted Cheques Stay Deleted
- A deleted cheque can no longer be cleared, bounced or deleted again; clearing it used to add its amount to the bank balance, and a concurrent delete and clear were both accepted.

### v8.0.68 — Each Voucher Is Reversed Only Once
- Two concurrent correction vouchers, or a correction and a reversal at the same time, no longer both reverse the same voucher; correction and repost lock the original voucher and every path refuses a voucher that already has an active reversal.

### v8.0.67 — Stock Paths Without Deadlocks
- Area J (concurrency) reviewed. Every stock path locks all its items at once, in id order and before any other lock, with FOR NO KEY UPDATE, so concurrent voids, invoices, receipts and returns sharing items no longer deadlock and a void's reversal row keeps the Kardex replay equal to the live WAC.

### v8.0.66 — Project Reservations Are Built by the Server (TD-306)
- A project's stock reservation is no longer taken from the browser: finalizing builds it on the server from the inventory control sections and item stock, and later saves keep it.

### v8.0.65 — Piecework Logs Need the Piecework Permission; Rates From the Server (TD-300)
- Recording piecework needs the piecework log permission instead of the daily-log one, and only personnel or rate managers enter a manual rate; others get the personnel or task rate.

### v8.0.64 — CRM Won Needs a Proforma on Every Path (TD-309)
- A sales lead can be marked won only after a proforma, whether through its stage or its status; a new lead cannot start as won.

### v8.0.63 — Vouchers Approved at Creation Record Their Approver (TD-308)
- A manual journal voucher created as approved records its creator as the approver.

### v8.0.62 — Document Creator Name Comes From the Session (TD-307)
- The creator name of a document, its Kardex rows and its voucher is the signed-in user, not a name sent in the request.

### v8.0.61 — Editing an Item Keeps the WAC of Stocked Items (TD-305)
- Editing an item that has stock no longer overwrites its weighted average cost without a Kardex row or voucher; the WAC changes only through stock in.

### v8.0.60 — Roles Accept Only Catalog Permissions (TD-304)
- A role can be given only permission keys from the catalog; "*" and unknown keys are refused.

### v8.0.59 — Payroll Payments Follow the Payroll Read Permission (TD-303)
- Payroll payments and personnel advance balances are read with the payroll read permissions only, like the payslips themselves.

### v8.0.58 — Pending Material Edits Need the Approval Permission (TD-302)
- Editing a pending raw-material request needs the approval permission and is refused once the request was approved or rejected.

### v8.0.57 — Private Daily Logs Stay Private by ID (TD-301)
- Opening a daily work log by its id applies the same visibility rule as the list; private and manager-only logs of others are no longer returned.

### v8.0.56 — Only an Admin Manages Admin Accounts (TD-299)
- A user manager without the admin role can no longer grant or remove the admin role, or change or delete an admin account.

### v8.0.55 — Area H Audit; Route Permission Table and View-Only Mutations (TD-298)
- Area H (security and access) was audited from a route → permission table built from the Express routers; BOM allocation and workflow start no longer open to view-only permissions, and a test keeps every route within the access policy.

### v8.0.54 — Stock Movement Chart by Jalali Month (TD-316)
- The stock movement chart now groups inflows and outflows by Jalali month over the current Jalali month and the five before it, instead of labelling Gregorian months with Jalali month names.

### v8.0.53 — Activity Log Shows Tehran Time and Filters Tehran Days (TD-315)
- The activity log API returns its UTC timestamps with a zone marker, so the page shows the time in the business time zone, and its date filter covers the business day rather than the UTC day.

### v8.0.52 — Database Session and Server Process Run in UTC (TD-314)
- The connection pool pins the PostgreSQL session time zone to UTC and the server process runs with TZ=UTC, so server timestamps written by the database and by the code agree on hosts set to Tehran time.

### v8.0.51 — Invoices From Proformas Take the Invoice Series Number (TD-317)
- Finalizing a proforma gives the invoice the next number of the invoice series for its fiscal year and keeps the proforma number in the notes; a proforma whose number already exists among that year's invoices no longer fails with a database error.

### v8.0.50 — Strict Document Dates and Cross-Year Draft Numbering (TD-313)
- A non-existent document date (30 Esfand of a common year, 30 February) or a non-date is refused with 422 instead of shifting silently or failing with 500; the numbering year comes from the stored date, and a draft moved to another fiscal year takes that year's next number.

### v8.0.49 — Browser «Today» in the Business Time Zone (TD-312)
- Stock counts and the invoice and treasury date fallbacks take today's date in the business time zone; a count saved after midnight in Tehran (on Nowruz night, in the new fiscal year) no longer gets yesterday's UTC date.

### v8.0.48 — Default Numbering Year Follows the Business Clock (TD-311)
- Without a date, the numbering year is today's Jalali year in the business time zone; requisition codes and the next-number preview no longer jump to the next year between 1 January and Nowruz.

### v8.0.47 — Fiscal Year Closing Always Ends on the Year's Last Day (TD-310)
- Closing vouchers are dated the year's last day (30 Esfand in a leap year) and the opening voucher 1 Farvardin; other dates are refused, so a leap year's 30 Esfand documents are closed too.

### v8.0.46 — No Floating Promises
- All 209 floating promises in the browser code are marked or handled; `no-floating-promises` is now an ESLint error, and clipboard copies report failure instead of a false «copied» message.

### v8.0.45 — Session-Start Hook and Release Tooling
- Tooling only: a Claude Code session-start hook prepares dependencies and PostgreSQL 16, `scripts/ci-test-env.sh` holds the CI test environment, and `npm run release:v8` writes a release's paperwork.

### v8.0.44 — Online Shop Warehouse for WooCommerce (TD-293)
- A new setting picks the online shop's warehouse: WooCommerce invoices draw from it and the stock sync pushes its sellable stock instead of the total of all warehouses.

### v8.0.43 — Changed Invoiced WooCommerce Orders Need Review (TD-294)
- When an invoiced order is edited in the shop or gets a partial refund, the order is flagged for review with the difference instead of being ignored.

### v8.0.42 — WooCommerce Negative Fees Become Line Discounts (TD-295)
- An order discount sent as a negative fee is spread over the invoice lines as line discounts in proportion to their amounts instead of rejecting the order.

### v8.0.41 — WooCommerce Line Totals Stay Exact (TD-297)
- A WooCommerce order line whose total is not divisible by its quantity is split into two lines with whole-rial prices, so the customer is charged exactly the order amount.

### v8.0.40 — WooCommerce Customer Matched by Phone in Any Format (TD-296)
- A WooCommerce order finds an existing customer whatever the phone format (+98, 0098, spaces, Persian digits) instead of creating a duplicate.

### v8.0.39 — WooCommerce Audit; Thousand-Toman and Thousand-Rial Units (TD-292)
- Area F (WooCommerce) audited with six findings; orders in the Persian plugin's thousand-toman (IRHT) and thousand-rial (IRHR) units are converted to rials and invoiced.

### v8.0.38 — Over-Ordering a Requisition Needs a Recorded Reason (TD-289)
- Ordering beyond a purchase requisition's remaining quantity is refused without a reason; the form warns, and the reason is recorded on the requisition and the order.

### v8.0.37 — Split-Order Form Accepted by the Convert Route (TD-291)
- The requisition convert route validates exactly the split-order form body, so the form works again and keeps each package's warehouse and status.

### v8.0.36 — Requisition Receipt Counts Every Line (TD-290)
- Delivering a purchase order counts every line of an item in its requisition and updates the requisition in the delivery transaction under a row lock.

### v8.0.35 — Project Delivery Issues a Production Receipt (TD-285)
- Delivering a project's finished goods to stock issues a final production receipt linked to the project: debit finished goods, credit work in progress.

### v8.0.34 — BOM Allocation Posts Work in Progress (TD-286)
- Allocating materials to a project posts debit work in progress, credit inventory at the Kardex cost; releasing the allocation voids that voucher.

### v8.0.33 — BOM Release at the Allocation's Own Cost (TD-288)
- Releasing a project material allocation returns the stock at the cost it left the warehouse, not at the current average cost.

### v8.0.32 — Area E Findings; BOM Receipt Allocation Needs a Receipt (TD-287)
- A direct BOM receipt allocation without a registered receipt is refused; with a receipt it moves stock out like a normal allocation. Five other procurement and project findings recorded.

### v8.0.31 — Payroll Payments Can Be Voided (TD-283)
- A payroll payment is voided with a reason from the payroll's payment window; bank balance, voucher, paid amount and payroll status step back.

### v8.0.30 — Fixed Salary per Jalali Month, Partial Months Pro Rata (TD-284)
- A payroll's fixed salary covers every Jalali month of its period, a partial month by days; two half-month payrolls add up to exactly one month.

### v8.0.29 — Advance Deduction Limited to the Outstanding Advance (TD-282)
- A payroll whose advance deduction exceeds the employee's outstanding advance is refused; the payroll form disables issuing it.

### v8.0.28 — Payroll Status Limited to Draft/Approved; Area D Findings (TD-281)
- Payroll status accepts only draft and approved by hand and a paid payroll keeps its status; three payroll findings await product-owner decisions.

### v8.0.27 — Cheque Reconciliation Report Matches the Ledger (TD-280)
- The cheque reconciliation compares cheque payables by their credit balance and no longer expects bounced or returned paid cheques there.

### v8.0.26 — Cheque Method Removed From the Treasury Form (TD-278)
- Cheques are registered only from the cheque book; the treasury and invoice-settlement forms no longer offer a cheque method and the server refuses it.

### v8.0.25 — Cheque Clearing Needs a Bank Ledger Account (TD-277)
- Clearing a cheque into a bank account without a ledger account is refused, like a treasury transaction, instead of marking it cleared without a voucher.

### v8.0.24 — Cleared Cheques Count in the Bank's Treasury Balance (TD-276)
- A cleared received cheque adds to, and a cleared paid cheque subtracts from, its bank account's treasury balance, so the account stays in sync with the ledger.

### v8.0.23 — Foreign-Currency Cheques Are Refused (TD-275)
- A cheque in a currency other than IRR is refused; foreign receipts and payments are recorded from the treasury form at an exchange rate.

### v8.0.22 — Returned Bounced Cheque Moves the Claim to the Customer (TD-273)
- Returning a bounced cheque to its drawer posts debit customer, credit protested cheques, so the claim is back on the customer's account.

### v8.0.21 — Bounced Paid Cheque Restores the Supplier (TD-272)
- A bounced paid cheque now posts a voucher: debit cheques payable, credit the supplier, so the debt to the supplier is open again.

### v8.0.20 — Foreign Treasury Transactions Use Their Rate (TD-274)
- Foreign-currency receipts, payments and transfers post at their exchange rate (explicit, the settled invoice's rate, or the setting) and are refused without one; the treasury form asks for the rate of a foreign account.

### v8.0.19 — Treasury and Cheque Evaluation; Cheque Delete by Link (TD-271)
- Second evaluation part (treasury and Sayad cheques): nine findings recorded; deleting a cheque no longer voids the vouchers of another cheque with the same number.

### v8.0.18 — Exact Rial Cost Rows in Foreign Vouchers (TD-261)
- Cost-of-sales, inventory and donated-goods rows of a foreign-currency voucher keep the document currency with their own rate, so their rial value equals the Kardex exactly; all findings of the first v8 evaluation part are closed.

### v8.0.17 — Free Goods Post to Donated-Goods Income (TD-268)
- A free line in a receipt or purchase (price 0 or a full discount) enters stock at the current WAC and its voucher credits the new account «درآمد کالای اهدایی» (5204); the supplier is credited only with priced lines.

### v8.0.16 — Foreign Rows Converted in Account Cards (TD-260)
- The account card, party ledger and financial health check convert foreign-currency rows to rials at their own rate in the all-currencies view, like the trial balance; a single-currency view shows that currency only.

### v8.0.15 — Reports Skip Deleted Voucher Rows (TD-270)
- The financial health check, project reports, bank ledger balances and personnel advance balances no longer count the old rows of a draft voucher that was edited or re-synced before approval.

### v8.0.14 — Purchase Vouchers Follow the Account Mapping (TD-259)
- Purchase, production receipt and sales return vouchers take inventory, payables and receivables accounts from the account mapping, like sales and remittances.

### v8.0.13 — Kardex Rebuild Starts From Zero Cost (TD-269)
- The Kardex rebuild replays WAC from zero, like an item with no movements; an item first received at price 0 keeps its live WAC after a rebuild.

### v8.0.12 — Zero-Price Receipt Kardex Cost (TD-256)
- A zero-price stock-in records the current WAC in its Kardex row, so voiding it and the Kardex rebuild keep WAC; a production receipt voucher takes such items at their Kardex cost.

### v8.0.11 — Void of an Outflow Restores Its Cost (TD-254)
- Voiding a sale, remittance or waste returns the goods at that outflow's own Kardex cost and recomputes WAC (same rule as stock-in and sales returns); the Kardex replay applies the same rule, also to older voids.

### v8.0.10 — Procurement Delivery Is Stock-In Only (TD-267)
- Procurement delivery finalizes only receipts and purchases; a purchase proforma is a receipt with status proforma (it used to finalize into a sales invoice that took the goods out of stock); finalizing a `purchase` document is stock-in.

### v8.0.9 — Purchase Line Discount in Stock Cost (TD-250)
- Incoming lines enter stock at the net unit price after the line discount (the same net the purchase voucher posts); foreign-currency lines are converted on the net price without intermediate rounding.

### v8.0.8 — Sales Return Capped at Quantity Sold (TD-253)
- A sales return with an original invoice is accepted only up to the invoice's sold quantity minus its earlier final returns (on create and on finalize, with row locks); voiding a return frees its quantity again.

### v8.0.7 — Running Kardex Shows Voided Documents (TD-266)
- Product-owner decision: the item Kardex report shows a voided document's original row (label «باطل‌شده») and its reversal («معکوس ابطال»); the running balance matches stock at every row, totals count only real movements, and each row's WAC is the live engine's WAC after that row.

### v8.0.6 — Void of a Consumed Incoming Document Refused (TD-265)
- Product-owner decision (option A): voiding a receipt, purchase, production receipt, sales return or count surplus is refused when, without it, a warehouse balance in date order would go negative; the error names the consuming documents. Voids of outflows are never refused.

### v8.0.5 — Excel Import Never Revalues Stock (TD-264)
- Product-owner decision (option A): an Excel row that changes the WAC of an item with stock is not applied and is listed in the import errors; a value within 1 rial of the current WAC is treated as unchanged; items without stock take the file's WAC.

### v8.0.4 — Stock Movement Date Rule and Kardex Replay (TD-257, TD-258)
- Product-owner decision: a stock movement (document, finalize, transfer) may not be dated before the item's last movement, except with the new permission `warehouse.backdate` (granted to no role by default); a permitted backdated outflow must keep the warehouse balance non-negative from that date on. Voided documents do not count, so void + reissue keeps the original date.
- The Kardex rebuild replays WAC in registration order with the live engine's formulas (`replayKardexWac`). New findings TD-265 (void of a consumed receipt) and TD-266 (running Kardex report after a void) registered; TD-264 decision (option A) recorded.

### v8.0.3 — Stock-Count and Excel Adjustment Vouchers (TD-255, TD-262, TD-263)
- Product-owner decision: stock-count shortages/surpluses and Excel stock adjustments post a draft voucher at Kardex cost against the new account «کسری و اضافات انبار» (7012, configurable mapping); a surplus of an item without WAC enters at cost 0; new Excel items with stock get the opening voucher; past counts get no voucher.
- A stock count is recorded only as final (a draft count used to deduct stock twice on finalize). New finding TD-264 (Excel WAC overwrite) registered for decision.

### v8.0.2 — Draft Vouchers at Fiscal Closing and Void (TD-252, TD-251)
- Product-owner decision: automatic vouchers stay draft; a fiscal year with draft vouchers is not closed (the preview lists them) and voiding a document, treasury transaction, cheque or payroll soft-deletes its draft voucher instead of issuing an approved reversal.

### v8.0.1 — Business-Logic Verification Tooling (test only)
- Executable inventory/ledger invariants, a seeded one-business-year simulator (`npm run simulate:year`) and the `business_invariants` suite with a shrink-only known-findings baseline.
- First evaluation report `docs/audit/BUSINESS_LOGIC_AUDIT_V8.md` (inventory and accounting): 12 proven findings registered as TD-250 – TD-261; no application behaviour changed.

### v8.0.0 — Closure of Version 7 & Launch of Version 8
- **Version 7 Closure:** Concluded and archived the v7.x series (`v7.0.0` through `v7.0.140`). `V7_MASTER_ROADMAP.md` is archived with a closing report; the debt registry ends the series with 0 open and 236 resolved rows; `src/data/changelogs/7.ts` is frozen.
- **Version 8 Mission:** `V8_MASTER_ROADMAP.md` — prove or refute the business-logic correctness of inventory, costing, accounting, treasury and payroll with executable invariants and a seeded one-business-year simulation on PostgreSQL 16; every finding gets a failing test, a `TD-###` row and its own `v8.0.x` fix.
- **Governance:** The active and closed series are declared in `src/data/changelogs/index.ts`; `npm run check:version` rejects a version outside the active series and any change to a closed series file.

---

## Version 7.x Series (Archived at v7.0.140)

### v7.0.0 – v7.0.140 — Quality Roadmap & Independent Audit Remediation
- **V7 Roadmap:** strict TypeScript (`strict: true`, v7.0.79), Zod on procurement/transactions/dashboard routes, batched stock and voucher lines, formal Drizzle migrations, per-warehouse stock normalized into `item_warehouse_stocks`.
- **Independent Audit Phases 0–3** (`docs/audit/TECHNICAL_AUDIT_REPORT.md`, base v7.0.17): fiscal-year reference numbering, negative-stock policy, tracked outbox delivery, WooCommerce order sync, structured VAT / exchange rate / service charges, decimal money columns, fiscal periods, attachments on disk, read permissions on every read route, flag and date CHECK constraints, Gregorian ISO date storage, Vitest and Playwright, ESLint ratchet.
- **Closure:** 236 technical-debt rows resolved, none open; details in `V7_MASTER_ROADMAP.md` (closing report) and `TECH_DEBT_ARCHIVE.md`.

---

## Version 6.x Series (Archived at v6.0.28)

### v6.0.0 — Official Launch of Version 6 & Version 5 Closure
- **Version 5 Closure:** Concluded and archived the v5.x series (`v5.0.0` through `v5.0.20`) after successfully completing inter-module integration, the 5-phase invoice-stock fix plan, 15-suite test runner isolation, and conducting the comprehensive independent data-integrity audit.
- **Version 6 Mission:** Enacted the Master Roadmap for Version 6 (`V6_MASTER_ROADMAP.md`) focusing on systemic remediation of 26 audited technical findings across 6 strategic pillars: Event-Sourced Kardex & True WAC preservation, double-entry ledger & year-end closing hardening, treasury separation of cash vs promissory cheques, deadlock-free row-locking hierarchy, and 100% architecture rules compliance (zero direct route mutations and zero hard deletes).
- **Governance Alignment:** Synchronized `AGENTS.md`, `package.json` (`6.0.0`), `check-version-sync.ts`, active roadmap `V6_MASTER_ROADMAP.md`, and activated `src/data/changelogs/6.ts`.

---

## Version 5.x Series (Archived / Finalized)

### v5.0.20 — Final Release & Conclusion of Version 5
- **Inter-Module Integration & Audit:** Completed 20 iterative releases across cross-module integration, stock movement automation, test-suite decoupling, and execution of comprehensive independent business logic audit.

### v5.0.0 — Official Launch of Version 5 & Version 4 Closure
- **Version 4 Closure:** Officially concluded and archived the v4.x series (`v4.0.0` through `v4.0.42`) encompassing major architectural refactorings, strict financial decimal precision, runtime contract hardening with Zod, frontend decluttering, and chunk error resilience.
- **Version 5 Mission:** Initiated Version 5 series with full continuity of Version 4 architectural rules and UI decluttering principles, focusing on deep cross-module integration (Inter-Module Workflows), end-to-end testing, error correction, and cross-functional performance optimization across Inventory, Accounting, Treasury, Production, Procurement, and Orders.
- **Governance Alignment:** Synchronized `AGENTS.md`, `package.json` (`5.0.0`), `check-version-sync`, active roadmap `V5_MASTER_ROADMAP.md`, and activated `src/data/changelogs/5.ts`.

---

## Version 4.x Series (Archived / Finalized)

### v4.0.42 — Final Release & Stabilization of Version 4
- **React Singleton & Chunk Resilience:** Resolved hook dispatch collision across lazy-loaded routes by pinning physical React/ReactDOM resolution in Vite, optimizing JSX runtimes, and hardening ErrorBoundary automated reload logic.
- **Final v4 Milestone:** Successfully delivered 42 iterative releases across architecture, security, financial calculation integrity, and UI/UX decluttering.

### v4.0.27 — Official Milestone Completion of Version 4 Architecture & Governance
- **Phase 1 (Database & Domain Schema):** Modular schema split across 8 domain files, `numeric(..., { mode: 'number' })` type consistency (D-1), soft-delete `isDeleted` standard (D-2), and strict foreign key integrity.
- **Phase 2 (Security Hardening):** Strict production CORS lockdown (S-1), IPv6/IPv4-mapped comprehensive SSRF normalization guard (S-2), authenticated Prometheus `/metrics` protection (S-3), elimination of default secrets in production (S-4), and PII data masking for personnel bank details (S-5).
- **Phase 3 (Financial & Payroll Integrity):** Transactional piecework payroll pipeline with `FinancialDecimal` (F-1, F-2), atomic sequence numbering (`piecework_payroll_number_seq`), strict voucher validation eliminating log-and-continue (F-3), and 3-step atomic document finalization (DB-008).
- **Phase 4 (Runtime Zod Contracts):** Sanitized payload replacement in Express `validate` middleware (S-6), strict mutation permission verification, and runtime validation across documents, inventory, transfers, BOM, vouchers, and treasury.
- **Phase 5 (Idempotency & Concurrency):** Triple-key composite idempotency (`user_id + scope + key`) (F-4), deadlock prevention via table priority lock ordering (`withOrderedLocks`) (A-1), auth caching, N+1 query elimination, and paginated transfers (A-2).
- **Phase 6 (Frontend Optimization & UX):** Refactored 1,875-line `BankAndTreasuryTab` into 9 modular components and `useTreasuryCalculations` hook (Q-1), debounce hooks across all search inputs (U-1), base `Modal` & `PrintModal` components (Q-2), and unified `ErrorBoundary`.
- **Phase 7 (CI/CD, Testing & Modular Scaffold):** Multi-stage GitHub Actions CI with live PostgreSQL 16 container (T-1), unified lockfile & test runner metrics (T-2), standardized domain module scaffold in `src/modules/_template/`, and 100% resolution of all 17 independent audit items (TD-088..TD-103).

### v4.0.0 — Official Launch of Version 4 & Version 3 Closure
- **Version 3 Closure:** Officially concluded and archived the comprehensive v3.x series (`v3.0.0` through `v3.3.22`) covering financial core automation, 4-level trial balance, multi-warehouse management, workflow FSM, domain event bus, and Iranian identifier normalization.
- **Version 4 Mission:** Initiated Version 4 series focusing on architectural optimization, codebase simplification, and targeted UI/UX refinements following the principles of visual decluttering, simplicity, and full Persian terminology.
- **Governance Alignment:** Synchronized `AGENTS.md`, `package.json` (`4.0.0`), and activated `src/data/changelogs/4.ts`.

---

## Version 3.x Series (Archived / Finalized)

### v3.1.16 — Strict Project Completion Gate & Progress Matrix Enforcement
- **Strict Matrix Gate:** Enforced backend validation on `PUT /projects/:id` and `POST /projects/:id/add-to-inventory` requiring 100% completion of the SKU × stage physical progress matrix before allowing project status transition to `completed`.
- **UI Lock & Indicators:** Disabled the "تغییر وضعیت پروژه به تکمیل‌شده" checkbox in `ProjectStockEntryTab` with lock icon, remaining items counter, and intuitive warning toast if clicked while incomplete.
- **Progress Matrix Feedback Banner:** Added status indicator banner in `ProjectProductProgressTab` showing total matrix items completed vs remaining and completion readiness.
- **Over-Reservation Inventory Governance:** Integrated comprehensive inventory availability policies for project material reservations.

### v3.0.4 — Version Drift Resolution & Build SSOT (TD-043)
- **Version Single Source of Truth (SSOT):** Centralized version resolution in `src/lib/version.ts` dynamically deriving build metadata and package version.
- **Probe & Health Endpoint Harmonization:** Updated `/health` and `/api/health` to return synchronized `version` and `buildInfo` payload.
- **Manifest & Backup Alignment:** Unified backup export metadata, Release Gate reports, Recovery verification manifests, and Kubernetes deployment YAML.
- **Automated Version Guard:** Added automated unit test assertion (Test 11 in `unitSuite.ts`) to prevent future version drift regressions.

### v3.0.3 — Performance, Memory Caching & Maintenance (TD-039..TD-042)
- **Frontend Code Splitting:** Dynamic `import('xlsx')` and React.lazy Suspense across Excel export/import and reconciliation components.
- **In-Memory TTL Caching:** Lightweight memory cache for RBAC role permissions lookup and system settings with automatic mutation invalidation.
- **Data Archival & Maintenance:** Purge utilities for old outbox events (`purgeProcessedEvents`) and audit trail records (`purgeOldAuditLogs`).
- **Test Scripts Separation:** Split `test:unit` and `test:full` execution scripts in package.json.

### v3.0.2 — Drizzle Migration Unification (TD-038)
- **Migration Pipeline Unification:** Consolidated all schema definitions into `drizzle/0000_v3_baseline.sql` and adopted standard Drizzle ORM migrator runner.

### v3.0.1 — Repository Architecture & Harmonization
- **Harmonization:** Standardized test suite naming, cleaned up development artifacts, and synchronized project documentation.

### v3.0.0 — Comprehensive UI/UX Overhaul & Financial Automation Milestone
- **Phase 1 (Flexible Multi-Step Invoice Settlements):** Full settlement modal supporting Cash, POS/Bank, Sayad Cheques, and Bank Transfers with automatic double-entry voucher generation and status tracking.
- **Phase 2 (3-Stage Accounting Voucher Lifecycle & Voiding):** Clear draft/audited/final voucher states, reversal vouchers for voiding, and correction vouchers with audit logs.
- **Phase 3 (Floating Detailed Party Ledger):** Comprehensive customer/vendor/personnel ledger with running balances, debt/credit indicators, and clean printing/export formats.
- **Phase 4 (Line & Cash Discounts):** Segregated line-item discounts and prompt cash payment discounts automatically mapped to designated discount accounts.
- **Phase 5 (Smart Financial Health Inspector):** Automated audit engine checking 6 critical areas (equilibrium, abnormal balances, inventory-to-ledger reconciliation, missing vouchers, overdue cheques, and bank bindings) with one-click automated sync.
- **Phase 6 (Global UI Simplification & Decluttering):** Universal adoption of the clean `ActionMenu` pattern across all system tables (invoices, items, vouchers, treasury, cheques, personnel, users) and complete Persian translation of technical/Latin terms.

---

Rules:
- Every functional/UI/security change adds an `AIUpdateLog` entry to the active
  version file (`2.ts`) with a unique semver bump; duplicates are never allowed.
- The old per-major-version files (`v1.ts … v9.ts`, ~700 KB of static data) were
  removed from the client bundle on purpose; consult Git for their content.

---

## Pre-1.0 history summary (v8.29.0 → v9.0.0 → baseline)

### v9.0.0 — Stability & Production-Ready (final V9 release; pre-reset era, unrelated to the current 9.x series)
**Phase 0 — P0 hotfixes**
- Locked down `PUT /documents/:id` finalization bypass (status transitions may no longer reach `final`; Zod body schema + service guard).
- Positive quantity / non-negative price validation on document line items and inside `applyStockMovement`.
- WooCommerce order processing made fully transactional (`externalTx` threading) + mandatory HMAC signature (fail-closed).

**Phase 1 — Financial integrity**
- Accounting voucher reversal issued automatically when a finalized document is deleted (+ DB-009 kardex reversal rows via `reversal_of_id`).
- Non-destructive `next-ref` peek (no more burned invoice numbers); atomic cold-start counter seeding.
- Decimal.js accumulators across voucherSync/treasury/documents; NaN-safe pagination caps (`parsePagination`, MAX_PAGE_LIMIT).

**Phase 2 — API hardening & edge security**
- Global error handler migration: ~175 ad-hoc handlers removed; uniform `{error, code, traceId}` responses.
- User lifecycle: soft delete, last-admin protection, `tokenVersion` session invalidation with live per-request user validation.
- CSRF fail-closed for legacy tokens; exact-match webhook auth paths; protected `/metrics` (`METRICS_TOKEN`); dead routes removed.

**Phase 3 — Currency UX**
- Eliminated ~100+ hardcoded «ریال» labels via `<Money>` + `useAppCurrency()`; per-currency KPI totals.
- SearchableSelect adopted in CRM/Documents/Accounting/Cheques forms.

**Phase 4 — UX polish**
- Modal scroll contract on 15 modals; real error display for rule tester (was faking success).
- Minimal responsive shell (<1024px auto-collapse), AbortController on global search, visibility-aware polling.
- SafeImage placeholders, RolesTab empty state, login lockout countdown + password reveal.

**Phase 5 — Code quality**
- React Query migration: Users/ActivityLogs/InvoicesList/Documents/Pricing/Transactions pages (hierarchical keys, placeholderData, cache-first reference lists).
- Giant component decomposition (~1400 LOC out of main pages): approval inbox, customers, NewVoucherModal, pricing, documents → 11 modular components.

**Phase 6 — Regression suite**
- `v9RegressionSuite`: bypass blocking, negative item validation, accounting reversal on deletion, peek idempotence, pagination caps, live session validation. Discovered & fixed a hidden bug: reversal-voucher read-back used outer ORM connection instead of caller's `externalTx`.

### Earlier eras (v1 … v8.29)
Accumulated feature set summarized in the baseline entry (`src/data/changelogs/0.ts`):
warehouse & multi-currency WAC inventory, warehouse docs with workflow approvals,
double-entry accounting with auto vouchers (sales/purchase/warehouse/payroll/treasury/Sayad-cheque),
fiscal-year closing, CRM kanban, production projects with BOM allocation, piecework payroll,
visual workflow designer (SLA analytics), domain-event bus + transactional outbox + DLQ,
webhook subscriptions with HMAC signatures, WooCommerce sync with idempotency,
RBAC permission catalog, observability stack (Winston rotation, Prometheus, K8s probes,
graceful shutdown) and atomic tracked migrations.

---

## v1.1.0 — V10 Release Sign-off (پایدار)

**Date:** 1405/06/06 • **Roadmap:** V10 Master Blueprint (phases 0→7 complete; docs archived in Git history)

| Phase | Deliverables (release series v1.0.x → v1.1.0) |
|---|---|
| 0 — Hotfix | Data-safety hard gate on test cleanup, Kardex envelope contract, ConfirmModal standardization, changelog reset |
| 1 — Date/TZ | Agreed business clock (`businessClock.ts`), client TZ provider, atomic Jalali date-normalization migration (alt_034) |
| 2 — Items & Coding | Unified tabbed products page, 300KB image standard + shared compressor, atomic `item_code_counters` next-code (alt_035), segmented code-builder UI |
| 3 — Unified UX | 21 native dialogs removed (Promise-based ConfirmDialogHost), unified print system (`.no-print`, DocPrintModal, isolated print area), movement analysis relocated, two-step inventory-audit confirmation |
| 4 — CRM & HR | Sellers as personnel (`assigned_personnel_id`, alt_036), formal `documents.crm_lead_id` (alt_037) + gated-lead unlock + customer-sync audit diffs, treasury-locked payroll payments (`PayrollPaymentService`) + fixed/mixed salary models (alt_038) |
| 5 — RBAC & Menu | Approved 8-group menu restructure + `/inventory-status`, permission vocabulary unification + dead-permission enforcement, per-role `menu_visibility` matrix (deny-list) |
| 6 — Finance & Print | Automation-status report (voucher coverage per doc type), per-project accounting report with running balance, workflow approver signatures on printed documents |
| 7 — Release Eng. | Docs consolidated into AGENTS.md (single source), new README with Linux install/update scripts (`install.sh`, `update.sh`, systemd), V10 regression suite (6 critical scenarios) |

**Sign-off:** All 15 critical-scenario suites + V10 regression suite green; lint and production build clean; `package.json`, `/health` and `src/data/changelogs/1.ts` version strings aligned at **v1.1.0**.

---

## v2.8.7 — تکامل و پاکسازی بدهی‌های فنی (سری 2.x پایدار)

**Date:** 1405/06/15 • **Series:** 2.x • **Milestone:** رفع جامع بدهی‌های فنی باز (TD-033 تا TD-037) و بهبود استحکام معماری

| حوزه | دستاوردها و اقدامات انجام‌شده |
|---|---|
| **TD-033 (Backend Types)** | جایگزینی بیش از ۳۸۰ نقطه `: any` در سرویس‌های رویدادها، ورکفلو، ریکاوری، اکشن‌ها و روت‌های اکسپرس با تایپ‌های صریح و بدون خطای تایپ‌اسکریپت |
| **TD-034 (Dates & Calendars)** | استانداردسازی کامل تاریخ‌های میلادی ISO و ثبت همزمان (Dual-Write) در جداول `daily_work_logs`, `piecework_logs`, `crm_activities` به همراه مایگریشن بک‌فیل و ایندکس‌ها |
| **TD-035 (Migrator)** | رفع وابستگی و اصلاح سال مالی در backfill قدیمی مایگریتر |
| **TD-036 (DB Hygiene)** | توسعه اسکریپت تراکنشی `scripts/cleanup-test-data.ts` (`npm run db:cleanup-test`)، پاکسازی کامل داده‌های آزمایشی و تسویه‌نشده، کالیبراسیون توالی‌های PostgreSQL و اسکن ۱۰۰٪ سالم مغایرت‌گیری ۱۲ گانه |
| **TD-037 (Dead Code Elimination)** | حذف کامل کامپوننت بلااستفاده `src/components/SystemTestRunner.tsx` (۳۰۰ خط کد مرده)، کاهش حجم باندل نهایی فرانت‌اند و تثبیت مسیر رسمی آزمون‌ها از طریق CLI استاندارد `npm run test` |

**Sign-off:** تمامی بدهی‌های فنی رده مهم و بحرانی حل شده؛ بیلد و linter کاملاً سبز (`tsc --noEmit` + `vite build`)؛ هماهنگی نسخه‌ها در `package.json`, `src/app.ts (/health)`, `src/data/changelogs/2.ts` روی **v2.8.7**.

