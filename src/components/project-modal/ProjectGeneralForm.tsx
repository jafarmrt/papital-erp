import React from 'react';
import { Sparkles } from 'lucide-react';
import DatePicker from 'react-multi-date-picker';
import persian from 'react-date-object/calendars/persian';
import persian_fa from 'react-date-object/locales/persian_fa';
import { SearchableSelect } from '../SearchableSelect';
import { extractDateString } from '../../utils';
import { Customer } from '../../types';

interface ProjectGeneralFormProps {
  projectCode: string;
  setProjectCode: (val: string) => void;
  title: string;
  setTitle: (val: string) => void;
  selectedCustomerId: number | null;
  selectedCustomer: Customer | undefined;
  activeCustomersList: Customer[];
  startDate: any;
  setStartDate: (val: any) => void;
  endDate: any;
  setEndDate: (val: any) => void;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  setPriority: (val: 'low' | 'medium' | 'high' | 'urgent') => void;
  description: string;
  setDescription: (val: string) => void;
  onCustomerSelect: (id: number | null) => void;
}

export const ProjectGeneralForm: React.FC<ProjectGeneralFormProps> = ({
  projectCode,
  setProjectCode,
  title,
  setTitle,
  selectedCustomerId,
  selectedCustomer,
  activeCustomersList,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  priority,
  setPriority,
  description,
  setDescription,
  onCustomerSelect
}) => {
  return (
    <div className="bg-slate-50/80 p-5 rounded-2xl border border-slate-200/80 space-y-4">
      <h3 className="text-xs font-bold text-slate-800 flex items-center gap-2 border-b border-slate-200 pb-2">
        <Sparkles size={14} className="text-blue-600" />
        مشخصات عمومی و زمان‌بندی پروژه
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Project Code */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            کد پروژه (اختیاری)
          </label>
          <input
            type="text"
            value={projectCode}
            onChange={(e) => setProjectCode(e.target.value)}
            placeholder="مثال: PRJ-1403-01 (خالی = خودکار)"
            className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono"
            dir="ltr"
          />
        </div>

        {/* Project Title */}
        <div className="md:col-span-2">
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            عنوان پروژه / سفارش <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="مثال: سفارش تولید اکسسوری گالری لوتوس"
            className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
          />
        </div>

        {/* Customer Select */}
        <div className="md:col-span-3">
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            مشتری / سفارش‌دهنده
          </label>
          <SearchableSelect
            options={activeCustomersList.map((c) => ({
              value: String(c.id),
              label: `${c.name}${c.code ? ` (کد: ${c.code})` : ''}${c.phone ? ` - ${c.phone}` : ''}`,
            }))}
            value={selectedCustomerId ? String(selectedCustomerId) : ''}
            onChange={(val) => onCustomerSelect(val ? Number(val) : null)}
            placeholder="جستجو و انتخاب مشتری..."
            className="w-full"
          />
          {selectedCustomer && (
            <p className="text-2xs text-slate-500 mt-1">
              مشتری انتخاب شده: <span className="font-bold text-slate-700">{selectedCustomer.name}</span>
              {selectedCustomer.phone && ` (${selectedCustomer.phone})`}
            </p>
          )}
        </div>

        {/* Start Date */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            تاریخ شروع <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <DatePicker
              value={startDate}
              onChange={(val: any) => setStartDate(extractDateString(val))}
              calendar={persian}
              locale={persian_fa}
              calendarPosition="bottom-right"
              inputClass="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              placeholder="انتخاب تاریخ شروع"
            />
          </div>
        </div>

        {/* End Date */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            تاریخ تحویل / پایان <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <DatePicker
              value={endDate}
              onChange={(val: any) => setEndDate(extractDateString(val))}
              calendar={persian}
              locale={persian_fa}
              calendarPosition="bottom-right"
              inputClass="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              placeholder="انتخاب تاریخ پایان"
            />
          </div>
        </div>

        {/* Priority */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            اولویت پروژه
          </label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as any)}
            className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
          >
            <option value="low">کم</option>
            <option value="medium">متوسط</option>
            <option value="high">زیاد</option>
            <option value="urgent">فوری / اضطراری</option>
          </select>
        </div>

        {/* Workshop Description */}
        <div className="md:col-span-3">
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            توضیحات و دستورالعمل کارگاهی
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="نکات خاص تولید، بسته‌بندی ویژه، الزامات فنی یا ابعاد سفارش..."
            className="w-full bg-white border border-slate-300 rounded-xl p-3 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none"
          />
        </div>
      </div>
    </div>
  );
};
