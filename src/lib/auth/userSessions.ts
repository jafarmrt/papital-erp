/**
 * 10.2 package 8 (D-07): one signed-in device as the profile and the users page show it (`GET /auth/sessions`,
 * `GET /users/:id/sessions`). Times are UTC ISO strings with a `Z`; the row key of the token is never sent.
 */
export interface UserSessionView {
  id: number;
  deviceLabel: string;
  ipAddress: string;
  signedInAt: string | null;
  lastSeenAt: string | null;
  expiresAt: string | null;
  isCurrent: boolean;
}

/** the answer of `GET /auth/sessions` and `GET /users/:id/sessions` */
export interface UserSessionList {
  sessions: UserSessionView[];
}
