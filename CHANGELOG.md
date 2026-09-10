# Changelog — Papital Workshop ERP

All notable development history is preserved in **Git history** (`git log`). This file
provides a concise, human-readable archive of the pre-1.0 era and the release policy
going forward.

## Release policy (V10 onward)

| Channel | File | Version series |
|---|---|---|
| Client-bundled update center | `src/data/changelogs/0.ts` | baseline `v1.0.0` entry |
| Client-bundled update center | `src/data/changelogs/1.ts` | `1.x.y` release series |
| Client-bundled update center | `src/data/changelogs/2.ts` | `2.x.y` release series |
| Client-bundled update center (active) | `src/data/changelogs/3.ts` | current `3.x.y` release series |
| Root archive (this file) | `CHANGELOG.md` | summary of the pre-reset history & milestones |

---

## Version 3.x Series

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

