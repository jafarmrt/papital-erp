import { useState } from 'react';
import { ShoppingBag, Plus, Layers, RefreshCw, Trash2, FileText, Truck, PackageCheck } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { PurchaseRequisition, ProcurementOrder } from '../../types';
import { fetchJson } from '../../api';
import { formatPersianNumber, getErrorMessage } from '../../utils';
import { RequisitionDetailModal } from './RequisitionDetailModal';
import { SplitOrderModal } from './SplitOrderModal';
import { CreateRequisitionModal } from './CreateRequisitionModal';
import { ConsolidateRequisitionsModal } from './ConsolidateRequisitionsModal';
import { ProcurementOrderList } from './ProcurementOrderList';
import { ConfirmWarehouseDeliveryModal } from './ConfirmWarehouseDeliveryModal';
import { RequisitionListPanel, type RequisitionListFilters } from './RequisitionListPanel';
import { canConsolidateRequisition } from '../../lib/procurement/requisitionFields';
import { PROCUREMENT_DESK_PAGE_SIZE } from '../../lib/procurement/procurementLists';
import { useProcurementDeskData } from '../../hooks/procurement/useProcurementDeskData';
import { useProcurementAccess } from '../../hooks/procurement/useProcurementAccess';
import { useProcurementPage } from '../../hooks/procurement/useProcurementPage';
import { useDebounce } from '../../hooks/useDebounce';

/** شمار خلاصه، یا «—» وقتی خلاصه بارگذاری نشد */
const countText = (n: number | undefined): string => (n === undefined ? '—' : formatPersianNumber(n));

type DeskTab = 'requisitions' | 'active_orders' | 'delivered_receipts';

