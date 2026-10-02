import { FileText } from 'lucide-react';
import type { FinancialAttachment } from '../../types';
import { AttachmentImage } from '../attachments/AttachmentImage';
import { attachmentNameOf, attachmentSourceOf, isImageAttachment } from '../../lib/attachments/attachmentDisplay';

interface VoucherAttachmentThumbnailsProps {
  attachments: FinancialAttachment[];
  onOpen: () => void;
}

/**
 * پیش‌نمایش پیوست‌های سند حسابداری در فهرست اسناد (استخراج‌شده از JournalVouchersTab).
 * v7.0.100 (TD-236): فراداده پیوست از v7.0.56 `name` / `url` / `type` دارد؛ پیش‌تر فقط `fileName` / `dataUrl` /
 * `fileType` خوانده می‌شد و هیچ تصویر و نامی نمایش داده نمی‌شد.
 */
export function VoucherAttachmentThumbnails({ attachments, onOpen }: VoucherAttachmentThumbnailsProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2">
      {attachments.map((att) => {
        const name = attachmentNameOf(att);
        return (
          <div
            key={att.id}
            onClick={onOpen}
            className="group relative rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden cursor-pointer hover:border-indigo-500 transition bg-slate-50 dark:bg-slate-800 aspect-4/3 flex flex-col"
          >
            {isImageAttachment(att) ? (
              <AttachmentImage
                src={attachmentSourceOf(att)}
                alt={name}
                className="w-full h-full object-cover group-hover:scale-105 transition"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center p-2 text-slate-500">
                <FileText className="w-6 h-6 text-rose-500 mb-1" />
                <span className="text-[9px] truncate max-w-full">{name}</span>
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 bg-black/60 backdrop-blur-xs text-white p-1 text-[9px] truncate">
              {att.title || name}
            </div>
          </div>
        );
      })}
    </div>
  );
}
