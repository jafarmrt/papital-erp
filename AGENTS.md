# AI Agent Instructions (AGENTS.md)

This is the short core of the project's rules: every agent and developer follows it in every change. Each rule is one or two lines and names its **guard**: the test or ratchet that fails when the rule is broken (`—` = no automatic guard; keep it by review). The full text of each area lives in `docs/rules/<area>.md`; read the area file before you change code in that area. The rules as they stood at the end of series 10, with their history (versions, debt rows, decisions), are kept unchanged in `docs/rules/archive/AGENTS_V10.md` (and the old `ARCHITECTURE_RULES.md` in `docs/rules/archive/ARCHITECTURE_RULES_V10.md`) at commit `c3c985845ef8a925bbb04946e74951305324d477`: v11.1.0 removed the archives (`docs/rules/archive`, `docs/roadmap/archive`, `docs/audit`, the CHANGELOG.md sections of series 1 to 10), and every path to them in code comments and documents is read at that commit. A code comment that cites «AGENTS.md §N» points to that file's numbering. A new rule joins this core only when it is a rule every change must keep; how a feature works belongs in its area file.

**Map:** area rules `docs/rules/` • active roadmap `docs/roadmap/` (closed series at commit `c3c9858`) • debt registry `TECH_DEBT.md` (closed rows and fixed-debt lessons in `docs/rules/DEBT_LESSONS.md`; ids closed up to series 10 in `docs/rules/CLOSED_DEBT_IDS_V10.md`) • active changelog: the file `ACTIVE_CHANGELOG` names in `src/data/changelogs/index.ts` • route → permission table `docs/security/ROUTE_PERMISSIONS.md` (generated, `npm run routes:permissions`) • Windows setup `docs/LOCAL_DEV_WINDOWS.md` • MCP tools `docs/LOCAL_MCP_TOOLING.md`.

## 1. How we work

1. **The product owner decides policy.** A recommended option is not a decision until the owner confirms it. Every version or sub-version starts from a written start plan (`V<ver>_START_PLAN.md`) reviewed with the owner before building. Small and medium findings stay in the current series; large ones go to the next version's list with a recommendation. Guard: —.
2. **Every finding is proven first.** A fix comes with a test that fails on the code before it (or a ratchet that only accepts decreases). A `TD-###` row in `TECH_DEBT.md` is only for debt that remains (a shortcut, a known issue, work left for later); a fix finished in the same pull request needs no row, its test is the record, and resolving a registered debt updates its row in the same change. A claim without such a test (a refactor, a documentation change) is never worded as a fix. Guard: `releaseTool.test.ts`, `unit_governance_docs_consistency_p3_12`.
3. **One branch per topic, a draft pull request, never a push to `master`.** Small fixes of the same kind go together in one pull request. Never force-push. Before a merge: run `npm run release:renumber -- origin/master` (it merges `master` into the branch and resolves the release files), fix duplicate changelog entries, run the fast checks (§10), push, and wait for every CI job. A pull request merges only when every check is green, it has no conflict and `master` has not moved; an agent merges its own pull request only under the owner's standing permission and after the coordinator's go. One re-run for a flaky job; a Docker pull failure (ECR 429) counts as red. A flaky test is fixed in the test. Guard: —.
4. **Every code pull request gets a fresh reviewer.** A change to money, stock, security or migrations gets the full review: a full brief, probes on a real PostgreSQL for money and stock, and delta reviews until it is clean. Other changes (screens, wording, tools, documents) get a light review of the diff. Every review checks the change against the lessons of `docs/rules/DEBT_LESSONS.md`. Leftover nits go to the next pull request or the backlog. Guard: —.
5. **The repository is public.** Never commit `.env`, secrets, server details, customer data, local database directories (`/pgdata`, `/logs`) or source archives, and never write them in a pull request or comment. Guard: —.
6. **A new library needs the owner's approval**; an upgrade that needs a manual step on the server is told to the owner before the merge. `dependencies` holds only what the server bundle needs, browser libraries go in `devDependencies`, and SheetJS comes only from the official tarball in `vendor/`. Guard: `npm run check:runtime-deps`, `runtimeDependencies.test.ts`.
7. **Never change** `scripts/monitor.sh`, `scripts/backup.sh` or the alert scripts without the owner's approval. Guard: —.
8. **Terminal output is English** (scripts, logs, test names, commit messages, pull request titles); UI text, user-facing API messages, the changelog, `TECH_DEBT.md` and documents are Persian. Guard: `npm run ratchet:terminal-english`.

