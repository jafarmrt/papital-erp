# Papital ERP — Go-Live Checklist (Production Deployment)

> **Scope:** Clean production install on an Ubuntu/Debian VPS using the built-in installer tooling.
> **Execution order is mandatory.** Do not proceed to the next phase until every box in the current phase is checked.
> All commands are run from `/opt/papital-erp` unless stated otherwise.

---

## Phase 0 — Quality Gates on the Development Machine (before shipping)

| # | Check | Command | Pass criteria |
|---|-------|---------|---------------|
| 0.1 | Type check / lint | `npm run lint` | `tsc --noEmit` exits 0 — **zero errors** |
| 0.2 | Full test suite (15 critical scenarios) | `npm run test` | All suites pass (unit, database, workflow, concurrency, integration, security, api, regression) |
| 0.3 | Production build | `npm run build` | Build completes; `dist/server.cjs` + `dist/index.html` exist |
| 0.4 | Version sync (3 locations) | — | `package.json` `version` == head entry of active changelog (`src/data/changelogs/3.ts` for v3.x). `/health` reads `package.json` dynamically at runtime. |
| 0.5 | Source archive (if shipping by zip) | `.\package-source.ps1` (Windows) | `papital-erp-source-v<VER>.zip` produced — never commit this zip |
| 0.6 | Push to GitHub | `git push origin master` | `git status` clean afterwards |

> Gate rule: if any of 0.1–0.3 fails, **STOP**. Fix, re-run, then ship.

---

## Phase 1 — Server Provisioning (VPS)

| # | Check | How to verify |
|---|-------|---------------|
| 1.1 | Ubuntu 22.04/24.04 LTS or Debian 12 | `lsb_release -a` |
| 1.2 | Minimum resources: 2 vCPU / 4 GB RAM / 40 GB SSD | `nproc && free -h && df -h /` |
| 1.3 | Non-root deploy user with sudo | `sudo whoami` returns `root` |
| 1.4 | Firewall: only 22, 80, 443 open. **Port 3000 must NOT be reachable from the internet** (app is exposed via Nginx only) | `ufw status` (or provider firewall panel) |
| 1.5 | DNS A record → server public IP, **DNS-only (no CDN proxy)** so Let's Encrypt can issue certificates | `dig +short erp.yourdomain.ir` |
| 1.6 | Server clock synced (NTP) — business documents depend on it | `timedatectl` shows `System clock synchronized: yes` |

---

## Phase 2 — Installation (`install.sh`)

Two supported source modes:
- **Zip mode:** upload the source zip, extract, run installer from the extracted directory.
- **Git mode:** installer clones the repo into `/opt/papital-erp`.

```bash
# Zip mode
unzip papital-erp-source-v*.zip -d /opt/papital-erp
cd /opt/papital-erp && sudo bash install.sh

# Git mode
sudo REPO_URL=https://<TOKEN>@github.com/jafarmrt/papital-erp.git bash install.sh
```

The installer performs: system deps (Node 22, PostgreSQL 16) → source → DB + `.env` generation (`chmod 600`) → `npm ci` → `npm run build` → systemd unit (`papital-erp`, Restart=always) → health probe.

**Post-install verification — do each one explicitly:**

| # | Check | Command / expected result |
|---|-------|---------------------------|
| 2.1 | `.env` exists and is locked down | `stat -c '%a %n' .env` → `600 .env` |
| 2.2 | `NODE_ENV=production` | `grep '^NODE_ENV' .env` |
| 2.3 | **Seed gate closed** | `grep '^ALLOW_SEED_IN_PRODUCTION' .env` → `false` |
| 2.4 | **Danger flags absent** | `grep -E '^ERP_ALLOW_TEST_CLEANUP=1|^ENABLE_TEST_ENDPOINTS=true' .env` → no output |
| 2.5 | `JWT_SECRET` >= 32 chars | `grep -c '^JWT_SECRET=.\{32,\}' .env` → `1` |
| 2.6 | Env audit | `set -a; . ./.env; set +a; ./scripts/audit-env.sh` → no CRITICAL findings |
| 2.7 | Service active and enabled | `systemctl is-active papital-erp && systemctl is-enabled papital-erp` → `active` / `enabled` |
| 2.8 | Lifecycle probes | `curl -fsS localhost:3000/health/live` → `{"status":"alive"}` • `/health/ready` → `{"status":"ready"}` • `/health/startup` |
| 2.9 | Migrations applied (atomic migrator — NEVER `db:push`) | `journalctl -u papital-erp -n 50 \| grep Migrator` shows success; `logs` free of errors |
| 2.10 | Installer log kept | `install-*.log` archived off the server |

