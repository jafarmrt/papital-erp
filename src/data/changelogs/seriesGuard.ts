import { createHash } from 'crypto';
import { AIUpdateLog } from './types';

/**
 * v8.0.0: گارد سری‌های چنج‌لاگ — سری فعال و سری‌های بسته‌شده (منجمد).
 * فقط اسکریپت `npm run check:version` و تست واحد unit_changelog_series_closure_v10 (از v10.0.0) از آن استفاده می‌کنند
 * (سمت مرورگر بارگذاری نمی‌شود، چون به crypto نیاز دارد).
 */
export interface ClosedChangelogSeries {
  series: number;
  /** آخرین نسخه سری که هنگام بستن ثبت شد */
  finalVersion: string;
  /** تعداد مدخل‌های سری هنگام بستن */
  entryCount: number;
  /** اثر انگشت SHA-256 محتوای مدخل‌ها هنگام بستن (fingerprintChangelog) */
  sha256: string;
  updates: AIUpdateLog[];
}

export interface ActiveChangelogSeries {
  series: number;
  file: string;
  updates: AIUpdateLog[];
}

const stripV = (v: unknown) => String(v ?? '').trim().replace(/^v/, '');
const majorOf = (v: unknown) => Number(stripV(v).split('.')[0]);

/** اثر انگشت پایدار محتوای مدخل‌ها؛ هر تغییر در متن، ترتیب یا تعداد مدخل‌ها آن را عوض می‌کند */
export function fingerprintChangelog(updates: AIUpdateLog[]): string {
  return createHash('sha256').update(JSON.stringify(updates)).digest('hex');
}

/**
 * ناسازگاری‌های سری‌ها را برمی‌گرداند (خالی = سالم):
 * ۱) شماره اصلی package.json همان سری فعال است؛
 * ۲) همه مدخل‌های فایل فعال در همان سری‌اند و نسخه تکراری ندارند؛
 * ۳) هر سری بسته‌شده دست‌نخورده است (نسخه پایانی، تعداد مدخل و اثر انگشت).
 */
export function findChangelogSeriesViolations(
  pkgVersion: string,
  active: ActiveChangelogSeries,
  closed: ClosedChangelogSeries[]
): string[] {
  const violations: string[] = [];

  if (majorOf(pkgVersion) !== active.series) {
    violations.push(`package.json version "${stripV(pkgVersion)}" is not in the active series ${active.series} (${active.file})`);
  }

  const seen = new Set<string>();
  for (const u of active.updates) {
    const v = stripV(u?.version);
    if (majorOf(v) !== active.series) violations.push(`entry "${v}" in the active file ${active.file} is not in series ${active.series}`);
    if (seen.has(v)) violations.push(`duplicate version "${v}" in ${active.file}`);
    seen.add(v);
  }

  for (const c of closed) {
    const top = stripV(c.updates[0]?.version);
    if (top !== stripV(c.finalVersion)) {
      violations.push(`closed series ${c.series} must end at v${stripV(c.finalVersion)}, but its top entry is "${top}"`);
    }
    if (c.updates.length !== c.entryCount) {
      violations.push(`closed series ${c.series} must have ${c.entryCount} entries, but has ${c.updates.length}`);
    }
    if (fingerprintChangelog(c.updates) !== c.sha256) {
      violations.push(`the changelog of closed series ${c.series} has changed; a closed series is frozen and new changes go into ${active.file}`);
    }
    for (const u of active.updates) {
      if (c.updates.some(x => stripV(x.version) === stripV(u.version))) {
        violations.push(`version "${stripV(u.version)}" is in both the active series and closed series ${c.series}`);
      }
    }
  }

  return violations;
}
