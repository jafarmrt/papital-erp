/**
 * v10.1.37 (N-01, TD-1283, decision ت۳ الف of the mobile workshop plan): the contract of «مسئولان پروژه», shared by the
 * project routes and the project form.
 */
export const MAX_PROJECT_MANAGERS = 20;

export interface ProjectManagerView {
  userId: number;
  fullName: string;
  username: string;
  /** a manager whose user was later deleted stays listed until the project is saved again */
  isDeleted: boolean;
}

/** The managers' user ids the form sends; a repeated or invalid id is dropped. */
export function managerUserIdsOf(managers: ReadonlyArray<{ userId: number }> | null | undefined): number[] {
  const ids: number[] = [];
  for (const m of Array.isArray(managers) ? managers : []) {
    const id = Number(m?.userId);
    if (Number.isInteger(id) && id > 0 && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
