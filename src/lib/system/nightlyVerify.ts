import { formatPersianNumber } from '../../utils/persianNumber';

/**
 * v10.2.16 (O-04, 10.2 package 13): the nightly check on a copy of the backup. `scripts/nightly-verify.sh` restores the
 * latest good daily backup (the one `.last_daily_ok` names) into a drill database, `scripts/nightly-verify.ts` runs the
 * financial health check and the business invariants on that copy and writes this report (`logs/nightly-verify.json`);
 * the health page reads it through `nightlyVerifyVerdict`. Data that was wrong before stays listed but does not fail the
 * night: only a run that could not be done, a restore that failed, a check that could not run, or a check that got worse
 * than the last healthy night does. That last healthy night is kept in each report (`baseline`), so a bad night is
 * compared with it again the next night instead of becoming the new normal. A health check the baseline does not list
 * (one an update added) is new, never worse. What stays worse with the same counts for
 * `NIGHTLY_VERIFY_ACCEPT_AFTER_NIGHTS` nights in a row is accepted as the new normal that night (`acceptedWorse`), and
 * `scripts/nightly-verify.sh --accept-baseline` accepts the last report's counts at once.
 */

export const NIGHTLY_VERIFY_REPORT_VERSION = 1;

/** Nights in a row with the same worse counts after which they are accepted as the new normal */
export const NIGHTLY_VERIFY_ACCEPT_AFTER_NIGHTS = 3;

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

/** Why a night could not be checked (the shell script names it; the card says it in Persian) */
export const NIGHTLY_VERIFY_FAILURES = ['restore', 'timeout', 'no_dump', 'stale_dump', 'no_new_backup', 'no_space', 'space_unknown', 'not_drill'] as const;
export type NightlyVerifyFailure = (typeof NIGHTLY_VERIFY_FAILURES)[number];

/** The counts of the last healthy night, the yardstick of «worse» */
export interface NightlyVerifyBaseline {
  finishedAt: string;
  backupFile: string;
  health: NightlyHealthCount[];
  invariants: NightlyInvariantCount[];
}

export interface NightlyVerifyReport {
  version: number;
  /** UTC ISO time the check finished */
  finishedAt: string;
  /** the backup file checked (base name; empty when none was found) */
  backupFile: string;
  /** UTC ISO time that backup was taken (from `.last_daily_ok`), null when unknown */
  backupAt: string | null;
  restoreOk: boolean;
  /** why the night could not be checked; null when the restore and the checks ran */
  failure: NightlyVerifyFailure | null;
  /** null when the check could not run */
  health: NightlyHealthCount[] | null;
  invariants: NightlyInvariantCount[] | null;
  /** health check ids and invariants worse than the baseline */
  worse: string[];
  /** consecutive nights, this one included, whose worse findings had these same counts (0: nothing worse) */
  repeatNights: number;
  /** worse findings accepted tonight as the new normal (after repeated nights, or by hand) */
  acceptedWorse: string[];
  /** health checks the baseline does not list (added by an update): new, never worse */
  newChecks: string[];
  /** why a step could not run (English, for the log) */
  errors: string[];
  /** the last healthy night this report was compared with (null: none yet) */
  baseline: NightlyVerifyBaseline | null;
}

export type NightlyVerifyStatus = 'ok' | 'warning' | 'failed' | 'stale' | 'never' | 'unknown';

export interface NightlyVerifyHealth {
  status: NightlyVerifyStatus;
  finishedAt: string | null;
  backupFile: string | null;
  backupAt: string | null;
  failure: NightlyVerifyFailure | null;
  healthErrorCount: number | null;
  healthWarningCount: number | null;
  invariantViolationCount: number | null;
  worse: string[];
  acceptedWorse: string[];
  newChecks: string[];
  messages: string[];
}

export const NIGHTLY_VERIFY_MESSAGES = {
  ok: 'آخرین نسخهٔ پشتیبان بازیابی شد و بررسی حساب‌ها و انبار روی رونوشت آن چیزی بدتر از آخرین شب سالم نشان نداد.',
  never: 'بررسی شبانهٔ پشتیبان هنوز اجرا نشده است. پس از راه‌اندازی زمان‌بندی، نخستین گزارش فردا صبح می‌آید.',
  stale: 'بررسی شبانهٔ پشتیبان بیش از یک روز است اجرا نشده؛ زمان‌بندی سرور را بررسی کنید.',
  unknown: 'گزارش بررسی شبانهٔ پشتیبان خوانده نشد.',
  restoreFailed: 'آخرین نسخهٔ پشتیبان بازیابی نشد؛ این پشتیبان قابل اعتماد نیست. گزارش سرور را بررسی کنید.',
  checkFailed: 'بررسی حساب‌ها و انبار روی رونوشت پشتیبان اجرا نشد؛ گزارش سرور را بررسی کنید.',
} as const;

