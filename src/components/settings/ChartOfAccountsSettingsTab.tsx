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

  const handleCreateAccount = async (data: AccountPayload) => {
    try {
      await createAccount.mutateAsync(data);
      toast.success('حساب جدید با موفقیت ایجاد شد');
    } catch (err: unknown) {
      toast.error(errorMessageOf(err) || 'خطا در ایجاد حساب');
      throw err;
    }
  };

  const handleUpdateAccount = async (id: number, data: AccountPayload) => {
    try {
      await updateAccount.mutateAsync({ id, data });
      toast.success('حساب با موفقیت ویرایش شد');
    } catch (err: unknown) {
      toast.error(errorMessageOf(err) || 'خطا در ویرایش حساب');
      throw err;
    }
  };

  const handleDeleteAccount = async (id: number) => {
    try {
      await deleteAccount.mutateAsync(id);
      toast.success('حساب با موفقیت حذف شد');
    } catch (err: unknown) {
      toast.error(errorMessageOf(err) || 'خطا در حذف حساب');
      throw err;
    }
  };

  const handleSeedStandardAccounts = async () => {
    if (seedStandardAccounts.isPending) return;
    try {
      await seedStandardAccounts.mutateAsync();
      toast.success('کدینگ استاندارد با موفقیت بارگذاری شد');
    } catch (err: unknown) {
      toast.error(errorMessageOf(err) || 'خطا در ایجاد سرفصل‌های پیش‌فرض');
      throw err;
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
