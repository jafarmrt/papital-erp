import { Power } from 'lucide-react';
import type { Account } from '../../types';
import { accountActiveAction } from '../../lib/accounting/accountDeleteText';

/** v10.0.49 (TD-1123): دکمه غیرفعال یا فعال کردن دوباره حساب در درخت و جدول سرفصل‌ها */
export function AccountActiveToggle({ account, onToggle, small }: {
  account: Account;
  onToggle: (account: Account, next: boolean) => void;
  small?: boolean;
}) {
  const action = accountActiveAction(account);
  if (!action) return null;
  return (
    <button
      onClick={() => onToggle(account, action.next)}
      title={action.label}
      aria-label={action.label}
      className={`p-1 rounded transition ${action.next ? 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
    >
      <Power className={small ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
    </button>
  );
}

/** نشان «غیرفعال» کنار نام حساب */
export function InactiveAccountBadge({ account }: { account: Pick<Account, 'isActive'> }) {
  if (account.isActive === undefined || account.isActive === null || Boolean(account.isActive)) return null;
  return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300">غیرفعال</span>;
}
