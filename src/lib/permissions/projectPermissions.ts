/**
 * v9.0.417 (TD-752، B11-18): کلیدهای گارد API بسته کنترل پروژه و تولید، مشترک میان routeها و دکمه‌های رابط؛ هر گروه
 * «یکی کافی است» (مانند `authorizePermission`). پیش‌تر هیچ دکمه‌ای در صفحه پروژه‌ها، پنجره جزئیات، کنترل موجودی، تحویل،
 * ماتریس پیشرفت و تخصیص مواد مجوز نمی‌پرسید و کاربری که فقط `projects.view` داشت فرم را پر می‌کرد و ۴۰۳ می‌گرفت.
 */
/** تعریف پروژه (`POST /projects`) */
export const PROJECT_CREATE_PERMISSIONS = ['projects.create'] as const;
/** ویرایش پروژه، مراحل، ماتریس پیشرفت، کنترل موجودی و ثبت نهایی، زمان‌بندی، پیوست و ورود به انبار (همراه با `PROJECT_STOCK_IN_PERMISSIONS`) */
export const PROJECT_EDIT_PERMISSIONS = ['projects.edit'] as const;
/** حذف پروژه */
export const PROJECT_DELETE_PERMISSIONS = ['projects.delete'] as const;
/**
 * تخصیص مواد اولیه به پروژه (`POST /inventory/allocations/allocate`). v9.0.454 (TD-923، تصمیم ت۳ الف فاز ۵): تخصیص کالا را از
 * انبار خارج می‌کند و همان `warehouse.out` حواله را می‌خواهد؛ پیش‌تر `projects.edit` به‌تنهایی هم کالا را خارج می‌کرد.
 */
export const BOM_ALLOCATE_PERMISSIONS = ['warehouse.out'] as const;
/** مصرف تخصیص (`POST /inventory/allocations/:id/consume`) */
export const BOM_CONSUME_PERMISSIONS = ['inventory.reconcile', 'projects.edit'] as const;
/** آزادسازی تخصیص (`POST /inventory/allocations/:id/release`)؛ از v9.0.454 همراه با `PROJECT_STOCK_IN_PERMISSIONS` */
export const BOM_RELEASE_PERMISSIONS = ['inventory.reconcile', 'projects.edit', 'warehouse.out'] as const;
/**
 * v9.0.454 (TD-923، تصمیم ت۳ الف فاز ۵): گارد دوم مسیرهای پروژه‌ای که کالا را وارد انبار می‌کنند، یعنی آزادسازی تخصیص و
 * «ورود به انبار» پروژه (`POST /projects/:id/add-to-inventory`)، همان `warehouse.in` رسید؛ هر دو گارد لازم‌اند. پیش‌تر
 * `projects.edit` یا `warehouse.out` به‌تنهایی کالا را وارد انبار می‌کرد، در حالی که `POST /documents` همان کاربر را رد می‌کرد.
 */
export const PROJECT_STOCK_IN_PERMISSIONS = ['warehouse.in'] as const;
