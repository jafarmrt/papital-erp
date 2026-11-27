import { eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { personnel } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { isRunningAccountKind, RUNNING_ACCOUNT_LABELS, type RunningAccountKind } from '../../lib/accounting/runningAccount.js';
import type { Account } from '../../types.js';
import { AccountMappingService } from './accountMapping.service.js';

/**
 * v12 colleague and partner sales (docs/roadmap/V12_COLLEAGUE_SALES_START_PLAN.md): the account a sales invoice stamped
 * with a running account debits instead of trade receivables (and its return credits): «حساب جاری همکار» (3208) or
 * «حساب جاری شرکا» (4101) from the account mapping, on the colleague's personnel detail. A mapping that does not resolve
 * refuses the voucher (AGENTS.md §3.4), never falls back to 1201.
 */
export interface RunningAccountVoucherSide {
  kind: RunningAccountKind;
  account: Account;
  personnelId: number;
  personnelName: string;
  label: string;
}

export async function runningAccountVoucherSide(
  executor: DbExecutor,
  stamp: { runningAccount: string | null; runningAccountPersonnelId: number | null; refNumber: string | null },
): Promise<RunningAccountVoucherSide | null> {
  const kind = stamp.runningAccount;
  if (!isRunningAccountKind(kind) || !stamp.runningAccountPersonnelId) return null;
  const account = kind === 'colleague'
    ? await AccountMappingService.getColleagueCurrentAccount(executor)
    : await AccountMappingService.getPartnersCurrentAccount(executor);
  const label = RUNNING_ACCOUNT_LABELS[kind];
  if (!account) {
    throw new ValidationError(`سرفصل «${label}» در نگاشت حساب‌ها پیدا نشد؛ سند فاکتور «${stamp.refNumber ?? ''}» صادر نمی‌شود. نگاشت حساب‌ها را در بخش حسابداری بررسی کنید.`, undefined, 'ACCOUNT_MAPPING_UNREADABLE');
  }
  const [person] = await executor.select({ fullName: personnel.fullName }).from(personnel).where(eq(personnel.id, stamp.runningAccountPersonnelId));
  return { kind, account, personnelId: stamp.runningAccountPersonnelId, personnelName: person?.fullName ?? '', label };
}
