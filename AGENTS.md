# AI Agent Instructions (AGENTS.md)

> **Documentation Map (Version 7.0.0 Architecture & Governance):** این فایل مرجع یگانه قواعد معماری و حاکمیت پروژه است. قوانین بنیادین: `ARCHITECTURE_RULES.md` • نقشه راه فعال: `V7_MASTER_ROADMAP.md` • نقشه راه آرشیو v6: `V6_MASTER_ROADMAP.md` • نقشه راه آرشیو v5: `V5_MASTER_ROADMAP.md` • نقشه راه آرشیو v4: `V4_MASTER_ROADMAP.md` • نقشه راه آرشیو v3: `V3_MASTER_ROADMAP.md` • دفتر بدهی: `TECH_DEBT.md` • چنج‌لاگ فعال: `src/data/changelogs/7.ts` • راه‌اندازی ویندوز: `docs/LOCAL_DEV_WINDOWS.md` • ابزار MCP: `docs/LOCAL_MCP_TOOLING.md`.

هر ایجنت هوش مصنوعی برای حفظ پایداری سیستم ملزم به رعایت دقیق این قواعد است:

## 1. Drizzle ORM & PostgreSQL Rules
1. **NO RAW SQL FOR MUTATIONS:** Never use `tx.execute(sql\`UPDATE ...\`)` or raw SQL with bindings for inserts/updates (prevents `operator is not unique: unknown * unknown` in node-postgres).
2. **Update Pattern (Read-Calculate-Update):** Always fetch row via `tx.select()`, compute mutations in TypeScript, and save via `tx.update().set()`.
3. **Row Locking:** For data updated within the same transaction, use `.for('update')` (NOT `.forUpdate()`).
4. **Explicit Text Casting for WHERE Queries:** For code columns (e.g. `project_code`), cast with `sql\`${table.projectCode} = ${String(code)}::text\``.
5. **Drizzle CamelCase Mapping & Standard Serialization (TD-170):** Express API endpoints for production projects and stages use standardized `camelCase` keys matching the Drizzle schema and typed contracts via `formatProject` and `formatStage` (with backward compatibility aliases for safe consumption).
6. **Atomic Sequence Numbering:** Sequential numbers (vouchers, treasury transactions, document references) MUST use PostgreSQL Sequences (`SELECT nextval('...')`) or atomic counter tables (`document_ref_counters` / `item_code_counters`, row lock or UPSERT), NEVER `COUNT(*)` or `MAX() + 1`.
7. **Module Resolution (`/src/db/drizzle.js`):** Subdirectory services MUST import Drizzle instance explicitly from `../../db/drizzle.js` (or `.ts`) to ensure clean production bundling.
8. **Money Columns are Decimal on the Server (v7.0.67, audit P2-6 / TD-210, product-owner decision):** Money columns are declared with `moneyNumeric` (`src/db/schema/moneyColumn.ts`; done for every money column — accounting, treasury, document lines/VAT/exchange rate, WAC, Kardex, item prices, payroll and piecework (v7.0.68)). Report totals are summed in SQL (`SUM(...)::text` → `fin()`) or accumulated with `FinancialDecimal`, never with JS `+=` on numbers (v7.0.71, TD-210 resolved).. Their value is `Money` (`src/lib/money.ts`, a `FinancialDecimal`): do arithmetic and comparisons with its methods or `fin()`, write with `money(x)` / `moneyOr(x, fallback)`, never through `Number()` or JS operators. API JSON stays numeric (`Money.toJSON`); DTOs typed `number` convert explicitly with `.toNumber()`.
9. **Flag and Date CHECK Constraints (v7.0.73 / v7.0.75, audit P3-14 / P3-15, product-owner decision — no type change):** Integer `is_*` / `has_*` flags carry `chk_<table>_<column>_flag CHECK (col IN (0,1))`; text date columns carry `chk_<table>_<column>_datefmt CHECK (erp_date_text_ok(col, 'iso' | 'any'))` (migrations 0028 and 0030; `*_iso` columns are `iso`). A new flag or text date column gets the same constraint in its migration (regression tests `reg_flag_check_constraints_p3_14` / `reg_date_format_check_constraints_p3_15` fail otherwise). Constraints are added `NOT VALID` and validated only when existing data is clean — never rewrite old rows silently to satisfy them; a repair needs a product-owner decision and records every old value (v7.0.82, TD-231: `legacy_date_repairs`, shown by the financial health check).

## 2. API Response Handling & Array Safety Guard
- **Safe Extraction:** APIs return paginated `{ data: [...], total, page, limit }` or arrays `[...]`. Always extract safely:
  ```ts
  const rawData = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
  ```
- **Guard Array Operations:** Always guard before calling array methods:
  ```ts
  const safeItems = Array.isArray(items) ? items : [];
  const filtered = safeItems.filter(...);
  ```

