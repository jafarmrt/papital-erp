import { Send } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useWorkflowDraftQuery, useWorkflowPublishMutation } from '../../hooks/queries/useWorkflowLifecycle';
import { confirmAction } from '../ConfirmDialogHost';
import { toPersianDigits } from '../../utils/persianNumber';
import { errorMessageOf } from '../../utils';
import type { VersionDiffItem, WorkflowVersionDiff } from '../../lib/workflow/workflowVersionDiff';

/**
 * v10.1.21 (TD-1270, D-06 part D): the unpublished draft of a workflow, what it changes against the published version and,
 * for the system admin (`workflow.admin`, decision ت۴), the button that publishes it. New records start with the
 * published version until then; running records keep their own version either way.
 */

const SECTIONS: ReadonlyArray<{ key: keyof Omit<WorkflowVersionDiff, 'unchanged'>; label: string; tone: string }> = [
  { key: 'addedSteps', label: 'گام‌های افزوده', tone: 'text-emerald-700 dark:text-emerald-300' },
  { key: 'removedSteps', label: 'گام‌های حذف‌شده', tone: 'text-rose-700 dark:text-rose-300' },
  { key: 'changedSteps', label: 'گام‌های تغییرکرده', tone: 'text-amber-700 dark:text-amber-300' },
  { key: 'addedActions', label: 'اقدام‌های افزوده', tone: 'text-emerald-700 dark:text-emerald-300' },
  { key: 'removedActions', label: 'اقدام‌های حذف‌شده', tone: 'text-rose-700 dark:text-rose-300' },
  { key: 'changedActions', label: 'اقدام‌های تغییرکرده', tone: 'text-amber-700 dark:text-amber-300' },
];

function DiffList({ items }: { items: VersionDiffItem[] }) {
  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <li key={item.key} className="text-gray-700 dark:text-gray-200">
          <span className="font-medium">{item.title}</span>
          {item.changes.length > 0 && (
            <ul className="mr-4 text-[11px] text-gray-500 dark:text-gray-400">
              {item.changes.map((c) => (
                <li key={c.field}>{c.label}: «{c.before || 'خالی'}» به «{c.after || 'خالی'}»</li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

export function WorkflowDraftPanel({ definitionId, canPublish }: { definitionId: number; canPublish: boolean }) {
  const { data, isLoading, isError } = useWorkflowDraftQuery(definitionId);
  const publish = useWorkflowPublishMutation();
  if (isLoading) return <p className="text-xs text-gray-500">در حال بررسی پیش‌نویس...</p>;
  if (isError) return <p className="text-xs text-rose-600">بررسی پیش‌نویس ممکن نشد.</p>;
  if (!data?.draftVersion || !data.diff) {
    return <p className="text-xs text-gray-500">پیش‌نویس منتشرنشده‌ای نیست؛ پرونده‌های تازه با نسخه {toPersianDigits(data?.publishedVersion ?? 1)} آغاز می‌شوند.</p>;
  }
  const { draftVersion, publishedVersion, diff } = data;

  const handlePublish = async () => {
    const ok = await confirmAction({
      title: 'انتشار پیش‌نویس',
      message: `نسخه ${toPersianDigits(draftVersion)} منتشر شود؟ پرونده‌های تازه از این پس با آن آغاز می‌شوند و پرونده‌های در جریان با نسخه خودشان ادامه می‌دهند.`,
    });
    if (!ok) return;
    try {
      await publish.mutateAsync({ id: definitionId, draftVersion });
      toast.success(`نسخه ${toPersianDigits(draftVersion)} منتشر شد.`);
    } catch (err: unknown) {
      toast.error(errorMessageOf(err) || 'انتشار پیش‌نویس ممکن نشد؛ دوباره تلاش کنید.');
    }
  };

  return (
    <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/30 p-3 space-y-2 text-xs">
      <p className="font-bold text-amber-800 dark:text-amber-200">
        پیش‌نویس نسخه {toPersianDigits(draftVersion)} منتشر نشده؛ پرونده‌های تازه با نسخه {toPersianDigits(publishedVersion)} آغاز می‌شوند.
      </p>
      {diff.unchanged ? (
        <p className="text-gray-600 dark:text-gray-300">پیش‌نویس در گام‌ها و اقدام‌ها با نسخه منتشرشده فرقی ندارد.</p>
      ) : (
        SECTIONS.filter((s) => diff[s.key].length > 0).map((s) => (
          <div key={s.key}>
            <h5 className={`font-bold mb-0.5 ${s.tone}`}>{s.label} ({toPersianDigits(diff[s.key].length)})</h5>
            <DiffList items={diff[s.key]} />
          </div>
        ))
      )}
      {canPublish ? (
        <button type="button" disabled={publish.isPending} onClick={() => void handlePublish()}
          className="flex items-center gap-1.5 px-3 py-1.5 font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
          <Send className="w-3.5 h-3.5" />
          <span>{publish.isPending ? 'در حال انتشار...' : `انتشار نسخه ${toPersianDigits(draftVersion)}`}</span>
        </button>
      ) : (
        <p className="text-gray-500 dark:text-gray-400">انتشار پیش‌نویس با دارنده مجوز «مدیریت ارشد و همگام‌سازی فرآیندها» است.</p>
      )}
    </div>
  );
}
