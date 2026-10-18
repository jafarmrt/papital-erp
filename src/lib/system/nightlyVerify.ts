import { formatPersianNumber } from '../../utils/persianNumber';

/**
 * v10.2.14 (O-04, 10.2 package 13): the nightly check on a copy of the backup. `scripts/nightly-verify.sh` restores last
 * night's daily backup into a drill database, `scripts/nightly-verify.ts` runs the financial health check and the business
 * invariants on that copy and writes this report (`logs/nightly-verify.json`); the health page reads it through
 * `nightlyVerifyVerdict`. Data that was wrong before stays listed but does not fail the night: only a restore that
 * failed, a check that could not run, or a check that got worse than the night before does.
 */

export const NIGHTLY_VERIFY_REPORT_VERSION = 1;

/** A report older than this is «not run lately» (the job runs once a day) */
export const NIGHTLY_VERIFY_STALE_HOURS = 36;

export interface NightlyHealthCount {
  id: string;
  status: 'healthy' | 'warning' | 'error';
  count: number;
}

export interface NightlyInvariantCount {
  invariant: string;
  count: number;
}

export interface NightlyVerifyReport {
  version: number;
  /** UTC ISO time the check finished */
  finishedAt: string;
  /** the backup file checked (base name) */
  backupFile: string;
  restoreOk: boolean;
  /** null when the check could not run */
  health: NightlyHealthCount[] | null;
  invariants: NightlyInvariantCount[] | null;
  /** health check ids and invariants worse than the night before */
  worse: string[];
  /** why a step could not run (English, for the log) */
  errors: string[];
}

export type NightlyVerifyStatus = 'ok' | 'warning' | 'failed' | 'stale' | 'never' | 'unknown';

export interface NightlyVerifyHealth {
  status: NightlyVerifyStatus;
  finishedAt: string | null;
  backupFile: string | null;
  healthErrorCount: number | null;
  healthWarningCount: number | null;
  invariantViolationCount: number | null;
  worse: string[];
  messages: string[];
}

export const NIGHTLY_VERIFY_MESSAGES = {
  ok: 'نسخهٔ پشتیبان دیشب بازیابی شد و بررسی حساب‌ها و انبار روی رونوشت آن چیزی بدتر از شب پیش نشان نداد.',
  never: 'بررسی شبانهٔ پشتیبان هنوز اجرا نشده است. پس از راه‌اندازی زمان‌بندی، نخستین گزارش فردا صبح می‌آید.',
  stale: 'بررسی شبانهٔ پشتیبان بیش از یک روز است اجرا نشده؛ زمان‌بندی کارساز را بررسی کنید.',
  unknown: 'گزارش بررسی شبانهٔ پشتیبان خوانده نشد.',
  restoreFailed: 'نسخهٔ پشتیبان دیشب بازیابی نشد؛ این پشتیبان قابل اعتماد نیست. گزارش کارساز را بررسی کنید.',
  checkFailed: 'بررسی حساب‌ها و انبار روی رونوشت پشتیبان اجرا نشد؛ گزارش کارساز را بررسی کنید.',
} as const;

export function worseMessage(count: number): string {
  return `${formatPersianNumber(count)} بررسی نسبت به شب پیش بدتر شده است؛ «بررسی سلامت مالی» را باز کنید.`;
}

function isHealthCount(v: unknown): v is NightlyHealthCount {
  const r = v as NightlyHealthCount;
  return Boolean(r) && typeof r.id === 'string' && typeof r.count === 'number'
    && (r.status === 'healthy' || r.status === 'warning' || r.status === 'error');
}

