import React from 'react';
import { PERMISSION_CATALOG, isCatalogPermission } from '../../lib/permissions/permissionCatalog';

/**
 * فیلدهای نگهبان انتقال در طراح گردش‌کار: «مجوز لازم» (v8.0.100، TD-391)، «نقش مشخص» و «آغازکننده تأیید نکند»
 * (جداسازی وظایف؛ v8.0.102، TD-392). v9.0.128 (TD-542، مدل مجوز §۴.۲): مجوز از فهرست مشترک مجوزها برگزیده می‌شود و نقش
 * فقط از نقش‌های تعریف‌شده؛ پیش‌تر مجوز متن آزاد بود و طراح در نصب بی نقش پنج کد نقش ثابت پیشنهاد می‌داد.
 */
export interface WorkflowEdgeGuard {
  requiredRole: string;
  requiredPermission: string;
  isInitiatorExcluded: number;
}

export interface WorkflowRoleOption {
  code: string;
  name: string;
}

interface WorkflowEdgeGuardFieldsProps {
  value: WorkflowEdgeGuard;
  onChange: (patch: Partial<WorkflowEdgeGuard>) => void;
  /** نقش‌های تعریف‌شده (از فهرست نقش‌ها) */
  roles: WorkflowRoleOption[];
}

const labelClass = 'block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1';
const fieldClass = 'w-full text-xs p-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white';
const hintClass = 'text-[10px] text-gray-500 dark:text-gray-400 mt-1';

export const WorkflowEdgeGuardFields: React.FC<WorkflowEdgeGuardFieldsProps> = ({ value, onChange, roles }) => {
  const permission = value.requiredPermission || '';
  const role = value.requiredRole || '';
  const roleKnown = !role || role === '*' || role === 'ALL' || roles.some(r => r.code.toLowerCase() === role.toLowerCase());
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="workflow-edge-permission" className={labelClass}>مجوز لازم</label>
        <select
          id="workflow-edge-permission"
          value={permission}
          onChange={(e) => onChange({ requiredPermission: e.target.value })}
          className={fieldClass}
        >
          <option value="">بدون مجوز (هر تأییدکننده گردش کار)</option>
          {PERMISSION_CATALOG.map(group => (
            <optgroup key={group.category} label={group.category}>
              {group.permissions.map(p => <option key={p.key} value={p.key}>{p.title}</option>)}
            </optgroup>
          ))}
          {permission && !isCatalogPermission(permission) && (
            <option value={permission}>{`مجوزی که در فهرست نیست («${permission}»)`}</option>
          )}
        </select>
        <p className={hintClass}>فقط دارندگان این مجوز (و مدیر سیستم) این اقدام را انجام می‌دهند.</p>
      </div>
      <div>
        <label htmlFor="workflow-edge-role" className={labelClass}>نقش مشخص (اختیاری)</label>
        <select
          id="workflow-edge-role"
          value={role}
          onChange={(e) => onChange({ requiredRole: e.target.value })}
          className={fieldClass}
        >
          <option value="">بدون نقش مشخص</option>
          {roles.map(r => <option key={r.code} value={r.code}>{r.name}</option>)}
          {!roleKnown && <option value={role}>{`نقشی که دیگر تعریف نشده است («${role}»)`}</option>}
        </select>
        <p className={hintClass}>
          اگر نقشی برگزیده شود، فقط اعضای همان نقش (و مدیر سیستم) این اقدام را انجام می‌دهند؛ برای «همه اعضای نقش» لازم است.
        </p>
      </div>
      <label className="flex items-start gap-2 text-xs text-gray-700 dark:text-gray-300 cursor-pointer">
        <input
          type="checkbox"
          checked={value.isInitiatorExcluded === 1}
          onChange={(e) => onChange({ isInitiatorExcluded: e.target.checked ? 1 : 0 })}
          className="mt-0.5"
        />
        <span>
          آغازکننده تأیید نکند
          <span className="block text-[10px] text-gray-500 dark:text-gray-400">
            کسی که فرایند را آغاز کرده (یا جانشینش) این گام را برای سند خودش اجرا نمی‌کند؛ مدیر سیستم مستثناست.
          </span>
        </span>
      </label>
    </div>
  );
};
