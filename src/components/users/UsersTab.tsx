import React, { useState, useMemo } from 'react';
import { User, Role } from '../../types';
import {
  Plus,
  Trash2,
  Edit2,
  ShieldCheck,
  Shield,
  KeyRound,
  Search,
  Copy,
} from 'lucide-react';
import { ActionMenu } from '../ActionMenu';
import toast from 'react-hot-toast';

interface UsersTabProps {
  users: User[];
  rolesList: Role[];
  currentUser: User;
  onAddUser: () => void;
  onEditUser: (user: User) => void;
  onDeleteUser: (userId: number) => void;
}

export const UsersTab: React.FC<UsersTabProps> = ({
  users,
  rolesList,
  currentUser,
  onAddUser,
  onEditUser,
  onDeleteUser,
}) => {
  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState<string>('ALL');

  // Filtered Users List
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const matchesSearch =
        !userSearch.trim() ||
        u.full_name?.toLowerCase().includes(userSearch.toLowerCase()) ||
        u.username?.toLowerCase().includes(userSearch.toLowerCase());

      const matchesRole = userRoleFilter === 'ALL' || u.role === userRoleFilter;
      return matchesSearch && matchesRole;
    });
  }, [users, userSearch, userRoleFilter]);

  const getRoleBadge = (roleCode: string) => {
    const roleObj = rolesList.find((r) => r.code === roleCode);
    const roleTitle = roleObj
      ? roleObj.name
      : roleCode === 'admin'
      ? 'مدیر سیستم'
      : roleCode === 'manager'
      ? 'سرپرست'
      : 'تماشاگر';

    if (roleCode === 'admin') {
      return (
        <span className="bg-purple-100 text-purple-800 border border-purple-200 px-2.5 py-1 rounded-lg text-xs font-semibold inline-flex items-center gap-1">
          <ShieldCheck size={14} /> {roleTitle}
        </span>
      );
    }
    if (roleObj?.isSystem === 1) {
      return (
        <span className="bg-blue-100 text-blue-800 border border-blue-200 px-2.5 py-1 rounded-lg text-xs font-semibold inline-flex items-center gap-1">
          <Shield size={14} /> {roleTitle}
        </span>
      );
    }
    return (
      <span className="bg-emerald-100 text-emerald-800 border border-emerald-200 px-2.5 py-1 rounded-lg text-xs font-semibold inline-flex items-center gap-1">
        <KeyRound size={14} /> {roleTitle}
      </span>
    );
  };

  return (
    <div className="bg-white border rounded-xl shadow-sm flex flex-col min-h-[460px] overflow-hidden space-y-4 p-4">
      {/* Filters & Actions Bar */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-3 pb-3 border-b">
        <div className="flex flex-1 items-center gap-2 w-full md:w-auto">
          <div className="relative flex-1 max-w-sm">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="جستجو نام یا نام کاربری..."
              className="w-full pr-9 pl-3 py-1.5 text-xs border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <select
            value={userRoleFilter}
            onChange={(e) => setUserRoleFilter(e.target.value)}
            className="text-xs border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="ALL">همه نقش‌ها ({users.length})</option>
            <option value="admin">مدیر سیستم</option>
            {rolesList.map((r) => (
              <option key={r.id} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={onAddUser}
          className="px-3.5 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-1.5 shadow-sm shrink-0 w-full md:w-auto justify-center"
        >
          <Plus size={16} /> ثبت کاربر جدید
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto rounded-lg border">
        <table className="w-full text-sm text-right">
          <thead className="bg-slate-50 text-slate-600 border-b sticky top-0 font-medium text-xs">
            <tr>
              <th className="p-3.5">نام و نام خانوادگی</th>
              <th className="p-3.5">نام کاربری (حساب)</th>
              <th className="p-3.5">نقش و سطح دسترسی</th>
              <th className="p-3.5 text-center">عملیات</th>
            </tr>
          </thead>
          <tbody className="divide-y text-sm">
            {filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center py-10 text-slate-400 text-xs">
                  هیچ کاربری با مشخصات جستجویافته یافت نشد.
                </td>
              </tr>
            ) : (
              filteredUsers.map((u) => (
                <tr key={u.id} className="hover:bg-blue-50/40 transition-colors">
                  <td className="p-3.5 font-bold text-slate-800 flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-slate-200 text-slate-600 font-bold flex items-center justify-center text-xs">
                      {u.full_name ? u.full_name.charAt(0) : u.username.charAt(0)}
                    </div>
                    {u.full_name || 'بدون نام'}
                  </td>
                  <td className="p-3.5 font-mono text-slate-600 text-left" dir="ltr">
                    {u.username}
                  </td>
                  <td className="p-3.5">{getRoleBadge(u.role)}</td>
                  <td className="p-3.5 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        onClick={() => onEditUser(u)}
                        className="text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 p-1.5 rounded-lg transition-colors cursor-pointer"
                        title="ویرایش اطلاعات کاربر"
                      >
                        <Edit2 size={16} />
                      </button>
                      <ActionMenu
                        items={[
                          {
                            label: 'ویرایش اطلاعات کاربر',
                            icon: Edit2,
                            onClick: () => onEditUser(u),
                          },
                          {
                            label: `کپی نام کاربری (${u.username})`,
                            icon: Copy,
                            onClick: () => {
                              navigator.clipboard.writeText(u.username);
                              toast.success('نام کاربری کپی شد');
                            },
                          },
                          ...(u.id !== currentUser.id
                            ? [
                                {
                                  label: 'حذف کاربر',
                                  icon: Trash2,
                                  variant: 'danger' as const,
                                  onClick: () => onDeleteUser(u.id),
                                },
                              ]
                            : []),
                        ]}
                        align="left"
                      />
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
