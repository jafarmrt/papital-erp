import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Filter, Briefcase, PhoneCall, Clock, Building2, TrendingUp, Loader2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { CRMLead, Customer } from '../types';
import { errorMessageOf, formatPersianNumber } from '../utils';
import { useCRMData, STAGES } from '../hooks/useCRMData';
import { CRMStatsCards } from '../components/crm/CRMStatsCards';
import { CRMKanbanPipeline } from '../components/crm/CRMKanbanPipeline';
import { CRMLeadsTable } from '../components/crm/CRMLeadsTable';
import { CRMFollowupsView } from '../components/crm/CRMFollowupsView';
import { CrmInteractionModalHost, CrmCustomerDossierHost, CrmLeadModalHost } from '../components/crm/crmSharedHosts';
import { SearchableSelect } from '../components/SearchableSelect';
import { CRMLeadDrawer } from '../components/crm/CRMLeadDrawer';
import { CrmDateRangeBar } from '../components/crm/CrmDateRangeBar';
import { useCrmDeepLink } from '../hooks/useCrmDeepLink';
import { DOSSIER_PARTY_MISSING_TEXT } from '../lib/crm/crmDeepLink';
import { useDossierPartyFinder } from '../hooks/crm/useDossierParty';
import { PICK_LIST_URLS } from '../lib/permissions/pickLists';
import { pickListServerSearchUrl } from '../lib/permissions/pickListCap';
import { boardCapNotice } from '../lib/crm/crmListPages';
import { leadProformaState } from '../lib/crm/leadProformaState';
import { canIssueLeadProforma } from '../lib/crm/leadProformaRule';
import { CRMFunnelReport } from '../components/crm/CRMFunnelReport';
import { LostReasonDialog } from '../components/crm/LostReasonFields';
import { CustomerTagFilter } from '../components/customers/CustomerTags';
import { useCustomerTagsQuery } from '../hooks/queries/useCustomerTagQueries';
import { useConvertLeadToCustomerMutation } from '../hooks/queries/useCustomerQueries';
import { personnelNameOption, personnelServerSearchUrl } from '../lib/personnel/personnelList';

const filterPartyOption = (c: { id: number; name: string }) => ({ value: String(c.id), label: c.name });

