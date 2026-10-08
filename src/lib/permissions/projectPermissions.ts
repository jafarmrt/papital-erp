/**
 * v9.0.393 (TD-752، B11-18): کلیدهای گارد API بسته کنترل پروژه و تولید، مشترک میان routeها و دکمه‌های رابط؛ هر گروه
 * «یکی کافی است» (مانند `authorizePermission`). پیش‌تر هیچ دکمه‌ای در صفحه پروژه‌ها، پنجره جزئیات، کنترل موجودی، تحویل،
 * ماتریس پیشرفت و تخصیص مواد مجوز نمی‌پرسید و کاربری که فقط `projects.view` داشت فرم را پر می‌کرد و ۴۰۳ می‌گرفت.
 */
/** تعریف پروژه (`POST /projects`) */
export const PROJECT_CREATE_PERMISSIONS = ['projects.create'] as const;
/** ویرایش پروژه، مراحل، ماتریس پیشرفت، کنترل موجودی و ثبت نهایی، زمان‌بندی، پیوست و ورود به انبار */
export const PROJECT_EDIT_PERMISSIONS = ['projects.edit'] as const;
/** حذف پروژه */
export const PROJECT_DELETE_PERMISSIONS = ['projects.delete'] as const;
/** تخصیص مواد اولیه به پروژه (`POST /inventory/allocations/allocate`) */
export const BOM_ALLOCATE_PERMISSIONS = ['projects.edit', 'warehouse.out'] as const;
/** مصرف تخصیص (`POST /inventory/allocations/:id/consume`) */
export const BOM_CONSUME_PERMISSIONS = ['inventory.reconcile', 'projects.edit'] as const;
/** آزادسازی تخصیص (`POST /inventory/allocations/:id/release`) */
export const BOM_RELEASE_PERMISSIONS = ['inventory.reconcile', 'projects.edit', 'warehouse.out'] as const;