## 2. Data, concurrency and migrations (`docs/rules/data.md`)

1. **Routes stay thin:** a route reads its input with a Zod schema (`validate`), takes the user from the session and calls a service; it never writes a table. Guard: ratchet `routeWrites`, `src/tests/security/writerRouteValidation.ts`.
2. **No whole raw SQL write statement** (`UPDATE … SET`, `INSERT INTO`): read with `tx.select()`, compute in TypeScript, write with `tx.update().set()` / `tx.insert()` / soft delete, and lock rows with `.for('update')`. A `sql` fragment inside a Drizzle write for an atomic calculation (`version + 1`, `now()`) is allowed. Guard: ratchet `rawSqlWrites` (0), `hardDeletes`.
3. **Business numbers are atomic:** PostgreSQL sequences or the counter tables under a row lock, never `MAX() + 1` or `COUNT(*)`. Guard: `numberingInvariant`.
4. **Inside a transaction use only that `tx`**: never `orm` / `pool`, also for `logActivity`, fiscal checks and workflow starts. Guard: ratchets `ormFallback`, `auditWithoutTx`.
5. **Work that touches several domains runs in one transaction**, with `tx` passed down, so a failure rolls everything back. Guard: ratchets `ormFallback`, `auditWithoutTx`, `businessInvariantSuite`.
6. **Every stock path locks all its items at once, in ascending id order, with `FOR NO KEY UPDATE`**, before the counter, the document row or any Kardex or line insert. Guard: `concurrencySuite`.
7. **Every edit sends the record's `version`**; a stale one is 409 `OCC_CONFLICT`, never a silent overwrite. Guard: `customerContactChannels.test.tsx`, `projectEditTests`.
8. **Idempotency keys** store only 2xx answers and refuse a key reused for another request (422); a key carries no name or amount. Guard: `idempotencyKeysTd1328.test.ts`.
9. **No business row is deleted physically:** soft delete (`is_deleted = 1`) and, for stock and money, an atomic reversal with `reversal_of_id`; every read filters `is_deleted = 0`. The allowed physical deletes are listed in `scripts/ratchets/HARD_DELETES.md`. Guard: ratchet `hardDeletes`.
10. **Text dates are stored as Gregorian ISO `YYYY-MM-DD`** and shown in Jalali; server timestamps are UTC. Flags and text dates carry their CHECK constraints from their first migration. Guard: `reg_flag_check_constraints_p3_14`, `reg_date_format_check_constraints_p3_15`. (Rewritten in phase 3, timestamptz.)
11. **Migrations:** only through the atomic migrator (`db:push` is banned), every migration in the journal with a `when` greater than all before it, a released migration is never edited (except the documented amendments), the migration number and `when` are fixed at merge time, and every caller checks `runMigrations().success`. A data fix never clamps or overwrites silently: it records what it changed. Guard: `migrationPlan.test.ts`, `drizzleKitGuard.test.ts`.
12. **The database mode is decided once** and PostgreSQL is the only database (the in-memory demo was removed in v11); without one the server does not start. Guard: `databaseModeTests`, `databaseModeTd616.test.ts`.
13. **Test data cleanup** runs only with `NODE_ENV` test or development and `ERP_ALLOW_TEST_CLEANUP=1`, and only on synthetic test rows. Guard: `deploySafetyChecks` (`src/tests/recovery/deploySafetyChecks.ts`).
14. **Each package owns its tables** and changes another package's data only through that package's service or a shared transaction; server imports go only towards a lower layer of `scripts/ratchets/PACKAGE_MAP.txt`, and a cycle goes through an event or the composition root. The count must not grow (the target is no growth, not zero). Guard: ratchet `packageBoundary`.

## 3. Money and accounting (`accounting.md`, `treasury.md`, `payroll.md`, `reports.md`)

