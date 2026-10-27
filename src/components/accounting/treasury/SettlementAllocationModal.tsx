import React, { useEffect, useMemo, useState } from 'react';
import { FileCheck2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { errorMessageOf, formatPersianCode } from '../../../utils';
import { rialDisplayOf } from '../../../lib/rialDisplay';
import {
  useReplaceSourceAllocations, useSettlementOptionsQuery, type SettlementSource,
} from '../../../hooks/accounting/useSettlementAllocations';
import {
  settlementPartsFor, settlementPartsProblem, type SettlementAllocationInput, type SettlementMode,
} from '../../../lib/treasury/settlementAllocation';
import { DialogLayer } from '../../common/DialogLayer';
import { SettlementAllocationList } from './SettlementAllocationField';

/** The recorded receipt, payment or cheque the window changes */
export interface SettlementWindowTarget extends SettlementSource {
  /** the treasury row's number or the cheque's number */
  number: string;
  amount: number;
  currency: string;
  /** «مشتری» or «تامین‌کننده» */
  partyLabel: string;
  partyName: string;
}

/**
 * v11 phase 6.1t (M11 / U2, decision ت۵۲-۵): «نشاندن روی فاکتورها» of a recorded receipt, payment or cheque. It opens on
 * the documents the source settles now (a direct link counts as one part) and saves the whole new set; an empty set puts
 * it all on account. The voucher does not change.
 */
export const SettlementAllocationModal: React.FC<{
  target: SettlementWindowTarget | null;
  appCurrency: string;
  onClose: () => void;
}> = ({ target, appCurrency, onClose }) => {
  const options = useSettlementOptionsQuery(target ? { source: { kind: target.kind, id: target.id } } : null);
  const replace = useReplaceSourceAllocations();
  const rial = useMemo(() => rialDisplayOf(appCurrency), [appCurrency]);
  const docs = useMemo(() => (Array.isArray(options.data) ? options.data : []), [options.data]);
  const [mode, setMode] = useState<SettlementMode>('manual');
  const [manual, setManual] = useState<SettlementAllocationInput[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const targetKey = target ? `${target.kind}-${target.id}` : null;

  // the window opens on what the source settles now, or on the default when it settles nothing yet
  useEffect(() => {
    if (!targetKey || options.isLoading || options.isError || loadedFor === targetKey) return;
    const current = docs.filter(d => d.allocatedHere > 0).map(d => ({ documentId: d.id, amount: d.allocatedHere }));
    setMode(current.length > 0 ? 'manual' : 'oldest');
    setManual(current);
    setLoadedFor(targetKey);
  }, [targetKey, docs, options.isLoading, options.isError, loadedFor]);

  if (!target) return null;
  const ready = loadedFor === targetKey;
  const parts = settlementPartsFor(mode, docs, target.amount, manual);
  const problem = settlementPartsProblem(parts, target.amount, docs);

  const close = () => { setLoadedFor(null); onClose(); };
  const save = async () => {
    if (problem) {
      toast.error(problem);
      return;
    }
    try {
      await replace.mutateAsync({ source: { kind: target.kind, id: target.id }, allocations: parts });
      toast.success(parts.length > 0 ? 'سهم فاکتورها ذخیره شد.' : 'همه مبلغ علی‌الحساب شد.');
      close();
    } catch (err) {
      toast.error(errorMessageOf(err) || 'سهم فاکتورها ذخیره نشد.');
    }
  };

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <DialogLayer onClose={close} disabled={replace.isPending} />
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-xl w-full max-h-[85vh] flex flex-col border border-slate-200 dark:border-slate-700">
        <div className="p-5 border-b border-slate-100 dark:border-slate-700">
          <h3 className="font-bold text-emerald-700 dark:text-emerald-300 text-base flex items-center gap-2">
            <FileCheck2 size={18} />
            نشاندن روی فاکتورها
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-6">
            {target.kind === 'cheque' ? 'چک' : 'تراکنش'} «<span className="font-mono font-bold">{formatPersianCode(target.number)}</span>» از{' '}
            {target.partyName} به مبلغ <span className="font-bold">{rial.money(target.amount, target.currency)}</span>. مانده فاکتورها با
            سهم هر کدام کم می‌شود و هر چه بماند علی‌الحساب است؛ سند حسابداری تغییر نمی‌کند.
          </p>
        </div>
        <div className="p-5 overflow-y-auto flex-1">
          <SettlementAllocationList
            docs={docs}
            isLoading={options.isLoading || (!ready && !options.isError)}
            isError={options.isError}
            amount={target.amount}
            currency={target.currency}
            appCurrency={appCurrency}
            mode={mode}
            manual={manual}
            onModeChange={(next, nextManual) => { setMode(next); setManual(nextManual); }}
            onManualChange={setManual}
            partyLabel={target.partyLabel}
            disabled={replace.isPending}
          />
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-slate-100 dark:border-slate-700">
          <button type="button" onClick={close} disabled={replace.isPending}
            className="px-4 py-2 text-xs font-bold border border-slate-200 dark:border-slate-600 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer disabled:opacity-50">
            انصراف
          </button>
          <button type="button" onClick={() => { void save(); }} disabled={replace.isPending || !ready || Boolean(problem)}
            className="px-4 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition-colors cursor-pointer disabled:opacity-50">
            {replace.isPending ? 'در حال ذخیره…' : 'ذخیره سهم فاکتورها'}
          </button>
        </div>
      </div>
    </div>
  );
};
