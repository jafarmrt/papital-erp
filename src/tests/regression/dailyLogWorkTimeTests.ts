import { TestCaseResult, makeTestCase } from '../types.js';
import { makeDailyLogTestCtx, type DailyLogTestCtx } from './dailyLogAccessTests.js';

type ShouldRun = (id: string, ...extra: string[]) => boolean;

/**
 * Package 13 (daily logs and attachments), PR D: the work time and work mode of a daily log.
 * Each case reproduces a finding of the package 13 review on the real Express routes.
 */
export async function runDailyLogWorkTimeTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], (ctx: DailyLogTestCtx) => Promise<string>]> = [
    ['reg_daily_log_work_time_validated_td_634',
      'v9.0.247: a daily log\'s start and end are valid times of day and the end is after the start; an overnight shift is refused (TD-634)',
      ['td634', 'daily_log', 'work_hours', 'package13'], workTimeCase],
    ['reg_daily_log_work_mode_onsite_remote_td_635',
      'v9.0.248: a daily log is onsite or remote; a legacy leave log is neither onsite nor work hours in the summary and statistics (TD-635)',
      ['td635', 'daily_log', 'work_mode', 'package13'], workModeCase],
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

const base = { title: 'p13 work time', content: 'p13 work time content', work_mode: 'onsite', visibility: 'private', date: '2026-09-15' };

async function workTimeCase(ctx: DailyLogTestCtx): Promise<string> {
  const wrong: string[] = [];
  const author = await ctx.userWith(['daily_logs.view', 'daily_logs.create']);
  const refused: Array<[string, string, string, number]> = [
    ['not a time', 'abc', '16:00', 400],
    ['hour 25', '25:00', '26:00', 400],
    ['end before start (overnight)', '22:00', '06:00', 422],
    ['end equal to start', '08:00', '08:00', 422],
  ];
  for (const [label, start, end, expected] of refused) {
    const res = await ctx.send(author, 'post', '/api/daily-logs', { ...base, start_time: start, end_time: end });
    if (res.status !== expected) wrong.push(`${label} answered ${res.status}, expected ${expected}`);
  }
  // Persian digits are read; 08:00 to 16:30 is 8.5 hours
  const ok = await ctx.send(author, 'post', '/api/daily-logs', { ...base, start_time: '۰۸:۰۰', end_time: '۱۶:۳۰' });
  if (ok.status !== 200) wrong.push(`a valid log answered ${ok.status}`);
  const id = Number(ok.body?.id ?? ok.body?.data?.id);
  if (ok.status === 200) {
    const read = await ctx.send(author, 'get', `/api/daily-logs/${id}`);
    const log = read.body?.data ?? read.body;
    if (Number(log?.work_hours) !== 8.5) wrong.push(`work_hours ${log?.work_hours}, expected 8.5`);
    // an edit that moves only the end before the stored start is refused, and the stored hours stay
    const edit = await ctx.send(author, 'put', `/api/daily-logs/${id}`, { end_time: '07:00' });
    if (edit.status !== 422) wrong.push(`edit with end before the stored start answered ${edit.status}`);
  }
  if (wrong.length > 0) throw new Error(wrong.join('; '));
  return 'invalid times 400, overnight and zero-length 422, Persian digits 08:00-16:30 = 8.5 h, edit end before start 422';
}

async function workModeCase(ctx: DailyLogTestCtx): Promise<string> {
  const wrong: string[] = [];
  const author = await ctx.userWith(['daily_logs.view', 'daily_logs.create']);
  const manager = await ctx.userWith(['daily_logs.view', 'daily_logs.manage_all']);
  for (const mode of ['leave', 'mission', 'hybrid']) {
    const res = await ctx.send(author, 'post', '/api/daily-logs', { ...base, work_mode: mode, start_time: '08:00', end_time: '16:00' });
    if (res.status !== 400) wrong.push(`work_mode ${mode} answered ${res.status}, expected 400`);
  }
  // legacy rows: one leave day of 8 hours and one onsite day of 6 hours
  await ctx.insertLog(author, { title: 'p13 legacy leave', date: '2026-09-15', dateIso: '2026-09-15', workMode: 'leave', workHours: 8 });
  await ctx.insertLog(author, { title: 'p13 onsite', date: '2026-09-15', dateIso: '2026-09-15', workMode: 'onsite', workHours: 6 });
  const summary = await ctx.send(manager, 'get', `/api/daily-logs/summary-report?report_type=daily&date=2026-09-15&user_id=${author.id}`);
  const row = (summary.body?.user_summaries ?? summary.body?.userSummaries ?? []).find((u: { userId: number }) => u.userId === author.id);
  if (summary.status !== 200 || !row) wrong.push(`summary answered ${summary.status} without the author`);
  else {
    if (row.onsiteCount !== 1) wrong.push(`onsiteCount ${row.onsiteCount}, expected 1 (leave is not onsite)`);
    if (row.otherCount !== 1) wrong.push(`otherCount ${row.otherCount}, expected 1`);
    if (row.totalHours !== 6) wrong.push(`totalHours ${row.totalHours}, expected 6 (leave hours are not work hours)`);
  }
  const stats = await ctx.send(author, 'get', '/api/daily-logs/stats');
  if (stats.body?.my_total_hours !== 6) wrong.push(`stats my_total_hours ${stats.body?.my_total_hours}, expected 6`);
  if (wrong.length > 0) throw new Error(wrong.join('; '));
  return 'leave, mission and hybrid 400; legacy leave: onsite 1, other 1, hours 6 in summary and statistics';
}
