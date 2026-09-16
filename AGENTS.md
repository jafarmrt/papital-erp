# AI Agent Instructions (AGENTS.md)

> **Documentation Map (Version 4.0.0 Architecture & Governance):** این فایل مرجع یگانه قواعد معماری و حاکمیت پروژه است. قوانین بنیادین: `ARCHITECTURE_RULES.md` • نقشه راه فعال: `V4_MASTER_ROADMAP.md` • نقشه راه آرشیو v3: `V3_MASTER_ROADMAP.md` • دفتر بدهی: `TECH_DEBT.md` • چنج‌لاگ فعال: `src/data/changelogs/4.ts` • راه‌اندازی ویندوز: `docs/LOCAL_DEV_WINDOWS.md` • ابزار MCP: `docs/LOCAL_MCP_TOOLING.md`.

هر ایجنت هوش مصنوعی برای حفظ پایداری سیستم ملزم به رعایت دقیق این قواعد است:

## 1. Drizzle ORM & PostgreSQL Rules
1. **NO RAW SQL FOR MUTATIONS:** Never use `tx.execute(sql\`UPDATE ...\`)` or raw SQL with bindings for inserts/updates (prevents `operator is not unique: unknown * unknown` in node-postgres).
2. **Update Pattern (Read-Calculate-Update):** Always fetch row via `tx.select()`, compute mutations in TypeScript, and save via `tx.update().set()`.
3. **Row Locking:** For data updated within the same transaction, use `.for('update')` (NOT `.forUpdate()`).
4. **Explicit Text Casting for WHERE Queries:** For code columns (e.g. `project_code`), cast with `sql\`${table.projectCode} = ${String(code)}::text\``.
5. **Drizzle CamelCase Mapping & Dual Field Formatting:** Express API endpoints for production projects/stages must return both `camelCase` and `snake_case` keys via formatters (`formatProject`, `formatStage`).
6. **Atomic Sequence Numbering:** Sequential numbers (vouchers, treasury transactions, document references) MUST use PostgreSQL Sequences (`SELECT nextval('...')`) or atomic counter tables (`document_counters` UPSERT), NEVER `COUNT(*)` or `MAX() + 1`.
7. **Module Resolution (`/src/db/drizzle.js`):** Subdirectory services MUST import Drizzle instance explicitly from `../../db/drizzle.js` (or `.ts`) to ensure clean production bundling.

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
- **Dual Stock Storage:** Inventory is stored globally in `current_stock` and per-location in `jsonb` column `stocks`. Both MUST be kept in sync during every stock movement.
- **Weighted Average Cost (WAC):** Updated ONLY on stock 'in'. If current stock <= 0, new WAC equals the new unit price.
- **Centralized Stock Movements:** All stock operations, warehouse locations, and WAC calculations MUST route through `DocumentService.applyStockMovement` in `src/services/document.service.ts`.
- **Document Statuses:** Supported document statuses in API and services: `'draft'`, `'proforma'` (پیش‌فاکتور), and `'final'`.
- **Soft Delete & Reversal (DB-009):** Never HARD DELETE stock transactions. Set `is_deleted = 1`, issue an atomic reversal transaction with `reversal_of_id`, and recalibrate balances via `DocumentService.applyStockMovement`.
- **Negative Stock Policy (DB-006):** Reductions (`out`) must validate against `negativeStockPolicy` settings before committing.

## 4. WooCommerce Integration & Webhooks
- **Public Route Exemption:** Webhook endpoints (`/api/woocommerce/webhook/order`) must be exempted from `authenticateToken` in `src/middleware/auth.ts` for ping/payloads (GET, POST, HEAD).
- **Preview Domain Resolution:** Replace `ais-dev-` with `ais-pre-` in `window.location.origin` when displaying webhook delivery URLs in AI Studio preview environments.
- **SKU Matching & Orders:** Match line items to ERP items via `items.code` (SKU). Route orders through `DocumentService.createDocument` (`docType: 'invoice'`, `status: 'final'`, `inOut: 'out'`).

## 5. Security, Authentication & Audit Logging
- **HttpOnly Cookies:** JWT tokens are issued and stored exclusively via secure HttpOnly cookies (`auth_token`, `secure: true`, `sameSite: 'none'`, `path: '/'`). Browser JS MUST NOT store or read raw tokens in `localStorage`. All client fetch calls MUST specify `credentials: 'include'`.
- **Session Verification & Logout:** Use `/api/auth/me` to verify session on load, and `/api/auth/logout` to clear the cookie.
- **Route Middleware Order:** Administrative/utility/seed routes MUST be registered AFTER `router.use(authenticateToken)` and protected via `authorize('admin')`.
- **Audit Logging & Snapshots:** All state mutations (customers, items, prices, documents, stocks, permissions) MUST log via `logActivity` in `src/lib/auditLogger.ts` with before/after snapshots.
- **Log Sanitization:** Sensitive fields (`password`, `token`, `secret`, `jwt`, `cookie`) MUST be sanitized to `[PROTECTED]`.
- **Soft Deletes:** Always filter with `.where(eq(table.isDeleted, 0))` on reads.

