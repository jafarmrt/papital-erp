import React, { useId } from 'react';
import { UserCheck, X } from 'lucide-react';
import { SearchableSelect } from '../SearchableSelect';
import { useSimpleUsersQuery } from '../../hooks/queries/useSimpleUsersQuery';
import { MAX_PROJECT_MANAGERS, type ProjectManagerView } from '../../lib/projects/projectManagers';
import { formatPersianNumber } from '../../utils';

interface ProjectManagersFieldProps {
  /** the chosen users, in the order they were added */
  managerIds: number[];
  onChange: (ids: number[]) => void;
  /** the stored managers of the project being edited, for the names of users the pick list no longer has */
  storedManagers?: ProjectManagerView[];
  disabled?: boolean;
}

/**
 * v10.1.35 (N-01, TD-1283, decision ت۳ الف of the mobile workshop plan): «مسئولان پروژه», the users who approve or
 * reject the end-of-task reports of the project's personnel in the workshop cartable.
 */
export const ProjectManagersField: React.FC<ProjectManagersFieldProps> = ({ managerIds, onChange, storedManagers = [], disabled }) => {
  const fieldId = useId();
  const usersQuery = useSimpleUsersQuery();
  const users = usersQuery.data ?? [];
  const nameOf = (id: number): string => {
    const user = users.find(u => u.id === id);
    if (user) return user.full_name || user.username;
    const stored = storedManagers.find(m => m.userId === id);
    return stored ? `${stored.fullName}${stored.isDeleted ? ' (حذف‌شده)' : ''}` : `کاربر ${formatPersianNumber(id)}`;
  };
  const options = users
    .filter(u => !managerIds.includes(u.id))
    .map(u => ({ value: String(u.id), label: `${u.full_name || u.username}${u.role_name ? ` (${u.role_name})` : ''}` }));
  const full = managerIds.length >= MAX_PROJECT_MANAGERS;

  return (
    <div className="bg-slate-50/80 p-5 rounded-2xl border border-slate-200/80 space-y-3">
      <h3 className="text-xs font-bold text-slate-800 flex items-center gap-2 border-b border-slate-200 pb-2">
        <UserCheck size={14} className="text-blue-600" />
        مسئولان پروژه
      </h3>
      <p className="text-2xs text-slate-500 leading-5">
        مسئولان پروژه گزارش پایان کار پرسنل این پروژه را در کارتابل کارگاه تأیید یا رد می‌کنند. نقش آن‌ها مجوز
        «بررسی گزارش‌های کار کارگاه» را هم لازم دارد.
      </p>

      {managerIds.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="مسئولان انتخاب‌شده">
          {managerIds.map(id => (
            <li key={id} className="flex items-center gap-1 bg-white border border-slate-300 rounded-full ps-3 pe-1 py-1 text-xs text-slate-700">
              {nameOf(id)}
              <button
                type="button"
                aria-label={`حذف ${nameOf(id)} از مسئولان`}
                disabled={disabled}
                onClick={() => onChange(managerIds.filter(m => m !== id))}
                className="p-1 rounded-full text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div>
        <label htmlFor={`${fieldId}-add-manager`} className="block text-xs font-bold text-slate-700 mb-1.5">
          افزودن مسئول
        </label>
        <SearchableSelect
          id={`${fieldId}-add-manager`}
          options={options}
          value=""
          onChange={(val) => { const id = Number(val); if (id > 0 && !full) onChange([...managerIds, id]); }}
          placeholder={full ? `حداکثر ${formatPersianNumber(MAX_PROJECT_MANAGERS)} مسئول` : 'جست‌وجو و انتخاب کاربر...'}
          disabled={disabled || full || usersQuery.isLoading}
          className="w-full"
        />
        {usersQuery.isError && <p className="text-2xs text-red-600 mt-1">فهرست کاربران خوانده نشد.</p>}
      </div>
    </div>
  );
};
