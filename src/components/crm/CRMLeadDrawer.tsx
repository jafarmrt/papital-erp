import { useState, useEffect, useEffectEvent } from 'react';
import { Edit3, Trash2, Clock, Check, FileText, Search, Package, Copy, Building2 } from 'lucide-react';
import { CRMLead, CRMActivity, Item } from '../../types';
import { getActivityTypeBadge } from './CRMFollowupsView';
import { ActivityRowActions } from './ActivityRowActions';
import { formatPersianNumber, formatPersianPhone, formatPersianDate, formatPersianCode } from '../../utils';
import { useRialDisplay } from '../../hooks/useAppCurrency';
import { toast } from 'react-hot-toast';
import { copyToClipboard } from '../../utils/clipboard';
import { useCrmStockItemsQuery } from '../../hooks/queries/useCrmQueries';
import { useWarehousesQuery, type WarehouseItem } from '../../hooks/queries/useSettingsQueries';
import { useOpeningRead } from '../../hooks/queries/readOnEveryOpening';
import { DialogLayer } from '../common/DialogLayer';
import { activityResultLabel } from '../../lib/crm/crmScreenText';
import { CrmAttachmentsPanel } from './CrmAttachmentsPanel';
import { useHasPermission } from '../../contexts/AuthContext';
import type { CrmAttachmentView } from '../../lib/crm/crmAttachments';

const NO_ITEMS: Item[] = [];
const NO_WAREHOUSES: WarehouseItem[] = [];

interface CRMLeadDrawerProps {
  selectedLeadDrawer: CRMLead | null;
  onCloseDrawer: () => void;
  drawerActivities: CRMActivity[];
  /** v10.2 package 7 review (N-5): the sales file's attachments from its detail, shown while the box reads them again */
  drawerAttachments?: CrmAttachmentView[];
  onOpenActivityModal: (lead: CRMLead, defaultType?: string) => void;
  onOpenLeadModal: (lead: CRMLead) => void;
  /** v9.0.148 (TD-893): فقط برای دارنده `crm.delete`؛ بی آن دکمه حذف نیست */
  onDeleteLead?: (leadId: number) => void;
  onToggleFollowup: (act: CRMActivity) => void;
  /** v10.1.18 (N-02 بخش ۲): ویرایش و حذف اقدام */
  onEditActivity?: (act: CRMActivity) => void;
  onDeleteActivity?: (act: CRMActivity) => void;
  onConvertToInvoice?: (lead: CRMLead) => void;
  /** v10.2 package 7 (OBS-R2-24): the page opens the dossier of the file's own party */
  onOpenCustomerDossier?: (lead: CRMLead) => void;
}

