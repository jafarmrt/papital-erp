import React, { useEffect, useMemo, useState } from 'react';
import { fetchJson } from '../api';
import { mutationSucceeded } from '../lib/settings/mutationSucceeded';
import { toast } from 'react-hot-toast';
import { normalizeRialDisplayUnit } from '../lib/rialDisplay';
import { TREASURY_HIGH_VALUE_THRESHOLD_DEFAULT, TREASURY_HIGH_VALUE_THRESHOLD_KEY, movementDaysError, priceListNamesError, treasuryHighValueThresholdError } from '../lib/settings/settingValues';
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
import { readPricingStrategies, serializePricingStrategies } from '../lib/items/pricingStrategies';
import { createSettingsDirtyKeys, trackedSetter, untouchedSetting } from '../lib/settings/settingsFormSync';

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
      setError(errorMessageOf(err) || 'خواندن فهرست از سرور ممکن نشد.');
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
  const [treasuryHighValueThreshold, setTreasuryHighValueThreshold] = useState(String(TREASURY_HIGH_VALUE_THRESHOLD_DEFAULT));
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

  const [activeTab, setActiveTab] = useState<'general' | 'accounting' | 'chart_of_accounts' | 'categories' | 'warehouses' | 'pricing' | 'projects' | 'inventory_control' | 'task_titles' | 'payroll_rates' | 'health' | 'system_config' | 'system' | 'woocommerce' | 'messenger'>(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    if (tabParam && ['general', 'accounting', 'chart_of_accounts', 'categories', 'warehouses', 'pricing', 'projects', 'inventory_control', 'task_titles', 'payroll_rates', 'health', 'system_config', 'system', 'woocommerce', 'messenger'].includes(tabParam)) {
      return tabParam as any;
    }
    return 'general';
  });

  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get('tab');
      if (tabParam && ['general', 'accounting', 'chart_of_accounts', 'categories', 'warehouses', 'pricing', 'projects', 'inventory_control', 'task_titles', 'payroll_rates', 'health', 'system_config', 'system', 'woocommerce', 'messenger'].includes(tabParam)) {
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

  const dirtyKeys = useMemo(() => createSettingsDirtyKeys(), []);
  const edit = useMemo(() => {
    const track = <T,>(key: string, set: React.Dispatch<React.SetStateAction<T>>) => trackedSetter(dirtyKeys, key, set);
    return {
      setInvoiceStartNum: track('invoice_start_number', setInvoiceStartNum), setFastMovingDays: track('fast_moving_days', setFastMovingDays),
      setSlowMovingDays: track('slow_moving_days', setSlowMovingDays), setDeadStockDays: track('dead_stock_days', setDeadStockDays),
      setTreasuryHighValueThreshold: track(TREASURY_HIGH_VALUE_THRESHOLD_KEY, setTreasuryHighValueThreshold),
      setPricingStrategies: track('pricing_strategies', setPricingStrategies), setWorkflowPresets: track('project_workflow_presets', setWorkflowPresets),
      setInventoryControlSections: track('inventory_control_preset_sections', setInventoryControlSections), setCompanyName: track('company_name', setCompanyName),
      setCompanyPhone: track('company_phone', setCompanyPhone), setCompanyAddress: track('company_address', setCompanyAddress),
      setCompanyLogo: track('company_logo', setCompanyLogo), setCurrency: track('currency', setCurrency),
      setDisplayTimezone: track('display_timezone', setDisplayTimezone), setWcStoreUrl: track('wc_store_url', setWcStoreUrl),
      setWcConsumerKey: track('wc_consumer_key', setWcConsumerKey), setWcConsumerSecret: track('wc_consumer_secret', setWcConsumerSecret),
      setWcWebhookSecret: track('wc_webhook_secret', setWcWebhookSecret), setWcShopWarehouse: track('wc_shop_warehouse', setWcShopWarehouse),
    };
  }, [dirtyKeys]);

  // Synchronize local form inputs when React Query settingsData updates; OBS-R2-94: an unsaved edit is never overwritten
  useEffect(() => {
    if (!settingsData || settingsData.length === 0) return;
    const data = settingsData;

    const startNum = untouchedSetting(data, dirtyKeys, 'invoice_start_number'); if (startNum) setInvoiceStartNum(startNum.value);

    const fastDaysSetting = untouchedSetting(data, dirtyKeys, 'fast_moving_days'); if (fastDaysSetting) setFastMovingDays(fastDaysSetting.value);

    const slowDaysSetting = untouchedSetting(data, dirtyKeys, 'slow_moving_days'); if (slowDaysSetting) setSlowMovingDays(slowDaysSetting.value);

    const deadDaysSetting = untouchedSetting(data, dirtyKeys, 'dead_stock_days'); if (deadDaysSetting) setDeadStockDays(deadDaysSetting.value);

    const highValueSetting = untouchedSetting(data, dirtyKeys, TREASURY_HIGH_VALUE_THRESHOLD_KEY); if (highValueSetting) setTreasuryHighValueThreshold(highValueSetting.value);

    const strategies = untouchedSetting(data, dirtyKeys, 'pricing_strategies');
    // v10.0.201 (OBS-R1-71): آرایه JSON (مقدار کهنه با کاما هم خوانده می‌شود)
    const readStrategies = strategies ? readPricingStrategies(strategies.value) : null;
    if (readStrategies && 'titles' in readStrategies) setPricingStrategies(readStrategies.titles);

    const compName = untouchedSetting(data, dirtyKeys, 'company_name');
    if (compName) setCompanyName(compName.value);

    const compPhone = untouchedSetting(data, dirtyKeys, 'company_phone');
    if (compPhone) setCompanyPhone(compPhone.value);

    const compAddr = untouchedSetting(data, dirtyKeys, 'company_address');
    if (compAddr) setCompanyAddress(compAddr.value);

    const compLogo = untouchedSetting(data, dirtyKeys, 'company_logo');
    if (compLogo) setCompanyLogo(compLogo.value);

    const curr = untouchedSetting(data, dirtyKeys, 'currency');
    if (curr) setCurrency(normalizeRialDisplayUnit(curr.value));

    // V10-1.1: ساعت توافقی واحد
    const tzSetting = untouchedSetting(data, dirtyKeys, 'display_timezone');
    if (tzSetting?.value) {
      setDisplayTimezone(tzSetting.value);
    }

    const presetsSetting = untouchedSetting(data, dirtyKeys, 'project_workflow_presets');
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

    const invCtrlSetting = untouchedSetting(data, dirtyKeys, 'inventory_control_preset_sections');
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

    const wcUrl = untouchedSetting(data, dirtyKeys, 'wc_store_url');
    if (wcUrl) setWcStoreUrl(wcUrl.value);

    const wcKey = untouchedSetting(data, dirtyKeys, 'wc_consumer_key');
    if (wcKey) setWcConsumerKey(wcKey.value);

    const wcSecret = untouchedSetting(data, dirtyKeys, 'wc_consumer_secret');
    if (wcSecret) setWcConsumerSecret(wcSecret.value);

    const wcWebhookSecretSetting = untouchedSetting(data, dirtyKeys, 'wc_webhook_secret');
    if (wcWebhookSecretSetting) setWcWebhookSecret(wcWebhookSecretSetting.value);

    const wcShopWarehouseSetting = untouchedSetting(data, dirtyKeys, 'wc_shop_warehouse');
    if (wcShopWarehouseSetting) setWcShopWarehouse(wcShopWarehouseSetting.value);
  }, [settingsData, dirtyKeys]);

  const loadSyncedWcOrders = (signal?: AbortSignal) => {
    loadWcList('/woocommerce/synced-orders', setSyncedWcOrders, setSyncedWcOrdersError, signal);
    loadWcList('/woocommerce/order-logs', setWcOrderLogs, setWcOrderLogsError, signal);
  };

  // v10.0.227 (OBS-PR-17): فهرست‌های ووکامرس را خود زبانه ووکامرس هنگام باز شدن می‌خواند، نه هر زبانه تنظیمات برای هر کاربر

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
        { key: TREASURY_HIGH_VALUE_THRESHOLD_KEY, value: treasuryHighValueThreshold },
        { key: 'pricing_strategies', value: serializePricingStrategies(pricingStrategies) },
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
    if (daysError) return void toast.error(daysError);
    // 10.2 package 8 (TD-1297): «آستانه تراکنش کلان خزانه» with the server's rule
    const thresholdError = treasuryHighValueThresholdError(treasuryHighValueThreshold); if (thresholdError) return void toast.error(thresholdError);
    // v10.0.95 (TD-1192): نام فهرست قیمت بی ویرگول لاتین و یکتا، با همان قاعده کارساز
    const priceListError = priceListNamesError(pricingStrategies, { allowLatinComma: true });
    if (priceListError) return void toast.error(priceListError);
    const changedSettings = candidateSettings.filter(
      (item) => item.value !== MASKED_SETTING_VALUE && (!serverValues.has(item.key) || serverValues.get(item.key) !== item.value)
    );
    if (changedSettings.length === 0) {
      dirtyKeys.clear();
      toast.success('تغییری برای ذخیره وجود ندارد');
      return;
    }
    if (!(await mutationSucceeded(saveSettingsMutation.mutateAsync({ settings: changedSettings })))) return;
    dirtyKeys.clear();
  };

  const handleCatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!(await mutationSucceeded(saveCategoryMutation.mutateAsync({
      id: editingCatId,
      data: catForm
    })))) return;
    setShowCatModal(false);
    setEditingCatId(null);
    setCatForm({ name: '', prefix: '', type: 'raw_material', defaultUnit: 'عدد' });
  };

  const handleCatDelete = (id: number) => {
    setConfirmState({ isOpen: true, catId: id });
  };

  const executeCatDelete = async () => {
    if (!(await mutationSucceeded(deleteCategoryMutation.mutateAsync(confirmState.catId)))) return;
    setConfirmState({ isOpen: false, catId: 0 });
  };

  const handleResetDefaultCategories = async () => {
    if (!(await mutationSucceeded(resetCategoriesMutation.mutateAsync()))) return;
  };

  const handleWhSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!(await mutationSucceeded(saveWarehouseMutation.mutateAsync({
      id: editingWhId,
      data: whForm
    })))) return;
    setShowWhModal(false);
    setEditingWhId(null);
    setWhForm({ name: '', code: '' });
  };

  const handleWhDelete = (id: number) => {
    setWhConfirmState({ isOpen: true, whId: id });
  };

  const executeWhDelete = async () => {
    if (!(await mutationSucceeded(deleteWarehouseMutation.mutateAsync(whConfirmState.whId)))) return;
    setWhConfirmState({ isOpen: false, whId: 0 });
  };

  const handleClearData = async () => {
    if (!isFactoryResetConfirmed(deleteConfirmText)) {
      return toast.error(`برای پاک‌سازی همه اطلاعات، عبارت «${FACTORY_RESET_CONFIRM_WORD}» را بنویسید.`);
    }
    try {
      const res = await fetchJson<{ success?: boolean; isSetup?: boolean; message?: string }>('/admin/clear-data', {
        method: 'POST',
        body: JSON.stringify({})
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
    invoiceStartNum, fastMovingDays, slowMovingDays, deadStockDays, treasuryHighValueThreshold, pricingStrategies, workflowPresets,
    inventoryControlSections, companyName, companyPhone, companyAddress, companyLogo, currency, displayTimezone,
    wcStoreUrl, wcConsumerKey, wcConsumerSecret, wcWebhookSecret, wcShopWarehouse,
    ...edit,
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
