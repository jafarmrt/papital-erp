import React from 'react';
import {
  ShieldCheck, X, Printer, CheckCircle2, XCircle, MessageSquare, Send
} from 'lucide-react';
import DocumentDetailsPreview, { ApprovalDocumentDetails } from './DocumentDetailsPreview';

export type ApprovalTaskAction = 'approve' | 'reject';

interface TaskExecuteModalProps {
  selectedTask: { id: number; title: string; instance?: { entityType?: string; entityId?: string | number }; entityType?: string; entity_id?: string | number; entityId?: string | number } | null;
  onClose: () => void;
  docDetails: ApprovalDocumentDetails | null;
  isLoadingDoc: boolean;
  onPrintDoc: (doc: ApprovalDocumentDetails) => void;
  taskAction: ApprovalTaskAction;
  onTaskActionChange: (action: ApprovalTaskAction) => void;
  comment: string;
  onCommentChange: (val: string) => void;
  onExecute: () => void;
  isExecuting: boolean;
}

/**
 * V9 Phase 5.2: مودال بررسی و تعیین تکلیف وظیفه کارتابل — استخراج‌شده از ApprovalInboxPage.
 */
export function TaskExecuteModal({
  selectedTask,
  onClose,
  docDetails,
  isLoadingDoc,
  onPrintDoc,
  taskAction,
  onTaskActionChange,
  comment,
  onCommentChange,
  onExecute,
  isExecuting
}: TaskExecuteModalProps) {
  if (!selectedTask) return null;

  const entityType = selectedTask.instance?.entityType || selectedTask.entityType;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-2xl w-full p-6 border border-gray-200 dark:border-gray-700 shadow-2xl animate-scaleUp max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h3 className="font-bold text-gray-900 dark:text-white text-base">
              بررسی و تعیین تکلیف: «{selectedTask.title}»
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
              <span className="text-gray-500 dark:text-gray-400">شناسه وظیفه: </span>
              <span className="font-mono font-bold text-gray-800 dark:text-gray-200">#{selectedTask.id}</span>
              <span className="mx-2 text-gray-300 dark:text-gray-600">|</span>
              <span className="text-gray-500 dark:text-gray-400">موجودیت: </span>
              <span className="font-bold text-indigo-700 dark:text-indigo-300">
                {entityType === 'document' ? 'پیش‌فاکتور / سند' : (entityType || 'سند')} #{(selectedTask.instance?.entityId || selectedTask.entityId || selectedTask.entity_id || '')}
              </span>
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

          {/* Document Items & Buyer Details when entity is document */}
          {entityType === 'document' && (
            <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden bg-gray-50/50 dark:bg-gray-900/30">
              <DocumentDetailsPreview docDetails={docDetails} isLoadingDoc={isLoadingDoc} />
            </div>
          )}

          {/* Action Decision Selector (Approve vs Reject) */}
          <div>
            <label className="block text-xs font-bold text-gray-800 dark:text-gray-200 mb-1.5">
              تصمیم و تعیین تکلیف شما:
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => onTaskActionChange('approve')}
                className={`flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                  taskAction === 'approve'
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-md ring-2 ring-emerald-300 dark:ring-emerald-900'
                    : 'bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
                }`}
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>تایید و موافقت با درخواست</span>
              </button>
              <button
                type="button"
                onClick={() => onTaskActionChange('reject')}
                className={`flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                  taskAction === 'reject'
                    ? 'bg-rose-600 text-white border-rose-600 shadow-md ring-2 ring-rose-300 dark:ring-rose-900'
                    : 'bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-600 hover:bg-rose-50 dark:hover:bg-rose-950/30'
                }`}
              >
                <XCircle className="w-4 h-4" />
                <span>رد و مخالفت با درخواست</span>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-1">
              <MessageSquare className="w-3.5 h-3.5 text-indigo-500" />
              دستور / توضیحات مدیر (اختیاری):
            </label>
            <textarea
              value={comment}
              onChange={(e) => onCommentChange(e.target.value)}
              placeholder="توضیحات تایید کالا، بررسی موجودی، یا دلیل رد را در اینجا درج نمایید..."
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
            className={`px-6 py-2.5 text-xs font-bold text-white rounded-xl transition-all shadow-md disabled:opacity-50 flex items-center gap-1.5 cursor-pointer ${
              taskAction === 'approve'
                ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20'
                : 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/20'
            }`}
          >
            <Send className="w-4 h-4" />
            <span>
              {isExecuting 
                ? 'در حال ثبت در گردش‌کار...' 
                : taskAction === 'approve' 
                ? 'تایید و ثبت نهایی وظیفه' 
                : 'رد و عودت وظیفه'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default TaskExecuteModal;
