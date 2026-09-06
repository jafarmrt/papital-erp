import React, { useState } from 'react';
import { fetchJson } from '../api';
import { User } from '../types';
import { Shield, Building2, User as UserIcon, Lock, KeyRound, CheckCircle2, ArrowRight, ArrowLeft, Upload, Image as ImageIcon, Phone, MapPin, DollarSign, Eye, EyeOff } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { compressTo300KB } from '../utils/imageCompression';

interface SetupPageProps {
  onLogin: (user: User, token: string) => void;
}

export default function SetupPage({ onLogin }: SetupPageProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  // Step 1: Admin Account State & Setup Security Token (SEC-012)
  const [setupToken, setSetupToken] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('token') || params.get('setupToken') || 'papital_erp_setup_token_2026';
    } catch {
      return 'papital_erp_setup_token_2026';
    }
  });
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Step 2: Business & Invoice Details State
  const [companyName, setCompanyName] = useState('سامانه جامع ERP پاپیتال');
  const [warehouseName, setWarehouseName] = useState('انبار مرکزی');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [currency, setCurrency] = useState('IRR');
  const [logoPreview, setLogoPreview] = useState<string>('');

  // Logo file upload handler
  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        toast.error('لطفاً یک فایل تصویری برای لوگو انتخاب کنید');
        return;
      }
      try {
        // V10-2.3: استاندارد واحد فشرده‌سازی تصاویر (سقف ۳۰۰ کیلوبایت)
        const dataUrl = await compressTo300KB(file);
        setLogoPreview(dataUrl);
      } catch {
        toast.error('خطا در پردازش تصویر. لطفاً فایل دیگری انتخاب کنید.');
      }
    }
  };

  const handleNextStep = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!fullName.trim()) {
      setError('لطفاً نام و نام خانوادگی مدیر را وارد کنید');
      return;
    }
    if (!username.trim() || username.length < 3) {
      setError('نام کاربری باید حداقل ۳ کاراکتر باشد');
      return;
    }
    if (!password || password.length < 6) {
      setError('رمز عبور باید حداقل ۶ کاراکتر باشد');
      return;
    }
    if (password !== confirmPassword) {
      setError('رمز عبور و تکرار آن یکسان نیستند');
      return;
    }

    setStep(2);
  };

  const handleFinalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSaving(true);

    try {
      const body = {
        fullName: fullName.trim(),
        username: username.trim(),
        password,
        companyName: companyName.trim() || 'سامانه جامع ERP پاپیتال',
        warehouseName: warehouseName.trim() || 'انبار مرکزی',
        phone: phone.trim(),
        address: address.trim(),
        currency,
        logo: logoPreview,
        setupToken: setupToken.trim()
      };

      const res = await fetchJson('/setup', {
        method: 'POST',
        headers: {
          'x-setup-token': setupToken.trim()
        },
        body: JSON.stringify(body)
      });

      if (res.success) {
        toast.success('سیستم با موفقیت راه‌اندازی شد. خوش آمدید!');
        onLogin(res.user, res.token);
      }
    } catch (err: any) {
      setError(err.message || 'خطا در راه‌اندازی اولیه سیستم');
    } finally {
      setIsSaving(false);
    }
  };

  // Password strength checker helper
  const getPasswordStrength = () => {
    if (!password) return { score: 0, label: '', color: '' };
    if (password.length < 6) return { score: 1, label: 'ضعیف', color: 'bg-red-500' };
    if (password.length < 10 || !/\d/.test(password)) return { score: 2, label: 'متوسط', color: 'bg-amber-500' };
    return { score: 3, label: 'قوی', color: 'bg-emerald-500' };
  };

  const passwordStrength = getPasswordStrength();

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center items-center p-4 font-sans text-slate-800" dir="rtl">
      {/* Container */}
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden border border-slate-200">
        
        {/* Header Banner */}
        <div className="bg-slate-900 text-white p-6 md:p-8 text-center relative overflow-hidden border-b border-slate-800">
          <div className="absolute -left-10 -bottom-10 w-40 h-40 bg-blue-600/20 rounded-full blur-2xl pointer-events-none" />
          <div className="absolute -right-10 -top-10 w-40 h-40 bg-indigo-600/20 rounded-full blur-2xl pointer-events-none" />
          
          <div className="relative z-10 flex flex-col items-center">
            <div className="w-14 h-14 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg mb-3">
              <Shield size={28} />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">راه‌اندازی اولیه سامانه جامع مدیریت و ERP پاپیتال</h1>
            <p className="text-slate-400 text-sm mt-1">پیکربندی حساب مدیر ارشد و اطلاعات کارگاه / سازمان</p>
          </div>

          {/* Stepper Header */}
          <div className="flex items-center justify-center gap-4 mt-8 max-w-md mx-auto">
            {/* Step 1 Indicator */}
            <div className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              step === 1 ? 'bg-blue-600 text-white shadow-md' : 'bg-slate-800 text-slate-300'
            }`}>
              <UserIcon size={16} />
              <span>۱. حساب مدیریت</span>
            </div>

            <div className="w-8 h-0.5 bg-slate-700" />

            {/* Step 2 Indicator */}
            <div className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              step === 2 ? 'bg-blue-600 text-white shadow-md' : 'bg-slate-800 text-slate-300'
            }`}>
              <Building2 size={16} />
              <span>۲. اطلاعات فروشگاه / کارگاه</span>
            </div>
          </div>
        </div>

        {/* Form Body */}
        <div className="p-6 md:p-8 bg-slate-50">
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl font-medium flex items-center gap-2">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {step === 1 ? (
            /* STEP 1 FORM: ADMIN ACCOUNT */
            <form onSubmit={handleNextStep} className="space-y-5">
              <div className="border-b pb-3 mb-4">
                <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
                  <UserIcon size={20} className="text-blue-600" />
                  تعیین مشخصات مدیر ارشد سیستم
                </h2>
                <p className="text-xs text-slate-500 mt-1">اطلاعات ورود مدیر برای دسترسی کامل به تمامی امکانات مدیریت، انبار، تولید و مالی</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  توکن امنیتی راه‌اندازی (ERP_SETUP_TOKEN) <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <KeyRound className="absolute right-3 top-3 text-slate-400" size={18} />
                  <input
                    required
                    type="text"
                    value={setupToken}
                    onChange={e => setSetupToken(e.target.value)}
                    dir="ltr"
                    placeholder="توکن امنیتی تعریف شده در متغیر محیطی ERP_SETUP_TOKEN"
                    className="w-full pr-10 pl-3 py-2.5 bg-white border border-slate-300 rounded-xl text-sm font-mono text-left focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                </div>
                <p className="text-xs text-slate-500 mt-1">جهت حفاظت امنیتی از راه‌اندازی اولیه، توکن تعیین‌شده در سرور را وارد نمایید.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">نام و نام خانوادگی مدیر <span className="text-red-500">*</span></label>
                <div className="relative">
                  <UserIcon className="absolute right-3 top-3 text-slate-400" size={18} />
                  <input
                    required
                    type="text"
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    placeholder="مثال: علی رضایی"
                    className="w-full pr-10 pl-3 py-2.5 bg-white border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">نام کاربری اختصاصی <span className="text-red-500">*</span></label>
                <div className="relative">
                  <UserIcon className="absolute right-3 top-3 text-slate-400" size={18} />
                  <input
                    required
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    dir="ltr"
                    placeholder="admin"
                    className="w-full pr-10 pl-3 py-2.5 bg-white border border-slate-300 rounded-xl text-sm font-mono text-left focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                </div>
                <p className="text-xs text-slate-500 mt-1">نام کاربری ورود به سیستم (حداقل ۳ حرف انگلیسی)</p>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">کلمه عبور اختصاصی <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <Lock className="absolute right-3 top-3 text-slate-400" size={18} />
                    <input
                      required
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      minLength={6}
                      dir="ltr"
                      placeholder="••••••••"
                      className="w-full pr-10 pl-10 py-2.5 bg-white border border-slate-300 rounded-xl text-sm font-mono text-left focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute left-3 top-3 text-slate-400 hover:text-slate-600"
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  
                  {/* Strength Bar */}
                  {password && (
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all ${passwordStrength.color}`}
                          style={{ width: `${(passwordStrength.score / 3) * 100}%` }}
                        />
                      </div>
                      <span className="text-[11px] font-bold text-slate-500">{passwordStrength.label}</span>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">تکرار کلمه عبور <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <Lock className="absolute right-3 top-3 text-slate-400" size={18} />
                    <input
                      required
                      type={showPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      minLength={6}
                      dir="ltr"
                      placeholder="••••••••"
                      className="w-full pr-10 pl-3 py-2.5 bg-white border border-slate-300 rounded-xl text-sm font-mono text-left focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-4 flex justify-end">
                <button
                  type="submit"
                  className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl font-medium text-sm flex items-center gap-2 shadow-md hover:shadow-lg transition-all"
                >
                  <span>گام بعدی: اطلاعات کسب‌وکار</span>
                  <ArrowLeft size={18} />
                </button>
              </div>
            </form>
          ) : (
            /* STEP 2 FORM: BUSINESS DETAILS */
            <form onSubmit={handleFinalSubmit} className="space-y-5">
              <div className="border-b pb-3 mb-4">
                <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
                  <Building2 size={20} className="text-blue-600" />
                  اطلاعات فروشگاه / شرکت جهت درج در سربرگ فاکتور
                </h2>
                <p className="text-xs text-slate-500 mt-1">این اطلاعات روی فاکتورها، پیش‌فاکتورها و حواله‌های چاپی نمایش داده می‌شود.</p>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">نام فروشگاه / شرکت <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <Building2 className="absolute right-3 top-3 text-slate-400" size={18} />
                    <input
                      required
                      type="text"
                      value={companyName}
                      onChange={e => setCompanyName(e.target.value)}
                      placeholder="مثال: فروشگاه مرکزی انبار"
                      className="w-full pr-10 pl-3 py-2.5 bg-white border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">شماره تماس پشتیبانی / دفتر</label>
                  <div className="relative">
                    <Phone className="absolute right-3 top-3 text-slate-400" size={18} />
                    <input
                      type="text"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      placeholder="02188888888"
                      className="w-full pr-10 pl-3 py-2.5 bg-white border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">آدرس فروشگاه / انبار مرکزی</label>
                <div className="relative">
                  <MapPin className="absolute right-3 top-3 text-slate-400" size={18} />
                  <input
                    type="text"
                    value={address}
                    onChange={e => setAddress(e.target.value)}
                    placeholder="مثال: تهران، خیابان آزادی، پلاک ۱۲"
                    className="w-full pr-10 pl-3 py-2.5 bg-white border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4 items-start">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">نام انبار پیش‌فرض <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <Building2 className="absolute right-3 top-3 text-slate-400" size={18} />
                    <input
                      required
                      type="text"
                      value={warehouseName}
                      onChange={e => setWarehouseName(e.target.value)}
                      placeholder="مثال: انبار مرکزی"
                      className="w-full pr-10 pl-3 py-2.5 bg-white border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">واحد پول اصلی فاکتورها</label>
                  <div className="relative">
                    <DollarSign className="absolute right-3 top-3 text-slate-400" size={18} />
                    <select
                      value={currency}
                      onChange={e => setCurrency(e.target.value)}
                      className="w-full pr-10 pl-3 py-2.5 bg-white border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    >
                      <option value="IRR">ریال (IRR)</option>
                      <option value="TOMAN">تومان (Toman)</option>
                      <option value="USD">دلار ($)</option>
                      <option value="EUR">یورو (€)</option>
                      <option value="AED">درهم (AED)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">لوگوی برند / فروشگاه (اختیاری)</label>
                  <div className="flex items-center gap-3">
                    {logoPreview ? (
                      <div className="relative w-16 h-16 border rounded-xl overflow-hidden bg-white p-1 shrink-0 flex items-center justify-center">
                        <img src={logoPreview} alt="Logo Preview" className="max-w-full max-h-full object-contain" />
                        <button
                          type="button"
                          onClick={() => setLogoPreview('')}
                          className="absolute top-0 right-0 bg-red-600 text-white rounded-bl p-0.5 text-[10px]"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <div className="w-16 h-16 border-2 border-dashed border-slate-300 rounded-xl flex flex-col items-center justify-center text-slate-400 shrink-0">
                        <ImageIcon size={20} />
                      </div>
                    )}
                    <label className="flex-1 cursor-pointer bg-white border border-slate-300 hover:bg-slate-50 px-4 py-2.5 rounded-xl text-xs font-medium text-slate-700 flex items-center justify-center gap-2 transition-colors">
                      <Upload size={16} />
                      <span>{logoPreview ? 'تغییر تصویر لوگو' : 'بارگذاری فایل لوگو'}</span>
                      <input type="file" accept="image/*" onChange={handleLogoChange} className="hidden" />
                    </label>
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t flex justify-between items-center">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-5 py-2.5 rounded-xl font-medium text-sm flex items-center gap-2 transition-colors"
                >
                  <ArrowRight size={18} />
                  <span>بازگشت به گام ۱</span>
                </button>

                <button
                  type="submit"
                  disabled={isSaving}
                  className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-8 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 shadow-md hover:shadow-lg transition-all"
                >
                  <CheckCircle2 size={18} />
                  <span>{isSaving ? 'در حال ایجاد سیستم...' : 'تکمیل و ورود به سامانه'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
