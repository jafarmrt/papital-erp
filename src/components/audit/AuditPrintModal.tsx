import React from 'react';
import { Printer, X, ShieldAlert, Calendar, User, FileText } from 'lucide-react';
import { formatPersianDateTime, formatPersianNumber } from '../../utils';
import { parseUserAgent } from '../../utils/userAgentParser';

interface AuditPrintModalProps {
  logs: any[];
  onClose: () => void;
  filterSummary?: {
    categoryLabel?: string;
    userFilter?: string;
    actionFilter?: string;
    entityFilter?: string;
    startDate?: string;
    endDate?: string;
  };
}

export const AuditPrintModal: React.FC<AuditPrintModalProps> = ({ logs, onClose, filterSummary }) => {
  React.useEffect(() => {
    document.body.classList.add('printing-doc');
    return () => {
      document.body.classList.remove('printing-doc');
    };
  }, []);

  const handlePrint = () => {
    window.print();
  };

  const todayShamsi = new Intl.DateTimeFormat('fa-IR', {
    dateStyle: 'full',
    timeStyle: 'short'
  }).format(new Date());

  return (
    <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
      <div className="bg-white rounded-2xl max-w-5xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-300 overflow-hidden doc-print-area">
        {/* Header - Non printable */}
        <div className="flex items-center justify-between border-b border-slate-200 p-4 bg-slate-50 print:hidden">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-xs">
              <Printer className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">پیش‌نمایش چاپ رسمی گزارش سجل تغییرات (Audit Report)</h3>
              <p className="text-2xs text-slate-500">طراحی استاندارد جهت ارائه در ممیزی‌های داخلی و حسابرسی‌های قانونی</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors"
            >
              <Printer className="w-4 h-4" />
              ارسال به چاپگر / ذخیره PDF
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-700 flex items-center justify-center transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Printable Content Area */}
        <div className="p-8 overflow-y-auto space-y-6 text-slate-900 bg-white print:p-0 print:overflow-visible">
          {/* Official Letterhead */}
          <div className="border-b-2 border-slate-900 pb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-slate-900 text-amber-400 flex items-center justify-center font-black text-xl">
                <ShieldAlert className="w-7 h-7" />
              </div>
              <div>
                <h1 className="text-lg font-black text-slate-900">سامانه جامع مدیریت کارگاه و ERP صنعتی</h1>
                <h2 className="text-sm font-bold text-slate-700">گزارش ممیزی امنیتی و سجل رویدادهای سیستمی (Audit Trail)</h2>
              </div>
            </div>

            <div className="text-left text-2xs space-y-1 font-mono text-slate-600">
              <p className="flex items-center gap-1 sm:justify-end">
                <span className="font-bold">تاریخ و ساعت استخراج:</span>
                <span>{todayShamsi}</span>
              </p>
              <p className="flex items-center gap-1 sm:justify-end">
                <span className="font-bold">تعداد کل رکوردها:</span>
                <span>{formatPersianNumber(logs.length)} مورد</span>
              </p>
              <p className="flex items-center gap-1 sm:justify-end">
                <span className="font-bold">سطح دسترسی:</span>
                <span className="text-rose-700 font-bold">محرمانه / نظارت مدیریتی</span>
              </p>
            </div>
          </div>

          {/* Filter Criteria Details */}
          {filterSummary && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-2xs grid grid-cols-2 sm:grid-cols-4 gap-2 text-slate-700">
              <div>
                <span className="text-slate-400 block mb-0.5">دسته‌بندی موضوعی:</span>
                <span className="font-bold text-slate-900">{filterSummary.categoryLabel || 'همه موضوعات'}</span>
              </div>
              <div>
                <span className="text-slate-400 block mb-0.5">فیلتر کاربر:</span>
                <span className="font-bold text-slate-900">{filterSummary.userFilter || 'همه کاربران'}</span>
              </div>
              <div>
                <span className="text-slate-400 block mb-0.5">نوع اقدام:</span>
                <span className="font-bold text-slate-900">{filterSummary.actionFilter || 'همه اقدامات'}</span>
              </div>
              <div>
                <span className="text-slate-400 block mb-0.5">بازه تاریخی:</span>
                <span className="font-bold text-slate-900">
                  {filterSummary.startDate || filterSummary.endDate
                    ? `${filterSummary.startDate || 'ابتدا'} تا ${filterSummary.endDate || 'اکنون'}`
                    : 'کل سوابق ثبت‌شده'}
                </span>
              </div>
            </div>
          )}

          {/* Records Table */}
          <div className="border border-slate-300 rounded-lg overflow-hidden">
            <table className="w-full text-right text-2xs border-collapse">
              <thead className="bg-slate-100 text-slate-800 font-black border-b border-slate-300">
                <tr>
                  <th className="py-2.5 px-3 border-l border-slate-300 text-center w-10">ردیف</th>
                  <th className="py-2.5 px-3 border-l border-slate-300 w-32">تاریخ و زمان</th>
                  <th className="py-2.5 px-3 border-l border-slate-300 w-28">کاربر مجری</th>
                  <th className="py-2.5 px-3 border-l border-slate-300 text-center w-20">اقدام</th>
                  <th className="py-2.5 px-3 border-l border-slate-300 w-24">موجودیت</th>
                  <th className="py-2.5 px-3 border-l border-slate-300">شرح رویداد</th>
                  <th className="py-2.5 px-3 border-l border-slate-300 w-24 text-center">آدرس IP</th>
                  <th className="py-2.5 px-3 w-28 text-center">دستگاه / مرورگر</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {logs.map((log, index) => {
                  const ua = parseUserAgent(log.details?.userAgent);
                  return (
                    <tr key={log.id} className={index % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                      <td className="py-2 px-3 border-l border-slate-200 text-center font-mono text-slate-500">
                        {formatPersianNumber(index + 1)}
                      </td>
                      <td className="py-2 px-3 border-l border-slate-200 font-mono text-slate-800 whitespace-nowrap">
                        {formatPersianDateTime(log.timestamp)}
                      </td>
                      <td className="py-2 px-3 border-l border-slate-200 font-bold text-slate-900">
                        {log.userFullName || log.username}
                        <span className="block text-3xs font-mono text-slate-400 font-normal">@{log.username}</span>
                      </td>
                      <td className="py-2 px-3 border-l border-slate-200 text-center font-bold">
                        <span className={`px-1.5 py-0.5 rounded text-3xs inline-block ${
                          log.action === 'LOGIN' ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' :
                          log.action === 'LOGIN_FAILED' ? 'bg-rose-100 text-rose-800 border border-rose-300' :
                          log.action === 'LOGOUT' ? 'bg-slate-200 text-slate-800 border border-slate-300' :
                          log.action === 'CREATE' ? 'bg-blue-100 text-blue-800 border border-blue-300' :
                          log.action === 'UPDATE' ? 'bg-amber-100 text-amber-800 border border-amber-300' :
                          log.action === 'DELETE' ? 'bg-rose-100 text-rose-800 border border-rose-300' :
                          'bg-slate-100 text-slate-700'
                        }`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="py-2 px-3 border-l border-slate-200 font-medium text-slate-800">
                        {log.entity} {log.entityId ? `(#${log.entityId})` : ''}
                      </td>
                      <td className="py-2 px-3 border-l border-slate-200 text-slate-800 leading-normal">
                        {log.description}
                      </td>
                      <td className="py-2 px-3 border-l border-slate-200 text-center font-mono text-3xs text-slate-600">
                        {log.ipAddress || '—'}
                      </td>
                      <td className="py-2 px-3 text-center text-3xs text-slate-600 leading-tight">
                        <span className="font-semibold text-slate-800 block">{ua.deviceLabel.split(' ')[0]}</span>
                        <span className="text-slate-400">{ua.browser}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Signatures & Approvals for Internal Audit */}
          <div className="pt-6 border-t border-slate-200 grid grid-cols-3 gap-8 text-center text-xs text-slate-700">
            <div className="space-y-12">
              <p className="font-bold">کارشناس استخراج‌کننده گزارش</p>
              <div className="border-b border-dashed border-slate-400 w-36 mx-auto"></div>
              <p className="text-2xs text-slate-500">امضا و تاریخ</p>
            </div>
            <div className="space-y-12">
              <p className="font-bold">مدیر فناوری اطلاعات و امنیت (IT)</p>
              <div className="border-b border-dashed border-slate-400 w-36 mx-auto"></div>
              <p className="text-2xs text-slate-500">امضا و تایید سیستمی</p>
            </div>
            <div className="space-y-12">
              <p className="font-bold">مدیریت ممیزی و حسابرسی داخلی</p>
              <div className="border-b border-dashed border-slate-400 w-36 mx-auto"></div>
              <p className="text-2xs text-slate-500">مهر و امضای نهایی</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
