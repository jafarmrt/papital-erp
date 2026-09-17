import React, { useState, useRef } from 'react';
import { Bell, CheckCheck, Trash2, AtSign, CheckCircle2, MessageSquare, ExternalLink } from 'lucide-react';
import { AppNotification } from '../types';
import { useNavigate } from 'react-router-dom';
import {
  useUnreadNotificationsCountQuery,
  useNotificationsQuery,
  useMarkNotificationReadMutation,
  useMarkAllNotificationsReadMutation,
  useDeleteNotificationMutation
} from '../hooks/queries';
import { useClickOutside } from '../hooks/useClickOutside';

export default function NotificationBell() {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const { data: unreadCount = 0 } = useUnreadNotificationsCountQuery();
  const { data: notifications = [], isLoading: loading } = useNotificationsQuery(isOpen);

  const markReadMutation = useMarkNotificationReadMutation();
  const markAllReadMutation = useMarkAllNotificationsReadMutation();
  const deleteNotifMutation = useDeleteNotificationMutation();

  // Click outside to close dropdown
  useClickOutside([menuRef], () => setIsOpen(false));

  const handleMarkAsRead = (id: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    markReadMutation.mutate(id);
  };

  const handleMarkAllAsRead = () => {
    markAllReadMutation.mutate();
  };

  const handleDeleteNotif = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteNotifMutation.mutate(id);
  };

  const handleNotifClick = (notif: AppNotification) => {
    if (!notif.is_read && !notif.isRead) {
      handleMarkAsRead(notif.id);
    }
    setIsOpen(false);
    if (notif.link) {
      navigate(notif.link);
    }
  };

  const getNotifIcon = (type: string) => {
    switch (type) {
      case 'mention':
        return <AtSign className="w-4 h-4 text-amber-500" />;
      case 'work_log_review':
        return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      default:
        return <MessageSquare className="w-4 h-4 text-blue-500" />;
    }
  };

  const formatRelativeTime = (timeStr?: string) => {
    if (!timeStr) return '';
    try {
      const date = new Date(timeStr);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / (1000 * 60));
      if (diffMins < 1) return 'همین الان';
      if (diffMins < 60) return `${diffMins} دقیقه پیش`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours} ساعت پیش`;
      const diffDays = Math.floor(diffHours / 24);
      return `${diffDays} روز پیش`;
    } catch (e) {
      return timeStr.slice(0, 10);
    }
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all focus:outline-hidden"
        title="اعلان‌ها و منشن‌ها"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-rose-500 text-white font-bold text-[10px] w-5 h-5 rounded-full flex items-center justify-center animate-pulse border-2 border-white shadow-xs">
            {unreadCount > 9 ? '+۹' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute left-0 mt-2 w-80 sm:w-96 bg-white rounded-2xl shadow-xl border border-slate-200 z-50 overflow-hidden flex flex-col text-right">
          <div className="p-3.5 bg-slate-900 text-white flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-bold">اعلان‌ها و منشن‌های شما</span>
              {unreadCount > 0 && (
                <span className="bg-amber-500/20 text-amber-300 text-[10px] font-extrabold px-2 py-0.5 rounded-full border border-amber-500/30">
                  {unreadCount} خوانده‌نشده
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllAsRead}
                className="text-[11px] text-amber-300 hover:text-amber-200 flex items-center gap-1 transition-colors"
                title="خوانده‌شدن همه"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                خوانده‌شدن همه
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 custom-scrollbar">
            {loading ? (
              <div className="p-8 text-center text-xs text-slate-400">در حال دریافت اعلان‌ها...</div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400 flex flex-col items-center gap-2">
                <Bell className="w-8 h-8 text-slate-300 stroke-1" />
                <p>هیچ اعلانی یافت نشد</p>
              </div>
            ) : (
              notifications.map((notif) => {
                const isUnread = !notif.is_read && !notif.isRead;
                return (
                  <div
                    key={notif.id}
                    onClick={() => handleNotifClick(notif)}
                    className={`p-3 text-xs transition-colors cursor-pointer flex items-start gap-3 relative group ${
                      isUnread ? 'bg-amber-50/70 hover:bg-amber-100/60' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="mt-0.5 shrink-0 p-1.5 rounded-xl bg-white border border-slate-200 shadow-2xs">
                      {getNotifIcon(notif.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className={`font-bold truncate ${isUnread ? 'text-slate-900' : 'text-slate-700'}`}>
                          {notif.title}
                        </span>
                        <span className="text-[10px] text-slate-400 shrink-0 mr-1">
                          {formatRelativeTime(notif.created_at || notif.createdAt)}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 line-clamp-2 leading-relaxed">
                        {notif.message}
                      </p>
                      {notif.sender_name && (
                        <span className="text-[10px] text-slate-400 mt-1 inline-block">
                          ارسال از: {notif.sender_name}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      {isUnread && (
                        <button
                          onClick={(e) => handleMarkAsRead(notif.id, e)}
                          className="p-1 hover:bg-slate-200 rounded-lg text-slate-500"
                          title="علامت خوانده شده"
                        >
                          <CheckCheck className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={(e) => handleDeleteNotif(notif.id, e)}
                        className="p-1 hover:bg-rose-100 text-rose-500 rounded-lg"
                        title="حذف"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="p-2 bg-slate-50 border-t border-slate-100 text-center">
            <button
              onClick={() => {
                setIsOpen(false);
                navigate('/daily-logs');
              }}
              className="text-[11px] font-bold text-blue-600 hover:text-blue-700 transition-colors inline-flex items-center gap-1"
            >
              مشاهده تمام گزارش‌های روزانه و منشن‌ها
              <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
