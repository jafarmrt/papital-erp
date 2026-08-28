import React from 'react';
import { 
  ShieldCheck, 
  Layers, 
  AlertTriangle, 
  TrendingDown, 
  DollarSign, 
  Warehouse, 
  Search, 
  Download, 
  RefreshCw, 
  RotateCcw,
  CheckCircle2,
  XCircle,
  Eye
} from 'lucide-react';
import { formatPersianPrice, formatPersianNumber, formatCurrencyLabel } from '../../utils';
import { useAppCurrency } from '../../hooks/useAppCurrency';

interface Inventory3WayIntegrityTabProps {
  integrityReport: any;
  integrityLoading: boolean;
  integritySearch: string;
  setIntegritySearch: (val: string) => void;
  integrityDiscrepancyOnly: boolean;
  setIntegrityDiscrepancyOnly: (val: boolean) => void;
  filteredIntegrityItems: any[];
  loadIntegrityReport: () => void;
  onOpenRebuildModal: (itemId?: number) => void;
  onOpenKardexModal?: (itemId: number) => void;
  onExportExcel: () => void;
}

export function Inventory3WayIntegrityTab({
  integrityReport,
  integrityLoading,
  integritySearch,
  setIntegritySearch,
  integrityDiscrepancyOnly,
  setIntegrityDiscrepancyOnly,
  filteredIntegrityItems,
  loadIntegrityReport,
  onOpenRebuildModal,
  onOpenKardexModal,
  onExportExcel
}: Inventory3WayIntegrityTabProps) {
  const appCurrency = useAppCurrency();
  const curLbl = formatCurrencyLabel(appCurrency);
  return (
    <div className="space-y-6">
      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Health Score */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 text-xs">
            <span>شاخص سلامت انبار</span>
            <ShieldCheck className="text-blue-600" size={18} />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900 font-mono">
              {integrityReport?.summary?.healthScorePercentage ?? 100}٪
            </span>
            <span className="text-xs text-slate-500 font-medium">انطباق ریاضی</span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-1.5 mt-2 overflow-hidden">
            <div 
              className={`h-1.5 rounded-full ${
                (integrityReport?.summary?.healthScorePercentage ?? 100) >= 95 
                  ? 'bg-emerald-500' 
                  : (integrityReport?.summary?.healthScorePercentage ?? 100) >= 80 
                    ? 'bg-amber-500' 
                    : 'bg-rose-500'
              }`}
              style={{ width: `${integrityReport?.summary?.healthScorePercentage ?? 100}%` }}
            />
          </div>
        </div>

        {/* Total Items & Synchronized */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 text-xs">
            <span>اقلام کاتالوگ انبار</span>
            <Layers className="text-slate-600" size={18} />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900 font-mono">
              {formatPersianNumber(integrityReport?.summary?.totalItems || 0)}
            </span>
            <span className="text-xs text-emerald-600 font-bold">
              {formatPersianNumber(integrityReport?.summary?.synchronizedItems || 0)} منطبق
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">تطبیق داده شده در ۳ لایه</p>
        </div>

        {/* Discrepancies Alert */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 text-xs">
            <span>مغایرت‌های شناسایی‌شده</span>
            <AlertTriangle className={integrityReport?.summary?.discrepancyItems > 0 ? "text-amber-500" : "text-slate-400"} size={18} />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className={`text-2xl font-black font-mono ${integrityReport?.summary?.discrepancyItems > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
              {formatPersianNumber(integrityReport?.summary?.discrepancyItems || 0)}
            </span>
            <span className="text-xs text-slate-500">قلم کالا</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">اختلاف اسمی با کاردکس یا JSONB</p>
        </div>

        {/* Negative Stocks Alert */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 text-xs">
            <span>موجودی منفی در انبار</span>
            <TrendingDown className={integrityReport?.summary?.negativeStockItems > 0 ? "text-rose-500" : "text-slate-400"} size={18} />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className={`text-2xl font-black font-mono ${integrityReport?.summary?.negativeStockItems > 0 ? 'text-rose-600' : 'text-slate-800'}`}>
              {formatPersianNumber(integrityReport?.summary?.negativeStockItems || 0)}
            </span>
            <span className="text-xs text-slate-500">قلم بحرانی</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">نیاز به تسویه و اصلاح کاردکس</p>
        </div>

        {/* Inventory Valuation */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 text-xs">
            <span>ارزش موجودی انبار</span>
            <DollarSign className="text-emerald-600" size={18} />
          </div>
          <div className="mt-3">
            <div className="text-lg font-black text-slate-900 font-mono truncate">
              {formatPersianPrice(integrityReport?.summary?.totalInventoryValuationStored || 0)}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">{`${curLbl} (مبتنی بر WAC)`}</div>
          </div>
        </div>
      </div>

      {/* Warehouses Breakdown Banner */}
      <div className="bg-slate-900 text-white rounded-2xl p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 font-bold text-slate-200">
            <Warehouse size={18} className="text-blue-400" />
            <span className="text-sm">توزیع موجودی در انبارها و انطباق کاردکس</span>
          </div>
          <span className="text-slate-400 text-xs">
            تعداد انبارهای فعال: {integrityReport?.warehouses?.length || 0}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {integrityReport?.warehouses?.map((wh: any) => {
            const isBalanced = Math.abs(wh.variance) < 0.0001;
            return (
              <div key={wh.code} className="bg-slate-800/90 border border-slate-700/60 p-3 rounded-xl text-xs space-y-1.5">
                <div className="flex justify-between items-center text-slate-200 font-bold">
                  <span>{wh.name} ({wh.code})</span>
                  {isBalanced ? (
                    <span className="text-emerald-400 text-[10px] bg-emerald-950/80 border border-emerald-800 px-1.5 py-0.5 rounded font-bold">
                      ✓ همگام
                    </span>
                  ) : (
                    <span className="text-amber-400 text-[10px] bg-amber-950/80 border border-amber-800 px-1.5 py-0.5 rounded font-mono font-bold">
                      مغایرت: {formatPersianNumber(wh.variance)}
                    </span>
                  )}
                </div>
                <div className="flex justify-between items-center text-slate-400 text-[11px]">
                  <span>ثبت جاری:</span>
                  <span className="font-mono text-slate-200 font-bold">{formatPersianNumber(wh.totalStockJsonb)}</span>
                </div>
                <div className="flex justify-between items-center text-slate-400 text-[11px]">
                  <span>کاردکس:</span>
                  <span className="font-mono text-slate-200">{formatPersianNumber(wh.totalStockLedger)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Search */}
          <div className="relative min-w-[220px]">
            <Search className="absolute right-3 top-2.5 text-slate-400" size={16} />
            <input
              type="text"
              placeholder="جستجو بر اساس نام، کد یا دسته‌بندی کالا..."
              value={integritySearch}
              onChange={(e) => setIntegritySearch(e.target.value)}
              className="w-full pl-3 pr-9 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Discrepancy Toggle */}
          <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-700 bg-slate-100 px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-200 transition-colors">
            <input
              type="checkbox"
              checked={integrityDiscrepancyOnly}
              onChange={(e) => setIntegrityDiscrepancyOnly(e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
            />
            <span>فقط نمایش موارد دارای مغایرت و عدم انطباق</span>
          </label>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onExportExcel}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <Download size={15} />
            <span>خروجی اکسل گزارش سلامت</span>
          </button>

          <button
            onClick={loadIntegrityReport}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <RefreshCw size={15} className={integrityLoading ? "animate-spin" : ""} />
            <span>به‌روزرسانی جدول</span>
          </button>
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="bg-slate-100/80 border-b border-slate-200 text-slate-700 font-bold">
                <th className="py-3 px-3 text-center">ردیف</th>
                <th className="py-3 px-3">کد کالا</th>
                <th className="py-3 px-4">نام کالا و دسته‌بندی</th>
                <th className="py-3 px-3 text-center">واحد</th>
                <th className="py-3 px-3 text-center bg-blue-50/60 text-blue-900 border-x border-blue-100">
                  موجودی اسمی (Current)
                </th>
                <th className="py-3 px-3 text-center bg-indigo-50/60 text-indigo-900 border-x border-indigo-100">
                  تفکیک انبارها (JSONB)
                </th>
                <th className="py-3 px-3 text-center bg-amber-50/60 text-amber-900 border-x border-amber-100">
                  موجودی کاردکس (Ledger)
                </th>
                <th className="py-3 px-3 text-center">مغایرت مقداری</th>
                <th className="py-3 px-3 text-center">میانگین موزون (WAC)</th>
                <th className="py-3 px-3 text-center">وضعیت انطباق</th>
                <th className="py-3 px-3 text-center">عملیات اصلاحی</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {integrityLoading ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-slate-400 font-medium">
                    <RefreshCw className="animate-spin inline-block mr-2" size={16} />
                    در حال ممیزی و محاسبات تطبیقی ۳ جانبه انبار و کاردکس...
                  </td>
                </tr>
              ) : filteredIntegrityItems.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-slate-400 font-medium">
                    هیچ کالایی با فیلترهای انتخابی یافت نشد.
                  </td>
                </tr>
              ) : (
                filteredIntegrityItems.map((item: any, idx: number) => {
                  const hasDiscrepancy = !item.isSynchronized;
                  const isNegative = item.currentStock < 0 || item.ledgerStock < 0;

                  return (
                    <tr 
                      key={item.itemId} 
                      className={`hover:bg-slate-50 transition-colors ${
                        hasDiscrepancy ? 'bg-amber-50/30' : ''
                      } ${isNegative ? 'bg-rose-50/30' : ''}`}
                    >
                      <td className="py-3 px-3 text-center font-mono text-slate-400">{formatPersianNumber(idx + 1)}</td>
                      <td className="py-3 px-3 font-mono font-bold text-slate-800">{item.itemCode}</td>
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">{item.itemName}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">{item.category}</div>
                      </td>
                      <td className="py-3 px-3 text-center text-slate-600">{item.unit || 'عدد'}</td>

                      {/* Current Stock */}
                      <td className="py-3 px-3 text-center font-mono font-bold bg-blue-50/30 border-x border-blue-100 text-blue-900">
                        {formatPersianNumber(item.currentStock)}
                      </td>

                      {/* JSONB Sum */}
                      <td className="py-3 px-3 text-center font-mono font-bold bg-indigo-50/30 border-x border-indigo-100 text-indigo-900">
                        {formatPersianNumber(item.warehouseStocksSum)}
                      </td>

                      {/* Ledger Stock */}
                      <td className="py-3 px-3 text-center font-mono font-bold bg-amber-50/30 border-x border-amber-100 text-amber-900">
                        {formatPersianNumber(item.ledgerStock)}
                        <div className="text-[10px] text-slate-400 font-normal">({formatPersianNumber(item.transactionCount)} تراکنش)</div>
                      </td>

                      {/* Variance */}
                      <td className="py-3 px-3 text-center font-mono font-bold">
                        {item.variance === 0 ? (
                          <span className="text-slate-400">۰</span>
                        ) : (
                          <span className="text-rose-600 dir-ltr inline-block">
                            {item.variance > 0 ? `+${item.variance}` : item.variance}
                          </span>
                        )}
                      </td>

                      {/* WAC */}
                      <td className="py-3 px-3 text-center font-mono text-slate-700">
                        <div>{formatPersianPrice(item.storedWac)}</div>
                        {item.storedWac !== item.recalculatedWac && (
                          <div className="text-[10px] text-amber-600" title="بازسازی شده از کاردکس">
                            محاسبه‌شده: {formatPersianPrice(item.recalculatedWac)}
                          </div>
                        )}
                      </td>

                      {/* Status Badge */}
                      <td className="py-3 px-3 text-center">
                        {item.isSynchronized ? (
                          <span className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-800 text-[11px] font-bold px-2 py-0.5 rounded-full">
                            <CheckCircle2 size={13} />
                            <span>کامل منطبق</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-800 text-[11px] font-bold px-2 py-0.5 rounded-full" title={item.discrepancyType}>
                            <XCircle size={13} />
                            <span>دارای عدم انطباق</span>
                          </span>
                        )}
                      </td>

                      {/* Action */}
                      <td className="py-3 px-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {onOpenKardexModal && (
                            <button
                              onClick={() => onOpenKardexModal(item.itemId)}
                              className="p-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg transition-colors cursor-pointer"
                              title="مشاهده کاردکس تفصیلی کالا"
                            >
                              <Eye size={13} />
                            </button>
                          )}
                          <button
                            onClick={() => onOpenRebuildModal(item.itemId)}
                            className="px-2 py-1 bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1"
                            title="بازسازی کاردکس و همگام‌سازی مانده"
                          >
                            <RotateCcw size={12} />
                            <span>بازسازی</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
