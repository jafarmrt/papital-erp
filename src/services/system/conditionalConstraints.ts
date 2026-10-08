import { sql } from 'drizzle-orm';
import { orm, extendStatementTimeout, type DbTransaction } from '../../db/drizzle.js';
import { ADVISORY_LOCK_KEYS } from '../../lib/advisoryLock.js';
import { logActivity } from '../../lib/auditLogger.js';
import { ConflictError } from '../../errors/customErrors.js';
import { errorMessageOf } from '../../utils.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import type { HealthCheckTestResult } from '../../types.js';
import {
  CONDITIONAL_CONSTRAINTS_BUSY_MESSAGE, conditionalConstraintCause,
  type ConditionalConstraintBuildResult, type ConditionalConstraintEntry, type ConditionalConstraintKind,
} from '../../lib/system/conditionalConstraints.js';

export { conditionalConstraintsResultMessage } from '../../lib/system/conditionalConstraints.js';

/**
 * v9.0.427 (TD-589، B01-09، تصمیم ت۵ الف): قیدها و ایندکس‌های یکتای شرطی مهاجرت‌ها. مهاجرت 0001، 0012 و 0015 هر کدام را فقط
 * روی داده پاک می‌سازند و روی داده ناپاک فقط هشدار «SKIPPED» می‌دهند؛ مهاجرت اجراشده دیگر تکرار نمی‌شود، پس پایگاه‌داده
 * دوره قدیم بی آن‌ها کار می‌کرد و کسی خبر نداشت. این بخش آن‌هایی را که در اسکیمای جاری نیستند با علتشان (ردیف یتیم یا گروه
 * تکراری) فهرست می‌کند و اقدام دستی مدیر سامانه، پس از پاک شدن داده، آن‌ها را با همان تعریف مهاجرت می‌سازد. داده هرگز
 * خودکار اصلاح نمی‌شود (قاعده TD-231). قیدهای شرطی دیگر بررسی سلامت خود را دارند (TD-195، TD-246، TD-420، ...).
 */
export const CONDITIONAL_CONSTRAINTS_AUDIT_ENTITY = 'سیستم:قیدهای_پایگاه‌داده';

export interface ConditionalConstraintRule {
  name: string;
  kind: ConditionalConstraintKind;
  table: string;
  migration: string;
  label: string;
  /** شمار آنچه ساختن را ناممکن می‌کند (عبارت ثابت، بی ورودی کاربر) */
  blockerCount: string;
  /** واحد شمار بالا، مثلاً «ردیف یتیم» */
  blockerUnit: string;
  /** تعریف همان مهاجرت */
  create: string;
  /** پس از ساختن، مثل مهاجرت (ایندکس جایگزین‌شده) */
  afterCreate?: (schema: string) => ReturnType<typeof sql>;
}

const orphanCount = (child: string, column: string, parent: string) =>
  `SELECT COUNT(*)::int AS n FROM ${child} c WHERE c.${column} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${parent} p WHERE p.id = c.${column})`;

