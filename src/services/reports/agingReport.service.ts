import { orm } from '../../db/drizzle.js';
import { ValidationError } from '../../errors/customErrors.js';
import { fin } from '../../lib/financialDecimal.js';
import {
  AGING_BUCKETS, agingBucketPercents,
  type AgingAmounts, type AgingBuckets, type AgingLastSettlement, type AgingParty, type AgingReport, type AgingReportParams,
  type AgingRow, type AgingTotals,
} from '../../lib/reports/agingReport.js';
import { AccountMappingService } from '../accounting/accountMapping.service.js';
import { agingPageSql, agingTotalsSql, lastSettlementSql, type AgingScope } from './agingReportQuery.js';

/**
 * v10.1.9 (D-03، طرح گزارش‌های مدیریتی §۳، تصمیم‌های ت۷ تا ت۱۱): «سن مطالبات و بدهی‌ها». مانده‌ها، بازه‌های سن، جمع‌ها و
 * صفحه‌بندی در پایگاه‌داده است (§۶.۱)؛ قاعده شمردن در `agingReportQuery.ts`. گزارش فقط می‌خواند و چیزی نمی‌نویسد.
 */

type Row = Record<string, unknown>;

const str = (value: unknown): string => fin(String(value ?? '0')).round(4).toString();

/** نام ستون‌های SQL بازه‌ها، به ترتیب `AGING_BUCKETS` */
const BUCKET_COLUMNS = ['up_to_30', 'up_to_60', 'up_to_90', 'up_to_180', 'over_180'] as const;

function bucketsOf(r: Row): AgingBuckets {
  const out = {} as AgingBuckets;
  AGING_BUCKETS.forEach((b, i) => { out[b.key] = str(r[BUCKET_COLUMNS[i]]); });
  return out;
}

function amountsOf(r: Row, scope: AgingScope): AgingAmounts {
  return {
    balance: str(r.balance),
    buckets: bucketsOf(r),
    advance: str(r.advance),
    draft: scope.approvedOnly ? null : str(r.draft),
    pendingCheques: scope.chequesApply ? str(r.pending) : null,
    bouncedCheques: scope.chequesApply && scope.kind === 'receivable' ? str(r.bounced) : null,
  };
}

const text = (value: unknown): string | null => {
  const s = value === null || value === undefined ? '' : String(value).trim();
  return s === '' ? null : s;
};

function partyOf(r: Row): AgingParty {
  const id = r.party_id === null || r.party_id === undefined ? null : Number(r.party_id);
  const partyName = text(r.party_name);
  const detailName = text(r.detail_name);
  if (id && partyName) return { id, name: partyName, kind: 'party', deleted: Number(r.party_deleted ?? 0) === 1 };
  // شناسه‌ای که در جدول طرف حساب‌ها نیست با نام تفصیلی ردیف خودش نشان داده می‌شود
  if (detailName) return { id: null, name: detailName, kind: 'name', deleted: false };
  return { id: null, name: '', kind: 'none', deleted: false };
}

async function reportAccount(kind: AgingReportParams['kind']) {
  const account = kind === 'receivable'
    ? await AccountMappingService.getTradeReceivablesAccount()
    : await AccountMappingService.getTradePayablesAccount();
  if (!account) {
    const concept = kind === 'receivable' ? 'حساب‌های دریافتنی تجاری' : 'حساب‌های پرداختنی تجاری';
    throw new ValidationError(`حساب «${concept}» در نگاشت حساب‌ها پیدا نشد؛ نخست آن را در تنظیمات حسابداری تعیین کنید.`, undefined, 'AGING_ACCOUNT_MISSING');
  }
  return account;
}

async function lastSettlements(scope: AgingScope, rows: Row[]): Promise<Map<number, AgingLastSettlement>> {
  const ids = Array.from(new Set(rows
    .map(r => (r.party_id === null || r.party_id === undefined ? 0 : Number(r.party_id)))
    .filter(id => id > 0)));
  const out = new Map<number, AgingLastSettlement>();
  if (ids.length === 0) return out;
  const res = await orm.execute(lastSettlementSql(scope, ids));
  for (const r of res.rows as Row[]) {
    out.set(Number(r.party_id), { date: String(r.day), amount: str(r.amount), byCheque: Number(r.src) === 1 });
  }
  return out;
}

export async function agingReport(params: AgingReportParams): Promise<AgingReport> {
  const account = await reportAccount(params.kind);
  const scope: AgingScope = {
    kind: params.kind,
    accountId: account.id,
    asOf: params.asOf,
    currency: params.currency,
    approvedOnly: params.approvedOnly,
    partyId: params.partyId ?? null,
    // چک فقط ریالی است (TD-275): در نمای یک ارز خارجی ستون چک معنا ندارد
    chequesApply: params.currency === 'all' || params.currency === 'IRR',
  };
  const offset = (params.page - 1) * params.limit;

  const pageRes = await orm.execute(agingPageSql(scope, params.sort, params.limit, offset));
  const pageRows = pageRes.rows as Row[];
  let total = Number(pageRows[0]?.total_rows ?? 0);
  if (pageRows.length === 0 && offset > 0) {
    const countRes = await orm.execute(agingPageSql(scope, params.sort, 1, 0));
    total = Number((countRes.rows as Row[])[0]?.total_rows ?? 0);
  }

  const settlements = await lastSettlements(scope, pageRows);
  const rows: AgingRow[] = pageRows.map(r => {
    const party = partyOf(r);
    return {
      ...amountsOf(r, scope),
      key: String(r.g_key ?? ''),
      party,
      lastSettlement: party.kind === 'party' && party.id ? (settlements.get(party.id) ?? null) : null,
    };
  });

  const totalsRow = ((await orm.execute(agingTotalsSql(scope))).rows as Row[])[0] ?? {};
  const totals: AgingTotals = { ...amountsOf(totalsRow, scope), partyCount: Number(totalsRow.party_count ?? 0) };

  return {
    kind: params.kind,
    asOf: params.asOf,
    currency: params.currency,
    approvedOnly: params.approvedOnly,
    sort: params.sort,
    rows,
    total,
    page: params.page,
    limit: params.limit,
    totals,
    bucketPercents: agingBucketPercents(totals.buckets),
    account: { code: account.code, name: account.name },
    chequesApply: scope.chequesApply,
  };
}
