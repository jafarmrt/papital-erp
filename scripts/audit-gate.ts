import fs from 'fs';

/**
 * v7.0.19 (TD-172/TD-173) — گیت امنیتی وابستگی‌های رانتایم (fail-fast)
 * ======================================================================
 * خروجی `npm audit --json` را از stdin می‌خواند و در صورت وجود
 * هر آسیب‌پذیری High/Critical که در فهرست استثنای ثبت‌شده نیست، با کد ۱ خارج می‌شود.
 * جایگزین الگوی بی‌اثر `npm audit --audit-level=high || true` در CI.
 *
 * هر استثنا باید یک ردیف باز در TECH_DEBT.md داشته باشد و با رفع آن حذف شود.
 *
 * v7.0.84 (TD-177): کتابخانه‌های فرانت (React، xlsx و ...) که در باندل مرورگر می‌روند به devDependencies منتقل شدند؛
 * گیت اکنون `npm audit --json` (همه وابستگی‌ها) را می‌خواند تا آسیب‌پذیری آن‌ها هم CI را متوقف کند.
 */
// v7.0.58 (TD-173): استثناهای xlsx@0.18.5 حذف شدند — نسخه رسمی 0.20.3 از vendor/ نصب می‌شود
const ALLOWED_ADVISORIES: Record<string, string> = {};

const BLOCKING_SEVERITIES = new Set(['high', 'critical']);

interface AuditVia {
  url?: string;
  severity?: string;
  title?: string;
}

interface AuditVulnerability {
  severity: string;
  via: Array<AuditVia | string>;
}

function advisoryId(url?: string): string {
  const match = String(url || '').match(/GHSA-[a-z0-9-]+/i);
  return match ? match[0] : String(url || 'unknown');
}

/** Why the input is not an audit report (an npm error object or no vulnerability list); null for a report */
function auditRunFailure(report: unknown): string | null {
  if (!report || typeof report !== 'object' || Array.isArray(report)) return 'the output is not a JSON object';
  const r = report as { error?: { code?: unknown; summary?: unknown } | unknown; vulnerabilities?: unknown };
  if (r.error !== undefined) {
    const e = r.error as { code?: unknown; summary?: unknown };
    return `${String(e?.code ?? 'error')} ${String(e?.summary ?? '')}`.trim();
  }
  if (!r.vulnerabilities || typeof r.vulnerabilities !== 'object' || Array.isArray(r.vulnerabilities)) {
    return 'the output has no "vulnerabilities" object';
  }
  return null;
}

function main(): void {
  const raw = fs.readFileSync(0, 'utf-8');
  let report: { vulnerabilities?: Record<string, AuditVulnerability> };
  try {
    report = JSON.parse(raw);
  } catch {
    console.error('❌ Audit Gate: the npm audit output cannot be parsed (invalid JSON).');
    process.exit(1);
  }

  // v9.0.185 (TD-607): a failed `npm audit` (registry unreachable, no lockfile) prints an error object without a
  // vulnerability list; the gate used to read it as «no vulnerabilities» and pass
  const failure = auditRunFailure(report);
  if (failure) {
    console.error(`Audit Gate FAILED - npm audit did not produce a report: ${failure}`);
    process.exit(1);
  }

  const blocking: string[] = [];
  const allowed: string[] = [];

  for (const [pkg, vuln] of Object.entries(report.vulnerabilities ?? {})) {
    if (!BLOCKING_SEVERITIES.has(vuln.severity)) continue;
    // فقط مدخل‌های مستقیم advisory بررسی می‌شوند؛ مدخل رشته‌ای یعنی آسیب‌پذیری از وابستگی دیگری به ارث رسیده است
    const directAdvisories = (Array.isArray(vuln.via) ? vuln.via : []).filter(
      (v): v is AuditVia => typeof v === 'object' && v !== null
    );
    for (const via of directAdvisories) {
      const id = advisoryId(via.url);
      const line = `${pkg} [${via.severity || vuln.severity}] ${id} ${via.title || ''}`.trim();
      if (ALLOWED_ADVISORIES[id]) {
        allowed.push(`${line} → registered exception: ${ALLOWED_ADVISORIES[id]}`);
      } else {
        blocking.push(line);
      }
    }
  }

  for (const line of allowed) console.warn(`⚠️  ${line}`);

  if (blocking.length > 0) {
    console.error('❌ Audit Gate FAILED: High/Critical vulnerabilities without a registered exception in runtime dependencies:');
    for (const line of blocking) console.error(`   - ${line}`);
    process.exit(1);
  }

  console.log(`✅ Audit Gate OK: no High/Critical vulnerability without a registered exception (${allowed.length} registered exceptions).`);
}

main();