export function CRMLeadDrawer({
  selectedLeadDrawer,
  onCloseDrawer,
  drawerActivities,
  drawerAttachments,
  onOpenActivityModal,
  onOpenLeadModal,
  onDeleteLead,
  onToggleFollowup,
  onEditActivity,
  onDeleteActivity,
  onConvertToInvoice,
  onOpenCustomerDossier
}: CRMLeadDrawerProps) {
  const rial = useRialDisplay();
  const [activeTab, setActiveTab] = useState<'activities' | 'stock'>('activities');
  const [stockSearchTerm, setStockSearchTerm] = useState('');
  // v10.2 package 7: the sales file's attachments; the drawer does not close while a file is being sent
  const canViewAttachments = useHasPermission('crm.view');
  const [attachmentsBusy, setAttachmentsBusy] = useState(false);
  const closeDrawer = () => {
    if (!attachmentsBusy) onCloseDrawer();
  };

  // 10.3 (ARCH review finding 3, part 12): the stock tab reads the items and warehouses through the shared cache, again
  // each time it opens (before, once per page visit), and a stock change refreshes it while it is open
  const stockOpen = activeTab === 'stock' && selectedLeadDrawer !== null;
  const itemsRead = useOpeningRead(useCrmStockItemsQuery(stockOpen), stockOpen);
  const warehousesRead = useOpeningRead(useWarehousesQuery({ enabled: stockOpen, readOnEveryOpening: true }), stockOpen);
  const items: Item[] = itemsRead.data ?? NO_ITEMS;
  const warehouses = warehousesRead.data ?? NO_WAREHOUSES;
  const stockFailedAt = Math.max(itemsRead.failedAt, warehousesRead.failedAt);
  const isLoadingStock = stockOpen && (itemsRead.data === undefined || warehousesRead.data === undefined) && stockFailedAt === 0;
  // one message when both reads fail, each at its own moment (review N1)
  const sayStockFailed = useEffectEvent(() => { toast.error('خطا در دریافت اطلاعات موجودی انبارها', { id: 'crm-stock-failed' }); });
  useEffect(() => {
    if (stockFailedAt) sayStockFailed();
  }, [stockFailedAt]);

  if (!selectedLeadDrawer) return null;

  const safeItemsList = Array.isArray(items) ? items : [];
  const filteredItems = safeItemsList.filter((item) => {
    if (!stockSearchTerm.trim()) return true;
    const term = stockSearchTerm.toLowerCase();
    return (
      item.code.toLowerCase().includes(term) ||
      item.name.toLowerCase().includes(term) ||
      (item.category && item.category.toLowerCase().includes(term))
    );
  });

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[60] bg-slate-900/50 backdrop-blur-xs flex justify-end">
      <DialogLayer onClose={closeDrawer} disabled={attachmentsBusy} />
      <div className="bg-white w-full md:w-[60%] lg:w-[60%] max-w-[60vw] h-full shadow-2xl flex flex-col p-6 overflow-y-auto custom-scrollbar animate-in slide-in-from-left duration-200">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-3 shrink-0">
          <div>
            <span className="px-2 py-0.5 bg-blue-100 text-blue-800 text-[10px] font-black rounded-md">
              پرونده فروش #{formatPersianCode(selectedLeadDrawer.id)}
            </span>
            <h3 className="font-black text-base text-slate-900 mt-1">{selectedLeadDrawer.title}</h3>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => onOpenLeadModal(selectedLeadDrawer)}
              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
              title="ویرایش پرونده"
            >
              <Edit3 size={13} />
              <span className="hidden sm:inline">ویرایش</span>
            </button>
            {onDeleteLead && (
              <button
                onClick={() => onDeleteLead(selectedLeadDrawer.id)}
                className="px-2.5 py-1 bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                title="حذف پرونده"
              >
                <Trash2 size={13} />
                <span className="hidden sm:inline">حذف</span>
              </button>
            )}
            <button
              onClick={closeDrawer}
              disabled={attachmentsBusy}
              aria-label="بستن"
              className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 cursor-pointer ml-1 text-xs"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Lead Meta Info Box */}
        <div className="bg-slate-50 border border-slate-200/90 rounded-2xl p-3.5 space-y-2.5 mb-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div>
              <span className="text-slate-400 block text-[10px]">خریدار / مخاطب:</span>
              {selectedLeadDrawer.customerName && onOpenCustomerDossier ? (
                <button
                  onClick={() => onOpenCustomerDossier(selectedLeadDrawer)}
                  className="font-black text-xs text-blue-700 hover:text-blue-900 hover:underline cursor-pointer inline-flex items-center gap-1 mt-0.5"
                  title="مشاهده پرونده جامع این مشتری"
                >
                  <Building2 size={12} className="text-blue-600 shrink-0" />
                  <span>{selectedLeadDrawer.customerName}</span>
                </button>
              ) : (
                <span className="font-bold text-xs text-slate-800 mt-0.5 block">{selectedLeadDrawer.customerName || '-'}</span>
              )}
            </div>
            <div>
              <span className="text-slate-400 block text-[10px]">تلفن تماس:</span>
              <span className="font-bold text-slate-800 dir-ltr text-right block mt-0.5">
                {selectedLeadDrawer.phone ? formatPersianPhone(selectedLeadDrawer.phone) : '-'}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px]">ارزش تخمینی:</span>
              <span className="font-black text-amber-600 block mt-0.5">{rial.money(selectedLeadDrawer.estimatedValue, selectedLeadDrawer.currency)}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px]">فروشنده مسئول:</span>
              <span className="font-bold text-slate-800 block mt-0.5">{selectedLeadDrawer.assignedTo || '-'}</span>
            </div>
          </div>

          {selectedLeadDrawer.company && (
            <div className="text-xs text-slate-600">
              <span className="text-slate-400 text-[10px]">شرکت / مجموعه: </span>
              <span className="font-bold text-slate-700">{selectedLeadDrawer.company}</span>
            </div>
          )}

          {Array.isArray(selectedLeadDrawer.contacts) && selectedLeadDrawer.contacts.length > 0 && (
            <div className="pt-2 border-t border-slate-200 space-y-1">
              <span className="font-bold text-[11px] text-slate-700 block">اشخاص مرتبط و مخاطبین:</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {selectedLeadDrawer.contacts.map((c: any, idx: number) => (
                  <div key={idx} className="bg-slate-50 p-1.5 rounded-lg border border-slate-200/60 text-[11px] flex items-center justify-between">
                    <div>
                      <span className="font-bold text-slate-800">{c.name || 'بدون نام'}</span>
                      {c.role && <span className="text-[10px] text-slate-500 mr-1.5">({c.role})</span>}
                    </div>
                    {c.phone && (
                      <a href={`tel:${c.phone}`} className="font-mono text-blue-600 hover:underline text-[10px] dir-ltr">
                        {c.phone}
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {selectedLeadDrawer.notes && (
            <div className="pt-2 border-t border-slate-200 text-xs text-slate-600">
              <span className="font-bold text-slate-700 block mb-0.5">یادداشت کلی:</span>
              {selectedLeadDrawer.notes}
            </div>
          )}

          <div className="pt-2 border-t border-slate-200 flex items-center justify-between gap-2 overflow-x-auto custom-scrollbar">
            <div className="flex items-center gap-1 text-[11px] font-bold shrink-0">
              <span className="text-slate-500 text-[10px] ml-1">ثبت سریع:</span>
              <button
                onClick={() => onOpenActivityModal(selectedLeadDrawer, 'call')}
                className="px-2 py-0.5 bg-white hover:bg-blue-50 text-blue-700 border border-slate-200 hover:border-blue-300 rounded-md transition-all flex items-center gap-1 cursor-pointer shadow-2xs"
                title="ثبت تماس تلفنی"
              >
                📞 <span className="text-[10px]">تماس</span>
              </button>
              <button
                onClick={() => onOpenActivityModal(selectedLeadDrawer, 'meeting')}
                className="px-2 py-0.5 bg-white hover:bg-purple-50 text-purple-700 border border-slate-200 hover:border-purple-300 rounded-md transition-all flex items-center gap-1 cursor-pointer shadow-2xs"
                title="ثبت جلسه"
              >
                👥 <span className="text-[10px]">جلسه</span>
              </button>
              <button
                onClick={() => onOpenActivityModal(selectedLeadDrawer, 'whatsapp')}
                className="px-2 py-0.5 bg-white hover:bg-emerald-50 text-emerald-700 border border-slate-200 hover:border-emerald-300 rounded-md transition-all flex items-center gap-1 cursor-pointer shadow-2xs"
                title="ثبت واتساپ"
              >
                💬 <span className="text-[10px]">واتساپ</span>
              </button>
              <button
                onClick={() => onOpenActivityModal(selectedLeadDrawer, 'email')}
                className="px-2 py-0.5 bg-white hover:bg-indigo-50 text-indigo-700 border border-slate-200 hover:border-indigo-300 rounded-md transition-all flex items-center gap-1 cursor-pointer shadow-2xs"
                title="ثبت ایمیل"
              >
                ✉️ <span className="text-[10px]">ایمیل</span>
              </button>
              <button
                onClick={() => onOpenActivityModal(selectedLeadDrawer, 'quote')}
                className="px-2 py-0.5 bg-white hover:bg-amber-50 text-amber-800 border border-slate-200 hover:border-amber-300 rounded-md transition-all flex items-center gap-1 cursor-pointer shadow-2xs"
                title="ثبت پیش‌فاکتور"
              >
                📑 <span className="text-[10px]">پیش‌فاکتور</span>
              </button>
              <button
                onClick={() => onOpenActivityModal(selectedLeadDrawer, 'note')}
                className="px-2 py-0.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 hover:border-slate-300 rounded-md transition-all flex items-center gap-1 cursor-pointer shadow-2xs"
                title="ثبت یادداشت"
              >
                📝 <span className="text-[10px]">یادداشت</span>
              </button>
            </div>

            {onConvertToInvoice && selectedLeadDrawer.stage === 'proposal' && (
              <button
                onClick={() => onConvertToInvoice(selectedLeadDrawer)}
                className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-[10px] font-bold transition-all flex items-center gap-1 shrink-0 cursor-pointer shadow-2xs"
                title="تبدیل به پیش‌فاکتور رسمی"
              >
                <FileText size={11} />
                صدور فاکتور
              </button>
            )}
          </div>
        </div>

        {canViewAttachments && (
          <div className="border border-slate-200 rounded-2xl p-3.5 mb-4">
            <CrmAttachmentsPanel key={selectedLeadDrawer.id} owner="lead" ownerId={selectedLeadDrawer.id} initial={drawerAttachments} onBusyChange={setAttachmentsBusy} />
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex items-center border-b border-slate-200 mb-4 gap-4">
          <button
            onClick={() => setActiveTab('activities')}
            className={`pb-2 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border-b-2 ${
              activeTab === 'activities'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Clock size={16} />
            تاریخچه تماس‌ها ({formatPersianNumber(drawerActivities.length)})
          </button>

          <button
            onClick={() => setActiveTab('stock')}
            className={`pb-2 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border-b-2 ${
              activeTab === 'stock'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Package size={16} />
            استعلام موجودی لحظه‌ای کالاها
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'activities' ? (
          <div className="space-y-3 flex-1 overflow-y-auto custom-scrollbar pl-1">
            {drawerActivities.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs bg-slate-50 rounded-xl border border-dashed border-slate-200">
                هیچ تماسی هنوز برای این پرونده ثبت نشده است.
              </div>
            ) : (
              drawerActivities.map((act) => {
                const badge = getActivityTypeBadge(act.type);
                const Icon = badge.icon;
                return (
                  <div key={act.id} className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-2xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold flex items-center gap-1 ${badge.class}`}>
                        <Icon size={12} />
                        {badge.label}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-[10px] text-slate-400">{formatPersianDate(act.activityDate || act.createdAt)}</span>
                        <ActivityRowActions activity={act} onEdit={onEditActivity} onDelete={onDeleteActivity} />
                      </span>
                    </div>

                    <h5 className="font-bold text-xs text-slate-900">{act.title}</h5>

                    {act.description && <p className="text-xs text-slate-600 leading-relaxed">{act.description}</p>}

                    <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between text-[10px] text-slate-500 gap-1">
                      <span>ثبت توسط: {act.loggedBy || 'فروشنده'}</span>
                      {act.assignedTo && (
                        <span className="font-semibold text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded-md">
                          مسئول پیگیری: {act.assignedTo}
                        </span>
                      )}
                      {act.result && <span className="font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded-md">{activityResultLabel(act.result)}</span>}
                    </div>

                    {act.nextFollowUpDate && (
                      <div className="p-2 bg-amber-50 rounded-lg border border-amber-200 text-[11px] text-amber-900 flex items-center justify-between">
                        <span>
                          پیگیری بعدی ({formatPersianDate(act.nextFollowUpDate)}): {act.nextFollowUpTask || 'تماس پیگیری'}
                        </span>
                        <button
                          aria-label={act.isFollowUpCompleted ? 'برداشتن علامت انجام پیگیری' : 'علامت انجام پیگیری'}
                          aria-pressed={Boolean(act.isFollowUpCompleted)}
                          onClick={() => onToggleFollowup(act)}
                          className={`p-1 rounded-md cursor-pointer ${
                            act.isFollowUpCompleted ? 'bg-emerald-200 text-emerald-800' : 'bg-amber-200 text-amber-800'
                          }`}
                        >
                          <Check size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pl-1">
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute right-3 top-2.5 text-slate-400" size={16} />
              <input
                type="text"
                placeholder="جست‌وجو کالا با کد، نام یا دسته‌بندی..."
                value={stockSearchTerm}
                onChange={(e) => setStockSearchTerm(e.target.value)}
                className="w-full pr-9 pl-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-blue-500 focus:bg-white transition-all"
              />
            </div>

            {isLoadingStock ? (
              <div className="p-8 text-center text-slate-500 text-xs">در حال دریافت موجودی انبارها...</div>
            ) : filteredItems.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs bg-slate-50 rounded-xl border border-dashed border-slate-200">
                هیچ کالایی یافت نشد.
              </div>
            ) : (
              <div className="space-y-2">
                {filteredItems.slice(0, 30).map((item) => {
                  const currentStock = item.current_stock ?? 0;
                  const itemStocks = item.stocks || {};

                  return (
                    <div
                      key={item.id}
                      className="bg-white border border-slate-200 rounded-xl p-3 shadow-2xs hover:border-blue-300 transition-all space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px] font-mono font-bold">
                              {item.code}
                            </span>
                            <h5 className="font-bold text-xs text-slate-900">{item.name}</h5>
                          </div>
                          {item.category && (
                            <span className="text-[10px] text-slate-400 block mt-0.5">دسته: {item.category}</span>
                          )}
                        </div>

                        <div className="text-left">
                          <span className="text-[10px] text-slate-400 block">موجودی کل:</span>
                          <span className={`font-black text-xs ${currentStock > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {formatPersianNumber(currentStock)} {item.unit || 'عدد'}
                          </span>
                        </div>
                      </div>

                      {/* Warehouses breakdown */}
                      <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-100">
                        {warehouses.map((wh) => {
                          const stockInWh = itemStocks[wh.code] ?? 0;
                          return (
                            <span
                              key={wh.code}
                              className={`px-2 py-0.5 rounded-md text-[10px] font-semibold flex items-center gap-1 ${
                                stockInWh > 0 ? 'bg-slate-100 text-slate-800' : 'bg-slate-50 text-slate-400'
                              }`}
                            >
                              <Building2 size={10} className="text-slate-400" />
                              {wh.name}: {formatPersianNumber(stockInWh)}
                            </span>
                          );
                        })}
                      </div>

                      {/* Quick copy info */}
                      <div className="flex items-center justify-between pt-1 text-[10px] text-slate-500">
                        <span>
                          {/* v10.1.51 (OBS-R2-26): the item pick list carries no sale price, so the item code is shown, not «بدون قیمت» */}
                          کد کالا: {formatPersianCode(item.code)}
                        </span>
                        <button
                          onClick={() => {
                            void copyToClipboard(`${item.code} - ${item.name}`).then(ok => {
                              if (ok) toast.success(`کد و نام کالا کپی شد: ${item.code}`);
                              else toast.error('کپی در کلیپ‌بورد ممکن نشد');
                            });
                          }}
                          className="text-blue-600 hover:text-blue-800 font-bold flex items-center gap-0.5 cursor-pointer"
                        >
                          <Copy size={12} />
                          کپی کد
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default CRMLeadDrawer;
