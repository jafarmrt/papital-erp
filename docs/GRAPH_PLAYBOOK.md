# Graph-Driven Debugging & Stabilization Playbook

> **Tool:** `codebase-memory` MCP server · **Project key:** `D-erp-project`
> **Purpose:** Practical, repeatable scenarios that use the code knowledge graph (4,7k nodes / 21k edges) to find bugs, enforce architecture invariants, and stabilize the Papital ERP.
> **Governance:** Findings discovered via this playbook MUST be registered as `TD-###` rows in root `TECH_DEBT.md` (see AGENTS.md §31).

---

## Tool Cheat Sheet

| Tool | When to use |
|---|---|
| `search_graph` | Locate a symbol (function/method) by name pattern |
| `get_code_snippet` | Read the exact source of a symbol found in the graph |
| `trace_path` (calls, inbound/outbound) | Who calls this? What does it call? (blast radius) |
| `trace_path` (data_flow) | How does a value propagate through calls? |
| `query_graph` (Cypher) | Bulk structural queries: complexity, loops, recursion, dead code |
| `detect_changes` | Map a git diff/commit to its transitive impact set |
| `search_code` | Literal text grep, enriched with graph metadata (dedup + rank) |
| `get_architecture` (aspects: cycles) | Circular CALLS dependencies (opt-in, heavy) |

**Coverage caveat:** if a file appears in `index_status → parse_partial`, prefer raw grep inside the flagged line ranges; the graph may miss constructs there.

---

## Scenario 1 — Hotfix Blast Radius (before touching a critical service) ✅ EXECUTED (v3.1.43)

**Goal:** Never edit `DocumentService.applyStockMovement`, `VoucherSync`, or `financialDecimal` without knowing every caller that will be affected.

**Bug class:** regression in inventory/accounting core paths.

**Steps**
1. Resolve the exact symbol:
   `search_graph(name_pattern="applyStockMovement")`
2. List all transitive callers (tests excluded by default):
   `trace_path(function_name="applyStockMovement", direction="inbound", depth=3)`
3. Read the symbol to confirm behavior:
   `get_code_snippet(qualified_name="...")`
4. Make the change.
5. Re-run step 2 and diff the caller set — **new callers = unintended coupling introduced**.

**Baseline (v3.1.46, ground-truthed):** `applyStockMovement` has **4 call sites, all sanctioned** — `createDocument` final-lines (document.service.ts:559), `finalizeDocument` (document.service.ts:1255), admin transaction reversal (transactions.routes.ts:204), and the project stock-entry route (projects.routes.ts:874, added v3.1.45). The graph's LSP resolver misses 2 of these hops — **ground-truth hot-spot caller sets with `rg` before trusting the graph** (see Appendix).

**Success criteria:** post-change caller set == pre-change caller set (or every new caller is intentional and reviewed).

**Execution record (v3.1.43):**
1. Symbol resolved: `DocumentService.applyStockMovement` (document.service.ts:997-1156, cx=13, 14 callees).
2. Caller baseline re-verified: still exactly **2** (`finalizeDocument` lsp 0.95, `__file__` heuristic 0.90).
3. Source audit: all 9 invariants hold inside the choke point (`.for('update')`, negative-stock policy, dual-store sync, WAC-on-in only via `FinancialMath.calculateWAC`, `fin()` decimals, OCC version bump, transactional outbox event, ledger insert with `isDeleted=0`, caller-supplied business date).
4. **Bypass sweep** (direct `items.currentStock/stocks/weightedAverageCost` writes + `insert(transactions)` outside the choke point) found:

| Site | Verdict | Ref |
|---|---|---|
| `projectBomAllocation` release: raw `new Date().toISOString()` date + no OCC bump (allocate & release) | **VIOLATION → fixed (TD-073)** | projectBomAllocation.service.ts:337,541,548 |
| `projects.routes.ts` project stock entry: full parallel stock-write implementation + float `roundFinancial(qtyToAdd * unitPrice)` | **VIOLATION → fixed (TD-074, v3.1.45)** — routed through `applyStockMovement` (now accepts optional `documentId` + `notes`); caller baseline is 3 (intentional) | projects.routes.ts:895-925 |
| `deleteDocument` revert: careful but duplicated reversal stock logic (for('update') ✓, fin ✓, nextVersion ✓) | **centralized (TD-076, v3.1.45)** — extracted as `DocumentService.applyStockReversal` | document.service.ts:1280-1336 |
| `projectBomAllocation` raw `throw new Error` (OBS-003) | **fixed (TD-077, v3.1.45)** — all 9 sites typed with `NotFoundError`/`InsufficientStockError`/`ConflictError` (+1 site in projects.routes → `ValidationError`) | projectBomAllocation.service.ts:311,321,515 |
| `items.crud.routes.ts` initial stock on item creation; `itemCatalog.processUnifiedImport` initial stock seeding | sanctioned opening-balance/import exceptions (documented) | items.crud.routes.ts:265-292, itemCatalog.service.ts:515-650 |
| `inventoryStockRepair.service.ts` correction pairs | sanctioned repair path (documented) | inventoryStockRepair.service.ts:75-110 |
| `applyStockMovement`, `deleteDocument` reversal rows (`reversalOfId`) | sanctioned (DB-009) | document.service.ts:1091,1260 |

