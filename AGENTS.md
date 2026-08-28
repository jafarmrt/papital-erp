# AI Agent Instructions (AGENTS.md)

> **Documentation Map (V10-7.1, updated at v1.1.0):** این فایل مرجع یگانه قواعد معماری و حاکمیت است. `GEMINI.md` فقط یک stub ارجاعی است؛ `DEVELOPER.md` و `DEVELOPER_GUIDE.md` حذف شده‌اند (تاریخچه در Git)؛ پوشه `docs/` نیز پس از انتشار v1.1.0 حذف شد (blueprintها در Git history). نقشه: قواعد و وضعیت نقشه راه: همین فایل (§۳۱) • دفتر بدهی: `TECH_DEBT.md` • آرشیو چنجلاگ و sign-off انتشار: `CHANGELOG.md` • راهنمای نصب/اجرا/عملیات (شامل Runbook): `README.md` • نصاب: `install.sh` / `update.sh`.

This project has specific architectural constraints and conventions discovered during development. Any AI Agent working on this codebase MUST strictly adhere to these guidelines to ensure system stability and consistency:

## 1. Drizzle ORM & PostgreSQL Rules
1. **NO RAW SQL FOR MUTATIONS:** Never use `tx.execute(sql\`UPDATE ...\`)` or raw SQL with bindings for inserts/updates, especially when dealing with math operations or `jsonb` columns. `node-postgres` parameter casting causes `operator is not unique: unknown * unknown` errors.
2. **Update Pattern (Read-Calculate-Update):** Always fetch the row using `tx.select()`, perform all mathematical or JSON object mutations in standard TypeScript, and save it using `tx.update().set()`.
3. **Row Locking:** When querying data that will be updated in the same transaction (e.g. checking stock limits), use `.for('update')`. DO NOT use `.forUpdate()` as it does not exist in the current Drizzle API version.
4. **Explicit Text Casting for WHERE Queries:** When querying string/code columns like `project_code`, always cast or format using `sql\`${table.projectCode} = ${String(code)}::text\`` to prevent PostgreSQL parameter type ambiguity errors.
5. **Drizzle CamelCase Mapping & Dual Field Formatting:** Express API endpoints for production projects and stages must return objects containing BOTH `camelCase` and `snake_case` keys (e.g., `project_code` and `projectCode`, `stage_order` and `stageOrder`) via helper formatters (`formatProject`, `formatStage`) to prevent frontend type mismatches and UI errors.
6. **Atomic Sequence Numbering:** Sequential numbers (vouchers, treasury transactions, document reference numbers) MUST use PostgreSQL Sequences (`SELECT nextval('...')`) or atomic counter tables (`document_counters` UPSERT), NEVER `COUNT(*)` or `MAX() + 1` queries to prevent race conditions under concurrent requests.

## 2. API Response Handling & Array Safety Guard
- **Paginated vs Plain API Responses:** Several API endpoints (like `/items`, `/documents`, `/crm/leads`) return paginated objects `{ data: [...], total, page, limit }` or plain arrays `[...]`.
- **Mandatory Safe Extraction:** Always extract items safely using:
  ```ts
  const rawData = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
  ```
- **Guard Before Method Calls:** Always wrap state array operations with a safety fallback before calling `.filter()`, `.map()`, or `.forEach()`:
  ```ts
  const safeItems = Array.isArray(items) ? items : [];
  const filtered = safeItems.filter(...);
  ```
  This prevents `TypeError: items.filter is not a function` errors when API state contains unexpected objects or errors.

## 3. Inventory & Stock Management
- **Dual Stock Storage:** Inventory is stored globally in `current_stock` and per-location in a `jsonb` column named `stocks`. Both MUST be kept in sync during every stock movement.
- **Weighted Average Cost (WAC):** Updated ONLY on stock 'in' events. If current stock is <= 0, new WAC is simply the new unit price.
- **Centralized Stock Movements:** Inventory checks, stock deductions/additions, warehouse location tracking, transaction log insertion, and WAC calculations MUST be routed through `DocumentService.applyStockMovement` in `src/services/document.service.ts`.
- **Document Statuses:** Document status values supported in API validation and services include `'draft'`, `'proforma'` (پیش‌فاکتور), and `'final'`. Zod validation schemas (e.g., in `src/routes/documents.routes.ts`) MUST include `'proforma'` alongside `'draft'` and `'final'`.
- **Soft Delete & Reversal Transactions (DB-009):** Never HARD DELETE stock transactions. Mark `is_deleted = 1`, issue an atomic Reversal Transaction referencing `reversal_of_id`, and recalibrate inventory levels using `DocumentService.applyStockMovement`.
- **Negative Stock Policy Integration (DB-006):** All inventory reduction operations (`out`) MUST validate against `negativeStockPolicy` settings before committing stock deductions.

