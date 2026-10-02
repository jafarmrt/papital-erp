import { Users } from 'lucide-react';
import { Customer, Personnel } from '../../../types';
import { SearchableSelect } from '../../SearchableSelect';
import type { StockDocumentForm } from '../../../hooks/documents/useStockDocumentForm';

interface StockCounterpartyFieldProps {
  form: StockDocumentForm;
  personnelList: Personnel[];
  suppliersList: Customer[];
}

/**
 * TD-080 (بخش ۳): طرف حساب سند انبار — تامین‌کننده (رسید، با اطلاعات بانکی) یا پرسنل گیرنده (حواله) —
 * استخراج‌شده از DocumentsPage.
 */
export function StockCounterpartyField({ form, personnelList, suppliersList }: StockCounterpartyFieldProps) {
  const { actionType, buyerName, setBuyerName, selectedSupplierObj, setSelectedSupplierObj, selectedPersonnelObj } = form;

  return (
    <div>
      <label className="block text-xs font-bold mb-1.5 text-slate-700 flex items-center justify-between">
        <span className="flex items-center gap-1">
          <Users size={13} className="text-slate-500" />
          <span>{actionType === 'in' ? 'تامین‌کننده / فروشنده کالا' : 'گیرنده حواله (پرسنل کارگاه)'}</span>
        </span>
        {actionType === 'in' && selectedSupplierObj && (
          <span className="text-[10px] font-normal text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
            طرف حساب ثبت‌شده {selectedSupplierObj.supplierCategory ? `(${selectedSupplierObj.supplierCategory})` : ''}
          </span>
        )}
        {actionType === 'out' && selectedPersonnelObj && (
          <span className="text-[10px] font-normal text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-200">
            پرسنل کارگاه: {selectedPersonnelObj.jobTitle || 'عضو تیم'} {selectedPersonnelObj.personnelCode ? `| کد: ${selectedPersonnelObj.personnelCode}` : ''}
          </span>
        )}
      </label>
      {actionType === 'out' ? (
        personnelList.length > 0 ? (
          <SearchableSelect
            value={buyerName}
            onChange={(val) => setBuyerName(val)}
            placeholder="جستجو و انتخاب پرسنل کارگاه..."
            maxResults={100}
            options={personnelList.map((p, idx) => {
              const name = p.fullName || `${p.firstName || ''} ${p.lastName || ''}`.trim() || 'پرسنل';
              const code = p.personnelCode ? `[کد: ${p.personnelCode}]` : '';
              const title = p.jobTitle ? `- ${p.jobTitle}` : '';
              const status = p.employmentStatus && p.employmentStatus !== 'فعال' ? `(${p.employmentStatus})` : '';
              return {
                value: name,
                label: `👤 ${name} ${code} ${title} ${status}`.trim().replace(/\s+/g, ' ')
              };
            })}
          />
        ) : (
          <input 
            required
            type="text" 
            value={buyerName} 
            onChange={e => setBuyerName(e.target.value)} 
            placeholder="نام پرسنل گیرنده حواله..." 
            className="w-full border border-slate-200 bg-slate-50/50 rounded-xl text-sm px-3 py-2 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all" 
          />
        )
      ) : actionType === 'in' ? (
        <div className="space-y-1.5">
          <SearchableSelect
            value={buyerName}
            onChange={(val) => {
              setBuyerName(val);
              const list = Array.isArray(suppliersList) ? suppliersList : [];
              const found = list.find(s => s.name.trim().toLowerCase() === val.trim().toLowerCase());
              setSelectedSupplierObj(found || null);
            }}
            placeholder="انتخاب طرف‌حساب..."
            options={(Array.isArray(suppliersList) ? suppliersList : []).map((s) => ({
              value: s.name,
              label: `${s.name}${s.supplierCategory ? ` (${s.supplierCategory})` : ''}${s.phone ? ` - ${s.phone}` : ''}`
            }))}
          />
          {selectedSupplierObj?.bankInfo && (selectedSupplierObj.bankInfo.cardNumber || selectedSupplierObj.bankInfo.shaba) && (
            <div className="text-[11px] text-slate-600 bg-slate-100/80 px-2.5 py-1.5 rounded-lg border border-slate-200 flex flex-wrap items-center gap-x-3 gap-y-1">
              {selectedSupplierObj.bankInfo.bankName && (
                <span>بانک: <strong>{selectedSupplierObj.bankInfo.bankName}</strong></span>
              )}
              {selectedSupplierObj.bankInfo.cardNumber && (
                <span>کارت: <strong className="font-mono" dir="ltr">{selectedSupplierObj.bankInfo.cardNumber}</strong></span>
              )}
              {selectedSupplierObj.bankInfo.shaba && (
                <span>شبا: <strong className="font-mono" dir="ltr">{selectedSupplierObj.bankInfo.shaba}</strong></span>
              )}
            </div>
          )}
        </div>
      ) : (
        <input 
          type="text" 
          value={buyerName} 
          onChange={e => setBuyerName(e.target.value)} 
          placeholder="نام طرف حساب..." 
          className="w-full border border-slate-200 bg-slate-50/50 rounded-xl text-sm px-3 py-2 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all" 
        />
      )}
    </div>
  );
}
