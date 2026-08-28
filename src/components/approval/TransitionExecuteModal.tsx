import React from 'react';
import { ShieldCheck, X, Printer, MessageSquare, Send } from 'lucide-react';
import DocumentDetailsPreview, { ApprovalDocumentDetails } from './DocumentDetailsPreview';

interface WorkflowTransitionLite {
  title: string;
}

interface TransitionExecuteModalProps {
  selectedItem: {
    item: {
      instance?: { entityType?: string; entityId?: string | number };
      entityType?: string;
      entityId?: string | number;
      currentState?: { title: string };
    };
    transition: WorkflowTransitionLite;
  } | null;
  onClose: () => void;
  docDetails: ApprovalDocumentDetails | null;
  isLoadingDoc: boolean;
  onPrintDoc: (doc: ApprovalDocumentDetails) => void;
  comment: string;
  onCommentChange: (val: string) => void;
  onExecute: () => void;
  isExecuting: boolean;
}

/**
 * V9 Phase 5.2: مودال ثبت اقدام گذار گردش‌کار — استخراج‌شده از ApprovalInboxPage.
 */
export function TransitionExecuteModal({
  selectedItem,
  onClose,
  docDetails,
  isLoadingDoc,
  onPrintDoc,
  comment,
  onCommentChange,
  onExecute,
  isExecuting
}: TransitionExecuteModalProps) {
  if (!selectedItem) return null;

  const entityInfo = selectedItem.item?.instance || selectedItem.item || {};
  const entityType = (entityInfo as any).entityType;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-2xl w-full p-6 border border-gray-200 dark:border-gray-700 shadow-2xl animate-scaleUp max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h3 className="font-bold text-gray-900 dark:text-white text-base">
              ثبت اقدام گردش‌کار: «{selectedItem.transition.title}»
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xs p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto pr-1 pl-1 flex-1">
          <div className="text-xs bg-indigo-50/70 dark:bg-indigo-950/40 p-3 rounded-xl border border-indigo-100 dark:border-indigo-900/50 flex items-center justify-between">
            <div>
              <span className="text-gray-500 dark:text-gray-400">موجودیت: </span>
              <span className="font-bold text-indigo-700 dark:text-indigo-300">
                {entityType === 'document' ? 'پیش‌فاکتور / سند' : (entityType || 'سند')} #{(entityInfo.entityId || '')}
              </span>
              <span className="mx-2 text-gray-300 dark:text-gray-600">|</span>
              <span className="text-gray-500 dark:text-gray-400">وضعیت جاری: </span>
              <span className="font-bold text-indigo-600 dark:text-indigo-400">{selectedItem.item?.currentState?.title || '-'}</span>
            </div>
            {entityType === 'document' && docDetails && (
              <button
                type="button"
                onClick={() => onPrintDoc(docDetails)}
                className="text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 bg-white dark:bg-gray-800 px-2.5 py-1 rounded-lg font-bold border border-indigo-200 dark:border-indigo-700 flex items-center gap-1 hover:shadow-xs transition-all cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                نمایش نسخه چاپی
              </button>
            )}
          </div>

          {/* Document details preview */}
          {(entityType === 'document' || entityType === 'doc') && (
            <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden bg-gray-50/50 dark:bg-gray-900/30">
              <DocumentDetailsPreview docDetails={docDetails} isLoadingDoc={isLoadingDoc} />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-1">
              <MessageSquare className="w-3.5 h-3.5 text-indigo-500" />
              یادداشت / دستور مدیر (اختیاری):
            </label>
            <textarea
              value={comment}
              onChange={(e) => onCommentChange(e.target.value)}
              placeholder="توضیحات تایید یا دلیل رد درخواست را وارد کنید..."
              className="w-full text-xs p-2.5 rounded-xl border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              rows={2}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pt-4 border-t border-gray-100 dark:border-gray-700 mt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors cursor-pointer"
          >
            انصراف
          </button>
          <button
            onClick={onExecute}
            disabled={isExecuting}
            className="px-6 py-2.5 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-colors shadow-md shadow-indigo-600/20 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
          >
            <Send className="w-4 h-4" />
            <span>{isExecuting ? 'در حال ثبت...' : 'ثبت اقدام و اعمال تغییر'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default TransitionExecuteModal;
