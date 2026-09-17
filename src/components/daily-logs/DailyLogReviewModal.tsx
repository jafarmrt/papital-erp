import { MessageSquare, X, Send } from 'lucide-react';
import { DailyWorkLog } from '../../types';
import { MentionTextarea } from '../MentionTextarea';

interface DailyLogReviewModalProps {
  reviewModalLog: DailyWorkLog | null;
  onClose: () => void;
  reviewNotes: string;
  setReviewNotes: (notes: string) => void;
  isSubmittingReview: boolean;
  onSaveReview: () => void;
  systemUsers?: any[];
}

export function DailyLogReviewModal({
  reviewModalLog,
  onClose,
  reviewNotes,
  setReviewNotes,
  isSubmittingReview,
  onSaveReview,
  systemUsers = []
}: DailyLogReviewModalProps) {
  if (!reviewModalLog) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 font-farsi text-right">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden text-right max-h-[85vh] flex flex-col">
        <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-emerald-400" />
            <h3 className="font-bold text-sm">ثبت بازخورد مدیریتی</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-100 text-xs">
            <p className="font-bold text-slate-800">{reviewModalLog.title}</p>
            <p className="text-slate-500 text-[11px]">نویسنده: {reviewModalLog.user_full_name || reviewModalLog.username}</p>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              یادداشت و دستور مدیریتی:
            </label>
            <MentionTextarea
              rows={3}
              placeholder="بازخورد، راهنمایی یا دستورات لازم را اینجا تایپ کنید... (تایپ @ جهت منشن همکاران)"
              value={reviewNotes}
              onChange={setReviewNotes}
              users={systemUsers}
              className="w-full p-2.5 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-hidden"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-xs font-bold cursor-pointer"
            >
              انصراف
            </button>
            <button
              type="button"
              disabled={isSubmittingReview}
              onClick={onSaveReview}
              className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs flex items-center gap-1 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              {isSubmittingReview ? 'در حال ثبت...' : 'ثبت و ارسال نوتیفیکیشن'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
