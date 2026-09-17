import { BookOpen } from 'lucide-react';
import { formatPersianPrice, formatPersianNumber, formatPersianDate } from '../../../utils';

interface JournalBookViewProps {
  journalLoading: boolean;
  journalBookData: any;
  onFetchJournalBook: () => void;
}

export function JournalBookView({
  journalLoading,
  journalBookData,
  onFetchJournalBook
}: JournalBookViewProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm no-print">
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-indigo-600" />
          <div>
            <h4 className="font-bold text-slate-900 dark:text-white text-sm">دفتر روزنامه قانونی و رسمی</h4>
            <p className="text-xs text-slate-500">ثبت متوالی آرتیکل‌های اسناد حسابداری تاییدشده به ترتیب تاریخ و شماره سند</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onFetchJournalBook}
            className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg transition"
          >
            به‌روزرسانی دفتر
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-300">
                <th className="py-2.5 px-3 w-12 text-center border-l border-slate-200 dark:border-slate-700">ردیف</th>
                <th className="py-2.5 px-3 w-24 text-center border-l border-slate-200 dark:border-slate-700">تاریخ سند</th>
                <th className="py-2.5 px-3 w-20 text-center border-l border-slate-200 dark:border-slate-700">شماره سند</th>
                <th className="py-2.5 px-3 w-28 text-center border-l border-slate-200 dark:border-slate-700">کد حساب</th>
                <th className="py-2.5 px-4 border-l border-slate-200 dark:border-slate-700">عنوان حساب و تفصیلی</th>
                <th className="py-2.5 px-4 border-l border-slate-200 dark:border-slate-700">شرح آرتیکل</th>
                <th className="py-2.5 px-3 w-32 text-left border-l border-slate-200 dark:border-slate-700">بدهکار</th>
                <th className="py-2.5 px-3 w-32 text-left border-l border-slate-200 dark:border-slate-700">بستانکار</th>
                <th className="py-2.5 px-3 w-32 text-left">مانده تجمعی</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {journalLoading ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-slate-400">در حال بارگذاری دفتر روزنامه...</td>
                </tr>
              ) : !journalBookData?.items || journalBookData.items.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-slate-400">سندی در این بازه ثبت نشده است</td>
                </tr>
              ) : (
                journalBookData.items.map((item: any) => (
                  <tr key={`${item.voucherId}-${item.rowNumber}`} className="hover:bg-slate-50/70 dark:hover:bg-slate-750">
                    <td className="py-2 px-3 text-center border-l border-slate-200 dark:border-slate-700 font-mono text-slate-400">
                      {formatPersianNumber(item.rowNumber)}
                    </td>
                    <td className="py-2 px-3 text-center border-l border-slate-200 dark:border-slate-700 font-mono">
                      {formatPersianDate(item.date)}
                    </td>
                    <td className="py-2 px-3 text-center border-l border-slate-200 dark:border-slate-700 font-mono font-bold text-indigo-600">
                      #{item.voucherNumber}
                    </td>
                    <td className="py-2 px-3 text-center border-l border-slate-200 dark:border-slate-700 font-mono">
                      {item.accountCode}
                    </td>
                    <td className="py-2 px-4 border-l border-slate-200 dark:border-slate-700">
                      <div className="font-semibold text-slate-800 dark:text-slate-200">{item.accountName}</div>
                      {item.detailedName && (
                        <div className="text-[11px] text-purple-600 dark:text-purple-400">↳ {item.detailedName}</div>
                      )}
                    </td>
                    <td className="py-2 px-4 border-l border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                      {item.description}
                    </td>
                    <td className="py-2 px-3 text-left border-l border-slate-200 dark:border-slate-700 font-mono font-bold text-emerald-600">
                      {item.debit ? formatPersianPrice(item.debit) : '-'}
                    </td>
                    <td className="py-2 px-3 text-left border-l border-slate-200 dark:border-slate-700 font-mono font-bold text-rose-600">
                      {item.credit ? formatPersianPrice(item.credit) : '-'}
                    </td>
                    <td className="py-2 px-3 text-left font-mono font-bold text-slate-700 dark:text-slate-300">
                      {formatPersianPrice(item.runningBalance)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {journalBookData?.items && journalBookData.items.length > 0 && (
              <tfoot>
                <tr className="bg-slate-100 dark:bg-slate-700/80 font-black text-slate-900 dark:text-white border-t-2 border-slate-300 dark:border-slate-600">
                  <td colSpan={6} className="py-3 px-4 text-center border-l border-slate-300 dark:border-slate-600">
                    جمع کل دفتر روزنامه ({formatPersianNumber(journalBookData.vouchersCount)} سند)
                  </td>
                  <td className="py-3 px-3 text-left border-l border-slate-300 dark:border-slate-600 font-mono text-emerald-700 dark:text-emerald-300">
                    {formatPersianPrice(journalBookData.totalDebit)}
                  </td>
                  <td className="py-3 px-3 text-left border-l border-slate-300 dark:border-slate-600 font-mono text-rose-700 dark:text-rose-300">
                    {formatPersianPrice(journalBookData.totalCredit)}
                  </td>
                  <td className="py-3 px-3 text-left font-mono">
                    {journalBookData.isBalanced ? 'تراز' : 'مغایرت'}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
