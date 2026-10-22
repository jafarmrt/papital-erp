import React, { useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { ApiError, fetchJson } from '../../api';
import {
  UNMATCHED_ROWS_BLOCK_NOTE, UNMATCHED_ROWS_NOTE, reconcileBlockedByUnmatched, reservationLineChange, reservationLineChangeText,
  reservationReconcileSummary, unmatchedRowLabel,
  type ReservationReconcileLine, type ReservationReconcilePreview, type ReservationReconcileResult, type ReservationReconcileUnmatchedRow,
} from '../../lib/projects/reservationReconcile';
import { PROJECT_VERSION_CONFLICT_MESSAGE } from '../../lib/projects/projectVersion';
import { isPartBehind, type ProjectWriteBase } from '../../lib/projects/projectParts';
import { OFFLINE_SUBMIT_TITLE, PHONE_SHEET_OVERLAY, PHONE_SHEET_PANEL, PHONE_TAP_TARGET } from '../../lib/pwa/phoneLayout';
import { useOnlineStatus } from '../../lib/pwa/useOnlineStatus';
import { errorMessageOf, formatPersianNumber } from '../../utils';
import { DialogLayer } from '../common/DialogLayer';

const CHANGE_TONE: Record<ReturnType<typeof reservationLineChange>, string> = {
  reserve: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  release: 'text-amber-800 bg-amber-50 border-amber-200',
  unchanged: 'text-slate-500 bg-slate-50 border-slate-200',
};

function LineRow({ line }: { line: ReservationReconcileLine }): React.ReactElement {
  const change = reservationLineChange(line);
  return (
    <tr data-reconcile-line={line.itemId} className="border-t border-slate-100">
      <td className="px-2 py-2">
        <div className="font-bold text-slate-800">{line.itemName || line.itemCode}</div>
        {line.itemCode && <div className="text-[10px] text-slate-500">{line.itemCode}</div>}
      </td>
      <td className="px-2 py-2 whitespace-nowrap">{formatPersianNumber(line.requiredQty)} {line.unit}</td>
      <td className="px-2 py-2 whitespace-nowrap">{formatPersianNumber(line.currentQty)}</td>
      <td className="px-2 py-2 whitespace-nowrap font-bold">{formatPersianNumber(line.targetQty)}</td>
      <td className="px-2 py-2">
        <span className={`inline-block px-2 py-0.5 rounded-md border text-[10px] font-bold ${CHANGE_TONE[change]}`}>{reservationLineChangeText(line)}</span>
        {line.shortQty > 0 && <div className="text-[10px] text-rose-600 mt-1">کمبود: {formatPersianNumber(line.shortQty)} {line.unit}</div>}
      </td>
    </tr>
  );
}

/** TD-1341 (M1): ردیف‌های فهرست که به هیچ کالای انبار نمی‌رسند، جدا از جدول کالاها */
function UnmatchedRows({ rows, blocked }: { rows: ReservationReconcileUnmatchedRow[]; blocked: boolean }): React.ReactElement {
  return (
    <div data-reconcile-unmatched className="border border-rose-200 bg-rose-50 rounded-xl p-3 space-y-2">
      <p className="font-bold text-rose-800">ردیف‌هایی که به هیچ کالای انبار نمی‌رسند</p>
      <p className="text-rose-700">{UNMATCHED_ROWS_NOTE}</p>
      {blocked && <p className="text-rose-700 font-bold" role="alert">{UNMATCHED_ROWS_BLOCK_NOTE}</p>}
      <ul className="space-y-1">
        {rows.map((row, idx) => (
          <li key={`${row.section ?? ''}|${row.code}|${row.name}|${idx}`} className="text-slate-700">
            {unmatchedRowLabel(row)}: {formatPersianNumber(row.qty)} {row.unit}{row.section ? ` در «${row.section}»` : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface DialogProps {
  projectId: number;
  /** نسخه و نشانهٔ بخش‌هایی که زبانهٔ مواد از آن ساخته شده؛ بی نسخه ثبت نمی‌شود */
  writeBase: ProjectWriteBase;
  initialPreview: ReservationReconcilePreview;
  onClose: () => void;
  onApplied: (result: ReservationReconcileResult) => void;
}

/**
 * TD-1341 (بستهٔ ۱۲ بند ۱، گزینهٔ ب کارت ت۴۲): پنجرهٔ تأیید «تکمیل رزرو». تغییر هر کالا را پیش از ثبت نشان می‌دهد و فقط همان
 * تغییرها را با نشانهٔ پیش‌نمایش ثبت می‌کند؛ اگر موجودی یا رزروها در این میان عوض شده باشد، فهرست تازه نشان داده می‌شود.
 */
export function ReservationReconcileDialog({ projectId, writeBase, initialPreview, onClose, onApplied }: DialogProps): React.ReactElement {
  const online = useOnlineStatus();
  const [preview, setPreview] = useState(initialPreview);
  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // TD-1342: حواله و تخصیص مواد فقط رزرو را کم می‌کنند و زبانه را کهنه نمی‌کنند؛ کهنه یعنی کنترل موجودی عوض شده
  const staleVersion = isPartBehind(writeBase, 'inventory', { version: preview.version, token: preview.inventoryToken });
  const unmatchedRows = preview.unmatchedRows ?? [];
  const blocked = reconcileBlockedByUnmatched(preview);
  const closeIfIdle = () => { if (!applying) onClose(); };

  const apply = async () => {
    setApplying(true);
    setNotice(null);
    try {
      const result = await fetchJson<ReservationReconcileResult>(`/api/projects/${projectId}/reservation-reconcile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...writeBase, planToken: preview.planToken }),
      });
      onApplied(result);
      toast.success(result.changed ? `رزرو با فهرست مواد برابر شد: ${reservationReconcileSummary(result.preview)}` : 'رزرو از پیش با فهرست مواد برابر بود.');
      onClose();
    } catch (err) {
      const errorCode = err instanceof ApiError ? err.code : undefined;
      const fresh = err instanceof ApiError && errorCode === 'PROJECT_RESERVATION_PLAN_CHANGED' ? (err.details?.preview as ReservationReconcilePreview | undefined) : undefined;
      if (fresh) {
        setPreview(fresh);
        setNotice(errorMessageOf(err));
      } else {
        setNotice(errorCode === 'OCC_CONFLICT' ? (errorMessageOf(err) || PROJECT_VERSION_CONFLICT_MESSAGE) : (errorMessageOf(err) || 'تکمیل رزرو ثبت نشد.'));
      }
    } finally {
      setApplying(false);
    }
  };

  const confirmTitle = !online ? OFFLINE_SUBMIT_TITLE : staleVersion ? PROJECT_VERSION_CONFLICT_MESSAGE : blocked ? UNMATCHED_ROWS_BLOCK_NOTE : undefined;
  return (
    <div className={PHONE_SHEET_OVERLAY} role="dialog" aria-modal="true" aria-label="تکمیل رزرو با فهرست مواد">
      <DialogLayer onClose={closeIfIdle} disabled={applying} />
      <div className={`${PHONE_SHEET_PANEL} bg-white max-w-3xl border border-slate-200 shadow-2xl overflow-hidden text-slate-800`}>
        <div className="px-5 py-3.5 border-b border-slate-200 flex justify-between items-center shrink-0 bg-slate-50/80">
          <h3 className="font-bold text-sm flex items-center gap-2"><RefreshCw size={16} className="text-purple-600" /> تکمیل رزرو با فهرست مواد</h3>
          <button type="button" onClick={closeIfIdle} disabled={applying} aria-label="بستن" className={`px-2 rounded-lg text-slate-500 hover:bg-slate-200 disabled:opacity-40 ${PHONE_TAP_TARGET}`}><X size={18} /></button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto text-xs">
          <p className="font-bold" role="status">{reservationReconcileSummary(preview)}</p>
          <p className="text-slate-500">
            رزرو فعلی پروژه تا نیاز امروز می‌ماند، کمبود فقط از موجودی‌ای که کسی رزرو نکرده پر می‌شود و رزرو بیش از نیاز آزاد می‌شود.
          </p>
          {notice && <p className="text-rose-600 font-bold" role="alert">{notice}</p>}
          {staleVersion && !notice && <p className="text-rose-600 font-bold" role="alert">{PROJECT_VERSION_CONFLICT_MESSAGE}</p>}
          {unmatchedRows.length > 0 && <UnmatchedRows rows={unmatchedRows} blocked={blocked} />}
          {preview.lines.length > 0 && (
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-right">
                <thead className="bg-slate-50 text-slate-600 text-[11px]">
                  <tr>
                    <th className="px-2 py-2 font-bold">کالا</th>
                    <th className="px-2 py-2 font-bold">نیاز</th>
                    <th className="px-2 py-2 font-bold">رزرو فعلی</th>
                    <th className="px-2 py-2 font-bold">رزرو پس از ثبت</th>
                    <th className="px-2 py-2 font-bold">تغییر</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.lines.map(line => <LineRow key={line.itemId} line={line} />)}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2 shrink-0 bg-slate-50/80">
          <button type="button" onClick={closeIfIdle} disabled={applying} className={`px-4 rounded-lg border border-slate-300 text-slate-700 text-xs font-bold disabled:opacity-40 ${PHONE_TAP_TARGET}`}>انصراف</button>
          <button
            type="button"
            onClick={() => { void apply(); }}
            disabled={!preview.hasChanges || applying || !online || staleVersion || blocked}
            title={confirmTitle}
            className={`px-4 rounded-lg bg-purple-600 text-white text-xs font-bold disabled:opacity-40 ${PHONE_TAP_TARGET}`}
          >
            {applying ? 'در حال ثبت…' : 'ثبت تغییرهای رزرو'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ButtonProps {
  projectId: number;
  writeBase: ProjectWriteBase;
  /** ذخیره یا ثبت دیگری در جریان است */
  busy: boolean;
  /** تغییر ذخیره‌نشده در کنترل موجودی هست */
  dirty: boolean;
  onApplied: (result: ReservationReconcileResult) => void;
}

/** دکمهٔ «تکمیل رزرو» زبانهٔ مواد پروژهٔ ثبت نهایی‌شده: پیش‌نمایش را می‌خواند و پنجرهٔ تأیید را باز می‌کند */
export function ReservationReconcileButton({ projectId, writeBase, busy, dirty, onApplied }: ButtonProps): React.ReactElement {
  const online = useOnlineStatus();
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<ReservationReconcilePreview | null>(null);
  const open = async () => {
    setLoading(true);
    try {
      setPreview(await fetchJson<ReservationReconcilePreview>(`/api/projects/${projectId}/reservation-reconcile`));
    } catch (err) {
      toast.error(errorMessageOf(err) || 'پیش‌نمایش تکمیل رزرو خوانده نشد.');
    } finally {
      setLoading(false);
    }
  };
  const title = !online ? OFFLINE_SUBMIT_TITLE : dirty ? 'ابتدا تغییرهای کنترل موجودی را ذخیره کنید.' : 'رزرو را با فهرست مواد امروز برابر می‌کند';
  return (
    <>
      <button
        type="button"
        onClick={() => { void open(); }}
        disabled={busy || dirty || loading || !online}
        title={title}
        className="px-3.5 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
      >
        <RefreshCw className={`w-4 h-4 text-purple-200 ${loading ? 'animate-spin' : ''}`} />
        تکمیل رزرو
      </button>
      {preview && (
        <ReservationReconcileDialog
          projectId={projectId}
          writeBase={writeBase}
          initialPreview={preview}
          onClose={() => setPreview(null)}
          onApplied={onApplied}
        />
      )}
    </>
  );
}
