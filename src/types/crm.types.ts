export interface ContactPerson {
  id?: string;
  name: string;
  role?: string;
  phone?: string;
  /** v10.1.15 (N-02، ت۲) */
  email?: string;
  isPrimary?: boolean;
}

export interface Customer {
  id: number;
  name: string;
  code?: string;
  contactName?: string;
  country?: string;
  province?: string;
  phone: string;
  city: string;
  address: string;
  notes: string;
  partyType?: 'customer' | 'supplier' | 'both';
  party_type?: 'customer' | 'supplier' | 'both';
  supplierCategory?: string;
  supplier_category?: string;
  bankInfo?: {
    bankName?: string;
    accountNumber?: string;
    shaba?: string;
    cardNumber?: string;
  };
  bank_info?: {
    bankName?: string;
    accountNumber?: string;
    shaba?: string;
    cardNumber?: string;
  };
  contacts?: ContactPerson[];
  /** v10.1.15 (N-02 بخش ۱): راه‌های ارتباط */
  website?: string;
  email?: string;
  instagram?: string;
  /** v10.1.23 (N-02 بخش ۳): برچسب‌های زنده طرف حساب (فهرست طرف حساب‌ها) */
  tags?: Array<{ id: number; name: string; color: string }>;
  currency?: string;
  /** نسخه قفل خوش‌بینانه؛ فرم ویرایش همان را برمی‌گرداند (TD-403) */
  version?: number;
}

export interface CRMLead {
  id: number;
  title: string;
  customerId?: number | null;
  customerName?: string;
  phone?: string;
  company?: string;
  source?: string;
  stage: string;
  // v10.1.18 (N-02 بخش ۲): دلیل از دست رفتن از `CRM_LOST_REASONS`
  lostReason?: string;
  lostReasonNote?: string;
  estimatedValue: number;
  currency: string;
  probability: number;
  assignedTo: string;
  // V10-4.1: لینک رسمی فروشنده به پرسنل
  assignedPersonnelId?: number | null;
  expectedCloseDate?: string;
  notes?: string;
  status: string;
  contacts?: ContactPerson[];
  hasProforma?: number;
  proformaId?: number | null;
  /** v10.1.22 (N-02 بخش ۳): نزدیک‌ترین سررسید پیگیری باز پرونده (ISO)، از فهرست پرونده‌ها */
  nextFollowUpDate?: string | null;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
}

export interface CRMActivity {
  id: number;
  leadId?: number | null;
  leadTitle?: string;
  customerId?: number | null;
  customerName?: string;
  type: string; // 'call' | 'meeting' | 'email' | 'whatsapp' | 'note' | 'quote' | 'task'
  title: string;
  description?: string;
  result?: string;
  loggedBy?: string;
  activity_date?: string;
  activityDate?: string;
  activity_date_iso?: string;
  activityDateIso?: string;
  next_followup_date?: string;
  nextFollowUpDate?: string;
  next_followup_date_iso?: string;
  nextFollowUpDateIso?: string;
  next_followup_task?: string;
  nextFollowUpTask?: string;
  assignedTo?: string;
  // V10-4.1: لینک رسمی مسئول تسک به پرسنل
  assignedPersonnelId?: number | null;
  is_followup_completed?: number;
  isFollowUpCompleted: number;
  created_at?: string;
  createdAt?: string;
  mentions?: number[];
  // v10.1.18 (N-02 بخش ۲): نسخه برای ویرایش و آخرین ویرایشگر
  version?: number;
  updatedAt?: string | null;
  updatedBy?: string;
}

export interface PartyOption {
  id: number;
  name: string;
  partyType: 'customer' | 'supplier' | 'personnel' | 'other';
  phone?: string;
  code?: string;
  city?: string;
}
