import { Lock, Building2, Calendar, UserCheck } from 'lucide-react';
import DatePicker from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import { Customer, Personnel, User } from '../../../types';
import { extractDateString } from '../../../utils';
import { ExchangeRateField } from '../ExchangeRateField';
import type { WarehouseItem } from '../../../hooks/queries/useSettingsQueries';
import type { StockDocProject } from '../../../lib/documents/stockReservations';
import type { StockDocumentForm } from '../../../hooks/documents/useStockDocumentForm';
import { StockCounterpartyField } from './StockCounterpartyField';
import { STOCK_PAGE_DOC_TYPE_LABELS } from '../../../lib/documents/stockDocumentAccess';
import { ReturnInvoiceYearChoices } from './ReturnInvoiceYearChoices';
import { isServerSeriesDocumentType } from '../../../lib/documents/documentRefRules';

interface StockDocumentDetailsFieldsProps {
  form: StockDocumentForm;
  currentUser: User;
  warehouses: WarehouseItem[];
  projectsList: StockDocProject[];
  personnelList: Personnel[];
  suppliersList: Customer[];
  /** v9.0.241 (TD-791): نوع‌های سندی که فهرست نشان می‌دهد (`stockPageTypeOptions`) */
  typeOptions: readonly string[];
}

/**
 * TD-080 (بخش ۳): مشخصات سند انبار (نوع، شماره، ارز و نرخ، پروژه، فاکتور مرجع برگشتی، طرف حساب، انبار،
 * تاریخ، صادرکننده، توضیحات) — استخراج‌شده از DocumentsPage.
 */
