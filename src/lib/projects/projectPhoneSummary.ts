import { formatPersianNumber } from '../../utils/persianNumber';
import type { ProjectStep } from './projectSteps';

/**
 * v10.2.7 (10.2 package 10, production projects review «ث»): what the phone summary of a project says beside the
 * desktop summary tab: how far the delivery date is and which steps still wait. Both read what the page already has,
 * the project record and the step bar's steps; nothing new is asked of the server.
 */

export interface ProjectDueNote {
  text: string;
  /** the date has passed and the project is still open */
  late: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDayNumber(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return null;
  const value = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(value) ? Math.round(value / DAY_MS) : null;
}

/**
 * the days left to the delivery date (ISO), from today in the business time zone (ISO); a completed or cancelled
 * project, or one without a readable date, has no note
 */
export function projectDueNote(endDate: string | null | undefined, todayIso: string, status: string | null | undefined): ProjectDueNote | null {
  if (status === 'completed' || status === 'cancelled') return null;
  const end = isoDayNumber(String(endDate ?? ''));
  const today = isoDayNumber(todayIso);
  if (end === null || today === null) return null;
  const days = end - today;
  if (days > 0) return { text: `${formatPersianNumber(days)} روز مانده`, late: false };
  if (days === 0) return { text: 'موعد تحویل امروز است', late: false };
  return { text: `${formatPersianNumber(-days)} روز از موعد گذشته`, late: true };
}

/** the steps not yet done, those that need attention first, each keeping its order otherwise */
export function pendingProjectSteps(steps: readonly ProjectStep[]): ProjectStep[] {
  const open = steps.filter(step => step.state !== 'done');
  return [...open.filter(step => step.state === 'attention'), ...open.filter(step => step.state !== 'attention')];
}
