import React from 'react';
import { Plus } from 'lucide-react';
import { BankAccountCard } from './BankAccountCard';
import type { BankAccount } from '../../../types';

interface BankAccountGridProps {
  bankAccounts: BankAccount[];
  appCurrency: string;
  copiedId: string | null;
  onCopy: (text: string, id: string) => void;
  onEdit: (bank: BankAccount) => void;
  onDelete: (id: number, title: string) => void;
  onReconcile: (bankId: number) => void;
  onNewAccount: () => void;
}

export const BankAccountGrid: React.FC<BankAccountGridProps> = React.memo(({
  bankAccounts,
  appCurrency,
  copiedId,
  onCopy,
  onEdit,
  onDelete,
  onReconcile,
  onNewAccount,
}) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {bankAccounts.map(b => (
        <BankAccountCard
          key={b.id}
          bank={b}
          appCurrency={appCurrency}
          copiedId={copiedId}
          onCopy={onCopy}
          onEdit={onEdit}
          onDelete={onDelete}
          onReconcile={onReconcile}
        />
      ))}

      {/* Add New Bank Account Card Trigger */}
      <button
        type="button"
        onClick={onNewAccount}
        className="border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-500 rounded-2xl p-6 flex flex-col items-center justify-center gap-2 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition bg-slate-50/40 dark:bg-slate-800/40 hover:bg-indigo-50/20 dark:hover:bg-indigo-950/20 group cursor-pointer min-h-[180px]"
      >
        <div className="w-12 h-12 rounded-2xl bg-white dark:bg-slate-700 shadow-sm flex items-center justify-center group-hover:scale-110 transition border border-slate-200 dark:border-slate-600">
          <Plus className="w-6 h-6 text-slate-400 group-hover:text-indigo-600" />
        </div>
        <span className="font-bold text-sm text-slate-600 dark:text-slate-300">تعریف حساب / صندوق جدید</span>
        <span className="text-xs text-slate-400">بانک، صندوق نقد یا کارتخوان</span>
      </button>
    </div>
  );
});

BankAccountGrid.displayName = 'BankAccountGrid';
