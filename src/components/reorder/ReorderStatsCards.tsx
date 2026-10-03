import { AlertTriangle, AlertCircle, Box, ShoppingCart } from 'lucide-react';
import { formatPersianPrice, formatPersianNumber } from '../../utils';

interface ReorderStatsCardsProps {
  totalAlarms: number;
  zeroStockCount: number;
  materialsCount: number;
  productsCount: number;
  totalDeficitCost: number;
}

/** کارت‌های خلاصه پایین صفحه نقطه سفارش */
export function ReorderStatsCards({ totalAlarms, zeroStockCount, materialsCount, productsCount, totalDeficitCost }: ReorderStatsCardsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 print:grid-cols-4">
      {/* Card 1: Total Alarms */}
      <div className="bg-white p-4 border rounded-xl shadow-xs flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-500 font-medium">کل اقلام در نقطه سفارش</p>
          <p className="text-2xl font-extrabold text-slate-800 mt-1">
            {formatPersianNumber(totalAlarms)} <span className="text-xs font-normal text-slate-400">قلم</span>
          </p>
        </div>
        <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center font-bold">
          <AlertTriangle size={20} />
        </div>
      </div>

      {/* Card 2: Zero Stock Items */}
      <div className="bg-white p-4 border rounded-xl shadow-xs flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-500 font-medium">اقلام کاملاً ناموجود (صفر)</p>
          <p className="text-2xl font-extrabold text-rose-600 mt-1">
            {formatPersianNumber(zeroStockCount)} <span className="text-xs font-normal text-rose-400">قلم</span>
          </p>
        </div>
        <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center font-bold">
          <AlertCircle size={20} />
        </div>
      </div>

      {/* Card 3: Products vs Materials breakdown */}
      <div className="bg-white p-4 border rounded-xl shadow-xs flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-500 font-medium">تفکیک تامین و تولید</p>
          <p className="text-xs font-bold text-slate-700 mt-2 flex items-center gap-2">
            <span className="text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">{formatPersianNumber(materialsCount)} خرید مواد</span>
            <span className="text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">{formatPersianNumber(productsCount)} تولید محصول</span>
          </p>
        </div>
        <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
          <Box size={20} />
        </div>
      </div>

      {/* Card 4: Estimated Deficit Value */}
      <div className="bg-white p-4 border rounded-xl shadow-xs flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-500 font-medium">مجموع ارزش برآوردی کسری</p>
          <p className="text-base font-extrabold text-blue-600 mt-1 font-mono">
            {formatPersianPrice(totalDeficitCost)}
          </p>
        </div>
        <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
          <ShoppingCart size={20} />
        </div>
      </div>
    </div>
  );
}
