import { createHash } from 'crypto';
import { AIUpdateLog } from './types';

/**
 * v8.0.0: گارد سری‌های چنج‌لاگ — سری فعال و سری‌های بسته‌شده (منجمد).
 * فقط اسکریپت `npm run check:version` و تست واحد unit_changelog_series_closure_v8 از آن استفاده می‌کنند
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
    violations.push(`نسخه package.json «${stripV(pkgVersion)}» در سری فعال ${active.series} نیست (${active.file})`);
  }

  const seen = new Set<string>();
  for (const u of active.updates) {
    const v = stripV(u?.version);
    if (majorOf(v) !== active.series) violations.push(`مدخل «${v}» در فایل فعال ${active.file} از سری ${active.series} نیست`);
    if (seen.has(v)) violations.push(`نسخه تکراری «${v}» در ${active.file}`);
    seen.add(v);
  }

  for (const c of closed) {
    const top = stripV(c.updates[0]?.version);
    if (top !== stripV(c.finalVersion)) {
      violations.push(`سری بسته‌شده ${c.series} باید با v${stripV(c.finalVersion)} تمام شود، اما مدخل بالای آن «${top}» است`);
    }
    if (c.updates.length !== c.entryCount) {
      violations.push(`سری بسته‌شده ${c.series} باید ${c.entryCount} مدخل داشته باشد، اما ${c.updates.length} مدخل دارد`);
    }
    if (fingerprintChangelog(c.updates) !== c.sha256) {
      violations.push(`چنج‌لاگ سری بسته‌شده ${c.series} تغییر کرده است؛ سری بسته‌شده منجمد است و تغییرات تازه در ${active.file} ثبت می‌شوند`);
    }
    for (const u of active.updates) {
      if (c.updates.some(x => stripV(x.version) === stripV(u.version))) {
        violations.push(`نسخه «${stripV(u.version)}» هم در سری فعال و هم در سری بسته‌شده ${c.series} آمده است`);
      }
    }
  }

  return violations;
}
