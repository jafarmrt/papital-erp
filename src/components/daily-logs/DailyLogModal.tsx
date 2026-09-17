import { FormEvent } from 'react';
import { Clock, X, Building2, Laptop, AtSign, Eye, Lock } from 'lucide-react';
import DatePicker from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import { DailyWorkLog, User, ProductionProject } from '../../types';
import { SimpleUserOption } from '../../hooks/useDailyLogs';
import { formatPersianNumber, getTodayJalaliDate, extractDateString } from '../../utils';
import { MentionTextarea } from '../MentionTextarea';

interface DailyLogModalProps {
  isModalOpen: boolean;
  onClose: () => void;
  editingLog: DailyWorkLog | null;
  formDate: any;
  setFormDate: (date: any) => void;
  formStartTime: string;
  setFormStartTime: (time: string) => void;
  formEndTime: string;
  setFormEndTime: (time: string) => void;
  formWorkMode: 'onsite' | 'remote';
  setFormWorkMode: (mode: 'onsite' | 'remote') => void;
  formTitle: string;
  setFormTitle: (title: string) => void;
  formContent: string;
  setFormContent: (content: string) => void;
  formProjectId: string;
  setFormProjectId: (id: string) => void;
  formVisibility: 'mentioned_only' | 'public' | 'private';
  setFormVisibility: (vis: 'mentioned_only' | 'public' | 'private') => void;
  formMentions: number[];
  setFormMentions?: (mentions: number[]) => void;
  formTags: string[];
  tagInput: string;
  setTagInput: (val: string) => void;
  currentFormHours: number;
  isSaving: boolean;
  user: User;
  systemUsers: SimpleUserOption[];
  projects: ProductionProject[];
  onAddTag: () => void;
  onRemoveTag: (tag: string) => void;
  onToggleMentionUser: (userId: number) => void;
  onSaveLog: (e: FormEvent) => void;
}

