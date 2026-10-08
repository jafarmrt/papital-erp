import { SearchableSelect } from '../SearchableSelect';
import { JalaliDateInput } from '../common/JalaliDateInput';
import type { WarehouseItem } from '../../hooks/queries/useSettingsQueries';

export type ReorderPriority = 'urgent' | 'high' | 'normal' | 'low';
export type ReorderDocStatus = 'draft' | 'final';

interface ReorderOrderFieldsProps {
  orderTarget: 'requisition' | 'direct_document';
  title: string;
  onTitleChange: (value: string) => void;
  priority: ReorderPriority;
  onPriorityChange: (value: ReorderPriority) => void;
  supplierName: string;
  onSupplierChange: (value: string) => void;
  supplierOptions: Array<{ value: string; label: string }>;
  docStatus: ReorderDocStatus;
  onDocStatusChange: (value: ReorderDocStatus) => void;
  warehouses: WarehouseItem[];
  warehouseCode: string;
  onWarehouseChange: (code: string) => void;
  /** ISO (YYYY-MM-DD) */
  date: string;
  onDateChange: (iso: string) => void;
  notes: string;
  onNotesChange: (value: string) => void;
  /** a final receipt has a line at price zero */
  askDonated: boolean;
  donatedConfirmed: boolean;
  onDonatedChange: (value: boolean) => void;
}

const FIELD = 'w-full p-2 bg-white border border-slate-300 rounded-lg text-slate-800 focus:ring-2 focus:ring-amber-400 focus:outline-none';

/**
 * v9.0.384 (TD-830، یافته B07-14): فیلدهای مودال سفارش خرید از هشدار نقطه سفارش. انبار مقصد سند مستقیم از فهرست انبارهای
 * فعال (`/warehouses`) انتخاب می‌شود و تاریخ با `JalaliDateInput` و حالت ISO است (AGENTS §۱.۱۰). پیش‌تر انبار setter نداشت
 * و کالا همیشه به انبار پیش‌فرض می‌رفت، و تاریخ یک کادر متنی بود که سند مستقیم اصلاً نشانش نمی‌داد.
 */
export function ReorderOrderFields(props: ReorderOrderFieldsProps) {
  const direct = props.orderTarget === 'direct_document';
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
      <div className="sm:col-span-2">
        <label className="block font-bold text-slate-700 mb-1">
          عنوان سفارش / درخواست <span className="text-rose-500">*</span>:
        </label>
        <input type="text" value={props.title} onChange={e => props.onTitleChange(e.target.value)} required className={FIELD} />
      </div>

      <div>
        <label className="block font-bold text-slate-700 mb-1">اولویت نیاز:</label>
        <select value={props.priority} onChange={e => props.onPriorityChange(e.target.value as ReorderPriority)} className={`${FIELD} font-bold`}>
          <option value="urgent">فوری / اضطراری</option>
          <option value="high">مهم</option>
          <option value="normal">عادی</option>
          <option value="low">کم‌اولویت</option>
        </select>
      </div>

      {direct && (
        <>
          <div className="sm:col-span-2">
            <label className="block font-bold text-slate-700 mb-1">
              نام تامین‌کننده / فروشنده <span className="text-rose-500">*</span>:
            </label>
            <SearchableSelect
              value={props.supplierName}
              onChange={props.onSupplierChange}
              placeholder="-- انتخاب یا جستجوی طرف‌حساب --"
              options={props.supplierOptions}
              className="w-full"
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">نوع و وضعیت سند:</label>
            <select value={props.docStatus} onChange={e => props.onDocStatusChange(e.target.value as ReorderDocStatus)} className={`${FIELD} font-bold`}>
              <option value="draft">پیش‌نویس سفارش خرید (عدم تغییر موجودی)</option>
              <option value="final">رسید قطعی ورود کالا به انبار (افزایش آنی موجودی)</option>
            </select>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="reorder-warehouse" className="block font-bold text-slate-700 mb-1">انبار مقصد:</label>
            <select
              id="reorder-warehouse"
              value={props.warehouseCode}
              onChange={e => props.onWarehouseChange(e.target.value)}
              className={`${FIELD} font-bold`}
            >
              {props.warehouses.map(w => <option key={w.id} value={w.code}>{w.name}</option>)}
            </select>
          </div>
        </>
      )}

      <div>
        <label className="block font-bold text-slate-700 mb-1">{direct ? 'تاریخ سند:' : 'تاریخ نیاز / تحویل:'}</label>
        <JalaliDateInput value={props.date} onChange={props.onDateChange} className={`${FIELD} font-mono text-center`} />
      </div>

      {direct && props.askDonated && (
        <label className="sm:col-span-3 flex items-start gap-2 p-3 bg-amber-50 border border-amber-300 rounded-lg text-amber-950 cursor-pointer">
          <input
            type="checkbox"
            checked={props.donatedConfirmed}
            onChange={e => props.onDonatedChange(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <span className="font-black">کالای اهدایی</span>: بهای ردیف‌های صفر درست است و این کالاها رایگان دریافت شده‌اند.
            رسید با میانگین موزون بهای فعلی هر کالا ثبت می‌شود و ارزش آن به «درآمد کالای اهدایی» می‌رود.
          </span>
        </label>
      )}

      <div className="sm:col-span-3">
        <label className="block font-bold text-slate-700 mb-1">یادداشت و توضیحات:</label>
        <input
          type="text"
          value={props.notes}
          onChange={e => props.onNotesChange(e.target.value)}
          placeholder="توضیحات تکمیلی پیرامون سفارش یا توافقات با تامین‌کننده..."
          className={FIELD}
        />
      </div>
    </div>
  );
}