## 4. WooCommerce Integration & Webhooks
- **Public Route Exemption:** Webhook endpoints (e.g. `/api/woocommerce/webhook/order`) MUST be exempted from `authenticateToken` middleware in `src/middleware/auth.ts` to allow unauthenticated webhook payloads and initial ping tests (supporting GET, POST, and HEAD methods).
- **Preview Domain Resolution:** When displaying webhook delivery URLs in AI Studio preview environments, automatically replace `ais-dev-` with `ais-pre-` in `window.location.origin` to ensure the URL is publicly reachable by WooCommerce servers without requiring browser session cookies.
- **SKU Matching & Order Processing:** Match order line items to ERP inventory items via `items.code` (SKU). Order processing must route through `DocumentService.createDocument` with `docType: 'invoice'`, `status: 'final'`, and `inOut: 'out'` to automatically trigger inventory deduction, customer auto-creation, and stock movement logs.

## 5. Security, Authentication & Audit Logging
- **HttpOnly Cookie Authentication:** JWT tokens are issued and stored exclusively via secure HttpOnly cookies (`auth_token` cookie) with `secure: true`, `sameSite: 'none'`, and `path: '/'`. JavaScript code in the browser MUST NOT store or read raw tokens in `localStorage` to prevent XSS credential theft. All client-side fetch calls MUST specify `credentials: 'include'`.
- **Session Verification & Logout:** Use `/api/auth/me` to verify active user sessions on initial app load, and `/api/auth/logout` to clear the HttpOnly cookie securely.
- **Route Middleware Order:** All Express API routes (including system diagnosis, environment checks, and database seeding routes like `/system/env`, `/system/schema-check`, `/system/run-seed`) MUST be registered AFTER `router.use(authenticateToken)` middleware and protected with role authorization (e.g. `authorize('admin')`). Never place administrative or utility routes before authentication middleware.
- **Audit Logging & Before/After Snapshots:** All critical state mutations (e.g., deleting/updating customers, items, prices, documents, stock levels, and user permissions) MUST log activity via `logActivity` in `src/lib/auditLogger.ts` with before and after snapshots (`details.changes`, `details.before`, `details.after`, or `details.addedPermissions`/`details.removedPermissions`).
- **Log Sanitization:** Sensitive fields (`password`, `token`, `secret`, `jwt`, `cookie`) MUST be automatically sanitized and replaced with `[PROTECTED]` in audit logs and system console loggers.
- **Soft Deletes:** Always filter with `.where(eq(table.isDeleted, 0))` on reads.

## 6. Localization & UI Guidelines
- **Dates & Numbers:** Store dates as standard timestamps or ISO/Jalali strings. Use `Intl.DateTimeFormat('fa-IR')` for grouping or displaying dates in the Persian calendar. Format numbers using `formatPersianPrice` or `formatPersianNumber` from `src/utils.ts`.
- **Dynamic Currencies:** The app supports multiple currencies (IRR, USD, EUR, AED, GBP). Always respect the `currency` field on items, prices, and documents. Do NOT hardcode "ریال" or "IRR" in the UI; display the dynamic currency of the record.
- **Double Submissions:** Always use an `isSaving` or `loading` state on form submissions to disable submit buttons and prevent duplicate API calls.
- **Dropdowns / Selects:** For large datasets (e.g., Customers, Items), use the custom `SearchableSelect` component (`src/components/SearchableSelect.tsx`) which handles filtering and bounds rendered items to avoid UI lag.
- **Form ID & Edit State Management:** Avoid holding `id: 0` in form state objects to represent "create mode". Instead, use a dedicated edit ID state like `editingId: number | null` along with explicit boolean helpers (`isEditing = editingId !== null`).
- **Page Modularization:** Keep pages lightweight by extracting state and API operations into custom hooks (e.g., `useSettings`, `useDailyLogs`) and splitting tab content into modular subcomponents (inside `src/components/...`).

## 7. AI Agent Auto-Changelog Updates & Release Tracking
- **Mandatory Update Logging (ثبت الزامی تمام تغییرات در صفحه به‌روزرسانی‌ها):** Whenever you (the AI Agent or Developer) modify code, add features, optimize performance, refactor modules, or fix bugs in this codebase, you MUST append a new release entry to the `SYSTEM_UPDATES` array inside `src/data/appInfoAndChangelog.ts` with the current Jalali date, version bump, title, summary, list of changes, and fixes. This powers the "درباره سامانه و به‌روزرسانی‌ها" page for administrators and users.
- **Completeness & Transparency:** All functional, structural, UI/UX, and architectural changes must be comprehensively recorded without omitting any task or fix.

