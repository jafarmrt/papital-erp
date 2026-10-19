import { useState, FormEvent, useEffect } from 'react';
import { confirmAction } from '../components/ConfirmDialogHost';
import { Personnel } from '../types';
import { toast as hotToast } from 'react-hot-toast';
import { fetchJson } from '../api';
import { errorMessageOf } from '../utils/formatters';
import { validateIranianNationalId, validateIranianPhoneNumber, normalizeNationalId, normalizePhoneNumber } from '../utils';
import { useDebounce } from './useDebounce';
import { EMPTY_PERSONNEL_STATS } from '../lib/personnel/personnelList';
import {
  usePersonnelListQuery,
  usePersonnelPageQuery,
  useUsersListQuery,
  useSavePersonnelMutation,
  useDeletePersonnelMutation,
  personnelKeys
} from './queries/usePersonnelQueries';

export { personnelKeys };

export interface PersonnelFormData {
  firstName: string;
  lastName: string;
  fullName: string;
  personnelCode: string;
  userId: string | number;
  gender: string;
  birthDate: string;
  nationality: string;
  nationalId: string;
  phone: string;
  employmentStatus: string;
  // V10-4.4: مدل حقوق
  salaryType: string;
  monthlySalary: string;
  jobTitle: string;
  education: string;
  startDate: string;
  // v10.0.210 (TD-1087): «مشمول بیمه» و «مشمول مالیات حقوق»
  isInsuranceCovered: boolean;
  isTaxCovered: boolean;
  isEidiCovered: boolean;
  // v10.2 package 9: the birthday (day and month) on the group dashboard, on by default
  isBirthdayVisible: boolean;
  endDate: string;
  terminationReason: string;
  specializedSkills: string;
  otherSkills: string;
  referralSource: string;
  cardNumber: string;
  accountNumber: string;
  shebaNumber: string;
  bankName: string;
  nobitexUsername: string;
  nobitexPassword: string;
  address: string;
  notes: string;
}

const INITIAL_FORM_DATA: PersonnelFormData = {
  firstName: '',
  lastName: '',
  fullName: '',
  personnelCode: '',
  userId: '',
  gender: 'مرد',
  birthDate: '',
  nationality: 'ایرانی',
  nationalId: '',
  phone: '',
  employmentStatus: 'فعال',
  salaryType: 'none',
  monthlySalary: '',
  jobTitle: '',
  education: '',
  startDate: '',
  isInsuranceCovered: false,
  isTaxCovered: false,
  isEidiCovered: true,
  isBirthdayVisible: true,
  endDate: '',
  terminationReason: '',
  specializedSkills: '',
  otherSkills: '',
  referralSource: '',
  cardNumber: '',
  accountNumber: '',
  shebaNumber: '',
  bankName: '',
  nobitexUsername: '',
  nobitexPassword: '',
  address: '',
  notes: ''
};

/**
 * OBS-R2-57 (TD-1321): the table reads one page from the server (search, status and page in SQL, the cards from the same
 * answer); every personnel is read only while a window that needs them is open: the form (users linked to another
 * personnel) or the Excel window (`fullListOpen`).
 */
