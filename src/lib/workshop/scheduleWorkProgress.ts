import type { WorkshopScheduleRow } from './workshopSchedule';

/**
 * 10.2 package 12, item 3 (D6, owner decision ت۴۲ الف): the done work of a project's workshop schedule rows, shared by
 * the progress matrix (a cell of item × stage), the stage progress of the workshop panel and the browser.
 *
 * A row's done quantity is the quantity of its live work log (a workshop report approved by a project manager, or a log
 * the project recorded from the schedule tab), at most the row's planned quantity; a row marked logged before v9.0.282
 * without a log id counts as done in full. Rows of one unit add up («۶۰ از ۱۰۰ عدد»); rows of several units give each
 * unit its share and the shares are averaged, since hours and pieces never add up. A row without a planned quantity
 * above zero counts nothing. The «تمام» tick stays the project manager's own (decision ت۶ الف).
 */

/** The schedule key of a project that has no product rows: its main item (`ProjectScheduleTab`, `ProjectOverviewTab`). */
export const MAIN_PRODUCT_SCHEDULE_ID = 'prod-main';

export interface ScheduleWorkRow {
  unit: string;
  planned: number;
  done: number;
}

export interface WorkProgress {
  /** planned quantity of the rows, or null when their units differ (hours and pieces never add up; review N4) */
  planned: number | null;
  /** done quantity of the rows, each capped at its planned quantity, or null when their units differ */
  done: number | null;
  /** the rows' one unit, or null when their units differ */
  unit: string | null;
  /** 0 to 1: done ÷ planned for one unit, else the average share of the units */
  share: number;
}

const unitKey = (unit: string) => unit.trim() || 'عدد';

/** The work of a set of rows, or null when none has a planned quantity above zero. */
export function workProgressOf(rows: readonly ScheduleWorkRow[]): WorkProgress | null {
  const byUnit = new Map<string, { planned: number; done: number }>();
  for (const row of rows) {
    const planned = Number(row.planned);
    if (!Number.isFinite(planned) || planned <= 0) continue;
    const done = Math.min(planned, Math.max(0, Number(row.done) || 0));
    const key = unitKey(row.unit);
    const group = byUnit.get(key) ?? { planned: 0, done: 0 };
    group.planned += planned;
    group.done += done;
    byUnit.set(key, group);
  }
  if (byUnit.size === 0) return null;
  const groups = [...byUnit.entries()];
  const share = groups.reduce((acc, [, g]) => acc + g.done / g.planned, 0) / groups.length;
  if (groups.length === 1) {
    const [[unit, g]] = groups;
    return { planned: g.planned, done: g.done, unit, share };
  }
  return { planned: null, done: null, unit: null, share };
}

/**
 * A share as a whole percent: 100 only when every row is done, so an almost finished stage never reads «۱۰۰٪», and at
 * least 1 for any work, so a started stage never reads «۰٪» (review N2: 4 of 1000 is 1%, not 0%).
 */
export function workPercent(share: number): number {
  if (!(share > 0)) return 0;
  if (share >= 1) return 100;
  return Math.min(99, Math.max(1, Math.round(share * 100)));
}

/** The done quantity of one schedule row: its live log's quantity (`liveQuantities`, log id → quantity) or a legacy flag. */
export function scheduleRowDoneQuantity(
  row: Pick<WorkshopScheduleRow, 'quantity' | 'pieceworkLogId' | 'legacyLogged'>,
  liveQuantities: ReadonlyMap<number, number>,
): number {
  if (row.pieceworkLogId !== null && liveQuantities.has(row.pieceworkLogId)) return liveQuantities.get(row.pieceworkLogId) ?? 0;
  return row.legacyLogged ? row.quantity : 0;
}

/**
 * The warehouse item a schedule product key stands for: the project's product row of that id, else, for a project
 * without product rows, its main item under `MAIN_PRODUCT_SCHEDULE_ID`; null otherwise.
 */
export function scheduleProductItemId(products: unknown, mainItemId: unknown, productId: string): number | null {
  const list = Array.isArray(products) ? products : [];
  const positive = (v: unknown): number | null => {
    const n = Number(v);
    return v !== null && v !== '' && Number.isInteger(n) && n > 0 ? n : null;
  };
  if (list.length > 0) {
    const found = list.find((p: { id?: unknown }) => String(p?.id) === productId) as { item_id?: unknown; itemId?: unknown } | undefined;
    return positive(found?.item_id ?? found?.itemId);
  }
  return productId === MAIN_PRODUCT_SCHEDULE_ID ? positive(mainItemId) : null;
}
