import { toEnglishDigits } from '../../utils/persianNumber.js';
import { amountText, headerKey } from './treasurySheet.js';
import { workLogMonthKey, type WorkLogImportRow } from './workLogImport.js';

/**
 * v12 work-log import: reading the sheet «کارکرد و پروژه» and turning each row, through the names the user mapped once, into
 * a row the server takes. Pure functions shared by the import window and its tests.
 *
 * Columns (found by their header, so their order and extra columns do not matter): ردیف «حقوق» اکسل اصلی · ماه · همکار ·
 * شرح فعالیت · تعداد · ساعت (اعشاری) · فی · جمع · توضیحات · پروژه · پروژه از کجا آمد. The sheet has no day, only the month.
 */

export interface ParsedWorkLogRow {
  rowNo: number;
  /** «ردیف حقوق» of the original Excel */
  sourceRow: string;
  monthText: string;
  personName: string;
  activity: string;
  count: string;
  hours: string;
  rate: string;
  total: string;
  notes: string;
  projectName: string;
}

const HEADERS = {
  month: 'ماه',
  person: 'همکار',
  activity: 'شرح فعالیت',
  count: 'تعداد',
  rate: 'فی',
  total: 'جمع',
  notes: 'توضیحات',
  project: 'پروژه',
} as const;

const cellText = (value: unknown): string => (value === null || value === undefined ? '' : String(value).trim());

/** A name compared without spaces, ZWNJ or the Arabic forms of «ی» and «ک» (the same rule as the sheet headers). */
export const nameKey = headerKey;

/**
 * A number cell as plain decimal text: a number keeps every digit Excel holds, only the float noise of its last places is
 * dropped (1.3333333333 hours stays as it is, so quantity × rate is the sheet's «جمع»; 0.30000000000000004 is 0.3), a text
 * keeps its digits without thousands separators; anything else stays as written so the server names the row. Twelve
 * significant digits cover any rate, quantity or row total of the sheet; a tiny number written with an exponent is refused
 * by the server with the row's number.
 */
export function numberText(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    return String(Number(value.toPrecision(12)));
  }
  return amountText(value);
}

export function detectWorkLogSheet(header: readonly unknown[]): boolean {
  const keys = header.map(headerKey);
  const has = (h: string) => keys.includes(headerKey(h));
  return has(HEADERS.month) && has(HEADERS.person) && has(HEADERS.activity) && has(HEADERS.rate) && has(HEADERS.project);
}

/** The rows of the sheet (the first row is the header); a row with no colleague and no activity is left out. */
export function parseWorkLogSheet(rows: readonly (readonly unknown[])[]): ParsedWorkLogRow[] {
  const header = rows[0] ?? [];
  if (!detectWorkLogSheet(header)) return [];
  const keys = header.map(headerKey);
  const col = (h: string) => keys.indexOf(headerKey(h));
  // «ساعت (اعشاری)» and «ردیف «حقوق» اکسل اصلی» are found by the words they start with
  const hoursCol = keys.findIndex(k => k.startsWith('ساعت'));
  const sourceCol = keys.findIndex(k => k.startsWith('ردیف') && k.includes('حقوق'));
  const at = (row: readonly unknown[], i: number) => (i < 0 ? '' : row[i]);
  const parsed: ParsedWorkLogRow[] = [];
  rows.slice(1).forEach((row, i) => {
    const out: ParsedWorkLogRow = {
      rowNo: i + 2,
      sourceRow: toEnglishDigits(cellText(at(row, sourceCol))),
      monthText: toEnglishDigits(cellText(at(row, col(HEADERS.month)))),
      personName: cellText(at(row, col(HEADERS.person))),
      activity: cellText(at(row, col(HEADERS.activity))),
      count: numberText(at(row, col(HEADERS.count))),
      hours: numberText(at(row, hoursCol)),
      rate: numberText(at(row, col(HEADERS.rate))),
      total: numberText(at(row, col(HEADERS.total))),
      notes: cellText(at(row, col(HEADERS.notes))),
      projectName: cellText(at(row, col(HEADERS.project))),
    };
    if (out.personName || out.activity) parsed.push(out);
  });
  return parsed;
}

const MONTH_NAMES = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

