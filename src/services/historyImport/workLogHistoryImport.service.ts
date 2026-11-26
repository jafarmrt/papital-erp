import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { personnel, pieceworkLogs, pieceworkPayrolls } from '../../db/schema.js';
import { fin, type DecimalValue, type FinancialDecimal } from '../../lib/financialDecimal.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { serviceEndOf } from '../../lib/payroll/payrollPeriod.js';
import { parsePieceworkRate } from '../../lib/piecework/pieceworkRate.js';
import { parseWorkQuantity } from '../../lib/piecework/workQuantity.js';
import {
  workLogImportDate, workLogImportDuplicateKey, workLogMonthBounds,
  type WorkLogImportResult, type WorkLogImportRow, type WorkLogImportRowOutcome, type WorkLogImportTotal,
} from '../../lib/historyImport/workLogImport.js';
import { toStorageDate } from '../../utils/calendarDate.js';
import { formatPersianNumber, isoToJalaliDate, toPersianDigits } from '../../utils.js';
import { PieceworkService } from '../piecework.service.js';
import { runImportRows } from './importRunner.js';

/**
 * v12 work-log import (start plan V12_WORKLOG_IMPORT_START_PLAN.md): the work of colleagues from the sheet «کارکرد و پروژه»
 * at once, for the 1405 history and later for any month. Each row goes through `PieceworkService.logWorkEntries`, the
 * service of the hand entry, so it gets the same checks (live colleague, task and project, a project not cancelled, no day
 * after the colleague's service end), the same «pending» status that the month's payslip takes, and its own audit row. The
 * row is dated on the last day of its month (owner's decision, 5 Azar 1405), and its rate is the sheet's «فی», so the
 * payslip reads as the Excel does; another rate than the program's is only a warning. A colleague who already has a
 * payslip for the month gets none of its rows (the payslip would never take them). A row like one already in the file or in
 * the books waits for the user. A preview runs everything and keeps nothing; a post keeps everything or nothing.
 */

export interface WorkLogImportOptions {
  commit: boolean;
  userId?: number;
  username?: string;
  req?: unknown;
  /** the user holds «مدیریت عناوین کاری و نرخ‌های پایه» (`piecework.manage_tasks`), which a hand entry needs for a manual rate */
  canSetRate: boolean;
}

interface PreparedRow {
  row: WorkLogImportRow;
  outcome: WorkLogImportRowOutcome;
  quantity: number;
  rate: string;
  excelTotal: string | null;
  bounds: { firstDay: string; lastDay: string } | null;
}

const faDate = (iso: string) => toPersianDigits(isoToJalaliDate(iso));
const faAmount = (v: DecimalValue) => `${formatPersianNumber(fin(v).round(0).toNumber())} ریال`;
const quantityKey = (q: DecimalValue) => fin(q).round(4).toString();
const rateKey = (r: DecimalValue) => fin(r).round(4).toString();

/** Reads each row's month, quantity, rate and Excel total; a row that cannot be read is an error and goes no further. */
function prepare(rows: WorkLogImportRow[]): PreparedRow[] {
  return rows.map(row => {
    const outcome: WorkLogImportRowOutcome = { rowNo: row.rowNo, status: 'ok' };
    const fail = (message: string): PreparedRow => {
      outcome.status = 'error';
      outcome.message = message;
      return { row, outcome, quantity: 0, rate: '0', excelTotal: null, bounds: null };
    };
    const bounds = workLogMonthBounds(row.month);
    if (!bounds) return fail('ماه ردیف خوانده نشد.');
    const quantity = parseWorkQuantity(row.quantity, 'تعداد یا ساعت ردیف');
    if (!quantity.ok) return fail(quantity.message);
    const rate = parsePieceworkRate(row.unitRate, 'فی ردیف');
    if (!rate.ok) return fail(rate.message);
    if (rate.value === undefined) return fail('فی ردیف خالی است؛ نرخ کار را در ستون «فی» بنویسید.');
    const total = parsePieceworkRate(row.excelTotal, 'جمع ردیف');
    if (!total.ok) return fail(total.message);
    return { row, outcome, quantity: quantity.value, rate: rate.value, excelTotal: total.value ?? null, bounds };
  });
}

