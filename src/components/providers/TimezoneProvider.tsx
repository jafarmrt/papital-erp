import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { getDisplayTimezoneClient, normalizeDisplayTimezone, setDisplayTimezone, subscribeDisplayTimezone } from '../../utils';
import { useSettingsQuery } from '../../hooks/queries';
import { PageLoader } from '../PageLoader';

/**
 * The display time zone as React state: a component that calls it re-renders when the zone changes (OBS-R2-106).
 * Non-React code keeps reading `getDisplayTimezoneClient()`.
 */
export function useDisplayTimezone(): string {
  return useSyncExternalStore(subscribeDisplayTimezone, getDisplayTimezoneClient, getDisplayTimezoneClient);
}

/**
 * V10-1.3 — TimezoneProvider
 * ===========================
 * تنظیم `display_timezone` سامانه را از کش React Query می‌خواند و به لایه فرمتورهای utils می‌دهد تا تمام
 * تاریخ‌ها/ساعت‌های UI در «ساعت توافقی واحد» رندر شوند، صرف‌نظر از منطقه زمانی دستگاه کاربر.
 *
 * OBS-R2-106: پیش‌تر منطقه فقط در متغیر ماژول نوشته می‌شد و صفحه‌ای که زودتر رندر شده بود با منطقه پیش‌فرض می‌ماند.
 * اکنون صفحه‌ها فقط پس از نخستین خواندن تنظیمات (یا شکست آن) و پس از نشستن منطقه رندر می‌شوند، و منطقه حالت React
 * است: هر خواننده `useDisplayTimezone` با تغییر آن دوباره رندر می‌شود.
 */
export function TimezoneProvider({ children }: { children: React.ReactNode }) {
  const { data, isFetched, isError } = useSettingsQuery();
  const items = Array.isArray(data) ? data : [];
  const wanted = normalizeDisplayTimezone(items.find((s: { key?: string; value?: string }) => s?.key === 'display_timezone')?.value);
  const timeZone = useDisplayTimezone();
  // once the pages are shown they stay mounted; a later zone change only re-renders the zone's readers
  const openedRef = useRef(false);

  useEffect(() => {
    if (wanted) setDisplayTimezone(wanted);
  }, [wanted]);

  const settingsRead = isFetched || isError || items.length > 0;
  const zoneApplied = !wanted || wanted === timeZone;
  if (!openedRef.current && (!settingsRead || !zoneApplied)) {
    return <PageLoader />;
  }
  openedRef.current = true;
  return <>{children}</>;
}

export default TimezoneProvider;
