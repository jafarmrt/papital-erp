import { formatPersianPrice, formatPersianNumber, formatPersianDate, financialAmountToPersianWords, formatCurrencyLabel } from '../../utils';
import { PrintModal } from '../common/PrintModal';
import type { JournalVoucher } from '../../types';
import { voucherTypeLabel } from '../../lib/accounting/voucherTypes';
import { voucherPrintAmounts, type VoucherPrintRowAmounts } from '../../lib/accounting/voucherPrintAmounts';
import { voucherMakerName } from '../../lib/accounting/voucherListViewer';

interface VoucherPrintModalProps {
  voucher: JournalVoucher | null;
  isOpen: boolean;
  onClose: () => void;
  companyName?: string;
  companyLogo?: string;
}

export function VoucherPrintModal({
  voucher,
  isOpen,
  onClose,
  companyName = 'کارگاه تولیدی و انبار پاپیتال',
  companyLogo,
}: VoucherPrintModalProps) {
  if (!isOpen || !voucher) return null;

  // v9.0.195 (TD-573): ستون‌ها، جمع‌ها و مبلغ به حروف در ارز سند تک‌ارز، و سند چندارزی به ریال با مبلغ ارزی هر ردیف
  const amounts = voucherPrintAmounts(voucher.items, voucher.currency);
  const { totalDebit, totalCredit } = amounts;
  const currencyLabel = formatCurrencyLabel(amounts.currency);
  const decimals = amounts.currency === 'IRR' ? 0 : 2;
  const money = (value: number) => formatPersianPrice(value, undefined, decimals);
  const typeLabel = voucherTypeLabel(voucher.voucherType);

  return (
    <PrintModal
      id="voucher-print-modal"
      isOpen={isOpen}
      onClose={onClose}
      title={`پیش‌نمایش چاپی سند حسابداری #${formatPersianNumber(voucher.voucherNumber)}`}
      subtitle={`نوع سند: ${typeLabel}`}
      printButtonText="چاپ سند حسابداری"
      size="3xl"
      showSignatures={false}
    >
      <div className="bg-white text-slate-900 w-full p-4 sm:p-6 rounded-lg shadow-xs border border-slate-300 print:shadow-none print:border-none print:p-0 print:m-0 print:w-full">
        {/* Document Header */}
        <div className="border-b-2 border-slate-900 pb-4 mb-4">
          <div className="flex items-center justify-between">
            <div className="w-1/4">
              {companyLogo ? (
                <img src={companyLogo} alt="Logo" className="max-h-12 object-contain" />
              ) : (
                <div className="text-xs font-bold text-slate-500">{companyName}</div>
              )}
            </div>

            <div className="w-2/4 text-center">
              <h1 className="text-lg font-black tracking-tight">{companyName}</h1>
              <h2 className="text-base font-bold mt-1 text-slate-700">سند حسابداری</h2>
              <div className="text-[11px] text-slate-500 mt-0.5">نوع سند: {typeLabel}</div>
              {amounts.rate !== null && (
                <div className="text-[11px] text-slate-500 mt-0.5">ارز سند: {currencyLabel}، نرخ هر {currencyLabel} {formatPersianPrice(amounts.rate)} ریال</div>
              )}
              {amounts.inRial && (
                <div className="text-[11px] text-slate-500 mt-0.5">سند چندارزی؛ مبلغ‌ها به ریال با نرخ هر ردیف</div>
              )}
            </div>

            <div className="w-1/4 text-left font-mono text-xs space-y-1 text-slate-700">
              <div>شماره سند: <strong className="font-black text-sm">{formatPersianNumber(voucher.voucherNumber)}</strong></div>
              <div>تاریخ سند: <span>{formatPersianDate(voucher.date)}</span></div>
              {voucher.manualVoucherNumber && (
                <div>عطف دستی: <span>{voucher.manualVoucherNumber}</span></div>
              )}
            </div>
          </div>
        </div>

        {/* Voucher Description */}
        <div className="bg-slate-50 border border-slate-300 rounded p-2.5 mb-4 text-xs font-medium leading-relaxed">
          <span className="font-bold ml-1">شرح کلی سند:</span>
          {voucher.description}
        </div>

        {/* Articles Table */}
        <div className="overflow-x-auto mb-6">
          <table className="w-full text-xs text-right border-collapse border border-slate-400">
            <thead>
              <tr className="bg-slate-100 font-bold border-b border-slate-400">
                <th className="border border-slate-300 p-2 text-center w-12">ردیف</th>
                <th className="border border-slate-300 p-2 w-32">کد معین/تفصیلی</th>
                <th className="border border-slate-300 p-2">عنوان حساب / شرح ردیف</th>
                <th className="border border-slate-300 p-2 text-left w-36">بدهکار ({currencyLabel})</th>
                <th className="border border-slate-300 p-2 text-left w-36">بستانکار ({currencyLabel})</th>
              </tr>
            </thead>
            <tbody>
              {(voucher.items || []).map((item, idx) => (
                <tr key={idx} className="border-b border-slate-200">
                  <td className="border border-slate-300 p-2 text-center font-mono">{idx + 1}</td>
                  <td className="border border-slate-300 p-2 font-mono text-[11px] text-slate-600">
                    <div>{item.accountCode || '---'}</div>
                    {item.detailedName && <div className="text-[10px] text-slate-400">شناسه: {item.detailedId || '---'}</div>}
                  </td>
                  <td className="border border-slate-300 p-2">
                    <div className="font-bold text-slate-800">{item.accountName}</div>
                    {item.detailedName && <div className="text-[11px] text-indigo-700">{item.detailedName}</div>}
                    <div className="text-[11px] text-slate-500 mt-0.5">{item.description}</div>
                  </td>
                  <VoucherPrintAmountCell row={amounts.rows[idx]} side="debit" money={money} />
                  <VoucherPrintAmountCell row={amounts.rows[idx]} side="credit" money={money} />
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100 font-bold border-t-2 border-slate-400">
                <td colSpan={3} className="border border-slate-300 p-2 text-center font-black">
                  جمع کل سند
                </td>
                <td className="border border-slate-300 p-2 text-left font-mono text-sm text-indigo-900 font-black">
                  {money(totalDebit)}
                </td>
                <td className="border border-slate-300 p-2 text-left font-mono text-sm text-indigo-900 font-black">
                  {money(totalCredit)}
                </td>
              </tr>
              {totalDebit > 0 && (
                <tr className="bg-slate-50/70 border-t border-slate-300">
                  <td colSpan={5} className="border border-slate-300 p-2 text-right text-xs">
                    <span className="font-bold text-slate-700">مبلغ سند به حروف: </span>
                    <span className="font-bold text-indigo-900">
                      {financialAmountToPersianWords(totalDebit, amounts.currency).fullDescription}
                    </span>
                  </td>
                </tr>
              )}
              {amounts.rowsWithoutRate.length > 0 && (
                <tr>
                  <td colSpan={5} className="border border-slate-300 p-2 text-right text-xs font-bold text-rose-700">
                    ردیف {amounts.rowsWithoutRate.map(n => formatPersianNumber(n)).join('، ')} نرخ تبدیل ندارد و در جمع ریالی نیامده است.
                  </td>
                </tr>
              )}
            </tfoot>
          </table>
        </div>

        {/* Verification Signatures */}
        <div className="grid grid-cols-4 gap-4 text-center text-xs pt-4 border-t border-slate-300">
          <div className="border border-slate-200 rounded p-3 h-24 flex flex-col justify-between">
            <span className="font-bold text-slate-600">تنظیم‌کننده</span>
            <span className="text-[10px] text-slate-400">{voucherMakerName(voucher)}</span>
          </div>
          <div className="border border-slate-200 rounded p-3 h-24 flex flex-col justify-between">
            <span className="font-bold text-slate-600">حسابدار</span>
            <span className="text-[10px] text-slate-400">امضاء و تأیید</span>
          </div>
          <div className="border border-slate-200 rounded p-3 h-24 flex flex-col justify-between">
            <span className="font-bold text-slate-600">مدیر مالی</span>
            <span className="text-[10px] text-slate-400">امضاء و تأیید</span>
          </div>
          <div className="border border-slate-200 rounded p-3 h-24 flex flex-col justify-between">
            <span className="font-bold text-slate-600">مدیریت عامل</span>
            <span className="text-[10px] text-slate-400">تصویب نهایی</span>
          </div>
        </div>
      </div>
    </PrintModal>
  );
}

function VoucherPrintAmountCell({ row, side, money }: {
  row: VoucherPrintRowAmounts | undefined;
  side: 'debit' | 'credit';
  money: (value: number) => string;
}) {
  const value = row?.[side] ?? 0;
  const original = row?.original;
  const originalValue = original ? original[side] : 0;
  return (
    <td className="border border-slate-300 p-2 text-left font-mono font-medium">
      {value > 0 || originalValue > 0 ? (original && original.rate === null ? '؟' : money(value)) : '-'}
      {original && originalValue > 0 && (
        <div className="text-[10px] text-slate-500 font-normal">
          {formatPersianPrice(originalValue, original.currency)}
          {original.rate !== null ? ` به نرخ ${formatPersianPrice(original.rate)}` : '، بی نرخ'}
        </div>
      )}
    </td>
  );
}
