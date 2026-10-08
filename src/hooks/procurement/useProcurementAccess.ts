import { useHasPermission } from '../../contexts/AuthContext';

/**
 * v9.0.345 (TD-702، B10-15، هم‌راستا با تصمیم ت۲ بسته ۱۶): هر دکمه تدارکات با مجوز همان API نشان داده می‌شود (گاردهای
 * `procurement.routes.ts`)، نه با کد نقش. پیش‌تر دکمه‌ها هیچ مجوزی نمی‌سنجیدند و کاربر دکمه را می‌دید و ۴۰۳ می‌گرفت.
 * فقط برای نمایش است؛ سرور همان مجوز را خودش می‌سنجد.
 */
export interface ProcurementAccess {
  /** ثبت درخواست خرید (`POST /requisitions`) */
  canCreate: boolean;
  /** ویرایش، حذف و تجمیع درخواست (`PUT` / `DELETE /requisitions/:id`، `POST /consolidate`) */
  canManage: boolean;
  /** صدور سفارش خرید از درخواست (`POST /requisitions/:id/convert-to-orders`) */
  canOrder: boolean;
  /** اقدام گردش کار درخواست (`POST /requisitions/:id/workflow-action`)؛ تأیید هنگام صدور سفارش هم همین را می‌خواهد (TD-689) */
  canApprove: boolean;
  /** تحویل سفارش به انبار (`POST /orders/:id/deliver`) */
  canDeliver: boolean;
}

export function useProcurementAccess(): ProcurementAccess {
  const create = useHasPermission('procurement.create');
  const editProjects = useHasPermission('projects.edit');
  const manage = useHasPermission('procurement.manage');
  const order = useHasPermission('procurement.order');
  const approve = useHasPermission('procurement.approve');
  return {
    canCreate: create || editProjects,
    canManage: manage,
    canOrder: order,
    canApprove: approve || manage,
    canDeliver: order || manage,
  };
}
