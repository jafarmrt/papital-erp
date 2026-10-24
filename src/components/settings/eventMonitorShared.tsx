import { Zap, Package, FileText, GitBranch, CreditCard } from 'lucide-react';
import { errorMessageOf } from '../../utils';

/** 10.3 (ARCH review): a read the server refused says why, never a zero count or «nothing found» */
export const READ_FAILED_CLASS = 'p-3 rounded-xl border border-rose-200 bg-rose-50 text-xs text-rose-700 dark:bg-rose-950/40 dark:border-rose-800/50 dark:text-rose-300';
export const readFailure = (err: unknown, fallback: string) => (err ? errorMessageOf(err) || fallback : '');
/** a count shows «—» until it is read, never a zero that was not read */
export const countOf = (read: boolean, n: number) => (read ? n.toLocaleString('fa-IR') : '—');

export const KPI_CARD_CLASS = 'bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm';
export const TOOLBAR_CLASS = 'flex flex-col md:flex-row items-center justify-between gap-3 bg-white dark:bg-slate-800 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm';
export const FILTER_SELECT_CLASS = 'text-xs bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 rounded-lg px-3 py-1.5 focus:outline-none';
export const SEARCH_INPUT_CLASS = 'w-full text-xs pr-8 pl-3 py-1.5 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-700 dark:text-slate-200 focus:outline-none';
export const LIST_NOTE_CLASS = 'p-8 text-center text-slate-400 text-xs';

/** The icon of an event row in the outbox and the live events lists */
export function EventIcon({ type, aggregate }: { type: string; aggregate: string }) {
  if (aggregate === 'Document' || type.includes('Invoice') || type.includes('Purchase')) return <FileText className="w-4 h-4 text-blue-500" />;
  if (aggregate === 'Item' || type.includes('Stock')) return <Package className="w-4 h-4 text-emerald-500" />;
  if (aggregate === 'Workflow' || type.includes('Workflow')) return <GitBranch className="w-4 h-4 text-indigo-500" />;
  if (aggregate === 'Treasury' || type.includes('Payment') || type.includes('Cheque')) return <CreditCard className="w-4 h-4 text-amber-500" />;
  return <Zap className="w-4 h-4 text-purple-500" />;
}
