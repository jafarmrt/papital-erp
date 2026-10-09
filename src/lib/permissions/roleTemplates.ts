import { requiredPermissionsOf, withRequiredPermissions } from './permissionCatalog';
import { canGrantPermission, type GrantorPermissions } from './grantBoundary';

/**
 * v9.0.134 (TD-526، یافته B02-11، مدل مجوز §۴.۳ و تصمیم ت۶ بازنگری‌شده الف): الگوهای نقش، یک فهرست واحد که جای نقش‌های
 * seed و قالب‌های فرم نقش را گرفت. نصب تازه فقط نقش «مدیر سیستم» دارد و هیچ نقش دیگری خودکار ساخته نمی‌شود؛ مدیر با
 * «ساخت نقش از الگو» در زبانه نقش‌ها یکی را برمی‌گزیند، نام و تیک‌ها را ویرایش و ذخیره می‌کند و از آن پس نقش عادی است.
 * الگو فقط پیشنهاد است: کد نقش در هیچ بررسی‌ای پرسیده نمی‌شود (شمارنده `permission-ratchet` این فایل را داده می‌داند، نه بررسی).
 * فهرست مجوز هر الگو همان نقش seed تا v9.0.133 است، با نیازهایش (Vitest `permissionCatalog.test.ts`؛ فرم و دکمه: `roleTemplates.test.tsx`).
 */
export interface RoleTemplate {
  /** کد پیشنهادی؛ اگر نقشی با همین کد هست، فرم کد دیگری پیشنهاد می‌کند */
  code: string;
  name: string;
  description: string;
  permissions: readonly string[];
}

