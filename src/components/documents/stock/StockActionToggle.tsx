import { FileInput, FileOutput } from 'lucide-react';

interface StockActionToggleProps {
  actionType: 'in' | 'out';
  onChange: (actionType: 'in' | 'out') => void;
  /** v9.0.216 (TD-791): جهتی که کاربر هیچ نوع سندش را ثبت نمی‌کند غیرفعال است */
  isEnabled?: (actionType: 'in' | 'out') => boolean;
}

/** TD-080 (بخش ۳): انتخاب ورود/خروج انبار — استخراج‌شده از DocumentsPage */
export function StockActionToggle({ actionType, onChange, isEnabled = () => true }: StockActionToggleProps) {
  return (
    <div className="grid grid-cols-2 p-1.5 bg-slate-100/80 border-b border-slate-200 gap-1.5">
      <button 
        type="button" 
        className={`py-3.5 px-4 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
          actionType === 'in' 
            ? 'bg-white text-emerald-700 shadow-sm border border-emerald-200 font-extrabold' 
            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
        }`}
        onClick={() => onChange('in')}
        disabled={!isEnabled('in')}
        title={isEnabled('in') ? undefined : 'ثبت ورود کالا با مجوزهای نقش شما ممکن نیست'}
      >
        <FileInput size={18} className={actionType === 'in' ? 'text-emerald-600' : 'text-slate-400'} />
        <span>ورود به انبار (رسید انبار)</span>
      </button>
      <button 
        type="button" 
        className={`py-3.5 px-4 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
          actionType === 'out' 
            ? 'bg-white text-amber-700 shadow-sm border border-amber-200 font-extrabold' 
            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
        }`}
        onClick={() => onChange('out')}
        disabled={!isEnabled('out')}
        title={isEnabled('out') ? undefined : 'ثبت خروج کالا با مجوزهای نقش شما ممکن نیست'}
      >
        <FileOutput size={18} className={actionType === 'out' ? 'text-amber-600' : 'text-slate-400'} />
        <span>خروج از انبار (حواله مصرف)</span>
      </button>
    </div>
  );
}
