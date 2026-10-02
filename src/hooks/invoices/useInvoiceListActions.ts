import { useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { confirmAction } from '../../components/ConfirmDialogHost';
import { fetchJson } from '../../api';
import { errorMessageOf } from '../../utils';
import type { InvoiceListDocument } from '../../lib/invoices/invoiceListDocuments';

/**
 * TD-080 (بخش ۳): ویرایش درجای توضیحات، چاپ، جزئیات، گردش‌کار، تسویه و ابطال سند —
 * منتقل‌شده بدون تغییر (همان درخواست‌ها و همان پیام‌ها) از InvoicesListPage.
 */
export function useInvoiceListActions(loadData: () => void) {
  const [editingNotesId, setEditingNotesId] = useState<number | null>(null);
  const [tempNotes, setTempNotes] = useState('');

  const [printedDoc, setPrintedDoc] = useState<InvoiceListDocument | null>(null);
  const [selectedDocDetails, setSelectedDocDetails] = useState<InvoiceListDocument | null>(null);
  const [workflowDoc, setWorkflowDoc] = useState<InvoiceListDocument | null>(null);
  const [settlementDoc, setSettlementDoc] = useState<InvoiceListDocument | null>(null);
  const [, setDetailsLoading] = useState(false);
  const [, setPrintLoading] = useState(false);
  const detailsRequestRef = useRef<AbortController | null>(null);

  const handleUpdateNotes = async (id: number) => {
    try {
      await fetchJson(`/documents/${id}/notes`, {
        method: 'PUT',
        body: JSON.stringify({ notes: tempNotes })
      });
      toast.success('توضیحات با موفقیت ثبت شد.');
      loadData();
      setEditingNotesId(null);
    } catch (err) {
      console.error(err);
      toast.error('خطا در بروزرسانی توضیحات');
    }
  };

  const handlePrint = async (id: number) => {
    try {
      setPrintLoading(true);
      const doc = await fetchJson(`/documents/${id}`);
      setPrintedDoc(doc);
    } catch (err) {
      console.error(err);
      toast.error('خطا در بارگذاری اطلاعات فاکتور');
    } finally {
      setPrintLoading(false);
    }
  };

  // TD-235 (بند ۶): بارگذاری قبلی لغو می‌شود و پاسخ فقط وقتی نشان داده می‌شود که همان سند هنوز در پنجره باز باشد
  // (پیش‌تر پاسخ دیررس سند قبلی جای سند تازه را می‌گرفت یا پنجره بسته را دوباره باز می‌کرد).
  const handleOpenDetails = async (docSummary: InvoiceListDocument) => {
    detailsRequestRef.current?.abort();
    const controller = new AbortController();
    detailsRequestRef.current = controller;
    try {
      setDetailsLoading(true);
      setSelectedDocDetails(docSummary);
      const fullDoc = await fetchJson(`/documents/${docSummary.id}`, { signal: controller.signal });
      if (fullDoc && !controller.signal.aborted) {
        setSelectedDocDetails(current => (current && current.id === docSummary.id ? fullDoc : current));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error('Error loading document details:', err);
      toast.error('خطا در بارگذاری جزئیات کامل اقلام سند');
    } finally {
      if (detailsRequestRef.current === controller) {
        detailsRequestRef.current = null;
        setDetailsLoading(false);
      }
    }
  };

  const handleDeleteDoc = async (id: number, refNum: string | undefined) => {
    if (!(await confirmAction({ title: 'ابطال سند', message: `آیا از ابطال / حذف سند یا پیش‌فاکتور شماره "${refNum}" اطمینان دارید؟` }))) return;
    try {
      await fetchJson(`/documents/${id}`, { method: 'DELETE' });
      toast.success('سند / پیش‌فاکتور با موفقیت ابطال و حذف گردید.');
      loadData();
    } catch (err) {
      console.error(err);
      toast.error(errorMessageOf(err) || 'خطا در ابطال سند');
    }
  };

  const startEditingNotes = (doc: InvoiceListDocument) => {
    setEditingNotesId(doc.id);
    setTempNotes(doc.notes || '');
  };

  const printFromDetails = (docId: number) => {
    setSelectedDocDetails(null);
    void handlePrint(docId);
  };

  const handleSettlementSuccess = () => {
    loadData();
    if (selectedDocDetails && settlementDoc && selectedDocDetails.id === settlementDoc.id) {
      void handleOpenDetails(settlementDoc);
    }
  };

  return {
    editingNotesId, setEditingNotesId,
    tempNotes, setTempNotes,
    printedDoc, setPrintedDoc,
    selectedDocDetails, setSelectedDocDetails,
    workflowDoc, setWorkflowDoc,
    settlementDoc, setSettlementDoc,
    handleUpdateNotes, handlePrint, handleOpenDetails, handleDeleteDoc,
    startEditingNotes, printFromDetails, handleSettlementSuccess,
  };
}

export type InvoiceListActions = ReturnType<typeof useInvoiceListActions>;
