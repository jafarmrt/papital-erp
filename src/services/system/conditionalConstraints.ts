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
  /**
   * v9.0.431 (TD-611، B01-31، تصمیم ت۶ الف): کلید خارجی‌ای که مهاجرتش آن را NOT VALID می‌افزاید (برای ردیف تازه برقرار) و فقط
   * روی داده پاک تأیید می‌کند. تا تأیید نشده جاافتاده شمرده می‌شود؛ «ساختن» آن را اگر نباشد با `create` (NOT VALID) می‌افزاید و
   * سپس با VALIDATE CONSTRAINT تأیید می‌کند.
   */
  addedNotValid?: boolean;
}

const orphanCount = (child: string, column: string, parent: string) =>
  `SELECT COUNT(*)::int AS n FROM ${child} c WHERE c.${column} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${parent} p WHERE p.id = c.${column})`;

/** کلید خارجی‌ای که مهاجرتش آن را NOT VALID می‌افزاید و فقط روی داده پاک تأیید می‌کند */
const notValidForeignKey = (rule: {
  name: string; table: string; column: string; parent: string; onDelete: 'NO ACTION' | 'CASCADE' | 'SET NULL';
  migration: string; label: string; blockerUnit: string;
}): ConditionalConstraintRule => ({
  name: rule.name, kind: 'foreign_key', table: rule.table, migration: rule.migration, label: rule.label,
  blockerUnit: rule.blockerUnit, blockerCount: orphanCount(rule.table, rule.column, rule.parent), addedNotValid: true,
  create: `ALTER TABLE ${rule.table} ADD CONSTRAINT ${rule.name} FOREIGN KEY (${rule.column}) REFERENCES ${rule.parent}(id) ON DELETE ${rule.onDelete} NOT VALID`,
});

/** v9.0.432 (TD-902، مهاجرت 0090): ستون‌های کاربر، هر کدام با عنوانی که در فهرست قیدهای جاافتاده می‌آید */
const USER_FOREIGN_KEYS: ReadonlyArray<readonly [table: string, column: string, label: string]> = [
  ['cheques', 'created_by_id', 'پیوند ثبت‌کننده چک به کاربر'],
  ['daily_work_logs', 'user_id', 'پیوند گزارش کار روزانه به کاربر'],
  ['dead_letter_events', 'resolved_by', 'پیوند رسیدگی‌کننده صف خطا به کاربر'],
  ['event_action_rules', 'created_by', 'پیوند سازنده قانون خودکار به کاربر'],
  ['form_drafts', 'user_id', 'پیوند پیش‌نویس فرم به کاربر'],
  ['journal_vouchers', 'approved_by_id', 'پیوند تأییدکننده سند حسابداری به کاربر'],
  ['journal_vouchers', 'created_by_id', 'پیوند ثبت‌کننده سند حسابداری به کاربر'],
  ['notifications', 'sender_id', 'پیوند فرستنده اعلان به کاربر'],
  ['notifications', 'user_id', 'پیوند گیرنده اعلان به کاربر'],
  ['personnel', 'user_id', 'پیوند پرسنل به کاربر سامانه'],
  ['piecework_logs', 'created_by_id', 'پیوند ثبت‌کننده کارکرد به کاربر'],
  ['piecework_payrolls', 'created_by_id', 'پیوند صادرکننده فیش حقوقی به کاربر'],
  ['piecework_task_rate_history', 'changed_by_user_id', 'پیوند تغییردهنده نرخ کارمزد به کاربر'],
  ['project_bom_allocations', 'user_id', 'پیوند تخصیص‌دهنده مواد پروژه به کاربر'],
  ['treasury_transactions', 'created_by_id', 'پیوند ثبت‌کننده تراکنش خزانه به کاربر'],
  ['webhook_subscriptions', 'created_by', 'پیوند سازنده اشتراک وب‌هوک به کاربر'],
];

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
  // v9.0.431 (TD-611): webhook deliveries and rule action logs, with the ON DELETE the Drizzle schema declares
  notValidForeignKey({
    name: 'fk_webhook_deliveries_subscription', table: 'webhook_deliveries', column: 'subscription_id',
    parent: 'webhook_subscriptions', onDelete: 'CASCADE', migration: '0089',
    label: 'پیوند ردیف تحویل وب‌هوک به اشتراک', blockerUnit: 'ردیف تحویل با اشتراک ناموجود',
  }),
  notValidForeignKey({
    name: 'fk_event_action_logs_rule', table: 'event_action_logs', column: 'rule_id',
    parent: 'event_action_rules', onDelete: 'SET NULL', migration: '0089',
    label: 'پیوند گزارش اجرای قانون خودکار به قانون', blockerUnit: 'گزارش اجرا با قانون ناموجود',
  }),
  // v9.0.432 (TD-902): user columns (users are only soft-deleted); the workflow engine's user columns stay without a key
  ...USER_FOREIGN_KEYS.map(([table, column, label]) => notValidForeignKey({
    name: `fk_${table}_${column}`, table, column, parent: 'users', onDelete: table === 'form_drafts' ? 'CASCADE' : 'NO ACTION',
    migration: '0090', label, blockerUnit: 'ردیف با کاربر ناموجود',
  })),
];