## 8. Server Startup & Background Seed Execution
- **Immediate Port 3000 Ingress:** In the containerized AI Studio preview / Cloud Run environment, `server.ts` MUST bind and listen on port 3000 immediately. Never block server startup with synchronous or serial multi-retry database seed/migration calls.
- **Asynchronous Background Seeding:** Database seeding (such as `runSeed()`) and initial catalog synchronizations must be executed asynchronously in a background IIFE (`(async () => { ... })().catch(...)`) to ensure instant dev server readiness and health-check compliance.

## 9. Standard 22 Categories & Auto-Selected Measurement Units
- **22 Standard System Categories:** The ERP system is calibrated with 22 standard categories across `product` (necklaces, stud earrings, hanging earrings, rings, bracelets, large earrings, large necklaces, 2-piece items) and `raw_material` (transfers, beads, crystal beads, stones, hematite beads, wooden beads, metal findings in gold/bronze/steel, leather cords & chains, killer/paint/glaze, and others).
- **Default Measurement Units (`defaultUnit`):** Each category has a dedicated default unit (e.g., `جفت` for earrings, `ریسه` for beads and stones, `برگ` for transfers, `متر` for cords and chains, `عدد` for findings and pieces).
- **Auto-Fill in Forms:** Whenever a user selects a category in item creation/editing forms (`ItemFormModal.tsx`), the form's unit field MUST automatically update to that category's `defaultUnit` to prevent manual entry errors.

## 10. Transfers & Image Management
- **Dual-Route API Acceptance:** Transfer API handlers in `src/routes/transfers.routes.ts` must accept both `POST` and `PUT` requests across `/transfers` and `/transfers/:code`, resolving the transfer code from either URL parameters or request payload (`body.code`).
- **Modal Viewport & Responsive Layout:** Modals dealing with images, large forms, or nested item lists must strictly employ fixed headers/footers with internal scrollable bodies (`max-h-[85vh]` or `max-h-[90vh]`) to guarantee 100% usability inside the AI Studio iframe preview without clipping submit/cancel action buttons.

## 11. Modular Accounting Services & Facade Pattern
- **Subservice Bounded Contexts:** Accounting domain logic MUST NOT be consolidated into a single monolithic "god service". It is divided into 6 modular services in `src/services/accounting/`:
  1. `ChartOfAccountsService`: Coding hierarchy, standard account seeding, tree generation, and account CRUD.
  2. `VoucherService`: Journal vouchers, sequential numbering via PostgreSQL sequences (`voucher_number_seq`), balanced debit/credit validation, and voucher operations.
  3. `TreasuryService`: Bank accounts, cash funds, petty cash, Sayad cheques lifecycle & status transitions, and treasury transactions.
  4. `AccountingReportService`: Trial balance (4/6-col), detailed account card/ledger, balance sheet, and income statement.
  5. `VoucherSyncService`: Automated journal voucher generation for sales, purchases, warehouse movements, and payroll.
  6. `FiscalYearService`: Closing temporary/permanent accounts, calculating net profit/loss, and issuing opening/closing vouchers.
- **Unified Facade:** `AccountingService` in `src/services/accounting.service.ts` acts as a unified Facade binding all sub-services to guarantee 100% backwards compatibility for Express API routes.
- **AccountNature Consistency:** The standard nature type is `AccountNature = 'debit' | 'credit' | 'both'`. Never use non-standard literals like `'debtor'` or `'creditor'` in Drizzle queries or TypeScript mappings.
- **Transactional Voucher Generation (DB-008):** `VoucherSync` calls triggered from document creation/finalization or treasury transactions MUST execute within the same database transaction (`tx`) as the primary operation. If `VoucherSync` fails (e.g., missing subsidiary account mappings), the entire parent database transaction MUST roll back.

## 12. Kardex Event Sourcing & Inventory Reconciliation
- **Event-Driven Stock Verification:** When inventory anomalies occur or when audits are run, calculate the true stock balance directly from the sequential `stock_movements` log (Event Sourcing).
- **Three-Way Sync:** Keep global `current_stock`, warehouse location JSONB `stocks`, and Kardex ledger (`stock_movements`) fully aligned and auditable.

## 13. Scalable Changelog Architecture
- **Version Partitioning:** Changelogs are split by major version in `src/data/changelogs/` (`v1.ts` through `v7.ts`) and aggregated in `src/data/appInfoAndChangelog.ts`.
- **Mandatory Registration:** Every release must increment `"version"` in `package.json` and append a new `AIUpdateLog` entry to the active version file (e.g. `src/data/changelogs/v7.ts` for version 7.x releases). Never append 7.x releases to `v6.ts`.

