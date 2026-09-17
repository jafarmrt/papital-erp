import { useState, useEffect, useCallback, FormEvent } from 'react';
import { fetchJson } from '../api';
import { CRMLead, CRMActivity } from '../types';
import { getTodayJalaliDate, getFutureJalaliDate } from '../utils';
import toast from 'react-hot-toast';
import { confirmAction } from '../components/ConfirmDialogHost';
import { useCRMFilters, normalizeLeadStage, buildLeadQueryParams, buildActivityQueryParams } from './useCRMFilters';

export const STAGES = [
  { key: 'lead', title: 'مخاطب اولیه', color: 'bg-slate-100 border-slate-300 text-slate-700', badge: 'bg-slate-200 text-slate-800' },
  { key: 'qualified', title: 'ارزیابی و نیازسنجی', color: 'bg-amber-50 border-amber-200 text-amber-700', badge: 'bg-amber-100 text-amber-800' },
  { key: 'proposal', title: 'پیش‌فاکتور و پیشنهاد', color: 'bg-purple-50 border-purple-200 text-purple-700', badge: 'bg-purple-100 text-purple-800' },
  { key: 'won', title: 'موفق (بسته شد)', color: 'bg-emerald-50 border-emerald-300 text-emerald-800', badge: 'bg-emerald-100 text-emerald-800' },
  { key: 'lost', title: 'ناموفق (انصراف)', color: 'bg-rose-50 border-rose-200 text-rose-700', badge: 'bg-rose-100 text-rose-800' },
];

export const SOURCES = ['تماس تلفنی', 'وبسایت', 'معرف', 'نمایشگاه', 'شبکه‌های اجتماعی', 'مراجع حضوری', 'سایر'];

