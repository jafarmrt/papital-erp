import React, { useState, useMemo } from 'react';
import { confirmAction } from '../ConfirmDialogHost';
import { 
  FolderTree, 
  Plus, 
  Search, 
  Filter, 
  ChevronRight, 
  ChevronDown, 
  Edit3, 
  Trash2, 
  RefreshCw, 
  CheckCircle2, 
  Layers, 
  Folder, 
  FileText,
  AlertCircle,
  Hash
} from 'lucide-react';
import { formatPersianPrice, formatPersianNumber } from '../../utils';
import type { Account, AccountLevel, AccountType, AccountNature } from '../../types';
import toast from 'react-hot-toast';

interface ChartOfAccountsTabProps {
  accounts: Account[];
  treeAccounts: Account[];
  loading: boolean;
  onRefresh: () => void;
  onCreateAccount: (data: any) => Promise<void>;
  onUpdateAccount: (id: number, data: any) => Promise<void>;
  onDeleteAccount: (id: number) => Promise<void>;
  onSeedStandardAccounts: () => Promise<void>;
}

export function ChartOfAccountsTab({
  accounts,
  treeAccounts,
  loading,
  onRefresh,
  onCreateAccount,
  onUpdateAccount,
  onDeleteAccount,
  onSeedStandardAccounts,
}: ChartOfAccountsTabProps) {
  const safeAccounts = Array.isArray(accounts) ? accounts : [];
  const safeTreeAccounts = Array.isArray(treeAccounts) ? treeAccounts : [];

  const [viewMode, setViewMode] = useState<'tree' | 'table'>('tree');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLevel, setSelectedLevel] = useState<string>('all');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [expandedNodes, setExpandedNodes] = useState<Record<number, boolean>>({});

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    level: 'subsidiary' as AccountLevel,
    parentId: null as number | null,
    accountType: 'asset' as AccountType,
    nature: 'debit' as AccountNature,
    description: '',
  });
  const [isSaving, setIsSaving] = useState(false);

  const toggleExpand = (id: number) => {
    setExpandedNodes(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const expandAll = () => {
    const all: Record<number, boolean> = {};
    accounts.forEach(a => { all[a.id] = true; });
    setExpandedNodes(all);
  };

  const collapseAll = () => {
    setExpandedNodes({});
  };

  const openCreateModal = (parent?: Account) => {
    setEditingAccount(null);
    let nextLevel: AccountLevel = 'subsidiary';
    let nextType: AccountType = parent?.accountType || 'asset';
    let nextNature: AccountNature = parent?.nature || 'debit';

    if (parent) {
      if (parent.level === 'group') nextLevel = 'general';
      else if (parent.level === 'general') nextLevel = 'subsidiary';
      else if (parent.level === 'subsidiary') nextLevel = 'detailed';
    }

    setFormData({
      code: '',
      name: '',
      level: nextLevel,
      parentId: parent ? parent.id : null,
      accountType: nextType,
      nature: nextNature,
      description: '',
    });
    setIsModalOpen(true);
  };

  const openEditModal = (acc: Account) => {
    setEditingAccount(acc);
    setFormData({
      code: acc.code,
      name: acc.name,
      level: acc.level,
      parentId: acc.parentId || null,
      accountType: acc.accountType,
      nature: acc.nature,
      description: acc.description || '',
    });
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.code.trim() || !formData.name.trim()) {
      toast.error('کد و نام حساب الزامی است');
      return;
    }

    setIsSaving(true);
    try {
      if (editingAccount) {
        await onUpdateAccount(editingAccount.id, formData);
        toast.success('حساب با موفقیت ویرایش شد');
      } else {
        await onCreateAccount(formData);
        toast.success('حساب جدید با موفقیت ایجاد شد');
      }
      setIsModalOpen(false);
    } catch (err) {
      toast.error(err.message || 'خطا در ذخیره حساب');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (acc: Account) => {
    if (acc.isSystem === 1) {
      toast.error('حساب‌های سیستمی و پایه قابل حذف نیستند');
      return;
    }
    if (!(await confirmAction({ title: 'حذف حساب', message: `آیا از حذف حساب "${acc.name}" (کد: ${acc.code}) اطمینان دارید؟` }))) return;

    try {
      await onDeleteAccount(acc.id);
      toast.success('حساب حذف شد');
    } catch (err) {
      toast.error(err.message || 'خطا در حذف حساب');
    }
  };

  // Filtered accounts for table view & search
  const filteredAccounts = useMemo(() => {
    return safeAccounts.filter(acc => {
      const matchSearch = !searchQuery.trim() || 
        acc.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
        acc.code.includes(searchQuery.trim());
      const matchLevel = selectedLevel === 'all' || acc.level === selectedLevel;
      const matchType = selectedType === 'all' || acc.accountType === selectedType;
      return matchSearch && matchLevel && matchType;
    });
  }, [safeAccounts, searchQuery, selectedLevel, selectedType]);

  const levelLabels: Record<AccountLevel, { label: string; badge: string }> = {
    group: { label: 'گروه حساب', badge: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300' },
    general: { label: 'حساب کل', badge: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
    subsidiary: { label: 'حساب معین', badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
    detailed: { label: 'تفصیلی', badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  };

  const typeLabels: Record<AccountType, string> = {
    asset: 'دارایی',
    liability: 'بدهی',
    equity: 'حقوق صاحبان سهام',
    revenue: 'درآمد',
    expense: 'هزینه',
    cost_of_sales: 'بهای تمام‌شده',
  };

  // Render recursive tree node
  const MAX_TREE_DEPTH = 50;
  const renderTreeNode = (node: Account, depth = 0, visited = new Set<number>()) => {
    if (depth > MAX_TREE_DEPTH || visited.has(node.id)) {
      console.warn('ChartOfAccountsTab: tree render guard triggered (cycle or excessive depth)', {
        nodeId: node.id,
        code: node.code,
        depth,
      });
      return null;
    }
    visited.add(node.id);
    const hasChildren = Array.isArray(node?.children) && node.children.length > 0;
    const isExpanded = expandedNodes[node.id] ?? (depth < 2);

    return (
      <div key={node.id} className="select-none">
        <div 
          className={`flex items-center justify-between p-2.5 my-1 rounded-xl transition border ${
            node.level === 'group' 
              ? 'bg-slate-100 dark:bg-slate-800/90 font-bold border-slate-200 dark:border-slate-700' 
              : node.level === 'general'
              ? 'bg-white dark:bg-slate-800/50 font-semibold border-slate-100 dark:border-slate-700/50'
              : 'bg-slate-50/50 dark:bg-slate-800/30 text-sm border-transparent hover:border-slate-200 dark:hover:border-slate-700'
          }`}
          style={{ paddingRight: `${Math.max(12, depth * 24)}px` }}
        >
          <div className="flex items-center gap-2">
            {hasChildren ? (
              <button 
                onClick={() => toggleExpand(node.id)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded"
              >
                {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
            ) : (
              <span className="w-6" />
            )}

            <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
              {node.code}
            </span>

            <span className="text-slate-800 dark:text-slate-200 font-medium">
              {node.name}
            </span>

            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${levelLabels[node.level].badge}`}>
              {levelLabels[node.level].label}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-left font-mono text-xs">
              <span className={`font-bold ${(node.balance || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                {formatPersianPrice(Math.abs(node.balance || 0))}
              </span>
              <span className="text-[10px] text-slate-400 mr-1">
                {(node.balance || 0) >= 0 ? (node.nature === 'credit' ? 'بس' : 'بد') : (node.nature === 'credit' ? 'بد' : 'بس')}
              </span>
            </div>

            <div className="flex items-center gap-1">
              {node.level !== 'detailed' && (
                <button
                  onClick={() => openCreateModal(node)}
                  title="افزودن زیرمجموعه"
                  className="p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded transition"
                >
                  <Plus className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={() => openEditModal(node)}
                title="ویرایش"
                className="p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded transition"
              >
                <Edit3 className="w-4 h-4" />
              </button>
              {node.isSystem !== 1 && (
                <button
                  onClick={() => handleDelete(node)}
                  title="حذف"
                  className="p-1 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded transition"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {hasChildren && isExpanded && (
          <div className="border-r-2 border-slate-200/60 dark:border-slate-700/60 mr-4">
            {(node.children || []).map(child => renderTreeNode(child, depth + 1, visited))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header & Action Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <FolderTree className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h3 className="font-bold text-slate-900 dark:text-white text-lg">ساختار و درخت کدینگ حساب‌ها</h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            مدیریت ۴ سطحی حساب‌های استاندارد (گروه، کل، معین و تفصیلی) با تراز لحظه‌ای
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => onSeedStandardAccounts()}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-xl transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>همگام‌سازی کدینگ پیش‌فرض</span>
          </button>

          <button
            onClick={() => openCreateModal()}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>تعریف حساب جدید</span>
          </button>
        </div>
      </div>

      {/* Filter & View Switcher Bar */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-3 bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700">
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {/* Search */}
          <div className="relative flex-1 sm:w-64">
            <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="جستجو در کد یا نام حساب..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pr-9 pl-3 py-1.5 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 dark:text-slate-100"
            />
          </div>

          {/* Level Filter */}
          <select
            value={selectedLevel}
            onChange={e => setSelectedLevel(e.target.value)}
            className="px-3 py-1.5 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-800 dark:text-slate-100"
          >
            <option value="all">همه سطوح</option>
            <option value="group">سطح ۱: گروه</option>
            <option value="general">سطح ۲: کل</option>
            <option value="subsidiary">سطح ۳: معین</option>
            <option value="detailed">سطح ۴: تفصیلی</option>
          </select>

          {/* Type Filter */}
          <select
            value={selectedType}
            onChange={e => setSelectedType(e.target.value)}
            className="px-3 py-1.5 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-800 dark:text-slate-100"
          >
            <option value="all">همه ماهیت‌ها</option>
            <option value="asset">دارایی‌ها</option>
            <option value="liability">بدهی‌ها</option>
            <option value="equity">سرمایه و حقوق صاحبان سهام</option>
            <option value="revenue">درآمدها</option>
            <option value="cost_of_sales">بهای تمام‌شده</option>
            <option value="expense">هزینه‌ها</option>
          </select>
        </div>

        {/* View Mode & Expand Controls */}
        <div className="flex items-center gap-2 w-full md:w-auto justify-end">
          {viewMode === 'tree' && (
            <div className="flex items-center gap-1 text-xs">
              <button
                onClick={expandAll}
                className="px-2.5 py-1 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition"
              >
                باز کردن همه
              </button>
              <button
                onClick={collapseAll}
                className="px-2.5 py-1 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition"
              >
                بستن همه
              </button>
            </div>
          )}

          <div className="flex items-center bg-white dark:bg-slate-700 rounded-lg p-0.5 border border-slate-300 dark:border-slate-600">
            <button
              onClick={() => setViewMode('tree')}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition ${
                viewMode === 'tree' ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              نمای درختی
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition ${
                viewMode === 'table' ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              نمای جدولی
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {viewMode === 'tree' && !searchQuery.trim() && selectedLevel === 'all' && selectedType === 'all' ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 p-5 shadow-sm space-y-2">
          {safeTreeAccounts.length === 0 ? (
            <div className="text-center py-12 text-slate-400">حسابی یافت نشد</div>
          ) : (
            safeTreeAccounts.map(rootNode => renderTreeNode(rootNode))
          )}
        </div>
      ) : (
        /* Table View */
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 text-xs font-bold">
                  <th className="py-3 px-4">کد حساب</th>
                  <th className="py-3 px-4">عنوان حساب</th>
                  <th className="py-3 px-4">سطح</th>
                  <th className="py-3 px-4">طبقه‌بندی</th>
                  <th className="py-3 px-4">ماهیت</th>
                  <th className="py-3 px-4 text-left">گردش بدهکار</th>
                  <th className="py-3 px-4 text-left">گردش بستانکار</th>
                  <th className="py-3 px-4 text-left">مانده نهایی</th>
                  <th className="py-3 px-4 text-center">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60 text-xs">
                {filteredAccounts.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-8 text-slate-400">موردی با این مشخصات یافت نشد</td>
                  </tr>
                ) : (
                  filteredAccounts.map(acc => (
                    <tr key={acc.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition">
                      <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-white">
                        {acc.code}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-800 dark:text-slate-200">
                        {acc.name}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${levelLabels[acc.level].badge}`}>
                          {levelLabels[acc.level].label}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                        {typeLabels[acc.accountType]}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`text-[10px] font-bold ${
                          acc.nature === 'debit' ? 'text-blue-600' : acc.nature === 'credit' ? 'text-amber-600' : 'text-slate-500'
                        }`}>
                          {acc.nature === 'debit' ? 'بدهکار' : acc.nature === 'credit' ? 'بستانکار' : 'دوگانه'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-left font-mono text-slate-700 dark:text-slate-300">
                        {formatPersianPrice(acc.totalDebit || 0)}
                      </td>
                      <td className="py-3 px-4 text-left font-mono text-slate-700 dark:text-slate-300">
                        {formatPersianPrice(acc.totalCredit || 0)}
                      </td>
                      <td className="py-3 px-4 text-left font-mono font-bold text-slate-900 dark:text-white">
                        {formatPersianPrice(Math.abs(acc.balance || 0))}
                        <span className="text-[10px] text-slate-400 mr-1 font-normal">
                          {(acc.balance || 0) >= 0 ? (acc.nature === 'credit' ? 'بس' : 'بد') : (acc.nature === 'credit' ? 'بد' : 'بس')}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => openEditModal(acc)}
                            className="p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          {acc.isSystem !== 1 && (
                            <button
                              onClick={() => handleDelete(acc)}
                              className="p-1 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-lg w-full border border-slate-200 dark:border-slate-700 animate-in fade-in zoom-in-95 duration-200 max-h-[85vh] overflow-y-auto p-6">
            <h3 className="font-bold text-slate-900 dark:text-white text-base mb-4">
              {editingAccount ? `ویرایش حساب: ${editingAccount.name}` : 'تعریف حساب جدید در کدینگ'}
            </h3>

            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    کد حساب *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.code}
                    onChange={e => setFormData({ ...formData, code: e.target.value })}
                    placeholder="مثال: 1001"
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    سطح حساب *
                  </label>
                  <select
                    value={formData.level}
                    disabled={!!editingAccount}
                    onChange={e => setFormData({ ...formData, level: e.target.value as AccountLevel })}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
                  >
                    <option value="group">سطح ۱: گروه</option>
                    <option value="general">سطح ۲: کل</option>
                    <option value="subsidiary">سطح ۳: معین</option>
                    <option value="detailed">سطح ۴: تفصیلی</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  عنوان حساب *
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  placeholder="مثال: صندوق مرکزی کارگاه"
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              {formData.level !== 'group' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    حساب بالادست (والد)
                  </label>
                  <select
                    value={formData.parentId || ''}
                    onChange={e => setFormData({ ...formData, parentId: e.target.value ? Number(e.target.value) : null })}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
                  >
                    <option value="">بدون والد (سطح ریشه)</option>
                    {safeAccounts
                      .filter(a => {
                        if (formData.level === 'general') return a.level === 'group';
                        if (formData.level === 'subsidiary') return a.level === 'general';
                        if (formData.level === 'detailed') return a.level === 'subsidiary';
                        return false;
                      })
                      .map(a => (
                        <option key={a.id} value={a.id}>
                          {a.code} - {a.name} ({levelLabels[a.level].label})
                        </option>
                      ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    نوع / طبقه‌بندی
                  </label>
                  <select
                    value={formData.accountType}
                    onChange={e => setFormData({ ...formData, accountType: e.target.value as AccountType })}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
                  >
                    <option value="asset">دارایی</option>
                    <option value="liability">بدهی</option>
                    <option value="equity">حقوق صاحبان سهام</option>
                    <option value="revenue">درآمد</option>
                    <option value="cost_of_sales">بهای تمام‌شده</option>
                    <option value="expense">هزینه</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    ماهیت حساب
                  </label>
                  <select
                    value={formData.nature}
                    onChange={e => setFormData({ ...formData, nature: e.target.value as AccountNature })}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
                  >
                    <option value="debit">بدهکار</option>
                    <option value="credit">بستانکار</option>
                    <option value="both">دوگانه</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  توضیحات و یادداشت
                </label>
                <textarea
                  rows={2}
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  placeholder="توضیحات تکمیلی پیرامون کاربرد حساب..."
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl transition shadow-sm disabled:opacity-50"
                >
                  {isSaving ? 'در حال ثبت...' : (editingAccount ? 'به‌روزرسانی حساب' : 'ایجاد حساب')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