5. Rule of thumb from this run: **any new endpoint that touches stock must call `applyStockMovement`** — parallel implementations rot silently. (All scenario-1 violations now shipped: TD-073 v3.1.43, TD-075 v3.1.44, TD-074/076/077 v3.1.45.)

---

## Scenario 2 — Architecture Convention Violation Hunt

**Goal:** Prove that every stock movement routes through `DocumentService.applyStockMovement` (AGENTS.md Rule §1.3) and no raw SQL mutations bypass ORM (Rule §1.1).

**Bug class:** architectural regression; inconsistent inventory state.

**Steps**
1. Enumerate all callers of the choke point:
   ```cypher
   MATCH (caller)-[:CALLS]->(f:Function)
   WHERE f.name = 'applyStockMovement'
   RETURN caller.qualified_name, caller.file_path
   ```
2. Hunt raw-SQL mutation bypasses (text layer, graph-enriched):
   `search_code(pattern="tx\\.execute\\(sql`", path_filter="^src/services")`
3. Cross-check: every file found in step 2 must appear in step 1's caller set (or be the service itself).
4. Any violation → fix by rerouting through the service, then register in `TECH_DEBT.md` if deferred.

**Success criteria:** `applyStockMovement` callers ⊆ {DocumentService methods}; zero `tx.execute(sql\`UPDATE|INSERT|DELETE\`)` in services outside the sanctioned paths.

---

## Scenario 3 — Three-Way Stock Mismatch Root Cause ✅ EXECUTED (v3.1.44, TD-075 fix)

**Goal:** When `current_stock` ≠ JSONB `stocks` (location) ≠ `stock_movements` ledger (Kardex), reconstruct exactly which write path diverged.

**Bug class:** inventory mismatch (AGENTS.md §3, §12).

**Steps**
1. Trace how a document creation propagates into stock writes:
   `trace_path(function_name="createDocument", mode="data_flow", direction="outbound", depth=4)`
2. Identify every function in the path that writes stock (`applyStockMovement`, level updates).
3. Verify each write touches **both** global `current_stock` and the per-location JSONB, and appends a `stock_movements` row — via `get_code_snippet` on each node.
4. For audit anomalies, rebuild truth from the ledger (Event Sourcing) via `inventoryIntegrity` / `kardexWacRecalculator` services, then compare against `current_stock`.
5. The first node in the path that writes only one of the three stores = the divergence point.

**Success criteria:** divergence point identified with file:line; repair routed through `applyStockMovement` (never ad-hoc UPDATE).

**Execution record (v3.1.44 — TD-075 root-cause + fix):**
1. Poisoning mechanism proven via data-flow trace: `rebuildItemFromLedger` computes `runningWac = (bal×wac + qty×unitPrice)/(bal+qty)` per 'in' row → synthetic backfill rows with `unitPrice` defaulted to 0 drag WAC toward 0 (halved when mixed with real rows, zeroed when alone).
2. Race mechanism proven: candidate query ran outside any lock; two concurrent dashboard GETs double-inserted → inflated stock on rebuild. The sync also ran on **every** request (before cache check) and mutated state inside a GET (BUG-14 class).
3. Fix shipped:
   - New `KardexBackfillService` (`src/services/inventory/kardexBackfill.service.ts`): inserts inside a single transaction with per-item `.for('update')` + **re-check under lock** (exactly-once), carries `unitPrice`/`totalPrice` from the item's WAC (zero-WAC items warn loudly), uses `businessTodayIsoDate()`, plus a **repair pass** that heals previously-poisoned synthetic rows (`documentRef = 'موجودی اولیه (تطبیق سیستم)'`, unitPrice=0 → item WAC, totalPrice recomputed).
   - GET `/dashboard-bi-stats` is now pure-read; the backfill runs once in the server's background bootstrap IIFE (server.ts, non-blocking, per AGENTS §8).
