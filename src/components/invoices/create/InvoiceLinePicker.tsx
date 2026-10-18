import { useId } from 'react';
import { Plus } from 'lucide-react';
import type { Item, ItemPrice } from '../../../types';
import { formatCurrencyLabel, formatPersianNumber, formatPersianPrice } from '../../../utils';
import { SearchableSelect } from '../../SearchableSelect';
import { DecimalInput, refuseInvalidDecimalInputs } from '../../common/DecimalInput';
import { getSellableStock } from '../../../lib/stockAvailability';
import { itemPickWithReservedUrl } from '../../../lib/permissions/pickLists';
import type { WarehouseItem } from '../../../hooks/queries/useSettingsQueries';
import { INVOICE_FIELD, INVOICE_LABEL, INVOICE_NUMBER_FIELD } from './invoiceFormStyles';

/** متن‌هایی که آزمون‌ها می‌خوانند */
export const INVOICE_LINE_TEXT = {
  itemPlaceholder: 'کد یا نام کالا را بنویسید',
  add: 'افزودن به فهرست',
  manualPrice: 'ورود دستی قیمت',
} as const;

type Amount = number | '';

interface InvoiceLinePickerProps {
  location: string;
  status: string;
  editingDocId: number | null;
  warehouses: WarehouseItem[];
  currency: string;
  selectedItem: string;
  onItemSelect: (value: string, raw?: Item) => void;
  /** قیمت‌های فهرست قیمت کالای برگزیده به ارز سند (`pricesForCurrency`) */
  prices: ItemPrice[];
  quantity: Amount;
  onQuantityChange: (value: Amount) => void;
  unitPrice: Amount;
  onUnitPriceChange: (value: Amount) => void;
  discount: Amount;
  onDiscountChange: (value: Amount) => void;
  onAdd: () => void;
}

/** برچسب کالا در فهرست انتخاب: کد، نام و موجودی قابل فروش انبار خروج */
export function invoiceItemOptionLabel(it: Item, location: string, warehouses: WarehouseItem[]): string {
  const { loc, total, reserved, sellable } = getSellableStock(it, location);
  const whName = warehouses.find(w => w.code === location)?.name || location || 'انبار انتخابی';
  const stock = location
    ? `${whName}: ${formatPersianNumber(loc)} | رزرو: ${formatPersianNumber(reserved)} | قابل فروش: ${formatPersianNumber(sellable)} ${it.unit}`
    : `کل: ${formatPersianNumber(total)} | رزرو: ${formatPersianNumber(reserved)} | قابل فروش: ${formatPersianNumber(sellable)} ${it.unit}`;
  return `${it.code} - ${it.name} (${stock})`;
}

const amountOf = (text: string): Amount => (text ? Number(text) : '');

/**
 * v10.2.3 (گزینه «ج»): ردیف افزودن کالای فاکتور. انتخابگر کالا یک ردیف کامل می‌گیرد و فهرست قیمت، تعداد، مبلغ واحد،
 * تخفیف و دکمه افزودن در ردیف دوم‌اند؛ روی گوشی همه زیر هم.
 */
export function InvoiceLinePicker(props: InvoiceLinePickerProps) {
  const id = useId();
  const { location, status, editingDocId, warehouses, currency, selectedItem, onItemSelect, prices,
    quantity, onQuantityChange, unitPrice, onUnitPriceChange, discount, onDiscountChange, onAdd } = props;
  const currencyLabel = formatCurrencyLabel(currency);
  return (
    <div data-decimal-scope="" className="grid grid-cols-2 sm:grid-cols-6 lg:grid-cols-12 gap-3 items-end bg-slate-50 p-3 sm:p-4 rounded-xl border border-slate-200">
      <div className="col-span-2 sm:col-span-6 lg:col-span-12">
        <label htmlFor={`${id}-item`} className={INVOICE_LABEL}>کالا</label>
        <SearchableSelect
          id={`${id}-item`}
          key={`item-select-${location}-${status}-${editingDocId ?? 'new'}`}
          className="w-full"
          fetchUrl={itemPickWithReservedUrl(editingDocId)}
          mapResultToOption={(it: Item) => ({
            value: it.id.toString(),
            label: invoiceItemOptionLabel(it, location, warehouses),
            disabled: status === 'final' && getSellableStock(it, location).sellable <= 0,
          })}
          value={selectedItem}
          onChange={onItemSelect}
          placeholder={INVOICE_LINE_TEXT.itemPlaceholder}
        />
      </div>
      <div className="col-span-2 sm:col-span-6 lg:col-span-3">
        <label htmlFor={`${id}-price-list`} className={INVOICE_LABEL}>فهرست قیمت</label>
        <select id={`${id}-price-list`} className={INVOICE_FIELD} defaultValue=""
          onChange={e => e.target.value && onUnitPriceChange(Number(e.target.value))}
          disabled={!selectedItem || prices.length === 0}>
          <option value="">{INVOICE_LINE_TEXT.manualPrice}</option>
          {prices.map((p, i) => (
            <option key={`price-opt-${p.id || i}-${i}`} value={p.price}>{p.title} - {formatPersianPrice(p.price)} {formatCurrencyLabel(p.currency)}</option>
          ))}
        </select>
      </div>
      <div className="col-span-1 sm:col-span-2 lg:col-span-2">
        <label htmlFor="invoice-line-quantity" className={INVOICE_LABEL}>تعداد</label>
        <DecimalInput id="invoice-line-quantity" min="0" step="any" value={quantity} onValueChange={v => onQuantityChange(amountOf(v))} className={INVOICE_NUMBER_FIELD} />
      </div>
      <div className="col-span-1 sm:col-span-2 lg:col-span-3">
        <label htmlFor="invoice-line-unit-price" className={INVOICE_LABEL}>مبلغ واحد ({currencyLabel})</label>
        <DecimalInput id="invoice-line-unit-price" min="0" value={unitPrice} onValueChange={v => onUnitPriceChange(amountOf(v))} className={INVOICE_NUMBER_FIELD} />
      </div>
      <div className="col-span-1 sm:col-span-2 lg:col-span-2">
        <label htmlFor="invoice-line-discount" className={INVOICE_LABEL}>تخفیف ردیف ({currencyLabel})</label>
        <DecimalInput id="invoice-line-discount" min="0" value={discount} onValueChange={v => onDiscountChange(amountOf(v))} className={INVOICE_NUMBER_FIELD} />
      </div>
      <div className="col-span-1 sm:col-span-6 lg:col-span-2">
        <button type="button" onClick={(e) => { if (!refuseInvalidDecimalInputs(e.currentTarget)) onAdd(); }}
          className="w-full min-h-[40px] bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-xl flex items-center justify-center gap-1.5 text-sm font-bold transition-colors shadow-sm">
          <Plus size={16} aria-hidden="true" /> {INVOICE_LINE_TEXT.add}
        </button>
      </div>
    </div>
  );
}
