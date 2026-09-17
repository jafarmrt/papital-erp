export interface ContactPerson {
  id?: string;
  name: string;
  role?: string;
  phone?: string;
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
  currency?: string;
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
}

export interface PartyOption {
  id: number;
  name: string;
  partyType: 'customer' | 'supplier' | 'personnel' | 'other';
  phone?: string;
  code?: string;
  city?: string;
}