4. Verified on the real DB: 11/11 checks — concurrent double-run yields exactly 1 row; unitPrice/totalPrice = WAC-derived; planted poisoned row repaired; ledger-replay math post-repair gives stock 10 / WAC 12345 unchanged.
5. Note: `ItemOpeningService.issueItemOpeningVoucher` already retro-patches audit-row unitPrices when opening vouchers are issued — the dashboard path was the one bypassing that healing; now both paths are born-correct.

---

## Scenario 4 — Unguarded Recursion in Tree Rendering ✅ FIXED (v3.1.42)

**Goal:** Detect recursion without a termination guard that can crash the UI, and check the tree producer for cycle protection.

**Bug class:** stack overflow / silent data loss in Chart of Accounts.

**Query that flagged it**
```cypher
MATCH (f:Function) WHERE f.unguarded_recursion = true
RETURN f.qualified_name, f.file_path
```

**Live execution (v3.1.40, findings real):**

1. **Flagged:** `renderTreeNode` — `src/components/accounting/ChartOfAccountsTab.tsx:188-276`
2. **Source inspection:** recursion at line 271:
   ```tsx
   {(node.children || []).map(child => renderTreeNode(child, depth + 1))}
   ```
   `depth` is used **only for styling** (`paddingRight: Math.max(12, depth * 24)`); there is **no `MAX_DEPTH` check and no visited-set**. Termination relies solely on `hasChildren`.
3. **Producer audit:** `ChartOfAccountsService.getAccountsTree` (`src/services/accounting/chartOfAccounts.service.ts:171-190`) attaches each node to `map.get(acc.parentId).children` when the parent exists in the map, else to `roots` — with **no cycle detection and no diagnostic**.
4. **Impact analysis (two distinct findings):**
   - **TD-071 (active, data integrity):** a `parentId` cycle (e.g., A→B, B→A, or A→A) makes both nodes unreachable from `roots` — the accounts **silently vanish from the tree UI** with no error logged. Plausible: migration `drizzle/0005_fk_and_cycle_resolution.sql` proves FK cycles existed before.
   - **TD-072 (latent, crash):** any cyclic subtree that ever reaches `roots` (producer refactor, alternative endpoint, manual fixture) triggers **infinite recursion → stack overflow** and the whole tab dies (ErrorBoundary fallback at best).
