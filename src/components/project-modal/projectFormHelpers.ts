import { ProductionProject, Customer, FinancialAttachment } from '../../types';
import { WorkflowPreset } from '../../constants/presets';
import { ProductRow, ProjectStage } from './types';
import { extractDateString } from '../../utils';

/**
 * v10.0.69 (TD-1145): فرم پروژه تازه بی الگو و با یک مرحله باز می‌شود و الگوی مراحل فقط با انتخاب کاربر اعمال می‌شود؛
 * پیش‌تر نخستین الگوی تنظیمات خودبه‌خود اعمال می‌شد و گزینه «بدون الگو» هم نبود.
 */
export const NEW_PROJECT_STAGE_TITLE = 'مرحله اول تولید';

export function newProjectStages(): ProjectStage[] {
  return [{ title: NEW_PROJECT_STAGE_TITLE, assigned_personnel: [], required_resources: [] }];
}

/** مراحل الگوی انتخاب‌شده؛ برای «بدون الگو» یا الگوی ناموجود null، یعنی مراحل فعلی فرم دست نمی‌خورند. */
export function presetStages(presetId: string, availablePresets: WorkflowPreset[]): ProjectStage[] | null {
  const found = presetId ? availablePresets.find(p => p.id === presetId) : undefined;
  if (!found) return null;
  return found.stages.map(stg => ({
    title: typeof stg === 'string' ? stg : stg.title,
    assigned_personnel: [],
    required_resources: []
  }));
}

export function getOptionalStageNamesForPreset(
  presetId: string,
  availablePresets: WorkflowPreset[],
  defaultPreset?: WorkflowPreset
): string[] {
  if (!presetId) return [];
  const currentPresetObj = availablePresets.find(p => p.id === presetId) || defaultPreset;
  if (!currentPresetObj || !currentPresetObj.stages) return [];

  const optionalNames: string[] = [];
  for (const stg of currentPresetObj.stages) {
    if (typeof stg === 'object' && stg !== null && stg.isOptionalPerProduct) {
      optionalNames.push(stg.title);
    }
  }
  return optionalNames;
}

export function formatPickerDate(val: any): string {
  return extractDateString(val);
}

export function createInitialProductRow(): ProductRow {
  return {
    id: `prod-${Date.now()}`,
    item_id: null,
    item_code: '',
    item_name: '',
    customer_code: '',
    quantity: 100,
    unit: 'عدد',
    needs_assembly: false,
    notes: ''
  };
}

export function mapProjectProductsToRows(projectToEdit: ProductionProject): ProductRow[] {
  if (Array.isArray(projectToEdit.products) && projectToEdit.products.length > 0) {
    return projectToEdit.products.map((p, idx) => ({
      id: p.id || `prod-${idx + 1}`,
      item_id: p.item_id ?? p.itemId ?? null,
      item_code: p.item_code || p.itemCode || '',
      item_name: p.item_name || p.itemName || '',
      customer_code: p.customer_code || p.customerCode || '',
      quantity: p.quantity || 100,
      unit: p.unit || 'عدد',
      needs_assembly: p.needs_assembly ?? p.needsAssembly ?? true,
      selected_optional_stages: (p as any).selected_optional_stages || (p as any).selectedOptionalStages || undefined,
      notes: p.notes || ''
    }));
  }
  if (projectToEdit.item_name || projectToEdit.item_id) {
    return [{
      id: 'prod-1',
      item_id: projectToEdit.item_id || null,
      item_code: projectToEdit.item_code || '',
      item_name: projectToEdit.item_name || '',
      customer_code: '',
      quantity: projectToEdit.quantity || 100,
      unit: projectToEdit.unit || 'عدد',
      needs_assembly: true,
      notes: ''
    }];
  }
  return [createInitialProductRow()];
}

export function buildProjectPayload({
  projectCode,
  title,
  selectedCustomerId,
  activeCustomersList,
  productsList,
  startDate,
  endDate,
  priority,
  description,
  stages,
  attachments,
  includeStages = true
}: {
  projectCode: string;
  title: string;
  selectedCustomerId: number | null;
  activeCustomersList: Customer[];
  productsList: ProductRow[];
  startDate: string;
  endDate: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  description: string;
  stages: ProjectStage[];
  attachments?: FinancialAttachment[];
  /** v9.0.384 (TD-740، تصمیم ت۲ الف): مراحل فقط در ساخت پروژه فرستاده می‌شوند؛ ویرایش پروژه آن‌ها را نمی‌فرستد */
  includeStages?: boolean;
}) {
  const firstProduct = productsList[0];
  const totalQty = productsList.reduce((sum, p) => sum + (Number(p.quantity) || 0), 0);
  const selectedCustomer = activeCustomersList.find(c => c.id === selectedCustomerId);

  const finalProducts = productsList.length > 0 ? productsList : [createInitialProductRow()];

  return {
    project_code: projectCode ? projectCode.trim() : '',
    title: title.trim(),
    customer_id: selectedCustomerId || null,
    customer_name: selectedCustomer ? selectedCustomer.name : '',
    item_id: firstProduct?.item_id || null,
    item_code: firstProduct?.item_code || '',
    item_name: firstProduct?.item_name || '',
    quantity: Math.max(0.01, totalQty || 1),
    unit: firstProduct?.unit ? firstProduct.unit.trim() : 'عدد',
    start_date: formatPickerDate(startDate),
    end_date: formatPickerDate(endDate),
    priority,
    description: description ? description.trim() : '',
    products: finalProducts,
    attachments: Array.isArray(attachments) ? attachments : [],
    ...(includeStages ? {
      initial_stages: stages.map((s, idx) => ({
        title: s.title ? s.title.trim() : `مرحله ${idx + 1}`,
        stage_order: idx + 1,
        assigned_personnel: s.assigned_personnel || [],
        required_resources: s.required_resources || []
      }))
    } : {})
  };
}
