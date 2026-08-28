import React, { useState, useEffect } from 'react';
import { Sliders, Check, ShieldAlert, AlertTriangle, CheckCircle, Info } from 'lucide-react';
import { fetchJson } from '../../api';

export function NegativeStockPolicySettingsTab() {
  const [currentPolicy, setCurrentPolicy] = useState<string>('forbidden');
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadPolicy = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetchJson('/inventory/negative-stock-policy');
      if (res && res.policy) {
        setCurrentPolicy(res.policy);
      }
    } catch (err) {
      setErrorMsg(err.message || 'خطا در دریافت سیاست موجودی منفی');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPolicy();
  }, []);

  const handlePolicyChange = async (newPolicy: string) => {
    if (newPolicy === currentPolicy || updating) return;
    setUpdating(true);
    setSuccessMsg(null);
    setErrorMsg(null);
    try {
      await fetchJson('/inventory/negative-stock-policy', {
        method: 'PUT',
        body: JSON.stringify({ policy: newPolicy })
      });
      setCurrentPolicy(newPolicy);
      setSuccessMsg('سیاست کنترل موجودی منفی با موفقیت به‌روزرسانی شد.');
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err) {
      setErrorMsg(err.message || 'خطا در تغییر سیاست موجودی منفی');
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl font-farsi">
      {/* Header Info */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
            <Sliders size={24} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-800">سیاست کنترل موجودی منفی (Negative Stock Policy)</h2>
            <p className="text-slate-500 text-xs mt-0.5">
              تنظیم شیوه برخورد سیستم در زمان صدور فاکتور فروش، حواله خروج انبار یا تخصیص به پروژه هنگام ناکافی بودن موجودی
            </p>
          </div>
        </div>

        {successMsg && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs flex items-center gap-2">
            <Check size={16} className="text-emerald-600" />
            <span className="font-bold">{successMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-2">
            <ShieldAlert size={16} className="text-rose-600" />
            <span className="font-bold">{errorMsg}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          {/* Forbidden */}
          <div
            onClick={() => handlePolicyChange('forbidden')}
            className={`border-2 rounded-2xl p-5 cursor-pointer transition-all flex flex-col justify-between ${
              currentPolicy === 'forbidden'
                ? 'border-rose-500 bg-rose-50/50 shadow-sm'
                : 'border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="p-2 bg-rose-100 text-rose-700 rounded-lg">
                  <ShieldAlert size={20} />
                </div>
                {currentPolicy === 'forbidden' && (
                  <span className="bg-rose-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                    <Check size={10} /> فعال
                  </span>
                )}
              </div>
              <h3 className="font-bold text-slate-800 text-sm mb-1">ممنوع (Strict Mode)</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                رد کامل هرگونه تراکنش خروج در صورت عدم وجود موجودی کافی. هیچ سندی امکان کسر مازاد بر موجودی را ندارد.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-rose-700 font-bold">
              توصیه شده برای تولید واقعی
            </div>
          </div>

          {/* Warning */}
          <div
            onClick={() => handlePolicyChange('warning')}
            className={`border-2 rounded-2xl p-5 cursor-pointer transition-all flex flex-col justify-between ${
              currentPolicy === 'warning'
                ? 'border-amber-500 bg-amber-50/50 shadow-sm'
                : 'border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="p-2 bg-amber-100 text-amber-700 rounded-lg">
                  <AlertTriangle size={20} />
                </div>
                {currentPolicy === 'warning' && (
                  <span className="bg-amber-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                    <Check size={10} /> فعال
                  </span>
                )}
              </div>
              <h3 className="font-bold text-slate-800 text-sm mb-1">هشدار (Warning Mode)</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                نمایش پیام هشدار کسری انبار به کاربر اما امکان تایید و ثبت نهایی سند با کسری موجودی فراهم است.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-amber-700 font-bold">
              انعطاف‌پذیر با اطلاع‌رسانی
            </div>
          </div>

          {/* Allowed */}
          <div
            onClick={() => handlePolicyChange('allowed')}
            className={`border-2 rounded-2xl p-5 cursor-pointer transition-all flex flex-col justify-between ${
              currentPolicy === 'allowed'
                ? 'border-blue-500 bg-blue-50/50 shadow-sm'
                : 'border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="p-2 bg-blue-100 text-blue-700 rounded-lg">
                  <CheckCircle size={20} />
                </div>
                {currentPolicy === 'allowed' && (
                  <span className="bg-blue-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                    <Check size={10} /> فعال
                  </span>
                )}
              </div>
              <h3 className="font-bold text-slate-800 text-sm mb-1">مجاز (Allowed Mode)</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                صدور و ثبت اسناد بدون هیچ‌گونه محدودیت یا مانعی انجام شده و موجودی انبار می‌تواند منفی گردد.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-blue-700 font-bold">
              بدون کنترل موجودی انبار
            </div>
          </div>
        </div>
      </div>

      {/* Details / Guidance Card */}
      <div className="bg-blue-50/60 border border-blue-200 rounded-2xl p-5 text-xs text-blue-900 leading-relaxed space-y-2">
        <div className="font-bold flex items-center gap-2 text-sm text-blue-950">
          <Info size={16} className="text-blue-600" />
          <span>توضیحات تکمیلی عملکرد سیاست‌های موجودی:</span>
        </div>
        <p>
          • <strong>ممنوع (Strict):</strong> تمام عملیات مرتبط با صدور فاکتور فروش (با کسر از انبار)، حواله خروج انبار، و تخصیص مستقیم مواد اولیه به پروژه‌ها در صورتی که موجودی کافی در انبار انتخابی وجود نداشته باشد، با پیغام خطای اعتبارسنجی متوقف می‌شوند.
        </p>
        <p>
          • <strong>انبارگردانی و ممیزی سلامت:</strong> جهت مشاهده ماتریس ۳ جانبه سلامت انبار، تطبیق کاردکس و ثبت شمارش‌های عینی به بخش «انبارگردانی و تطبیق ۳جانبه» در منوی اصلی سامانه مراجعه نمایید.
        </p>
      </div>
    </div>
  );
}
