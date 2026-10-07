import { TestCaseResult, makeTestCase } from '../types.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { makeDailyLogTestCtx, type DailyLogTestCtx } from './dailyLogAccessTests.js';

type ShouldRun = (id: string, ...extra: string[]) => boolean;

/**
 * Package 13 (daily logs and attachments), PR B: reading daily work logs (list, statistics, timestamps).
 * Each case reproduces a finding of the package 13 review on the real Express routes.
 */
export async function runDailyLogReadTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], (ctx: DailyLogTestCtx) => Promise<string>]> = [
    ['reg_daily_log_list_paginated_td_630',
      'v9.0.249: the daily log list is paged in SQL with its total, applies the visibility rule in SQL and refuses a negative limit (TD-630)',
      ['td630', 'daily_log', 'pagination', 'package13'], listPaginatedCase],
    ['reg_daily_log_today_hours_by_work_date_td_631',
      'v9.0.250: today\'s hours count only logs whose work date is today, not older logs created today (TD-631)',
      ['td631', 'daily_log', 'stats', 'package13'], todayHoursCase],
    ['reg_daily_log_created_at_utc_td_636',
      'v9.0.252: a daily log\'s created_at reaches the browser as UTC with a Z (TD-636)',
      ['td636', 'daily_log', 'timestamp', 'package13'], createdAtUtcCase],
  ];
  for (const [id, name, tags, run] of cases) {
    if (!shouldRun(id, ...tags)) continue;
    const tStart = Date.now();
    const ctx = await makeDailyLogTestCtx();
    try {
      const details = await run(ctx);
      results.push(makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details }));
    } catch (err) {
      results.push(makeTestCase({
        id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      await ctx.cleanup();
    }
  }
  return results;
}

async function listPaginatedCase(ctx: DailyLogTestCtx): Promise<string> {
  const wrong: string[] = [];
  const author = await ctx.userWith(['daily_logs.view', 'daily_logs.create']);
  const reader = await ctx.userWith(['daily_logs.view']);
  // 205 logs of one author: the old list cut the whole table at 200 rows and had no total
  for (let i = 0; i < 205; i++) {
    await ctx.insertLog(author, { title: `p13 bulk ${i}`, date: '2026-09-01', dateIso: '2026-09-01', visibility: i === 0 ? 'mentioned_only' : 'private', mentions: i === 0 ? [reader.id] : [] });
  }
  const page1 = await ctx.send(author, 'get', '/api/daily-logs?filter_type=mine&limit=100&page=1');
  const page3 = await ctx.send(author, 'get', '/api/daily-logs?filter_type=mine&limit=100&page=3');
  if (page1.status !== 200 || !Array.isArray(page1.body?.data)) wrong.push(`list answered ${page1.status} with ${Array.isArray(page1.body) ? 'a bare array' : typeof page1.body?.data}`);
  else {
    if (page1.body.total !== 205) wrong.push(`total ${page1.body.total}, expected 205`);
    if (page1.body.data.length !== 100) wrong.push(`page 1 has ${page1.body.data.length} rows`);
    if (page3.body?.data?.length !== 5) wrong.push(`page 3 has ${page3.body?.data?.length} rows, expected the last 5`);
  }
  // the visibility rule in SQL: the reader sees only the mentioned log, and the statistics count the same set
  const readerList = await ctx.send(reader, 'get', '/api/daily-logs?filter_type=all&limit=100&search=p13%20bulk');
  if (readerList.body?.total !== 1) wrong.push(`the reader sees ${readerList.body?.total} bulk logs, expected 1`);
  const negative = await ctx.send(author, 'get', '/api/daily-logs?limit=-5');
  if (negative.status !== 400) wrong.push(`limit=-5 answered ${negative.status}`);
  const stats = await ctx.send(author, 'get', '/api/daily-logs/stats');
  if (stats.body?.my_total_logs !== 205) wrong.push(`stats my_total_logs ${stats.body?.my_total_logs}`);

  if (wrong.length > 0) throw new Error(wrong.join('; '));
  return '205 logs: total 205, pages of 100 / 100 / 5; the reader sees only the mentioned log; limit=-5 is 400';
}

async function todayHoursCase(ctx: DailyLogTestCtx): Promise<string> {
  const author = await ctx.userWith(['daily_logs.view', 'daily_logs.create']);
  const today = await businessTodayIsoDate();
  const [y, m, d] = today.split('-').map(Number);
  const yesterday = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
  // both created now; only the second one is today's work
  await ctx.insertLog(author, { title: 'p13 yesterday', date: yesterday, dateIso: yesterday, workHours: 8 });
  await ctx.insertLog(author, { title: 'p13 today', date: today, dateIso: today, workHours: 8 });
  const stats = await ctx.send(author, 'get', '/api/daily-logs/stats');
  if (stats.status !== 200 || stats.body.today_hours !== 8) {
    throw new Error(`today_hours ${stats.body?.today_hours} (${stats.status}), expected 8`);
  }
  return 'yesterday 8h + today 8h, both created now: today_hours = 8';
}

async function createdAtUtcCase(ctx: DailyLogTestCtx): Promise<string> {
  const author = await ctx.userWith(['daily_logs.view', 'daily_logs.create']);
  const created = await ctx.send(author, 'post', '/api/daily-logs', { title: 'p13 utc', content: 'p13 utc', start_time: '08:00', end_time: '16:00' });
  const one = await ctx.send(author, 'get', `/api/daily-logs/${created.body?.id}`);
  const list = await ctx.send(author, 'get', '/api/daily-logs?filter_type=mine');
  const values = [created.body?.created_at, one.body?.created_at, list.body?.data?.[0]?.created_at];
  const bad = values.filter(v => typeof v !== 'string' || !/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/.test(v));
  if (bad.length > 0) throw new Error(`created_at without Z: ${JSON.stringify(values)}`);
  return `created_at ${values[0]}`;
}
