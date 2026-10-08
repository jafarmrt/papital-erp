import React, { useEffect, useState } from 'react';
import { fetchJson } from '../api';
import { toast } from 'react-hot-toast';
import { normalizeRialDisplayUnit } from '../lib/rialDisplay';
import { movementDaysError } from '../lib/settings/settingValues';
import { wcTestConnectionBody } from '../lib/woocommerce/wcConnectionTest';
import { stockSyncOutcome } from '../lib/woocommerce/stockSyncOutcome';
import { errorMessageOf } from '../utils/formatters';
import { FACTORY_RESET_CONFIRM_WORD, isFactoryResetConfirmed } from '../lib/system/factoryReset';
import { DEFAULT_WORKFLOW_PRESETS, WorkflowPreset } from '../constants/presets';
import { DEFAULT_INVENTORY_CONTROL_SECTIONS, InventoryControlPresetSection } from '../constants/inventoryControlPresets';
import {
  useSettingsQuery,
  useCategoriesQuery,
  useWarehousesQuery,
  useSaveSettingsMutation,
  useSaveCategoryMutation,
  useDeleteCategoryMutation,
  useResetDefaultCategoriesMutation,
  useSaveWarehouseMutation,
  useDeleteWarehouseMutation,
  WarehouseItem
} from './queries/useSettingsQueries';
import { settingsKeys } from '../lib/queryKeys';

/** مقدار ماسک کلیدهای محرمانه در پاسخ GET /settings برای غیرادمین (هم‌راستا با systemSettings.service.ts) */
const MASKED_SETTING_VALUE = '********';

export type Warehouse = WarehouseItem;

// v9.0.334 (TD-730، نیمه ووکامرس): خطای خواندن (۴۰۳، ۵۰۰) نگه داشته و در جدول نشان داده می‌شود، نه «هنوز هیچ سفارشی ثبت نشده است»
function loadWcList(endpoint: string, setRows: (rows: unknown[]) => void, setError: (message: string) => void, signal?: AbortSignal) {
  fetchJson(endpoint, { signal })
    .then((res) => {
      setRows(Array.isArray(res) ? res : []);
      setError('');
    })
    .catch((err) => {
      if (err?.name === 'AbortError') return;
      setError(errorMessageOf(err) || 'خواندن فهرست از کارساز ممکن نشد.');
    });
}

export { settingsKeys };

