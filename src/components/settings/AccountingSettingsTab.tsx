import { useEffect, useState } from 'react';
import { fetchJson } from '../../api';
import { toast } from 'react-hot-toast';
import { RefreshCw, Save, ShieldCheck, Info, Check } from 'lucide-react';
import { AccountSearchSelect } from '../accounting/AccountSearchSelect';
import type { Account } from '../../types';
import { formatPersianNumber } from '../../utils';

// V1.7.0 — تب «تنظیمات حسابداری»: مپینگ سندهای اتوماتیک دوبل + همگام‌سازی کدینگ پیش‌فرض
interface MappingRowMeta {
  key: string;
  label: string;
  description: string;
}

const MAPPING_ROWS: MappingRowMeta[] = [
  { key: 'tradeReceivablesAccountCode', label: 'حساب‌های دریافتنی تجاری', description: 'طرف حساب دریافت وجه از مشتری (خزانه) و بستانکاری در ثبت چک دریافتی' },
  { key: 'tradePayablesAccountCode', label: 'حساب‌های پرداختنی تجاری', description: 'طرف حساب پرداخت وجه به تامین‌کننده (خزانه) و بدهکار شدن در صدور چک پرداختی' },
  { key: 'wagesPayableAccountCode', label: 'حقوق و دستمزد پرداختنی', description: 'سند تسویه پرداخت حقوق و طرف حساب دریافت وجه از پرسنل' },
  { key: 'chequeReceivableAccountCode', label: 'اسناد دریافتنی نزد صندوق (1101)', description: 'ثبت اولیه چک دریافتی و بازگشت از جریان وصول' },
  { key: 'chequeInCollectionAccountCode', label: 'اسناد در جریان وصول (1102)', description: 'ارسال چک به بانک برای وصول و کسر هنگام پاس/برگشت' },
  { key: 'chequeProtestAccountCode', label: 'اسناد واخواستی (1103)', description: 'برگشت چک دریافتی (واخواست)' },
  { key: 'chequePayableAccountCode', label: 'اسناد پرداختنی تجاری (3101)', description: 'صدور چک پرداختی و پاس شدن آن' },
  { key: 'employeeAdvanceAccountCode', label: 'مساعده و وام پرسنل (1301)', description: 'پرداخت مساعده/وام به پرسنل (مطالبات از کارکنان) تا کسر از حقوق' },
  { key: 'salesRevenueAccountCode', label: 'درآمد فروش', description: 'سند خودکار فروش (فاکتور نهایی)' },
  { key: 'salesDiscountAccountCode', label: 'تخفیف فروش', description: 'سند خودکار تخفیفات فاکتور' },
  { key: 'salesVatPayableAccountCode', label: 'مالیات بر ارزش افزوده', description: 'بستانکاری VAT در سند فروش' },
  { key: 'inventoryRawMaterialsCode', label: 'موجودی مواد اولیه (1401)', description: 'اسناد رسید مواد اولیه و حواله تولید' },
  { key: 'inventoryFinishedGoodsCode', label: 'موجودی کالای تولیدشده (1403)', description: 'اسناد رسید تولید نهایی' },
  { key: 'costOfGoodsSoldCode', label: 'بهای تمام‌شده کالای فروش‌رفته (6001)', description: 'سند خودکار بهای تمام‌شده در فروش' },
  { key: 'directProductionWagesAccountCode', label: 'حقوق مستقیم تولید (6002)', description: 'سند تجمیع کارکرد پرکیسی تولید' },
  { key: 'summaryProfitLossCode', label: 'خلاصه سود و زیان', description: 'بستن حساب‌های موقت در پایان سال مالی' },
  { key: 'retainedEarningsCode', label: 'سود (زیان) انباشته', description: 'انتقال نتیجه سال مالی' },
  { key: 'closingBalanceAccountCode', label: 'حساب ترازClosing', description: 'سند افتتاحیه/اختتامیه ترازنامه' },
  { key: 'openingCapitalAccountCode', label: 'سرمایه اولیه (4001)', description: 'طرف حساب اسناد افتتاحیه موجودی اولیه خزانه و انبار' },
];

