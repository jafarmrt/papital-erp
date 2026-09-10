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

## Scenario 1 — Hotfix Blast Radius (before touching a critical service)

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

**Baseline (v3.1.x):** `applyStockMovement` has exactly **2 callers** — `DocumentService.finalizeDocument` (lsp-verified, confidence 0.95) and the file-level `__file__` node (heuristic, 0.90).

**Success criteria:** post-change caller set == pre-change caller set (or every new caller is intentional and reviewed).

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

## Scenario 3 — Three-Way Stock Mismatch Root Cause

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

---

## Scenario 4 — Unguarded Recursion in Tree Rendering ⚡ EXECUTED (live findings)

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

## Scenario 10 — Pre-Release Gate (Run All Checks Together)

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

---

## Appendix — Interpreting Evidence & Coverage Signals

- `trace_path` evidence: `strategy=lsp` + `confidence≥0.9` ⇒ trustworthy edge; `heuristic` ⇒ verify by reading source; `unresolved` ⇒ treat as unknown, grep manually.
- `index_status.parse_partial` files: constructs inside the flagged ranges may be missing from the graph — always grep those ranges.
- `not_indexed` files are excluded **by design** (gitignore/skip-lists) — not failures.
- Watcher: the daemon auto-refreshes the graph on git changes (`watcher.baseline strategy=git`); cursor-based re-queries after a reindex may return `stale_cursor` — just re-run.