export function useCRMData(user: any) {
  const currentLoggedInUser = user?.fullName || user?.full_name || user?.username || '';
  const isAdminOrManager = user?.role === 'admin' || user?.role === 'manager';

  const [activeTab, setActiveTab] = useState<'kanban' | 'list' | 'activities' | 'followups'>('kanban');
  const [stats, setStats] = useState<any>({});
  const [leads, setLeads] = useState<CRMLead[]>([]);
  const [activities, setActivities] = useState<CRMActivity[]>([]);
  const [customersList, setCustomersList] = useState<any[]>([]);
  // V10-4.1: منبع «فروشنده مسئول» اکنون پرسنل فعال است (نه users)
  const [personnelList, setPersonnelList] = useState<any[]>([]);
  // کاربران سیستم فقط برای قابلیت منشن (@) در توضیحات اقدامات
  const [mentionUsers, setMentionUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // V3.2.3 (TD-080 / Playbook Scenario 6): فیلترها به هوک اختصاصی useCRMFilters منتقل شدند
  const filters = useCRMFilters();
  const { searchTerm, filterSeller, filterStage, filterCustomer, fromDate, toDate } = filters;

  // Modals state
  const [isLeadModalOpen, setIsLeadModalOpen] = useState<boolean>(false);
  const [editingLead, setEditingLead] = useState<CRMLead | null>(null);

  const [isActivityModalOpen, setIsActivityModalOpen] = useState<boolean>(false);
  const [selectedLeadForActivity, setSelectedLeadForActivity] = useState<CRMLead | null>(null);

  const [selectedLeadDrawer, setSelectedLeadDrawer] = useState<CRMLead | null>(null);
  const [drawerActivities, setDrawerActivities] = useState<CRMActivity[]>([]);

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
    notes: ''
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

  const loadAllData = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      // Fetch stats
      try {
        const statsRes = await fetchJson('/crm/stats', { signal });
        setStats(statsRes || {});
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
        console.error('Could not load CRM stats:', e);
      }

      // Build query
      const params = buildLeadQueryParams({ searchTerm, filterSeller, filterStage, filterCustomer });

      try {
        const leadsRes = await fetchJson(`/crm/leads?${params.toString()}`, { signal });
        const rawLeads = Array.isArray(leadsRes?.data) ? leadsRes.data : (Array.isArray(leadsRes) ? leadsRes : []);
        const mappedLeads = rawLeads.map((l: CRMLead) => ({ ...l, stage: normalizeLeadStage(l.stage) }));
        setLeads(mappedLeads);
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
        console.error('Could not load CRM leads:', e);
        toast.error('خطا در دریافت سرنخ‌های CRM');
      }

      const actParams = buildActivityQueryParams(fromDate, toDate);

      try {
        const actRes = await fetchJson(`/crm/activities?${actParams.toString()}`, { signal });
        setActivities(Array.isArray(actRes) ? actRes : []);
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
        console.error('Could not load CRM activities:', e);
        toast.error('خطا در دریافت فعالیت‌های CRM');
      }

      // Load customers
      try {
        const custRes = await fetchJson('/customers?limit=1000', { signal });
        if (Array.isArray(custRes)) {
          setCustomersList(custRes);
        } else if (custRes && Array.isArray(custRes.data)) {
          setCustomersList(custRes.data);
        }
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
        console.error('Could not load customers for CRM:', e);
      }

      // V10-4.1: بارگذاری پرسنل فعال — فروشنده مسئول از پرسنل انتخاب می‌شود
      try {
        const perRes = await fetchJson('/personnel?limit=1000', { signal });
        const perData = Array.isArray(perRes) ? perRes : (Array.isArray(perRes?.data) ? perRes.data : []);
        const activePeople = perData.filter((p: any) => (p.employmentStatus || 'فعال') === 'فعال');
        setPersonnelList(activePeople);
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
        console.error('Could not load personnel for CRM:', e);
      }

      // کاربران سیستم صرفاً برای منشن‌ها
      try {
        const usersRes = await fetchJson('/users/list-simple', { signal }).catch((err) => {
          if (err?.name === 'AbortError') throw err;
          return fetchJson('/users', { signal });
        });
        if (Array.isArray(usersRes)) {
          setMentionUsers(usersRes);
        }
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
        console.error('Could not load mention users:', e);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Error loading CRM data:', err);
      toast.error('خطا در دریافت اطلاعات CRM');
    } finally {
      setLoading(false);
    }
  }, [searchTerm, filterSeller, filterStage, filterCustomer, fromDate, toDate]);

  useEffect(() => {
    const controller = new AbortController();
    loadAllData(controller.signal);
    return () => {
      controller.abort();
    };
  }, [loadAllData]);

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
        expectedCloseDate: lead.expectedCloseDate || getFutureJalaliDate(30),
        notes: lead.notes || ''
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
        notes: ''
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

    setIsSavingLead(true);
    try {
      const payload = {
        ...leadForm,
        estimatedValue: Number(leadForm.estimatedValue || 0),
        probability: Number(leadForm.probability || 50),
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
        toast.success('🎉 عالی بود! معامله با موفقیت بسته شد. همزمان اعلان ثبت پیش‌فاکتور به واحد انبار ارسال شد.', { duration: 6000 });
      } else if (leadForm.stage === 'lost') {
        toast('💪 با تلاش بیشتر در فرصت‌های بعدی موفق خواهید شد! هر تجربه گامی به سوی فروش‌های بزرگ‌تر است.', { duration: 6000 });
      }

      setIsLeadModalOpen(false);
      loadAllData();
    } catch (err) {
      toast.error(err.message || 'خطا در ذخیره فرصت فروش');
    } finally {
      setIsSavingLead(false);
    }
  };

  const handleStageChange = async (leadId: number, newStage: string) => {
    const targetLead = leads.find((l) => l.id === leadId);
    if (newStage === 'won' && (!targetLead || Number(targetLead.hasProforma) !== 1)) {
      toast.error('امکان انتقال پرونده فروش به مرحله "موفق بسته شد" وجود ندارد. ابتدا باید برای این پرونده فروش، پیش‌فاکتور صادر و ثبت کنید.');
      return;
    }

    try {
      await fetchJson(`/crm/leads/${leadId}`, {
        method: 'PUT',
        body: JSON.stringify({ stage: newStage })
      });
      if (newStage === 'won') {
        toast.success('🎉 عالی بود! معامله با موفقیت بسته شد. همزمان اعلان ثبت پیش‌فاکتور به واحد انبار ارسال گردید.', { duration: 6000 });
      } else if (newStage === 'lost') {
        toast('💪 با تلاش بیشتر در فرصت‌های بعدی موفق خواهید شد! هر تجربه گامی به سوی فروش‌های بزرگ‌تر است.', { duration: 6000 });
      } else {
        toast.success('مرحله فروش به‌روزرسانی شد');
      }
      loadAllData();
    } catch (err) {
      toast.error(err.message || 'خطا در تغییر مرحله فروش');
    }
  };

  const handleDeleteLead = async (leadId: number) => {
    if (!(await confirmAction({ title: 'حذف پرونده فروش', message: 'آیا از حذف این پرونده فروش اطمینان دارید؟' }))) return;
    try {
      await fetchJson(`/crm/leads/${leadId}`, { method: 'DELETE' });
      toast.success('فرصت فروش حذف شد');
      if (selectedLeadDrawer?.id === leadId) setSelectedLeadDrawer(null);
      loadAllData();
    } catch (err) {
      toast.error('خطا در حذف فرصت فروش');
    }
  };

  const openActivityModal = (lead?: CRMLead, defaultType: string = 'call', defaultCustName?: string, defaultCustId?: number) => {
    setSelectedLeadForActivity(lead || null);

    let defaultTitle = 'تماس تلفنی جدید';
    if (defaultType === 'meeting') defaultTitle = 'جلسه با مشتری';
    else if (defaultType === 'whatsapp') defaultTitle = 'ارسال پیام / واتساپ';
    else if (defaultType === 'email') defaultTitle = 'ارسال ایمیل';
    else if (defaultType === 'quote') defaultTitle = 'ارسال پیش‌فاکتور / پیشنهاد';
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
      const payload = {
        ...activityForm,
        leadId: selectedLeadForActivity?.id || null,
        customerId: selectedLeadForActivity?.customerId || null
      };

      await fetchJson('/crm/activities', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      toast.success('اقدام/تماس با موفقیت ثبت شد');
      setIsActivityModalOpen(false);
      loadAllData();

      if (selectedLeadDrawer && selectedLeadDrawer.id === selectedLeadForActivity?.id) {
        openLeadDrawer(selectedLeadDrawer);
      }
    } catch (err) {
      toast.error(err.message || 'خطا در ثبت اقدام');
    } finally {
      setIsSavingActivity(false);
    }
  };

  const openLeadDrawer = async (lead: CRMLead) => {
    setSelectedLeadDrawer(lead);
    try {
      const res = await fetchJson(`/crm/leads/${lead.id}`);
      // V3.0.7 (TD-066): Array Safety Guard (قاعده #2 AGENTS)
      if (Array.isArray(res?.activities)) {
        setDrawerActivities(res.activities);
      } else if (res?.activities && typeof res.activities === 'object') {
        setDrawerActivities([]);
      }
    } catch (err) {
      console.error('Error fetching lead drawer detail:', err);
    }
  };

  const handleToggleFollowup = async (actInput: number | CRMActivity) => {
    const act = typeof actInput === 'number'
      ? activities.find((a) => a.id === actInput) || drawerActivities.find((a) => a.id === actInput)
      : actInput;

    if (!act) return;

    if (!act.isFollowUpCompleted) {
      setSelectedFollowupAct(act);
      setFollowupResultForm({
        result: act.result || 'پاسخ داد و توافق شد',
        resultNote: ''
      });
      setIsFollowupResultModalOpen(true);
    } else {
      try {
        await fetchJson(`/crm/activities/${act.id}/toggle-followup`, { method: 'PUT' });
        toast.success('وضعیت پیگیری به حالت معوق تغییر کرد');
        loadAllData();
        if (selectedLeadDrawer) openLeadDrawer(selectedLeadDrawer);
      } catch (err) {
        toast.error('خطا در به‌روزرسانی پیگیری');
      }
    }
  };

  const handleConfirmFollowupResult = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedFollowupAct) return;

    setIsSubmittingFollowupResult(true);
    try {
      await fetchJson(`/crm/activities/${selectedFollowupAct.id}/toggle-followup`, {
        method: 'PUT',
        body: JSON.stringify({
          result: followupResultForm.result,
          resultNote: followupResultForm.resultNote
        })
      });
      toast.success('نتیجه پیگیری ثبت و وضعیت آن تکمیل شد');
      setIsFollowupResultModalOpen(false);
      setSelectedFollowupAct(null);
      loadAllData();
      if (selectedLeadDrawer) openLeadDrawer(selectedLeadDrawer);
    } catch (err) {
      toast.error('خطا در ثبت نتیجه پیگیری');
    } finally {
      setIsSubmittingFollowupResult(false);
    }
  };

  return {
    currentLoggedInUser,
    isAdminOrManager,
    activeTab,
    setActiveTab,
    stats,
    leads,
    activities,
    customersList,
    personnelList,
    currentPersonnelId,
    mentionUsers,
    loading,
    searchTerm: filters.searchTerm,
    setSearchTerm: filters.setSearchTerm,
    filterSeller: filters.filterSeller,
    setFilterSeller: filters.setFilterSeller,
    filterStage: filters.filterStage,
    setFilterStage: filters.setFilterStage,
    filterCustomer: filters.filterCustomer,
    setFilterCustomer: filters.setFilterCustomer,
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
    selectedLeadDrawer,
    setSelectedLeadDrawer,
    drawerActivities,
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