function isInvariantCount(v: unknown): v is NightlyInvariantCount {
  const r = v as NightlyInvariantCount;
  return Boolean(r) && typeof r.invariant === 'string' && typeof r.count === 'number';
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(s => typeof s === 'string');

/** The stored report, or null when the text is not a report of this version */
export function parseNightlyReport(text: string): NightlyVerifyReport | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const r = raw as NightlyVerifyReport;
  if (!r || r.version !== NIGHTLY_VERIFY_REPORT_VERSION || typeof r.finishedAt !== 'string' || Number.isNaN(Date.parse(r.finishedAt))) return null;
  if (typeof r.backupFile !== 'string' || typeof r.restoreOk !== 'boolean') return null;
  if (r.health !== null && !(Array.isArray(r.health) && r.health.every(isHealthCount))) return null;
  if (r.invariants !== null && !(Array.isArray(r.invariants) && r.invariants.every(isInvariantCount))) return null;
  if (!isStringArray(r.worse) || !isStringArray(r.errors)) return null;
  return r;
}

const STATUS_RANK: Record<NightlyHealthCount['status'], number> = { healthy: 0, warning: 1, error: 2 };

/**
 * Health checks and invariants worse tonight than in the previous report: a worse status, or more findings at the same
 * non-healthy status, or more violations of an invariant. Without a previous report (or a side that did not run) nothing
 * is compared.
 */
export function nightlyWorse(previous: NightlyVerifyReport | null, next: Pick<NightlyVerifyReport, 'health' | 'invariants'>): string[] {
  const worse: string[] = [];
  if (previous?.health && next.health) {
    const was = new Map(previous.health.map(h => [h.id, h]));
    for (const now of next.health) {
      const before = was.get(now.id);
      const beforeRank = before ? STATUS_RANK[before.status] : 0;
      const beforeCount = before && before.status === now.status ? before.count : 0;
      if (STATUS_RANK[now.status] > beforeRank || (now.status !== 'healthy' && STATUS_RANK[now.status] === beforeRank && now.count > beforeCount)) {
        worse.push(`health:${now.id}`);
      }
    }
  }
  if (previous?.invariants && next.invariants) {
    const was = new Map(previous.invariants.map(i => [i.invariant, i.count]));
    for (const now of next.invariants) {
      if (now.count > (was.get(now.invariant) ?? 0)) worse.push(`invariant:${now.invariant}`);
    }
  }
  return worse;
}

/** The health page card from the stored report (null: none yet) at the time `now` */
export function nightlyVerifyVerdict(report: NightlyVerifyReport | null, now: Date): NightlyVerifyHealth {
  if (!report) {
    return {
      status: 'never', finishedAt: null, backupFile: null, healthErrorCount: null, healthWarningCount: null,
      invariantViolationCount: null, worse: [], messages: [NIGHTLY_VERIFY_MESSAGES.never],
    };
  }
  const healthErrorCount = report.health ? report.health.filter(h => h.status === 'error').length : null;
  const healthWarningCount = report.health ? report.health.filter(h => h.status === 'warning').length : null;
  const invariantViolationCount = report.invariants ? report.invariants.reduce((sum, i) => sum + i.count, 0) : null;
  const messages: string[] = [];
  let status: NightlyVerifyStatus = 'ok';
  if (!report.restoreOk) {
    status = 'failed';
    messages.push(NIGHTLY_VERIFY_MESSAGES.restoreFailed);
  } else if (report.health === null || report.invariants === null) {
    status = 'failed';
    messages.push(NIGHTLY_VERIFY_MESSAGES.checkFailed);
  } else if (report.worse.length > 0) {
    status = 'warning';
    messages.push(worseMessage(report.worse.length));
  }
  const ageHours = (now.getTime() - Date.parse(report.finishedAt)) / 3_600_000;
  if (ageHours > NIGHTLY_VERIFY_STALE_HOURS) {
    status = 'stale';
    messages.unshift(NIGHTLY_VERIFY_MESSAGES.stale);
  }
  if (messages.length === 0) messages.push(NIGHTLY_VERIFY_MESSAGES.ok);
  return {
    status, finishedAt: report.finishedAt, backupFile: report.backupFile,
    healthErrorCount, healthWarningCount, invariantViolationCount, worse: report.worse, messages,
  };
}
