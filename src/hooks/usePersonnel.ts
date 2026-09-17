import { useState, useMemo, FormEvent, useEffect } from 'react';
import { confirmAction } from '../components/ConfirmDialogHost';
import { Personnel } from '../types';
import { toast as hotToast } from 'react-hot-toast';
import { normalizePersianText, validateIranianNationalId, validateIranianPhoneNumber, normalizeNationalId, normalizePhoneNumber } from '../utils';
import {
  usePersonnelListQuery,
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

export function usePersonnel() {
  const { data: personnelList = [], isLoading: isLoadingPersonnel, refetch: loadData } = usePersonnelListQuery();
  const { data: usersList = [] } = useUsersListQuery();

  const saveMutation = useSavePersonnelMutation();
  const deleteMutation = useDeletePersonnelMutation();

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Pagination states
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(15);

  // Reset to first page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter]);

  // Modal states
  const [showFormModal, setShowFormModal] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showDetailModal, setShowDetailModal] = useState<boolean>(false);
  const [selectedPersonnel, setSelectedPersonnel] = useState<Personnel | null>(null);
  const [showNobitexPass, setShowNobitexPass] = useState<boolean>(false);

  // Form State
  const [formData, setFormData] = useState<PersonnelFormData>(INITIAL_FORM_DATA);

  const resetForm = () => {
    setFormData(INITIAL_FORM_DATA);
    setEditingId(null);
    setShowNobitexPass(false);
  };

  const handleOpenAddModal = () => {
    resetForm();
    setShowFormModal(true);
  };

  const handleOpenEditModal = (p: Personnel) => {
    setEditingId(p.id);
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
      userId: formData.userId ? Number(formData.userId) : null
    };

    await saveMutation.mutateAsync({
      id: editingId,
      payload
    });

    setShowFormModal(false);
    resetForm();
  };

  const handleDelete = async (p: Personnel) => {
    if (await confirmAction({ title: 'حذف پرسنل', message: `آیا از حذف اطلاعات پرسنل «${p.fullName}» اطمینان دارید؟` })) {
      await deleteMutation.mutateAsync(p.id);
      if (selectedPersonnel?.id === p.id) {
        setShowDetailModal(false);
        setSelectedPersonnel(null);
      }
    }
  };

  const handleViewDetail = (p: Personnel) => {
    setSelectedPersonnel(p);
    setShowDetailModal(true);
  };

  // Filtered List with robust Persian normalization and comprehensive field matching
  const filteredPersonnel = useMemo(() => {
    const safePersonnel = Array.isArray(personnelList) ? personnelList : [];
    const normalizedQ = normalizePersianText(searchQuery);

    return safePersonnel.filter((p) => {
      const matchesStatus = statusFilter === 'all' || p.employmentStatus === statusFilter;
      if (!matchesStatus) return false;

      if (!normalizedQ) return true;

      const searchableFields = [
        p.fullName,
        p.firstName,
        p.lastName,
        p.personnelCode,
        p.phone,
        p.nationalId,
        p.jobTitle,
        p.education,
        p.specializedSkills,
        p.otherSkills,
        p.bankName,
        p.cardNumber,
        p.accountNumber,
        p.shebaNumber,
        p.username,
        p.address,
        p.notes,
        p.referralSource
      ];

      return searchableFields.some(field => {
        if (!field) return false;
        return normalizePersianText(String(field)).includes(normalizedQ);
      });
    });
  }, [personnelList, statusFilter, searchQuery]);

  // Pagination computations
  const totalFilteredCount = filteredPersonnel.length;
  const totalPages = Math.max(1, Math.ceil(totalFilteredCount / (pageSize || 15)));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);

  const startIndex = (safeCurrentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalFilteredCount);

  const paginatedPersonnel = useMemo(() => {
    return filteredPersonnel.slice(startIndex, endIndex);
  }, [filteredPersonnel, startIndex, endIndex]);

  const resetFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setCurrentPage(1);
  };

  // Statistics
  const stats = useMemo(() => {
    const safePersonnel = Array.isArray(personnelList) ? personnelList : [];
    const total = safePersonnel.length;
    const active = safePersonnel.filter((p) => p.employmentStatus === 'فعال').length;
    const terminated = safePersonnel.filter((p) => p.employmentStatus === 'قطع همکاری').length;
    const onLeave = safePersonnel.filter((p) => p.employmentStatus === 'مرخصی' || p.employmentStatus === 'تعلیق').length;
    const usersCount = safePersonnel.filter((p) => p.userId).length;
    return { total, active, terminated, onLeave, usersCount };
  }, [personnelList]);

  return {
    personnelList,
    usersList,
    isLoading: isLoadingPersonnel,
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
    totalAllCount: personnelList.length,
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
    showNobitexPass,
    setShowNobitexPass,
    formData,
    setFormData,
    loadData,
    resetForm,
    handleOpenAddModal,
    handleOpenEditModal,
    handleSave,
    handleDelete,
    handleViewDetail,
    filteredPersonnel,
    stats
  };
}
