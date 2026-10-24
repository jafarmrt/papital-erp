import { downloadSheet, loadXlsx } from '../../lib/excel/downloadSheet';
import { PieceworkTask } from '../../types';
import { parsePieceworkRate } from '../../lib/piecework/pieceworkRate';

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
export async function downloadPieceworkTemplate(): Promise<void> {
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

  // column widths for readability
  await downloadSheet(sampleData, 'عناوین_کاری', 'piecework-tasks-template.xlsx', [
    { wch: 12 }, // کد کار
    { wch: 30 }, // عنوان کار
    { wch: 20 }, // دسته‌بندی
    { wch: 15 }, // نرخ پایه
    { wch: 12 }, // واحد سنجش
    { wch: 45 }  // توضیحات
  ]);
}

/**
 * Exports existing piecework tasks to an Excel file (.xlsx)
 */
export async function exportPieceworkTasksToExcel(tasks: PieceworkTask[], fileName = 'piecework-tasks-export.xlsx'): Promise<void> {
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

  await downloadSheet(exportData, 'عناوین_و_نرخ_کارها', fileName, [
    { wch: 8 },  // ردیف
    { wch: 14 }, // کد کار
    { wch: 35 }, // عنوان کار
    { wch: 22 }, // دسته‌بندی
    { wch: 16 }, // نرخ پایه
    { wch: 14 }, // واحد سنجش
    { wch: 45 }, // توضیحات
    { wch: 12 }  // وضعیت
  ]);
}

/**
 * Parses an Excel or CSV file into validated piecework rows
 */
export async function parsePieceworkExcelFile(file: File): Promise<ParsedPieceworkRow[]> {
  const arrayBuffer = await file.arrayBuffer();
  // 10.3 package 6 (I-05): the xlsx library loads when a file is made or read, not with the page
  const xlsx = await loadXlsx();
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

  return parsePieceworkTaskRows(rawRows);
}

/** ردیف‌های خام برگه اکسل را به ردیف‌های سنجیده‌شده پیش‌نمایش تبدیل می‌کند */
export function parsePieceworkTaskRows(rawRows: Array<Record<string, unknown>>): ParsedPieceworkRow[] {
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
      row['defaultRate'];

    // v9.0.279 (TD-813): همان قاعده سرور؛ نرخ متن یا منفی ردیف را نامعتبر می‌کند (پیش‌تر منفی بی‌صدا صفر می‌شد)
    const parsedRate = parsePieceworkRate(rawRate, 'نرخ پایه');
    const defaultRate = parsedRate.ok ? Number(parsedRate.value ?? 0) : 0;

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
    if (!parsedRate.ok) {
      warnings.push(`${parsedRate.message} (ردیف بارگذاری نمی‌شود)`);
    }

    parsedList.push({
      index: idx + 1,
      code,
      title,
      category,
      defaultRate,
      unit,
      description,
      isValid: Boolean(title) && parsedRate.ok,
      warnings
    });
  });

  return parsedList;
}