/** «ماه» of a row (`2`, `1405-02`, `1405/2` or «اردیبهشت») as `YYYY-MM`, the year taken from the window when the cell has none. */
export function monthOfRow(monthText: string, year: number): string {
  const text = toEnglishDigits(monthText).trim();
  const full = /^(\d{4})[-/](\d{1,2})$/.exec(text);
  if (full) return workLogMonthKey(Number(full[1]), Number(full[2]));
  if (/^\d{1,2}$/.test(text)) return workLogMonthKey(year, Number(text));
  const named = MONTH_NAMES.findIndex(n => nameKey(n) === nameKey(text));
  return named >= 0 ? workLogMonthKey(year, named + 1) : '';
}

const isZeroOrEmpty = (text: string) => !text || /^0+(\.0+)?$/.test(text);

/**
 * A row that is not work: its project says so («— (حقوق ثابت …)», «— (عیدی ۱۴۰۴ …)»; these come with the fixed-salary or
 * eidi payslip), or it carries no amount at all. Such rows are left out and listed with the reason.
 */
export function workLogSkipReason(row: ParsedWorkLogRow): string | null {
  const project = row.projectName.trim();
  if (/^[—–-]/.test(project)) return `کارکرد نیست (${project.replace(/^[—–-]\s*/, '')})`;
  if (isZeroOrEmpty(row.total) && (isZeroOrEmpty(row.rate) || (isZeroOrEmpty(row.count) && isZeroOrEmpty(row.hours)))) return 'ردیف بی‌مبلغ';
  return null;
}

/** «بدون پروژه (عمومی و مشترک)» and the like: work of the workshop as a whole */
export const isNoProjectName = (name: string): boolean => nameKey(name).startsWith(nameKey('بدون پروژه'));

export type ProjectTarget = { kind: 'project'; projectId: number } | { kind: 'none' };

/** The names mapped once: colleague → personnel, activity → task title, project → production project (or none). */
export interface WorkLogImportMapping {
  personnel: Record<string, number>;
  tasks: Record<string, number>;
  projects: Record<string, ProjectTarget>;
}

export const emptyWorkLogMapping = (): WorkLogImportMapping => ({ personnel: {}, tasks: {}, projects: {} });

export interface WorkLogLookups {
  personnel: ReadonlyArray<{ id: number; fullName: string }>;
  tasks: ReadonlyArray<{ id: number; title: string; unit?: string }>;
  projects: ReadonlyArray<{ id: number; title: string; projectCode?: string }>;
}

/**
 * Names the app already knows are offered at once: the same colleague name, a task title that is the activity or starts
 * with it and a bracket («آموزش» → «آموزش (هرجلسه)», only when one title fits), a project with the same title or code, and
 * «بدون پروژه …» as none. A name the user mapped before keeps its mapping.
 */
export function suggestWorkLogMapping(rows: readonly ParsedWorkLogRow[], mapping: WorkLogImportMapping, lookups: WorkLogLookups): WorkLogImportMapping {
  const next: WorkLogImportMapping = { personnel: { ...mapping.personnel }, tasks: { ...mapping.tasks }, projects: { ...mapping.projects } };
  for (const r of rows) {
    if (r.personName && next.personnel[r.personName] === undefined) {
      const found = lookups.personnel.filter(p => nameKey(p.fullName) === nameKey(r.personName));
      if (found.length === 1) next.personnel[r.personName] = found[0].id;
    }
    if (r.activity && next.tasks[r.activity] === undefined) {
      const key = nameKey(r.activity);
      const exact = lookups.tasks.filter(t => nameKey(t.title) === key);
      const prefixed = lookups.tasks.filter(t => nameKey(t.title).startsWith(`${key}(`));
      const pick = exact.length === 1 ? exact : exact.length === 0 && prefixed.length === 1 ? prefixed : [];
      if (pick.length === 1) next.tasks[r.activity] = pick[0].id;
    }
    const project = r.projectName.trim();
    if (project && !workLogSkipReason(r) && next.projects[project] === undefined) {
      if (isNoProjectName(project)) next.projects[project] = { kind: 'none' };
      else {
        const found = lookups.projects.filter(p => nameKey(p.title) === nameKey(project) || (!!p.projectCode && nameKey(p.projectCode) === nameKey(project)));
        if (found.length === 1) next.projects[project] = { kind: 'project', projectId: found[0].id };
      }
    }
  }
  return next;
}