export default function CRMPage({ user }: { user: any }) {
  const crm = useCRMData(user);
  const { data: tagOptions = [] } = useCustomerTagsQuery();
  const deleteLead = crm.canDeleteLead ? crm.handleDeleteLead : undefined;
  const navigate = useNavigate();
  const [selectedCustomerDossier, setSelectedCustomerDossier] = useState<Customer | null>(null);

  // v10.2 package 7 (OBS-R2-24): the dossier of the file's own party, never a made-up party with id 0
  // v11 phase 6.1ch (C13): a party the cut pick list lacks is read from the server (`useDossierPartyFinder`)
  const findDossierParty = useDossierPartyFinder(crm.customersList as Customer[]);
  const handleOpenLeadDossier = (lead: CRMLead) => {
    findDossierParty(lead).then(
      (party) => {
        if (party) setSelectedCustomerDossier(party);
        else toast.error(DOSSIER_PARTY_MISSING_TEXT);
      },
      (err: unknown) => toast.error(errorMessageOf(err) || DOSSIER_PARTY_MISSING_TEXT),
    );
  };

  // a party named by a link waits for the party pick list
  const [pendingPartyId, setPendingPartyId] = useState<number | null>(null);
  const findPendingParty = useEffectEvent((partyId: number, isCancelled: () => boolean) => {
    const done = (party: Customer | null) => {
      if (isCancelled()) return;
      setPendingPartyId(null);
      if (party) setSelectedCustomerDossier(party);
      else toast.error('طرف حساب این اقدام پیدا نشد.');
    };
    findDossierParty({ customerId: partyId }).then(done, () => done(null));
  });
  useEffect(() => {
    if (pendingPartyId === null || !crm.pickListsReady) return undefined;
    // a later link (or leaving the page) drops this one's answer
    let cancelled = false;
    findPendingParty(pendingPartyId, () => cancelled);
    return () => { cancelled = true; };
  }, [pendingPartyId, crm.pickListsReady]);

  useCrmDeepLink({
    openLead: (lead) => crm.openLeadDrawer(lead),
    openParty: setPendingPartyId,
    openActivities: () => crm.setActiveTab('activities'),
  });

  // v10.2 package 7 (OBS-R2-31): one conversion at a time; a second click while it runs does nothing
  const convertingRef = useRef(false);
  const convertLead = useConvertLeadToCustomerMutation();
  const [convertingLeadId, setConvertingLeadId] = useState<number | null>(null);

  const handleConvertToInvoice = async (lead: CRMLead) => {
    if (Number(lead.hasProforma) === 1) {
      toast.error('برای این پرونده فروش قبلاً پیش‌فاکتور صادر شده است. هر پرونده فروش تنها مجاز به داشتن یک پیش‌فاکتور است.');
      return;
    }

    // v11 6.3p (U17): any open lead; the saved proforma moves it to «پیش‌فاکتور و پیشنهاد», not the conversion
    if (!canIssueLeadProforma(lead)) {
      toast.error('پرونده فروش بسته‌شده («فروش موفق» یا «از دست رفته») پیش‌فاکتور تازه نمی‌گیرد.');
      return;
    }

    if (convertingRef.current) return;
    convertingRef.current = true;
    setConvertingLeadId(lead.id);
    try {
      toast.loading('در حال ثبت رسمی مشتری و انتقال به صدور پیش‌فاکتور...', { id: 'convert-lead' });
      const res = await convertLead.mutateAsync(lead.id);
      toast.dismiss('convert-lead');
      toast.success('مشتری با موفقیت در حساب‌ها ثبت گردید.');

      // Navigate to create invoice page with pre-filled buyer details
      // v10.0.177 (OBS-R2-30): نشانی خریدار فقط از مشتری، نه یادداشت پرونده؛ v10.0.213 (OBS-R1-102): فرم فاکتور فروش
      void navigate('/invoices/create', { state: leadProformaState(lead, res.customer) });
    } catch (err) {
      toast.dismiss('convert-lead');
      toast.error(errorMessageOf(err) || 'خطا در تبدیل پرونده فروش به مشتری');
    } finally {
      convertingRef.current = false;
      setConvertingLeadId(null);
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
        <CrmDateRangeBar
          datePreset={crm.datePreset}
          fromDate={crm.fromDate}
          toDate={crm.toDate}
          onPreset={crm.handleApplyPreset}
          onFromDate={(iso) => {
            crm.setDatePreset('custom');
            crm.setFromDate(iso);
          }}
          onToDate={(iso) => {
            crm.setDatePreset('custom');
            crm.setToDate(iso);
          }}
        />

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
              قیف فروش
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
              جدول پرونده‌های فروش
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
              دفترچه تماس‌ها و اقدامات
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
              {/* v9.0.14 (TD-428): شمار پیگیری‌های باز از سرور، بی بازه تاریخ اقدام */}
              پیگیری‌های من ({formatPersianNumber(crm.stats.openFollowupsCount ?? 0)})
            </button>

            <button
              onClick={() => crm.setActiveTab('funnel')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                crm.activeTab === 'funnel' ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30' : 'bg-indigo-50 text-indigo-800 hover:bg-indigo-100'
              }`}
            >
              <TrendingUp size={15} />
              گزارش قیف
            </button>
          </div>

          {/* Search and Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 sm:w-64">
              <input
                type="text"
                placeholder="جست‌وجو در عنوان، مشتری، شماره..."
                value={crm.searchTerm}
                onChange={(e) => crm.setSearchTerm(e.target.value)}
                className="w-full pr-9 pl-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-blue-500 focus:bg-white transition-all"
              />
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
            </div>

            {/* v10.2 package 7 (OBS-R2-32): the seller is picked with search, like the party */}
            <SearchableSelect
              value={crm.filterSeller}
              onChange={(val) => crm.setFilterSeller(val)}
              className="max-w-[200px]"
              placeholder="همه فروشندگان"
              options={[
                { value: '', label: 'همه فروشندگان' },
                ...(Array.isArray(crm.personnelList) ? crm.personnelList : []).map(personnelNameOption),
              ]}
              // 10.3 package 6 (TD-1362): a list cut at the cap also searches the active personnel on the server
              serverSearchUrl={personnelServerSearchUrl(Array.isArray(crm.personnelList) ? crm.personnelList : [], { activeOnly: true })}
              mapResultToOption={personnelNameOption}
            />

            <div className="flex items-center gap-1">
              <SearchableSelect
                value={crm.filterCustomer}
                onChange={(val) => crm.setFilterCustomer(val)}
                className="max-w-[200px]"
                placeholder="همه مشتریان"
                options={(() => {
                  const list = Array.isArray(crm.customersList) ? crm.customersList : [];
                  // v9.0.15 (TD-429): مقدار گزینه شناسه طرف حساب است، نه نام
                  return [{ value: '', label: 'همه مشتریان' }, ...list.map(filterPartyOption)];
                })()}
                // v11 phase 6.1ch (C13): a party list cut at the cap also searches on the server
                serverSearchUrl={pickListServerSearchUrl(Array.isArray(crm.customersList) ? crm.customersList : [], PICK_LIST_URLS.customers)}
                mapResultToOption={filterPartyOption}
              />
              {crm.filterCustomer && (
                <button
                  onClick={() => {
                    findDossierParty({ customerId: Number(crm.filterCustomer) }).then(
                      (party) => { if (party) setSelectedCustomerDossier(party); },
                      (err: unknown) => toast.error(errorMessageOf(err) || DOSSIER_PARTY_MISSING_TEXT),
                    );
                  }}
                  className="p-2 bg-blue-100 hover:bg-blue-200 text-blue-900 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1 shrink-0"
                  title="مشاهده پرونده جامع این مشتری"
                >
                  <Building2 size={14} />
                  پرونده مشتری
                </button>
              )}
            </div>

            {/* v10.1.23 (N-02 بخش ۳): پرونده‌های طرف حساب‌های یک برچسب */}
            <CustomerTagFilter
              id="crm-tag-filter"
              tags={tagOptions}
              value={crm.filterTag ? Number(crm.filterTag) : null}
              onChange={(tagId) => crm.setFilterTag(tagId === null ? '' : String(tagId))}
            />

            <select
              aria-label="مرحله فروش"
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

        {/* v10.2 package 7 (OBS-R2-31): the page says it is loading and shows a failed load with a retry */}
        {crm.loading && (
          <p className="text-xs text-blue-700 flex items-center gap-1" role="status">
            <Loader2 size={13} className="animate-spin" /> در حال دریافت…
          </p>
        )}
        {crm.loadError && (
          <div className="flex items-center justify-between gap-2 p-3 rounded-xl border border-rose-200 bg-rose-50 text-xs text-rose-700" role="alert">
            <span>{crm.loadError}</span>
            <button type="button" onClick={() => void crm.loadAllData()} className="px-3 py-1 rounded-lg bg-white border border-rose-200 font-bold cursor-pointer">
              تلاش دوباره
            </button>
          </div>
        )}

        {/* Tab 1: Kanban Pipeline */}
        {crm.activeTab === 'kanban' && boardCapNotice(crm.leads.length) && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-2.5">{boardCapNotice(crm.leads.length)}</p>
        )}
        {crm.activeTab === 'kanban' && (
          <CRMKanbanPipeline
            leads={crm.leads}
            onOpenLeadDrawer={crm.openLeadDrawer}
            onOpenActivityModal={crm.openActivityModal}
            onOpenLeadModal={crm.openLeadModal}
            onDeleteLead={deleteLead}
            onStageChange={crm.handleStageChange}
            onConvertToInvoice={handleConvertToInvoice}
          />
        )}

        {/* Tab 2: Leads List Table */}
        {crm.activeTab === 'list' && (
          <CRMLeadsTable
            filterQuery={crm.leadFilterQuery}
            onOpenLeadDrawer={crm.openLeadDrawer}
            onOpenActivityModal={crm.openActivityModal}
            onOpenLeadModal={crm.openLeadModal}
            onDeleteLead={deleteLead}
            onConvertToInvoice={handleConvertToInvoice}
            onOpenCustomerDossier={handleOpenLeadDossier}
            convertingLeadId={convertingLeadId}
          />
        )}

        {/* Tab 3 & 4: Activities & Followups */}
        {(crm.activeTab === 'activities' || crm.activeTab === 'followups') && (
          <CRMFollowupsView
            activeTab={crm.activeTab}
            fromDate={crm.fromDate}
            toDate={crm.toDate}
            onOpenActivityModal={() => crm.openActivityModal()}
            onToggleFollowup={crm.handleToggleFollowup}
            onEditActivity={crm.openEditActivity}
            onDeleteActivity={crm.handleDeleteActivity}
            personnelList={crm.personnelList}
          />
        )}

        {crm.activeTab === 'funnel' && <CRMFunnelReport personnelList={crm.personnelList} />}
      </div>

      {/* Modal 1 & 2: Activity Log & Followup Completion */}
      <CrmInteractionModalHost crm={crm} currentUser={user} />

      {/* Modal 3: Lead Create / Edit */}
      <CrmLeadModalHost crm={crm} />

      {/* Drawer: Lead Detail Timeline */}
      <CRMLeadDrawer
        selectedLeadDrawer={crm.selectedLeadDrawer}
        onCloseDrawer={() => crm.setSelectedLeadDrawer(null)}
        drawerActivities={crm.drawerActivities}
        drawerAttachments={crm.drawerAttachments}
        onOpenActivityModal={crm.openActivityModal}
        onOpenLeadModal={crm.openLeadModal}
        onDeleteLead={deleteLead}
        onToggleFollowup={crm.handleToggleFollowup}
        onEditActivity={crm.openEditActivity}
        onDeleteActivity={crm.handleDeleteActivity}
        onConvertToInvoice={handleConvertToInvoice}
        onOpenCustomerDossier={handleOpenLeadDossier}
      />

      {crm.lostPromptLeadId !== null && (
        <LostReasonDialog
          leadTitle={crm.leads.find((l) => l.id === crm.lostPromptLeadId)?.title ?? ''}
          onCancel={() => crm.setLostPromptLeadId(null)}
          onConfirm={(lost) => crm.handleStageChange(crm.lostPromptLeadId as number, 'lost', lost)}
        />
      )}

      {/* Drawer: Full Customer Dossier */}
      <CrmCustomerDossierHost
        crm={crm}
        customer={selectedCustomerDossier}
        onClose={() => setSelectedCustomerDossier(null)}
        onEditCustomer={(cust) => {
          setSelectedCustomerDossier(null);
          // v10.2 package 7 (OBS-R2-24): the customers page reads the full record by id (a pick-list row has no version)
          void navigate('/customers', { state: { editCustomerId: cust.id } });
        }}
      />
    </div>
  );
}