## 3. Inventory & Stock Management
- **Single Source of Truth for Stock (v7.0.45 / v7.0.48, audit P2-1 / TD-214, product-owner decisions):** Per-warehouse stock lives ONLY in `item_warehouse_stocks` (one row per item × warehouse, CHECK non-negative); a missing row means zero. The `items.stocks` JSONB column was dropped (migration 0021; old values kept in `items_stocks_archive`). `items.current_stock` is maintained ONLY by the database (`trg_iws_refresh_item_current_stock` on `item_warehouse_stocks` and `trg_items_current_stock_from_table` on `items`): application code must never write it — a direct write is replaced by `SUM(item_warehouse_stocks)`. API responses that need a per-warehouse map build `stocks` / `stock_<code>` from `ItemWarehouseStockService.getStocksForItems` (canonical warehouse codes via join); availability / count / transfer checks read the table.
- **Weighted Average Cost (WAC):** Updated ONLY on stock 'in'. If current stock <= 0, new WAC equals the new unit price. WAC and Kardex amounts are in IRR: a foreign-currency document's unit price is converted with the document's own exchange rate (`stockUnitPriceInIrr` in `src/services/documents/documentExchangeRate.ts`) before `applyStockMovement` (v7.0.69, TD-227, product-owner decision).
- **No Outflow Without Cost (v7.0.46, audit P2-4, product-owner decision):** An `out` movement records the item's WAC as its cost. If WAC <= 0 the movement is rejected (`ValidationError`) — sales invoices, remittances/waste, project material allocation, WooCommerce orders — except stock-count and Excel adjustments (`documentType = 'audit'`), which are recorded at cost 0. The document price (sale price) or a price-list price is never used as cost.
- **Sales Return Cost (v7.0.81, TD-230, product-owner decision):** A sales return (`return`, stock in) enters stock at the cost of the original sales invoice's Kardex `out` rows (`documents.return_of_document_id`, `resolveSalesReturnUnitCosts` in `src/services/documents/salesReturnCost.ts`), or at the item's current WAC when no original invoice is linked — never at the sale price. Its voucher reverses cost of sales with the return's own Kardex `in` cost.
- **Centralized Stock Movements:** All stock operations, warehouse locations, and WAC calculations MUST route through `DocumentService.applyStockMovement` in `src/services/document.service.ts` (item creation and opening stock included). Warehouse-to-warehouse transfers that must not change WAC move both rows through `ItemWarehouseStockService.applyMovement` and then rebuild the cache.
- **Default Warehouse (TD-203, v7.0.36):** The default warehouse is the ACTIVE warehouse with the LOWEST id. Any query that picks a default/first warehouse MUST `orderBy(asc(warehouses.id))` (or use `getDefaultWarehouseCode` in `src/services/inventory/warehouseResolver.ts`); PostgreSQL row order without `ORDER BY` changes after updates.
- **Document Statuses:** Supported document statuses in API and services: `'draft'`, `'proforma'` (پیش‌فاکتور), and `'final'`.
- **Soft Delete & Reversal (DB-009):** Never HARD DELETE stock transactions. Set `is_deleted = 1`, issue an atomic reversal transaction with `reversal_of_id`, and recalibrate balances via `DocumentService.applyStockMovement`.
- **Negative Stock Policy (DB-006, TD-180):** Negative stock is **always forbidden** (product-owner decision, v7.0.22). Reductions (`out`) must fail with `InsufficientStockError` before committing; the database constraint `chk_iws_current_stock_non_negative` on `item_warehouse_stocks` is the final safeguard. The legacy `warning` / `allowed` options are removed and must not be reintroduced without dropping that constraint in a new migration.

## 4. WooCommerce Integration & Webhooks
- **Public Route Exemption:** Webhook endpoints (`/api/woocommerce/webhook/order`) must be exempted from `authenticateToken` in `src/middleware/auth.ts` for ping/payloads (GET, POST, HEAD).
- **Preview Domain Resolution:** Replace `ais-dev-` with `ais-pre-` in `window.location.origin` when displaying webhook delivery URLs in AI Studio preview environments.
- **SKU Matching & Orders:** Match line items to ERP items via `items.code` (SKU). Route orders through `DocumentService.createDocument` (`docType: 'invoice'`, `status: 'final'`, `inOut: 'out'`).
- **Order Status Policy (TD-190, v7.0.30):** All order processing lives in `WooOrderSyncService` (`src/services/woocommerce/wooOrderSync.service.ts`). Only `processing` / `completed` issue a final invoice; other statuses are logged as `deferred`. `cancelled` / `failed` void the invoice through `DocumentService.deleteDocument` (DB-009); `refunded` is only flagged `needs_review`. An order with any unmatched SKU is rejected as a whole (no partial invoices). Each order is serialized by a row lock on its `woocommerce_order_logs` row; failures are persisted outside the rolled-back transaction. The webhook always answers HTTP 200 (WooCommerce never re-delivers and disables a webhook after 5 non-2xx responses); retries happen via manual order sync.

