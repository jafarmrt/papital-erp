import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { toast } from 'react-hot-toast';
import { User } from '../../types';
import { extractDateString, errorMessageOf, formatPersianNumber, getTodayJalaliDate } from '../../utils';
import { exchangeRateError } from '../../components/documents/ExchangeRateField';
import { invalidatePreset } from '../../lib/queryInvalidation';
import { refNumberToSend } from '../../lib/documents/documentRefRules';
import { selectedPartyId } from '../../lib/documents/partySelection';
import type { StockDocumentForm } from './useStockDocumentForm';
import type { StockDocumentReferenceData } from './useStockDocumentReferenceData';

/**
 * TD-080 (بخش ۳): ثبت نهایی سند رسید/حواله انبار — منتقل‌شده بدون تغییر رفتار از DocumentsPage
 * (همان اعتبارسنجی‌ها، بدنه درخواست و پیام‌ها). v7.0.102 (TD-233): رزرو پروژه دیگر در مرورگر کم نمی‌شود؛ سرور آن را
 * در همان تراکنش حواله کم می‌کند و مقدار کسرشده را در پاسخ برمی‌گرداند.
 */

interface CreateDocumentResponse {
  docId?: number;
  projectReservation?: { releasedQuantity?: number } | null;
}
export function useStockDocumentSubmit(form: StockDocumentForm, refData: StockDocumentReferenceData, currentUser: User) {
  const queryClient = useQueryClient();
  const { warehouses } = refData;
  const {
    actionType, docType, refNumber, suggestedRef, date, location, buyerName, currency, exchangeRate, returnInvoiceId, returnVatPercent, setReturnVatPercent,
    notes, docItems, selectedProjectId, selectedProjectObj, attachments, getItemReservationSummary, selectedSupplierObj,
    setIsSaving, setDocItems, fetchNextRef, changeReturnInvoiceRef, setBuyerName,
    setSelectedSupplierObj, setNotes, setUnitPrice, setQuantity, setSelectedProjectId,
    setSelectedProjectObj, setAttachments, setCurrency, setExchangeRate,
  } = form;

  // v9.0.292 (TD-796، یافته B08-27): همان فهرست‌هایی که ثبت فاکتور باطل می‌کند (اسناد، کاردکس، سند حسابداری، کالاها، پیشخوان،
  // رزروها، پروژه، پرونده فروش و طرف حساب)؛ پیش‌تر فقط پروژه، طرف حساب، کالا و رزرو تازه می‌شدند
  const reloadReferenceLists = () => {
    void invalidatePreset(queryClient, 'documentChange');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (warehouses.length === 0) {
      toast.error('هیچ انباری در سامانه تعریف نشده است. لطفاً ابتدا از بخش تنظیمات > انبارها، حداقل یک انبار تعریف نمایید.');
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

          toast.error(`خطا در کالا «${d.item.name}»: مقدار درخواستی (${formatPersianNumber(d.quantity)}) بیش از حد مجاز خروج (${formatPersianNumber(maxAllowedForExit)}) است. (${formatPersianNumber(reservedForOtherProjects)} ${d.item.unit} برای ${otherProjTitles} رزرو است)`);
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
      // TD-234 (بند ۴): تاریخ جایگزین امروزِ ساعت کسب‌وکار است، نه تاریخ UTC مرورگر
      const formattedDate = extractDateString(date) || getTodayJalaliDate();

      let finalNotes = notes || '';
      if (actionType === 'out' && selectedProjectObj) {
        const projTag = `[پروژه: ${selectedProjectObj.project_code || selectedProjectObj.title}]`;
        if (!finalNotes.includes(projTag)) {
          finalNotes = `${projTag} ${finalNotes}`.trim();
        }
      }

      const created = await fetchJson<CreateDocumentResponse>('/documents', {
        method: 'POST',
        body: JSON.stringify({
          docType,
          status: 'final',
          // v9.0.285 (TD-783): برگشت از فروش و شماره پیشنهادی دست‌نخورده «auto»؛ سرور شماره آزاد سری را می‌دهد
          refNumber: refNumberToSend(docType, refNumber, suggestedRef),
          date: formattedDate,
          user: currentUser.full_name || currentUser.username,
          location,
          // v9.0.287 (TD-778): طرف حساب ورود با شناسه انتخابگر؛ برگشت با فاکتور مرجع طرف حساب فاکتور را از سرور می‌گیرد
          partyId: actionType === 'in' && returnInvoiceId === null ? selectedPartyId(selectedSupplierObj?.id) : undefined,
          buyer_name: buyerName,
          notes: finalNotes,
          inOut: actionType,
          currency: docCurrency,
          exchangeRate: docCurrency !== 'IRR' ? exchangeRate : null,
          projectId: selectedProjectId ? Number(selectedProjectId) : undefined,
          returnOfDocumentId: docType === 'return' && returnInvoiceId !== null ? returnInvoiceId : undefined,
          // v9.0.274 (TD-774): مالیات برگشت با فاکتور مرجع را سرور از فاکتور می‌گیرد؛ بی فاکتور مرجع درصد کاربر
          vatPercent: docType === 'return' && returnInvoiceId === null && returnVatPercent !== '' ? Number(returnVatPercent) : undefined,
          attachments,
          items: docItems.map(d => ({
            itemId: d.item.id,
            quantity: d.quantity,
            unit_price: d.unitPrice || 0
          }))
        })
      });

      if (actionType === 'out' && selectedProjectObj) {
        const releasedQty = Number(created?.projectReservation?.releasedQuantity || 0);
        if (releasedQty > 0) {
          toast.success(`سند خروج با موفقیت ثبت شد و تعداد ${formatPersianNumber(releasedQty)} عدد از اقلام رزرو شده پروژه «${selectedProjectObj.project_code || selectedProjectObj.title}» کسر گردید.`);
        } else {
          // v9.0.297 (TD-803): سند انبار نهایی ثبت می‌شود و گردش کاری آغاز نمی‌شود
          toast.success('سند حواله خروج ثبت و موجودی انبار به‌روزرسانی شد.');
        }
      } else {
        if (actionType === 'in' && docType === 'receipt') {
          toast.success('رسید خرید ثبت و موجودی انبار به‌روزرسانی شد؛ سند حسابداری تا تأیید حسابدار پیش‌نویس است.');
        } else {
          toast.success('سند با موفقیت در سامانه ثبت شد.');
        }
      }

      setDocItems([]);
      void fetchNextRef();
      changeReturnInvoiceRef('');
      setReturnVatPercent('');
      setBuyerName('');
      setSelectedSupplierObj(null);
      setNotes('');
      setUnitPrice('');
      setQuantity('');
      setSelectedProjectId('');
      setSelectedProjectObj(null);
      setAttachments([]);
      setCurrency('IRR'); // TD-234 (بند ۳): نرخ تسعیر سند قبلی برای سند بعدی نمی‌ماند
      setExchangeRate(0);
      reloadReferenceLists(); // Refresh project list and reservations
    } catch (err: unknown) {
      toast.error(errorMessageOf(err) || 'خطا در ثبت سند');
    } finally {
      setIsSaving(false);
    }
  };

  return { handleSubmit };
}
