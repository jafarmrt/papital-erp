import React from 'react';
import { Users, Building2, Truck, UserPlus, UserCheck, Trash2, Plus, CreditCard, X } from 'lucide-react';

export const IRAN_PROVINCES = [
  'آذربایجان شرقی', 'آذربایجان غربی', 'اردبیل', 'اصفهان', 'البرز', 'ایلام',
  'بوشهر', 'تهران', 'چهارمحال و بختیاری', 'خراسان جنوبی', 'خراسان رضوی',
  'خراسان شمالی', 'خوزستان', 'زنجان', 'سمنان', 'سیستان و بلوچستان', 'فارس',
  'قزوین', 'قم', 'کردستان', 'کرمان', 'کرمانشاه', 'کهگیلویه و بویراحمد',
  'گلستان', 'گیلان', 'لرستان', 'مازندران', 'مرکزی', 'هرمزگان', 'همدان', 'یزد'
];

export const CONTACT_ROLES = [
  'مدیر خرید',
  'مدیر فروش / فروشنده',
  'حسابدار / مسئول مالی',
  'مدیرعامل',
  'مسئول انبار / تحویل',
  'پیگیری مطالبات',
  'پشتیبانی',
  'سایر'
];

export const SUPPLIER_CATEGORIES = [
  'سنگ‌های قیمتی، نیمه‌قیمتی و مروارید',
  'اتصالات و خرج‌کار فلزی (استیل، برنز، برنج، نقره)',
  'مهره‌های کریستالی و چوبی',
  'ترنسفر و طرح‌های چاپ',
  'بسته‌بندی، جعبه و کارتن',
  'بند چرم، زنجیر و نخ تسبیح/دستبند',
  'کیلر، رزین، چسب و رنگ',
  'ابزارآلات و قالب‌های تولید',
  'سایر اقلام و خدمات'
];

export interface FormContactPerson {
  id: string;
  name: string;
  role: string;
  phone: string;
  isPrimary: boolean;
}

export interface CustomerPartyForm {
  name: string;
  country: string;
  province: string;
  city: string;
  address: string;
  notes: string;
  partyType: 'customer' | 'supplier' | 'both';
  supplierCategory: string;
  bankInfo: {
    bankName: string;
    accountNumber: string;
    shaba: string;
    cardNumber: string;
  };
}

interface CustomerFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingId: number | null;
  form: CustomerPartyForm;
  setForm: React.Dispatch<React.SetStateAction<CustomerPartyForm>>;
  contacts: FormContactPerson[];
  addContactPerson: () => void;
  removeContactPerson: (id: string) => void;
  updateContactPerson: (id: string, field: keyof FormContactPerson, value: any) => void;
  setPrimaryContact: (id: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  isSaving: boolean;
}

/**
 * V9 Phase 5.2: مودال یکپارچه ثبت/ویرایش طرف حساب — استخراج‌شده از CustomersPage.
 * منطق اعتبارسنجی و ذخیره در صفحه والد باقی می‌ماند؛ این کامپوننت صرفاً UI است.
 */
