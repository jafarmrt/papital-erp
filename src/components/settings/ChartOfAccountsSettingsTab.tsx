import { useCallback } from 'react';
import toast from 'react-hot-toast';
import { ChartOfAccountsTab } from '../accounting/ChartOfAccountsTab';
import { errorMessageOf } from '../../utils';
import type { Account } from '../../types';
import {
  useAccountMutations,
  useAccountsListQuery,
  useAccountsTreeQuery,
  type AccountPayload,
} from '../../hooks/accounting/useAccountsQueries';

const NO_ACCOUNTS: Account[] = [];

/**
 * تنظیمات › کدینگ حساب‌ها (مقصد تب «کدینگ» صفحه حسابداری): همان کش و ذخیره‌های React Query صفحه حسابداری،
 * پس تغییر کدینگ در هر دو جا نمایش داده می‌شود.
 */
export function ChartOfAccountsSettingsTab() {
  const accountsQuery = useAccountsListQuery();
  const treeQuery = useAccountsTreeQuery();
  const { createAccount, updateAccount, deleteAccount, seedStandardAccounts } = useAccountMutations();
  const accounts = accountsQuery.data ?? NO_ACCOUNTS;
  const treeAccounts = treeQuery.data ?? NO_ACCOUNTS;
  const loading = accountsQuery.isFetching || treeQuery.isFetching || seedStandardAccounts.isPending;

  const { refetch: refetchAccounts } = accountsQuery;
  const { refetch: refetchTree } = treeQuery;
  const loadData = useCallback(() => {
    void refetchAccounts();
    void refetchTree();
  }, [refetchAccounts, refetchTree]);

  // v9.0.203 (TD-576، B03-34): پیام ذخیره و حذف را فقط خود تب کدینگ می‌دهد (پیش‌تر هر پیام دو بار می‌آمد)
  const handleCreateAccount = async (data: AccountPayload) => {
    await createAccount.mutateAsync(data);
  };

  const handleUpdateAccount = async (id: number, data: AccountPayload) => {
    await updateAccount.mutateAsync({ id, data });
  };

  const handleDeleteAccount = async (id: number) => {
    await deleteAccount.mutateAsync(id);
  };

  // خطا همین‌جا پیام می‌شود و دوباره پرتاب نمی‌شود؛ پیش‌تر دکمه وعده را رها می‌کرد و ۴۰۳ رد رسیدگی‌نشده می‌ساخت
  const handleSeedStandardAccounts = async () => {
    if (seedStandardAccounts.isPending) return;
    try {
      await seedStandardAccounts.mutateAsync();
      toast.success('کدینگ استاندارد با موفقیت بارگذاری شد');
    } catch (err: unknown) {
      toast.error(errorMessageOf(err) || 'خطا در ایجاد سرفصل‌های پیش‌فرض');
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm">
      <div className="mb-4 pb-3 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h2 className="text-base font-black text-slate-800">کدینگ و ساختار سلسله‌مراتبی حساب‌ها</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            مدیریت درخت حساب‌های گروه، کل، معین و تفصیلی مطابق با استانداردهای حسابداری دوبل ایران
          </p>
        </div>
      </div>
      <ChartOfAccountsTab
        accounts={accounts}
        treeAccounts={treeAccounts}
        loading={loading}
        onRefresh={loadData}
        onCreateAccount={handleCreateAccount}
        onUpdateAccount={handleUpdateAccount}
        onDeleteAccount={handleDeleteAccount}
        onSeedStandardAccounts={handleSeedStandardAccounts}
      />
    </div>
  );
}
