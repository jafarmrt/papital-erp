import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { fetchJson, isAbortError } from '../api';
import { errorMessageOf } from '../utils';
import { normalizeLeadStage } from './useCRMFilters';
import { activityTarget, parseCrmDeepLink } from '../lib/crm/crmDeepLink';
import type { CRMActivity, CRMLead } from '../types';

interface CrmDeepLinkHandlers {
  openLead: (lead: CRMLead) => void;
  openParty: (customerId: number) => void;
  openActivities: () => void;
}

/**
 * v10.2 package 7 (OBS-R2-24): opens what `/crm?leadId=` or `/crm?activityId=` names (notifications, the dashboard
 * widget) and then removes the parameters from the address, so going back or reloading does not open it again.
 */
export function useCrmDeepLink(handlers: CrmDeepLinkHandlers) {
  const location = useLocation();
  const navigate = useNavigate();
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  useEffect(() => {
    const link = parseCrmDeepLink(location.search);
    if (!link) return;
    void navigate(location.pathname, { replace: true });
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const { signal } = controller;
    void (async () => {
      try {
        let leadId = link.leadId;
        if (!leadId && link.activityId) {
          const activity = await fetchJson<CRMActivity>(`/crm/activities/${link.activityId}`, { signal });
          const target = activityTarget(activity ?? {});
          if (signal.aborted) return;
          if (target.kind === 'party') return handlersRef.current.openParty(target.customerId);
          if (target.kind === 'activities') return handlersRef.current.openActivities();
          leadId = target.leadId;
        }
        const lead = await fetchJson<CRMLead>(`/crm/leads/${leadId}`, { signal });
        if (signal.aborted || !lead) return;
        handlersRef.current.openLead({ ...lead, stage: normalizeLeadStage(lead.stage) });
      } catch (err) {
        if (isAbortError(err) || signal.aborted) return;
        toast.error(errorMessageOf(err) || 'پرونده فروش یا اقدامِ این پیوند پیدا نشد.');
      }
    })();
  }, [location.search, location.pathname, navigate]);
}
