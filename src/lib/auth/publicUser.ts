/**
 * v10.1.44 (OBS-R1-28): the user record a login, `/auth/me` or the profile answers with.
 * Only what the browser reads (`User` / `AuthUserPayload` in `src/types/auth.types.ts`); the password hash,
 * the token version, the failed-login counters and the lock time never leave the server.
 */
export interface StoredUserRow {
  id: number;
  username: string;
  fullName: string | null;
  role: string | null;
  avatarUrl?: string | null;
  mustResetPassword?: number | boolean | null;
}

export interface PublicUserView {
  id: number;
  username: string;
  fullName: string;
  full_name: string;
  role: string;
  avatarUrl: string;
  avatar_url: string;
  mustResetPassword: boolean;
  must_reset_password: boolean;
}

/** fields of a public user view; a regression test keeps the internal columns out of it */
export const PUBLIC_USER_FIELDS: readonly (keyof PublicUserView)[] = [
  'id', 'username', 'fullName', 'full_name', 'role', 'avatarUrl', 'avatar_url', 'mustResetPassword', 'must_reset_password',
];

export function publicUserView(user: StoredUserRow): PublicUserView {
  const fullName = user.fullName || user.username;
  const avatar = user.avatarUrl || '';
  const mustReset = Boolean(user.mustResetPassword);
  return {
    id: user.id,
    username: user.username,
    fullName,
    full_name: fullName,
    role: user.role ?? '',
    avatarUrl: avatar,
    avatar_url: avatar,
    mustResetPassword: mustReset,
    must_reset_password: mustReset,
  };
}
