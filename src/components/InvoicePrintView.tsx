import React, { useEffect, useState } from 'react';
import { formatPersianPrice, formatPersianNumber, formatPersianCode, formatCurrencyLabel, formatPersianDate } from '../utils';
import { fetchJson } from '../api';

export default function InvoicePrintView({ printedDoc }: { printedDoc: any }) {
  const [companyInfo, setCompanyInfo] = useState<{
    name: string;
    phone: string;
    address: string;
    logo: string;
  }>({
    name: 'سامانه جامع ERP و مدیریت کارگاه پاپیتال',
    phone: '',
    address: '',
    logo: ''
  });

  // V10-6.2: تاییدکنندگان سند از تاریخچه ورکفلو (برای بخش امضای چاپ)
  const [workflowSignatures, setWorkflowSignatures] = useState<Array<{ name: string; roleTitle: string; date: string }>>([]);

  useEffect(() => {
    fetchJson('/public-settings')
      .then((res: any) => {
        const rawSettings: { key: string; value: string }[] = Array.isArray(res?.settings)
          ? res.settings
          : (Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []));
        const name = res?.companyName || rawSettings.find(s => s.key === 'company_name')?.value || 'سامانه جامع ERP و مدیریت کارگاه پاپیتال';
        const phone = rawSettings.find(s => s.key === 'company_phone')?.value || '';
        const address = rawSettings.find(s => s.key === 'company_address')?.value || '';
        const logo = res?.companyLogo || rawSettings.find(s => s.key === 'company_logo')?.value || '';
        setCompanyInfo({ name, phone, address, logo });
      })
      .catch(err => console.error('Failed to load company settings for print', err));
  }, []);

  useEffect(() => {
    const docId = printedDoc?.id || printedDoc?.docId;
    if (!docId) return;
    const controller = new AbortController();
    fetchJson(`/accounting/doc-signatures?entityId=${docId}`, { signal: controller.signal })
      .then((res: any) => {
        setWorkflowSignatures(Array.isArray(res?.signatures) ? res.signatures : []);
      })
      .catch(() => setWorkflowSignatures([]));
    return () => controller.abort();
  }, [printedDoc?.id, printedDoc?.docId]);

  if (!printedDoc) return null;

  const isInvoice = printedDoc.type === 'invoice';
  const isReceipt = printedDoc.type === 'receipt';
  const isProforma = printedDoc.status === 'proforma' || printedDoc.type === 'proforma';
  const hasMonetaryValues = isInvoice || isReceipt || isProforma || (printedDoc.items && printedDoc.items.some((i: any) => Number(i.unit_price) > 0));
  const currencyLabel = formatCurrencyLabel(printedDoc.currency);
  
  let title = 'سند انبار';
  if (isInvoice) title = 'صورتحساب فروش کالا و خدمات';
  else if (isReceipt) title = 'رسید ورود و خرید کالا و مواد اولیه';
  else if (printedDoc.type === 'remittance') title = 'حواله خروج کالا و مصرف';
  else if (printedDoc.type === 'return') title = 'رسید برگشت از فروش';
  else if (printedDoc.type === 'waste') title = 'حواله ضایعات و افت کیفی';

  const totalGrossAmount = (printedDoc.items || []).reduce((a: any, b: any) => a + (Number(b.quantity || 0) * Number(b.unit_price || 0)), 0);
  const totalDiscountAmount = (printedDoc.items || []).reduce((a: any, b: any) => a + Number(b.discount || 0), 0);
  const totalNetAmount = totalGrossAmount - totalDiscountAmount;
  const totalQuantityCount = (printedDoc.items || []).reduce((a: any, b: any) => a + Number(b.quantity || 0), 0);

  return (
    <div className="bg-white p-6 mx-auto w-full max-w-[210mm] shadow print:shadow-none print:w-full print:p-4 font-sans text-sm border print:border-none">
      {/* Header Banner */}
      <div 
        className={`text-white flex items-center justify-between px-6 py-3 mb-4 font-bold text-lg rounded-t-xl print:rounded-none ${
          isReceipt ? 'bg-[#0f766e]' : isInvoice ? 'bg-[#4338ca]' : 'bg-[#475569]'
        }`} 
        style={{ 
          backgroundColor: isReceipt ? '#0f766e' : isInvoice ? '#4338ca' : '#475569', 
          printColorAdjust: 'exact' 
        }}
      >
        <div className="flex items-center gap-3">
          {companyInfo.logo && (
            <img src={companyInfo.logo} alt="Logo" className="w-8 h-8 object-contain bg-white rounded p-0.5" />
          )}
          <span>{title}</span>
          {isProforma && <span className="text-xs bg-amber-400 text-amber-950 px-2 py-0.5 rounded font-bold mr-2">پیش‌فاکتور</span>}
        </div>
        <div className="text-xs font-normal opacity-90">{companyInfo.name}</div>
      </div>

      {/* Doc Ref and Date */}
      <div className="flex justify-between items-center mb-3 text-xs border-b pb-2">
        <div className="font-bold flex items-center gap-2">
          <span>شماره سند:</span>
          <span className="font-mono text-sm bg-slate-100 px-2 py-0.5 rounded border border-slate-200">{formatPersianCode(printedDoc.ref_number)}</span>
        </div>
        <div className="font-bold flex items-center gap-2">
          <span>تاریخ ثبت:</span>
          <span className="font-mono bg-slate-100 px-2 py-0.5 rounded border border-slate-200">{formatPersianDate(printedDoc.date)}</span>
        </div>
      </div>
      
      {/* Parties Info Boxes */}
      {isInvoice ? (
        <table className="w-full mb-4 border-collapse print:text-[13px]">
          <tbody>
            <tr>
              <td colSpan={4} className="bg-gray-100 text-center font-bold py-1 border" style={{ backgroundColor: '#f3f4f6', printColorAdjust: 'exact' }}>مشخصات فروشنده</td>
            </tr>
            <tr>
              <td className="py-1 px-2 border w-1/3"><strong>نام فروشنده:</strong> {companyInfo.name}</td>
              <td colSpan={3} className="py-1 px-2 border"><strong>تلفن:</strong> {companyInfo.phone ? formatPersianCode(companyInfo.phone) : '-'}</td>
            </tr>
            <tr>
              <td colSpan={4} className="py-1 px-2 border"><strong>نشانی:</strong> {companyInfo.address || '-'}</td>
            </tr>

            <tr>
              <td colSpan={4} className="bg-gray-100 text-center font-bold py-1 border mt-2" style={{ backgroundColor: '#f3f4f6', printColorAdjust: 'exact' }}>مشخصات خریدار / مشتری</td>
            </tr>
            <tr>
              <td className="py-1 px-2 border w-1/4"><strong>نام خریدار:</strong> {printedDoc.buyer_name || '-'}</td>
              <td className="py-1 px-2 border w-1/4"><strong>استان / شهر:</strong> {printedDoc.buyer_city || '-'}</td>
              <td colSpan={2} className="py-1 px-2 border"><strong>تلفن:</strong> {formatPersianCode(printedDoc.buyer_phone || '-')}</td>
            </tr>
            <tr>
              <td colSpan={4} className="py-1 px-2 border"><strong>نشانی:</strong> {printedDoc.buyer_address || '-'}</td>
            </tr>
          </tbody>
        </table>
      ) : isReceipt ? (
        <table className="w-full mb-4 border-collapse print:text-[13px]">
          <tbody>
            <tr>
              <td colSpan={4} className="bg-emerald-50 text-emerald-900 text-center font-bold py-1 border border-emerald-200" style={{ backgroundColor: '#ecfdf5', printColorAdjust: 'exact' }}>
                مشخصات تامین‌کننده / فروشنده کالا
              </td>
            </tr>
            <tr>
              <td className="py-1 px-2 border w-1/3"><strong>نام تامین‌کننده:</strong> {printedDoc.buyer_name || 'تامین‌کننده ناشناس / عمومی'}</td>
              <td className="py-1 px-2 border w-1/3"><strong>استان / شهر:</strong> {printedDoc.buyer_city || '-'}</td>
              <td className="py-1 px-2 border w-1/3"><strong>تلفن تماس:</strong> {formatPersianCode(printedDoc.buyer_phone || '-')}</td>
            </tr>
            <tr>
              <td colSpan={4} className="py-1 px-2 border"><strong>نشانی / محل تامین:</strong> {printedDoc.buyer_address || '-'}</td>
            </tr>

            <tr>
              <td colSpan={4} className="bg-gray-100 text-center font-bold py-1 border" style={{ backgroundColor: '#f3f4f6', printColorAdjust: 'exact' }}>
                مشخصات تحویل‌گیرنده و انبار مقصد
              </td>
            </tr>
            <tr>
              <td className="py-1 px-2 border w-1/2"><strong>کارگاه / انبار:</strong> {companyInfo.name}</td>
              <td className="py-1 px-2 border w-1/2"><strong>مسئول ثبت / انباردار:</strong> {printedDoc.user || '-'}</td>
            </tr>
          </tbody>
        </table>
      ) : (
        <div className="flex justify-between items-center mb-4 text-sm font-medium border p-3 rounded bg-slate-50">
          <div>{['return'].includes(printedDoc.type) ? 'تحویل دهنده:' : 'گیرنده حواله / مصرف‌کننده:'} <strong>{printedDoc.buyer_name || '-'}</strong></div>
          <div>مسئول صدور سند: <strong>{printedDoc.user || '-'}</strong></div>
        </div>
      )}

      {/* Items Table Header */}
      <div className="bg-gray-100 text-center font-bold py-1 border border-b-0 print:text-[13px]" style={{ backgroundColor: '#f3f4f6', printColorAdjust: 'exact' }}>
        ریز اقلام، تعداد و ارقام سند ({formatPersianNumber((printedDoc.items || []).length)} ردیف - مجموع {formatPersianNumber(totalQuantityCount)} واحد)
      </div>

      <table className="w-full text-center border-collapse border print:text-[12px] break-inside-auto">
        <thead>
          <tr 
            className="text-white text-xs font-bold" 
            style={{ 
              backgroundColor: isReceipt ? '#0f766e' : isInvoice ? '#4338ca' : '#475569', 
              printColorAdjust: 'exact' 
            }}
          >
            <th className="border p-1.5 font-medium w-12">ردیف</th>
            <th className="border p-1.5 font-medium w-24">کد کالا</th>
            <th className="border p-1.5 font-medium text-right pr-3">شرح کالا و مشخصات</th>
            <th className="border p-1.5 font-medium w-16">تعداد</th>
            <th className="border p-1.5 font-medium w-14">واحد</th>
            {hasMonetaryValues && <th className="border p-1.5 font-medium w-28">مبلغ واحد ({currencyLabel})</th>}
            {hasMonetaryValues && <th className="border p-1.5 font-medium w-28">مبلغ کل ({currencyLabel})</th>}
            {hasMonetaryValues && <th className="border p-1.5 font-medium w-20">تخفیف ({currencyLabel})</th>}
            {hasMonetaryValues && <th className="border p-1.5 font-medium w-28">مبلغ نهایی ({currencyLabel})</th>}
          </tr>
        </thead>
        <tbody>
          {(printedDoc.items || []).map((item: any, idx: number) => {
            const itemQty = Number(item.quantity || 0);
            const itemUnitPrice = Number(item.unit_price || 0);
            const itemDisc = Number(item.discount || 0);
            const total = itemQty * itemUnitPrice;
            const final = total - itemDisc;
            return (
              <tr key={item.id || idx} className="h-7 hover:bg-slate-50 break-inside-avoid">
                <td className="border p-1 font-medium bg-slate-50">{formatPersianNumber(idx + 1)}</td>
                <td className="border p-1 font-mono text-[11px]" dir="ltr">{formatPersianCode(item.code || '-')}</td>
                <td className="border p-1 font-bold text-right pr-3 text-slate-800">{item.name}</td>
                <td className="border p-1 font-bold font-mono">{formatPersianNumber(itemQty)}</td>
                <td className="border p-1 text-slate-600">{item.unit || 'عدد'}</td>
                {hasMonetaryValues && <td className="border p-1 font-mono">{formatPersianPrice(itemUnitPrice)}</td>}
                {hasMonetaryValues && <td className="border p-1 font-mono">{formatPersianPrice(total)}</td>}
                {hasMonetaryValues && <td className="border p-1 font-mono text-rose-700">{itemDisc > 0 ? formatPersianPrice(itemDisc) : '-'}</td>}
                {hasMonetaryValues && <td className="border p-1 font-bold font-mono bg-slate-50 text-slate-900">{formatPersianPrice(final)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Summary Footer */}
      <table className="w-full mt-2 border-collapse print:text-[13px] break-inside-avoid">
        <tbody>
          <tr>
            <td className="border p-2 align-top h-20" colSpan={hasMonetaryValues ? 4 : 1} rowSpan={hasMonetaryValues ? 3 : 1}>
              <div className="font-bold text-slate-700 mb-1">یادداشت‌ها و توضیحات سند:</div>
              <p className="text-xs text-slate-600 leading-relaxed">{printedDoc.notes || 'توضیحات خاصی ثبت نشده است.'}</p>
            </td>
            {hasMonetaryValues && (
              <>
                <td className="border p-2 bg-gray-50 w-36 font-bold text-slate-700 text-xs" style={{ backgroundColor: '#f9fafb', printColorAdjust: 'exact' }}>
                  جمع کل ناخالص ({currencyLabel}):
                </td>
                <td className="border p-2 w-40 text-left font-bold font-mono text-slate-800">
                  {formatPersianPrice(totalGrossAmount)}
                </td>
              </>
            )}
          </tr>
          {hasMonetaryValues && (
            <tr>
              <td className="border p-2 bg-gray-50 font-bold text-rose-700 text-xs" style={{ backgroundColor: '#f9fafb', printColorAdjust: 'exact' }}>
                مجموع تخفیف ({currencyLabel}):
              </td>
              <td className="border p-2 text-left font-bold font-mono text-rose-700">
                {formatPersianPrice(totalDiscountAmount)}
              </td>
            </tr>
          )}
          {hasMonetaryValues && (
            <tr>
              <td 
                className={`border p-2 font-black text-xs ${isReceipt ? 'bg-emerald-100 text-emerald-950' : 'bg-indigo-100 text-indigo-950'}`} 
                style={{ 
                  backgroundColor: isReceipt ? '#d1fae5' : '#e0e7ff', 
                  printColorAdjust: 'exact' 
                }}
              >
                {isReceipt ? 'ارزش کل فاکتور خرید:' : 'مبلغ نهایی قابل پرداخت:'}
              </td>
              <td 
                className={`border p-2 text-left font-black text-base font-mono ${isReceipt ? 'bg-emerald-50 text-emerald-950' : 'bg-indigo-50 text-indigo-950'}`} 
                style={{ 
                  backgroundColor: isReceipt ? '#ecfdf5' : '#eef2ff', 
                  printColorAdjust: 'exact' 
                }}
              >
                {formatPersianPrice(totalNetAmount)} {currencyLabel}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Signature Section — V10-6.2: با وجود امضاهای ورکفلو، گرید سه‌ستونه تاییدکنندگان رندر می‌شود */}
      {workflowSignatures.length > 0 ? (
        <div className="mt-8 border border-slate-300 rounded-lg overflow-hidden break-inside-avoid print:text-[12px]">
          <div className="bg-gray-100 text-center font-bold py-1 text-xs border-b border-slate-300" style={{ backgroundColor: '#f3f4f6', printColorAdjust: 'exact' }}>
            تاییدکنندگان سند (گردش کار)
          </div>
          <div className="grid grid-cols-3 divide-x divide-x-reverse divide-slate-300">
            {workflowSignatures.map((sig, idx) => (
              <div key={idx} className="p-3 text-center">
                <div className="font-bold text-slate-800 text-xs">{sig.name}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{sig.roleTitle}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">{formatPersianDate(sig.date)}</div>
                <div className="mt-6 mx-4 border-b border-dashed border-slate-400"></div>
              </div>
            ))}
            {workflowSignatures.length < 3 && Array.from({ length: 3 - workflowSignatures.length }).map((_, idx) => (
              <div key={`empty-${idx}`} className="p-3 text-center">
                <div className="font-bold text-slate-400 text-xs">—</div>
                <div className="text-[10px] text-slate-400 mt-0.5">در انتظار تایید</div>
                <div className="mt-6 mx-4 border-b border-dashed border-slate-400"></div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-8 flex justify-between items-center text-center font-bold px-8 text-xs text-slate-700 break-inside-avoid">
          <div>
            <p className="mb-8">{isReceipt ? 'امضاء و تایید تامین‌کننده / تحویل‌دهنده' : 'مهر و امضاء خریدار'}</p>
            <div className="w-36 border-b border-dashed border-slate-400 mx-auto"></div>
          </div>
          <div>
            <p className="mb-8">{isReceipt ? 'امضاء انباردار / مسئول خرید کارگاه' : 'مهر و امضاء فروشنده (کارگاه)'}</p>
            <div className="w-36 border-b border-dashed border-slate-400 mx-auto"></div>
          </div>
        </div>
      )}
    </div>
  );
}
