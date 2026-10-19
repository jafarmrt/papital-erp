/**
 * TD-1341 (بستهٔ ۱۲ بند ۱، گزینهٔ ب کارت ت۴۲): «تکمیل رزرو» رزرو پروژهٔ ثبت نهایی‌شده را با فهرست مواد ذخیره‌شدهٔ امروز برابر
 * می‌کند. نیاز هر کالا همان نیاز ثبت نهایی است (بخش‌ها و اقلام دستی به واحد کالا، منهای آنچه به پروژه داده شده)؛ رزرو موجود تا
 * نیاز می‌ماند و رزرو بعدی پیش‌فاکتورها یا پروژه‌های دیگر آن را کم نمی‌کند، کمبود فقط از موجودی‌ای که هیچ‌کس رزرو نکرده پر
 * می‌شود و رزرو بیش از نیاز آزاد می‌شود. سرور پیش‌نمایش را می‌سازد (`GET /projects/:id/reservation-reconcile`) و ثبت
 * (`POST`) فقط همان تغییرهایی را می‌نویسد که کاربر دیده است (`planToken`). این قرارداد میان سرور و پنجرهٔ تأیید یکی است.
 */

import { formatPersianNumber } from '../../utils/persianNumber.js';

/** یک کالا در پیش‌نمایش؛ مقدارها به واحد کالا */
export interface ReservationReconcileLine {
  itemId: number;
  itemCode: string;
  itemName: string;
  unit: string;
  /** نیاز باقی‌ماندهٔ پروژه: فهرست مواد امروز منهای آنچه به پروژه داده شده */
  requiredQty: number;
  /** رزرو فعلی پروژه */
  currentQty: number;
  /** رزرو پس از ثبت */
  targetQty: number;
  /** نیازی که پس از ثبت هم رزرو نمی‌شود، چون موجودی آزاد نیست */
  shortQty: number;
}

/** TD-1341 (M1): ردیفی از فهرست مواد که به هیچ کالای زندهٔ انبار نمی‌رسد؛ مقدار به واحد خود ردیف */
export interface ReservationReconcileUnmatchedRow {
  code: string;
  name: string;
  unit: string;
  qty: number;
  section?: string;
}

export interface ReservationReconcilePreview {
  projectId: number;
  /** نسخهٔ پروژه‌ای که پیش‌نمایش از آن ساخته شد */
  version: number;
  lines: ReservationReconcileLine[];
  /** ردیف‌های بی کالا؛ رزروی نمی‌گیرند و تا هستند هیچ رزروی آزاد نمی‌شود */
  unmatchedRows: ReservationReconcileUnmatchedRow[];
  /** رزرو یا کمبودی عوض می‌شود */
  hasChanges: boolean;
  /** نشانهٔ همین تغییرها؛ ثبت با نشانهٔ دیگر ۴۰۹ `PROJECT_RESERVATION_PLAN_CHANGED` است */
  planToken: string;
}

/** پاسخ ثبت: نسخهٔ تازهٔ پروژه و رزرو ذخیره‌شده */
export interface ReservationReconcileResult {
  id: number;
  version: number;
  changed: boolean;
  preview: ReservationReconcilePreview;
  inventory_control: { reservedItems: unknown[]; reservationShortages: unknown[] };
}

export const RESERVATION_PLAN_CHANGED_MESSAGE =
  'موجودی یا رزروها از زمان پیش‌نمایش عوض شده است؛ فهرست تازهٔ تغییرها را ببینید و دوباره تأیید کنید.';

export type ReservationLineChange = 'reserve' | 'release' | 'unchanged';

/** مقدارها با چهار رقم اعشار سنجیده می‌شوند، همان دقت رزرو */
const qtyKey = (v: number): number => Math.round((Number(v) || 0) * 10_000);

export function reservationLineChange(line: Pick<ReservationReconcileLine, 'currentQty' | 'targetQty'>): ReservationLineChange {
  const diff = qtyKey(line.targetQty) - qtyKey(line.currentQty);
  return diff > 0 ? 'reserve' : diff < 0 ? 'release' : 'unchanged';
}

