import { FileInput, FileOutput } from 'lucide-react';

interface StockActionToggleProps {
  actionType: 'in' | 'out';
  onChange: (actionType: 'in' | 'out') => void;
}

/** TD-080 (بخش ۳): انتخاب ورود/خروج انبار — استخراج‌شده از DocumentsPage */
export function StockActionToggle({ actionType, onChange }: StockActionToggleProps) {
  return (
    <div className="grid grid-cols-2 p-1.5 bg-slate-100/80 border-b border-slate-200 gap-1.5">
      <button 
        type="button" 
        className={`py-3.5 px-4 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
          actionType === 'in' 
            ? 'bg-white text-emerald-700 shadow-sm border border-emerald-200 font-extrabold' 
            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
        }`}
        onClick={() => onChange('in')}
      >
        <FileInput size={18} className={actionType === 'in' ? 'text-emerald-600' : 'text-slate-400'} />
        <span>ورود به انبار (رسید انبار)</span>
      </button>
      <button 
        type="button" 
        className={`py-3.5 px-4 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
          actionType === 'out' 
            ? 'bg-white text-amber-700 shadow-sm border border-amber-200 font-extrabold' 
            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
        }`}
        onClick={() => onChange('out')}
      >
        <FileOutput size={18} className={actionType === 'out' ? 'text-amber-600' : 'text-slate-400'} />
        <span>خروج از انبار (حواله مصرف)</span>
      </button>
    </div>
  );
}
