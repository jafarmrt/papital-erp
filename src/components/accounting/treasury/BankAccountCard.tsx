import React from 'react';
import { 
  Building2, 
  Wallet, 
  CreditCard, 
  Copy, 
  Check, 
  Trash2, 
  Edit3, 
  ShieldCheck, 
  AlertTriangle, 
  CheckCircle2, 
  Layers 
} from 'lucide-react';
import { formatPersianPrice, formatCurrencyLabel, formatBankCard, formatIranianSheba } from '../../../utils';
import { ActionMenu } from '../../ActionMenu';
import type { BankAccount } from '../../../types';

interface BankAccountCardProps {
  bank: BankAccount;
  appCurrency: string;
  copiedId: string | null;
  onCopy: (text: string, id: string) => void;
  onEdit: (bank: BankAccount) => void;
  onDelete: (id: number, title: string) => void;
  onReconcile: (bankId: number) => void;
}

export const BankAccountCard: React.FC<BankAccountCardProps> = React.memo(({
  bank,
  appCurrency,
  copiedId,
  onCopy,
  onEdit,
  onDelete,
  onReconcile,
}) => {
  const isBank = bank.type === 'bank';
  const isPos = bank.type === 'pos';
  const isSynced = bank.syncStatus === 'synced';
  const isDiscrepant = bank.syncStatus === 'discrepant';

  return (
    <div
      className={`bg-white dark:bg-slate-800 p-5 rounded-2xl border shadow-sm relative overflow-hidden flex flex-col justify-between transition hover:shadow-md ${
        isDiscrepant
          ? 'border-amber-300 dark:border-amber-700/80 ring-1 ring-amber-400/20'
          : 'border-slate-200/80 dark:border-slate-700/80'
      }`}
    >
      <div>
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                isBank
                  ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400'
                  : isPos
                  ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400'
                  : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400'
              }`}
            >
              {isBank ? <Building2 className="w-5 h-5" /> : isPos ? <CreditCard className="w-5 h-5" /> : <Wallet className="w-5 h-5" />}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                  {bank.title}
                </h4>
                <span className="text-[10px] font-mono text-slate-400 bg-slate-100 dark:bg-slate-700/60 px-1.5 py-0.5 rounded">
                  {bank.code}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {bank.bankName ? `${bank.bankName} ${bank.branch ? `(${bank.branch})` : ''}` : (bank.type === 'cash' ? 'صندوق نقد' : 'دستگاه کارتخوان')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => onEdit(bank)}
              title="ویرایش حساب و کد معین"
              className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition cursor-pointer"
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>
            <ActionMenu
              items={[
                {
                  label: 'مغایرت‌گیری و تطبیق بانکی',
                  icon: ShieldCheck,
                  onClick: () => onReconcile(bank.id),
                },
                ...(bank.accountNumber
                  ? [
                      {
                        label: 'کپی شماره حساب',
                        icon: Copy,
                        onClick: () => onCopy(bank.accountNumber || '', `acc-${bank.id}`),
                      },
                    ]
                  : []),
                ...(bank.shebaNumber
                  ? [
                      {
                        label: 'کپی شماره شبا',
                        icon: Copy,
                        onClick: () => onCopy(bank.shebaNumber || '', `sheba-${bank.id}`),
                      },
                    ]
                  : []),
                {
                  label: 'حذف حساب',
                  icon: Trash2,
                  variant: 'danger',
                  onClick: () => onDelete(bank.id, bank.title),
                },
              ]}
              align="left"
            />
          </div>
        </div>

        {/* Sync Badge */}
        <div className="mb-3">
          {isSynced && (
            <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-lg border border-emerald-200/60 dark:border-emerald-800/40">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span>تراز ۱۰۰٪ با اسناد دوبل حسابداری</span>
            </div>
          )}
          {isDiscrepant && (
            <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1 rounded-lg border border-amber-200/60 dark:border-amber-800/40">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>مغایرت دفتری: {formatPersianPrice(bank.discrepancy || 0, bank.currency || appCurrency)}</span>
            </div>
          )}
          {bank.syncStatus === 'unlinked' && (
            <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 px-2.5 py-1 rounded-lg">
              <Layers className="w-3.5 h-3.5 shrink-0" />
              <span>فاقد اتصال به سرفصل کدینگ</span>
            </div>
          )}
        </div>

        {/* Main Real-time Dynamic Balance */}
        <div className="my-2 p-3 bg-slate-50 dark:bg-slate-700/40 rounded-xl border border-slate-100 dark:border-slate-700/60">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">مانده همگام لحظه‌ای:</span>
            <span className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold">
              {bank.accountName ? `متصل به: ${bank.accountName}` : 'کد معین اختصاصی'}
            </span>
          </div>
          <div className="text-xl font-black text-slate-900 dark:text-white font-mono mt-1">
            {formatPersianPrice(bank.currentBalance || 0)} <span className="text-xs font-normal text-slate-500">{formatCurrencyLabel(bank.currency || appCurrency)}</span>
          </div>
        </div>

        {/* Sub-Ledger & Treasury Breakdown */}
        <div className="grid grid-cols-2 gap-2 my-2 text-[11px]">
          <div className="p-2 bg-slate-50/70 dark:bg-slate-700/20 rounded-lg">
            <span className="text-slate-400 block text-[10px]">مانده اسناد دوبل:</span>
            <span className="font-bold text-slate-700 dark:text-slate-200 font-mono">
              {formatPersianPrice(bank.ledgerBalance ?? bank.currentBalance ?? 0)}
            </span>
          </div>
          <div className="p-2 bg-slate-50/70 dark:bg-slate-700/20 rounded-lg">
            <span className="text-slate-400 block text-[10px]">گردش خزانه‌داری:</span>
            <span className="font-bold text-slate-700 dark:text-slate-200 font-mono">
              {formatPersianPrice(bank.treasuryBalance ?? bank.currentBalance ?? 0)}
            </span>
          </div>
        </div>

        {/* Turnover Details */}
        <div className="flex items-center justify-between text-[10px] text-slate-500 px-1 py-1 border-t border-slate-100 dark:border-slate-700/60">
          <span>گردش بدهکار اسناد: <strong className="text-emerald-600 font-mono">{formatPersianPrice(bank.totalDebit || 0)}</strong></span>
          <span>گردش بستانکار اسناد: <strong className="text-rose-600 font-mono">{formatPersianPrice(bank.totalCredit || 0)}</strong></span>
        </div>

        {/* Bank Card / Sheba Info */}
        <div className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300 mt-2">
          {bank.cardNumber && (
            <div className="flex items-center justify-between bg-slate-50/60 dark:bg-slate-700/20 px-2 py-1 rounded">
              <span className="text-slate-400 text-[11px]">شماره کارت:</span>
              <div className="flex items-center gap-1.5 font-mono">
                <span dir="ltr">{formatBankCard(bank.cardNumber)}</span>
                <button
                  onClick={() => onCopy(bank.cardNumber || '', `card-${bank.id}`)}
                  className="text-slate-400 hover:text-indigo-600 cursor-pointer"
                  title="کپی شماره کارت"
                >
                  {copiedId === `card-${bank.id}` ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
            </div>
          )}

          {bank.shebaNumber && (
            <div className="flex items-center justify-between bg-slate-50/60 dark:bg-slate-700/20 px-2 py-1 rounded">
              <span className="text-slate-400 text-[11px]">شماره شبا:</span>
              <div className="flex items-center gap-1.5 font-mono text-[11px]">
                <span dir="ltr">{formatIranianSheba(bank.shebaNumber)}</span>
                <button
                  onClick={() => onCopy(bank.shebaNumber || '', `sheba-${bank.id}`)}
                  className="text-slate-400 hover:text-indigo-600 cursor-pointer"
                  title="کپی شماره شبا"
                >
                  {copiedId === `sheba-${bank.id}` ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

BankAccountCard.displayName = 'BankAccountCard';
