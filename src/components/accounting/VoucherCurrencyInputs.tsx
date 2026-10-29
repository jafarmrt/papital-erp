import { formatCurrencyLabel, formatPersianNumber } from '../../utils';
import { DecimalInput } from '../common/DecimalInput';
import { RialEquivalent } from '../common/RialEquivalent';
import { VOUCHER_CURRENCIES, type VoucherHeaderCurrency, type VoucherRowCurrencyDraft } from '../../lib/accounting/voucherFormCurrency';
import { voucherRowCurrency } from '../../lib/accounting/voucherCurrencyBalance';

/**
 * v9.0.191 (TD-564، B03-22، تصمیم ت۷): انتخاب ارز و نرخ تبدیل به ریال در سرآیند و ردیف سند حسابداری دستی و اصلاحی.
 */

const currencyOption = (code: string) => `${formatCurrencyLabel(code)} (${code})`;

const inputClass = 'px-2 py-1.5 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white';

export function VoucherHeaderCurrencyFields({ value, onChange, currencyLocked = false }: {
  value: VoucherHeaderCurrency;
  onChange: (next: VoucherHeaderCurrency) => void;
  /** سند اصلاحی: ارز سند همان ارز سند اصلی است */
  currencyLocked?: boolean;
}) {
  const currency = voucherRowCurrency(value.currency);
  return (
    <div className="flex items-start gap-2">
      <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
        ارز سند
        <select
          value={currency}
          disabled={currencyLocked}
          onChange={e => onChange({ currency: e.target.value, rate: e.target.value === 'IRR' ? '' : value.rate })}
          className={inputClass}
        >
          {VOUCHER_CURRENCIES.map(code => <option key={code} value={code}>{currencyOption(code)}</option>)}
        </select>
      </label>
      {currency !== 'IRR' && (
        <div>
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
            نرخ {formatCurrencyLabel(currency)} به ریال *
            <DecimalInput
              min="0"
              step="any"
              value={value.rate ?? ''}
              onValueChange={rate => onChange({ currency, rate })}
              placeholder="نرخ تبدیل"
              className={`${inputClass} w-32 font-mono text-left`}
            />
          </label>
          <RialEquivalent value={value.rate} />
        </div>
      )}
    </div>
  );
}

/** ارز ردیف (خالی = ارز سند) و نرخ آن؛ نرخ خالی ردیف هم‌ارز سند نرخ سند را می‌گیرد */
export function VoucherRowCurrencyCell({ row, header, onChange }: {
  row: VoucherRowCurrencyDraft;
  header: VoucherHeaderCurrency;
  onChange: (patch: VoucherRowCurrencyDraft) => void;
}) {
  const headerCurrency = voucherRowCurrency(header.currency);
  const currency = voucherRowCurrency(row.currency, headerCurrency);
  const inherited = currency === headerCurrency && header.rate !== '' && header.rate !== undefined;
  return (
    <div className="flex flex-col gap-1">
      <select
        aria-label="ارز ردیف"
        value={row.currency ? currency : ''}
        onChange={e => onChange({ currency: e.target.value, exchangeRate: '' })}
        className={`${inputClass} w-28 text-[11px]`}
      >
        <option value="">ارز سند ({formatCurrencyLabel(headerCurrency)})</option>
        {VOUCHER_CURRENCIES.filter(code => code !== headerCurrency).map(code => <option key={code} value={code}>{currencyOption(code)}</option>)}
      </select>
      {currency !== 'IRR' && (
        <DecimalInput
          min="0"
          step="any"
          aria-label="نرخ ردیف به ریال"
          value={row.exchangeRate ?? ''}
          onValueChange={exchangeRate => onChange({ exchangeRate })}
          placeholder={inherited ? `نرخ سند: ${formatPersianNumber(header.rate, 4)}` : 'نرخ به ریال *'}
          className={`${inputClass} w-28 text-[11px] font-mono text-left`}
        />
      )}
      {currency !== 'IRR' && <RialEquivalent value={row.exchangeRate} className="mt-0 text-[10px]" />}
    </div>
  );
}
