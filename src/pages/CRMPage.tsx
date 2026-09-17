import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Filter, Calendar, Briefcase, PhoneCall, Clock, Building2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { fetchJson } from '../api';
import { CRMLead, Customer } from '../types';
import { useCRMData, STAGES } from '../hooks/useCRMData';
import { CRMStatsCards } from '../components/crm/CRMStatsCards';
import { CRMKanbanPipeline } from '../components/crm/CRMKanbanPipeline';
import { CRMLeadsTable } from '../components/crm/CRMLeadsTable';
import { CRMFollowupsView } from '../components/crm/CRMFollowupsView';
import { CRMInteractionModal } from '../components/crm/CRMInteractionModal';
import { SearchableSelect } from '../components/SearchableSelect';
import { CRMLeadModal } from '../components/crm/CRMLeadModal';
import { CRMLeadDrawer } from '../components/crm/CRMLeadDrawer';
import { CustomerDossierDrawer } from '../components/crm/CustomerDossierDrawer';

export default function CRMPage({ user }: { user: any }) {
  const crm = useCRMData(user);
  const navigate = useNavigate();
  const [selectedCustomerDossier, setSelectedCustomerDossier] = useState<Customer | null>(null);

  const handleOpenCustomerDossierByName = (custName: string) => {
    if (!custName) return;
    const found = crm.customersList.find(
      (c) => c.name.trim().toLowerCase() === custName.trim().toLowerCase()
    );
    if (found) {
      setSelectedCustomerDossier(found);
    } else {
      setSelectedCustomerDossier({
        id: 0,
        name: custName,
        country: 'ایران',
        province: '',
        city: '',
        phone: '',
        address: '',
        notes: 'حساب ثبت‌شده در CRM'
      });
    }
  };

  const handleConvertToInvoice = async (lead: CRMLead) => {
    if (Number(lead.hasProforma) === 1) {
      toast.error('برای این پرونده فروش قبلاً پیش‌فاکتور صادر شده است. هر پرونده فروش تنها مجاز به داشتن یک پیش‌فاکتور می‌باشد.');
      return;
    }

    if (lead.stage !== 'proposal') {
      toast.error('صدور پیش‌فاکتور تنها برای لیدهایی که در مرحله "پیش‌فاکتور و پیشنهاد" هستند امکان‌پذیر است.');
      return;
    }

    try {
      toast.loading('در حال ثبت رسمی مشتری و انتقال به صدور پیش‌فاکتور...', { id: 'convert-lead' });
      const res = await fetchJson(`/crm/leads/${lead.id}/convert-to-customer`, { method: 'POST' });
      toast.dismiss('convert-lead');
      toast.success('مشتری با موفقیت در حساب‌ها ثبت گردید.');

      // Refresh leads list
      crm.loadAllData();

      // Navigate to create invoice page with pre-filled buyer details
      navigate('/remittances', {
        state: {
          crmLeadId: lead.id,
          buyerName: res.customer?.name || lead.customerName || lead.company || lead.title,
          buyerPhone: res.customer?.phone || lead.phone || '',
          buyerAddress: res.customer?.address || lead.notes || '',
          notes: `صادره از پرونده فروش CRM #${lead.id} - ${lead.title}`,
          status: 'proforma',
          currency: lead.currency || 'IRR'
        }
      });
    } catch (err: any) {
      toast.dismiss('convert-lead');
      toast.error(err.message || 'خطا در تبدیل لید به مشتری');
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-[1700px] mx-auto space-y-6 text-right font-farsi">
      {/* Header & Stats Cards */}
      <CRMStatsCards
        stats={crm.stats}
        onOpenLeadModal={() => crm.openLeadModal()}
      />

      {/* Tabs & Search Filter Bar */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs space-y-4">
        {/* Date Filter Bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200/80">
          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-blue-600 shrink-0" />
            <span className="text-xs font-bold text-slate-700">فیلتر زمانی (هجری شمسی):</span>
            <div className="flex flex-wrap items-center gap-1">
              {[
                { key: '1m', label: 'یک ماه اخیر (پیش‌فرض)' },
                { key: '7d', label: '۷ روز اخیر' },
                { key: 'today', label: 'امروز' },
                { key: 'all', label: 'همه زمان‌ها' },
              ].map((p) => (
                <button
                  key={p.key}
                  onClick={() => crm.handleApplyPreset(p.key as any)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                    crm.datePreset === p.key
                      ? 'bg-blue-600 text-white shadow-2xs'
                      : 'bg-white text-slate-600 hover:bg-slate-200 border border-slate-200'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto text-xs">
            <span className="text-slate-500 text-[11px]">از:</span>
            <input
              type="text"
              placeholder="1403/01/01"
              value={crm.fromDate}
              onChange={(e) => {
                crm.setDatePreset('custom');
                crm.setFromDate(e.target.value);
              }}
              className="w-24 px-2 py-1 bg-white border border-slate-200 rounded-lg text-[11px] text-center font-mono outline-none focus:border-blue-500"
            />
            <span className="text-slate-500 text-[11px]">تا:</span>
            <input
              type="text"
              placeholder="1403/12/29"
              value={crm.toDate}
              onChange={(e) => {
                crm.setDatePreset('custom');
                crm.setToDate(e.target.value);
              }}
              className="w-24 px-2 py-1 bg-white border border-slate-200 rounded-lg text-[11px] text-center font-mono outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-100 pb-4">
          {/* Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0 custom-scrollbar">
            <button
              onClick={() => crm.setActiveTab('kanban')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                crm.activeTab === 'kanban'
                  ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/30'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80'
              }`}
            >
              <Briefcase size={15} />
              قیف فروش (Kanban)
            </button>

            <button
              onClick={() => crm.setActiveTab('list')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                crm.activeTab === 'list'
                  ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/30'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80'
              }`}
            >
              <Filter size={15} />
              جدول پرونده‌های فروش ({crm.leads.length})
            </button>

            <button
              onClick={() => crm.setActiveTab('activities')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                crm.activeTab === 'activities'
                  ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/30'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80'
              }`}
            >
              <PhoneCall size={15} />
              دفترچه تماس‌ها و اقدامات ({crm.activities.length})
            </button>

            <button
              onClick={() => crm.setActiveTab('followups')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                crm.activeTab === 'followups'
                  ? 'bg-amber-600 text-white shadow-sm shadow-amber-600/30'
                  : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
              }`}
            >
              <Clock size={15} />
              پیگیری‌های من ({crm.activities.filter((a) => a.nextFollowUpDate).length})
            </button>
          </div>

          {/* Search and Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 sm:w-64">
              <input
                type="text"
                placeholder="جستجو در عنوان، مشتری، شماره..."
                value={crm.searchTerm}
                onChange={(e) => crm.setSearchTerm(e.target.value)}
                className="w-full pr-9 pl-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-blue-500 focus:bg-white transition-all"
              />
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
            </div>

            <select
              value={crm.filterSeller}
              onChange={(e) => crm.setFilterSeller(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none focus:border-blue-500 cursor-pointer"
            >
              <option value="">همه فروشندگان</option>
              {crm.personnelList.map((p: any) => (
                <option key={p.id} value={String(p.id)}>
                  {p.fullName}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1">
              <SearchableSelect
                value={crm.filterCustomer}
                onChange={(val) => crm.setFilterCustomer(val)}
                className="max-w-[200px]"
                placeholder="همه مشتریان"
                options={(() => {
                  const list = Array.isArray(crm.customersList) ? crm.customersList : [];
                  return [{ value: '', label: 'همه مشتریان' }, ...list.map((c: any) => ({ value: c.name, label: c.name }))];
                })()}
              />
              {crm.filterCustomer && (
                <button
                  onClick={() => handleOpenCustomerDossierByName(crm.filterCustomer)}
                  className="p-2 bg-blue-100 hover:bg-blue-200 text-blue-900 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1 shrink-0"
                  title="مشاهده پرونده جامع این مشتری"
                >
                  <Building2 size={14} />
                  پرونده مشتری
                </button>
              )}
            </div>

            <select
              value={crm.filterStage}
              onChange={(e) => crm.setFilterStage(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none focus:border-blue-500 cursor-pointer"
            >
              <option value="">همه مراحل فروش</option>
              {STAGES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Tab 1: Kanban Pipeline */}
        {crm.activeTab === 'kanban' && (
          <CRMKanbanPipeline
            leads={crm.leads}
            onOpenLeadDrawer={crm.openLeadDrawer}
            onOpenActivityModal={crm.openActivityModal}
            onOpenLeadModal={crm.openLeadModal}
            onDeleteLead={crm.handleDeleteLead}
            onStageChange={crm.handleStageChange}
            onConvertToInvoice={handleConvertToInvoice}
          />
        )}

        {/* Tab 2: Leads List Table */}
        {crm.activeTab === 'list' && (
          <CRMLeadsTable
            leads={crm.leads}
            onOpenLeadDrawer={crm.openLeadDrawer}
            onOpenActivityModal={crm.openActivityModal}
            onOpenLeadModal={crm.openLeadModal}
            onDeleteLead={crm.handleDeleteLead}
            onConvertToInvoice={handleConvertToInvoice}
            onOpenCustomerDossier={handleOpenCustomerDossierByName}
          />
        )}

        {/* Tab 3 & 4: Activities & Followups */}
        {(crm.activeTab === 'activities' || crm.activeTab === 'followups') && (
          <CRMFollowupsView
            activeTab={crm.activeTab}
            activities={crm.activities}
            onOpenActivityModal={() => crm.openActivityModal()}
            onToggleFollowup={crm.handleToggleFollowup}
            personnelList={crm.personnelList}
          />
        )}
      </div>

      {/* Modal 1 & 2: Activity Log & Followup Completion */}
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
        currentUser={user}
        currentLoggedInUser={crm.currentLoggedInUser}
        isFollowupResultModalOpen={crm.isFollowupResultModalOpen}
        onCloseFollowupResultModal={() => crm.setIsFollowupResultModalOpen(false)}
        selectedFollowupAct={crm.selectedFollowupAct}
        followupResultForm={crm.followupResultForm}
        setFollowupResultForm={crm.setFollowupResultForm}
        isSubmittingFollowupResult={crm.isSubmittingFollowupResult}
        onConfirmFollowupResult={crm.handleConfirmFollowupResult}
      />

      {/* Modal 3: Lead Create / Edit */}
      <CRMLeadModal
        isLeadModalOpen={crm.isLeadModalOpen}
        onCloseLeadModal={() => crm.setIsLeadModalOpen(false)}
        editingLead={crm.editingLead}
        leadForm={crm.leadForm}
        setLeadForm={crm.setLeadForm}
        isSavingLead={crm.isSavingLead}
        onSaveLead={crm.handleSaveLead}
        onDeleteLead={crm.handleDeleteLead}
        customersList={crm.customersList}
        personnelList={crm.personnelList}
        currentPersonnelId={crm.currentPersonnelId}
        currentLoggedInUser={crm.currentLoggedInUser}
        isAdminOrManager={crm.isAdminOrManager}
      />

      {/* Drawer: Lead Detail Timeline */}
      <CRMLeadDrawer
        selectedLeadDrawer={crm.selectedLeadDrawer}
        onCloseDrawer={() => crm.setSelectedLeadDrawer(null)}
        drawerActivities={crm.drawerActivities}
        onOpenActivityModal={crm.openActivityModal}
        onOpenLeadModal={crm.openLeadModal}
        onDeleteLead={crm.handleDeleteLead}
        onToggleFollowup={crm.handleToggleFollowup}
        onConvertToInvoice={handleConvertToInvoice}
        onOpenCustomerDossier={handleOpenCustomerDossierByName}
        isAdminOrManager={crm.isAdminOrManager}
      />

      {/* Drawer: Full Customer Dossier */}
      <CustomerDossierDrawer
        customer={selectedCustomerDossier}
        onClose={() => setSelectedCustomerDossier(null)}
        allLeads={crm.leads}
        allActivities={crm.activities}
        onOpenLeadDrawer={crm.openLeadDrawer}
        onOpenLeadModal={(lead, defaultCustName) => {
          crm.openLeadModal(lead);
          if (defaultCustName) {
            crm.setLeadForm((prev: any) => ({ ...prev, customerName: defaultCustName }));
          }
        }}
        onOpenActivityModal={(lead, defaultCustName, defaultCustId) => {
          crm.openActivityModal(lead, 'call', defaultCustName, defaultCustId);
          if (defaultCustName || defaultCustId) {
            crm.setActivityForm((prev: any) => ({
              ...prev,
              customerName: defaultCustName || prev.customerName,
              customerId: defaultCustId || prev.customerId
            }));
          }
        }}
        onEditCustomer={(cust) => {
          setSelectedCustomerDossier(null);
          navigate('/customers', { state: { editCustomerId: cust.id, editCustomer: cust } });
        }}
      />
    </div>
  );
}
