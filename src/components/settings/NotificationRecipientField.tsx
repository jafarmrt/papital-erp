import { PERMISSION_CATALOG, SYSTEM_ADMIN_ROLE } from '../../lib/permissions/permissionCatalog';

/**
 * v9.0.127 (TD-883، مدل مجوز §۴.۲): گیرنده اعلان قاعده «دارندگان یک مجوز» از کاتالوگ است، یا مدیر سیستم. پیش‌تر فهرست
 * ثابت چهار کد نقش بود. قاعده‌ای که پیش‌تر نقش دیگری را برگزیده آن نقش را نگه می‌دارد و همان نشان داده می‌شود.
 */
export type NotificationActionConfig = Record<string, unknown> & { targetPermission?: string; targetRole?: string };

type RecipientMode = 'permission' | 'system' | 'role';

const FIRST_PERMISSION = PERMISSION_CATALOG[0]?.permissions[0]?.key ?? '';
const fieldClass = 'w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-white';
const labelClass = 'block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1';

export function recipientMode(config: NotificationActionConfig): RecipientMode {
  if (typeof config.targetPermission === 'string' && config.targetPermission !== '') return 'permission';
  if (typeof config.targetRole === 'string' && config.targetRole !== '' && config.targetRole !== SYSTEM_ADMIN_ROLE) return 'role';
  return 'system';
}

export function withRecipient(config: NotificationActionConfig, mode: RecipientMode, permission?: string): NotificationActionConfig {
  const rest = Object.fromEntries(Object.entries(config).filter(([key]) => key !== 'targetPermission' && key !== 'targetRole'));
  if (mode === 'permission') return { ...rest, targetPermission: permission || FIRST_PERMISSION };
  if (mode === 'role') return { ...rest, targetRole: config.targetRole };
  return { ...rest, targetRole: SYSTEM_ADMIN_ROLE };
}

export function NotificationRecipientField({ config, onChange }: { config: NotificationActionConfig; onChange: (next: NotificationActionConfig) => void }) {
  const mode = recipientMode(config);
  return (
    <div className="space-y-2">
      <div>
        <label htmlFor="notification-recipient-mode" className={labelClass}>گیرندگان اعلان</label>
        <select id="notification-recipient-mode" value={mode} onChange={(e) => onChange(withRecipient(config, e.target.value as RecipientMode))} className={fieldClass}>
          <option value="permission">دارندگان یک مجوز</option>
          <option value="system">مدیر سیستم</option>
          {mode === 'role' && <option value="role">{`اعضای نقش «${config.targetRole}»`}</option>}
        </select>
      </div>
      {mode === 'permission' && (
        <div>
          <label htmlFor="notification-recipient-permission" className={labelClass}>مجوز</label>
          <select id="notification-recipient-permission" value={config.targetPermission} onChange={(e) => onChange(withRecipient(config, 'permission', e.target.value))} className={fieldClass}>
            {PERMISSION_CATALOG.map(group => (
              <optgroup key={group.category} label={group.category}>
                {group.permissions.map(p => <option key={p.key} value={p.key}>{p.title}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
