import React from 'react';
import { 
  Calendar as CalendarIcon, Clock, Building2, Laptop, Eye, AtSign, 
  Lock, Tag, CheckCircle2, MessageSquare, Edit3, Trash2 
} from 'lucide-react';
import { DailyWorkLog, User } from '../../types';
import { SimpleUserOption } from '../../hooks/useDailyLogs';
import { formatPersianNumber } from '../../utils';

interface DailyLogsListProps {
  logs: DailyWorkLog[];
  loading: boolean;
  page: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  limit: number;
  user: User;
  systemUsers: SimpleUserOption[];
  onOpenCreateModal: () => void;
  onOpenEditModal: (log: DailyWorkLog) => void;
  onDeleteLog: (logId: number) => void;
  onOpenReviewModal: (log: DailyWorkLog) => void;
}

export function DailyLogsList({
  logs,
  loading,
  page,
  setPage,
  limit,
  user,
  systemUsers,
  onOpenCreateModal,
  onOpenEditModal,
  onDeleteLog,
  onOpenReviewModal
}: DailyLogsListProps) {
  const getWorkModeBadge = (mode: string) => {
    switch (mode) {
      case 'onsite':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
            <Building2 className="w-3 h-3" />
            حضوری
          </span>
        );
      case 'remote':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <Laptop className="w-3 h-3" />
            دورکاری
          </span>
        );
      default:
        return null;
    }
  };

  const getVisibilityBadge = (vis: string) => {
    switch (vis) {
      case 'public':
      case 'all':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500" title="عمومی - همه همکاران">
            <Eye className="w-3 h-3 text-slate-400" />
            عمومی
          </span>
        );
      case 'mentioned_only':
      case 'custom':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200" title="محرمانه - فقط منشن‌شده‌ها و خودم">
            <AtSign className="w-3 h-3 text-amber-600" />
            فقط منشن‌شده‌ها و خودم
          </span>
        );
      case 'private':
      case 'managers':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-800 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200" title="کاملاً شخصی - فقط خودم و مدیریت">
            <Lock className="w-3 h-3 text-rose-600" />
            شخصی (فقط خودم و مدیر)
          </span>
        );
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl p-10 text-center text-slate-400 text-xs font-farsi">
        در حال دریافت گزارش‌های کار...
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-10 text-center text-slate-400 text-xs flex flex-col items-center gap-2.5 border border-slate-200 font-farsi">
        <Clock className="w-10 h-10 text-slate-300 stroke-1" />
        <p className="font-bold text-slate-700 text-sm">هیچ گزارش کاری در این بخش یافت نشد</p>
        <p className="text-slate-400">می‌توانید نخستین گزارش کار روزانه خود را ثبت نمایید</p>
        <button
          onClick={onOpenCreateModal}
          className="mt-1 px-4 py-2 rounded-xl bg-blue-600 text-white font-bold text-xs shadow-sm hover:bg-blue-700 transition-colors cursor-pointer"
        >
          ثبت گزارش کار جدید
        </button>
      </div>
    );
  }

  const totalPages = Math.ceil(logs.length / limit);
  const paginatedLogs = logs.slice((page - 1) * limit, page * limit);

  return (
    <div className="space-y-3.5 font-farsi text-right">
      {paginatedLogs.map((log) => {
        const isOwner = log.userId === user.id || log.user_id === user.id;
        const isManagerOrAdmin = user.role === 'admin' || user.role === 'manager';
        const mentionsList = Array.isArray(log.mentions) ? log.mentions : [];
        const mentionedUsersObj = systemUsers.filter((u) => mentionsList.includes(u.id));

        return (
          <div
            key={log.id}
            className="bg-white rounded-2xl p-4 border border-slate-200 shadow-2xs hover:shadow-md transition-shadow space-y-3"
          >
            {/* Log Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-slate-100 pb-2.5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-slate-900 border-2 border-amber-400 text-amber-400 font-black flex items-center justify-center shrink-0 shadow-xs overflow-hidden text-xs">
                  <span>{(log.user_full_name || log.username || '?').charAt(0)}</span>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 text-xs sm:text-sm">
                      {log.user_full_name || log.username}
                    </span>
                    {getWorkModeBadge(log.work_mode || log.workMode)}
                    {getVisibilityBadge(log.visibility)}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    کد کاربری: #{log.userId || log.user_id}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-slate-600 font-semibold bg-slate-50 px-2.5 py-1 rounded-xl border border-slate-100 self-start sm:self-auto">
                <div className="flex items-center gap-1 text-slate-800">
                  <CalendarIcon className="w-3.5 h-3.5 text-blue-500" />
                  <span>{log.date}</span>
                </div>
                <span className="text-slate-300">|</span>
                <div className="flex items-center gap-1 text-slate-800">
                  <Clock className="w-3.5 h-3.5 text-amber-500" />
                  <span>
                    {log.start_time || log.startTime} الی {log.end_time || log.endTime}
                  </span>
                  <span className="text-[10px] font-extrabold text-blue-700 bg-blue-100/80 px-1.5 py-0.5 rounded-md mr-1">
                    ({formatPersianNumber(log.work_hours || log.workHours)} ساعت)
                  </span>
                </div>
              </div>
            </div>

            {/* Title & Project Link */}
            <div>
              <h3 className="font-bold text-slate-900 text-sm sm:text-base flex items-center gap-2">
                {log.title}
                {log.status === 'reviewed' && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    تأییدشده
                  </span>
                )}
              </h3>
              {log.project_name && (
                <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-blue-700 bg-blue-50/80 px-2 py-0.5 rounded-md font-medium border border-blue-100">
                  <span>پروژه مرتبط:</span>
                  <span className="font-bold">{log.project_name}</span>
                </div>
              )}
            </div>

            {/* Content / Activity Description */}
            <div className="text-xs text-slate-700 leading-relaxed bg-slate-50/70 p-3 rounded-xl border border-slate-100 whitespace-pre-wrap">
              {log.content}
            </div>

            {/* Tags & Mentions */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 pt-0.5">
              <div className="flex flex-wrap items-center gap-1.5">
                {Array.isArray(log.tags) &&
                  log.tags.map((t, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1 text-[10px] font-semibold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md border border-slate-200"
                    >
                      <Tag className="w-3 h-3 text-slate-400" />
                      {t}
                    </span>
                  ))}
              </div>

              {mentionedUsersObj.length > 0 && (
                <div className="flex items-center gap-1 bg-amber-50/80 px-2.5 py-1 rounded-lg border border-amber-200/60 text-xs">
                  <AtSign className="w-3.5 h-3.5 text-amber-600" />
                  <span className="text-[10px] font-bold text-amber-800">افراد منشن‌شده:</span>
                  <div className="flex items-center gap-1">
                    {mentionedUsersObj.map((mUser) => (
                      <span
                        key={mUser.id}
                        className="bg-white text-amber-900 text-[10px] font-bold px-1.5 py-0.5 rounded-md border border-amber-200 shadow-2xs"
                      >
                        @{mUser.full_name || mUser.username}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Manager Feedback Section */}
            {(log.manager_notes || log.managerNotes) && (
              <div className="p-2.5 bg-emerald-50/60 border border-emerald-200/80 rounded-xl text-xs space-y-1">
                <div className="flex items-center gap-1.5 text-emerald-800 font-bold">
                  <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                  <span>بازخورد مدیریت:</span>
                </div>
                <p className="text-slate-700 pr-5 text-[11px]">{log.manager_notes || log.managerNotes}</p>
              </div>
            )}

            {/* Actions Footer */}
            <div className="flex items-center justify-between border-t border-slate-100 pt-2.5 print:hidden">
              <span className="text-[10px] text-slate-400">
                ثبت شده: {log.created_at || log.createdAt}
              </span>

              <div className="flex items-center gap-1.5">
                {isManagerOrAdmin && (
                  <button
                    onClick={() => onOpenReviewModal(log)}
                    className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-[11px] transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    ثبت بازخورد
                  </button>
                )}

                {(isOwner || isManagerOrAdmin) && (
                  <button
                    onClick={() => onOpenEditModal(log)}
                    className="p-1 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors cursor-pointer"
                    title="ویرایش"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                )}

                {(isOwner || isManagerOrAdmin) && (
                  <button
                    onClick={() => onDeleteLog(log.id)}
                    className="p-1 rounded-lg hover:bg-rose-50 text-rose-600 transition-colors cursor-pointer"
                    title="حذف"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* Pagination UI for Daily Logs */}
      {logs.length > 0 && (
        <div className="mt-4 p-4 border border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs bg-slate-50/50 rounded-xl">
          <span className="text-slate-500">
            نمایش صفحه {formatPersianNumber(page)} از {formatPersianNumber(totalPages)} (مجموع{' '}
            {formatPersianNumber(logs.length)} رکورد)
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1.5 border border-slate-300 rounded hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              قبلی
            </button>
            <span className="px-3 font-bold text-slate-700">
              {formatPersianNumber(page)} / {formatPersianNumber(totalPages)}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1.5 border border-slate-300 rounded hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              بعدی
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