export const CONDITIONAL_CONSTRAINT_RULES: readonly ConditionalConstraintRule[] = [
  {
    name: 'fk_transactions_item_id', kind: 'foreign_key', table: 'transactions', migration: '0001',
    label: 'پیوند ردیف کاردکس به کالا', blockerUnit: 'ردیف کاردکس با کالای ناموجود',
    blockerCount: orphanCount('transactions', 'item_id', 'items'),
    create: 'ALTER TABLE transactions ADD CONSTRAINT fk_transactions_item_id FOREIGN KEY (item_id) REFERENCES items(id)',
  },
  {
    name: 'fk_document_items_item_id', kind: 'foreign_key', table: 'document_items', migration: '0001',
    label: 'پیوند ردیف سند انبار و فروش به کالا', blockerUnit: 'ردیف سند با کالای ناموجود',
    blockerCount: orphanCount('document_items', 'item_id', 'items'),
    create: 'ALTER TABLE document_items ADD CONSTRAINT fk_document_items_item_id FOREIGN KEY (item_id) REFERENCES items(id)',
  },
  {
    name: 'fk_document_items_document_id', kind: 'foreign_key', table: 'document_items', migration: '0001',
    label: 'پیوند ردیف سند انبار و فروش به سند', blockerUnit: 'ردیف سند با سند ناموجود',
    blockerCount: orphanCount('document_items', 'document_id', 'documents'),
    create: 'ALTER TABLE document_items ADD CONSTRAINT fk_document_items_document_id FOREIGN KEY (document_id) REFERENCES documents(id)',
  },
  {
    name: 'fk_journal_voucher_items_voucher_id', kind: 'foreign_key', table: 'journal_voucher_items', migration: '0001',
    label: 'پیوند ردیف سند حسابداری به سند', blockerUnit: 'ردیف سند حسابداری با سند ناموجود',
    blockerCount: orphanCount('journal_voucher_items', 'voucher_id', 'journal_vouchers'),
    create: 'ALTER TABLE journal_voucher_items ADD CONSTRAINT fk_journal_voucher_items_voucher_id FOREIGN KEY (voucher_id) REFERENCES journal_vouchers(id)',
  },
  {
    name: 'fk_journal_voucher_items_account_id', kind: 'foreign_key', table: 'journal_voucher_items', migration: '0001',
    label: 'پیوند ردیف سند حسابداری به حساب', blockerUnit: 'ردیف سند حسابداری با حساب ناموجود',
    blockerCount: orphanCount('journal_voucher_items', 'account_id', 'accounts'),
    create: 'ALTER TABLE journal_voucher_items ADD CONSTRAINT fk_journal_voucher_items_account_id FOREIGN KEY (account_id) REFERENCES accounts(id)',
  },
  {
    name: 'uq_cheques_sayad_number_active', kind: 'unique_index', table: 'cheques', migration: '0012',
    label: 'یکتایی شناسه صیاد چک‌های فعال', blockerUnit: 'شناسه صیاد مشترک میان چک‌های فعال',
    blockerCount: `SELECT COUNT(*)::int AS n FROM (SELECT sayad_number FROM cheques
      WHERE is_deleted = 0 AND sayad_number IS NOT NULL AND sayad_number <> '' GROUP BY sayad_number HAVING COUNT(*) > 1) d`,
    create: "CREATE UNIQUE INDEX uq_cheques_sayad_number_active ON cheques (sayad_number) WHERE is_deleted = 0 AND sayad_number IS NOT NULL AND sayad_number <> ''",
  },
  {
    name: 'uq_accounts_code_active', kind: 'unique_index', table: 'accounts', migration: '0012',
    label: 'یکتایی کد حساب‌های فعال', blockerUnit: 'کد مشترک میان حساب‌های فعال',
    blockerCount: `SELECT COUNT(*)::int AS n FROM (SELECT code FROM accounts
      WHERE is_deleted = 0 AND code IS NOT NULL GROUP BY code HAVING COUNT(*) > 1) d`,
    create: 'CREATE UNIQUE INDEX uq_accounts_code_active ON accounts (code) WHERE is_deleted = 0',
  },
  {
    name: 'uq_documents_type_fy_ref_active', kind: 'unique_index', table: 'documents', migration: '0015',
    label: 'یکتایی شماره سند در هر نوع و سال مالی', blockerUnit: 'شماره مشترک میان اسناد فعال یک نوع و یک سال',
    blockerCount: `SELECT COUNT(*)::int AS n FROM (SELECT type, ref_fiscal_year, ref_number FROM documents
      WHERE is_deleted = 0 AND length(ref_number) > 0 AND type IS NOT NULL AND ref_fiscal_year IS NOT NULL
      GROUP BY type, ref_fiscal_year, ref_number HAVING COUNT(*) > 1) d`,
    create: 'CREATE UNIQUE INDEX uq_documents_type_fy_ref_active ON documents (type, ref_fiscal_year, ref_number) WHERE is_deleted = 0 AND length(ref_number) > 0',
    // مثل 0015: ایندکس قدیمی بی سال مالی فقط وقتی برداشته می‌شود که ایندکس تازه ساخته شده باشد
    afterCreate: (schema) => sql`DROP INDEX IF EXISTS ${sql.identifier(schema)}.uq_documents_type_ref_number_active`,
  },
];

type Executor = Pick<DbTransaction, 'execute'> | typeof orm;

const firstNumber = (rows: unknown[], key: string) => Number((rows[0] as Record<string, unknown> | undefined)?.[key] ?? 0);

async function isPresent(db: Executor, rule: ConditionalConstraintRule): Promise<boolean> {
  const res = rule.kind === 'foreign_key'
    ? await db.execute(sql`SELECT COUNT(*)::int AS n FROM pg_constraint WHERE conname = ${rule.name} AND connamespace = current_schema()::regnamespace`)
    : await db.execute(sql`SELECT COUNT(*)::int AS n FROM pg_indexes WHERE indexname = ${rule.name} AND schemaname = current_schema()`);
  return firstNumber(res.rows, 'n') > 0;
}

async function entryFor(db: Executor, rule: ConditionalConstraintRule): Promise<ConditionalConstraintEntry> {
  const blockers = firstNumber((await db.execute(sql.raw(rule.blockerCount))).rows, 'n');
  return {
    name: rule.name, kind: rule.kind, table: rule.table, migration: rule.migration, label: rule.label,
    state: blockers > 0 ? 'blocked' : 'ready', blockers, blockerUnit: rule.blockerUnit,
  };
}

/** قیدهای شرطی که در اسکیمای جاری نیستند، هر کدام با شمار آنچه ساختنش را ناممکن می‌کند */
export async function findMissingConditionalConstraints(db: Executor = orm): Promise<ConditionalConstraintEntry[]> {
  const entries: ConditionalConstraintEntry[] = [];
  for (const rule of CONDITIONAL_CONSTRAINT_RULES) {
    if (!(await isPresent(db, rule))) entries.push(await entryFor(db, rule));
  }
  return entries;
}

