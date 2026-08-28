import React from 'react';
import { PhoneCall, Video, MessageSquare, Mail, FileText, AtSign, Clock, CheckCircle2 } from 'lucide-react';
import DatePicker from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import { CRMLead, CRMActivity } from '../../types';
import { getTodayJalaliDate, toEnglishDigits, extractDateString } from '../../utils';
import { MentionTextarea } from '../MentionTextarea';

interface CRMInteractionModalProps {
  // Activity Modal Props
  isActivityModalOpen: boolean;
  onCloseActivityModal: () => void;
  selectedLeadForActivity: CRMLead | null;
  setSelectedLeadForActivity: (lead: CRMLead | null) => void;
  leads: CRMLead[];
  activityForm: any;
  setActivityForm: React.Dispatch<React.SetStateAction<any>>;
  isSavingActivity: boolean;
  onSaveActivity: (e: React.FormEvent) => void;
  // V10-4.1: مسئول تسک = پرسنل فعال؛ کاربران فقط برای منشن
  personnelList: any[];
  mentionUsers: any[];
  currentUser: any;
  currentLoggedInUser: string;

  // Followup Result Modal Props
  isFollowupResultModalOpen: boolean;
  onCloseFollowupResultModal: () => void;
  selectedFollowupAct: CRMActivity | null;
  followupResultForm: { result: string; resultNote: string };
  setFollowupResultForm: React.Dispatch<React.SetStateAction<{ result: string; resultNote: string }>>;
  isSubmittingFollowupResult: boolean;
  onConfirmFollowupResult: (e: React.FormEvent) => void;
}

