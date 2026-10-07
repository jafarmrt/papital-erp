import toast from 'react-hot-toast';
import { fetchJson } from '../../api';

export async function exportCompleteExcel(typeFilter: string): Promise<void> {
  const query = typeFilter ? `?type=${typeFilter}` : '';
  const data = await fetchJson(`/items/unified-export${query}`);

  if (!data.rows || data.rows.length === 0) {
    toast.error('هیچ کالایی برای دریافت خروجی یافت نشد.');
    return;
  }

  const xlsx = await import('xlsx');
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

/** v9.0.208 (O8): الگو را سرور با سرستون‌های ورود می‌سازد (انبارهای فعال، فهرست‌های قیمت و ارز هر کدام) */
export async function downloadExcelTemplate(): Promise<void> {
  const data = await fetchJson('/items/excel-template');
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const xlsx = await import('xlsx');
  const ws = xlsx.utils.json_to_sheet(rows);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'الگوی_ورود_کالا_و_قیمت');
  xlsx.writeFile(wb, 'الگوی_استاندارد_ورود_کالا_و_قیمت.xlsx');
  toast.success('الگوی نمونه اکسل دریافت شد.');
}