export function usePersonnel(options: { fullListOpen?: boolean } = {}) {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const debouncedSearch = useDebounce(searchQuery);

  // Pagination states
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(15);

  // Reset to first page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, statusFilter, pageSize]);

  // Modal states
  const [showFormModal, setShowFormModal] = useState<boolean>(false);

  const pageQuery = usePersonnelPageQuery({ page: currentPage, limit: pageSize, search: debouncedSearch, status: statusFilter });
  const fullListQuery = usePersonnelListQuery({ enabled: showFormModal || Boolean(options.fullListOpen) });
  const personnelList = fullListQuery.data ?? [];
  const usersQuery = useUsersListQuery();
  const usersList = usersQuery.data ?? [];
  // TD-1321 (review): the windows that check against every personnel (linked users, existing codes) wait for these lists,
  // so a duplicate check never runs on a list that has not arrived
  const fullListReady = fullListQuery.data !== undefined;
  const fullListFailed = fullListQuery.isError;
  const usersReady = usersQuery.data !== undefined;

  const saveMutation = useSavePersonnelMutation();
  const deleteMutation = useDeletePersonnelMutation();
  const [editingId, setEditingId] = useState<number | null>(null);
  // v9.0.30 (TD-442): نسخه رکوردی که فرم ویرایش از آن ساخته شده؛ سرور نسخه کهنه را با ۴۰۹ رد می‌کند
  const [editingVersion, setEditingVersion] = useState<number | undefined>(undefined);
  const [showDetailModal, setShowDetailModal] = useState<boolean>(false);
  const [selectedPersonnel, setSelectedPersonnel] = useState<Personnel | null>(null);

  // Form State
  const [formData, setFormData] = useState<PersonnelFormData>(INITIAL_FORM_DATA);

  const resetForm = () => {
    setFormData(INITIAL_FORM_DATA);
    setEditingId(null);
    setEditingVersion(undefined);
  };

  const handleOpenAddModal = () => {
    resetForm();
    setShowFormModal(true);
  };

  /** v9.0.23 (TD-434): رمز نوبیتکس فقط در جزئیات یک پرسنل می‌آید، پس فرم ویرایش و پرونده از GET /personnel/:id پر می‌شوند */
  const loadPersonnelDetail = async (p: Personnel): Promise<Personnel | null> => {
    try {
      return await fetchJson<Personnel>(`/personnel/${p.id}`);
    } catch (err) {
      hotToast.error(errorMessageOf(err) || 'خطا در دریافت اطلاعات پرسنل');
      return null;
    }
  };

  const fillEditForm = (p: Personnel) => {
    setEditingId(p.id);
    setEditingVersion(p.version);
    setFormData({
      firstName: p.firstName || '',
      lastName: p.lastName || '',
      fullName: p.fullName || '',
      personnelCode: p.personnelCode || '',
      userId: p.userId || '',
      gender: p.gender || 'مرد',
      birthDate: p.birthDate || '',
      nationality: p.nationality || 'ایرانی',
      nationalId: p.nationalId || '',
      phone: p.phone || '',
      employmentStatus: p.employmentStatus || 'فعال',
      salaryType: String(p.salaryType || 'none'),
      monthlySalary: p.monthlySalary != null && p.monthlySalary !== '' ? String(p.monthlySalary) : '',
      jobTitle: p.jobTitle || '',
      education: p.education || '',
      startDate: p.startDate || '',
      isInsuranceCovered: Number(p.isInsuranceCovered ?? 0) === 1,
      isTaxCovered: Number(p.isTaxCovered ?? 0) === 1,
      isEidiCovered: Number(p.isEidiCovered ?? 1) === 1,
      isBirthdayVisible: Number(p.isBirthdayVisible ?? 1) === 1,
      endDate: p.endDate || '',
      terminationReason: p.terminationReason || '',
      specializedSkills: p.specializedSkills || '',
      otherSkills: p.otherSkills || '',
      referralSource: p.referralSource || '',
      cardNumber: p.cardNumber || '',
      accountNumber: p.accountNumber || '',
      shebaNumber: p.shebaNumber || '',
      bankName: p.bankName || '',
      nobitexUsername: p.nobitexUsername || '',
      nobitexPassword: p.nobitexPassword || '',
      address: p.address || '',
      notes: p.notes || ''
    });
    setShowFormModal(true);
  };

  // فرم فقط با جزئیات کامل باز می‌شود؛ فرم پرشده از ردیف فهرست رمز نوبیتکس ندارد و ذخیره آن رمز را پاک می‌کرد
  const handleOpenEditModal = (p: Personnel) => {
    void loadPersonnelDetail(p).then((full) => {
      if (full) fillEditForm(full);
    });
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!formData.firstName.trim() && !formData.lastName.trim() && !formData.fullName.trim()) {
      hotToast.error('لطفاً نام یا نام خانوادگی را وارد کنید');
      return;
    }

    // اعتبارسنجی کد ملی
    const cleanNationalId = normalizeNationalId(formData.nationalId || '');
    if (cleanNationalId) {
      const nationalIdValidation = validateIranianNationalId(cleanNationalId);
      if (!nationalIdValidation.isValid) {
        hotToast.error(nationalIdValidation.error || 'کد ملی وارد شده نامعتبر است');
        return;
      }
    }

    // اعتبارسنجی شماره تماس (۱۱ رقم و شروع با ۰)
    const cleanPhone = normalizePhoneNumber(formData.phone || '');
    if (cleanPhone) {
      const phoneValidation = validateIranianPhoneNumber(cleanPhone);
      if (!phoneValidation.isValid) {
        hotToast.error(phoneValidation.error || 'شماره تماس باید ۱۱ رقم بوده و با صفر (۰) شروع شود');
        return;
      }
    }

    const computedFullName = formData.fullName.trim() || `${formData.firstName} ${formData.lastName}`.trim();
    const payload = {
      ...formData,
      nationalId: cleanNationalId,
      phone: cleanPhone,
      fullName: computedFullName,
      userId: formData.userId ? Number(formData.userId) : null,
      ...(editingId !== null ? { version: editingVersion } : {})
    };

    // OBS-R2-55: a refused save (the server's message is shown by the mutation's `onError`) keeps the form open with what was
    // typed; the rejection no longer escapes the submit handler unhandled
    const saved = await saveMutation.mutateAsync({
      id: editingId,
      payload
    }).then(() => true, () => false);
    if (!saved) return;

    setShowFormModal(false);
    resetForm();
  };

  const handleDelete = async (p: Personnel) => {
    if (await confirmAction({ title: 'حذف پرسنل', message: `آیا از حذف اطلاعات پرسنل «${p.fullName}» اطمینان دارید؟` })) {
      // v9.0.29 (TD-441): حذف ردشده (۴۰۹ با دلیل) را پیام خطای mutation نشان می‌دهد؛ پنجره جزئیات باز می‌ماند
      const removed = await deleteMutation.mutateAsync(p.id).then(() => true, () => false);
      if (removed && selectedPersonnel?.id === p.id) {
        setShowDetailModal(false);
        setSelectedPersonnel(null);
      }
    }
  };

  const handleViewDetail = (p: Personnel) => {
    setSelectedPersonnel(p);
    setShowDetailModal(true);
    void loadPersonnelDetail(p).then((full) => {
      if (full) setSelectedPersonnel((current) => (current?.id === full.id ? full : current));
    });
  };

  const page = pageQuery.data;
  const paginatedPersonnel = page?.data ?? [];
  const totalFilteredCount = page?.total ?? 0;
  const stats = page?.stats ?? EMPTY_PERSONNEL_STATS;
  const totalPages = Math.max(1, Math.ceil(totalFilteredCount / (pageSize || 15)));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);
  // TD-1321 (review): the range follows the rows on screen; while the next page loads the previous page's rows keep their
  // own range, never the new page's label
  const shownPage = page ? Math.max(1, page.page) : safeCurrentPage;
  const startIndex = (shownPage - 1) * (page?.limit || pageSize);
  const endIndex = Math.min(startIndex + paginatedPersonnel.length, totalFilteredCount);

  // a delete that empties the last page moves back to the page that still has rows
  useEffect(() => {
    if (page && currentPage > totalPages) setCurrentPage(totalPages);
  }, [page, currentPage, totalPages]);

  const resetFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setCurrentPage(1);
  };

  const loadData = () => Promise.all([pageQuery.refetch(), ...(fullListQuery.isFetched ? [fullListQuery.refetch()] : [])]);

  return {
    personnelList,
    usersList,
    fullListReady,
    fullListFailed,
    usersReady,
    isLoading: pageQuery.isLoading,
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter,
    resetFilters,
    // Pagination
    currentPage: safeCurrentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    totalPages,
    totalFilteredCount,
    totalAllCount: stats.total,
    startIndex,
    endIndex,
    paginatedPersonnel,
    showFormModal,
    setShowFormModal,
    editingId,
    setEditingId,
    showDetailModal,
    setShowDetailModal,
    selectedPersonnel,
    setSelectedPersonnel,
    isSaving: saveMutation.isPending || deleteMutation.isPending,
    formData,
    setFormData,
    loadData,
    resetForm,
    handleOpenAddModal,
    handleOpenEditModal,
    handleSave,
    handleDelete,
    handleViewDetail,
    stats
  };
}
