import { useState, useEffect, useCallback } from 'react';
import { fetchJson } from '../../api';
import toast from 'react-hot-toast';
import { ChartOfAccountsTab } from '../accounting/ChartOfAccountsTab';
import type { Account } from '../../types';

export function ChartOfAccountsSettingsTab() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [treeAccounts, setTreeAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const [accRes, treeRes] = await Promise.all([
        fetchJson('/accounting/accounts', { signal }).catch(() => []),
        fetchJson('/accounting/accounts/tree', { signal }).catch(() => [])
      ]);
      const safeAccounts = Array.isArray(accRes?.data) ? accRes.data : (Array.isArray(accRes) ? accRes : []);
      const safeTree = Array.isArray(treeRes?.data) ? treeRes.data : (Array.isArray(treeRes) ? treeRes : []);
      setAccounts(safeAccounts);
      setTreeAccounts(safeTree);
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        toast.error('خطا در دریافت کدینگ حساب‌ها');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadData(controller.signal);
    return () => controller.abort();
  }, [loadData]);

  const handleCreateAccount = async (data: any) => {
    try {
      await fetchJson('/accounting/accounts', {
        method: 'POST',
        body: JSON.stringify(data)
      });
      toast.success('حساب جدید با موفقیت ایجاد شد');
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || 'خطا در ایجاد حساب');
      throw err;
    }
  };

  const handleUpdateAccount = async (id: number, data: any) => {
    try {
      await fetchJson(`/accounting/accounts/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data)
      });
      toast.success('حساب با موفقیت ویرایش شد');
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || 'خطا در ویرایش حساب');
      throw err;
    }
  };

  const handleDeleteAccount = async (id: number) => {
    try {
      await fetchJson(`/accounting/accounts/${id}`, {
        method: 'DELETE'
      });
      toast.success('حساب با موفقیت حذف شد');
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || 'خطا در حذف حساب');
      throw err;
    }
  };

  const handleSeedStandardAccounts = async () => {
    try {
      await fetchJson('/accounting/accounts/seed-standard', {
        method: 'POST'
      });
      toast.success('کدینگ استاندارد با موفقیت بارگذاری شد');
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || 'خطا در ایجاد سرفصل‌های پیش‌فرض');
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
