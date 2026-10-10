import React, { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { User, Role } from '../types';
import {
  Users,
  ShieldCheck,
  KeyRound,
  UserCheck,
} from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';
import { UsersTab } from '../components/users/UsersTab';
import { RolesTab } from '../components/users/RolesTab';
import { UserFormModal } from '../components/users/UserFormModal';
import { RoleFormModal } from '../components/users/RoleFormModal';
import { roleDraftFromTemplate, type RoleDraft } from '../lib/permissions/roleTemplates';
import {
  useUsersQuery,
  useRolesQuery,
  usePermissionCatalogQuery,
  useDeleteUserMutation,
  useDeleteRoleMutation,
} from '../hooks/queries';
import { QUERY_KEYS } from '../lib/queryKeys';
import { formatPersianNumber } from '../utils';
import { isSystemAdminRole } from '../lib/permissions/permissionCatalog';
import { canGrantPermission, grantorPermissionsOf, type GrantorPermissions } from '../lib/permissions/grantBoundary';
import { DELETE_USER_CONFIRM_MESSAGE } from '../lib/users/userRestore';

interface UsersPageProps {
  currentUser: User;
  userPermissions?: { permissions?: string[]; isAdmin?: boolean } | null;
}

/**
 * v9.0.130 (TD-525، یافته B02-10، تصمیم ت۳ الف): صفحه برای دارندگان «مدیریت کاربران» و «مدیریت نقش‌ها» باز است (همان
 * مجوزهای مسیر و API)، نه فقط برای کد مدیر سیستم. هر دکمه همان مجوز API خودش را می‌پرسد و فرم‌ها فقط آنچه کاربر جاری
 * می‌تواند بدهد پیشنهاد می‌کنند (قاعده مشترک `grantBoundary`).
 */
export default function UsersPage({ currentUser, userPermissions }: UsersPageProps) {
  const fullGrantor: GrantorPermissions = userPermissions?.isAdmin
    ? 'all'
    : grantorPermissionsOf(currentUser.role, userPermissions?.permissions);
  const canManageUsers = canGrantPermission(fullGrantor, 'users.manage');
  const canManageRoles = canGrantPermission(fullGrantor, 'roles.manage');
  const [activeTab, setActiveTab] = React.useState<'users' | 'roles'>(canManageUsers || !canManageRoles ? 'users' : 'roles');

  // V9 Phase 5.1: مهاجرت به React Query — کش مشترک، حذف fetch دستی و AbortController تکراری
  const queryClient = useQueryClient();
  const usersQuery = useUsersQuery();
  const rolesQuery = useRolesQuery();
  const permQuery = usePermissionCatalogQuery();
  const deleteUserMutation = useDeleteUserMutation();
  const deleteRoleMutation = useDeleteRoleMutation();

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
  // v9.0.134 (TD-526): پیش‌نویس نقش تازه از الگو
  const [roleDraft, setRoleDraft] = React.useState<RoleDraft | null>(null);
  const [confirmRoleState, setConfirmRoleState] = React.useState<{
    isOpen: boolean;
    roleId: number;
    roleName: string;
  }>({ isOpen: false, roleId: 0, roleName: '' });

  const loadData = () => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.users.all });
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.roles.all });
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.permissions.all });
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
      await deleteRoleMutation.mutateAsync(id);
      setConfirmRoleState({ isOpen: false, roleId: 0, roleName: '' });
    } catch {
      // Handled in mutation onError
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Overview Stats */}
      <div className="bg-white border rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b pb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <Users className="text-blue-600" size={24} />
              مدیریت کاربران و سطح دسترسی
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              تعریف کاربران، تخصیص نقش‌ها و تعیین مجوزهای هر نقش در همه بخش‌های سامانه
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
              لیست کاربران ({formatPersianNumber(users.length)})
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
              ماتریس نقش‌ها و مجوزها ({formatPersianNumber(rolesList.length)})
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
              <strong className="text-base text-slate-800 font-bold">{formatPersianNumber(users.length)} نفر</strong>
            </div>
          </div>

          <div className="bg-purple-50/60 border border-purple-100 rounded-lg p-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-500/10 text-purple-600 flex items-center justify-center">
              <ShieldCheck size={20} />
            </div>
            <div>
              <span className="text-[11px] text-slate-500 font-medium block">نقش‌های تعریف‌شده</span>
              <strong className="text-base text-slate-800 font-bold">{formatPersianNumber(rolesList.length)} نقش</strong>
            </div>
          </div>

          <div className="bg-emerald-50/60 border border-emerald-100 rounded-lg p-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
              <KeyRound size={20} />
            </div>
            <div>
              <span className="text-[11px] text-slate-500 font-medium block">مجوزهای سیستم</span>
              <strong className="text-base text-slate-800 font-bold">
                {formatPersianNumber(totalCatalogPermsCount)} کلید
              </strong>
            </div>
          </div>

          <div className="bg-amber-50/60 border border-amber-100 rounded-lg p-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 text-amber-600 flex items-center justify-center">
              <UserCheck size={20} />
            </div>
            <div>
              <span className="text-[11px] text-slate-500 font-medium block">
                مدیران سیستم
              </span>
              <strong className="text-base text-slate-800 font-bold">
                {formatPersianNumber(users.filter((u: any) => isSystemAdminRole(u.role)).length)} کاربر
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
          canManage={canManageUsers}
          grantor={fullGrantor}
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
            setRoleDraft(null);
            setShowRoleModal(true);
          }}
          onAddRoleFromTemplate={(t) => {
            setEditingRole(null);
            setRoleDraft(roleDraftFromTemplate(t, rolesList.map((r: Role) => r.code), fullGrantor));
            setShowRoleModal(true);
          }}
          onEditRole={(r) => {
            setEditingRole(r);
            setRoleDraft(null);
            setShowRoleModal(true);
          }}
          onDeleteRole={(roleId, roleName) => {
            setConfirmRoleState({ isOpen: true, roleId, roleName });
          }}
          canManage={canManageRoles}
          ownRoleCode={currentUser.role}
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
        grantor={fullGrantor}
        currentUserId={currentUser.id}
      />

      {/* ROLE & PERMISSION MATRIX MODAL */}
      <RoleFormModal
        isOpen={showRoleModal}
        onClose={() => {
          setShowRoleModal(false);
          setEditingRole(null);
          setRoleDraft(null);
        }}
        editingRole={editingRole}
        permCatalog={permCatalog}
        onSuccess={loadData}
        grantor={fullGrantor}
        draft={roleDraft}
      />

      {/* CONFIRM DELETE USER */}
      <ConfirmModal
        isOpen={confirmUserState.isOpen}
        message={DELETE_USER_CONFIRM_MESSAGE}
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
