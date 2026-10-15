import { orm } from '../../db/drizzle.js';
import { 
  workflowDefinitions, 
  workflowStates, 
  workflowTransitions,
  workflowInstances
} from '../../db/schema.js';
import { eq, and, sql, inArray, type SQL } from 'drizzle-orm';
import type { Request } from 'express';
import { logger } from '../../middleware/logger.js';
import { logActivity } from '../../lib/auditLogger.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { workflowDesignErrors } from '../../lib/workflow/workflowDesignRules.js';
import { RuleEngineService, type RuleExpression } from '../ruleEngine.service.js';
import { ensurePublishedSnapshot, recordDefinitionVersion } from './workflowSnapshot.js';
import { writeDesignTables, type DesignStateInput, type DesignTransitionInput } from './workflowDesignTables.js';
import { DOC_APPROVAL_STEP_GUARDS, DOC_APPROVAL_SUBMIT_GUARD_UPGRADE, upgradeLegacyDocApprovalGuards } from './docApprovalGuards.js';
import { upgradeLegacySeedGuards } from './seedGuardUpgrade.js';
import { JOURNAL_VOUCHER_GUARD_UPGRADE, JOURNAL_VOUCHER_STEP_GUARDS } from './voucherWorkflowGuards.js';
import { PURCHASE_REQUISITION_GUARD_UPGRADE, PURCHASE_REQUISITION_STEP_GUARDS } from './purchaseWorkflowGuards.js';
import { resolveTransitionRoles } from './transitionRoles.js';
import { activeDefinitionsOfType, lockWorkflowEntityTypes, startedInstanceCount } from './workflowDefinitionLifecycle.js';
import { workflowEntityTypeChangeRefusal } from '../../lib/workflow/workflowLifecycle.js';
import { JOURNAL_VOUCHER_WORKFLOW_TEMPLATE, PURCHASE_REQUISITION_WORKFLOW_TEMPLATE } from '../../lib/workflow/workflowTemplates.js';
import type { WorkflowDefinitionDTO } from './contracts/workflowDomainContracts.js';

export type WorkflowDefinitionWithStats = (typeof workflowDefinitions.$inferSelect) & {
  stateCount: number;
  transitionCount: number;
  activeInstancesCount: number;
};

export interface WorkflowDefinitionDetails {
  definition: typeof workflowDefinitions.$inferSelect;
  states: (typeof workflowStates.$inferSelect)[];
  transitions: (typeof workflowTransitions.$inferSelect)[];
  /** v10.1.7 (TD-1229): records of any status started with this definition; the designer locks the record type then */
  startedInstanceCount: number;
}

/** v10.1.7 (TD-1229, OBS-R2-64): what a design save changed, for its audit row */
function designAuditSummary(d: { title: string; entityType: string; description?: string | null; isActive?: number | null }, stepKeys: string[], actionKeys: string[]) {
  return { title: d.title, entityType: d.entityType, description: d.description ?? '', isActive: Number(d.isActive ?? 0), steps: stepKeys, actions: actionKeys };
}

export interface SaveWorkflowDefinitionPayload {
  id?: number;
  code: string;
  title: string;
  entityType: string;
  description?: string;
  version?: number;
  isActive?: number;
  /** کاربر ذخیره‌کننده (ثبت در نسخه) */
  userId?: number;
  /** v10.1.11 (TD-1263, D-06 part B): a new definition made from a template is saved inactive, whatever its record type has */
  startInactive?: boolean;
  /** v10.1.11 (TD-1263): the template a new definition was made from, for its audit row */
  fromTemplate?: string;
  states?: DesignStateInput[];
  transitions?: DesignTransitionInput[];
  [key: string]: unknown;
}

/**
 * v9.0.45 (TD-452، B14-10): طرح ناقص ذخیره نمی‌شود (۴۲۲ با پیام فارسی): کد، عنوان و نوع موجودیت متن‌اند؛ دقیقاً یک
 * گام آغاز، دست‌کم یک گام پایان، کلید یکتا، هر اقدام با مبدأ و مقصد پیداشده و بی خروج از گام پایانی (جز «رد شده»).
 */