export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    code: 'manager',
    name: 'مدیر عمومی',
    description: 'دسترسی مدیریتی جامع به همه بخش‌ها و عملیات سامانه',
    permissions: [
      'products.view', 'products.create', 'products.edit', 'products.edit_price', 'products.delete', 'warehouse.view',
      'warehouse.in', 'warehouse.out', 'warehouse.transfer', 'inventory.reconcile', 'documents.view', 'documents.create',
      'documents.finalize', 'documents.edit', 'documents.delete', 'audit.view', 'audit.create', 'audit.apply',
      'customers.view', 'customers.manage', 'crm.view', 'crm.manage', 'crm.delete', 'reports.view',
      'projects.view', 'projects.create', 'projects.edit', 'projects.delete', 'workflow.view', 'workflow.approve',
      'workflow.manage', 'events.view', 'events.manage', 'daily_logs.view', 'daily_logs.create', 'daily_logs.manage_all',
      'personnel.view', 'personnel.manage', 'piecework.view', 'piecework.manage_tasks', 'piecework.log', 'piecework.payroll',
      'piecework.pay', 'personnel.view_sensitive', 'payroll.view_sensitive', 'pending_materials.view', 'pending_materials.create', 'pending_materials.approve', 'pending_materials.delete', 'procurement.view',
      'procurement.create', 'procurement.manage', 'procurement.order', 'procurement.approve', 'accounting.view', 'accounting.vouchers',
      'accounting.vouchers_approve', 'accounting.coa', 'accounting.treasury', 'accounting.cheques', 'accounting.reports', 'woocommerce.view', 'woocommerce.manage',
      'audit_logs.view', 'settings.manage',
    ],
  },
  {
    code: 'cfo_accountant',
    name: 'مدیر ارشد مالی',
    description: 'دسترسی کامل به کدینگ حساب‌ها، اسناد دوبل، خزانه‌داری، چک‌های صیادی، صورت‌های مالی، قیمت‌گذاری و حقوق پرسنل',
    permissions: [
      'accounting.view', 'accounting.vouchers', 'accounting.vouchers_approve', 'accounting.coa', 'accounting.treasury', 'accounting.cheques', 'accounting.reports',
      'products.view', 'products.edit_price', 'documents.view', 'documents.create', 'documents.edit', 'documents.delete',
      'documents.finalize', 'customers.view', 'customers.manage', 'workflow.view', 'workflow.approve', 'events.view',
      'personnel.view', 'piecework.view', 'piecework.payroll', 'daily_logs.view', 'daily_logs.create', 'reports.view',
      'audit_logs.view',
    ],
  },
  {
    code: 'warehouse_keeper',
    name: 'انباردار',
    description: 'مسئول ورود و خروج کالا، جابه‌جایی بین انبارها و ثبت شمارش انبارگردانی',
    permissions: [
      'products.view', 'products.create', 'products.edit', 'warehouse.view', 'warehouse.in', 'warehouse.out',
      'warehouse.transfer', 'inventory.reconcile', 'documents.view', 'documents.edit', 'documents.finalize', 'audit.view',
      'audit.create', 'audit.apply', 'pending_materials.view', 'pending_materials.create', 'pending_materials.approve', 'workflow.view', 'workflow.approve',
      'workflow.execute', 'customers.view', 'projects.view', 'projects.edit', 'daily_logs.view', 'daily_logs.create',
    ],
  },
  {
    code: 'accountant',
    name: 'حسابدار و کارشناس مالی',
    description: 'مدیریت اسناد دوبل، کدینگ، فاکتورهای فروش، خزانه‌داری و صدور چک و صورت‌های مالی',
    permissions: [
      'products.view', 'products.edit_price', 'warehouse.view', 'documents.view', 'documents.create', 'documents.edit',
      'documents.delete', 'documents.finalize', 'customers.view', 'customers.manage', 'workflow.view', 'workflow.approve',
      'crm.view', 'reports.view', 'projects.view', 'accounting.view', 'accounting.vouchers', 'accounting.coa',
      'accounting.treasury', 'accounting.cheques', 'accounting.reports', 'daily_logs.view', 'daily_logs.create',
    ],
  },
  {
    code: 'production_manager',
    name: 'مدیر تولید و کارگاه',
    description: 'مدیریت پروژه‌های تولید، مراحل ساخت، تأیید خط تولید، کارهای کارمزدی و درخواست‌های مواد اولیه',
    permissions: [
      'products.view', 'products.create', 'products.edit', 'warehouse.view', 'warehouse.in', 'warehouse.out',
      'projects.view', 'projects.create', 'projects.edit', 'projects.delete', 'workflow.view', 'workflow.approve',
      'workflow.execute', 'personnel.view', 'piecework.view', 'piecework.log', 'piecework.manage_tasks', 'pending_materials.view',
      'pending_materials.create', 'pending_materials.approve', 'daily_logs.view', 'daily_logs.create', 'daily_logs.manage_all', 'reports.view',
    ],
  },
  {
    code: 'treasurer',
    name: 'خزانه‌دار و مسئول صندوق',
    description: 'مدیریت حساب‌های بانکی، صندوق و مانده نقدینگی، ثبت و پیگیری دریافت و پرداخت‌ها و چک‌های صیادی',
    permissions: [
      'accounting.view', 'accounting.treasury', 'accounting.cheques', 'workflow.view', 'workflow.approve', 'workflow.execute',
      'documents.view', 'customers.view', 'daily_logs.view', 'daily_logs.create',
    ],
  },
  {
    code: 'sales_manager',
    name: 'مدیر فروش',
    description: 'صدور فاکتور و پیش‌فاکتور فروش، ثبت مشتریان و مشاهده موجودی کالاها',
    permissions: [
      'products.view', 'warehouse.view', 'documents.view', 'documents.create', 'documents.edit', 'customers.view',
      'customers.manage', 'workflow.view', 'workflow.approve', 'crm.view', 'crm.manage', 'reports.view',
      'projects.view', 'daily_logs.view', 'daily_logs.create',
    ],
  },
  {
    code: 'inventory_auditor',
    name: 'ناظر انبارگردانی',
    description: 'ایجاد دوره‌های انبارگردانی، ثبت شمارش عینی و کنترل و اعمال مغایرت‌ها',
    permissions: [
      'products.view', 'warehouse.view', 'inventory.reconcile', 'audit.view', 'audit.create', 'audit.apply',
      'workflow.view', 'projects.view', 'daily_logs.view', 'daily_logs.create',
    ],
  },
  {
    code: 'viewer',
    name: 'فقط مشاهده',
    description: 'مشاهده اطلاعات، کالاها و فاکتورها بی امکان ویرایش',
    permissions: [
      'products.view', 'warehouse.view', 'documents.view', 'customers.view', 'crm.view', 'reports.view',
      'projects.view', 'workflow.view', 'daily_logs.view',
    ],
  },
  {
    code: 'daily_logger',
    name: 'ثبت‌کننده گزارش کار',
    description: 'ثبت و مشاهده گزارش کار روزانه و اعلان‌ها',
    permissions: [
      'daily_logs.view', 'daily_logs.create',
    ],
  },
  {
    code: 'procurement_officer',
    name: 'مسئول خرید و تدارکات',
    description: 'مدیریت درخواست‌های خرید پروژه‌ها و انبار، استعلام قیمت، تفکیک اقلام، انتخاب تأمین‌کننده و صدور سفارش خرید',
    permissions: [
      'procurement.view', 'procurement.create', 'procurement.manage', 'procurement.order', 'procurement.approve', 'products.view',
      'products.edit_price', 'warehouse.view', 'warehouse.in', 'documents.view', 'documents.create', 'documents.edit',
      'customers.view', 'customers.manage', 'projects.view', 'workflow.view', 'workflow.approve', 'daily_logs.view',
      'daily_logs.create',
    ],
  },
  {
    code: 'sales_agent',
    name: 'کارشناس فروش و ارتباط با مشتری',
    description: 'مدیریت مشتریان، پرونده‌های فروش، پیش‌فاکتورها و مشاهده سفارش‌های فروشگاه اینترنتی',
    permissions: [
      'crm.view', 'crm.manage', 'customers.view', 'customers.manage', 'documents.view', 'documents.create',
      'woocommerce.view',
    ],
  },
  {
    code: 'workshop_operator',
    name: 'متصدی ثبت کارکرد کارگاه',
    description: 'ثبت کارکرد کارمزدی پرسنل و گزارش کار روزانه کارگاه',
    permissions: [
      'piecework.view', 'piecework.log', 'daily_logs.view', 'daily_logs.create',
    ],
  },
];