1. **Money is decimal on the server:** money columns use `moneyNumeric`, values are `Money` (`src/lib/money.ts`); never `Number()` or JS `+` on money, report totals are summed in SQL or with `FinancialDecimal`. Guard: `regressionSuite`, `unitSuite`.
2. **Insurance (3204), payroll tax (3206) and VAT are supported but never required**, per person and per document. **Eidi is tax-free.** Guard: `payrollStatutoryTests`, `payrollEidiTests`.
3. **Automatic vouchers are written in the same transaction as their source** and stay `draft` until an accountant approves them; a document's voucher is found only by its source column (`source_document_id`, `source_payroll_id`, `source_cheque_id` …), never by reference text. Guard: `regressionSuite`, `voucherPageActions.test.tsx`.
4. **Voucher accounts come from the account mapping**; an unreadable mapping refuses the voucher (422), never falls back silently. Guard: `payrollDeductionAccountTests`.
5. **Whether a fiscal year is closed lives only in `fiscal_periods`**; every voucher write checks it under the year lock, a year with a draft voucher is not closed, a year closes only after it ends and only the last closed year reopens. Guard: `fiscalClosingTests`, `fiscalYearOrderTests`.
6. **A reversal voucher never returns to draft.** A source is voided through the voucher service. Guard: `regressionSuite` (`VOUCHER_REVERSAL_LOCKED`).
7. **One treasury path:** every receipt, payment, transfer and their void go through `postTreasuryRow` / `reverseTreasuryRow` (balance never negative, number from the sequence, voucher and outbox event in the same `tx`). Payroll payments use it too, and a payslip is `paid` only through a payment. Guard: `treasuryOnePathObsR252.test.ts`, `treasuryOnePathObsR252Tests`.
8. **Foreign currency:** a non-rial document or voucher row needs a positive exchange rate (never rate 1); rial cost rows in a foreign voucher carry their own row rate; reports convert a foreign row only at its own rate and never add a raw foreign amount to rials. Guard: `foreignCostScenarios`, `currencyReportScenarios`, `manualVoucherRowCurrency.test.tsx`.
9. **A party's card and statement find rows by detailed type and id**, never by a name that «contains» the text. Guard: `partyTemporaryRowsTd915.test.tsx`.
10. **An account used by any voucher row is never deleted**, and manual rows post only to posting accounts. Guard: `chartOfAccountsTests`.
11. **Messenger messages never carry amounts**; payslip and treasury event payloads carry no name or amount. Guard: `treasuryEventPrivacyTests`.

## 4. Inventory (`inventory.md`, `items-pricing.md`, `production-projects.md`, `procurement.md`, `documents.md`)

1. **Per-warehouse stock lives only in `item_warehouse_stocks`**; `items.current_stock` is kept by the database and never written by code. Three-way invariant: that table = `items.current_stock` = the Kardex ledger balance. Guard: `kardexRebuildInvariant`.
2. **Every stock movement goes through `DocumentService.applyStockMovement`** (transfers through the transfer service, quantity only). Guard: `integrationSuite`.
3. **Negative stock is always forbidden** (`InsufficientStockError`, and the CHECK constraint as the last guard). Guard: `businessLogicAuditSuite`.
4. **Weighted average cost changes only on stock in**, in IRR; an item without a cost never enters stock at zero cost (unless the line is ticked as donated), and an outflow is never recorded without cost (stock count adjustments excepted). The sale price is never a cost. Guard: `documentIntegritySuite`, `workflowAutoActionScenarios`.
5. **A sales return enters at the cost of the original invoice's outflow** (else the current cost), capped at what that invoice sold. Guard: `salesDocumentTests`.
6. **A document's stock direction comes only from its type**, and every final outflow passes one sellable gate: min(warehouse stock, total stock − other reservations). Guard: `documentLineStockTests`.
7. **Only a sales proforma and a finalized project reserve stock**; the reservation is written only by the server, and every reader fails closed (never shows zero on a read error). Guard: `reservationReconcileTd1341.test.tsx`.
8. **A stock movement is never dated after the business today**, nor before the item's last movement without `warehouse.backdate`; a void that would break later history is refused. Guard: `stockMovementFutureDateTests`.
9. **Stock repairs are manual, dry-run first, quantities only, and log every change**; nothing at boot repairs stock or issues vouchers in bulk. Guard: `regressionSuite`.
10. **The default warehouse is the active warehouse with the lowest id**; every «first warehouse» query orders by id. Guard: `reg_default_warehouse_deterministic_p2_3`.

## 5. Security and access (`docs/rules/security.md`)

