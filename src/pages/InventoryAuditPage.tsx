import React, { useState, useEffect, useCallback } from 'react';
import { 
  ShieldCheck, 
  RotateCcw, 
  ArrowLeftRight, 
  ClipboardCheck, 
  Layers, 
  X, 
  RefreshCw 
} from 'lucide-react';
import * as xlsx from 'xlsx';
import toast from 'react-hot-toast';
import { fetchJson } from '../api';
import { formatPersianDate, formatPersianNumber } from '../utils';

// Subcomponents
import { Inventory3WayIntegrityTab } from '../components/inventory/Inventory3WayIntegrityTab';
import { PhysicalAuditSheetTab } from '../components/inventory/PhysicalAuditSheetTab';
import { PastAuditReportsTab } from '../components/inventory/PastAuditReportsTab';
import { WarehouseTransfersListTab } from '../components/inventory/WarehouseTransfersListTab';
import { ProjectBomAllocationsTab } from '../components/inventory/ProjectBomAllocationsTab';
import { Boxes } from 'lucide-react';


// Modals
import RunningKardexModal from '../components/RunningKardexModal';
import WarehouseTransferModal from '../components/WarehouseTransferModal';
import InventoryRebuildModal from '../components/InventoryRebuildModal';

interface InventoryAuditPageProps {
  user: any;
}