## 5. Security, Authentication & Audit Logging
- **HttpOnly Cookies:** JWT tokens are issued and stored exclusively via secure HttpOnly cookies (`auth_token`, `secure: true`, `sameSite: 'none'`, `path: '/'`). Browser JS MUST NOT store or read raw tokens in `localStorage`. All client fetch calls MUST specify `credentials: 'include'`.
- **No Token in Response Bodies (TD-185, v7.0.27):** Login/setup responses MUST NOT include the JWT by default. The only exception is the opt-in compatibility flag `EXPOSE_TOKEN_IN_BODY=true` for preview environments whose browsers block the iframe cookie (BUG-08); production deployments must leave it unset.
- **Login Lockout per Username + IP (v7.0.70, TD-187, product-owner decision):** The progressive login lock (5 failures → 1, 2, 4 … at most 30 minutes) applies to the (username + client IP) pair, held in memory (single instance); the whole account (`users.locked_until`) is locked only after `ACCOUNT_LOCKOUT_THRESHOLD` = 50 failures from any address within 24 hours (`src/services/auth/loginSecurity.service.ts`). Unknown usernames behave identically; no CAPTCHA.
- **Session Verification & Logout:** Use `/api/auth/me` to verify session on load, and `/api/auth/logout` to clear the cookie.
- **Route Middleware Order:** Administrative/utility/seed routes MUST be registered AFTER `router.use(authenticateToken)` and protected via `authorize('admin')`.
- **Role vs Permission Namespaces (v7.0.51, audit P2-10):** Permission keys always contain a dot (`customers.manage`); role codes never do (`ROLE_CODE_PATTERN = /^[a-z0-9_-]+$/`, enforced on role creation). `authorize` / `authorizePermission` / `userHasRoleOrPermission` match the user's role code only against dot-less guard entries and the role's permissions only against permission keys; `admin` always passes.
- **Read Scope by Section Permission (v7.0.53, audit P2-10, product-owner decision — existing permissions only):** Global search returns each section only to holders of its view permission (items `products.view`, customers `customers.view`, documents/invoices `documents.view`, projects `projects.view`; a section without permission is empty, never an error). Kardex list `GET /api/transactions`: `warehouse.view` OR `accounting.view`. Warehouse dashboard statistics (`/api/stats`, `/api/dashboard-bi-stats`) and the «وضعیت انبار» page: `reports.view` OR `warehouse.view` (v7.0.55). Menu items and page routes use the same permissions as their API. User input in LIKE / ILIKE patterns goes through `containsLikePattern` / `startsWithLikePattern` / `escapeLikePattern` (`src/lib/sqlLike.ts`); a unit test rejects `%${…}`, `'%' +` and template literals passed straight to `like` / `ilike` (v7.0.57, TD-222).
- **Read Permissions for All Read Routes (v7.0.59, TD-223, product-owner decision — existing permissions only):** Every read route that returns business data is guarded with `authorizePermission(...READ_PERMISSIONS.<section>)` from `src/lib/recordReadPermissions.ts` (any one permission suffices: the section's view permission plus the permissions of pages/forms that pick from that list — add a page's visibility permission there when a new page consumes a list). Payroll amounts: `piecework.payroll` / `personnel.manage` / `accounting.treasury` (own payslips via `/piecework/payrolls/mine`). Full user and role directory: `users.manage` / `roles.manage` / `personnel.manage` / `workflow.manage` / `settings.manage`; `/users/list-simple` (names only), settings (secrets masked), categories, warehouses and the user's own data stay login-only.
- **Audit Logging & Snapshots:** All state mutations (customers, items, prices, documents, stocks, permissions) MUST log via `logActivity` in `src/lib/auditLogger.ts` with before/after snapshots.
- **Log Sanitization:** Sensitive fields (`password`, `token`, `secret`, `jwt`, `cookie`) MUST be sanitized to `[PROTECTED]`.
- **Soft Deletes:** Always filter with `.where(eq(table.isDeleted, 0))` on reads.

