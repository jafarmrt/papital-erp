import React, { useState } from 'react';
import { UserCheck, X } from 'lucide-react';
import { useAuth, useHasAnyPermission } from '../../contexts/AuthContext';
import { useRevokeDelegationMutation } from '../../hooks/queries/useWorkflowQueries';
import { delegationScopeLabel, useMyDelegationsQuery, type DelegationRow } from '../../hooks/queries/useWorkflowDelegationQueries';
import { WORKFLOW_DELEGATE_PERMISSIONS } from '../../lib/permissions/workflowPermissions';
import { OFFLINE_SUBMIT_TITLE, PHONE_SHEET_OVERLAY, PHONE_SHEET_PANEL, PHONE_TAP_TARGET } from '../../lib/pwa/phoneLayout';
import { useOnlineStatus } from '../../lib/pwa/useOnlineStatus';
import { formatPersianDate } from '../../utils';
import { confirmAction } from '../ConfirmDialogHost';
import { DelegationForm } from './DelegationForm';

const STATUS_LABELS: Record<DelegationRow['status'], string> = {
  active: 'فعال',
  scheduled: 'برنامه‌ریزی‌شده',
  expired: 'پایان‌یافته',
  revoked: 'لغو شده',
};

function DelegationLine({ row, given, onRevoke, revoking }: {
  row: DelegationRow;
  given: boolean;
  onRevoke: (id: number) => void;
  revoking: boolean;
}): React.ReactElement {
  const online = useOnlineStatus();
  const live = row.status === 'active' || row.status === 'scheduled';
  return (
    <li className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl border border-gray-200 dark:border-gray-700 text-xs">
      <div className="space-y-0.5">
        <div className="font-semibold text-gray-900 dark:text-white">
          {given ? `به «${row.toUserName}»` : `از «${row.fromUserName}»`}
          <span className="mr-2 font-normal text-gray-500 dark:text-gray-400">{STATUS_LABELS[row.status]}</span>
        </div>
        <div className="text-gray-600 dark:text-gray-300">{delegationScopeLabel(row.scope, row.scopeTitle)}</div>
        <div className="text-gray-500 dark:text-gray-400">از {formatPersianDate(row.startDate)} تا {formatPersianDate(row.endDate)}</div>
      </div>
      {given && live && (
        <button
          type="button"
          onClick={() => onRevoke(row.id)}
          disabled={revoking || !online}
          title={online ? undefined : OFFLINE_SUBMIT_TITLE}
          className={`px-3 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50 ${PHONE_TAP_TARGET}`}
        >
          لغو تفویض
        </button>
      )}
    </li>
  );
}

function DelegationList({ title, rows, given, onRevoke, revoking }: {
  title: string;
  rows: DelegationRow[];
  given: boolean;
  onRevoke: (id: number) => void;
  revoking: boolean;
}): React.ReactElement {
  return (
    <section className="space-y-2">
      <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300">{title}</h4>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-400">موردی نیست.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => <DelegationLine key={row.id} row={row} given={given} onRevoke={onRevoke} revoking={revoking} />)}
        </ul>
      )}
    </section>
  );
}

/**
 * v10.1.13 (D-06 part C, OBS-R2-73): «تفویض کارهایم» of the approval inbox. An approver gives a deputy for a period
 * (the server signs the deputy's actions in the delegator's name, TD-377) and sees «تفویض‌های من»: the delegations given,
 * with «لغو تفویض» for a live one, and those received. Shown by the keys of `POST /workflow/delegations`.
 */
export function MyDelegationsButton(): React.ReactElement | null {
  const canDelegate = useHasAnyPermission(WORKFLOW_DELEGATE_PERMISSIONS);
  const [open, setOpen] = useState(false);
  if (!canDelegate) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors shadow-sm ${PHONE_TAP_TARGET}`}
      >
        <UserCheck className="w-3.5 h-3.5" />
        <span>تفویض کارهایم</span>
      </button>
      {open && <MyDelegationsWindow onClose={() => setOpen(false)} />}
    </>
  );
}

function MyDelegationsWindow({ onClose }: { onClose: () => void }): React.ReactElement {
  const { user } = useAuth();
  const { data: rows = [], isLoading, isError } = useMyDelegationsQuery();
  const revokeMutation = useRevokeDelegationMutation();
  const given = rows.filter((r) => r.fromUserId === user?.id);
  const received = rows.filter((r) => r.toUserId === user?.id);

  const handleRevoke = async (id: number) => {
    if (await confirmAction({ title: 'لغو تفویض اختیار', message: 'این تفویض لغو شود؟ جانشین از این پس کارهای شما را نمی‌بیند.' })) {
      revokeMutation.mutate(id);
    }
  };

  return (
    <div className={PHONE_SHEET_OVERLAY} role="dialog" aria-modal="true" aria-label="تفویض کارهایم">
      <div className={`${PHONE_SHEET_PANEL} bg-white dark:bg-gray-800 shadow-xl border border-gray-200 dark:border-gray-700 sm:max-w-2xl`}>
        <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="font-bold text-sm text-gray-900 dark:text-white flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-indigo-600" />
            تفویض کارهایم
          </h3>
          <button type="button" onClick={onClose} aria-label="بستن" className={`p-2 text-gray-400 hover:text-gray-600 ${PHONE_TAP_TARGET}`}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <p className="text-xs text-gray-600 dark:text-gray-300">
            جانشین در بازه تفویض کارهای شما را در کارتابل خود می‌بیند و به نام شما انجام می‌دهد.
          </p>
          <DelegationForm currentUserId={user?.id} />
          <div className="space-y-4 border-t border-gray-100 dark:border-gray-700 pt-4">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">تفویض‌های من</h3>
            {isLoading ? (
              <p className="text-xs text-gray-500">در حال دریافت تفویض‌ها...</p>
            ) : isError ? (
              <p className="text-xs text-rose-600">تفویض‌های شما بارگذاری نشد.</p>
            ) : (
              <>
                <DelegationList title="تفویض‌هایی که داده‌ام" rows={given} given onRevoke={(id) => void handleRevoke(id)} revoking={revokeMutation.isPending} />
                <DelegationList title="تفویض‌هایی که به من داده‌اند" rows={received} given={false} onRevoke={() => undefined} revoking={false} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
