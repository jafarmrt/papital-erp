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
import { recordDefinitionVersion } from './workflowSnapshot.js';
import { DOC_APPROVAL_STEP_GUARDS, upgradeLegacyDocApprovalGuards } from './docApprovalGuards.js';
import { upgradeLegacySeedGuards } from './seedGuardUpgrade.js';
import { JOURNAL_VOUCHER_GUARD_UPGRADE, JOURNAL_VOUCHER_STEP_GUARDS } from './voucherWorkflowGuards.js';
import { PURCHASE_REQUISITION_GUARD_UPGRADE, PURCHASE_REQUISITION_STEP_GUARDS } from './purchaseWorkflowGuards.js';
import { resolveTransitionRoles, storedTransitionRole } from './transitionRoles.js';
import { 
  CreateWorkflowDefinitionInput, 
  UpdateWorkflowDefinitionInput, 
  WorkflowDefinitionDTO 
} from './contracts/workflowDomainContracts.js';

export type WorkflowDefinitionWithStats = (typeof workflowDefinitions.$inferSelect) & {
  stateCount: number;
  transitionCount: number;
  activeInstancesCount: number;
};

export interface WorkflowDefinitionDetails {
  definition: typeof workflowDefinitions.$inferSelect;
  states: (typeof workflowStates.$inferSelect)[];
  transitions: (typeof workflowTransitions.$inferSelect)[];
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
  states?: Array<{
    id?: number | string;
    code?: string;
    key?: string;
    stateKey?: string;
    title: string;
    stateType?: string;
    stepOrder?: number;
    slaHours?: number;
    color?: string;
    positionX?: number;
    positionY?: number;
    x?: number;
    y?: number;
    [key: string]: unknown;
  }>;
  transitions?: Array<{
    id?: number | string;
    from?: string | number;
    to?: string | number;
    fromStateId?: number | string;
    toStateId?: number | string;
    fromStateKey?: string;
    toStateKey?: string;
    actionKey: string;
    key?: string;
    title?: string;
    requiredRole?: string;
    requiredPermission?: string;
    ruleConditionsJson?: unknown;
    approvalRuleType?: string;
    parallelApprovalRule?: string;
    kValue?: number;
    autoActionKey?: string;
    /** v8.0.102 (TD-392): آغازکننده فرایند این انتقال را اجرا نمی‌کند */
    isInitiatorExcluded?: number | boolean;
    [key: string]: unknown;
  }>;
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
      transitions
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
   * Create a new workflow definition with its initial version 1
   */
  static async createDefinition(input: CreateWorkflowDefinitionInput): Promise<WorkflowDefinitionDTO> {
    return await orm.transaction(async (tx) => {
      const existing = await tx.select().from(workflowDefinitions).where(eq(workflowDefinitions.code, input.code));
      if (existing.length > 0) {
        throw new ConflictError(`کد فرآیند کاری '${input.code}' قبلاً ثبت شده است`, undefined, 'WF_DEF_CODE_EXISTS');
      }

      const [def] = await tx.insert(workflowDefinitions).values({
        code: input.code,
        title: input.title,
        entityType: input.entityType,
        description: input.description || '',
        version: 0,
        isActive: 1,
        dslJson: input.dslJson || {}
      }).returning();

      // v7.0.87 (TD-112): نسخه ۱ تصویر جدول‌هاست، نه payload خام
      const version = await recordDefinitionVersion(tx, def.id, { title: def.title, description: def.description || 'ایجاد فرآیند' });
      return { ...def, version } as WorkflowDefinitionDTO;
    });
  }

