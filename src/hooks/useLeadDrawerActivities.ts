import { useCallback, useRef, useState } from 'react';
import { fetchJson } from '../api';
import type { CRMActivity } from '../types';

/**
 * v10.0.32 (OBS-R2-29، TD-991): تاریخچه کشوی پرونده فروش. باز کردن پرونده دیگر تاریخچه پرونده پیشین را فوراً پاک می‌کند و
 * پاسخ دیرِ درخواست پیشین نادیده گرفته می‌شود؛ پیش‌تر تاریخچه پرونده قبلی تا رسیدن پاسخ (یا پس از خطا برای همیشه) زیر
 * پرونده تازه می‌ماند و پاسخ دیر پرونده قبلی روی پرونده تازه می‌نشست. بارگذاری دوباره همان پرونده تاریخچه را پاک نمی‌کند.
 */
export function useLeadDrawerActivities() {
  const [state, setState] = useState<{ leadId: number | null; activities: CRMActivity[] }>({ leadId: null, activities: [] });
  const latestRequest = useRef(0);

  const loadDrawerActivities = useCallback(async (leadId: number) => {
    const request = ++latestRequest.current;
    setState(prev => (prev.leadId === leadId ? prev : { leadId, activities: [] }));
    try {
      const res = await fetchJson(`/crm/leads/${leadId}`);
      if (request !== latestRequest.current) return;
      // V3.0.7 (TD-066): Array Safety Guard (قاعده #2 AGENTS)
      setState({ leadId, activities: Array.isArray(res?.activities) ? res.activities : [] });
    } catch (err) {
      if (request !== latestRequest.current) return;
      console.error('Error fetching lead drawer detail:', err);
    }
  }, []);

  return { drawerActivities: state.activities, loadDrawerActivities };
}
