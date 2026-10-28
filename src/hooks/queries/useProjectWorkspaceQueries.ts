import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { PICK_LIST_URLS } from '../../lib/permissions/pickLists';
import { cappedPickListUrl, takePickList } from '../../lib/permissions/pickListCap';
import type { Item, PieceworkLog, ProductionProject } from '../../types';
import type { ProjectStepCounts } from '../../lib/projects/projectSteps';
import type { ProductProgressResponse } from '../../lib/projects/progressTicks';
import { READ_ON_EVERY_OPENING, useOpenedAt, useOpeningRead } from './readOnEveryOpening';

/** the counts of a project's step bar; under the project's key, so every project save that invalidates it refreshes them */
export const projectStepsKey = (projectId: number) => [...QUERY_KEYS.projects.detail(projectId), 'steps'] as const;

export function useProjectStepCounts(projectId: number | null) {
  return useQuery<ProjectStepCounts>({
    queryKey: projectStepsKey(projectId ?? 0),
    queryFn: ({ signal }) => fetchJson<ProjectStepCounts>(`/projects/${projectId}/steps`, { signal }),
    enabled: projectId !== null,
    staleTime: 30 * 1000,
  });
}

/**
 * the item pick list the materials and delivery tabs read (TD-888); under the items key, so a stock change refreshes it.
 * v11 phase 6.1ch (C13): the whole list, since those tabs match their rows to items by code and name
 */
export function useProjectItemOptions(enabled: boolean) {
  return useQuery<Item[]>({
    queryKey: [...QUERY_KEYS.items.all, 'options', 'project-workspace'] as const,
    queryFn: async ({ signal }) => {
      const res = await fetchJson<unknown>(PICK_LIST_URLS.items, { signal });
      if (Array.isArray(res)) return res as Item[];
      const data = (res as { data?: unknown } | null)?.data;
      return Array.isArray(data) ? (data as Item[]) : [];
    },
    enabled,
    staleTime: 60 * 1000,
  });
}

/**
 * v11 phase 6.1ch (C13): the item pick list of the project form, at most the cap (its picker also searches on the server
 * and keeps a chosen row). The materials and delivery tabs keep the whole list: their rows match items by code and name
 * (`findProjectItemMatch`), which a list cut at the cap cannot answer.
 */
export function useProjectFormItemOptions(enabled: boolean) {
  return useQuery<Item[]>({
    queryKey: [...QUERY_KEYS.items.all, 'options', 'project-form'] as const,
    queryFn: async ({ signal }) => {
      const res = await fetchJson<unknown>(cappedPickListUrl(PICK_LIST_URLS.items), { signal });
      if (Array.isArray(res)) return takePickList(res as Item[]);
      const data = (res as { data?: unknown } | null)?.data;
      return Array.isArray(data) ? takePickList(data as Item[]) : [];
    },
    enabled,
    // 10.3 (part 16): the project form reads it again on each opening
    ...READ_ON_EVERY_OPENING,
  });
}

export interface WorkspaceProject {
  /** the project the tabs build on, null until this visit read it */
  project: ProductionProject | null;
  /** the newest project this visit read, for the header, the step bar and the summary, which hold no edits */
  latest: ProductionProject | null;
  /** this visit's read answered that there is no such project */
  missing: boolean;
  /** the error of this visit's last read, null once a later read succeeds */
  error: unknown;
  /** when the last read of this visit failed, 0 otherwise: the page says once that a refresh failed */
  failedAt: number;
}

/**
 * 10.3 (ARCH review finding 3): the project of the workspace page, through the shared cache under the project's key. Every
 * project save, stock document and workshop change invalidates `projects`, so an open page reads it again. Only what this
 * visit read counts, never a project an earlier visit or the list's edit form left in the cache. A tab starts its edits
 * from the project, so a newer one reaches the tabs only while none of them holds an unsaved change (`settled`); until
 * then they keep the one their edits started from, as before 10.3, and the server refuses a save over a newer version.
 * A project read while a tab held a change is never shown afterwards: it predates that tab's save (the save's own refresh
 * brings the project as saved), so once the tabs settle the project is read again instead. A tab is settled only when
 * nothing is unsaved and no save is under way, so a read that answers before the save does not reset its edits (part 9
 * review). The header shows the newest project at once (`latest`): a status change there starts from the status on screen.
 */