  /**
   * Update workflow definition
   */
  static async updateDefinition(id: number, input: UpdateWorkflowDefinitionInput): Promise<WorkflowDefinitionDTO> {
    const [existing] = await orm.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, id));
    if (!existing) {
      throw new NotFoundError('گردش کار یافت نشد.', undefined, 'WF_DEF_NOT_FOUND');
    }

    const [updated] = await orm.update(workflowDefinitions)
      .set({
        title: input.title !== undefined ? input.title : existing.title,
        description: input.description !== undefined ? input.description : existing.description,
        isActive: input.isActive !== undefined ? input.isActive : existing.isActive,
        dslJson: input.dslJson !== undefined ? input.dslJson : existing.dslJson
      })
      .where(eq(workflowDefinitions.id, id))
      .returning();

    return updated as WorkflowDefinitionDTO;
  }

  /**
   * Save definition with states & transitions DSL structure
   */
  static async saveWorkflowDefinition(payload: SaveWorkflowDefinitionPayload) {
    assertSavableWorkflowDesign(payload);
    // v7.0.87 (TD-112): تعریف، وضعیت‌ها، انتقال‌ها و نسخه تازه در یک تراکنش ذخیره می‌شوند
    const defId = await orm.transaction(async (tx) => {
      // v9.0.128 (TD-542): نقش هر اقدام باید در فهرست نقش‌ها باشد (۴۲۲)؛ کد ثبت‌شده نقش ذخیره می‌شود
      const knownRoles = await resolveTransitionRoles(tx, Array.isArray(payload.transitions) ? payload.transitions : []);
      let finalDefId = payload.id;
      if (!finalDefId) {
        const [duplicate] = await tx.select({ id: workflowDefinitions.id }).from(workflowDefinitions)
          .where(eq(workflowDefinitions.code, payload.code));
        if (duplicate) {
          throw new ConflictError(`کد فرآیند کاری '${payload.code}' قبلاً ثبت شده است`, undefined, 'WF_DEF_CODE_EXISTS');
        }
        const [created] = await tx.insert(workflowDefinitions).values({
          code: payload.code,
          title: payload.title,
          entityType: payload.entityType,
          description: payload.description || '',
          version: 0,
          isActive: 1,
          dslJson: payload
        }).returning();
        finalDefId = created.id;
      } else {
        const [existing] = await tx.select().from(workflowDefinitions)
          .where(eq(workflowDefinitions.id, finalDefId)).for('update');
        if (!existing) {
          throw new NotFoundError('تعریف فرآیند کاری یافت نشد', undefined, 'WF_DEF_NOT_FOUND');
        }
        await tx.update(workflowDefinitions).set({
          title: payload.title,
          description: payload.description !== undefined ? payload.description : existing.description,
          dslJson: payload
        }).where(eq(workflowDefinitions.id, finalDefId));
      }

      if (payload.states && Array.isArray(payload.states)) {
        await tx.delete(workflowTransitions).where(eq(workflowTransitions.workflowDefinitionId, finalDefId));
        await tx.delete(workflowStates).where(eq(workflowStates.workflowDefinitionId, finalDefId));

        const stateIdMap = new Map<number | string, number>();

        for (const [index, st] of payload.states.entries()) {
          const [insertedSt] = await tx.insert(workflowStates).values({
            workflowDefinitionId: finalDefId,
            stateKey: st.stateKey || st.key || 'state',
            title: st.title || 'وضعیت',
            stateType: st.stateType || 'normal',
            color: st.color || 'gray',
            // v9.0.47 (TD-454): گام بی ترتیب جای خودش در فهرست را می‌گیرد (پیش‌تر همه گام‌ها ترتیب ۱ می‌گرفتند)
            stepOrder: Number.isInteger(st.stepOrder) && Number(st.stepOrder) > 0 ? Number(st.stepOrder) : index + 1,
            slaHours: Number(st.slaHours) || 24,
            positionX: Number(st.positionX) || Number(st.x) || 100,
            positionY: Number(st.positionY) || Number(st.y) || 100
          }).returning();

          if (st.id !== undefined) {
            stateIdMap.set(st.id, insertedSt.id);
            stateIdMap.set(Number(st.id), insertedSt.id);
            stateIdMap.set(String(st.id), insertedSt.id);
          }
          if (st.stateKey) stateIdMap.set(st.stateKey, insertedSt.id);
          if (st.key) stateIdMap.set(st.key, insertedSt.id);
        }

        if (payload.transitions && Array.isArray(payload.transitions)) {
          for (const tr of payload.transitions) {
            const fromKey = tr.fromStateId ?? tr.fromStateKey ?? tr.from;
            const toKey = tr.toStateId ?? tr.toStateKey ?? tr.to;

            const fromId = fromKey !== undefined ? stateIdMap.get(fromKey) : undefined;
            const toId = toKey !== undefined ? stateIdMap.get(toKey) : undefined;

            // v9.0.45 (TD-452): اقدامی که مبدأ یا مقصدش پیدا نشود رد می‌شود، نه بی‌صدا حذف
            if (!fromId || !toId) {
              throw new ValidationError(`طرح گردش کار ذخیره نشد: گام مبدأ یا مقصد اقدام «${tr.title || tr.actionKey}» پیدا نشد.`);
            }
            await tx.insert(workflowTransitions).values({
              workflowDefinitionId: finalDefId,
              fromStateId: fromId,
              toStateId: toId,
              actionKey: tr.actionKey || tr.key || 'action',
              title: tr.title || 'اقدام',
              requiredRole: storedTransitionRole(tr.requiredRole, knownRoles),
              requiredPermission: (tr.requiredPermission || '').trim(),
              approvalRuleType: tr.approvalRuleType || tr.parallelApprovalRule || 'SINGLE',
              kValue: Number(tr.kValue) || 1,
              ruleConditionsJson: tr.ruleConditionsJson || [],
              autoActionKey: tr.autoActionKey || '',
              isInitiatorExcluded: tr.isInitiatorExcluded === true || Number(tr.isInitiatorExcluded) === 1 ? 1 : 0
            });
          }
        }
      }

      await recordDefinitionVersion(tx, finalDefId, {
        title: payload.title,
        description: payload.id ? 'ذخیره تغییرات طرح فرآیند' : 'ایجاد فرآیند',
        userId: payload.userId,
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
   * Add new workflow state
   */
  static async addState(definitionId: number, data: {
    stateKey: string;
    title: string;
    stateType: 'initial' | 'normal' | 'terminal';
    slaHours?: number;
    color?: string;
    stepOrder?: number;
    positionX?: number;
    positionY?: number;
  }) {
    const [inserted] = await orm.insert(workflowStates).values({
      workflowDefinitionId: definitionId,
      stateKey: data.stateKey,
      title: data.title,
      stateType: data.stateType,
      slaHours: data.slaHours || 24,
      color: data.color || 'gray',
      stepOrder: data.stepOrder || 1,
      positionX: data.positionX || 100,
      positionY: data.positionY || 100
    }).returning();

    return inserted;
  }

  /**
   * Add new workflow transition
   */
  static async addTransition(data: {
    workflowDefinitionId: number;
    fromStateId: number;
    toStateId: number;
    actionKey: string;
    title: string;
    requiredRole?: string;
    ruleConditionsJson?: unknown;
    approvalRuleType?: string;
    kValue?: number;
  }) {
    const [inserted] = await orm.insert(workflowTransitions).values({
      workflowDefinitionId: data.workflowDefinitionId,
      fromStateId: data.fromStateId,
      toStateId: data.toStateId,
      actionKey: data.actionKey,
      title: data.title,
      requiredRole: data.requiredRole || '',
      ruleConditionsJson: data.ruleConditionsJson || [],
      approvalRuleType: data.approvalRuleType || 'SINGLE',
      kValue: data.kValue || 1
    }).returning();

    return inserted;
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
      } else if (await upgradeLegacyDocApprovalGuards()) {
        logger.info('[WorkflowDefinitionService] DOC_APPROVAL_WORKFLOW step permissions upgraded (TD-445).');
      }

      // Seed PURCHASE_REQUISITION_WORKFLOW (سیستم ساده‌سازی شده ۳ مرحله‌ای خرید و تدارکات کارگاه)
      if (await missing('PURCHASE_REQUISITION_WORKFLOW')) {
        await this.saveWorkflowDefinition({
          code: 'PURCHASE_REQUISITION_WORKFLOW',
          title: 'گردش کار تدارکات و خرید کارگاه (بررسی و تایید -> در حال خرید -> تحویل انبار)',
          entityType: 'purchase_requisition',
          description: 'فرآیند ساده‌سازی شده خرید و تدارکات کارگاه شامل ۳ گام عملیاتی: ۱. در انتظار بررسی و تایید، ۲. تایید شده (در حال خرید)، ۳. خرید و تحویل انبار شده',
          version: 2,
          isActive: 1,
          states: [
            {
              stateKey: 'pending',
              title: 'در انتظار بررسی و تایید',
              stateType: 'initial',
              color: 'amber',
              stepOrder: 1,
              slaHours: 24,
              positionX: 100,
              positionY: 160
            },
            {
              stateKey: 'ordered',
              title: 'تایید شده (در حال خرید)',
              stateType: 'normal',
              color: 'sky',
              stepOrder: 2,
              slaHours: 48,
              positionX: 450,
              positionY: 160
            },
            {
              stateKey: 'received',
              title: 'خرید و تحویل انبار شده (تکمیل)',
              stateType: 'terminal',
              color: 'emerald',
              stepOrder: 3,
              slaHours: 24,
              positionX: 800,
              positionY: 160
            },
            {
              stateKey: 'rejected',
              title: 'رد شده / لغو',
              stateType: 'terminal',
              color: 'rose',
              stepOrder: 4,
              slaHours: 24,
              positionX: 450,
              positionY: 340
            }
          ],
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
          code: 'JOURNAL_VOUCHER_WORKFLOW',
          title: 'گردش کار تایید اسناد حسابداری کارگاه (پیش‌نویس -> تایید و ثبت دفاتر -> قطعی‌سازی)',
          entityType: 'journal_voucher',
          description: 'فرآیند سبک و متناسب کارگاه جهت تایید اسناد حسابداری: ثبت پیش‌نویس توسط کاربران/سیستم -> بررسی و تایید واحد حسابداری -> قطعی‌سازی دفاتر رسمی',
          version: 1,
          isActive: 1,
          states: [
            {
              stateKey: 'draft',
              title: 'پیش‌نویس سند',
              stateType: 'initial',
              color: 'slate',
              stepOrder: 1,
              slaHours: 24,
              positionX: 100,
              positionY: 160
            },
            {
              stateKey: 'approved',
              title: 'تایید و ثبت دفاتر رسمی',
              stateType: 'intermediate',
              color: 'blue',
              stepOrder: 2,
              slaHours: 48,
              positionX: 450,
              positionY: 160
            },
            {
              stateKey: 'permanent',
              title: 'قطعی و قفل دفاتر',
              stateType: 'terminal',
              color: 'emerald',
              stepOrder: 3,
              slaHours: 72,
              positionX: 800,
              positionY: 160
            },
            {
              stateKey: 'rejected',
              title: 'رد شده / نیازمند بازبینی',
              stateType: 'intermediate',
              color: 'rose',
              stepOrder: 4,
              slaHours: 24,
              positionX: 450,
              positionY: 340
            }
          ],
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
