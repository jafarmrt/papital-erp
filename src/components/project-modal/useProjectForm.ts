import React, { useState, useEffect, useEffectEvent } from 'react';
import toast from 'react-hot-toast';
import { Customer, Item, FinancialAttachment } from '../../types';
import { fetchJson } from '../../api';
import { getTodayIsoDate, errorMessageOf, toStorageDate, toPersianDigits } from '../../utils';
import { DEFAULT_WORKFLOW_PRESETS, WorkflowPreset } from '../../constants/presets';
import { ProductRow, ProjectStage, ProjectModalProps } from './types';
import {
  getOptionalStageNamesForPreset,
  formatPickerDate,
  mapProjectProductsToRows,
  createInitialProductRow,
  newProjectStages,
  presetStages,
  buildProjectPayload
} from './projectFormHelpers';
import { useOpeningRead } from '../../hooks/queries/readOnEveryOpening';
import { useCustomerOptionsQuery } from '../../hooks/queries/useCustomerQueries';
import { useProjectFormItemOptions } from '../../hooks/queries/useProjectWorkspaceQueries';
import { useMissingPickRows, withPickRows } from '../../hooks/queries/usePickListRows';
import { useSettingsQuery, type SettingItem } from '../../hooks/queries/useSettingsQueries';
import { managerUserIdsOf } from '../../lib/projects/projectManagers';

