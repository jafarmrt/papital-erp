import { documentTypeRecordPermission } from '../permissions/documentPermissions';
import { permissionDefinition } from '../permissions/permissionCatalog';
import type { DocumentStockDirection } from './documentDirection';

/**
 * v9.0.241 (TD-791، یافته B08-22، تصمیم ت۱ «الف» بسته ۸): صفحه «ورود و خروج به انبار» هر نوع سند را فقط به کسی پیشنهاد می‌کند
 * که سرور ثبت قطعی آن را از او می‌پذیرد (`documentTypeRecordPermission`، همان جدول `POST /documents`): رسید و رسید تولید
 * «ثبت ورود کالا»، برگشت از فروش «قطعی کردن سند فروش»، حواله و ضایعات «ثبت خروج کالا». پیش‌تر دکمه ثبت فقط برای کد نقش
 * `viewer` غیرفعال بود و مدیر تولید دکمه فعال می‌دید و ۴۰۳ می‌گرفت.
 *
 * v9.0.325 (TD-780، یافته B08-11، تصمیم ت۷ «الف» بسته ۸): رسید تولید از این صفحه پیشنهاد نمی‌شود؛ محصول پروژه فقط از
 * «ورود به انبار» همان پروژه وارد انبار می‌شود (TD-285، سقف TD-327) و `POST /documents` آن را ۴۲۲ می‌دهد.
 *
 * این فایل به چیزی از سرور یا React وابسته نیست.
 */

/** نوع‌های سند صفحه اسناد انبار در هر جهت، به ترتیب نمایش؛ همه قطعی ثبت می‌شوند */
export const STOCK_PAGE_DOC_TYPES: Readonly<Record<DocumentStockDirection, readonly string[]>> = Object.freeze({
  in: Object.freeze(['receipt', 'return']),
  out: Object.freeze(['remittance', 'waste']),
});

export const STOCK_PAGE_DOC_TYPE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  receipt: 'رسید خرید مواد اولیه / کالا (فاکتور خرید)',
  return: 'برگشت از فروش / مرجوعی مشتری',
  remittance: 'حواله خروج مصرف (تولید / کارگاه)',
  waste: 'ضایعات و اسقاط',
});

const DIRECTIONS: readonly DocumentStockDirection[] = ['in', 'out'];

/** مجوزی که ثبت قطعی این نوع از صفحه اسناد انبار می‌خواهد */
export function stockPageRecordPermission(docType: string): string {
  return documentTypeRecordPermission(docType, 'final');
}

/** همه مجوزهایی که یکی از نوع‌های صفحه را ثبت می‌کنند، بی تکرار */
export const STOCK_PAGE_RECORD_PERMISSIONS: readonly string[] = Object.freeze(
  Array.from(new Set(DIRECTIONS.flatMap(d => STOCK_PAGE_DOC_TYPES[d].map(stockPageRecordPermission)))),
);

export interface StockPageAccess {
  /** نوع‌هایی که کاربر در هر جهت ثبت می‌کند */
  readonly types: Readonly<Record<DocumentStockDirection, readonly string[]>>;
  /** جهت‌هایی که دست‌کم یک نوع ثبت‌شدنی دارند */
  readonly directions: readonly DocumentStockDirection[];
  /** کلید پایدار برای وابستگی اثرها */
  readonly key: string;
}

export function stockPageAccess(holds: (permission: string) => boolean): StockPageAccess {
  const types = {
    in: STOCK_PAGE_DOC_TYPES.in.filter(t => holds(stockPageRecordPermission(t))),
    out: STOCK_PAGE_DOC_TYPES.out.filter(t => holds(stockPageRecordPermission(t))),
  };
  return {
    types,
    directions: DIRECTIONS.filter(d => types[d].length > 0),
    key: `${types.in.join(',')}|${types.out.join(',')}`,
  };
}

/** نوع‌هایی که فهرست نوع سند در این جهت نشان می‌دهد: ثبت‌شدنی‌ها، وگرنه همه (دکمه ثبت با پیام مجوز غیرفعال می‌ماند) */
export function stockPageTypeOptions(access: StockPageAccess, direction: DocumentStockDirection): readonly string[] {
  return access.types[direction].length > 0 ? access.types[direction] : STOCK_PAGE_DOC_TYPES[direction];
}

function permissionTitle(permission: string): string {
  return permissionDefinition(permission)?.title ?? permission;
}

/** چرا ثبت این نوع از دست کاربر برنمی‌آید؛ null یعنی ثبت‌شدنی است */
export function stockPageBlockedReason(access: StockPageAccess, direction: DocumentStockDirection, docType: string): string | null {
  if (access.types[direction].includes(docType)) return null;
  const label = STOCK_PAGE_DOC_TYPE_LABELS[docType] ?? docType;
  return `ثبت «${label}» مجوز «${permissionTitle(stockPageRecordPermission(docType))}» را می‌خواهد که نقش شما ندارد.`;
}

/** پیام صفحه برای کسی که هیچ نوعی را ثبت نمی‌کند */
export function stockPageNoAccessNotice(): string {
  const titles = STOCK_PAGE_RECORD_PERMISSIONS.map(p => `«${permissionTitle(p)}»`).join('، ');
  return `این صفحه را می‌بینید ولی برای ثبت سند در آن یکی از مجوزهای ${titles} لازم است.`;
}
