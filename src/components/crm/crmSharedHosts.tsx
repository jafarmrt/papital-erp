import type { useCRMData } from '../../hooks/useCRMData';
import type { CRMActivity, CRMLead, Customer } from '../../types';
import { CRMInteractionModal } from './CRMInteractionModal';
import { CustomerDossierDrawer } from './CustomerDossierDrawer';

/**
 * v7.0.140: اتصال مشترک مودال اقدام/پیگیری و پرونده مشتری به useCRMData — پیش‌تر در CRMPage و CustomersPage تکرار شده بود.
 */
type CrmState = ReturnType<typeof useCRMData>;

export function CrmInteractionModalHost({ crm, currentUser }: { crm: CrmState; currentUser: Parameters<typeof useCRMData>[0] }) {
  return (
    <CRMInteractionModal
      isActivityModalOpen={crm.isActivityModalOpen}
      onCloseActivityModal={() => crm.setIsActivityModalOpen(false)}
      selectedLeadForActivity={crm.selectedLeadForActivity}
      setSelectedLeadForActivity={crm.setSelectedLeadForActivity}
      leads={crm.leads}
      activityForm={crm.activityForm}
      setActivityForm={crm.setActivityForm}
      isSavingActivity={crm.isSavingActivity}
      onSaveActivity={crm.handleSaveActivity}
      personnelList={crm.personnelList}
      mentionUsers={crm.mentionUsers}
      currentUser={currentUser}
      currentLoggedInUser={crm.currentLoggedInUser}
      isFollowupResultModalOpen={crm.isFollowupResultModalOpen}
      onCloseFollowupResultModal={() => crm.setIsFollowupResultModalOpen(false)}
      selectedFollowupAct={crm.selectedFollowupAct}
      followupResultForm={crm.followupResultForm}
      setFollowupResultForm={crm.setFollowupResultForm}
      isSubmittingFollowupResult={crm.isSubmittingFollowupResult}
      onConfirmFollowupResult={crm.handleConfirmFollowupResult}
    />
  );
}

interface CrmCustomerDossierHostProps {
  crm: CrmState;
  customer: Customer | null;
  onClose: () => void;
  allLeads: CRMLead[];
  allActivities: CRMActivity[];
  onEditCustomer: (customer: Customer) => void;
}

/** پرونده مشتری: فرصت یا اقدام تازه با نام و شناسه همان مشتری از پیش پرشده باز می‌شود */
export function CrmCustomerDossierHost({ crm, customer, onClose, allLeads, allActivities, onEditCustomer }: CrmCustomerDossierHostProps) {
  return (
    <CustomerDossierDrawer
      customer={customer}
      onClose={onClose}
      allLeads={allLeads}
      allActivities={allActivities}
      onOpenLeadDrawer={crm.openLeadDrawer}
      onOpenLeadModal={(lead, defaultCustName) => {
        crm.openLeadModal(lead);
        if (defaultCustName) {
          crm.setLeadForm((prev) => ({ ...prev, customerName: defaultCustName }));
        }
      }}
      onOpenActivityModal={(lead, defaultCustName, defaultCustId) => {
        crm.openActivityModal(lead, 'call', defaultCustName, defaultCustId);
        if (defaultCustName || defaultCustId) {
          crm.setActivityForm((prev) => ({
            ...prev,
            customerName: defaultCustName || prev.customerName,
            customerId: defaultCustId || prev.customerId
          }));
        }
      }}
      onEditCustomer={onEditCustomer}
    />
  );
}