## 6. Localization & UI Guidelines
- **Dates & Numbers:** Server dates must use `src/lib/businessClock.ts`. UI dates use `Intl.DateTimeFormat('fa-IR')`. Numbers formatted via `formatPersianPrice` or `formatPersianNumber`. Iranian identifiers (national ID, phones) preserve leading zeros via `formatPersianPhone` and `formatPersianNationalId`.
- **Dynamic Currencies:** Respect `currency` on records (IRR, USD, EUR, AED, GBP); do not hardcode "ریال".
- **Double Submissions:** Always use `isSaving` or `loading` to disable submit buttons.
- **Large Selects:** Use `SearchableSelect` (`src/components/SearchableSelect.tsx`) for large datasets.
- **Form State:** Use dedicated `editingId: number | null` and `isEditing = editingId !== null` instead of holding `id: 0`.

## 7. AI Agent Auto-Changelog Updates & Release Tracking
- **Mandatory Update Logging:** Whenever modifying code, adding features, optimizing, or fixing bugs, you MUST append a new release entry to `src/data/changelogs/4.ts` with Jalali date, version bump (v4.x.y), title, summary, changes, and fixes.
- **Completeness:** All functional, structural, and architectural changes must be recorded.

## 8. Server Startup & Background Seed Execution
- **Port 3000 Ingress:** In AI Studio preview / Cloud Run, `server.ts` MUST bind and listen on port 3000 immediately.
- **Background Seeding:** Seeding (`runSeed()`) must run asynchronously in background IIFE without blocking server startup.

## 9. Standard 22 Categories & Default Units
- **22 Categories:** 8 product categories (گردنبند، گوشواره میخی، گوشواره آویز، انگشتر، دستبند، گوشواره بزرگ، گردنبند بزرگ، دو تکه) and 14 raw_material categories.
- **Auto-Fill Default Units:** When category is selected in `ItemFormModal.tsx`, unit automatically updates to category's `defaultUnit` (جفت، ریسه، برگ، متر، عدد و...).

## 10. Transfers & Image Management
- **Dual-Route API:** Transfer routes in `src/routes/transfers.routes.ts` accept both `POST` and `PUT` across `/transfers` and `/transfers/:code`.
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
- **Transactional Voucher Generation (DB-008):** `VoucherSync` calls triggered from documents/treasury MUST execute inside the same database transaction (`tx`).

## 12. Kardex Event Sourcing & Inventory Reconciliation
- **Event-Driven Verification:** Calculate true stock balances from sequential `stock_movements` log.
- **Three-Way Sync:** Keep global `current_stock`, warehouse location JSONB `stocks`, and Kardex ledger fully aligned.

## 13. Scalable Changelog Architecture
- **Version Partitioning:** Changelogs are split by major version (`0.ts`, `1.ts`, `2.ts`, `3.ts` as archives; `4.ts` active) in `src/data/changelogs/`.
- **Active File:** For version 4.x releases, append to `src/data/changelogs/4.ts` and bump `package.json` `"version"`.

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
- **Dead Letter Queue (DLQ):** Failed events transfer to `dead_letter_queue` with replay/dismiss endpoints.
- **Automated Event Actions:** `EventActionEngineService` dynamically triggers webhooks, notifications, SMS, or workflows based on rules.
- **HMAC-SHA256 Signatures:** Webhooks sign payload with HMAC-SHA256 and attach `X-ERP-Signature-256` and `X-ERP-Delivery-Id`.

## 16. Frontend Communication & Polling Optimization
- **Standardized `fetchJson`:** Use `fetchJson` from `/src/api.ts` with `credentials: 'include'`.
- **Guarded Background Polling:** Intervals (`setInterval`) must check active sub-tab state and clean up on unmount.

## 17. System Testing & E2E Integration Audit
- **Modular Test Suites:** Suites isolated under `src/tests/suites/` (`unit`, `database`, `workflow`, `concurrency`, `integration`, `security`, `api`, `regression`).
- **Execution:** Run tests via CLI (`npm run test`) or administrative endpoint (`/api/system/tests/run`).

