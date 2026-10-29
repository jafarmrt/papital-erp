import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Paperclip, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { fetchJson } from '../../api';
import { MAX_ATTACHMENT_FILE_MB } from '../../lib/attachments/attachmentBodyLimit';
import { recordAttachmentRefusal, recordAttachmentRuleText, type RecordAttachmentEntity, type RecordAttachmentState } from '../../lib/attachments/recordAttachments';
import { QUERY_KEYS } from '../../lib/queryKeys';
import type { FinancialAttachment } from '../../types';
import { errorMessageOf, formatPersianDateTime, formatPersianNumber } from '../../utils';
import { compressTo300KB } from '../../utils/imageCompression';
import { confirmAction } from '../ConfirmDialogHost';
import { FinancialAttachmentViewerModal } from '../accounting/FinancialAttachmentViewerModal';
import { Modal } from '../common/Modal';

/**
 * v11 «افزودن پیوست» (owner's decision 7 Aban 1405): the files of one recorded document, treasury row, cheque or voucher,
 * added one at a time after the record is saved. Before approval a file is added or removed; after approval only added;
 * in a closed fiscal year only seen (rule in `src/lib/attachments/recordAttachments.ts`, the server's too). `canWrite` is
 * the user's key for that kind of record; without it the window only shows the files.
 */

interface Props {
  entityType: RecordAttachmentEntity;
  entityId: number;
  title: string;
  canWrite: boolean;
  onClose: () => void;
}

/** The lists that show the record's number of files, read again after a change. */
const LIST_KEYS: Record<RecordAttachmentEntity, ReadonlyArray<readonly unknown[]>> = {
  treasury_transaction: [QUERY_KEYS.accounting.treasuryTransactions()],
  cheque: [QUERY_KEYS.accounting.cheques()],
  journal_voucher: [QUERY_KEYS.accounting.vouchers(), ['accounting', 'voucher-detail']],
  document: [QUERY_KEYS.documents.all],
};

const readAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result ?? ''));
  reader.onerror = () => reject(reader.error ?? new Error('read failed'));
  reader.readAsDataURL(file);
});

export function RecordAttachmentsWindow({ entityType, entityId, title, canWrite, onClose }: Props) {
  const queryClient = useQueryClient();
  const key = QUERY_KEYS.recordAttachments.detail(entityType, entityId);
  const url = `/record-attachments/${entityType}/${entityId}`;
  const { data, isLoading, error } = useQuery<RecordAttachmentState>({
    queryKey: key,
    queryFn: ({ signal }) => fetchJson<RecordAttachmentState>(url, { signal }),
    staleTime: 0,
  });
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<FinancialAttachment | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const files = data?.attachments ?? [];
  const canAdd = canWrite && !!data && recordAttachmentRefusal(data, 'add') === null;
  const canRemove = canWrite && !!data && recordAttachmentRefusal(data, 'remove') === null;

  const changed = async () => {
    await Promise.all([key, ...LIST_KEYS[entityType]].map(queryKey => queryClient.invalidateQueries({ queryKey: [...queryKey] })));
  };

  const add = async (picked: File[]) => {
    if (picked.length === 0) return;
    setBusy(true);
    let added = 0;
    try {
      for (const file of picked) {
        if (file.size > MAX_ATTACHMENT_FILE_MB * 1024 * 1024) {
          toast.error(`فایل «${file.name}» بیش از ${formatPersianNumber(MAX_ATTACHMENT_FILE_MB)} مگابایت است.`);
          continue;
        }
        try {
          const isImage = file.type.startsWith('image/') && file.type !== 'image/svg+xml';
          const dataUrl = isImage ? await compressTo300KB(file) : await readAsDataUrl(file);
          await fetchJson(url, { method: 'POST', body: JSON.stringify({ name: file.name || 'attachment', dataUrl }) });
          added++;
        } catch (err) {
          toast.error(`«${file.name}» افزوده نشد: ${errorMessageOf(err) || 'خطا'}`);
        }
      }
      if (added > 0) toast.success(`${formatPersianNumber(added)} پیوست افزوده شد.`);
    } finally {
      setBusy(false);
      await changed();
    }
  };

  const remove = async (file: FinancialAttachment) => {
    if (!(await confirmAction({ title: 'برداشتن پیوست', message: `پیوست «${file.title || file.name}» از این سند برداشته شود؟` }))) return;
    setBusy(true);
    try {
      await fetchJson(`${url}/${encodeURIComponent(file.id)}`, { method: 'DELETE' });
      toast.success('پیوست برداشته شد.');
    } catch (err) {
      toast.error(errorMessageOf(err) || 'پیوست برداشته نشد.');
    } finally {
      setBusy(false);
      await changed();
    }
  };

  return (
    <Modal isOpen onClose={onClose} closeDisabled={busy} size="lg" title={title} icon={<Paperclip size={18} />}>
      <div className="space-y-3 text-xs text-slate-700 dark:text-slate-200">
        {isLoading && <p>در حال خواندن پیوست‌ها…</p>}
        {error && <p role="alert" className="font-bold text-rose-600">{errorMessageOf(error) || 'پیوست‌ها خوانده نشد.'}</p>}
        {data && (
          <>
            <p className="text-slate-500 dark:text-slate-400">{recordAttachmentRuleText(data)}</p>
            {files.length === 0 ? (
              <p className="text-slate-500 dark:text-slate-400">این سند هنوز پیوستی ندارد.</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
                {files.map(file => (
                  <li key={file.id} className="flex items-center gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-bold">{file.title || file.name}</div>
                      <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                        {[file.uploadedBy, file.uploadedAt ? formatPersianDateTime(file.uploadedAt) : ''].filter(Boolean).join(' — ') || file.name}
                      </div>
                    </div>
                    <button type="button" aria-label={`دیدن ${file.name}`} title="دیدن" onClick={() => setViewing(file)}
                      className="rounded-lg p-1.5 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-950/40">
                      <Eye size={15} />
                    </button>
                    {canRemove && (
                      <button type="button" aria-label={`برداشتن ${file.name}`} title="برداشتن" disabled={busy} onClick={() => { void remove(file); }}
                        className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:hover:bg-rose-950/40">
                        <Trash2 size={15} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canAdd && (
              <div>
                <input ref={input} type="file" multiple hidden aria-label="فایل‌های پیوست"
                  accept="image/*,application/pdf,.xlsx,.xls,.csv,.doc,.docx,.txt"
                  onChange={e => { const picked = Array.from(e.target.files ?? []); e.target.value = ''; void add(picked); }} />
                <button type="button" disabled={busy} onClick={() => input.current?.click()}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 font-bold text-white hover:bg-indigo-700 disabled:opacity-50">
                  {busy ? 'در حال فرستادن…' : 'افزودن پیوست'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
      {viewing && <FinancialAttachmentViewerModal attachment={viewing} onClose={() => setViewing(null)} />}
    </Modal>
  );
}
