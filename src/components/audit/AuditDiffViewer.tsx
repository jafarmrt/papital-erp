import React from 'react';
import { ArrowRightLeft, Check, Trash2, ShieldAlert } from 'lucide-react';
import { formatPersianNumber } from '../../utils';

interface AuditDiffViewerProps {
  details: any;
  action: string;
}

export const AuditDiffViewer: React.FC<AuditDiffViewerProps> = ({ details, action }) => {
  if (!details || typeof details !== 'object') {
    return (
      <div className="p-4 text-center text-slate-400 text-xs">
        اطلاعات ساختاریافته‌ای برای مقایسه ثبت نشده است.
      </div>
    );
  }

  // Helper to format any value cleanly
  const renderValue = (val: any) => {
    if (val === null || val === undefined) {
      return <span className="text-slate-400 italic">خالی (null)</span>;
    }
    if (typeof val === 'boolean') {
      return val ? 'بله (True)' : 'خیر (False)';
    }
    if (typeof val === 'number') {
      return formatPersianNumber(val);
    }
    if (typeof val === 'string') {
      if (val.trim() === '') return <span className="text-slate-400 italic">متن خالی</span>;
      return val;
    }
    if (Array.isArray(val)) {
      if (val.length === 0) return <span className="text-slate-400 italic">[آرایه خالی]</span>;
      return (
        <div className="flex flex-wrap gap-1">
          {val.map((item, idx) => (
            <span key={idx} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-2xs font-mono">
              {typeof item === 'object' ? JSON.stringify(item) : String(item)}
            </span>
          ))}
        </div>
      );
    }
    if (typeof val === 'object') {
      return (
        <pre className="text-2xs font-mono bg-slate-50 p-1 rounded max-h-24 overflow-y-auto text-left ltr">
          {JSON.stringify(val, null, 2)}
        </pre>
      );
    }
    return String(val);
  };

  // 1. Extract Changes Table
  let diffRows: { field: string; before: any; after: any }[] = [];

  if (details.changes && typeof details.changes === 'object') {
    diffRows = Object.entries(details.changes).map(([field, ch]: [string, any]) => ({
      field,
      before: ch?.before !== undefined ? ch.before : null,
      after: ch?.after !== undefined ? ch.after : ch
    }));
  } else if (details.before && details.after && typeof details.before === 'object' && typeof details.after === 'object') {
    // Compare keys from before and after
    const allKeys = Array.from(new Set([...Object.keys(details.before), ...Object.keys(details.after)]));
    diffRows = allKeys
      .filter(key => {
        const b = details.before[key];
        const a = details.after[key];
        return JSON.stringify(b) !== JSON.stringify(a);
      })
      .map(key => ({
        field: key,
        before: details.before[key],
        after: details.after[key]
      }));
  }

  // 2. Permission Diffs
  const addedPermissions: string[] = Array.isArray(details.addedPermissions) ? details.addedPermissions : [];
  const removedPermissions: string[] = Array.isArray(details.removedPermissions) ? details.removedPermissions : [];

  return (
    <div className="space-y-4">
      {/* Changes Comparison Table */}
      {diffRows.length > 0 ? (
        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-xs">
          <div className="bg-slate-100/80 px-4 py-2.5 border-b border-slate-200 font-bold text-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs">
              <ArrowRightLeft className="w-4 h-4 text-blue-600" />
              <span>مقایسه تغییرات مقادیر فیلدها ({formatPersianNumber(diffRows.length)} فیلد تغییر یافته)</span>
            </div>
            <div className="flex items-center gap-3 text-2xs font-medium">
              <span className="flex items-center gap-1 text-rose-700">
                <span className="w-2 h-2 rounded-full bg-rose-500 inline-block"></span>
                مقدار قبلی (Before)
              </span>
              <span className="flex items-center gap-1 text-emerald-700">
                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
                مقدار جدید (After)
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-4 w-1/4">عنوان فیلد</th>
                  <th className="py-2.5 px-4 w-3/8 text-rose-700 bg-rose-50/40">مقدار قبلی (حذف‌شده / تغییر‌یافته)</th>
                  <th className="py-2.5 px-4 w-3/8 text-emerald-700 bg-emerald-50/40">مقدار جدید (جایگزین‌شده)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {diffRows.map(({ field, before, after }) => (
                  <tr key={field} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3 px-4 font-mono font-semibold text-slate-800 text-2xs align-top">
                      <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 inline-block">
                        {field}
                      </span>
                    </td>
                    <td className="py-3 px-4 bg-rose-50/20 text-rose-800 align-top">
                      <div className="inline-flex items-start gap-1.5 p-1.5 rounded-md bg-rose-100/50 border border-rose-200 text-2xs font-medium w-full break-all">
                        <span className="text-rose-600 font-bold select-none">-</span>
                        <span className="line-through decoration-rose-400 opacity-90">
                          {renderValue(before)}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4 bg-emerald-50/20 text-emerald-800 align-top">
                      <div className="inline-flex items-start gap-1.5 p-1.5 rounded-md bg-emerald-100/50 border border-emerald-200 text-2xs font-bold w-full break-all">
                        <span className="text-emerald-600 font-bold select-none">+</span>
                        <span>{renderValue(after)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : action === 'UPDATE' ? (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
          <span>جزئیات دقیق فیلدهای قبل و بعد برای این ویرایش ثبت نشده است یا تغییرات بدون تغییر مقدار رخ داده‌اند.</span>
        </div>
      ) : null}

      {/* Permission Differences (Added / Removed Badges) */}
      {(addedPermissions.length > 0 || removedPermissions.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {addedPermissions.length > 0 && (
            <div className="p-3 bg-emerald-50/80 border border-emerald-200 rounded-xl space-y-2">
              <span className="font-bold text-emerald-900 flex items-center gap-1.5 text-xs">
                <Check className="w-4 h-4 text-emerald-600" />
                دسترسی‌های افزوده شده ({formatPersianNumber(addedPermissions.length)} دسترسی):
              </span>
              <div className="flex flex-wrap gap-1.5">
                {addedPermissions.map((perm) => (
                  <span
                    key={perm}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-100 border border-emerald-300 text-emerald-900 rounded-lg font-mono text-2xs font-bold shadow-2xs"
                  >
                    <span className="text-emerald-600 font-bold">+</span>
                    {perm}
                  </span>
                ))}
              </div>
            </div>
          )}

          {removedPermissions.length > 0 && (
            <div className="p-3 bg-rose-50/80 border border-rose-200 rounded-xl space-y-2">
              <span className="font-bold text-rose-900 flex items-center gap-1.5 text-xs">
                <Trash2 className="w-4 h-4 text-rose-600" />
                دسترسی‌های لغوشده ({formatPersianNumber(removedPermissions.length)} دسترسی):
              </span>
              <div className="flex flex-wrap gap-1.5">
                {removedPermissions.map((perm) => (
                  <span
                    key={perm}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-rose-100 border border-rose-300 text-rose-900 rounded-lg font-mono text-2xs font-bold line-through decoration-rose-500 shadow-2xs"
                  >
                    <span className="text-rose-600 font-bold">-</span>
                    {perm}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Before Snapshot (e.g. for DELETE) */}
      {details.before && diffRows.length === 0 && (
        <div className="p-3.5 bg-rose-50/50 border border-rose-200 rounded-xl space-y-2">
          <span className="font-bold text-rose-900 flex items-center gap-1.5 text-xs">
            <Trash2 className="w-4 h-4 text-rose-600" />
            اسنپ‌شات وضعیت رکورد قبل از حذف (Before Snapshot):
          </span>
          <div className="bg-slate-900 text-slate-100 p-3 rounded-lg overflow-x-auto text-2xs font-mono ltr text-left max-h-56">
            <pre>{JSON.stringify(details.before, null, 2)}</pre>
          </div>
        </div>
      )}

      {/* After Snapshot (e.g. for CREATE) */}
      {details.after && diffRows.length === 0 && (
        <div className="p-3.5 bg-emerald-50/50 border border-emerald-200 rounded-xl space-y-2">
          <span className="font-bold text-emerald-900 flex items-center gap-1.5 text-xs">
            <Check className="w-4 h-4 text-emerald-600" />
            اطلاعات ثبت‌شده رکورد جدید (After Snapshot):
          </span>
          <div className="bg-slate-900 text-slate-100 p-3 rounded-lg overflow-x-auto text-2xs font-mono ltr text-left max-h-56">
            <pre>{JSON.stringify(details.after, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
};
