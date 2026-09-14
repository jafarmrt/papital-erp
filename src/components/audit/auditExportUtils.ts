import toast from 'react-hot-toast';
import { formatPersianDateTime } from '../../utils';
import { parseUserAgent } from '../../utils/userAgentParser';

export interface AuditExportRow {
  id: number;
  timestamp: string | number;
  username: string;
  userFullName?: string | null;
  action: string;
  entity: string;
  entityId?: string | number | null;
  description: string;
  ipAddress?: string | null;
  details?: any;
}

export async function exportAuditLogsToExcel(logs: AuditExportRow[], filterSummary?: string): Promise<void> {
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
        'نوع اقدام': log.action,
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

    const now = new Date().toISOString().slice(0, 10);
    const fileName = `گزارش_سجل_تغییرات_ERP_${now}.xlsx`;
    xlsx.writeFile(workbook, fileName);

    toast.success(`فایل اکسل با موفقیت ایجاد شد (${logs.length} رکورد)`);
  } catch (error) {
    console.error('Failed to export audit logs to Excel:', error);
    toast.error('خطا در ایجاد فایل اکسل سجل تغییرات');
  }
}