/** The live colleagues of the rows, locked `FOR SHARE` in id order (before the payslips are read, as a payslip issue locks them). */
async function lockColleagues(tx: DbExecutor, ids: number[]) {
  if (ids.length === 0) return new Map<number, { fullName: string; serviceEnd: string | null }>();
  const rows = await tx.select({ id: personnel.id, fullName: personnel.fullName, employmentStatus: personnel.employmentStatus, endDate: personnel.endDate })
    .from(personnel).where(and(inArray(personnel.id, ids), eq(personnel.isDeleted, 0))).orderBy(asc(personnel.id)).for('share');
  const map = new Map<number, { fullName: string; serviceEnd: string | null }>();
  for (const r of rows) {
    const end = serviceEndOf(r);
    map.set(r.id, { fullName: r.fullName ?? '', serviceEnd: end.kind === 'ended' ? end.endIso : null });
  }
  return map;
}

/** The live regular payslips of these colleagues (an eidi or prepayment payslip takes no work), with their period. */
async function payslipsOf(tx: DbExecutor, ids: number[]) {
  if (ids.length === 0) return [];
  const rows = await tx.select({
    personnelId: pieceworkPayrolls.personnelId, payrollNumber: pieceworkPayrolls.payrollNumber,
    startDate: pieceworkPayrolls.startDate, endDate: pieceworkPayrolls.endDate,
  }).from(pieceworkPayrolls)
    .where(and(inArray(pieceworkPayrolls.personnelId, ids), eq(pieceworkPayrolls.isDeleted, 0), eq(pieceworkPayrolls.isEidi, 0), eq(pieceworkPayrolls.isPrepayment, 0)));
  return rows.map(r => ({ personnelId: r.personnelId, payrollNumber: r.payrollNumber, start: toStorageDate(r.startDate) || '', end: toStorageDate(r.endDate) || '' }));
}

/** Live work logs of these colleagues on these days, as duplicate keys. */
async function bookedKeys(tx: DbExecutor, ids: number[], days: string[]): Promise<Set<string>> {
  const keys = new Set<string>();
  if (ids.length === 0 || days.length === 0) return keys;
  const rows = await tx.select({
    personnelId: pieceworkLogs.personnelId, taskId: pieceworkLogs.taskId, projectId: pieceworkLogs.projectId,
    date: pieceworkLogs.date, quantity: pieceworkLogs.quantity, unitRate: pieceworkLogs.unitRate,
  }).from(pieceworkLogs)
    .where(and(inArray(pieceworkLogs.personnelId, ids), inArray(pieceworkLogs.date, days), eq(pieceworkLogs.isDeleted, 0)));
  for (const r of rows) {
    keys.add(workLogImportDuplicateKey({ personnelId: r.personnelId, taskId: r.taskId, projectId: r.projectId ?? null, date: r.date, quantity: quantityKey(r.quantity), unitRate: rateKey(r.unitRate) }));
  }
  return keys;
}

