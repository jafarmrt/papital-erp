import React, { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../api';
import { toast } from 'react-hot-toast';
import { User, Role } from '../types';
import {
  Users,
  ShieldCheck,
  KeyRound,
  Lock,
  UserCheck,
} from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';
import { UsersTab } from '../components/users/UsersTab';
import { RolesTab } from '../components/users/RolesTab';
import { UserFormModal } from '../components/users/UserFormModal';
import { RoleFormModal } from '../components/users/RoleFormModal';
import {
  useUsersQuery,
  useRolesQuery,
  usePermissionCatalogQuery,
  useDeleteUserMutation
} from '../hooks/queries';
import { QUERY_KEYS } from '../lib/queryKeys';

export default function UsersPage({ currentUser }: { currentUser: User }) {
  const [activeTab, setActiveTab] = React.useState<'users' | 'roles'>('users');

  // V9 Phase 5.1: مهاجرت به React Query — کش مشترک، حذف fetch دستی و AbortController تکراری
  const queryClient = useQueryClient();
  const usersQuery = useUsersQuery();
  const rolesQuery = useRolesQuery();
  const permQuery = usePermissionCatalogQuery();
  const deleteUserMutation = useDeleteUserMutation();

  const users = usersQuery.data ?? [];
  const rolesList = rolesQuery.data ?? [];
  const permCatalog = permQuery.data ?? [];

  // User Modal State
  const [showUserModal, setShowUserModal] = React.useState(false);
  const [editingUser, setEditingUser] = React.useState<User | null>(null);
  const [confirmUserState, setConfirmUserState] = React.useState<{ isOpen: boolean; userId: number }>({
    isOpen: false,
    userId: 0,
  });

  // Role Modal State
  const [showRoleModal, setShowRoleModal] = React.useState(false);
  const [editingRole, setEditingRole] = React.useState<Role | null>(null);
  const [confirmRoleState, setConfirmRoleState] = React.useState<{
    isOpen: boolean;
    roleId: number;
    roleName: string;
  }>({ isOpen: false, roleId: 0, roleName: '' });

  const loadData = () => {
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.users.all });
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.roles.all });
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.permissions.all });
  };

  // Total permissions count in catalog
  const totalCatalogPermsCount = useMemo(() => {
    return (Array.isArray(permCatalog) ? permCatalog : []).reduce((acc: number, c: any) => acc + (c?.permissions?.length || 0), 0);
  }, [permCatalog]);

  const executeDeleteUser = async () => {
    const id = confirmUserState.userId;
    await deleteUserMutation.mutateAsync(id);
    setConfirmUserState({ isOpen: false, userId: 0 });
  };

  const executeDeleteRole = async () => {
    const id = confirmRoleState.roleId;
    try {
      await fetchJson(`/roles/${id}`, { method: 'DELETE' });
      toast.success('نقش با موفقیت حذف شد');
      loadData();
      setConfirmRoleState({ isOpen: false, roleId: 0, roleName: '' });
    } catch (err: any) {
      toast.error(err.message || 'خطا در حذف نقش');
    }
  };

  if (currentUser.role !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-slate-500">
        <Lock size={56} className="mb-4 text-slate-400" />
        <h2 className="text-xl font-bold mb-2 text-slate-800">دسترسی محدود</h2>
        <p className="text-sm">
          تنها مدیران ارشد سیستم به مدیریت کاربران و ماتریس نقش‌ها دسترسی دارند.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header & Overview Stats */}
      <div className="bg-white border rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b pb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <Users className="text-blue-600" size={24} />
              مدیریت کاربران و سطح دسترسی (RBAC)
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              تعریف کاربران، تخصیص نقش‌های سفارشی و پیکربندی تفکیکی ماتریس مجوزهای تمامی ماژول‌های سیستم
            </p>
          </div>

          <div className="flex items-center bg-slate-100 p-1 rounded-lg text-xs font-medium self-stretch md:self-auto">
            <button
              onClick={() => setActiveTab('users')}
              className={`flex-1 md:flex-none px-4 py-2 rounded-md transition-all flex items-center justify-center gap-2 ${
                activeTab === 'users'
                  ? 'bg-white text-blue-700 shadow-sm font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Users size={16} />
              لیست کاربران ({users.length})
            </button>
            <button
              onClick={() => setActiveTab('roles')}
              className={`flex-1 md:flex-none px-4 py-2 rounded-md transition-all flex items-center justify-center gap-2 ${
                activeTab === 'roles'
                  ? 'bg-white text-blue-700 shadow-sm font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ShieldCheck size={16} />
              ماتریس نقش‌ها و مجوزها ({rolesList.length})
            </button>
          </div>
        </div>

        {/* Stats Summary Widgets */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-blue-50/60 border border-blue-100 rounded-lg p-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 text-blue-600 flex items-center justify-center">
              <Users size={20} />
            </div>
            <div>
              <span className="text-[11px] text-slate-500 font-medium block">کل کاربران سیستم</span>
              <strong className="text-base text-slate-800 font-bold">{users.length} نفر</strong>
            </div>
          </div>

          <div className="bg-purple-50/60 border border-purple-100 rounded-lg p-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-500/10 text-purple-600 flex items-center justify-center">
              <ShieldCheck size={20} />
            </div>
            <div>
              <span className="text-[11px] text-slate-500 font-medium block">نقش‌های تعریف‌شده</span>
              <strong className="text-base text-slate-800 font-bold">{rolesList.length} نقش</strong>
            </div>
          </div>

          <div className="bg-emerald-50/60 border border-emerald-100 rounded-lg p-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
              <KeyRound size={20} />
            </div>
            <div>
              <span className="text-[11px] text-slate-500 font-medium block">مجوزهای سیستم</span>
              <strong className="text-base text-slate-800 font-bold">
                {totalCatalogPermsCount} کلید
              </strong>
            </div>
          </div>

          <div className="bg-amber-50/60 border border-amber-100 rounded-lg p-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 text-amber-600 flex items-center justify-center">
              <UserCheck size={20} />
            </div>
            <div>
              <span className="text-[11px] text-slate-500 font-medium block">
                مدیران ارشد (Admin)
              </span>
              <strong className="text-base text-slate-800 font-bold">
                {users.filter((u) => u.role === 'admin').length} کاربر
              </strong>
            </div>
          </div>
        </div>
      </div>

      {/* TAB 1: USERS LIST */}
      {activeTab === 'users' && (
        <UsersTab
          users={users}
          rolesList={rolesList}
          currentUser={currentUser}
          onAddUser={() => {
            setEditingUser(null);
            setShowUserModal(true);
          }}
          onEditUser={(u) => {
            setEditingUser(u);
            setShowUserModal(true);
          }}
          onDeleteUser={(userId) => {
            setConfirmUserState({ isOpen: true, userId });
          }}
        />
      )}

      {/* TAB 2: ROLES & PERMISSION MATRIX */}
      {activeTab === 'roles' && (
        <RolesTab
          rolesList={rolesList}
          users={users}
          totalCatalogPermsCount={totalCatalogPermsCount}
          onAddRole={() => {
            setEditingRole(null);
            setShowRoleModal(true);
          }}
          onEditRole={(r) => {
            setEditingRole(r);
            setShowRoleModal(true);
          }}
          onDeleteRole={(roleId, roleName) => {
            setConfirmRoleState({ isOpen: true, roleId, roleName });
          }}
        />
      )}

      {/* USER MODAL */}
      <UserFormModal
        isOpen={showUserModal}
        onClose={() => {
          setShowUserModal(false);
          setEditingUser(null);
        }}
        editingUser={editingUser}
        rolesList={rolesList}
        onSuccess={loadData}
      />

      {/* ROLE & PERMISSION MATRIX MODAL */}
      <RoleFormModal
        isOpen={showRoleModal}
        onClose={() => {
          setShowRoleModal(false);
          setEditingRole(null);
        }}
        editingRole={editingRole}
        permCatalog={permCatalog}
        onSuccess={loadData}
      />

      {/* CONFIRM DELETE USER */}
      <ConfirmModal
        isOpen={confirmUserState.isOpen}
        message="آیا از حذف این کاربر اطمینان دارید؟ این عملیات غیر قابل بازگشت است."
        onConfirm={executeDeleteUser}
        onCancel={() => setConfirmUserState({ isOpen: false, userId: 0 })}
      />

      {/* CONFIRM DELETE ROLE */}
      <ConfirmModal
        isOpen={confirmRoleState.isOpen}
        message={`آیا از حذف نقش "${confirmRoleState.roleName}" اطمینان دارید؟`}
        onConfirm={executeDeleteRole}
        onCancel={() => setConfirmRoleState({ isOpen: false, roleId: 0, roleName: '' })}
      />
    </div>
  );
}
