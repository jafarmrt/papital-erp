import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Upload, 
  X, 
  Eye, 
  FileText, 
  Loader2, 
  CheckCircle2, 
  FileSpreadsheet,
  ClipboardPaste,
  ArrowUpCircle
} from 'lucide-react';
import toast from 'react-hot-toast';
import { FinancialAttachment } from '../../types';
import { compressTo300KB } from '../../utils/imageCompression';
import { formatFileSize, formatPersianNumber } from '../../utils';

export interface ModernPersianDropzoneProps {
  attachments: FinancialAttachment[];
  onChange: (attachments: FinancialAttachment[]) => void;
  onPreview?: (attachment: FinancialAttachment) => void;
  readOnly?: boolean;
  title?: string;
  description?: string;
  helperText?: string;
  maxFiles?: number;
  maxSizeMB?: number;
  accept?: string;
  className?: string;
  /** پشتیبانی از فشرده‌سازی خودکار تصاویر (سقف ۳۰۰ کیلوبایت) */
  autoCompressImages?: boolean;
}

/**
 * کامپوننت مدرن، ارگونومیک و بومی درگ‌اند‌دراپ و پیوست اسناد (وایب‌فارسی - فاز ۴)
 * ویژگی‌ها:
 * - کادر Drag & Drop با وضعیت‌های دیداری روان (Hover & DragOver)
 * - پشتیبانی زنده از Paste مستقیم از کلیپ‌بورد (Ctrl+V) هنگام فوکوس روی پنجره/کادر
 * - اتصال به موتور فشرده‌سازی خودکار کلاینت‌ساید تصاویر (سقف ۳۰۰KB)
 * - پشتیبانی از اسناد PDF، اکسل (Excel/CSV) و تصاویر
 * - مدیریت خطاها و سقف حجم فایل‌ها با متن‌های رسا و فارسی
 * - ویرایش عنوان اسناد و پیش‌نمایش سریع
 */
