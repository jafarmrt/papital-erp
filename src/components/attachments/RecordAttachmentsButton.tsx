import { Paperclip } from 'lucide-react';
import { formatPersianNumber } from '../../utils';

/**
 * v11 «افزودن پیوست»: the button of a list row that opens the record's files window; with files it shows their number, with
 * none it offers to add one.
 */
export function RecordAttachmentsButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button type="button" onClick={e => { e.stopPropagation(); onClick(); }}
      className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
      <Paperclip size={11} />
      <span>{count > 0 ? `${formatPersianNumber(count)} ضمیمه` : 'افزودن پیوست'}</span>
    </button>
  );
}