1. **Tokens live only in the HttpOnly cookie**: no token in a response body or in `localStorage`; browser fetches use `credentials: 'include'`. Guard: `securitySuite`.
2. **Access is by permission only, never by a role code:** one check, `can(user, ...keys)`, the route guard `requirePermission` (keys from the shared catalog `src/lib/permissions/permissionCatalog.ts`), and the system admin is the only role code code may name. Screens show a button by the permission of the route it calls. Roles are editable by the owner. Guard: `npm run ratchet:permissions`, `permissionCatalog.test.ts`.
3. **Every route is classified:** public routes and login-only routes are listed in `src/tests/security/routeAccessPolicy.ts`, admin and utility routes are registered after `authenticateToken`, no write passes with a `*.view` key alone, and every read of business data has its read permission. Regenerate `docs/security/ROUTE_PERMISSIONS.md` after a route change. Guard: `sec_route_access_policy_td_298`.
4. **Every state change writes an audit row** with `logActivity`, before and after, in the change's own `tx`. Guard: ratchet `auditWithoutTx`.
5. **Secrets:** third-party passwords are encrypted at rest (`encryptSecret`, key `ERP_SECRETS_KEY`), webhook keys and secret headers are masked in every answer, and logs and audit details sanitize secrets (`[REDACTED]` in logs, `[PROTECTED]` in audit) and keep only the last four digits of card, account and Sheba numbers. Guard: `integrationSecretsAtRestTests`, `auditSanitizer.test.ts`.
6. **Personal bank details are unmasked only** for the system admin, the person themself and holders of the sensitive keys. Guard: `securitySuite`.
7. **Outgoing requests pass the SSRF guard** (`assertSafeExternalUrl`), follow no redirect except by hand within the same site, and shop keys go only in the `Authorization` header. Guard: `wcRedirectObsR282.test.ts`, `webhookConnectTimeLookupTd1296.test.ts`.

## 6. User interface and wording (`docs/rules/ui.md`)

1. **Screens speak plain Persian:** Jalali dates (`formatPersianDate`, `JalaliDateInput`), Persian digits (`formatPersianNumber`, codes with `formatPersianCode`, «٪»), the words of the UI glossary in `docs/rules/ui.md`, and no English word. The only allowed transliterations are «کاردکس», «ترنسفر» and «وب‌هوک»; the dashboard is «پیشخوان»; the computer is «سرور». Guard: `npm run ratchet:ui-wording`, `npm run ratchet:latin-digits`, the wording tests.
2. **Number fields:** money, rate and quantity fields go through `decimalInput` on the server and `DecimalInput` / `FinancialAmountInput` in the browser; Persian and Arabic digits are read, a misplaced «٬» is an error (also on the server), and an invalid entry never becomes 0. Guard: `persianDigitInputs.test.ts`, `persianNumberFieldsTd1288.test.tsx`, `moneyUrgentFixesV11.test.ts`.
3. **Rial amounts are shown through `useRialDisplay`** (rial or toman by the setting); a record in another currency keeps its own; never hard-code «ریال». Guard: `rialDisplayUnitTd667.test.tsx`.
4. **Dialogs:** Esc closes only the topmost window and never while it is saving; focus stays inside the open window; no screen calls `alert` or `confirm`; a save started from more than one path (button, Ctrl+S, submit) is guarded by a ref. Guard: `dialogRolesTd1277.test.tsx`, `voucherShortcutLatest10_3.test.tsx`.
5. **Long lists are filtered, counted and paged on the server**, never in the browser. **Every answer the browser reads has one contract shared with the server** (in `src/lib`). Guard: `voucherListServerPaging.test.tsx`, `financialStatementsView.test.tsx`.
6. **Data fetching:** `fetchJson` with React Query, invalidation presets after a change, an `AbortController` and cleanup in effects, guarded polling; an effect that reads other state uses `useEffectEvent`. Guard: `crmOneDataLayerTd1329.test.tsx`.
7. **Arrays are guarded** before `.map()` / `.filter()` (`Array.isArray(x) ? x : []`). Guard: —.
8. **Screens stay uncluttered:** no crowded row of buttons; secondary actions go in the three-dot menu. Guard: —.
9. **A switch sends its target state** (`{ enabled }` / `{ active }`); a repeat changes nothing and writes one audit row. Guard: rule and shop toggle tests.

## 7. Workflow and events (`workflow.md`, `events.md`)

