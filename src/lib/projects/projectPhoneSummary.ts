import { formatPersianNumber } from '../../utils/persianNumber';
import { toStorageDate } from '../../utils/calendarDate';
import { daysUntilDeadline } from '../workshop/workshopSchedule';
import type { ProjectStep } from './projectSteps';

/**
 * v10.2.9 (10.2 package 10, production projects review «ث»): what the phone summary of a project says beside the
 * desktop summary tab: how far the delivery date is and which steps still wait. Both read what the page already has,
 * the project record and the step bar's steps; nothing new is asked of the server.
 */

export interface ProjectDueNote {
  text: string;
  /** the date has passed and the project is still open */
  late: boolean;
}

/**
 * the days left to the delivery date, from today in the business time zone (ISO); the date is read like the workshop
 * deadline (`toStorageDate`: ISO, or a legacy Jalali text, Persian digits too); a completed or cancelled project, or
 * one without a readable date, has no note
 */
export function projectDueNote(endDate: string | null | undefined, todayIso: string, status: string | null | undefined): ProjectDueNote | null {
  if (status === 'completed' || status === 'cancelled') return null;
  const end = toStorageDate(endDate);
  const today = toStorageDate(todayIso);
  if (!end || !today) return null;
  const days = daysUntilDeadline(end, today);
  if (days > 0) return { text: `${formatPersianNumber(days)} روز مانده`, late: false };
  if (days === 0) return { text: 'موعد تحویل امروز است', late: false };
  return { text: `${formatPersianNumber(-days)} روز از موعد گذشته`, late: true };
}

/** the steps not yet done, those that need attention first, each keeping its order otherwise */
export function pendingProjectSteps(steps: readonly ProjectStep[]): ProjectStep[] {
  const open = steps.filter(step => step.state !== 'done');
  return [...open.filter(step => step.state === 'attention'), ...open.filter(step => step.state !== 'attention')];
}
