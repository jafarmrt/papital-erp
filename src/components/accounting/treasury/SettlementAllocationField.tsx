import React, { useEffect, useMemo, useState } from 'react';
import { FileCheck2 } from 'lucide-react';
import { HelpBadge } from '../../common/HelpBadge';
import { FinancialAmountInput } from '../../common/FinancialAmountInput';
import { formatPersianCode, formatPersianDate } from '../../../utils';
import { rialDisplayOf } from '../../../lib/rialDisplay';
import { fin } from '../../../lib/financialDecimal';
import { useSettlementOptionsQuery, type SettlementOptionsQuery } from '../../../hooks/accounting/useSettlementAllocations';
import {
  allocationTotal, settlementPartsFor, settlementPartsProblem, settlementRoom, SETTLEMENT_DOCUMENT_TYPE_LABELS,
  type OpenSettlementDocument, type SettlementAllocationInput, type SettlementMode,
} from '../../../lib/treasury/settlementAllocation';

/**
 * v11 phase 6.1t (M11 / U2, decision ت۵۲-۵): which open documents of the party a receipt, payment or cheque settles.
 * The default puts it on the oldest first; the user may pick documents and amounts, or keep it all on account.
 */

const MODE_LABELS: ReadonlyArray<{ mode: SettlementMode; label: string }> = [
  { mode: 'oldest', label: 'قدیمی‌ترین اول' },
  { mode: 'manual', label: 'انتخاب سندها' },
  { mode: 'none', label: 'همه علی‌الحساب' },
];

export interface SettlementAllocationListProps {
  docs: OpenSettlementDocument[];
  isLoading: boolean;
  isError: boolean;
  amount: number;
  currency: string;
  appCurrency: string;
  mode: SettlementMode;
  manual: SettlementAllocationInput[];
  onModeChange: (mode: SettlementMode, manual: SettlementAllocationInput[]) => void;
  onManualChange: (manual: SettlementAllocationInput[]) => void;
  /** «مشتری» or «تامین‌کننده», for the empty list */
  partyLabel: string;
  disabled?: boolean;
}

