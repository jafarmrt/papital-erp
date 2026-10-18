import { useId } from 'react';
import { UserRound } from 'lucide-react';
import { SearchableSelect } from '../../SearchableSelect';
import { documentPartyPickListUrl } from '../../../lib/documents/documentPartyKind';
import { customerLocationLabel, type BuyerSource } from '../../../lib/invoices/invoiceForm';
import { InvoiceFormSection } from './InvoiceFormSection';
import { INVOICE_LABEL, INVOICE_READONLY_FIELD } from './invoiceFormStyles';

/** متن‌هایی که آزمون‌ها می‌خوانند */
export const INVOICE_BUYER_TEXT = {
  placeholder: 'نام یا تلفن خریدار را بنویسید',
  fromFile: 'از پرونده خریدار',
  notRecorded: 'در پرونده ثبت نشده است',
} as const;

/** برچسب خریدار در فهرست انتخاب: نام، تلفن و استان و شهر، بی شکلک */
export function buyerOptionLabel(c: BuyerSource): string {
  const location = customerLocationLabel(c);
  return [c.name, c.phone ? `(${c.phone})` : '', location ? `- ${location}` : ''].filter(Boolean).join(' ');
}

interface InvoiceBuyerFieldsProps {
  selectedCustomerId: string;
  onCustomerSelect: (value: string, raw?: BuyerSource) => void;
  buyerName: string;
  buyerCity: string;
  buyerPhone: string;
  buyerAddress: string;
}

/**
 * v10.2.4 (گزینه «ج»): بخش «خریدار». خریدار فقط از فهرست طرف حساب‌ها برگزیده می‌شود و مشخصات او از پرونده‌اش خوانده
 * می‌شود (فقط‌خواندنی).
 */
export function InvoiceBuyerFields({ selectedCustomerId, onCustomerSelect, buyerName, buyerCity, buyerPhone, buyerAddress }: InvoiceBuyerFieldsProps) {
  const id = useId();
  const readOnlyPlaceholder = (value: string) => (selectedCustomerId ? (value ? '' : INVOICE_BUYER_TEXT.notRecorded) : INVOICE_BUYER_TEXT.fromFile);
  return (
    <InvoiceFormSection icon={UserRound} title="خریدار" hint="خریدار فقط از فهرست طرف حساب‌ها انتخاب می‌شود.">
      <div>
        <label htmlFor={`${id}-customer`} className={INVOICE_LABEL}>
          طرف حساب<span className="text-rose-500 mr-1">*</span>
        </label>
        <SearchableSelect
          id={`${id}-customer`}
          className="w-full"
          fetchUrl={documentPartyPickListUrl('invoice')}
          mapResultToOption={(c: BuyerSource & { id: number }) => ({ value: c.id.toString(), label: buyerOptionLabel(c), _raw: c })}
          value={selectedCustomerId}
          valueLabel={buyerName || undefined}
          onChange={onCustomerSelect}
          placeholder={INVOICE_BUYER_TEXT.placeholder}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div>
          <label htmlFor={`${id}-buyer-name`} className={INVOICE_LABEL}>نام خریدار</label>
          <input id={`${id}-buyer-name`} type="text" value={buyerName} readOnly
            placeholder={selectedCustomerId ? (buyerName || 'بدون نام') : INVOICE_BUYER_TEXT.fromFile}
            className={`${INVOICE_READONLY_FIELD} font-bold`} />
        </div>
        <div>
          <label htmlFor={`${id}-buyer-city`} className={INVOICE_LABEL}>استان / شهر</label>
          <input id={`${id}-buyer-city`} type="text" value={buyerCity} readOnly placeholder={readOnlyPlaceholder(buyerCity)} className={INVOICE_READONLY_FIELD} />
        </div>
        <div>
          <label htmlFor={`${id}-buyer-phone`} className={INVOICE_LABEL}>تلفن</label>
          <input id={`${id}-buyer-phone`} type="text" value={buyerPhone} readOnly dir="ltr" placeholder={readOnlyPlaceholder(buyerPhone)}
            className={`${INVOICE_READONLY_FIELD} text-right`} />
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <label htmlFor={`${id}-buyer-address`} className={INVOICE_LABEL}>نشانی تحویل</label>
          <input id={`${id}-buyer-address`} type="text" value={buyerAddress} readOnly placeholder={readOnlyPlaceholder(buyerAddress)} className={INVOICE_READONLY_FIELD} />
        </div>
      </div>
    </InvoiceFormSection>
  );
}
