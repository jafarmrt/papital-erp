import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  ShoppingBag, ShoppingCart, Clock, CheckCircle2, AlertTriangle, 
  Search, Filter, Plus, Layers, RefreshCw, Eye, Trash2, ArrowUpDown, 
  Building2, UserCheck, Ban, Check, FileText, ChevronDown, ChevronUp, AlertCircle
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { PurchaseRequisition, Item, User } from '../../types';
import { fetchJson } from '../../api';
import { formatPersianPrice, formatPersianNumber } from '../../utils';
import { RequisitionDetailModal } from './RequisitionDetailModal';
import { SplitOrderModal } from './SplitOrderModal';
import { CreateRequisitionModal } from './CreateRequisitionModal';
import { ConsolidateRequisitionsModal } from './ConsolidateRequisitionsModal';

interface ProcurementDeskProps {
  currentUser?: User | null;
}

export function ProcurementDesk({ currentUser }: ProcurementDeskProps) {
  const [requisitions, setRequisitions] = useState<PurchaseRequisition[]>([]);
  const [warehouseItems, setWarehouseItems] = useState<Item[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // Summary Metrics State
  const [summary, setSummary] = useState({
    totalRequisitions: 0,
    pendingCount: 0,
    underReviewCount: 0,
    managerApprovalCount: 0,
    orderedCount: 0,
    receivedCount: 0,
    urgentCount: 0
  });

  // Modal States
  const [selectedRequisitionForDetail, setSelectedRequisitionForDetail] = useState<PurchaseRequisition | null>(null);
  const [selectedRequisitionForSplit, setSelectedRequisitionForSplit] = useState<PurchaseRequisition | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isConsolidateModalOpen, setIsConsolidateModalOpen] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [reqsRes, itemsRes, summaryRes] = await Promise.all([
        fetchJson<{ success: boolean; data: PurchaseRequisition[] }>('/api/procurement/requisitions?limit=100'),
        fetchJson<{ data?: Item[] } | Item[]>('/api/items'),
        fetchJson<{ success: boolean; data: any }>('/api/procurement/inbox/summary')
      ]);

      const reqs = reqsRes?.data || [];
      setRequisitions(Array.isArray(reqs) ? reqs : []);

      const itms = Array.isArray(itemsRes) ? itemsRes : (itemsRes?.data || []);
      setWarehouseItems(itms);

      if (summaryRes?.data) {
        setSummary(summaryRes.data);
      }
    } catch (err: any) {
      toast.error(err.message || 'خطا در بارگذاری داده‌های میز کار تدارکات');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Filtering
  const filteredRequisitions = useMemo(() => {
    return requisitions.filter(r => {
      // Status
      if (statusFilter !== 'all') {
        if (statusFilter === 'pending' || statusFilter === 'in_progress') {
          if (r.status !== 'pending' && r.status !== 'under_review' && r.status !== 'manager_approval') return false;
        } else if (statusFilter === 'ordered') {
          if (r.status !== 'ordered' && r.status !== 'approved') return false;
        } else if (statusFilter === 'received') {
          if (r.status !== 'received' && r.status !== 'completed') return false;
        } else if (statusFilter === 'rejected') {
          if (r.status !== 'rejected' && r.status !== 'cancelled') return false;
        } else if (r.status !== statusFilter) {
          return false;
        }
      }

      // Priority
      if (priorityFilter !== 'all' && r.priority !== priorityFilter) {
        return false;
      }

      // Search
      if (searchTerm.trim()) {
        const q = searchTerm.trim().toLowerCase();
        const matchCode = (r.code || '').toLowerCase().includes(q);
        const matchTitle = (r.title || '').toLowerCase().includes(q);
        const matchProject = (r.projectCode || '').toLowerCase().includes(q) || (r.projectName || '').toLowerCase().includes(q);
        const matchItems = Array.isArray(r.items) && r.items.some(i => 
          (i.itemName || '').toLowerCase().includes(q) || (i.itemCode || '').toLowerCase().includes(q)
        );
        if (!matchCode && !matchTitle && !matchProject && !matchItems) return false;
      }

      return true;
    });
  }, [requisitions, statusFilter, priorityFilter, searchTerm]);

  const handleToggleSelect = (id: number) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleSelectAll = (select: boolean) => {
    if (select) {
      setSelectedIds(filteredRequisitions.map(r => r.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleDeleteRequisition = async (id: number, code: string) => {
    if (!window.confirm(`آیا از حذف درخواست خرید ${code} اطمینان دارید؟`)) return;

    try {
      await fetchJson(`/api/procurement/requisitions/${id}`, { method: 'DELETE' });
      toast.success(`درخواست خرید ${code} حذف شد.`);
      loadData();
    } catch (err: any) {
      toast.error(err.message || 'خطا در حذف درخواست خرید');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
      case 'under_review':
      case 'manager_approval':
        return <span className="px-2.5 py-1 bg-amber-100 text-amber-900 font-bold rounded-lg text-xs flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-amber-600" /> در انتظار بررسی و تایید</span>;
      case 'ordered':
      case 'approved':
        return <span className="px-2.5 py-1 bg-sky-100 text-sky-900 font-bold rounded-lg text-xs flex items-center gap-1.5"><ShoppingCart className="w-3.5 h-3.5 text-sky-600" /> تایید شده (در حال خرید)</span>;
      case 'received':
      case 'completed':
        return <span className="px-2.5 py-1 bg-emerald-100 text-emerald-900 font-bold rounded-lg text-xs flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> خرید و تحویل انبار شده</span>;
      case 'rejected':
      case 'cancelled':
        return <span className="px-2.5 py-1 bg-rose-100 text-rose-900 font-bold rounded-lg text-xs flex items-center gap-1.5"><Ban className="w-3.5 h-3.5 text-rose-600" /> رد شده / لغو</span>;
      default:
        return <span className="px-2.5 py-1 bg-slate-100 text-slate-800 font-bold rounded-lg text-xs">{status}</span>;
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return <span className="px-2 py-0.5 bg-rose-500 text-white font-black rounded text-[10px] animate-pulse">فوری</span>;
      case 'high':
        return <span className="px-2 py-0.5 bg-amber-500 text-slate-950 font-bold rounded text-[10px]">بالا</span>;
      case 'low':
        return <span className="px-2 py-0.5 bg-slate-200 text-slate-700 font-bold rounded text-[10px]">پایین</span>;
      default:
        return <span className="px-2 py-0.5 bg-blue-100 text-blue-800 font-bold rounded text-[10px]">عادی</span>;
    }
  };

  const selectedRequisitionsForConsolidate = useMemo(() => {
    return requisitions.filter(r => selectedIds.includes(r.id));
  }, [requisitions, selectedIds]);

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
          {selectedIds.length >= 2 && (
            <button
              type="button"
              onClick={() => setIsConsolidateModalOpen(true)}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs rounded-xl flex items-center gap-2 shadow-xs transition-all cursor-pointer"
            >
              <Layers className="w-4 h-4" />
              تجمیع ({selectedIds.length} درخواست انتخابی)
            </button>
          )}

          <button
            type="button"
            onClick={loadData}
            className="p-2 text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer border border-slate-200"
            title="تازه‌سازی"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          <button
            type="button"
            onClick={() => setIsCreateModalOpen(true)}
            className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs rounded-xl flex items-center gap-2 shadow-sm transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            ثبت درخواست خرید جدید
          </button>
        </div>
      </div>

      {/* KPI Stats Cards - Simplified 3-stage workshop model */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs">
          <span className="text-xs text-slate-500 block mb-1">کل درخواست‌ها</span>
          <div className="text-xl font-black text-slate-900 font-mono">
            {formatPersianNumber(summary.totalRequisitions)}
          </div>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-amber-200 bg-amber-50/30 shadow-xs">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-amber-900 font-bold">۱. در انتظار بررسی و تایید</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-xl font-black text-amber-700 font-mono">
            {formatPersianNumber(summary.pendingCount + summary.underReviewCount + summary.managerApprovalCount)}
          </div>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-sky-200 bg-sky-50/30 shadow-xs">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-sky-900 font-bold">۲. تایید شده (در حال خرید)</span>
            <ShoppingCart className="w-4 h-4 text-sky-600" />
          </div>
          <div className="text-xl font-black text-sky-700 font-mono">
            {formatPersianNumber(summary.orderedCount)}
          </div>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-emerald-200 bg-emerald-50/30 shadow-xs">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-emerald-900 font-bold">۳. خرید و تحویل انبار شده</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-xl font-black text-emerald-700 font-mono">
            {formatPersianNumber(summary.receivedCount)}
          </div>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-rose-200 bg-rose-50/40 shadow-xs">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-rose-900 font-black">اقلام فوری و اضطراری</span>
            <AlertTriangle className="w-4 h-4 text-rose-600" />
          </div>
          <div className="text-xl font-black text-rose-700 font-mono">
            {formatPersianNumber(summary.urgentCount)}
          </div>
        </div>
      </div>

      {/* Filters & Tabs Section */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
        {/* Status Tabs - Streamlined Workshop Stages */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 border-b border-slate-100">
          {[
            { id: 'all', label: 'همه درخواست‌ها' },
            { id: 'pending', label: '۱. در انتظار بررسی و تایید' },
            { id: 'ordered', label: '۲. تایید شده (در حال خرید)' },
            { id: 'received', label: '۳. خرید و تحویل انبار شده (تکمیل)' },
            { id: 'rejected', label: 'رد شده / لغو' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                statusFilter === tab.id
                  ? 'bg-amber-500 text-slate-950 shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search and Priority Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="relative flex-1 min-w-[260px]">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
            <input
              type="text"
              placeholder="جستجو در کد درخواست، عنوان، پروژه یا کالاهای درخواستی..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-3 pr-9 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:bg-white focus:ring-2 focus:ring-amber-400 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-bold">اولویت:</span>
            <select
              value={priorityFilter}
              onChange={e => setPriorityFilter(e.target.value)}
              className="p-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold focus:bg-white focus:outline-none cursor-pointer"
            >
              <option value="all">همه اولویت‌ها</option>
              <option value="urgent">فوری / اضطراری</option>
              <option value="high">بالا</option>
              <option value="normal">عادی</option>
              <option value="low">پایین</option>
            </select>
          </div>
        </div>
      </div>

      {/* Requisitions List Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-bold text-slate-800">
              لیست درخواست‌های خرید ({formatPersianNumber(filteredRequisitions.length)} مورد)
            </span>
            {selectedIds.length > 0 && (
              <span className="px-2 py-0.5 bg-amber-100 text-amber-900 rounded font-mono font-bold">
                {selectedIds.length} مورد انتخاب شده
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => handleSelectAll(true)}
              className="text-blue-600 hover:text-blue-800 font-bold cursor-pointer"
            >
              انتخاب همه
            </button>
            <span className="text-slate-300">|</span>
            <button
              type="button"
              onClick={() => handleSelectAll(false)}
              className="text-slate-500 hover:text-slate-700 font-bold cursor-pointer"
            >
              لغو انتخاب
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-slate-500 text-xs">
            در حال بارگذاری کارتابل تدارکات...
          </div>
        ) : filteredRequisitions.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-xs">
            هیچ درخواست خریدی با فیلترهای انتخابی یافت نشد.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-right">
              <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-3 text-center w-12">انتخاب</th>
                  <th className="p-3">شماره و اولویت</th>
                  <th className="p-3">عنوان و پروژه</th>
                  <th className="p-3 text-center">اقلام</th>
                  <th className="p-3 text-center">تاریخ نیاز</th>
                  <th className="p-3 text-center">برآورد مبلغ</th>
                  <th className="p-3 text-center">وضعیت گردش کار</th>
                  <th className="p-3 text-center">عملیات تدارکات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRequisitions.map(req => {
                  const itemsCount = Array.isArray(req.items) ? req.items.length : 0;
                  const isSelected = selectedIds.includes(req.id);

                  return (
                    <tr key={req.id} className={`hover:bg-slate-50/70 transition-colors ${isSelected ? 'bg-amber-50/40' : ''}`}>
                      <td className="p-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelect(req.id)}
                          className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500 border-slate-300 cursor-pointer"
                        />
                      </td>

                      <td className="p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono font-black text-slate-900 text-sm">{req.code}</span>
                          {getPriorityBadge(req.priority)}
                        </div>
                        <span className="text-[11px] text-slate-400">ثبت: {req.requestedByName || 'نامشخص'}</span>
                      </td>

                      <td className="p-3">
                        <div className="font-bold text-slate-900 mb-0.5">{req.title}</div>
                        {req.projectName ? (
                          <div className="flex items-center gap-1 text-[11px] text-blue-700">
                            <Building2 className="w-3 h-3" />
                            <span>{req.projectName} ({req.projectCode || ''})</span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400">خرید عمومی سازمان</span>
                        )}
                      </td>

                      <td className="p-3 text-center">
                        <span className="px-2.5 py-1 bg-slate-100 text-slate-800 rounded-lg font-mono font-bold">
                          {formatPersianNumber(itemsCount)} قلم
                        </span>
                      </td>

                      <td className="p-3 text-center font-mono font-bold text-slate-700">
                        {req.requiredDate || '---'}
                      </td>

                      <td className="p-3 text-center font-mono font-black text-amber-800">
                        {formatPersianPrice(req.totalEstimatedAmount || 0)}
                      </td>

                      <td className="p-3 text-center">
                        {getStatusBadge(req.status)}
                      </td>

                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {/* Details Modal */}
                          <button
                            type="button"
                            onClick={() => setSelectedRequisitionForDetail(req)}
                            className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                            title="مشاهده جزئیات و تاییدات"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {/* Split & Order Action Button */}
                          {req.status !== 'ordered' && req.status !== 'received' && req.status !== 'rejected' && (
                            <button
                              type="button"
                              onClick={() => setSelectedRequisitionForSplit(req)}
                              className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-lg flex items-center gap-1 shadow-xs transition-colors cursor-pointer"
                              title="تفکیک و صدور سفارش‌های خرید"
                            >
                              <ShoppingCart className="w-3.5 h-3.5" />
                              <span>تفکیک و خرید</span>
                            </button>
                          )}

                          {/* Delete Requisition (only if pending/under_review) */}
                          {(req.status === 'pending' || req.status === 'under_review' || req.status === 'rejected') && (
                            <button
                              type="button"
                              onClick={() => handleDeleteRequisition(req.id, req.code)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg transition-colors cursor-pointer"
                              title="حذف درخواست"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedRequisitionForDetail && (
        <RequisitionDetailModal
          isOpen={!!selectedRequisitionForDetail}
          requisition={selectedRequisitionForDetail}
          warehouseItems={warehouseItems}
          currentUser={currentUser}
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
          warehouseItems={warehouseItems}
          onClose={() => setSelectedRequisitionForSplit(null)}
          onSuccess={loadData}
        />
      )}

      {/* Create Manual Requisition Modal */}
      {isCreateModalOpen && (
        <CreateRequisitionModal
          isOpen={isCreateModalOpen}
          warehouseItems={warehouseItems}
          onClose={() => setIsCreateModalOpen(false)}
          onSuccess={loadData}
        />
      )}

      {/* Consolidate Modal */}
      {isConsolidateModalOpen && (
        <ConsolidateRequisitionsModal
          isOpen={isConsolidateModalOpen}
          selectedRequisitions={selectedRequisitionsForConsolidate}
          onClose={() => {
            setIsConsolidateModalOpen(false);
            setSelectedIds([]);
          }}
          onSuccess={loadData}
        />
      )}
    </div>
  );
}
