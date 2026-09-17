import { useEffect, useState } from 'react';
import { Lock, ShieldCheck, Terminal, RefreshCw } from 'lucide-react';
import { fetchJson } from '../../api';

/** V1.1.1: خروجی GET /system/env — فقط وضعیت set/not-set؛ هرگز مقدار secret ها */
interface SystemEnvInfo {
  db: 'set' | 'not set';
  nodeEnv: string;
  nodeVersion: string;
  flags: Record<string, 'set' | 'not set'>;
}

/** V4.0.29: تب پیکربندی سیستمی فقط نمایشی است — روت‌های اجرای آزمون درون‌برنامه‌ای
 * حذف شده‌اند و اجرای آزمون‌ها فقط از طریق CLI استاندارد `npm run test` انجام می‌شود. */
const NODE_ENV_HELP: Record<string, string> = {
  development:
    'حالت توسعه: سید خودکار دیتابیس فعال است، فرانت‌اند با Vite و HMR سرو می‌شود و خطاهای داخلی با جزئیات کامل نمایش داده می‌شوند.',
  production:
    'حالت عملیاتی: سید خودکار غیرفعال، فایل‌های build‌شده سرو می‌شوند، جزئیات خطاهای ۵۰۰ مخفی می‌شود و کدهای تست از باندل حذف شده‌اند.',
  test:
    'حالت تست خودکار: توسط اجراکننده تست‌ها (npm run test) استفاده می‌شود و برای کاربرد عملیاتی روزمره نیست.'
};

/** فلگ‌های فقط-فایل — عمداً از UI قابل تغییر نیستند */
const LOCKED_FLAGS: Array<{ key: string; label: string; reason: string }> = [
  {
    key: 'ERP_ALLOW_TEST_CLEANUP',
    label: 'کلید پاکسازی داده‌های تست',
    reason:
      'این کلید اجازه حذف رکوردهای آزمایشی از دیتابیس را می‌دهد و عمداً فقط از فایل .env قابل تنظیم است تا گارد ایمنی تخریب داده با یک کلیک ساده باز نشود. اجرای `npm run test` آن را به‌صورت خودکار و موقت فعال می‌کند.'
  },
  {
    key: 'JWT_SECRET',
    label: 'کلید امضای توکن‌های احراز هویت',
    reason:
      'راز رمزنگاری جلسات کاربران است؛ نمایش یا ویرایش آن از رابط کاربری حفره امنیتی ایجاد می‌کند. تغییر آن فقط با ویرایش فایل .env و ری‌استارت سرور (که همه کاربران را از جلسه خارج می‌کند) مجاز است.'
  },
  {
    key: 'DATABASE_URL',
    label: 'رشته اتصال به پایگاه‌داده',
    reason:
      'در زمان راه‌اندازی سرور خوانده می‌شود و شامل نام کاربری و رمز عبور دیتابیس است. تغییر آن فقط از طریق فایل .env و ری‌استارت سرور ممکن است.'
  },
  {
    key: 'ALLOW_SEED_IN_PRODUCTION',
    label: 'مجوز سید خودکار در production',
    reason:
      'به‌طور پیش‌فرض در محیط عملیاتی غیرفعال است. فعال‌سازی آن فقط با ویرایش فایل .env و با آگاهی کامل از خطر بازنویسی داده‌های پیش‌فرض مجاز است.'
  }
];

export function SystemConfigTab() {
  const [envInfo, setEnvInfo] = useState<SystemEnvInfo | null>(null);
  const [isLoadingEnv, setIsLoadingEnv] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoadingEnv(true);
    fetchJson<SystemEnvInfo>('/system/env', { signal: controller.signal })
      .then(setEnvInfo)
      .catch((err) => {
        if (err?.name === 'AbortError') return;
      })
      .finally(() => setIsLoadingEnv(false));
    return () => controller.abort();
  }, []);

  const nodeEnv = envInfo?.nodeEnv || 'development';
  const nodeEnvHelp = NODE_ENV_HELP[nodeEnv] || NODE_ENV_HELP.development;

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-xs p-6 max-w-4xl mx-auto space-y-8 text-right font-farsi">
      {/* Section 1: حالت اجرا (فقط نمایش) */}
      <div>
        <h3 className="font-bold border-b border-slate-200 pb-3 mb-6 text-slate-800 flex items-center gap-2 text-base">
          <ShieldCheck size={18} className="text-indigo-600" /> حالت اجرای سامانه (فقط نمایش)
        </h3>
        {isLoadingEnv ? (
          <div className="flex items-center gap-2 text-xs text-slate-500 py-4">
            <RefreshCw size={14} className="animate-spin" /> در حال دریافت وضعیت محیط...
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <span className={`px-3 py-1 rounded-full text-xs font-bold border ${
                nodeEnv === 'production'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                  : 'bg-amber-50 text-amber-700 border-amber-300'
              }`}>
                NODE_ENV = {nodeEnv === 'production' ? 'production (عملیاتی)' : `${nodeEnv} (غیرعملیاتی)`}
              </span>
              <span className="text-[11px] text-slate-400 font-mono" dir="ltr">{envInfo?.nodeVersion}</span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 border border-slate-200 rounded-lg p-3">
              {nodeEnvHelp}
            </p>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              این حالت در زمان راه‌اندازی سرور از فایل <span className="font-mono" dir="ltr">.env</span> خوانده و قفل می‌شود و عمداً از رابط کاربری قابل تغییر نیست؛ زیرا همه‌ی قفل‌های ایمنی سامانه (سید دیتابیس، پاکسازی داده) به آن وابسته‌اند. تغییر آن نیازمند ویرایش فایل و ری‌استارت سرور است.
            </p>
          </div>
        )}
      </div>

      {/* Section 2: فلگ‌های فقط-فایل */}
      <div>
        <h3 className="font-bold border-b border-slate-200 pb-3 mb-6 text-slate-800 flex items-center gap-2 text-base">
          <Lock size={18} className="text-slate-500" /> متغیرهای فقط-فایل (قفل‌شده)
        </h3>
        <div className="space-y-3">
          {LOCKED_FLAGS.map((flag) => (
            <div key={flag.key} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Lock size={13} className="text-slate-400" />
                  <span className="text-sm font-bold text-slate-700">{flag.label}</span>
                  <span className="text-[10px] font-mono text-slate-400" dir="ltr">{flag.key}</span>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-mono ${
                  envInfo?.flags?.[flag.key] === 'set'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-slate-100 text-slate-500 border-slate-200'
                }`}>
                  {envInfo?.flags?.[flag.key] === 'set' ? 'set' : 'not set'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">{flag.reason}</p>
            </div>
          ))}
          <p className="text-[11px] text-slate-500 leading-relaxed flex items-start gap-1.5">
            <Terminal size={13} className="shrink-0 mt-0.5" />
            برای تغییر متغیرهای بالا، فایل <span className="font-mono" dir="ltr">.env</span> را ویرایش و سرور را ری‌استارت کنید. مقادیر این متغیرها به‌دلایل امنیتی هرگز از سرور دریافت یا نمایش داده نمی‌شوند (فقط وضعیت تنظیم‌بودن/تنظیم‌نبودن).
          </p>
        </div>
      </div>
    </div>
  );
}
