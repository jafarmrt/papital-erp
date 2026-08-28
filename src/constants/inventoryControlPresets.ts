export type InventoryControlCheckType = 'per_item' | 'global';

export interface InventoryControlPresetItem {
  id: string;
  name: string;
  itemCode?: string;
  unit: string;
  isOptional?: boolean;
  notes?: string;
}

export interface InventoryControlPresetSection {
  id: string;
  title: string;
  description?: string;
  checkType: InventoryControlCheckType; // 'per_item' (کد به کد) | 'global' (کلی برای کل سفارش)
  items: InventoryControlPresetItem[];
  filterType?: 'all' | 'category' | 'item_code'; // 'all' (همه اقلام) | 'category' (فیلتر دسته‌بندی) | 'item_code' (فیلتر کد به کد)
  allowedCategories?: string[];
  allowedItemCodes?: string[];
}

export const DEFAULT_INVENTORY_CONTROL_SECTIONS: InventoryControlPresetSection[] = [
  {
    id: 'sec_transfer_paper',
    title: '۱. کنترل موجودی کاغذ ترنسفر',
    description: 'کنترل کد به کد: بررسی موجودی کاغذ ترنسفر یا نیاز به چاپ برای هر کد محصول در سفارش',
    checkType: 'per_item',
    items: [
      { id: 'item_paper_transfer', name: 'کاغذ ترنسفر', unit: 'برگ' }
    ]
  },
  {
    id: 'sec_tile_base',
    title: '۲. کنترل موجودی کاشی خام / بیس',
    description: 'کنترل کد به کد: بررسی موجودی کاشی بیس یا نیاز به ساخت برای هر کد محصول سفارش',
    checkType: 'per_item',
    items: [
      { id: 'item_tile_raw', name: 'کاشی خام بیس', unit: 'عدد' }
    ]
  },
  {
    id: 'sec_transfer_materials',
    title: '۳. کنترل مواد عمومی ترنسفر (کیلر، گلیز، سمباده)',
    description: 'کنترل کلی: بررسی مقدار کلی مواد مصرفی عمومی ترنسفر برای کل سفارش بدون نیاز به تفکیک کد',
    checkType: 'global',
    items: [
      { id: 'item_killer', name: 'کیلر (چاپ ترنسفر)', unit: 'کیلوگرم' },
      { id: 'item_glaze', name: 'گلیز (چاپ ترنسفر)', unit: 'کیلوگرم' },
      { id: 'item_sandpaper', name: 'کاغذ سمباده', unit: 'ورق' },
      { id: 'item_solvent', name: 'حلال و چسب ویژه', unit: 'لیتر' }
    ]
  },
  {
    id: 'sec_packaging_supplies',
    title: '۴. کنترل ملزومات و بسته‌بندی سفارش',
    description: 'کنترل کلی: بررسی ملزومات عمومی بسته‌بندی برای کل سفارش (کارتن، کیسه، کاور، پالت)',
    checkType: 'global',
    items: [
      { id: 'item_carton', name: 'کارتن بسته‌بندی', unit: 'عدد' },
      { id: 'item_bag', name: 'کیسه پارچه‌ای / کاور', unit: 'عدد' },
      { id: 'item_card', name: 'کارت معرفی محصول', unit: 'عدد' },
      { id: 'item_strap', name: 'بند / زنجیر / آویز', unit: 'عدد' }
    ]
  }
];