/** The list of open documents with the part of each; the form and the window of a recorded receipt share it */
export const SettlementAllocationList: React.FC<SettlementAllocationListProps> = ({
  docs, isLoading, isError, amount, currency, appCurrency, mode, manual, onModeChange, onManualChange, partyLabel, disabled,
}) => {
  const rial = useMemo(() => rialDisplayOf(appCurrency), [appCurrency]);
  const parts = settlementPartsFor(mode, docs, amount, manual);
  const partOf = new Map(parts.map(p => [p.documentId, p.amount]));
  const total = allocationTotal(parts);
  const onAccount = fin(amount || 0).subtract(total);
  const problem = settlementPartsProblem(parts, amount, docs);

  const toggle = (doc: OpenSettlementDocument, checked: boolean) => {
    if (!checked) {
      onManualChange(manual.filter(p => p.documentId !== doc.id));
      return;
    }
    // a ticked document takes what is left of the amount, up to what it can take
    const left = fin(amount || 0).subtract(allocationTotal(manual.filter(p => p.documentId !== doc.id)));
    const room = fin(settlementRoom(doc));
    const part = left.greaterThan(room) ? room : left;
    onManualChange([...manual.filter(p => p.documentId !== doc.id), { documentId: doc.id, amount: part.isPositive() ? part.toNumber() : 0 }]);
  };
  const setPart = (docId: number, value: number) =>
    onManualChange(manual.map(p => (p.documentId === docId ? { ...p, amount: value } : p)));

  return (
    <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-900/10 p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-800 dark:text-emerald-300">
          <FileCheck2 size={14} />
          نشاندن روی فاکتورها
          <HelpBadge text="مبلغ روی فاکتورهای باز همین طرف حساب می‌نشیند و مانده آن‌ها کم می‌شود. پیش‌فرض: قدیمی‌ترین فاکتور اول. هر چه از مبلغ بماند علی‌الحساب می‌ماند. سند حسابداری تغییر نمی‌کند." />
        </span>
        <div role="radiogroup" aria-label="روش نشاندن" className="inline-flex rounded-lg border border-emerald-200 dark:border-emerald-800 overflow-hidden">
          {MODE_LABELS.map(m => (
            <button
              key={m.mode}
              type="button"
              role="radio"
              aria-checked={mode === m.mode}
              disabled={disabled}
              onClick={() => onModeChange(m.mode, m.mode === 'manual' && mode !== 'manual' ? parts : manual)}
              className={`px-2.5 py-1 text-[11px] font-bold transition cursor-pointer disabled:opacity-50 ${
                mode === m.mode
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-emerald-50 dark:hover:bg-slate-700'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {mode === 'none' ? (
        <p className="text-[11px] text-slate-600 dark:text-slate-300">همه مبلغ علی‌الحساب می‌ماند و مانده هیچ فاکتوری کم نمی‌شود.</p>
      ) : isLoading ? (
        <p className="text-[11px] text-slate-500">در حال خواندن فاکتورهای باز…</p>
      ) : isError ? (
        <p className="text-[11px] font-bold text-rose-600 dark:text-rose-400">فاکتورهای باز خوانده نشد؛ پنجره را دوباره باز کنید یا «همه علی‌الحساب» را انتخاب کنید.</p>
      ) : docs.length === 0 ? (
        <p className="text-[11px] text-slate-600 dark:text-slate-300">فاکتور بازی از این {partyLabel} با همین ارز نیست؛ مبلغ علی‌الحساب می‌ماند.</p>
      ) : (
        <ul className="space-y-1.5 max-h-56 overflow-y-auto">
          {docs.map(doc => {
            const part = partOf.get(doc.id);
            const ticked = mode === 'manual' ? manual.some(p => p.documentId === doc.id) : part !== undefined;
            return (
              <li key={doc.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white/80 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 px-2.5 py-1.5">
                {mode === 'manual' && (
                  <input
                    type="checkbox"
                    aria-label={`سند ${formatPersianCode(doc.refNumber)}`}
                    checked={ticked}
                    disabled={disabled}
                    onChange={e => toggle(doc, e.target.checked)}
                    className="w-4 h-4 text-emerald-600 rounded border-slate-300"
                  />
                )}
                <span className="text-[11px] font-bold text-slate-800 dark:text-slate-100">
                  {SETTLEMENT_DOCUMENT_TYPE_LABELS[doc.type] ?? 'سند'} {formatPersianCode(doc.refNumber)}
                </span>
                <span className="text-[10px] text-slate-500">{doc.date ? formatPersianDate(doc.date) : '—'}</span>
                <span className="text-[10px] text-slate-500">
                  مانده: {rial.money(settlementRoom(doc), currency)}
                </span>
                <span className="ms-auto">
                  {mode === 'manual' && ticked ? (
                    <FinancialAmountInput
                      variant="compact"
                      value={manual.find(p => p.documentId === doc.id)?.amount ?? 0}
                      currency={currency}
                      min={0}
                      disabled={disabled}
                      onChange={val => setPart(doc.id, val)}
                      containerClassName="w-40"
                    />
                  ) : part !== undefined ? (
                    <span className="text-[11px] font-black text-emerald-700 dark:text-emerald-300">{rial.money(part, currency)}</span>
                  ) : (
                    <span className="text-[10px] text-slate-400">—</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {mode !== 'none' && !isLoading && !isError && docs.length > 0 && (
        <p className="text-[11px] text-slate-700 dark:text-slate-200">
          روی فاکتورها: <span className="font-bold">{rial.money(total, currency)}</span>
          {' • '}
          علی‌الحساب: <span className="font-bold">{rial.money(onAccount.isPositive() ? onAccount.toNumber() : 0, currency)}</span>
        </p>
      )}
      {problem && <p className="text-[11px] font-bold text-rose-600 dark:text-rose-400">{problem}</p>}
    </div>
  );
};

/** What the form sends, and why it must not be sent yet */
export interface SettlementFieldState {
  parts: SettlementAllocationInput[];
  problem: string | null;
}

/**
 * The field of the new receipt, payment and cheque forms. It reports the parts on every change; a list still loading,
 * or one that failed while documents are wanted, holds the form back so a receipt is not put on account by accident.
 */
export const SettlementAllocationField: React.FC<{
  query: SettlementOptionsQuery;
  amount: number;
  currency: string;
  appCurrency: string;
  partyLabel: string;
  onChange: (state: SettlementFieldState) => void;
  disabled?: boolean;
}> = ({ query, amount, currency, appCurrency, partyLabel, onChange, disabled }) => {
  const options = useSettlementOptionsQuery(query);
  const docs = useMemo(() => (Array.isArray(options.data) ? options.data : []), [options.data]);
  const [mode, setMode] = useState<SettlementMode>('oldest');
  const [manual, setManual] = useState<SettlementAllocationInput[]>([]);

  useEffect(() => {
    const parts = settlementPartsFor(mode, docs, amount, manual);
    const problem = mode === 'none'
      ? null
      : options.isLoading
        ? 'فاکتورهای باز هنوز خوانده می‌شود؛ چند لحظه بعد ثبت کنید.'
        : options.isError
          ? 'فاکتورهای باز خوانده نشد؛ برای ثبت علی‌الحساب «همه علی‌الحساب» را انتخاب کنید.'
          : settlementPartsProblem(parts, amount, docs);
    onChange({ parts, problem });
  }, [mode, manual, docs, amount, options.isLoading, options.isError, onChange]);

  return (
    <SettlementAllocationList
      docs={docs}
      isLoading={options.isLoading}
      isError={options.isError}
      amount={amount}
      currency={currency}
      appCurrency={appCurrency}
      mode={mode}
      manual={manual}
      onModeChange={(next, nextManual) => { setMode(next); setManual(nextManual); }}
      onManualChange={setManual}
      partyLabel={partyLabel}
      disabled={disabled}
    />
  );
};
