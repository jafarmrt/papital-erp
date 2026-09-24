import React, { useState, useEffect } from 'react';
import { 
  X, 
  CreditCard, 
  CheckCircle2, 
  Clock, 
  Building2, 
  Calendar, 
  FileText, 
  Hash, 
  Banknote, 
  ArrowDownLeft, 
  ArrowUpRight,
  ShieldCheck,
  AlertCircle
} from 'lucide-react';
import { fetchJson } from '../../api';
import { toast } from 'react-hot-toast';
import { 
  formatPersianPrice, 
  getTodayJalaliDate, 
  toPersianDigits, 
  toEnglishDigits 
} from '../../utils';
import { FinancialAmountInput } from '../common/FinancialAmountInput';

interface BankAccount {
  id: number;
  title: string;
  code: string;
  type: 'bank' | 'cash' | 'pos' | 'petty_cash';
  bankName?: string;
  accountNumber?: string;
  cardNumber?: string;
  balance?: number;
  currency?: string;
}

interface SettlementItem {
  id: number;
  transactionNumber: string;
  type: string;
  method: string;
  amount: number;
  date: string;
  status: string;
  trackingNumber?: string | null;
  bankAccountId?: number | null;
  description?: string | null;
}

interface InvoiceSettlementModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  document: {
    id: number;
    refNumber?: string;
    ref_number?: string;
    buyerName?: string | null;
    buyer_name?: string | null;
    type?: string;
    currency?: string;
    totalAmount?: number;
    total_amount?: number;
    paidAmount?: number;
    remainingAmount?: number;
    settlementStatus?: string;
    settlements?: SettlementItem[];
  } | null;
}