/** Each colleague's live work logs per Jalali month already in the books, on any day of the month (count and amount). */
async function bookedMonthTotals(tx: DbExecutor, prepared: readonly PreparedRow[]): Promise<Map<string, { rows: number; amount: FinancialDecimal }>> {
  const totals = new Map<string, { rows: number; amount: FinancialDecimal }>();
  const months = new Map<string, { firstDay: string; lastDay: string; ids: Set<number> }>();
  for (const p of prepared) {
    if (!p.bounds) continue;
    const m = months.get(p.row.month) ?? { ...p.bounds, ids: new Set<number>() };
    m.ids.add(p.row.personnelId);
    months.set(p.row.month, m);
  }
  for (const [month, m] of months) {
    const rows = await tx.select({ personnelId: pieceworkLogs.personnelId, totalAmount: pieceworkLogs.totalAmount }).from(pieceworkLogs)
      .where(and(inArray(pieceworkLogs.personnelId, [...m.ids]), gte(pieceworkLogs.date, m.firstDay), lte(pieceworkLogs.date, m.lastDay), eq(pieceworkLogs.isDeleted, 0)));
    for (const r of rows) {
      const key = `${r.personnelId}|${month}`;
      const t = totals.get(key) ?? { rows: 0, amount: fin(0) };
      t.rows += 1;
      t.amount = t.amount.add(r.totalAmount);
      totals.set(key, t);
    }
  }
  return totals;
}

