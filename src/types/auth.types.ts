export interface User {
  id: number;
  username: string;
  full_name: string;
  role: string;
  avatar_url?: string;
  mustResetPassword?: boolean | number;
  must_reset_password?: boolean | number;
}

export interface AuthUserPayload {
  id: number;
  username: string;
  role: string;
  fullName?: string;
  full_name?: string;
  avatarUrl?: string;
  avatar_url?: string;
  csrfToken?: string;
  mustResetPassword?: boolean | number;
  must_reset_password?: boolean | number;
  permissions?: string[];
}

export interface PermissionItem {
  key: string;
  title: string;
  description: string;
}

export interface PermissionCategory {
  category: string;
  permissions: PermissionItem[];
}

export interface Role {
  id: number;
  name: string;
  code: string;
  description: string;
  permissions: string[];
  isSystem: number;
}

export interface Changelog {
  id: number;
  version: string;
  date: string;
  features: string;
  fixes: string;
}

export interface ActivityLog {
  id: number;
  userId?: number;
  username: string;
  userFullName?: string;
  action: string;
  entity: string;
  entityId?: string;
  description: string;
  details?: any;
  ipAddress?: string;
  timestamp: string;
}
