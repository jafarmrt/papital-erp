import {
  APPLICATION_STATUS_TITLES, BUYER_ACCOUNT_STATUS_TITLES, type ApplicationStatus, type BuyerAccountStatus,
} from '../../lib/storefront/storefrontBuyerRules';

/** v11 phase 8.2b: one chip for a site buyer account: suspended wins, else the wholesale state */
const TONES: Readonly<Record<ApplicationStatus, string>> = {
  none: 'bg-slate-100 text-slate-600',
  pending: 'bg-amber-50 text-amber-800',
  approved: 'bg-emerald-50 text-emerald-700',
  declined: 'bg-rose-50 text-rose-700',
};

export function BuyerStatusChip({ status, application }: { status: BuyerAccountStatus; application: ApplicationStatus }) {
  const suspended = status === 'suspended' && application !== 'declined';
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${suspended ? 'bg-slate-800 text-white' : TONES[application]}`}>
      {suspended ? BUYER_ACCOUNT_STATUS_TITLES.suspended : APPLICATION_STATUS_TITLES[application]}
    </span>
  );
}
