/**
 * v7.0.89 (TD-085 بند ۱): متن فارسی شرط‌های انتقال ورکفلو (ruleConditionsJson) برای پیش‌نمایش پیش از اقدام و پیام خطا.
 * خالص و بدون وابستگی است؛ سرور (getInstanceByEntity / executeTransition) و فرانت هر دو از آن استفاده می‌کنند.
 */

export interface WorkflowRuleLike {
  field: string;
  operator: string;
  value?: unknown;
}

/** برچسب فیلدهای زمینه موجودیت (getEntityContext در workflowDslParser.ts) */
const FIELD_LABELS: Record<string, string> = {
  amount: 'مبلغ',
  finalAmount: 'مبلغ نهایی',
  totalAmount: 'مبلغ کل',
  amountInCurrency: 'مبلغ به ارز سند',
  exchangeRate: 'نرخ تسعیر',
  itemCount: 'تعداد اقلام',
  docType: 'نوع سند',
  type: 'نوع',
  status: 'وضعیت',
  buyerName: 'نام خریدار',
  buyer_name: 'نام خریدار',
  buyerCity: 'شهر خریدار',
  buyer_city: 'شهر خریدار',
  currency: 'ارز',
  refNumber: 'شماره سند',
  ref_number: 'شماره سند',
  notes: 'توضیحات',
  priority: 'اولویت',
  quantity: 'تعداد',
  title: 'عنوان',
  projectCode: 'کد پروژه',
  weight: 'وزن',
  unit: 'واحد',
  category: 'دسته‌بندی',
  code: 'کد',
  name: 'نام',
  currentStock: 'موجودی',
  purchasePrice: 'قیمت خرید',
  salesPrice: 'قیمت فروش',
  balance: 'مانده حساب',
};

const OPERATOR_TEXT: Record<string, string> = {
  '=': 'برابر', '==': 'برابر', eq: 'برابر', equal: 'برابر',
  '!=': 'مخالف', neq: 'مخالف', not_equal: 'مخالف',
  '>': 'بیشتر از', gt: 'بیشتر از',
  '>=': 'دست‌کم', gte: 'دست‌کم',
  '<': 'کمتر از', lt: 'کمتر از',
  '<=': 'حداکثر', lte: 'حداکثر',
  in: 'یکی از', not_in: 'هیچ‌یک از', nin: 'هیچ‌یک از',
  contains: 'شامل', like: 'شامل', includes: 'شامل',
};

const UNARY_TEXT: Record<string, string> = {
  is_empty: 'خالی باشد', empty: 'خالی باشد',
  is_not_empty: 'خالی نباشد', not_empty: 'خالی نباشد',
  exists: 'مقدار داشته باشد', not_exists: 'مقدار نداشته باشد',
};

const numberFormatter = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 4 });

export function workflowFieldLabel(field: string): string {
  const key = String(field || '').replace(/^(entity|context|payload)\./, '');
  return FIELD_LABELS[key] ?? key;
}

export function formatRuleValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'خالی';
  if (Array.isArray(value)) return value.map(formatRuleValue).join('، ');
  // v8.0.123 (TD-404): مبلغ ریالی سند ارزی بی نرخ تسعیر
  if (typeof value === 'number' && Number.isNaN(value)) return 'نامعلوم (نرخ تسعیر ثبت نشده)';
  if (typeof value === 'number') return numberFormatter.format(value);
  if (typeof value === 'string' && value.trim() !== '' && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    return numberFormatter.format(Number(value));
  }
  if (typeof value === 'boolean') return value ? 'بله' : 'خیر';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/** «مبلغ کل بیشتر از ۵۰٬۰۰۰ باشد» */
export function describeWorkflowRule(rule: WorkflowRuleLike): string {
  const label = workflowFieldLabel(rule.field);
  const op = String(rule.operator || 'eq').toLowerCase();
  if (UNARY_TEXT[op]) return `${label} ${UNARY_TEXT[op]}`;
  if (op === 'regex' || op === 'regexp') return `${label} با الگوی ${String(rule.value ?? '')} جور باشد`;
  const opText = OPERATOR_TEXT[op] ?? op;
  return `${label} ${opText} ${formatRuleValue(rule.value)} باشد`;
}

/** «مبلغ کل بیشتر از ۵۰٬۰۰۰ باشد (مقدار فعلی: ۳۰٬۰۰۰)» */
export function describeUnmetWorkflowRule(rule: WorkflowRuleLike, actualValue: unknown): string {
  return `${describeWorkflowRule(rule)} (مقدار فعلی: ${formatRuleValue(actualValue)})`;
}
