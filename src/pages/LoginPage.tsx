import React, { useState, useEffect, useCallback } from 'react';
import { fetchJson } from '../api';
import { User } from '../types';
import { Lock, User as UserIcon, Shield, AlertTriangle, ShieldAlert, Eye, EyeOff } from 'lucide-react';
import SetupPage from './SetupPage';

export default function LoginPage({ onLogin }: { onLogin: (user: User, token: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSetup, setIsSetup] = useState<boolean | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [companyLogo, setCompanyLogo] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [lockoutMinutes, setLockoutMinutes] = useState<number | null>(null);
  // V9 Phase 4.3: شمارش معکوس زنده lockout + toggle نمایش رمز عبور
  const [lockoutSecondsLeft, setLockoutSecondsLeft] = useState<number | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchJson('/check-setup', { signal: controller.signal })
      .then(res => {
        setIsSetup(res.isSetup);
        if (res.companyLogo) setCompanyLogo(res.companyLogo);
        if (res.companyName) setCompanyName(res.companyName);
      })
      .catch(err => {
        if (err?.name === 'AbortError') return;
        console.error('Failed to check setup', err);
        setIsSetup(true); // Default to login on error
      });
    return () => controller.abort();
  }, []);

  // تایمر شمارش معکوس قفل حساب — هنگام رسیدن به صفر، فرم به‌طور خودکار باز می‌شود
  useEffect(() => {
    if (lockoutSecondsLeft === null) return;
    if (lockoutSecondsLeft <= 0) {
      setLockoutSecondsLeft(null);
      setLockoutMinutes(null);
      setError('');
      return;
    }
    const t = setTimeout(() => setLockoutSecondsLeft(prev => (prev !== null ? prev - 1 : null)), 1000);
    return () => clearTimeout(t);
  }, [lockoutSecondsLeft]);

  const startLockoutCountdown = useCallback((minutes: number) => {
    setLockoutMinutes(minutes);
    setLockoutSecondsLeft(minutes * 60);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError('');
    setLockoutMinutes(null);
    try {
      const res = await fetchJson('/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      if (res.success) {
        onLogin(res.user, res.token);
      }
    } catch (err: any) {
      setError(err.message || 'خطا در ارتباط با سرور');
      if (err.status === 429 || (err.message && err.message.includes('قفل'))) {
        // Extract minutes if present
        const match = err.message?.match(/(\d+)\s*دقیقه/);
        if (match && match[1]) {
          startLockoutCountdown(parseInt(match[1], 10));
        } else {
          startLockoutCountdown(15);
        }
      }
    } finally {
      setIsSaving(false);
    }
  };

  if (isSetup === null) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500 font-sans" dir="rtl">در حال بررسی وضعیت سیستم...</div>;
  }

  if (isSetup === false) {
    return <SetupPage onLogin={onLogin} />;
  }

  const isLocked = lockoutSecondsLeft !== null && lockoutSecondsLeft > 0;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 font-sans" dir="rtl">
      <div className="bg-white p-8 rounded-xl shadow-sm border w-full max-w-md">
        <div className="text-center mb-8">
          {companyLogo ? (
            <div className="w-16 h-16 bg-white border border-slate-200 rounded-2xl p-1.5 mx-auto mb-4 flex items-center justify-center shadow-sm">
              <img src={companyLogo} alt="Logo" className="max-w-full max-h-full object-contain" />
            </div>
          ) : (
            <div className="w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-white text-xl mx-auto mb-4">
              <Shield size={24} />
            </div>
          )}
          <h1 className="text-2xl font-bold text-slate-800">
            {companyName ? `ورود به ${companyName}` : 'ورود به سامانه جامع ERP پاپیتال'}
          </h1>
          <p className="text-slate-500 mt-2 text-sm">
            لطفاً برای ورود به سیستم اطلاعات خود را وارد کنید.
          </p>
        </div>

        {isLocked ? (
          <div className="bg-rose-50 border border-rose-200 text-rose-800 p-4 rounded-xl mb-5 flex items-start gap-3 text-xs leading-relaxed">
            <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-bold text-rose-900">حساب کاربری موقتاً مسدود شد (Lockout)</p>
              <p className="mt-1 text-rose-700">
                به دلیل ۵ تلاش ناموفق مکرر و به منظور حفاظت از حساب کاربری، ورود به مدت {lockoutMinutes} دقیقه مسدود گردید.
              </p>
              <p className="mt-2 text-center font-mono font-black text-lg text-rose-900" aria-live="polite">
                {String(Math.floor(lockoutSecondsLeft / 60)).padStart(2, '0')}:{String(lockoutSecondsLeft % 60).padStart(2, '0')}
              </p>
              <p className="text-center text-[10px] text-rose-600 mt-1">پس از پایان شمارش معکوس، فرم ورود به‌طور خودکار فعال می‌شود.</p>
            </div>
          </div>
        ) : error ? (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-lg mb-4 text-xs font-medium flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">نام کاربری</label>
            <div className="relative">
              <UserIcon className="absolute right-3 top-2.5 text-slate-400" size={18} />
              <input 
                required 
                type="text" 
                value={username} 
                onChange={e => setUsername(e.target.value)} 
                disabled={isLocked}
                className="w-full pr-10 pl-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-400" 
                dir="ltr"
                placeholder="نام کاربری"
              />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">رمز عبور</label>
            <div className="relative">
              <Lock className="absolute right-3 top-2.5 text-slate-400" size={18} />
              <input 
                required 
                type={showPassword ? 'text' : 'password'} 
                value={password} 
                onChange={e => setPassword(e.target.value)} 
                disabled={isLocked}
                className="w-full pr-10 pl-10 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-400" 
                dir="ltr"
                placeholder="کلمه عبور"
              />
              <button
                type="button"
                onClick={() => setShowPassword(prev => !prev)}
                className="absolute left-2.5 top-2 p-0.5 text-slate-400 hover:text-slate-700 rounded transition-colors cursor-pointer"
                title={showPassword ? 'مخفی کردن رمز عبور' : 'نمایش رمز عبور'}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          
          <button 
            type="submit" 
            disabled={isSaving || isLocked} 
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition-colors mt-4"
          >
            {isSaving ? 'در حال ورود...' : isLocked ? 'حساب قفل است — در انتظار فعال‌سازی' : 'ورود به سیستم'}
          </button>
        </form>
      </div>
    </div>
  );
}
