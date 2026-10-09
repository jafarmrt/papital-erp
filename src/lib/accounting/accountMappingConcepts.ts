/**
 * v9.0.199 (TD-550، B03-08): مفهوم‌های نگاشت حساب سندهای خودکار، مشترک سرور (اعتبارسنجی ذخیره و بررسی سلامت) و
 * صفحه نگاشت. هر مفهوم فقط به حساب قابل ثبت (`postingAccount.ts`) از نوع‌های همان مفهوم نگاشت می‌شود؛ پیش‌تر هر کدی
 * ذخیره می‌شد و «۵۰۰۱ درآمد» به جای موجودی مواد اولیه پذیرفته شد.
 */

export type AccountTypeCode = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' | 'cost_of_sales';

export interface AccountMappingConcept {
  key: string;
  label: string;
  description: string;
  defaultCode: string;
  accountTypes: readonly AccountTypeCode[];
}

const ASSET = ['asset'] as const;
const LIABILITY = ['liability'] as const;
const EQUITY = ['equity'] as const;
const REVENUE = ['revenue'] as const;
const EXPENSE = ['cost_of_sales', 'expense'] as const;
const PROFIT_AND_LOSS = ['revenue', 'cost_of_sales', 'expense'] as const;

export const ACCOUNT_MAPPING_CONCEPTS = [
  { key: 'tradeReceivablesAccountCode', label: 'حساب‌های دریافتنی تجاری', description: 'طرف حساب فروش، دریافت وجه از مشتری و چک دریافتی', defaultCode: '1201', accountTypes: ASSET },
  { key: 'tradePayablesAccountCode', label: 'حساب‌های پرداختنی تجاری', description: 'طرف حساب خرید، پرداخت وجه به تأمین‌کننده و چک پرداختی', defaultCode: '3001', accountTypes: LIABILITY },
  { key: 'wagesPayableAccountCode', label: 'حقوق و دستمزد پرداختنی', description: 'فیش حقوق، پرداخت حقوق و دریافت وجه از پرسنل', defaultCode: '3201', accountTypes: LIABILITY },
  // v9.0.286 (TD-554، تصمیم ت۶ الف): پیش‌فرض ۳۲۰۵؛ پیش‌تر ۳۲۰۲ «پیش‌دریافت‌ها از مشتریان» بود
  { key: 'employeeDeductionsPayableAccountCode', label: 'کسورات حقوق پرداختنی', description: 'بیمه و مالیات سهم کارکنان در فیش حقوق', defaultCode: '3205', accountTypes: LIABILITY },
  { key: 'chequeReceivableAccountCode', label: 'اسناد دریافتنی نزد صندوق', description: 'ثبت چک دریافتی و بازگشت آن از جریان وصول', defaultCode: '1101', accountTypes: ASSET },
  { key: 'chequeInCollectionAccountCode', label: 'اسناد در جریان وصول', description: 'فرستادن چک به بانک برای وصول، تا پاس یا برگشت', defaultCode: '1102', accountTypes: ASSET },
  { key: 'chequeProtestAccountCode', label: 'اسناد واخواستی', description: 'برگشت چک دریافتی', defaultCode: '1103', accountTypes: ASSET },
  { key: 'chequePayableAccountCode', label: 'اسناد پرداختنی تجاری', description: 'صدور چک پرداختی و پاس شدن آن', defaultCode: '3101', accountTypes: LIABILITY },
  { key: 'employeeAdvanceAccountCode', label: 'مساعده و وام پرسنل', description: 'پرداخت مساعده و وام به پرسنل تا کسر از حقوق', defaultCode: '1301', accountTypes: ASSET },
  { key: 'salesRevenueAccountCode', label: 'درآمد فروش', description: 'سند خودکار فاکتور فروش قطعی', defaultCode: '5001', accountTypes: REVENUE },
  { key: 'salesDiscountAccountCode', label: 'تخفیف فروش', description: 'تخفیف ردیف‌های فاکتور فروش', defaultCode: '5102', accountTypes: REVENUE },
  { key: 'serviceRevenueAccountCode', label: 'درآمد حمل و خدمات', description: 'هزینه ارسال و کارمزد فاکتور فروش', defaultCode: '5004', accountTypes: REVENUE },
  { key: 'salesVatPayableAccountCode', label: 'مالیات بر ارزش افزوده', description: 'بستانکار مالیات بر ارزش افزوده در سند فروش', defaultCode: '3203', accountTypes: LIABILITY },
  { key: 'inventoryRawMaterialsCode', label: 'موجودی مواد اولیه', description: 'رسید و خرید مواد اولیه و حواله به تولید', defaultCode: '1401', accountTypes: ASSET },
  { key: 'workInProgressCode', label: 'کالای در جریان ساخت', description: 'تخصیص مواد به پروژه و رسید تولید', defaultCode: '1402', accountTypes: ASSET },
  { key: 'inventoryFinishedGoodsCode', label: 'موجودی کالای ساخته‌شده', description: 'رسید تولید و فروش کالای ساخته‌شده', defaultCode: '1403', accountTypes: ASSET },
  { key: 'inventoryCountDifferenceAccountCode', label: 'کسری و اضافات انبار', description: 'انبارگردانی، اصلاح موجودی از اکسل و اصلاح میانگین موزون بها', defaultCode: '7012', accountTypes: PROFIT_AND_LOSS },
  { key: 'donatedGoodsIncomeAccountCode', label: 'درآمد کالای اهدایی', description: 'کالای رایگان رسید و فاکتور خرید که به میانگین موزون بها وارد انبار می‌شود', defaultCode: '5204', accountTypes: REVENUE },
  { key: 'costOfGoodsSoldCode', label: 'بهای تمام‌شده کالای فروش‌رفته', description: 'بهای تمام‌شده فروش و برگشت از فروش', defaultCode: '6001', accountTypes: EXPENSE },
  { key: 'wasteExpenseAccountCode', label: 'ضایعات و افت کیفی', description: 'سند خودکار ضایعات انبار به بهای کاردکس', defaultCode: '6004', accountTypes: EXPENSE },
  // v10.0.27 (TD-948، تصمیم ت۴ ب فاز ۵): حواله بی پروژه دیگر به کالای در جریان ساخت (۱۴۰۲) نمی‌رود
  { key: 'unassignedConsumptionAccountCode', label: 'مصرف مواد بی پروژه', description: 'حواله خروج از انبار که به هیچ پروژه‌ای پیوند ندارد', defaultCode: '6003', accountTypes: EXPENSE },
  { key: 'directProductionWagesAccountCode', label: 'دستمزد مستقیم تولید', description: 'کارکرد قطعه‌کاری در فیش حقوق', defaultCode: '6002', accountTypes: EXPENSE },
  { key: 'fixedSalaryExpenseAccountCode', label: 'هزینه حقوق ثابت', description: 'بخش حقوق ثابت فیش حقوق', defaultCode: '6003', accountTypes: EXPENSE },
  { key: 'summaryProfitLossCode', label: 'خلاصه سود و زیان', description: 'بستن حساب‌های موقت در پایان سال مالی', defaultCode: '4301', accountTypes: EQUITY },
  { key: 'retainedEarningsCode', label: 'سود (زیان) انباشته', description: 'انتقال نتیجه سال مالی', defaultCode: '4201', accountTypes: EQUITY },
  { key: 'closingBalanceAccountCode', label: 'تراز اختتامیه و افتتاحیه', description: 'سند اختتامیه و افتتاحیه ترازنامه', defaultCode: '4401', accountTypes: EQUITY },
  { key: 'openingCapitalAccountCode', label: 'سرمایه اولیه', description: 'طرف حساب اسناد افتتاحیه موجودی خزانه و انبار', defaultCode: '4001', accountTypes: EQUITY },
] as const satisfies readonly AccountMappingConcept[];

export type AccountMappingKey = (typeof ACCOUNT_MAPPING_CONCEPTS)[number]['key'];

export const ACCOUNT_TYPE_LABELS: Record<AccountTypeCode, string> = {
  asset: 'دارایی',
  liability: 'بدهی',
  equity: 'حقوق صاحبان سرمایه',
  revenue: 'درآمد',
  expense: 'هزینه',
  cost_of_sales: 'بهای تمام‌شده',
};

export function accountMappingConcept(key: string): AccountMappingConcept | undefined {
  return (ACCOUNT_MAPPING_CONCEPTS as readonly AccountMappingConcept[]).find(c => c.key === key);
}

/** نوع حساب با مفهوم سازگار است؟ */
export function accountTypeFitsConcept(concept: AccountMappingConcept, accountType: string | null | undefined): boolean {
  return (concept.accountTypes as readonly string[]).includes(String(accountType ?? ''));
}

/** نوع‌های پذیرفته یک مفهوم به فارسی («دارایی» یا «بهای تمام‌شده / هزینه») */
export function conceptAccountTypesText(concept: AccountMappingConcept): string {
  return concept.accountTypes.map(t => ACCOUNT_TYPE_LABELS[t]).join(' / ');
}
