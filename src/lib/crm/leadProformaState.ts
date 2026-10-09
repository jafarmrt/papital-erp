/**
 * v10.0.31 (OBS-R2-30، TD-991): آنچه صفحه پرونده‌های فروش به فرم پیش‌فاکتور می‌فرستد، پس از ثبت مشتری پرونده. نشانی
 * خریدار فقط نشانی مشتری است؛ پیش‌تر اگر مشتری نشانی نداشت یادداشت پرونده فروش در نشانی خریدار پیش‌فاکتور چاپ می‌شد.
 */

export interface LeadForProforma {
  id: number;
  title: string;
  customerName?: string | null;
  company?: string | null;
  phone?: string | null;
  currency?: string | null;
}

export interface CustomerForProforma {
  id?: number | null;
  name?: string | null;
  phone?: string | null;
  address?: string | null;
}

export interface LeadProformaState {
  crmLeadId: number;
  customerId: number | undefined;
  buyerName: string;
  buyerPhone: string;
  buyerAddress: string;
  notes: string;
  status: 'proforma';
  currency: string;
}

export function leadProformaState(lead: LeadForProforma, customer: CustomerForProforma | null | undefined): LeadProformaState {
  return {
    crmLeadId: lead.id,
    // v9.0.336 (TD-778): پیش‌فاکتور به همان مشتری با شناسه وصل می‌شود
    customerId: customer?.id ?? undefined,
    buyerName: customer?.name || lead.customerName || lead.company || lead.title,
    buyerPhone: customer?.phone || lead.phone || '',
    buyerAddress: customer?.address || '',
    notes: `صادره از پرونده فروش #${lead.id} - ${lead.title}`,
    status: 'proforma',
    currency: lead.currency || 'IRR',
  };
}
