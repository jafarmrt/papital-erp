import { useState, useEffect, useCallback, useMemo, useRef, FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../api';
import { CRMLead, CRMActivity } from '../types';
import { getTodayJalaliDate, getFutureJalaliDate, errorMessageOf, isoToJalaliDate } from '../utils';
import toast from 'react-hot-toast';
import { confirmAction } from '../components/ConfirmDialogHost';
import { useCRMFilters, buildLeadQueryParams } from './useCRMFilters';
import { useDebounce } from './useDebounce';
import type { CrmStats } from '../lib/crm/leadCurrencyTotals';
import { QUERY_KEYS } from '../lib/queryKeys';
import { crmLeadDetailKey, useCrmActivePersonnelQuery, useCrmBoardLeadsQuery, useCrmStatsQuery } from './queries/useCrmQueries';
import { useCustomerOptionsQuery } from './queries/useCustomerQueries';
import { useSimpleUsersQuery } from './queries/useSimpleUsersQuery';
import { useHasPermission } from '../contexts/AuthContext';
import { activityPayload } from '../lib/crm/activityPayload';
import { useLeadDrawerActivities } from './useLeadDrawerActivities';
import { activityEditForm, activityEditPayload } from '../lib/crm/activityEdit';
import { lostReasonError } from '../lib/crm/leadFields';
import { WON_LEAD_MESSAGE, crmAssignablePersonnel } from '../lib/crm/crmScreenText';

export const STAGES = [
  { key: 'lead', title: 'مخاطب اولیه', color: 'bg-slate-100 border-slate-300 text-slate-700', badge: 'bg-slate-200 text-slate-800' },
  { key: 'qualified', title: 'ارزیابی و نیازسنجی', color: 'bg-amber-50 border-amber-200 text-amber-700', badge: 'bg-amber-100 text-amber-800' },
  { key: 'proposal', title: 'پیش‌فاکتور و پیشنهاد', color: 'bg-purple-50 border-purple-200 text-purple-700', badge: 'bg-purple-100 text-purple-800' },
  { key: 'won', title: 'موفق (بسته شد)', color: 'bg-emerald-50 border-emerald-300 text-emerald-800', badge: 'bg-emerald-100 text-emerald-800' },
  { key: 'lost', title: 'ناموفق (انصراف)', color: 'bg-rose-50 border-rose-200 text-rose-700', badge: 'bg-rose-100 text-rose-800' },
];

const NO_ROWS: never[] = [];
const NO_STATS: Partial<CrmStats> = {};

export const SOURCES = ['تماس تلفنی', 'وبسایت', 'معرف', 'نمایشگاه', 'شبکه‌های اجتماعی', 'مراجع حضوری', 'سایر'];

/**
 * `withLists: false` (the customers page) loads only the pick lists the windows need: neither the statistics nor the
 * board's sales files, which that page never shows (v10.2 package 7, OBS-R2-31).
 */
export function useCRMData(user: any, options: { withLists?: boolean } = {}) {
  const withLists = options.withLists !== false;
  const currentLoggedInUser = user?.fullName || user?.full_name || user?.username || '';
  // v9.0.148 (TD-893): دکمه حذف پرونده فروش با همان مجوز API حذف (`crm.delete`)، نه با کد نقش
  const canDeleteLead = useHasPermission('crm.delete');

  const [activeTab, setActiveTab] = useState<'kanban' | 'list' | 'activities' | 'followups' | 'funnel'>('kanban');

  // V3.2.3 (TD-080 / Playbook Scenario 6): فیلترها به هوک اختصاصی useCRMFilters منتقل شدند
  const filters = useCRMFilters();
  const { searchTerm, filterSeller, filterStage, filterCustomer, filterTag } = filters;

  // Modals state
  const [isLeadModalOpen, setIsLeadModalOpen] = useState<boolean>(false);
  const [editingLead, setEditingLead] = useState<CRMLead | null>(null);

  const [isActivityModalOpen, setIsActivityModalOpen] = useState<boolean>(false);
  const [selectedLeadForActivity, setSelectedLeadForActivity] = useState<CRMLead | null>(null);

  const [selectedLeadDrawer, setSelectedLeadDrawer] = useState<CRMLead | null>(null);
  // 10.3 package 7: counts the drawer's openings, so showing the file it already shows reads it again
  const [leadDrawerOpening, setLeadDrawerOpening] = useState(0);
  // 10.3 (part 12): the drawer shows the file as its detail read it now, over the row it was opened from
  const { drawerLead, drawerActivities, drawerAttachments } = useLeadDrawerActivities(selectedLeadDrawer?.id ?? null, leadDrawerOpening);
  const shownLeadDrawer = useMemo(
    () => (selectedLeadDrawer && drawerLead?.id === selectedLeadDrawer.id ? { ...selectedLeadDrawer, ...drawerLead } : selectedLeadDrawer),
    [selectedLeadDrawer, drawerLead],
  );

  // Followup completion result modal state
  const [isFollowupResultModalOpen, setIsFollowupResultModalOpen] = useState<boolean>(false);
  const [selectedFollowupAct, setSelectedFollowupAct] = useState<CRMActivity | null>(null);
  const [followupResultForm, setFollowupResultForm] = useState({
    result: 'پاسخ داد و توافق شد',
    resultNote: ''
  });
  const [isSubmittingFollowupResult, setIsSubmittingFollowupResult] = useState<boolean>(false);

  // Form states
  const [leadForm, setLeadForm] = useState({
    title: '',
    customerId: '',
    customerName: '',
    phone: '',
    company: '',
    contacts: [] as any[],
    source: 'تماس تلفنی',
    stage: 'lead',
    estimatedValue: 0,
    currency: 'IRR',
    probability: 50,
    assignedTo: currentLoggedInUser,
    assignedPersonnelId: null as number | null,
    expectedCloseDate: getFutureJalaliDate(30),
    notes: '',
    lostReason: '',
    lostReasonNote: ''
  });

  const [activityForm, setActivityForm] = useState({
    type: 'call',
    title: 'تماس تلفنی با مشتری',
    description: '',
    result: 'پاسخ داد',
    activityDate: getTodayJalaliDate(),
    nextFollowUpDate: '',
    nextFollowUpTask: '',
    assignedTo: currentLoggedInUser,
    assignedPersonnelId: null as number | null,
    mentions: [] as number[],
    customerName: '',
    customerId: null as number | null
  });

  const [isSavingLead, setIsSavingLead] = useState<boolean>(false);
  const [isSavingActivity, setIsSavingActivity] = useState<boolean>(false);
  // v10.1.18 (N-02 بخش ۲): اقدامی که پنجره اقدام ویرایشش می‌کند، و پرونده‌ای که برای رفتن به «از دست رفته» دلیل می‌خواهد
  const [editingActivity, setEditingActivity] = useState<CRMActivity | null>(null);
  const [lostPromptLeadId, setLostPromptLeadId] = useState<number | null>(null);

  const queryClient = useQueryClient();
  // v10.2 package 7 (OBS-R2-31): typing in the search box waits for a pause before asking the server
  const debouncedSearch = useDebounce(searchTerm, 300);
  // the search conditions of the board and the server-paged table, with the search box's text after its pause
  const leadFilterQuery = useMemo(
    () => buildLeadQueryParams({ searchTerm: debouncedSearch, filterSeller, filterStage, filterCustomer, filterTag }).toString(),
    [debouncedSearch, filterSeller, filterStage, filterCustomer, filterTag],
  );

  // v10.2 package 11 part 5a (TD-1329, OBS-R2-102): the statistics, the board and the pick lists come from React Query;
  // the pick lists (parties, personnel, users for mentions) share the other forms' cache, load once and a failure is shown
  const statsQuery = useCrmStatsQuery(withLists);
  const boardQuery = useCrmBoardLeadsQuery(leadFilterQuery, withLists);
  const customersQuery = useCustomerOptionsQuery();
  // V10-4.1: فروشنده مسئول از پرسنل؛ v10.2.0: everyone but a personnel who left, asked of the server (TD-1321)
  const personnelQuery = useCrmActivePersonnelQuery<{ employmentStatus?: string | null }>();
  const mentionQuery = useSimpleUsersQuery();

  const stats = statsQuery.data ?? NO_STATS;
  const leads = boardQuery.data ?? NO_ROWS;
  const customersList: any[] = customersQuery.data ?? NO_ROWS;
  const personnelList: any[] = useMemo(() => crmAssignablePersonnel(personnelQuery.data ?? []), [personnelQuery.data]);
  const mentionUsers: any[] = mentionQuery.data ?? NO_ROWS;
  const pickLists = [[customersQuery, 'مشتریان'], [personnelQuery, 'پرسنل'], [mentionQuery, 'کاربران']] as const;
  const pickListsReady = pickLists.every(([q]) => !q.isPending);
  const failedPickLists = pickLists.filter(([q]) => q.isError).map(([, label]) => label).join('، ');
  const pickFailureShown = useRef(false);
  useEffect(() => {
    if (!pickListsReady || !failedPickLists || pickFailureShown.current) return;
    pickFailureShown.current = true;
    toast.error(`فهرست ${failedPickLists} دریافت نشد؛ صفحه را دوباره باز کنید.`);
  }, [pickListsReady, failedPickLists]);

  const loading = withLists && (statsQuery.isFetching || boardQuery.isFetching);
  const loadProblems = withLists ? [statsQuery.isError && 'آمار', boardQuery.isError && 'پرونده‌های فروش'].filter(Boolean) : [];
  const loadError = loadProblems.length > 0 ? `دریافت ${loadProblems.join(' و ')} ناموفق بود.` : null;

  // v9.0.14 (TD-428) / v10.2 package 7: the server-paged lists, the statistics and the board refresh with every reload;
  // 10.3 (part 12): every sales read does (`crm`): the open file drawer, its attachments, the funnel and the dashboard
  // widget too, none of which waited for this before
  const loadAllData = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crm.all });
  }, [queryClient]);

  // V10-4.1: پرسنل متصل به کاربر جاری — پیش‌فرض انتخاب فروشنده
  const currentPersonnel = personnelList.find((p: any) => p.userId && user?.id && Number(p.userId) === Number(user.id));
  const currentPersonnelId: number | null = currentPersonnel ? currentPersonnel.id : null;

  const openLeadModal = (lead?: CRMLead) => {
    const defaultSellerId = lead?.assignedPersonnelId ?? currentPersonnelId;
    const defaultSellerName = lead?.assignedTo || (currentPersonnel?.fullName ?? currentLoggedInUser);
    if (lead) {
      setEditingLead(lead);
      setLeadForm({
        title: lead.title,
        customerId: lead.customerId ? String(lead.customerId) : '',
        customerName: lead.customerName || '',
        phone: lead.phone || '',
        company: lead.company || '',
        contacts: Array.isArray(lead.contacts) ? lead.contacts : [],
        source: lead.source || 'تماس تلفنی',
        stage: lead.stage || 'lead',
        estimatedValue: lead.estimatedValue || 0,
        currency: lead.currency || 'IRR',
        probability: lead.probability ?? 50,
        assignedTo: defaultSellerName,
        assignedPersonnelId: defaultSellerId,
        // v7.0.132 (TD-232): تاریخ ذخیره‌شده میلادی ISO است؛ فرم شمسی می‌گیرد
        expectedCloseDate: isoToJalaliDate(lead.expectedCloseDate) || getFutureJalaliDate(30),
        notes: lead.notes || '',
        lostReason: lead.lostReason || '',
        lostReasonNote: lead.lostReasonNote || ''
      });
    } else {
      setEditingLead(null);
      setLeadForm({
        title: '',
        customerId: '',
        customerName: '',
        phone: '',
        company: '',
        contacts: [],
        source: 'تماس تلفنی',
        stage: 'lead',
        estimatedValue: 0,
        currency: 'IRR',
        probability: 50,
        assignedTo: defaultSellerName,
        assignedPersonnelId: defaultSellerId,
        expectedCloseDate: getFutureJalaliDate(30),
        notes: '',
        lostReason: '',
        lostReasonNote: ''
      });
    }
    setIsLeadModalOpen(true);
  };

  const handleSaveLead = async (e: FormEvent) => {
    e.preventDefault();
    if (!leadForm.title.trim()) {
      toast.error('لطفاً عنوان فرصت فروش را وارد کنید');
      return;
    }

    if (leadForm.stage === 'won' && (!editingLead || Number(editingLead.hasProforma) !== 1)) {
      toast.error('امکان انتقال پرونده فروش به مرحله "موفق بسته شد" وجود ندارد. ابتدا باید برای این پرونده فروش، پیش‌فاکتور صادر و ثبت کنید.');
      return;
    }

    // v10.1.18 (N-02 بخش ۲، ت۶): رفتن به «از دست رفته» دلیل از فهرست می‌خواهد؛ دلیل فقط با همین مرحله فرستاده می‌شود
    const { lostReason, lostReasonNote, ...leadFields } = leadForm;
    const enteringLost = leadForm.stage === 'lost' && editingLead?.stage !== 'lost';
    if (leadForm.stage === 'lost' && (enteringLost || lostReason)) {
      const lostError = lostReasonError(lostReason, lostReasonNote);
      if (lostError) {
        toast.error(lostError);
        return;
      }
    }

    setIsSavingLead(true);
    try {
      const payload = {
        ...leadFields,
        ...(leadForm.stage === 'lost' && lostReason ? { lostReason, lostReasonNote } : {}),
        estimatedValue: Number(leadForm.estimatedValue || 0),
        // v10.1.51 (OBS-R2-26): a probability of 0 stays 0
        probability: Number(leadForm.probability ?? 50),
        contacts: Array.isArray(leadForm.contacts) ? leadForm.contacts : []
      };

      if (editingLead) {
        await fetchJson(`/crm/leads/${editingLead.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
        toast.success('پرونده فروش با موفقیت به‌روزرسانی شد');
      } else {
        await fetchJson('/crm/leads', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        toast.success('فرصت فروش جدید با موفقیت ایجاد شد');
      }

      if (leadForm.stage === 'won') {
        toast.success(WON_LEAD_MESSAGE, { duration: 6000 });
      } else if (leadForm.stage === 'lost') {
        toast('💪 با تلاش بیشتر در فرصت‌های بعدی موفق خواهید شد! هر تجربه گامی به سوی فروش‌های بزرگ‌تر است.', { duration: 6000 });
      }

      setIsLeadModalOpen(false);
      void loadAllData();
    } catch (err) {
      toast.error(errorMessageOf(err) || 'خطا در ذخیره فرصت فروش');
    } finally {
      setIsSavingLead(false);
    }
  };

  // v10.2 package 7 (OBS-R2-31): one stage change per file at a time; a second drop waits for the first answer
  const changingStageIds = useRef(new Set<number>());
  const handleStageChange = async (leadId: number, newStage: string, lost?: { lostReason: string; lostReasonNote: string }) => {
    if (changingStageIds.current.has(leadId)) return;
    const targetLead = leads.find((l) => l.id === leadId);
    if (newStage === 'lost' && !lost && targetLead?.stage !== 'lost') {
      setLostPromptLeadId(leadId);
      return;
    }
    if (newStage === 'won' && (!targetLead || Number(targetLead.hasProforma) !== 1)) {
      toast.error('امکان انتقال پرونده فروش به مرحله "موفق بسته شد" وجود ندارد. ابتدا باید برای این پرونده فروش، پیش‌فاکتور صادر و ثبت کنید.');
      return;
    }

    changingStageIds.current.add(leadId);
    try {
      await fetchJson(`/crm/leads/${leadId}`, {
        method: 'PUT',
        body: JSON.stringify({ stage: newStage, ...(lost ?? {}) })
      });
      setLostPromptLeadId(null);
      if (newStage === 'won') {
        toast.success(WON_LEAD_MESSAGE, { duration: 6000 });
      } else if (newStage === 'lost') {
        toast('💪 با تلاش بیشتر در فرصت‌های بعدی موفق خواهید شد! هر تجربه گامی به سوی فروش‌های بزرگ‌تر است.', { duration: 6000 });
      } else {
        toast.success('مرحله فروش به‌روزرسانی شد');
      }
      void loadAllData();
    } catch (err) {
      toast.error(errorMessageOf(err) || 'خطا در تغییر مرحله فروش');
    } finally {
      changingStageIds.current.delete(leadId);
    }
  };

  const handleDeleteLead = async (leadId: number) => {
    if (!(await confirmAction({ title: 'حذف پرونده فروش', message: 'آیا از حذف این پرونده فروش اطمینان دارید؟' }))) return;
    try {
      await fetchJson(`/crm/leads/${leadId}`, { method: 'DELETE' });
      toast.success('فرصت فروش حذف شد');
      if (selectedLeadDrawer?.id === leadId) setSelectedLeadDrawer(null);
      // the deleted file's detail is dropped, not read again (the drawer may still watch it until it closes)
      queryClient.removeQueries({ queryKey: crmLeadDetailKey(leadId) });
      void loadAllData();
    } catch (err) {
      // v9.0.16 (TD-425): پیام سرور (پرونده دارای سند فعال، پرونده ناموجود)
      toast.error(errorMessageOf(err) || 'خطا در حذف فرصت فروش');
    }
  };

  // v10.1.18 (N-02 بخش ۲، ت۱ و ت۲): ویرایش در همان پنجره اقدام با نسخه اقدام، و حذف پس از تأیید
  const openEditActivity = (act: CRMActivity) => {
    setEditingActivity(act);
    setSelectedLeadForActivity(leads.find((l) => l.id === act.leadId) || null);
    setActivityForm({ ...activityEditForm(act), customerName: act.customerName || '', customerId: act.customerId ?? null });
    setIsActivityModalOpen(true);
  };

  const refreshAfterActivityChange = () => {
    void loadAllData();
  };

  const handleDeleteActivity = async (act: CRMActivity) => {
    if (!(await confirmAction({ title: 'حذف اقدام', message: `اقدام «${act.title}» حذف شود؟ از فهرست‌ها و یادآوری‌ها بیرون می‌رود.` }))) return;
    try {
      await fetchJson(`/crm/activities/${act.id}`, { method: 'DELETE' });
      toast.success('اقدام حذف شد');
      refreshAfterActivityChange();
    } catch (err) {
      toast.error(errorMessageOf(err) || 'خطا در حذف اقدام');
    }
  };

  const openActivityModal = (lead?: CRMLead, defaultType: string = 'call', defaultCustName?: string, defaultCustId?: number) => {
    setEditingActivity(null);
    setSelectedLeadForActivity(lead || null);

    let defaultTitle = 'تماس تلفنی جدید';
    if (defaultType === 'meeting') defaultTitle = 'جلسه با مشتری';
    else if (defaultType === 'whatsapp') defaultTitle = 'ارسال پیام / واتس‌اپ';
    else if (defaultType === 'email') defaultTitle = 'ارسال ایمیل';
    else if (defaultType === 'quote') defaultTitle = 'ثبت ارسال پیش‌فاکتور / پیشنهاد';
    else if (defaultType === 'note') defaultTitle = 'یادداشت جدید';

    if (lead) {
      defaultTitle = `${defaultTitle} - ${lead.customerName || lead.title}`;
    } else if (defaultCustName) {
      defaultTitle = `${defaultTitle} - ${defaultCustName}`;
    }

    setActivityForm({
      type: defaultType,
      title: defaultTitle,
      description: '',
      result: defaultType === 'quote' ? 'درخواست پیش‌فاکتور' : 'پاسخ داد',
      activityDate: getTodayJalaliDate(),
      nextFollowUpDate: '',
      nextFollowUpTask: '',
      // V10-4.1: مسئول تسک — پیش‌فرض پرسنل متصل به کاربر جاری، سپس فروشنده فرصت
      assignedTo: lead?.assignedTo || (currentPersonnel?.fullName ?? currentLoggedInUser),
      assignedPersonnelId: lead?.assignedPersonnelId ?? currentPersonnelId,
      mentions: [],
      customerName: lead?.customerName || defaultCustName || '',
      customerId: lead?.customerId || defaultCustId || null
    });
    setIsActivityModalOpen(true);
  };

  const handleSaveActivity = async (e: FormEvent) => {
    e.preventDefault();
    if (!activityForm.title.trim()) {
      toast.error('لطفاً عنوان تماس یا اقدام را وارد کنید');
      return;
    }

    setIsSavingActivity(true);
    try {
      // v10.0.31 (TD-973): an activity without a lead keeps the party the form was opened for
      if (editingActivity) {
        await fetchJson(`/crm/activities/${editingActivity.id}`, {
          method: 'PUT',
          body: JSON.stringify(activityEditPayload(activityForm, Number(editingActivity.version ?? 1)))
        });
        toast.success('اقدام ویرایش شد');
        setIsActivityModalOpen(false);
        setEditingActivity(null);
        refreshAfterActivityChange();
        return;
      }
      const payload = activityPayload(activityForm, selectedLeadForActivity);

      await fetchJson('/crm/activities', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      toast.success('اقدام/تماس با موفقیت ثبت شد');
      setIsActivityModalOpen(false);
      void loadAllData();
    } catch (err) {
      toast.error(errorMessageOf(err) || 'خطا در ثبت اقدام');
    } finally {
      setIsSavingActivity(false);
    }
  };

  const openLeadDrawer = (lead: CRMLead) => {
    setSelectedLeadDrawer(lead);
    setLeadDrawerOpening((n) => n + 1);
  };

  const reopeningFollowupIds = useRef(new Set<number>());
  const handleToggleFollowup = async (actInput: number | CRMActivity) => {
    const act = typeof actInput === 'number' ? drawerActivities.find((a) => a.id === actInput) : actInput;

    if (!act) return;

    if (!act.isFollowUpCompleted) {
      setSelectedFollowupAct(act);
      setFollowupResultForm({
        result: act.result || 'پاسخ داد و توافق شد',
        resultNote: ''
      });
      setIsFollowupResultModalOpen(true);
    } else {
      // v9.0.19 (TD-430): «بازگشایی» عمل صریح است و تا پاسخ درخواست قبلی همان پیگیری دوباره فرستاده نمی‌شود
      if (reopeningFollowupIds.current.has(act.id)) return;
      reopeningFollowupIds.current.add(act.id);
      try {
        await fetchJson(`/crm/activities/${act.id}/reopen-followup`, { method: 'PUT' });
        toast.success('پیگیری دوباره باز شد');
        void loadAllData();
      } catch (err) {
        toast.error(errorMessageOf(err) || 'خطا در بازگشایی پیگیری');
      } finally {
        reopeningFollowupIds.current.delete(act.id);
      }
    }
  };

  const handleConfirmFollowupResult = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedFollowupAct) return;

    setIsSubmittingFollowupResult(true);
    try {
      await fetchJson(`/crm/activities/${selectedFollowupAct.id}/complete-followup`, {
        method: 'PUT',
        body: JSON.stringify({
          result: followupResultForm.result,
          resultNote: followupResultForm.resultNote
        })
      });
      toast.success('نتیجه پیگیری ثبت و وضعیت آن تکمیل شد');
      setIsFollowupResultModalOpen(false);
      setSelectedFollowupAct(null);
      void loadAllData();
    } catch (err) {
      toast.error('خطا در ثبت نتیجه پیگیری');
    } finally {
      setIsSubmittingFollowupResult(false);
    }
  };

  return {
    currentLoggedInUser,
    canDeleteLead,
    activeTab,
    setActiveTab,
    stats,
    leads,
    customersList,
    personnelList,
    currentPersonnelId,
    mentionUsers,
    loading,
    loadError,
    pickListsReady,
    leadFilterQuery,
    searchTerm: filters.searchTerm,
    setSearchTerm: filters.setSearchTerm,
    filterSeller: filters.filterSeller,
    setFilterSeller: filters.setFilterSeller,
    filterStage: filters.filterStage,
    setFilterStage: filters.setFilterStage,
    filterCustomer: filters.filterCustomer,
    setFilterCustomer: filters.setFilterCustomer,
    filterTag: filters.filterTag,
    setFilterTag: filters.setFilterTag,
    datePreset: filters.datePreset,
    setDatePreset: filters.setDatePreset,
    fromDate: filters.fromDate,
    setFromDate: filters.setFromDate,
    toDate: filters.toDate,
    setToDate: filters.setToDate,
    handleApplyPreset: filters.handleApplyPreset,
    isLeadModalOpen,
    setIsLeadModalOpen,
    editingLead,
    leadForm,
    setLeadForm,
    isSavingLead,
    openLeadModal,
    handleSaveLead,
    handleStageChange,
    handleDeleteLead,
    isActivityModalOpen,
    setIsActivityModalOpen,
    selectedLeadForActivity,
    setSelectedLeadForActivity,
    activityForm,
    setActivityForm,
    isSavingActivity,
    openActivityModal,
    handleSaveActivity,
    editingActivity,
    openEditActivity,
    handleDeleteActivity,
    lostPromptLeadId,
    setLostPromptLeadId,
    selectedLeadDrawer: shownLeadDrawer,
    setSelectedLeadDrawer,
    drawerActivities,
    drawerAttachments,
    openLeadDrawer,
    handleToggleFollowup,
    isFollowupResultModalOpen,
    setIsFollowupResultModalOpen,
    selectedFollowupAct,
    followupResultForm,
    setFollowupResultForm,
    isSubmittingFollowupResult,
    handleConfirmFollowupResult,
    loadAllData
  };
}
