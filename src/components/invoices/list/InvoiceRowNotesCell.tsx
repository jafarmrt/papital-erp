import { Edit3 } from 'lucide-react';
import type { InvoiceListDocument } from '../../../lib/invoices/invoiceListDocuments';
import type { InvoiceListActions } from '../../../hooks/invoices/useInvoiceListActions';

/** TD-080 (بخش ۳): ستون «توضیحات و یادداشت» با ویرایش درجا */
export function InvoiceRowNotesCell({ doc, actions }: { doc: InvoiceListDocument; actions: InvoiceListActions }) {
  const { editingNotesId, setEditingNotesId, tempNotes, setTempNotes, handleUpdateNotes, startEditingNotes } = actions;
  return (
    <td className="p-3">
      {editingNotesId === doc.id ? (
        <div className="flex items-center gap-2">
          <textarea 
            value={tempNotes} 
            onChange={e => setTempNotes(e.target.value)} 
            className="w-full border border-blue-400 rounded-lg p-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            rows={2}
          />
          <div className="flex flex-col gap-1 shrink-0">
            <button 
              onClick={() => handleUpdateNotes(doc.id)} 
              className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded-lg text-[10px] cursor-pointer font-bold"
            >
              ثبت
            </button>
            <button 
              onClick={() => setEditingNotesId(null)} 
              className="bg-slate-200 hover:bg-slate-300 px-2 py-1 rounded-lg text-[10px] cursor-pointer font-medium"
            >
              لغو
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between group gap-2">
          <span className="text-slate-600 text-[11px] line-clamp-2 leading-relaxed" title={doc.notes}>
            {doc.notes || <span className="text-slate-300">-</span>}
          </span>
          <button 
            onClick={() => startEditingNotes(doc)} 
            className="opacity-0 group-hover:opacity-100 text-blue-600 hover:text-blue-800 p-1 cursor-pointer transition-opacity rounded hover:bg-blue-50 shrink-0"
            title="ویرایش توضیحات"
          >
            <Edit3 size={13} />
          </button>
        </div>
      )}
    </td>
  );
}