export function useWorkspaceProject(projectId: number | null, settled: boolean): WorkspaceProject {
  const query = useQuery<ProductionProject | null>({
    queryKey: QUERY_KEYS.projects.detail(projectId ?? 0),
    queryFn: async ({ signal }) => {
      const data = await fetchJson<ProductionProject | null>(`/projects/${projectId}`, { signal });
      return data && data.id ? data : null;
    },
    ...READ_ON_EVERY_OPENING,
    enabled: projectId !== null,
  });
  const read = useOpeningRead(query, projectId !== null);
  // when the tabs last had nothing unsaved (the "opening" of a settled spell)
  const settledAt = useOpenedAt(settled);
  const [shown, setShown] = useState<ProductionProject | null>(null);
  // undefined: nothing read in this visit yet; null: there is no such project (any more)
  const answer = read.data;
  let project = shown;
  if (answer !== undefined && answer !== shown && (shown === null || (settled && query.dataUpdatedAt >= settledAt))) {
    project = answer;
    setShown(answer);
  }
  const heldBack = settled && answer !== undefined && answer !== project && query.dataUpdatedAt < settledAt;
  const { refetch } = query;
  useEffect(() => {
    if (heldBack) void refetch({ cancelRefetch: false });
  }, [heldBack, refetch]);
  return { project, latest: answer ?? project, missing: read.data === null, error: read.error, failedAt: read.failedAt };
}

/** a work log row as the workshop tab reads it; older answers named some fields in snake case */
export type ProjectWorkLog = Partial<PieceworkLog> & {
  personnel_name?: string;
  personnel_id?: number;
  task_title?: string;
  unit_rate?: number;
};

/** a project's work logs (`GET /piecework/logs?projectId=`); money, so read again on every opening of the tab */
export function useProjectWorkLogsQuery(projectId: number) {
  return useQuery<ProjectWorkLog[]>({
    queryKey: QUERY_KEYS.piecework.logs({ projectId }),
    queryFn: async ({ signal }) => {
      const res = await fetchJson<unknown>(`/piecework/logs?projectId=${projectId}`, { signal });
      const list = Array.isArray(res) ? res : (res as { data?: unknown } | null)?.data;
      return Array.isArray(list) ? (list as ProjectWorkLog[]) : [];
    },
    ...READ_ON_EVERY_OPENING,
  });
}

/** an answer of the progress matrix read that has no product list */
export const UNREADABLE_PROGRESS = 'ساختار پاسخ پیشرفت نامعتبر است';

/** the progress matrix of a project, under its key so a project save, stock document or tick save refreshes it */
export const productProgressKey = (projectId: number) => [...QUERY_KEYS.projects.detail(projectId), 'product-progress'] as const;

/**
 * 10.3 (ARCH review finding 3): a project's progress matrix (`GET /projects/:id/product-progress`), read by the progress
 * tab, the phone list and the delivery tab's completion check; read again on each opening of any of them
 */
export function useProductProgressQuery(projectId: number) {
  return useQuery<ProductProgressResponse>({
    queryKey: productProgressKey(projectId),
    queryFn: async ({ signal }) => {
      const res = await fetchJson<{ data?: unknown } | null>(`/projects/${projectId}/product-progress`, { signal });
      const payload = (res?.data ?? res) as ProductProgressResponse | null;
      if (!payload || !Array.isArray(payload.products)) throw new Error(UNREADABLE_PROGRESS);
      return payload;
    },
    ...READ_ON_EVERY_OPENING,
  });
}