export function CustomerFormModal({
  isOpen,
  onClose,
  editingId,
  form,
  setForm,
  contacts,
  addContactPerson,
  removeContactPerson,
  updateContactPerson,
  setPrimaryContact,
  onSubmit,
  isSaving
}: CustomerFormModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-[80] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh] overflow-hidden border border-slate-200">
        <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center shrink-0 bg-slate-50/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600/10 text-blue-600 flex items-center justify-center font-bold">
              <Users size={18} />
            </div>
            <div>
              <h3 className="font-bold text-sm sm:text-base text-slate-800">
                {editingId ? 'ویرایش مشخصات طرف حساب' : 'تعریف طرف حساب و شریک تجاری جدید'}
              </h3>
              <p className="text-[11px] text-slate-400">ثبت اطلاعات تجاری، رسته فعالیت، شماره‌های تماس و حساب بانکی</p>
            </div>
          </div>
          <button 
            type="button" 
            onClick={onClose} 
            className="text-slate-400 hover:text-slate-600 rounded-lg p-1.5 hover:bg-slate-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col overflow-hidden flex-1">
          <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar text-xs">

            {/* Section 0: Party Role Selection */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-700">نوع طرف حساب و رسته همکاری <span className="text-rose-500">*</span></label>
              <div className="grid grid-cols-3 gap-2.5">
                <label 
                  className={`flex flex-col items-center justify-center p-3 rounded-xl border cursor-pointer transition-all ${
                    form.partyType === 'customer'
                      ? 'border-blue-500 bg-blue-50/60 text-blue-900 shadow-xs'
                      : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                  }`}
                >
                  <input 
                    type="radio" 
                    name="partyType" 
                    value="customer" 
                    checked={form.partyType === 'customer'} 
                    onChange={() => setForm({ ...form, partyType: 'customer' })} 
                    className="sr-only" 
                  />
                  <Building2 size={18} className={form.partyType === 'customer' ? 'text-blue-600 mb-1' : 'text-slate-400 mb-1'} />
                  <span className="font-bold text-xs">مشتری و خریدار</span>
                  <span className="text-[10px] text-slate-400 mt-0.5">صدور فاکتور و CRM</span>
                </label>

                <label 
                  className={`flex flex-col items-center justify-center p-3 rounded-xl border cursor-pointer transition-all ${
                    form.partyType === 'supplier'
                      ? 'border-emerald-500 bg-emerald-50/60 text-emerald-900 shadow-xs'
                      : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                  }`}
                >
                  <input 
                    type="radio" 
                    name="partyType" 
                    value="supplier" 
                    checked={form.partyType === 'supplier'} 
                    onChange={() => setForm({ ...form, partyType: 'supplier' })} 
                    className="sr-only" 
                  />
                  <Truck size={18} className={form.partyType === 'supplier' ? 'text-emerald-600 mb-1' : 'text-slate-400 mb-1'} />
                  <span className="font-bold text-xs">تامین‌کننده متریال</span>
                  <span className="text-[10px] text-slate-400 mt-0.5">رسید خرید و تسویه</span>
                </label>

                <label 
                  className={`flex flex-col items-center justify-center p-3 rounded-xl border cursor-pointer transition-all ${
                    form.partyType === 'both'
                      ? 'border-amber-500 bg-amber-50/60 text-amber-900 shadow-xs'
                      : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                  }`}
                >
                  <input 
                    type="radio" 
                    name="partyType" 
                    value="both" 
                    checked={form.partyType === 'both'} 
                    onChange={() => setForm({ ...form, partyType: 'both' })} 
                    className="sr-only" 
                  />
                  <Users size={18} className={form.partyType === 'both' ? 'text-amber-600 mb-1' : 'text-slate-400 mb-1'} />
                  <span className="font-bold text-xs">هر دو (دوگانه)</span>
                  <span className="text-[10px] text-slate-400 mt-0.5">خرید و فروش همزمان</span>
                </label>
              </div>
            </div>

            {/* Section 1: Account Information */}
            <div className="space-y-3 bg-slate-50/50 p-4 rounded-xl border border-slate-200">
              <h4 className="text-xs font-bold text-slate-700 border-b border-slate-200 pb-1.5 flex items-center gap-1.5">
                <Building2 size={14} className="text-blue-600" />
                مشخصات هویتی و تجاری
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold mb-1 text-slate-700">نام کامل شرکت / مجموعه / شخص <span className="text-rose-500">*</span></label>
                  <input 
                    required 
                    type="text" 
                    value={form.name} 
                    onChange={e => setForm({...form, name: e.target.value})} 
                    placeholder={form.partyType === 'supplier' ? 'مثلاً: بازرگانی سنگ فیروزه نیشابور، یا کارگاه اتصالات برادران رضایی' : 'مثلاً: شرکت گالری جواهرات مدرن، یا خانم مریم اکبری'}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium" 
                  />
                </div>

                {form.partyType !== 'customer' && (
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold mb-1 text-slate-700">حوزه تامین و رسته کالاها</label>
                    <select
                      value={form.supplierCategory}
                      onChange={e => setForm({ ...form, supplierCategory: e.target.value })}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium"
                    >
                      <option value="">-- انتخاب یا ورود رسته تامین --</option>
                      {SUPPLIER_CATEGORIES.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>

            {/* Section 2: Connected Contacts / Persons */}
            <div className="space-y-3 bg-slate-50/50 p-4 rounded-xl border border-slate-200">
              <div className="flex justify-between items-center border-b border-slate-200 pb-1.5">
                <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <UserPlus size={14} className="text-blue-600" />
                  اشخاص رابط و شماره‌های تماس متصل
                </h4>
                <span className="text-[10px] text-slate-400">می‌توانید چندین شخص با شماره‌های جداگانه تعریف کنید</span>
              </div>

              <div className="space-y-2.5">
                {contacts.map((contact, index) => (
                  <div key={contact.id} className="p-3 bg-white border border-slate-200 rounded-xl space-y-2.5 relative">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                        رابط {index + 1}
                        {contact.isPrimary && (
                          <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 text-[9px] px-1.5 py-0.2 rounded-full font-bold flex items-center gap-0.5">
                            <UserCheck size={10} /> رابط اصلی
                          </span>
                        )}
                      </span>

                      <div className="flex items-center gap-2">
                        {!contact.isPrimary && (
                          <button 
                            type="button" 
                            onClick={() => setPrimaryContact(contact.id)}
                            className="text-[11px] text-blue-600 hover:underline cursor-pointer"
                          >
                            تنظیم به عنوان رابط اصلی
                          </button>
                        )}
                        {contacts.length > 1 && (
                          <button 
                            type="button" 
                            onClick={() => removeContactPerson(contact.id)} 
                            className="p-1 text-rose-500 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                            title="حذف رابط"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                      <div>
                        <label className="block text-[10px] font-medium mb-1 text-slate-600">نام رابط</label>
                        <input 
                          type="text" 
                          value={contact.name} 
                          onChange={e => updateContactPerson(contact.id, 'name', e.target.value)} 
                          placeholder="نام و نام خانوادگی"
                          className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:ring-2 focus:ring-blue-500 outline-none" 
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-medium mb-1 text-slate-600">سمت / مسئولیت</label>
                        <input 
                          type="text"
                          list={`roles-list-${contact.id}`}
                          value={contact.role} 
                          onChange={e => updateContactPerson(contact.id, 'role', e.target.value)} 
                          placeholder="مثلاً: مدیر فروش"
                          className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:ring-2 focus:ring-blue-500 outline-none" 
                        />
                        <datalist id={`roles-list-${contact.id}`}>
                          {CONTACT_ROLES.map((role, idx) => (
                            <option key={`${role}-${idx}`} value={role} />
                          ))}
                        </datalist>
                      </div>

                      <div>
                        <label className="block text-[10px] font-medium mb-1 text-slate-600">شماره(های) تماس</label>
                        <input 
                          type="text" 
                          value={contact.phone} 
                          onChange={e => updateContactPerson(contact.id, 'phone', e.target.value)} 
                          placeholder="09121234567"
                          dir="ltr"
                          className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-mono bg-white focus:ring-2 focus:ring-blue-500 outline-none text-left" 
                        />
                      </div>
                    </div>
                  </div>
                ))}

                <button 
                  type="button" 
                  onClick={addContactPerson} 
                  className="w-full py-2 border border-dashed border-blue-300 hover:border-blue-500 hover:bg-blue-50/40 rounded-xl text-blue-600 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Plus size={14} /> افزودن رابط جدید
                </button>
              </div>
            </div>

            {/* Section 3: Bank & Settlement Info (Useful for Suppliers) */}
            <div className="space-y-3 bg-slate-50/50 p-4 rounded-xl border border-slate-200">
              <h4 className="text-xs font-bold text-slate-700 border-b border-slate-200 pb-1.5 flex items-center gap-1.5">
                <CreditCard size={14} className="text-emerald-600" />
                اطلاعات حساب بانکی جهت تسویه و واریز وجه
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-medium mb-1 text-slate-600">نام بانک و شعبه</label>
                  <input 
                    type="text" 
                    value={form.bankInfo.bankName} 
                    onChange={e => setForm({ ...form, bankInfo: { ...form.bankInfo, bankName: e.target.value } })} 
                    placeholder="مثلاً: بانک ملت شعبه بازار"
                    className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:ring-2 focus:ring-blue-500 outline-none" 
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-medium mb-1 text-slate-600">شماره شبا (بدون IR)</label>
                  <div className="relative">
                    <input 
                      type="text" 
                      value={form.bankInfo.shaba} 
                      onChange={e => setForm({ ...form, bankInfo: { ...form.bankInfo, shaba: e.target.value } })} 
                      placeholder="012345678901234567890123"
                      dir="ltr"
                      className="w-full border border-slate-200 rounded-lg pl-8 pr-2.5 py-1.5 text-xs font-mono bg-white focus:ring-2 focus:ring-blue-500 outline-none text-left" 
                    />
                    <span className="absolute left-2.5 top-1.5 font-bold text-slate-400 font-mono text-[11px]">IR</span>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-medium mb-1 text-slate-600">شماره کارت بانکی</label>
                  <input 
                    type="text" 
                    value={form.bankInfo.cardNumber} 
                    onChange={e => setForm({ ...form, bankInfo: { ...form.bankInfo, cardNumber: e.target.value } })} 
                    placeholder="6037-xxxx-xxxx-xxxx"
                    dir="ltr"
                    className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-mono bg-white focus:ring-2 focus:ring-blue-500 outline-none text-left" 
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-medium mb-1 text-slate-600">شماره حساب</label>
                  <input 
                    type="text" 
                    value={form.bankInfo.accountNumber} 
                    onChange={e => setForm({ ...form, bankInfo: { ...form.bankInfo, accountNumber: e.target.value } })} 
                    placeholder="شماره حساب"
                    dir="ltr"
                    className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-mono bg-white focus:ring-2 focus:ring-blue-500 outline-none text-left" 
                  />
                </div>
              </div>
            </div>

            {/* Section 4: Address & Location */}
            <div className="space-y-3 bg-slate-50/50 p-4 rounded-xl border border-slate-200">
              <h4 className="text-xs font-bold text-slate-700 border-b border-slate-200 pb-1.5">موقعیت مکانی و آدرس</h4>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-medium mb-1 text-slate-600">کشور</label>
                  <select value={form.country} onChange={e => setForm({...form, country: e.target.value, province: '', city: ''})} className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white">
                    <option value="ایران">ایران</option>
                    <option value="سایر">سایر</option>
                  </select>
                </div>
                {form.country === 'ایران' && (
                  <div>
                    <label className="block text-[10px] font-medium mb-1 text-slate-600">استان</label>
                    <select value={form.province} onChange={e => setForm({...form, province: e.target.value})} className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white">
                      <option value="">انتخاب استان...</option>
                      {IRAN_PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                )}

                {form.country === 'ایران' && (
                  <div>
                    <label className="block text-[10px] font-medium mb-1 text-slate-600">شهر</label>
                    <input type="text" value={form.city} onChange={e => setForm({...form, city: e.target.value})} className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white" placeholder="نام شهر" />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[10px] font-medium mb-1 text-slate-600">نشانی کامل پستی</label>
                <textarea value={form.address} onChange={e => setForm({...form, address: e.target.value})} className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white" rows={2} placeholder="خیابان، پلاک، طبقه و واحد..." />
              </div>
              <div>
                <label className="block text-[10px] font-medium mb-1 text-slate-600">یادداشت و شرایط تسویه</label>
                <textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white" rows={2} placeholder="نحوه تسویه، مدت اعتبار، توضیحات تکمیلی..." />
              </div>
            </div>
          </div>

          {/* Modal Footer Actions */}
          <div className="p-4 border-t border-slate-200 flex justify-end gap-2.5 bg-slate-50/80 shrink-0">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-slate-200 rounded-xl hover:bg-slate-100 bg-white text-xs font-bold text-slate-700 cursor-pointer">انصراف</button>
            <button type="submit" disabled={isSaving} className="px-5 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-bold text-xs shadow-xs disabled:opacity-50 cursor-pointer">
              {isSaving ? 'در حال ثبت...' : 'ثبت و ذخیره مشخصات'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CustomerFormModal;
