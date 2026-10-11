/**
 * v10.0.252 (TD-971، OBS-R1-66): چک وصول‌شده‌ای که در تطبیق صورت‌حساب حساب بانکی نامزد است؛ قرارداد مشترک سرور
 * (`GET /accounting/treasury/reconcile-cheques`) و پنجره تطبیق.
 */
export interface ReconcilableCheque {
  id: number;
  chequeNumber: string;
  /** چک دریافتی واریز به حساب است و چک پرداختی برداشت از آن */
  type: 'receipt' | 'payment';
  amount: number;
  /** تاریخ وصول از تاریخچه چک، وگرنه سررسید */
  date: string;
  partyName: string;
  reconciled: number;
}