/** The names of the work rows that still need a mapping, each kind once. */
export function unmappedWorkLogNames(rows: readonly ParsedWorkLogRow[], mapping: WorkLogImportMapping) {
  const personnel = new Set<string>();
  const tasks = new Set<string>();
  const projects = new Set<string>();
  for (const r of rows) {
    if (workLogSkipReason(r)) continue;
    if (r.personName && mapping.personnel[r.personName] === undefined) personnel.add(r.personName);
    if (r.activity && mapping.tasks[r.activity] === undefined) tasks.add(r.activity);
    const project = r.projectName.trim();
    if (project && mapping.projects[project] === undefined) projects.add(project);
  }
  return { personnel: [...personnel], tasks: [...tasks], projects: [...projects] };
}

export type ResolvedWorkLogRow =
  | { status: 'ready'; parsed: ParsedWorkLogRow; row: WorkLogImportRow; personName: string }
  | { status: 'skipped'; parsed: ParsedWorkLogRow; reason: string }
  | { status: 'unresolved'; parsed: ParsedWorkLogRow; reason: string };

/** The key of a row in the user's choices (an accepted duplicate) */
export const workLogRowKey = (parsed: Pick<ParsedWorkLogRow, 'rowNo'>): string => `row#${parsed.rowNo}`;

/** The notes a row is recorded with: the sheet's «توضیحات» and the row of the original payroll Excel. */
export function workLogImportNotes(parsed: Pick<ParsedWorkLogRow, 'notes' | 'sourceRow'>): string {
  const parts = [parsed.notes.trim()];
  if (parsed.sourceRow.trim()) parts.push(`(ورود از اکسل، ردیف حقوق ${parsed.sourceRow.trim()})`);
  else parts.push('(ورود از اکسل)');
  return parts.filter(Boolean).join(' ');
}

/**
 * One parsed row → the row the server takes, or why it is left out or waits for a name. An hourly task (unit «ساعت») takes
 * «ساعت (اعشاری)», any other «تعداد»; when that cell is empty the other one is used.
 */
export function resolveWorkLogRow(
  parsed: ParsedWorkLogRow,
  mapping: WorkLogImportMapping,
  options: { year: number; lookups: Pick<WorkLogLookups, 'tasks'>; accepted?: ReadonlySet<string> },
): ResolvedWorkLogRow {
  const skip = workLogSkipReason(parsed);
  if (skip) return { status: 'skipped', parsed, reason: skip };
  const month = monthOfRow(parsed.monthText, options.year);
  if (!month) return { status: 'unresolved', parsed, reason: `ماه «${parsed.monthText || 'خالی'}» خوانده نشد.` };
  const personnelId = mapping.personnel[parsed.personName];
  if (!personnelId) return { status: 'unresolved', parsed, reason: `همکار «${parsed.personName || 'خالی'}» نگاشت نشده است.` };
  const taskId = mapping.tasks[parsed.activity];
  if (!taskId) return { status: 'unresolved', parsed, reason: `شرح فعالیت «${parsed.activity || 'خالی'}» به عنوان کاری نگاشت نشده است.` };
  const projectName = parsed.projectName.trim();
  const target = projectName ? mapping.projects[projectName] : ({ kind: 'none' } as ProjectTarget);
  if (!target) return { status: 'unresolved', parsed, reason: `پروژهٔ «${projectName}» نگاشت نشده است.` };
  const hourly = options.lookups.tasks.find(t => t.id === taskId)?.unit === 'ساعت';
  const preferred = hourly ? parsed.hours : parsed.count;
  const quantity = isZeroOrEmpty(preferred) ? (hourly ? parsed.count : parsed.hours) : preferred;
  return {
    status: 'ready',
    parsed,
    personName: parsed.personName,
    row: {
      rowNo: parsed.rowNo,
      month,
      personnelId,
      taskId,
      projectId: target.kind === 'project' ? target.projectId : null,
      quantity,
      unitRate: parsed.rate,
      excelTotal: parsed.total || undefined,
      notes: workLogImportNotes(parsed),
      duplicateAccepted: options.accepted?.has(workLogRowKey(parsed)) || undefined,
    },
  };
}
