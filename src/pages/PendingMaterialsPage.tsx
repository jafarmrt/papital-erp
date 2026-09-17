import React, { useState } from 'react';
import { confirmAction } from '../components/ConfirmDialogHost';
import { PendingMaterial, User } from '../types';
import { formatPersianNumber } from '../utils';
import {
  Clock,
  CheckCircle2,
  XCircle,
  Search,
  User as UserIcon,
  Check,
  X,
  Edit3,
  Trash2,
  AlertCircle,
  Box,
  Building2,
  ShieldCheck,
} from 'lucide-react';
import {
  usePendingMaterialsQuery,
  useApprovePendingMaterialMutation,
  useRejectPendingMaterialMutation,
  useUpdatePendingMaterialMutation,
  useDeletePendingMaterialMutation
} from '../hooks/queries';
import { WorkflowStepperWidget } from '../components/workflow/WorkflowStepperWidget';

const COMMON_UNITS = [
  'عدد', 'برگ', 'کیلوگرم', 'گرم', 'متر', 'سانتی‌متر', 'مترمربع', 'لیتر', 'میلی‌لیتر',
  'بسته', 'رول', 'کارتن', 'جفت', 'قوطی', 'طاقه', 'کلاف', 'ست'
];

export default function PendingMaterialsPage({ user }: { user: User }) {
  const { data, isLoading: loading, refetch } = usePendingMaterialsQuery();
  const items = data?.items || [];
  const categories = data?.categories || [];

  const approveMutation = useApprovePendingMaterialMutation();
  const rejectMutation = useRejectPendingMaterialMutation();
  const updateMutation = useUpdatePendingMaterialMutation();
  const deleteMutation = useDeletePendingMaterialMutation();

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  // Modal states for Approval / Editing
  const [selectedItem, setSelectedItem] = useState<PendingMaterial | null>(null);
  const [isApproveModalOpen, setIsApproveModalOpen] = useState<boolean>(false);
  const [isRejectModalOpen, setIsRejectModalOpen] = useState<boolean>(false);
  const [rejectionReason, setRejectionReason] = useState<string>('');
  const isSubmitting = approveMutation.isPending || rejectMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  // Form state for approve/edit
  const [approveForm, setApproveForm] = useState({
    code: '',
    name: '',
    category: '',
    unit: 'عدد',
    weighted_average_cost: 0,
    reorder_point: 0,
    color: '',
    weight: 0,
    material: '',
    size: ''
  });

  const loadData = () => {
    refetch();
  };

  // Statistics
  const safeItems = Array.isArray(items) ? items : [];
  const pendingCount = safeItems.filter(i => i.status === 'pending').length;
  const approvedCount = safeItems.filter(i => i.status === 'approved').length;
  const rejectedCount = safeItems.filter(i => i.status === 'rejected').length;

  // Filtered Items
  const filteredItems = safeItems.filter(item => {
    if (statusFilter !== 'all' && item.status !== statusFilter) return false;
    if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const matchName = item.name.toLowerCase().includes(q);
      const matchCode = item.code.toLowerCase().includes(q);
      const matchProj = (item.projectTitle || item.project_title || '').toLowerCase().includes(q);
      if (!matchName && !matchCode && !matchProj) return false;
    }
    return true;
  });

  // Open Approval Modal
  const handleOpenApproveModal = (item: PendingMaterial) => {
    setSelectedItem(item);
    setApproveForm({
      code: item.code || '',
      name: item.name || '',
      category: item.category || (categories[0]?.name || 'عمومی'),
      unit: item.unit || 'عدد',
      weighted_average_cost: item.weightedAverageCost || item.weighted_average_cost || 0,
      reorder_point: item.reorderPoint || item.reorder_point || 0,
      color: item.color || '',
      weight: item.weight || 0,
      material: item.material || '',
      size: item.size || ''
    });
    setIsApproveModalOpen(true);
  };

  // Save edits without changing status
  const handleSaveEditsOnly = () => {
    if (!selectedItem) return;
    updateMutation.mutate({
      id: selectedItem.id,
      payload: {
        code: approveForm.code,
        name: approveForm.name,
        category: approveForm.category,
        unit: approveForm.unit,
        weightedAverageCost: approveForm.weighted_average_cost,
        reorderPoint: approveForm.reorder_point,
        color: approveForm.color,
        weight: approveForm.weight,
        material: approveForm.material,
        size: approveForm.size
      }
    }, {
      onSuccess: () => {
        setIsApproveModalOpen(false);
        setSelectedItem(null);
      }
    });
  };

  // Submit Approval
  const handleConfirmApproval = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) return;
    
    approveMutation.mutate({ id: selectedItem.id, payload: approveForm }, {
      onSuccess: () => {
        setIsApproveModalOpen(false);
        setSelectedItem(null);
      }
    });
  };

  // Open Reject Modal
  const handleOpenRejectModal = (item: PendingMaterial) => {
    setSelectedItem(item);
    setRejectionReason('');
    setIsRejectModalOpen(true);
  };

  // Confirm Rejection
  const handleConfirmRejection = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) return;
    
    rejectMutation.mutate({ id: selectedItem.id, reason: rejectionReason }, {
      onSuccess: () => {
        setIsRejectModalOpen(false);
        setSelectedItem(null);
      }
    });
  };

  // Delete pending item
  const handleDeleteItem = async (id: number) => {
    if (!(await confirmAction({ title: 'حذف درخواست', message: 'آیا از حذف این درخواست ماده اولیه اطمینان دارید؟' }))) return;
    deleteMutation.mutate(id);
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 rounded-2xl p-6 text-white shadow-xl relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-amber-500/10 via-transparent to-transparent pointer-events-none" />
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative z-10">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-500/20 border border-amber-500/30 text-amber-300 rounded-full text-xs font-bold mb-2">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              مرور و تأیید انباردار
            </div>
            <h1 className="text-xl sm:text-2xl font-black">کالاهای در انتظار تأیید انبار</h1>
            <p className="text-xs sm:text-sm text-slate-300">
              مواد اولیه که از فرم‌های کنترل پروژه به صورت خارج از انبار ثبت شده‌اند، پس از مرور و تأیید شما در انبار رسمیت می‌یابند.
            </p>
          </div>

          <button
            onClick={loadData}
            className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white font-bold text-xs rounded-xl transition-all backdrop-blur-xs flex items-center gap-2 border border-white/10"
          >
            به‌روزرسانی لیست
          </button>
        </div>
      </div>

      {/* Summary Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div 
          onClick={() => setStatusFilter('pending')}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            statusFilter === 'pending'
              ? 'bg-amber-50 border-amber-300 ring-2 ring-amber-400 shadow-md'
              : 'bg-white border-slate-200 hover:border-amber-200 shadow-xs'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">در انتظار مرور و تأیید</span>
            <div className="p-2 bg-amber-100 text-amber-800 rounded-xl">
              <Clock className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black text-amber-900 font-mono">
            {formatPersianNumber(pendingCount)}
            <span className="text-xs font-normal text-slate-500 mr-1">مورد</span>
          </div>
        </div>

        <div 
          onClick={() => setStatusFilter('approved')}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            statusFilter === 'approved'
              ? 'bg-emerald-50 border-emerald-300 ring-2 ring-emerald-400 shadow-md'
              : 'bg-white border-slate-200 hover:border-emerald-200 shadow-xs'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">تأیید شده و موجود در انبار</span>
            <div className="p-2 bg-emerald-100 text-emerald-800 rounded-xl">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black text-emerald-900 font-mono">
            {formatPersianNumber(approvedCount)}
            <span className="text-xs font-normal text-slate-500 mr-1">مورد</span>
          </div>
        </div>

        <div 
          onClick={() => setStatusFilter('rejected')}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            statusFilter === 'rejected'
              ? 'bg-rose-50 border-rose-300 ring-2 ring-rose-400 shadow-md'
              : 'bg-white border-slate-200 hover:border-rose-200 shadow-xs'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">رد شده (صرفاً در پروژه)</span>
            <div className="p-2 bg-rose-100 text-rose-800 rounded-xl">
              <XCircle className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black text-rose-900 font-mono">
            {formatPersianNumber(rejectedCount)}
            <span className="text-xs font-normal text-slate-500 mr-1">مورد</span>
          </div>
        </div>
      </div>

      {/* Filter and Search Toolbar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          {/* Status Tabs */}
          <div className="flex bg-slate-100 p-1 rounded-xl w-full sm:w-auto text-xs font-bold">
            <button
              onClick={() => setStatusFilter('pending')}
              className={`flex-1 sm:flex-initial px-4 py-1.5 rounded-lg transition-all ${
                statusFilter === 'pending'
                  ? 'bg-amber-500 text-slate-950 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              در انتظار تأیید ({formatPersianNumber(pendingCount)})
            </button>
            <button
              onClick={() => setStatusFilter('approved')}
              className={`flex-1 sm:flex-initial px-4 py-1.5 rounded-lg transition-all ${
                statusFilter === 'approved'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              تأیید شده ({formatPersianNumber(approvedCount)})
            </button>
            <button
              onClick={() => setStatusFilter('rejected')}
              className={`flex-1 sm:flex-initial px-4 py-1.5 rounded-lg transition-all ${
                statusFilter === 'rejected'
                  ? 'bg-rose-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              رد شده ({formatPersianNumber(rejectedCount)})
            </button>
            <button
              onClick={() => setStatusFilter('all')}
              className={`flex-1 sm:flex-initial px-4 py-1.5 rounded-lg transition-all ${
                statusFilter === 'all'
                  ? 'bg-slate-800 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              همه ({formatPersianNumber(items.length)})
            </button>
          </div>

          {/* Category & Search */}
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none"
            >
              <option value="all">همه دسته‌بندی‌ها</option>
              {categories.map((c, idx) => (
                <option key={`cat-pm-flt-${c.id || idx}-${idx}`} value={c.name}>{c.name}</option>
              ))}
            </select>

            <div className="relative flex-1 sm:w-64">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="جستجوی نام، کد یا پروژه..."
                className="w-full pr-9 pl-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:ring-2 focus:ring-amber-500 focus:outline-none"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Main Table / List */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-500 space-y-3">
            <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs font-bold">در حال دریافت لیست مواد اولیه در انتظار...</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-12 text-center text-slate-500 space-y-3">
            <Box className="w-12 h-12 text-slate-300 mx-auto" />
            <p className="font-bold text-sm text-slate-700">هیچ کالا یا ماده اولیه با مشخصات مورد نظر یافت نشد.</p>
            <p className="text-xs text-slate-400">
              مادامی که در فرم‌های کنترل پروژه ماده اولیه خارج از انبار اضافه شود، لیست آن در این صفحه قرار می‌گیرد.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-700 font-bold text-xs border-b border-slate-200">
                  <th className="p-3.5 text-center w-12">#</th>
                  <th className="p-3.5">عنوان و کد ماده اولیه</th>
                  <th className="p-3.5">دسته‌بندی و واحد</th>
                  <th className="p-3.5">پروژه و ثبت‌کننده</th>
                  <th className="p-3.5 text-center">وضعیت</th>
                  <th className="p-3.5 text-center w-48">عملیات انباردار</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredItems.map((item, index) => {
                  const isPending = item.status === 'pending';
                  const isApproved = item.status === 'approved';
                  const isRejected = item.status === 'rejected';

                  return (
                    <tr 
                      key={item.id} 
                      className={`hover:bg-slate-50/80 transition-colors ${
                        isPending ? 'bg-amber-50/20' : ''
                      }`}
                    >
                      <td className="p-3.5 text-center font-bold text-slate-400">{index + 1}</td>
                      <td className="p-3.5 font-bold text-slate-900">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-black text-slate-900">{item.name}</span>
                            <span className="font-mono text-[11px] text-amber-900 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-lg">
                              کد: {item.code}
                            </span>
                          </div>
                          {(item.color || item.material || item.size) && (
                            <div className="flex items-center gap-2 text-[10px] text-slate-500 font-normal">
                              {item.color && <span>رنگ: {item.color}</span>}
                              {item.material && <span>جنس: {item.material}</span>}
                              {item.size && <span>سایز: {item.size}</span>}
                            </div>
                          )}
                        </div>
                      </td>

                      <td className="p-3.5">
                        <div className="space-y-0.5">
                          <div className="font-bold text-slate-800">{item.category || 'عمومی'}</div>
                          <div className="text-[11px] text-slate-500">واحد: <span className="font-bold text-slate-700">{item.unit}</span></div>
                        </div>
                      </td>

                      <td className="p-3.5">
                        <div className="space-y-1">
                          <div className="flex items-center gap-1 text-slate-800 font-bold">
                            <Building2 className="w-3.5 h-3.5 text-slate-400" />
                            <span>{item.projectTitle || item.project_title || 'نامشخص'}</span>
                          </div>
                          <div className="flex items-center gap-1 text-[11px] text-slate-500">
                            <UserIcon className="w-3 h-3 text-slate-400" />
                            <span>ثبت توسط: {item.requestedBy || item.requested_by || 'کاربر'}</span>
                          </div>
                        </div>
                      </td>

                      <td className="p-3.5 text-center">
                        {isPending && (
                          <span className="inline-flex items-center gap-1 px-3 py-1 bg-amber-100 text-amber-900 border border-amber-300 rounded-xl font-bold text-[11px]">
                            <Clock className="w-3.5 h-3.5 text-amber-600" />
                            در انتظار تأیید
                          </span>
                        )}
                        {isApproved && (
                          <span className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-100 text-emerald-900 border border-emerald-300 rounded-xl font-bold text-[11px]">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            ثبت شده در انبار
                          </span>
                        )}
                        {isRejected && (
                          <div className="inline-flex flex-col items-center">
                            <span className="inline-flex items-center gap-1 px-3 py-1 bg-rose-100 text-rose-900 border border-rose-300 rounded-xl font-bold text-[11px]">
                              <XCircle className="w-3.5 h-3.5 text-rose-600" />
                              رد شده انبار
                            </span>
                            {(item.rejectionReason || item.rejection_reason) && (
                              <span className="text-[10px] text-rose-600 mt-0.5 max-w-[150px] truncate" title={item.rejectionReason || item.rejection_reason}>
                                دلیل: {item.rejectionReason || item.rejection_reason}
                              </span>
                            )}
                          </div>
                        )}
                      </td>

                      <td className="p-3.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {isPending && (
                            <>
                              <button
                                onClick={() => handleOpenApproveModal(item)}
                                className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs flex items-center gap-1 transition-all shadow-xs cursor-pointer"
                                title="مرور، ویرایش و تأیید ثبت در انبار"
                              >
                                <Check className="w-3.5 h-3.5" />
                                <span>تأیید</span>
                              </button>
                              <button
                                onClick={() => handleOpenRejectModal(item)}
                                className="px-2.5 py-1.5 bg-rose-100 hover:bg-rose-200 text-rose-800 font-bold rounded-xl text-xs flex items-center gap-1 transition-all cursor-pointer border border-rose-300"
                                title="رد کد کالا (ماندن فقط در پروژه)"
                              >
                                <X className="w-3.5 h-3.5" />
                                <span>رد</span>
                              </button>
                            </>
                          )}

                          {!isPending && (
                            <button
                              onClick={() => handleOpenApproveModal(item)}
                              className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs flex items-center gap-1 transition-all cursor-pointer border border-slate-200"
                              title="مشاهده مشخصات"
                            >
                              <Edit3 className="w-3.5 h-3.5 text-slate-500" />
                              <span>مشاهده / ویرایش</span>
                            </button>
                          )}

                          <button
                            onClick={() => handleDeleteItem(item.id)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                            title="حذف"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Approve / Review Modal */}
      {isApproveModalOpen && selectedItem && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-fadeIn my-auto">
            <div className="bg-slate-900 text-white p-4 shrink-0 flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-amber-400 shrink-0" />
                <h3 className="font-bold text-xs sm:text-sm">
                  {selectedItem.status === 'pending' ? 'بررسی، ویرایش و تأیید ثبت ماده اولیه در انبار' : 'مشاهده و ویرایش مشخصات ماده اولیه'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsApproveModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmApproval} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
              {/* Workflow Engine Stepper Widget */}
              <WorkflowStepperWidget
                entityType="pending_material"
                entityId={selectedItem.id}
                workflowCode="PENDING_MATERIAL_WORKFLOW"
                title={`چرخه گردش کار ماده اولیه معلق شماره ${selectedItem.id}`}
                onStateChange={loadData}
              />

              {/* Context / Origin Card */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 sm:p-4 space-y-2">
                <div className="text-xs font-black text-slate-700 flex items-center gap-1.5 border-b border-slate-200 pb-2">
                  <Building2 className="w-4 h-4 text-amber-600" />
                  اطلاعات منشاء ثبت درخواست (بخش CRM / کنترل موجودی پروژه)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3 text-xs pt-1">
                  <div>
                    <span className="text-slate-500">پروژه مربوطه:</span>
                    <span className="font-bold text-slate-900 mr-1 block sm:inline">
                      {selectedItem.projectTitle || selectedItem.project_title || '---'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">ثبت‌کننده درخواست:</span>
                    <span className="font-bold text-slate-900 mr-1 block sm:inline">
                      {selectedItem.requestedBy || selectedItem.requested_by || 'کاربر سیستم'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">وضعیت درخواست:</span>
                    <span className="font-bold text-slate-900 mr-1 block sm:inline">
                      {selectedItem.status === 'pending' ? '⏳ در انتظار تأیید انبار' : selectedItem.status === 'approved' ? '✅ تأیید شده در انبار' : '❌ رد شده'}
                    </span>
                  </div>
                </div>
              </div>

              {selectedItem.status === 'pending' && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <span>
                    انباردار محترم، تمامی مشخصات این کالا را در صورت نیاز تکمیل یا ویرایش کرده و سپس دکمه «تأیید و افزودن به انبار» را فشار دهید.
                  </span>
                </div>
              )}

              {/* Form Fields Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="font-bold text-slate-700 text-xs">دسته‌بندی کالا *</label>
                  <select
                    required
                    value={approveForm.category}
                    onChange={(e) => setApproveForm({ ...approveForm, category: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-800 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  >
                    {categories.map((c, idx) => (
                      <option key={`cat-pm-modal-${c.id || idx}-${idx}`} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700 text-xs">کد رسمی کالا در انبار *</label>
                  <input
                    type="text"
                    required
                    value={approveForm.code}
                    onChange={(e) => setApproveForm({ ...approveForm, code: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono font-bold text-slate-800 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>

                <div className="sm:col-span-2 space-y-1">
                  <label className="font-bold text-slate-700 text-xs">عنوان کامل ماده اولیه *</label>
                  <input
                    type="text"
                    required
                    value={approveForm.name}
                    onChange={(e) => setApproveForm({ ...approveForm, name: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-800 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700 text-xs">واحد شمارش *</label>
                  <select
                    value={approveForm.unit}
                    onChange={(e) => setApproveForm({ ...approveForm, unit: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-800 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  >
                    {COMMON_UNITS.map(u => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700 text-xs">نقطه سفارش اولیه</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={approveForm.reorder_point}
                    onChange={(e) => setApproveForm({ ...approveForm, reorder_point: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono font-bold text-slate-800 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700 text-xs">قیمت / هزینه واحد تخمینی</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={approveForm.weighted_average_cost}
                    onChange={(e) => setApproveForm({ ...approveForm, weighted_average_cost: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono font-bold text-slate-800 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700 text-xs">رنگ</label>
                  <input
                    type="text"
                    value={approveForm.color}
                    onChange={(e) => setApproveForm({ ...approveForm, color: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800 focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700 text-xs">جنس</label>
                  <input
                    type="text"
                    value={approveForm.material}
                    onChange={(e) => setApproveForm({ ...approveForm, material: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800 focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700 text-xs">سایز / ابعاد</label>
                  <input
                    type="text"
                    value={approveForm.size}
                    onChange={(e) => setApproveForm({ ...approveForm, size: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800 focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700 text-xs">وزن (کیلوگرم)</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={approveForm.weight}
                    onChange={(e) => setApproveForm({ ...approveForm, weight: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono text-slate-800 focus:outline-none"
                  />
                </div>
              </div>

              {/* Modal Action Buttons */}
              <div className="pt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsApproveModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-colors cursor-pointer"
                >
                  انصراف
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSaveEditsOnly}
                    disabled={isSubmitting}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>ذخیره فقط تغییرات</span>
                  </button>

                  {selectedItem.status === 'pending' && (
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <Check className="w-4 h-4" />
                      <span>تأیید و افزودن به انبار</span>
                    </button>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {isRejectModalOpen && selectedItem && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden animate-fadeIn">
            <div className="bg-rose-900 text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <XCircle className="w-5 h-5 text-rose-300" />
                <h3 className="font-bold text-sm">رد درخواست ماده اولیه</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsRejectModalOpen(false)}
                className="p-1 text-rose-300 hover:text-white rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmRejection} className="p-5 space-y-4">
              <p className="text-xs text-slate-700 leading-relaxed font-bold">
                آیا از رد ماده اولیه «{selectedItem.name}» (کد: {selectedItem.code}) اطمینان دارید؟
              </p>
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900">
                با رد این کد، ماده جدید به انبار رسمی افزوده‌نمیشود و صرفاً در فرم‌های کنترل پروژه باقی می‌ماند.
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700 text-xs">دلیل رد درخواست (اختیاری)</label>
                <input
                  type="text"
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="مثلاً: لزوم استفاده از کد استاندار موجود..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800 focus:ring-2 focus:ring-rose-500 focus:outline-none"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsRejectModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-colors cursor-pointer"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
                >
                  تأیید رد ماده اولیه
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
