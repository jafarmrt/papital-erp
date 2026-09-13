import React from 'react';
import {
  Users,
  Briefcase,
  Award,
  Wallet,
  X,
  Edit2,
  Phone,
  Calendar,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle
} from 'lucide-react';
import { Personnel } from '../../types';
import { formatPersianCode, formatPersianNumber } from '../../utils';

interface PersonnelDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  personnel: Personnel | null;
  onEdit: (p: Personnel) => void;
}

export function PersonnelDetailModal({
  isOpen,
  onClose,
  personnel,
  onEdit
}: PersonnelDetailModalProps) {
  if (!isOpen || !personnel) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl border border-slate-200 my-8 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Detail Header */}
        <div className="p-5 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center text-lg font-black shrink-0">
              {personnel.fullName ? personnel.fullName.charAt(0) : 'پ'}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black">{personnel.fullName}</h2>
                {personnel.employmentStatus === 'فعال' && (
                  <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-lg text-[10px] font-bold">
                    فعال
                  </span>
                )}
                {personnel.employmentStatus === 'قطع همکاری' && (
                  <span className="px-2 py-0.5 bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-lg text-[10px] font-bold">
                    قطع همکاری
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-300 font-normal mt-0.5">
                {personnel.jobTitle || 'عنوان شغلی تعریف نشده'} | کد پرسنلی: {personnel.personnelCode || '---'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onClose();
                onEdit(personnel);
              }}
              className="p-2 bg-white/10 hover:bg-white/20 rounded-xl transition-all text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
            >
              <Edit2 size={14} />
              <span>ویرایش</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/20 rounded-xl transition-all cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Detail Body */}
        <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto text-xs">
          {/* Quick Contact & IDs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-[10px] text-slate-400 block">شماره تماس</span>
              <span className="font-bold font-mono text-slate-800 mt-0.5 flex items-center gap-1">
                <Phone size={12} className="text-blue-500" />
                {personnel.phone ? formatPersianCode(personnel.phone) : '---'}
              </span>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-[10px] text-slate-400 block">کد ملی</span>
              <span className="font-bold font-mono text-slate-800 mt-0.5 block">
                {personnel.nationalId ? formatPersianCode(personnel.nationalId) : '---'}
              </span>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-[10px] text-slate-400 block">تاریخ تولد</span>
              <span className="font-bold font-mono text-slate-800 mt-0.5 flex items-center gap-1">
                <Calendar size={12} className="text-amber-500" />
                {personnel.birthDate ? formatPersianNumber(personnel.birthDate) : '---'}
              </span>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-[10px] text-slate-400 block">ملیت / جنسیت</span>
              <span className="font-bold text-slate-800 mt-0.5 block">
                {personnel.nationality || 'ایرانی'} ({personnel.gender || '---'})
              </span>
            </div>
          </div>

          {/* Job & Referral */}
          <div className="p-4 bg-amber-50/50 rounded-2xl border border-amber-100 space-y-2">
            <h4 className="font-black text-amber-900 flex items-center gap-1.5">
              <Briefcase size={14} className="text-amber-700" />
              اطلاعات شغلی و پاپیتال
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pt-1">
              <div>
                <span className="text-[10px] text-slate-500 block">مدرک تحصیلی:</span>
                <span className="font-bold text-slate-800">{personnel.education || '---'}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 block">نحوه آشنایی با پاپیتال:</span>
                <span className="font-bold text-slate-800">{personnel.referralSource || '---'}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 block">تاریخ پایان همکاری:</span>
                <span className="font-bold font-mono text-slate-800">
                  {personnel.endDate ? formatPersianNumber(personnel.endDate) : '---'}
                </span>
              </div>
            </div>
            {personnel.terminationReason && (
              <div className="pt-2 border-t border-amber-200/50">
                <span className="text-[10px] text-rose-600 font-bold block">علت قطع همکاری:</span>
                <p className="text-slate-700 mt-0.5">{personnel.terminationReason}</p>
              </div>
            )}
          </div>

          {/* Skills */}
          <div className="p-4 bg-purple-50/50 rounded-2xl border border-purple-100 space-y-2">
            <h4 className="font-black text-purple-900 flex items-center gap-1.5">
              <Award size={14} className="text-purple-700" />
              مهارت‌ها و توانمندی‌ها
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <span className="text-[10px] text-slate-500 block">مهارت‌های تخصصی:</span>
                <p className="font-bold text-slate-800 mt-0.5">{personnel.specializedSkills || 'ثبت نشده'}</p>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 block">سایر مهارت‌ها:</span>
                <p className="font-bold text-slate-800 mt-0.5">{personnel.otherSkills || 'ثبت نشده'}</p>
              </div>
            </div>
          </div>

          {/* Banking & Crypto */}
          <div className="p-4 bg-emerald-50/50 rounded-2xl border border-emerald-100 space-y-2">
            <h4 className="font-black text-emerald-900 flex items-center gap-1.5">
              <Wallet size={14} className="text-emerald-700" />
              اطلاعات مالی و نوبیتکس
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <span className="text-[10px] text-slate-500 block">نام بانک / کارت:</span>
                <span className="font-bold font-mono text-slate-800 mt-0.5 block">
                  {personnel.bankName || 'بانک'} - {personnel.cardNumber ? formatPersianCode(personnel.cardNumber) : '---'}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 block">شماره حساب:</span>
                <span className="font-bold font-mono text-slate-800 mt-0.5 block">
                  {personnel.accountNumber ? formatPersianCode(personnel.accountNumber) : '---'}
                </span>
              </div>
              <div className="sm:col-span-2">
                <span className="text-[10px] text-slate-500 block">شماره شبا (IBAN):</span>
                <span className="font-bold font-mono text-slate-800 mt-0.5 block text-left" dir="ltr">
                  {personnel.shebaNumber || '---'}
                </span>
              </div>
              {personnel.nobitexUsername && (
                <div>
                  <span className="text-[10px] text-slate-500 block">نام کاربری نوبیتکس:</span>
                  <span className="font-bold font-mono text-slate-800 mt-0.5 block">
                    {personnel.nobitexUsername}
                  </span>
                </div>
              )}
              {personnel.nobitexPassword && (
                <div>
                  <span className="text-[10px] text-slate-500 block">رمز عبور نوبیتکس:</span>
                  <span className="font-bold font-mono text-slate-800 mt-0.5 block select-all">
                    {personnel.nobitexPassword}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Address & Notes */}
          {personnel.address && (
            <div>
              <span className="text-[10px] text-slate-400 block">آدرس سکونت:</span>
              <p className="font-bold text-slate-800 mt-0.5">{personnel.address}</p>
            </div>
          )}

          {personnel.notes && (
            <div>
              <span className="text-[10px] text-slate-400 block">یادداشت‌ها:</span>
              <p className="text-slate-700 mt-0.5">{personnel.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
