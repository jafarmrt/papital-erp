import * as xlsx from 'xlsx';
import toast from 'react-hot-toast';
import { fetchJson } from '../../api';

export async function exportCompleteExcel(typeFilter: string): Promise<void> {
  const query = typeFilter ? `?type=${typeFilter}` : '';
  const data = await fetchJson(`/items/unified-export${query}`);

  if (!data.rows || data.rows.length === 0) {
    toast.error('هیچ کالایی برای دریافت خروجی یافت نشد.');
    return;
  }

  const ws = xlsx.utils.json_to_sheet(data.rows);
  const wb = xlsx.utils.book_new();
  const sheetName = typeFilter === 'product'
    ? 'محصولات_و_قیمت‌ها'
    : typeFilter === 'raw_material'
    ? 'مواد_اولیه_و_قیمت‌ها'
    : 'جامع_کالاها_و_قیمت‌ها';
  xlsx.utils.book_append_sheet(wb, ws, sheetName);
  xlsx.writeFile(wb, `${sheetName}.xlsx`);
  toast.success('فایل اکسل جامع با موفقیت دانلود شد.');
}

export async function downloadExcelTemplate(): Promise<void> {
  const data = await fetchJson('/items/unified-export');
  const warehouses = data.warehouses || [];
  const strategies = data.strategies || ['قیمت عمده', 'قیمت خرده', 'قیمت همکار'];

  const sampleRow: Record<string, any> = {
    'کد کالا': 'N-101',
    'نام محصول': 'گردنبند طلایی طرح لوتوس',
    'نوع کالا': 'محصول نهایی',
    'دسته‌بندی': 'گردنبند',
    'واحد': 'عدد',
    'موجودی کل': 100,
  };

  warehouses.forEach((w: any) => {
    sampleRow[`موجودی انبار ${w.name}`] = 50;
  });

  sampleRow['حد نقطه سفارش (آلارم کسری)'] = 20;
  sampleRow['قیمت میانگین خرید (WAC)'] = 1500000;
  sampleRow['تصویر'] = '';
  sampleRow['رنگ'] = 'طلایی';
  sampleRow['سایز'] = 'استاندارد';
  sampleRow['وزن'] = 15;
  sampleRow['جنس'] = 'استیل';

  strategies.forEach((st: string) => {
    let cleanStrat = (st || '').trim();
    while (cleanStrat.startsWith('قیمت - ') || cleanStrat.startsWith('قیمت ')) {
      if (cleanStrat.startsWith('قیمت - ')) cleanStrat = cleanStrat.substring(7).trim();
      else if (cleanStrat.startsWith('قیمت ')) cleanStrat = cleanStrat.substring(5).trim();
    }
    sampleRow[`قیمت ${cleanStrat || st}`] = 2500000;
  });
  sampleRow['واحد ارز'] = 'IRR';

  const ws = xlsx.utils.json_to_sheet([sampleRow]);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'الگوی_ورود_کالا_و_قیمت');
  xlsx.writeFile(wb, 'الگوی_استاندارد_ورود_کالا_و_قیمت.xlsx');
  toast.success('الگوی نمونه اکسل با موفقیت دانلود شد.');
}