## 18. Financial Reporting & Trial Balance
- **4-Level Trial Balance (`FinancialReportsTab.tsx`):** Displays group, general, subsidiary, and detailed accounts.
- **Supported Formats:** 2-column, 4-column, 6-column, and 8-column balances.
- **General Journal Book (`journal-book`):** Double-entry vouchers sorted by date and number with verified debit/credit balance.
- **Drill-Down:** All balance rows support instant navigation to detailed ledger cards (`ledger`).

## 19. Concurrency, OCC & Database Stability Rules
- **PostgreSQL Atomic Sequences (DB-001, DB-003, DB-011):** Sequence IDs generated via `nextval('...')` or `document_counters` UPSERT.
- **Idempotency OCC Locks (DB-010):** `IdempotencyService` uses `.onConflictDoNothing()` and OCC (`status` and `locked_until` in UPDATE WHERE clause).
- **Stock Soft Delete & Reversal (DB-009):** `is_deleted = 1` + reversal transaction + balance recalculation.
- **Negative Stock Guard (DB-006):** Validates against `negativeStockPolicy` before inventory deductions.

## 20. Observability, Error Handling & Lifecycle Rules
- **AppError Hierarchy (OBS-003):** Typed subclasses (`ValidationError`, `NotFoundError`, `UnauthorizedError`, `ConflictError`, `DatabaseError`).
- **AsyncHandler & Global Error Handler (OBS-002):** Routes wrapped in `asyncHandler` return uniform error schema with `traceId`.
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

## 22. Database Migrations, Production Seed Gating & Pool Timeouts
- **Atomic Migrations (DB-013):** Migrations in `src/db/migrator.ts` execute in atomic transaction tracked in `migrations_log`.
- **Production Seed Gating (DB-014):** Seeding disabled in production unless `ALLOW_SEED_IN_PRODUCTION=true`, protected by advisory lock (`pg_try_advisory_lock(89345)`).
- **Session-Level Timeouts (DB-012):** `statement_timeout = 60000` ms and `idle_in_transaction_session_timeout = 30000` ms. Bulk tasks use `withLongQueryTimeout(fn)`.

## 23. V4 Governance — Active Series, Architecture Optimization & UI/UX Principles
- **Active Series (v4.x.y):** The active changelog file is `src/data/changelogs/4.ts` (`v4.x.y`). Historical changelogs reside in `0.ts` (`v1.0.0`), `1.ts` (`v1.x.y`), `2.ts` (`v2.x.y`), and `3.ts` (`v3.x.y` - finalized and archived). Every change MUST append one unique `AIUpdateLog` entry to `src/data/changelogs/4.ts` and bump `package.json` `"version"`.
- **Core Mission of Version 4:**
  1. **Architecture Optimization (بهبود معماری):** Refactoring, simplifying code paths, reducing cognitive complexity, and optimizing server/client state management without introducing breaking changes or unnecessary layers.
  2. **Decluttering & UI/UX Simplicity (سادگی و خلوت‌سازی):** Minor, targeted user interface improvements adhering to the decluttering principle (minimal button clusters, action menus), eliminating technical and Latin jargon, and ensuring natural, fluent Persian terminology.
- **CHANGELOG.md Archive:** Condensed markdown archive of major series milestones lives in root `CHANGELOG.md`.
- **Technical Debt Registry (TECH_DEBT.md):** ANY shortcut, workaround, or known issue must be registered with unique `TD-###` in `TECH_DEBT.md`. Resolving a debt requires updating its status in the same change-set.
- **Data-Safety Invariant:** Test cleanup gated on `NODE_ENV ∈ {test,development}` AND `ERP_ALLOW_TEST_CLEANUP=1`, scoped to synthetic test IDs only. `db:push` is BANNED; migrations come exclusively from the atomic migrator.
- **Business Clock Invariant:** Server-side dates must use `src/lib/businessClock.ts`.
- **Local Dev & MCP References:**
  - Windows local PostgreSQL & portable `.pgdata` lifecycle: see `docs/LOCAL_DEV_WINDOWS.md`.
  - DBHub read-only MCP configuration: see `docs/LOCAL_MCP_TOOLING.md`.
- **Release Version Bump = 2 Synced Locations:**
  1. `"version"` in `package.json` (single source of truth; dynamically resolved by `src/lib/version.ts` and `/health`).
  2. Top entry in active changelog `src/data/changelogs/4.ts`.

## 24. GitHub Sync Policy
- **Commit & Push:** In local development or environments with configured Git credentials/SSH keys, commit with descriptive messages and push to `origin/master`.
- **Cloud & Sandbox Environments:** In environments without Git credentials, avoid executing failing push commands that interrupt workflow.
- **Exclusions:** Never commit `.env`, local database directories (`/pgdata`, `/logs`), or source archives.
- **Conflict Handling:** Always use `git pull --rebase` if remote has progressed; never force-push.
