import React from 'react';
import { needsChosenContraAccount, SALARY_SETTLEMENT_VIA_PAYSLIP_MESSAGE, type PersonnelPurpose } from '../../../lib/treasury/partyPurpose';
import { ContraAccountField } from './ContraAccountField';

interface PartyPurposeFieldsProps {
  partyType: string;
  purpose: PersonnelPurpose | '';
  contraAccountId: number | null;
  isReceipt: boolean;
  /** v10.0.22 (TD-925): فرم خزانه پرداخت «تسویه حقوق» را پیشنهاد نمی‌کند؛ تسویه حقوق فقط از «پرداخت فیش» است */
  settlementViaPayslipOnly?: boolean;
  onChange: (patch: { purpose?: PersonnelPurpose | ''; contraAccountId: number | null }) => void;
}

/**
 * v9.0.82 / v9.0.84 (TD-507 / TD-497، تصمیم‌های مالک محصول ت۴ و ت۲ الف): نوع دریافت یا پرداخت پرسنل (الزامی، بی پیش‌فرض)
 * و سرفصل طرف مقابل «متفرقه» و «سایر» پرسنل؛ فرم خزانه و فرم ثبت چک هر دو همین را دارند.
 */
export const PartyPurposeFields: React.FC<PartyPurposeFieldsProps> = ({ partyType, purpose, contraAccountId, isReceipt, settlementViaPayslipOnly = false, onChange }) => {
  const offerSettlement = isReceipt || !settlementViaPayslipOnly;
  return (
  <>
    {partyType === 'personnel' && (
      <div>
        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
          {isReceipt ? 'نوع دریافت از پرسنل *' : 'نوع پرداخت به پرسنل *'}
        </label>
        <select
          required
          value={purpose}
          onChange={e => onChange({ purpose: e.target.value as PersonnelPurpose | '', contraAccountId: null })}
          className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl font-bold"
        >
          <option value="">انتخاب کنید...</option>
          {offerSettlement && <option value="settlement">تسویه حقوق و دستمزد → «حقوق پرداختنی»</option>}
          <option value="advance">مساعده / وام → «مساعده و وام پرسنل»</option>
          <option value="other">سایر → سرفصلی که انتخاب می‌کنید</option>
        </select>
        {!offerSettlement && <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{SALARY_SETTLEMENT_VIA_PAYSLIP_MESSAGE}</p>}
      </div>
    )}
    {needsChosenContraAccount(partyType, purpose) && (
      <ContraAccountField value={contraAccountId} onChange={id => onChange({ contraAccountId: id })} />
    )}
  </>
  );
};
