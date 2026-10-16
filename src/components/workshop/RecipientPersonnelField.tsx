import { SearchableSelect } from '../SearchableSelect';
import { usePersonnelListQuery } from '../../hooks/queries/usePersonnelQueries';
import { personnelDisplayName } from '../../lib/documents/stockDocumentParties';
import { RECIPIENT_TERMINATED_STATUS } from '../../lib/workshop/recipient';

interface RecipientPersonnelFieldProps {
  id: string;
  value: number | null;
  onChange: (personnelId: number | null) => void;
  disabled?: boolean;
}

/**
 * v10.1.36 (N-01, TD-1283, decision ت۴ الف of the mobile workshop plan): «تحویل‌گیرنده» of a material allocation, the
 * personnel who receives the materials and confirms them in the workshop cartable. Personnel who left are not offered.
 */
export function RecipientPersonnelField({ id, value, onChange, disabled }: RecipientPersonnelFieldProps) {
  const personnelQuery = usePersonnelListQuery();
  const options = (personnelQuery.data ?? [])
    .filter(p => p.employmentStatus !== RECIPIENT_TERMINATED_STATUS)
    .map(p => ({
      value: String(p.id),
      label: `${personnelDisplayName(p)}${p.personnelCode ? ` (کد ${p.personnelCode})` : ''}${p.jobTitle ? ` - ${p.jobTitle}` : ''}`,
    }));
  return (
    <div>
      <label htmlFor={id} className="block text-slate-700 font-bold mb-1">تحویل‌گیرنده (اختیاری):</label>
      <SearchableSelect
        id={id}
        options={[{ value: '', label: 'بدون تحویل‌گیرنده' }, ...options]}
        value={value ? String(value) : ''}
        onChange={(val) => onChange(val ? Number(val) : null)}
        placeholder="جست‌وجو و انتخاب پرسنل کارگاه..."
        disabled={disabled}
        className="w-full"
      />
      <p className="text-2xs text-slate-500 mt-1">تحویل‌گیرنده دریافت مواد را در کارتابل کارگاه تأیید می‌کند.</p>
      {personnelQuery.isError && <p className="text-2xs text-red-600 mt-1">فهرست پرسنل خوانده نشد.</p>}
    </div>
  );
}
