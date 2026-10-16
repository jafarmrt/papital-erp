import type { DeliveryConfirmationStatus, WorkshopReportStatus } from './workshopSchedule';

/**
 * v10.1.38 (N-01 part 2): the answers of the workshop cartable routes (`/api/workshop/...`), shared by the server and the
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
}

/** A work log recorded outside the workshop schedule, which an approval might pay a second time. */
export interface WorkshopManualLog {
  id: number;
  /** ISO date */
  date: string;
  quantity: number;
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
  plannedQuantity: number;
  approvedQuantity: number;
  percent: number;
}

export interface ProjectWorkshopReports {
  pending: WorkshopReviewItem[];
  stageProgress: WorkshopStageProgress[];
  canReview: boolean;
}
