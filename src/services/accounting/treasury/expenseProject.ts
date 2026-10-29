import { and, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../../db/drizzle.js';
import { accounts, productionProjects } from '../../../db/schema.js';
import { ValidationError } from '../../../errors/customErrors.js';

/**
 * v11 (the 1405 replay, tool 5, owner's decision 7 Aban 1405): an expense may name the production project it was spent
 * on (a treasury expense payment, a line of a petty cash statement or of a colleague's out-of-pocket expense). The expense
 * voucher line then carries the project as its detail, so the project summary report counts it with the project's other
 * costs. Any project that is not deleted may be named (a past expense of a project finished since included).
 */
/** The account types an expense line (and so a project) may sit on: expense and cost of sales. */
export const EXPENSE_ACCOUNT_TYPES = ['expense', 'cost_of_sales'] as const;

/**
 * Whether a counter account takes a project: only an expense or cost-of-sales account. A project on a liability, asset,
 * revenue or equity line would count as the project's cost and take the line off its party's statement.
 */
export async function isExpenseAccount(tx: DbExecutor, accountId: number): Promise<boolean> {
  const [row] = await tx.select({ accountType: accounts.accountType }).from(accounts).where(eq(accounts.id, accountId));
  return !!row && (EXPENSE_ACCOUNT_TYPES as readonly string[]).includes(String(row.accountType));
}

export interface ExpenseProject {
  id: number;
  code: string;
  title: string;
}

/** The named projects, read on the transaction (shared lock, so a project is not deleted under the expense); refuses a missing or deleted one. */
export async function resolveExpenseProjects(tx: DbExecutor, projectIds: ReadonlyArray<number | null | undefined>): Promise<Map<number, ExpenseProject>> {
  const ids = [...new Set(projectIds.filter((id): id is number => typeof id === 'number' && id > 0))].sort((a, b) => a - b);
  const result = new Map<number, ExpenseProject>();
  if (ids.length === 0) return result;
  const rows = await tx.select({ id: productionProjects.id, code: productionProjects.projectCode, title: productionProjects.title })
    .from(productionProjects)
    .where(and(inArray(productionProjects.id, ids), eq(productionProjects.isDeleted, 0)))
    .orderBy(productionProjects.id)
    .for('share');
  for (const r of rows) result.set(r.id, { id: r.id, code: r.code, title: r.title });
  const missing = ids.filter(id => !result.has(id));
  if (missing.length > 0) throw new ValidationError('پروژهٔ انتخاب‌شده یافت نشد یا حذف شده است.', { projectIds: missing }, 'EXPENSE_PROJECT_INVALID');
  return result;
}

/** The detail of an expense voucher line: the project when one is named, else none. */
export function expenseLineDetail(project: ExpenseProject | undefined) {
  return project
    ? { detailedType: 'project', detailedId: project.id, detailedName: projectTitleOf(project) }
    : { detailedType: 'none' };
}

/** A project as an expense line shows it: code and title. */
export function projectTitleOf(project: Pick<ExpenseProject, 'code' | 'title'> | undefined): string {
  return project ? `${project.code} - ${project.title}` : '';
}
