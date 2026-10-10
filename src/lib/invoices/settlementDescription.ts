import { toPersianDigits } from '../../utils/persianNumber';

export interface SettlementDescriptionInput {
  refNumber: string;
  buyerName: string;
  isPurchase: boolean;
}

/** Default description of a quick settlement of a sales or purchase invoice, numbers in Persian digits (v10.0.119, TD-1184) */
export function settlementDefaultDescription({ refNumber, buyerName, isPurchase }: SettlementDescriptionInput): string {
  const ref = toPersianDigits(refNumber);
  return isPurchase
    ? `پرداخت بابت فاکتور خرید ${ref} به ${buyerName}`
    : `تسویه فاکتور فروش شماره ${ref}${buyerName ? ` - ${buyerName}` : ''}`;
}