## 6. Localization & UI Guidelines
- **Dates & Numbers:** Server dates must use `src/lib/businessClock.ts`. UI dates use `Intl.DateTimeFormat('fa-IR')`. Numbers formatted via `formatPersianPrice` or `formatPersianNumber`. Iranian identifiers (national ID, phones) preserve leading zeros via `formatPersianPhone` and `formatPersianNationalId`.
- **Dynamic Currencies:** Respect `currency` on records (IRR, USD, EUR, AED, GBP); do not hardcode "ریال".
- **Structured VAT (TD-197, v7.0.32):** Sales VAT lives only in `documents.vat_percent` / `documents.vat_amount` (resolved via `src/services/documents/documentVat.ts` on create, update and finalize). The sales voucher reads `vat_amount` only — NEVER parse amounts, rates or taxes out of free-text `notes`, and never write VAT into notes. Payable amount = net of lines + `vat_amount`.
- **Structured Exchange Rate (TD-198, v7.0.63, product-owner decision):** The exchange rate of a non-IRR document (IRR per one unit of its currency) lives only in `documents.exchange_rate` and is required on create, update and finalize (`src/services/documents/documentExchangeRate.ts`). Vouchers take it via `VoucherSyncService.resolveVoucherExchangeRate` (explicit rate, document column, `exchange_rate_<cur>` setting) and never from `notes`; without a rate no voucher is issued (never rate 1). Pre-v7.0.63 documents were not migrated.
- **Double Submissions:** Always use `isSaving` or `loading` to disable submit buttons.
- **Large Selects:** Use `SearchableSelect` (`src/components/SearchableSelect.tsx`) for large datasets.
- **Form State:** Use dedicated `editingId: number | null` and `isEditing = editingId !== null` instead of holding `id: 0`.

## 7. AI Agent Auto-Changelog Updates & Release Tracking
- **Mandatory Update Logging:** Whenever modifying code, adding features, optimizing, or fixing bugs, you MUST append a new release entry to the **active** changelog file (currently `src/data/changelogs/7.ts`, series `v7.x.y` — see §13 and §23) with Jalali date, version bump, title, summary, changes, and fixes.
- **Short Entries, Important Points Only (v7.0.54, product-owner decision):** Every version still gets exactly one entry, but it records only important changes and important / critical bugs — no file lists, test names, debt bookkeeping or "version bumped" lines (those belong in the commit and `TECH_DEBT.md`). Limits in `src/data/changelogs/compactRule.ts` (title ≤ 90, summary ≤ 300 chars, ≤ 4 changes, ≤ 4 fixes, each ≤ 150 chars) are enforced by `npm run check:version`.
- **Every Claim Has a Test (v7.0.64, audit P3-13):** Every fix or behaviour change recorded in the changelog is backed by at least one automated test that fails on the previous version and passes on the new one. The test id is named in the commit message and in the `TECH_DEBT.md` / `TECH_DEBT_ARCHIVE.md` row (never in `7.ts`, per the rule above). A claim without such a test (e.g. a refactor or a documentation change) is worded as such and never as a fix.

## 8. Server Startup & Background Seed Execution
- **Port 3000 Ingress:** In AI Studio preview / Cloud Run, `server.ts` MUST bind and listen on port 3000 immediately.
- **Background Seeding:** Seeding (`runSeed()`) must run asynchronously in background IIFE without blocking server startup.

## 9. Standard 22 Categories & Default Units
- **22 Categories:** 8 product categories (گردنبند، گوشواره میخی، گوشواره آویز، انگشتر، دستبند، گوشواره بزرگ، گردنبند بزرگ، دو تکه) and 14 raw_material categories.
- **Auto-Fill Default Units:** When category is selected in `ItemFormModal.tsx`, unit automatically updates to category's `defaultUnit` (جفت، ریسه، برگ، متر، عدد و...).

