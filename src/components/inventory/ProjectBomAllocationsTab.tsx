import React, { useState, useEffect, useCallback } from 'react';
import { confirmAction } from '../ConfirmDialogHost';
import toast from 'react-hot-toast';
import {
  Boxes,
  Plus,
  Search,
  RefreshCw,
  CheckCircle2,
  Clock,
  RotateCcw,
  ArrowUpRight,
  User,
  Calendar,
  Warehouse,
  FileText,
  AlertCircle,
  ExternalLink,
  Download
} from 'lucide-react';
import * as xlsx from 'xlsx';
import { fetchJson } from '../../api';
import { formatPersianDate, formatPersianNumber } from '../../utils';

interface ProjectBomAllocationsTabProps {
  user?: any;
}

export function ProjectBomAllocationsTab({ user }: ProjectBomAllocationsTabProps) {
  const [allocations, setAllocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Allocation Modal State
  const [showAllocateModal, setShowAllocateModal] = useState(false);
  const [projectsList, setProjectsList] = useState<any[]>([]);
  const [itemsList, setItemsList] = useState<any[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | ''>('');
  const [selectedItemId, setSelectedItemId] = useState<number | ''>('');
  const [allocateQty, setAllocateQty] = useState<string>('1');
  const [selectedLocation, setSelectedLocation] = useState('main');
  const [allocateNotes, setAllocateNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Traceability Modal
  const [selectedAllocForTrace, setSelectedAllocForTrace] = useState<any | null>(null);

  // Release Modal
  const [releaseTarget, setReleaseTarget] = useState<any | null>(null);
  const [releaseReason, setReleaseReason] = useState('تغییر در برنامه تولید یا لغو تخصیص');
  const [releasing, setReleasing] = useState(false);

  const loadAllocations = useCallback(async () => {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams();
      if (statusFilter !== 'all') queryParams.append('status', statusFilter);
      if (search) queryParams.append('search', search);

      const res = await fetchJson(`/inventory/allocations?${queryParams.toString()}`);
      setAllocations(res?.allocations || []);
    } catch (err) {
      console.error('Error loading allocations:', err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  const loadMetadata = async () => {
    try {
      const [projRes, itemsRes] = await Promise.all([
        fetchJson('/projects'),
        fetchJson('/items?type=raw_material')
      ]);
      const rawProjs = Array.isArray(projRes?.data) ? projRes.data : (Array.isArray(projRes) ? projRes : []);
      const rawItems = Array.isArray(itemsRes?.data) ? itemsRes.data : (Array.isArray(itemsRes) ? itemsRes : []);
      setProjectsList(rawProjs);
      setItemsList(rawItems);
    } catch (err) {
      console.error('Error loading metadata for allocation:', err);
    }
  };

  useEffect(() => {
    loadAllocations();
  }, [loadAllocations]);

  useEffect(() => {
    loadMetadata();
  }, []);

  const handleOpenAllocateModal = () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setSelectedProjectId(projectsList[0]?.id || '');
    setSelectedItemId(itemsList[0]?.id || '');
    setAllocateQty('1');
    setSelectedLocation('main');
    setAllocateNotes('');
    setShowAllocateModal(true);
  };

  const handleSubmitAllocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId || !selectedItemId) {
      setErrorMsg('لطفاً پروژه و کالای اولیه را انتخاب کنید.');
      return;
    }

    const qtyNum = parseFloat(allocateQty);
    if (isNaN(qtyNum) || qtyNum <= 0) {
      setErrorMsg('تعداد یا مقدار تخصیص باید بزرگتر از صفر باشد.');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    try {
      await fetchJson('/inventory/allocations/allocate', {
        method: 'POST',
        body: JSON.stringify({
          projectId: selectedProjectId,
          allocations: [
            {
              itemId: selectedItemId,
              quantity: qtyNum,
              location: selectedLocation,
              notes: allocateNotes
            }
          ]
        })
      });

      setShowAllocateModal(false);
      loadAllocations();
    } catch (err) {
      setErrorMsg(err.message || 'خطا در ثبت تخصیص به پروژه');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConsume = async (alloc: any) => {
    if (!(await confirmAction({ title: 'مصرف قطعی تخصیص', message: `آیا از مصرف قطعی ${alloc.quantity} ${alloc.unit} کالای ${alloc.itemName} در پروژه ${alloc.projectCode} اطمینان دارید؟` }))) {
      return;
    }
    try {
      await fetchJson(`/inventory/allocations/${alloc.id}/consume`, {
        method: 'POST'
      });
      loadAllocations();
    } catch (err) {
      toast.error((err as any)?.message || 'خطا در ثبت مصرف');
    }
  };

  const handleConfirmRelease = async () => {
    if (!releaseTarget) return;
    setReleasing(true);
    try {
      await fetchJson(`/inventory/allocations/${releaseTarget.id}/release`, {
        method: 'POST',
        body: JSON.stringify({ reason: releaseReason })
      });
      setReleaseTarget(null);
      loadAllocations();
    } catch (err) {
      toast.error((err as any)?.message || 'خطا در آزادسازی تخصیص');
    } finally {
      setReleasing(false);
    }
  };

  const handleExportExcel = () => {
    const data = allocations.map((a, idx) => ({
      'ردیف': idx + 1,
      'شناسه تخصیص': a.id,
      'کد پروژه': a.projectCode,
      'کد کالا': a.itemCode,
      'نام کالای اولیه': a.itemName,
      'مقدار تخصیص': a.quantity,
      'واحد': a.unit,
      'انبار مبداء': a.sourceLocation,
      'شناسه تراکنش کاردکس': a.sourceTransactionId || '-',
      'وضعیت': a.status === 'allocated' ? 'در جریان تولید' : (a.status === 'consumed' ? 'مصرف شده' : 'آزاد شده'),
      'تخصیص‌دهنده': a.username,
      'تاریخ تخصیص': a.allocatedAt ? formatPersianDate(a.allocatedAt) : '-',
      'توضیحات': a.notes || ''
    }));

    const ws = xlsx.utils.json_to_sheet(data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'BOM Allocations');
    xlsx.writeFile(wb, `BOM_Allocations_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // KPIs
  const totalAllocatedCount = allocations.length;
  const activeAllocatedCount = allocations.filter((a) => a.status === 'allocated').length;
  const consumedCount = allocations.filter((a) => a.status === 'consumed').length;
  const releasedCount = allocations.filter((a) => a.status === 'released').length;

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500 font-medium">کل رکوردهای تخصیص</div>
            <div className="text-2xl font-black text-slate-800 font-mono mt-1">
              {formatPersianNumber(totalAllocatedCount)}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">ثبت شده در زنجیره تولید</div>
          </div>
          <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
            <Boxes size={24} />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500 font-medium">در جریان مصرف تولید (رزرو قطعی)</div>
            <div className="text-2xl font-black text-amber-600 font-mono mt-1">
              {formatPersianNumber(activeAllocatedCount)}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">کسر شده از موجودی آزاد انبار</div>
          </div>
          <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
            <Clock size={24} />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500 font-medium">مصرف قطعی در محصول</div>
            <div className="text-2xl font-black text-emerald-600 font-mono mt-1">
              {formatPersianNumber(consumedCount)}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">تکمیل شده در خط تولید</div>
          </div>
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
            <CheckCircle2 size={24} />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500 font-medium">آزادسازی و عودت به انبار</div>
            <div className="text-2xl font-black text-slate-600 font-mono mt-1">
              {formatPersianNumber(releasedCount)}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">برگشت داده شده با سند اصلاحی</div>
          </div>
          <div className="p-3 bg-slate-100 text-slate-600 rounded-xl">
            <RotateCcw size={24} />
          </div>
        </div>
      </div>

      {/* Action & Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Search */}
          <div className="relative min-w-[240px]">
            <Search className="absolute right-3 top-2.5 text-slate-400" size={16} />
            <input
              type="text"
              placeholder="جستجو بر اساس کد پروژه، نام کالا یا کاربر..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-3 pr-9 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-semibold">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                statusFilter === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              همه ({formatPersianNumber(totalAllocatedCount)})
            </button>
            <button
              onClick={() => setStatusFilter('allocated')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                statusFilter === 'allocated' ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              در جریان ({formatPersianNumber(activeAllocatedCount)})
            </button>
            <button
              onClick={() => setStatusFilter('consumed')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                statusFilter === 'consumed' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              مصرف‌شده ({formatPersianNumber(consumedCount)})
            </button>
            <button
              onClick={() => setStatusFilter('released')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                statusFilter === 'released' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              آزادشده ({formatPersianNumber(releasedCount)})
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportExcel}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer transition-colors shadow-sm"
          >
            <Download size={15} />
            <span>خروجی اکسل</span>
          </button>

          <button
            onClick={loadAllocations}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            <span>تازه‌سازی</span>
          </button>

          <button
            onClick={handleOpenAllocateModal}
            className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer transition-colors shadow-sm"
          >
            <Plus size={15} />
            <span>تخصیص مواد به پروژه</span>
          </button>
        </div>
      </div>

      {/* Main Allocations Table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="bg-slate-100/80 border-b border-slate-200 text-slate-700 font-bold">
                <th className="py-3 px-3 text-center">شناسه</th>
                <th className="py-3 px-3">کد و عنوان پروژه</th>
                <th className="py-3 px-4">ماده اولیه (BOM Item)</th>
                <th className="py-3 px-3 text-center">مقدار و واحد</th>
                <th className="py-3 px-3 text-center">انبار مبداء</th>
                <th className="py-3 px-3 text-center">شناسه سند کاردکس</th>
                <th className="py-3 px-3 text-center">وضعیت</th>
                <th className="py-3 px-3">تخصیص‌دهنده و زمان</th>
                <th className="py-3 px-3 text-center">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-400">
                    <RefreshCw className="animate-spin inline-block mr-2" size={16} />
                    در حال بارگذاری لیست تخصیص‌های BOM...
                  </td>
                </tr>
              ) : allocations.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-400">
                    هیچ رکوردی منطبق با فیلترهای جاری یافت نشد.
                  </td>
                </tr>
              ) : (
                allocations.map((alloc) => (
                  <tr key={alloc.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-3 text-center font-mono font-bold text-slate-600">
                      #{alloc.id}
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-bold text-blue-700 font-mono">{alloc.projectCode}</div>
                      <div className="text-[11px] text-slate-500 truncate max-w-[160px]">{alloc.notes || 'پروژه تولید'}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900">{alloc.itemName}</div>
                      <div className="text-[11px] text-slate-400 font-mono">{alloc.itemCode}</div>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className="font-bold text-slate-800 font-mono text-sm">
                        {formatPersianNumber(alloc.quantity)}
                      </span>{' '}
                      <span className="text-slate-500 text-[11px]">{alloc.unit}</span>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-slate-100 text-slate-700 font-medium">
                        <Warehouse size={12} />
                        {alloc.sourceLocation || 'main'}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center">
                      {alloc.sourceTransactionId ? (
                        <span className="font-mono text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded font-bold">
                          TX-{alloc.sourceTransactionId}
                        </span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-center">
                      {alloc.status === 'allocated' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                          <Clock size={12} />
                          در جریان تولید
                        </span>
                      )}
                      {alloc.status === 'consumed' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <CheckCircle2 size={12} />
                          مصرف شده
                        </span>
                      )}
                      {alloc.status === 'released' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-300">
                          <RotateCcw size={12} />
                          آزاد شده
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-1 text-slate-700 font-medium">
                        <User size={12} className="text-slate-400" />
                        <span>{alloc.username || 'سیستم'}</span>
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                        {alloc.allocatedAt ? formatPersianDate(alloc.allocatedAt) : '-'}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => setSelectedAllocForTrace(alloc)}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                          title="مشاهده شناسنامه ردگیری منبع (Traceability)"
                        >
                          <FileText size={15} />
                        </button>

                        {alloc.status === 'allocated' && (
                          <>
                            <button
                              onClick={() => handleConsume(alloc)}
                              className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-300 rounded-lg text-[11px] font-bold transition-colors cursor-pointer"
                              title="ثبت مصرف قطعی در محصول"
                            >
                              مصرف شد
                            </button>
                            <button
                              onClick={() => setReleaseTarget(alloc)}
                              className="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 rounded-lg text-[11px] font-bold transition-colors cursor-pointer"
                              title="آزادسازی و عودت به انبار"
                            >
                              آزادسازی
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Traceability Modal */}
      {selectedAllocForTrace && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl text-right animate-in fade-in zoom-in-95 duration-200 max-h-[85vh] flex flex-col overflow-hidden"><div className="p-6 overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2 text-slate-800 font-black">
                <FileText className="text-blue-600" size={20} />
                <span>شناسنامه ردگیری تخصیص مواد (BOM Traceability)</span>
              </div>
              <span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-600 font-bold">
                #{selectedAllocForTrace.id}
              </span>
            </div>

            <div className="space-y-3 text-xs">
              <div className="bg-blue-50 border border-blue-200 p-3.5 rounded-2xl space-y-2">
                <div className="flex justify-between items-center text-blue-900 font-bold">
                  <span>پروژه مقصد:</span>
                  <span className="font-mono">{selectedAllocForTrace.projectCode}</span>
                </div>
                <div className="flex justify-between items-center text-blue-800">
                  <span>ماده اولیه تخصیص‌یافته:</span>
                  <span className="font-bold">{selectedAllocForTrace.itemName} ({selectedAllocForTrace.itemCode})</span>
                </div>
                <div className="flex justify-between items-center text-blue-800">
                  <span>مقدار کسر شده:</span>
                  <span className="font-bold font-mono">{formatPersianNumber(selectedAllocForTrace.quantity)} {selectedAllocForTrace.unit}</span>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 p-3.5 rounded-2xl space-y-2">
                <div className="text-slate-700 font-bold flex items-center gap-1.5">
                  <Warehouse size={14} className="text-slate-500" />
                  <span>ردگیری سند کاردکس مبداء (Source Inventory Transaction):</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-slate-600 pt-1">
                  <div>
                    <span className="text-slate-400">شناسه تراکنش: </span>
                    <span className="font-mono font-bold text-slate-800">
                      TX-{selectedAllocForTrace.sourceTransactionId || '-'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">انبار مبداء: </span>
                    <span className="font-bold text-slate-800">{selectedAllocForTrace.sourceLocation}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">تاریخ تخصیص: </span>
                    <span className="font-mono text-slate-800">
                      {selectedAllocForTrace.allocatedAt ? formatPersianDate(selectedAllocForTrace.allocatedAt) : '-'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">تخصیص‌دهنده: </span>
                    <span className="font-bold text-slate-800">{selectedAllocForTrace.username || 'سیستم'}</span>
                  </div>
                </div>
              </div>

              {selectedAllocForTrace.consumedAt && (
                <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-xl text-emerald-800 flex items-center justify-between">
                  <span className="font-bold">زمان مصرف در خط تولید:</span>
                  <span className="font-mono">{formatPersianDate(selectedAllocForTrace.consumedAt)}</span>
                </div>
              )}

              {selectedAllocForTrace.releasedAt && (
                <div className="bg-slate-100 border border-slate-300 p-3 rounded-xl text-slate-700 flex items-center justify-between">
                  <span className="font-bold">زمان آزادسازی و برگشت به انبار:</span>
                  <span className="font-mono">{formatPersianDate(selectedAllocForTrace.releasedAt)}</span>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedAllocForTrace(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs cursor-pointer transition-colors"
              >
                بستن پنجره
              </button>
            </div>
            </div>
          </div>
        </div>
      )}

      {/* Release Reason Modal */}
      {releaseTarget && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl text-right animate-in fade-in zoom-in-95 duration-200 max-h-[85vh] overflow-y-auto p-6">
            <div className="flex items-center gap-2 text-rose-600 font-black border-b border-slate-100 pb-3">
              <RotateCcw size={20} />
              <span>تأیید آزادسازی و برگشت مواد به انبار</span>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              با این اقدام، مقدار <strong className="text-slate-900">{formatPersianNumber(releaseTarget.quantity)} {releaseTarget.unit}</strong> از کالای <strong className="text-slate-900">{releaseTarget.itemName}</strong> به موجودی انبار <strong className="text-slate-900">{releaseTarget.sourceLocation}</strong> عودت داده شده و سند ورود اصلاحی در کاردکس ثبت خواهد شد.
            </p>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">دلیل آزادسازی:</label>
              <textarea
                value={releaseReason}
                onChange={(e) => setReleaseReason(e.target.value)}
                rows={3}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs outline-none focus:ring-2 focus:ring-rose-500"
                placeholder="توضیحات دلیل لغو یا تغییر تخصیص..."
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setReleaseTarget(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs cursor-pointer transition-colors"
              >
                انصراف
              </button>
              <button
                type="button"
                disabled={releasing}
                onClick={handleConfirmRelease}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs cursor-pointer transition-colors disabled:opacity-50"
              >
                {releasing ? 'در حال ثبت برگشت...' : 'تأیید آزادسازی به انبار'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Allocate Material Form Modal */}
      {showAllocateModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl text-right animate-in fade-in zoom-in-95 duration-200 max-h-[85vh] flex flex-col overflow-hidden"><div className="p-6 overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2 text-slate-800 font-black">
                <Boxes className="text-blue-600" size={20} />
                <span>تخصیص مواد اولیه BOM به پروژه تولید</span>
              </div>
              <button
                onClick={() => setShowAllocateModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                ✕
              </button>
            </div>

            {errorMsg && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
                <AlertCircle size={16} />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleSubmitAllocation} className="space-y-3.5 text-xs">
              {/* Project Select */}
              <div>
                <label className="block text-slate-700 font-bold mb-1">پروژه تولید مقصد:</label>
                <select
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(Number(e.target.value))}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                >
                  <option value="">-- انتخاب پروژه --</option>
                  {projectsList.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.projectCode} - {p.title}
                    </option>
                  ))}
                </select>
              </div>

              {/* Raw Material Select */}
              <div>
                <label className="block text-slate-700 font-bold mb-1">ماده اولیه / قطعه (Raw Material):</label>
                <select
                  value={selectedItemId}
                  onChange={(e) => setSelectedItemId(Number(e.target.value))}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                >
                  <option value="">-- انتخاب ماده اولیه --</option>
                  {itemsList.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.code}) - موجودی کل: {formatPersianNumber(item.currentStock || item.current_stock || 0)} {item.unit}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Quantity */}
                <div>
                  <label className="block text-slate-700 font-bold mb-1">مقدار تخصیص:</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={allocateQty}
                    onChange={(e) => setAllocateQty(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-mono font-bold"
                  />
                </div>

                {/* Warehouse Location */}
                <div>
                  <label className="block text-slate-700 font-bold mb-1">انبار مبداء کسر موجودی:</label>
                  <select
                    value={selectedLocation}
                    onChange={(e) => setSelectedLocation(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                  >
                    <option value="main">انبار مرکزی (main)</option>
                    <option value="warehouse_b">انبار مواد اولیه (warehouse_b)</option>
                    <option value="production">انبار خط تولید (production)</option>
                  </select>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-slate-700 font-bold mb-1">توضیحات و بابت (اختیاری):</label>
                <input
                  type="text"
                  value={allocateNotes}
                  onChange={(e) => setAllocateNotes(e.target.value)}
                  placeholder="مثال: تخصیص برای سری ساخت اول مهر ماه"
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAllocateModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl cursor-pointer transition-colors"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl cursor-pointer transition-colors disabled:opacity-50"
                >
                  {submitting ? 'در حال ثبت...' : 'تأیید و ثبت تخصیص'}
                </button>
              </div>
            </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
