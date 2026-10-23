import { useState } from 'react';
import { Users, Search, UserCheck, X } from 'lucide-react';
import { toPersianDigits } from '../../../utils';
import { DialogLayer } from '../../common/DialogLayer';
import { personNameOf, type SchedulePerson } from './useScheduleReferenceData';

interface SchedulePersonnelPickerProps {
  personnelList: SchedulePerson[];
  /** the picked personnel, null for no one */
  onPick: (person: SchedulePerson | null) => void;
  onClose: () => void;
}

/** the personnel picker of a plan row, searched by name, job title or personnel code; it starts with an empty search */
export function SchedulePersonnelPicker({ personnelList, onPick, onClose }: SchedulePersonnelPickerProps) {
  const [personnelSearch, setPersonnelSearch] = useState('');
  const searchLower = personnelSearch.trim().toLowerCase();
  const filteredPersonnel = !searchLower ? personnelList : personnelList.filter(p => {
    const nameStr = (p.fullName || `${p.firstName || p.first_name || ''} ${p.lastName || p.last_name || ''} ${p.name || ''}`).toLowerCase();
    const jobStr = (p.jobTitle || p.job_title || p.role || '').toLowerCase();
    const codeStr = (p.personnelCode || p.personnel_code || '').toLowerCase();
    return nameStr.includes(searchLower) || jobStr.includes(searchLower) || codeStr.includes(searchLower);
  });

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
      <DialogLayer onClose={onClose} />
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]">
        {/* Modal Header */}
        <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-amber-400" />
            <div>
              <h3 className="font-bold text-sm text-white">انتخاب مسئول / مجری از لیست پرسنل</h3>
              <p className="text-[11px] text-slate-400">پرسنل مورد نظر را جهت تخصیص کارمزد انتخاب کنید</p>
            </div>
          </div>
          <button aria-label="بستن"
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl cursor-pointer transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Search Input */}
        <div className="p-3 bg-slate-50 border-b border-slate-200">
          <div className="relative">
            <Search size={16} className="absolute right-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={personnelSearch}
              onChange={(e) => setPersonnelSearch(e.target.value)}
              placeholder="جست‌وجوی نام پرسنل، سمبل کاری، کد پرسنلی یا سمت..."
              className="w-full pr-9 pl-3 py-1.5 text-xs border border-slate-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 font-semibold"
              autoFocus
            />
          </div>
        </div>

        {/* Personnel List */}
        <div className="p-3 overflow-y-auto space-y-2 flex-1">
          <button
            type="button"
            onClick={() => onPick(null)}
            className="w-full p-2.5 text-right border border-dashed border-slate-300 hover:border-rose-400 bg-slate-50 hover:bg-rose-50 rounded-xl text-xs font-semibold text-slate-600 hover:text-rose-700 flex items-center justify-between transition-colors cursor-pointer"
          >
            <span>عدم تخصیص (بدون مسئول)</span>
            <X size={14} className="text-slate-400" />
          </button>

          {filteredPersonnel.length > 0 ? (
            filteredPersonnel.map((person) => {
              const fullName = personNameOf(person) || 'پرسنل';
              const jobTitle = person.jobTitle || person.job_title || person.role || 'کارگر کارگاه';
              const code = person.personnelCode || person.personnel_code || person.id;

              return (
                <div
                  key={person.id}
                  onClick={() => onPick(person)}
                  className="p-3 bg-white hover:bg-amber-50/80 border border-slate-200 hover:border-amber-300 rounded-xl flex items-center justify-between gap-3 transition-all cursor-pointer group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-slate-100 group-hover:bg-amber-200 text-slate-700 group-hover:text-amber-900 font-bold flex items-center justify-center shrink-0 text-xs transition-colors">
                      {fullName.charAt(0)}
                    </div>
                    <div>
                      <div className="font-bold text-slate-800 text-xs group-hover:text-amber-950 flex items-center gap-2">
                        <span>{fullName}</span>
                        <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.2 rounded">
                          کد: {code}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2">
                        <span className="font-medium text-slate-600">{jobTitle}</span>
                        {person.phone && (
                          <span className="text-[10px] font-mono text-slate-400">| {person.phone}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="text-amber-600 opacity-0 group-hover:opacity-100 transition-opacity">
                    <UserCheck size={18} />
                  </div>
                </div>
              );
            })
          ) : (
            <div className="p-8 text-center text-slate-400 text-xs">
              هیچ پرسنلی با عبارت جست‌وجو شده پیدا نشد.
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3 bg-slate-100 border-t border-slate-200 flex items-center justify-between text-slate-500 text-[11px]">
          <span>مجموع پرسنل فعال: {toPersianDigits(personnelList.length)} نفر</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 bg-white border border-slate-300 rounded-lg font-bold hover:bg-slate-200 text-slate-700 cursor-pointer"
          >
            انصراف
          </button>
        </div>
      </div>
    </div>
  );
}
