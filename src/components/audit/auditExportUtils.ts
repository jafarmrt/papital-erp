import toast from 'react-hot-toast';
import { formatPersianDateTime, formatPersianNumber, getTodayJalaliDate } from '../../utils';
import { auditActionLabel } from '../../lib/audit/auditActionLabels';
import { parseUserAgent } from '../../utils/userAgentParser';

/** v9.0.158 (TD-538): نام فایل با تاریخ شمسی امروزِ منطقه زمانی توافقی، نه روز میلادی UTC */
export function auditExportFileName(jalaliDate: string): string {
  return `گزارش-سجل-رویدادها-${jalaliDate.replace(/\//g, '-')}.xlsx`;
}

export interface AuditExportRow {
  id: number;
  timestamp?: string | number;
  username: string;
  userFullName?: string | null;
  action: string;
  entity: string;
  entityId?: string | number | null;
  description: string;
  ipAddress?: string | null;
  details?: any;
}

/** v9.0.157 (TD-527): `total` شمار کل ردیف‌های پالایه از سرور است؛ وقتی فایل کمتر از آن دارد، پیام همین را می‌گوید */
export async function exportAuditLogsToExcel(logs: AuditExportRow[], total: number = logs.length): Promise<void> {
  if (!logs || logs.length === 0) {
    toast.error('هیچ لاگی برای دریافت خروجی اکسل موجود نیست.');
    return;
  }

  try {
    const xlsx = await import('xlsx');

    const formattedData = logs.map((log, index) => {
      const parsedUA = parseUserAgent(log.details?.userAgent);
      return {
        'ردیف': index + 1,
        'شناسه لاگ': log.id,
        'تاریخ و زمان (شمسی)': formatPersianDateTime(log.timestamp),
        'نام کاربری': log.username,
        'نام کامل کاربر': log.userFullName || '—',
        'نوع اقدام': auditActionLabel(log.action),
        'بخش / موجودیت': log.entity,
        'شناسه موجودیت': log.entityId || '—',
        'شرح رویداد': log.description,
        'آدرس IP': log.ipAddress || '—',
        'دستگاه': parsedUA.deviceLabel,
        'سیستم‌عامل': parsedUA.os,
        'مرورگر': parsedUA.browser
      };
    });

    const worksheet = xlsx.utils.json_to_sheet(formattedData);

    // Set column widths
    worksheet['!cols'] = [
      { wch: 6 },   // ردیف
      { wch: 10 },  // شناسه لاگ
      { wch: 22 },  // تاریخ و زمان
      { wch: 15 },  // نام کاربری
      { wch: 20 },  // نام کامل
      { wch: 16 },  // نوع اقدام
      { wch: 18 },  // بخش / موجودیت
      { wch: 14 },  // شناسه موجودیت
      { wch: 45 },  // شرح رویداد
      { wch: 16 },  // IP
      { wch: 18 },  // دستگاه
      { wch: 16 },  // سیستم‌عامل
      { wch: 16 }   // مرورگر
    ];

    const workbook = xlsx.utils.book_new();
    const sheetName = 'سجل_تغییرات_سیستم';
    xlsx.utils.book_append_sheet(workbook, worksheet, sheetName);

    xlsx.writeFile(workbook, auditExportFileName(getTodayJalaliDate()));

    if (logs.length < total) {
      toast(`فقط ${formatPersianNumber(logs.length)} ردیف اول از ${formatPersianNumber(total)} ردیف در فایل اکسل آمده است؛ برای همه ردیف‌ها پالایه را محدودتر کنید.`, { duration: 8000 });
    } else {
      toast.success(`فایل اکسل با موفقیت ایجاد شد (${formatPersianNumber(logs.length)} رکورد)`);
    }
  } catch (error) {
    console.error('Failed to export audit logs to Excel:', error);
    toast.error('خطا در ایجاد فایل اکسل سجل تغییرات');
  }
}