## 14. Workflow Engine, Visual Canvas & SLA Analytics Architecture
1. **JSON Rule Engine & Pre-conditions (`ruleConditionsJson`):** Evaluate context variables (e.g. invoice total amount, branch, priority) using operator rules (`eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `contains`) before rendering available transition buttons or executing transitions.
2. **Parallel Approvals & Multi-sign (`approvalProgressJson`):** Support `SINGLE`, `AND_ALL`, `OR_ANY`, and `K_OF_N` rules. Store user signatures and signature counts incrementally in `approvalProgressJson`. Transition state only when threshold/unanimity criteria are fulfilled.
3. **Immutable DSL Versioning (`snapshotDsl`):** Store an immutable JSON snapshot of the workflow definition in `snapshotDsl` and `definitionVersion` upon instance creation (`startInstance`). Ensures active document instances are never corrupted or disrupted when administrators edit or upgrade workflow definitions.
4. **Visual Canvas Position Persistence:** Persist node coordinates (`positionX`, `positionY`) and state properties (`slaHours`) in `workflow_states`. SVG connector lines automatically render directional arrows and transition labels between nodes.
5. **SLA Bottleneck Analytics:** SLA compliance rate, active/overdue instances, and bottleneck states are derived by analyzing sequential `workflow_history_logs` (`now() - updatedAt` vs `slaHours`).

## 15. Enterprise Domain Event Bus & Pub/Sub Architecture
- **Strongly Typed Event Catalog:** Domain events for invoices, warehouse movements, treasury operations, and workflows must follow standard schema contracts with correlation IDs, timestamps, and user context.
- **Centralized Event Dispatch:** `DomainEventBus` in `src/services/events/domainEventBus.ts` serves as the singleton bus with ring-buffered telemetry.
- **Non-Blocking Handlers:** Handlers registered to the event bus must never throw unhandled exceptions or block core transactions.

## 16. Transactional Outbox Pattern & Background Workers
- **Atomic Dual-Write:** When mutating business state inside a database transaction (`tx`), record outbox entries atomically via `OutboxService.recordEvent(tx, event)`.
- **Exponential Backoff Worker:** The background outbox worker polls pending events, executes handler dispatches, and applies exponential retry backoff (5s, 10s, 20s... max 5 attempts).
- **At-Least-Once Delivery:** Decouples core database commits from downstream notification/webhook failures.

## 17. Dead Letter Queue (DLQ), Quarantine & Error Recovery
- **Automatic Quarantine:** Events exceeding max retries in the Outbox worker automatically transfer to `dead_letter_queue` with error details, stack traces, and metadata.
- **Replay & Dismissal Lifecycle:** Support single and batch re-queueing (`replay`), permanent dismissal (`dismiss`), and safe payload adjustments prior to replay.

## 18. Automated Event Actions & Rules Engine
- **Dynamic Rule Evaluation:** The `EventActionEngineService` parses operator rules (`eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `contains`, `exists`) against event payloads.
- **Decoupled Action Execution:** Supports Webhooks, In-App Notifications, SMS Simulations, Workflow Triggers, and Audit Logging with string template interpolation (`{{payload.field}}`).
- **Error Isolation:** Action execution errors are logged in `event_action_logs` and never fail the parent event or database transactions.

## 19. Webhook Subscriptions & HMAC-SHA256 Signatures
- **Pattern Matching & Headers:** Webhook subscriptions support topic wildcard patterns (e.g., `document.*`, `*`), custom headers, retry counts, and timeout limits.
- **HMAC-SHA256 Cryptographic Signatures:** Every outgoing webhook payload MUST include `X-ERP-Signature-256` and `X-ERP-Delivery-Id` headers for authenticity and replay protection.
- **Full Delivery Auditing:** HTTP status codes, latency in ms, request/response bodies, and timestamps are recorded in `webhook_deliveries`.

## 20. Event Sourcing Timeline Replay & Simulation
- **Chronological Aggregation:** Build unified timelines for aggregates (`document`, `item`, `customer`, `voucher`, `workflow_instance`) aggregating Outbox, DLQ, audit logs, and workflow histories.
- **Dry-Run Mode:** Support dry-run simulations allowing operators to test replay behavior and downstream effects before committing state changes.

## 21. Frontend API Communication & Polling Optimization
- **Standardized `fetchJson` Utility:** Always use `fetchJson` from `/src/api.ts` for all frontend API calls to guarantee uniform HttpOnly cookie credentials (`credentials: 'include'`), JSON parsing, and error interception.
- **Guarded Background Polling:** Background polling intervals (`setInterval`) in tabbed views MUST check active sub-tab state and clean up intervals on unmount to prevent unnecessary network traffic and race conditions.

