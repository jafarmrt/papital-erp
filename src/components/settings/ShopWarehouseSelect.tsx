import { Warehouse } from 'lucide-react';
import type { WarehouseItem } from '../../hooks/queries/useSettingsQueries';

interface ShopWarehouseSelectProps {
  value: string;
  onChange: (code: string) => void;
  warehouses: WarehouseItem[];
}

/**
 * v8.0.44 (TD-293، تصمیم مالک محصول — گزینه الف): «انبار فروشگاه اینترنتی». فاکتور سفارش‌های ووکامرس از همین انبار کم می‌کند و
 * همگام‌سازی موجودی، موجودی قابل فروش همین انبار (موجودی منهای رزرو) را به فروشگاه می‌فرستد. خالی یعنی انبار پیش‌فرض.
 */
export function ShopWarehouseSelect({ value, onChange, warehouses }: ShopWarehouseSelectProps) {
  const active = (Array.isArray(warehouses) ? warehouses : []).filter(w => Number(w.is_active) === 1);
  return (
    <div className="bg-white/90 border border-blue-200 rounded-lg p-3 space-y-2">
      <label htmlFor="wc-shop-warehouse" className="block text-xs font-bold text-blue-950 flex items-center gap-1.5">
        <Warehouse size={14} className="text-emerald-600" />
        انبار فروشگاه اینترنتی
      </label>
      <select
        id="wc-shop-warehouse"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full border border-slate-300 rounded px-3 py-1.5 text-xs bg-slate-50 outline-none focus:ring-1 focus:ring-blue-500"
      >
        <option value="">انبار پیش‌فرض سامانه</option>
        {active.map(w => (
          <option key={w.id} value={w.code}>{w.name} ({w.code})</option>
        ))}
      </select>
      <p className="text-[11px] text-slate-500 leading-normal">
        فاکتور سفارش‌های فروشگاه از همین انبار کم می‌شود و «همگام‌سازی موجودی» موجودی قابل فروش همین انبار (موجودی منهای رزرو پروژه‌ها و پیش‌فاکتورها) را به فروشگاه می‌فرستد.
      </p>
    </div>
  );
}
