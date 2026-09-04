import { orm } from '../../db/drizzle.js';
import { 
  workflowDefinitions, 
  workflowDefinitionVersions,
  workflowStates,
  workflowTransitions
} from '../../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { WorkflowVersionDTO } from './contracts/workflowDomainContracts.js';

export class WorkflowVersionService {
  /**
   * Get all published versions for a definition
   */
  static async getDefinitionVersions(definitionId: number): Promise<WorkflowVersionDTO[]> {
    const versions = await orm.select()
      .from(workflowDefinitionVersions)
      .where(eq(workflowDefinitionVersions.definitionId, definitionId))
      .orderBy(desc(workflowDefinitionVersions.version));

    return versions.map(v => ({
      id: v.id,
      definitionId: v.definitionId,
      version: v.version,
      title: v.title,
      description: v.description || '',
      dslJson: (v.dslJson as Record<string, unknown>) || {},
      createdAt: v.createdAt || ''
    }));
  }

  /**
   * Get specific version detail for a definition
   */
  static async getDefinitionVersionDetail(definitionId: number, versionNumber: number): Promise<WorkflowVersionDTO> {
    const [versionEntry] = await orm.select()
      .from(workflowDefinitionVersions)
      .where(and(
        eq(workflowDefinitionVersions.definitionId, definitionId),
        eq(workflowDefinitionVersions.version, versionNumber)
      ));

    if (!versionEntry) {
      throw new Error(`نسخه شماره ${versionNumber} برای این فرآیند کاری یافت نشد (WF_VER_NOT_FOUND)`);
    }

    return {
      id: versionEntry.id,
      definitionId: versionEntry.definitionId,
      version: versionEntry.version,
      title: versionEntry.title,
      description: versionEntry.description || '',
      dslJson: (versionEntry.dslJson as Record<string, unknown>) || {},
      createdAt: versionEntry.createdAt || ''
    };
  }

  /**
   * Publish an explicit new immutable version snapshot for a definition
   */
  static async publishVersion(definitionId: number, title?: string, description?: string, userId?: number): Promise<WorkflowVersionDTO> {
    const [def] = await orm.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, definitionId));
    if (!def) {
      throw new Error(`تعریف فرآیند کاری شماره ${definitionId} یافت نشد (WF_VER_INVALID_DEFINITION)`);
    }

    const nextVersion = (def.version || 1) + 1;

    // Fetch active states & transitions to form a complete, self-contained DSL snapshot
    const states = await orm.select().from(workflowStates).where(eq(workflowStates.workflowDefinitionId, definitionId));
    const transitions = await orm.select().from(workflowTransitions).where(eq(workflowTransitions.workflowDefinitionId, definitionId));

    const fullDsl: Record<string, unknown> = {
      ...((def.dslJson as Record<string, unknown>) || {}),
      definitionId: def.id,
      code: def.code,
      title: title || def.title,
      entityType: def.entityType,
      version: nextVersion,
      states,
      transitions,
      publishedAt: new Date().toISOString()
    };

    await orm.update(workflowDefinitions)
      .set({ 
        version: nextVersion,
        dslJson: fullDsl
      })
      .where(eq(workflowDefinitions.id, definitionId));

    const [published] = await orm.insert(workflowDefinitionVersions).values({
      definitionId,
      version: nextVersion,
      title: title || def.title,
      description: description || def.description || `انتشار نسخه شماره ${nextVersion}`,
      dslJson: fullDsl,
      createdBy: userId || null,
      createdAt: new Date().toISOString()
    }).returning();

    return {
      id: published.id,
      definitionId: published.definitionId,
      version: published.version,
      title: published.title,
      description: published.description || '',
      dslJson: (published.dslJson as Record<string, unknown>) || {},
      createdAt: published.createdAt || ''
    };
  }

  /**
   * Rollback workflow definition to a historical published version
   */
  static async rollbackToVersion(definitionId: number, targetVersion: number, userId?: number) {
    const versionEntry = await this.getDefinitionVersionDetail(definitionId, targetVersion);
    const dsl = versionEntry.dslJson || {};

    const [def] = await orm.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, definitionId));
    if (!def) {
      throw new Error('ورکفلو یافت نشد (WF_VER_INVALID_DEFINITION)');
    }

    const newVersion = (def.version || 1) + 1;

    // Restore physical workflowStates and workflowTransitions from target version DSL if present
    if (dsl.states && Array.isArray(dsl.states)) {
      await orm.delete(workflowTransitions).where(eq(workflowTransitions.workflowDefinitionId, definitionId));
      await orm.delete(workflowStates).where(eq(workflowStates.workflowDefinitionId, definitionId));

      const stateIdMap = new Map<number | string, number>();

      for (const st of dsl.states) {
        const [insertedSt] = await orm.insert(workflowStates).values({
          workflowDefinitionId: definitionId,
          stateKey: st.stateKey || st.key || 'state',
          title: st.title || 'وضعیت',
          stateType: st.stateType || 'normal',
          color: st.color || 'gray',
          stepOrder: st.stepOrder || 1,
          slaHours: st.slaHours || 24,
          positionX: st.positionX || st.x || 100,
          positionY: st.positionY || st.y || 100
        }).returning();

        if (st.id) stateIdMap.set(st.id, insertedSt.id);
        stateIdMap.set(st.stateKey, insertedSt.id);
      }

      if (dsl.transitions && Array.isArray(dsl.transitions)) {
        for (const tr of dsl.transitions) {
          const fromId = stateIdMap.get(tr.fromStateId) || stateIdMap.get(tr.from);
          const toId = stateIdMap.get(tr.toStateId) || stateIdMap.get(tr.to);

          if (fromId && toId) {
            await orm.insert(workflowTransitions).values({
              workflowDefinitionId: definitionId,
              fromStateId: fromId,
              toStateId: toId,
              actionKey: tr.actionKey || tr.key || 'action',
              title: tr.title || 'انتقال',
              requiredRole: tr.requiredRole || '',
              requiredPermission: tr.requiredPermission || '',
              approvalRuleType: tr.approvalRuleType || tr.parallelApprovalRule || 'SINGLE',
              kValue: tr.kValue || 1,
              ruleConditionsJson: tr.ruleConditionsJson || []
            });
          }
        }
      }
    }

    const restoredDsl: Record<string, unknown> = {
      ...dsl,
      version: newVersion,
      restoredFromVersion: targetVersion,
      publishedAt: new Date().toISOString()
    };

    await orm.update(workflowDefinitions)
      .set({
        version: newVersion,
        title: versionEntry.title,
        description: versionEntry.description,
        dslJson: restoredDsl
      })
      .where(eq(workflowDefinitions.id, definitionId));

    await orm.insert(workflowDefinitionVersions).values({
      definitionId,
      version: newVersion,
      title: versionEntry.title,
      description: `بازگردانی شده به نسخه ${targetVersion}`,
      dslJson: restoredDsl,
      createdBy: userId || null,
      createdAt: new Date().toISOString()
    });

    return { success: true, version: newVersion };
  }
}