## 22. Phase 17 Event Architecture Lessons Learned & Best Practices
- **Explicit ORM Module Resolution (`/src/db/drizzle.js`):** Service files inside subdirectories (like `/src/services/events/`) MUST import the Drizzle instance explicitly from `../../db/drizzle.js` rather than non-existent `index.js` or standard index imports to avoid esbuild compilation errors during production bundling.
- **BaseDomainEvent Interface Strictness:** Every published domain event MUST fulfill all required `BaseDomainEvent` fields: `eventId` (string), `eventType`, `aggregateType`, `aggregateId` (string), `payload`, `metadata` (containing string `timestamp`), and `occurredAt` (ISO string). Mismatched numeric IDs must be cast using `String(id)`.
- **Atomic Outbox Writes & Background Exponential Backoff:** Writes to `outbox_events` MUST occur within the primary database transaction (`tx`). The background worker processes items with exponential backoff (`5s * 2^(retry)`) and transfers failed items to `dead_letter_events` upon reaching max retries (5).
- **HMAC SHA-256 Webhook Security:** All outgoing webhook dispatches MUST compute an HMAC SHA-256 signature over the JSON payload using `crypto.createHmac('sha256', secret)` and attach it in the `X-ERP-Signature-256` header alongside a unique `X-ERP-Delivery-Id`.

## 23. Phase 21 System Testing & E2E Integration Audit Lessons Learned
- **Modular Test Suite Architecture (`/src/tests/suites/`):** Maintain test suites isolated by architectural layer (`unitSuite`, `databaseSuite`, `workflowSuite`, `concurrencySuite`, `integrationSuite`, `securitySuite`, `apiSuite`, `regressionSuite`) under `src/tests/suites/`.
- **Critical 15-Scenario Audit Coverage:** Every automated test runner execution MUST evaluate all 15 critical core scenarios including: Unauthorized Workflow Access & Approval, Concurrency Row Locking, Atomic Stock Deductions, Deduplicated Webhook Ingestion (`X-ERP-Delivery-Id`), Workflow Delegations & Rejections, Parallel Approval Contracts (`AND_ALL`, `OR_ANY`, `K_OF_N`), Rule Engine Condition Failures, Immutable Workflow Versioning Snapshots, Accounting Reversals, Event Sourcing Kardex Rebuilds, WooCommerce Idempotency, and System Regression Sanity.
- **Dual CLI & API Test Execution:** Tests must be runnable both via command line (`npm run test` executing `scripts/run-tests.ts`) and through protected administrative API endpoints (`/api/system/tests/run`) for continuous integration and real-time dashboard UI audits.

## 24. Standard 4-Level Financial Reporting, Journal Book & Ratio Analytics
- **Standard 4-Level Trial Balance (`FinancialReportsTab.tsx`):** The Trial Balance MUST load all 4 coding hierarchy levels (`group`, `general`, `subsidiary`, `detailed`) directly in a tree or filtered view without requiring initial user search or single-account selection.
- **Multi-Column Trial Formats:** Support 2-column (Closing Balances), 4-column (Turnover & Balances), 6-column (Period Turnover, Total Turnover, Closing Balances), and 8-column (Initial Balances, Period Turnover, Total Turnover, Closing Balances) accounting standards.
- **Legal General Journal Book (`journal-book`):** Endpoints and UI must render double-entry journal vouchers sequentially sorted by voucher date and voucher number, displaying running balance, accounts, detailed mappings, and verified debit/credit equilibrium.
- **Drill-Down Capabilities:** All trial balance rows must support instant drill-down navigation to detailed ledger cards (`ledger`) for comprehensive ledger auditing.

## 26. Version 8 Master Execution Blueprint Compliance & Subphase Approval Rules
- **Blueprint Verification (`/docs/V8_MASTER_BLUEPRINT.md`):** Before beginning any phase or subphase of Version 8.6.0 (Stability & Production-Stable Roadmap aiming for v8.7.0), the AI Agent MUST inspect `/docs/V8_MASTER_BLUEPRINT.md` to verify the execution plan, DAG dependencies, and phase goals. The agent MUST strictly adhere to the 10-phase roadmap without adding unsolicited features.
- **Subphase Execution & Mandatory Stop:** At the end of every subphase (e.g. Subphase 0.1, Subphase 1.1, etc.), the AI Agent MUST:
  1. Complete the subphase tasks self-containedly.
  2. Run `lint_applet` and `compile_applet` to verify zero build or lint errors.
  3. **STOP execution immediately** and provide a detailed report of completed changes and debt/status to the user.
  4. Wait for explicit user confirmation before proceeding to the next subphase.