/** What the card says for a night that could not be checked */
export const NIGHTLY_VERIFY_FAILURE_MESSAGES: Record<NightlyVerifyFailure, string> = {
  restore: NIGHTLY_VERIFY_MESSAGES.restoreFailed,
  timeout: 'بررسی شبانهٔ پشتیبان در زمان مجاز تمام نشد و نیمه‌کاره رها شد؛ گزارش سرور را بررسی کنید.',
  no_new_backup: 'از شب پیش نسخهٔ پشتیبان تازه‌ای گرفته نشده و همان پشتیبان قبلی دوباره بررسی می‌شد؛ پشتیبان‌گیری شبانه را بررسی کنید.',
  no_dump: 'هیچ نسخهٔ پشتیبان روزانهٔ موفقی پیدا نشد؛ پشتیبان‌گیری شبانه را بررسی کنید.',
  stale_dump: 'آخرین نسخهٔ پشتیبان موفق بیش از یک روز پیش گرفته شده است؛ پشتیبان‌گیری شبانه را بررسی کنید.',
  no_space: 'جای خالی دیسک برای بازیابی رونوشت پشتیبان کافی نبود و بررسی انجام نشد؛ دیسک سرور را خالی‌تر کنید.',
  space_unknown: 'جای خالی دیسک برای بازیابی رونوشت پشتیبان سنجیده نشد و بررسی انجام نشد؛ گزارش سرور را بررسی کنید.',
  not_drill: NIGHTLY_VERIFY_MESSAGES.checkFailed,
};

/** Hours from the backup to the end of the check, in Persian digits; «نامعلوم» without the backup time */
export function backupAgeText(backupAt: string | null, finishedAt: string | null): string {
  if (!backupAt || !finishedAt) return 'نامعلوم';
  const hours = Math.floor((Date.parse(finishedAt) - Date.parse(backupAt)) / 3_600_000);
  return Number.isFinite(hours) ? `${formatPersianNumber(Math.max(0, hours))} ساعت` : 'نامعلوم';
}

export function worseMessage(count: number): string {
  return `${formatPersianNumber(count)} بررسی نسبت به آخرین شب سالم بدتر شده است؛ «بررسی سلامت مالی» را باز کنید.`;
}

export function acceptedMessage(count: number): string {
  return `${formatPersianNumber(count)} بررسی که بدتر شده بود، به‌عنوان وضع عادی تازه پذیرفته شد و از این پس مبنای مقایسه است.`;
}

export function newChecksMessage(count: number): string {
  return `${formatPersianNumber(count)} بررسی تازه آمده که آخرین شب سالم نداشت؛ از شب سالم بعد با آن مقایسه می‌شود.`;
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
const isIsoTime = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));

function isBaseline(v: unknown): v is NightlyVerifyBaseline {
  const b = v as NightlyVerifyBaseline;
  return Boolean(b) && isIsoTime(b.finishedAt) && typeof b.backupFile === 'string'
    && Array.isArray(b.health) && b.health.every(isHealthCount) && Array.isArray(b.invariants) && b.invariants.every(isInvariantCount);
}

/** The stored report, or null when the text is not a report of this version */
export function parseNightlyReport(text: string): NightlyVerifyReport | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const r = raw as NightlyVerifyReport;
  if (!r || r.version !== NIGHTLY_VERIFY_REPORT_VERSION || !isIsoTime(r.finishedAt)) return null;
  if (typeof r.backupFile !== 'string' || typeof r.restoreOk !== 'boolean') return null;
  if (r.health !== null && !(Array.isArray(r.health) && r.health.every(isHealthCount))) return null;
  if (r.invariants !== null && !(Array.isArray(r.invariants) && r.invariants.every(isInvariantCount))) return null;
  if (!isStringArray(r.worse) || !isStringArray(r.errors) || !isStringArray(r.acceptedWorse) || !isStringArray(r.newChecks)) return null;
  if (!Number.isInteger(r.repeatNights) || r.repeatNights < 0) return null;
  if (r.backupAt !== null && !isIsoTime(r.backupAt)) return null;
  if (r.failure !== null && !(NIGHTLY_VERIFY_FAILURES as readonly string[]).includes(r.failure)) return null;
  if (r.baseline !== null && !isBaseline(r.baseline)) return null;
  return r;
}

/** A night whose restore and checks ran and found nothing worse: the next nights are compared with it */
export function isHealthyNight(r: NightlyVerifyReport): r is NightlyVerifyReport & { health: NightlyHealthCount[]; invariants: NightlyInvariantCount[] } {
  return r.restoreOk && r.failure === null && r.health !== null && r.invariants !== null && r.worse.length === 0 && r.errors.length === 0;
}

/**
 * The note of an accepted new normal stays until the next healthy night: a night that could not be checked keeps the
 * one the night before carried
 */