export function CRMInteractionModal({
  isActivityModalOpen,
  onCloseActivityModal,
  selectedLeadForActivity,
  setSelectedLeadForActivity,
  leads,
  activityForm,
  setActivityForm,
  isSavingActivity,
  onSaveActivity,
  personnelList,
  mentionUsers,
  currentUser,
  currentLoggedInUser,
  isFollowupResultModalOpen,
  onCloseFollowupResultModal,
  selectedFollowupAct,
  followupResultForm,
  setFollowupResultForm,
  isSubmittingFollowupResult,
  onConfirmFollowupResult
}: CRMInteractionModalProps) {
  return (
    <>
      {/* Modal 1: Log Activity / Call */}
      {isActivityModalOpen && (
        <div className="fixed inset-0 z-[80] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-xl border border-slate-200 max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white">
              <h3 className="font-black text-base text-slate-900 flex items-center gap-2">
                <PhoneCall className="text-blue-600" size={20} />
                ثبت تماس / اقدام انجام‌شده
              </h3>
              <button
                onClick={onCloseActivityModal}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 cursor-pointer transition-colors"
              >
                ✕
              </button>
            </div>

            <form onSubmit={onSaveActivity} className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* Connected Lead Picker / Info */}
              {selectedLeadForActivity ? (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-900 font-bold flex items-center justify-between">
                  <span>مربوط به پرونده: {selectedLeadForActivity.title} ({selectedLeadForActivity.customerName || 'مشتری'})</span>
                  <button
                    type="button"
                    onClick={() => setSelectedLeadForActivity(null)}
                    className="text-blue-700 hover:text-rose-600 text-[11px] font-normal underline cursor-pointer"
                  >
                    تغییر یا لغو اتصال
                  </button>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    اتصال به پرونده فروش (CRM Lead)
                    {(activityForm?.customerName || activityForm?.customerId) && (
                      <span className="text-[11px] font-normal text-blue-600 font-farsi mr-1">
                        (مربوط به مشتری: {activityForm.customerName || `کد #${activityForm.customerId}`})
                      </span>
                    )}
                  </label>
                  {(() => {
                    const filteredLeads = leads.filter((l) => {
                      if (activityForm?.customerId) {
                        return l.customerId === activityForm.customerId;
                      }
                      if (activityForm?.customerName) {
                        return l.customerName && l.customerName.trim().toLowerCase() === activityForm.customerName.trim().toLowerCase();
                      }
                      return true;
                    });

                    return (
                      <select
                        value={selectedLeadForActivity?.id || ''}
                        onChange={(e) => {
                          const leadId = Number(e.target.value);
                          const found = filteredLeads.find((l) => l.id === leadId);
                          setSelectedLeadForActivity(found || null);
                          if (found) {
                            setActivityForm((prev: any) => ({
                              ...prev,
                              title: prev.title || `تماس با ${found.customerName || found.title}`,
                              assignedTo: prev.assignedTo || found.assignedTo
                            }));
                          }
                        }}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-blue-500 font-bold text-slate-800"
                      >
                        <option value="">
                          {filteredLeads.length === 0 && (activityForm?.customerName || activityForm?.customerId)
                            ? '-- این مشتری هنوز پرونده فروشی ندارد (ثبت تماس عمومی) --'
                            : '-- تماس عمومی با مشتری (بدون اتصال به پرونده خاص) --'}
                        </option>
                        {filteredLeads.map((l) => (
                          <option key={l.id} value={l.id}>
                            پرونده: {l.title} {l.customerName ? `(${l.customerName})` : ''}
                          </option>
                        ))}
                      </select>
                    );
                  })()}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">نوع اقدام / ارتباط</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'call', label: 'تماس تلفنی', icon: PhoneCall },
                    { id: 'meeting', label: 'جلسه', icon: Video },
                    { id: 'whatsapp', label: 'واتساپ/پیام', icon: MessageSquare },
                    { id: 'email', label: 'ایمیل', icon: Mail },
                    { id: 'quote', label: 'پیش‌فاکتور', icon: FileText },
                    { id: 'note', label: 'یادداشت', icon: FileText },
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setActivityForm({ ...activityForm, type: t.id })}
                      className={`p-2 rounded-xl text-xs font-bold border flex flex-col items-center gap-1 transition-all cursor-pointer ${
                        activityForm.type === t.id
                          ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      <t.icon size={16} />
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  عنوان اقدام <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="مثلاً: تماس جهت بررسی قیمت کاشی‌ها"
                  value={activityForm.title}
                  onChange={(e) => setActivityForm({ ...activityForm, title: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-blue-500 focus:bg-white transition-all"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">تاریخ انجام این تماس / اقدام</label>
                  <DatePicker
                    value={activityForm.activityDate || getTodayJalaliDate()}
                    onChange={(dateObj: any) => {
                      setActivityForm({ ...activityForm, activityDate: extractDateString(dateObj) });
                    }}
                    calendar={persian}
                    locale={persian_fa}
                    calendarPosition="bottom-right"
                    inputClass="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-blue-500 font-semibold text-slate-800"
                    containerClassName="w-full"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">نتیجه اولیه تماس / اقدام</label>
                  <select
                    value={activityForm.result}
                    onChange={(e) => setActivityForm({ ...activityForm, result: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-blue-500 font-bold"
                  >
                    <option value="پاسخ داد">پاسخ داد - مذاکره اولیه انجام شد</option>
                    <option value="درخواست پیش‌فاکتور">درخواست ارسال پیش‌فاکتور/قیمت</option>
                    <option value="نیازمند پیگیری مجدد">نیازمند پیگیری در تاریخ دیگر</option>
                    <option value="اشغال/عدم پاسخ">اشغال بود / پاسخ نداد</option>
                    <option value="انصراف خریدار">خریدار فعلاً انصراف داد</option>
                    <option value="موافق و نهایی شد">موافق بود / معامله بسته شد</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">شرح مذاکرات و جزئیات تماس</label>
                <MentionTextarea
                  rows={3}
                  placeholder="مشتری چه مواردی مطرح کرد و فروشنده چه پاسخی داد... (تایپ @ جهت منشن همکاران)"
                  value={activityForm.description}
                  onChange={(newVal) => setActivityForm({ ...activityForm, description: newVal })}
                  users={mentionUsers}
                  currentUser={currentUser}
                  mentions={activityForm.mentions}
                  onMentionsChange={(newMentions) => setActivityForm({ ...activityForm, mentions: newMentions })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-blue-500 focus:bg-white transition-all"
                />
              </div>

              <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl space-y-3">
                <h4 className="font-bold text-xs text-amber-900 flex items-center gap-1.5">
                  <Clock size={15} />
                  تنظیم کار / پیگیری بعدی (اختیاری)
                </h4>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-amber-800 mb-1">تاریخ پیگیری بعدی</label>
                    <DatePicker
                      value={activityForm.nextFollowUpDate}
                      onChange={(dateObj: any) => {
                        setActivityForm({ ...activityForm, nextFollowUpDate: extractDateString(dateObj) });
                      }}
                      calendar={persian}
                      locale={persian_fa}
                      calendarPosition="bottom-right"
                      inputClass="w-full px-2.5 py-1.5 bg-white border border-amber-300 rounded-lg text-xs outline-none focus:border-amber-500 font-semibold text-slate-800"
                      containerClassName="w-full"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-amber-800 mb-1">عنوان کار پیگیری</label>
                    <input
                      type="text"
                      placeholder="پیگیری ارسال نمونه کار"
                      value={activityForm.nextFollowUpTask}
                      onChange={(e) => setActivityForm({ ...activityForm, nextFollowUpTask: e.target.value })}
                      className="w-full px-2.5 py-1.5 bg-white border border-amber-300 rounded-lg text-xs outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-amber-800 mb-1">مسئول پیگیری / تسک (پرسنل)</label>
                  <select
                    value={activityForm.assignedPersonnelId ? String(activityForm.assignedPersonnelId) : ''}
                    onChange={(e) => {
                      const id = e.target.value ? Number(e.target.value) : null;
                      const selected = personnelList.find((p: any) => p.id === id);
                      setActivityForm({ ...activityForm, assignedPersonnelId: id, assignedTo: selected?.fullName || '' });
                    }}
                    className="w-full px-2.5 py-1.5 bg-white border border-amber-300 rounded-lg text-xs outline-none focus:border-amber-500 font-bold text-slate-800"
                  >
                    <option value="">-- انتخاب مسئول تسک --</option>
                    {personnelList.map((p: any) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.fullName}{p.jobTitle ? ` — ${p.jobTitle}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-3 shrink-0">
                <button
                  type="button"
                  onClick={onCloseActivityModal}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  disabled={isSavingActivity}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-blue-600/30 disabled:opacity-50 cursor-pointer"
                >
                  {isSavingActivity ? 'در حال ثبت...' : 'ثبت اقدام و ذخیره'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Followup Result Modal */}
      {isFollowupResultModalOpen && selectedFollowupAct && (
        <div className="fixed inset-0 z-[90] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-black text-sm text-slate-900 flex items-center gap-2">
                <CheckCircle2 className="text-emerald-600" size={20} />
                ثبت نتیجه پیگیری و تکمیل تسک
              </h3>
              <button
                type="button"
                onClick={onCloseFollowupResultModal}
                className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs space-y-1">
              <span className="font-bold text-amber-900 block">
                عنوان کار: {selectedFollowupAct.nextFollowUpTask || selectedFollowupAct.title}
              </span>
              <span className="text-amber-700 block text-[11px]">
                تاریخ سررسید: {selectedFollowupAct.nextFollowUpDate || 'تعیین نشده'}
              </span>
            </div>

            <form onSubmit={onConfirmFollowupResult} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  نتیجه تماس / پیگیری <span className="text-rose-500">*</span>
                </label>
                <select
                  value={followupResultForm.result}
                  onChange={(e) => setFollowupResultForm({ ...followupResultForm, result: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800 outline-none focus:border-blue-500"
                >
                  <option value="پاسخ داد و توافق شد">پاسخ داد و توافق شد</option>
                  <option value="ارسال پیش‌فاکتور جدید">ارسال پیش‌فاکتور جدید</option>
                  <option value="عدم پاسخگویی / اشغال">عدم پاسخگویی / اشغال</option>
                  <option value="درخواست زمان بیشتر">درخواست زمان بیشتر</option>
                  <option value="عدم تمایل / انصراف خریدار">عدم تمایل / انصراف خریدار</option>
                  <option value="انجام شد">انجام شد</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  خلاصه توضیحات و نتیجه صحبت‌ها (یادداشت پیگیری):
                </label>
                <textarea
                  rows={3}
                  placeholder="مثال: با مشتری صحبت شد، قرار شد تا فردا پیش‌فاکتور اصلاحی ارسال شود..."
                  value={followupResultForm.resultNote}
                  onChange={(e) => setFollowupResultForm({ ...followupResultForm, resultNote: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:bg-white transition-all text-xs"
                />
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onCloseFollowupResultModal}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition-all cursor-pointer"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingFollowupResult}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold transition-all shadow-md shadow-emerald-600/20 disabled:opacity-50 cursor-pointer"
                >
                  {isSubmittingFollowupResult ? 'در حال ثبت...' : 'ثبت و تکمیل تسک'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

export default CRMInteractionModal;
