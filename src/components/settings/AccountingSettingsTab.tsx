import { useEffect, useMemo, useState } from 'react';
import { fetchJson } from '../../api';
import { toast } from 'react-hot-toast';
import { RefreshCw, Save, ShieldCheck, Info, Check } from 'lucide-react';
import { AccountSearchSelect } from '../accounting/AccountSearchSelect';
import type { Account } from '../../types';
import { formatPersianNumber } from '../../utils';
import { postingAccountsOf } from '../../lib/accounting/postingAccount';
import {
  ACCOUNT_MAPPING_CONCEPTS, accountTypeFitsConcept, conceptAccountTypesText, type AccountMappingConcept,
} from '../../lib/accounting/accountMappingConcepts';

// V1.7.0 — تب «تنظیمات حسابداری»: نگاشت سندهای خودکار دوبل + همگام‌سازی کدینگ پیش‌فرض.
// v9.0.199 (TD-550، B03-08): همه ۲۶ مفهوم سرور از فهرست مشترک (پیش‌تر ۲۳ ردیف؛ کالای در جریان ساخت، حقوق ثابت و
// کسورات نبودند) و انتخابگر هر مفهوم فقط حساب قابل ثبت با نوع همان مفهوم را نشان می‌دهد (پیش‌تر «۱ دارایی‌ها» هم بود).
function mappingAccountsFor(concept: AccountMappingConcept, postingAccounts: Account[]): Account[] {
  return postingAccounts.filter(a => accountTypeFitsConcept(concept, a.accountType));
}

// v9.0.131 (TD-668): استقرار کدینگ پیش‌فرض فقط برای مدیر سیستم است (همان گارد API)؛ دیگران فقط پیام آن را می‌بینند
export function AccountingSettingsTab({ currentUser, canSeedDefaults = true }: { currentUser: any; canSeedDefaults?: boolean }) {
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [disabled, setDisabled] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountsCount, setAccountsCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const postingAccounts = useMemo(() => postingAccountsOf(accounts), [accounts]);

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
    void loadData(controller.signal);
    return () => controller.abort();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await fetchJson('/accounting/mappings', {
        method: 'POST',
        body: JSON.stringify({ ...mappings, disabled }),
      });
      toast.success('نگاشت حساب‌ها ذخیره شد');
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
              هنوز هیچ حسابی در درخت حساب‌ها تعریف نشده است. با دکمه زیر، ساختار کدینگ استاندارد
              (گروه‌ها، معین‌ها و تفصیلی‌های پیش‌فرض نرم‌افزار) یک‌جا مستقر و همگام می‌شود.
            </p>
            {canSeedDefaults ? (
            <button
              onClick={handleSeedDefault}
              disabled={isSeeding}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition shadow-sm disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw size={14} className={isSeeding ? 'animate-spin' : ''} />
              <span>{isSeeding ? 'در حال استقرار...' : 'همگام‌سازی کدینگ پیش‌فرض'}</span>
            </button>
            ) : (
              <p className="text-xs text-amber-700 font-bold">استقرار کدینگ پیش‌فرض با مدیر سیستم است.</p>
            )}
          </>
        ) : (
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-6 flex items-center gap-1.5">
            <Check size={14} className="text-emerald-600 shrink-0" />
            درخت حساب‌ها فعال است ({formatPersianNumber(accountsCount)} حساب تعریف‌شده) — نیازی به همگام‌سازی پیش‌فرض نیست.
            مدیریت کدینگ از بخش <span className="font-bold">حسابداری ← کدینگ حساب‌ها</span> انجام می‌شود.
          </p>
        )}
      </div>

      {/* Section 2: نگاشت سندهای خودکار */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Info size={18} className="text-blue-600" />
            <h3 className="font-black text-slate-900 dark:text-white text-sm">نگاشت حساب سندهای خودکار</h3>
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
          سندهای خودکار فروش، خرید، خزانه، چک صیادی، حقوق، تولید و بستن سال مالی این حساب‌ها را می‌گیرند.
          برای هر مفهوم حساب معین یا تفصیلی با نوع همان مفهوم انتخاب کنید؛ با خاموش کردن کلید، مفهوم به کدینگ پیش‌فرض برمی‌گردد.
        </p>

        {loading ? (
          <div className="py-10 text-center text-slate-400 text-sm">در حال بارگذاری...</div>
        ) : (
          <div className="space-y-2.5">
            {ACCOUNT_MAPPING_CONCEPTS.map(row => {
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
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-5">{row.description} (نوع حساب: {conceptAccountTypesText(row)})</p>
                      {!isDisabled && (
                        <div className="mt-2">
                          <AccountSearchSelect
                            accounts={mappingAccountsFor(row, postingAccounts)}
                            value={(() => {
                              const acc = accounts.find(a => a.code === currentCode);
                              return acc ? acc.id : '';
                            })()}
                            onChange={(accountId) => {
                              const acc = accounts.find(a => a.id === accountId);
                              setMappings(prev => ({ ...prev, [row.key]: acc ? acc.code : currentCode }));
                            }}
                            placeholder="انتخاب حساب معین یا تفصیلی..."
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