export function ProcurementDesk() {
  // v9.0.277 (TD-702، B10-15): هر بخش جدا بارگذاری می‌شود و هر دکمه با مجوز API خودش نشان داده می‌شود
  const { summary, version, reload: loadData } = useProcurementDeskData();
  const access = useProcurementAccess();
  const [activeMainTab, setActiveMainTab] = useState<DeskTab>('requisitions');
  const [deliveringOrderId, setDeliveringOrderId] = useState<number | null>(null);
  const [deliveryModalOrder, setDeliveryModalOrder] = useState<ProcurementOrder | null>(null);
  const [isSubmittingDelivery, setIsSubmittingDelivery] = useState(false);
  const [requisitionToDelete, setRequisitionToDelete] = useState<{ id: number; code: string } | null>(null);
  const [isDeletingRequisition, setIsDeletingRequisition] = useState(false);

  // v9.0.278 (TD-697، B10-10): فیلترها، جست‌وجو و صفحه در سرور؛ هر تغییر فیلتر به صفحه ۱ برمی‌گردد
  const [filters, setFilters] = useState<RequisitionListFilters>({ status: 'all', priority: 'all', search: '', page: 1 });
  const [orderSearch, setOrderSearch] = useState('');
  const [orderPage, setOrderPage] = useState(1);
  const requisitionSearch = useDebounce(filters.search.trim());
  const debouncedOrderSearch = useDebounce(orderSearch.trim());
  const requisitionList = useProcurementPage<PurchaseRequisition>('/api/procurement/requisitions', {
    status: filters.status, priority: filters.priority, search: requisitionSearch, page: filters.page, limit: PROCUREMENT_DESK_PAGE_SIZE,
  }, version);
  const orderList = useProcurementPage<ProcurementOrder>(activeMainTab === 'requisitions' ? null : '/api/procurement/orders', {
    status: activeMainTab === 'active_orders' ? 'pending_delivery' : 'final', search: debouncedOrderSearch, page: orderPage, limit: PROCUREMENT_DESK_PAGE_SIZE,
  }, version);
  // درخواست‌های انتخاب‌شده برای تجمیع، از هر صفحه‌ای
  const [selected, setSelected] = useState<PurchaseRequisition[]>([]);
  const selectedIds = selected.map(r => r.id);

  // Modal States
  const [selectedRequisitionForDetail, setSelectedRequisitionForDetail] = useState<PurchaseRequisition | null>(null);
  const [selectedRequisitionForSplit, setSelectedRequisitionForSplit] = useState<PurchaseRequisition | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isConsolidateModalOpen, setIsConsolidateModalOpen] = useState(false);

  const openTab = (tab: DeskTab) => {
    if (tab !== activeMainTab) {
      setOrderPage(1);
      setOrderSearch('');
    }
    setActiveMainTab(tab);
  };

  const changeFilters = (change: Partial<RequisitionListFilters>) => setFilters(prev => ({ ...prev, ...change }));

  // v9.0.276 (TD-701): فقط سفارشی که سرور فرستاده تأیید می‌شود؛ پیش‌تر سفارش پیدانشده با تأمین‌کننده و انبار ساختگی نمایش داده می‌شد
  const handleDeliverOrder = (orderId: number) => {
    const found = orderList.rows.find(o => o.id === orderId);
    if (found) setDeliveryModalOrder(found);
  };

  // درخواست سفارش ممکن است در صفحه جاری فهرست درخواست‌ها نباشد؛ از سرور خوانده می‌شود
  const handleViewRequisition = async (requisitionId: number) => {
    const onPage = requisitionList.rows.find(r => r.id === requisitionId);
    if (onPage) {
      setSelectedRequisitionForDetail(onPage);
      return;
    }
    try {
      const res = await fetchJson<{ data?: PurchaseRequisition }>(`/api/procurement/requisitions/${requisitionId}`);
      if (res?.data) setSelectedRequisitionForDetail(res.data);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    }
  };

  const handleConfirmDelivery = async () => {
    if (!deliveryModalOrder) return;
    setIsSubmittingDelivery(true);
    setDeliveringOrderId(deliveryModalOrder.id);
    try {
      const res = await fetchJson<{ success: boolean; message: string }>(`/api/procurement/orders/${deliveryModalOrder.id}/deliver`, {
        method: 'POST'
      });
      toast.success(res.message || 'فاکتور خرید با موفقیت به انبار تحویل و رسید قطعی صادر شد.');
      setDeliveryModalOrder(null);
      await loadData();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setIsSubmittingDelivery(false);
      setDeliveringOrderId(null);
    }
  };

  const handleToggleSelect = (req: PurchaseRequisition) => {
    setSelected(prev => prev.some(r => r.id === req.id) ? prev.filter(r => r.id !== req.id) : [...prev, req]);
  };

  const handleSelectAll = (select: boolean) => {
    if (select) {
      // v9.0.274 (TD-694): فقط درخواست تأییدنشده و بی سفارش تجمیع می‌شود؛ انتخاب صفحه‌های دیگر می‌ماند
      setSelected(prev => [...prev, ...requisitionList.rows.filter(r => canConsolidateRequisition(r) && !prev.some(p => p.id === r.id))]);
    } else {
      setSelected([]);
    }
  };

  const handleConfirmDeleteRequisition = async () => {
    if (!requisitionToDelete) return;
    setIsDeletingRequisition(true);
    try {
      await fetchJson(`/api/procurement/requisitions/${requisitionToDelete.id}`, { method: 'DELETE' });
      toast.success(`درخواست خرید ${requisitionToDelete.code} با موفقیت حذف شد.`);
      setSelected(prev => prev.filter(r => r.id !== requisitionToDelete.id));
      setRequisitionToDelete(null);
      await loadData();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setIsDeletingRequisition(false);
    }
  };

  return (
    <div className="space-y-6 font-farsi">
      {/* Top Banner & Title */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center font-black">
            <ShoppingBag className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900 flex items-center gap-2">
              میز کار خرید و تدارکات
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              مدیریت و تفکیک درخواست‌های خرید پروژه‌ها، استعلام تامین‌کنندگان، تجمیع سفارش‌ها و گردش کار تاییدات
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {access.canManage && selectedIds.length >= 2 && (
            <button
              type="button"
              onClick={() => setIsConsolidateModalOpen(true)}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs rounded-xl flex items-center gap-2 shadow-xs transition-all cursor-pointer"
            >
              <Layers className="w-4 h-4" />
              تجمیع ({formatPersianNumber(selectedIds.length)} درخواست انتخابی)
            </button>
          )}

          <button
            type="button"
            onClick={() => void loadData()}
            className="p-2 text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer border border-slate-200"
            title="تازه‌سازی"
          >
            <RefreshCw className={`w-4 h-4 ${requisitionList.isLoading || orderList.isLoading ? 'animate-spin' : ''}`} />
          </button>

          {access.canCreate && (
            <button
              type="button"
              onClick={() => setIsCreateModalOpen(true)}
              className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs rounded-xl flex items-center gap-2 shadow-sm transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              ثبت درخواست خرید جدید
            </button>
          )}
        </div>
      </div>

      {/* 3-Stage Life-Cycle Pipeline Cards */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
              <Layers className="w-4 h-4 text-amber-600" />
              چرخه حیات و مرزهای سه‌گانه تدارکات و خرید
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              جهت ورود به هر مرحله و مشاهده اسناد مربوطه، بر روی کارت گام مورد نظر کلیک نمایید
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] font-bold bg-slate-100 text-slate-700 px-3 py-1 rounded-xl">
            <span>۱. درخواست خرید</span>
            <span className="text-slate-400">➔</span>
            <span>۲. فاکتور خرید</span>
            <span className="text-slate-400">➔</span>
            <span>۳. رسید قطعی انبار</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
          {/* Stage 1 */}
          <button
            type="button"
            onClick={() => openTab('requisitions')}
            className={`p-4 rounded-2xl border text-right transition-all cursor-pointer relative flex flex-col justify-between ${
              activeMainTab === 'requisitions'
                ? 'bg-amber-500/10 border-amber-500 ring-2 ring-amber-500/20 shadow-xs'
                : 'bg-slate-50/50 border-slate-200 hover:border-slate-300'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-black text-slate-900 flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-amber-500 text-slate-950 flex items-center justify-center text-[11px] font-black">۱</span>
                  درخواست‌های خرید (Requisitions)
                </span>
                <span className="text-xl font-black font-mono text-amber-700">
                  {countText(summary?.totalRequisitions)}
                </span>
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                اعلام نیاز پروژه‌ها و کارگاه، بررسی فنی، استعلام و گردش کار تاییدات
              </p>
            </div>
            <div className="mt-4 pt-2.5 border-t border-slate-200/60 flex items-center justify-between text-[11px]">
              <span className="text-amber-800 font-bold">
                {countText(summary ? summary.pendingCount + summary.underReviewCount + summary.managerApprovalCount : undefined)} در انتظار تایید
              </span>
              <span className="text-blue-700 font-bold flex items-center gap-1">
                مرز ۱: تفکیک و صدور فاکتور ➔
              </span>
            </div>
          </button>

          {/* Stage 2 */}
          <button
            type="button"
            onClick={() => openTab('active_orders')}
            className={`p-4 rounded-2xl border text-right transition-all cursor-pointer relative flex flex-col justify-between ${
              activeMainTab === 'active_orders'
                ? 'bg-sky-500/10 border-sky-500 ring-2 ring-sky-500/20 shadow-xs'
                : 'bg-slate-50/50 border-slate-200 hover:border-slate-300'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-black text-slate-900 flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-sky-500 text-white flex items-center justify-center text-[11px] font-black">۲</span>
                  فاکتورهای خرید (در انتظار تحویل انبار)
                </span>
                <span className="text-xl font-black font-mono text-sky-700">
                  {countText(summary?.pendingDeliveryOrdersCount)}
                </span>
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                فاکتورهای تفکیک‌شده تامین‌کنندگان با مشخصات قیمت و تاریخ ارسال (در راه کارگاه)
              </p>
            </div>
            <div className="mt-4 pt-2.5 border-t border-slate-200/60 flex items-center justify-between text-[11px]">
              <span className="text-sky-800 font-bold">
                آماده تایید رسید انبار
              </span>
              <span className="text-emerald-700 font-bold flex items-center gap-1">
                مرز ۲: تحویل به انبار ➔
              </span>
            </div>
          </button>

          {/* Stage 3 */}
          <button
            type="button"
            onClick={() => openTab('delivered_receipts')}
            className={`p-4 rounded-2xl border text-right transition-all cursor-pointer relative flex flex-col justify-between ${
              activeMainTab === 'delivered_receipts'
                ? 'bg-emerald-500/10 border-emerald-500 ring-2 ring-emerald-500/20 shadow-xs'
                : 'bg-slate-50/50 border-slate-200 hover:border-slate-300'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-black text-slate-900 flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[11px] font-black">۳</span>
                  رسیدهای قطعی انبار (تحویل‌شده)
                </span>
                <span className="text-xl font-black font-mono text-emerald-700">
                  {countText(summary?.deliveredOrdersCount)}
                </span>
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                کالاهای تحویل‌شده به انباردار، افزایش رسمی کاردکس و ثبت سند حسابداری
              </p>
            </div>
            <div className="mt-4 pt-2.5 border-t border-slate-200/60 flex items-center justify-between text-[11px]">
              <span className="text-emerald-800 font-bold">
                خرید قطعی و نهایی
              </span>
              <span className="text-emerald-700 font-black flex items-center gap-1">
                ثبت رسمی در کاردکس ✅
              </span>
            </div>
          </button>
        </div>
      </div>

      {/* Main Mode Navigation Tabs */}
      <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-2xl">
        {([
          { id: 'requisitions', icon: <FileText className="w-4 h-4 text-amber-600" />, label: '۱. کارتابل درخواست‌های خرید', badge: 'bg-amber-100 text-amber-900', count: summary ? summary.totalRequisitions : requisitionList.total },
          { id: 'active_orders', icon: <Truck className="w-4 h-4 text-sky-600" />, label: '۲. فاکتورهای خرید (در انتظار تحویل انبار)', badge: 'bg-sky-100 text-sky-900', count: summary?.pendingDeliveryOrdersCount },
          { id: 'delivered_receipts', icon: <PackageCheck className="w-4 h-4 text-emerald-600" />, label: '۳. رسیدهای قطعی انبار (تحویل‌شده)', badge: 'bg-emerald-100 text-emerald-900', count: summary?.deliveredOrdersCount },
        ] as const).map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => openTab(tab.id)}
            className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center justify-center gap-2 ${
              activeMainTab === tab.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
            <span className={`px-2 py-0.5 rounded-full text-[11px] ${tab.badge}`}>{countText(tab.count)}</span>
          </button>
        ))}
      </div>

      {/* Main Content Area Based on Active Tab */}
      {activeMainTab === 'requisitions' ? (
        <RequisitionListPanel
          list={requisitionList}
          filters={filters}
          pageSize={PROCUREMENT_DESK_PAGE_SIZE}
          onFiltersChange={changeFilters}
          access={access}
          selectedIds={selectedIds}
          onToggleSelect={handleToggleSelect}
          onSelectAll={handleSelectAll}
          onView={setSelectedRequisitionForDetail}
          onSplit={setSelectedRequisitionForSplit}
          onDelete={req => setRequisitionToDelete({ id: req.id, code: req.code })}
          onShowOrders={() => openTab('active_orders')}
          onRetry={() => void loadData()}
        />
      ) : (
        <ProcurementOrderList
          key={activeMainTab}
          orders={orderList.rows}
          total={orderList.total}
          page={orderPage}
          pageSize={PROCUREMENT_DESK_PAGE_SIZE}
          onPageChange={setOrderPage}
          search={orderSearch}
          onSearchChange={value => { setOrderSearch(value); setOrderPage(1); }}
          isLoading={orderList.isLoading}
          type={activeMainTab === 'active_orders' ? 'active' : 'delivered'}
          error={orderList.error}
          onDeliverOrder={activeMainTab === 'active_orders' && access.canDeliver ? handleDeliverOrder : undefined}
          deliveringOrderId={deliveringOrderId}
          onViewRequisition={reqId => void handleViewRequisition(reqId)}
        />
      )}

      {/* Detail Modal */}
      {selectedRequisitionForDetail && (
        <RequisitionDetailModal
          isOpen={!!selectedRequisitionForDetail}
          requisition={selectedRequisitionForDetail}
          onClose={() => setSelectedRequisitionForDetail(null)}
          onRefresh={loadData}
          onOpenSplitOrder={(req) => {
            setSelectedRequisitionForDetail(null);
            setSelectedRequisitionForSplit(req);
          }}
        />
      )}

      {/* Split & Purchase Modal */}
      {selectedRequisitionForSplit && (
        <SplitOrderModal
          isOpen={!!selectedRequisitionForSplit}
          requisition={selectedRequisitionForSplit}
          onClose={() => setSelectedRequisitionForSplit(null)}
          onSuccess={loadData}
        />
      )}

      {/* Create Manual Requisition Modal */}
      {isCreateModalOpen && (
        <CreateRequisitionModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          onSuccess={loadData}
        />
      )}

      {/* Consolidate Modal */}
      {isConsolidateModalOpen && (
        <ConsolidateRequisitionsModal
          isOpen={isConsolidateModalOpen}
          selectedRequisitions={selected}
          onClose={() => {
            setIsConsolidateModalOpen(false);
            setSelected([]);
          }}
          onSuccess={loadData}
        />
      )}

      {/* Warehouse Delivery Confirmation Modal */}
      {deliveryModalOrder && (
        <ConfirmWarehouseDeliveryModal
          isOpen={true}
          order={deliveryModalOrder}
          isSubmitting={isSubmittingDelivery}
          onClose={() => setDeliveryModalOrder(null)}
          onConfirm={handleConfirmDelivery}
        />
      )}

      {/* Delete Requisition Confirmation Modal */}
      {requisitionToDelete && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center z-50 p-4 font-farsi animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center font-bold">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-black text-slate-900 text-sm">حذف درخواست خرید</h4>
                <p className="text-xs text-slate-500 mt-0.5">شناسه: {requisitionToDelete.code}</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              آیا از حذف این درخواست خرید اطمینان دارید؟ این عملیات غیرقابل بازگشت است.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setRequisitionToDelete(null)}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl font-bold text-xs transition-colors cursor-pointer"
              >
                انصراف
              </button>
              <button
                type="button"
                disabled={isDeletingRequisition}
                onClick={handleConfirmDeleteRequisition}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl transition-all shadow-xs cursor-pointer"
              >
                {isDeletingRequisition ? 'در حال حذف...' : 'بله، حذف شود'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
