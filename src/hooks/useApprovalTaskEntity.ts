import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { fetchJson } from '../api';
import type { ApprovalDocumentDetails } from '../components/approval/DocumentDetailsPreview';
import type { PurchaseRequisition } from '../types';
import type { DocumentLineStock } from '../lib/documents/documentLineStock';

/** فیلدهای ردیف کارتابل که برای خواندن موجودیت کار لازم است */
export interface ApprovalTaskEntityRef {
  id: number;
  entityType?: string;
  entityId?: string | number;
  instance?: { entityType?: string; entityId?: string | number };
  refNumber?: string;
  buyerName?: string;
  amount?: number;
}

export interface ApprovalTaskEntity {
  docDetails: ApprovalDocumentDetails | null;
  isLoadingDoc: boolean;
  requisitionDetails: PurchaseRequisition | null;
  isLoadingRequisition: boolean;
}

const EMPTY: ApprovalTaskEntity = { docDetails: null, isLoadingDoc: false, requisitionDetails: null, isLoadingRequisition: false };

export const approvalEntityTypeOf = (task: ApprovalTaskEntityRef): string => task.instance?.entityType || task.entityType || '';
export const approvalEntityIdOf = (task: ApprovalTaskEntityRef): string | number | undefined => task.instance?.entityId || task.entityId;
export const isRequisitionEntity = (type: string): boolean => type === 'purchase_requisition' || type === 'requisition';

/** خلاصه سند از خود ردیف کارتابل تا پاسخ سرور برسد (مبلغ ردیف ریالی است) */
function documentFromRow(task: ApprovalTaskEntityRef, entityId: string | number): ApprovalDocumentDetails | null {
  if (!task.buyerName && !task.refNumber && !task.amount) return null;
  return {
    ref_number: task.refNumber || String(entityId),
    buyer_name: task.buyerName || '',
    total_amount: task.amount || 0,
    currency: 'IRR',
    items: [],
  };
}

/**
 * TD-464 (یافته B14-22): سند یا درخواست خرید کار باز کارتابل. هر درخواست با بسته یا عوض شدن کار لغو می‌شود
 * (AbortController، AGENTS §21 FE-008) و پاسخی که پس از آن برسد نادیده گرفته می‌شود؛ پیش‌تر پاسخ دیررس کار بسته‌شده
 * جزئیات کار بعدی را جایگزین می‌کرد. درخواست خرید فقط همین‌جا و یک بار خوانده می‌شود.
 */
export function useApprovalTaskEntity(task: ApprovalTaskEntityRef | null): ApprovalTaskEntity {
  const [state, setState] = useState<ApprovalTaskEntity>(EMPTY);

  useEffect(() => {
    setState(EMPTY);
    if (!task) return undefined;
    const entityType = approvalEntityTypeOf(task);
    const entityId = approvalEntityIdOf(task);
    if (!entityId) return undefined;
    const controller = new AbortController();
    const live = () => !controller.signal.aborted;

    if (isRequisitionEntity(entityType)) {
      setState({ ...EMPTY, isLoadingRequisition: true });
      fetchJson<{ data?: PurchaseRequisition } & Partial<PurchaseRequisition>>(`/procurement/requisitions/${entityId}`, { signal: controller.signal })
        .then((res) => {
          if (!live()) return;
          const req = (res?.data ?? res) as PurchaseRequisition | undefined;
          setState({ ...EMPTY, requisitionDetails: req && (req.id || req.code) ? req : null });
        })
        .catch((err: unknown) => {
          if (!live()) return;
          setState(EMPTY);
          toast.error(err instanceof Error && err.message ? err.message : 'درخواست خرید خوانده نشد؛ دوباره باز کنید.');
        });
    } else if (['document', 'doc', 'invoice', 'proforma', ''].includes(entityType)) {
      const fromRow = documentFromRow(task, entityId);
      setState({ ...EMPTY, docDetails: fromRow, isLoadingDoc: true });
      // v10.0.92 (TD-1175): the outgoing lines' warehouse and sellable stock beside the document; its error only hides them
      const lineStock = fetchJson<{ data?: DocumentLineStock[] }>(`/documents/${entityId}/line-stock`, { signal: controller.signal })
        .then(res => (Array.isArray(res?.data) ? res.data : []))
        .catch(() => [] as DocumentLineStock[]);
      fetchJson<{ data?: ApprovalDocumentDetails } & ApprovalDocumentDetails>(`/documents/${entityId}`, { signal: controller.signal })
        .then(async (res) => {
          const doc = (res?.data ?? res) as ApprovalDocumentDetails | undefined;
          const stock = await lineStock;
          if (!live()) return;
          setState({ ...EMPTY, docDetails: doc && (doc.id || doc.refNumber || doc.ref_number) ? { ...doc, lineStock: stock } : fromRow });
        })
        .catch((err: unknown) => {
          if (!live()) return;
          setState({ ...EMPTY, docDetails: fromRow });
          if (!fromRow) toast.error(err instanceof Error && err.message ? err.message : 'سند خوانده نشد؛ دوباره باز کنید.');
        });
    }
    return () => controller.abort();
  }, [task]);

  return state;
}