export const ModernPersianDropzone: React.FC<ModernPersianDropzoneProps> = ({
  attachments = [],
  onChange,
  onPreview,
  readOnly = false,
  title = 'پیوست اسناد مثبته و مدارک',
  description,
  helperText,
  maxFiles = 10,
  maxSizeMB = 15,
  accept = 'image/*,application/pdf,.xlsx,.xls,.csv,.doc,.docx,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel',
  className = '',
  autoCompressImages = true
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropzoneRef = useRef<HTMLDivElement>(null);

  const processFiles = useCallback(async (incomingFiles: FileList | File[]) => {
    if (!incomingFiles || incomingFiles.length === 0 || readOnly) return;

    if (attachments.length >= maxFiles) {
      toast.error(`حداکثر سقف مجاز پیوست‌ها (${formatPersianNumber(maxFiles)} عدد) پر شده است.`);
      return;
    }

    setIsProcessing(true);
    const newAttachments: FinancialAttachment[] = [...attachments];
    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    let addedCount = 0;

    try {
      for (let i = 0; i < incomingFiles.length; i++) {
        if (newAttachments.length >= maxFiles) {
          toast.error(`ظرفیت مجاز تکمیل شد؛ تنها ${formatPersianNumber(addedCount)} فایل اضافه شد.`);
          break;
        }

        const file = incomingFiles[i];

        // بررسی سقف حجم فایل
        if (file.size > maxSizeBytes) {
          toast.error(`فایل «${file.name}» بیش از سقف مجاز (${formatPersianNumber(maxSizeMB)} مگابایت) است.`);
          continue;
        }

        const isImage = file.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif)$/i.test(file.name);

        if (isImage && autoCompressImages) {
          try {
            const compressedBase64 = await compressTo300KB(file);
            newAttachments.push({
              id: 'att_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
              name: file.name || 'image-pasted.jpg',
              title: (file.name || 'تصویر رسید').replace(/\.[^/.]+$/, ''),
              url: compressedBase64,
              size: file.size,
              type: file.type || 'image/jpeg',
              uploadedAt: new Date().toISOString(),
            });
            addedCount++;
          } catch (err) {
            console.error('Error compressing image:', err);
            toast.error(`خطا در فشرده‌سازی تصویر «${file.name}»`);
          }
        } else {
          try {
            const reader = new FileReader();
            const dataUrl = await new Promise<string>((resolve, reject) => {
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = () => reject(new Error('File read error'));
              reader.readAsDataURL(file);
            });

            newAttachments.push({
              id: 'att_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
              name: file.name || 'document',
              title: (file.name || 'سند پیوست').replace(/\.[^/.]+$/, ''),
              url: dataUrl,
              size: file.size,
              type: file.type || 'application/octet-stream',
              uploadedAt: new Date().toISOString(),
            });
            addedCount++;
          } catch (err) {
            console.error('Error reading attachment:', err);
            toast.error(`خطا در خواندن فایل «${file.name}»`);
          }
        }
      }

      if (addedCount > 0) {
        onChange(newAttachments);
        toast.success(`${formatPersianNumber(addedCount)} فایل با موفقیت اضافه شد.`);
      }
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [attachments, maxFiles, maxSizeMB, readOnly, autoCompressImages, onChange]);

  // رویدادهای Drag & Drop
  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!readOnly) setIsDragOver(true);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!readOnly && !isDragOver) setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    // جلوگیری از بسته شدن زودرس هنگامی که کرسر روی عناصر داخلی می‌رود
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (readOnly) return;

    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  // شنود رویداد Paste از کلیپ‌بورد (مانند اسکرین‌شات از رسید بانکی)
  useEffect(() => {
    if (readOnly) return;

    const handlePaste = (e: ClipboardEvent) => {
      // اگر کاربر داخل اینپوت متنی مشغول تایپ است، پیست کلیپ‌بورد متنی را مختل نکنیم
      const activeElement = document.activeElement;
      if (
        activeElement &&
        (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA') &&
        (activeElement as HTMLInputElement).type !== 'file'
      ) {
        // اگر تصویر در کلیپ‌بورد بود حتی درون اینپوت هم می‌توان پیست کرد
        const items = e.clipboardData?.items;
        if (!items) return;
        let hasImage = false;
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.indexOf('image') !== -1) {
            hasImage = true;
            break;
          }
        }
        if (!hasImage) return;
      }

      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;

      const pastedFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) {
            pastedFiles.push(file);
          }
        }
      }

      if (pastedFiles.length > 0) {
        e.preventDefault();
        processFiles(pastedFiles);
      }
    };

    const container = dropzoneRef.current;
    if (container) {
      container.addEventListener('paste', handlePaste as any);
    }
    window.addEventListener('paste', handlePaste);

    return () => {
      if (container) {
        container.removeEventListener('paste', handlePaste as any);
      }
      window.removeEventListener('paste', handlePaste);
    };
  }, [readOnly, processFiles]);

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
    <div className={`space-y-3 ${className}`}>
      {/* Header info */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">{title}</h4>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {description || helperText || 'تصاویر به صورت خودکار زیر ۳۰۰KB فشرده می‌شوند. پشتیبانی از Drag & Drop و Paste (Ctrl+V).'}
          </p>
        </div>

        {!readOnly && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[11px] text-slate-400">
              {formatPersianNumber(attachments.length)} از {formatPersianNumber(maxFiles)} فایل
            </span>
          </div>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) processFiles(e.target.files);
        }}
        disabled={isProcessing || attachments.length >= maxFiles || readOnly}
      />

      {/* Dropzone Container */}
      {!readOnly && attachments.length < maxFiles && (
        <div
          ref={dropzoneRef}
          tabIndex={0}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`relative border-2 border-dashed rounded-2xl p-5 text-center transition-all cursor-pointer outline-none focus:ring-2 focus:ring-indigo-500/40 select-none ${
            isDragOver
              ? 'border-indigo-500 bg-indigo-50/80 dark:bg-indigo-950/40 scale-[1.01]'
              : 'border-slate-300 dark:border-slate-600 bg-slate-50/60 dark:bg-slate-800/40 hover:bg-slate-100/70 dark:hover:bg-slate-800/70 hover:border-slate-400'
          }`}
        >
          {isProcessing ? (
            <div className="flex flex-col items-center justify-center gap-2 py-3">
              <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
              <span className="text-xs font-bold text-indigo-900 dark:text-indigo-200">
                در حال پردازش و بهینه‌سازی فایل‌ها...
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2">
              <div className="w-11 h-11 rounded-2xl bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-300 flex items-center justify-center transition-transform group-hover:scale-105">
                {isDragOver ? <ArrowUpCircle size={24} className="animate-bounce" /> : <Upload size={22} />}
              </div>
              <div className="space-y-1 text-center">
                <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  فایل‌ها را به اینجا بکشید یا برای انتخاب <span className="text-indigo-600 dark:text-indigo-400 underline">کلیک کنید</span>
                </p>
                <div className="flex items-center justify-center gap-2 text-[11px] text-slate-400">
                  <span>پشتیبانی از تصویر، PDF و اکسل</span>
                  <span>•</span>
                  <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                    <ClipboardPaste size={12} />
                    امکان Paste مستقیم با Ctrl+V
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Attachments Grid / List */}
      {attachments.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {attachments.map((att) => {
            const isImage =
              att.url?.startsWith('data:image/') ||
              att.type?.startsWith('image/') ||
              /\.(jpg|jpeg|png|webp|gif)$/i.test(att.name || '');
            const isSpreadsheet =
              /\.(xlsx|xls|csv)$/i.test(att.name || '') ||
              att.type?.includes('spreadsheet') ||
              att.type?.includes('excel') ||
              att.type?.includes('csv');

            return (
              <div
                key={att.id}
                className="group relative bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-2.5 shadow-xs hover:shadow-md hover:border-indigo-300 dark:hover:border-indigo-600 transition-all flex items-center gap-3"
              >
                {/* Thumbnail / Icon */}
                <div
                  onClick={() => onPreview && onPreview(att)}
                  className="w-12 h-12 rounded-lg bg-slate-100 dark:bg-slate-700 border border-slate-200/80 dark:border-slate-600 overflow-hidden shrink-0 flex items-center justify-center cursor-pointer relative group/thumb"
                >
                  {isImage ? (
                    <>
                      <img
                        src={att.url}
                        alt={att.title || att.name}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center text-white">
                        <Eye size={16} />
                      </div>
                    </>
                  ) : isSpreadsheet ? (
                    <FileSpreadsheet size={22} className="text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <FileText size={22} className="text-amber-600 dark:text-amber-400" />
                  )}
                </div>

                {/* File Details & Title editing */}
                <div className="flex-1 min-w-0">
                  {readOnly ? (
                    <div className="font-bold text-xs text-slate-800 dark:text-slate-200 truncate" title={att.title || att.name}>
                      {att.title || att.name}
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={att.title || ''}
                      onChange={(e) => handleTitleChange(att.id, e.target.value)}
                      placeholder="عنوان سند..."
                      className="w-full text-xs font-bold text-slate-800 dark:text-slate-200 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-indigo-500 rounded px-1 py-0.5 outline-none transition-all"
                    />
                  )}
                  <div className="text-[10px] text-slate-400 truncate flex items-center gap-1.5 mt-0.5">
                    <span className="truncate">{att.name}</span>
                    <span>•</span>
                    <span dir="ltr">{formatFileSize(att.size)}</span>
                    {isImage && (
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium shrink-0 flex items-center gap-0.5">
                        <CheckCircle2 size={10} /> بهینه‌شده
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  {onPreview && (
                    <button
                      type="button"
                      onClick={() => onPreview(att)}
                      className="p-1.5 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 rounded-lg transition cursor-pointer"
                      title="مشاهده بزرگنمایی"
                    >
                      <Eye size={15} />
                    </button>
                  )}
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={(e) => handleRemove(att.id, e)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition cursor-pointer"
                      title="حذف پیوست"
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
        readOnly && (
          <div className="border border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-4 text-center">
            <p className="text-xs text-slate-400">هیچ پیوستی برای این سند بارگذاری نشده است.</p>
          </div>
        )
      )}
    </div>
  );
};

export default ModernPersianDropzone;
