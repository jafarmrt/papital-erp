/**
 * v10.0.262 (I-04): the performance baseline's endpoint list, targets and report, kept pure so Vitest covers them.
 * `scripts/perf-baseline.ts` measures the endpoints on realistic data and passes the samples here.
 *
 * A target is the 95th percentile response time in milliseconds a single user may wait for on the workshop's
 * one-server deployment (AGENTS.md §22: one process, at most 20 concurrent users). A page reads one page of a list,
 * so its API must stay quick however large the tables grow; a report over a whole year may take longer.
 */

export type PerfEndpointKind = 'list' | 'report' | 'shell';

export interface PerfEndpoint {
  /** The page the API serves, in Persian (the report is read by the product owner). */
  page: string;
  path: string;
  kind: PerfEndpointKind;
  /** p95 target in milliseconds. */
  targetP95Ms: number;
}

/** p95 targets by endpoint kind (milliseconds). */
export const PERF_TARGET_P95_MS: Record<PerfEndpointKind, number> = {
  shell: 300,
  list: 800,
  report: 2000,
};

function endpoint(page: string, path: string, kind: PerfEndpointKind): PerfEndpoint {
  return { page, path, kind, targetP95Ms: PERF_TARGET_P95_MS[kind] };
}

/** The main APIs of the pages in `src/lib/permissions/pageAccess.ts`, as each page first calls them. */
export const PERF_ENDPOINTS: readonly PerfEndpoint[] = [
  endpoint('پیشخوان', '/api/stats', 'report'),
  endpoint('پیشخوان', '/api/dashboard-bi-stats', 'report'),
  endpoint('نوار بالا', '/api/notifications/unread-count', 'shell'),
  endpoint('نوار بالا', '/api/workflow/tasks/stats', 'shell'),
  endpoint('اسناد فروش', '/api/documents?page=1&limit=50', 'list'),
  endpoint('اسناد انبار', '/api/documents?page=1&limit=50&type=receipt', 'list'),
  endpoint('کاردکس', '/api/transactions?page=1&limit=50', 'list'),
  endpoint('کالاها', '/api/items?page=1&limit=50', 'list'),
  endpoint('فهرست کالا برای فرم‌ها', '/api/items/options?limit=50', 'list'),
  endpoint('هشدار نقطه سفارش', '/api/items/reorder-alerts', 'report'),
  endpoint('اقلام رزروشده', '/api/inventory/reserved-items', 'report'),
  endpoint('اشخاص', '/api/customers?page=1&limit=50', 'list'),
  endpoint('پروژه‌ها', '/api/projects?page=1&limit=50', 'list'),
  endpoint('تدارکات', '/api/procurement/requisitions', 'list'),
  endpoint('تدارکات', '/api/procurement/orders?page=1&limit=50', 'list'),
  endpoint('پرسنل', '/api/personnel', 'list'),
  endpoint('کارمزد', '/api/piecework/logs?page=1&limit=50', 'list'),
  endpoint('اسناد حسابداری', '/api/accounting/vouchers?page=1&limit=50', 'list'),
  endpoint('خزانه', '/api/accounting/treasury?page=1&limit=50', 'list'),
  endpoint('چک‌ها', '/api/accounting/cheques', 'list'),
  endpoint('تراز آزمایشی', '/api/accounting/reports/trial-balance', 'report'),
  endpoint('دفتر روزنامه', '/api/accounting/reports/journal-book?page=1', 'report'),
  endpoint('کارتابل', '/api/workflow/tasks/my-tasks?status=pending', 'list'),
  endpoint('گزارش رویدادها', '/api/activity-logs?page=1&limit=50', 'list'),
  endpoint('گزارش رویدادها', '/api/activity-logs/filters', 'list'),
];

export interface PerfSummary {
  count: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  meanMs: number;
}

