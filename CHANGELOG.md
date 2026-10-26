# Changelog — Papital Workshop ERP

All notable development history is preserved in **Git history** (`git log`). This file
holds the release policy and the active series: the changes waiting for the next release
under «### Unreleased», then one section per released version.

## Release policy (V10 onward)

| Channel | File | Version series |
|---|---|---|
| Client-bundled update center | `src/data/changelogs/0.ts` | baseline `v1.0.0` entry |
| Client-bundled update center (archive) | `src/data/changelogs/archive_1_6.ts` | condensed `1.x.y` – `6.x.y` series (`v1.x` - `v6.0.28`), replaced `1.ts` … `6.ts` in v7.0.11 |
| Client-bundled update center (archive) | `src/data/changelogs/7.ts` | closed `7.x.y` series (`v7.0.0` – `v7.0.140`), frozen in v8.0.0 (fingerprint checked by `npm run check:version`) |
| Client-bundled update center (archive) | `src/data/changelogs/8.ts` | closed `8.x.y` series (`v8.0.0` – `v8.0.128`), frozen in v9.0.0 (fingerprint checked by `npm run check:version`) |
| Client-bundled update center (archive) | `src/data/changelogs/9.ts` | closed `9.x.y` series (`v9.0.0` – `v9.0.461`), frozen in v10.0.0 (fingerprint checked by `npm run check:version`) |
| Client-bundled update center (archive) | `src/data/changelogs/10.ts` | closed `10.x.y` series (`v10.0.0` – `v10.3.24`), frozen in v11.0.0 (fingerprint checked by `npm run check:version`) |
| Client-bundled update center (active) | `src/data/changelogs/11.ts` | current `11.x.y` release series (`v11.0.0` onward); short entries, important points only (v7.0.54) |
| Release notes (this file) | `CHANGELOG.md` | «### Unreleased» and the sections of the active series (series 1 to 10: commit `c3c9858`) |

---

## Version 11.x Series (Active — see `src/data/changelogs/11.ts`)