> If the health probe fails: `journalctl -u papital-erp -n 100` — most common causes are `DATABASE_URL` connectivity or a failed migration (atomic → fully rolled back; check `migrations_log`).

---

## Phase 3 — Initial Setup Wizard & Secret Rotation

| # | Action | Detail |
|---|--------|--------|
| 3.1 | Read setup token | `grep '^ERP_SETUP_TOKEN' .env` |
| 3.2 | Run wizard over **HTTPS** | `https://erp.yourdomain.ir/setup?token=<ERP_SETUP_TOKEN>` → create chief-admin account + company settings. **Complete this before exposing the app to users.** |
| 3.3 | **Rotate the setup token immediately after setup** | `ERP_SETUP_TOKEN=$(openssl rand -hex 24)` → update `.env` → `sudo systemctl restart papital-erp` |
| 3.4 | Login test through the public domain | Browser: HTTPS login succeeds; cookie `auth_token` present, `Secure` + `HttpOnly` flags set (DevTools → Application → Cookies) |

---

## Phase 4 — Domain & HTTPS (`setup-domain.sh`)

```bash
sudo DOMAIN=erp.yourdomain.ir EMAIL=admin@yourdomain.ir bash setup-domain.sh
```

The script installs Nginx + Certbot, configures reverse proxy → localhost:3000, issues the Let's Encrypt certificate, enables HTTP→HTTPS redirect, and updates `ALLOWED_ORIGINS` in `.env` (service restart included).

| # | Check | Expected |
|---|-------|----------|
| 4.1 | `curl -I https://erp.yourdomain.ir/health/live` | `200`, valid TLS cert |
| 4.2 | `curl -I http://erp.yourdomain.ir/health/live` | `301` → HTTPS |
| 4.3 | `ALLOWED_ORIGINS` contains `https://erp.yourdomain.ir` | `grep '^ALLOWED_ORIGINS' .env` |
| 4.4 | Auto-renewal active | `systemctl list-timers \| grep certbot` |
| 4.5 | Certificate renewal dry-run | `sudo certbot renew --dry-run` → success |

---

## Phase 5 — In-App Configuration (performed inside the app, as chief admin)

| # | Item | Notes |
|---|------|-------|
| 5.1 | System settings: display timezone (`display_timezone`), company profile | Settings → همه settingها must reflect the real business |
| 5.2 | Currencies in use | Do not hardcode currency anywhere — verify item/price/document currency fields |
| 5.3 | Warehouses / locations | Define real warehouse structure before any stock document |
| 5.4 | Chart of accounts seed & account mapping (customers/suppliers subsidiary accounts) | Accounting → chart of accounts; needed before voucher sync |
| 5.5 | Users & roles (least privilege) | Only operational accounts; no shared credentials |
| 5.6 | Workflows & SLA | Verify state machines render on the visual canvas |
| 5.7 | WooCommerce (if used) | Webhook URL must be the **public domain** `https://erp.yourdomain.ir/api/woocommerce/webhook/order` (never a preview URL). Verify secret + HMAC headers. |

---

## Phase 6 — Backup & Recovery (must be proven BEFORE go-live)

| # | Action | Command / expected |
|---|--------|--------------------|
| 6.1 | Daily backup cron installed | `/etc/cron.d/papital-erp-backup` runs `scripts/backup.sh` nightly (`0 2 * * *`) |
| 6.2 | First manual backup succeeds | `set -a; . ./.env; set +a; BACKUP_KIND=daily ./scripts/backup.sh` → dump + uploads archive created in `/var/backups/erp`, integrity verified (gzip + `pg_restore --list`) |
| 6.3 | Offsite copy strategy | `S3_BACKUP_BUCKET` in `.env`, or a manual scheduled off-server copy — **backups on the same disk are not a backup** |
| 6.4 | **Recovery drill (mandatory)** | `RESTORE_MODE=drill ./scripts/restore.sh <latest-dump>.dump.gz` → restores into a temporary DB, validates row counts of critical tables, drops temp DB |
| 6.5 | Drill result recorded | Log file/date + verified table counts kept with ops documentation |

> Principle: "a backup exists" ≠ "the backup is restorable". Repeat the drill after every major schema change and monthly.

---

## Phase 7 — Automated Post-Deploy Verification

### 7.1 Full server readiness sweep

```bash
sudo bash scripts/go-live-verify.sh http://localhost:3000
```

Validates: env safety, systemd state, all three health probes, version match against `package.json`, DB reachability, latest migration record, Outbox/DLQ status, backup dir + cron presence, HTTPS reachability, metrics endpoint. Exits non-zero on any failure.