export function AccountingSettingsTab({ currentUser }: { currentUser: any }) {
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [disabled, setDisabled] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountsCount, setAccountsCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);

  const loadData = async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const [res, accRes] = await Promise.all([
        fetchJson('/accounting/mappings', { signal }),
        fetchJson('/accounting/accounts', { signal }).catch(() => []),
      ]);
      const { disabled: dis, accountsCount: cnt, ...m } = res || {};
      setMappings(m || {});
      setDisabled(Array.isArray(dis) ? dis : []);
      setAccountsCount(Number(cnt) || 0);
      const items = Array.isArray(accRes?.data) ? accRes.data : (Array.isArray(accRes) ? accRes : []);
      setAccounts(items);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      toast.error(err?.message || 'خطا در دریافت تنظیمات حسابداری');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    loadData(controller.signal);
    return () => controller.abort();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await fetchJson('/accounting/mappings', {
        method: 'POST',
        body: JSON.stringify({ ...mappings, disabled }),
      });
      toast.success('تنظیمات مپینگ حسابداری ذخیره شد');
    } catch (err: any) {
      toast.error(err?.message || 'خطا در ذخیره تنظیمات');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSeedDefault = async () => {
    const ok = window.confirm('کدینگ استاندارد حساب‌ها (گروه‌ها، معین و تفصیلی‌های پیش‌فرض) مستقر و همگام شود؟');
    if (!ok) return;
    setIsSeeding(true);
    try {
      const res = await fetchJson('/accounting/accounts/seed-default', { method: 'POST' });
      toast.success(res?.message || 'کدینگ پیش‌فرض مستقر شد');
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || 'خطا در استقرار کدینگ پیش‌فرض');
    } finally {
      setIsSeeding(false);
    }
  };

  const toggleDisabled = (key: string) => {
    setDisabled(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Section 1: کدینگ پیش‌فرض */}
      <div className={`rounded-2xl border p-5 ${accountsCount === 0 ? 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}>
        <div className="flex items-center gap-2 mb-2">
          <ShieldCheck size={18} className="text-emerald-600" />
          <h3 className="font-black text-slate-900 dark:text-white text-sm">کدینگ پیش‌فرض حساب‌ها</h3>
        </div>
        {accountsCount === 0 ? (
          <>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-6 mb-3">
              هنوز هیچ حسابی در چارت حساب‌ها تعریف نشده است. با دکمه زیر، ساختار کدینگ استاندارد
              (گروه‌ها، معین‌ها و تفصیلی‌های پیش‌فرض نرم‌افزار) یک‌جا مستقر و همگام می‌شود.
            </p>
            <button
              onClick={handleSeedDefault}
              disabled={isSeeding}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition shadow-sm disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw size={14} className={isSeeding ? 'animate-spin' : ''} />
              <span>{isSeeding ? 'در حال استقرار...' : 'همگام‌سازی کدینگ پیش‌فرض'}</span>
            </button>
          </>
        ) : (
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-6 flex items-center gap-1.5">
            <Check size={14} className="text-emerald-600 shrink-0" />
            چارت حساب‌ها فعال است ({formatPersianNumber(accountsCount)} حساب تعریف‌شده) — نیازی به همگام‌سازی پیش‌فرض نیست.
            مدیریت کدینگ از بخش <span className="font-bold">حسابداری ← کدینگ حساب‌ها</span> انجام می‌شود.
          </p>
        )}
      </div>

      {/* Section 2: مپینگ سندهای اتوماتیک */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Info size={18} className="text-blue-600" />
            <h3 className="font-black text-slate-900 dark:text-white text-sm">مپینگ سندهای اتوماتیک دوبل</h3>
          </div>
          <button
            onClick={handleSave}
            disabled={isSaving || loading}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl transition disabled:opacity-50 cursor-pointer"
          >
            <Save size={14} />
            <span>{isSaving ? 'در حال ذخیره...' : 'ذخیره تنظیمات'}</span>
          </button>
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-6 mb-4">
          این حساب‌ها توسط موتور سند اتوماتیک (فروش، خرید، خزانه، چک صیادی، حقوق، تولید و بستن سال مالی) استفاده می‌شوند.
          برای هر مفهوم می‌توانید حساب معین دلخواه انتخاب کنید؛ با خاموش کردن سوییچ، مفهوم به کدینگ پیش‌فرض برمی‌گردد.
        </p>

        {loading ? (
          <div className="py-10 text-center text-slate-400 text-sm">در حال بارگذاری...</div>
        ) : (
          <div className="space-y-2.5">
            {MAPPING_ROWS.map(row => {
              const isDisabled = disabled.includes(row.key);
              const currentCode = mappings[row.key] || '';
              return (
                <div key={row.key} className={`p-3 rounded-xl border transition ${isDisabled ? 'border-slate-100 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/60' : 'border-blue-100 dark:border-blue-900/50 bg-blue-50/30 dark:bg-blue-900/10'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-black text-slate-800 dark:text-white">{row.label}</span>
                        {!isDisabled && currentCode && (
                          <span className="text-[10px] font-mono font-bold text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/40 px-1.5 py-0.5 rounded">{currentCode}</span>
                        )}
                        {isDisabled && (
                          <span className="text-[10px] font-bold text-slate-500 bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 rounded">کدینگ پیش‌فرض</span>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-5">{row.description}</p>
                      {!isDisabled && (
                        <div className="mt-2">
                          <AccountSearchSelect
                            accounts={accounts}
                            value={(() => {
                              const acc = accounts.find(a => a.code === currentCode);
                              return acc ? acc.id : '';
                            })()}
                            onChange={(accountId) => {
                              const acc = accounts.find(a => a.id === accountId);
                              setMappings(prev => ({ ...prev, [row.key]: acc ? acc.code : currentCode }));
                            }}
                            placeholder="انتخاب حساب معین از چارت حساب‌ها..."
                            className="max-w-md"
                          />
                        </div>
                      )}
                    </div>
                    {/* سوییچ فعال/غیرفعال سفارشی‌سازی */}
                    <button
                      onClick={() => toggleDisabled(row.key)}
                      title={isDisabled ? 'سفارشی‌سازی خاموش — استفاده از کدینگ پیش‌فرض' : 'سفارشی‌سازی روشن'}
                      className={`relative w-11 h-6 rounded-full transition-colors shrink-0 cursor-pointer ${isDisabled ? 'bg-slate-300 dark:bg-slate-600' : 'bg-blue-600'}`}
                    >
                      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${isDisabled ? 'right-0.5' : 'right-[22px]'}`} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
