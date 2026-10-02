import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { toast } from 'react-hot-toast';
import { User } from '../../types';
import { extractDateString, errorMessageOf } from '../../utils';
import { exchangeRateError } from '../../components/documents/ExchangeRateField';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { deductProjectReservations } from '../../lib/documents/stockReservations';
import type { StockDocumentForm } from './useStockDocumentForm';
import type { StockDocumentReferenceData } from './useStockDocumentReferenceData';

/**
 * TD-080 (بخش ۳): ثبت نهایی سند رسید/حواله انبار — منتقل‌شده بدون تغییر رفتار از DocumentsPage
 * (همان اعتبارسنجی‌ها، بدنه درخواست، کسر رزرو پروژه و پیام‌ها).
 */
export function useStockDocumentSubmit(form: StockDocumentForm, refData: StockDocumentReferenceData, currentUser: User) {
  const queryClient = useQueryClient();
  const { warehouses } = refData;
  const {
    actionType, docType, refNumber, date, location, buyerName, currency, exchangeRate, returnInvoiceId,
    notes, docItems, selectedProjectId, selectedProjectObj, attachments, getItemReservationSummary,
    setIsSaving, setDocItems, fetchNextRef, setReturnInvoiceRef, setReturnInvoiceId, setBuyerName,
    setSelectedSupplierObj, setNotes, setUnitPrice, setQuantity, setSelectedProjectId,
    setSelectedProjectObj, setAttachments,
  } = form;

  // بازخوانی لیست پروژه‌ها پس از عملیات تخصیص
  const reloadReferenceLists = () => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.projects.all });
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.customers.all });
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.items.all });
    void queryClient.invalidateQueries({ queryKey: ['inventory', 'reserved-items'] });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (warehouses.length === 0) {
      toast.error('هیچ انباری در سیستم تعریف نشده است. لطفاً ابتدا از بخش تنظیمات > انبارها، حداقل یک انبار تعریف نمایید.');
      return;
    }
    if (docItems.length === 0) {
      toast.error('هیچ کالایی اضافه نشده است.');
      return;
    }

    // Double check constraints for all items before submitting
    if (actionType === 'out') {
      if (!buyerName || !buyerName.trim()) {
        toast.error('لطفاً پرسنل گیرنده حواله را انتخاب کنید.');
        return;
      }
      for (const d of docItems) {
        const { reservedForOtherProjects, maxAllowedForExit, matchingReservations } = getItemReservationSummary(d.item);
        if (d.quantity > maxAllowedForExit) {
          const otherProjTitles = matchingReservations
            .filter(r => String(r.projectId) !== String(selectedProjectId))
            .map(r => `«${r.projectCode || r.projectTitle}»`)
            .join('، ');

          toast.error(`خطا در کالا «${d.item.name}»: مقدار درخواستی (${d.quantity}) بیش از حد مجاز خروج (${maxAllowedForExit}) است. (${reservedForOtherProjects} ${d.item.unit} برای ${otherProjTitles} رزرو است)`);
          return;
        }
      }
    }

    // v7.0.63 (TD-198): ارز فقط برای سند ورود انتخاب می‌شود؛ سند ارزی بدون نرخ تسعیر ثبت نمی‌شود
    const docCurrency = actionType === 'in' ? currency : 'IRR';
    const rateError = exchangeRateError(docCurrency, exchangeRate);
    if (rateError) {
      toast.error(rateError);
      return;
    }

    setIsSaving(true);
    try {
      const formattedDate = extractDateString(date) || new Date().toISOString().split('T')[0];

      let finalNotes = notes || '';
      if (actionType === 'out' && selectedProjectObj) {
        const projTag = `[پروژه: ${selectedProjectObj.project_code || selectedProjectObj.title}]`;
        if (!finalNotes.includes(projTag)) {
          finalNotes = `${projTag} ${finalNotes}`.trim();
        }
      }

      await fetchJson('/documents', {
        method: 'POST',
        body: JSON.stringify({
          docType,
          status: 'final',
          refNumber,
          date: formattedDate,
          user: currentUser.full_name || currentUser.username,
          location,
          buyer_name: buyerName,
          notes: finalNotes,
          inOut: actionType,
          currency: docCurrency,
          exchangeRate: docCurrency !== 'IRR' ? exchangeRate : null,
          projectId: selectedProjectId ? Number(selectedProjectId) : undefined,
          returnOfDocumentId: docType === 'return' && returnInvoiceId !== null ? returnInvoiceId : undefined,
          attachments,
          items: docItems.map(d => ({
            itemId: d.item.id,
            quantity: d.quantity,
            unit_price: d.unitPrice || 0
          }))
        })
      });

      if (actionType === 'out' && selectedProjectObj) {
        const currentInvControl = selectedProjectObj.inventory_control || {};
        const { reservedItems: reservedItemsList, totalDeducted: totalDeductedCount } =
          deductProjectReservations(currentInvControl.reservedItems, docItems);

        if (totalDeductedCount > 0) {
          const updatedInvControl = {
            ...currentInvControl,
            reservedItems: reservedItemsList,
            isReserved: reservedItemsList.length > 0,
            lastUpdated: new Date().toISOString()
          };

          try {
            await fetchJson(`/projects/${selectedProjectObj.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                inventory_control: updatedInvControl
              })
            });
            toast.success(`سند خروج با موفقیت ثبت شد و تعداد ${totalDeductedCount} عدد از اقلام رزرو شده پروژه «${selectedProjectObj.project_code || selectedProjectObj.title}» کسر گردید.`);
          } catch (projErr) {
            console.error("Error updating project reserved items:", projErr);
          }
        } else {
          toast.success('سند حواله خروج با موفقیت ثبت شد و فرآیند تایید در ورکفلو آغاز گردید.');
        }
      } else {
        if (actionType === 'in' && docType === 'receipt') {
          toast.success('رسید خرید با موفقیت ثبت شد و گردش کار تاییدات مالی و انبار آغاز گردید.');
        } else {
          toast.success('سند با موفقیت در سیستم ثبت گردید!');
        }
      }

      setDocItems([]);
      void fetchNextRef();
      setReturnInvoiceRef('');
      setReturnInvoiceId(null);
      setBuyerName('');
      setSelectedSupplierObj(null);
      setNotes('');
      setUnitPrice('');
      setQuantity('');
      setSelectedProjectId('');
      setSelectedProjectObj(null);
      setAttachments([]);
      reloadReferenceLists(); // Refresh project list and reservations
    } catch (err: unknown) {
      toast.error(errorMessageOf(err) || 'خطا در ثبت سند');
    } finally {
      setIsSaving(false);
    }
  };

  return { handleSubmit };
}
