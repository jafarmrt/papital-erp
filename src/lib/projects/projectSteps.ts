import { formatPersianNumber } from '../../utils/persianNumber';
import { storedReservationShortages } from './projectReservationState';
import type { ProjectWorkspaceTab } from './projectWorkspaceTabs';

/**
 * v10.2.1 (10.2 package 2, production projects review U4): the step bar at the top of a project page says where the
 * project stands and what comes next, in the order the guide teaches: the material list, «ثبت نهایی و رزرو», buying
 * the shortages, taking the materials from the warehouse, the progress matrix and «ورود به انبار». Each step opens
 * its own tab. The material list, the reservation and the progress come from the project record; the purchase
 * requisitions, the material allocations and the delivered quantities come from `GET /projects/:id/steps`, which
 * carries counts only, never an amount.
 */

/** the answer of `GET /projects/:id/steps` */
export interface ProjectStepCounts {
  /** live purchase requisitions of the project by stage (consolidated sources not counted) */
  requisitions: { open: number; ordered: number; received: number };
  /**
   * material taken for the project: its live allocations, still allocated or consumed (released ones not counted),
   * and its live final remittances and waste, which issue material to the project too (TD-233)
   */
  allocations: { open: number; consumed: number; issueDocuments: number };
  /** the project's products against its final production receipts */
  delivery: {
    products: number;
    completeProducts: number;
    delivered: number;
    planned: number;
    /** the one unit of every product, or null when the products are in different units */
    unit: string | null;
  };
}

export type ProjectStepState = 'done' | 'active' | 'attention' | 'todo';

export interface ProjectStep {
  key: 'materials' | 'reservation' | 'purchase' | 'allocation' | 'progress' | 'delivery';
  label: string;
  state: ProjectStepState;
  note: string;
  tab: ProjectWorkspaceTab;
}

interface StepProject {
  progress_percent?: number | null;
  inventory_control?: {
    isFinalized?: boolean;
    reservedItems?: unknown[];
    reservationShortages?: unknown[];
    sections?: Array<{ globalItems?: unknown[]; perItemResults?: Record<string, Record<string, unknown> | null | undefined> }>;
  } | null;
}

/** the material rows of the project's inventory control sections (global rows and rows per product) */
export function projectMaterialRowCount(project: StepProject): number {
  const sections = Array.isArray(project.inventory_control?.sections) ? project.inventory_control.sections : [];
  let rows = 0;
  for (const section of sections) {
    rows += Array.isArray(section?.globalItems) ? section.globalItems.length : 0;
    const perItem = section?.perItemResults && typeof section.perItemResults === 'object' ? section.perItemResults : {};
    for (const results of Object.values(perItem)) {
      if (results && typeof results === 'object') rows += Object.keys(results).length;
    }
  }
  return rows;
}

const n = (value: number): string => formatPersianNumber(value);

/** an answer of `GET /projects/:id/steps` with every count the bar reads; anything else is read as not yet known */
export function isProjectStepCounts(value: unknown): value is ProjectStepCounts {
  const v = value as ProjectStepCounts | null;
  return !!v && typeof v === 'object'
    && !!v.requisitions && typeof v.requisitions === 'object'
    && !!v.allocations && typeof v.allocations === 'object'
    && !!v.delivery && typeof v.delivery === 'object';
}

