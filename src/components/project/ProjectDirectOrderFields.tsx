import { SearchableSelect } from '../SearchableSelect';
import { JalaliDateInput } from '../common/JalaliDateInput';
import type { WarehouseItem } from '../../hooks/queries/useSettingsQueries';

interface ProjectDirectOrderFieldsProps {
  supplierId: string;
  onSupplierChange: (id: string) => void;
  supplierOptions: Array<{ value: string; label: string }>;
  warehouses: WarehouseItem[];
  targetWarehouse: string;
  onWarehouseChange: (code: string) => void;
  requiredDate: string;
  onRequiredDateChange: (value: string) => void;
  notes: string;
  onNotesChange: (value: string) => void;
}

const fieldClass = 'w-full p-2 bg-white border border-slate-300 rounded-lg text-slate-800 focus:ring-2 focus:ring-amber-400 focus:outline-none';

/**
 * v9.0.416 (TD-745، تصمیم ت۸ ب): فیلدهای «سفارش مستقیم» صفحه پروژه؛ تأمین‌کننده و انبار مقصد فقط از فهرست، بی شماره دستی و
 * بی گزینه رسید قطعی. شماره سفارش را سامانه می‌دهد و کالا با «تحویل به انبار» تدارکات وارد انبار می‌شود.
 */
export function ProjectDirectOrderFields(props: ProjectDirectOrderFieldsProps) {
  const { supplierId, onSupplierChange, supplierOptions, warehouses, targetWarehouse, onWarehouseChange } = props;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
      <div>
        <label className="block font-bold text-slate-700 mb-1">تأمین‌کننده:</label>
        <SearchableSelect
          value={supplierId}
          onChange={(val) => onSupplierChange(val)}
          placeholder="-- انتخاب تأمین‌کننده --"
          options={supplierOptions}
          className="w-full"
        />
        {supplierOptions.length === 0 && (
          <p className="mt-1 text-[11px] text-rose-700">هنوز طرف حسابی از نوع «تأمین‌کننده» تعریف نشده است.</p>
        )}
      </div>

      <div>
        <label htmlFor="direct-order-warehouse" className="block font-bold text-slate-700 mb-1">انبار مقصد:</label>
        <select
          id="direct-order-warehouse"
          value={targetWarehouse}
          onChange={e => onWarehouseChange(e.target.value)}
          className={fieldClass}
        >
          {warehouses.length === 0 && <option value="">انبار فعالی یافت نشد</option>}
          {warehouses.map(w => (
            <option key={w.id} value={w.code}>{w.name} ({w.code})</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block font-bold text-slate-700 mb-1">تاریخ نیاز به کالا:</label>
        <JalaliDateInput
          value={props.requiredDate}
          onChange={props.onRequiredDateChange}
          placeholder="انتخاب تاریخ"
          className={`${fieldClass} font-mono`}
        />
      </div>

      <div>
        <label className="block font-bold text-slate-700 mb-1">یادداشت سفارش:</label>
        <input
          type="text"
          value={props.notes}
          onChange={e => props.onNotesChange(e.target.value)}
          className={fieldClass}
        />
      </div>

      <div className="sm:col-span-2 text-[11px] text-slate-700 bg-slate-100 p-2.5 rounded-lg">
        💡 درخواست خرید پروژه ثبت و به نام شما تأیید می‌شود و یک سفارش خرید پیش‌نویس با شماره سامانه برای این تأمین‌کننده صادر
        می‌شود. موجودی انبار تغییر نمی‌کند؛ کالا پس از رسیدن با «تحویل به انبار» در صفحه تدارکات وارد انبار می‌شود.
      </div>
    </div>
  );
}
