import { useState, type ReactNode } from 'react';
import { ArrowLeftRight, ClipboardCheck, Printer, RefreshCw, X, type LucideIcon } from 'lucide-react';
import { TransferDocumentPrint } from './TransferDocumentPrint';
import { formatPersianDate } from '../../utils';
import type { InventoryDocumentDetail } from '../../hooks/inventoryAudit/useInventoryAuditQueries';

/** مودال‌های جزئیات سند انبارگردانی و حواله انتقال صفحه انبارگردانی (قاب مشترک + محتوای هر سند) */

interface ShellProps {
  title: string;
  icon: LucideIcon;
  maxWidthClass: string;
  loading: boolean;
  loadingText: string;
  onClose: () => void;
  children: ReactNode;
  footerActions?: ReactNode;
}

function DocumentDetailShell({ title, icon: Icon, maxWidthClass, loading, loadingText, onClose, children, footerActions }: ShellProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in" style={{ direction: 'rtl' }}>
      <div className={`w-full ${maxWidthClass} bg-white rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden border border-slate-200`}>
        <div className="flex items-center justify-between p-5 border-b bg-slate-50">
          <div className="flex items-center gap-3">
            <Icon className="text-blue-600" size={22} />
            <h3 className="font-bold text-slate-800 text-lg">{title}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-200 text-slate-400 hover:text-slate-600 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-slate-500">
              <RefreshCw className="animate-spin text-blue-600" size={32} />
              <span>{loadingText}</span>
            </div>
          ) : children}
        </div>

        <div className="p-4 border-t bg-slate-50 flex justify-end gap-2">
          {footerActions}
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 text-slate-700 hover:bg-slate-300 rounded-xl font-medium text-xs transition-colors"
          >
            بستن
          </button>
        </div>
      </div>
    </div>
  );
}

interface DetailModalProps {
  doc: InventoryDocumentDetail | null;
  loading: boolean;
  onClose: () => void;
}

const refOf = (doc: InventoryDocumentDetail) => doc.ref_number || doc.refNumber;

function VarianceBadge({ variance }: { variance: number }) {
  if (variance === 0) {
    return (
      <span className="text-xs bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full">
        ✓ منطبق
      </span>
    );
  }
  if (variance > 0) {
    return (
      <span className="text-xs bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded-full font-mono">
        +{variance} اضافی
      </span>
    );
  }
  return (
    <span className="text-xs bg-rose-100 text-rose-800 font-bold px-2 py-0.5 rounded-full font-mono">
      {variance} کسری
    </span>
  );
}

