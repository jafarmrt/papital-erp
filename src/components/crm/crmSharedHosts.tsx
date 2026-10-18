import type { useCRMData } from '../../hooks/useCRMData';
import type { CRMLead, Customer } from '../../types';
import { CRMLeadModal } from './CRMLeadModal';
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
      isEditingActivity={crm.editingActivity !== null}
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
  onEditCustomer: (customer: Customer) => void;
  /** the customers page has no sales file drawer: it opens the file on the sales page instead (v10.2 package 7, OBS-R2-24) */
  onOpenLeadDrawer?: (lead: CRMLead) => void;
}

/** پرونده مشتری: فرصت یا اقدام تازه با نام و شناسه همان مشتری از پیش پرشده باز می‌شود */
export function CrmCustomerDossierHost({ crm, customer, onClose, onEditCustomer, onOpenLeadDrawer }: CrmCustomerDossierHostProps) {
  return (
    <CustomerDossierDrawer
      customer={customer}
      onClose={onClose}
      onOpenLeadDrawer={onOpenLeadDrawer ?? crm.openLeadDrawer}
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

/**
 * The sales file window, shared by the sales page and the customers page, where the dossier's «پرونده فروش تازه» opened
 * nothing before (v10.2 package 7, OBS-R2-24)
 */
export function CrmLeadModalHost({ crm }: { crm: CrmState }) {
  return (
    <CRMLeadModal
      isLeadModalOpen={crm.isLeadModalOpen}
      onCloseLeadModal={() => crm.setIsLeadModalOpen(false)}
      editingLead={crm.editingLead}
      leadForm={crm.leadForm}
      setLeadForm={crm.setLeadForm}
      isSavingLead={crm.isSavingLead}
      onSaveLead={crm.handleSaveLead}
      onDeleteLead={crm.canDeleteLead ? crm.handleDeleteLead : undefined}
      customersList={crm.customersList}
      personnelList={crm.personnelList}
      currentPersonnelId={crm.currentPersonnelId}
      currentLoggedInUser={crm.currentLoggedInUser}
    />
  );
}
