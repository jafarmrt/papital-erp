import React, { useState } from 'react';
import { Paperclip, Image as ImageIcon } from 'lucide-react';
import { FinancialAttachment } from '../../types';
import { FinancialAttachmentViewerModal } from './FinancialAttachmentViewerModal';

interface Props {
  attachments?: FinancialAttachment[] | null;
  compact?: boolean;
}

export const FinancialAttachmentBadge: React.FC<Props> = ({ attachments, compact = false }) => {
  const [selectedAtt, setSelectedAtt] = useState<FinancialAttachment | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  const safeList = Array.isArray(attachments) ? attachments.filter(a => a && a.url) : [];
  if (safeList.length === 0) return null;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (safeList.length === 1) {
      setSelectedAtt(safeList[0]);
    } else {
      setShowPicker(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={`inline-flex items-center gap-1 rounded-lg font-bold transition-all ${
          compact
            ? 'px-1.5 py-0.5 text-[10px] bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200'
            : 'px-2 py-1 text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 shadow-xs'
        }`}
        title={`${safeList.length} سند ضمیمه شده - کلیک برای مشاهده`}
      >
        <Paperclip size={compact ? 11 : 13} className="text-blue-600" />
        <span>{safeList.length} ضمیمه</span>
      </button>

      {/* Multiple attachments picker popup */}
      {showPicker && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in"
          onClick={() => setShowPicker(false)}
        >
          <div 
            className="bg-white rounded-2xl shadow-xl max-w-md w-full p-4 border border-slate-200 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h4 className="font-bold text-sm text-slate-800 flex items-center gap-2">
                <Paperclip size={16} className="text-blue-600" />
                <span>اسناد و ضمائم ثبت ({safeList.length})</span>
              </h4>
              <button 
                type="button"
                onClick={() => setShowPicker(false)}
                className="text-xs text-slate-400 hover:text-slate-600 font-bold"
              >
                بستن
              </button>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto">
              {safeList.map((att, idx) => (
                <div
                  key={att.id || idx}
                  onClick={() => {
                    setShowPicker(false);
                    setSelectedAtt(att);
                  }}
                  className="flex items-center gap-3 p-2.5 rounded-xl border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 cursor-pointer transition-all"
                >
                  <div className="w-10 h-10 rounded-lg bg-slate-100 overflow-hidden flex items-center justify-center shrink-0 border border-slate-200">
                    {att.url?.startsWith('data:image/') || /\.(jpg|jpeg|png|webp|gif)$/i.test(att.name || '') ? (
                      <img src={att.url} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <ImageIcon size={18} className="text-blue-600" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-xs text-slate-800 truncate">{att.title || att.name}</div>
                    <div className="text-[10px] text-slate-400 truncate">{att.name}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {selectedAtt && (
        <FinancialAttachmentViewerModal
          attachment={selectedAtt}
          onClose={() => setSelectedAtt(null)}
        />
      )}
    </>
  );
};