/** تغییر یک ردیف به زبان کاربر: «۳ رزرو تازه»، «۲ آزاد می‌شود» یا «بی‌تغییر» */
export function reservationLineChangeText(line: ReservationReconcileLine): string {
  const change = reservationLineChange(line);
  if (change === 'unchanged') return 'بی‌تغییر';
  const amount = formatPersianNumber(Math.abs(qtyKey(line.targetQty) - qtyKey(line.currentQty)) / 10_000);
  return change === 'reserve' ? `${amount} ${line.unit} رزرو تازه` : `${amount} ${line.unit} آزاد می‌شود`;
}

/** خلاصهٔ پیش‌نمایش برای بالای پنجره و پیام پس از ثبت */
export function reservationReconcileSummary(preview: Pick<ReservationReconcilePreview, 'lines' | 'hasChanges'>): string {
  if (!preview.hasChanges) return 'رزرو با فهرست مواد امروز برابر است و تغییری لازم نیست.';
  const reserve = preview.lines.filter(l => reservationLineChange(l) === 'reserve').length;
  const release = preview.lines.filter(l => reservationLineChange(l) === 'release').length;
  const short = preview.lines.filter(l => qtyKey(l.shortQty) > 0).length;
  const parts = [
    reserve > 0 ? `${formatPersianNumber(reserve)} کالا رزرو تازه می‌گیرد` : '',
    release > 0 ? `رزرو ${formatPersianNumber(release)} کالا آزاد می‌شود` : '',
    short > 0 ? `${formatPersianNumber(short)} کالا کمبود دارد` : '',
  ].filter(Boolean);
  return parts.length > 0 ? `${parts.join('، ')}.` : 'کمبودهای ثبت‌شده به‌روز می‌شوند.';
}

/**
 * TD-1341 (M1): «تکمیل رزرو» تا ردیفی از فهرست به هیچ کالایی نمی‌رسد رزروی را آزاد نمی‌کند، چون شاید همان ردیف نیاز کالایی
 * باشد که رزروش آزاد می‌شد (کد یا نامش عوض شده یا با «ي» و «ی» دیگری نوشته شده). ردیف بی کالا رزرو تازه را نمی‌بندد: ردیفی که
 * کالایش هنوز در انبار تعریف نشده، حالت عادی پروژه است.
 */
export function reconcileBlockedByUnmatched(preview: Pick<ReservationReconcilePreview, 'lines' | 'unmatchedRows'>): boolean {
  return (preview.unmatchedRows?.length ?? 0) > 0 && preview.lines.some(l => reservationLineChange(l) === 'release');
}

/** نام ردیف بی کالا برای پیام و پنجره */
export function unmatchedRowLabel(row: Pick<ReservationReconcileUnmatchedRow, 'code' | 'name'>): string {
  if (row.name && row.code) return `«${row.name}» (${row.code})`;
  return `«${row.name || row.code}»`;
}

export const UNMATCHED_ROWS_NOTE = 'کد و نام این ردیف‌ها به هیچ کالای انبار نمی‌رسد، پس رزروی نمی‌گیرند.';

export const UNMATCHED_ROWS_BLOCK_NOTE =
  'تا این ردیف‌ها در فهرست مواد درست نشوند یا کالایشان در انبار تعریف نشود، هیچ رزروی آزاد نمی‌شود؛ شاید یکی از همین ردیف‌ها نیاز کالایی باشد که رزروش آزاد می‌شد.';

const UNMATCHED_ROWS_SHOWN = 10;

/** پیام ۴۲۲ `PROJECT_RESERVATION_ROWS_UNMATCHED` با نام ردیف‌ها */
export function unmatchedRowsRefusalMessage(rows: ReadonlyArray<Pick<ReservationReconcileUnmatchedRow, 'code' | 'name'>>): string {
  const shown = rows.slice(0, UNMATCHED_ROWS_SHOWN).map(unmatchedRowLabel).join('، ');
  const more = rows.length > UNMATCHED_ROWS_SHOWN ? ` و ${formatPersianNumber(rows.length - UNMATCHED_ROWS_SHOWN)} ردیف دیگر` : '';
  return `این ردیف‌های فهرست مواد به هیچ کالای انبار نمی‌رسند: ${shown}${more}. ${UNMATCHED_ROWS_BLOCK_NOTE}`;
}
