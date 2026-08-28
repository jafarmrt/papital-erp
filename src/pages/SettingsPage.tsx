import React from 'react';
import { Settings, List, FolderTree, Building2, Tags, ShieldAlert, Activity, Layers, Copy, Check, ShoppingBag, RefreshCw, Zap, ShieldCheck } from 'lucide-react';
import { User } from '../types';
import ConfirmModal from '../components/ConfirmModal';
import { cn } from '../utils';
import SystemHealthDiagnostic from '../components/SystemHealthDiagnostic';
import { SystemConfigTab } from '../components/settings/SystemConfigTab';
import { useSettings } from '../hooks/useSettings';
import { GeneralSettingsTab } from '../components/settings/GeneralSettingsTab';
import { CategoriesTab, CategoryModal } from '../components/settings/CategoriesTab';
import { WarehousesTab, WarehouseModal } from '../components/settings/WarehousesTab';
import { PricingStrategiesTab } from '../components/settings/PricingStrategiesTab';
import { WorkflowPresetsTab } from '../components/settings/WorkflowPresetsTab';
import { InventoryControlPresetTab } from '../components/settings/InventoryControlPresetTab';
import { TaskTitlesSettingsTab } from '../components/settings/TaskTitlesSettingsTab';
import { SystemOperationsTab, ClearDataModal } from '../components/settings/SystemOperationsTab';
import { WooCommerceTab } from '../components/settings/WooCommerceTab';
import { NegativeStockPolicySettingsTab } from '../components/settings/NegativeStockPolicySettingsTab';

interface SettingsPageProps {
  currentUser: User;
}