export async function importWorkLogHistory(rows: WorkLogImportRow[], options: WorkLogImportOptions): Promise<WorkLogImportResult> {
  const prepared = prepare(rows);
  const readable = prepared.filter(p => p.outcome.status === 'ok');
  const today = await businessTodayIsoDate();
  let totals: WorkLogImportTotal[] = [];

  await runImportRows({ commit: options.commit, closable: false }, async (tx, attempt) => {
    // every pass starts again from what the rows say (the post runs as a preview first)
    for (const p of readable) { p.outcome = { rowNo: p.row.rowNo, status: 'ok' }; }
    const ids = [...new Set(readable.map(p => p.row.personnelId))].sort((a, b) => a - b);
    const colleagues = await lockColleagues(tx, ids);
    const payslips = await payslipsOf(tx, ids);
    for (const p of readable) {
      p.outcome.date = workLogImportDate(p.row.month, colleagues.get(p.row.personnelId)?.serviceEnd ?? null) ?? undefined;
    }
    const booked = await bookedKeys(tx, ids, [...new Set(readable.map(p => p.outcome.date).filter((d): d is string => !!d))]);
    // read before any row of this pass is written, so the month's hand-entered work is told apart from the import's own
    const bookedMonths = await bookedMonthTotals(tx, readable);
    const serverRates = new Map<string, FinancialDecimal>();
    const inFile = new Map<string, number>();
    const sums = new Map<string, WorkLogImportTotal & { sum: FinancialDecimal }>();

    for (const p of readable) {
      const { row, outcome, bounds } = p;
      const date = outcome.date as string;
      const amount = fin(p.quantity).multiply(p.rate);
      outcome.amount = amount.round(4).toString();
      const warnings: string[] = [];

      const slip = bounds ? payslips.find(s => s.personnelId === row.personnelId && s.start && s.end && s.start <= bounds.lastDay && s.end >= bounds.firstDay) : undefined;
      if (slip) {
        outcome.status = 'error';
        outcome.message = `این همکار فیش حقوق ${slip.payrollNumber} (${faDate(slip.start)} تا ${faDate(slip.end)}) دارد که دوره‌اش با این ماه هم‌پوشانی دارد؛ ردیف‌های این ماه با این ابزار وارد نمی‌شوند، چون فیش صادرشده کارکرد تازهٔ دوره‌اش را نمی‌گیرد. اگر کارکرد آن ماه کم است، فیش را باطل کنید، کارکرد را وارد کنید و فیش را دوباره صادر کنید.`;
        continue;
      }

      const key = workLogImportDuplicateKey({ personnelId: row.personnelId, taskId: row.taskId, projectId: row.projectId, date, quantity: quantityKey(p.quantity), unitRate: rateKey(p.rate) });
      const seen = inFile.get(key);
      inFile.set(key, row.rowNo);
      if (!row.duplicateAccepted && (seen !== undefined || booked.has(key))) {
        outcome.status = 'duplicate';
        outcome.message = seen !== undefined
          ? `این ردیف با ردیف ${toPersianDigits(String(seen))} همین پرونده یکی است (همان همکار، کار، پروژه، ماه، مقدار و فی).`
          : `کارکردی با همین همکار، کار، پروژه، روز (${faDate(date)})، مقدار و فی پیش‌تر در برنامه ثبت شده است.`;
        continue;
      }

      const pair = `${row.personnelId}|${row.taskId}`;
      let programRate = serverRates.get(pair);
      if (!programRate) {
        programRate = fin(await PieceworkService.serverRate(tx, row.personnelId, row.taskId));
        serverRates.set(pair, programRate);
      }
      const sameRate = programRate.equals(fin(p.rate));
      if (!sameRate) {
        if (!options.canSetRate) {
          outcome.status = 'error';
          outcome.message = `فی این ردیف (${faAmount(p.rate)}) با نرخ برنامه برای این همکار و کار (${faAmount(programRate)}) فرق دارد؛ ثبت نرخ دستی مجوز «مدیریت عناوین کاری و نرخ‌های پایه» را می‌خواهد، مثل فرم کارکرد.`;
          continue;
        }
        warnings.push(`فی اکسل (${faAmount(p.rate)}) با نرخ کنونی برنامه (${faAmount(programRate)}) فرق دارد؛ فی اکسل ثبت می‌شود.`);
      }
      if (p.excelTotal !== null && amount.subtract(p.excelTotal).abs().greaterThan(1)) {
        warnings.push(`جمع اکسل (${faAmount(p.excelTotal)}) با مقدار × فی (${faAmount(amount)}) نمی‌خواند؛ مقدار × فی ثبت می‌شود.`);
      }
      if (bounds && date !== bounds.lastDay) warnings.push(`همکاری این همکار ${faDate(date)} تمام شده است؛ ردیف در همان روز ثبت می‌شود.`);
      if (date > today) warnings.push(`روز ثبت (${faDate(date)}) پس از امروز است؛ فیش این ماه پس از پایان ماه صادر می‌شود.`);

      const result = await attempt(sp => PieceworkService.logWorkEntries([{
        personnelId: row.personnelId,
        taskId: row.taskId,
        projectId: row.projectId,
        date,
        quantity: p.quantity,
        // always the sheet's rate: without the rates key it is the program's rate read above (another one was refused), so a
        // rate changed meanwhile cannot slip in under the preview's figures
        unitRate: p.rate,
        notes: (row.notes ?? '').trim(),
        createdById: options.userId,
        createdByUsername: options.username,
      }], sp, { req: options.req, userId: options.userId, username: options.username }));
      if (!result.ok) {
        outcome.status = 'error';
        outcome.message = result.message;
        continue;
      }
      if (warnings.length > 0) outcome.warnings = warnings;
      const totalKey = `${row.personnelId}|${row.month}`;
      const before = bookedMonths.get(totalKey);
      const t = sums.get(totalKey) ?? {
        personnelId: row.personnelId, month: row.month, rows: 0, amount: '0', sum: fin(0),
        bookedRows: before?.rows ?? 0, bookedAmount: (before?.amount ?? fin(0)).round(4).toString(),
      };
      t.rows += 1;
      t.sum = t.sum.add(amount);
      sums.set(totalKey, t);
    }
    totals = [...sums.values()]
      .map(({ sum, ...t }) => ({ ...t, amount: sum.round(4).toString() }))
      .sort((a, b) => (a.month === b.month ? a.personnelId - b.personnelId : a.month < b.month ? -1 : 1));
    return prepared.every(p => p.outcome.status === 'ok');
  });

  const outcomes = prepared.map(p => p.outcome).sort((a, b) => a.rowNo - b.rowNo);
  const count = (s: string) => outcomes.filter(o => o.status === s).length;
  const okCount = count('ok');
  return {
    committed: options.commit && okCount === outcomes.length,
    rows: outcomes,
    totals,
    okCount,
    errorCount: count('error'),
    duplicateCount: count('duplicate'),
  };
}