/** Nearest-rank percentile of the samples (p in 0..100); 0 for no samples. */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((Math.min(100, Math.max(0, p)) / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)];
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function summarize(samples: readonly number[]): PerfSummary {
  if (samples.length === 0) return { count: 0, minMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0, meanMs: 0 };
  const total = samples.reduce((sum, s) => sum + s, 0);
  return {
    count: samples.length,
    minMs: round1(Math.min(...samples)),
    p50Ms: round1(percentile(samples, 50)),
    p95Ms: round1(percentile(samples, 95)),
    maxMs: round1(Math.max(...samples)),
    meanMs: round1(total / samples.length),
  };
}

export interface PerfMeasurement {
  endpoint: PerfEndpoint;
  /** HTTP statuses that were not 200, so a failing API is never reported as fast. */
  failedStatuses: number[];
  summary: PerfSummary;
}

export interface PerfVerdict extends PerfMeasurement {
  withinTarget: boolean;
}

/** An endpoint meets its target only when every request answered 200 and its p95 is within the target. */
export function evaluate(measurements: readonly PerfMeasurement[]): PerfVerdict[] {
  return measurements.map(m => ({
    ...m,
    withinTarget: m.failedStatuses.length === 0 && m.summary.count > 0 && m.summary.p95Ms <= m.endpoint.targetP95Ms,
  }));
}

export interface StatementStat {
  query: string;
  calls: number;
  totalMs: number;
  meanMs: number;
  rows: number;
}

export interface PerfReportInput {
  generatedAt: string;
  version: string;
  steps: number;
  activityLogRows: number;
  tableRows: Record<string, number>;
  verdicts: readonly PerfVerdict[];
  /** null when pg_stat_statements is not loaded (`shared_preload_libraries`). */
  topStatements: readonly StatementStat[] | null;
}

const md = (text: string): string => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/** The Markdown report, Persian, as the docs are (AGENTS.md §6 terminal rule covers only the terminal). */
export function renderPerfReport(input: PerfReportInput): string {
  const breaches = input.verdicts.filter(v => !v.withinTarget);
  const lines: string[] = [
    `# خط پایه کارایی (${input.version})`,
    '',
    `تاریخ اجرا: ${input.generatedAt} — شبیه‌ساز: ${input.steps} گام — ردیف‌های گزارش رویدادها: ${input.activityLogRows}`,
    '',
    '## حجم داده',
    '',
    '| جدول | ردیف |',
    '|---|---:|',
    ...Object.entries(input.tableRows).map(([table, rows]) => `| ${table} | ${rows} |`),
    '',
    '## زمان پاسخ (میلی‌ثانیه)',
    '',
    '| صفحه | API | میانه | p95 | بیشینه | هدف p95 | وضعیت |',
    '|---|---|---:|---:|---:|---:|---|',
    ...input.verdicts.map(v => {
      const state = v.failedStatuses.length > 0
        ? `خطا (${[...new Set(v.failedStatuses)].join('، ')})`
        : v.withinTarget ? 'در هدف' : 'بیش از هدف';
      return `| ${v.endpoint.page} | \`${v.endpoint.path}\` | ${v.summary.p50Ms} | ${v.summary.p95Ms} | ${v.summary.maxMs} | ${v.endpoint.targetP95Ms} | ${state} |`;
    }),
    '',
    breaches.length === 0 ? 'همه APIها در هدف خود هستند.' : `${breaches.length} API از هدف خود بیشتر است یا خطا داد.`,
    '',
    '## پرهزینه‌ترین پرس‌وجوها (pg_stat_statements)',
    '',
  ];
  if (input.topStatements === null) {
    lines.push('در این پایگاه‌داده `pg_stat_statements` بارگذاری نشده است (`shared_preload_libraries`)؛ این بخش خالی است.');
  } else {
    lines.push('| مجموع (ms) | میانگین (ms) | دفعات | ردیف | پرس‌وجو |', '|---:|---:|---:|---:|---|');
    for (const s of input.topStatements) {
      lines.push(`| ${round1(s.totalMs)} | ${round1(s.meanMs)} | ${s.calls} | ${s.rows} | \`${md(s.query).slice(0, 160)}\` |`);
    }
  }
  return `${lines.join('\n')}\n`;
}
