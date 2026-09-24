import React, { useState, useEffect } from 'react';
import { ArrowDownLeft, ArrowUpRight, X, ShieldCheck } from 'lucide-react';
import DatePicker from 'react-multi-date-picker';
import persian from 'react-date-object/calendars/persian';
import persian_fa from 'react-date-object/locales/persian_fa';
import { SearchableSelect } from '../../SearchableSelect';
import { FinancialAttachmentUploader } from '../FinancialAttachmentUploader';
import { FinancialAmountInput } from '../../common/FinancialAmountInput';
import { HelpBadge } from '../../common/HelpBadge';
import { formatPersianPrice, formatCurrencyLabel, extractDateString } from '../../../utils';
import { fetchJson } from '../../../api';
import type { BankAccount, Customer, Personnel, FinancialAttachment } from '../../../types';

interface TreasuryTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: 'receipt' | 'payment';
  bankAccounts: BankAccount[];
  customers: Customer[];
  personnelList: Personnel[];
  appCurrency: string;
  onSave: (data: any) => Promise<void>;
}

export const TreasuryTransactionModal: React.FC<TreasuryTransactionModalProps> = ({
  isOpen,
  onClose,
  type,
  bankAccounts,
  customers,
  personnelList,
  appCurrency,
  onSave,
}) => {
  const [formData, setFormData] = useState({
    type,
    date: '',
    bankAccountId: null as number | null,
    partyType: 'customer' as 'customer' | 'supplier' | 'personnel' | 'other',
    partyId: null as number | null,
    partyName: '',
    purpose: 'settlement' as 'settlement' | 'advance' | 'other',
    method: 'bank_transfer' as 'bank_transfer' | 'pos' | 'cash' | 'cheque',
    amount: 0,
    trackingNumber: '',
    description: '',
    createVoucher: true,
    attachments: [] as FinancialAttachment[],
  });

  const [isSaving, setIsSaving] = useState(false);
  const [voucherPreview, setVoucherPreview] = useState<any>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  // TD-105: تاریخ پیش‌فرض از سرور (ساعت توافقی) — نه ساعت مرورگر کلاینت
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetchJson<{ success: boolean; data: { today: string } }>('/api/system/business-date')
      .then(res => {
        const today = res?.data?.today;
        if (!cancelled && today) {
          setFormData(prev => ({ ...prev, date: today }));
        }
      })
      .catch(() => {
        // fallback: تاریخ مرورگر فقط در خطای شبکه (رفتار قدیمی)
        if (!cancelled) {
          setFormData(prev => (prev.date ? prev : { ...prev, date: new Date().toISOString().slice(0, 10) }));
        }
      });
    return () => { cancelled = true; };
  }, [isOpen]);

  // Sync type when modal opens
  useEffect(() => {
    if (isOpen) {
      setFormData(prev => ({
        ...prev,
        type,
        amount: 0,
        trackingNumber: '',
        description: '',
        attachments: [],
      }));
    }
  }, [isOpen, type]);

  // Live Double-Entry Voucher Preview with debounce and AbortController
  useEffect(() => {
    if (!isOpen || !formData.createVoucher || !formData.bankAccountId || !formData.amount || formData.amount <= 0) {
      setVoucherPreview(null);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setIsPreviewLoading(true);
      try {
        const res = await fetchJson<{ success: boolean; data: any }>(
          '/api/accounting/treasury/preview-voucher',
          {
            method: 'POST',
            body: JSON.stringify({
              type: formData.type,
              bankAccountId: formData.bankAccountId,
              amount: formData.amount,
              partyType: formData.partyType,
              partyId: formData.partyId,
              partyName: formData.partyName,
              purpose: formData.purpose,
            }),
            signal: controller.signal,
          }
        );
        if (res?.success && res.data) {
          setVoucherPreview(res.data);
        } else {
          setVoucherPreview(null);
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          setVoucherPreview(null);
        }
      } finally {
        setIsPreviewLoading(false);
      }
    }, 400);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    isOpen,
    formData.createVoucher,
    formData.bankAccountId,
    formData.amount,
    formData.type,
    formData.partyType,
    formData.partyId,
    formData.partyName,
    formData.purpose,
  ]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onSave(formData);
      onClose();
    } catch {
      // Handled in parent
    } finally {
      setIsSaving(false);
    }
  };

  const safeBankAccounts = Array.isArray(bankAccounts) ? bankAccounts : [];
  const safeCustomers = Array.isArray(customers) ? customers : [];
  const safePersonnelList = Array.isArray(personnelList) ? personnelList : [];

  const customerList = safeCustomers.filter(c => {
    const pt = c.partyType || (c as any).party_type || 'customer';
    return pt === 'customer' || pt === 'both';
  });

  const supplierList = safeCustomers.filter(c => {
    const pt = c.partyType || (c as any).party_type;
    return pt === 'supplier' || pt === 'both';
  });
  const actualSupplierList = supplierList.length > 0 ? supplierList : safeCustomers;

  const curLbl = formatCurrencyLabel(appCurrency);
  const isReceipt = formData.type === 'receipt';
  const selectedBank = safeBankAccounts.find(b => b.id === formData.bankAccountId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-4 backdrop-blur-xs">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-xl w-full border border-slate-200 dark:border-slate-700 max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/80 shrink-0">
          <div className="flex items-center gap-2.5">
            <span
              className={`p-1.5 rounded-lg ${
                isReceipt
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                  : 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
              }`}
            >
              {isReceipt ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
            </span>
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-base">
                {isReceipt ? 'ثبت رسید دریافت وجه' : 'ثبت اعلام پرداخت وجه'}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {isReceipt
                  ? 'دریافت نقدی / حواله / پایا / چک از مشتریان یا متفرقه'
                  : 'پرداخت وجه به تامین‌کنندگان، پرسنل یا تسویه هزینه‌ها'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-700 transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  تاریخ تراکنش *
                </label>
                <DatePicker
                  value={formData.date}
                  onChange={(dateObj: any) => {
                    setFormData({ ...formData, date: extractDateString(dateObj) });
                  }}
                  calendar={persian}
                  locale={persian_fa}
                  calendarPosition="bottom-right"
                  inputClass="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl font-mono focus:ring-2 focus:ring-indigo-500 outline-none"
                  containerClassName="w-full"
                />
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  <span>روش پرداخت</span>
                  <HelpBadge text="روش جابجایی وجه: حواله بین‌بانکی، کارتخوان فروشگاهی، نقد صندوق یا چک." />
                </label>
                <select
                  value={formData.method}
                  onChange={e => setFormData({ ...formData, method: e.target.value as any })}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
                >
                  <option value="bank_transfer">حواله / پایا / ساتنا</option>
                  <option value="pos">کارتخوان (POS)</option>
                  <option value="cash">نقدی / صندوق</option>
                  <option value="cheque">چک</option>
                </select>
              </div>
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                <span>حساب بانکی / صندوق مرتبط *</span>
                <HelpBadge text="حساب یا صندوقی که وجه از آن کسر یا به آن واریز می‌شود. برای صدور سند دوبل باید به حساب معین چارت متصل باشد." />
              </label>
              <select
                required
                value={formData.bankAccountId || ''}
                onChange={e => setFormData({ ...formData, bankAccountId: Number(e.target.value) || null })}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
              >
                <option value="">انتخاب حساب...</option>
                {safeBankAccounts.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.title} (موجودی: {formatPersianPrice(b.currentBalance)} {b.currency})
                  </option>
                ))}
              </select>
              {formData.bankAccountId && !selectedBank?.accountId && (
                <p className="text-[10px] font-bold text-amber-700 dark:text-amber-300 mt-1 leading-5">
                  ⚠️ این حساب به چارت حساب‌ها متصل نیست — سند دوبل صادر نخواهد شد. از ویرایش حساب، «اتصال به حساب معین» را تکمیل کنید.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  طرف حساب
                </label>
                <select
                  value={formData.partyType}
                  onChange={e => setFormData({
                    ...formData,
                    partyType: e.target.value as any,
                    partyId: null,
                    partyName: '',
                  })}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
                >
                  <option value="customer">مشتری</option>
                  <option value="supplier">تامین‌کننده</option>
                  <option value="personnel">پرسنل</option>
                  <option value="other">متفرقه</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  نام طرف حساب *
                </label>
                {formData.partyType === 'customer' ? (
                  <SearchableSelect
                    options={customerList.map(c => ({
                      value: String(c.id),
                      label: `${c.name}${c.city ? ` (${c.city})` : ''}${c.phone ? ` - ${c.phone}` : ''}`,
                    }))}
                    value={formData.partyId ? String(formData.partyId) : ''}
                    onChange={(val) => {
                      const c = customerList.find(x => String(x.id) === val) || safeCustomers.find(x => String(x.id) === val);
                      setFormData({ ...formData, partyId: c ? c.id : null, partyName: c ? c.name : '' });
                    }}
                    placeholder="جستجو و انتخاب مشتری..."
                    maxResults={50}
                    className="w-full"
                  />
                ) : formData.partyType === 'supplier' ? (
                  <SearchableSelect
                    options={actualSupplierList.map(s => ({
                      value: String(s.id),
                      label: `${s.name}${s.supplierCategory ? ` [${s.supplierCategory}]` : ''}${s.city ? ` (${s.city})` : ''}${s.phone ? ` - ${s.phone}` : ''}`,
                    }))}
                    value={formData.partyId ? String(formData.partyId) : ''}
                    onChange={(val) => {
                      const s = actualSupplierList.find(x => String(x.id) === val) || safeCustomers.find(x => String(x.id) === val);
                      setFormData({ ...formData, partyId: s ? s.id : null, partyName: s ? s.name : '' });
                    }}
                    placeholder="جستجو و انتخاب تامین‌کننده..."
                    maxResults={50}
                    className="w-full"
                  />
                ) : formData.partyType === 'personnel' ? (
                  <SearchableSelect
                    options={safePersonnelList.map(p => ({
                      value: String(p.id),
                      label: `${p.firstName} ${p.lastName}`.trim(),
                    }))}
                    value={formData.partyId ? String(formData.partyId) : ''}
                    onChange={(val) => {
                      const p = safePersonnelList.find(x => String(x.id) === val);
                      setFormData({ ...formData, partyId: p ? p.id : null, partyName: p ? `${p.firstName} ${p.lastName}`.trim() : '' });
                    }}
                    placeholder="جستجو و انتخاب پرسنل..."
                    maxResults={50}
                    className="w-full"
                  />
                ) : (
                  <input
                    type="text"
                    required
                    placeholder="نام شخص یا شرکت متفرقه..."
                    value={formData.partyName}
                    onChange={e => setFormData({ ...formData, partyName: e.target.value })}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
                  />
                )}
              </div>
            </div>

            {/* Purpose for personnel payment */}
            {formData.partyType === 'personnel' && (
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  نوع پرداخت به پرسنل *
                </label>
                <select
                  value={formData.purpose}
                  onChange={e => setFormData({ ...formData, purpose: e.target.value as any })}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl font-bold"
                >
                  <option value="settlement">تسویه حقوق و دستمزد → بدهکار «حقوق پرداختنی»</option>
                  <option value="advance">مساعده / وام → بدهکار «مساعده و وام پرسنل»</option>
                  <option value="other">سایر</option>
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 items-start">
              <div>
                <FinancialAmountInput
                  label="مبلغ تراکنش"
                  required
                  min={1}
                  value={formData.amount}
                  currency={curLbl}
                  onChange={val => setFormData({ ...formData, amount: val })}
                  placeholder="1000000"
                  showWordsBadge={true}
                  showTomanEquivalent={true}
                />
                {/* Overdraft warning */}
                {!isReceipt && selectedBank && formData.amount > Number(selectedBank.currentBalance) && (
                  <p className="text-[10px] font-bold text-amber-700 dark:text-amber-300 mt-1">
                    ⚠️ مبلغ بیشتر از مانده «{selectedBank.title}» ({formatPersianPrice(selectedBank.currentBalance)}) است — ثبت با خطا مواجه خواهد شد.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  شماره پیگیری / ارجاع
                </label>
                <input
                  type="text"
                  placeholder="کد پیگیری تراکنش..."
                  value={formData.trackingNumber}
                  onChange={e => setFormData({ ...formData, trackingNumber: e.target.value })}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                شرح و توضیحات
              </label>
              <input
                type="text"
                placeholder="بابت تسویه فاکتور / واریزی علی‌الحساب..."
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="createVoucher"
                checked={formData.createVoucher}
                onChange={e => setFormData({ ...formData, createVoucher: e.target.checked })}
                className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
              />
              <label htmlFor="createVoucher" className="text-xs text-slate-700 dark:text-slate-300 font-medium cursor-pointer flex items-center gap-1.5">
                <span>صدور خودکار سند حسابداری دوبل برای این تراکنش</span>
                <HelpBadge text="با فعال بودن این گزینه، یک سند دوبل حسابداری متوازن با سرفصل بانک/صندوق و طرف‌حساب ایجاد می‌گردد." />
              </label>
            </div>

            {/* Attachments */}
            <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
              <FinancialAttachmentUploader
                attachments={formData.attachments}
                onChange={(atts) => setFormData(p => ({ ...p, attachments: atts }))}
                title="پیوست تصویر فیش واریز / رسید پرداخت / اسناد مثبته"
                description="امکان الصاق تصاویر با فشرده‌سازی خودکار هوشمند تا سقف ۳۰۰ کیلوبایت و PDF"
              />
            </div>

            {/* Live Voucher Preview */}
            {formData.createVoucher && formData.bankAccountId && formData.amount > 0 && (
              <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-900/20 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-black text-indigo-800 dark:text-indigo-300 flex items-center gap-1">
                    <ShieldCheck size={13} />
                    پیش‌نمایش سند دوبل (همان چیزی که صادر می‌شود)
                  </span>
                  {isPreviewLoading && <span className="text-[10px] text-slate-400">در حال محاسبه...</span>}
                </div>
                {voucherPreview?.debit && voucherPreview?.credit ? (
                  <table className="w-full text-[10px] border-collapse">
                    <thead>
                      <tr className="text-indigo-700 dark:text-indigo-300 border-b border-indigo-200 dark:border-indigo-800">
                        <th className="py-1 text-right">شرح</th>
                        <th className="py-1 text-right">حساب معین</th>
                        <th className="py-1 text-left">بدهکار</th>
                        <th className="py-1 text-left">بستانکار</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      <tr className="border-b border-indigo-100 dark:border-indigo-900/50">
                        <td className="py-1.5 font-sans font-bold text-slate-800 dark:text-slate-200">{voucherPreview.debit.detailedName}</td>
                        <td className="py-1.5 text-slate-600 dark:text-slate-300">{voucherPreview.debit.accountCode} — {voucherPreview.debit.accountName}</td>
                        <td className="py-1.5 text-left font-bold text-slate-900 dark:text-white">{formatPersianPrice(voucherPreview.debit.amount)}</td>
                        <td className="py-1.5 text-left text-slate-300">—</td>
                      </tr>
                      <tr>
                        <td className="py-1.5 font-sans font-bold text-slate-800 dark:text-slate-200">{voucherPreview.credit.detailedName}</td>
                        <td className="py-1.5 text-slate-600 dark:text-slate-300">{voucherPreview.credit.accountCode} — {voucherPreview.credit.accountName}</td>
                        <td className="py-1.5 text-left text-slate-300">—</td>
                        <td className="py-1.5 text-left font-bold text-slate-900 dark:text-white">{formatPersianPrice(voucherPreview.credit.amount)}</td>
                      </tr>
                    </tbody>
                  </table>
                ) : !isPreviewLoading ? (
                  <p className="text-[10px] font-bold text-slate-400">برای مشاهده پیش‌نمایش، مبلغ را وارد کنید.</p>
                ) : null}
                {voucherPreview?.warnings?.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {voucherPreview.warnings.map((w: string, i: number) => (
                      <p key={i} className="text-[10px] font-bold text-amber-700 dark:text-amber-300 leading-5">⚠️ {w}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Modal Footer */}
          <div className="flex items-center justify-end gap-2 px-6 py-3.5 border-t border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/80 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-700 rounded-xl transition cursor-pointer"
            >
              انصراف
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl shadow-sm disabled:opacity-50 transition cursor-pointer"
            >
              {isSaving ? 'در حال ثبت...' : 'ثبت قطعی تراکنش'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
