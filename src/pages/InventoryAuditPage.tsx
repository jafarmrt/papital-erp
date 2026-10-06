import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { User } from '../types';
import { useWarehousesQuery, type WarehouseItem } from '../hooks/queries/useSettingsQueries';
import ConfirmModal from '../components/ConfirmModal';

// Subcomponents
import { Inventory3WayIntegrityTab } from '../components/inventory/Inventory3WayIntegrityTab';
import { WarehouseStockReconciliationPanel } from '../components/inventory/WarehouseStockReconciliationPanel';
import { PhysicalAuditSheetTab } from '../components/inventory/PhysicalAuditSheetTab';
import { PastAuditReportsTab } from '../components/inventory/PastAuditReportsTab';
import { WarehouseTransfersListTab } from '../components/inventory/WarehouseTransfersListTab';
import { ProjectBomAllocationsTab } from '../components/inventory/ProjectBomAllocationsTab';
import { InventoryAuditHeader } from '../components/inventory/InventoryAuditHeader';
import { AuditConfirmSummaryModal } from '../components/inventory/AuditConfirmSummaryModal';
import { AuditDocumentDetailModal, TransferDocumentDetailModal } from '../components/inventory/InventoryDocumentDetailModals';

// Modals
import RunningKardexModal from '../components/RunningKardexModal';
import WarehouseTransferModal from '../components/WarehouseTransferModal';
import InventoryRebuildModal from '../components/InventoryRebuildModal';

// Data (React Query)
import {
  useInventoryAuditQueries,
  useInventoryDocumentDetail,
  type InventoryAuditTab,
} from '../hooks/inventoryAudit/useInventoryAuditQueries';
import { useAuditSheet } from '../hooks/inventoryAudit/useAuditSheet';
import { invalidateAfterStockAdjustment } from '../hooks/inventoryAudit/useInventoryAuditSave';
import { exportIntegrityExcel, filterIntegrityItems } from '../lib/inventoryAudit/auditSheet';

const NO_WAREHOUSES: WarehouseItem[] = [];

interface InventoryAuditPageProps {
  user: User | null;
}