## 27. Phase 2 Database Stability, Concurrency & OCC Rules
- **PostgreSQL Atomic Sequences (DB-001, DB-003, DB-011):** Never calculate sequential IDs using `SELECT COUNT(*)` or `MAX(val) + 1`. Always use PostgreSQL Sequences (`voucher_number_seq`, `treasury_tx_number_seq`) or dedicated counter tables with atomic UPSERT/increments (`document_counters`).
- **Idempotency OCC Locks & Atomic Inserts (DB-010):** `IdempotencyService` uses `.onConflictDoNothing()` for atomic lock insertions and Optimistic Concurrency Control (OCC) (`status` and `locked_until` in UPDATE WHERE clause) when re-acquiring expired locks to eliminate race conditions under concurrent hits.
- **Stock Soft Delete & Reversal (DB-009):** Deleting stock movements must NEVER perform a hard SQL delete on `transactions`. It sets `is_deleted = 1`, creates a corresponding reversal transaction with `reversal_of_id`, and recalibrates inventory balances via `DocumentService.applyStockMovement`.
- **Negative Stock Guard (DB-006):** Inventory deduction logic MUST respect the `negativeStockPolicy` system setting before committing changes.

## 28. Phase 5 Observability, Error Handling & Lifecycle Rules
- **AppError Hierarchy & Domain Codes (OBS-003):** Always use typed `AppError` subclasses (`ValidationError`, `NotFoundError`, `UnauthorizedError`, `ConflictError`, `DatabaseError`) for business validations with explicit HTTP status codes and domain error identifiers.
- **AsyncHandler & Global Error Handler (OBS-002):** Express routes MUST be wrapped in `asyncHandler` to forward exceptions to `errorHandler`, responding with uniform error schemas containing a unique `traceId`. Never use ad-hoc `res.status(500).json({ error: err.message })` inside route handlers.
- **Structured Logging & Daily Rotation (OBS-001, OBS-006):** Use the centralized Winston `logger` for all backend logging. Raw `console.log` is strictly prohibited in backend code. In production, logs rotate daily into `logs/application-%DATE%.log` and `logs/error-%DATE%.log`.
- **Recursive Metadata Sanitization (OBS-009):** The Winston sanitize formatter recursively scrubs sensitive fields (`password`, `secret`, `token`, `auth`, `creditcard`, `cvv`) with `[REDACTED]` and masking JWT tokens with `[JWT_REDACTED]`.
- **Morgan Stripped URLs & Metrics Exemption (OBS-010):** HTTP request logging strips query strings via `stripped-url` token to prevent credential leaks, and automatically bypasses health and metric endpoints.
- **Kubernetes Lifecycle Probes (OBS-007):** Container orchestrator probes (`/health/live`, `/health/ready`, `/health/startup`) provide real-time status of process liveness and PostgreSQL connection pool saturation.
- **Prometheus Metrics Exporter (OBS-008):** System metrics are exposed in Prometheus format at `/metrics` and `/api/metrics` via `prom-client`.
- **Graceful Shutdown & Force-Exit Timeout (OBS-004, OBS-005):** Process shutdown handles `SIGTERM` and `SIGINT` via `gracefulShutdown` (closing HTTP server, stopping Outbox Worker, terminating DB Pool) backed by a 10-second force-exit timeout.
- **IPv6 Rate Limiting Guard:** When using `express-rate-limit` with custom `keyGenerator`, always invoke `ipKeyGenerator(req)` for non-authenticated clients and set `keyGeneratorIpFallback: false` to avoid IPv6 bypass warnings.

