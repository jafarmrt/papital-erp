/**
 * v9.0.154 (TD-648، تصمیم ت۲ الف): مجوز هر بخش از ورود اکسل کالا، مشترک میان سرور و پیش‌نمایش مرورگر. پیش‌تر هر دارنده
 * «تعریف کالا» یا «ویرایش کالا» با یک ردیف اکسل قیمت فروش و موجودی انبار را هم عوض می‌کرد.
 * - کالای تازه (با موجودی اولیه‌اش، مثل فرم کالا): `products.create`
 * - مشخصات کالای موجود: `products.edit`
 * - قیمت فروش: `products.edit_price`
 * - افزایش موجودی کالای موجود: `warehouse.in`؛ کاهش آن: `warehouse.out` (همان مجوز سند انبارگردانی)
 * بخشی که مجوزش نیست فقط وقتی چیزی را عوض کند خطای ردیف می‌گیرد و نادیده گرفته می‌شود؛ بقیه ردیف ثبت می‌شود.
 */
export interface ItemImportPermissions {
  createItems: boolean;
  editItems: boolean;
  editPrices: boolean;
  stockIn: boolean;
  stockOut: boolean;
}

/** کلید مجوز هر بخش، به ترتیب فیلدهای `ItemImportPermissions` */
export const ITEM_IMPORT_PERMISSION_KEYS: Readonly<Record<keyof ItemImportPermissions, string>> = {
  createItems: 'products.create',
  editItems: 'products.edit',
  editPrices: 'products.edit_price',
  stockIn: 'warehouse.in',
  stockOut: 'warehouse.out',
};

/** همه مجوزها؛ فقط برای فراخوانی داخلی سرور (آزمون‌ها و ابزارها)، هرگز از درخواست کاربر */
export const ALL_ITEM_IMPORT_PERMISSIONS: Readonly<ItemImportPermissions> = {
  createItems: true,
  editItems: true,
  editPrices: true,
  stockIn: true,
  stockOut: true,
};

export const ITEM_IMPORT_DENIED_MESSAGES: Readonly<Record<keyof ItemImportPermissions, string>> = {
  createItems: 'برای تعریف کالای تازه از اکسل مجوز «تعریف کالای جدید» لازم است؛ این ردیف ثبت نشد.',
  editItems: 'برای تغییر مشخصات کالای موجود مجوز «ویرایش اطلاعات کالا» لازم است؛ مشخصات این کالا تغییر نکرد.',
  editPrices: 'برای تغییر قیمت مجوز «ویرایش قیمت‌ها» لازم است؛ قیمت‌های این ردیف ثبت نشد.',
  stockIn: 'برای افزایش موجودی مجوز «ثبت ورود کالا (رسید)» لازم است؛ موجودی این ردیف تغییر نکرد.',
  stockOut: 'برای کاهش موجودی مجوز «ثبت خروج کالا (حواله)» لازم است؛ موجودی این ردیف تغییر نکرد.',
};

/** مجوزهای کاربر از فهرست کلیدهای نقش (مرورگر)؛ مدیر سیستم همه را دارد */
export function itemImportPermissionsFromKeys(isAdmin: boolean, keys: readonly string[]): ItemImportPermissions {
  const has = (k: keyof ItemImportPermissions) => isAdmin || keys.includes(ITEM_IMPORT_PERMISSION_KEYS[k]);
  return {
    createItems: has('createItems'),
    editItems: has('editItems'),
    editPrices: has('editPrices'),
    stockIn: has('stockIn'),
    stockOut: has('stockOut'),
  };
}

/**
 * یادآوری پیش‌نمایش: بخش‌هایی از ورود که کاربر مجوزشان را ندارد. سرور همین را خودش می‌سنجد؛ این فقط برای آگاه‌کردن
 * کاربر پیش از ثبت است.
 */
export function itemImportPermissionNotices(perms: ItemImportPermissions): string[] {
  const notices: string[] = [];
  if (!perms.createItems) notices.push('مجوز «تعریف کالای جدید» را ندارید: ردیف کالاهای تازه ثبت نمی‌شود.');
  if (!perms.editItems) notices.push('مجوز «ویرایش اطلاعات کالا» را ندارید: مشخصات کالاهای موجود تغییر نمی‌کند.');
  if (!perms.editPrices) notices.push('مجوز «ویرایش قیمت‌ها» را ندارید: ستون‌های قیمت ثبت نمی‌شوند.');
  if (!perms.stockIn) notices.push('مجوز «ثبت ورود کالا (رسید)» را ندارید: افزایش موجودی کالاهای موجود ثبت نمی‌شود.');
  if (!perms.stockOut) notices.push('مجوز «ثبت خروج کالا (حواله)» را ندارید: کاهش موجودی کالاهای موجود ثبت نمی‌شود.');
  return notices;
}
