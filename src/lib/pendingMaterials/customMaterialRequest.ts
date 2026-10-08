/**
 * v9.0.398 (TD-826، یافته B07-10، تصمیم ت۵ «الف»): «ثبت ماده اولیه جدید» کنترل پروژه دیگر کالا نمی‌سازد؛ یک درخواست به صف
 * «مواد اولیه در انتظار تأیید» می‌فرستد (`POST /pending-materials`، مجوز `pending_materials.create`) و کالا فقط با تأیید
 * انباردار ساخته می‌شود. پیش‌تر فرم مستقیم `POST /api/items` می‌زد، با موجودی اولیه، و صف و تأیید را دور می‌زد. موجودی
 * فقط با رسید وارد می‌شود، پس فرم موجودی اولیه ندارد.
 */
export interface CustomMaterialForm {
  name: string;
  category: string;
  itemCode: string;
  unit: string;
  weightedAverageCost: number;
  reorderPoint: number;
  color: string;
  material: string;
  size: string;
}

export const EMPTY_CUSTOM_MATERIAL_FORM: CustomMaterialForm = {
  name: '', category: '', itemCode: '', unit: 'عدد', weightedAverageCost: 0, reorderPoint: 5, color: '', material: '', size: '',
};

/** The body of `POST /pending-materials` (`createPendingMaterialSchema`); the server reads the project title itself */
export interface PendingMaterialRequestBody {
  name: string;
  category: string;
  code: string;
  unit: string;
  projectId: number | null;
  weightedAverageCost: number;
  reorderPoint: number;
  color: string;
  material: string;
  size: string;
}

export function pendingMaterialRequestOf(form: CustomMaterialForm, projectId: number | null | undefined): PendingMaterialRequestBody {
  return {
    name: form.name.trim(),
    category: form.category,
    code: form.itemCode.trim(),
    unit: form.unit || 'عدد',
    projectId: projectId ?? null,
    weightedAverageCost: Number(form.weightedAverageCost) || 0,
    reorderPoint: Number(form.reorderPoint) || 0,
    color: form.color,
    material: form.material,
    size: form.size,
  };
}