## 29. Phase 6 Frontend Optimization & Component Architecture
- **Route & Tab Code Splitting (FE-001):** Heavy views, analytics dashboards, visual canvas workflows, and complex accounting reports must be lazy-loaded using `React.lazy` and `Suspense` with lightweight skeleton loaders. Use Vite `manualChunks` to isolate vendor libraries (`vendor-react`, `vendor-query`, `vendor-excel`, `vendor-icons`).
- **Modular Component Decomposition (FE-003, FE-004):** Deconstruct large monolithic components (>300 lines) like `App.tsx` and `AccountingPage` into modular subcomponents, custom hooks, and layout components (`AppLayout`, `Sidebar`, `TopBar`, `AppRoutes`).
- **React Query Cache & Mutation Management (FE-005):** Core data fetching must use `@tanstack/react-query` with structured query keys, `staleTime: 5 * 60 * 1000` (5 minutes), `gcTime: 30 * 60 * 1000`, and automatic cache invalidation on mutations (`queryClient.invalidateQueries`).
- **AuthContext & HttpOnly Cookie Security (FE-006):** User authentication state is managed centrally via `AuthContext.tsx` and `useAuth()`. NEVER store user objects or tokens in `localStorage` (`localStorage.setItem("user", ...)` is strictly prohibited). Auth verification relies on `/api/auth/me` with HttpOnly cookies.
- **DatePicker Primitive Coercion Protection (FE-010):** DatePicker components (from `react-multi-date-picker`) pass `DateObject` or `Date` instances in `onChange`. Always pass dates through `extractDateString()` before assigning to string state variables or sending API payloads to avoid `Uncaught TypeError: Cannot convert object to primitive value` errors.
- **AbortController Request Cancellation (FE-008):** Asynchronous `useEffect` data fetching loops MUST instantiate an `AbortController` and pass `signal` to `fetchJson` or Axios, calling `controller.abort()` in the cleanup function to prevent memory leaks and state updates on unmounted components.
- **Explicit Type Safety & Elimination of Any (FE-007):** Replace loose `any` types with explicit TypeScript interfaces, DTOs, or generic constraints to ensure compile-time error detection (`tsc --noEmit`).
- **Production Console Drop (FE-002):** Production builds configured via `vite.config.ts` (`esbuild: { drop: ['console', 'debugger'] }`) automatically strip all debug logs and breakpoints from client output chunks.
- **Array Safety & Defensive Access:** Strict compliance with Rule #2 (`Array.isArray(data) ? data : []`) on all UI collection mappings to eliminate runtime crashes from paginated or error payloads.

## 30. Phase 7 Database Migrations, Production Seed Gating & Pool Timeouts
- **Atomic Migrations & Logging (DB-013):** All database DDL schema migrations in `src/db/migrator.ts` MUST execute inside a single atomic PostgreSQL transaction (`BEGIN / COMMIT / ROLLBACK`). Applied steps MUST be tracked in the `migrations_log` table. If any migration step fails, the transaction MUST roll back completely.
- **Production Seed Gating & Multi-Instance Lock (DB-014):** Automatic seeding during server startup MUST be disabled in production (`process.env.NODE_ENV === 'production'`) unless explicitly permitted via `ALLOW_SEED_IN_PRODUCTION=true`. To prevent race conditions in multi-instance deployments, seed execution MUST acquire a PostgreSQL Advisory Lock (`pg_try_advisory_lock(89345)`).
- **Session-Level Timeouts & Long Query Helper (DB-012):** All database pool connections MUST enforce session-level timeouts (`statement_timeout = 60000` ms and `idle_in_transaction_session_timeout = 30000` ms). Long-running or bulk tasks (such as Excel catalog imports in `ItemsService`) MUST be wrapped in `withLongQueryTimeout(fn)` to dynamically override the timeout (default 300,000 ms / 5 minutes) without exposing standard queries to unbounded execution.

