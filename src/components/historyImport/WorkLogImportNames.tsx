import type { ReactNode } from 'react';
import type { ProjectTarget, WorkLogImportMapping, WorkLogLookups } from '../../lib/historyImport/workLogSheet';
import { formatPersianCode } from '../../utils';

/**
 * v12 work-log import: the names of the sheet, each mapped once — colleague → personnel, «شرح فعالیت» → task title,
 * «پروژه» → production project or «بدون پروژه». The choice is kept in this browser for next month's file.
 */
interface Props {
  names: { personnel: string[]; tasks: string[]; projects: string[] };
  mapping: WorkLogImportMapping;
  lookups: WorkLogLookups;
  onChange: (mapping: WorkLogImportMapping) => void;
}

const SELECT_CLASS = 'w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs';

function Group({ title, names, children }: { title: string; names: string[]; children: (name: string) => ReactNode }) {
  if (names.length === 0) return null;
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">{title}</legend>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">
        {names.map(name => (
          <label key={name} className="grid grid-cols-[minmax(0,10rem)_1fr] items-center gap-2 text-[11px] text-slate-700 dark:text-slate-200">
            <span className="truncate" title={name}>{name}</span>
            {children(name)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const encodeProject = (t?: ProjectTarget) => (!t ? '' : t.kind === 'none' ? 'none' : String(t.projectId));

export function WorkLogImportNames({ names, mapping, lookups, onChange }: Props) {
  const setPersonnel = (name: string, value: string) => {
    const personnel = { ...mapping.personnel };
    if (value) personnel[name] = Number(value);
    else delete personnel[name];
    onChange({ ...mapping, personnel });
  };
  const setTask = (name: string, value: string) => {
    const tasks = { ...mapping.tasks };
    if (value) tasks[name] = Number(value);
    else delete tasks[name];
    onChange({ ...mapping, tasks });
  };
  const setProject = (name: string, value: string) => {
    const projects = { ...mapping.projects };
    if (!value) delete projects[name];
    else projects[name] = value === 'none' ? { kind: 'none' } : { kind: 'project', projectId: Number(value) };
    onChange({ ...mapping, projects });
  };
  const total = names.personnel.length + names.tasks.length + names.projects.length;
  if (total === 0) return <p className="text-xs text-emerald-700 dark:text-emerald-400">همهٔ نام‌های این ماه نگاشت شده‌اند؛ پیش‌نمایش را بزنید.</p>;
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-600 dark:text-slate-300">هر نام یک بار به برنامه وصل می‌شود و برای پرونده‌های بعدی در همین مرورگر می‌ماند.</p>
      <Group title="همکار ← پرسنل" names={names.personnel}>
        {name => (
          <select aria-label={`پرسنل برای ${name}`} className={SELECT_CLASS} value={mapping.personnel[name] ?? ''} onChange={e => setPersonnel(name, e.target.value)}>
            <option value="">انتخاب کنید</option>
            {lookups.personnel.map(p => <option key={p.id} value={p.id}>{p.fullName}</option>)}
          </select>
        )}
      </Group>
      <Group title="شرح فعالیت ← عنوان کاری" names={names.tasks}>
        {name => (
          <select aria-label={`عنوان کاری برای ${name}`} className={SELECT_CLASS} value={mapping.tasks[name] ?? ''} onChange={e => setTask(name, e.target.value)}>
            <option value="">انتخاب کنید</option>
            {lookups.tasks.map(t => <option key={t.id} value={t.id}>{t.title}{t.unit ? ` (${t.unit})` : ''}</option>)}
          </select>
        )}
      </Group>
      <Group title="پروژه ← پروژهٔ تولید" names={names.projects}>
        {name => (
          <select aria-label={`پروژه برای ${name}`} className={SELECT_CLASS} value={encodeProject(mapping.projects[name])} onChange={e => setProject(name, e.target.value)}>
            <option value="">انتخاب کنید</option>
            <option value="none">بدون پروژه (عمومی و مشترک)</option>
            {lookups.projects.map(p => <option key={p.id} value={p.id}>{p.projectCode ? `${formatPersianCode(p.projectCode)} - ` : ''}{p.title}</option>)}
          </select>
        )}
      </Group>
    </div>
  );
}
