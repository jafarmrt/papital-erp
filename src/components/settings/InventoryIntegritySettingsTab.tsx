import React, { useState, useEffect, useCallback } from 'react';
import * as xlsx from 'xlsx';
import { fetchJson } from '../../api';
import { Inventory3WayIntegrityTab } from '../inventory/Inventory3WayIntegrityTab';
import RunningKardexModal from '../RunningKardexModal';
import InventoryRebuildModal from '../InventoryRebuildModal';

export function InventoryIntegritySettingsTab() {
  const [integrityReport, setIntegrityReport] = useState<any>(null);
  const [integrityLoading, setIntegrityLoading] = useState(false);
  const [integritySearch, setIntegritySearch] = useState('');
  const [integrityDiscrepancyOnly, setIntegrityDiscrepancyOnly] = useState(false);

  // Modals
  const [showRebuildModal, setShowRebuildModal] = useState(false);
  const [rebuildTargetItemId, setRebuildTargetItemId] = useState<number | undefined>(undefined);
  const [kardexItemId, setKardexItemId] = useState<number | null>(null);
  const [allItemsList, setAllItemsList] = useState<any[]>([]);

  const loadIntegrityReport = useCallback(async () => {
    setIntegrityLoading(true);
    try {
      const res = await fetchJson('/inventory/integrity-audit');
      setIntegrityReport(res?.report || res);
    } catch (err) {
      console.error('Error loading integrity report:', err);
    } finally {
      setIntegrityLoading(false);
    }
  }, []);

  const fetchAllItems = useCallback(async () => {
    try {
      const res = await fetchJson('/items');
      const raw = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
      setAllItemsList(raw);
    } catch (err) {
      console.error('Error fetching all items:', err);
    }
  }, []);

  useEffect(() => {
    loadIntegrityReport();
    fetchAllItems();
  }, [loadIntegrityReport, fetchAllItems]);

  const handleExportExcel = () => {
    const list = integrityReport?.audits || integrityReport?.items || [];
    if (!list.length) return;
    try {
      const rows = list.map((i: any, idx: number) => ({
        'ردیف': idx + 1,
        'کد کالا': i.itemCode,
        'نام کالا': i.itemName,
        'دسته‌بندی': i.category || '-',
        'واحد': i.unit,
        'موجودی کل (Current Stock)': i.globalCurrentStock ?? i.currentStock,
        'موجودی انبار تفکیکی': i.locationStock ?? i.warehouseStocksSum,
        'موجودی کاردکس (Ledger)': i.kardexStock ?? i.ledgerStock,
        'موجودی اسناد': i.documentsStock ?? '-',
        'وضعیت سلامت': i.isHealthy || i.isSynchronized ? 'سالم و منطبق' : 'دارای مغایرت',
        'مغایرت‌ها': Array.isArray(i.discrepancies) ? i.discrepancies.join(' | ') : (i.discrepancyType || '-')
      }));

      const ws = xlsx.utils.json_to_sheet(rows);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'ماتریس سلامت کاردکس');
      xlsx.writeFile(wb, `Kardex_Health_Matrix.xlsx`);
    } catch (err) {
      console.error('Export error:', err);
    }
  };

  const rawItems = integrityReport?.audits || integrityReport?.items || [];
  const filteredIntegrityItems = rawItems.filter((item: any) => {
    const isHealthy = item.isHealthy ?? item.isSynchronized;
    if (integrityDiscrepancyOnly && isHealthy) return false;
    if (!integritySearch.trim()) return true;
    const q = integritySearch.toLowerCase();
    return (
      item.itemName?.toLowerCase().includes(q) ||
      item.itemCode?.toLowerCase().includes(q) ||
      item.category?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
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
        onExportExcel={handleExportExcel}
      />

      {kardexItemId && (
        <RunningKardexModal
          itemId={kardexItemId}
          isOpen={true}
          onClose={() => setKardexItemId(null)}
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
    </div>
  );
}