5. **Callers:** `renderTreeNode` has 1 caller (the tab's roots `.map`) — fix is safe, no blast radius.

**Fix contract**
- Frontend: add a depth guard (`if (depth > MAX_TREE_DEPTH) return null;` with a dev-mode `console.warn`) and/or a `visited: Set<number>` passed down.
- Backend: in `getAccountsTree`, detect nodes never attached (post-pass: compare `map.size` vs reachable count) and fail loudly (`throw ValidationError`) or quarantine them in the response under `orphans[]`.
- DB level: consider a schema-level check constraint / trigger preventing `parentId = id` and same-level cycles (deferred — register only).

**Success criteria:** recursion guard in place; `getAccountsTree` reports orphan count; reintroducing a test-cycle fixture no longer crashes the tab and no longer hides accounts silently.

**Resolution (v3.1.42):** Both fixes shipped per the contract above —
- Backend: pure `ChartOfAccountsService.buildAccountTree` performs a reachability pass; cyclic orphans (including downstream nodes of a cycle) are quarantined as **visible roots** + `logger.warn` with `orphanCount`/`orphanCodes`; self-referencing `parentId` promotes directly to root without entering its own children. Response contract (`Account[]`) unchanged.
- Frontend: `renderTreeNode` guards with `MAX_TREE_DEPTH = 50` + per-path `visited` set (dev `console.warn` stripped in production builds by `vite.config.ts`).
- Verified: 9/9 simulation checks green (valid tree, self-cycle, mutual cycle with downstream child) + `tsc --noEmit` clean. TD-071/TD-072 flipped to `resolved`.

---

## Scenario 5 — Nested-Loop / Hidden O(n²) UI & Batch Ops

**Goal:** Find polynomial-degree loops in pages and seeds before users file "it's slow" tickets.

**Bug class:** UI lag, seed timeouts, transaction pool exhaustion (DB-012).

**Query**
```cypher
MATCH (f:Function)
WHERE f.transitive_loop_depth >= 3 OR f.linear_scan_in_loop >= 2
RETURN f.qualified_name, f.transitive_loop_depth AS loopDepth,
       f.linear_scan_in_loop AS scanInLoop
ORDER BY f.transitive_loop_depth DESC LIMIT 15
```

**Baseline (v3.1.x):**
| Function | loopDepth | scanInLoop | Note |
|---|---|---|---|
| `ProjectScheduleTab` | 4 | 0 | Gantt/schedule render — candidate for memoized lookups |
| `ProjectsPage` | 4 | 0 | Page-level render |
| `CustomersPage` | 3 | 0 | Page-level render |
| `runSeed` | 2 | 3 | 3 linear scans inside loops — seed scaling risk |
| `server.startServer` | 4 | 0 | Startup path — keep an eye on boot time |

**Steps:** for each hit → `get_code_snippet` → hoist `find/indexOf/contains` scans out of the loop into a `Map` → re-query to confirm reduction.

**Success criteria:** loopDepth of UI render paths ≤ 2 or scans hoisted; `runSeed` linear scans replaced with keyed maps.

---

## Scenario 6 — Splitting a God Component With a Safety Net

**Goal:** Refactor the highest-complexity component without behavioral regression.

**Bug class:** refactor regression.

**Baseline:** `usePiecework` (cx=60, cognitive=100) is the #1 complexity hotspot; next: `DomainEventsTab` (39/64), `BankAndTreasuryTab` (35/46).

**Steps**
1. Map the full dependency surface:
   `trace_path(function_name="usePiecework", direction="both", depth=3)`
2. Split only along the seams the graph reveals (per-tab hooks, pure helpers).
3. After each extraction, re-run `search_graph(name_pattern="<extracted>")` + verify old symbol gone (dead code check → Scenario 8).
4. Before merge: `detect_changes(since="HEAD~1", scope="impact")` — the impacted set must match your expectation.
5. Run the relevant suites: `npm run test` (piecework behavior lives in `businessLogicAuditSuite` / `regressionSuite`).

**Success criteria:** cognitive score of new hooks < 30 each; impacted-set diff only contains renamed symbols; suites green.

---

## Scenario 7 — Race Condition / Double Stock Deduction

**Goal:** Verify concurrency-critical paths use row locks + idempotency, and find call chains that can interleave.

**Bug class:** double deduction under concurrent requests (DB-010, DB-001).

**Steps**
1. List every caller chain into stock deduction:
   `trace_path(function_name="applyStockMovement", direction="inbound", depth=3, include_evidence=true)`
2. For each entry route (WooCommerce webhook → `createDocument`, API → `finalizeDocument`), confirm:
   - `IdempotencyService` middleware precedes the handler (route layer),
   - stock-limit checks use `.for('update')` (grep in the same snippet),
   - negative-stock policy is evaluated inside the same `tx`.
3. Confidence check: hops resolved with `strategy=lsp, confidence≥0.9` are trustworthy; `heuristic` hops must be confirmed by reading the source.
4. Document any uncovered route (no idempotency lock) as a `TD-###`.

**Success criteria:** every route into stock deduction has an idempotency key and `.for('update')` guard; evidence column shows no `unresolved` hops on the critical path.

---

## Scenario 8 — Dead Code & Orphaned Handlers

**Goal:** Find functions with zero inbound calls (safe deletions) and orphaned API handlers the frontend never invokes.

**Bug class:** technical debt drift; misleading API surface.

**Queries**
```cypher
// Dead functions (exclude entry points & tests)
MATCH (f:Function)
WHERE f.in_degree = 0
  AND NOT f.file_path CONTAINS 'tests'
  AND NOT f.file_path CONTAINS 'scripts'
RETURN f.qualified_name, f.file_path LIMIT 50
```
```cypher
// Routes defined but never referenced by HTTP_CALLS
MATCH (r:Route) WHERE NOT ()-[:HTTP_CALLS]->(r)
RETURN r.method, r.path
```

**Steps:** for each hit → confirm with `search_code` (string-based dynamic dispatch can fake "dead") → delete or register as TD.

**Success criteria:** dead-code list shrinks after each cleanup sprint; zero false "dead" among confirmed deletions.

---

## Scenario 9 — Array-Safety Audit (Paginated API Responses)

**Goal:** Eliminate the `items.filter is not a function` crash class (AGENTS.md Rule §2) by finding unguarded array operations on API results.

**Bug class:** runtime TypeError on paginated/error payloads.

**Steps**
1. Locate candidate mutations:
   `search_code(pattern="\\.filter\\(|\\.map\\(", path_filter="^src/(pages|components|hooks)")`
2. For each hit, verify the operand follows the safe-extraction contract:
   ```ts
   const rawData = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
   ```
3. Cluster hits by graph connectivity: the same fetcher feeding many components should be fixed **at the fetcher/hook**, not per-component.
4. Track audit progress as a TD row with a running count.

**Success criteria:** every `.map/.filter/.forEach` on API-derived data has an `Array.isArray` fallback within one hop of the response boundary.

---

## Scenario 10 — Pre-Release Gate (Run All Checks Together) ✅ EXECUTED (v3.1.46)

**Goal:** One repeatable sweep before tagging a release (feeds `releaseGate.service` and the test runner).

**Steps (ordered)**
1. `detect_changes(base_branch="master", scope="impact")` — full blast radius of the pending diff; flag any touched file inside `src/services/**` for Scenario 1/2 re-checks.
2. Re-run Scenario 2 (convention violations) — must be zero.
3. Re-run Scenario 4's recursion query — must return only guarded recursions.
4. `get_architecture(aspects=["cycles"])` — no new circular CALLS vs last release.
5. Complexity budget: no function exceeds cognitive 100 (`query_graph` Scenario 6 query); if exceeded → TD with a scheduled phase.
6. `npm run test` (all suites) + verify `Failed: 0`.
7. Bump version in the 3 sanctioned places (`package.json`, `/health` via `src/lib/version.ts` (reads package.json), active changelog `src/data/changelogs/3.ts`).

**Success criteria:** all six checks green → taggable. Any red → TD row + scheduled phase, per governance.

**Execution record (v3.1.46):**
1. `npm run test` (full 15-suite batch): first run **123/125** → root-caused 2 failures → fixed → re-run **125/125 PASSED**:
   - *Data-Safety gate test failed:* `isCleanupPermitted` implemented OR-semantics (flag OR dev-env) while the V10-0.1 invariant mandates AND → cleanup ran without the flag and killed the canary. Fixed to strict AND (`flag==='1'` AND `NODE_ENV∈{test,development}`) → TD-078.
   - *XSS penetration 401:* inter-suite cleanup hard-deletes `pen_admin%` users while `httpTestHelper` served a stale cached session → self-heal: liveness check (isDeleted=0) + re-create + re-login → TD-079a.
   - **Real-admin lockout side effect discovered:** the XFF rate-limit test brute-forced the REAL `admin` username → locked 30 min (columns `failedLoginCount`/`lockedUntil` on the real row). Fixed: synthetic probe user (created + hammered + deleted in-test) → TD-079b; real admin's lockout manually cleared.
2. `detect_changes` (release diff 83c516c..HEAD): 54 seeds → 28 impacted symbols, all expected (BOM/integrity callers, test suites, accounting routes/pages). No surprise coupling.
3. Cycles: 1 pre-existing mutual recursion (ruleEngine DSL evaluator pair) — not introduced by this release.
4. Recursion query: only `renderTreeNode` flagged — guarded since v3.1.42 (MAX_DEPTH + visited set, proven by 9 simulation checks); detector heuristic does not recognize Set-based guards.
5. Scenario-2 sweep: zero raw-SQL mutations in services/routes; `applyStockMovement` caller map all-sanctioned (4 sites, see Scenario 1 baseline).
6. Complexity budget: pre-existing >100-cognitive functions found (parseCliArgs 253, useCRMData 177, useAccounting 149, suites ~130-158, processUnifiedImport 117) → registered as TD-080 (open, scheduled), not a blocker for this release.
7. Version sync: `package.json` = changelog = `/health` (via `src/lib/version.ts` reads package.json) ✓.
**Verdict: release-gate GREEN → v3.1.46 taggable.**

---

## Appendix — Interpreting Evidence & Coverage Signals

- `trace_path` evidence: `strategy=lsp` + `confidence≥0.9` ⇒ trustworthy edge; `heuristic` ⇒ verify by reading source; `unresolved` ⇒ treat as unknown, grep manually.
- **Known resolver gap (v3.1.45):** cross-module **static-method calls from route files** (e.g. `DocumentService.applyStockMovement` inside `projects.routes.ts`) may not produce a CALLS edge even after a full re-index. When a hot-spot's caller count looks stale, ground-truth it with `rg "<Service>.<method>" src/` before trusting the graph. The same applies to any file listed in `index_status.parse_partial`.
- `index_status.parse_partial` files: constructs inside the flagged ranges may be missing from the graph — always grep those ranges.
- `not_indexed` files are excluded **by design** (gitignore/skip-lists) — not failures.
- Watcher: the daemon auto-refreshes the graph on git changes (`watcher.baseline strategy=git`); cursor-based re-queries after a reindex may return `stale_cursor` — just re-run.