export function useProjectForm({
  isOpen,
  onClose,
  projectToEdit,
  customersList,
  itemsList,
  onSuccess,
  initialProducts,
  initialTitle
}: ProjectModalProps) {
  const [projectCode, setProjectCode] = useState<string>('');
  const [title, setTitle] = useState<string>('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  // v9.0.420 (TD-764): تاریخ‌های فرم ISO هستند و `JalaliDateInput` آن‌ها را شمسی نشان می‌دهد
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [description, setDescription] = useState<string>('');
  const [attachments, setAttachments] = useState<FinancialAttachment[]>([]);
  // v10.1.37 (N-01, TD-1283): «مسئولان پروژه» by user id
  const [managerIds, setManagerIds] = useState<number[]>([]);

  // 10.3 (ARCH review finding 3, part 16): the pick lists and the presets read through the shared cache, again on each
  // opening; until this opening's answer the lists the page passed in, and the default presets
  const customersRead = useOpeningRead(useCustomerOptionsQuery({ readOnEveryOpening: true, enabled: isOpen }), isOpen);
  const itemsRead = useOpeningRead(useProjectFormItemOptions(isOpen), isOpen);
  const settingsRead = useOpeningRead(useSettingsQuery({ readOnEveryOpening: true, enabled: isOpen }), isOpen);
  const [productsList, setProductsList] = useState<ProductRow[]>([]);
  const workflowPresets = workflowPresetsOf(settingsRead.data);
  const [preset, setPreset] = useState<string>('');
  const [stages, setStages] = useState<ProjectStage[]>([]);
  const [saving, setSaving] = useState<boolean>(false);

  // Exclude archived presets, custom, and legacy presets
  const availablePresets = workflowPresets.filter(
    p => !p.isArchived && p.id !== 'custom' && !p.title?.includes('سفارشی') && p.id !== 'tile_transfer' && p.id !== 'general_assembly'
  );
  const listedCustomers: Customer[] = customersRead.data?.length ? customersRead.data : customersList;
  const listedItems: Item[] = itemsRead.data?.length ? itemsRead.data : itemsList;
  // v11 phase 6.1ch (C13): the lists hold at most the cap. A party or item chosen from the server's matches is kept here,
  // and the stored customer of an edited project is read by id (its stored name stands in while that read runs or if it
  // fails), so the saved customer name never goes empty for a party beyond the cap
  const [pickedCustomers, setPickedCustomers] = useState<Customer[]>([]);
  const [pickedItems, setPickedItems] = useState<Item[]>([]);
  const storedCustomerId = Number(projectToEdit?.customer_id) || null;
  const storedCustomer = useMissingPickRows<Customer>('customers', listedCustomers, [storedCustomerId], isOpen && customersRead.data !== undefined);
  const storedCustomerName = String(projectToEdit?.customer_name ?? '').trim();
  const storedCustomerStub: Customer[] = storedCustomerId && storedCustomerName && (storedCustomer.loading || storedCustomer.failed)
    ? [{ id: storedCustomerId, name: storedCustomerName } as Customer]
    : [];
  const activeCustomersList = withPickRows(listedCustomers, [...pickedCustomers, ...storedCustomer.rows, ...storedCustomerStub]);
  const activeItemsList = withPickRows(listedItems, pickedItems);

  const getOptionalStageNames = () => {
    return getOptionalStageNamesForPreset(preset, availablePresets);
  };

  // a failed pick list says so once for each failure
  const sayCustomersFailed = useEffectEvent(() => { toast.error('خطا در دریافت لیست مشتریان'); });
  useEffect(() => {
    if (customersRead.failedAt) sayCustomersFailed();
  }, [customersRead.failedAt]);
  const sayItemsFailed = useEffectEvent(() => { toast.error('خطا در دریافت لیست اقلام'); });
  useEffect(() => {
    if (itemsRead.failedAt) sayItemsFailed();
  }, [itemsRead.failedAt]);

  useEffect(() => {
    if (isOpen) {
      setPickedCustomers([]);
      setPickedItems([]);
      if (projectToEdit) {
        setProjectCode(projectToEdit.project_code || '');
        setTitle(projectToEdit.title || '');
        setSelectedCustomerId(projectToEdit.customer_id || null);
        setStartDate(toStorageDate(projectToEdit.start_date || '') || '');
        setEndDate(toStorageDate(projectToEdit.end_date || '') || '');
        setPriority(projectToEdit.priority || 'medium');
        setDescription(projectToEdit.description || '');
        setStages(projectToEdit.stages?.map(s => ({
          title: s.title,
          assigned_personnel: s.assigned_personnel || [],
          required_resources: s.required_resources || []
        })) || []);
        setProductsList(mapProjectProductsToRows(projectToEdit));
        setAttachments(Array.isArray(projectToEdit.attachments) ? projectToEdit.attachments : []);
        setManagerIds(managerUserIdsOf(projectToEdit.managers));
      } else {
        setManagerIds([]);
        setProjectCode('');
        setTitle(initialTitle || (initialProducts && initialProducts.length > 0 
          ? `تولید کسری انبار (${initialProducts.map(p => p.item_name).slice(0, 2).join('، ')}${initialProducts.length > 2 ? ' و...' : ''})`
          : ''));
        setSelectedCustomerId(null);
        if (initialProducts && initialProducts.length > 0) {
          setProductsList(initialProducts.map((p, idx) => ({
            id: `init-prod-${p.item_id || idx}-${Date.now()}`,
            item_id: p.item_id,
            item_code: p.item_code,
            item_name: p.item_name,
            customer_code: '',
            quantity: p.quantity,
            unit: p.unit || 'عدد',
            needs_assembly: false,
            notes: 'تعریف خودکار بر اساس کسری نقطه سفارش انبار'
          })));
        } else {
          setProductsList([createInitialProductRow()]);
        }
        setStartDate(getTodayIsoDate());
        setEndDate('');
        setPriority('medium');
        setDescription(initialProducts && initialProducts.length > 0 
          ? `پروژه تولید تعریف‌شده جهت جبران کسری نقطه سفارش محصولات در انبار (${toPersianDigits(initialProducts.length)} قلم محصول)` 
          : '');
        setAttachments([]);
        setPreset('');
        setStages(newProjectStages());
      }
    }
  }, [isOpen, projectToEdit, initialProducts, initialTitle]);

  const handleAddProductRow = () => {
    setProductsList(prev => [...prev, createInitialProductRow()]);
  };

  /** `picked` is the item's row when it came from the server's matches (a list cut at the cap lacks it) */
  const handleUpdateProductRow = (index: number, field: string, value: any, picked?: Item) => {
    if (field === 'item_id' && picked && Number(picked.id) === Number(value)) setPickedItems(prev => withPickRows(prev, [picked]));
    setProductsList(prev => {
      // Prevent selecting the same item multiple times in different rows
      if (field === 'item_id' && value) {
        const isDuplicate = prev.some((row, i) => i !== index && row.item_id === Number(value));
        if (isDuplicate) {
          toast.error('این کالا قبلاً در یکی از ردیف‌های پروژه انتخاب شده است. امکان انتخاب مجدد یک کالا در چند ردیف وجود ندارد.');
          return prev;
        }
      }

      const copy = [...prev];
      const item = { ...copy[index], [field]: value };
      if (field === 'item_id') {
        const found = activeItemsList.find(i => i.id === Number(value)) ?? (picked && Number(picked.id) === Number(value) ? picked : undefined);
        item.item_id = found?.id || null;
        item.item_code = found?.code || '';
        item.item_name = found?.name || '';
        item.unit = found?.unit || 'عدد';
      }
      copy[index] = item;
      return copy;
    });
  };

  const handleRemoveProductRow = (index: number) => {
    setProductsList(prev => prev.filter((_, i) => i !== index));
  };

  const handleSelectPreset = (presetId: string) => {
    setPreset(presetId);
    const chosen = presetStages(presetId, availablePresets);
    if (chosen) setStages(chosen);
  };

  const handleAddStage = () => {
    setStages(prev => [...prev, { title: `مرحله جدید ${prev.length + 1}`, assigned_personnel: [], required_resources: [] }]);
  };

  const handleRemoveStage = (index: number) => {
    setStages(prev => prev.filter((_, i) => i !== index));
  };

  const handleStageTitleChange = (index: number, newTitle: string) => {
    setStages(prev => {
      const copy = [...prev];
      copy[index].title = newTitle;
      return copy;
    });
  };

  const handleMoveStage = (index: number, direction: 'up' | 'down') => {
    if ((direction === 'up' && index === 0) || (direction === 'down' && index === stages.length - 1)) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    setStages(prev => {
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[targetIndex];
      copy[targetIndex] = temp;
      return copy;
    });
  };

  /** `picked` is the party's row when it came from the server's matches */
  const handleCustomerSelect = (custId: number | null, picked?: Customer) => {
    setSelectedCustomerId(custId);
    if (custId && picked && Number(picked.id) === custId) setPickedCustomers(prev => withPickRows(prev, [picked]));
    if (custId) {
      const found = activeCustomersList.find(c => c.id === custId) ?? (picked && Number(picked.id) === custId ? picked : undefined);
      if (found && !title) setTitle(`سفارش تولید - ${found.name}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    if (!title.trim()) return toast.error('لطفاً عنوان پروژه را وارد کنید');
    if (!formatPickerDate(startDate)) return toast.error('انتخاب تاریخ شروع پروژه اجباری است');
    if (!formatPickerDate(endDate)) return toast.error('انتخاب تاریخ تحویل (پایان) پروژه اجباری است');
    if (!projectToEdit && stages.length === 0) return toast.error('حداقل یک مرحله برای فرآیند تولید تعیین کنید');

    // Duplicate check in products list
    const selectedItemIds = productsList.map(p => p.item_id).filter((id): id is number => id !== null && id !== undefined);
    const hasDuplicates = new Set(selectedItemIds).size !== selectedItemIds.length;
    if (hasDuplicates) {
      return toast.error('یک کالا نمی‌تواند در چند ردیف محصول انتخاب شود. لطفاً کالاهای تکراری را حذف یا ادغام کنید.');
    }

    setSaving(true);
    try {
      const payload = buildProjectPayload({
        projectCode,
        title,
        selectedCustomerId,
        activeCustomersList,
        productsList,
        startDate,
        endDate,
        priority,
        description,
        stages,
        attachments,
        includeStages: !projectToEdit
      });
      const body = { ...payload, managerUserIds: managerIds };

      const url = projectToEdit ? `/projects/${projectToEdit.id}` : '/projects';
      const method = projectToEdit ? 'PUT' : 'POST';
      // v9.0.385 (TD-742، تصمیم ت۳ الف): ویرایش نسخه‌ای را می‌فرستد که فرم از آن باز شد؛ تغییر هم‌زمان دیگری ۴۰۹ است
      // TD-1342: با نشانهٔ بخش‌ها، فقط تغییر هم‌زمان مشخصات یا پیوست‌ها ۴۰۹ است
      const res = await fetchJson(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(projectToEdit
          ? { ...body, version: projectToEdit.version, ...(projectToEdit.partTokens ? { partTokens: projectToEdit.partTokens } : {}) }
          : body)
      });

      if (res && (res.id || res.success)) {
        toast.success(projectToEdit ? 'پروژه با موفقیت به‌روزرسانی شد' : 'پروژه تولید جدید با موفقیت ثبت شد');
        onSuccess();
        onClose();
      } else {
        toast.error(res?.error || 'خطا در ذخیره‌سازی پروژه');
      }
    } catch (err) {
      toast.error(errorMessageOf(err) || 'خطا در ارتباط با سامانه');
    } finally {
      setSaving(false);
    }
  };

  return {
    projectCode,
    setProjectCode,
    title,
    setTitle,
    selectedCustomerId,
    selectedCustomer: activeCustomersList.find(c => c.id === selectedCustomerId),
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    priority,
    setPriority,
    description,
    setDescription,
    attachments,
    setAttachments,
    managerIds,
    setManagerIds,
    productsList,
    stages,
    preset,
    saving,
    availablePresets,
    activeCustomersList,
    activeItemsList,
    getOptionalStageNames,
    handleAddProductRow,
    handleUpdateProductRow,
    handleRemoveProductRow,
    handleSelectPreset,
    handleAddStage,
    handleRemoveStage,
    handleStageTitleChange,
    handleMoveStage,
    handleCustomerSelect,
    handleSubmit
  };
}

/**
 * The project presets of the settings: the defaults (none) until they are read, when the read failed or the setting is
 * not there; none when it holds no valid JSON. The legacy presets are left out where they are offered (`availablePresets`).
 */
function workflowPresetsOf(rows: SettingItem[] | undefined): WorkflowPreset[] {
  const value = rows?.find(s => s.key === 'project_workflow_presets')?.value;
  if (!value) return DEFAULT_WORKFLOW_PRESETS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  // an entry that is not a template (a hand-edited null) is skipped, never a crash of the form
  return Array.isArray(parsed)
    ? parsed.filter((p): p is WorkflowPreset => typeof p === 'object' && p !== null)
    : DEFAULT_WORKFLOW_PRESETS;
}
