import React, { useState, useRef } from 'react';
import { Paperclip, Upload, X, Image as ImageIcon, Eye, FileText, Loader2, CheckCircle2, FileSpreadsheet } from 'lucide-react';
import toast from 'react-hot-toast';
import { FinancialAttachment } from '../../types';
import { compressTo300KB } from '../../utils/imageCompression';
import { FinancialAttachmentViewerModal } from './FinancialAttachmentViewerModal';

interface Props {
  attachments: FinancialAttachment[];
  onChange: (attachments: FinancialAttachment[]) => void;
  readOnly?: boolean;
  title?: string;
  helperText?: string;
  maxFiles?: number;
  accept?: string;
}

export const FinancialAttachmentUploader: React.FC<Props> = ({
  attachments = [],
  onChange,
  readOnly = false,
  title = 'ضمائم و اسناد مثبته (تصویر فاکتور، رسید بانکی، تصویر چک)',
  helperText = 'تصاویر به صورت خودکار بهینه‌سازی و فشرده می‌شوند (حداکثر سقف ۳۰۰ کیلوبایت برای هر تصویر).',
  maxFiles = 10,
  accept = 'image/*,application/pdf,.xlsx,.xls,.csv,.doc,.docx,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel',
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [previewItem, setPreviewItem] = useState<FinancialAttachment | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsProcessing(true);
    const newAttachments: FinancialAttachment[] = [...attachments];

    try {
      for (let i = 0; i < files.length; i++) {
        if (newAttachments.length >= maxFiles) break;
        const file = files[i];

        if (file.type.startsWith('image/')) {
          try {
            const compressedBase64 = await compressTo300KB(file);
            newAttachments.push({
              id: 'att_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
              name: file.name,
              title: file.name.replace(/\.[^/.]+$/, ''),
              url: compressedBase64,
              size: file.size,
              type: file.type,
              uploadedAt: new Date().toISOString(),
            });
          } catch (err) {
            console.error('Error compressing image:', err);
          }
        } else {
          // Read any document / order file as Base64 data url
          if (file.size > 15 * 1024 * 1024) {
            toast.error(`حجم فایل «${file.name}» بیش از حد مجاز (حداکثر ۱۵ مگابایت) است.`);
            continue;
          }
          try {
            const reader = new FileReader();
            const dataUrl = await new Promise<string>((resolve, reject) => {
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = () => reject(new Error('File read error'));
              reader.readAsDataURL(file);
            });

            newAttachments.push({
              id: 'att_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
              name: file.name,
              title: file.name.replace(/\.[^/.]+$/, ''),
              url: dataUrl,
              size: file.size,
              type: file.type || 'application/octet-stream',
              uploadedAt: new Date().toISOString(),
            });
          } catch (err) {
            console.error('Error reading attachment file:', err);
            toast.error(`خطا در بارگذاری فایل «${file.name}»`);
          }
        }
      }

      onChange(newAttachments);
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRemove = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(attachments.filter(a => a.id !== id));
  };

  const handleTitleChange = (id: string, newTitle: string) => {
    onChange(
      attachments.map(a => a.id === id ? { ...a, title: newTitle } : a)
    );
  };

  return (
    <div className="space-y-3 bg-slate-50/70 border border-slate-200/80 rounded-2xl p-4 transition-all">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
            <Paperclip size={16} />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-800">{title}</h4>
            <p className="text-[11px] text-slate-500">{helperText}</p>
          </div>
        </div>

        {!readOnly && (
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept={accept}
              multiple
              className="hidden"
              onChange={handleFileSelect}
              disabled={isProcessing || attachments.length >= maxFiles}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing || attachments.length >= maxFiles}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl text-xs font-bold shadow-sm transition-all disabled:opacity-50"
            >
              {isProcessing ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>در حال بهینه‌سازی...</span>
                </>
              ) : (
                <>
                  <Upload size={14} />
                  <span>افزودن سند یا تصویر</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Attachments List / Grid */}
      {attachments.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-2">
          {attachments.map((att) => {
            const isImage = att.url?.startsWith('data:image/') || att.type?.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif)$/i.test(att.name || '');
            const isSpreadsheet = /\.(xlsx|xls|csv)$/i.test(att.name || '') || att.type?.includes('spreadsheet') || att.type?.includes('excel') || att.type?.includes('csv');

            return (
              <div
                key={att.id}
                className="group relative bg-white border border-slate-200 rounded-xl p-2.5 shadow-sm hover:shadow-md hover:border-blue-300 transition-all flex items-center gap-3"
              >
                {/* Thumbnail / Icon */}
                <div 
                  onClick={() => setPreviewItem(att)}
                  className="w-14 h-14 rounded-lg bg-slate-100 border border-slate-200/70 overflow-hidden flex-shrink-0 flex items-center justify-center cursor-pointer relative group/thumb"
                >
                  {isImage ? (
                    <>
                      <img 
                        src={att.url} 
                        alt={att.title || att.name} 
                        className="w-full h-full object-cover" 
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute inset-0 bg-black/30 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center text-white">
                        <Eye size={16} />
                      </div>
                    </>
                  ) : isSpreadsheet ? (
                    <FileSpreadsheet size={24} className="text-emerald-600" />
                  ) : (
                    <FileText size={24} className="text-amber-600" />
                  )}
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  {readOnly ? (
                    <div className="font-bold text-xs text-slate-800 truncate" title={att.title || att.name}>
                      {att.title || att.name}
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={att.title || ''}
                      onChange={(e) => handleTitleChange(att.id, e.target.value)}
                      placeholder="عنوان سند (مثلا: فاکتور خرید)..."
                      className="w-full text-xs font-bold text-slate-800 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 focus:bg-slate-50/50 rounded px-1 py-0.5 outline-none transition-all"
                    />
                  )}
                  <div className="text-[10px] text-slate-400 truncate flex items-center gap-1.5 mt-0.5">
                    <span className="truncate">{att.name}</span>
                    {isImage && <span className="text-emerald-600 font-medium shrink-0 flex items-center gap-0.5"><CheckCircle2 size={10} /> بهینه‌شده</span>}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setPreviewItem(att)}
                    className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    title="مشاهده بزرگنمایی سند"
                  >
                    <Eye size={15} />
                  </button>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={(e) => handleRemove(att.id, e)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                      title="حذف ضمیمه"
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div 
          onClick={() => !readOnly && fileInputRef.current?.click()}
          className={`border border-dashed border-slate-300 rounded-xl p-4 text-center ${!readOnly ? 'cursor-pointer hover:bg-blue-50/30 hover:border-blue-400' : ''} transition-all`}
        >
          <div className="flex flex-col items-center justify-center gap-1 text-slate-400">
            <ImageIcon size={22} className="text-slate-300" />
            <span className="text-xs font-medium text-slate-500">
              {readOnly ? 'هیچ تصویر یا سندی پیوست نشده است.' : 'تصویر فاکتور، رسید بانکی، برگه چک یا سایر مدارک را اینجا اضافه کنید'}
            </span>
          </div>
        </div>
      )}

      {/* Lightbox / Preview Modal */}
      {previewItem && (
        <FinancialAttachmentViewerModal
          attachment={previewItem}
          onClose={() => setPreviewItem(null)}
        />
      )}
    </div>
  );
};