/** `readFailed`: the counts could not be read, so their steps say so instead of «در حال خواندن» for ever */
export function projectSteps(project: StepProject, answer: ProjectStepCounts | null, readFailed = false): ProjectStep[] {
  const counts = isProjectStepCounts(answer) ? answer : null;
  const materialRows = projectMaterialRowCount(project);
  const finalized = project.inventory_control?.isFinalized === true;
  const shortages = finalized ? storedReservationShortages(project.inventory_control).length : 0;
  const progress = Math.max(0, Math.min(100, Math.round(Number(project.progress_percent) || 0)));
  const unknown = readFailed ? 'خوانده نشد' : 'در حال خواندن';

  const materials: ProjectStep = materialRows > 0
    ? { key: 'materials', label: 'فهرست مواد', state: 'done', note: `${n(materialRows)} ردیف`, tab: 'materials' }
    : { key: 'materials', label: 'فهرست مواد', state: 'todo', note: 'هنوز ماده‌ای ثبت نشده', tab: 'materials' };

  const reservation: ProjectStep = !finalized
    ? { key: 'reservation', label: 'رزرو انبار', state: materialRows > 0 ? 'active' : 'todo', note: 'ثبت نهایی نشده', tab: 'materials' }
    : shortages > 0
      ? { key: 'reservation', label: 'رزرو انبار', state: 'attention', note: `${n(shortages)} قلم کمبود`, tab: 'materials' }
      : { key: 'reservation', label: 'رزرو انبار', state: 'done', note: 'همه رزرو شد', tab: 'materials' };

  let purchase: ProjectStep;
  if (!counts) {
    purchase = { key: 'purchase', label: 'خرید کسری', state: 'todo', note: unknown, tab: 'materials' };
  } else {
    const { open, ordered, received } = counts.requisitions;
    const inFlight = open + ordered;
    if (inFlight > 0) {
      purchase = { key: 'purchase', label: 'خرید کسری', state: 'active', note: `${n(inFlight)} درخواست در جریان`, tab: 'materials' };
    } else if (shortages > 0) {
      purchase = { key: 'purchase', label: 'خرید کسری', state: 'attention', note: received > 0 ? `${n(shortages)} کمبود مانده` : 'درخواست خرید ثبت نشده', tab: 'materials' };
    } else if (received > 0) {
      purchase = { key: 'purchase', label: 'خرید کسری', state: 'done', note: `${n(received)} درخواست رسید`, tab: 'materials' };
    } else {
      purchase = { key: 'purchase', label: 'خرید کسری', state: finalized ? 'done' : 'todo', note: finalized ? 'کسری ندارد' : 'پس از رزرو', tab: 'materials' };
    }
  }

  let allocation: ProjectStep;
  if (!counts) {
    allocation = { key: 'allocation', label: 'مواد گرفته‌شده', state: 'todo', note: unknown, tab: 'materials' };
  } else {
    const allocated = counts.allocations.open + counts.allocations.consumed;
    const issued = Number(counts.allocations.issueDocuments) || 0;
    const parts = [allocated > 0 ? `${n(allocated)} تخصیص` : '', issued > 0 ? `${n(issued)} حواله` : ''].filter(Boolean);
    allocation = parts.length > 0
      ? { key: 'allocation', label: 'مواد گرفته‌شده', state: 'done', note: `${parts.join(' و ')} از انبار`, tab: 'materials' }
      : { key: 'allocation', label: 'مواد گرفته‌شده', state: finalized ? 'active' : 'todo', note: 'هنوز از انبار گرفته نشده', tab: 'materials' };
  }

  const progressStep: ProjectStep = {
    key: 'progress', label: 'پیشرفت', tab: 'progress', note: `${n(progress)}٪`,
    state: progress >= 100 ? 'done' : progress > 0 ? 'active' : 'todo',
  };

  let delivery: ProjectStep;
  if (!counts) {
    delivery = { key: 'delivery', label: 'ورود به انبار', state: 'todo', note: unknown, tab: 'delivery' };
  } else {
    const d = counts.delivery;
    const note = d.unit !== null && d.planned > 0
      ? `${n(d.delivered)} از ${n(d.planned)} ${d.unit}`
      : `${n(d.completeProducts)} از ${n(d.products)} محصول`;
    const complete = d.products > 0 && d.completeProducts >= d.products;
    delivery = { key: 'delivery', label: 'ورود به انبار', tab: 'delivery', note, state: complete ? 'done' : d.delivered > 0 ? 'active' : 'todo' };
  }

  return [materials, reservation, purchase, allocation, progressStep, delivery];
}

/** a cancelled or paused project's step bar is muted with this note (review L3); an open project has none */
export function projectInactiveNote(status: string | null | undefined): string | null {
  if (status === 'cancelled') return 'این پروژه لغو شده است؛ گام‌ها فقط برای دیدن است.';
  if (status === 'paused') return 'این پروژه متوقف است؛ گام‌ها تا ادامه پروژه پیش نمی‌روند.';
  return null;
}
