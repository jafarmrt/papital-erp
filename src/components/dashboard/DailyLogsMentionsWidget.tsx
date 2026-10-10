import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AtSign, Clock, User, ArrowLeft, Plus, Tag, Briefcase, MessageSquare, Search, X } from 'lucide-react';
import { toPersianDigits, formatPersianDate } from '../../utils';
import { DailyWorkLog, User as UserModel } from '../../types';
import { idList } from '../../lib/dailyLogs/dailyLogVisibility';

interface DailyLogsMentionsWidgetProps {
  user: UserModel;
  logs: DailyWorkLog[];
  stats?: {
    today_hours?: number;
    my_mentions_count?: number;
    my_total_logs?: number;
  };
  loading?: boolean;
  /** v10.0.88 (TD-1223): فقط دارنده daily_logs.create دکمه «ثبت گزارش» را می‌بیند */
  canCreate?: boolean;
}

export function DailyLogsMentionsWidget({
  user,
  logs = [],
  stats,
  loading = false,
  canCreate = false
}: DailyLogsMentionsWidgetProps) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState<string>('');
  const currentUserId = user?.id;

  // v9.0.253 (TD-638): a log mentions me when its `mentions` (the API field, user ids) holds my id; a text match on
  // «@name» found the wrong user for prefix names (TD-628) and missed logs after a rename
  const mentionedLogs = useMemo(
    () => logs.filter((log) => currentUserId !== undefined && idList(log.mentions).includes(currentUserId)),
    [logs, currentUserId]
  );

  // Search filter
  const displayedLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return mentionedLogs;
    return mentionedLogs.filter((log) => {
      const author = (log.username || (log as any).userName || (log as any).userFullName || '').toLowerCase();
      const content = (log.content || '').toLowerCase();
      const project = (log.projectName || '').toLowerCase();
      return author.includes(q) || content.includes(q) || project.includes(q);
    });
  }, [mentionedLogs, searchQuery]);

  const todayHours = Number(stats?.today_hours || 0);
  const targetHours = 8;
  const progressPercent = Math.min(100, Math.round((todayHours / targetHours) * 100));

  return (
    <div className="bg-white border border-slate-200/80 rounded-3xl p-5 shadow-xs flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold shrink-0">
            <AtSign size={18} />
          </div>
          <div>
            <h2 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
              <span>اشاره‌ها و ارجاعات کار روزانه</span>
              {mentionedLogs.length > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-600 text-white">
                  {toPersianDigits(mentionedLogs.length)} ارجاع
                </span>
              )}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">گزارش‌های کاری همکاران که شما در آن‌ها مخاطب یا نام‌برده شده‌اید</p>
          </div>
        </div>

        <button
          onClick={() => navigate('/daily-logs')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-bold transition-colors"
        >
          <span>کارتابل گزارش کار</span>
          <ArrowLeft size={13} />
        </button>
      </div>

      {/* Today Hours Mini Progress Banner */}
      <div className="p-3.5 bg-gradient-to-r from-blue-50/80 to-indigo-50/80 border border-blue-100 rounded-2xl mb-2.5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
            <Clock size={14} className="text-blue-600" />
            <span>کارکرد ثبت‌شده امروز شما:</span>
            <span className="text-blue-700 font-extrabold">{toPersianDigits(todayHours)} ساعت</span>
            <span className="text-[10px] text-slate-400 font-normal">از ۸ ساعت استاندارد</span>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-blue-200/60 h-1.5 rounded-full mt-2 overflow-hidden">
            <div
              className="bg-blue-600 h-full rounded-full transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {canCreate && (
        <button
          onClick={() => navigate('/daily-logs')}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors shrink-0 flex items-center gap-1"
        >
          <Plus size={13} />
          <span>ثبت گزارش</span>
        </button>
        )}
      </div>

      {/* Search filter if mentions > 3 */}
      {mentionedLogs.length > 3 && (
        <div className="relative mb-2.5">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="جستجو در متن گزارش، همکار یا پروژه..."
            className="w-full pl-8 pr-8 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 text-slate-700"
          />
          <Search size={13} className="absolute right-2.5 top-2.5 text-slate-400" />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute left-2.5 top-2 text-slate-400 hover:text-slate-600"
            >
              <X size={13} />
            </button>
          )}
        </div>
      )}

      {/* Mentioned Logs List with scrollbar */}
      <div className="flex-1 overflow-y-auto space-y-2.5 max-h-72 sm:max-h-80 pr-1">
        {loading ? (
          <div className="space-y-2 py-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-16 bg-slate-100 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : mentionedLogs.length === 0 ? (
          <div className="text-center py-7 px-4 bg-slate-50/70 border border-slate-100 rounded-2xl">
            <div className="w-10 h-10 mx-auto rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mb-2">
              <MessageSquare size={18} />
            </div>
            <p className="text-xs font-bold text-slate-700">هیچ اشاره تازه‌ای ندارید</p>
            <p className="text-[11px] text-slate-400 mt-1">
              وقتی همکاران در ثبت کارهای روزانه از نام کاربری شما استفاده کنند، اینجا نمایش داده می‌شود.
            </p>
          </div>
        ) : displayedLogs.length === 0 && searchQuery ? (
          <div className="text-center py-6 text-slate-400 text-xs bg-slate-50 rounded-2xl">
            موردی مطابق با «{searchQuery}» در اشاره‌ها پیدا نشد.
          </div>
        ) : (
          displayedLogs.map((log) => {
            const authorName = log.username || (log as any).userName || (log as any).userFullName || 'همکار';
            const logDate = log.date || (log as any).logDate || '';

            return (
              <div
                key={log.id}
                onClick={() => navigate(`/daily-logs?id=${log.id}`)}
                className="p-3 bg-slate-50 hover:bg-blue-50/60 border border-slate-200/80 rounded-2xl transition-all cursor-pointer space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[10px] font-bold shrink-0">
                      <User size={12} />
                    </div>
                    <span className="font-bold text-xs text-slate-800 truncate">
                      {authorName}
                    </span>
                  </div>

                  <span className="text-[10px] text-slate-400 font-medium shrink-0">
                    📅 {formatPersianDate(logDate)}
                  </span>
                </div>

                <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                  {log.content}
                </p>

                {/* Tags and Projects */}
                <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-slate-100">
                  {log.projectName && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium bg-purple-50 text-purple-700 border border-purple-100">
                      <Briefcase size={10} />
                      {log.projectName}
                    </span>
                  )}
                  {Array.isArray(log.tags) &&
                    log.tags.slice(0, 3).map((tag, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-lg text-[10px] font-medium bg-slate-200/70 text-slate-700"
                      >
                        <Tag size={9} />
                        {tag}
                      </span>
                    ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer counter */}
      {mentionedLogs.length > 0 && (
        <div className="pt-2.5 mt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
          <span>
            نمایش {toPersianDigits(displayedLogs.length)} از {toPersianDigits(mentionedLogs.length)} اشاره
          </span>
          <button
            onClick={() => navigate('/daily-logs')}
            className="text-blue-600 hover:text-blue-800 font-bold flex items-center gap-1"
          >
            <span>مشاهده آرشیو در گزارش کار</span>
            <ArrowLeft size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