export function DailyLogModal({
  isModalOpen,
  onClose,
  editingLog,
  formDate,
  setFormDate,
  formStartTime,
  setFormStartTime,
  formEndTime,
  setFormEndTime,
  formWorkMode,
  setFormWorkMode,
  formTitle,
  setFormTitle,
  formContent,
  setFormContent,
  formProjectId,
  setFormProjectId,
  formVisibility,
  setFormVisibility,
  formMentions,
  setFormMentions,
  formTags,
  tagInput,
  setTagInput,
  currentFormHours,
  isSaving,
  user,
  systemUsers,
  projects,
  onAddTag,
  onRemoveTag,
  onToggleMentionUser,
  onSaveLog
}: DailyLogModalProps) {
  if (!isModalOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-3 overflow-y-auto font-farsi text-right">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden text-right my-auto">
        {/* Modal Header */}
        <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-400" />
            <h2 className="font-bold text-sm">
              {editingLog ? 'ویرایش گزارش کار روزانه' : 'ثبت گزارش کار روزانه جدید'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={onSaveLog} className="p-4 space-y-3.5 max-h-[82vh] overflow-y-auto custom-scrollbar">
          {/* Row 1: Jalali Date Picker & Work Mode */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                تاریخ (هجری شمسی) <span className="text-rose-500">*</span>
              </label>
              <DatePicker
                value={formDate}
                onChange={(dateObj: any) => {
                  setFormDate(extractDateString(dateObj));
                }}
                calendar={persian}
                locale={persian_fa}
                calendarPosition="bottom-right"
                inputClass="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-xs bg-slate-50 focus:bg-white text-center font-bold text-slate-800"
                containerClassName="w-full"
              />
              {/* Quick Jalali Date Presets */}
              <div className="flex items-center gap-1 mt-1 text-[10px]">
                <button
                  type="button"
                  onClick={() => setFormDate(getTodayJalaliDate())}
                  className="text-blue-600 font-bold hover:underline cursor-pointer"
                >
                  امروز
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                حالت کاری <span className="text-rose-500">*</span>
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setFormWorkMode('onsite')}
                  className={`py-1.5 rounded-lg text-[11px] font-bold border flex items-center justify-center gap-1 transition-all cursor-pointer ${
                    formWorkMode === 'onsite'
                      ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-2xs'
                      : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <Building2 className="w-3 h-3" />
                  حضوری
                </button>
                <button
                  type="button"
                  onClick={() => setFormWorkMode('remote')}
                  className={`py-1.5 rounded-lg text-[11px] font-bold border flex items-center justify-center gap-1 transition-all cursor-pointer ${
                    formWorkMode === 'remote'
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-700 shadow-2xs'
                      : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <Laptop className="w-3 h-3" />
                  دورکاری
                </button>
              </div>
            </div>
          </div>

          {/* Row 2: Time Interval & Hours Display */}
          <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-800 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-amber-500" />
                ساعات کارکرد:
              </span>
              <span className="font-extrabold text-blue-700 bg-blue-100/80 px-2 py-0.5 rounded-md text-[11px]">
                کارکرد: {formatPersianNumber(currentFormHours)} ساعت
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">ساعت شروع</label>
                <input
                  type="time"
                  value={formStartTime}
                  onChange={(e) => setFormStartTime(e.target.value)}
                  className="w-full px-2.5 py-1 border border-slate-200 rounded-lg text-xs bg-white text-center font-bold"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">ساعت پایان</label>
                <input
                  type="time"
                  value={formEndTime}
                  onChange={(e) => setFormEndTime(e.target.value)}
                  className="w-full px-2.5 py-1 border border-slate-200 rounded-lg text-xs bg-white text-center font-bold"
                  required
                />
              </div>
            </div>
          </div>

          {/* Row 3: Simplified Confidentiality & Access Level */}
          <div>
            <label className="block text-xs font-bold text-slate-800 mb-1">
              سطح محرمانگی و مشاهده <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => setFormVisibility('mentioned_only')}
                className={`p-2 rounded-xl border text-right text-xs transition-all flex items-start gap-1.5 cursor-pointer ${
                  formVisibility === 'mentioned_only'
                    ? 'bg-amber-50 border-amber-500 text-amber-900 font-bold shadow-2xs ring-1 ring-amber-400'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <AtSign className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-[11px] font-bold">منشن‌شده‌ها و خودم</p>
                  <p className="text-[9px] font-normal text-slate-500">فقط منشن‌شده‌ها + مدیر</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setFormVisibility('public')}
                className={`p-2 rounded-xl border text-right text-xs transition-all flex items-start gap-1.5 cursor-pointer ${
                  formVisibility === 'public'
                    ? 'bg-blue-50 border-blue-500 text-blue-900 font-bold shadow-2xs ring-1 ring-blue-400'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Eye className="w-3.5 h-3.5 text-blue-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-[11px] font-bold">🌐 عمومی</p>
                  <p className="text-[9px] font-normal text-slate-500">مشاهده برای همه همکاران</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setFormVisibility('private')}
                className={`p-2 rounded-xl border text-right text-xs transition-all flex items-start gap-1.5 cursor-pointer ${
                  formVisibility === 'private'
                    ? 'bg-rose-50 border-rose-500 text-rose-900 font-bold shadow-2xs ring-1 ring-rose-400'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Lock className="w-3.5 h-3.5 text-rose-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-[11px] font-bold">🔒 شخصی</p>
                  <p className="text-[9px] font-normal text-slate-500">فقط خودم و مدیریت</p>
                </div>
              </button>
            </div>
          </div>

          {/* Row 5: Title & Project Link */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                عنوان فعالیت <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                placeholder="عنوان کار (مثلاً: برنامه‌نویسی انبار)"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-xs focus:bg-white"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                پروژه تولید مرتبط (اختیاری)
              </label>
              <select
                value={formProjectId}
                onChange={(e) => setFormProjectId(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-xs bg-slate-50 focus:bg-white"
              >
                <option value="">بدون پروژه (عمومی)</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.project_code} - {p.title}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 6: Tags Input */}
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <input
                type="text"
                placeholder="افزودن برچسب (انتر بکنید)..."
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onAddTag();
                  }
                }}
                className="flex-1 px-3 py-1 border border-slate-200 rounded-lg text-xs bg-slate-50 focus:bg-white"
              />
              <button
                type="button"
                onClick={onAddTag}
                className="px-2.5 py-1 bg-slate-800 text-white rounded-lg text-xs font-bold cursor-pointer"
              >
                افزودن
              </button>
            </div>
            {formTags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {formTags.map((t, idx) => (
                  <span key={idx} className="inline-flex items-center gap-1 text-[10px] bg-blue-50 text-blue-800 px-2 py-0.5 rounded-md border border-blue-200">
                    {t}
                    <button type="button" onClick={() => onRemoveTag(t)} className="text-blue-500 hover:text-rose-600 cursor-pointer">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Row 7: Content / Detailed Work Description */}
          <div>
            <label className="block text-xs font-bold text-slate-800 mb-1">
              شرح کامل فعالیت‌های انجام‌شده <span className="text-rose-500">*</span>
            </label>
            <MentionTextarea
              rows={3}
              placeholder="شرح کارهای انجام‌شده، نتایج حاصله و پیگیری‌ها... (تایپ @ جهت منشن همکاران)"
              value={formContent}
              onChange={setFormContent}
              users={systemUsers}
              currentUser={user}
              mentions={formMentions}
              onMentionsChange={setFormMentions}
              className="w-full p-2.5 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-hidden focus:border-blue-500 leading-relaxed"
              required
            />
          </div>

          {/* Submit Buttons */}
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 transition-colors cursor-pointer"
            >
              انصراف
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-all shadow-md flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              {isSaving ? 'در حال ثبت...' : editingLog ? 'ذخیره تغییرات' : 'ثبت و ارسال گزارش'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