1. **No file outside `src/services/workflow/` writes the workflow tables**; a step moves only through `executeTransition`, and a transition's action runs inside the approval transaction. Guard: `workflowTableWrites.test.ts`.
2. **A record type has at most one active definition**, and a running instance follows its own snapshot. The initiator of a purchase requisition never approves it. Guard: `workflowDefinitionSwitchTests`.
3. **Events are written to the outbox in the change's `tx`**; handlers rethrow their errors and a handler that succeeded never runs again. Guard: `opsSweepTests`, `eventRequestLink.test.ts`.
4. **No fake success:** a failed webhook is `failed`, test tools and simulations have no effect, no demo handler is registered. Guard: `ruleTestSimulationTests`.
5. **Webhooks are signed** (HMAC-SHA256, `X-ERP-Signature-256`); the event types a subscription may name are the published ones. Guard: `eventTypeCatalog.test.ts`, `webhookSecretEditTests`.
6. **The event and workflow engines are kept, not expanded** (v11 product-owner decision): the outbox and the messenger alerts stay as they are, and a new rule-engine, webhook, dead-letter, simulator or workflow-designer feature is built only for a need the owner names. Guard: —.

## 8. Online shop (`docs/rules/woocommerce.md`)

1. Only a `processing` or `completed` order issues a final invoice; an order with any unmatched SKU is refused whole; the webhook always answers 200. Guard: `wooDeletedOrderChecks`.
2. A change to an invoiced order only sets «نیاز به بازبینی» and never edits the invoice. Guard: `businessInvariantSuite`.
3. The shop gets the sellable stock of its own warehouse, through the item's product link only. Guard: `wooScenarios`.

## 9. Server and operations (`docs/rules/platform.md`)

1. **One server process** (one workshop, at most 20 concurrent users): no multi-replica infrastructure. The supported install is `install.sh` and updates go through `update.sh`; `deploy/k8s` is an unsupported example. Guard: —.
2. **Startup:** the server listens on port 3000 at once and answers 503 `SYSTEM_STARTING` until migrations finish; base data is inserted only where missing, saved rules and passwords are never rewritten, and no bulk accounting or inventory work runs at boot. Guard: `systemStartingWait.test.tsx`, `startupMonitoringChecks`, `bootSequence.test.ts`, `accessPackageTwoInstallTests`.
3. **Errors:** routes go through `asyncHandler`, services throw `AppError` subclasses, production hides only 5xx details. Guard: `unit_route_async_handler_td_229`, ratchets `serviceGenericErrors`, `routeErrorResponses`.
4. **Health:** a probe or health card that cannot read reports «نامعلوم», never zeros and «ok». Guard: `eventQueueActions.test.tsx`.
5. **Attachments live on disk** outside `public` serving and outside the image and source package, registered in `file_attachments`; never Base64 in the database. Guard: `attachmentUploadTests`.
6. **Server dates come from `src/lib/businessClock.ts`**. Guard: `dateBoundaryScenarios`.

## 10. Versions, releases and guards (`release.md`, `testing.md`)

1. **A version per server update, not per change.** Every code change adds one line at the top of «### Unreleased» in `CHANGELOG.md` (`npm run release -- <spec.json>` without `version`) and takes no version. Before each server update a release cut gives everything unreleased one version (the next patch) with one short entry in the active changelog; the end of a roadmap phase takes the next minor (x.y+1.0); a new major is a new series the owner decides. Closed series are frozen. Then `npm run check:version`. Guard: `npm run check:version`, `releaseTool.test.ts`, `releaseGovernance.test.ts`.
2. **Fast checks before every push:** `npm run lint`, ESLint ratchet, every ratchet below, `npm run check:version`, the tests the change touches, `npm run build`. CI runs the full suite; a full local run happens only when asked. Known environment-only failures are listed in `docs/rules/testing.md`. Guard: `ciGatesI06.test.ts`.
3. **Business invariants and the known-findings baseline only shrink.** Guard: `business_invariants` suite.
4. **Ratchets only go down; the coverage floor only goes up.** Never raise a baseline. Guard: each ratchet below, `ciGatesI06.test.ts`.

| Guard | Command | Baseline at v11 start |
|---|---|---|
| Architecture (route writes, pool fallback, audit without tx, hard deletes, package boundary, generic service errors, raw SQL writes …) | `npm run ratchet:architecture` | 8 / 130 / 54 / 23 / 132 / 17 / 0 |
| ESLint (long files, `any`, hooks, promises) | `npm run lint:eslint` | max-lines 119, any 923 |
| Permissions (role codes, catalog keys) | `npm run ratchet:permissions` | role codes 3 |
| UI wording | `npm run ratchet:ui-wording` | 121 |
| Latin digits on screen | `npm run ratchet:latin-digits` | 0 |
| Terminal English | `npm run ratchet:terminal-english` | 0 |
| Runtime dependencies | `npm run check:runtime-deps` | — |
