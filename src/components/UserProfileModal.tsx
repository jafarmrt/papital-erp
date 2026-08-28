import React, { useState, useEffect, useRef } from 'react';
import { 
  User as UserIcon, Lock, Camera, Check, X, Eye, EyeOff, ShieldCheck, KeyRound, 
  UploadCloud, AlertCircle, RefreshCw
} from 'lucide-react';
import { User } from '../types';
import { fetchJson } from '../api';
import { compressTo300KB } from '../utils/imageCompression';
import toast from 'react-hot-toast';

interface UserProfileModalProps {
  user: User;
  isOpen: boolean;
  onClose: () => void;
  onUserUpdate: (updatedUser: User) => void;
}

export default function UserProfileModal({ user, isOpen, onClose, onUserUpdate }: UserProfileModalProps) {
  const [activeTab, setActiveTab] = useState<'profile' | 'password'>('profile');
  const [fullName, setFullName] = useState<string>(user.full_name || '');
  const [avatarPreview, setAvatarPreview] = useState<string>(user.avatar_url || '');
  const [isNewAvatarSelected, setIsNewAvatarSelected] = useState<boolean>(false);

  // Password fields
  const [currentPassword, setCurrentPassword] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [showCurrentPassword, setShowCurrentPassword] = useState<boolean>(false);
  const [showNewPassword, setShowNewPassword] = useState<boolean>(false);

  const [saving, setSaving] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const requiresPasswordReset = Boolean(user.mustResetPassword || (user as any).must_reset_password);

  useEffect(() => {
    if (isOpen) {
      setFullName(user.full_name || '');
      setAvatarPreview(user.avatar_url || '');
      setIsNewAvatarSelected(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      if (requiresPasswordReset) {
        setActiveTab('password');
      }
    }
  }, [isOpen, user, requiresPasswordReset]);

  if (!isOpen) return null;

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('لطفاً یک فایل تصویری انتخاب کنید (PNG, JPG, WebP)');
      return;
    }

    try {
      // V10-2.3: استاندارد واحد فشرده‌سازی تصاویر (سقف ۳۰۰ کیلوبایت)
      const dataUrl = await compressTo300KB(file);
      setAvatarPreview(dataUrl);
      setIsNewAvatarSelected(true);
    } catch {
      toast.error('خطا در پردازش تصویر. لطفاً فایل دیگری انتخاب کنید.');
    }
  };

  const handleRemoveAvatar = () => {
    setAvatarPreview('');
    setIsNewAvatarSelected(true);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmitProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    if (!fullName.trim()) {
      toast.error('نام و نام خانوادگی نمی‌تواند خالی باشد');
      return;
    }

    setSaving(true);
    try {
      const payload: any = {
        full_name: fullName.trim()
      };

      if (isNewAvatarSelected) {
        payload.avatar = avatarPreview; // base64 or empty string
      }

      const res = await fetchJson('/users/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res && res.user) {
        toast.success('پروفایل با موفقیت بروزرسانی شد');
        onUserUpdate(res.user);
        onClose();
      } else {
        toast.error(res?.error || 'خطا در بروزرسانی پروفایل');
      }
    } catch (err) {
      toast.error(err.message || 'خطا در برقراری ارتباط با سرور');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    if (!currentPassword) {
      toast.error('وارد کردن کلمه عبور فعلی الزامی است');
      return;
    }

    if (!newPassword) {
      toast.error('وارد کردن کلمه عبور جدید الزامی است');
      return;
    }

    if (newPassword.length < 4) {
      toast.error('کلمه عبور جدید باید حداقل ۴ کاراکتر باشد');
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error('کلمه عبور جدید و تکرار آن یکسان نیستند');
      return;
    }

    setSaving(true);
    try {
      const res = await fetchJson('/users/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword
        })
      });

      if (res && res.success) {
        toast.success('رمز عبور شما با موفقیت تغییر یافت');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        if (res.user) onUserUpdate(res.user);
        onClose();
      } else {
        toast.error(res?.error || 'خطا در تغییر کلمه عبور');
      }
    } catch (err) {
      toast.error(err.message || 'خطا در تغییر کلمه عبور');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
      <div className="bg-white rounded-3xl max-w-lg w-full overflow-hidden shadow-2xl border border-slate-200 max-h-[90vh] flex flex-col">
        {/* Modal Header */}
        <div className="bg-slate-900 text-white p-6 relative">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-400 text-slate-950 font-bold flex items-center justify-center shadow-md">
                <UserIcon className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold">تنظیمات حساب کاربری</h2>
                <p className="text-xs text-slate-400">ویرایش مشخصات، تصویر آواتار و کلمه عبور شخصی</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-2 mt-6 bg-slate-800/80 p-1 rounded-xl text-xs">
            <button
              onClick={() => setActiveTab('profile')}
              className={`flex-1 py-2 rounded-lg font-bold transition-all flex items-center justify-center gap-2 ${
                activeTab === 'profile'
                  ? 'bg-amber-400 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <UserIcon className="w-4 h-4" />
              مشخصات و آواتار
            </button>
            <button
              onClick={() => setActiveTab('password')}
              className={`flex-1 py-2 rounded-lg font-bold transition-all flex items-center justify-center gap-2 ${
                activeTab === 'password'
                  ? 'bg-amber-400 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <KeyRound className="w-4 h-4" />
              تغییر کلمه عبور
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto">
          {activeTab === 'profile' ? (
            <form onSubmit={handleSubmitProfile} className="space-y-6">
              {/* Avatar Upload Box */}
              <div className="flex flex-col items-center justify-center gap-3">
                <div className="relative group">
                  <div className="w-24 h-24 rounded-full border-4 border-slate-100 shadow-lg overflow-hidden bg-slate-100 flex items-center justify-center">
                    {avatarPreview ? (
                      <img
                        src={avatarPreview}
                        alt="User Avatar"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-blue-600 to-indigo-700 text-white text-3xl font-black flex items-center justify-center">
                        {(fullName || user.username || '?').charAt(0)}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-slate-900 hover:bg-slate-800 text-amber-400 border-2 border-white flex items-center justify-center shadow-md transition-all hover:scale-110"
                    title="تغییر تصویر آواتار"
                  >
                    <Camera className="w-4 h-4" />
                  </button>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png, image/jpeg, image/webp"
                  onChange={handleImageChange}
                  className="hidden"
                />

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs text-blue-600 hover:text-blue-800 font-bold flex items-center gap-1"
                  >
                    <UploadCloud className="w-3.5 h-3.5" />
                    انتخاب تصویر جدید
                  </button>
                  {avatarPreview && (
                    <button
                      type="button"
                      onClick={handleRemoveAvatar}
                      className="text-xs text-rose-600 hover:text-rose-800 font-bold flex items-center gap-1 border-r border-slate-200 pr-2 mr-2"
                    >
                      <X className="w-3.5 h-3.5" />
                      حذف آواتار
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-slate-400">فرمت‌های مجاز: PNG, JPG, WebP (حداکثر ۵ مگابایت)</p>
              </div>

              {/* Form Inputs */}
              <div className="space-y-4 text-xs">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">نام کاربری (غیرقابل تغییر):</label>
                  <input
                    type="text"
                    value={user.username}
                    disabled
                    className="w-full px-3.5 py-2.5 bg-slate-100 border border-slate-200 rounded-xl font-mono text-slate-500 font-bold cursor-not-allowed"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">نام و نام خانوادگی:</label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="نام کامل خود را وارد کنید..."
                    className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">نقش و سطح دسترسی:</label>
                  <div className="px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-slate-700 font-semibold">
                    <span>{user.role === 'admin' ? 'مدیر ارشد سیستم' : user.role === 'manager' ? 'سرپرست انبار' : user.role}</span>
                    <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 font-bold text-[10px]">
                      فعال
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-500 rounded-xl transition-all shadow-sm flex items-center gap-1.5 disabled:opacity-50"
                >
                  {saving ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      در حال ذخیره‌سازی...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      ذخیره تغییرات
                    </>
                  )}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleSubmitPassword} className="space-y-4 text-xs">
              {requiresPasswordReset ? (
                <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-2.5 text-rose-900 animate-pulse">
                  <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                  <div className="leading-relaxed">
                    <p className="font-bold">تغییر اجباری کلمه عبور (الزامات امنیتی)</p>
                    <p className="text-[11px] text-rose-800 mt-0.5">
                      جهت ارتقای امنیت حساب کاربری و انطباق با استانداردهای رمزنگاری سامانه، لطفاً یک کلمه عبور امن جدید تعیین نمایید.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-2.5 text-amber-900">
                  <ShieldCheck className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="leading-relaxed">
                    <p className="font-bold">امنیت حساب کاربری</p>
                    <p className="text-[11px] text-amber-800 mt-0.5">
                      پس از تغییر موفق کلمه عبور، تغییرات بلافاصله در تمام سیستم اعمال می‌گردد.
                    </p>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-slate-700 font-bold mb-1">کلمه عبور فعلی:</label>
                <div className="relative">
                  <input
                    type={showCurrentPassword ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="کلمه عبور فعلی خود را وارد کنید..."
                    className="w-full pr-3.5 pl-10 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-left ltr"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">کلمه عبور جدید:</label>
                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="حداقل ۴ کاراکتر..."
                    className="w-full pr-3.5 pl-10 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-left ltr"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">تکرار کلمه عبور جدید:</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="تکرار کلمه عبور جدید..."
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-left ltr"
                />
              </div>

              {/* Action Buttons */}
              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-500 rounded-xl transition-all shadow-sm flex items-center gap-1.5 disabled:opacity-50"
                >
                  {saving ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      در حال بروزرسانی...
                    </>
                  ) : (
                    <>
                      <Lock className="w-4 h-4" />
                      تغییر کلمه عبور
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
