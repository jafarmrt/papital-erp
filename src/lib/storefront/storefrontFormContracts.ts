import type { FormTemplate, FormValues } from './storefrontFormRules.js';

/** v12 phase 10f: «فرم‌های سایت» between the ERP's server and its screen */
export interface FormListRow {
  id: number;
  key: string;
  title: string;
  /** «این فرم روی سایت باشد» */
  enabled: boolean;
  fieldCount: number;
  updatedAt: string;
  updatedBy: string;
  version: number;
}

export interface FormDetail extends FormListRow {
  form: FormValues;
}

export interface FormList {
  data: FormListRow[];
  /** how many forms the shop may have */
  max: number;
}

export interface FormCreateInput { title: string; key: string; template: FormTemplate | null }
export type FormSaveInput = FormValues & { version: number };
export interface FormSwitchInput { enabled: boolean; version: number }
