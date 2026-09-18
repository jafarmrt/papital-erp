export interface Personnel {
  id: number;
  firstName?: string;
  lastName?: string;
  fullName: string;
  personnelCode?: string;
  userId?: number | null;
  username?: string;
  gender?: string;
  birthDate?: string;
  nationality?: string;
  nationalId?: string;
  phone?: string;
  employmentStatus?: string;
  // V10-4.4: مدل حقوق — 'none' | 'piecework' | 'monthly_fixed' | 'mixed'
  salaryType?: 'none' | 'piecework' | 'monthly_fixed' | 'mixed';
  monthlySalary?: number | string | null;
  jobTitle?: string;
  education?: string;
  endDate?: string;
  terminationReason?: string;
  specializedSkills?: string;
  otherSkills?: string;
  referralSource?: string;
  cardNumber?: string;
  accountNumber?: string;
  shebaNumber?: string;
  bankName?: string;
  nobitexUsername?: string;
  nobitexPassword?: string;
  address?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
  isDeleted?: number;
}

export interface PieceworkTask {
  id: number;
  code: string;
  title: string;
  category?: string;
  defaultRate: number;
  unit: string;
  description?: string;
  isActive?: number;
  createdAt?: string;
  updatedAt?: string;
  isDeleted?: number;
  previousRate?: number;
  rateChangesCount?: number;
}

export interface PieceworkTaskRateHistory {
  id: number;
  taskId: number;
  taskCode?: string;
  taskTitle?: string;
  oldRate: number;
  newRate: number;
  changeType: 'create' | 'rate_change' | 'excel_import' | 'title_change' | 'archived' | 'restored';
  reason?: string;
  changedByUserId?: number | null;
  changedByUsername?: string;
  effectiveDate: string;
  createdAt?: string;
}

export interface PieceworkPersonnelRate {
  id: number;
  personnelId: number;
  taskId: number;
  customRate: number;
  updatedAt?: string;
}

export interface PieceworkLog {
  id: number;
  personnelId: number;
  personnelName?: string;
  personnelCode?: string;
  taskId: number;
  taskTitle?: string;
  taskCode?: string;
  taskCategory?: string;
  projectId?: number | null;
  projectCode?: string;
  projectTitle?: string;
  unit?: string;
  date: string;
  date_iso?: string;
  dateIso?: string;
  quantity: number;
  unitRate: number;
  totalAmount: number;
  notes?: string;
  payrollId?: number | null;
  status?: string;
  createdById?: number;
  createdByUsername?: string;
  createdAt?: string;
}

export interface PieceworkPayroll {
  id: number;
  payrollNumber: string;
  personnelId: number;
  personnelName?: string;
  personnelCode?: string;
  jobTitle?: string;
  cardNumber?: string;
  shebaNumber?: string;
  bankName?: string;
  nobitexUsername?: string;
  startDate: string;
  endDate: string;
  title: string;
  totalPieceworkAmount: number;
  // V10-4.4: سهم حقوق ثابت در فیش (monthly_fixed / mixed)
  totalFixedAmount?: number;
  // V1.9.0: کسر از مساعده/وام پرسنلی (بستانکار حساب مساعده در سند تسویه)
  advanceDeduction?: number;
  advance_deduction?: number;
  totalBonuses: number;
  totalDeductions: number;
  netPayable: number;
  // V4.0.33: پرداخت چندمرحله‌ای حقوق
  paidAmount?: number;
  paid_amount?: number;
  remainingAmount?: number;
  status: 'draft' | 'approved' | 'partially_paid' | 'paid';
  paymentDate?: string;
  paymentMethod?: string;
  paymentReference?: string;
  notes?: string;
  items?: PieceworkLog[];
  createdAt?: string;
  voucherId?: number | null;
  voucherNumber?: number | string | null;
  voucherStatus?: string | null;
  isVoucherSynced?: boolean;
}