export default function SettingsPage({ currentUser }: SettingsPageProps) {
  const s = useSettings();

  if (currentUser.role !== 'admin' && currentUser.role !== 'manager') {
    return <div className="p-8 text-center text-slate-500 font-farsi">عدم دسترسی</div>;
  }

  const tabs = [
    { id: 'general', label: 'تنظیمات عمومی', icon: List },
    { id: 'inventory_integrity', label: 'سیاست کنترل موجودی منفی', icon: ShieldCheck },
    { id: 'categories', label: 'دسته‌بندی انبار', icon: FolderTree },
    { id: 'task_titles', label: 'عناوین و دسته‌بندی‌های کاری', icon: Layers },
    { id: 'warehouses', label: 'مدیریت انبارها', icon: Building2 },
    { id: 'pricing', label: 'سیاست‌های قیمتی', icon: Tags },
    { id: 'projects', label: 'الگوهای مراحل تولید', icon: Layers },
    { id: 'inventory_control', label: 'الگوی کنترل موجودی و لیست خرید', icon: ShoppingBag },
    { id: 'woocommerce', label: 'اتصال به ووکامرس', icon: FolderTree },
    { id: 'health', label: 'وضعیت سلامت سیستم', icon: Activity },
    ...(currentUser.role === 'admin' ? [
      { id: 'system_config', label: 'پیکربندی سیستمی', icon: ShieldAlert },
      { id: 'system', label: 'عملیات سیستمی', icon: ShieldAlert }
    ] : [])
  ] as const;

  return (
    <div className="flex flex-col h-full bg-slate-50 font-farsi text-right">
      {/* Page Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-4 shrink-0">
        <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
          <Settings size={24} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-800">تنظیمات سامانه</h1>
          <p className="text-slate-500 text-xs mt-1">پیکربندی سیستم و مدیریت داده‌های پایه</p>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex bg-white border-b border-slate-200 px-6 gap-6 shrink-0 pt-2 overflow-x-auto custom-scrollbar">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => s.setActiveTab(t.id as any)}
            className={cn(
              'flex items-center gap-2 pb-3 px-1 border-b-2 font-medium text-sm transition-colors whitespace-nowrap cursor-pointer',
              s.activeTab === t.id
                ? 'border-blue-600 text-blue-600 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
            )}
          >
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>

      {/* Active Tab Content */}
      <div className="p-6 flex-1 overflow-auto">
        {s.activeTab === 'general' && (
          <GeneralSettingsTab
            companyName={s.companyName}
            setCompanyName={s.setCompanyName}
            companyPhone={s.companyPhone}
            setCompanyPhone={s.setCompanyPhone}
            companyAddress={s.companyAddress}
            setCompanyAddress={s.setCompanyAddress}
            currency={s.currency}
            setCurrency={s.setCurrency}
            displayTimezone={s.displayTimezone}
            setDisplayTimezone={s.setDisplayTimezone}
            companyLogo={s.companyLogo}
            setCompanyLogo={s.setCompanyLogo}
            invoiceStartNum={s.invoiceStartNum}
            setInvoiceStartNum={s.setInvoiceStartNum}
            fastMovingDays={s.fastMovingDays}
            setFastMovingDays={s.setFastMovingDays}
            slowMovingDays={s.slowMovingDays}
            setSlowMovingDays={s.setSlowMovingDays}
            deadStockDays={s.deadStockDays}
            setDeadStockDays={s.setDeadStockDays}
            isSaving={s.isSaving}
            onSave={s.handleSaveSettings}
          />
        )}

        {s.activeTab === 'inventory_integrity' && (
          <NegativeStockPolicySettingsTab />
        )}

        {s.activeTab === 'categories' && (
          <CategoriesTab
            categories={s.categories}
            onOpenCreateModal={() => {
              s.setEditingCatId(null);
              s.setCatForm({ name: '', prefix: '', type: 'raw_material', defaultUnit: 'عدد' });
              s.setShowCatModal(true);
            }}
            onOpenEditModal={(c) => {
              s.setEditingCatId(c.id);
              s.setCatForm({
                name: c.name,
                prefix: c.prefix,
                type: c.type,
                defaultUnit: c.defaultUnit || c.default_unit || 'عدد'
              });
              s.setShowCatModal(true);
            }}
            onDeleteCategory={s.handleCatDelete}
            onResetDefaults={s.handleResetDefaultCategories}
          />
        )}

        {s.activeTab === 'warehouses' && (
          <WarehousesTab
            warehouses={s.warehouses}
            onOpenCreateModal={() => {
              s.setEditingWhId(null);
              s.setWhForm({ name: '', code: '' });
              s.setShowWhModal(true);
            }}
            onOpenEditModal={(w) => {
              s.setEditingWhId(w.id);
              s.setWhForm({ name: w.name, code: w.code });
              s.setShowWhModal(true);
            }}
            onDeleteWarehouse={s.handleWhDelete}
          />
        )}

        {s.activeTab === 'pricing' && (
          <PricingStrategiesTab
            pricingStrategies={s.pricingStrategies}
            setPricingStrategies={s.setPricingStrategies}
            isSaving={s.isSaving}
            onSave={s.handleSaveSettings}
          />
        )}

        {s.activeTab === 'task_titles' && (
          <TaskTitlesSettingsTab />
        )}

        {s.activeTab === 'projects' && (
          <WorkflowPresetsTab
            workflowPresets={s.workflowPresets}
            setWorkflowPresets={s.setWorkflowPresets}
            isSaving={s.isSaving}
            onSave={s.handleSaveSettings}
          />
        )}

        {s.activeTab === 'inventory_control' && (
          <InventoryControlPresetTab
            sections={s.inventoryControlSections}
            setSections={s.setInventoryControlSections}
            isSaving={s.isSaving}
            onSave={s.handleSaveSettings}
          />
        )}
        
        {s.activeTab === 'woocommerce' && (
          <WooCommerceTab
            wcStoreUrl={s.wcStoreUrl}
            setWcStoreUrl={s.setWcStoreUrl}
            wcConsumerKey={s.wcConsumerKey}
            setWcConsumerKey={s.setWcConsumerKey}
            wcConsumerSecret={s.wcConsumerSecret}
            setWcConsumerSecret={s.setWcConsumerSecret}
            wcWebhookSecret={s.wcWebhookSecret}
            setWcWebhookSecret={s.setWcWebhookSecret}
            handleSaveSettings={s.handleSaveSettings}
            isSaving={s.isSaving}
            handleTestWcConnection={s.handleTestWcConnection}
            isTestingWc={s.isTestingWc}
            manualOrderId={s.manualOrderId}
            setManualOrderId={s.setManualOrderId}
            isSyncingManualOrder={s.isSyncingManualOrder}
            handleSyncManualOrder={s.handleSyncManualOrder}
            syncedWcOrders={s.syncedWcOrders}
            wcOrderLogs={s.wcOrderLogs}
            loadSyncedWcOrders={s.loadSyncedWcOrders}
            handleSyncAllStocks={s.handleSyncAllStocks}
            isSyncingAllStocks={s.isSyncingAllStocks}
          />
        )}

        {s.activeTab === 'health' && <SystemHealthDiagnostic />}

        {/* V1.1.1: تب پیکربندی سیستمی جایگزین تب اجرای تست شد — اجرای درون‌برنامه‌ای تست‌ها به‌دلیل آلودگی دیتابیس زنده حذف شد */}
        {s.activeTab === 'system_config' && currentUser.role === 'admin' && (
          <SystemConfigTab
            enableTestEndpoints={s.enableTestEndpoints}
            setEnableTestEndpoints={s.setEnableTestEndpoints}
            isSaving={s.isSaving}
            onSave={s.handleSaveSettings}
          />
        )}

        {s.activeTab === 'system' && currentUser.role === 'admin' && (
          <SystemOperationsTab onOpenClearModal={() => s.setShowClearModal(true)} />
        )}
      </div>

      {/* Modals */}
      <CategoryModal
        isOpen={s.showCatModal}
        onClose={() => s.setShowCatModal(false)}
        isEditing={s.isEditingCat}
        catForm={s.catForm}
        setCatForm={s.setCatForm}
        isSaving={s.isSaving}
        onSubmit={s.handleCatSubmit}
      />

      <WarehouseModal
        isOpen={s.showWhModal}
        onClose={() => s.setShowWhModal(false)}
        isEditing={s.isEditingWh}
        whForm={s.whForm}
        setWhForm={s.setWhForm}
        isSaving={s.isSaving}
        onSubmit={s.handleWhSubmit}
      />

      <ClearDataModal
        isOpen={s.showClearModal}
        onClose={() => {
          s.setShowClearModal(false);
          s.setDeleteConfirmText('');
        }}
        deleteConfirmText={s.deleteConfirmText}
        setDeleteConfirmText={s.setDeleteConfirmText}
        isSaving={s.isSaving}
        onConfirmClear={s.handleClearData}
      />

      <ConfirmModal
        isOpen={s.confirmState.isOpen}
        message="آیا از حذف مطمئن هستید؟"
        onConfirm={s.executeCatDelete}
        onCancel={() => s.setConfirmState({ isOpen: false, catId: 0 })}
      />

      <ConfirmModal
        isOpen={s.whConfirmState.isOpen}
        message="غیرفعال‌سازی این انبار؟"
        onConfirm={s.executeWhDelete}
        onCancel={() => s.setWhConfirmState({ isOpen: false, whId: 0 })}
      />
    </div>
  );
}
