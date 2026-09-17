import React from 'react';
import { Briefcase, Trash2, Users, Plus } from 'lucide-react';
import DatePicker from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import { CRMLead } from '../../types';
import { SearchableSelect } from '../SearchableSelect';
import { STAGES, SOURCES } from '../../hooks/useCRMData';
import { formatPersianPrice, formatCurrencyLabel, getFutureJalaliDate, extractDateString } from '../../utils';

interface CRMLeadModalProps {
  isLeadModalOpen: boolean;
  onCloseLeadModal: () => void;
  editingLead: CRMLead | null;
  leadForm: any;
  setLeadForm: React.Dispatch<React.SetStateAction<any>>;
  isSavingLead: boolean;
  onSaveLead: (e: React.FormEvent) => void;
  onDeleteLead: (leadId: number) => void;
  customersList: any[];
  // V10-4.1: منبع فروشنده مسئول = پرسنل فعال
  personnelList: any[];
  currentPersonnelId: number | null;
  currentLoggedInUser: string;
  isAdminOrManager: boolean;
}

export function CRMLeadModal({
  isLeadModalOpen,
  onCloseLeadModal,
  editingLead,
  leadForm,
  setLeadForm,
  isSavingLead,
  onSaveLead,
  onDeleteLead,
  customersList,
  personnelList,
  currentPersonnelId,
  currentLoggedInUser,
  isAdminOrManager
}: CRMLeadModalProps) {
  if (!isLeadModalOpen) return null;

  return (
    <div className="fixed inset-0 z-[80] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full shadow-xl border border-slate-200 max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white">
          <h3 className="font-black text-base text-slate-900 flex items-center gap-2">
            <Briefcase className="text-blue-600" size={20} />
            {editingLead ? 'ویرایش پرونده فروش' : 'ثبت فرصت فروش جدید'}
          </h3>
          <button
            onClick={onCloseLeadModal}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 cursor-pointer transition-colors"
          >
            ✕
          </button>
        </div>

        <form onSubmit={onSaveLead} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">
                عنوان فرصت فروش <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="مثلاً: فروش کاشی‌های ۵۰×۵۰ پروژه برج آسمان"
                value={leadForm.title}
                onChange={(e) => setLeadForm({ ...leadForm, title: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-blue-500 focus:bg-white transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">انتخاب از لیست مشتریان / طرفین حساب (اختیاری)</label>
              <SearchableSelect
                options={customersList.map((c) => ({
                  value: String(c.id),
                  label: `${c.name}${c.contactName ? ` (${c.contactName})` : ''} - ${c.phone || 'بدون تلفن'}`
                }))}
                value={leadForm.customerId}
                onChange={(val) => {
                  const sel = customersList.find((c) => String(c.id) === val);
                  if (sel) {
                    setLeadForm({
                      ...leadForm,
                      customerId: val,
                      customerName: sel.contactName || sel.name,
                      phone: sel.phone || leadForm.phone,
                      company: (sel.contactName && sel.name !== sel.contactName) ? sel.name : (leadForm.company || '')
                    });
                  } else {
                    setLeadForm({ ...leadForm, customerId: val });
                  }
                }}
                placeholder="جستجو و انتخاب مشتری..."
                maxResults={4}
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">نام مشتری / مخاطب</label>
              <input
                type="text"
                placeholder="نام کامل خریدار"
                value={leadForm.customerName}
                onChange={(e) => setLeadForm({ ...leadForm, customerName: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-blue-500 focus:bg-white transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">شماره تلفن تماس</label>
              <input
                type="text"
                placeholder="09123456789"
                value={leadForm.phone}
                onChange={(e) => setLeadForm({ ...leadForm, phone: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-blue-500 focus:bg-white transition-all dir-ltr text-right"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">نام شرکت / مجموعه</label>
              <input
                type="text"
                placeholder="مثلاً: شرکت ساختمانی پارس"
                value={leadForm.company}
                onChange={(e) => setLeadForm({ ...leadForm, company: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-blue-500 focus:bg-white transition-all"
              />
            </div>

            {/* Multiple Contact Persons Section */}
            <div className="md:col-span-2 bg-slate-50/80 p-3.5 rounded-xl border border-slate-200/80 space-y-2.5">
              <div className="flex items-center justify-between border-b border-slate-200/60 pb-2">
                <span className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                  <Users size={15} className="text-blue-600" />
                  افراد مرتبط و مخاطبین این فرصت (نام، سمت و شماره تلفن)
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const currentContacts = Array.isArray(leadForm.contacts) ? leadForm.contacts : [];
                    setLeadForm({
                      ...leadForm,
                      contacts: [
                        ...currentContacts,
                        { id: Date.now().toString(), name: '', role: 'رابط اصلی', phone: '' }
                      ]
                    });
                  }}
                  className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1 cursor-pointer"
                >
                  <Plus size={13} />
                  افزودن فرد جدید
                </button>
              </div>

              {(!Array.isArray(leadForm.contacts) || leadForm.contacts.length === 0) ? (
                <p className="text-[11px] text-slate-500 italic text-center py-1">
                  هنوز فرد رابط اضافه نشده است. با کلیک بر روی دکمه بالا می‌توانید چندین شخص را ثبت کنید.
                </p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar pl-1">
                  {leadForm.contacts.map((contact: any, idx: number) => (
                    <div key={contact.id || idx} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center bg-white p-2 rounded-lg border border-slate-200">
                      <div className="sm:col-span-4">
                        <input
                          type="text"
                          placeholder="نام و نام خانوادگی فرد"
                          value={contact.name || ''}
                          onChange={(e) => {
                            const updated = leadForm.contacts.map((c: any) => c.id === contact.id ? { ...c, name: e.target.value } : c);
                            setLeadForm({ ...leadForm, contacts: updated });
                          }}
                          className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500 font-medium"
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <input
                          type="text"
                          placeholder="سمت (مثلا: مدیر خرید)"
                          value={contact.role || ''}
                          onChange={(e) => {
                            const updated = leadForm.contacts.map((c: any) => c.id === contact.id ? { ...c, role: e.target.value } : c);
                            setLeadForm({ ...leadForm, contacts: updated });
                          }}
                          className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500 font-medium"
                        />
                      </div>
                      <div className="sm:col-span-4">
                        <input
                          type="text"
                          placeholder="شماره مستقیم"
                          value={contact.phone || ''}
                          onChange={(e) => {
                            const updated = leadForm.contacts.map((c: any) => c.id === contact.id ? { ...c, phone: e.target.value } : c);
                            setLeadForm({ ...leadForm, contacts: updated });
                          }}
                          className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500 font-medium dir-ltr text-right"
                        />
                      </div>
                      <div className="sm:col-span-1 flex justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            const updated = leadForm.contacts.filter((c: any) => c.id !== contact.id);
                            setLeadForm({ ...leadForm, contacts: updated });
                          }}
                          className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                          title="حذف این مخاطب"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">منبع آشنایی / جذب</label>
              <select
                value={leadForm.source}
                onChange={(e) => setLeadForm({ ...leadForm, source: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-blue-500 font-medium"
              >
                {SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">مرحله قیف فروش</label>
              <select
                value={leadForm.stage}
                onChange={(e) => setLeadForm({ ...leadForm, stage: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-blue-500 font-medium"
              >
                {STAGES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                ارزش تخمینی معامله ({formatCurrencyLabel(leadForm.currency)})
              </label>
              <input
                type="text"
                placeholder="0"
                value={leadForm.estimatedValue ? leadForm.estimatedValue.toLocaleString('en-US') : ''}
                onChange={(e) => {
                  const rawNum = e.target.value.replace(/,/g, '').replace(/[^0-9]/g, '');
                  setLeadForm({ ...leadForm, estimatedValue: rawNum ? parseInt(rawNum, 10) : 0 });
                }}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-blue-500 focus:bg-white transition-all font-mono text-left"
                dir="ltr"
              />
              {leadForm.estimatedValue > 0 && (
                <p className="text-[11px] font-bold text-blue-600 mt-1">
                  {formatPersianPrice(leadForm.estimatedValue)} {formatCurrencyLabel(leadForm.currency)}
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">احتمال موفقیت (٪)</label>
              <input
                type="number"
                min="0"
                max="100"
                value={leadForm.probability}
                onChange={(e) => setLeadForm({ ...leadForm, probability: parseInt(e.target.value) || 50 })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-blue-500 focus:bg-white transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">فروشنده مسئول (پرسنل)</label>
              <select
                value={leadForm.assignedPersonnelId ? String(leadForm.assignedPersonnelId) : ''}
                onChange={(e) => {
                  const id = e.target.value ? Number(e.target.value) : null;
                  const selected = personnelList.find((p: any) => p.id === id);
                  setLeadForm({ ...leadForm, assignedPersonnelId: id, assignedTo: selected?.fullName || leadForm.assignedTo });
                }}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-blue-500 font-semibold text-slate-800"
              >
                {!leadForm.assignedPersonnelId && (
                  <option value="">{leadForm.assignedTo || currentLoggedInUser} (بدون اتصال پرسنلی)</option>
                )}
                {personnelList.map((p: any) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.fullName}{p.jobTitle ? ` — ${p.jobTitle}` : ''}
                  </option>
                ))}
              </select>
              {currentPersonnelId && String(leadForm.assignedPersonnelId || '') !== '' && !editingLead && (
                <p className="text-[10px] text-emerald-600 mt-1">پیش‌فرض: پرسنل متصل به حساب کاربری شما</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">تاریخ پیش‌بینی بسته‌شدن</label>
              <DatePicker
                value={leadForm.expectedCloseDate || getFutureJalaliDate(30)}
                onChange={(dateObj: any) => {
                  setLeadForm({ ...leadForm, expectedCloseDate: extractDateString(dateObj) });
                }}
                calendar={persian}
                locale={persian_fa}
                calendarPosition="bottom-right"
                inputClass="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-blue-500 focus:bg-white transition-all text-right font-semibold text-slate-800"
                containerClassName="w-full"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">توضیحات و یادداشت اولیه</label>
              <textarea
                rows={3}
                placeholder="جزئیات درخواست مشتری و نیازمندی‌ها..."
                value={leadForm.notes}
                onChange={(e) => setLeadForm({ ...leadForm, notes: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-blue-500 focus:bg-white transition-all"
              />
            </div>
          </div>
        </div>

        <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-3 shrink-0">
            {editingLead && isAdminOrManager ? (
              <button
                type="button"
                onClick={() => {
                  onDeleteLead(editingLead.id);
                  onCloseLeadModal();
                }}
                className="px-3.5 py-2 bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 size={15} />
                حذف پرونده
              </button>
            ) : <div />}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onCloseLeadModal}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                انصراف
              </button>
              <button
                type="submit"
                disabled={isSavingLead}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-blue-600/30 disabled:opacity-50 cursor-pointer"
              >
                {isSavingLead ? 'در حال ذخیره...' : editingLead ? 'به‌روزرسانی پرونده' : 'ذخیره فرصت فروش'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CRMLeadModal;
