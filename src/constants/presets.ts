export interface StageTaskTemplate {
  taskId?: number | null;
  taskTitle: string;
  unit?: string;
  defaultRate?: number;
}

export interface WorkflowStageItem {
  title: string;
  isOptionalPerProduct?: boolean; // آیا این مرحله برای تولید هر کالا انتخابی است؟
  defaultTasks?: StageTaskTemplate[]; // الگوی پیش‌فرض عناوین کاری و کارمزدهای این مرحله
}

export interface WorkflowPreset {
  id: string;
  title: string;
  description: string;
  stages: (string | WorkflowStageItem)[];
  isArchived?: boolean; // آیا این الگو آرشیو شده است؟
}

export const DEFAULT_WORKFLOW_PRESETS: WorkflowPreset[] = [];

