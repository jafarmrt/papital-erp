/**
 * v10.0.72 (TD-1132): the name a record shows for the signed-in user who wrote it: the user's full name, else the
 * username, else the caller's fallback. `req.user.full_name` always carries the live full name (authenticateToken);
 * `name` is a legacy field no token carries.
 */
export interface ActorNameSource {
  full_name?: string | null;
  fullName?: string | null;
  username?: string | null;
}

export function actorDisplayName(user: ActorNameSource | null | undefined, fallback = 'سیستم'): string {
  const fullName = (user?.full_name ?? user?.fullName ?? '').trim();
  if (fullName) return fullName;
  const username = (user?.username ?? '').trim();
  return username || fallback;
}
