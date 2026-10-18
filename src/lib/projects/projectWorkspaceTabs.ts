/**
 * v10.2.x (10.2 package 2, production projects review U1 / U6): a project is a page with its own address,
 * `/projects/<id>/<tab>`, instead of a window over the project list, so the browser's back button, a link from a
 * notification or the reservation report and a reload open the same tab. Five tabs instead of six: the timeline chart
 * sits beside the stages in the first tab. The old window's tab names are still read, so an earlier link keeps working.
 */
export const PROJECT_WORKSPACE_TABS = ['overview', 'materials', 'progress', 'workshop', 'delivery'] as const;
export type ProjectWorkspaceTab = typeof PROJECT_WORKSPACE_TABS[number];

export const PROJECT_WORKSPACE_TAB_LABELS: Record<ProjectWorkspaceTab, string> = {
  overview: '۱. مشخصات و مراحل',
  materials: '۲. مواد، رزرو و خرید',
  progress: '۳. پیشرفت هر کالا',
  workshop: '۴. تقسیم کار و دستمزد',
  delivery: '۵. ورود به انبار',
};

/** the tab names of the window before 10.2, read from an earlier link */
const LEGACY_TAB_NAMES: Readonly<Record<string, ProjectWorkspaceTab>> = {
  inventory: 'materials',
  product_progress: 'progress',
  schedule: 'workshop',
  gantt: 'overview',
  stock: 'delivery',
};

export function parseProjectWorkspaceTab(value: string | null | undefined): ProjectWorkspaceTab {
  const key = String(value ?? '').trim();
  if ((PROJECT_WORKSPACE_TABS as readonly string[]).includes(key)) return key as ProjectWorkspaceTab;
  return LEGACY_TAB_NAMES[key] ?? 'overview';
}

/** the address of a project's tab; the first tab is the project's own address */
export function projectWorkspacePath(projectId: number | string, tab: ProjectWorkspaceTab = 'overview'): string {
  const base = `/projects/${encodeURIComponent(String(projectId))}`;
  return tab === 'overview' ? base : `${base}/${tab}`;
}

/** a positive whole project id from the address, else null */
export function projectIdFromParam(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
