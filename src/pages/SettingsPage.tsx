import { useMemo, useState } from 'react';
import { Settings, Menu, X } from 'lucide-react';
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
import { AccountingSettingsTab } from '../components/settings/AccountingSettingsTab';
import { ChartOfAccountsSettingsTab } from '../components/settings/ChartOfAccountsSettingsTab';
import { 
  SETTINGS_GROUPS, 
  getVisibleGroups, 
  findGroupByTabId, 
  findTabById 
} from '../components/settings/settingsNavigationConfig';
import { SettingsNavigationSidebar } from '../components/settings/SettingsNavigationSidebar';

interface SettingsPageProps {
  currentUser: User;
  userPermissions?: { permissions: string[]; isAdmin: boolean; roleName?: string };
}

export default function SettingsPage({ currentUser, userPermissions }: SettingsPageProps) {
  const s = useSettings();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const isAdmin = currentUser.role === 'admin' || userPermissions?.isAdmin;
  const isManager = currentUser.role === 'manager';
  const hasCoaPerm = Array.isArray(userPermissions?.permissions) && userPermissions.permissions.includes('accounting.coa');
  const hasSettingsPerm = Array.isArray(userPermissions?.permissions) && userPermissions.permissions.includes('settings.manage');

  const visibleGroups = useMemo(() => {
    return getVisibleGroups(SETTINGS_GROUPS, currentUser.role, userPermissions);
  }, [currentUser.role, userPermissions]);

  const activeTabItem = useMemo(() => {
    return findTabById(visibleGroups, s.activeTab);
  }, [visibleGroups, s.activeTab]);

  const activeGroupItem = useMemo(() => {
    return findGroupByTabId(visibleGroups, s.activeTab);
  }, [visibleGroups, s.activeTab]);

  if (!isAdmin && !isManager && !hasCoaPerm && !hasSettingsPerm) {
    return <div className="p-8 text-center text-slate-500 font-farsi">عدم دسترسی</div>;
  }

  const handleSelectTab = (tabId: string) => {
    s.setActiveTab(tabId as any);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tabId);
    window.history.replaceState({}, '', url.toString());
    setIsMobileMenuOpen(false);
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 font-farsi text-right">
      {/* Page Header */}
      <div className="bg-white border-b border-slate-200/90 px-6 py-3.5 flex flex-wrap items-center justify-between gap-4 shrink-0 shadow-2xs">
        <div className="flex items-center gap-3.5">
          <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl border border-blue-100 shadow-2xs">
            <Settings size={22} />
          </div>
          <div>
            <div className="flex items-center flex-wrap gap-2">
              <h1 className="text-lg font-black text-slate-800">تنظیمات سامانه</h1>
              {activeGroupItem && (
                <>
                  <span className="text-slate-300">/</span>
                  <span className="text-xs font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                    {activeGroupItem.title}
                  </span>
                </>
              )}
              {activeTabItem && (
                <>
                  <span className="text-slate-300">/</span>
                  <span className="text-xs font-black text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-md border border-blue-200">
                    {activeTabItem.label}
                  </span>
                </>
              )}
            </div>
            <p className="text-slate-500 text-xs mt-0.5">
              {activeTabItem?.shortDesc || 'پیکربندی سیستم و مدیریت داده‌های پایه بر اساس ماژول‌های مرتبط'}
            </p>
          </div>
        </div>

        {/* Mobile Toggle Button */}
        <div className="md:hidden flex items-center gap-2">
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition cursor-pointer"
          >
            {isMobileMenuOpen ? <X size={16} /> : <Menu size={16} />}
            <span>دسته‌بندی‌ها</span>
          </button>
        </div>
      </div>

      {/* Main Layout: Categorized Sidebar + Content Area */}
      <div className="flex-1 flex flex-col md:flex-row gap-5 p-4 md:p-6 overflow-hidden min-h-0">
        {/* Navigation Sidebar (Desktop + Collapsible Mobile) */}
        <div className={cn(
          'shrink-0',
          isMobileMenuOpen ? 'block w-full mb-4' : 'hidden md:block'
        )}>
          <SettingsNavigationSidebar
            groups={visibleGroups}
            activeTab={s.activeTab}
            onSelectTab={handleSelectTab}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            selectedGroupFilter={selectedGroupFilter}
            setSelectedGroupFilter={setSelectedGroupFilter}
          />
        </div>

        {/* Content Pane */}
        <main className="flex-1 min-w-0 overflow-y-auto custom-scrollbar flex flex-col space-y-4">
          <div className="flex-1">
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

        {s.activeTab === 'accounting' && (
          <AccountingSettingsTab currentUser={currentUser} />
        )}

        {s.activeTab === 'chart_of_accounts' && (
          <ChartOfAccountsSettingsTab />
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
          <SystemConfigTab />
        )}

        {s.activeTab === 'system' && currentUser.role === 'admin' && (
          <SystemOperationsTab onOpenClearModal={() => s.setShowClearModal(true)} />
        )}
          </div>
        </main>
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
