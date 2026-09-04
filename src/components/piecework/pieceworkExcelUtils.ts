import * as xlsx from 'xlsx';
import { PieceworkTask } from '../../types';

export interface ParsedPieceworkRow {
  index: number;
  code: string;
  title: string;
  category: string;
  defaultRate: number;
  unit: string;
  description: string;
  isValid: boolean;
  warnings: string[];
}

/**
 * Downloads a blank or sample template Excel file for piecework tasks
 */
export function downloadPieceworkTemplate() {
  const sampleData = [
    {
      'کد کار': 'PW-001',
      'عنوان کار': 'مونتاژ زنجیر و قفل',
      'دسته‌بندی': 'مونتاژ',
      'نرخ پایه': 35000,
      'واحد سنجش': 'عدد',
      'توضیحات': 'مونتاژ دستی زنجیر با اتصال حلقه و قفل استیل'
    },
    {
      'کد کار': 'PW-002',
      'عنوان کار': 'سمباده و پولیش بدنه',
      'دسته‌بندی': 'سمباده و روتوش',
      'نرخ پایه': 25000,
      'واحد سنجش': 'عدد',
      'توضیحات': 'سمباده‌کاری سطحی دو طرف'
    },
    {
      'کد کار': 'PW-003',
      'عنوان کار': 'بسته‌بندی و الصاق بارکد',
      'دسته‌بندی': 'بسته‌بندی',
      'نرخ پایه': 12000,
      'واحد سنجش': 'بسته',
      'توضیحات': 'قرار دادن در سلفون و کارتن کوچک'
    }
  ];

  const ws = xlsx.utils.json_to_sheet(sampleData);
  // Set column widths for readability
  ws['!cols'] = [
    { wch: 12 }, // کد کار
    { wch: 30 }, // عنوان کار
    { wch: 20 }, // دسته‌بندی
    { wch: 15 }, // نرخ پایه
    { wch: 12 }, // واحد سنجش
    { wch: 45 }  // توضیحات
  ];

  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'عناوین_کاری');
  xlsx.writeFile(wb, 'piecework-tasks-template.xlsx');
}

/**
 * Exports existing piecework tasks to an Excel file (.xlsx)
 */
export function exportPieceworkTasksToExcel(tasks: PieceworkTask[], fileName = 'piecework-tasks-export.xlsx') {
  const exportData = tasks.map((t, idx) => ({
    'ردیف': idx + 1,
    'کد کار': t.code || `PW-${String(t.id).padStart(3, '0')}`,
    'عنوان کار': t.title,
    'دسته‌بندی': t.category || 'سایر',
    'نرخ پایه': Number(t.defaultRate) || 0,
    'واحد سنجش': t.unit || 'عدد',
    'توضیحات': t.description || '',
    'وضعیت': (t.isActive === 1 || (t.isActive as any) === true) ? 'فعال' : 'غیرفعال'
  }));

  const ws = xlsx.utils.json_to_sheet(exportData);
  ws['!cols'] = [
    { wch: 8 },  // ردیف
    { wch: 14 }, // کد کار
    { wch: 35 }, // عنوان کار
    { wch: 22 }, // دسته‌بندی
    { wch: 16 }, // نرخ پایه
    { wch: 14 }, // واحد سنجش
    { wch: 45 }, // توضیحات
    { wch: 12 }  // وضعیت
  ];

  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'عناوین_و_نرخ_کارها');
  xlsx.writeFile(wb, fileName);
}

/**
 * Parses an Excel or CSV file into validated piecework rows
 */
export async function parsePieceworkExcelFile(file: File): Promise<ParsedPieceworkRow[]> {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = xlsx.read(arrayBuffer, { type: 'array' });

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new Error('فایل اکسل ارسالی فاقد هرگونه برگه (Sheet) کاری است.');
  }

  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rawRows: any[] = xlsx.utils.sheet_to_json(worksheet, { defval: '' });

  if (rawRows.length === 0) {
    throw new Error('هیچ داده‌ای در برگه اکسل یافت نشد.');
  }

  const parsedList: ParsedPieceworkRow[] = [];

  rawRows.forEach((row, idx) => {
    // Normalizing column names (Persian and English aliases)
    const title = String(
      row['عنوان کار'] ||
      row['عنوان'] ||
      row['عنوان کاری'] ||
      row['نام کار'] ||
      row['Title'] ||
      row['title'] ||
      row['Task'] ||
      row['task'] ||
      ''
    ).trim();

    const code = String(
      row['کد کار'] ||
      row['کد'] ||
      row['کد کاری'] ||
      row['Code'] ||
      row['code'] ||
      ''
    ).trim();

    const category = String(
      row['دسته‌بندی'] ||
      row['دسته'] ||
      row['گروه'] ||
      row['بخش'] ||
      row['Category'] ||
      row['category'] ||
      'سایر'
    ).trim() || 'سایر';

    const rawRate = row['نرخ پایه'] ||
      row['نرخ'] ||
      row['نرخ پیش‌فرض'] ||
      row['دستمزد'] ||
      row['مبلغ'] ||
      row['Rate'] ||
      row['rate'] ||
      row['defaultRate'] ||
      0;

    // Clean numeric value from comma, spaces, or Persian digits
    let cleanRateStr = String(rawRate)
      .replace(/[,٬\s]/g, '')
      .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d).toString());
    const defaultRate = Number(cleanRateStr) || 0;

    const unit = String(
      row['واحد سنجش'] ||
      row['واحد'] ||
      row['Unit'] ||
      row['unit'] ||
      'عدد'
    ).trim() || 'عدد';

    const description = String(
      row['توضیحات'] ||
      row['شرح'] ||
      row['Description'] ||
      row['description'] ||
      ''
    ).trim();

    const warnings: string[] = [];
    if (!title) {
      warnings.push('عنوان کاری خالی است (ردیف نادیده گرفته خواهد شد)');
    }
    if (defaultRate < 0) {
      warnings.push('نرخ پایه نمی‌تواند منفی باشد');
    }

    parsedList.push({
      index: idx + 1,
      code,
      title,
      category,
      defaultRate: Math.max(0, defaultRate),
      unit,
      description,
      isValid: Boolean(title),
      warnings
    });
  });

  return parsedList;
}