export const InvoiceSettlementModal: React.FC<InvoiceSettlementModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  document: doc
}) => {
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<number | ''>('');
  const [amountStr, setAmountStr] = useState<string>('');
  const [date, setDate] = useState<string>(getTodayJalaliDate());
  const [method, setMethod] = useState<'pos' | 'bank_transfer' | 'cash' | 'cheque'>('pos');
  const [trackingNumber, setTrackingNumber] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [createVoucher, setCreateVoucher] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState<boolean>(false);

  // Initialize or reset form when modal opens
  useEffect(() => {
    if (!isOpen || !doc) return;

    const totalAmt = Number(doc.totalAmount ?? doc.total_amount ?? 0);
    const paidAmt = Number(doc.paidAmount ?? 0);
    const remain = Math.max(0, doc.remainingAmount !== undefined ? doc.remainingAmount : (totalAmt - paidAmt));
    
    setAmountStr(remain > 0 ? String(remain) : '');
    setDate(getTodayJalaliDate());
    setTrackingNumber('');
    
    const docRef = doc.refNumber || doc.ref_number || '';
    const buyer = doc.buyerName || doc.buyer_name || '';
    const isPurchase = ['receipt', 'production_receipt', 'purchase'].includes(doc.type || '');
    
    setDescription(
      isPurchase 
        ? `پرداخت بابت فاکتور خرید ${docRef} به ${buyer}`
        : `تسویه فاکتور فروش شماره ${docRef}${buyer ? ` - ${buyer}` : ''}`
    );

    // Fetch active bank accounts and cash funds
    setIsLoadingAccounts(true);
    fetchJson('/accounting/bank-accounts')
      .then((res: any) => {
        const list = Array.isArray(res) ? res : (res?.data || []);
        setBankAccounts(list);
        if (list.length > 0) {
          // Select default account: prefer POS or Bank
          const defaultAcc = list.find((a: BankAccount) => a.type === 'pos' || a.type === 'bank') || list[0];
          setSelectedAccountId(defaultAcc.id);
        }
      })
      .catch((err) => {
        console.error('Failed to load bank accounts', err);
        toast.error('خطا در دریافت لیست حساب‌های بانکی و صندوق‌ها');
      })
      .finally(() => {
        setIsLoadingAccounts(false);
      });
  }, [isOpen, doc]);

  if (!isOpen || !doc) return null;

  const totalAmount = Number(doc.totalAmount ?? doc.total_amount ?? 0);
  const paidAmount = Number(doc.paidAmount ?? 0);
  const remainingAmount = Math.max(0, doc.remainingAmount !== undefined ? doc.remainingAmount : (totalAmount - paidAmount));
  const currency = doc.currency || 'IRR';
  const isPurchase = ['receipt', 'production_receipt', 'purchase'].includes(doc.type || '');
  const docRef = doc.refNumber || doc.ref_number || '';
  const partyName = doc.buyerName || doc.buyer_name || (isPurchase ? 'تامین‌کننده' : 'مشتری');

  const parsedAmount = Number(toEnglishDigits(amountStr).replace(/,/g, '')) || 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (parsedAmount <= 0) {
      toast.error('لطفاً مبلغ تسویه را به درستی وارد کنید.');
      return;
    }

    if (!selectedAccountId) {
      toast.error('لطفاً حساب بانکی یا صندوق دریافت/پرداخت را انتخاب کنید.');
      return;
    }

    if (!date.trim()) {
      toast.error('تاریخ تسویه الزامی است.');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        type: isPurchase ? 'payment' : 'receipt',
        date: date.trim(),
        method,
        amount: parsedAmount,
        currency,
        bankAccountId: Number(selectedAccountId),
        partyType: isPurchase ? 'supplier' : 'customer',
        partyName: partyName.trim() || (isPurchase ? 'تامین‌کننده' : 'مشتری'),
        trackingNumber: trackingNumber.trim() || undefined,
        documentId: doc.id,
        description: description.trim() || undefined,
        createVoucher,
      };

      await fetchJson('/accounting/treasury', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      toast.success(
        isPurchase 
          ? `پرداخت به مبلغ ${formatPersianPrice(parsedAmount, currency)} با موفقیت ثبت شد.`
          : `تسویه و دریافت وجه به مبلغ ${formatPersianPrice(parsedAmount, currency)} با موفقیت ثبت گردید.`
      );
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'خطا در ثبت تسویه فاکتور');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSetFullRemaining = () => {
    setAmountStr(String(remainingAmount));
  };

  const handleSetHalfRemaining = () => {
    setAmountStr(String(Math.round(remainingAmount / 2)));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-xl overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-slate-50 to-slate-100/80 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              isPurchase ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
            }`}>
              {isPurchase ? <ArrowUpRight size={22} /> : <ArrowDownLeft size={22} />}
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-base flex items-center gap-2">
                <span>{isPurchase ? 'پرداخت و تسویه فاکتور خرید' : 'دریافت و تسویه سریع فاکتور'}</span>
                <span className="font-mono text-xs bg-white px-2 py-0.5 rounded-md border border-slate-200 text-slate-600">
                  {toPersianDigits(docRef)}
                </span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                طرف حساب: <strong className="text-slate-700">{partyName}</strong>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Balance Overview Card */}
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200/80 grid grid-cols-3 gap-3 text-center">
            <div className="p-2 bg-white rounded-lg border border-slate-100">
              <span className="block text-[11px] text-slate-500 font-medium">مبلغ کل فاکتور</span>
              <span className="font-bold text-sm text-slate-800 mt-1 block">
                {formatPersianPrice(totalAmount, currency)}
              </span>
            </div>

            <div className="p-2 bg-white rounded-lg border border-slate-100">
              <span className="block text-[11px] text-slate-500 font-medium">پرداخت‌شده قبلی</span>
              <span className="font-bold text-sm text-emerald-600 mt-1 block">
                {formatPersianPrice(paidAmount, currency)}
              </span>
            </div>

            <div className={`p-2 rounded-lg border ${
              remainingAmount > 0 
                ? 'bg-amber-50/70 border-amber-200/80' 
                : 'bg-emerald-50/70 border-emerald-200/80'
            }`}>
              <span className="block text-[11px] text-slate-600 font-medium">مانده قابل تسویه</span>
              <span className={`font-black text-sm mt-1 block ${
                remainingAmount > 0 ? 'text-amber-700' : 'text-emerald-700'
              }`}>
                {formatPersianPrice(remainingAmount, currency)}
              </span>
            </div>
          </div>

          {/* Amount Field with Quick Buttons */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Banknote size={15} className="text-emerald-600" />
                <span>مبلغ پرداختی این نوبت ({currency === 'IRR' ? 'ریال' : currency})</span>
                <span className="text-rose-500">*</span>
              </label>

              {remainingAmount > 0 && (
                <div className="flex items-center gap-1.5 text-xs">
                  <button
                    type="button"
                    onClick={handleSetFullRemaining}
                    className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 text-[11px] transition-colors"
                  >
                    تسویه کل مانده
                  </button>
                  {remainingAmount > 1000 && (
                    <button
                      type="button"
                      onClick={handleSetHalfRemaining}
                      className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 hover:bg-slate-200 text-[11px] transition-colors"
                    >
                      نصف مبلغ
                    </button>
                  )}
                </div>
              )}
            </div>

            <FinancialAmountInput
              value={amountStr}
              currency={currency}
              onChange={(val) => setAmountStr(val > 0 ? String(val) : '')}
              placeholder="مبلغ را وارد کنید..."
              required
              showWordsBadge={true}
              showTomanEquivalent={true}
            />
            
            {parsedAmount > remainingAmount && remainingAmount > 0 && (
              <p className="text-[11px] text-amber-600 mt-1 flex items-center gap-1">
                <AlertCircle size={12} />
                <span>توجه: مبلغ وارد شده بیش از مانده فاکتور است و مابه‌التفاوت به عنوان بستانکاری طرف‌حساب منظور می‌گردد.</span>
              </p>
            )}
          </div>

          {/* Payment Method Selector */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-2">روش پرداخت / دریافت</label>
            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => setMethod('pos')}
                className={`flex flex-col items-center justify-center p-2.5 rounded-xl border text-xs font-medium transition-all ${
                  method === 'pos'
                    ? 'border-emerald-500 bg-emerald-50/50 text-emerald-800 shadow-sm ring-1 ring-emerald-500'
                    : 'border-slate-200 hover:border-slate-300 bg-white text-slate-600'
                }`}
              >
                <CreditCard size={18} className={method === 'pos' ? 'text-emerald-600 mb-1' : 'text-slate-400 mb-1'} />
                <span>کارت‌خوان</span>
              </button>

              <button
                type="button"
                onClick={() => setMethod('bank_transfer')}
                className={`flex flex-col items-center justify-center p-2.5 rounded-xl border text-xs font-medium transition-all ${
                  method === 'bank_transfer'
                    ? 'border-emerald-500 bg-emerald-50/50 text-emerald-800 shadow-sm ring-1 ring-emerald-500'
                    : 'border-slate-200 hover:border-slate-300 bg-white text-slate-600'
                }`}
              >
                <Building2 size={18} className={method === 'bank_transfer' ? 'text-emerald-600 mb-1' : 'text-slate-400 mb-1'} />
                <span>انتقال بانکی</span>
              </button>

              <button
                type="button"
                onClick={() => setMethod('cash')}
                className={`flex flex-col items-center justify-center p-2.5 rounded-xl border text-xs font-medium transition-all ${
                  method === 'cash'
                    ? 'border-emerald-500 bg-emerald-50/50 text-emerald-800 shadow-sm ring-1 ring-emerald-500'
                    : 'border-slate-200 hover:border-slate-300 bg-white text-slate-600'
                }`}
              >
                <Banknote size={18} className={method === 'cash' ? 'text-emerald-600 mb-1' : 'text-slate-400 mb-1'} />
                <span>وجه نقد (صندوق)</span>
              </button>

              <button
                type="button"
                onClick={() => setMethod('cheque')}
                className={`flex flex-col items-center justify-center p-2.5 rounded-xl border text-xs font-medium transition-all ${
                  method === 'cheque'
                    ? 'border-emerald-500 bg-emerald-50/50 text-emerald-800 shadow-sm ring-1 ring-emerald-500'
                    : 'border-slate-200 hover:border-slate-300 bg-white text-slate-600'
                }`}
              >
                <FileText size={18} className={method === 'cheque' ? 'text-emerald-600 mb-1' : 'text-slate-400 mb-1'} />
                <span>چک صیادی</span>
              </button>
            </div>
          </div>

          {/* Account Selection & Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                حساب بانکی یا صندوق مقصد <span className="text-rose-500">*</span>
              </label>
              {isLoadingAccounts ? (
                <div className="h-10 bg-slate-100 rounded-xl animate-pulse" />
              ) : (
                <select
                  value={selectedAccountId}
                  onChange={(e) => setSelectedAccountId(Number(e.target.value))}
                  className="w-full text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                  required
                >
                  <option value="">انتخاب حساب / صندوق...</option>
                  {bankAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.title} {acc.bankName ? `(${acc.bankName})` : ''} - کد {toPersianDigits(acc.code)}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1">
                <Calendar size={13} className="text-slate-400" />
                <span>تاریخ تسویه</span>
                <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={toPersianDigits(date)}
                onChange={(e) => setDate(toEnglishDigits(e.target.value))}
                placeholder="۱۴۰۴/۰۱/۰۱"
                className="w-full text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                required
              />
            </div>
          </div>

          {/* Tracking Number & Description */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1">
                <Hash size={13} className="text-slate-400" />
                <span>شماره پیگیری / ارجاع (اختیاری)</span>
              </label>
              <input
                type="text"
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                placeholder="کد پیگیری تراکنش بانکی..."
                className="w-full text-xs text-slate-800 bg-white border border-slate-300 rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none placeholder:text-slate-400"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">شرح پرداخت</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="شرح تسویه..."
                className="w-full text-xs text-slate-800 bg-white border border-slate-300 rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none placeholder:text-slate-400"
              />
            </div>
          </div>

          {/* Auto Journal Voucher Option */}
          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck size={18} className="text-emerald-600" />
              <div>
                <span className="text-xs font-bold text-slate-700 block">صدور خودکار سند حسابداری دوبل</span>
                <span className="text-[11px] text-slate-500">
                  ثبت همزمان سند بستانکاری مشتری/فروشنده و بدهکاری بانک یا صندوق
                </span>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input 
                type="checkbox" 
                checked={createVoucher} 
                onChange={(e) => setCreateVoucher(e.target.checked)}
                className="sr-only peer" 
              />
              <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
            </label>
          </div>

          {/* Previous Settlement History (if any) */}
          {doc.settlements && doc.settlements.length > 0 && (
            <div className="pt-2 border-t border-slate-100">
              <span className="text-xs font-bold text-slate-700 mb-2 block flex items-center gap-1">
                <Clock size={13} className="text-slate-400" />
                <span>سوابق پرداخت‌های این فاکتور ({toPersianDigits(doc.settlements.length)} مورد)</span>
              </span>
              <div className="space-y-1.5 max-h-28 overflow-y-auto">
                {doc.settlements.map((st) => (
                  <div key={st.id} className="flex items-center justify-between text-[11px] bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200/60">
                    <div className="flex items-center gap-2 text-slate-600">
                      <span className="font-mono font-medium">{toPersianDigits(st.date)}</span>
                      <span>•</span>
                      <span className="text-slate-500">
                        {st.method === 'pos' ? 'کارت‌خوان' : st.method === 'cash' ? 'نقدی' : st.method === 'cheque' ? 'چک' : 'حواله'}
                      </span>
                      {st.trackingNumber && (
                        <span className="text-slate-400 font-mono text-[10px]">({st.trackingNumber})</span>
                      )}
                    </div>
                    <span className="font-bold text-emerald-700">
                      {formatPersianPrice(st.amount, currency)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </form>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 rounded-xl transition-colors"
          >
            انصراف
          </button>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || parsedAmount <= 0 || !selectedAccountId}
            className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:hover:bg-emerald-600 rounded-xl shadow-sm hover:shadow transition-all flex items-center gap-2"
          >
            {isSubmitting ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>در حال ثبت...</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={16} />
                <span>{isPurchase ? 'تایید و ثبت پرداخت' : 'تایید و ثبت تسویه'}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default InvoiceSettlementModal;
