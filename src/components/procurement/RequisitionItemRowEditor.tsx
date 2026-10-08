import { Trash2 } from 'lucide-react';
import type { Item } from '../../types';
import { formatPersianNumber, formatPersianPrice } from '../../utils';
import { SearchableSelect } from '../SearchableSelect';
import { PICK_LIST_URLS } from '../../lib/permissions/pickLists';

/** یک ردیف فرم ثبت درخواست خرید */
export interface NewRequisitionRow {
  id: string;
  itemId: number | null;
  itemCode: string;
  itemName: string;
  unit: string;
  requestedQty: number;
  unitPriceEstimate: number;
  notes: string;
}

/** گزینه انتخابگر کالا: نام و کد کالای فهرست انتخاب (`GET /items/options`) */
const itemOption = (item: Item) => ({ value: item.id, label: `${item.name}${item.code ? ` (${item.code})` : ''}` });

/** v9.0.328 (TD-901، ت۵): پیام خطای هر فیلد زیر همان فیلد، نه فقط در اعلان */
export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return <p id={id} role="alert" className="mt-1 text-[11px] font-bold text-rose-600">{message}</p>;
}

interface RequisitionItemRowEditorProps {
  row: NewRequisitionRow;
  index: number;
  errors: Record<string, string>;
  onSelectItem: (rowId: string, item: Item | undefined) => void;
  onChange: <K extends keyof NewRequisitionRow>(rowId: string, field: K, value: NewRequisitionRow[K]) => void;
  onRemove: (rowId: string) => void;
}

const inputClass = (invalid: boolean) =>
  `p-1.5 bg-white border rounded text-slate-800 focus:ring-2 focus:ring-amber-400 focus:outline-none ${invalid ? 'border-rose-500' : 'border-slate-300'}`;

/** ردیف کالای فرم درخواست خرید؛ خطای Zod سرور یا بررسی فرم زیر همان فیلد ردیف می‌آید (کلید `items.<ردیف>.<فیلد>`) */
export function RequisitionItemRowEditor({ row, index, errors, onSelectItem, onChange, onRemove }: RequisitionItemRowEditorProps) {
  const errorOf = (field: string) => errors[`items.${index}.${field}`];
  const errorId = (field: string) => `req-row-${row.id}-${field}-error`;
  return (
    <tr className="hover:bg-slate-50/50 align-top">
      <td className="p-2.5 text-center text-slate-400">{formatPersianNumber(index + 1)}</td>
      <td className="p-2.5">
        <SearchableSelect
          value={row.itemId ?? ''}
          onChange={(_value, raw) => onSelectItem(row.id, raw as Item | undefined)}
          fetchUrl={PICK_LIST_URLS.items}
          mapResultToOption={itemOption}
          placeholder="جست‌وجو در فهرست کالا..."
        />
      </td>
      <td className="p-2.5">
        <input
          type="text"
          aria-label={`نام کالای ردیف ${formatPersianNumber(index + 1)}`}
          placeholder="نام کالا"
          value={row.itemName}
          onChange={e => onChange(row.id, 'itemName', e.target.value)}
          aria-invalid={Boolean(errorOf('itemName'))}
          aria-describedby={errorOf('itemName') ? errorId('itemName') : undefined}
          className={`w-full font-bold ${inputClass(Boolean(errorOf('itemName')))}`}
        />
        <FieldError id={errorId('itemName')} message={errorOf('itemName')} />
      </td>
      <td className="p-2.5 text-center">
        <input
          type="text"
          aria-label={`واحد ردیف ${formatPersianNumber(index + 1)}`}
          value={row.unit}
          onChange={e => onChange(row.id, 'unit', e.target.value)}
          className={`w-16 text-center ${inputClass(false)}`}
        />
      </td>
      <td className="p-2.5 text-center">
        <input
          type="number"
          min={0.001}
          step="any"
          aria-label={`مقدار درخواستی ردیف ${formatPersianNumber(index + 1)}`}
          value={row.requestedQty === 0 ? '' : row.requestedQty}
          onChange={e => onChange(row.id, 'requestedQty', e.target.value === '' ? 0 : Number(e.target.value))}
          placeholder="۱"
          aria-invalid={Boolean(errorOf('requestedQty'))}
          aria-describedby={errorOf('requestedQty') ? errorId('requestedQty') : undefined}
          className={`w-20 text-center font-bold ${inputClass(Boolean(errorOf('requestedQty')))}`}
          dir="ltr"
        />
        <FieldError id={errorId('requestedQty')} message={errorOf('requestedQty')} />
      </td>
      <td className="p-2.5 text-center">
        <input
          type="number"
          min={0}
          step="any"
          aria-label={`برآورد قیمت واحد ردیف ${formatPersianNumber(index + 1)}`}
          value={row.unitPriceEstimate === 0 ? '' : row.unitPriceEstimate}
          onChange={e => onChange(row.id, 'unitPriceEstimate', e.target.value === '' ? 0 : Number(e.target.value))}
          placeholder="۰"
          aria-invalid={Boolean(errorOf('unitPriceEstimate'))}
          aria-describedby={errorOf('unitPriceEstimate') ? errorId('unitPriceEstimate') : undefined}
          className={`w-28 text-center ${inputClass(Boolean(errorOf('unitPriceEstimate')))}`}
          dir="ltr"
        />
        <FieldError id={errorId('unitPriceEstimate')} message={errorOf('unitPriceEstimate')} />
      </td>
      <td className="p-2.5 text-center font-bold text-amber-700">
        {formatPersianPrice(row.requestedQty * row.unitPriceEstimate)}
      </td>
      <td className="p-2.5 text-center">
        <button
          type="button"
          onClick={() => onRemove(row.id)}
          className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors cursor-pointer"
          title="حذف ردیف"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </td>
    </tr>
  );
}