## 31. V10 Governance — Changelog Discipline & Technical Debt Registry (الزامی)
- **Version Reset (v1.x Series):** Following the V10 reset, the client changelog source of truth is `src/data/changelogs/0.ts` (immutable `v1.0.0` baseline entry) plus the ACTIVE series file `src/data/changelogs/1.ts` (`v1.x.y`). Every functional/UI/security/migration change MUST append one unique, non-duplicate `AIUpdateLog` entry to `1.ts` and bump `package.json` `version` accordingly. Never recreate per-era files `v2..v9`.
- **CHANGELOG.md Root Archive:** A condensed English archive of pre-reset history lives in root `CHANGELOG.md`. Historical detail lives ONLY in Git — do not re-bundle it.
- **Technical Debt Registry (TECH_DEBT.md):** ANY shortcut, workaround, known bug, endpoint mismatch, stale copy, or deferred improvement discovered during development MUST be registered as a row (unique `TD-###`) in the project-root `TECH_DEBT.md` table with: area, description, exact file/line reference, status (`open` / `scheduled:<phase>` / `in_progress` / `resolved`), and planned phase. Resolving a debt requires flipping its status in the same change-set. This registry is reviewed before starting any new phase.
- **Data-Safety Invariant (from V10-0.1):** Test fixture cleanup MUST stay gated on `NODE_ENV ∈ {test,development}` AND `ERP_ALLOW_TEST_CLEANUP=1`, and MUST remain scoped to synthetic test identifiers only. NEVER reintroduce full-table deletes or business-word ILIKE patterns into `cleanupAllTestFixtures`. `db:push` is BANNED from deploy/update/setup scripts — migrations come exclusively from the built-in atomic migrator.
- **Business Clock Invariant (from V10-1.1/1.2):** Server-side dates for documents/transactions/vouchers MUST come from `src/lib/businessClock.ts` helpers (never raw `new Date().toISOString()`); stored formats are normalized Gregorian ISO; Jalali is display-only via the agreed `display_timezone` setting. Fiscal partitioning always uses the Jalali year key.
- **V10 Execution State (MUST READ at session start):** **RELEASED v1.1.1** — تمام فازهای 0..7 کامل و sign-off شده‌اند (sign-off: `CHANGELOG.md`؛ سابقه blueprint در Git history — پوشه docs پس از انتشار حذف شد). پس از انتشار، زیرفاز پایداری V1.1.1 نیز کامل و به‌صورت زنده راستی‌آزمایی شد: endpointهای تست (`/system/tests/run`، `/system/clean-test-data`) همیشه ثبت ولی در زمان درخواست گارد می‌خورند (production=ممنوع همیشگی؛ در غیر این صورت فلگ `runtime_enable_test_endpoints` از تب «پیکربندی سیستمی» تنظیمات، فقط-admin) — پیش‌فرض خاموش (seed) و مسیر امن اجرای تست‌ها فقط `npm run test` است (TD-036 داده تستی باقی‌مانده + TD-037 SystemTestRunner بی‌اتصال، open). Released series: `v1.x.y` (package.json + /health string must always match `src/data/changelogs/1.ts` top entry — فعلاً v1.1.1). Roadmap آینده: عطف به درخواست کاربر «داشبورد سراسری جدید» (Backlog G-1) و رفع اقلام open باقی‌مانده در `TECH_DEBT.md`.
- **Local DB Lifecycle Invariant (from V1.1.1 session):** PostgreSQL محلی یک Windows Service نیست — نمونه پورتیبل `.pgdata` روی پورت 5433 با `stop-local.ps1` متوقف و با ری‌استارت ویندوز از بین می‌رود؛ علامت مشکل: `ECONNREFUSED` در `[Migrator]` هنگام `npm run dev`. قبل از هر کاری با DB، پورت 5433 را چک کن (`Test-NetConnection localhost -Port 5433`) و اگر خاموش است از کاربر بخواه در ترمینال خودش `.\start-local.ps1` اجرا کند — **پروسه‌های DB که از سشن AI بالا می‌آیند بعد از پایان دستور توسط sandbox کشته می‌شوند** (0xC0000142 در server.log) و قابل اتکا نیستند. راه‌حل دائمی پیشنهادی به کاربر: ثبت به‌عنوان سرویس (`pg_ctl register -N PapitalPostgreSQL -D <path> -o "-p 5433"` + `Set-Service -StartupType Automatic`، نیاز به PowerShell Admin از سمت کاربر).
- **Release Version Bump = ۳ محل (from v1.1.1 incident):** همیشه هر سه با هم: (۱) `package.json`، (۲) رشته `version` در `src/app.ts` هندلر `/health`، (۳) مدخل بالای `src/data/changelogs/1.ts` — در ریلیز قطع‌شده v1.1.1 محل دوم فراموش شد و `/health` نسخه قدیمی گزارش می‌داد.

## 32. GitHub Sync Policy (از درخواست کاربر — الزامی)
- **Auto Commit & Push بعد از هر تغییر:** در پایان هر سشن که در آن کد/دokumentation تغییر کرده است، ایجنت MUST تغییرات را `git add` + `git commit` (پیام مختصر و توصیفی) و سپس `git push` به `origin/master` (`https://github.com/jafarmrt/papital-erp.git`) کند — بدون نیاز به تأیید مجدد کاربر (این section همان تأیید دائمی کاربر است).
- **Pull در شروع سشن:** در ابتدای هر سشن، قبل از هر تغییری، ایجنت MUST یک بار `git pull --rebase` اجرا کند تا تغییرات کامیت‌شده از محیط‌های دیگر روی گیت‌هاب، قبل از شروع کار وارد کد محلی شود. اگر pull تداخل (conflict) داشت، قبل از هر کاری تداخل را با کاربر مطرح و رفع کند.
- **Exclusions:** هرگز `.env`، داده‌های محلی (`/pgdata`، `/logs`) و فایل‌های زیپ خروجی (`papital-erp-source-*.zip`) را کامیت نکنید (`.gitignore` را رعایت کنید).
- **Conflict Handling:** اگر push به‌دلیل تغییرات ریموت رد شد، ابتدا `git pull --rebase` و پس از رفع تداخل، دوباره push؛ هرگز force-push نکنید.
