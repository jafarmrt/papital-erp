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
| Client-bundled update center (active) | `src/data/changelogs/8.ts` | current `8.x.y` release series (`v8.0.0` onward); short entries, important points only (v7.0.54) |
| Root archive (this file) | `CHANGELOG.md` | summary of the pre-reset history & milestones |

---

## Version 8.x Series (Active — see `src/data/changelogs/8.ts`)

### v8.0.49 — Deleted Cheques Stay Deleted
- A deleted cheque can no longer be cleared, bounced or deleted again; clearing it used to add its amount to the bank balance, and a concurrent delete and clear were both accepted.

### v8.0.48 — Each Voucher Is Reversed Only Once
- Two concurrent correction vouchers, or a correction and a reversal at the same time, no longer both reverse the same voucher; correction and repost lock the original voucher and every path refuses a voucher that already has an active reversal.

### v8.0.47 — Stock Paths Without Deadlocks
- Area J (concurrency) reviewed. Every stock path locks all its items at once, in id order and before any other lock, with FOR NO KEY UPDATE, so concurrent voids, invoices, receipts and returns sharing items no longer deadlock and a void's reversal row keeps the Kardex replay equal to the live WAC.

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

### v9.0.0 — Stability & Production-Ready (final V9 release)
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

