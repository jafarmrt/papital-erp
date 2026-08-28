export interface StageTaskTemplate {
  taskId?: number | null;
  taskTitle: string;
  unit?: string;
  defaultRate?: number;
}

export interface WorkflowStageItem {
  title: string;
  isOptionalPerProduct?: boolean; // آیا این مرحله برای تولید هر کالا انتخابی است؟
  defaultTasks?: StageTaskTemplate[]; // الگوی پیش‌فرض عناوین کاری و کارمزدهای این مرحله
}

export interface WorkflowPreset {
  id: string;
  title: string;
  description: string;
  stages: (string | WorkflowStageItem)[];
}

export const DEFAULT_WORKFLOW_PRESETS: WorkflowPreset[] = [
  {
    id: 'tile_transfer',
    title: 'تولید کاشی و چاپ ترنسفر (پیش‌فرض)',
    description: 'خرید مواد اولیه → تولید کاشی Base → چاپ ترنسفر → مونتاژ و پخت → کنترل کیفیت',
    stages: [
      { 
        title: 'خرید مواد اولیه و لعاب', 
        isOptionalPerProduct: false,
        defaultTasks: [
          { taskTitle: 'بررسی انبار و انطباق خرید مواد اولیه', unit: 'نوبت', defaultRate: 500000 }
        ]
      },
      { 
        title: 'تولید کاشی خام (Base Tile)', 
        isOptionalPerProduct: false,
        defaultTasks: [
          { taskTitle: 'مخلوط‌سازی بدنه و قالب‌گیری بیس', unit: 'عدد', defaultRate: 5000 },
          { taskTitle: 'اعمال لعاب و آماده‌سازی بیس کاشی', unit: 'عدد', defaultRate: 4000 }
        ]
      },
      { 
        title: 'چاپ ترنسفر (Transfer Printing)', 
        isOptionalPerProduct: false,
        defaultTasks: [
          { taskTitle: 'چاپ طرح ترنسفر روی کاغذ اختصاصی', unit: 'برگ', defaultRate: 15000 },
          { taskTitle: 'برش و آماده‌سازی کاغذ ترنسفر', unit: 'برگ', defaultRate: 3000 },
          { taskTitle: 'انتقال و چسباندن ترنسفر روی کاشی', unit: 'عدد', defaultRate: 8000 }
        ]
      },
      { 
        title: 'مونتاژ و پخت کوره', 
        isOptionalPerProduct: true,
        defaultTasks: [
          { taskTitle: 'چیدمان روی واگن کوره و پخت پارتیکولار', unit: 'عدد', defaultRate: 10000 },
          { taskTitle: 'مونتاژ و چسباندن قطعات جانبی', unit: 'عدد', defaultRate: 12000 }
        ]
      },
      { 
        title: 'کنترل کیفیت و بسته‌بندی', 
        isOptionalPerProduct: false,
        defaultTasks: [
          { taskTitle: 'کنترل کیفیت، تمیزکاری و کیلر زدن', unit: 'عدد', defaultRate: 5000 },
          { taskTitle: 'بسته‌بندی در کارتن و سلفون‌کشی', unit: 'کارتن', defaultRate: 25000 }
        ]
      }
    ]
  },
  {
    id: 'general_assembly',
    title: 'تولید و مونتاژ عمومی',
    description: 'تأمین قطعات → آماده‌سازی → مونتاژ → کنترل کیفیت و تحویل',
    stages: [
      { 
        title: 'خرید مواد اولیه', 
        isOptionalPerProduct: false,
        defaultTasks: [
          { taskTitle: 'سفارش‌گذاری و تأمین ملزومات اولویت‌دار', unit: 'پارت', defaultRate: 300000 }
        ]
      },
      { 
        title: 'آماده‌سازی و برش قطعات', 
        isOptionalPerProduct: false,
        defaultTasks: [
          { taskTitle: 'برش کاری و سمباده اولویت اول', unit: 'عدد', defaultRate: 6000 }
        ]
      },
      { 
        title: 'مونتاژ و ترکیب', 
        isOptionalPerProduct: true,
        defaultTasks: [
          { taskTitle: 'مونتاژ قطعات و چسب‌کاری', unit: 'عدد', defaultRate: 15000 }
        ]
      },
      { 
        title: 'کنترل کیفیت و بسته‌بندی', 
        isOptionalPerProduct: false,
        defaultTasks: [
          { taskTitle: 'چک‌لیست کنترل کیفیت و کارتن‌بندی', unit: 'عدد', defaultRate: 4000 }
        ]
      }
    ]
  }
];