export function StockDocumentDetailsFields({ form, currentUser, warehouses, projectsList, personnelList, suppliersList, typeOptions }: StockDocumentDetailsFieldsProps) {
  const {
    actionType, docType, setDocType, refNumber, setRefNumber, currency, setCurrency, exchangeRate, setExchangeRate,
    selectedProjectId, setSelectedProjectId, returnInvoiceRef, changeReturnInvoiceRef, returnInvoiceId, returnInvoiceCandidates,
    returnTermsLocked, returnVatPercent, setReturnVatPercent, handleFetchReturnInvoice, location, setLocation, date, setDate, notes, setNotes,
  } = form;

  return (
    <>
      {/* Document Section Header */}
      <div className="flex items-center gap-2 text-slate-800 border-b border-slate-100 pb-2">
        <Building2 size={18} className="text-blue-600" />
        <h3 className="font-bold text-sm">
          {actionType === 'in' ? 'مشخصات سند رسید ورود و انبارداری' : 'مشخصات سند حواله خروج و تحویل‌گیرنده'}
        </h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <div>
          <label className="block text-xs font-bold mb-1.5 text-slate-700">نوع سند</label>
          <select 
            className="w-full border border-slate-200 bg-slate-50/50 rounded-xl text-sm px-3 py-2 font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all" 
            value={docType} 
            onChange={e => setDocType(e.target.value)}
          >
            {typeOptions.map(type => (
              <option key={type} value={type}>{STOCK_PAGE_DOC_TYPE_LABELS[type] ?? type}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold mb-1.5 text-slate-700">شماره سند / رفرنس</label>
          {/* v9.0.285 (TD-783، تصمیم ت۹ الف): شماره برگشت از فروش فقط از سری سرور است */}
          <input 
            required 
            type="text" 
            value={refNumber} 
            onChange={e => setRefNumber(e.target.value)} 
            readOnly={isServerSeriesDocumentType(docType)}
            title={isServerSeriesDocumentType(docType) ? 'شماره هنگام ثبت از سری سرور داده می‌شود' : undefined}
            className="w-full border border-slate-200 bg-slate-50/50 rounded-xl text-sm px-3 py-2 text-left font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all read-only:text-slate-500" 
            dir="ltr" 
          />
        </div>

        {actionType === 'in' && (
          <div>
            <label className="block text-xs font-bold mb-1.5 text-slate-700">واحد پول (ارز سند)</label>
            <select 
              className="w-full border border-slate-200 bg-slate-50/50 rounded-xl text-sm px-3 py-2 font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all" 
              value={currency} 
              onChange={e => setCurrency(e.target.value)}
              disabled={returnTermsLocked}
            >
              <option value="IRR">ریال (IRR)</option>
              <option value="USD">دلار (USD)</option>
              <option value="EUR">یورو (EUR)</option>
              <option value="AED">درهم (AED)</option>
              <option value="GBP">پوند (GBP)</option>
            </select>
            <ExchangeRateField currency={currency} value={exchangeRate} onChange={setExchangeRate} disabled={returnTermsLocked} />
          </div>
        )}

        {actionType === 'out' && (
          <div>
            <label className="block text-xs font-bold mb-1.5 text-purple-950 flex items-center gap-1">
              <Lock size={13} className="text-purple-600" />
              <span>پروژه مربوطه (جهت خروج)</span>
            </label>
            <select 
              className="w-full border border-purple-300 bg-purple-50/60 rounded-xl text-sm px-3 py-2 font-bold text-purple-950 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all" 
              value={selectedProjectId} 
              onChange={e => setSelectedProjectId(e.target.value)}
            >
              <option value="">— خروج عمومی (بدون تخصیص به پروژه) —</option>
              {projectsList.map((p, idx) => (
                <option key={`proj-${p.id || idx}-${idx}`} value={p.id}>
                  پروژه {p.project_code || p.id} - {p.title}
                </option>
              ))}
            </select>
          </div>
        )}

        {docType === 'return' && (
          <div>
            <label className="block text-xs font-bold mb-1.5 text-slate-700">شماره فاکتور مرجع</label>
            <div className="flex gap-2">
              <input 
                type="text" 
                value={returnInvoiceRef} 
                onChange={e => changeReturnInvoiceRef(e.target.value)} 
                placeholder="مثال: 1005" 
                className="w-full border border-slate-200 bg-slate-50/50 rounded-xl text-sm px-3 py-2 text-left font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" 
                dir="ltr" 
              />
              <button 
                type="button" 
                onClick={() => void handleFetchReturnInvoice()} 
                className="bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 px-3 rounded-xl text-xs font-bold whitespace-nowrap transition-colors"
              >
                جستجو
              </button>
            </div>
            <ReturnInvoiceYearChoices candidates={returnInvoiceCandidates} onChoose={year => void handleFetchReturnInvoice(year)} />
            <p className="text-[10px] text-slate-500 mt-1">
              {returnInvoiceId !== null
                ? 'ارز، نرخ و قیمت خالص هر کالا از همین فاکتور است و کالاها با بهای تمام‌شده خروج همین فاکتور وارد انبار می‌شوند.'
                : 'بدون فاکتور مرجع، کالا با میانگین موزون فعلی وارد انبار می‌شود.'}
            </p>
            {returnTermsLocked ? (
              <p className="text-[10px] text-slate-500 mt-1">مالیات بر ارزش افزوده به نسبت مبلغ برگشتی از مالیات همین فاکتور برمی‌گردد.</p>
            ) : (
              <label className="block text-[11px] font-bold mt-2 text-slate-700">
                درصد مالیات بر ارزش افزوده
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  value={returnVatPercent}
                  onChange={e => setReturnVatPercent(e.target.value === '' ? '' : Number(e.target.value))}
                  className="mt-1 w-full border border-slate-200 bg-slate-50/50 rounded-xl text-sm px-3 py-1.5 text-left font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  dir="ltr"
                />
              </label>
            )}
          </div>
        )}

        <StockCounterpartyField form={form} personnelList={personnelList} suppliersList={suppliersList} />

        <div>
          <label className="block text-xs font-bold mb-1.5 text-slate-700 flex items-center gap-1">
            <Building2 size={13} className="text-slate-500" />
            <span>{actionType === 'in' ? 'انبار مقصد (ورود)' : 'انبار مبدا (خروج)'}</span>
          </label>
          {warehouses.length > 0 ? (
            <select 
              className="w-full border border-slate-200 bg-slate-50/50 rounded-xl text-sm px-3 py-2 font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all" 
              value={location} 
              onChange={e => setLocation(e.target.value)}
            >
              {warehouses.map(w => (
                <option key={w.code} value={w.code}>
                  📦 {w.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 p-2.5 rounded-xl font-medium">
              ⚠️ هیچ انباری تعریف نشده است (تنظیمات &gt; مدیریت انبارها)
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-bold mb-1.5 text-slate-700 flex items-center gap-1">
            <Calendar size={13} className="text-slate-500" />
            <span>تاریخ سند</span>
          </label>
          <DatePicker 
            value={date} 
            onChange={(dateObj) => setDate(extractDateString(dateObj))} 
            calendar={persian} 
            locale={persian_fa} 
            calendarPosition="bottom-right"
            inputClass="w-full border border-slate-200 bg-slate-50/50 rounded-xl text-sm px-3 py-2 font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500" 
            containerClassName="w-full"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-bold mb-1.5 text-slate-700 flex items-center gap-1">
            <UserCheck size={13} className="text-slate-500" />
            <span>کاربر صادرکننده</span>
          </label>
          <div className="w-full border border-slate-200 rounded-xl bg-slate-100 text-sm px-3 py-2 font-bold text-slate-800 flex items-center justify-between shadow-2xs">
            <span>{currentUser.full_name || currentUser.username}</span>
            <span className="text-[10px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded font-mono">فعال</span>
          </div>
        </div>

        <div className="md:col-span-2">
          <label className="block text-xs font-bold mb-1.5 text-slate-700">توضیحات و ملاحظات</label>
          <input 
            type="text" 
            value={notes} 
            onChange={e => setNotes(e.target.value)} 
            placeholder="توضیحات تکمیلی سند، بابت خرید یا حواله مصرف..." 
            className="w-full border border-slate-200 bg-slate-50/50 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all" 
          />
        </div>
      </div>
    </>
  );
}
