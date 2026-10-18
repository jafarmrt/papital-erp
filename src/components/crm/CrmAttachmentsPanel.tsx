import { useCallback, useEffect, useId, useState } from 'react';
import { Download, FileText, Loader2, Paperclip, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { API_URL, fetchJson } from '../../api';
import { useHasPermission } from '../../contexts/AuthContext';
import { AttachmentImage } from '../attachments/AttachmentImage';
import { confirmAction } from '../ConfirmDialogHost';
import { downloadAttachment } from '../../lib/attachments/attachmentDisplay';
import { sendRawFile } from '../../lib/media/mediaUpload';
import { useOnlineStatus } from '../../lib/pwa/useOnlineStatus';
import { OFFLINE_SUBMIT_TITLE } from '../../lib/pwa/phoneLayout';
import { formatPersianNumber } from '../../utils/persianNumber';
import { errorMessageOf } from '../../utils';
import {
  CRM_ATTACHMENT_ACCEPT,
  CRM_ATTACHMENT_FORMAT_TEXT,
  CRM_ATTACHMENT_MAX_FILES,
  crmAttachmentPickError,
  crmAttachmentSizeText,
  crmAttachmentTypeOf,
  crmAttachmentsPath,
  type CrmAttachmentOwner,
  type CrmAttachmentView,
} from '../../lib/crm/crmAttachments';

interface CrmAttachmentsPanelProps {
  owner: CrmAttachmentOwner;
  ownerId: number;
  /** files the parent already read (the sales file detail); the panel reads them itself without it */
  initial?: CrmAttachmentView[];
  /** true while a file is being sent or removed, so the window around it does not close (Esc included) */
  onBusyChange?: (busy: boolean) => void;
  onCountChange?: (count: number) => void;
}

/**
 * v10.2 package 7 (N-02 §3.3, CRM plan decisions ت۶ / ت۷ / ت۸): the attachments of one sales file or activity. Images
 * show their light version and download their original; PDFs show a file card. Holders of `crm.manage` add (JPG, PNG,
 * WEBP or PDF, at most 10 files of 10 MB, checked here with the server's rule before sending) and remove files; the
 * files never enter the media library.
 */
export function CrmAttachmentsPanel({ owner, ownerId, initial, onBusyChange, onCountChange }: CrmAttachmentsPanelProps) {
  const canManage = useHasPermission('crm.manage');
  const online = useOnlineStatus();
  const inputId = useId();
  const [files, setFiles] = useState<CrmAttachmentView[]>(initial ?? []);
  const [loading, setLoading] = useState(!initial);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  const setBusyState = useCallback((value: string | null) => {
    setBusy(value);
    onBusyChange?.(value !== null);
  }, [onBusyChange]);

  useEffect(() => {
    if (initial) {
      setFiles(initial);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    fetchJson<{ data: CrmAttachmentView[] }>(crmAttachmentsPath(owner, ownerId), { signal: controller.signal })
      .then((res) => setFiles(Array.isArray(res?.data) ? res.data : []))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setLoadError(errorMessageOf(err) || 'فهرست پیوست‌ها دریافت نشد.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [owner, ownerId, initial]);

  useEffect(() => {
    onCountChange?.(files.length);
  }, [files.length, onCountChange]);

  const addFiles = async (picked: File[]) => {
    const error = crmAttachmentPickError(picked, files.length);
    setPickError(error);
    if (error || picked.length === 0) return;
    for (const [index, file] of picked.entries()) {
      setBusyState(`در حال ارسال ${formatPersianNumber(index + 1)} از ${formatPersianNumber(picked.length)}`);
      try {
        const type = crmAttachmentTypeOf(file.name, file.type || '');
        if (!type) throw new Error(CRM_ATTACHMENT_FORMAT_TEXT);
        const res = await sendRawFile<{ data: CrmAttachmentView }>({
          method: 'POST', url: `${API_URL}${crmAttachmentsPath(owner, ownerId)}`, body: file, contentType: type, fileName: file.name,
        });
        setFiles((prev) => [...prev, res.data]);
      } catch (err) {
        setPickError(`«${file.name}»: ${errorMessageOf(err)}`);
        break;
      }
    }
    setBusyState(null);
  };

  const remove = async (file: CrmAttachmentView) => {
    if (!(await confirmAction({ title: 'حذف پیوست', message: `پیوست «${file.name}» حذف شود؟`, confirmText: 'حذف', cancelText: 'انصراف' }))) return;
    setBusyState('در حال حذف');
    try {
      await fetchJson(`${crmAttachmentsPath(owner, ownerId)}/${file.id}`, { method: 'DELETE' });
      setFiles((prev) => prev.filter((f) => f.id !== file.id));
      toast.success('پیوست حذف شد');
    } catch (err) {
      toast.error(errorMessageOf(err) || 'حذف پیوست ناموفق بود.');
    } finally {
      setBusyState(null);
    }
  };

  const download = (file: CrmAttachmentView) => {
    downloadAttachment(file.url, file.name).catch((err: unknown) => toast.error(errorMessageOf(err) || 'دریافت پیوست ناموفق بود.'));
  };

  const full = files.length >= CRM_ATTACHMENT_MAX_FILES;
  return (
    <section className="space-y-2" aria-busy={loading || busy !== null} data-testid={`crm-attachments-${owner}-${ownerId}`}>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-black text-slate-700 flex items-center gap-1">
          <Paperclip size={14} /> پیوست‌ها ({formatPersianNumber(files.length)} از {formatPersianNumber(CRM_ATTACHMENT_MAX_FILES)})
        </h4>
        {canManage && (
          <>
            <label htmlFor={inputId} title={!online ? OFFLINE_SUBMIT_TITLE : full ? 'سقف پیوست‌ها پر است' : undefined}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border ${busy || !online || full ? 'opacity-50 pointer-events-none border-slate-200 text-slate-400' : 'cursor-pointer border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100'}`}>
              افزودن عکس یا PDF
            </label>
            <input id={inputId} type="file" multiple accept={CRM_ATTACHMENT_ACCEPT} className="sr-only"
              disabled={busy !== null || !online || full}
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                e.target.value = '';
                void addFiles(picked);
              }} />
          </>
        )}
      </div>
      {busy && <p className="text-xs text-blue-700 flex items-center gap-1" role="status"><Loader2 size={12} className="animate-spin" /> {busy}…</p>}
      {pickError && <p className="text-xs text-rose-600" role="alert">{pickError}</p>}
      {loading ? (
        <p className="text-xs text-slate-500 flex items-center gap-1" role="status"><Loader2 size={12} className="animate-spin" /> در حال دریافت پیوست‌ها…</p>
      ) : loadError ? (
        <p className="text-xs text-rose-600" role="alert">{loadError}</p>
      ) : files.length === 0 ? (
        <p className="text-xs text-slate-400">پیوستی ندارد.</p>
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {files.map((file) => (
            <li key={file.id} className="border border-slate-200 rounded-xl overflow-hidden bg-white">
              <button type="button" onClick={() => download(file)} className="block w-full cursor-pointer" aria-label={`دریافت ${file.name}`}>
                {file.lightUrl ? (
                  <AttachmentImage src={file.lightUrl} alt={file.name} className="w-full h-24 object-cover bg-slate-50" loading="lazy" />
                ) : (
                  <span className="w-full h-24 flex items-center justify-center bg-slate-50 text-rose-500"><FileText size={28} /></span>
                )}
              </button>
              <div className="px-2 py-1.5 flex items-center gap-1">
                <span className="flex-1 min-w-0">
                  <span className="block text-[11px] font-bold text-slate-700 truncate" title={file.name}>{file.name}</span>
                  <span className="block text-[10px] text-slate-400">{crmAttachmentSizeText(file.size)}</span>
                </span>
                <button type="button" onClick={() => download(file)} aria-label={`دریافت ${file.name}`} title="دریافت"
                  className="p-1 rounded-md text-slate-500 hover:text-blue-700 cursor-pointer"><Download size={13} /></button>
                {canManage && (
                  <button type="button" onClick={() => void remove(file)} disabled={busy !== null || !online} aria-label={`حذف ${file.name}`} title="حذف"
                    className="p-1 rounded-md text-slate-500 hover:text-rose-600 cursor-pointer disabled:opacity-40"><Trash2 size={13} /></button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
