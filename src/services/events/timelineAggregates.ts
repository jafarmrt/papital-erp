/**
 * v9.0.431 (TD-711، B15-09): دامنه هر نوع موجودیت «خط زمانی رویدادها». رویدادهای outbox و صف خطا با نوع تجمیعی که ناشر
 * می‌نویسد (`Document`، `Item`، `Treasury`، `Project`؛ و نوع موجودیت گردش کار با حروف کوچک، مانند `document`) و شناسه
 * عددی همان موجودیت خوانده می‌شوند، و سطرهای ممیزی فقط با نام‌های موجودیتی که همان بخش می‌نویسد و شناسه همان موجودیت.
 * پیش‌تر نوع با حروف کوچک (`document`) هرگز با `Document` outbox جور نمی‌شد، انتخابگر شماره سند را به جای شناسه می‌داد و
 * ممیزی با `entityId = X OR description ILIKE '%X%'` و بی شرط نوع، سطرهای موجودیت‌های دیگر را می‌آورد.
 */
export interface TimelineAggregateScope {
  /** aggregate types of outbox / dead-letter rows, compared in lower case */
  eventAggregateTypes: readonly string[];
  /** activity log entity names this section writes */
  auditEntities: readonly string[];
}

const DOCUMENT_AUDIT_ENTITIES = [
  'document', 'اسناد انبار', 'اسناد انبار / پیش‌فاکتور', 'سند انبار', 'رسید خرید مواد و کالا', 'رسید تولید و تحویل محصول',
  'فاکتور فروش', 'پیش‌فاکتور', 'سند مرجوعی', 'سند انبارگردانی', 'حواله انتقال', 'حواله خروج', 'سند ضایعات', 'حواله انتقال انبار',
] as const;

export const TIMELINE_AGGREGATE_SCOPES: Readonly<Record<string, TimelineAggregateScope>> = {
  document: { eventAggregateTypes: ['document'], auditEntities: DOCUMENT_AUDIT_ENTITIES },
  customer: { eventAggregateTypes: ['customer'], auditEntities: ['مشتری', 'طرف حساب', 'تامین‌کننده'] },
  item: { eventAggregateTypes: ['item'], auditEntities: ['کالا', 'قیمت کالا', 'کالاها_و_محصولات'] },
  treasury: { eventAggregateTypes: ['treasury'], auditEntities: ['treasury_transaction'] },
  project: { eventAggregateTypes: ['project'], auditEntities: ['پروژه تولید', 'کنترل موجودی پروژه'] },
  workflow: { eventAggregateTypes: ['workflow'], auditEntities: [] },
};

export function timelineAggregateScope(type: string): TimelineAggregateScope | null {
  return Object.prototype.hasOwnProperty.call(TIMELINE_AGGREGATE_SCOPES, type) ? TIMELINE_AGGREGATE_SCOPES[type] : null;
}
