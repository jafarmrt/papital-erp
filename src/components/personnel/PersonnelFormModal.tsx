import React, { FormEvent } from 'react';
import DatePicker from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import {
  Users,
  UserPlus,
  Edit2,
  Briefcase,
  Award,
  Wallet,
  X,
  CheckCircle2
} from 'lucide-react';
import { User } from '../../types';
import { PersonnelFormData } from '../../hooks/usePersonnel';
import { toEnglishDigits, extractDateString, normalizeNationalId, normalizePhoneNumber } from '../../utils';

interface PersonnelFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
  editingId: number | null;
  formData: PersonnelFormData;
  setFormData: React.Dispatch<React.SetStateAction<PersonnelFormData>>;
  usersList: User[];
  isSaving: boolean;
}

export function PersonnelFormModal({
  isOpen,
  onClose,
  onSubmit,
  editingId,
  formData,
  setFormData,
  usersList,
  isSaving
}: PersonnelFormModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-3xl rounded-3xl shadow-2xl border border-slate-200 my-8 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="p-5 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-white/10 rounded-xl">
              {editingId ? <Edit2 size={20} /> : <UserPlus size={20} />}
            </div>
            <div>
              <h2 className="text-base font-black">
                {editingId ? `ویرایش پرسنل: ${formData.fullName || formData.firstName}` : 'ثبت پرسنل جدید'}
              </h2>
              <p className="text-xs text-slate-300 font-normal mt-0.5">
                مشخصات فردی، شغلی، حساب مالی و اطلاعات نوبیتکس پرسنل
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/20 rounded-xl transition-all cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <form
          onSubmit={onSubmit}
          autoComplete="off"
          data-lpignore="true"
          data-1p-ignore="true"
          className="p-6 space-y-6 max-h-[80vh] overflow-y-auto"
        >
          {/* Section 1: اطلاعات فردی */}
          <div className="space-y-3">
            <h3 className="text-xs font-black text-blue-700 bg-blue-50 px-3 py-1.5 rounded-xl flex items-center gap-1.5 w-fit">
              <Users size={14} />
              اطلاعات فردی و شناسنامه‌ای
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">نام *</label>
                <input
                  type="text"
                  required
                  value={formData.firstName}
                  onChange={(e) => {
                    const val = e.target.value;
                    setFormData((prev) => ({
                      ...prev,
                      firstName: val,
                      fullName: `${val} ${prev.lastName}`.trim()
                    }));
                  }}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">نام خانوادگی *</label>
                <input
                  type="text"
                  required
                  value={formData.lastName}
                  onChange={(e) => {
                    const val = e.target.value;
                    setFormData((prev) => ({
                      ...prev,
                      lastName: val,
                      fullName: `${prev.firstName} ${val}`.trim()
                    }));
                  }}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">نام و نام خانوادگی (کامل)</label>
                <input
                  type="text"
                  value={formData.fullName}
                  onChange={(e) => setFormData((prev) => ({ ...prev, fullName: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  کد ملی <span className="text-[10px] text-slate-400 font-normal">(۱۰ رقم عددی)</span>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={10}
                  autoComplete="off"
                  value={formData.nationalId}
                  onChange={(e) => {
                    // فیلتر آنی: تبدیل ارقام فارسی و حذف کاراکترهای غیرعددی با سقف ۱۰ رقم
                    const digits = toEnglishDigits(e.target.value).replace(/\D/g, '').slice(0, 10);
                    setFormData((prev) => ({ ...prev, nationalId: digits }));
                  }}
                  onBlur={() => {
                    if (formData.nationalId) {
                      setFormData((prev) => ({ ...prev, nationalId: normalizeNationalId(prev.nationalId) }));
                    }
                  }}
                  placeholder="۱۰ رقم عددی"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500 font-mono tracking-widest text-left"
                  dir="ltr"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">جنسیت</label>
                <select
                  value={formData.gender}
                  onChange={(e) => setFormData((prev) => ({ ...prev, gender: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
                >
                  <option value="مرد">مرد</option>
                  <option value="زن">زن</option>
                  <option value="سایر">سایر</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">تاریخ تولد</label>
                <DatePicker
                  value={formData.birthDate || ''}
                  onChange={(dateObj: any) => {
                    setFormData((prev) => ({ ...prev, birthDate: extractDateString(dateObj) }));
                  }}
                  calendar={persian}
                  locale={persian_fa}
                  calendarPosition="bottom-right"
                  placeholder="انتخاب تاریخ تولد"
                  inputClass="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500 font-mono"
                  containerClassName="w-full"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">ملیت</label>
                <input
                  type="text"
                  value={formData.nationality}
                  onChange={(e) => setFormData((prev) => ({ ...prev, nationality: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  شماره تماس <span className="text-[10px] text-slate-400 font-normal">(۱۱ رقم شروع با ۰)</span>
                </label>
                <input
                  type="tel"
                  inputMode="numeric"
                  maxLength={11}
                  autoComplete="off"
                  placeholder="۰۹۱۲۳۴۵۶۷۸۹"
                  value={formData.phone}
                  onChange={(e) => {
                    // فیلتر آنی: تبدیل ارقام فارسی و حذف کاراکترهای غیرعددی با سقف ۱۱ رقم
                    const digits = toEnglishDigits(e.target.value).replace(/\D/g, '').slice(0, 11);
                    setFormData((prev) => ({ ...prev, phone: digits }));
                  }}
                  onBlur={() => {
                    if (formData.phone) {
                      setFormData((prev) => ({ ...prev, phone: normalizePhoneNumber(prev.phone) }));
                    }
                  }}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500 font-mono tracking-widest text-left"
                  dir="ltr"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">آخرین مدرک تحصیلی</label>
                <input
                  type="text"
                  placeholder="دیپلم / کارشناسی / ارشد..."
                  value={formData.education}
                  onChange={(e) => setFormData((prev) => ({ ...prev, education: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">آدرس سکونت</label>
              <input
                type="text"
                value={formData.address}
                onChange={(e) => setFormData((prev) => ({ ...prev, address: e.target.value }))}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <hr className="border-slate-100" />

          {/* Section 2: اطلاعات شغلی و پاپیتال */}
          <div className="space-y-3">
            <h3 className="text-xs font-black text-amber-700 bg-amber-50 px-3 py-1.5 rounded-xl flex items-center gap-1.5 w-fit">
              <Briefcase size={14} />
              اطلاعات شغلی و پاپیتال
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">کد پرسنلی</label>
                <input
                  type="text"
                  value={formData.personnelCode}
                  onChange={(e) => setFormData((prev) => ({ ...prev, personnelCode: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">عنوان شغلی</label>
                <input
                  type="text"
                  placeholder="کارشناس فروش / سرپرست انبار / مدیر..."
                  value={formData.jobTitle}
                  onChange={(e) => setFormData((prev) => ({ ...prev, jobTitle: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">وضعیت همکاری *</label>
                <select
                  value={formData.employmentStatus}
                  onChange={(e) => setFormData((prev) => ({ ...prev, employmentStatus: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500 font-bold"
                >
                  <option value="فعال">فعال</option>
                  <option value="قطع همکاری">قطع همکاری</option>
                  <option value="مرخصی">مرخصی</option>
                  <option value="تعلیق">تعلیق</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">اتصال به کاربر سیستم</label>
                <select
                  value={formData.userId}
                  onChange={(e) => setFormData((prev) => ({ ...prev, userId: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
                >
                  <option value="">-- غیرکاربر (بدون اکانت ورودی به سامانه) --</option>
                  {usersList.map((u) => (
                    <option key={u.id} value={u.id}>
                      کاربر: {u.full_name} ({u.username})
                    </option>
                  ))}
                </select>
              </div>

              {/* V10-4.4 / V1.3.1: مدل حقوق — گزینه‌های متمایز با توضیح صریح تفاوت‌ها */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">مدل حقوق</label>
                <select
                  value={formData.salaryType === 'monthly_fixed' || formData.salaryType === 'mixed' ? formData.salaryType : 'piecework'}
                  onChange={(e) => setFormData((prev) => ({ ...prev, salaryType: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
                >
                  <option value="piecework">پرکیسی — کارمزد بر اساس عناوین کاری</option>
                  <option value="monthly_fixed">حقوق ثابت ماهانه — بدون کارمزد</option>
                  <option value="mixed">ترکیبی — حقوق ثابت + کارمزد پرکیسی</option>
                </select>
                <p className="text-[10px] text-slate-500 mt-1 leading-5">
                  {formData.salaryType === 'monthly_fixed'
                    ? 'این شخص فقط حقوق ماهانه ثابت می‌گیرد؛ فیش او صرفاً بابت حقوق پایه صادر می‌شود و ردیف کارکرد پرکیسی ندارد.'
                    : formData.salaryType === 'mixed'
                      ? 'فیش این شخص = حقوق ماهانه ثابت + جمع کارکرد پرکیسی همان دوره (دو ردیف جدا در فیش).'
                      : 'فیش این شخص فقط بر اساس نرخ عناوین کاری و مقدار کارکرد ثبت‌شده محاسبه می‌شود؛ حقوق پایه ثابت ندارد.'}
                </p>
              </div>

              {(formData.salaryType === 'monthly_fixed' || formData.salaryType === 'mixed') && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">مبلغ حقوق ماهانه (ریال)</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="مثال: 30000000"
                    value={formData.monthlySalary}
                    onChange={(e) => setFormData((prev) => ({ ...prev, monthlySalary: e.target.value }))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-left outline-none focus:border-blue-500"
                    dir="ltr"
                  />
                  {formData.salaryType === 'mixed' && (
                    <p className="text-[10px] text-slate-500 mt-1">در فیش‌های ترکیبی، سهم ثابت به کارکرد پرکیسی دوره اضافه می‌شود.</p>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">نحوه آشنایی با پاپیتال</label>
                <input
                  type="text"
                  placeholder="معرفی دوستان / جابینجا /..."
                  value={formData.referralSource}
                  onChange={(e) => setFormData((prev) => ({ ...prev, referralSource: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">تاریخ پایان کار با پاپیتال</label>
                <DatePicker
                  value={formData.endDate || ''}
                  onChange={(dateObj: any) => {
                    setFormData((prev) => ({ ...prev, endDate: extractDateString(dateObj) }));
                  }}
                  calendar={persian}
                  locale={persian_fa}
                  calendarPosition="bottom-right"
                  placeholder="انتخاب تاریخ پایان کار"
                  inputClass="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500 font-mono"
                  containerClassName="w-full"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">علت قطع همکاری</label>
              <input
                type="text"
                placeholder="توضیح دلایل استعفا، پایان قرارداد یا تعدیل..."
                value={formData.terminationReason}
                onChange={(e) => setFormData((prev) => ({ ...prev, terminationReason: e.target.value }))}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <hr className="border-slate-100" />

          {/* Section 3: مهارت‌ها */}
          <div className="space-y-3">
            <h3 className="text-xs font-black text-purple-700 bg-purple-50 px-3 py-1.5 rounded-xl flex items-center gap-1.5 w-fit">
              <Award size={14} />
              مهارت‌ها و توانمندی‌ها
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">مهارت‌های تخصصی</label>
                <textarea
                  rows={2}
                  placeholder="برنامه‌نویسی، طراحی فتوشاپ، نرم‌افزار هلو، ICDL..."
                  value={formData.specializedSkills}
                  onChange={(e) => setFormData((prev) => ({ ...prev, specializedSkills: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">مهارت‌های دیگر</label>
                <textarea
                  rows={2}
                  placeholder="زبان انگلیسی، فن بیان، رانندگی، مدیریت زمان..."
                  value={formData.otherSkills}
                  onChange={(e) => setFormData((prev) => ({ ...prev, otherSkills: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          <hr className="border-slate-100" />

          {/* Section 4: اطلاعات مالی و نوبیتکس */}
          <div className="space-y-3">
            <h3 className="text-xs font-black text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-xl flex items-center gap-1.5 w-fit">
              <Wallet size={14} />
              اطلاعات مالی و حساب نوبیتکس
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">نام بانک</label>
                <input
                  type="text"
                  placeholder="ملی، ملت، پاسارگاد..."
                  value={formData.bankName}
                  onChange={(e) => setFormData((prev) => ({ ...prev, bankName: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">شماره کارت بانک</label>
                <input
                  type="text"
                  placeholder="۶۰۳۷..."
                  value={formData.cardNumber}
                  onChange={(e) => setFormData((prev) => ({ ...prev, cardNumber: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">شماره حساب</label>
                <input
                  type="text"
                  value={formData.accountNumber}
                  onChange={(e) => setFormData((prev) => ({ ...prev, accountNumber: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">شماره شبا (IBAN)</label>
                <input
                  type="text"
                  placeholder="IR0000..."
                  value={formData.shebaNumber}
                  onChange={(e) => setFormData((prev) => ({ ...prev, shebaNumber: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">نام کاربری نوبیتکس</label>
                <input
                  type="text"
                  name="personnel_nobitex_username_field"
                  autoComplete="off"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  placeholder="نام کاربری نوبیتکس پرسنل"
                  value={formData.nobitexUsername}
                  onChange={(e) => setFormData((prev) => ({ ...prev, nobitexUsername: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">رمز عبور نوبیتکس (رشته متنی)</label>
                <input
                  type="text"
                  name="personnel_nobitex_password_field"
                  autoComplete="off"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  placeholder="رمز عبور نوبیتکس پرسنل"
                  value={formData.nobitexPassword}
                  onChange={(e) => setFormData((prev) => ({ ...prev, nobitexPassword: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500 font-mono"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">توضیحات تکمیلی و یادداشت‌ها</label>
            <textarea
              rows={2}
              value={formData.notes}
              onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
            />
          </div>

          {/* Form Buttons */}
          <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all cursor-pointer"
            >
              انصراف
            </button>

            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-all shadow-md flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {isSaving ? (
                <span>در حال ذخیره...</span>
              ) : (
                <>
                  <CheckCircle2 size={16} />
                  <span>{editingId ? 'بروزرسانی اطلاعات' : 'ذخیره پرسنل'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
