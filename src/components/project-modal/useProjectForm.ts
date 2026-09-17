import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Customer, Item, FinancialAttachment } from '../../types';
import { fetchJson } from '../../api';
import { getTodayJalaliDate } from '../../utils';
import { DEFAULT_WORKFLOW_PRESETS, WorkflowPreset } from '../../constants/presets';
import { ProductRow, ProjectStage, ProjectModalProps } from './types';
import {
  getOptionalStageNamesForPreset,
  formatPickerDate,
  mapProjectProductsToRows,
  createInitialProductRow,
  buildProjectPayload
} from './projectFormHelpers';

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
  const [startDate, setStartDate] = useState<any>('');
  const [endDate, setEndDate] = useState<any>('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [description, setDescription] = useState<string>('');
  const [attachments, setAttachments] = useState<FinancialAttachment[]>([]);

  const [localCustomers, setLocalCustomers] = useState<Customer[]>([]);
  const [localItems, setLocalItems] = useState<Item[]>([]);
  const [productsList, setProductsList] = useState<ProductRow[]>([]);
  const [workflowPresets, setWorkflowPresets] = useState<WorkflowPreset[]>(DEFAULT_WORKFLOW_PRESETS);
  const [preset, setPreset] = useState<string>('');
  const [stages, setStages] = useState<ProjectStage[]>([]);
  const [saving, setSaving] = useState<boolean>(false);

  // Exclude archived presets, custom, and legacy presets
  const availablePresets = workflowPresets.filter(
    p => !p.isArchived && p.id !== 'custom' && !p.title?.includes('سفارشی') && p.id !== 'tile_transfer' && p.id !== 'general_assembly'
  );
  const activeCustomersList = localCustomers.length > 0 ? localCustomers : customersList;
  const activeItemsList = localItems.length > 0 ? localItems : itemsList;

  const getOptionalStageNames = () => {
    return getOptionalStageNamesForPreset(preset, availablePresets);
  };

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();

    fetchJson('/customers?limit=1000', { signal: controller.signal })
      .then(res => setLocalCustomers(Array.isArray(res) ? res : (res?.data && Array.isArray(res.data) ? res.data : [])))
      .catch(err => {
        if (err?.name === 'AbortError') return;
        console.error('Failed to load customers in project form:', err);
        toast.error('خطا در دریافت لیست مشتریان');
      });

    fetchJson('/items?limit=1000', { signal: controller.signal })
      .then(res => setLocalItems(Array.isArray(res) ? res : (res?.data && Array.isArray(res.data) ? res.data : [])))
      .catch(err => {
        if (err?.name === 'AbortError') return;
        console.error('Failed to load items in project form:', err);
        toast.error('خطا در دریافت لیست اقلام');
      });

    fetchJson('/settings', { signal: controller.signal })
      .then(data => {
        if (Array.isArray(data)) {
          const p = data.find((s: any) => s.key === 'project_workflow_presets');
          if (p?.value) {
            const parsed = JSON.parse(p.value);
            if (Array.isArray(parsed)) {
              setWorkflowPresets(parsed.filter((item: any) => item.id !== 'tile_transfer' && item.id !== 'general_assembly'));
            }
          }
        }
      })
      .catch(err => {
        if (err?.name === 'AbortError') return;
        console.error('Failed to load workflow presets, falling back to defaults:', err);
        setWorkflowPresets([]);
      });

    return () => controller.abort();
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      if (projectToEdit) {
        setProjectCode(projectToEdit.project_code || '');
        setTitle(projectToEdit.title || '');
        setSelectedCustomerId(projectToEdit.customer_id || null);
        setStartDate(projectToEdit.start_date || '');
        setEndDate(projectToEdit.end_date || '');
        setPriority(projectToEdit.priority || 'medium');
        setDescription(projectToEdit.description || '');
        setStages(projectToEdit.stages?.map(s => ({
          title: s.title,
          assigned_personnel: s.assigned_personnel || [],
          required_resources: s.required_resources || []
        })) || []);
        setProductsList(mapProjectProductsToRows(projectToEdit));
        setAttachments(Array.isArray(projectToEdit.attachments) ? projectToEdit.attachments : []);
      } else {
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
        setStartDate(getTodayJalaliDate());
        setEndDate('');
        setPriority('medium');
        setDescription(initialProducts && initialProducts.length > 0 
          ? `پروژه تولید تعریف‌شده جهت جبران کسری نقطه سفارش محصولات در انبار (${initialProducts.length} قلم محصول)` 
          : '');
        setAttachments([]);
        const initialPreset = availablePresets[0];
        if (initialPreset) {
          setPreset(initialPreset.id);
          setStages(initialPreset.stages.map(stg => ({
            title: typeof stg === 'string' ? stg : stg.title,
            assigned_personnel: [],
            required_resources: []
          })));
        } else {
          setPreset('');
          setStages([
            { title: 'مرحله اول تولید', assigned_personnel: [], required_resources: [] }
          ]);
        }
      }
    }
  }, [isOpen, projectToEdit, workflowPresets, initialProducts, initialTitle]);

  const handleAddProductRow = () => {
    setProductsList(prev => [...prev, createInitialProductRow()]);
  };

  const handleUpdateProductRow = (index: number, field: string, value: any) => {
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
        const found = activeItemsList.find(i => i.id === Number(value));
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
    const found = availablePresets.find(p => p.id === presetId) || availablePresets[0];
    if (found) {
      setStages(found.stages.map(stg => ({
        title: typeof stg === 'string' ? stg : stg.title,
        assigned_personnel: [],
        required_resources: []
      })));
    }
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

  const handleCustomerSelect = (custId: number | null) => {
    setSelectedCustomerId(custId);
    if (custId) {
      const found = activeCustomersList.find(c => c.id === custId);
      if (found && !title) setTitle(`سفارش تولید - ${found.name}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    if (!title.trim()) return toast.error('لطفاً عنوان پروژه را وارد کنید');
    if (!formatPickerDate(startDate)) return toast.error('انتخاب تاریخ شروع پروژه اجباری است');
    if (!formatPickerDate(endDate)) return toast.error('انتخاب تاریخ تحویل (پایان) پروژه اجباری است');
    if (stages.length === 0) return toast.error('حداقل یک مرحله برای فرآیند تولید تعیین کنید');

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
        attachments
      });

      const url = projectToEdit ? `/projects/${projectToEdit.id}` : '/projects';
      const method = projectToEdit ? 'PUT' : 'POST';
      const res = await fetchJson(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res && (res.id || res.success)) {
        toast.success(projectToEdit ? 'پروژه با موفقیت بروزرسانی شد' : 'پروژه تولید جدید با موفقیت ثبت شد');
        onSuccess();
        onClose();
      } else {
        toast.error(res?.error || 'خطا در ذخیره‌سازی پروژه');
      }
    } catch (err) {
      toast.error(err.message || 'خطا در ارتباط با سرور');
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
