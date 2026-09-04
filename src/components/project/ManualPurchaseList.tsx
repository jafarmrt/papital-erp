import React, { useState } from 'react';
import { 
  ShoppingCart, Plus, Printer, CheckCircle2, Trash2, FilePlus, ExternalLink, CheckSquare
} from 'lucide-react';
import { ProductionProject, PurchaseListItem, Item } from '../../types';
import { COMMON_UNITS, roundToOneDecimal } from './projectInventoryUtils';
import { CreatePurchaseOrderModal } from './CreatePurchaseOrderModal';

interface ManualPurchaseListProps {
  project: ProductionProject;
  purchaseList: PurchaseListItem[];
  isFinalized: boolean;
  warehouseItems?: Item[];
  handleAddManualPurchaseRow: () => void;
  handlePrintPurchaseListWithCheck: () => void;
  handleUpdateManualPurchaseItem: (id: string, field: keyof PurchaseListItem, value: any) => void;
  handleRemoveManualPurchaseItem: (id: string) => void;
  handleUpdateProcurementStatus: (itemId: string, newStatus: any) => void;
}

export function ManualPurchaseList({
  project,
  purchaseList,
  isFinalized,
  warehouseItems = [],
  handleAddManualPurchaseRow,
  handlePrintPurchaseListWithCheck,
  handleUpdateManualPurchaseItem,
  handleRemoveManualPurchaseItem,
  handleUpdateProcurementStatus
}: ManualPurchaseListProps) {
  const [isCreateOrderModalOpen, setIsCreateOrderModalOpen] = useState(false);
  const [lastCreatedOrderDoc, setLastCreatedOrderDoc] = useState<any>(null);

  // Count items that have actual shortfalls
  const shortfallCount = purchaseList.filter(i => 
    (i.convertedToPurchaseQty !== undefined && i.convertedToPurchaseQty > 0) || 
    (i.toPurchaseQty !== undefined && i.toPurchaseQty > 0)
  ).length;

  const handleOrderCreatedSuccess = (createdDoc: any, orderedItemIds: string[]) => {
    setLastCreatedOrderDoc(createdDoc);
    // Update procurement status of ordered items to 'in_progress'
    orderedItemIds.forEach(id => {
      handleUpdateProcurementStatus(id, 'in_progress');
    });
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-xs animate-fadeIn font-farsi text-xs">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3 print:border-b-2 print:border-slate-800">
        <div>
          <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-amber-600 print:text-slate-900" />
            لیست نهایی نیازمندی‌ها و کسری‌های خرید (پروژه: {project.project_code || project.title})
          </h4>
          <p className="text-xs text-slate-500 mt-0.5 print:hidden">
            اقلام زیر بر اساس ارزیابی مراحل فوق استخراج شده‌اند. می‌توانید اقلام دستی مجزا نیز اضافه کنید.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {shortfallCount > 0 && (
            <button
              type="button"
              onClick={() => setIsCreateOrderModalOpen(true)}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 transition-all shadow-xs cursor-pointer active:scale-98"
              title="ثبت سند پیش‌نویس سفارش خرید یا پیش‌فاکتور برای کسری‌های این پروژه"
            >
              <FilePlus className="w-4 h-4 text-emerald-100" />
              صدور سفارش خرید ({shortfallCount} کسری)
            </button>
          )}

          <button
            type="button"
            onClick={handleAddManualPurchaseRow}
            className="px-3.5 py-2 bg-amber-100 hover:bg-amber-200 text-amber-950 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-colors border border-amber-300 shadow-2xs cursor-pointer"
          >
            <Plus className="w-4 h-4 text-amber-800" />
            افزودن دستی به لیست خرید
          </button>
          <button
            type="button"
            onClick={handlePrintPurchaseListWithCheck}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            چاپ / خروجی PDF
          </button>
        </div>
      </div>

      {/* Purchase Order Notification Banner if created in session */}
      {lastCreatedOrderDoc && (
        <div className="bg-emerald-50 border border-emerald-300 rounded-xl p-3.5 flex items-center justify-between gap-3 text-emerald-950 print:hidden animate-fadeIn">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <div>
              <span className="font-bold text-xs">سند سفارش خرید برای کسری‌ها صادر شد: </span>
              <span className="font-mono font-bold bg-emerald-100 px-2 py-0.5 rounded-md border border-emerald-300 text-emerald-900">
                شماره سند: {lastCreatedOrderDoc.ref_number || lastCreatedOrderDoc.refNumber || '---'}
              </span>
              <span className="text-[11px] text-emerald-800 mr-2">
                وضعیت اقلام سفارش‌داده‌شده به «در حال سفارش/خرید» ارتقا یافت.
              </span>
            </div>
          </div>
          <a
            href="/invoices"
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] rounded-lg flex items-center gap-1 transition-colors shrink-0 shadow-2xs"
          >
            <span>مشاهده در فاکتورها</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      )}

      {/* Reserved Items in Warehouse Section */}
      {((project.inventory_control?.reservedItems && project.inventory_control.reservedItems.length > 0) || isFinalized) && (
        <div className="bg-purple-50/70 border border-purple-200 rounded-2xl p-4 sm:p-5 space-y-3 print:hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-purple-200 pb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-purple-600 text-white flex items-center justify-center font-bold text-sm shadow-xs shrink-0">
                🔒
              </div>
              <div>
                <h4 className="font-bold text-purple-950 text-sm">اقلام رزرو شده در انبار برای این پروژه</h4>
                <p className="text-xs text-purple-700">این اقلام در انبار اصلی فریز شده و فقط جهت صدور حواله خروج همین پروژه اختصاص دارند.</p>
              </div>
            </div>
            <span className="px-3 py-1 bg-purple-200 text-purple-950 rounded-full text-xs font-bold font-mono self-start sm:self-center">
              {project.inventory_control?.reservedItems?.length || 0} کالا رزرو شده
            </span>
          </div>

          {project.inventory_control?.reservedItems && project.inventory_control.reservedItems.length > 0 ? (
            <div className="overflow-x-auto border border-purple-200 rounded-xl bg-white shadow-xs">
              <table className="w-full text-xs text-right">
                <thead className="bg-purple-100/80 text-purple-950 font-bold border-b border-purple-200">
                  <tr>
                    <th className="p-2.5 text-center">#</th>
                    <th className="p-2.5">کد کالا</th>
                    <th className="p-2.5">عنوان / نام ماده اولیه</th>
                    <th className="p-2.5 text-center">مقدار رزرو شده</th>
                    <th className="p-2.5 text-center">مقدار درخواستی اولیه</th>
                    <th className="p-2.5 text-center">تاریخ رزرو</th>
                    <th className="p-2.5 text-center">وضعیت تخصیص</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-purple-100">
                  {project.inventory_control.reservedItems.map((rItem: any, idx: number) => (
                    <tr key={idx} className="hover:bg-purple-50/50">
                      <td className="p-2.5 text-center font-bold text-slate-500">{idx + 1}</td>
                      <td className="p-2.5 font-mono font-bold text-purple-900">{rItem.itemCode || '---'}</td>
                      <td className="p-2.5 font-bold text-slate-900">{rItem.itemName}</td>
                      <td className="p-2.5 text-center font-mono font-bold text-emerald-800">
                        <span className="px-2 py-0.5 bg-emerald-100 border border-emerald-300 rounded-md">
                          {rItem.reservedQty} {rItem.unit}
                        </span>
                      </td>
                      <td className="p-2.5 text-center font-mono text-slate-600">
                        {rItem.originalQty} {rItem.originalUnit || rItem.unit}
                      </td>
                      <td className="p-2.5 text-center text-slate-500 font-mono dir-ltr">
                        {rItem.reservedAt ? new Date(rItem.reservedAt).toLocaleDateString('fa-IR') : '---'}
                      </td>
                      <td className="p-2.5 text-center">
                        <span className="px-2 py-0.5 bg-purple-100 text-purple-900 font-bold rounded-md text-[10px] border border-purple-200">
                          فریز شده در انبار
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-xs text-purple-800 p-3 bg-white rounded-xl border border-purple-200 text-center">
              هنوز هیچ کالایی برای این پروژه رزرو نشده است. با کلیک روی «ثبت نهایی و فریز انبار» موجودی‌ها رزرو خواهند شد.
            </div>
          )}
        </div>
      )}

      {purchaseList.length === 0 ? (
        <div className="p-8 text-center bg-emerald-50 border border-emerald-200 rounded-2xl space-y-2">
          <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
          <h4 className="font-bold text-emerald-900 text-sm">تمام موارد در انبار موجود هستند!</h4>
          <p className="text-xs text-emerald-700">هیچ مورد کسری یا نیازمند خریدی برای این سفارش ثبت نشده است.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-800 text-white font-bold">
              <tr>
                <th className="p-3 border-b border-slate-700 text-center">ردیف</th>
                <th className="p-3 border-b border-slate-700">بخش / دسته کنترل</th>
                <th className="p-3 border-b border-slate-700">شرح کالا / نیازمندی تامین</th>
                <th className="p-3 border-b border-slate-700 text-center">مقدار مورد نیاز اولیه</th>
                <th className="p-3 border-b border-slate-700 text-center">موجودی فعلی انبار</th>
                <th className="p-3 border-b border-slate-700 text-center">واحد و ضریب تبدیل (انبار)</th>
                <th className="p-3 border-b border-slate-700 text-center">مقدار کسری نهایی (خرید)</th>
                <th className="p-3 border-b border-slate-700">وضعیت تامین و پیگیری</th>
                <th className="p-3 border-b border-slate-700">توضیحات</th>
                <th className="p-3 border-b border-slate-700 text-center print:hidden">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {purchaseList.map((item, idx) => (
                <tr key={item.id || idx} className={`hover:bg-slate-50 ${item.id.startsWith('manual_') ? 'bg-amber-50/30' : ''}`}>
                  <td className="p-3 font-bold text-slate-500 text-center">{idx + 1}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 font-bold rounded-md text-[11px] ${
                      item.id.startsWith('manual_') 
                        ? 'bg-amber-100 text-amber-900 border border-amber-300' 
                        : 'bg-slate-100 text-slate-800'
                    }`}>
                      {item.id.startsWith('manual_') ? 'اقلام دستی' : item.category}
                    </span>
                  </td>
                  <td className="p-3 font-bold text-slate-900 min-w-[200px]">
                    {item.id.startsWith('manual_') ? (
                      <div className="space-y-1">
                        <input
                          type="text"
                          value={item.itemName}
                          onChange={(e) => handleUpdateManualPurchaseItem(item.id, 'itemName', e.target.value)}
                          placeholder="عنوان / شرح نیازمندی کالا *"
                          className="w-full px-2.5 py-1.5 bg-amber-50/70 border border-amber-300 rounded-lg font-bold text-xs text-slate-900 focus:ring-2 focus:ring-amber-500 focus:outline-none print:hidden"
                        />
                        <input
                          type="text"
                          value={item.itemCode || ''}
                          onChange={(e) => handleUpdateManualPurchaseItem(item.id, 'itemCode', e.target.value)}
                          placeholder="کد کالا (اختیاری)"
                          className="w-full px-2.5 py-1 bg-white border border-slate-200 rounded-md font-mono text-[10px] text-slate-600 focus:outline-none print:hidden"
                        />
                        <div className="hidden print:block font-bold">
                          {item.itemName || 'کالای دستی بدون عنوان'} {item.itemCode ? `(${item.itemCode})` : ''}
                        </div>
                      </div>
                    ) : (
                      <>
                        {item.itemName}
                        {item.itemCode && (
                          <span className="block font-mono text-[10px] text-slate-500">کد: {item.itemCode}</span>
                        )}
                      </>
                    )}
                  </td>
                  <td className="p-3 text-center font-mono font-bold text-slate-800">
                    {item.id.startsWith('manual_') ? (
                      <>
                        <div className="flex items-center justify-center gap-1 print:hidden">
                          <input
                            type="number"
                            min="0.001"
                            step="any"
                            value={item.totalRequiredQty}
                            onChange={(e) => handleUpdateManualPurchaseItem(item.id, 'totalRequiredQty', Number(e.target.value))}
                            className="w-16 px-2 py-1 bg-amber-50/70 border border-amber-300 rounded-lg text-center font-mono font-bold text-xs text-slate-900 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                          />
                          <select
                            value={item.unit}
                            onChange={(e) => handleUpdateManualPurchaseItem(item.id, 'unit', e.target.value)}
                            className="px-1.5 py-1 bg-white border border-slate-200 rounded-lg text-[11px] font-bold text-slate-800 focus:outline-none cursor-pointer"
                          >
                            {COMMON_UNITS.map(u => (
                              <option key={u} value={u}>{u}</option>
                            ))}
                          </select>
                        </div>
                        <span className="hidden print:inline font-mono font-bold">{item.totalRequiredQty} {item.unit}</span>
                      </>
                    ) : (
                      <>{item.totalRequiredQty} {item.unit}</>
                    )}
                  </td>
                  <td className="p-3 text-center font-mono text-slate-600">
                    {item.id.startsWith('manual_') ? `0 ${item.unit}` : `${item.warehouseStockQty} ${item.warehouseUnit || item.unit}`}
                  </td>
                  <td className="p-3 text-center font-mono font-bold">
                    {item.convertedRequiredQty ? (
                      <div className="space-y-0.5">
                        <span className="px-2 py-0.5 bg-blue-50 text-blue-900 rounded border border-blue-200 text-xs inline-block">
                          {roundToOneDecimal(item.convertedRequiredQty)} {item.convertedUnit}
                        </span>
                        {item.conversionRate && (
                          <span className="block text-[10px] text-slate-500 font-normal">
                            (هر {item.convertedUnit} = {roundToOneDecimal(item.conversionRate)} {item.unit})
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-400 font-normal text-[11px]">— همان واحد اولیه —</span>
                    )}
                  </td>
                  <td className="p-3 text-center font-mono font-bold">
                    {item.convertedToPurchaseQty !== undefined ? (
                      <span className="px-2.5 py-1 bg-amber-100 text-amber-950 rounded-lg border border-amber-300">
                        {roundToOneDecimal(item.convertedToPurchaseQty)} {item.convertedUnit}
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 bg-amber-100 text-amber-950 rounded-lg border border-amber-300">
                        {roundToOneDecimal(item.toPurchaseQty)} {item.unit}
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    <select
                      value={item.procurementStatus || 'pending'}
                      onChange={(e) => handleUpdateProcurementStatus(item.id, e.target.value as any)}
                      className={`px-2 py-1 rounded-xl font-bold text-xs border cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-500 transition-colors print:hidden ${
                        item.procurementStatus === 'fulfilled'
                          ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                          : item.procurementStatus === 'in_progress'
                          ? 'bg-blue-100 text-blue-900 border-blue-300'
                          : item.procurementStatus === 'reserved'
                          ? 'bg-purple-100 text-purple-900 border-purple-300'
                          : 'bg-amber-100 text-amber-950 border-amber-300'
                      }`}
                    >
                      <option value="pending">در انتظار تامین</option>
                      <option value="in_progress">در حال سفارش/ساخت</option>
                      <option value="reserved">رزرو انبار</option>
                      <option value="fulfilled">تحویل شده (تکمیل)</option>
                    </select>
                    <span className={`hidden print:inline-block px-2.5 py-1 rounded-xl font-bold text-[11px] ${
                      item.procurementStatus === 'fulfilled'
                        ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                        : item.procurementStatus === 'in_progress'
                        ? 'bg-blue-100 text-blue-900 border border-blue-300'
                        : item.procurementStatus === 'reserved'
                        ? 'bg-purple-100 text-purple-900 border border-purple-300'
                        : 'bg-amber-100 text-amber-950 border border-amber-300'
                    }`}>
                      {item.procurementStatus === 'fulfilled' ? 'تحویل شده (تکمیل)' :
                       item.procurementStatus === 'in_progress' ? 'در حال سفارش/ساخت' :
                       item.procurementStatus === 'reserved' ? 'رزرو انبار' : 'در انتظار تامین'}
                    </span>
                  </td>
                  <td className="p-3 text-slate-600">
                    {item.id.startsWith('manual_') ? (
                      <div>
                        <input
                          type="text"
                          value={item.notes || ''}
                          onChange={(e) => handleUpdateManualPurchaseItem(item.id, 'notes', e.target.value)}
                          placeholder="توضیحات و نکات خرید..."
                          className="w-full px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none print:hidden"
                        />
                        <span className="hidden print:inline text-slate-600">{item.notes || '---'}</span>
                      </div>
                    ) : (
                      item.notes || '---'
                    )}
                  </td>
                  <td className="p-3 text-center print:hidden">
                    {item.id.startsWith('manual_') ? (
                      <button
                        type="button"
                        onClick={() => handleRemoveManualPurchaseItem(item.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                        title="حذف ردیف دستی"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    ) : (
                      <span className="text-slate-300 text-[10px]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer Print Signatures */}
      <div className="hidden print:flex justify-between items-end pt-12 text-xs font-bold text-slate-800">
        <div>امضاء و تایید مسئول انبار: ....................</div>
        <div>امضاء و تایید سرپرست تولید: ....................</div>
        <div>تاريخ: ....................</div>
      </div>

      {/* Create Purchase Order Modal */}
      <CreatePurchaseOrderModal
        isOpen={isCreateOrderModalOpen}
        onClose={() => setIsCreateOrderModalOpen(false)}
        project={project}
        purchaseList={purchaseList}
        warehouseItems={warehouseItems}
        onOrderCreated={handleOrderCreatedSuccess}
      />
    </div>
  );
}
