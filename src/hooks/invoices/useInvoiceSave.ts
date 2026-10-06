import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { invalidateDomains, invalidatePreset } from '../../lib/queryInvalidation';
import type { InvoiceDocumentDetails, InvoiceSavePayload, InvoiceSaveResponse } from '../../lib/invoices/invoiceForm';

/**
 * صفحه صدور فاکتور: ثبت/ویرایش فاکتور و پیش‌فاکتور با useMutation — همان درخواست‌ها، بدنه‌ها و پیام‌های
 * CreateInvoicePage. پس از ثبت موفق، کش صفحات دیگری که همین داده را نشان می‌دهند باطل می‌شود
 * (فهرست فاکتورها/اسناد، پیش‌فاکتورهای باز، شماره بعدی سند، موجودی کالاها، رزروها، کاردکس، داشبورد، اسناد حسابداری).
 */

export interface InvoiceSaveVariables {
  editingDocId: number | null;
  payload: InvoiceSavePayload;
}

export interface InvoiceSaveResult {
  docId?: number;
  printedDoc: InvoiceDocumentDetails | null;
}

interface InvoiceSaveDeps {
  loadDocument: (id: number) => Promise<InvoiceDocumentDetails | null>;
  discardDraft: () => Promise<void>;
}

/** کلیدهایی که ثبت یا ویرایش فاکتور/پیش‌فاکتور باطل می‌کند */
export async function invalidateAfterInvoiceSave(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    // documents: فهرست فاکتورها و اسناد، پیش‌فاکتورهای باز، شماره بعدی سند و جزئیات سند
    // transactions: کاردکس — accounting: سند حسابداری دوبل فاکتور نهایی
    invalidateDomains(queryClient, ['documents', 'transactions', 'accounting']),
    // items، dashboard، transfers، pendingMaterials (همان preset نهایی‌سازی و ابطال سند)
    invalidatePreset(queryClient, 'inventoryChange'),
    // رزرو موجودی پیش‌فاکتورها در فرم رسید/حواله انبار
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.inventory.all }),
  ]);
}

function saveErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const { message, error } = err as { message?: unknown; error?: unknown };
    if (typeof message === 'string' && message) return message;
    if (typeof error === 'string' && error) return error;
  }
  return 'خطا در ثبت سند';
}

export function useInvoiceSave({ loadDocument, discardDraft }: InvoiceSaveDeps) {
  const queryClient = useQueryClient();

  return useMutation<InvoiceSaveResult, unknown, InvoiceSaveVariables>({
    mutationFn: async ({ editingDocId, payload }) => {
      let res: InvoiceSaveResponse | null;
      if (editingDocId) {
        res = await fetchJson<InvoiceSaveResponse | null>(`/documents/${editingDocId}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
        void invalidateAfterInvoiceSave(queryClient);
        toast.success('پیش‌فاکتور با موفقیت به‌روزرسانی شد!');
      } else {
        res = await fetchJson<InvoiceSaveResponse | null>('/documents', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        // سند در سرور ثبت شده است؛ حتی اگر گام‌های بعدی (گردش‌کار، بارگذاری چاپ) خطا بدهند کش باید تازه شود
        void invalidateAfterInvoiceSave(queryClient);
        toast.success(payload.status === 'final' ? 'فاکتور و سند حسابداری دوبل آن با موفقیت ثبت شدند!' : 'پیش‌فاکتور با موفقیت ثبت شد و وارد چرخه تاییدات گردید!');
        // v9.0.39 (TD-446): گردش کار تأیید پیش‌فاکتور را خود سرور در تراکنش ثبت شروع می‌کند
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.workflow.all });
      }

      const targetDocId = editingDocId || res?.docId;
      const printedDoc = targetDocId ? await loadDocument(targetDocId) : null;

      if (!editingDocId) {
        await discardDraft();
      }
      return { docId: res?.docId, printedDoc };
    },
    onError: (err) => {
      toast.error(saveErrorMessage(err), { duration: 5000 });
    },
  });
}