export function useSettings() {
  const { data: settingsData = [], isLoading: isLoadingSettings } = useSettingsQuery();
  const { data: categoriesData = [], isLoading: isLoadingCategories } = useCategoriesQuery();
  const { data: warehousesData = [], isLoading: isLoadingWarehouses } = useWarehousesQuery();

  const saveSettingsMutation = useSaveSettingsMutation();
  const saveCategoryMutation = useSaveCategoryMutation();
  const deleteCategoryMutation = useDeleteCategoryMutation();
  const resetCategoriesMutation = useResetDefaultCategoriesMutation();
  const saveWarehouseMutation = useSaveWarehouseMutation();
  const deleteWarehouseMutation = useDeleteWarehouseMutation();

  const [invoiceStartNum, setInvoiceStartNum] = useState('1000');
  const [fastMovingDays, setFastMovingDays] = useState('30');
  const [slowMovingDays, setSlowMovingDays] = useState('90');
  const [deadStockDays, setDeadStockDays] = useState('180');
  const [pricingStrategies, setPricingStrategies] = useState<string[]>(['فروشگاه', 'مصرف‌کننده', 'عمده']);
  const [workflowPresets, setWorkflowPresets] = useState<WorkflowPreset[]>(DEFAULT_WORKFLOW_PRESETS);
  const [inventoryControlSections, setInventoryControlSections] = useState<InventoryControlPresetSection[]>(DEFAULT_INVENTORY_CONTROL_SECTIONS);

  // Business / Company Header details
  const [companyName, setCompanyName] = useState('سامانه جامع ERP پاپیتال');
  const [companyPhone, setCompanyPhone] = useState('');
  const [companyAddress, setCompanyAddress] = useState('');
  const [companyLogo, setCompanyLogo] = useState('');
  const [currency, setCurrency] = useState('IRR');
  const [displayTimezone, setDisplayTimezone] = useState('Asia/Tehran');

  // V1.1.1: فلگ‌های runtime سیستمی (تب پیکربندی سیستمی)

  // Modal and form states for categories
  const [showCatModal, setShowCatModal] = useState(false);
  const [editingCatId, setEditingCatId] = useState<number | null>(null);
  const [catForm, setCatForm] = useState({ name: '', prefix: '', type: 'raw_material', defaultUnit: 'عدد' });
  const [confirmState, setConfirmState] = useState<{ isOpen: boolean; catId: number }>({ isOpen: false, catId: 0 });

  // Modal and form states for warehouses
  const [editingWhId, setEditingWhId] = useState<number | null>(null);
  const [whForm, setWhForm] = useState({ name: '', code: '' });
  const [showWhModal, setShowWhModal] = useState(false);
  const [whConfirmState, setWhConfirmState] = useState<{ isOpen: boolean; whId: number }>({ isOpen: false, whId: 0 });

  // Modal and form states for system data clearing
  const [showClearModal, setShowClearModal] = useState(false);
  const [clearMode, setClearMode] = useState<'transactions' | 'all'>('transactions');
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const [activeTab, setActiveTab] = useState<'general' | 'accounting' | 'chart_of_accounts' | 'categories' | 'warehouses' | 'pricing' | 'projects' | 'inventory_control' | 'task_titles' | 'health' | 'system_config' | 'system' | 'woocommerce' | 'inventory_integrity'>(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    if (tabParam && ['general', 'accounting', 'chart_of_accounts', 'categories', 'warehouses', 'pricing', 'projects', 'inventory_control', 'task_titles', 'health', 'system_config', 'system', 'woocommerce', 'inventory_integrity'].includes(tabParam)) {
      return tabParam as any;
    }
    return 'general';
  });

  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get('tab');
      if (tabParam && ['general', 'accounting', 'chart_of_accounts', 'categories', 'warehouses', 'pricing', 'projects', 'inventory_control', 'task_titles', 'health', 'system_config', 'system', 'woocommerce', 'inventory_integrity'].includes(tabParam)) {
        setActiveTab(tabParam as any);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const [isTestingWc, setIsTestingWc] = useState(false);

  // WooCommerce Settings
  const [wcStoreUrl, setWcStoreUrl] = useState('');
  const [wcConsumerKey, setWcConsumerKey] = useState('');
  const [wcConsumerSecret, setWcConsumerSecret] = useState('');
  const [wcWebhookSecret, setWcWebhookSecret] = useState('');
  // v8.0.44 (TD-293): انبار فروشگاه اینترنتی (خالی = انبار پیش‌فرض)
  const [wcShopWarehouse, setWcShopWarehouse] = useState('');
  const [syncedWcOrders, setSyncedWcOrders] = useState<any[]>([]);
  const [wcOrderLogs, setWcOrderLogs] = useState<any[]>([]);
  const [syncedWcOrdersError, setSyncedWcOrdersError] = useState('');
  const [wcOrderLogsError, setWcOrderLogsError] = useState('');
  const [manualOrderId, setManualOrderId] = useState('');
  const [isSyncingManualOrder, setIsSyncingManualOrder] = useState(false);
  const [isSyncingAllStocks, setIsSyncingAllStocks] = useState(false);

  // Synchronize local form inputs when React Query settingsData updates
  useEffect(() => {
    if (!settingsData || settingsData.length === 0) return;
    const data = settingsData;

    const startNum = data.find((s) => s.key === 'invoice_start_number');
    if (startNum) setInvoiceStartNum(startNum.value);

    const fastDaysSetting = data.find((s) => s.key === 'fast_moving_days');
    if (fastDaysSetting) setFastMovingDays(fastDaysSetting.value);

    const slowDaysSetting = data.find((s) => s.key === 'slow_moving_days');
    if (slowDaysSetting) setSlowMovingDays(slowDaysSetting.value);

    const deadDaysSetting = data.find((s) => s.key === 'dead_stock_days');
    if (deadDaysSetting) setDeadStockDays(deadDaysSetting.value);

    const strategies = data.find((s) => s.key === 'pricing_strategies');
    if (strategies) setPricingStrategies(strategies.value.split(',').filter(Boolean));

    const compName = data.find((s) => s.key === 'company_name');
    if (compName) setCompanyName(compName.value);

    const compPhone = data.find((s) => s.key === 'company_phone');
    if (compPhone) setCompanyPhone(compPhone.value);

    const compAddr = data.find((s) => s.key === 'company_address');
    if (compAddr) setCompanyAddress(compAddr.value);

    const compLogo = data.find((s) => s.key === 'company_logo');
    if (compLogo) setCompanyLogo(compLogo.value);

    const curr = data.find((s) => s.key === 'currency');
    if (curr) setCurrency(normalizeRialDisplayUnit(curr.value));

    // V10-1.1: ساعت توافقی واحد
    const tzSetting = data.find((s) => s.key === 'display_timezone');
    if (tzSetting?.value) {
      setDisplayTimezone(tzSetting.value);
    }

    const presetsSetting = data.find((s) => s.key === 'project_workflow_presets');
    if (presetsSetting && presetsSetting.value) {
      try {
        const parsed = JSON.parse(presetsSetting.value);
        if (Array.isArray(parsed)) {
          // Filter out legacy default presets that the user requested to remove
          const cleaned = parsed.filter((p: any) => p.id !== 'tile_transfer' && p.id !== 'general_assembly');
          setWorkflowPresets(cleaned);
        }
      } catch (e) {
        console.error(e);
      }
    }

    const invCtrlSetting = data.find((s) => s.key === 'inventory_control_preset_sections');
    if (invCtrlSetting && invCtrlSetting.value) {
      try {
        const parsed = JSON.parse(invCtrlSetting.value);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setInventoryControlSections(parsed);
        }
      } catch (e) {
        console.error(e);
      }
    }

    const wcUrl = data.find((s) => s.key === 'wc_store_url');
    if (wcUrl) setWcStoreUrl(wcUrl.value);

    const wcKey = data.find((s) => s.key === 'wc_consumer_key');
    if (wcKey) setWcConsumerKey(wcKey.value);

    const wcSecret = data.find((s) => s.key === 'wc_consumer_secret');
    if (wcSecret) setWcConsumerSecret(wcSecret.value);

    const wcWebhookSecretSetting = data.find((s) => s.key === 'wc_webhook_secret');
    if (wcWebhookSecretSetting) setWcWebhookSecret(wcWebhookSecretSetting.value);

    const wcShopWarehouseSetting = data.find((s) => s.key === 'wc_shop_warehouse');
    if (wcShopWarehouseSetting) setWcShopWarehouse(wcShopWarehouseSetting.value);
  }, [settingsData]);

  const loadSyncedWcOrders = (signal?: AbortSignal) => {
    loadWcList('/woocommerce/synced-orders', setSyncedWcOrders, setSyncedWcOrdersError, signal);
    loadWcList('/woocommerce/order-logs', setWcOrderLogs, setWcOrderLogsError, signal);
  };

  useEffect(() => {
    const controller = new AbortController();
    loadSyncedWcOrders(controller.signal);
    return () => controller.abort();
  }, []);

  const handleSyncAllStocks = async () => {
    setIsSyncingAllStocks(true);
    try {
      const res = await fetchJson('/woocommerce/sync-all-stocks', { method: 'POST' });
      if (res.success) {
        // v9.0.334 (TD-724): کالای ناموفق پیام خطا با شمار و نخستین خطاها می‌گیرد، نه پیام سبز سرور
        const outcome = stockSyncOutcome(res);
        if (outcome.tone === 'error') toast.error(outcome.message, { duration: 15000 });
        else toast.success(outcome.message);
      } else {
        toast.error(res.error || 'خطا در همگام‌سازی دسته‌ای موجودی‌ها');
      }
    } catch (err: any) {
      toast.error(err.message || 'خطا در برقراری ارتباط');
    } finally {
      setIsSyncingAllStocks(false);
    }
  };

  const handleSyncManualOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualOrderId.trim()) return;
    setIsSyncingManualOrder(true);
    try {
      const res = await fetchJson('/woocommerce/sync-order-by-id', {
        method: 'POST',
        body: JSON.stringify({ orderId: manualOrderId.trim() })
      });
      if (res.success) {
        toast.success(res.message || 'سفارش با موفقیت دریافت و فاکتور فروش صادر شد');
        setManualOrderId('');
        loadSyncedWcOrders();
      } else {
        toast.error(res.error || 'خطا در دریافت سفارش');
      }
    } catch (err: any) {
      toast.error(err.message || 'خطا در برقراری ارتباط با ووکامرس');
    } finally {
      setIsSyncingManualOrder(false);
    }
  };

  const handleTestWcConnection = async () => {
    setIsTestingWc(true);
    try {
      // v9.0.333 (TD-723): کلید ماسک‌شده («********») یا خالی فرستاده نمی‌شود؛ کارساز کلید ذخیره‌شده را به کار می‌برد
      const res = await fetchJson('/woocommerce/test-connection', {
        method: 'POST',
        body: JSON.stringify(wcTestConnectionBody({
          url: wcStoreUrl,
          consumerKey: wcConsumerKey,
          consumerSecret: wcConsumerSecret
        }))
      });
      if (res.success) {
        toast.success(res.message || 'ارتباط برقرار شد');
      }
    } catch (err: any) {
      toast.error(err.message || 'خطا در برقراری ارتباط');
    } finally {
      setIsTestingWc(false);
    }
  };

  const isSaving =
    saveSettingsMutation.isPending ||
    saveCategoryMutation.isPending ||
    deleteCategoryMutation.isPending ||
    resetCategoriesMutation.isPending ||
    saveWarehouseMutation.isPending ||
    deleteWarehouseMutation.isPending;

  const handleSaveSettings = async () => {
    // v7.0.26 (TD-184): فقط کلیدهای تغییرکرده ارسال می‌شوند و مقدار ماسک‌شده کلیدهای محرمانه هرگز ارسال نمی‌شود
    const serverValues = new Map(
      (Array.isArray(settingsData) ? settingsData : []).map((s) => [s.key, s.value] as const)
    );
    const candidateSettings: { key: string; value: string }[] = [
        { key: 'invoice_start_number', value: invoiceStartNum },
        { key: 'fast_moving_days', value: fastMovingDays },
        { key: 'slow_moving_days', value: slowMovingDays },
        { key: 'dead_stock_days', value: deadStockDays },
        { key: 'pricing_strategies', value: pricingStrategies.filter((s: string) => s.trim() !== '').join(',') },
        { key: 'company_name', value: companyName },
        { key: 'company_phone', value: companyPhone },
        { key: 'company_address', value: companyAddress },
        { key: 'company_logo', value: companyLogo },
        { key: 'currency', value: currency },
        { key: 'display_timezone', value: displayTimezone },
        { key: 'project_workflow_presets', value: JSON.stringify(workflowPresets) },
        { key: 'inventory_control_preset_sections', value: JSON.stringify(inventoryControlSections) },
        { key: 'wc_store_url', value: wcStoreUrl },
        { key: 'wc_consumer_key', value: wcConsumerKey },
        { key: 'wc_consumer_secret', value: wcConsumerSecret },
        { key: 'wc_webhook_secret', value: wcWebhookSecret },
        { key: 'wc_shop_warehouse', value: wcShopWarehouse }
    ];
    // v9.0.276 (TD-672، تصمیم ت۴): روزهای گردش پیش از ارسال با همان قاعده کارساز سنجیده می‌شوند
    const daysError = movementDaysError({
      fast_moving_days: fastMovingDays, slow_moving_days: slowMovingDays, dead_stock_days: deadStockDays
    });
    if (daysError) {
      toast.error(daysError);
      return;
    }
    const changedSettings = candidateSettings.filter(
      (item) => item.value !== MASKED_SETTING_VALUE && (!serverValues.has(item.key) || serverValues.get(item.key) !== item.value)
    );
    if (changedSettings.length === 0) {
      toast.success('تغییری برای ذخیره وجود ندارد');
      return;
    }
    await saveSettingsMutation.mutateAsync({ settings: changedSettings });
  };

  const handleCatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveCategoryMutation.mutateAsync({
      id: editingCatId,
      data: catForm
    });
    setShowCatModal(false);
    setEditingCatId(null);
    setCatForm({ name: '', prefix: '', type: 'raw_material', defaultUnit: 'عدد' });
  };

  const handleCatDelete = (id: number) => {
    setConfirmState({ isOpen: true, catId: id });
  };

  const executeCatDelete = async () => {
    await deleteCategoryMutation.mutateAsync(confirmState.catId);
    setConfirmState({ isOpen: false, catId: 0 });
  };

  const handleResetDefaultCategories = async () => {
    await resetCategoriesMutation.mutateAsync();
  };

  const handleWhSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveWarehouseMutation.mutateAsync({
      id: editingWhId,
      data: whForm
    });
    setShowWhModal(false);
    setEditingWhId(null);
    setWhForm({ name: '', code: '' });
  };

  const handleWhDelete = (id: number) => {
    setWhConfirmState({ isOpen: true, whId: id });
  };

  const executeWhDelete = async () => {
    await deleteWarehouseMutation.mutateAsync(whConfirmState.whId);
    setWhConfirmState({ isOpen: false, whId: 0 });
  };

  const handleClearData = async () => {
    if (!isFactoryResetConfirmed(deleteConfirmText)) {
      return toast.error(`برای پاک‌سازی همه اطلاعات، عبارت «${FACTORY_RESET_CONFIRM_WORD}» را بنویسید.`);
    }
    try {
      const res = await fetchJson<{ success?: boolean; isSetup?: boolean; message?: string }>('/admin/clear-data', {
        method: 'POST',
        body: JSON.stringify({ mode: 'all' })
      });
      toast.success(res?.message || 'همه اطلاعات و کاربران پاک شدند. در حال رفتن به صفحه راه‌اندازی اولیه…');
      setShowClearModal(false);
      setDeleteConfirmText('');
      setTimeout(() => {
        window.location.href = '/';
      }, 1000);
    } catch (err: any) {
      toast.error(err.message || 'خطا در عملیات پاکسازی سیستم');
    }
  };

  return {
    categories: categoriesData,
    appSettings: settingsData,
    invoiceStartNum, setInvoiceStartNum,
    fastMovingDays, setFastMovingDays,
    slowMovingDays, setSlowMovingDays,
    deadStockDays, setDeadStockDays,
    pricingStrategies, setPricingStrategies,
    workflowPresets, setWorkflowPresets,
    inventoryControlSections, setInventoryControlSections,
    companyName, setCompanyName,
    companyPhone, setCompanyPhone,
    companyAddress, setCompanyAddress,
    companyLogo, setCompanyLogo,
    currency, setCurrency,
    displayTimezone, setDisplayTimezone,
    wcStoreUrl, setWcStoreUrl,
    wcConsumerKey, setWcConsumerKey,
    wcConsumerSecret, setWcConsumerSecret,
    wcWebhookSecret, setWcWebhookSecret,
    wcShopWarehouse, setWcShopWarehouse,
    wcOrderLogs,
    wcOrderLogsError,
    isSyncingAllStocks,
    handleSyncAllStocks,
    showCatModal, setShowCatModal,
    editingCatId, setEditingCatId,
    isEditingCat: editingCatId !== null,
    catForm, setCatForm,
    confirmState, setConfirmState,
    warehouses: warehousesData,
    editingWhId, setEditingWhId,
    isEditingWh: editingWhId !== null,
    whForm, setWhForm,
    showWhModal, setShowWhModal,
    whConfirmState, setWhConfirmState,
    showClearModal, setShowClearModal,
    clearMode, setClearMode,
    deleteConfirmText, setDeleteConfirmText,
    activeTab, setActiveTab,
    isSaving,
    handleSaveSettings,
    handleCatSubmit,
    handleCatDelete,
    executeCatDelete,
    handleResetDefaultCategories,
    handleWhSubmit,
    handleWhDelete,
    executeWhDelete,
    handleClearData,
    isTestingWc,
    handleTestWcConnection,
    syncedWcOrders,
    syncedWcOrdersError,
    manualOrderId, setManualOrderId,
    isSyncingManualOrder,
    handleSyncManualOrder,
    loadSyncedWcOrders,
    isLoading: isLoadingSettings || isLoadingCategories || isLoadingWarehouses
  };
}
