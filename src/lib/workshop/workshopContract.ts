import type { DeliveryConfirmationStatus, WorkshopReportStatus } from './workshopSchedule';

/**
 * v10.1.39 (N-01 part 2): the answers of the workshop cartable routes (`/api/workshop/...`), shared by the server and the
 * cartable screens. Dates are ISO; amounts are rial numbers and reach the worker only after approval (decision ت۷ الف).
 */

export interface WorkshopReportView {
  id: number;
  status: WorkshopReportStatus;
  quantity: number;
  approvedQuantity: number | null;
  notes: string;
  reviewNote: string;
  version: number;
  createdAt: string;
  reviewedAt: string | null;
}

export interface WorkshopTaskCard {
  projectId: number;
  projectCode: string;
  projectTitle: string;
  stageId: number;
  stageTitle: string;
  productId: string;
  productName: string;
  rowId: string;
  taskId: number | null;
  taskTitle: string;
  quantity: number;
  unit: string;
  deadline: string | null;
  daysLeft: number | null;
  report: WorkshopReportView | null;
}

export interface WorkshopApprovedReport {
  reportId: number;
  projectCode: string;
  projectTitle: string;
  stageTitle: string;
  productName: string;
  taskTitle: string;
  quantity: number;
  /** the work log's amount; shown to the worker once the report is approved */
  amount: number;
  reviewedAt: string | null;
}

export interface MyWorkshopTasks {
  personnel: { id: number; fullName: string };
  tasks: WorkshopTaskCard[];
  approved: WorkshopApprovedReport[];
}

export interface WorkshopDeliveryLine {
  itemCode: string;
  itemName: string;
  quantity: number;
  unit: string;
}

export interface WorkshopDelivery {
  kind: 'document' | 'allocation';
  id: number;
  /** remittance number, or the allocation's project code */
  reference: string;
  date: string;
  projectTitle: string | null;
  lines: WorkshopDeliveryLine[];
  confirmation: { status: DeliveryConfirmationStatus; note: string; confirmedAt: string } | null;
}

export interface MyWorkshopDeliveries {
  personnel: { id: number; fullName: string };
  deliveries: WorkshopDelivery[];
}

export interface WorkshopReviewItem {
  report: WorkshopReportView;
  projectId: number;
  projectCode: string;
  projectTitle: string;
  stageId: number;
  stageTitle: string;
  productId: string;
  productName: string;
  rowId: string;
  taskTitle: string;
  plannedQuantity: number;
  unit: string;
  personnelId: number;
  personnelName: string;
  deadline: string | null;
  /** live work logs of the same worker, task and project recorded by hand (no schedule row); approval needs «بررسی کردم» */
  manualLogs: WorkshopManualLog[];
  /** the viewer's own work (linked personnel or recorder), which the server refuses to approve or reject; system admin false */
  isOwn: boolean;
}

/** A work log recorded outside the workshop schedule, which an approval might pay a second time. */
export interface WorkshopManualLog {
  id: number;
  /** ISO date */
  date: string;
  quantity: number;
}

/** The manual work logs a 409 `WORKSHOP_MANUAL_LOGS_EXIST` names in its details, or null when it names none. */
export function manualLogsOfConflict(details: unknown): WorkshopManualLog[] | null {
  const list = (details as { manualLogs?: unknown } | null | undefined)?.manualLogs;
  if (!Array.isArray(list)) return null;
  return list.filter((log): log is WorkshopManualLog =>
    typeof log === 'object' && log !== null
    && Number.isInteger((log as WorkshopManualLog).id)
    && typeof (log as WorkshopManualLog).date === 'string'
    && typeof (log as WorkshopManualLog).quantity === 'number');
}

/** After the last row of a product in a stage is approved: offer the progress matrix tick (decision ت۶ الف). */
export interface MatrixTickSuggestion {
  projectId: number;
  stageId: number;
  stageOrder: number;
  stageTitle: string;
  productId: string;
  productName: string;
  itemId: number | null;
}

export interface WorkshopApproveResult {
  reportId: number;
  pieceworkLogId: number;
  matrixTickSuggestion: MatrixTickSuggestion | null;
}

/** Per stage of a project: approved quantity ÷ planned quantity of its schedule rows (plan §4.3 «پیشرفت»). */
export interface WorkshopStageProgress {
  stageId: number;
  /** null when the rows have several units (10.2 package 12, review N4) */
  plannedQuantity: number | null;
  /** the done work of the stage's rows (live work logs up to each row; 10.2 package 12, D6); null with several units */
  approvedQuantity: number | null;
  /** the rows' one unit, or null when they have several (only the percent is given then) */
  unit: string | null;
  /** below 100 until the stage is complete */
  percent: number;
}

export interface ProjectWorkshopReports {
  pending: WorkshopReviewItem[];
  stageProgress: WorkshopStageProgress[];
  canReview: boolean;
}