export function AuditDocumentDetailModal({ doc, loading, onClose }: DetailModalProps) {
  return (
    <DocumentDetailShell
      title={`جزئیات سند انبارگردانی ${doc ? `شماره ${refOf(doc)}` : ''}`}
      icon={ClipboardCheck}
      maxWidthClass="max-w-4xl"
      loading={loading}
      loadingText="در حال دریافت اطلاعات..."
      onClose={onClose}
    >
      {doc ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100 text-xs">
            <div>
              <span className="text-slate-500 block mb-1">شماره سند:</span>
              <strong className="text-slate-800 font-mono text-sm">{refOf(doc)}</strong>
            </div>
            <div>
              <span className="text-slate-500 block mb-1">تاریخ ثبت:</span>
              <strong className="text-slate-800 font-mono">{formatPersianDate(doc.date)}</strong>
            </div>
            <div>
              <span className="text-slate-500 block mb-1">موقعیت انبار:</span>
              <strong className="text-blue-700 font-bold">{doc.location || 'اصلی'}</strong>
            </div>
            <div>
              <span className="text-slate-500 block mb-1">ثبت‌کننده:</span>
              <strong className="text-slate-800">{doc.user || '-'}</strong>
            </div>
          </div>

          <div className="border rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-xs text-right">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="p-3 text-slate-600">ردیف</th>
                  <th className="p-3 text-slate-600">کد کالا</th>
                  <th className="p-3 text-slate-600">نام کالا</th>
                  <th className="p-3 text-center text-slate-600">موجودی سیستم</th>
                  <th className="p-3 text-center text-slate-600">موجودی فیزیکی</th>
                  <th className="p-3 text-center text-slate-600">مغایرت</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {doc.items?.map((line, idx) => {
                  const variance = Number(line.variance || (Number(line.quantity) - Number(line.system_stock || 0)));
                  return (
                    <tr key={idx} className="hover:bg-slate-50/50">
                      <td className="p-3 text-slate-500">{idx + 1}</td>
                      <td className="p-3 text-slate-600 font-mono">{line.code}</td>
                      <td className="p-3 text-slate-800 font-medium">{line.name}</td>
                      <td className="p-3 text-center text-slate-600 font-mono">{line.system_stock} {line.unit}</td>
                      <td className="p-3 text-center text-slate-800 font-mono font-bold">{line.quantity} {line.unit}</td>
                      <td className="p-3 text-center">
                        <VarianceBadge variance={variance} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </DocumentDetailShell>
  );
}

export function TransferDocumentDetailModal({ doc, loading, onClose }: DetailModalProps) {
  // v9.0.67 (TD-489): حواله انتقال سند است؛ مبدأ و مقصد از ردیف‌های کاردکس همان سند و چاپ با قالب یکدست اسناد
  const [printing, setPrinting] = useState(false);
  return (
    <DocumentDetailShell
      title={`جزئیات حواله انتقال ${doc ? `شماره ${refOf(doc)}` : ''}`}
      icon={ArrowLeftRight}
      maxWidthClass="max-w-3xl"
      loading={loading}
      loadingText="در حال بارگذاری اطلاعات حواله..."
      onClose={onClose}
      footerActions={doc ? (
        <button
          onClick={() => setPrinting(true)}
          className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-xl font-medium text-xs transition-colors inline-flex items-center gap-1.5"
        >
          <Printer size={14} />
          چاپ حواله
        </button>
      ) : null}
    >
      {doc ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100 text-xs">
            <div>
              <span className="text-slate-500 block mb-1">شماره حواله:</span>
              <strong className="text-slate-800 font-mono text-sm">{refOf(doc)}</strong>
            </div>
            <div>
              <span className="text-slate-500 block mb-1">تاریخ انتقال:</span>
              <strong className="text-slate-800 font-mono">{formatPersianDate(doc.date)}</strong>
            </div>
            <div>
              <span className="text-slate-500 block mb-1">صادرکننده:</span>
              <strong className="text-slate-800">{doc.user || '-'}</strong>
            </div>
            <div>
              <span className="text-slate-500 block mb-1">انبار مبدأ:</span>
              <strong className="text-blue-700">{doc.sourceLocation || '-'}</strong>
            </div>
            <div>
              <span className="text-slate-500 block mb-1">انبار مقصد:</span>
              <strong className="text-emerald-700">{doc.destinationLocation || '-'}</strong>
            </div>
            <div>
              <span className="text-slate-500 block mb-1">توضیحات:</span>
              <strong className="text-slate-800">{doc.notes || '-'}</strong>
            </div>
          </div>

          <div className="border rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-xs text-right">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="p-3 text-slate-600">ردیف</th>
                  <th className="p-3 text-slate-600">کد کالا</th>
                  <th className="p-3 text-slate-600">نام کالا</th>
                  <th className="p-3 text-center text-slate-600">مقدار انتقال</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {doc.items?.map((line, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/50">
                    <td className="p-3 text-slate-500">{idx + 1}</td>
                    <td className="p-3 text-slate-600 font-mono">{line.code}</td>
                    <td className="p-3 text-slate-800 font-bold">{line.name}</td>
                    <td className="p-3 text-center text-blue-900 font-mono font-bold">{line.quantity} {line.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TransferDocumentPrint doc={doc} isOpen={printing} onClose={() => setPrinting(false)} />
        </>
      ) : null}
    </DocumentDetailShell>
  );
}