## 10. Transfers & Image Management
- **Dual-Route API:** Transfer routes in `src/routes/transfers.routes.ts` accept both `POST` and `PUT` across `/transfers` and `/transfers/:code`.
- **Attachments on Disk (v7.0.56, audit P2-9, product-owner decision):** Attachment files of documents, journal vouchers, cheques, treasury transactions, projects and payrolls live in `public/uploads/.attachments/` (never served by `/uploads`) and are registered in `file_attachments`; the JSONB `attachments` columns hold metadata and `/api/attachments/<id>` only — never Base64. Every save path passes incoming attachments through `AttachmentStorageService` (`attachToNewRecord` after insert, `normalizeForRecord` on update). Files are downloaded only via `GET /api/attachments/:id`, which requires the read permission of the owning record (`RECORD_READ_PERMISSIONS` in `src/lib/recordReadPermissions.ts`, also used by those records' read routes).
- **Orphan Attachment Cleanup (v7.0.83, TD-224):** Files whose save transaction rolled back have no `file_attachments` row. Only the manual `npm run attachments:cleanup` / `POST /api/attachments/cleanup-orphans` (admin, dry-run by default, advisory lock 91005) removes them: `<uuid>.<ext>` files with no row at all, older than 60 minutes. Files of attachments detached from their record (`is_deleted = 1`) are kept and only counted.
- **Modal Viewports:** Large modals must use fixed headers/footers with internal scrollable bodies (`max-h-[85vh]` or `max-h-[90vh]`) for iframe preview compatibility.

## 11. Modular Accounting Services & Facade Pattern
- **6 Sub-Services in `src/services/accounting/`:**
  1. `ChartOfAccountsService`: Coding hierarchy, standard accounts, tree generation.
  2. `VoucherService`: Journal vouchers, atomic sequence (`voucher_number_seq`), balanced debit/credit validation.
  3. `TreasuryService`: Bank accounts, cash funds, petty cash, Sayad cheques lifecycle, treasury transactions.
  4. `AccountingReportService`: Trial balance (2/4/6/8-col), detailed ledger, balance sheet, income statement.
  5. `VoucherSyncService`: Automated vouchers for sales, purchases, warehouse movements, payroll.
  6. `FiscalYearService`: Closing temporary/permanent accounts, opening/closing vouchers.
- **Unified Facade:** `AccountingService` in `src/services/accounting.service.ts` binds all sub-services for 100% backwards compatibility.
- **AccountNature Consistency:** Standard type is `AccountNature = 'debit' | 'credit' | 'both'`.
- **Fiscal Periods (v7.0.49, audit P2-5, product-owner decisions):** Whether a (Jalali) fiscal year is closed lives ONLY in `fiscal_periods` (`FiscalPeriodService`); never infer it from voucher reference numbers. Every voucher create/update/delete/reverse/finalize calls `VoucherService.checkFiscalPeriodOpen(date, tx)`, which locks the year's row `FOR SHARE`; `FiscalYearService.executeFiscalYearClosing` locks it `FOR UPDATE` before computing balances and marks it closed in the same transaction. No voucher type (including `closing`) bypasses the check. The double-entry balance tolerance is the single constant `VOUCHER_BALANCE_TOLERANCE = 0.01` in every path (`src/lib/voucherBalance.ts`; the voucher forms use `computeVoucherBalance` from the same file, v7.0.76).
- **Transactional Voucher Generation (DB-008):** `VoucherSync` calls triggered from documents/treasury MUST execute inside the same database transaction (`tx`).
- **Document ↔ Voucher Link (TD-193, v7.0.31):** Vouchers issued by `VoucherSync` for a document carry `journal_vouchers.source_document_id` (unique among active vouchers, migration 0017). Always find a document's voucher by `source_document_id`, never by (`reference_module`, `reference_id`) — reversal/correction/repost vouchers (`REV-V…`, `CORR-V…`, `VOID-REPOST-V…`, `REPOST-V…`) keep `reference_module='invoice'` but store the ORIGINAL VOUCHER id in `reference_id`.
- **No Bulk Accounting/Inventory Work at Boot (TD-193):** Server startup must not run bulk voucher sync or Kardex backfill. Bulk voucher issuance runs only manually via `VoucherSyncService.syncMissingDocumentVouchers` (missing vouchers only, never rewrites existing ones) under advisory lock 91001; Kardex initial backfill via `KardexBackfillService.runExclusive` under lock 91002 (`src/lib/advisoryLock.ts`).

## 12. Kardex Event Sourcing & Inventory Reconciliation
- **Event-Driven Verification:** Calculate true stock balances from sequential `stock_movements` log.
- **Three-Way Invariant:** `item_warehouse_stocks` (truth) = `items.current_stock` (database-maintained sum) = Kardex ledger balance (active rows, excluding reversals of soft-deleted rows). Kardex locations and legacy JSON keys map to warehouses with one rule (`createLedgerLocationResolver`: '' / 'default' = default warehouse, then code, then name, all warehouses). The Kardex rebuild refuses (never silently drops) items with movements in an unresolvable location or a negative per-warehouse balance.
- **Warehouse Stock Reconciliation (TD-200, v7.0.33):** `WarehouseStockReconciliationService` compares `item_warehouse_stocks` with the Kardex ledger (active rows, excluding reversals of soft-deleted rows). Repairs are manual only, dry-run by default, correct quantities only (never WAC), never auto-adjust negative ledger balances or items with unresolvable Kardex locations, and log every change/refusal to `inventory_reconciliation_anomalies`. Data-fixing migrations must never clamp or overwrite silently: add (`existing + EXCLUDED`) and record anomalies.

## 13. Scalable Changelog Architecture
- **Version Partitioning:** `src/data/changelogs/0.ts` (`v1.0.0`) and `archive_1_6.ts` (condensed `v1.x`–`v6.x`, v7.0.11) are archives; `7.ts` is active.
- **Active File:** For version 7.x releases, append to `src/data/changelogs/7.ts` and bump the version in all synced locations listed in §23.

## 14. Workflow Engine, Visual Canvas & SLA Analytics
1. **Rule Engine (`ruleConditionsJson`):** Evaluate context variables using operators (`eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `contains`).
2. **Parallel Approvals (`approvalProgressJson`):** Support `SINGLE`, `AND_ALL`, `OR_ANY`, and `K_OF_N` multi-signature rules.
3. **Immutable DSL Versioning (`snapshotDsl`):** Store immutable JSON snapshot and version upon instance creation (`startInstance`).
4. **Canvas Position Persistence:** Persist node coordinates (`positionX`, `positionY`) and `slaHours` in `workflow_states`.
5. **SLA Analytics:** SLA compliance and bottleneck states derived from `workflow_history_logs` (`now() - updatedAt` vs `slaHours`).

## 15. Enterprise Domain Event Bus & Outbox Pattern
- **Event Catalog:** Domain events follow `BaseDomainEvent` contract (`eventId`, `eventType`, `aggregateType`, `aggregateId`, `payload`, `metadata`, `occurredAt`).
- **DomainEventBus:** Central singleton dispatcher (`src/services/events/domainEventBus.ts`) with non-blocking handlers.
- **Transactional Outbox:** Write events atomically inside `tx` via `OutboxService.recordEvent(tx, event)`.
- **Exponential Backoff Worker:** Polls pending events, dispatches, retries (5s, 10s, 20s... max 5 attempts).
- **Tracked Dispatch (TD-183, v7.0.25):** `publish()` stays fire-and-forget (non-blocking, errors only logged). The outbox worker and DLQ replay MUST use `domainEventBus.dispatchTracked(event, completedHandlers)`, which awaits every handler and reports failures. Every handler is registered with a stable name (`subscribe(type, fn, name)`) and MUST rethrow its errors after logging; succeeded handler names are persisted in `outbox_events.completed_handlers` so retries never re-run a handler that already succeeded.
- **Dead Letter Queue (DLQ):** Failed events transfer to `dead_letter_queue` with replay/dismiss endpoints.
- **Automated Event Actions:** `EventActionEngineService` dynamically triggers webhooks, notifications, SMS, or workflows based on rules.
- **HMAC-SHA256 Signatures:** Webhooks sign payload with HMAC-SHA256 and attach `X-ERP-Signature-256` and `X-ERP-Delivery-Id`.

## 16. Frontend Communication & Polling Optimization
- **Standardized `fetchJson`:** Use `fetchJson` from `/src/api.ts` with `credentials: 'include'`.
- **Guarded Background Polling:** Intervals (`setInterval`) must check active sub-tab state and clean up on unmount.

## 17. System Testing, E2E Audit & Test Runs
- **Vitest for New Unit & Frontend Tests (v7.0.76, audit P3-6, product-owner decision):** New pure-unit and React component tests are Vitest files in `src/tests/vitest/*.test.ts(x)` (jsdom + Testing Library), run with `npm run test:vitest` (CI lint job). Database and domain suites stay on the existing runner.
- **Playwright Critical Path (v7.0.77, audit P3-7):** `e2e/critical-path.spec.ts` drives login → final sales invoice → its journal voucher against the production bundle (`dist/server.cjs`) on an empty database (`E2E_DATABASE_URL`, `npm run test:e2e`, CI job `e2e`; the web server is awaited on `/health/startup`, not `/health/ready`, because migrations and seed run in the background). UI changes on these pages must keep it green.
- **Modular Test Suites:** Suites isolated under `src/tests/suites/` (`unit`, `database`, `workflow`, `concurrency`, `integration`, `security`, `api`, `regression`, `criticalPath`, `businessLogicAudit`, etc.).
- **Test Runs (v7.0.64, product-owner decision):**
  - **While working:** verify with `npm run lint` and run ONLY the tests relevant to the change (`npx tsx scripts/run-tests.ts --suite <name> --filter <id-or-keyword>`), plus the same test on the previous code to prove it fails there.
  - **Before every push:** run the full suite with the CI settings (`npm test` with the environment of the `test` job in `.github/workflows/ci.yml` against PostgreSQL 16) and `npm run build`; push only when both pass.
  - **Otherwise:** a full run happens only when the user explicitly asks for it.
  - **No Polling Loops:** never poll long background jobs repeatedly; wait for the completion notification.

## 18. Financial Reporting & Trial Balance
- **4-Level Trial Balance (`FinancialReportsTab.tsx`):** Displays group, general, subsidiary, and detailed accounts.
- **Supported Formats:** 2-column, 4-column, 6-column, and 8-column balances.
- **General Journal Book (`journal-book`):** Double-entry vouchers sorted by date and number with verified debit/credit balance.
- **Drill-Down:** All balance rows support instant navigation to detailed ledger cards (`ledger`).

## 19. Concurrency, OCC & Database Stability Rules
- **PostgreSQL Atomic Sequences (DB-001, DB-003, DB-011):** Sequence IDs generated via `nextval('...')` or the `document_ref_counters` / `item_code_counters` counter tables.
- **Idempotency OCC Locks (DB-010):** `IdempotencyService` uses `.onConflictDoNothing()` and OCC (`status` and `locked_until` in UPDATE WHERE clause).
- **Stock Soft Delete & Reversal (DB-009):** `is_deleted = 1` + reversal transaction + balance recalculation.
- **Negative Stock Guard (DB-006, TD-180):** Inventory deductions below zero are rejected (policy fixed to `forbidden`, enforced in `ItemWarehouseStockService.applyMovement` and by the DB CHECK constraint).

## 20. Observability, Error Handling & Lifecycle Rules
- **AppError Hierarchy (OBS-003):** Typed subclasses (`ValidationError`, `NotFoundError`, `UnauthorizedError`, `ConflictError`, `DatabaseError`).
- **AsyncHandler & Global Error Handler (OBS-002):** Routes wrapped in `asyncHandler` return uniform error schema with `traceId`. Every async route handler and every async middleware factory (`authorize`, `authorizePermission`, `validate`, `idempotency`) MUST go through `asyncHandler` (v7.0.66, TD-229); `express-async-errors` is only a safety net, never the mechanism. Enforced by unit test `unit_route_async_handler_td_229`.
- **Structured Logging (OBS-001, OBS-006):** Winston logger with daily rotation into `logs/application-%DATE%.log` and `logs/error-%DATE%.log`.
- **Recursive Sanitization (OBS-009):** Sensitive fields scrubbed with `[REDACTED]`.
- **Lifecycle Probes (OBS-007):** Kubernetes probes at `/health/live`, `/health/ready`, `/health/startup`.
- **Prometheus Metrics (OBS-008):** System metrics exposed at `/metrics` and `/api/metrics`.
- **Graceful Shutdown (OBS-004, OBS-005):** Handles `SIGTERM`/`SIGINT` with a 10s force-exit timeout.

## 21. Frontend Optimization & Component Architecture
- **Code Splitting (FE-001):** Lazy-load heavy views with `React.lazy` and `Suspense`. Vite vendor chunks isolated.
- **Modular Components (FE-003, FE-004):** Keep components <300 lines; extract subcomponents and hooks.
- **React Query Cache (FE-005):** Use `@tanstack/react-query` with `staleTime: 5 * 60 * 1000` and invalidate on mutations.
- **Auth Security (FE-006):** Centralized in `AuthContext.tsx`. NEVER store user objects or tokens in `localStorage`.
- **DatePicker Protection (FE-010):** Pass dates through `extractDateString()` before assigning to string state.
- **AbortController (FE-008):** Asynchronous fetch loops in `useEffect` must pass abort signal and abort on cleanup.
- **Type Safety (FE-007):** Replace loose `any` types with explicit TypeScript interfaces.
- **Production Console Drop (FE-002):** `esbuild: { drop: ['console', 'debugger'] }` in production Vite build.
- **ESLint Ratchet (v7.0.65, audit P3-4):** `npm run lint:eslint` (CI gate) runs ESLint (`eslint.config.js`: `no-floating-promises`, `no-misused-promises`, `no-explicit-any`, `react-hooks/rules-of-hooks`, `react-hooks/exhaustive-deps`, `max-lines` 400 / 300 for `.tsx`) and fails when any rule count exceeds `eslint-baseline.json`. New code must not add violations; when a change removes violations, run `npm run lint:eslint -- --update` and commit the lower baseline. Never raise the baseline.

## 22. Database Migrations, Production Seed Gating & Pool Timeouts
- **Atomic Migrations (DB-013):** `src/db/migrator.ts` runs the official Drizzle migrator over `drizzle/*.sql` (journal: `drizzle/meta/_journal.json`) in an atomic transaction; applied migrations are tracked in `drizzle.__drizzle_migrations`. Every new migration MUST be registered in the journal. `runMigrations()` never throws: every caller MUST check `result.success` and stop on failure (v7.0.50, TD-217 — `setupTestSchema`, `ensureTestDatabaseReady`/`assertTestDatabaseReady`, `runSeed`, `server.ts`).
- **Production Seed Gating (DB-014):** Seeding disabled in production unless `ALLOW_SEED_IN_PRODUCTION=true`, protected by advisory lock (`pg_try_advisory_lock(89345)`).
- **Session-Level Timeouts (DB-012):** `statement_timeout = 60000` ms and `idle_in_transaction_session_timeout = 60000` ms (defaults of `DB_STATEMENT_TIMEOUT` / `DB_IDLE_IN_TX_TIMEOUT`), sent in the pool's connection startup `options` (v7.0.39). Bulk tasks use `withLongQueryTimeout(fn)`.
- **Single-Instance Deployment (v7.0.44, product-owner decision):** The system runs as ONE server process (one workshop, at most 20 concurrent users). In-memory caches, rate limiters and process-level locks assume a single process; do not add multi-replica infrastructure (Redis, object storage, cross-instance cache invalidation). The Kubernetes manifest uses `replicas: 1` with `strategy: Recreate` and no autoscaler.

## 23. V7 Governance — Active Series, Strict Typing, Zod Coverage, N+1 Optimization & Stock Normalization
- **Active Series (v7.x.y):** The active changelog file is `src/data/changelogs/7.ts` (`v7.x.y`). Historical changelogs reside in `0.ts` (`v1.0.0`) and `archive_1_6.ts` (condensed `v1.x.y`–`v6.x.y`, finalized at `v6.0.28`). Every change MUST append one unique, short `AIUpdateLog` entry (§7) to `src/data/changelogs/7.ts` and bump `package.json` `"version"`.
- **Core Mission of Version 7:**
  1. **Strict TypeScript & Type Safety (فعال‌سازی Strict Mode):** `strict: true` is on (v7.0.79, audit P3-3 — catch variables are `unknown`: read them with `errorMessageOf(err)` / `getErrorMessage(err)` from `src/utils`, never `err.message`); untyped `: any` escape hatches are removed incrementally (ESLint ratchet).
  2. **100% Zod Validation Coverage (اعتبارسنجی کامل روت‌ها):** Complete Zod middleware protection on all remaining unvalidated endpoints (Procurement, Dashboard, Transactions) preventing NaN/malformed inputs.
  3. **N+1 Performance Elimination (حذف کوری‌های متوالی در لوپ‌ها):** Batch fetching of warehouse locations and item base prices in document finalization and audit loops.
  4. **Database Migrator Hardening (استحکام مایگریتور):** Formalization of all ad-hoc DDL into numbered Drizzle migrations and fail-fast startup behavior in production.
  5. **Data Model Normalization (نرمال‌سازی انبار):** Migration of per-warehouse inventory quantities from JSONB blob into a normalized `item_warehouse_stocks` table with database-level constraints.
- **CHANGELOG.md Archive:** Condensed markdown archive of major series milestones lives in root `CHANGELOG.md`.
- **Technical Debt Registry (TECH_DEBT.md):** ANY shortcut, workaround, or known issue must be registered with unique `TD-###` in `TECH_DEBT.md`. Resolving a debt requires updating its status in the same change-set.
- **Data-Safety Invariant:** Test cleanup gated on `NODE_ENV ∈ {test,development}` AND `ERP_ALLOW_TEST_CLEANUP=1`, scoped to synthetic test IDs only. `db:push` is BANNED; migrations come exclusively from the atomic migrator.
- **Business Clock Invariant:** Server-side dates must use `src/lib/businessClock.ts`.
- **Local Dev & MCP References:**
  - Windows local PostgreSQL & portable `.pgdata` lifecycle: see `docs/LOCAL_DEV_WINDOWS.md`.
  - DBHub read-only MCP configuration: see `docs/LOCAL_MCP_TOOLING.md`.
- **Release Version Bump = 4 Synced Locations (enforced by `npm run check:version`):**
  1. `"version"` in `package.json` (single source of truth; dynamically resolved by `src/lib/version.ts` and `/health`).
  2. Top entry in active changelog `src/data/changelogs/7.ts`.
  3. `deploy/k8s/erp-deployment.yaml` — both the image tag (`erp:vX.Y.Z`) and the `APP_VERSION` env value (it overrides `package.json` at runtime).
  4. Header line of `README.md` (`نسخه مستقر: \`vX.Y.Z\``).

## 24. GitHub Sync Policy
- **Commit & Push:** In local development or environments with configured Git credentials/SSH keys, commit with descriptive messages and push to `origin/master`.
- **Cloud & Sandbox Environments:** In environments without Git credentials, avoid executing failing push commands that interrupt workflow.
- **Exclusions:** Never commit `.env`, local database directories (`/pgdata`, `/logs`), or source archives.
- **Vendored SheetJS (v7.0.58, audit P2-13 / TD-173, product-owner decision):** `xlsx` (a devDependency since v7.0.84) is installed from `vendor/xlsx-0.20.3.tgz` (the official SheetJS build, published only on cdn.sheetjs.com — the npm `xlsx@0.18.5` is vulnerable). This tarball is the one allowed third-party archive in the repository. Upgrade only by replacing it with a newer official tarball and updating the `package.json` reference and lockfile; never switch back to the npm package.
- **Runtime vs Dev Dependencies (v7.0.84, TD-177):** `dependencies` holds exactly the packages the server bundle requires (the Docker image installs only these with `npm ci --omit=dev`); frontend-only libraries (React, icons, fonts, xlsx …) go in `devDependencies`. Enforced by `npm run check:runtime-deps` and Vitest `runtimeDependencies.test.ts`. The audit gate (`npm run audit:gate`) reads `npm audit` over all dependencies so browser libraries stay covered.
- **Conflict Handling:** Always use `git pull --rebase` if remote has progressed; never force-push.
