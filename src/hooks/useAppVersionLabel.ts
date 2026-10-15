import { useEffect, useState } from 'react';
import { fetchJson } from '../api';
import { appVersionLabel } from '../lib/system/appVersionLabel';

/**
 * v10.1.13: شماره نسخه برنامه («نسخه ۱۰.۱.۱۳») از `GET /api/health`، برای پای منو و صفحه ورود. پیش‌تر صفحه ورود همه
 * یادداشت‌های نسخه را در بسته مرورگر می‌خواند تا فقط شماره آخرین نسخه را نشان دهد.
 */
export function useAppVersionLabel(): string {
  const [label, setLabel] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetchJson<{ version?: string }>('/health', { signal: controller.signal })
      .then(res => { if (!controller.signal.aborted) setLabel(appVersionLabel(res?.version)); })
      .catch(() => { /* the label stays hidden when the health probe is unreachable */ });
    return () => controller.abort();
  }, []);
  return label;
}
