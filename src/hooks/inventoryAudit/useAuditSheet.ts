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

/**
 * برگه شمارش انبارگردانی: مقادیر شمارش‌شده، خلاصه تایید و ثبت نهایی.
 * اقلام از کش React Query می‌آیند و مقدار شمارش‌شده هر کالا روی آن‌ها سوار می‌شود؛ تایپ در برگه دیگر درخواستی به سرور نمی‌فرستد.
 */
interface AuditSheetDeps {
  serverItems: AuditItemRow[];
  selectedLocation: string;
  nextRef: string;
  user: User | null | undefined;
}

export function useAuditSheet({ serverItems, selectedLocation, nextRef, user }: AuditSheetDeps) {
  const [notes, setNotes] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [auditedItemsMap, setAuditedItemsMap] = useState<AuditedItemsMap>({});
  // V10-3.4: خلاصه شمارش برای مودال تایید پیش از ثبت نهایی انبارگردانی
  const [pendingAuditSummary, setPendingAuditSummary] = useState<AuditSummary | null>(null);
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
    const payload = buildAuditPayload(pendingAuditSummary.list, { nextRef, location: selectedLocation, notes, user });
    saveMutation.mutate(payload, {
      onSuccess: () => {
        setSuccessMsg(`سند انبارگردانی با شماره ${nextRef} با موفقیت ثبت و موجودی انبار به‌روزرسانی شد.`);
        setPendingAuditSummary(null);
        setAuditedItemsMap({});
        setNotes('');
      },
      onError: (err) => {
        setErrorMsg(errorMessageOf(err) || 'خطا در ثبت سند انبارگردانی');
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
    handlePhysicalChange,
    handleApplyCurrentStockAsPhysical,
    handleSubmitAudit,
    confirmSubmitAudit,
  };
}
