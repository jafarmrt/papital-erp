import type { PendingMaterial } from '../../types';

/**
 * v9.0.396 (TD-824، یافته B07-08): فرم پنجره بررسی ماده اولیه. «ذخیره فقط تغییرات» و «تأیید و افزودن به انبار» هر دو همین
 * شیء را می‌فرستند و کلیدهایش همان کلیدهای طرح سرور است (`approvePendingMaterialBody` / `updatePendingMaterialBody` در
 * `src/routes/pendingMaterials.schemas.ts`). پیش‌تر فرم کلیدهای snake_case داشت، تأیید آن را خام می‌فرستاد و بها و نقطه
 * سفارشی که بررسی‌کننده وارد کرده بود دور ریخته می‌شد.
 */
export interface PendingMaterialForm {
  code: string;
  name: string;
  category: string;
  unit: string;
  weightedAverageCost: number;
  reorderPoint: number;
  color: string;
  weight: number;
  material: string;
  size: string;
}

export const EMPTY_PENDING_MATERIAL_FORM: PendingMaterialForm = {
  code: '', name: '', category: '', unit: 'عدد', weightedAverageCost: 0, reorderPoint: 0, color: '', weight: 0, material: '', size: '',
};

/** فرم پنجره از ردیف درخواست؛ دسته خالی دسته پیش‌فرض صفحه را می‌گیرد */
export function pendingMaterialFormOf(item: PendingMaterial, defaultCategory: string): PendingMaterialForm {
  return {
    code: item.code || '',
    name: item.name || '',
    category: item.category || defaultCategory,
    unit: item.unit || 'عدد',
    weightedAverageCost: Number(item.weightedAverageCost ?? item.weighted_average_cost ?? 0) || 0,
    reorderPoint: Number(item.reorderPoint ?? item.reorder_point ?? 0) || 0,
    color: item.color || '',
    weight: Number(item.weight ?? 0) || 0,
    material: item.material || '',
    size: item.size || '',
  };
}
