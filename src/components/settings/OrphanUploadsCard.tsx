import { useState } from 'react';
import { ImageOff, Search, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { fetchJson } from '../../api';
import { errorMessageOf } from '../../utils';
import { confirmAction } from '../ConfirmDialogHost';
import { orphanUploadsMessage, type OrphanUploadsReport } from '../../lib/system/orphanUploads';

/**
 * v10.2.17 (OBS-R2-60, 10.2 package 13): «پاک کردن تصویرهای بی‌صاحب». First a count of the image files no record names,
 * then, after a confirmation, the removal; never on a schedule.
 */
type OrphanUploadsAnswer = OrphanUploadsReport & { message?: string };

const runCleanup = (apply: boolean) => fetchJson<OrphanUploadsAnswer>('/system/orphan-uploads', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apply }),
});

export function OrphanUploadsCard() {
  const [isRunning, setIsRunning] = useState(false);
  const [preview, setPreview] = useState<OrphanUploadsAnswer | null>(null);

  const handleCheck = async () => {
    try {
      setIsRunning(true);
      setPreview(await runCleanup(false));
    } catch (err) {
      toast.error(errorMessageOf(err) || 'بررسی تصویرها انجام نشد؛ دوباره تلاش کنید.');
    } finally {
      setIsRunning(false);
    }
  };

  const handleRemove = async () => {
    if (!preview || preview.orphans.files === 0) return;
    const ok = await confirmAction({
      title: 'پاک کردن تصویرهای بی‌صاحب',
      message: `${preview.message ?? orphanUploadsMessage(preview)} تصویری که هر رکوردی، حتی رکورد حذف‌شده یا رونوشت، به آن اشاره کند پاک نمی‌شود. پاک‌شده‌ها برنمی‌گردند مگر از پشتیبان. ادامه می‌دهید؟`,
      confirmText: 'پاک کردن',
    });
    if (!ok) return;
    try {
      setIsRunning(true);
      const result = await runCleanup(true);
      if (result.failures.length > 0) toast.error(result.message || orphanUploadsMessage(result));
      else toast.success(result.message || orphanUploadsMessage(result));
      setPreview(null);
    } catch (err) {
      toast.error(errorMessageOf(err) || 'پاک کردن تصویرها انجام نشد؛ دوباره تلاش کنید.');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-xs p-6 space-y-4" data-testid="orphan-uploads-card">
      <div className="flex items-center gap-2 text-slate-800 border-b border-slate-100 pb-4">
        <ImageOff className="w-6 h-6 text-indigo-600" />
        <h3 className="font-bold text-lg m-0 p-0 border-0">تصویرهای بی‌صاحب</h3>
      </div>
      <p className="text-xs text-slate-600 leading-6 m-0">
        وقتی تصویر کالا، طرح ترنسفر، تصویر نمایه یا نشانهٔ شرکت عوض می‌شود، فایل قبلی روی کارساز می‌ماند. اینجا نخست شمرده می‌شود
        چند تصویر به هیچ رکوردی وصل نیست و سپس با تأیید شما پاک می‌شود. تصویری که رکوردی، حتی رکورد حذف‌شده یا رونوشت، به آن اشاره کند و
        تصویری که کمتر از یک ساعت پیش بارگذاری شده دست نمی‌خورد.
      </p>
      {preview && (
        <div role="status" className={`text-sm rounded-xl p-3 border ${preview.orphans.files > 0 ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
          {preview.message ?? orphanUploadsMessage(preview)}
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => void handleCheck()}
          disabled={isRunning}
          className="flex items-center gap-1.5 border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50 text-sm font-bold px-4 py-2 rounded-xl cursor-pointer"
        >
          <Search className="w-4 h-4" />
          <span>{isRunning && !preview ? 'در حال بررسی...' : 'بررسی تصویرها'}</span>
        </button>
        <button
          type="button"
          onClick={() => void handleRemove()}
          disabled={isRunning || !preview || preview.orphans.files === 0}
          className="flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-sm font-bold px-4 py-2 rounded-xl cursor-pointer"
        >
          <Trash2 className="w-4 h-4" />
          <span>{isRunning && preview ? 'در حال پاک کردن...' : 'پاک کردن تصویرهای بی‌صاحب'}</span>
        </button>
      </div>
    </div>
  );
}