### Unreleased
- Dashboard: the «تازه‌های این نسخه» card no longer shows on the پیشخوان after an update (owner's request); `WhatsNewCard` and its two client hooks are removed. With it users no longer see any release notes in the app (the changelog page itself left in 10.1). The `/social/whats-new` routes, their regression case and the `users.whats_new_seen_version` column are kept unused for now, so the card can come back without a migration.
- Update memory check (after the failed v11.2.0 server update, whose build the kernel killed for lack of memory on a server without swap): `update.sh` adds RAM available and free swap before the backup and again before the build and stops with the swap file steps below 2048 MB (`UPDATE_MIN_MEMORY_MB`), and a build or `npm ci` killed for lack of memory (`oom_kill` of `/proc/vmstat`) is named as such instead of a bare «Build failed» or three network retries; README and the go-live checklist give the swap steps. Vitest `updateMemoryCheck.test.ts`.

### v11.2.0 — پایان فاز ۳: رفع فوری پول، انبار و به‌روزرسانی سرور
- Update safety (phase 3.3, findings O1, O2, O4 and O5 of the independent evaluation): the built server reads its migrations only from its own `dist/drizzle`, never from the source `drizzle/` update.sh pulls before the swap (a restart of the old build in that window used to run the new release's migrations under the old code); after a failed update the rollback steps follow the database (no migration newer than the previous build: code back with no restore; else go forward or restore the backup, never the previous build on the migrated database); `npm ci` regenerates the lock only on npm's own lock mismatch and never one git tracks, retries network failures and never writes a lock into the checkout (a lock an earlier update changed is put back before the pull); every script reads `.env` through one reader, `scripts/env-file.sh`, the way the service does (`node --env-file`: the last line wins, `export`, inline comments), also `backup.sh` and `monitor.sh` (only that one line, with the owner's leave from card ت۵۲). The pull of the first update after this change is still done by the previous update.sh and the previous build's migrator, so these protections start with the update after it. Vitest `updateSafetyPhase3_3.test.ts`.
- Stock fixes (phase 3.2, findings S1 and S3 of the independent evaluation): an Excel row no longer changes the type of an item with stock or a Kardex row (the stock sat in the inventory account of the old type, so the raw material and product accounts drifted apart); an item with an open BOM allocation or a finalized project's reservation is not deleted (409 `ITEM_HAS_OPEN_ALLOCATION` / `ITEM_HAS_PROJECT_RESERVATION`), the release of an allocation whose item was deleted is refused (409 `ALLOCATION_ITEM_DELETED`, it can still be consumed) and the stock engine records no movement on a deleted item (409 `ITEM_DELETED`) except a stock count decrease; the financial health check lists deleted items that still hold stock or an open allocation (`item_deleted_with_stock`), and such stock is written off by a stock count to zero. Regression `reg_item_excel_type_change_with_history_s1`, `reg_item_delete_open_allocation_s3`, `reg_bom_release_deleted_item_s3`.
- Urgent money fixes (phase 3.1, evaluation findings M1, M2, M4, M5/S6/M23): a voucher correction issues its replacement as a manual draft that another approver approves (before, a user who may only draft vouchers posted any amount straight into the books); the opening voucher of a treasury account and its opening-balance adjustments are sourced vouchers, changed only from the account form, where a draft opening voucher now moves with the start date; a misplaced group separator («12,5», «1٬00٬0», «0,500») is refused by every server number field (prices, work log quantities and piecework rates included) instead of being read as 125; the fiscal-year lock holds on treasury rows, transfers and cheques without a voucher, cheque steps, warehouse transfers and draft documents, a proforma turned into a draft included (a proforma itself is exempt). Regression `moneyUrgentFixesV11Tests.ts`, vitest `moneyUrgentFixesV11.test.ts`.

### v11.1.0 — پایان فاز ۱: قواعد تازه، نسخه با هر به‌روزرسانی سرور
- Archive cleanup (sub-phase 1.3, owner decision): `docs/rules/archive` (old AGENTS.md, ARCHITECTURE_RULES.md, the 1.4 MB debt archive), `docs/roadmap/archive`, `docs/audit` and the CHANGELOG.md sections of series 1 to 10 are removed; they are read at commit `c3c985845ef8a925bbb04946e74951305324d477`. Only the ids of the debt rows closed up to series 10 stay, in `docs/rules/CLOSED_DEBT_IDS_V10.md`, so no id is used twice and the closed count stays whole. Vitest `releaseGovernance.test.ts`, `releaseTool.test.ts`.
- Release process (sub-phase 1.3, PR 3, product-owner decision): a version per server update, not per change. A pull request adds its line here under Unreleased and takes no version (`npm run release` without `version`); a release cut before a server update moves these lines under the next patch, and the end of a roadmap phase takes the next minor (end of phase 1 = v11.1.0). `release:renumber` keeps both sides' Unreleased lines, and `check:version` refuses a missing Unreleased section and a skipped version. Vitest `releaseTool.test.ts`, `releaseRenumber.test.ts`, `releaseGovernance.test.ts`.

### v11.0.4 — درس‌های بدهی به‌جای بایگانی بزرگ
- Documentation and tooling (sub-phase 1.3, PR 2): the 1.4 MB `TECH_DEBT_ARCHIVE.md` is frozen as `docs/rules/archive/TECH_DEBT_ARCHIVE_V10.md` (rows closed up to series 10). `docs/rules/DEBT_LESSONS.md` holds 15 lessons of the fixed debt that no single rule names, and the rows closed since series 11 (TD-1389 and TD-1390 move there). `npm run release`, `release:renumber` and `check:version` write and read the new file, and the frozen archive still counts for used ids and the closed-row count. The unsupported k8s example is no version location any more (placeholder image tag, no `APP_VERSION`), so a release bumps three locations.

### v11.0.3 — قواعد کوتاه پروژه
- Documentation and tooling (sub-phase 1.3, PR 1, from the 24 section decisions of the v11 governance review): `AGENTS.md` becomes a short core, one line per rule with its guard, and the full rules move to area files in `docs/rules/` (20 files, version and debt tags removed, a UI glossary in `ui.md`). The old `AGENTS.md` and `ARCHITECTURE_RULES.md` are kept verbatim in `docs/rules/archive/`. The architecture rules join the core: thin routes, no whole raw SQL write statement (a `sql` fragment inside `set()` is allowed), package boundary must not grow. Lighter process: small same-kind fixes share a pull request and a version, docs-only pull requests take no version, TD rows only for remaining debt, full review only for money, stock, security and migrations. New architecture ratchet metric `rawSqlWrites` (baseline 0); the governance docs test reads `AGENTS.md` and `docs/rules/*.md`.

### v11.0.2 — تصویر پایهٔ Docker از آینهٔ گوگل
- CI fix: Amazon ECR Public refused the Node base image with «toomanyrequests: Data limit exceeded», so the Docker Container Build Verification job failed on master and every pull request before any build step. The Dockerfile base images now come from the Google mirror of the Docker official images (`mirror.gcr.io/library/node:24-alpine`, same tag). The server is not affected (it installs with `install.sh`, not Docker). Vitest `ci_images_from_mirror_td_1169`, `node24Runtime.test.ts`.

### v11.0.1 — دکمهٔ پاک کردن شاخه‌های ادغام‌شده در GitHub
- Tooling only: a hand-run Actions workflow «Delete merged branches» (`.github/workflows/delete-merged-branches.yml`, logic in `scripts/governance/deleteMergedBranches.ts`) deletes the branches fully merged into the default branch and keeps the default, protected and open pull request branches and any branch with its own commits; it lists only unless «delete» is ticked (TD-1390, decision t50-6). No change to the app.

### v11.0.0 — بستن سری ۱۰ و آغاز نسخهٔ ۱۱
- Documentation and tooling: series 10 closes at v10.3.24 (`a5450c3`); `10.ts` is frozen with its fingerprint (413 entries) and `11.ts` is the active changelog. `docs/roadmap/V10_MASTER_ROADMAP.md` moves to `docs/roadmap/archive/` with a closing report (section 9) and `docs/roadmap/V11_MASTER_ROADMAP.md` opens (phases 0–6; phases 1 and 2 final, 3–6 provisional until the independent evaluation). The «what's new» card reads the active changelog instead of `10.ts` and its regression test now fails when the running version has no entry (TD-1389). Open debt carried over: TD-1294, TD-1354, TD-1355; the next id is TD-1390.

---

## Series 1 to 10 (removed in v11.1.0)

The summaries of series 1 to 10 (and the pre-1.0 history) were removed from this file in v11.1.0 with the other archives (`docs/rules/archive`, `docs/roadmap/archive`, `docs/audit`); read them at commit `c3c985845ef8a925bbb04946e74951305324d477`. The in-app entries of those series stay in `src/data/changelogs/0.ts`, `archive_1_6.ts` and `7.ts` to `10.ts`.
