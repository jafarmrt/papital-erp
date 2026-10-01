import fs from 'fs';

/**
 * v7.0.19 (TD-172/TD-173) — گیت امنیتی وابستگی‌های رانتایم (fail-fast)
 * ======================================================================
 * خروجی `npm audit --omit=dev --json` را از stdin می‌خواند و در صورت وجود
 * هر آسیب‌پذیری High/Critical که در فهرست استثنای ثبت‌شده نیست، با کد ۱ خارج می‌شود.
 * جایگزین الگوی بی‌اثر `npm audit --audit-level=high || true` در CI.
 *
 * هر استثنا باید یک ردیف باز در TECH_DEBT.md داشته باشد و با رفع آن حذف شود.
 */
const ALLOWED_ADVISORIES: Record<string, string> = {
  // xlsx@0.18.5 — بدون نسخه اصلاحی در رجیستری npm؛ مهاجرت در TD-173 پیگیری می‌شود
  'GHSA-4r6h-8v6p-xvw6': 'TD-173 (xlsx Prototype Pollution)',
  'GHSA-5pgg-2g8v-p4x9': 'TD-173 (xlsx ReDoS)',
};

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

function main(): void {
  const raw = fs.readFileSync(0, 'utf-8');
  let report: { vulnerabilities?: Record<string, AuditVulnerability> };
  try {
    report = JSON.parse(raw);
  } catch {
    console.error('❌ Audit Gate: خروجی npm audit قابل پارس نیست (JSON نامعتبر).');
    process.exit(1);
  }

  const blocking: string[] = [];
  const allowed: string[] = [];

  for (const [pkg, vuln] of Object.entries(report.vulnerabilities || {})) {
    if (!BLOCKING_SEVERITIES.has(vuln.severity)) continue;
    // فقط مدخل‌های مستقیم advisory بررسی می‌شوند؛ مدخل رشته‌ای یعنی آسیب‌پذیری از وابستگی دیگری به ارث رسیده است
    const directAdvisories = (Array.isArray(vuln.via) ? vuln.via : []).filter(
      (v): v is AuditVia => typeof v === 'object' && v !== null
    );
    for (const via of directAdvisories) {
      const id = advisoryId(via.url);
      const line = `${pkg} [${via.severity || vuln.severity}] ${id} ${via.title || ''}`.trim();
      if (ALLOWED_ADVISORIES[id]) {
        allowed.push(`${line} → استثنای ثبت‌شده: ${ALLOWED_ADVISORIES[id]}`);
      } else {
        blocking.push(line);
      }
    }
  }

  for (const line of allowed) console.warn(`⚠️  ${line}`);

  if (blocking.length > 0) {
    console.error('❌ Audit Gate FAILED — آسیب‌پذیری High/Critical ثبت‌نشده در وابستگی‌های رانتایم:');
    for (const line of blocking) console.error(`   - ${line}`);
    process.exit(1);
  }

  console.log(`✅ Audit Gate OK — بدون آسیب‌پذیری High/Critical ثبت‌نشده (${allowed.length} استثنای ثبت‌شده).`);
}

main();