export function InventoryAuditPage({ user }: InventoryAuditPageProps) {
  const queryClient = useQueryClient();
  // Navigation
  const [activeTab, setActiveTab] = useState<InventoryAuditTab>('new_audit');

  // Modal States
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showRebuildModal, setShowRebuildModal] = useState(false);
  const [rebuildTargetItemId, setRebuildTargetItemId] = useState<number | undefined>(undefined);
  const [kardexItemId, setKardexItemId] = useState<number | null>(null);
  const [viewAuditId, setViewAuditId] = useState<number | null>(null);
  const [viewTransferId, setViewTransferId] = useState<number | null>(null);

  // Integrity Report filters
  const [integritySearch, setIntegritySearch] = useState('');
  const [integrityDiscrepancyOnly, setIntegrityDiscrepancyOnly] = useState(false);

  // Physical Audit location: کد انبار (TD-480)؛ تا کاربر انباری برنگزیده، انبار پیش‌فرض (فعال با کمترین شناسه، اول فهرست)
  const warehousesQuery = useWarehousesQuery();
  const warehouses = Array.isArray(warehousesQuery.data) ? warehousesQuery.data : NO_WAREHOUSES;
  const [chosenLocation, setChosenLocation] = useState('');
  const selectedLocation = chosenLocation || warehouses[0]?.code || '';
  const warehouseName = (code: string) => warehouses.find(w => w.code === code)?.name || code;
  const locationLabel = warehouseName(selectedLocation);

  const data = useInventoryAuditQueries(activeTab, selectedLocation);
  const sheet = useAuditSheet({
    serverItems: data.auditItems,
    selectedLocation,
    locationLabel,
    nextRef: data.nextRef,
    user,
    onLocationChange: setChosenLocation,
    reloadItems: data.refreshAuditItems,
  });
  const auditDetail = useInventoryDocumentDetail(viewAuditId, 'خطا در دریافت جزئیات سند انبارگردانی', 'audit');
  const transferDetail = useInventoryDocumentDetail(viewTransferId, 'خطا در دریافت جزئیات حواله بین‌انباری', 'transfer');

  // هر تغییر موجودی در این صفحه کش صفحات دیگر (کالاها، کاردکس، داشبورد، اسناد، رزروها) را هم باطل می‌کند
  const refreshAfterStockChange = () => { void invalidateAfterStockAdjustment(queryClient); };

  const filteredIntegrityItems = filterIntegrityItems(data.integrityReport, integritySearch, integrityDiscrepancyOnly);

  return (
    <div className="space-y-6" style={{ direction: 'rtl' }}>
      <InventoryAuditHeader
        activeTab={activeTab}
        onTabChange={setActiveTab}
        discrepancyItems={data.integrityReport?.summary?.discrepancyItems}
        onOpenRebuild={() => {
          setRebuildTargetItemId(undefined);
          setShowRebuildModal(true);
        }}
        onOpenTransfer={() => setShowTransferModal(true)}
      />

      {/* TAB CONTENT */}
      {activeTab === 'integrity' && (
        <Inventory3WayIntegrityTab
          integrityReport={data.integrityReport}
          integrityLoading={data.integrityLoading}
          integritySearch={integritySearch}
          setIntegritySearch={setIntegritySearch}
          integrityDiscrepancyOnly={integrityDiscrepancyOnly}
          setIntegrityDiscrepancyOnly={setIntegrityDiscrepancyOnly}
          filteredIntegrityItems={filteredIntegrityItems}
          loadIntegrityReport={data.refreshIntegrity}
          onOpenRebuildModal={(itemId) => {
            setRebuildTargetItemId(itemId);
            setShowRebuildModal(true);
          }}
          onOpenKardexModal={(itemId) => setKardexItemId(itemId)}
          onExportExcel={() => exportIntegrityExcel(data.integrityReport)}
        />
      )}
      {activeTab === 'integrity' && (
        <div className="mt-6">
          <WarehouseStockReconciliationPanel />
        </div>
      )}

      {activeTab === 'new_audit' && (
        <PhysicalAuditSheetTab
          selectedLocation={selectedLocation}
          locationLabel={locationLabel}
          warehouses={warehouses}
          warehousesFailed={warehousesQuery.isError}
          onRequestLocationChange={sheet.requestLocationChange}
          nextRef={data.nextRef}
          notes={sheet.notes}
          setNotes={sheet.setNotes}
          searchQuery={sheet.searchQuery}
          setSearchQuery={sheet.setSearchQuery}
          categoryFilter={sheet.categoryFilter}
          setCategoryFilter={sheet.setCategoryFilter}
          categories={sheet.categories}
          filteredItems={sheet.filteredItems}
          auditedItemsMap={sheet.auditedItemsMap}
          submitting={sheet.submitting}
          errorMsg={sheet.errorMsg}
          successMsg={sheet.successMsg}
          handlePhysicalChange={sheet.handlePhysicalChange}
          handleApplyCurrentStockAsPhysical={sheet.handleApplyCurrentStockAsPhysical}
          handleSubmitAudit={sheet.handleSubmitAudit}
        />
      )}

      {activeTab === 'reports' && (
        <PastAuditReportsTab
          auditDocsLoading={data.auditDocsLoading}
          auditDocs={data.auditDocs}
          handleViewAudit={setViewAuditId}
        />
      )}

      {activeTab === 'transfers' && (
        <WarehouseTransfersListTab
          transfersLoading={data.transfersLoading}
          transfers={data.transfers}
          handleViewTransfer={setViewTransferId}
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
          onSuccess={refreshAfterStockChange}
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
          itemsList={data.rebuildItems}
          onSuccess={refreshAfterStockChange}
        />
      )}

      {/* Audit Detail Modal */}
      {viewAuditId !== null && (
        <AuditDocumentDetailModal
          doc={auditDetail.data ?? null}
          loading={auditDetail.isFetching}
          onClose={() => setViewAuditId(null)}
        />
      )}

      {/* Transfer Detail Modal */}
      {viewTransferId !== null && (
        <TransferDocumentDetailModal
          doc={transferDetail.data ?? null}
          loading={transferDetail.isFetching}
          onClose={() => setViewTransferId(null)}
        />
      )}

      {/* V10-3.4: مودال خلاصه تایید پیش از ثبت نهایی انبارگردانی */}
      {sheet.pendingAuditSummary && (
        <AuditConfirmSummaryModal
          summary={sheet.pendingAuditSummary}
          nextRef={data.nextRef}
          selectedLocation={locationLabel}
          notes={sheet.notes}
          submitting={sheet.submitting}
          onCancel={sheet.cancelPendingAudit}
          onConfirm={sheet.confirmSubmitAudit}
        />
      )}

      {/* v9.0.56 (TD-484): عوض کردن انبار پس از شمارش، شمارش‌ها را پاک می‌کند */}
      <ConfirmModal
        isOpen={sheet.pendingLocation !== null}
        title="تغییر انبار شمارش"
        message={`شمارش‌های واردشده برای «${locationLabel}» پاک می‌شوند و برگه «${warehouseName(sheet.pendingLocation ?? '')}» بارگذاری می‌شود. ادامه می‌دهید؟`}
        confirmText="پاک کردن و تغییر انبار"
        cancelText="ماندن در همین انبار"
        onConfirm={sheet.confirmLocationChange}
        onCancel={sheet.cancelLocationChange}
      />
    </div>
  );
}

export default InventoryAuditPage;
