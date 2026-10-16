/**
 * v10.1.36 (N-01, TD-1283, mobile workshop plan): the keys of the workshop cartable, read by its routes, the long
 * session and the screens.
 * - `workshop.self`: a worker's own cartable (tasks, deliveries, receipt confirmation, end-of-task report).
 * - `workshop.review`: a project manager reviews the end-of-task reports of the projects they manage.
 * - `workshop.long_session`: the login stays for seven days instead of 24 hours (decision ت۱۱ الف).
 */
export const WORKSHOP_SELF_PERMISSION = 'workshop.self';
export const WORKSHOP_REVIEW_PERMISSION = 'workshop.review';
export const WORKSHOP_LONG_SESSION_PERMISSION = 'workshop.long_session';
