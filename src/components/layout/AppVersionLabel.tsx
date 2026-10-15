import { useAppVersionLabel } from '../../hooks/useAppVersionLabel';

/** شماره نسخه برنامه در پای منو (جانشین صفحه «معرفی و به‌روزرسانی‌ها»، v10.1.15) */
export function AppVersionLabel({ compact }: { compact?: boolean }) {
  const label = useAppVersionLabel();
  if (!label || compact) return null;
  return <p className="px-2 text-[10px] text-slate-500" data-testid="app-version-label">{label}</p>;
}
