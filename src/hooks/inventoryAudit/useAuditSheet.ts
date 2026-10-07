import { useMemo, useState } from 'react';
import type { User } from '../../types';
import { errorMessageOf } from '../../utils';
import {
  auditCategories,
  buildAuditPayload,
  filterAuditItems,
  summarizeAudit,
  withPhysicalStock,
  type AuditedItemsMap,
  type AuditItemRow,
  type AuditSummary,
} from '../../lib/inventoryAudit/auditSheet';
import { useInventoryAuditSave } from './useInventoryAuditSave';

/** کد خطای ۴۰۹ سرور وقتی موجودی دفتری برگه پس از بارگذاری تغییر کرده است (TD-480، ت۷ الف) */
const STALE_BOOK_STOCK_CODE = 'AUDIT_BOOK_STOCK_CHANGED';

/**
 * برگه شمارش انبارگردانی: مقادیر شمارش‌شده، خلاصه تایید و ثبت نهایی.
 * اقلام از کش React Query می‌آیند و مقدار شمارش‌شده هر کالا روی آن‌ها سوار می‌شود؛ تایپ در برگه دیگر درخواستی به سرور نمی‌فرستد.
 */
interface AuditSheetDeps {
  serverItems: AuditItemRow[];
  /** کد انبار شمارش */
  selectedLocation: string;
  /** نام انبار شمارش برای متن‌ها */
  locationLabel: string;
  nextRef: string;
  user: User | null | undefined;
  onLocationChange: (code: string) => void;
  reloadItems: () => void;
}

export function useAuditSheet({ serverItems, selectedLocation, locationLabel, nextRef, user, onLocationChange, reloadItems }: AuditSheetDeps) {
  const [notes, setNotes] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [auditedItemsMap, setAuditedItemsMap] = useState<AuditedItemsMap>({});
  // V10-3.4: خلاصه شمارش برای مودال تایید پیش از ثبت نهایی انبارگردانی
  const [pendingAuditSummary, setPendingAuditSummary] = useState<AuditSummary | null>(null);
  // v9.0.56 (TD-484): انبار تازه‌ای که کاربر انتخاب کرده و منتظر تأیید پاک شدن شمارش‌های برگه است
  const [pendingLocation, setPendingLocation] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const saveMutation = useInventoryAuditSave();

  const items = useMemo(() => withPhysicalStock(serverItems, auditedItemsMap), [serverItems, auditedItemsMap]);
  const categories = useMemo(() => auditCategories(items), [items]);
  const filteredItems = useMemo(() => filterAuditItems(items, categoryFilter, searchQuery), [items, categoryFilter, searchQuery]);

  const handlePhysicalChange = (itemId: number, value: string) => {
    const targetItem = items.find(i => i.id === itemId);
    if (!targetItem) return;
    const updatedItem = { ...targetItem, physical_stock: value };
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
    items.forEach(i => {
      updatedMap[i.id] = { ...i, physical_stock: String(i.system_stock_computed) };
    });
    setAuditedItemsMap(updatedMap);
  };

  const switchLocation = (code: string) => {
    setAuditedItemsMap({});
    setPendingAuditSummary(null);
    setErrorMsg(null);
    setSuccessMsg(null);
    onLocationChange(code);
  };

  /** v9.0.56 (TD-484): شمارش‌های یک انبار هرگز برای انبار دیگر فرستاده نمی‌شوند؛ اگر شمارشی وارد شده، اول تأیید */
  const requestLocationChange = (code: string) => {
    if (code === selectedLocation) return;
    if (Object.keys(auditedItemsMap).length === 0) {
      switchLocation(code);
      return;
    }
    setPendingLocation(code);
  };

  const confirmLocationChange = () => {
    if (pendingLocation === null) return;
    const code = pendingLocation;
    setPendingLocation(null);
    switchLocation(code);
  };

  const handleSubmitAudit = () => {
    const auditedList = Object.values(auditedItemsMap);
    if (auditedList.length === 0) {
      setErrorMsg('هیچ کالایی جهت ثبت انبارگردانی مقداردهی نشده است.');
      return;
    }
    // V10-3.4: نمایش مودال تایید — ثبت واقعی فقط پس از تایید کاربر
    setPendingAuditSummary(summarizeAudit(auditedList));
  };

  /** V10-3.4: اجرای ثبت نهایی پس از تایید در مودال خلاصه */
  const confirmSubmitAudit = () => {
    if (!pendingAuditSummary || pendingAuditSummary.list.length === 0) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    const payload = buildAuditPayload(pendingAuditSummary.list, { location: selectedLocation, locationLabel, notes, user });
    saveMutation.mutate(payload, {
      onSuccess: (created) => {
        // v9.0.258 (TD-783): شماره‌ای که سرور ذخیره کرد، نه شماره پیشنهادی برگه
        setSuccessMsg(`سند انبارگردانی با شماره ${created?.refNumber || nextRef} با موفقیت ثبت و موجودی انبار به‌روزرسانی شد.`);
        setPendingAuditSummary(null);
        setAuditedItemsMap({});
        setNotes('');
      },
      onError: (err) => {
        setErrorMsg(errorMessageOf(err) || 'خطا در ثبت سند انبارگردانی');
        // ت۷ الف: موجودی دفتری پس از بارگذاری تغییر کرده؛ مودال بسته و برگه با موجودی تازه دوباره خوانده می‌شود
        // (شمارش‌های واردشده می‌مانند تا کاربر آن‌ها را با موجودی تازه بسنجد)
        if ((err as { code?: unknown } | null)?.code === STALE_BOOK_STOCK_CODE) {
          setPendingAuditSummary(null);
          reloadItems();
        }
      },
    });
  };

  return {
    notes,
    setNotes,
    searchQuery,
    setSearchQuery,
    categoryFilter,
    setCategoryFilter,
    categories,
    filteredItems,
    auditedItemsMap,
    submitting: saveMutation.isPending,
    errorMsg,
    successMsg,
    pendingAuditSummary,
    cancelPendingAudit: () => setPendingAuditSummary(null),
    pendingLocation,
    requestLocationChange,
    confirmLocationChange,
    cancelLocationChange: () => setPendingLocation(null),
    handlePhysicalChange,
    handleApplyCurrentStockAsPhysical,
    handleSubmitAudit,
    confirmSubmitAudit,
  };
}
