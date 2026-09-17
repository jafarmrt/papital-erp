import React, { useState } from 'react';
import { confirmAction } from '../ConfirmDialogHost';
import { 
  useDelegationsQuery, 
  useCreateDelegationMutation, 
  useRevokeDelegationMutation,
  useWorkflowDefinitionsQuery
} from '../../hooks/queries/useWorkflowQueries';
import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { UserCheck, Plus, Search, Clock, CheckCircle2, XCircle, Trash2, Calendar, Layers, ArrowRightLeft } from 'lucide-react';
import { toast } from 'react-hot-toast';

interface UserItem {
  id: number;
  username: string;
  full_name?: string;
  role?: string;
}

export function WorkflowDelegationTab() {
  const { data: delegations = [], isLoading } = useDelegationsQuery();
  const { data: definitions = [] } = useWorkflowDefinitionsQuery();
  const createMutation = useCreateDelegationMutation();
  const revokeMutation = useRevokeDelegationMutation();

  // Fetch users for selection
  const { data: users = [] } = useQuery<UserItem[]>({
    queryKey: ['users', 'list'],
    queryFn: async () => {
      const res = await fetchJson('/users');
      return Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
    },
    staleTime: 60000
  });

  // Local state
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'scheduled' | 'expired' | 'revoked'>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);

  // New Delegation Form State
  const today = new Date().toISOString().split('T')[0];
  const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const [toUserId, setToUserId] = useState<number | ''>('');
  const [scope, setScope] = useState('ALL');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(nextWeek);
  const [reason, setReason] = useState('');

  // Filtering
  const filteredDelegations = delegations.filter((item: any) => {
    const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
    const matchesSearch = 
      (item.fromUserName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.toUserName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.scope || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.reason || '').toLowerCase().includes(searchTerm.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  // KPI Calculations
  const activeCount = delegations.filter((d: any) => d.status === 'active').length;
  const scheduledCount = delegations.filter((d: any) => d.status === 'scheduled').length;
  const expiredCount = delegations.filter((d: any) => d.status === 'expired').length;
  const revokedCount = delegations.filter((d: any) => d.status === 'revoked').length;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!toUserId) {
      toast.error('لطفاً کاربر جانشین (دریافت‌کننده) را انتخاب کنید');
      return;
    }
    if (!startDate || !endDate) {
      toast.error('لطفاً تاریخ شروع و پایان تفویض را مشخص نمایید');
      return;
    }

    try {
      await createMutation.mutateAsync({
        toUserId: Number(toUserId),
        scope,
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(`${endDate}T23:59:59.999Z`).toISOString(),
        reason
      });
      setIsModalOpen(false);
      // Reset Form
      setToUserId('');
      setScope('ALL');
      setStartDate(today);
      setEndDate(nextWeek);
      setReason('');
    } catch (err) {
      // Error handled in mutation toast
    }
  };

  const handleRevoke = async (id: number) => {
    if (await confirmAction({ title: 'لغو تفویض اختیار', message: 'آیا از لغو این تفویض اختیار اطمینان دارید؟' })) {
      await revokeMutation.mutateAsync(id);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-indigo-900 to-slate-900 text-white p-5 rounded-2xl shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-500/20 rounded-xl border border-indigo-400/30">
            <UserCheck className="w-6 h-6 text-indigo-300" />
          </div>
          <div>
            <h2 className="text-lg font-bold">مدیریت تفویض اختیارات (Delegation)</h2>
            <p className="text-xs text-indigo-200 mt-0.5">
              تعیین جانشین موقت جهت لغو یا تایید فرآیندها در فواصل مرخصی و ماموریت‌های کاری
            </p>
          </div>
        </div>

        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs rounded-xl transition-all shadow-md active:scale-98"
        >
          <Plus className="w-4 h-4" />
          <span>ایجاد تفویض اختیار جدید</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">تفویض‌های فعال</p>
            <h3 className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{activeCount}</h3>
          </div>
          <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 rounded-lg">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">برنامه‌ریزی‌شده</p>
            <h3 className="text-xl font-bold text-amber-600 dark:text-amber-400 mt-1">{scheduledCount}</h3>
          </div>
          <div className="p-2.5 bg-amber-50 dark:bg-amber-950/60 text-amber-600 rounded-lg">
            <Clock className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">منقضی‌شده</p>
            <h3 className="text-xl font-bold text-gray-600 dark:text-gray-400 mt-1">{expiredCount}</h3>
          </div>
          <div className="p-2.5 bg-gray-100 dark:bg-gray-700 text-gray-500 rounded-lg">
            <Calendar className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">لغو شده</p>
            <h3 className="text-xl font-bold text-rose-600 dark:text-rose-400 mt-1">{revokedCount}</h3>
          </div>
          <div className="p-2.5 bg-rose-50 dark:bg-rose-950/60 text-rose-600 rounded-lg">
            <XCircle className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white dark:bg-gray-800 p-3 rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 absolute right-3 top-2.5 text-gray-400" />
          <input
            type="text"
            placeholder="جستجو در نام، حوزه یا دلیل..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pr-9 pl-3 py-1.5 text-xs bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-hidden focus:border-indigo-500 dark:text-white"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto">
          {[
            { id: 'all', label: 'همه موارد' },
            { id: 'active', label: 'فعال' },
            { id: 'scheduled', label: 'زمان‌بندی‌شده' },
            { id: 'expired', label: 'منقضی شده' },
            { id: 'revoked', label: 'لغو شده' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id as any)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                statusFilter === tab.id
                  ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-xs">
        {isLoading ? (
          <div className="p-8 text-center text-gray-500 text-xs">در حال دریافت اطلاعات تفویض‌ها...</div>
        ) : filteredDelegations.length === 0 ? (
          <div className="p-12 text-center text-gray-500 dark:text-gray-400 space-y-2">
            <ArrowRightLeft className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-600" />
            <p className="text-sm font-medium">هیچ تفویض اختیاری یافت نشد</p>
            <p className="text-xs text-gray-400">می‌توانید با کلیک روی دکمه بالا، تفویض اختیار جدید ثبت کنید</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 font-semibold border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="p-3.5">تفویض‌کننده</th>
                  <th className="p-3.5">دریافت‌کننده (جانشین)</th>
                  <th className="p-3.5">حوزه (Scope)</th>
                  <th className="p-3.5">بازه زمانی اعتبار</th>
                  <th className="p-3.5">وضعیت</th>
                  <th className="p-3.5">دلیل / توضیحات</th>
                  <th className="p-3.5 text-center">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
                {filteredDelegations.map((item: any) => {
                  return (
                    <tr key={item.id} className="hover:bg-gray-50/80 dark:hover:bg-gray-700/30 transition-colors">
                      <td className="p-3.5 font-medium text-gray-900 dark:text-white">
                        {item.fromUserName}
                      </td>
                      <td className="p-3.5 font-medium text-indigo-600 dark:text-indigo-400">
                        {item.toUserName}
                      </td>
                      <td className="p-3.5">
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-mono bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                          <Layers className="w-3 h-3 text-gray-400" />
                          {item.scope === 'ALL' ? 'تمامی ورکفلوها (ALL)' : item.scope}
                        </span>
                      </td>
                      <td className="p-3.5 text-gray-600 dark:text-gray-300 text-[11px]">
                        <div>از: {new Date(item.startDate).toLocaleDateString('fa-IR')}</div>
                        <div>تا: {new Date(item.endDate).toLocaleDateString('fa-IR')}</div>
                      </td>
                      <td className="p-3.5">
                        {item.status === 'active' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                            <CheckCircle2 className="w-3 h-3" />
                            فعال
                          </span>
                        )}
                        {item.status === 'scheduled' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                            <Clock className="w-3 h-3" />
                            برنامه‌ریزی‌شده
                          </span>
                        )}
                        {item.status === 'expired' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                            منقضی شده
                          </span>
                        )}
                        {item.status === 'revoked' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800">
                            <XCircle className="w-3 h-3" />
                            لغو شده
                          </span>
                        )}
                      </td>
                      <td className="p-3.5 text-gray-500 dark:text-gray-400 max-w-xs truncate">
                        {item.reason || '-'}
                      </td>
                      <td className="p-3.5 text-center">
                        {(item.status === 'active' || item.status === 'scheduled') && (
                          <button
                            onClick={() => handleRevoke(item.id)}
                            disabled={revokeMutation.isPending}
                            className="p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-lg transition-colors"
                            title="لغو تفویض اختیار"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal for Creating Delegation */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-lg w-full shadow-xl border border-gray-200 dark:border-gray-700 space-y-5 animate-in fade-in zoom-in-95 max-h-[85vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 pb-3">
              <h3 className="font-bold text-base text-gray-900 dark:text-white flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-indigo-600" />
                <span>ثبت تفویض اختیار جدید</span>
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  کاربر جانشین (دریافت‌کننده تفویض) <span className="text-rose-500">*</span>
                </label>
                <select
                  value={toUserId}
                  onChange={(e) => setToUserId(e.target.value ? Number(e.target.value) : '')}
                  required
                  className="w-full px-3 py-2 text-xs bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl focus:outline-hidden focus:border-indigo-500 dark:text-white"
                >
                  <option value="">-- انتخاب کاربر جانشین --</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name || u.username} ({u.role || 'کاربر'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  حوزه شمول تفویض (Scope)
                </label>
                <select
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl focus:outline-hidden focus:border-indigo-500 dark:text-white"
                >
                  <option value="ALL">تمامی فرآیندها و کارتابل‌ها (ALL)</option>
                  {definitions.map((def: any) => (
                    <option key={def.id} value={def.code}>
                      ورکفلو: {def.title} ({def.code})
                    </option>
                  ))}
                  <option value="invoice">فقط فاکتورهای فروش و خرید</option>
                  <option value="transfer">فقط حواله‌های انبار</option>
                  <option value="project">فقط پروژه‌های تولیدی</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    تاریخ شروع تفویض <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    required
                    className="w-full px-3 py-2 text-xs bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl focus:outline-hidden focus:border-indigo-500 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    تاریخ پایان تفویض <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    required
                    className="w-full px-3 py-2 text-xs bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl focus:outline-hidden focus:border-indigo-500 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  علت تفویض / توضیحات
                </label>
                <textarea
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="مثال: مرخصی استحقاقی سالانه یا ماموریت کاری..."
                  className="w-full px-3 py-2 text-xs bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl focus:outline-hidden focus:border-indigo-500 dark:text-white"
                />
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-gray-100 dark:border-gray-700 pt-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="px-4 py-2 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-colors shadow-xs"
                >
                  {createMutation.isPending ? 'در حال ثبت...' : 'ثبت تفویض اختیار'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
