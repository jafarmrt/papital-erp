import React, { useState, useEffect, useMemo } from 'react';
import { X, Download, FileText, Calendar, ShieldCheck, ChevronRight, ChevronLeft, FileSpreadsheet } from 'lucide-react';
import { FinancialAttachment } from '../../types';
import { formatPersianDate, formatPersianNumber } from '../../utils';

interface Props {
  attachment?: FinancialAttachment | null;
  attachments?: FinancialAttachment[] | null;
  isOpen?: boolean;
  title?: string;
  onClose: () => void;
}

export const FinancialAttachmentViewerModal: React.FC<Props> = ({
  attachment,
  attachments,
  isOpen,
  title,
  onClose
}) => {
  // Normalize attachment list
  const allAttachments = useMemo(() => {
    if (attachment) return [attachment];
    if (Array.isArray(attachments) && attachments.length > 0) {
      return attachments.filter((att): att is FinancialAttachment => !!att && !!att.url);
    }
    return [];
  }, [attachment, attachments]);

  const [currentIndex, setCurrentIndex] = useState(0);

  // Reset index when modal opens or attachment list changes
  useEffect(() => {
    setCurrentIndex(0);
  }, [attachment, attachments, isOpen]);

  // Don't render if explicitly closed or if there are no attachments
  if (isOpen === false) return null;
  if (allAttachments.length === 0) return null;

  const currentAttachment = allAttachments[currentIndex] || allAttachments[0];
  if (!currentAttachment) return null;

  const isImage =
    currentAttachment.url?.startsWith('data:image/') ||
    currentAttachment.type?.startsWith('image/') ||
    /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(currentAttachment.name || '') ||
    /\.(jpg|jpeg|png|webp|gif|svg)/i.test(currentAttachment.url || '');

  const handleDownload = () => {
    if (!currentAttachment.url) return;
    const link = document.createElement('a');
    link.href = currentAttachment.url;
    link.download = currentAttachment.name || 'financial-document';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : allAttachments.length - 1));
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentIndex((prev) => (prev < allAttachments.length - 1 ? prev + 1 : 0));
  };

  const modalTitle =
    title ||
    currentAttachment.title ||
    currentAttachment.name ||
    'اسناد و مدارک پیوست مالی';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/80 backdrop-blur-xs animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden border border-slate-200 animate-scale-up font-farsi text-right"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-blue-400 shrink-0">
              {isImage ? <ShieldCheck size={18} /> : <FileText size={18} />}
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-sm truncate">{modalTitle}</h3>
              <p className="text-[11px] text-slate-300 truncate">
                {currentAttachment.name || currentAttachment.title || 'سند مالی'}
                {allAttachments.length > 1 && (
                  <span className="mr-2 text-slate-400">
                    ({formatPersianNumber(currentIndex + 1)} از {formatPersianNumber(allAttachments.length)})
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleDownload}
              className="px-3 py-1.5 bg-white/10 hover:bg-white/20 active:bg-white/30 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
              title="دانلود فایل"
            >
              <Download size={14} />
              <span className="hidden sm:inline">دانلود</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition-all cursor-pointer"
              title="بستن"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Body / Viewer */}
        <div className="relative flex-1 overflow-auto bg-slate-950/95 p-4 sm:p-6 flex items-center justify-center min-h-[320px]">
          {/* Previous / Next buttons for multi-attachment */}
          {allAttachments.length > 1 && (
            <>
              <button
                type="button"
                onClick={handlePrev}
                className="absolute right-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-slate-800/80 hover:bg-slate-700 text-white flex items-center justify-center transition-all shadow-lg border border-white/10 cursor-pointer"
                title="پیوست قبلی"
              >
                <ChevronRight size={22} />
              </button>
              <button
                type="button"
                onClick={handleNext}
                className="absolute left-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-slate-800/80 hover:bg-slate-700 text-white flex items-center justify-center transition-all shadow-lg border border-white/10 cursor-pointer"
                title="پیوست بعدی"
              >
                <ChevronLeft size={22} />
              </button>
            </>
          )}

          {isImage ? (
            <div className="max-w-full max-h-[68vh] flex items-center justify-center">
              <img
                src={currentAttachment.url}
                alt={currentAttachment.title || currentAttachment.name || 'پیوست'}
                className="max-w-full max-h-[68vh] object-contain rounded-lg shadow-2xl border border-white/10"
                referrerPolicy="no-referrer"
              />
            </div>
          ) : (
            <div className="w-full h-[60vh] flex flex-col items-center justify-center bg-slate-900 rounded-xl p-6 text-slate-300 gap-4">
              {/\.(xlsx|xls|csv)$/i.test(currentAttachment.name || '') || currentAttachment.type?.includes('spreadsheet') || currentAttachment.type?.includes('excel') || currentAttachment.type?.includes('csv') ? (
                <FileSpreadsheet size={64} className="text-emerald-500" />
              ) : (
                <FileText size={64} className="text-amber-500" />
              )}
              <div className="text-center space-y-1">
                <div className="font-bold text-base text-white">
                  {currentAttachment.title || currentAttachment.name}
                </div>
                <p className="text-xs text-slate-400">
                  {/\.(xlsx|xls|csv)$/i.test(currentAttachment.name || '') ? 'فایل اکسل / لیست سفارش مشتری' : 'سند غیرتصویری یا فایل ضمیمه'}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleDownload}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer"
                >
                  <Download size={15} />
                  <span>دانلود و مشاهده فایل</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Thumbnail Gallery Strip (if > 1 attachments) */}
        {allAttachments.length > 1 && (
          <div className="px-4 py-2.5 bg-slate-900 border-t border-slate-800 flex items-center gap-2 overflow-x-auto">
            {allAttachments.map((att, idx) => {
              const isSelected = idx === currentIndex;
              const isAttImage =
                att.url?.startsWith('data:image/') ||
                att.type?.startsWith('image/') ||
                /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(att.name || '');

              return (
                <button
                  key={`thumb-${idx}-${att.id || att.name}`}
                  type="button"
                  onClick={() => setCurrentIndex(idx)}
                  className={`relative shrink-0 w-12 h-12 rounded-lg overflow-hidden border-2 transition-all cursor-pointer ${
                    isSelected ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-slate-700 opacity-60 hover:opacity-100'
                  }`}
                  title={att.title || att.name || `پیوست ${idx + 1}`}
                >
                  {isAttImage ? (
                    <img
                      src={att.url}
                      alt=""
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-full h-full bg-slate-800 flex items-center justify-center text-slate-400">
                      <FileText size={18} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Modal Footer / Metadata */}
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 shrink-0">
          <div className="flex items-center gap-4 flex-wrap">
            {currentAttachment.uploadedAt && (
              <span className="flex items-center gap-1">
                <Calendar size={13} className="text-slate-400" />
                <span>تاریخ بارگذاری: {formatPersianDate(currentAttachment.uploadedAt)}</span>
              </span>
            )}
            {currentAttachment.size && (
              <span>حجم: {(currentAttachment.size / 1024).toFixed(1)} کیلوبایت</span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl font-bold transition-all cursor-pointer"
          >
            بستن
          </button>
        </div>
      </div>
    </div>
  );
};
