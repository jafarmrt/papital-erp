import { useCallback, useEffect, useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
import { CRM_ACTIVITY_PAGE_QUERY_KEY } from '../../lib/crm/crmListPages';
import { CRM_FOLLOWUPS_QUERY_KEY } from '../../lib/crm/crmFollowupsQuery';
import { CRM_LEAD_DETAIL_KEY, crmAttachmentsKey, useCrmAttachmentsQuery } from '../../hooks/queries/useCrmQueries';
import { useOpeningRead } from '../../hooks/queries/readOnEveryOpening';
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
  /** files the parent already read (the sales file detail, an activity row): shown at once while the panel reads them again */
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
 * 10.3 (ARCH review finding 3, part 12): the list is read through the shared cache, again each time the box opens (it
 * mounts with its window or drawer), never what an earlier opening left there; a file sent or removed updates that list
 * and refreshes the sales file detail and the activity lists that count files. A failed refresh keeps the list on screen.
 */
export function CrmAttachmentsPanel({ owner, ownerId, initial, onBusyChange, onCountChange }: CrmAttachmentsPanelProps) {
  const canManage = useHasPermission('crm.manage');
  const online = useOnlineStatus();
  const inputId = useId();
  const queryClient = useQueryClient();
  const read = useOpeningRead(useCrmAttachmentsQuery(owner, ownerId), true);
  // v10.2 package 7 review (N-5): files the parent already has are shown (and counted) at once; the panel still reads
  // the current list, so a file added since the parent's read is never missing
  const fetched = read.data !== undefined;
  const files = read.data ?? initial ?? [];
  const loading = !fetched && !initial && !read.error;
  const loadError = read.error ? errorMessageOf(read.error) || 'فهرست پیوست‌ها دریافت نشد.' : null;
  const [busy, setBusy] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  const setBusyState = useCallback((value: string | null) => {
    setBusy(value);
    onBusyChange?.(value !== null);
  }, [onBusyChange]);

  /**
   * the box's list changed by a send or a removal: a read of the list already on its way (another sales write refreshes
   * every sales read) may predate the change, so it is dropped first
   */
  const setFiles = async (change: (prev: CrmAttachmentView[]) => CrmAttachmentView[]) => {
    await queryClient.cancelQueries({ queryKey: crmAttachmentsKey(owner, ownerId) });
    queryClient.setQueryData<CrmAttachmentView[]>(crmAttachmentsKey(owner, ownerId), (prev) => change(prev ?? []));
  };
  /** after the sends or a removal: the box's list as the server holds it now, the file detail and the lists that count files */
  const refreshCounts = () => {
    for (const queryKey of [crmAttachmentsKey(owner, ownerId), CRM_LEAD_DETAIL_KEY, CRM_ACTIVITY_PAGE_QUERY_KEY, CRM_FOLLOWUPS_QUERY_KEY]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  };

  // the count goes to the parent only once it is known, so a badge never drops to zero while the list loads
  const countKnown = fetched || Boolean(initial);
  useEffect(() => {
    if (countKnown) onCountChange?.(files.length);
  }, [countKnown, files.length, onCountChange]);

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
        // a list read answered after the server stored the file already holds it
        await setFiles((prev) => (prev.some((f) => f.id === res.data.id) ? prev : [...prev, res.data]));
      } catch (err) {
        setPickError(`«${file.name}»: ${errorMessageOf(err)}`);
        break;
      }
    }
    setBusyState(null);
    refreshCounts();
  };

  const remove = async (file: CrmAttachmentView) => {
    if (!(await confirmAction({ title: 'حذف پیوست', message: `پیوست «${file.name}» حذف شود؟`, confirmText: 'حذف', cancelText: 'انصراف' }))) return;
    setBusyState('در حال حذف');
    try {
      await fetchJson(`${crmAttachmentsPath(owner, ownerId)}/${file.id}`, { method: 'DELETE' });
      await setFiles((prev) => prev.filter((f) => f.id !== file.id));
      refreshCounts();
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
  const blocked = busy !== null || !fetched;
  return (
    <section className="space-y-2" aria-busy={loading || busy !== null} data-testid={`crm-attachments-${owner}-${ownerId}`}>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-black text-slate-700 flex items-center gap-1">
          <Paperclip size={14} /> پیوست‌ها ({formatPersianNumber(files.length)} از {formatPersianNumber(CRM_ATTACHMENT_MAX_FILES)})
        </h4>
        {canManage && (
          <>
            <label htmlFor={inputId} title={!online ? OFFLINE_SUBMIT_TITLE : full ? 'سقف پیوست‌ها پر است' : undefined}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border ${blocked || !online || full ? 'opacity-50 pointer-events-none border-slate-200 text-slate-400' : 'cursor-pointer border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100'}`}>
              افزودن عکس یا PDF
            </label>
            <input id={inputId} type="file" multiple accept={CRM_ATTACHMENT_ACCEPT} className="sr-only"
              disabled={blocked || !online || full}
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
      {loadError && <p className="text-xs text-rose-600" role="alert">{loadError}</p>}
      {loading ? (
        <p className="text-xs text-slate-500 flex items-center gap-1" role="status"><Loader2 size={12} className="animate-spin" /> در حال دریافت پیوست‌ها…</p>
      ) : loadError && !fetched ? null : files.length === 0 ? (
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
                  <button type="button" onClick={() => void remove(file)} disabled={blocked || !online} aria-label={`حذف ${file.name}`} title="حذف"
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
