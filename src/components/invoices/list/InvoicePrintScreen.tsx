import { Printer } from 'lucide-react';
import InvoicePrintView from '../../InvoicePrintView';
import type { InvoiceListDocument } from '../../../lib/invoices/invoiceListDocuments';

/** TD-080 (بخش ۳): نمای چاپ سند / فاکتور از لیست اسناد */
export function InvoicePrintScreen({ printedDoc, setPrintedDoc }: { printedDoc: InvoiceListDocument; setPrintedDoc: (doc: InvoiceListDocument | null) => void }) {
  return (
    <div className="space-y-6">
      <div className="flex gap-4 mb-4 print:hidden">
        <button 
          onClick={() => window.print()} 
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl flex items-center gap-2 font-bold cursor-pointer shadow-sm transition-colors"
        >
          <Printer size={18} /> چاپ سند / فاکتور (A4)
        </button>
        <button 
          onClick={() => setPrintedDoc(null)} 
          className="border border-slate-300 bg-white px-4 py-2 rounded-xl hover:bg-slate-50 font-medium cursor-pointer shadow-2xs transition-colors"
        >
          بازگشت به لیست اسناد
        </button>
      </div>

      <InvoicePrintView printedDoc={printedDoc} />
    </div>
  );
}
