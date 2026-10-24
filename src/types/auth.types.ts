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
  /** 10.2 package 8 (D-07): the key of the token's `user_sessions` row; absent on a token issued before it */
  sid?: string;
  tokenVersion?: number;
  /** 10.3 package 5: set on a request let in with the device's previous token version inside its grace; never signed */
  tokenGrace?: boolean;
  iat?: number;
  exp?: number;
  mustResetPassword?: boolean | number;
  must_reset_password?: boolean | number;
  permissions?: string[];
}

export interface PermissionItem {
  key: string;
  title: string;
  description: string;
  requires?: readonly string[];
}

export interface PermissionCategory {
  category: string;
  permissions: readonly PermissionItem[];
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
