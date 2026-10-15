import { and, desc, eq } from 'drizzle-orm';
import type { Request } from 'express';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { workflowDefinitions, workflowDefinitionVersions } from '../../db/schema.js';
import { logActivity } from '../../lib/auditLogger.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { workflowDesignErrors } from '../../lib/workflow/workflowDesignRules.js';
import { workflowEntityTypeLabel } from '../../lib/workflow/workflowEntityLabels.js';
import { workflowVersionDiff, type WorkflowVersionDiff } from '../../lib/workflow/workflowVersionDiff.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import { lockDefinition } from './workflowDefinitionLifecycle.js';
import { writeDesignTables } from './workflowDesignTables.js';
import { isUsableSnapshot, publishedDesignOf, publishedVersionOf, recordDefinitionVersion } from './workflowSnapshot.js';
import { resolveTransitionRoles } from './transitionRoles.js';
import type { WorkflowSnapshotDsl } from './workflowTransitionExecutor.js';

/**
 * v10.1.17 (TD-1270, D-06 part D, decision ت۱۰): a design save of an existing definition records a draft; new records start
 * with the published version. The system admin (`workflow.admin`, decision ت۴) publishes the draft or reverts to an earlier
 * version, which is published as a new version: history is never rewritten. Both run in one transaction under the record
 * type lock and the definition row lock, with their audit row written with the same `tx`. Running records keep their own
 * version's snapshot whatever happens here.
 */

type VersionRow = typeof workflowDefinitionVersions.$inferSelect;

/** the same entity name as the lifecycle switches (`WORKFLOW_DEFINITION_AUDIT_ENTITY`), written here as a literal for the audit scan */
const AUDIT_ENTITY = 'طرح گردش کار';

const n = (value: number) => toPersianDigits(String(value));

async function draftRow(db: DbExecutor, definitionId: number): Promise<VersionRow | undefined> {
  const [row] = await db.select().from(workflowDefinitionVersions)
    .where(and(eq(workflowDefinitionVersions.definitionId, definitionId), eq(workflowDefinitionVersions.status, 'draft')))
    .orderBy(desc(workflowDefinitionVersions.version)).limit(1);
  return row;
}

/** The save rules and the role list, applied again to a stored design before it reaches new records. */
async function assertRunnableDesign(tx: DbExecutor, design: WorkflowSnapshotDsl, what: string): Promise<void> {
  const states = (design.states ?? []).map(s => ({ id: s.id, stateKey: s.stateKey, title: s.title, stateType: s.stateType ?? undefined }));
  const errors = workflowDesignErrors(states, design.transitions ?? []);
  if (errors.length > 0) throw new ValidationError(`${what} منتشر نشد: ${errors.join(' ')}`, { errors }, 'WF_VERSION_DESIGN_INVALID');
  await resolveTransitionRoles(tx, design.transitions ?? []);
}

export interface WorkflowDraftState {
  definitionId: number;
  publishedVersion: number;
  /** null when the definition has no unpublished draft */
  draftVersion: number | null;
  diff: WorkflowVersionDiff | null;
}

/** The unpublished draft of a definition and what it changes against the published version. */
export async function getWorkflowDraftState(definitionId: number): Promise<WorkflowDraftState> {
  const [def] = await orm.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, definitionId));
  if (!def) throw new NotFoundError('گردش کار یافت نشد.', undefined, 'WF_DEF_NOT_FOUND');
  const publishedVersion = publishedVersionOf(def);
  const draft = await draftRow(orm, definitionId);
  if (!draft) return { definitionId, publishedVersion, draftVersion: null, diff: null };
  const published = await publishedDesignOf(orm, definitionId);
  const draftDesign = draft.dslJson as WorkflowSnapshotDsl;
  return {
    definitionId, publishedVersion, draftVersion: draft.version,
    diff: workflowVersionDiff(published ?? {}, draftDesign ?? {}),
  };
}

export interface WorkflowPublishResult {
  definitionId: number;
  publishedVersion: number;
  previousPublishedVersion: number;
}

/**
 * Publishes the definition's draft. `draftVersion` is the draft the admin looked at: a draft saved again meanwhile is
 * 409 WF_DRAFT_CHANGED, no draft 409 WF_NO_DRAFT, and a draft that breaks the save rules (or names a deleted role) 422.
 */