function assertSavableWorkflowDesign(payload: SaveWorkflowDefinitionPayload): void {
  const header = [
    typeof payload.code === 'string' && payload.code.trim() ? '' : 'کد گردش کار باید متن باشد.',
    typeof payload.title === 'string' && payload.title.trim() ? '' : 'عنوان گردش کار باید متن باشد.',
    typeof payload.entityType === 'string' && payload.entityType.trim() ? '' : 'نوع موجودیت گردش کار باید متن باشد.',
  ].filter(Boolean);
  // v9.0.48 (TD-456، B14-14): قاعده هر اقدام هنگام ذخیره سنجیده می‌شود (پیش‌تر هرچه می‌رسید ذخیره می‌شد)
  const ruleErrors = (Array.isArray(payload.transitions) ? payload.transitions : []).flatMap((tr) => {
    const check = tr && typeof tr === 'object' ? RuleEngineService.validateExpression(tr.ruleConditionsJson as RuleExpression) : { valid: true };
    return check.valid ? [] : [`شرط اقدام «${String(tr.title || tr.actionKey || '')}» نامعتبر است: ${check.error}.`];
  });
  const errors = [...header, ...workflowDesignErrors(payload.states, payload.transitions), ...ruleErrors];
  if (errors.length > 0) {
    throw new ValidationError(`طرح گردش کار ذخیره نشد: ${errors.join(' ')}`, { errors });
  }
}

export class WorkflowDefinitionService {
  /**
   * List workflow definitions with optional filters
   */
  static async getDefinitions(filter?: { isActive?: boolean; entityType?: string }): Promise<WorkflowDefinitionWithStats[]> {
    // v9.0.46 (TD-453، ت۸): خواندن فهرست دیگر seed اجرا نمی‌کند؛ seed فقط هنگام راه‌اندازی است
    const conditions: SQL[] = [];

    if (filter?.isActive !== undefined) {
      conditions.push(eq(workflowDefinitions.isActive, filter.isActive ? 1 : 0));
    }
    if (filter?.entityType) {
      conditions.push(eq(workflowDefinitions.entityType, filter.entityType));
    }

    const defs = conditions.length > 0
      ? await orm.select().from(workflowDefinitions).where(and(...conditions))
      : await orm.select().from(workflowDefinitions);

    if (defs.length === 0) return [];

    const defIds = defs.map(d => d.id);

    // V4 Phase 5.3 (A-2): بهینه‌سازی ۳×N به ۳ کوئری تجمیعی با groupBy جهت حذف کامل N+1
    const [statesCounts, transCounts, instancesCounts] = await Promise.all([
      orm
        .select({
          workflowDefinitionId: workflowStates.workflowDefinitionId,
          count: sql<number>`count(*)::int`
        })
        .from(workflowStates)
        .where(inArray(workflowStates.workflowDefinitionId, defIds))
        .groupBy(workflowStates.workflowDefinitionId),
      orm
        .select({
          workflowDefinitionId: workflowTransitions.workflowDefinitionId,
          count: sql<number>`count(*)::int`
        })
        .from(workflowTransitions)
        .where(inArray(workflowTransitions.workflowDefinitionId, defIds))
        .groupBy(workflowTransitions.workflowDefinitionId),
      orm
        .select({
          workflowDefinitionId: workflowInstances.workflowDefinitionId,
          count: sql<number>`count(*)::int`
        })
        .from(workflowInstances)
        .where(and(
          inArray(workflowInstances.workflowDefinitionId, defIds),
          eq(workflowInstances.status, 'IN_PROGRESS')
        ))
        .groupBy(workflowInstances.workflowDefinitionId)
    ]);

    const statesMap = new Map<number, number>(
      statesCounts.map(s => [Number(s.workflowDefinitionId), Number(s.count || 0)])
    );
    const transMap = new Map<number, number>(
      transCounts.map(t => [Number(t.workflowDefinitionId), Number(t.count || 0)])
    );
    const instancesMap = new Map<number, number>(
      instancesCounts.map(i => [Number(i.workflowDefinitionId), Number(i.count || 0)])
    );

    return defs.map(def => ({
      ...def,
      stateCount: statesMap.get(def.id) || 0,
      transitionCount: transMap.get(def.id) || 0,
      activeInstancesCount: instancesMap.get(def.id) || 0
    }));
  }

