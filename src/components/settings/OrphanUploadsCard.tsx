import { useState } from 'react';
import { ImageOff, Search, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { fetchJson } from '../../api';
import { errorMessageOf } from '../../utils';
import { confirmAction } from '../ConfirmDialogHost';
import { orphanUploadsMessage, type OrphanUploadsReport } from '../../lib/system/orphanUploads';

/**
 * v10.2.18 (OBS-R2-60, 10.2 package 13): «تصویرهای بی‌صاحب». First a check, then, after a confirmation, a run that acts only on
 * the files the check listed: moves them aside, removes those held past the hold and brings back those named again; never on
 * a schedule.
 */
type OrphanUploadsAnswer = OrphanUploadsReport & { message?: string };

const runCleanup = (body: object) => fetchJson<OrphanUploadsAnswer>('/system/orphan-uploads', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

const hasWork = (r: OrphanUploadsReport) => r.orphans.files > 0 || r.expired.files > 0 || r.restored.files > 0;

export function OrphanUploadsCard() {
  const [isChecking, setIsChecking] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [preview, setPreview] = useState<OrphanUploadsAnswer | null>(null);
  const busy = isChecking || isApplying;

  const handleCheck = async () => {
    try {
      setIsChecking(true);
      setPreview(await runCleanup({ apply: false }));
    } catch (err) {
      toast.error(errorMessageOf(err) || 'بررسی تصویرها انجام نشد؛ دوباره تلاش کنید.');
    } finally {
      setIsChecking(false);
    }
  };

  const handleApply = async () => {
    if (!preview || !hasWork(preview)) return;
    const ok = await confirmAction({
      title: 'جابه‌جایی تصویرهای بی‌صاحب',
      message: `${preview.message ?? orphanUploadsMessage(preview)} فقط همین تصویرها جابه‌جا یا پاک می‌شوند و هر کدام که در این میان رکوردی به آن اشاره کند دست نمی‌خورد. ادامه می‌دهید؟`,
      confirmText: 'اجرا',
    });
    if (!ok) return;
    try {
      setIsApplying(true);
      const result = await runCleanup({ apply: true, quarantine: preview.orphans.names, purge: preview.expired.names });
      if (result.failureCount > 0) toast.error(result.message || orphanUploadsMessage(result));
      else toast.success(result.message || orphanUploadsMessage(result));
      setPreview(null);
    } catch (err) {
      toast.error(errorMessageOf(err) || 'اجرا انجام نشد؛ دوباره تلاش کنید.');
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-xs p-6 space-y-4" data-testid="orphan-uploads-card">
      <div className="flex items-center gap-2 text-slate-800 border-b border-slate-100 pb-4">
        <ImageOff className="w-6 h-6 text-indigo-600" />
        <h3 className="font-bold text-lg m-0 p-0 border-0">تصویرهای بی‌صاحب</h3>
      </div>
      <p className="text-xs text-slate-600 leading-6 m-0">
        وقتی تصویر کالا، طرح ترنسفر یا تصویر نمایه عوض می‌شود، فایل قبلی روی سرور می‌ماند. اینجا نخست شمرده می‌شود چند تصویر به
        هیچ رکوردی وصل نیست و سپس با تأیید شما به پوشهٔ جدا منتقل می‌شود و بعد از ۳۰ روز پاک می‌شود؛ تا آن روز در پشتیبان هست و اگر
        رکوردی دوباره به آن اشاره کند در اجرای بعد برمی‌گردد. تصویری که رکوردی، حتی رکورد حذف‌شده یا رونوشت، به آن اشاره کند و تصویری که کمتر از
        یک ساعت پیش بارگذاری شده دست نمی‌خورد.
      </p>
      {preview && (
        <div role="status" className={`text-sm rounded-xl p-3 border ${hasWork(preview) ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
          {preview.message ?? orphanUploadsMessage(preview)}
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => void handleCheck()}
          disabled={busy}
          className="flex items-center gap-1.5 border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50 text-sm font-bold px-4 py-2 rounded-xl cursor-pointer"
        >
          <Search className="w-4 h-4" />
          <span>{isChecking ? 'در حال بررسی...' : 'بررسی تصویرها'}</span>
        </button>
        <button
          type="button"
          onClick={() => void handleApply()}
          disabled={busy || !preview || !hasWork(preview)}
          className="flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-sm font-bold px-4 py-2 rounded-xl cursor-pointer"
        >
          <Trash2 className="w-4 h-4" />
          <span>{isApplying ? 'در حال اجرا...' : 'جابه‌جایی تصویرهای بی‌صاحب'}</span>
        </button>
      </div>
    </div>
  );
}