export async function publishWorkflowDraft(params: { id: number; draftVersion: number; userId?: number | null; req?: Request }): Promise<WorkflowPublishResult> {
  return orm.transaction(async (tx) => {
    const def = await lockDefinition(tx, params.id);
    const draft = await draftRow(tx, def.id);
    if (!draft) throw new ConflictError(`گردش کار «${def.title}» پیش‌نویس منتشرنشده‌ای ندارد.`, undefined, 'WF_NO_DRAFT');
    if (draft.version !== params.draftVersion) {
      throw new ConflictError(`پیش‌نویس «${def.title}» پس از باز شدن این پنجره دوباره ذخیره شده (نسخه ${n(draft.version)})؛ دوباره باز کنید.`, undefined, 'WF_DRAFT_CHANGED');
    }
    const design = draft.dslJson as WorkflowSnapshotDsl;
    if (!isUsableSnapshot(design)) throw new ValidationError('پیش‌نویس تصویر قابل اجرا ندارد؛ طرح را دوباره ذخیره کنید.', undefined, 'WF_VERSION_DESIGN_INVALID');
    if (design.entityType && design.entityType !== def.entityType) {
      throw new ValidationError(`پیش‌نویس برای «${workflowEntityTypeLabel(design.entityType)}» است؛ طرح را دوباره ذخیره کنید.`, undefined, 'WF_VERSION_DESIGN_INVALID');
    }
    await assertRunnableDesign(tx, design, `پیش‌نویس نسخه ${n(draft.version)}`);

    const previousPublishedVersion = publishedVersionOf(def);
    const published = await publishedDesignOf(tx, def.id);
    await tx.update(workflowDefinitionVersions).set({ status: 'retired' }).where(and(
      eq(workflowDefinitionVersions.definitionId, def.id), eq(workflowDefinitionVersions.status, 'published'),
    ));
    await tx.update(workflowDefinitionVersions).set({ status: 'published' }).where(eq(workflowDefinitionVersions.id, draft.id));
    await tx.update(workflowDefinitions).set({ publishedVersion: draft.version }).where(eq(workflowDefinitions.id, def.id));
    const diff = workflowVersionDiff(published ?? {}, design);
    await logActivity({
      tx, req: params.req, userId: params.userId ?? undefined, action: 'UPDATE', entity: AUDIT_ENTITY, entityId: def.id,
      description: `انتشار نسخه ${n(draft.version)} گردش کار «${def.title}» (به جای نسخه ${n(previousPublishedVersion)})`,
      details: { code: def.code, operation: 'publish', publishedVersion: draft.version, previousPublishedVersion, diff },
    });
    return { definitionId: def.id, publishedVersion: draft.version, previousPublishedVersion };
  });
}

export interface WorkflowRevertResult extends WorkflowPublishResult {
  revertedFrom: number;
  /** the draft that the revert set aside, if there was one */
  discardedDraftVersion: number | null;
}

/**
 * Reverts a definition to an earlier version: its snapshot becomes the design (new step ids) and is published as a new
 * version, setting aside any unpublished draft. A version without a usable snapshot, of another record type, against the
 * save rules or with a deleted role is 422; the published version itself, with no draft, is 409 WF_VERSION_ALREADY_PUBLISHED.
 */
export async function revertWorkflowToVersion(params: { id: number; version: number; userId?: number | null; req?: Request }): Promise<WorkflowRevertResult> {
  return orm.transaction(async (tx) => {
    const def = await lockDefinition(tx, params.id);
    const [row] = await tx.select().from(workflowDefinitionVersions).where(and(
      eq(workflowDefinitionVersions.definitionId, def.id), eq(workflowDefinitionVersions.version, params.version),
    ));
    if (!row) throw new NotFoundError(`نسخه ${n(params.version)} برای این گردش کار یافت نشد.`, undefined, 'WF_VER_NOT_FOUND');
    const draft = await draftRow(tx, def.id);
    const previousPublishedVersion = publishedVersionOf(def);
    if (params.version === previousPublishedVersion && !draft) {
      throw new ConflictError(`نسخه ${n(params.version)} همین حالا نسخه منتشرشده است.`, undefined, 'WF_VERSION_ALREADY_PUBLISHED');
    }
    const snapshot = row.dslJson as WorkflowSnapshotDsl;
    if (!isUsableSnapshot(snapshot)) {
      throw new ValidationError(`نسخه ${n(params.version)} پیش از ثبت کامل نسخه‌ها ذخیره شده و برگرداندنی نیست.`, undefined, 'WF_VERSION_NOT_RESTORABLE');
    }
    if (snapshot.entityType && snapshot.entityType !== def.entityType) {
      throw new ValidationError(`نسخه ${n(params.version)} برای «${workflowEntityTypeLabel(snapshot.entityType)}» است و روی «${workflowEntityTypeLabel(def.entityType)}» برنمی‌گردد.`, undefined, 'WF_VERSION_NOT_RESTORABLE');
    }
    await assertRunnableDesign(tx, snapshot, `نسخه ${n(params.version)}`);
    const knownRoles = await resolveTransitionRoles(tx, snapshot.transitions ?? []);

    const before = await publishedDesignOf(tx, def.id);
    await writeDesignTables(
      tx, def.id,
      (snapshot.states ?? []).map(s => ({ ...s, title: s.title, stateType: s.stateType ?? undefined })),
      (snapshot.transitions ?? []).map(t => ({ ...t })),
      knownRoles,
    );
    const version = await recordDefinitionVersion(tx, def.id, {
      title: def.title, description: `برگرداندن به نسخه ${n(params.version)}`, userId: params.userId, status: 'published',
    });
    await logActivity({
      tx, req: params.req, userId: params.userId ?? undefined, action: 'UPDATE', entity: AUDIT_ENTITY, entityId: def.id,
      description: `برگرداندن گردش کار «${def.title}» به نسخه ${n(params.version)}؛ نسخه ${n(version)} منتشر شد`,
      details: {
        code: def.code, operation: 'revert', revertedFrom: params.version, publishedVersion: version, previousPublishedVersion,
        discardedDraftVersion: draft?.version ?? null, diff: workflowVersionDiff(before ?? {}, snapshot),
      },
    });
    return {
      definitionId: def.id, publishedVersion: version, previousPublishedVersion,
      revertedFrom: params.version, discardedDraftVersion: draft?.version ?? null,
    };
  });
}
