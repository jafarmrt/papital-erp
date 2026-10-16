import React from 'react';
import { Loader2, X } from 'lucide-react';
import { DialogLayer } from '../common/DialogLayer';
import { OFFLINE_SUBMIT_TITLE, PHONE_SHEET_FOOTER_SAFE_AREA, PHONE_SHEET_OVERLAY, PHONE_SHEET_PANEL, PHONE_TAP_TARGET } from '../../lib/pwa/phoneLayout';
import { useOnlineStatus } from '../../lib/pwa/useOnlineStatus';

export interface WorkshopSheetAction {
  label: string;
  onClick: () => void;
  /** a reason that keeps the button off (an invalid field), shown as its title */
  blockedBy?: string | null;
  tone?: 'primary' | 'danger';
}

/**
 * v10.1.40 (N-01 part 3): the cartable's one window. On a phone it takes the whole screen with 44 px buttons; Esc and «بستن»
 * do nothing while a request runs, and offline every action stays off with «اتصال قطع است» (decision ت۱۰ الف: nothing is
 * queued or sent later).
 */
export function WorkshopSheet({ title, onClose, saving, actions, children }: {
  title: string;
  onClose: () => void;
  saving: boolean;
  actions: WorkshopSheetAction[];
  children: React.ReactNode;
}): React.ReactElement {
  const online = useOnlineStatus();
  const close = () => { if (!saving) onClose(); };
  return (
    <div className={PHONE_SHEET_OVERLAY}>
      <div role="dialog" aria-modal="true" aria-label={title}
        className={`${PHONE_SHEET_PANEL} bg-white dark:bg-gray-800 sm:max-w-lg p-4 sm:p-6 sm:border border-gray-200 dark:border-gray-700 shadow-2xl`}>
        <DialogLayer onClose={close} disabled={saving} />
        <div className="flex items-center justify-between gap-2 mb-3 pb-3 border-b border-gray-100 dark:border-gray-700">
          <h3 className="font-bold text-gray-900 dark:text-white text-base">{title}</h3>
          <button type="button" onClick={close} disabled={saving} aria-label="بستن"
            className={`${PHONE_TAP_TARGET} p-2.5 sm:p-1 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40`}>
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
        <div className="space-y-4 overflow-y-auto flex-1 px-0.5">{children}</div>
        <div className={`flex flex-wrap items-center justify-end gap-2 pt-4 mt-3 border-t border-gray-100 dark:border-gray-700 ${PHONE_SHEET_FOOTER_SAFE_AREA}`}>
          <button type="button" onClick={close} disabled={saving}
            className={`${PHONE_TAP_TARGET} px-4 py-2 text-sm text-gray-600 dark:text-gray-300 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40`}>
            انصراف
          </button>
          {actions.map(action => {
            const blocked = !online ? OFFLINE_SUBMIT_TITLE : action.blockedBy ?? null;
            return (
              <button key={action.label} type="button" onClick={action.onClick} disabled={saving || blocked !== null}
                title={blocked ?? undefined}
                className={`${PHONE_TAP_TARGET} flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-5 py-2 text-sm font-bold text-white rounded-xl shadow-sm disabled:opacity-50 disabled:cursor-not-allowed ${
                  action.tone === 'danger' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
                {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                {action.label}
              </button>
            );
          })}
        </div>
        {!online && <p role="status" className="mt-2 text-xs font-bold text-amber-700">{OFFLINE_SUBMIT_TITLE}</p>}
      </div>
    </div>
  );
}

export default WorkshopSheet;
