import { ProductionProject, Customer, Item } from '../../types';
import { WorkflowPreset } from '../../constants/presets';
import { ProductRow, ProjectStage } from './types';
import { extractDateString } from '../../utils';

export function getOptionalStageNamesForPreset(
  presetId: string,
  availablePresets: WorkflowPreset[],
  defaultPreset?: WorkflowPreset
): string[] {
  const currentPresetObj = availablePresets.find(p => p.id === presetId) || availablePresets[0] || defaultPreset;
  if (!currentPresetObj || !currentPresetObj.stages) return ['مونتاژ و پخت کوره'];

  const optionalNames: string[] = [];
  for (const stg of currentPresetObj.stages) {
    if (typeof stg === 'object' && stg !== null) {
      if (stg.isOptionalPerProduct) {
        optionalNames.push(stg.title);
      }
    } else if (typeof stg === 'string' && stg.includes('مونتاژ')) {
      optionalNames.push(stg);
    }
  }
  return optionalNames.length > 0 ? optionalNames : ['مونتاژ و پخت کوره'];
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
    needs_assembly: true,
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
  stages
}: {
  projectCode: string;
  title: string;
  selectedCustomerId: number | null;
  activeCustomersList: Customer[];
  productsList: ProductRow[];
  startDate: any;
  endDate: any;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  description: string;
  stages: ProjectStage[];
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
    initial_stages: stages.map((s, idx) => ({
      title: s.title ? s.title.trim() : `مرحله ${idx + 1}`,
      stage_order: idx + 1,
      assigned_personnel: s.assigned_personnel || [],
      required_resources: s.required_resources || []
    }))
  };
}