### 7.2 API smoke test

```bash
# ADMIN_TOKEN = value of the auth_token cookie from a logged-in admin session (DevTools → Application → Cookies)
BASE_URL=https://erp.yourdomain.ir ADMIN_TOKEN=<cookie-value> ./scripts/smoke-test.sh
```

Covers 8 steps: health/live, health/ready, `/api/stats`, vouchers list, items list, unsigned webhook rejection (401/403/503), login rate-limit (429), `/metrics`.

---

## Phase 8 — Manual Business-Logic E2E (on test data, via the public domain)

Run each scenario end-to-end and verify the accounting/inventory side effects:

| # | Scenario | Verify |
|---|----------|--------|
| 8.1 | Login / logout / session persistence | `/api/auth/me` returns user after reload |
| 8.2 | Create item + customer | Both visible in lists; category default unit auto-filled |
| 8.3 | Invoice: draft → final (sale) | Stock deducted (global `current_stock` **and** location `stocks`), stock movement log row created, WAC untouched on 'out' |
| 8.4 | Purchase receipt (in) | Stock added; **WAC recalculated** on in-event |
| 8.5 | Kardex (event sourcing) | Ledger rows match stock movements; three-way sync consistent |
| 8.6 | Accounting: auto voucher | Voucher auto-generated for the documents; debits == credits |
| 8.7 | Trial balance (4 levels) + journal book | All 4 coding levels load without search; drill-down to ledger works |
| 8.8 | Treasury transaction + Sayad cheque lifecycle | Transaction numbered atomically; cheque status transitions work |
| 8.9 | Workflow instance + approval | Transitions respect rule conditions; parallel approvals (`AND_ALL`/`OR_ANY`/`K_OF_N`) honor thresholds |
| 8.10 | Event pipeline | Outbox events dispatched; DLQ empty (or replay works); webhook delivery logged with `X-ERP-Signature-256` |
| 8.11 | Persian UI correctness | Jalali dates, `formatPersianPrice` formatting, dynamic currency labels |
| 8.12 | **Cleanup test data** | Delete test documents via normal app flows (soft-delete). `ERP_ALLOW_TEST_CLEANUP` must NEVER be set on production |

---

## Phase 9 — Operations, Monitoring & Update Discipline

| # | Item | Detail |
|---|------|--------|
| 9.1 | Log rotation & writable LOG_DIR | Winston daily rotation into `LOG_DIR`; `logs/` writable by service user |
| 9.2 | Metrics & monitoring | `/metrics` scraped (Prometheus) or a cron alert on `/health/ready` failure |
| 9.3 | Memory / pool limits | `MemoryLimit` in the systemd unit (default 2G commented) + `DB_POOL_MAX` in `.env` |
| 9.4 | Graceful shutdown verified | `sudo systemctl restart papital-erp` → journal shows `[Shutdown]` sequence, no data loss |
| 9.5 | Secret rotation calendar | `JWT_SECRET` every 3 months • `ERP_SETUP_TOKEN` once after setup • `DATABASE_URL` password every 6 months • `wc_webhook_secret` every 6 months (README: Secrets table). After each rotation run `./scripts/smoke-test.sh` |
| 9.6 | Known open tech debt acknowledged | `TECH_DEBT.md` open rows (TD-032, TD-081, TD-083, TD-085) reviewed — none blocking go-live |
| 9.7 | On-call runbook familiarity | README "Runbook" section: OOM, failed migration, rollback, restore |

### Updating the application — two supported paths

**A) Git-based update (recommended):**
```bash
cd /opt/papital-erp && ./update.sh
# → automatic pre-deployment backup (90-day retention) → git pull --ff-only
#   → npm ci → npm run build → service restart → health verification
```

**B) Manual update (source zip, no git remote access):**
```bash
# Upload the new source zip, extract it, then:
sudo bash update.sh --source /root/papital-erp-source-v<NEW>/
# or directly from the zip archive:
sudo bash update.sh --zip /root/papital-erp-source-v<NEW>.zip
# → backup → sync source over /opt/papital-erp (preserves .env, .git, logs,
#   uploads, backups, node_modules) → npm ci → build → restart → health check
```

> **Invariants for every update path:** migrations run automatically at startup via the atomic migrator — `npm run db:push` is **banned**. `update.sh` always backs up first (`--no-backup` override exists but is discouraged).

---

## Sign-off

Go-live is approved only when **all boxes above are checked** and recorded (installer log, update log, drill log, smoke-test output).

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Deployer | | | |
| Business owner | | | |