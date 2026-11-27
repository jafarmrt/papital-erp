import React, { useId } from 'react';
import { needsChosenContraAccount, SALARY_SETTLEMENT_VIA_PAYSLIP_MESSAGE, type PersonnelPurpose } from '../../../lib/treasury/partyPurpose';
import { ContraAccountField } from './ContraAccountField';
import { DecimalInput } from '../../common/DecimalInput';

interface PartyPurposeFieldsProps {
  partyType: string;
  purpose: PersonnelPurpose | '';
  contraAccountId: number | null;
  isReceipt: boolean;
  /** v10.0.57 (TD-925): فرم خزانه پرداخت «تسویه حقوق» را پیشنهاد نمی‌کند؛ تسویه حقوق فقط از «پرداخت فیش» است */
  settlementViaPayslipOnly?: boolean;
  onChange: (patch: { purpose?: PersonnelPurpose | ''; contraAccountId: number | null }) => void;
  /**
   * v12 colleague sales part B2: the treasury form offers «حساب جاری شریک» (the cheque book does not); a rial row of it asks
   * the euro rate it is turned into euros at
   */
  partnerAccount?: { bankCurrency: string; euroRate: number; onEuroRateChange: (rate: number) => void };
}

export const PARTNER_ACCOUNT_FIELD_TEXT = {
  option: (isReceipt: boolean) => `حساب جاری شریک (${isReceipt ? 'دریافت از شریک' : 'پرداخت به شریک'}، به یورو) ← «حساب جاری شرکا»`,
  rate: 'نرخ یورو (ریال برای هر یورو) *',
  rateHint: 'بدهی شریک به یورو است؛ این مبلغ ریالی با همین نرخ به یورو حساب می‌شود و فرق نرخ با میانگین ماندهٔ یورویی شریک، سود یا زیان تسعیر است.',
  euroHint: 'بدهی شریک به یورو است؛ فرق نرخ تسعیر این ردیف با میانگین ماندهٔ یورویی شریک، سود یا زیان تسعیر ثبت می‌شود.',
} as const;

/**
 * v9.0.82 / v9.0.84 (TD-507 / TD-497، تصمیم‌های مالک محصول ت۴ و ت۲ الف): نوع دریافت یا پرداخت پرسنل (الزامی، بی پیش‌فرض)
 * و سرفصل طرف مقابل «متفرقه» و «سایر» پرسنل؛ فرم خزانه و فرم ثبت چک هر دو همین را دارند.
 */
export const PartyPurposeFields: React.FC<PartyPurposeFieldsProps> = ({ partyType, purpose, contraAccountId, isReceipt, settlementViaPayslipOnly = false, onChange, partnerAccount }) => {
  const fieldId = useId();
  const offerSettlement = isReceipt || !settlementViaPayslipOnly;
  return (
  <>
    {partyType === 'personnel' && (
      <div>
        <label htmlFor={`${fieldId}-purpose`} className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
          {isReceipt ? 'نوع دریافت از پرسنل *' : 'نوع پرداخت به پرسنل *'}
        </label>
        <select
          id={`${fieldId}-purpose`}
          required
          value={purpose}
          onChange={e => onChange({ purpose: e.target.value as PersonnelPurpose | '', contraAccountId: null })}
          className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl font-bold"
        >
          <option value="">انتخاب کنید...</option>
          {offerSettlement && <option value="settlement">تسویه حقوق و دستمزد ← «حقوق پرداختنی»</option>}
          <option value="advance">مساعده / وام ← «مساعده و وام پرسنل»</option>
          {!isReceipt && <option value="deductions">واریز کسورات حقوق ← «سایر کسورات حقوق پرداختنی»</option>}
          <option value="colleague_account">{isReceipt ? 'حساب جاری همکار (پس دادن تنخواه)' : 'حساب جاری همکار (تنخواه یا بازپرداخت هزینه‌ای که از جیب داده)'} ← «حساب جاری همکاران»</option>
          {partnerAccount && <option value="partner_account">{PARTNER_ACCOUNT_FIELD_TEXT.option(isReceipt)}</option>}
          <option value="other">سایر ← سرفصلی که انتخاب می‌کنید</option>
        </select>
        {!offerSettlement && <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{SALARY_SETTLEMENT_VIA_PAYSLIP_MESSAGE}</p>}
      </div>
    )}
    {partnerAccount && partyType === 'personnel' && purpose === 'partner_account' && (
      partnerAccount.bankCurrency === 'IRR' ? (
        <div>
          <label htmlFor={`${fieldId}-partner-rate`} className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">{PARTNER_ACCOUNT_FIELD_TEXT.rate}</label>
          <DecimalInput id={`${fieldId}-partner-rate`} required min={1} step="any" value={partnerAccount.euroRate || ''}
            onValueChange={(v) => partnerAccount.onEuroRateChange(Number(v) || 0)}
            className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl font-mono" />
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{PARTNER_ACCOUNT_FIELD_TEXT.rateHint}</p>
        </div>
      ) : <p className="text-[11px] text-slate-500 dark:text-slate-400">{PARTNER_ACCOUNT_FIELD_TEXT.euroHint}</p>
    )}
    {needsChosenContraAccount(partyType, purpose) && (
      <ContraAccountField value={contraAccountId} onChange={id => onChange({ contraAccountId: id })} />
    )}
  </>
  );
};