type Executor = Pick<DbTransaction, 'execute'> | typeof orm;

const firstNumber = (rows: unknown[], key: string) => Number((rows[0] as Record<string, unknown> | undefined)?.[key] ?? 0);

type Presence = 'present' | 'unvalidated' | 'missing';

async function presenceOf(db: Executor, rule: ConditionalConstraintRule): Promise<Presence> {
  if (rule.kind === 'foreign_key') {
    const res = await db.execute(sql`SELECT convalidated FROM pg_constraint WHERE conname = ${rule.name} AND connamespace = current_schema()::regnamespace`);
    const row = res.rows[0] as { convalidated?: boolean } | undefined;
    if (!row) return 'missing';
    return row.convalidated === false ? 'unvalidated' : 'present';
  }
  const res = await db.execute(sql`SELECT COUNT(*)::int AS n FROM pg_indexes WHERE indexname = ${rule.name} AND schemaname = current_schema()`);
  return firstNumber(res.rows, 'n') > 0 ? 'present' : 'missing';
}

async function entryFor(db: Executor, rule: ConditionalConstraintRule, presence: Presence): Promise<ConditionalConstraintEntry> {
  const blockers = firstNumber((await db.execute(sql.raw(rule.blockerCount))).rows, 'n');
  return {
    name: rule.name, kind: rule.kind, table: rule.table, migration: rule.migration, label: rule.label,
    state: blockers > 0 ? 'blocked' : 'ready', blockers, blockerUnit: rule.blockerUnit,
    ...(presence === 'unvalidated' ? { unvalidated: true } : {}),
  };
}

/**
 * قیدهای شرطی که در اسکیمای جاری نیستند، یا (کلید خارجی NOT VALID، v9.0.431) هنوز تأیید نشده‌اند، هر کدام با شمار آنچه
 * ساختن یا تأییدش را ناممکن می‌کند
 */
export async function findMissingConditionalConstraints(db: Executor = orm): Promise<ConditionalConstraintEntry[]> {
  const entries: ConditionalConstraintEntry[] = [];
  for (const rule of CONDITIONAL_CONSTRAINT_RULES) {
    const presence = await presenceOf(db, rule);
    if (presence !== 'present') entries.push(await entryFor(db, rule, presence));
  }
  return entries;
}

export function buildConditionalConstraintsHealthTest(entries: ConditionalConstraintEntry[]): HealthCheckTestResult {
  const blocked = entries.filter(e => e.state === 'blocked').length;
  return {
    id: 'conditional_constraints_missing',
    category: 'system',
    title: 'قیدها و ایندکس‌های یکتای جاافتاده مهاجرت‌ها',
    description: 'مهاجرت‌ها برخی قیدها (پیوند ردیف‌ها به جدول مرجعشان، و یکتایی شناسه صیاد، کد حساب و شماره سند) را فقط روی داده پاک می‌سازند یا تأیید می‌کنند. قیدی که به سبب داده ناپاک ساخته یا تأیید نشده اینجا با علتش می‌آید؛ داده خودکار عوض نمی‌شود',
    status: entries.length > 0 ? 'warning' : 'healthy',
    scoreImpact: 0,
    count: entries.length,
    message: entries.length === 0
      ? 'همه قیدها و ایندکس‌های یکتای شرطی مهاجرت‌ها برقرارند.'
      : `${toPersianDigits(entries.length, 0)} قید یا ایندکس یکتای مهاجرت‌ها در پایگاه‌داده نیست یا تأیید نشده${blocked > 0 ? `؛ ساختن یا تأیید ${toPersianDigits(blocked, 0)} مورد پیش از اصلاح داده ممکن نیست` : ''}. مدیر سامانه آن‌ها را از «عملیات سامانه» می‌سازد.`,
    items: entries.map((e, index) => ({
      id: index + 1,
      code: e.name,
      title: e.label,
      subtitle: e.state === 'blocked' ? `${toPersianDigits(e.blockers, 0)} ${e.blockerUnit}` : 'آماده ساختن',
      details: `${conditionalConstraintCause(e)} (مهاجرت ${toPersianDigits(e.migration, 0)})`,
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
          if (!entry.unvalidated) await sp.execute(sql.raw(rule.create));
          if (rule.addedNotValid) await sp.execute(sql.raw(`ALTER TABLE ${rule.table} VALIDATE CONSTRAINT ${rule.name}`));
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
