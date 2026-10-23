import { useEffect, useEffectEvent } from 'react';
import toast from 'react-hot-toast';
import { errorMessageOf } from '../utils';
import { useOpeningRead } from './queries/readOnEveryOpening';
import { useDocumentDetailQuery, useDocumentLineStockQuery } from './queries/useDocumentQueries';
import { useRequisitionDetailQuery } from './queries/useProcurementQueries';
import type { ApprovalDocumentDetails } from '../components/approval/DocumentDetailsPreview';
import type { PurchaseRequisition } from '../types';

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

const DOCUMENT_ENTITY_TYPES = ['document', 'doc', 'invoice', 'proforma', ''];
type DocumentAnswer = ({ data?: ApprovalDocumentDetails } & ApprovalDocumentDetails) | null;

/** the document of an answer, or null when it carries none */
function documentOf(answer: DocumentAnswer | undefined): ApprovalDocumentDetails | null {
  const doc = (answer?.data ?? answer) as ApprovalDocumentDetails | null | undefined;
  return doc && (doc.id || doc.refNumber || doc.ref_number) ? doc : null;
}

/**
 * TD-464 (یافته B14-22): سند یا درخواست خرید کار باز کارتابل. هر درخواست با بسته یا عوض شدن کار لغو می‌شود
 * (AbortController، AGENTS §21 FE-008) و پاسخی که پس از آن برسد نادیده گرفته می‌شود؛ پیش‌تر پاسخ دیررس کار بسته‌شده
 * جزئیات کار بعدی را جایگزین می‌کرد. درخواست خرید فقط همین‌جا و یک بار خوانده می‌شود.
 * 10.3 (ARCH review finding 3, part 15): both read through the shared cache, under the document's and the requisition's
 * own keys, again whenever the inbox shows a record (another task's, or the same one after the task was closed), and
 * never shown from an earlier showing; an approval elsewhere, a document change or a procurement change refreshes the one
 * on screen. Each key is the record's, so a late answer for an earlier task never lands on the next one; another task of
 * the record on screen keeps it, as it is already this showing's and kept fresh.
 */
export function useApprovalTaskEntity(task: ApprovalTaskEntityRef | null): ApprovalTaskEntity {
  const entityType = task ? approvalEntityTypeOf(task) : '';
  const rawId = task ? approvalEntityIdOf(task) : undefined;
  const entityId = Number(rawId);
  const id = rawId && Number.isSafeInteger(entityId) && entityId > 0 ? entityId : null;
  const isRequisition = id !== null && isRequisitionEntity(entityType);
  const isDocument = id !== null && DOCUMENT_ENTITY_TYPES.includes(entityType);
  // the record shown, not the task: the query's key is the record's, so only a new record (or a closed task) reads again
  const opening = id;

  const requisitionRead = useOpeningRead(useRequisitionDetailQuery(isRequisition ? id : null), isRequisition ? opening : null);
  const documentRead = useOpeningRead(useDocumentDetailQuery<DocumentAnswer>(isDocument ? id : null), isDocument ? opening : null);
  // v10.0.151 (TD-1175): the outgoing lines' warehouse and sellable stock beside the document; its error only hides them
  const lineStockRead = useOpeningRead(useDocumentLineStockQuery(isDocument ? id : null), isDocument ? opening : null);

  const fromRow = task && isDocument ? documentFromRow(task, rawId ?? '') : null;
  const sayRequisitionFailed = useEffectEvent(() => {
    toast.error(errorMessageOf(requisitionRead.error) || 'درخواست خرید خوانده نشد؛ دوباره باز کنید.');
  });
  const requisitionFailedAt = requisitionRead.data === undefined ? requisitionRead.failedAt : 0;
  useEffect(() => {
    if (requisitionFailedAt) sayRequisitionFailed();
  }, [requisitionFailedAt]);
  // a document read that fails with no summary in the row says so; with one, the summary stays on screen
  const sayDocumentFailed = useEffectEvent(() => {
    if (!fromRow) toast.error(errorMessageOf(documentRead.error) || 'سند خوانده نشد؛ دوباره باز کنید.');
  });
  const documentFailedAt = documentRead.data === undefined ? documentRead.failedAt : 0;
  useEffect(() => {
    if (documentFailedAt) sayDocumentFailed();
  }, [documentFailedAt]);

  if (isRequisition) {
    return {
      ...EMPTY,
      requisitionDetails: requisitionRead.data ?? null,
      isLoadingRequisition: requisitionRead.data === undefined && requisitionFailedAt === 0,
    };
  }
  if (isDocument) {
    const lineStockSettled = lineStockRead.data !== undefined || lineStockRead.failedAt > 0;
    if (documentRead.data !== undefined && lineStockSettled) {
      const doc = documentOf(documentRead.data);
      return { ...EMPTY, docDetails: doc ? { ...doc, lineStock: lineStockRead.data ?? [] } : fromRow };
    }
    return { ...EMPTY, docDetails: fromRow, isLoadingDoc: documentFailedAt === 0 };
  }
  return EMPTY;
}
