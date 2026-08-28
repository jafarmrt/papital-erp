import React, { useEffect } from 'react';
import { setDisplayTimezone } from '../../utils';
import { useSettingsQuery } from '../../hooks/queries';

/**
 * V10-1.3 — TimezoneProvider
 * ===========================
 * تنظیم `display_timezone` سامانه را از کش React Query می‌خواند و به لایه
 * فرمتورهای utils (ماژولی) تزریق می‌کند تا تمام تاریخ‌ها/ساعت‌های UI در
 * «ساعت توافقی واحد» رندر شوند، صرف‌نظر از منطقه زمانی دستگاه کاربر.
 */
export function TimezoneProvider({ children }: { children: React.ReactNode }) {
  const { data } = useSettingsQuery();
  useEffect(() => {
    const items = Array.isArray(data) ? data : [];
    const tz = items.find((s: any) => s?.key === 'display_timezone')?.value;
    if (tz) setDisplayTimezone(tz);
  }, [data]);

  return <>{children}</>;
}

export default TimezoneProvider;