export function buildConditionalConstraintsHealthTest(entries: ConditionalConstraintEntry[]): HealthCheckTestResult {
  const blocked = entries.filter(e => e.state === 'blocked').length;
  return {
    id: 'conditional_constraints_missing',
    category: 'system',
    title: 'قیدها و ایندکس‌های یکتای جاافتاده مهاجرت‌ها',
    description: 'مهاجرت‌ها پیوند ردیف کاردکس و ردیف سند به کالا و سند و حساب، و یکتایی شناسه صیاد، کد حساب و شماره سند را فقط روی داده پاک می‌سازند. قیدی که به سبب داده ناپاک ساخته نشده اینجا با علتش می‌آید؛ داده خودکار عوض نمی‌شود',
    status: entries.length > 0 ? 'warning' : 'healthy',
    scoreImpact: 0,
    count: entries.length,
    message: entries.length === 0
      ? 'همه قیدها و ایندکس‌های یکتای شرطی مهاجرت‌ها برقرارند.'
      : `${toPersianDigits(entries.length, 0)} قید یا ایندکس یکتای مهاجرت‌ها در پایگاه‌داده نیست${blocked > 0 ? `؛ ساختن ${toPersianDigits(blocked, 0)} مورد پیش از اصلاح داده ممکن نیست` : ''}. مدیر سامانه آن‌ها را از «عملیات سامانه» می‌سازد.`,
    items: entries.map((e, index) => ({
      id: index + 1,
      code: e.name,
      title: e.label,
      subtitle: e.state === 'blocked' ? `${toPersianDigits(e.blockers, 0)} ${e.blockerUnit}` : 'آماده ساختن',
      details: `${conditionalConstraintCause(e)} (مهاجرت ${toPersianDigits(e.migration, 0)}، TD-589)`,
    })),
    metrics: { conditionalConstraintsMissing: entries.length, conditionalConstraintsBlocked: blocked },
  };
}

export interface ConditionalConstraintActor {
  userId?: number;
  username?: string;
  fullName?: string;
  ipAddress?: string;
}

/**
 * پیش‌نمایش (پیش‌فرض) یا ساختن قیدهای جاافتاده‌ای که داده‌شان پاک است، در یک تراکنش زیر قفل مشورتی
 * `CONDITIONAL_CONSTRAINTS`. هر قید در نقطه بازگشت خودش ساخته می‌شود و شکست یکی دیگری را برنمی‌گرداند؛ اجرا یک ردیف
 * ممیزی با `tx` دارد. داده هرگز تغییر نمی‌کند.
 */
export async function buildConditionalConstraints(apply: boolean, actor: ConditionalConstraintActor = {}): Promise<ConditionalConstraintBuildResult> {
  return orm.transaction(async (tx) => {
    const locked = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(${ADVISORY_LOCK_KEYS.CONDITIONAL_CONSTRAINTS}) AS ok`);
    if (!(locked.rows[0] as { ok?: boolean } | undefined)?.ok) {
      throw new ConflictError(CONDITIONAL_CONSTRAINTS_BUSY_MESSAGE, undefined, 'CONDITIONAL_CONSTRAINTS_BUSY');
    }
    if (apply) await extendStatementTimeout(tx);
    const schema = String((await tx.execute(sql`SELECT current_schema() AS s`)).rows[0]?.s ?? 'public');
    const missing = await findMissingConditionalConstraints(tx);
    const result: ConditionalConstraintBuildResult = { applied: apply, missing, built: [], blocked: [], failed: [] };
    for (const entry of missing) {
      if (entry.state === 'blocked') { result.blocked.push(entry.name); continue; }
      if (!apply) { result.built.push(entry.name); continue; }
      const rule = CONDITIONAL_CONSTRAINT_RULES.find(r => r.name === entry.name)!;
      try {
        await tx.transaction(async (sp) => {
          await sp.execute(sql.raw(rule.create));
          if (rule.afterCreate) await sp.execute(rule.afterCreate(schema));
        });
        result.built.push(entry.name);
      } catch (err) {
        result.failed.push({ name: entry.name, error: errorMessageOf(err) });
      }
    }
    if (apply && (result.built.length > 0 || result.failed.length > 0)) {
      await logActivity({
        tx,
        userId: actor.userId,
        username: actor.username || 'سیستم',
        userFullName: actor.fullName || '',
        action: 'CREATE',
        entity: CONDITIONAL_CONSTRAINTS_AUDIT_ENTITY,
        entityId: 'conditional_constraints',
        description: `ساختن ${toPersianDigits(result.built.length, 0)} قید یا ایندکس یکتای جاافتاده مهاجرت‌ها`
          + (result.blocked.length > 0 ? `؛ ${toPersianDigits(result.blocked.length, 0)} مورد به سبب داده ناپاک ساخته نشد` : '')
          + (result.failed.length > 0 ? `؛ ساختن ${toPersianDigits(result.failed.length, 0)} مورد شکست خورد` : ''),
        details: { built: result.built, blocked: result.blocked, failed: result.failed, missingBefore: missing.map(m => ({ name: m.name, blockers: m.blockers })) },
        ipAddress: actor.ipAddress || '',
      });
    }
    return result;
  });
}
