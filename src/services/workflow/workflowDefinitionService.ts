import { orm } from '../../db/drizzle.js';
import { 
  workflowDefinitions, 
  workflowDefinitionVersions, 
  workflowStates, 
  workflowTransitions,
  workflowInstances
} from '../../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { logger } from '../../middleware/logger.js';
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
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

export class WorkflowDefinitionService {
  /**
   * List workflow definitions with optional filters
   */
  static async getDefinitions(filter?: { isActive?: boolean; entityType?: string }): Promise<WorkflowDefinitionWithStats[]> {
    await this.seedDefaultWorkflows();

    const conditions = [];

    if (filter?.isActive !== undefined) {
      conditions.push(eq(workflowDefinitions.isActive, filter.isActive ? 1 : 0));
    }
    if (filter?.entityType) {
      conditions.push(eq(workflowDefinitions.entityType, filter.entityType));
    }

    const defs = conditions.length > 0
      ? await orm.select().from(workflowDefinitions).where(and(...conditions))
      : await orm.select().from(workflowDefinitions);

    const results: WorkflowDefinitionWithStats[] = [];
    for (const def of defs) {
      const [statesRes] = await orm.select({ count: sql<number>`count(*)` }).from(workflowStates).where(eq(workflowStates.workflowDefinitionId, def.id));
      const [transRes] = await orm.select({ count: sql<number>`count(*)` }).from(workflowTransitions).where(eq(workflowTransitions.workflowDefinitionId, def.id));
      const [instancesRes] = await orm.select({ count: sql<number>`count(*)` }).from(workflowInstances).where(and(eq(workflowInstances.workflowDefinitionId, def.id), eq(workflowInstances.status, 'IN_PROGRESS')));

      results.push({
        ...def,
        stateCount: Number(statesRes?.count || 0),
        transitionCount: Number(transRes?.count || 0),
        activeInstancesCount: Number(instancesRes?.count || 0)
      });
    }

    return results;
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
   * Create a new workflow definition and publish initial version 1
   */
  static async createDefinition(input: CreateWorkflowDefinitionInput): Promise<WorkflowDefinitionDTO> {
    const existing = await orm.select().from(workflowDefinitions).where(eq(workflowDefinitions.code, input.code));
    if (existing.length > 0) {
      throw new Error(`کد فرآیند کاری '${input.code}' قبلاً ثبت شده است (WF_DEF_CODE_EXISTS)`);
    }

    const [def] = await orm.insert(workflowDefinitions).values({
      code: input.code,
      title: input.title,
      entityType: input.entityType,
      description: input.description || '',
      version: 1,
      isActive: 1,
      dslJson: input.dslJson || {}
    }).returning();

    await orm.insert(workflowDefinitionVersions).values({
      definitionId: def.id,
      version: 1,
      title: def.title,
      description: def.description || '',
      dslJson: input.dslJson || {},
      createdAt: new Date().toISOString()
    });

    return def as WorkflowDefinitionDTO;
  }

  /**
   * Update workflow definition
   */
  static async updateDefinition(id: number, input: UpdateWorkflowDefinitionInput): Promise<WorkflowDefinitionDTO> {
    const [existing] = await orm.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, id));
    if (!existing) {
      throw new Error('تعریف فرآیند کاری یافت نشد (WF_DEF_NOT_FOUND)');
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
    let defId = payload.id;
    if (!defId) {
      const created = await this.createDefinition({
        code: payload.code,
        title: payload.title,
        entityType: payload.entityType,
        description: payload.description,
        dslJson: payload
      });
      defId = created.id;
    } else {
      await this.updateDefinition(defId, {
        title: payload.title,
        description: payload.description,
        dslJson: payload
      });
    }

    const finalDefId = defId;
    if (!finalDefId) {
      throw new Error('Failed to obtain workflow definition ID');
    }

    if (payload.states && Array.isArray(payload.states)) {
      await orm.delete(workflowTransitions).where(eq(workflowTransitions.workflowDefinitionId, finalDefId));
      await orm.delete(workflowStates).where(eq(workflowStates.workflowDefinitionId, finalDefId));

      const stateIdMap = new Map<number | string, number>();

      for (const st of payload.states) {
        const [insertedSt] = await orm.insert(workflowStates).values({
          workflowDefinitionId: finalDefId,
          stateKey: st.stateKey || st.key || 'state',
          title: st.title || 'وضعیت',
          stateType: st.stateType || 'normal',
          color: st.color || 'gray',
          stepOrder: st.stepOrder || 1,
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

          if (fromId && toId) {
            await orm.insert(workflowTransitions).values({
              workflowDefinitionId: finalDefId,
              fromStateId: fromId,
              toStateId: toId,
              actionKey: tr.actionKey || tr.key || 'action',
              title: tr.title || 'انتقال',
              requiredRole: tr.requiredRole || '',
              requiredPermission: tr.requiredPermission || '',
              approvalRuleType: tr.approvalRuleType || tr.parallelApprovalRule || 'SINGLE',
              kValue: Number(tr.kValue) || 1,
              ruleConditionsJson: tr.ruleConditionsJson || [],
              autoActionKey: tr.autoActionKey || ''
            });
          }
        }
      }
    }

    return await this.getDefinitionById(defId);
  }

  /**
   * Update node canvas coordinates
   */
  static async updateCanvasPositions(positions: { id: number; positionX: number; positionY: number }[]) {
    for (const pos of positions) {
      await orm.update(workflowStates)
        .set({ positionX: pos.positionX, positionY: pos.positionY })
        .where(eq(workflowStates.id, pos.id));
    }
    return { success: true };
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
   */
  static async seedDefaultWorkflows(): Promise<void> {
    try {
      const existingDocWf = await orm.select().from(workflowDefinitions).where(eq(workflowDefinitions.code, 'DOC_APPROVAL_WORKFLOW'));
      const statesCount = existingDocWf.length > 0
        ? await orm.select({ count: sql<number>`count(*)` }).from(workflowStates).where(eq(workflowStates.workflowDefinitionId, existingDocWf[0].id))
        : [{ count: 0 }];

      if (existingDocWf.length === 0 || Number(statesCount[0]?.count || 0) === 0) {
        await this.saveWorkflowDefinition({
          id: existingDocWf[0]?.id,
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
            {
              from: 'draft',
              to: 'warehouse_review',
              actionKey: 'submit_to_warehouse',
              title: 'ارسال به انبار جهت تایید اقلام',
              requiredRole: '',
              requiredPermission: ''
            },
            {
              from: 'warehouse_review',
              to: 'accounting_review',
              actionKey: 'approve_warehouse',
              title: 'تایید انبارداری و تحویل کالا',
              requiredRole: '',
              requiredPermission: ''
            },
            {
              from: 'accounting_review',
              to: 'approved',
              actionKey: 'approve_accounting',
              title: 'تایید نهایی واحد مالی و صدور سند',
              requiredRole: '',
              requiredPermission: ''
            },
            {
              from: 'warehouse_review',
              to: 'rejected',
              actionKey: 'reject',
              title: 'رد پیش‌فاکتور توسط انبار',
              requiredRole: '',
              requiredPermission: ''
            },
            {
              from: 'accounting_review',
              to: 'rejected',
              actionKey: 'reject',
              title: 'رد پیش‌فاکتور توسط مالی',
              requiredRole: '',
              requiredPermission: ''
            },
            {
              from: 'rejected',
              to: 'draft',
              actionKey: 'reopen',
              title: 'بازگشایی مجدد جهت اصلاح',
              requiredRole: '',
              requiredPermission: ''
            },
            {
              from: 'draft',
              to: 'approved',
              actionKey: 'direct_approve',
              title: 'تایید مستقیم مدیریتی',
              requiredRole: 'admin',
              requiredPermission: 'workflow.approve'
            }
          ]
        });
        logger.info('[WorkflowDefinitionService] Seeded default DOC_APPROVAL_WORKFLOW successfully.');
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn(`[WorkflowDefinitionService] Seed default workflows warning: ${errMsg}`);
    }
  }
}