/** کد پیشنهادی یکتا: کد الگو، و اگر گرفته شده با پسوند `_2`، `_3` و … */
export function uniqueRoleCode(code: string, takenCodes: readonly string[]): string {
  const taken = new Set(takenCodes.map(c => c.toLowerCase()));
  if (!taken.has(code.toLowerCase())) return code;
  for (let n = 2; ; n++) {
    const candidate = `${code}_${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** پیش‌نویس فرم نقش تازه از یک الگو */
export interface RoleDraft {
  name: string;
  code: string;
  description: string;
  permissions: string[];
}

/**
 * پیش‌نویس فرم «ساخت نقش از الگو»: کد یکتا، و از مجوزهای الگو (با نیازهایش) فقط کلیدهایی که کاربر جاری می‌تواند بدهد و
 * همه نیازهایشان را هم می‌تواند بدهد (همان مرز TD-520 که سرور هنگام ذخیره می‌سنجد)
 */
export function roleDraftFromTemplate(template: RoleTemplate, takenCodes: readonly string[], grantor: GrantorPermissions): RoleDraft {
  const grantable = (key: string) => canGrantPermission(grantor, key) && requiredPermissionsOf(key).every(r => canGrantPermission(grantor, r));
  return {
    name: template.name,
    code: uniqueRoleCode(template.code, takenCodes),
    description: template.description,
    permissions: withRequiredPermissions(template.permissions).filter(grantable),
  };
}
