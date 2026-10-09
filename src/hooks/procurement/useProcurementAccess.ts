import { useHasPermission } from '../../contexts/AuthContext';
import { PROCUREMENT_RECEIVE_PERMISSION } from '../../lib/permissions/procurementPermissions';

/**
 * v9.0.352 (TD-702، B10-15، هم‌راستا با تصمیم ت۲ بسته ۱۶): هر دکمه تدارکات با مجوز همان API نشان داده می‌شود (گاردهای
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
  /**
   * تأیید، رد و لغو درخواست (`POST /requisitions/:id/workflow-action`)؛ تأیید هنگام صدور سفارش هم همین را می‌خواهد (TD-689).
   * از v10.0.38 (TD-1126) فقط `procurement.approve`، گارد این سه اقدام در گردش کار (OBS-R2-36)
   */
  canApprove: boolean;
  /** بازگشایی درخواست ردشده: گارد مسیر (`procurement.approve` / `procurement.manage`) و گارد گام (`procurement.create`) */
  canReopen: boolean;
  /**
   * تحویل سفارش به انبار (`POST /orders/:id/deliver`)؛ از v9.0.455 (TD-904، ت۳ الف) افزون بر مجوز تدارکات، مجوز ثبت قطعی
   * سند رسید («ثبت ورود کالا») را هم می‌خواهد که سرویس تحویل می‌سنجد
   */
  canDeliver: boolean;
}

export function useProcurementAccess(): ProcurementAccess {
  const create = useHasPermission('procurement.create');
  const editProjects = useHasPermission('projects.edit');
  const manage = useHasPermission('procurement.manage');
  const order = useHasPermission('procurement.order');
  const approve = useHasPermission('procurement.approve');
  const receiveIntoStock = useHasPermission(PROCUREMENT_RECEIVE_PERMISSION);
  return {
    canCreate: create || editProjects,
    canManage: manage,
    canOrder: order,
    canApprove: approve,
    canReopen: (approve || manage) && create,
    canDeliver: (order || manage) && receiveIntoStock,
  };
}
