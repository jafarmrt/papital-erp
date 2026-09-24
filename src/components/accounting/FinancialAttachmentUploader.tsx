import React, { useState } from 'react';
import { Paperclip } from 'lucide-react';
import { FinancialAttachment } from '../../types';
import { ModernPersianDropzone } from '../common/ModernPersianDropzone';
import { FinancialAttachmentViewerModal } from './FinancialAttachmentViewerModal';

interface Props {
  attachments: FinancialAttachment[];
  onChange: (attachments: FinancialAttachment[]) => void;
  readOnly?: boolean;
  title?: string;
  helperText?: string;
  description?: string;
  maxFiles?: number;
  accept?: string;
}

/**
 * کامپوننت ارتقایافته مدیریت پیوست‌ها و اسناد مثبته مالی
 * اکنون با بهره‌گیری از ModernPersianDropzone (وایب‌فارسی - فاز ۴):
 * - پشتیبانی از درگ‌اند‌دراپ واقعی با فیدبک بصری
 * - پشتیبانی از Paste مستقیم از کلیپ‌بورد (Ctrl+V) برای اسکرین‌شات رسیدها و چک‌ها
 * - فشرده‌سازی خودکار و بهینه‌سازی کلاینت‌ساید تصاویر (سقف ۳۰۰KB)
 * - پیش‌نمایش تمام‌صفحه لایت‌باکس با متادیتا و دانلود
 */
export const FinancialAttachmentUploader: React.FC<Props> = ({
  attachments = [],
  onChange,
  readOnly = false,
  title = 'ضمائم و اسناد مثبته (تصویر فاکتور، رسید بانکی، تصویر چک)',
  helperText,
  description,
  maxFiles = 10,
  accept = 'image/*,application/pdf,.xlsx,.xls,.csv,.doc,.docx,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel',
}) => {
  const [previewItem, setPreviewItem] = useState<FinancialAttachment | null>(null);

  return (
    <div className="space-y-3 bg-slate-50/70 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700 rounded-2xl p-4 transition-all">
      {/* Top Header with Badge */}
      <div className="flex items-center gap-2 mb-1">
        <div className="w-8 h-8 rounded-xl bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 flex items-center justify-center shrink-0">
          <Paperclip size={16} />
        </div>
        <div>
          <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">{title}</h4>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {description || helperText || 'تصاویر به صورت خودکار بهینه‌سازی و فشرده می‌شوند (حداکثر ۳۰۰KB). امکان درج با Ctrl+V نیز فراهم است.'}
          </p>
        </div>
      </div>

      {/* Modern Persian Dropzone */}
      <ModernPersianDropzone
        attachments={attachments}
        onChange={onChange}
        onPreview={(att) => setPreviewItem(att)}
        readOnly={readOnly}
        maxFiles={maxFiles}
        accept={accept}
        autoCompressImages={true}
      />

      {/* Lightbox / Preview Modal */}
      {previewItem && (
        <FinancialAttachmentViewerModal
          attachment={previewItem}
          attachments={attachments}
          isOpen={true}
          onClose={() => setPreviewItem(null)}
        />
      )}
    </div>
  );
};
export default FinancialAttachmentUploader;
