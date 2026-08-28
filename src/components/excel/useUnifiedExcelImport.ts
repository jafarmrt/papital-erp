import React, { useState, useRef, useMemo } from 'react';
import * as xlsx from 'xlsx';
import toast from 'react-hot-toast';
import { fetchJson } from '../../api';
import { formatPersianNumber } from '../../utils';
import { Category, Item } from '../../types';
import { PreviewRow, ImportResult } from './types';
import { validateExcelRows, ParsedExcelItem } from './excelImportValidation';
import { exportCompleteExcel, downloadExcelTemplate } from './excelExportHelpers';

export function useUnifiedExcelImport({
  typeFilter = '',
  onSuccess,
  onClose
}: {
  typeFilter?: 'product' | 'raw_material' | '';
  onSuccess: () => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<'upload' | 'preview' | 'result'>('upload');
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(false);

  const [categories, setCategories] = useState<Category[]>([]);
  const [existingItems, setExistingItems] = useState<Item[]>([]);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [filterMode, setFilterMode] = useState<'all' | 'issues'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredPreviewRows = useMemo(() => {
    return previewRows.filter(r => {
      const matchesSearch = !searchQuery || 
        r.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
        r.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.category.toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchesSearch) return false;
      if (filterMode === 'issues') {
        return r.hasPrefixMismatch || r.isDuplicateInBatch || r.isDuplicateInDb;
      }
      return true;
    });
  }, [previewRows, filterMode, searchQuery]);

  const handleResetModal = () => {
    setStep('upload');
    setPreviewRows([]);
    setImportResult(null);
    setSearchQuery('');
    setFilterMode('all');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClose = () => {
    handleResetModal();
    onClose();
  };

  const handleDownloadExport = async () => {
    setIsExporting(true);
    try {
      await exportCompleteExcel(typeFilter);
    } catch (err) {
      toast.error('خطا در دریافت خروجی اکسل: ' + (err.message || 'خطای شبکه'));
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      await downloadExcelTemplate();
    } catch (err) {
      toast.error('خطا در دانلود الگوی اکسل: ' + err.message);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoadingMetadata(true);
    try {
      const [catsRes, itemsRes] = await Promise.all([
        fetchJson('/categories'),
        fetchJson('/items?limit=0')
      ]);

      const loadedCats: Category[] = Array.isArray(catsRes) ? catsRes : (catsRes?.data && Array.isArray(catsRes.data) ? catsRes.data : []);
      const loadedItems: Item[] = Array.isArray(itemsRes) ? itemsRes : (itemsRes?.data && Array.isArray(itemsRes.data) ? itemsRes.data : []);
      setCategories(loadedCats);
      setExistingItems(loadedItems);

      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const bstr = evt.target?.result;
          const wb = xlsx.read(bstr, { type: 'binary' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rawRows = xlsx.utils.sheet_to_json<any>(ws);

          if (!rawRows || rawRows.length === 0) {
            toast.error('فایل اکسل خالی است یا فرمت آن پشتیبانی نمی‌شود.');
            setIsLoadingMetadata(false);
            return;
          }

          const parsedList: ParsedExcelItem[] = rawRows.map((row: any, idx: number) => ({
            index: idx,
            raw: row,
            code: String(row['کد کالا'] || row['کد'] || row['code'] || row['Code'] || '').trim(),
            name: String(row['نام محصول'] || row['نام کالا'] || row['نام'] || row['name'] || row['Name'] || '').trim(),
            category: String(row['دسته‌بندی'] || row['دسته'] || row['category'] || '').trim(),
            type: String(row['نوع کالا'] || row['نوع'] || row['type'] || '').trim()
          }));

          const validated = validateExcelRows(parsedList, loadedCats, loadedItems);
          setPreviewRows(validated);
          setStep('preview');
          toast.success(`${validated.length} ردیف آماده بررسی و ثبت است.`);
        } catch (err) {
          toast.error('خطا در خواندن فایل اکسل: ' + err.message);
        } finally {
          setIsLoadingMetadata(false);
        }
      };

      reader.readAsBinaryString(file);
    } catch (err) {
      toast.error('خطا در دریافت اطلاعات پایه سیستم: ' + err.message);
      setIsLoadingMetadata(false);
    }
  };

  const handleCellEdit = (index: number, field: 'code' | 'name' | 'category', value: string) => {
    setPreviewRows(prev => {
      const updated = prev.map(r => {
        if (r.index === index) {
          const newRaw = { ...r.raw };
          if (field === 'code') newRaw['کد کالا'] = value;
          if (field === 'name') newRaw['نام محصول'] = value;
          if (field === 'category') newRaw['دسته‌بندی'] = value;

          return { ...r, raw: newRaw, [field]: value };
        }
        return r;
      });

      return validateExcelRows(updated, categories, existingItems);
    });
  };

  const handleFixRowPrefix = (index: number) => {
    setPreviewRows(prev => {
      const updated = prev.map(r => {
        if (r.index === index && r.expectedPrefix) {
          let newCode = r.code;
          if (!newCode) {
            newCode = `${r.expectedPrefix}101`;
          } else if (!newCode.toLowerCase().startsWith(r.expectedPrefix.toLowerCase())) {
            newCode = `${r.expectedPrefix}${newCode}`;
          }
          return { ...r, raw: { ...r.raw, 'کد کالا': newCode }, code: newCode };
        }
        return r;
      });

      return validateExcelRows(updated, categories, existingItems);
    });
    toast.success('پیشوند کد اصلاح شد.');
  };

  const handleAutoFixAllPrefixes = () => {
    let fixedCount = 0;
    setPreviewRows(prev => {
      const updated = prev.map(r => {
        if (r.hasPrefixMismatch && r.expectedPrefix) {
          let newCode = r.code;
          if (!newCode) {
            newCode = `${r.expectedPrefix}${100 + r.index + 1}`;
          } else if (!newCode.toLowerCase().startsWith(r.expectedPrefix.toLowerCase())) {
            newCode = `${r.expectedPrefix}${newCode}`;
          }
          fixedCount++;
          return { ...r, raw: { ...r.raw, 'کد کالا': newCode }, code: newCode };
        }
        return r;
      });

      return validateExcelRows(updated, categories, existingItems);
    });

    if (fixedCount > 0) {
      toast.success(`پیشوند کد ${formatPersianNumber(fixedCount)} محصول به طور خودکار اصلاح شد!`);
    } else {
      toast('کدی نیازمند اصلاح پیشوند یافت نشد.');
    }
  };

  const handleConfirmImport = async () => {
    setIsImporting(true);
    setImportResult(null);

    try {
      const finalRawRows = previewRows.map(r => {
        const rowObj = { ...r.raw };
        rowObj['کد کالا'] = r.code;
        rowObj['نام محصول'] = r.name;
        rowObj['دسته‌بندی'] = r.category;
        return rowObj;
      });

      const res = await fetchJson('/items/unified-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: finalRawRows, typeFilter })
      });

      if (res && res.success) {
        setImportResult({
          createdCount: res.createdCount || 0,
          updatedCount: res.updatedCount || 0,
          pricesCount: res.pricesCount || 0,
          errors: res.errors || []
        });
        setStep('result');
        toast.success('ورود داده‌های اکسل با موفقیت انجام شد!');
        onSuccess();
      }
    } catch (err) {
      toast.error('خطا در ورود اطلاعات: ' + (err.message || 'خطای غیرمنتظره'));
    } finally {
      setIsImporting(false);
    }
  };

  return {
    step,
    setStep,
    isExporting,
    isImporting,
    isLoadingMetadata,
    previewRows,
    filteredPreviewRows,
    filterMode,
    setFilterMode,
    searchQuery,
    setSearchQuery,
    importResult,
    fileInputRef,
    totalRows: previewRows.length,
    mismatchCount: previewRows.filter(r => r.hasPrefixMismatch).length,
    duplicateBatchCount: previewRows.filter(r => r.isDuplicateInBatch).length,
    duplicateDbCount: previewRows.filter(r => r.isDuplicateInDb).length,
    totalIssues: previewRows.filter(r => r.hasPrefixMismatch || r.isDuplicateInBatch || r.isDuplicateInDb).length,
    handleClose,
    handleResetModal,
    handleDownloadExport,
    handleDownloadTemplate,
    handleFileChange,
    handleCellEdit,
    handleFixRowPrefix,
    handleAutoFixAllPrefixes,
    handleConfirmImport
  };
}
