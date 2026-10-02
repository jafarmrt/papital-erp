import { useState } from 'react';
import { History, X } from 'lucide-react';
import { useWorkflowDefinitionVersionsQuery, type WorkflowDefinitionVersion } from '../../hooks/queries/useWorkflowQueries';
import { toPersianDigits } from '../../utils/persianNumber';

/**
 * v7.0.87 (TD-112): تاریخچه فقط‌خواندنی نسخه‌های یک الگوی ورکفلو. هر ذخیره طرح یک نسخه می‌سازد؛
 * فرایندهای در جریان با نسخه‌ای که با آن شروع شده‌اند ادامه می‌دهند. انتشار و بازگردانی وجود ندارد.
 */
const STATE_TYPE_LABELS: Record<string, string> = { initial: 'شروع', terminal: 'پایان' };

const dateFormatter = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' });

function formatVersionDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : dateFormatter.format(d);
}

function VersionDetail({ version }: { version: WorkflowDefinitionVersion }) {
  const states = Array.isArray(version.dslJson?.states) ? version.dslJson.states : [];
  const transitions = Array.isArray(version.dslJson?.transitions) ? version.dslJson.transitions : [];
  const titleOf = (id: number) => states.find((s) => s.id === id)?.title ?? '؟';
  return (
    <div className="space-y-3 text-xs">
      <div>
        <h4 className="font-bold text-gray-800 dark:text-gray-200 mb-1">وضعیت‌ها ({toPersianDigits(states.length)})</h4>
        <ul className="flex flex-wrap gap-1.5">
          {states.map((s) => (
            <li key={s.id} className="px-2 py-0.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">
              {s.title}
              {s.stateType && STATE_TYPE_LABELS[s.stateType] ? ` (${STATE_TYPE_LABELS[s.stateType]})` : ''}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h4 className="font-bold text-gray-800 dark:text-gray-200 mb-1">انتقال‌ها ({toPersianDigits(transitions.length)})</h4>
        {transitions.length === 0 ? (
          <p className="text-gray-400">بدون انتقال</p>
        ) : (
          <ul className="space-y-1">
            {transitions.map((t) => (
              <li key={t.id} className="text-gray-600 dark:text-gray-300">
                {titleOf(t.fromStateId)} ← {titleOf(t.toStateId)}: <span className="font-medium">{t.title}</span>
                {t.requiredRole ? <span className="text-gray-400"> — نقش {t.requiredRole}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function WorkflowVersionHistoryModal({ definitionId, title, onClose }: {
  definitionId: number;
  title: string;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useWorkflowDefinitionVersionsQuery(definitionId);
  const versions = Array.isArray(data) ? data : [];
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const selected = versions.find((v) => v.version === selectedVersion) ?? versions[0];

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4" role="dialog" aria-label="تاریخچه نسخه‌ها">
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 w-full max-w-3xl shadow-xl flex flex-col max-h-[85vh]">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between shrink-0">
          <h3 className="font-bold text-sm text-gray-900 dark:text-white flex items-center gap-2">
            <History className="w-4 h-4 text-indigo-600" />
            <span>تاریخچه نسخه‌های «{title}»</span>
          </h3>
          <button onClick={onClose} aria-label="بستن" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 overflow-y-auto grid grid-cols-1 md:grid-cols-[220px_1fr] gap-4">
          {isLoading ? (
            <p className="text-xs text-gray-500">در حال دریافت نسخه‌ها...</p>
          ) : isError ? (
            <p className="text-xs text-rose-600">دریافت تاریخچه نسخه‌ها ممکن نشد.</p>
          ) : versions.length === 0 ? (
            <p className="text-xs text-gray-500">هنوز نسخه‌ای ثبت نشده است.</p>
          ) : (
            <>
              <ul className="space-y-1.5">
                {versions.map((v) => (
                  <li key={v.id}>
                    <button
                      onClick={() => setSelectedVersion(v.version)}
                      className={`w-full text-right p-2 rounded-xl border text-xs transition-colors ${
                        selected?.version === v.version
                          ? 'border-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 dark:border-indigo-700'
                          : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/40'
                      }`}
                    >
                      <span className="font-bold font-mono text-gray-900 dark:text-white">نسخه {toPersianDigits(v.version)}</span>
                      <span className="block text-[10px] text-gray-500">{formatVersionDate(v.createdAt)}</span>
                      <span className="block text-[10px] text-gray-500 truncate">{v.description}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {selected ? <VersionDetail version={selected} /> : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