export function nightlyCarriedAccepted(previous: NightlyVerifyReport | null, next: NightlyVerifyReport): string[] {
  if (next.acceptedWorse.length > 0) return next.acceptedWorse;
  if (!isHealthyNight(next) && previous && previous.acceptedWorse.length > 0) return previous.acceptedWorse;
  return [];
}

/** The yardstick of tonight: the previous night when it was healthy, else the last healthy night it kept */
export function nightlyBaseline(previous: NightlyVerifyReport | null): NightlyVerifyBaseline | null {
  if (!previous) return null;
  if (isHealthyNight(previous)) {
    return { finishedAt: previous.finishedAt, backupFile: previous.backupFile, health: previous.health, invariants: previous.invariants };
  }
  return previous.baseline;
}

const STATUS_RANK: Record<NightlyHealthCount['status'], number> = { healthy: 0, warning: 1, error: 2 };

/**
 * Health checks and invariants worse tonight than in the baseline: a worse status, or more findings at the same
 * non-healthy status, or more violations of an invariant. Without a baseline (or a side that did not run) nothing is
 * compared.
 */
export function nightlyWorse(previous: Pick<NightlyVerifyReport, 'health' | 'invariants'> | null, next: Pick<NightlyVerifyReport, 'health' | 'invariants'>): string[] {
  const worse: string[] = [];
  if (previous?.health && next.health) {
    const was = new Map(previous.health.map(h => [h.id, h]));
    for (const now of next.health) {
      const before = was.get(now.id);
      // a check the baseline does not list is new (nightlyNewChecks), not worse
      if (!before) continue;
      const beforeRank = STATUS_RANK[before.status];
      const beforeCount = before.status === now.status ? before.count : 0;
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

/** Health checks tonight that the baseline does not list (an update added them) */
export function nightlyNewChecks(previous: Pick<NightlyVerifyReport, 'health'> | null, next: Pick<NightlyVerifyReport, 'health'>): string[] {
  if (!previous?.health || !next.health) return [];
  const was = new Set(previous.health.map(h => h.id));
  return next.health.filter(h => !was.has(h.id)).map(h => h.id);
}

const countsKey = (r: Pick<NightlyVerifyReport, 'health' | 'invariants'>) => JSON.stringify([r.health, r.invariants]);

/**
 * How many nights in a row, tonight included, were worse with these same counts: one more than the night before when
 * that night was worse with the same health and invariant counts, else 1; 0 when nothing is worse tonight.
 */
export function nightlyRepeat(previous: NightlyVerifyReport | null, next: Pick<NightlyVerifyReport, 'health' | 'invariants' | 'worse' | 'backupFile'>): number {
  if (next.worse.length === 0) return 0;
  if (previous && previous.worse.length > 0 && countsKey(previous) === countsKey(next)) {
    // Another run on the same backup is not another night
    if (previous.backupFile !== '' && previous.backupFile === next.backupFile) return previous.repeatNights;
    return previous.repeatNights + 1;
  }
  return 1;
}

/** The health page card from the stored report (null: none yet) at the time `now` */
export function nightlyVerifyVerdict(report: NightlyVerifyReport | null, now: Date): NightlyVerifyHealth {
  if (!report) {
    return {
      status: 'never', finishedAt: null, backupFile: null, backupAt: null, failure: null, healthErrorCount: null, healthWarningCount: null,
      invariantViolationCount: null, worse: [], acceptedWorse: [], newChecks: [], messages: [NIGHTLY_VERIFY_MESSAGES.never],
    };
  }
  const healthErrorCount = report.health ? report.health.filter(h => h.status === 'error').length : null;
  const healthWarningCount = report.health ? report.health.filter(h => h.status === 'warning').length : null;
  const invariantViolationCount = report.invariants ? report.invariants.reduce((sum, i) => sum + i.count, 0) : null;
  const messages: string[] = [];
  let status: NightlyVerifyStatus = 'ok';
  if (report.failure) {
    status = 'failed';
    messages.push(NIGHTLY_VERIFY_FAILURE_MESSAGES[report.failure]);
  } else if (!report.restoreOk) {
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
    // a failed night stays failed; an old good or warned one is «not run lately»
    if (status !== 'failed') status = 'stale';
    messages.unshift(NIGHTLY_VERIFY_MESSAGES.stale);
  }
  if (messages.length === 0) messages.push(NIGHTLY_VERIFY_MESSAGES.ok);
  if (report.acceptedWorse.length > 0) messages.push(acceptedMessage(report.acceptedWorse.length));
  if (report.newChecks.length > 0) messages.push(newChecksMessage(report.newChecks.length));
  return {
    status, finishedAt: report.finishedAt, backupFile: report.backupFile || null, backupAt: report.backupAt, failure: report.failure,
    healthErrorCount, healthWarningCount, invariantViolationCount, worse: report.worse, acceptedWorse: report.acceptedWorse,
    newChecks: report.newChecks, messages,
  };
}