export function InventoryAuditPage({ user }: InventoryAuditPageProps) {
  // Navigation
  const [activeTab, setActiveTab] = useState<'new_audit' | 'integrity' | 'reports' | 'transfers' | 'bom_allocations'>('new_audit');

  // Modal States
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showRebuildModal, setShowRebuildModal] = useState(false);
  const [rebuildTargetItemId, setRebuildTargetItemId] = useState<number | undefined>(undefined);
  const [kardexItemId, setKardexItemId] = useState<number | null>(null);

  // Tab 1: Integrity Report State
  const [integrityReport, setIntegrityReport] = useState<any>(null);
  const [integrityLoading, setIntegrityLoading] = useState(false);
  const [integritySearch, setIntegritySearch] = useState('');
  const [integrityDiscrepancyOnly, setIntegrityDiscrepancyOnly] = useState(false);

  // Tab 2: Physical Audit Form State
  const [selectedLocation, setSelectedLocation] = useState('انبار مرکزی');
  const [nextRef, setNextRef] = useState('AUD-1001');
  const [notes, setNotes] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [items, setItems] = useState<any[]>([]);
  const [auditedItemsMap, setAuditedItemsMap] = useState<Record<number, any>>({});
  const [submitting, setSubmitting] = useState(false);
  // V10-3.4: خلاصه شمارش برای مودال تایید پیش از ثبت نهایی انبارگردانی
  const [pendingAuditSummary, setPendingAuditSummary] = useState<{ list: any[]; counted: number; matched: number; surplus: number; shortage: number; surplusQty: number; shortageQty: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Tab 3: Past Audits State
  const [auditDocs, setAuditDocs] = useState<any[]>([]);
  const [auditDocsLoading, setAuditDocsLoading] = useState(false);
  const [selectedAudit, setSelectedAudit] = useState<any>(null);
  const [showModal, setShowModal] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);

  // Tab 4: Transfers List State
  const [transfers, setTransfers] = useState<any[]>([]);
  const [transfersLoading, setTransfersLoading] = useState(false);
  const [selectedTransfer, setSelectedTransfer] = useState<any>(null);
  const [showTransferDetailModal, setShowTransferDetailModal] = useState(false);

  // All Items List for rebuild modal
  const [allItemsList, setAllItemsList] = useState<any[]>([]);

  // Load Integrity Report
  const loadIntegrityReport = useCallback(async (signal?: AbortSignal) => {
    setIntegrityLoading(true);
    try {
      const res = await fetchJson('/inventory/integrity-audit', { signal });
      setIntegrityReport(res?.report || res);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Error loading integrity report:', err);
    } finally {
      setIntegrityLoading(false);
    }
  }, []);

  // Load Physical Audit Items
  const loadPhysicalAuditItems = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetchJson(`/documents/audit-items?location=${encodeURIComponent(selectedLocation)}`, { signal });
      const raw = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
      const formatted = raw.map((i: any) => ({
        ...i,
        system_stock_computed: Number(i.system_stock_computed ?? i.system_stock ?? i.current_stock ?? i.currentStock ?? 0),
        physical_stock: auditedItemsMap[i.id]?.physical_stock || ''
      }));
      setItems(formatted);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Error loading audit items:', err);
    }
  }, [selectedLocation, auditedItemsMap]);

  // Load All Items for Selectors
  const fetchAllItems = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetchJson('/items?limit=1000', { signal });
      const raw = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
      setAllItemsList(raw);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Error loading items:', err);
    }
  }, []);

  // Load Past Audit Docs
  const loadPastAudits = useCallback(async (signal?: AbortSignal) => {
    setAuditDocsLoading(true);
    try {
      const res = await fetchJson('/documents?type=audit', { signal });
      const raw = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
      setAuditDocs(raw);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Error loading past audits:', err);
    } finally {
      setAuditDocsLoading(false);
    }
  }, []);

  // Load Transfers
  const loadTransfers = useCallback(async (signal?: AbortSignal) => {
    setTransfersLoading(true);
    try {
      const res = await fetchJson('/documents?type=transfer', { signal });
      const raw = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
      setTransfers(raw);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Error loading transfers:', err);
    } finally {
      setTransfersLoading(false);
    }
  }, []);

  // Initial Load
  useEffect(() => {
    const controller = new AbortController();
    loadIntegrityReport(controller.signal);
    fetchAllItems(controller.signal);
    return () => controller.abort();
  }, [loadIntegrityReport, fetchAllItems]);

  useEffect(() => {
    const controller = new AbortController();
    if (activeTab === 'integrity') {
      loadIntegrityReport(controller.signal);
    } else if (activeTab === 'new_audit') {
      loadPhysicalAuditItems(controller.signal);
    } else if (activeTab === 'reports') {
      loadPastAudits(controller.signal);
    } else if (activeTab === 'transfers') {
      loadTransfers(controller.signal);
    }
    return () => controller.abort();
  }, [activeTab, selectedLocation, loadIntegrityReport, loadPhysicalAuditItems, loadPastAudits, loadTransfers]);

  // Physical Audit Change Handlers
  const handlePhysicalChange = (itemId: number, value: string) => {
    const targetItem = items.find(i => i.id === itemId);
    if (!targetItem) return;

    const updatedItem = { ...targetItem, physical_stock: value };
    setItems(prev => prev.map(i => (i.id === itemId ? updatedItem : i)));

    setAuditedItemsMap(prev => {
      if (value.trim() === '') {
        const copy = { ...prev };
        delete copy[itemId];
        return copy;
      }
      return { ...prev, [itemId]: updatedItem };
    });
  };

  const handleApplyCurrentStockAsPhysical = () => {
    const updatedMap = { ...auditedItemsMap };
    const updatedItems = items.map(i => {
      const valStr = String(i.system_stock_computed);
      const updated = { ...i, physical_stock: valStr };
      updatedMap[i.id] = updated;
      return updated;
    });
    setItems(updatedItems);
    setAuditedItemsMap(updatedMap);
  };

  const handleSubmitAudit = async () => {
    const auditedList = Object.values(auditedItemsMap);
    if (auditedList.length === 0) {
      setErrorMsg('هیچ کالایی جهت ثبت انبارگردانی مقداردهی نشده است.');
      return;
    }

    // V10-3.4: محاسبه خلاصه شمارش و نمایش مودال تایید — ثبت واقعی فقط پس از تایید کاربر
    let matched = 0;
    let surplus = 0;
    let shortage = 0;
    let surplusQty = 0;
    let shortageQty = 0;
    for (const it of auditedList as any[]) {
      const phys = Number(it.physical_stock) || 0;
      const sys = Number(it.system_stock_computed) || 0;
      const variance = phys - sys;
      if (Math.abs(variance) < 1e-9) {
        matched += 1;
      } else if (variance > 0) {
        surplus += 1;
        surplusQty += variance;
      } else {
        shortage += 1;
        shortageQty += Math.abs(variance);
      }
    }
    setPendingAuditSummary({ list: auditedList, counted: auditedList.length, matched, surplus, shortage, surplusQty, shortageQty });
  };

  /** V10-3.4: اجرای ثبت نهایی پس از تایید در مودال خلاصه */
  const confirmSubmitAudit = async () => {
    if (!pendingAuditSummary || pendingAuditSummary.list.length === 0) return;
    const auditedList = pendingAuditSummary.list;

    setSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const payload = {
        docType: 'audit',
        refNumber: nextRef,
        date: new Date().toISOString().split('T')[0],
        location: selectedLocation,
        user: user?.full_name || user?.username || 'انباردار',
        notes: notes || `ثبت انبارگردانی در موقعیت ${selectedLocation}`,
        status: 'final',
        items: auditedList.map((i: any) => {
          const phys = parseFloat(i.physical_stock) || 0;
          return {
            itemId: i.id,
            system_stock: i.system_stock_computed,
            physical_stock: phys,
            quantity: phys,
            location: selectedLocation
          };
        })
      };

      await fetchJson('/documents', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      setSuccessMsg(`سند انبارگردانی با شماره ${nextRef} با موفقیت ثبت و موجودی انبار به‌روزرسانی شد.`);
      setPendingAuditSummary(null);
      setAuditedItemsMap({});
      setNotes('');
      loadPhysicalAuditItems();
      fetchAllItems();
      loadIntegrityReport();
    } catch (err: any) {
      setErrorMsg(err.message || 'خطا در ثبت سند انبارگردانی');
    } finally {
      setSubmitting(false);
    }
  };

  const handleViewAudit = (docId: number) => {
    setModalLoading(true);
    setShowModal(true);
    fetchJson(`/documents/${docId}`)
      .then(res => setSelectedAudit(res))
      .catch(err => {
        console.error(`Failed to fetch audit document ${docId}:`, err);
        toast.error('خطا در دریافت جزئیات سند انبارگردانی');
      })
      .finally(() => setModalLoading(false));
  };

  const handleViewTransfer = (docId: number) => {
    setModalLoading(true);
    setShowTransferDetailModal(true);
    fetchJson(`/documents/${docId}`)
      .then(res => setSelectedTransfer(res))
      .catch(err => {
        console.error(`Failed to fetch transfer document ${docId}:`, err);
        toast.error('خطا در دریافت جزئیات حواله بین‌انباری');
      })
      .finally(() => setModalLoading(false));
  };

  const handleExportIntegrityExcel = () => {
    if (!integrityReport?.items?.length) return;
    try {
      const rows = integrityReport.items.map((i: any, idx: number) => ({
        'ردیف': idx + 1,
        'کد کالا': i.itemCode,
        'نام کالا': i.itemName,
        'دسته‌بندی': i.category,
        'واحد': i.unit,
        'موجودی اسمی (Current Stock)': i.currentStock,
        'مجموع انبارهای تفکیکی (JSONB)': i.warehouseStocksSum,
        'موجودی کاردکس (Ledger)': i.ledgerStock,
        'مغایرت مقداری': i.variance,
        'وضعیت تطبیق': i.isSynchronized ? 'منطبق' : i.discrepancyType,
        'تعداد تراکنش‌ها': i.transactionCount,
        'میانگین موزون ذخیره‌شده (WAC)': i.storedWac,
        'میانگین موزون بازسازی‌شده': i.recalculatedWac
      }));

      const ws = xlsx.utils.json_to_sheet(rows);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'ممیزی سلامت انبار');
      xlsx.writeFile(wb, `Inventory_Integrity_Audit.xlsx`);
    } catch (err) {
      console.error(err);
    }
  };

  // Filtered lists
  const filteredIntegrityItems = (integrityReport?.items || []).filter((item: any) => {
    if (integrityDiscrepancyOnly && item.isSynchronized) return false;
    if (!integritySearch.trim()) return true;
    const q = integritySearch.toLowerCase();
    return (
      item.itemName?.toLowerCase().includes(q) ||
      item.itemCode?.toLowerCase().includes(q) ||
      item.category?.toLowerCase().includes(q)
    );
  });

  const categories: string[] = Array.from(new Set(items.map((i: any) => i.category).filter(Boolean)));
  const filteredAuditItems = items.filter(i => {
    if (categoryFilter !== 'all' && i.category !== categoryFilter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return i.name?.toLowerCase().includes(q) || i.code?.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6" style={{ direction: 'rtl' }}>
      {/* Header & Tabs Nav */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-100 text-blue-700 rounded-2xl">
              <ShieldCheck size={26} />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
                مرکز یکپارچگی انبار و انبارگردانی (Inventory Integrity & Kardex)
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                تطبیق ۳ جانبه موجودی، کاردکس لحظه‌ای، ثبت انبارگردانی فیزیکی و انتقال بین انبارها
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => {
                setRebuildTargetItemId(undefined);
                setShowRebuildModal(true);
              }}
              className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors shadow-sm"
            >
              <RotateCcw size={15} />
              <span>تطبیق و بازسازی هوشمند انبار</span>
            </button>

            <button
              onClick={() => setShowTransferModal(true)}
              className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors shadow-sm"
            >
              <ArrowLeftRight size={15} />
              <span>ثبت حواله انتقال انبار</span>
            </button>
          </div>
        </div>

        {/* Tab Buttons */}
        <div className="flex items-center gap-2 pt-3 overflow-x-auto text-xs font-semibold">
          <button
            onClick={() => setActiveTab('integrity')}
            className={`px-4 py-2 rounded-xl flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'integrity'
                ? 'bg-slate-900 text-white shadow-md'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <ShieldCheck size={16} />
            <span>ماتریس سلامت و تطبیق ۳ جانبه کاردکس</span>
            {integrityReport?.summary?.discrepancyItems > 0 && (
              <span className="bg-rose-500 text-white text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                {integrityReport.summary.discrepancyItems}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('new_audit')}
            className={`px-4 py-2 rounded-xl flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'new_audit'
                ? 'bg-slate-900 text-white shadow-md'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <ClipboardCheck size={16} />
            <span>ثبت انبارگردانی فیزیکی دوره</span>
          </button>

          <button
            onClick={() => setActiveTab('reports')}
            className={`px-4 py-2 rounded-xl flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'reports'
                ? 'bg-slate-900 text-white shadow-md'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Layers size={16} />
            <span>سوابق اسناد انبارگردانی</span>
          </button>

          <button
            onClick={() => setActiveTab('transfers')}
            className={`px-4 py-2 rounded-xl flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'transfers'
                ? 'bg-slate-900 text-white shadow-md'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <ArrowLeftRight size={16} />
            <span>سوابق حواله‌های انتقال بین انبارها</span>
          </button>

          <button
            onClick={() => setActiveTab('bom_allocations')}
            className={`px-4 py-2 rounded-xl flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'bom_allocations'
                ? 'bg-slate-900 text-white shadow-md'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Boxes size={16} />
            <span>تخصیص مواد اولیه BOM و ردگیری منبع</span>
          </button>
        </div>
      </div>

      {/* TAB CONTENT */}
      {activeTab === 'integrity' && (
        <Inventory3WayIntegrityTab
          integrityReport={integrityReport}
          integrityLoading={integrityLoading}
          integritySearch={integritySearch}
          setIntegritySearch={setIntegritySearch}
          integrityDiscrepancyOnly={integrityDiscrepancyOnly}
          setIntegrityDiscrepancyOnly={setIntegrityDiscrepancyOnly}
          filteredIntegrityItems={filteredIntegrityItems}
          loadIntegrityReport={loadIntegrityReport}
          onOpenRebuildModal={(itemId) => {
            setRebuildTargetItemId(itemId);
            setShowRebuildModal(true);
          }}
          onOpenKardexModal={(itemId) => setKardexItemId(itemId)}
          onExportExcel={handleExportIntegrityExcel}
        />
      )}

      {activeTab === 'new_audit' && (
        <PhysicalAuditSheetTab
          selectedLocation={selectedLocation}
          setSelectedLocation={setSelectedLocation}
          nextRef={nextRef}
          notes={notes}
          setNotes={setNotes}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          categoryFilter={categoryFilter}
          setCategoryFilter={setCategoryFilter}
          categories={categories}
          filteredItems={filteredAuditItems}
          auditedItemsMap={auditedItemsMap}
          submitting={submitting}
          errorMsg={errorMsg}
          successMsg={successMsg}
          handlePhysicalChange={handlePhysicalChange}
          handleApplyCurrentStockAsPhysical={handleApplyCurrentStockAsPhysical}
          handleSubmitAudit={handleSubmitAudit}
        />
      )}

      {activeTab === 'reports' && (
        <PastAuditReportsTab
          auditDocsLoading={auditDocsLoading}
          auditDocs={auditDocs}
          handleViewAudit={handleViewAudit}
        />
      )}

      {activeTab === 'transfers' && (
        <WarehouseTransfersListTab
          transfersLoading={transfersLoading}
          transfers={transfers}
          handleViewTransfer={handleViewTransfer}
          onOpenTransferModal={() => setShowTransferModal(true)}
        />
      )}

      {activeTab === 'bom_allocations' && (
        <ProjectBomAllocationsTab user={user} />
      )}


      {/* MODALS */}
      {kardexItemId && (
        <RunningKardexModal
          itemId={kardexItemId}
          isOpen={true}
          onClose={() => setKardexItemId(null)}
        />
      )}

      {showTransferModal && (
        <WarehouseTransferModal
          isOpen={true}
          onClose={() => setShowTransferModal(false)}
          onSuccess={() => {
            loadTransfers();
            loadIntegrityReport();
            fetchAllItems();
          }}
        />
      )}

      {showRebuildModal && (
        <InventoryRebuildModal
          isOpen={true}
          onClose={() => {
            setShowRebuildModal(false);
            setRebuildTargetItemId(undefined);
          }}
          defaultItemId={rebuildTargetItemId}
          itemsList={allItemsList}
          onSuccess={() => {
            loadIntegrityReport();
            fetchAllItems();
          }}
        />
      )}

      {/* Audit Detail Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in" style={{ direction: 'rtl' }}>
          <div className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden border border-slate-200">
            <div className="flex items-center justify-between p-5 border-b bg-slate-50">
              <div className="flex items-center gap-3">
                <ClipboardCheck className="text-blue-600" size={22} />
                <h3 className="font-bold text-slate-800 text-lg">
                  جزئیات سند انبارگردانی {selectedAudit ? `شماره ${selectedAudit.ref_number || selectedAudit.refNumber}` : ''}
                </h3>
              </div>
              <button 
                onClick={() => { setShowModal(false); setSelectedAudit(null); }}
                className="p-1.5 hover:bg-slate-200 text-slate-400 hover:text-slate-600 rounded-lg transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {modalLoading ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3 text-slate-500">
                  <RefreshCw className="animate-spin text-blue-600" size={32} />
                  <span>در حال دریافت اطلاعات...</span>
                </div>
              ) : selectedAudit ? (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100 text-xs">
                    <div>
                      <span className="text-slate-500 block mb-1">شماره سند:</span>
                      <strong className="text-slate-800 font-mono text-sm">{selectedAudit.ref_number || selectedAudit.refNumber}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block mb-1">تاریخ ثبت:</span>
                      <strong className="text-slate-800 font-mono">{formatPersianDate(selectedAudit.date)}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block mb-1">موقعیت انبار:</span>
                      <strong className="text-blue-700 font-bold">{selectedAudit.location || 'اصلی'}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block mb-1">ثبت‌کننده:</span>
                      <strong className="text-slate-800">{selectedAudit.user || '-'}</strong>
                    </div>
                  </div>

                  <div className="border rounded-xl overflow-hidden shadow-sm">
                    <table className="w-full text-xs text-right">
                      <thead className="bg-slate-50 border-b">
                        <tr>
                          <th className="p-3 text-slate-600">ردیف</th>
                          <th className="p-3 text-slate-600">کد کالا</th>
                          <th className="p-3 text-slate-600">نام کالا</th>
                          <th className="p-3 text-center text-slate-600">موجودی سیستم</th>
                          <th className="p-3 text-center text-slate-600">موجودی فیزیکی</th>
                          <th className="p-3 text-center text-slate-600">مغایرت</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {selectedAudit.items?.map((line: any, idx: number) => {
                          const variance = Number(line.variance || (Number(line.quantity) - Number(line.system_stock || 0)));
                          return (
                            <tr key={idx} className="hover:bg-slate-50/50">
                              <td className="p-3 text-slate-500">{idx + 1}</td>
                              <td className="p-3 text-slate-600 font-mono">{line.code}</td>
                              <td className="p-3 text-slate-800 font-medium">{line.name}</td>
                              <td className="p-3 text-center text-slate-600 font-mono">{line.system_stock} {line.unit}</td>
                              <td className="p-3 text-center text-slate-800 font-mono font-bold">{line.quantity} {line.unit}</td>
                              <td className="p-3 text-center">
                                {variance === 0 ? (
                                  <span className="text-xs bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full">
                                    ✓ منطبق
                                  </span>
                                ) : variance > 0 ? (
                                  <span className="text-xs bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded-full font-mono">
                                    +{variance} اضافی
                                  </span>
                                ) : (
                                  <span className="text-xs bg-rose-100 text-rose-800 font-bold px-2 py-0.5 rounded-full font-mono">
                                    {variance} کسری
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </div>

            <div className="p-4 border-t bg-slate-50 flex justify-end">
              <button
                onClick={() => { setShowModal(false); setSelectedAudit(null); }}
                className="px-4 py-2 bg-slate-200 text-slate-700 hover:bg-slate-300 rounded-xl font-medium text-xs transition-colors"
              >
                بستن
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transfer Detail Modal */}
      {showTransferDetailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in" style={{ direction: 'rtl' }}>
          <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden border border-slate-200">
            <div className="flex items-center justify-between p-5 border-b bg-slate-50">
              <div className="flex items-center gap-3">
                <ArrowLeftRight className="text-blue-600" size={22} />
                <h3 className="font-bold text-slate-800 text-lg">
                  جزئیات حواله انتقال {selectedTransfer ? `شماره ${selectedTransfer.ref_number || selectedTransfer.refNumber}` : ''}
                </h3>
              </div>
              <button 
                onClick={() => { setShowTransferDetailModal(false); setSelectedTransfer(null); }}
                className="p-1.5 hover:bg-slate-200 text-slate-400 hover:text-slate-600 rounded-lg transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {modalLoading ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3 text-slate-500">
                  <RefreshCw className="animate-spin text-blue-600" size={32} />
                  <span>در حال بارگذاری اطلاعات حواله...</span>
                </div>
              ) : selectedTransfer ? (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100 text-xs">
                    <div>
                      <span className="text-slate-500 block mb-1">شماره حواله:</span>
                      <strong className="text-slate-800 font-mono text-sm">{selectedTransfer.ref_number || selectedTransfer.refNumber}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block mb-1">تاریخ ثبت:</span>
                      <strong className="text-slate-800 font-mono">{formatPersianDate(selectedTransfer.date)}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block mb-1">صادرکننده:</span>
                      <strong className="text-slate-800">{selectedTransfer.user || '-'}</strong>
                    </div>
                  </div>

                  <div className="border rounded-xl overflow-hidden shadow-sm">
                    <table className="w-full text-xs text-right">
                      <thead className="bg-slate-50 border-b">
                        <tr>
                          <th className="p-3 text-slate-600">ردیف</th>
                          <th className="p-3 text-slate-600">کد کالا</th>
                          <th className="p-3 text-slate-600">نام کالا</th>
                          <th className="p-3 text-center text-slate-600">مقدار انتقال</th>
                          <th className="p-3 text-center text-slate-600">انبار مبدا</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {selectedTransfer.items?.map((line: any, idx: number) => (
                          <tr key={idx} className="hover:bg-slate-50/50">
                            <td className="p-3 text-slate-500">{idx + 1}</td>
                            <td className="p-3 text-slate-600 font-mono">{line.code}</td>
                            <td className="p-3 text-slate-800 font-bold">{line.name}</td>
                            <td className="p-3 text-center text-blue-900 font-mono font-bold">{line.quantity} {line.unit}</td>
                            <td className="p-3 text-center font-mono text-slate-700">{line.location || selectedTransfer.location || 'اصلی'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </div>

            <div className="p-4 border-t bg-slate-50 flex justify-end">
              <button
                onClick={() => { setShowTransferDetailModal(false); setSelectedTransfer(null); }}
                className="px-4 py-2 bg-slate-200 text-slate-700 hover:bg-slate-300 rounded-xl font-medium text-xs transition-colors"
              >
                بستن
              </button>
            </div>
          </div>
        </div>
      )}

      {/* V10-3.4: مودال خلاصه تایید پیش از ثبت نهایی انبارگردانی */}
      {pendingAuditSummary && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 space-y-4 p-6 animate-in zoom-in-95 duration-150 max-h-[85vh] overflow-y-auto" dir="rtl">
            <div>
              <h3 className="text-base font-bold text-slate-900">تایید و ثبت نهایی انبارگردانی</h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                پیش از صدور سند «{nextRef}» در موقعیت «{selectedLocation}»، خلاصه شمارش را بازبینی کنید. پس از ثبت، موجودی انبار بر اساس شمارش به‌روزرسانی خواهد شد.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
                <span className="block text-slate-500">تعداد ردیف شمارش‌شده</span>
                <strong className="text-slate-800 text-base font-mono">{formatPersianNumber(pendingAuditSummary.counted)}</strong>
              </div>
              <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50">
                <span className="block text-emerald-700">منطبق با سیستم</span>
                <strong className="text-emerald-800 text-base font-mono">{formatPersianNumber(pendingAuditSummary.matched)}</strong>
              </div>
              <div className={`p-3 rounded-xl border ${pendingAuditSummary.surplus > 0 ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
                <span className={pendingAuditSummary.surplus > 0 ? 'block text-amber-700' : 'block text-slate-500'}>اقلام اضافی (+)</span>
                <strong className={`${pendingAuditSummary.surplus > 0 ? 'text-amber-800' : 'text-slate-800'} text-base font-mono`}>
                  {formatPersianNumber(pendingAuditSummary.surplus)} مورد / {formatPersianNumber(pendingAuditSummary.surplusQty)}
                </strong>
              </div>
              <div className={`p-3 rounded-xl border ${pendingAuditSummary.shortage > 0 ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-slate-50'}`}>
                <span className={pendingAuditSummary.shortage > 0 ? 'block text-rose-700' : 'block text-slate-500'}>اقلام کسری (−)</span>
                <strong className={`${pendingAuditSummary.shortage > 0 ? 'text-rose-800' : 'text-slate-800'} text-base font-mono`}>
                  {formatPersianNumber(pendingAuditSummary.shortage)} مورد / {formatPersianNumber(pendingAuditSummary.shortageQty)}
                </strong>
              </div>
            </div>

            {notes.trim() && (
              <div className="text-xs bg-white border rounded-xl p-3">
                <span className="text-slate-500 block mb-1">یادداشت سند:</span>
                <p className="text-slate-700 leading-relaxed">{notes}</p>
              </div>
            )}

            <div className="flex justify-end gap-2.5 pt-1">
              <button
                onClick={() => setPendingAuditSummary(null)}
                disabled={submitting}
                className="px-4 py-2 border border-slate-300 rounded-xl hover:bg-slate-100 bg-white text-slate-700 text-xs font-bold transition-all cursor-pointer"
              >
                بازگشت برای اصلاح
              </button>
              <button
                onClick={confirmSubmitAudit}
                disabled={submitting}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold disabled:opacity-50 text-xs shadow-md shadow-blue-600/20 transition-all cursor-pointer"
              >
                {submitting ? 'در حال ثبت...' : 'ثبت قطعی انبارگردانی'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default InventoryAuditPage;
