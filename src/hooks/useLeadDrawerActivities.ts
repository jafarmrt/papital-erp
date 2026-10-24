import { useEffect, useEffectEvent, useRef } from 'react';
import toast from 'react-hot-toast';
import { errorMessageOf } from '../utils';
import type { CRMActivity } from '../types';
import { useCrmLeadDetailQuery } from './queries/useCrmQueries';
import { useOpeningRead } from './queries/readOnEveryOpening';

const NO_ACTIVITIES: CRMActivity[] = [];

/**
 * v10.0.178 (OBS-R2-29، TD-991): تاریخچه کشوی پرونده فروش. باز کردن پرونده دیگر تاریخچه پرونده پیشین را فوراً پاک می‌کند و
 * پاسخ دیرِ درخواست پیشین نادیده گرفته می‌شود؛ بارگذاری دوباره همان پرونده تاریخچه را پاک نمی‌کند.
 * 10.3 (ARCH review finding 3, part 12): the detail is read through the shared cache, again on each opening of a file
 * (never what an earlier opening left there); a change that invalidates `crm` refreshes it while the drawer is open, and
 * the drawer shows the file as read now. A failed read is said once.
 * 10.3 package 7: `opening` changes on every showing of a file; showing the file the drawer already shows (a notification
 * or the dossier naming it again) reads it again too, and the drawer keeps what it shows until that answer arrives.
 */
export function useLeadDrawerActivities(leadId: number | null, opening = 0) {
  const query = useCrmLeadDetailQuery(leadId);
  const read = useOpeningRead(query, leadId);
  const shown = useRef({ leadId, opening });
  const readAgain = useEffectEvent(() => {
    void query.refetch();
  });
  useEffect(() => {
    const previous = shown.current;
    shown.current = { leadId, opening };
    // another file, or the first showing, is read by the query itself on its new key
    if (leadId !== null && previous.leadId === leadId && previous.opening !== opening) readAgain();
  }, [leadId, opening]);
  const sayFailed = useEffectEvent(() => {
    toast.error(errorMessageOf(read.error) || 'تاریخچهٔ پرونده فروش دریافت نشد.');
  });
  useEffect(() => {
    if (read.failedAt) sayFailed();
  }, [read.failedAt]);

  return {
    drawerLead: read.data?.lead ?? null,
    drawerActivities: read.data?.activities ?? NO_ACTIVITIES,
    drawerAttachments: read.data?.attachments,
  };
}
