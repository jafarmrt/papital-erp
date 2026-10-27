import React, { FormEvent, useId } from 'react';
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
import { getIranianBankFromCard, getIranianBankFromSheba, isoToJalaliDate } from '../../utils';
import { NationalIdInput, IranianPhoneInput, BankCardInput, ShebaInput } from '../common';
import { PersonnelStatutoryFlags } from './PersonnelStatutoryFlags';
import { JalaliDateInput } from '../common/JalaliDateInput';
import { NobitexPasswordInput } from './NobitexPasswordFields';
import { DecimalInput } from '../common/DecimalInput';
import { SALARY_TYPES, SALARY_TYPE_LABELS, salaryTypeOf } from '../../lib/personnel/salaryType';
import { DialogLayer } from '../common/DialogLayer';
import { PERSONNEL_LIST_STATE_TEXT, type PersonnelListState } from '../../lib/personnel/personnelList';
import { RialEquivalent } from '../common/RialEquivalent';
import { personnelUserPickerRule } from '../../lib/personnel/personnelUserLinks';

interface PersonnelFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
  editingId: number | null;
  formData: PersonnelFormData;
  setFormData: React.Dispatch<React.SetStateAction<PersonnelFormData>>;
  usersList: User[];
  /** کاربرانی که به پرسنل دیگری وصل‌اند (نام آن پرسنل)؛ v9.0.24، TD-435 */
  linkedUsers?: Map<number, string>;
  /** TD-1321: the user picker waits until the users and the personnel they are linked to have arrived */
  linkedUsersState?: PersonnelListState;
  /** v11 phase 6.2 (X6): the viewer holds «مدیریت کاربران», which linking and unlinking an account needs */
  canLinkUser?: boolean;
  /** v11 phase 6.2 (X6): the account the stored person is linked to ('' for none or a new person) */
  storedUserId?: string;
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
  linkedUsers,
  linkedUsersState = 'ready',
  canLinkUser = false,
  storedUserId = '',
  isSaving
}: PersonnelFormModalProps) {
  const fieldId = useId();
  if (!isOpen) return null;
  const userPicker = personnelUserPickerRule(canLinkUser, storedUserId);
  const pickerNote = linkedUsersState !== 'ready' ? PERSONNEL_LIST_STATE_TEXT[linkedUsersState] : userPicker.hint;

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <DialogLayer onClose={onClose} disabled={isSaving} />
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
          <button aria-label="بستن"
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
                <label htmlFor={`${fieldId}-first-name`} className="block text-xs font-bold text-slate-700 mb-1">نام *</label>
                <input
                  id={`${fieldId}-first-name`}
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
                <label htmlFor={`${fieldId}-last-name`} className="block text-xs font-bold text-slate-700 mb-1">نام خانوادگی *</label>
                <input
                  id={`${fieldId}-last-name`}
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
                <label htmlFor={`${fieldId}-full-name`} className="block text-xs font-bold text-slate-700 mb-1">نام و نام خانوادگی (کامل)</label>
                <input
                  id={`${fieldId}-full-name`}
                  type="text"
                  value={formData.fullName}
                  onChange={(e) => setFormData((prev) => ({ ...prev, fullName: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
                />
              </div>

              <NationalIdInput
                value={formData.nationalId}
                onChange={(digits) => setFormData((prev) => ({ ...prev, nationalId: digits }))}
                placeholder="۱۰ رقم عددی"
              />

              <div>
                <label htmlFor={`${fieldId}-gender`} className="block text-xs font-bold text-slate-700 mb-1">جنسیت</label>
                <select
                  id={`${fieldId}-gender`}
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
                <label htmlFor={`${fieldId}-birth-date`} className="block text-xs font-bold text-slate-700 mb-1">تاریخ تولد</label>
                <JalaliDateInput
                  id={`${fieldId}-birth-date`}
                  value={formData.birthDate || ''}
                  onChange={iso => setFormData((prev) => ({ ...prev, birthDate: isoToJalaliDate(iso) }))}
                  placeholder="انتخاب تاریخ تولد"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500 font-mono"
                />
                <label className="mt-1.5 flex items-center gap-2 text-[11px] font-bold text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.isBirthdayVisible}
                    onChange={(e) => setFormData((prev) => ({ ...prev, isBirthdayVisible: e.target.checked }))}
                  />
                  روز تولد (بی سال) روی پیشخوان گروهی به همکاران نشان داده شود
                </label>
              </div>

              <div>
                <label htmlFor={`${fieldId}-nationality`} className="block text-xs font-bold text-slate-700 mb-1">ملیت</label>
                <input
                  id={`${fieldId}-nationality`}
                  type="text"
                  value={formData.nationality}
                  onChange={(e) => setFormData((prev) => ({ ...prev, nationality: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
                />
              </div>

              <IranianPhoneInput
                value={formData.phone}
                onChange={(digits) => setFormData((prev) => ({ ...prev, phone: digits }))}
                placeholder="۰۹۱۲۳۴۵۶۷۸۹"
              />

              <div>
                <label htmlFor={`${fieldId}-education`} className="block text-xs font-bold text-slate-700 mb-1">آخرین مدرک تحصیلی</label>
                <input
                  id={`${fieldId}-education`}
                  type="text"
                  placeholder="دیپلم / کارشناسی / ارشد..."
                  value={formData.education}
                  onChange={(e) => setFormData((prev) => ({ ...prev, education: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label htmlFor={`${fieldId}-address`} className="block text-xs font-bold text-slate-700 mb-1">آدرس سکونت</label>
              <input
                id={`${fieldId}-address`}
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
                <label htmlFor={`${fieldId}-personnel-code`} className="block text-xs font-bold text-slate-700 mb-1">کد پرسنلی</label>
                <input
                  id={`${fieldId}-personnel-code`}
                  type="text"
                  value={formData.personnelCode}
                  onChange={(e) => setFormData((prev) => ({ ...prev, personnelCode: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500 font-mono"
                />
              </div>

              <div>
                <label htmlFor={`${fieldId}-job-title`} className="block text-xs font-bold text-slate-700 mb-1">عنوان شغلی</label>
                <input
                  id={`${fieldId}-job-title`}
                  type="text"
                  placeholder="کارشناس فروش / سرپرست انبار / مدیر..."
                  value={formData.jobTitle}
                  onChange={(e) => setFormData((prev) => ({ ...prev, jobTitle: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label htmlFor={`${fieldId}-employment-status`} className="block text-xs font-bold text-slate-700 mb-1">وضعیت همکاری *</label>
                <select
                  id={`${fieldId}-employment-status`}
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
                <label htmlFor={`${fieldId}-user-id`} className="block text-xs font-bold text-slate-700 mb-1">اتصال به کاربر سیستم</label>
                <select
                  id={`${fieldId}-user-id`}
                  value={formData.userId}
                  onChange={(e) => setFormData((prev) => ({ ...prev, userId: e.target.value }))}
                  disabled={linkedUsersState !== 'ready' || userPicker.locked}
                  aria-describedby={pickerNote ? `${fieldId}-user-id-state` : undefined}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500 disabled:opacity-60"
                >
                  <option value="">-- بدون حساب کاربری در سامانه --</option>
                  {usersList.filter(u => !userPicker.onlyStored || String(u.id) === storedUserId).map((u) => {
                    const linkedTo = linkedUsers?.get(Number(u.id));
                    return (
                      <option key={u.id} value={u.id} disabled={linkedTo !== undefined}>
                        کاربر: {u.full_name} ({u.username}){linkedTo !== undefined ? ` — وصل به ${linkedTo}` : ''}
                      </option>
                    );
                  })}
                </select>
                {pickerNote && (
                  <p id={`${fieldId}-user-id-state`} className="text-[10px] text-slate-500 mt-1">{pickerNote}</p>
                )}
              </div>

              {/* V10-4.4 / V1.3.1: مدل حقوق — گزینه‌های متمایز با توضیح صریح تفاوت‌ها */}
              <div>
                <label htmlFor={`${fieldId}-piecework`} className="block text-xs font-bold text-slate-700 mb-1">مدل حقوق</label>
                <select
                  id={`${fieldId}-piecework`}
                  value={salaryTypeOf(formData.salaryType)}
                  onChange={(e) => setFormData((prev) => ({ ...prev, salaryType: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
                >
                  {/* OBS-R2-55: «تعیین‌نشده» is offered only while it is the stored value */}
                  {SALARY_TYPES.filter(t => t !== 'none' || salaryTypeOf(formData.salaryType) === 'none').map(t => (
                    <option key={t} value={t}>{SALARY_TYPE_LABELS[t]}</option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-500 mt-1 leading-5">
                  {formData.salaryType === 'monthly_fixed'
                    ? 'این شخص فقط حقوق ماهانه ثابت می‌گیرد؛ فیش او صرفاً بابت حقوق پایه صادر می‌شود و ردیف کارکرد کارمزدی ندارد.'
                    : formData.salaryType === 'mixed'
                      ? 'فیش این شخص = حقوق ماهانه ثابت + جمع کارکرد کارمزدی همان دوره (دو ردیف جدا در فیش).'
                      : 'فیش این شخص فقط بر اساس نرخ عناوین کاری و مقدار کارکرد ثبت‌شده محاسبه می‌شود؛ حقوق پایه ثابت ندارد.'}
                </p>
              </div>

              {(formData.salaryType === 'monthly_fixed' || formData.salaryType === 'mixed') && (
                <div>
                  <label htmlFor={`${fieldId}-monthly-salary`} className="block text-xs font-bold text-slate-700 mb-1">مبلغ حقوق ماهانه (ریال)</label>
                  <DecimalInput
                    id={`${fieldId}-monthly-salary`}
                    min="0"
                    step="any"
                    placeholder="مثال: ۳۰٬۰۰۰٬۰۰۰"
                    value={formData.monthlySalary}
                    onValueChange={(v) => setFormData((prev) => ({ ...prev, monthlySalary: v }))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-left outline-none focus:border-blue-500"
                    dir="ltr"
                  />
                  <RialEquivalent value={formData.monthlySalary} />
                  {formData.salaryType === 'mixed' && (
                    <p className="text-[10px] text-slate-500 mt-1">در فیش‌های ترکیبی، سهم ثابت به کارکرد کارمزدی دوره اضافه می‌شود.</p>
                  )}
                </div>
              )}

              <div>
                <label htmlFor={`${fieldId}-referral-source`} className="block text-xs font-bold text-slate-700 mb-1">نحوه آشنایی با پاپیتال</label>
                <input
                  id={`${fieldId}-referral-source`}
                  type="text"
                  placeholder="معرفی دوستان / جابینجا /..."
                  value={formData.referralSource}
                  onChange={(e) => setFormData((prev) => ({ ...prev, referralSource: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
                />
              </div>

              <div>
                {/* v10.0.199 (TD-1086): حقوق ثابت از این روز آغاز می‌شود؛ ماه نخست روزشمار */}
                <label htmlFor={`${fieldId}-start-date`} className="block text-xs font-bold text-slate-700 mb-1">تاریخ آغاز همکاری</label>
                <JalaliDateInput
                  id={`${fieldId}-start-date`}
                  value={formData.startDate}
                  onChange={(iso) => setFormData((prev) => ({ ...prev, startDate: iso }))}
                  placeholder="انتخاب تاریخ آغاز همکاری"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500 font-mono"
                />
                <p className="mt-1 text-[10px] text-slate-500">حقوق ثابت از این روز داده می‌شود؛ خالی یعنی از آغاز دوره هر فیش.</p>
              </div>

              <PersonnelStatutoryFlags
                insurance={formData.isInsuranceCovered}
                tax={formData.isTaxCovered}
                eidi={formData.isEidiCovered}
                onChange={(flags) => setFormData((prev) => ({ ...prev, ...flags }))}
              />

              <div>
                <label htmlFor={`${fieldId}-end-date`} className="block text-xs font-bold text-slate-700 mb-1">تاریخ پایان کار با پاپیتال</label>
                <JalaliDateInput
                  id={`${fieldId}-end-date`}
                  value={formData.endDate || ''}
                  onChange={iso => setFormData((prev) => ({ ...prev, endDate: isoToJalaliDate(iso) }))}
                  placeholder="انتخاب تاریخ پایان کار"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500 font-mono"
                />
              </div>
            </div>

            <div>
              <label htmlFor={`${fieldId}-termination-reason`} className="block text-xs font-bold text-slate-700 mb-1">علت قطع همکاری</label>
              <input
                id={`${fieldId}-termination-reason`}
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
                <label htmlFor={`${fieldId}-specialized-skills`} className="block text-xs font-bold text-slate-700 mb-1">مهارت‌های تخصصی</label>
                <textarea
                  id={`${fieldId}-specialized-skills`}
                  rows={2}
                  placeholder="برنامه‌نویسی، طراحی فتوشاپ، نرم‌افزار هلو، ICDL..."
                  value={formData.specializedSkills}
                  onChange={(e) => setFormData((prev) => ({ ...prev, specializedSkills: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label htmlFor={`${fieldId}-other-skills`} className="block text-xs font-bold text-slate-700 mb-1">مهارت‌های دیگر</label>
                <textarea
                  id={`${fieldId}-other-skills`}
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
                <label htmlFor={`${fieldId}-bank-name`} className="block text-xs font-bold text-slate-700 mb-1">نام بانک</label>
                <input
                  id={`${fieldId}-bank-name`}
                  type="text"
                  placeholder="ملی، ملت، پاسارگاد..."
                  value={formData.bankName}
                  onChange={(e) => setFormData((prev) => ({ ...prev, bankName: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <BankCardInput
                  label="شماره کارت بانک"
                  value={formData.cardNumber}
                  onChange={(val) => {
                    setFormData((prev) => {
                      const updates: Partial<PersonnelFormData> = { cardNumber: val };
                      if (!prev.bankName) {
                        const detected = getIranianBankFromCard(val);
                        if (detected) updates.bankName = detected.name;
                      }
                      return { ...prev, ...updates };
                    });
                  }}
                  inputClassName="!py-2 !text-xs"
                />
              </div>

              <div>
                <label htmlFor={`${fieldId}-account-number`} className="block text-xs font-bold text-slate-700 mb-1">شماره حساب</label>
                <input
                  id={`${fieldId}-account-number`}
                  type="text"
                  value={formData.accountNumber}
                  onChange={(e) => setFormData((prev) => ({ ...prev, accountNumber: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500 font-mono"
                />
              </div>

              <div>
                <ShebaInput
                  label="شماره شبا"
                  value={formData.shebaNumber}
                  onChange={(val) => {
                    setFormData((prev) => {
                      const updates: Partial<PersonnelFormData> = { shebaNumber: val };
                      if (!prev.bankName) {
                        const detected = getIranianBankFromSheba(val);
                        if (detected) updates.bankName = detected.name;
                      }
                      return { ...prev, ...updates };
                    });
                  }}
                  inputClassName="!py-2 !text-xs"
                />
              </div>

              <div>
                <label htmlFor={`${fieldId}-nobitex-username`} className="block text-xs font-bold text-slate-700 mb-1">نام کاربری نوبیتکس</label>
                <input
                  id={`${fieldId}-nobitex-username`}
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

              <NobitexPasswordInput
                value={formData.nobitexPassword}
                onChange={(nobitexPassword) => setFormData((prev) => ({ ...prev, nobitexPassword }))}
              />
            </div>
          </div>

          <div>
            <label htmlFor={`${fieldId}-notes`} className="block text-xs font-bold text-slate-700 mb-1">توضیحات تکمیلی و یادداشت‌ها</label>
            <textarea
              id={`${fieldId}-notes`}
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
                  <span>{editingId ? 'به‌روزرسانی اطلاعات' : 'ذخیره پرسنل'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
