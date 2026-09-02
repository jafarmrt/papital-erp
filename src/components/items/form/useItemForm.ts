import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Item } from '../../../types';
import { fetchJson } from '../../../api';
import { getTodayJalaliDate } from '../../../utils';
import { ItemFormData, ItemFormModalProps } from './types';
import {
  parseItemStocks,
  parseMultiValue,
  formatMultiValue,
  peekNextProductCode,
  peekNextRawCode,
  reserveNextProductCode,
  reserveNextRawCode,
  cleanCategoryPrefix,
  buildRawItemCode,
  buildProductCode,
  processImageFile
} from './itemFormHelpers';

export function useItemForm({
  isOpen,
  item: propItem,
  editingItem,
  categories: propCategories = [],
  allCategories = [],
  type: propType = '',
  typeFilter = '',
  onSave,
  onSuccess,
  onClose
}: ItemFormModalProps) {
  const item = editingItem ?? propItem ?? null;
  const categories = propCategories.length > 0 ? propCategories : allCategories;
  const activeTypeFilter = propType || typeFilter || '';

  const [form, setForm] = useState<ItemFormData>({
    name: '',
    code: '',
    category: '',
    type: (activeTypeFilter === 'raw_material' ? 'raw_material' : 'product') as 'product' | 'raw_material',
    unit: 'عدد',
    current_stock: 0,
    initial_cost: 0,
    reorder_point: 0,
    thumbnail: '',
    color: '',
    material: '',
    weight: '',
    size: '',
    stocks: {}
  });

  // V10-2.1: سال طراحی از تاریخ جلالی امروز (حذف هاردکد ۱۴۰۳)
  const [productYear, setProductYear] = useState(() => getTodayJalaliDate().split('/')[0] || '1403');
  const [productCatPrefix, setProductCatPrefix] = useState('N');
  const [productTransferCode, setProductTransferCode] = useState('101');
  const [productDesignVar, setProductDesignVar] = useState('01');
  const [rawPrefix, setRawPrefix] = useState('B');
  const [rawNum, setRawNum] = useState('101');
  const [isSaving, setIsSaving] = useState(false);
  // V10-2.1: رزرو اتمیک شماره سری (POST consume) — با ویرایش دستی سری، رزرو باطل می‌شود
  const [productSerialReserved, setProductSerialReserved] = useState(false);
  const [rawSerialReserved, setRawSerialReserved] = useState(false);

  useEffect(() => {
    if (item) {
      setForm({
        name: item.name || '',
        code: item.code || '',
        category: item.category || '',
        type: item.type || 'product',
        unit: item.unit || 'عدد',
        current_stock: item.current_stock || 0,
        // V2.0.0: refill از weighted_average_cost (کلید واقعی) — قبلاً initial_cost همیشه خالی بود
        initial_cost: Number((item as any).weighted_average_cost ?? (item as any).weightedAverageCost ?? (item as any).initial_cost) || 0,
        reorder_point: item.reorder_point || 0,
        thumbnail: item.thumbnail || '',
        color: item.color || '',
        material: item.material || '',
        weight: item.weight ? String(item.weight) : '',
        size: item.size || '',
        stocks: parseItemStocks((item as any).stocks)
      });

      if (item.type === 'product' && item.code) {
        const parts = item.code.split('-');
        if (parts.length === 4) {
          setProductYear(parts[0]);
          setProductCatPrefix(parts[1]);
          setProductTransferCode(parts[2]);
          setProductDesignVar(parts[3]);
        }
      } else if (item.type === 'raw_material' && item.code) {
        const parts = item.code.split('-');
        if (parts.length >= 2) {
          setRawNum(parts[parts.length - 1]);
          setRawPrefix(parts.slice(0, parts.length - 1).join('-'));
        }
      }
    } else {
      const defaultType = (activeTypeFilter === 'raw_material' ? 'raw_material' : 'product') as 'product' | 'raw_material';
      const initialCat = categories.find(c => c.type === defaultType)?.name || '';
      const catObj = categories.find(c => c.name === initialCat);

      setForm({
        name: '',
        code: '',
        category: initialCat,
        type: defaultType,
        unit: catObj?.defaultUnit || 'عدد',
        current_stock: 0,
        initial_cost: 0,
        reorder_point: 10,
        thumbnail: '',
        color: '',
        material: '',
        weight: '',
        size: '',
        stocks: {}
      });

      if (defaultType === 'product') {
        const p = cleanCategoryPrefix(catObj?.prefix || 'N');
        setProductCatPrefix(p);
        peekNextProductCode(productYear, p, productTransferCode).then(parts => {
          if (parts) {
            setProductYear(parts.year);
            setProductCatPrefix(parts.catPrefix);
            setProductTransferCode(parts.transferCode);
            setProductDesignVar(parts.serial);
            setForm(prev => ({ ...prev, code: parts.code }));
          }
        });
      } else {
        const p = cleanCategoryPrefix(catObj?.prefix || 'B');
        setRawPrefix(p);
        peekNextRawCode(p).then(parts => {
          if (parts) {
            setRawNum(parts.serial);
            setRawPrefix(parts.prefix);
            setForm(prev => ({ ...prev, code: parts.code }));
          }
        });
      }
    }
  }, [item, categories, activeTypeFilter, isOpen]);

  const handleCategoryChange = (catName: string) => {
    const selectedCat = categories.find(c => c.name === catName);
    const newUnit = selectedCat?.defaultUnit || form.unit || 'عدد';

    setForm(prev => ({ ...prev, category: catName, unit: newUnit }));

    if (selectedCat && selectedCat.prefix) {
      if (form.type === 'product') {
        const p = cleanCategoryPrefix(selectedCat.prefix);
        setProductCatPrefix(p);
        const newCode = buildProductCode(productYear, p, productTransferCode, productDesignVar);
        setForm(prev => ({ ...prev, code: newCode, category: catName, unit: newUnit }));
      } else {
        // V10-2.1: prefix بدون dash انتهایی — کد جدید تک‌خط (B-H-101 به‌جای B-H--101)
        const p = cleanCategoryPrefix(selectedCat.prefix);
        setRawPrefix(p);
        const newCode = buildRawItemCode(p, rawNum);
        setForm(prev => ({ ...prev, code: newCode, category: catName, unit: newUnit }));
        peekNextRawCode(p).then(parts => {
          if (parts) {
            setRawNum(parts.serial);
            setForm(prev => ({ ...prev, code: parts.code }));
          }
        });
      }
      setProductSerialReserved(false);
      setRawSerialReserved(false);
    }
  };

  /** V10-2.1: تخصیص اتمیک شماره سری بعدی محصول (POST consume) */
  const handleReserveProductCode = async () => {
    const parts = await reserveNextProductCode(productYear, productCatPrefix, productTransferCode);
    if (!parts) {
      toast.error('خطا در دریافت شماره سری بعدی از سرور');
      return;
    }
    setProductYear(parts.year);
    setProductCatPrefix(parts.catPrefix);
    setProductTransferCode(parts.transferCode);
    setProductDesignVar(parts.serial);
    setProductSerialReserved(true);
    setForm(prev => ({ ...prev, code: parts.code }));
    toast.success(`شماره سری «${parts.serial}» برای شما رزرو شد`);
  };

  /** V10-2.1: تخصیص اتمیک شماره سری بعدی ماده اولیه (POST consume) */
  const handleReserveRawCode = async () => {
    const parts = await reserveNextRawCode(rawPrefix);
    if (!parts) {
      toast.error('خطا در دریافت شماره سری بعدی از سرور');
      return;
    }
    setRawPrefix(parts.prefix);
    setRawNum(parts.serial);
    setRawSerialReserved(true);
    setForm(prev => ({ ...prev, code: parts.code }));
    toast.success(`شماره سری «${parts.serial}» برای شما رزرو شد`);
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processImageFile(file, (dataUrl) => setForm(prev => ({ ...prev, thumbnail: dataUrl })));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setIsSaving(true);

    try {
      // V10-2.1: کد نهایی همیشه با سازنده استاندارد نرمال می‌شود (پدینگ سری + تک‌خط بودن مواد اولیه)
      let finalCode = form.code;
      if (!item) {
        finalCode = form.type === 'product'
          ? buildProductCode(productYear, productCatPrefix, productTransferCode, productDesignVar)
          : buildRawItemCode(rawPrefix, rawNum);
      }

      let calculatedStock = form.current_stock;
      if (!item && Object.keys(form.stocks).length > 0) {
        calculatedStock = Object.values(form.stocks).reduce((acc: number, val: any) => acc + (Number(val) || 0), 0);
      }

      const payload: Partial<Item> & Record<string, any> = {
        ...form,
        code: finalCode,
        current_stock: calculatedStock,
        stocks: form.stocks,
        weight: form.weight ? parseFloat(form.weight) : undefined,
        // V2.0.0: کلید صحیح بک‌اند برای «بهای تمام‌شده اولیه (WAC/خرید)» —
        // قبلاً initial_cost فرستاده می‌شد که توسط Zod حذف و WAC صفر ذخیره می‌شد
        weighted_average_cost: Number(form.initial_cost) || 0,
        initial_cost: Number(form.initial_cost) || 0
      };

      if (onSave) {
        await onSave(payload);
      } else {
        const url = item ? `/items/${item.id}` : '/items';
        const method = item ? 'PUT' : 'POST';
        const res = await fetchJson(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (res && res.error) throw new Error(res.error);
        toast.success(item ? 'اطلاعات کالا با موفقیت به‌روزرسانی شد' : 'کالای جدید با موفقیت ثبت شد');
      }

      if (onSuccess) await onSuccess();
      onClose();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'خطا در ثبت کالا');
    } finally {
      setIsSaving(false);
    }
  };

  // V10-2.1: ویرایش دستی شماره سری، رزرو خودکار قبلی را باطل می‌کند
  const setProductDesignVarManual = (val: string) => {
    setProductDesignVar(val);
    setProductSerialReserved(false);
  };
  const setRawNumManual = (val: string) => {
    setRawNum(val);
    setRawSerialReserved(false);
  };

  return {
    item,
    categories,
    form,
    setForm,
    productYear,
    setProductYear,
    productCatPrefix,
    setProductCatPrefix,
    productTransferCode,
    setProductTransferCode,
    productDesignVar,
    setProductDesignVar: setProductDesignVarManual,
    rawPrefix,
    setRawPrefix,
    rawNum,
    setRawNum: setRawNumManual,
    isSaving,
    handleCategoryChange,
    handleReserveProductCode,
    handleReserveRawCode,
    productSerialReserved,
    rawSerialReserved,
    handleImageChange,
    parseMultiValue,
    formatMultiValue,
    handleSubmit
  };
}