  /**
   * Get workflow definition by numeric ID with states & transitions
   */
  static async getDefinitionById(id: number): Promise<WorkflowDefinitionDetails | null> {
    const [def] = await orm.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, id));
    if (!def) return null;

    const states = await orm.select().from(workflowStates).where(eq(workflowStates.workflowDefinitionId, id));
    const transitions = await orm.select().from(workflowTransitions).where(eq(workflowTransitions.workflowDefinitionId, id));

    return {
      definition: def,
      ...def,
      states,
      transitions,
      startedInstanceCount: await startedInstanceCount(orm, id),
    };
  }

  /**
   * Get workflow definition by string code
   */
  static async getDefinitionByCode(code: string): Promise<WorkflowDefinitionDTO | null> {
    const [def] = await orm.select().from(workflowDefinitions).where(eq(workflowDefinitions.code, code));
    return (def as WorkflowDefinitionDTO) || null;
  }

  /**
   * Save definition with states & transitions DSL structure
   */
  static async saveWorkflowDefinition(payload: SaveWorkflowDefinitionPayload, req?: Request) {
    assertSavableWorkflowDesign(payload);
    // v7.0.87 (TD-112): تعریف، وضعیت‌ها، انتقال‌ها و نسخه تازه در یک تراکنش ذخیره می‌شوند
    const defId = await orm.transaction(async (tx) => {
      // v9.0.128 (TD-542): نقش هر اقدام باید در فهرست نقش‌ها باشد (۴۲۲)؛ کد ثبت‌شده نقش ذخیره می‌شود
      const knownRoles = await resolveTransitionRoles(tx, Array.isArray(payload.transitions) ? payload.transitions : []);
      let finalDefId = payload.id;
      let before: ReturnType<typeof designAuditSummary> | null = null;
      let isActive = 0;
      if (!finalDefId) {
        // v10.1.7 (TD-1229): a new definition is active only when its record type has none (one active per type)
        await lockWorkflowEntityTypes(tx, [payload.entityType]);
        const [duplicate] = await tx.select({ id: workflowDefinitions.id }).from(workflowDefinitions)
          .where(eq(workflowDefinitions.code, payload.code));
        if (duplicate) {
          throw new ConflictError(`کد فرآیند کاری '${payload.code}' قبلاً ثبت شده است`, undefined, 'WF_DEF_CODE_EXISTS');
        }
        isActive = !payload.startInactive && (await activeDefinitionsOfType(tx, payload.entityType)).length === 0 ? 1 : 0;
        const [created] = await tx.insert(workflowDefinitions).values({
          code: payload.code,
          title: payload.title,
          entityType: payload.entityType,
          description: payload.description || '',
          version: 0,
          isActive,
          dslJson: payload
        }).returning();
        finalDefId = created.id;
      } else {
        const [peek] = await tx.select({ entityType: workflowDefinitions.entityType }).from(workflowDefinitions)
          .where(eq(workflowDefinitions.id, finalDefId));
        if (!peek) {
          throw new NotFoundError('تعریف فرآیند کاری یافت نشد', undefined, 'WF_DEF_NOT_FOUND');
        }
        await lockWorkflowEntityTypes(tx, [peek.entityType, payload.entityType]);
        const [existing] = await tx.select().from(workflowDefinitions)
          .where(eq(workflowDefinitions.id, finalDefId)).for('update');
        if (!existing) {
          throw new NotFoundError('تعریف فرآیند کاری یافت نشد', undefined, 'WF_DEF_NOT_FOUND');
        }
        isActive = Number(existing.isActive ?? 0);
        // v10.1.7 (TD-1229, OBS-PR-15): the designer asks the record type; only an inactive, never-used definition takes another
        if (payload.entityType !== existing.entityType) {
          const refusal = workflowEntityTypeChangeRefusal({ isActive, startedCount: await startedInstanceCount(tx, existing.id) });
          if (refusal) throw new ValidationError(refusal, undefined, 'WF_ENTITY_TYPE_LOCKED');
        }
        const [oldStates, oldTransitions] = await Promise.all([
          tx.select({ stateKey: workflowStates.stateKey }).from(workflowStates).where(eq(workflowStates.workflowDefinitionId, existing.id)),
          tx.select({ actionKey: workflowTransitions.actionKey }).from(workflowTransitions).where(eq(workflowTransitions.workflowDefinitionId, existing.id)),
        ]);
        before = designAuditSummary(existing, oldStates.map(r => r.stateKey), oldTransitions.map(r => r.actionKey));
        // v10.1.17 (TD-1270): before the tables become a draft, the published design keeps its own usable snapshot
        await ensurePublishedSnapshot(tx, existing.id, { title: existing.title, userId: payload.userId });
        await tx.update(workflowDefinitions).set({
          title: payload.title,
          entityType: payload.entityType,
          description: payload.description !== undefined ? payload.description : existing.description,
          dslJson: payload
        }).where(eq(workflowDefinitions.id, finalDefId));
      }

      if (payload.states && Array.isArray(payload.states)) {
        await writeDesignTables(tx, finalDefId, payload.states, payload.transitions, knownRoles);
      }

      // v10.1.17 (TD-1270, decision ت۱۰): a new definition is published at once (it never sits without a published
      // version); a save of an existing one is a draft that new records do not see until it is published
      const version = await recordDefinitionVersion(tx, finalDefId, {
        title: payload.title,
        description: before ? 'پیش‌نویس طرح گردش کار' : 'ایجاد فرآیند',
        userId: payload.userId,
        status: before ? 'draft' : 'published',
      });
      // v10.1.7 (TD-1229, OBS-R2-64): a design save writes its audit row with the same tx (before only positions did)
      const after = designAuditSummary(
        { title: payload.title, entityType: payload.entityType, description: payload.description ?? before?.description ?? '', isActive },
        (payload.states ?? []).map(st => String(st.stateKey || st.key || '')),
        (payload.transitions ?? []).map(tr => String(tr.actionKey || tr.key || '')),
      );
      await logActivity({
        tx, req, userId: payload.userId, action: before ? 'UPDATE' : 'CREATE', entity: 'طرح گردش کار', entityId: finalDefId,
        description: before ? `ذخیره پیش‌نویس طرح گردش کار «${payload.title}» (نسخه ${version}، منتشرنشده)` : `ساخت گردش کار «${payload.title}»${isActive ? '' : ' (غیرفعال)'}`,
        details: { code: payload.code, version, status: before ? 'draft' : 'published', before, after, ...(payload.fromTemplate ? { fromTemplate: payload.fromTemplate } : {}) },
      });
      return finalDefId;
    });

    return await this.getDefinitionById(defId);
  }

  /**
   * Update node canvas coordinates
   *
   * v9.0.50 (TD-459، B14-17): فقط گام‌های همان گردش کار، در یک تراکنش زیر قفل ردیف تعریف و با یک گزارش فعالیت؛
   * گام گردش کار دیگر ۴۲۲. پیش‌تر مختصات هر گامِ هر تعریفی بیرون از تراکنش و بی گزارش عوض می‌شد. مختصات فقط چیدمان
   * طراح‌اند و نسخه تازه نمی‌سازند.
   */
  static async updateCanvasPositions(
    definitionId: number,
    positions: { id: number; positionX: number; positionY: number }[],
    req?: Request,
  ) {
    return await orm.transaction(async (tx) => {
      const [def] = await tx.select({ id: workflowDefinitions.id, title: workflowDefinitions.title })
        .from(workflowDefinitions).where(eq(workflowDefinitions.id, definitionId)).for('update');
      if (!def) throw new NotFoundError('گردش کار یافت نشد', undefined, 'WF_DEF_NOT_FOUND');
      const ids = [...new Set(positions.map(p => p.id))];
      const own = await tx.select({ id: workflowStates.id }).from(workflowStates)
        .where(and(eq(workflowStates.workflowDefinitionId, definitionId), inArray(workflowStates.id, ids)));
      if (own.length !== ids.length) {
        throw new ValidationError(`مختصات ذخیره نشد: ${ids.length - own.length} گام از این گردش کار نیست؛ طراح را دوباره باز کنید.`);
      }
      for (const pos of positions) {
        await tx.update(workflowStates)
          .set({ positionX: pos.positionX, positionY: pos.positionY })
          .where(and(eq(workflowStates.id, pos.id), eq(workflowStates.workflowDefinitionId, definitionId)));
      }
      await logActivity({
        tx, req, action: 'UPDATE', entity: 'طرح گردش کار', entityId: definitionId,
        description: `جابه‌جایی ${positions.length} گام در طراح گردش کار «${def.title}»`,
        details: { positions },
      });
      return { success: true };
    });
  }

  /**
   * Seed default system workflow definitions
   *
   * v9.0.46 (TD-453، تصمیم ت۸ الف): فقط تعریفی را می‌سازد که با این کد وجود ندارد و فقط هنگام راه‌اندازی صدا زده
   * می‌شود (server.ts، seed، آماده‌سازی آزمون)؛ تعریف موجود هرگز بازنویسی نمی‌شود. پیش‌تر هر خواندن فهرست تعریف‌ها و
   * هر شروع فرایند بی تراکنش آن را اجرا می‌کرد و گردش خرید ویرایش‌شده (عنوان «…استعلام…» یا ≤ ۱ گام) و گردش اسناد
   * حسابداری با ≤ ۱ گام به پیش‌فرض برمی‌گشتند. خطا دیگر بلعیده نمی‌شود.
   */
  static async seedDefaultWorkflows(): Promise<void> {
    try {
      const missing = async (code: string) =>
        (await orm.select({ id: workflowDefinitions.id }).from(workflowDefinitions).where(eq(workflowDefinitions.code, code))).length === 0;

      if (await missing('DOC_APPROVAL_WORKFLOW')) {
        await this.saveWorkflowDefinition({
          code: 'DOC_APPROVAL_WORKFLOW',
          title: 'چرخه تایید سه‌مرحله‌ای اسناد و فاکتورها (فروش -> انبار -> مالی)',
          entityType: 'document',
          description: 'گردش کار تایید سه‌مرحله‌ای اسناد فروش و پیش‌فاکتورها شامل بررسی پیش‌نویس، تایید تحویل انبار و تاییدیه مالی',
          version: 1,
          isActive: 1,
          states: [
            {
              stateKey: 'draft',
              title: 'پیش‌نویس اولیه',
              stateType: 'initial',
              color: 'gray',
              stepOrder: 1,
              slaHours: 24,
              positionX: 80,
              positionY: 160
            },
            {
              stateKey: 'warehouse_review',
              title: 'بررسی و تایید انبار',
              stateType: 'normal',
              color: 'amber',
              stepOrder: 2,
              slaHours: 24,
              positionX: 320,
              positionY: 160
            },
            {
              stateKey: 'accounting_review',
              title: 'بررسی و ثبت مالی',
              stateType: 'normal',
              color: 'sky',
              stepOrder: 3,
              slaHours: 24,
              positionX: 560,
              positionY: 160
            },
            {
              stateKey: 'approved',
              title: 'تایید نهایی و قطعی',
              stateType: 'terminal',
              color: 'emerald',
              stepOrder: 4,
              slaHours: 24,
              positionX: 800,
              positionY: 160
            },
            {
              stateKey: 'rejected',
              title: 'رد شده / لغو شده',
              stateType: 'terminal',
              color: 'rose',
              stepOrder: 5,
              slaHours: 24,
              positionX: 440,
              positionY: 340
            }
          ],
          transitions: [
            // v9.0.35 (TD-445، تصمیم ت۲ «فقط مجوز»): نگهبان هر اقدام از DOC_APPROVAL_STEP_GUARDS
            ...DOC_APPROVAL_STEP_GUARDS.map(g => ({ ...g }))
          ]
        });
        logger.info('[WorkflowDefinitionService] Seeded default DOC_APPROVAL_WORKFLOW successfully.');
      } else {
        if (await upgradeLegacyDocApprovalGuards()) {
          logger.info('[WorkflowDefinitionService] DOC_APPROVAL_WORKFLOW step permissions upgraded (TD-445).');
        }
        // v10.0.120 (TD-1220): ارسال به انبار فقط برای سازنده سند و بازگشایی با ویرایش سند
        if (await upgradeLegacySeedGuards(DOC_APPROVAL_SUBMIT_GUARD_UPGRADE)) {
          logger.info('[WorkflowDefinitionService] DOC_APPROVAL_WORKFLOW send and reopen guards upgraded (TD-1220).');
        }
      }

      // Seed PURCHASE_REQUISITION_WORKFLOW (سیستم ساده‌سازی شده ۳ مرحله‌ای خرید و تدارکات کارگاه)
      if (await missing('PURCHASE_REQUISITION_WORKFLOW')) {
        await this.saveWorkflowDefinition({
          code: PURCHASE_REQUISITION_WORKFLOW_TEMPLATE.code,
          title: PURCHASE_REQUISITION_WORKFLOW_TEMPLATE.title,
          entityType: PURCHASE_REQUISITION_WORKFLOW_TEMPLATE.entityType,
          description: PURCHASE_REQUISITION_WORKFLOW_TEMPLATE.description,
          version: 2,
          isActive: 1,
          states: PURCHASE_REQUISITION_WORKFLOW_TEMPLATE.states.map(st => ({ ...st })),
          // v10.0.23 (OBS-R2-36): نگهبان گام‌ها از PURCHASE_REQUISITION_STEP_GUARDS
          transitions: PURCHASE_REQUISITION_STEP_GUARDS.map(g => ({ ...g }))
        });
        logger.info('[WorkflowDefinitionService] Seeded simplified 3-stage PURCHASE_REQUISITION_WORKFLOW successfully.');
      } else if (await upgradeLegacySeedGuards(PURCHASE_REQUISITION_GUARD_UPGRADE)) {
        logger.info('[WorkflowDefinitionService] PURCHASE_REQUISITION_WORKFLOW step permissions upgraded (OBS-R2-36).');
      }

      // Seed JOURNAL_VOUCHER_WORKFLOW (گردش‌کار تایید و ثبت اسناد حسابداری کارگاه)
      if (await missing('JOURNAL_VOUCHER_WORKFLOW')) {
        await this.saveWorkflowDefinition({
          code: JOURNAL_VOUCHER_WORKFLOW_TEMPLATE.code,
          title: JOURNAL_VOUCHER_WORKFLOW_TEMPLATE.title,
          entityType: JOURNAL_VOUCHER_WORKFLOW_TEMPLATE.entityType,
          description: JOURNAL_VOUCHER_WORKFLOW_TEMPLATE.description,
          version: 1,
          isActive: 1,
          states: JOURNAL_VOUCHER_WORKFLOW_TEMPLATE.states.map(st => ({ ...st })),
          // v10.0.27 (TD-965): نگهبان گام‌ها از JOURNAL_VOUCHER_STEP_GUARDS (تأیید با accounting.vouchers_approve)
          transitions: JOURNAL_VOUCHER_STEP_GUARDS.map(g => ({ ...g }))
        });
        logger.info('[WorkflowDefinitionService] Seeded simplified JOURNAL_VOUCHER_WORKFLOW successfully.');
      } else if (await upgradeLegacySeedGuards(JOURNAL_VOUCHER_GUARD_UPGRADE)) {
        logger.info('[WorkflowDefinitionService] JOURNAL_VOUCHER_WORKFLOW step permissions upgraded (TD-965).');
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`[WorkflowDefinitionService] Seed default workflows failed: ${errMsg}`);
      throw err;
    }
  }
}
