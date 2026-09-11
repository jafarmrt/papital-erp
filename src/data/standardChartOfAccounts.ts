export interface InitialAccountItem {
  code: string;
  name: string;
  level: 'group' | 'general' | 'subsidiary';
  parentCode?: string;
  accountType: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' | 'cost_of_sales';
  nature: 'debit' | 'credit' | 'both';
  description?: string;
  isSystem?: number;
}

export const STANDARD_CHART_OF_ACCOUNTS: InitialAccountItem[] = [
  // ==========================================
  // گروه ۱: دارایی‌های جاری (Current Assets)
  // ==========================================
  { code: '1', name: 'دارایی‌های جاری', level: 'group', accountType: 'asset', nature: 'debit', isSystem: 1 },
  
  // کل ۱۰: موجودی نقد و بانک
  { code: '10', name: 'موجودی نقد و بانک', level: 'general', parentCode: '1', accountType: 'asset', nature: 'debit', isSystem: 1 },
  { code: '1001', name: 'صندوق‌های ریالی', level: 'subsidiary', parentCode: '10', accountType: 'asset', nature: 'debit', isSystem: 1 },
  { code: '1002', name: 'صندوق‌های ارزی', level: 'subsidiary', parentCode: '10', accountType: 'asset', nature: 'debit', isSystem: 1 },
  { code: '1003', name: 'بانک‌های ریالی', level: 'subsidiary', parentCode: '10', accountType: 'asset', nature: 'debit', isSystem: 1 },
  { code: '1004', name: 'بانک‌های ارزی', level: 'subsidiary', parentCode: '10', accountType: 'asset', nature: 'debit', isSystem: 1 },
  { code: '1005', name: 'دستگاه‌های کارتخوان (POS)', level: 'subsidiary', parentCode: '10', accountType: 'asset', nature: 'debit', isSystem: 1 },
  { code: '1006', name: 'تنخواه‌گردان', level: 'subsidiary', parentCode: '10', accountType: 'asset', nature: 'debit', isSystem: 1 },

  // کل ۱۱: اسناد دریافتنی تجاری (چک‌ها)
  { code: '11', name: 'اسناد دریافتنی تجاری', level: 'general', parentCode: '1', accountType: 'asset', nature: 'debit', isSystem: 1 },
  { code: '1101', name: 'اسناد دریافتنی نزد صندوق', level: 'subsidiary', parentCode: '11', accountType: 'asset', nature: 'debit', isSystem: 1 },
  { code: '1102', name: 'اسناد دریافتنی در جریان وصول', level: 'subsidiary', parentCode: '11', accountType: 'asset', nature: 'debit', isSystem: 1 },
  { code: '1103', name: 'اسناد دریافتنی واخواست‌شده / برگشتی', level: 'subsidiary', parentCode: '11', accountType: 'asset', nature: 'debit', isSystem: 1 },

  // کل ۱۲: حساب‌های دریافتنی تجاری (مشتریان)
  { code: '12', name: 'حساب‌های دریافتنی تجاری', level: 'general', parentCode: '1', accountType: 'asset', nature: 'debit', isSystem: 1 },
  { code: '1201', name: 'بدهکاران تجاری (مشتریان)', level: 'subsidiary', parentCode: '12', accountType: 'asset', nature: 'debit', isSystem: 1 },
  { code: '1202', name: 'مشتریان فروشگاه آنلاین (ووکامرس)', level: 'subsidiary', parentCode: '12', accountType: 'asset', nature: 'debit', isSystem: 1 },

  // کل ۱۳: سایر حساب‌ها و اسناد دریافتنی
  { code: '13', name: 'سایر حساب‌ها و اسناد دریافتنی', level: 'general', parentCode: '1', accountType: 'asset', nature: 'debit', isSystem: 1 },
  { code: '1301', name: 'مساعده و وام به پرسنل', level: 'subsidiary', parentCode: '13', accountType: 'asset', nature: 'debit', isSystem: 1 },
  { code: '1302', name: 'پیش‌پرداخت‌ها به تامین‌کنندگان', level: 'subsidiary', parentCode: '13', accountType: 'asset', nature: 'debit', isSystem: 1 },

  // کل ۱۴: موجودی مواد و کالا
  { code: '14', name: 'موجودی مواد و کالا', level: 'general', parentCode: '1', accountType: 'asset', nature: 'debit', isSystem: 1 },
  { code: '1401', name: 'موجودی مواد اولیه و ملزومات', level: 'subsidiary', parentCode: '14', accountType: 'asset', nature: 'debit', isSystem: 1 },
  { code: '1402', name: 'موجودی کالای در جریان ساخت', level: 'subsidiary', parentCode: '14', accountType: 'asset', nature: 'debit', isSystem: 1 },
  { code: '1403', name: 'موجودی کالای ساخته‌شده (محصولات نهایی)', level: 'subsidiary', parentCode: '14', accountType: 'asset', nature: 'debit', isSystem: 1 },
  { code: '1404', name: 'موجودی قطعات نیمه‌ساخته و ترنسفرها', level: 'subsidiary', parentCode: '14', accountType: 'asset', nature: 'debit', isSystem: 1 },

  // ==========================================
  // گروه ۲: دارایی‌های غیرجاری (Non-Current Assets)
  // ==========================================
  { code: '2', name: 'دارایی‌های غیرجاری', level: 'group', accountType: 'asset', nature: 'debit', isSystem: 1 },
  { code: '20', name: 'دارایی‌های ثابت مشهود', level: 'general', parentCode: '2', accountType: 'asset', nature: 'debit', isSystem: 1 },
  { code: '2001', name: 'ماشین‌آلات و تجهیزات کارگاهی و کوره', level: 'subsidiary', parentCode: '20', accountType: 'asset', nature: 'debit', isSystem: 1 },
  { code: '2002', name: 'ابزارآلات و قالب‌ها', level: 'subsidiary', parentCode: '20', accountType: 'asset', nature: 'debit', isSystem: 1 },
  { code: '2003', name: 'اثاثیه و تجهیزات اداری و کامپیوتر', level: 'subsidiary', parentCode: '20', accountType: 'asset', nature: 'debit', isSystem: 1 },
  { code: '21', name: 'استهلاک انباشته دارایی‌های ثابت', level: 'general', parentCode: '2', accountType: 'asset', nature: 'credit', isSystem: 1 },
  { code: '2101', name: 'استهلاک انباشته ماشین‌آلات و تجهیزات', level: 'subsidiary', parentCode: '21', accountType: 'asset', nature: 'credit', isSystem: 1 },
  { code: '2102', name: 'استهلاک انباشته اثاثیه و تجهیزات اداری', level: 'subsidiary', parentCode: '21', accountType: 'asset', nature: 'credit', isSystem: 1 },

  // ==========================================
  // گروه ۳: بدهی‌های جاری (Current Liabilities)
  // ==========================================
  { code: '3', name: 'بدهی‌های جاری', level: 'group', accountType: 'liability', nature: 'credit', isSystem: 1 },
  
  // کل ۳۰: حساب‌های پرداختنی تجاری (تامین‌کنندگان)
  { code: '30', name: 'حساب‌های پرداختنی تجاری', level: 'general', parentCode: '3', accountType: 'liability', nature: 'credit', isSystem: 1 },
  { code: '3001', name: 'بستانکاران تجاری (تامین‌کنندگان مواد)', level: 'subsidiary', parentCode: '30', accountType: 'liability', nature: 'credit', isSystem: 1 },

  // کل ۳۱: اسناد پرداختنی تجاری (چک‌های پرداختی)
  { code: '31', name: 'اسناد پرداختنی تجاری', level: 'general', parentCode: '3', accountType: 'liability', nature: 'credit', isSystem: 1 },
  { code: '3101', name: 'چک‌های پرداختی به تامین‌کنندگان', level: 'subsidiary', parentCode: '31', accountType: 'liability', nature: 'credit', isSystem: 1 },

  // کل ۳۲: سایر حساب‌ها و اسناد پرداختنی
  { code: '32', name: 'سایر حساب‌ها و اسناد پرداختنی', level: 'general', parentCode: '3', accountType: 'liability', nature: 'credit', isSystem: 1 },
  { code: '3201', name: 'حقوق و دستمزد پرداختنی پرسنل (پرکیسی/کنتراتی)', level: 'subsidiary', parentCode: '32', accountType: 'liability', nature: 'credit', isSystem: 1 },
  { code: '3202', name: 'پیش‌دریافت‌ها از مشتریان', level: 'subsidiary', parentCode: '32', accountType: 'liability', nature: 'credit', isSystem: 1 },
  { code: '3203', name: 'مالیات و عوارض پرداختنی', level: 'subsidiary', parentCode: '32', accountType: 'liability', nature: 'credit', isSystem: 1 },
  { code: '3204', name: 'بیمه پرداختنی', level: 'subsidiary', parentCode: '32', accountType: 'liability', nature: 'credit', isSystem: 1 },

  // ==========================================
  // گروه ۴: بدهی‌های بلندمدت و حقوق صاحبان سهام (Equity & Long-term)
  // ==========================================
  { code: '4', name: 'حقوق صاحبان سهام و سرمایه', level: 'group', accountType: 'equity', nature: 'credit', isSystem: 1 },
  { code: '40', name: 'سرمایه', level: 'general', parentCode: '4', accountType: 'equity', nature: 'credit', isSystem: 1 },
  { code: '4001', name: 'سرمایه اولیه سهامداران / موسسین', level: 'subsidiary', parentCode: '40', accountType: 'equity', nature: 'credit', isSystem: 1 },
  { code: '41', name: 'جاری شرکا و سهامداران', level: 'general', parentCode: '4', accountType: 'equity', nature: 'both', isSystem: 1 },
  { code: '4101', name: 'حساب جاری شرکا', level: 'subsidiary', parentCode: '41', accountType: 'equity', nature: 'both', isSystem: 1 },
  { code: '42', name: 'سود (زیان) انباشته', level: 'general', parentCode: '4', accountType: 'equity', nature: 'credit', isSystem: 1 },
  { code: '4201', name: 'سود (زیان) انباشته سنواتی', level: 'subsidiary', parentCode: '42', accountType: 'equity', nature: 'credit', isSystem: 1 },
  { code: '43', name: 'خلاصه حساب سود و زیان جاری', level: 'general', parentCode: '4', accountType: 'equity', nature: 'both', isSystem: 1 },
  { code: '4301', name: 'خلاصه سود و زیان سال جاری', level: 'subsidiary', parentCode: '43', accountType: 'equity', nature: 'both', isSystem: 1 },
  { code: '44', name: 'حساب تراز افتتاحیه و اختتامیه', level: 'general', parentCode: '4', accountType: 'equity', nature: 'both', isSystem: 1 },
  { code: '4401', name: 'تراز اختتامیه / افتتاحیه', level: 'subsidiary', parentCode: '44', accountType: 'equity', nature: 'both', isSystem: 1 },

  // ==========================================
  // گروه ۵: درآمدها و فروش (Revenues)
  // ==========================================
  { code: '5', name: 'درآمدها و فروش', level: 'group', accountType: 'revenue', nature: 'credit', isSystem: 1 },
  { code: '50', name: 'فروش خالص محصولات', level: 'general', parentCode: '5', accountType: 'revenue', nature: 'credit', isSystem: 1 },
  { code: '5001', name: 'درآمد فروش محصولات کارگاهی', level: 'subsidiary', parentCode: '50', accountType: 'revenue', nature: 'credit', isSystem: 1 },
  { code: '5002', name: 'درآمد فروش آنلاین ووکامرس', level: 'subsidiary', parentCode: '50', accountType: 'revenue', nature: 'credit', isSystem: 1 },
  { code: '5003', name: 'درآمد حاصل از خدمات تولید و سفارشات', level: 'subsidiary', parentCode: '50', accountType: 'revenue', nature: 'credit', isSystem: 1 },
  { code: '51', name: 'برگشت از فروش و تخفیفات', level: 'general', parentCode: '5', accountType: 'revenue', nature: 'debit', isSystem: 1 },
  { code: '5101', name: 'برگشت از فروش', level: 'subsidiary', parentCode: '51', accountType: 'revenue', nature: 'debit', isSystem: 1 },
  { code: '5102', name: 'تخفیفات نقدی اعطایی به مشتریان', level: 'subsidiary', parentCode: '51', accountType: 'revenue', nature: 'debit', isSystem: 1 },
  { code: '52', name: 'سایر درآمدهای عملیاتی و غیرعملیاتی', level: 'general', parentCode: '5', accountType: 'revenue', nature: 'credit', isSystem: 1 },
  { code: '5201', name: 'سود تسعیر ارز', level: 'subsidiary', parentCode: '52', accountType: 'revenue', nature: 'credit', isSystem: 1 },
  { code: '5202', name: 'سود سپرده‌های بانکی و سرمایه‌گذاری', level: 'subsidiary', parentCode: '52', accountType: 'revenue', nature: 'credit', isSystem: 1 },
  { code: '5203', name: 'سایر درآمدهای عملیاتی', level: 'subsidiary', parentCode: '52', accountType: 'revenue', nature: 'credit', isSystem: 1 },

  // ==========================================
  // گروه ۶: بهای تمام‌شده کالای فروش‌رفته (Cost of Goods Sold - COGS)
  // ==========================================
  { code: '6', name: 'بهای تمام‌شده کالای فروش‌رفته', level: 'group', accountType: 'cost_of_sales', nature: 'debit', isSystem: 1 },
  { code: '60', name: 'بهای تمام‌شده محصولات فروش‌رفته', level: 'general', parentCode: '6', accountType: 'cost_of_sales', nature: 'debit', isSystem: 1 },
  { code: '6001', name: 'هزینه مواد اولیه مصرفی در تولید', level: 'subsidiary', parentCode: '60', accountType: 'cost_of_sales', nature: 'debit', isSystem: 1 },
  { code: '6002', name: 'دستمزد مستقیم تولید (کارمزد پرکیسی و قطعه‌کاری)', level: 'subsidiary', parentCode: '60', accountType: 'cost_of_sales', nature: 'debit', isSystem: 1 },
  { code: '6003', name: 'سربار ساخت و هزینه‌های کارگاه (پخت، برق، ضایعات)', level: 'subsidiary', parentCode: '60', accountType: 'cost_of_sales', nature: 'debit', isSystem: 1 },

  // ==========================================
  // گروه ۷: هزینه‌های عمومی، اداری و توزیع (Operating Expenses)
  // ==========================================
  { code: '7', name: 'هزینه‌های عملیاتی و عمومی', level: 'group', accountType: 'expense', nature: 'debit', isSystem: 1 },
  { code: '70', name: 'هزینه‌های اداری و عمومی', level: 'general', parentCode: '7', accountType: 'expense', nature: 'debit', isSystem: 1 },
  { code: '7001', name: 'هزینه حقوق و مزایای پرسنل اداری', level: 'subsidiary', parentCode: '70', accountType: 'expense', nature: 'debit', isSystem: 1 },
  { code: '7002', name: 'هزینه اجاره کارگاه و دفتر', level: 'subsidiary', parentCode: '70', accountType: 'expense', nature: 'debit', isSystem: 1 },
  { code: '7003', name: 'هزینه آب، برق، گاز و تلفن کارگاه', level: 'subsidiary', parentCode: '70', accountType: 'expense', nature: 'debit', isSystem: 1 },
  { code: '7004', name: 'هزینه ملزومات مصرفی، بسته‌بندی و کارتن', level: 'subsidiary', parentCode: '70', accountType: 'expense', nature: 'debit', isSystem: 1 },
  { code: '7005', name: 'هزینه ایاب و ذهاب، پیک و ارسال بار', level: 'subsidiary', parentCode: '70', accountType: 'expense', nature: 'debit', isSystem: 1 },
  { code: '7006', name: 'هزینه تبلیغات، بازاریابی و CRM', level: 'subsidiary', parentCode: '70', accountType: 'expense', nature: 'debit', isSystem: 1 },
  { code: '7007', name: 'هزینه‌های بانکی و کارمزد درگاه پرداخت', level: 'subsidiary', parentCode: '70', accountType: 'expense', nature: 'debit', isSystem: 1 },
  { code: '7008', name: 'زیان تسعیر ارز', level: 'subsidiary', parentCode: '70', accountType: 'expense', nature: 'debit', isSystem: 1 },
  { code: '7009', name: 'سایر هزینه‌های متفرقه کارگاهی', level: 'subsidiary', parentCode: '70', accountType: 'expense', nature: 'debit', isSystem: 1 },
  { code: '7010', name: 'هزینه پذیرایی، آبدارخانه و ارزاق پرسنل', level: 'subsidiary', parentCode: '70', accountType: 'expense', nature: 'debit', isSystem: 1 },
  { code: '7011', name: 'هزینه تعمیرات و نگهداری ابزار و تجهیزات', level: 'subsidiary', parentCode: '70', accountType: 'expense', nature: 'debit', isSystem: 1 },
];
