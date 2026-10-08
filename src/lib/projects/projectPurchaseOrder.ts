/**
 * v9.0.392 (TD-745، B11-11، تصمیم ت۸ ب): «سفارش مستقیم» صفحه پروژه فقط سفارش خرید پیش‌نویس تدارکات می‌سازد: درخواست خرید
 * پروژه ثبت و در همان اقدام به سفارش پیش‌نویس تبدیل می‌شود (`convert-to-orders`)، شماره سفارش را سامانه می‌دهد و تأمین‌کننده
 * و انبار مقصد از فهرست می‌آیند؛ کالا فقط با «تحویل به انبار» تدارکات وارد انبار می‌شود (TD-267). پیش‌تر مرورگر شماره
 * `PO-<کد پروژه>-<چهار رقم تصادفی>` می‌ساخت، تأمین‌کننده و انبار متن آزاد بودند و «رسید خرید قطعی» از صفحه پروژه بی گذر از
 * تدارکات موجودی را بالا می‌برد.
 */

/**
 * گاردهای سرور این مسیر، هر گروه «یکی کافی است»: ثبت درخواست خرید، صدور سفارش، و تأیید درخواست (سفارش فقط از درخواست
 * تأییدشده صادر می‌شود و دارنده حق تأیید آن را به نام خودش تأیید می‌کند، TD-689). بی یکی از این سه، فقط درخواست خرید.
 */
export const DIRECT_ORDER_PERMISSIONS = {
  requisition: ['procurement.create', 'projects.edit'],
  order: ['procurement.order'],
  approve: ['procurement.approve', 'procurement.manage'],
} as const satisfies Record<string, readonly string[]>;

export type RequisitionPriority = 'urgent' | 'high' | 'normal' | 'low';

/** قلم سفارش: کالای انبار، مقدار و قیمت واحد برآوردی */
export interface ProjectOrderLine {
  itemId: number;
  itemCode: string;
  itemName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
}

export interface OrderSupplier {
  id: number;
  name: string;
}

interface PartyRow {
  id?: number | null;
  name?: string | null;
  partyType?: string | null;
  phone?: string | null;
}

/** تأمین‌کننده خرید: طرف حساب «تأمین‌کننده» یا «هر دو» (همان قاعده پرداخت خزانه و خرج چک، TD-498) */
export const isPurchaseSupplier = (party: PartyRow): boolean => party.partyType === 'supplier' || party.partyType === 'both';

/** گزینه‌های انتخاب تأمین‌کننده با شناسه طرف حساب */
export function supplierPickOptions(parties: readonly PartyRow[]): Array<{ value: string; label: string; supplier: OrderSupplier }> {
  return parties
    .filter(p => !!p && Number(p.id) > 0 && !!p.name?.trim() && isPurchaseSupplier(p))
    .map(p => ({
      value: String(p.id),
      label: p.phone ? `${p.name} - ${p.phone}` : String(p.name),
      supplier: { id: Number(p.id), name: String(p.name).trim() },
    }));
}

/** بدنه ثبت درخواست خرید پروژه (هر دو حالت) */
export function projectRequisitionBody(projectId: number, lines: readonly ProjectOrderLine[], opts: {
  title: string;
  priority: RequisitionPriority;
  requiredDate: string;
  notes: string;
}) {
  return {
    title: opts.title,
    projectId,
    priority: opts.priority,
    requiredDate: opts.requiredDate,
    notes: opts.notes,
    items: lines.map(l => ({
      itemId: l.itemId,
      itemCode: l.itemCode,
      itemName: l.itemName,
      unit: l.unit,
      requestedQty: l.quantity,
      unitPriceEstimate: l.unitPrice,
      notes: '',
    })),
  };
}

/** بدنه تبدیل همان درخواست به یک سفارش پیش‌نویس (رسید پیش‌نویس) برای تأمین‌کننده و انبار انتخاب‌شده */
export function draftOrderBody(lines: readonly ProjectOrderLine[], supplier: OrderSupplier, targetWarehouse: string, notes: string) {
  return {
    orderGroups: [{
      supplierId: supplier.id,
      supplierName: supplier.name,
      targetWarehouse,
      docType: 'receipt' as const,
      status: 'draft' as const,
      notes,
      items: lines.map(l => ({
        itemId: l.itemId,
        itemCode: l.itemCode,
        itemName: l.itemName,
        unit: l.unit,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
      })),
    }],
  };
}
