import { and, asc, eq, inArray, max } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import {
  workflowDefinitions,
  workflowDefinitionVersions,
  workflowStates,
  workflowTransitions,
} from '../../db/schema.js';
import type { WorkflowSnapshotDsl, WorkflowTransitionSnapshot } from './workflowTransitionExecutor.js';
import type { WorkflowVersionStatus } from '../../lib/workflow/workflowVersionDiff.js';

type DbClient = typeof orm | Parameters<Parameters<typeof orm.transaction>[0]>[0];

/**
 * v7.0.87 (TD-112): نسخه‌های تعریف ورکفلو.
 * هر ذخیره تعریف (طراح یا seed) یک ردیف workflow_definition_versions با تصویر کامل وضعیت‌ها و انتقال‌های همان لحظه
 * (با شناسه‌های پایگاه‌داده) ثبت می‌کند و workflow_definitions.version را جلو می‌برد. فرایند در جریان با تصویر نسخه خودش
 * ادامه می‌دهد. v10.1.17 (TD-1270, D-06 part D, decision ت۱۰): a save of an existing definition is a draft; new records
 * start with the published version (`published_version`) until it is published or another version is reverted to.
 */


const isPositiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;

/**
 * تصویری که با شناسه‌های پایگاه‌داده ساخته نشده (ردیف نسخه ۱ قدیمی که payload خام طراح را با کلید وضعیت نگه می‌داشت)
 * قابل استفاده نیست: هیچ انتقالی از آن با وضعیت جاری فرایند جور درنمی‌آید و فرایند گیر می‌کند.
 */
export function isUsableSnapshot(snapshot: WorkflowSnapshotDsl | null | undefined): snapshot is WorkflowSnapshotDsl {
  if (!snapshot || !Array.isArray(snapshot.states) || !Array.isArray(snapshot.transitions)) return false;
  if (snapshot.states.length === 0 || !snapshot.states.every((s) => isPositiveInt(s?.id))) return false;
  return snapshot.transitions.every((t) => isPositiveInt(t?.id) && isPositiveInt(t?.fromStateId) && isPositiveInt(t?.toStateId));
}

/** انتقال‌های تصویر فرایند، یا undefined وقتی تصویر قابل استفاده نیست (آنگاه جدول‌های جاری خوانده می‌شوند). */
export function snapshotTransitionsOf(snapshot: unknown): WorkflowTransitionSnapshot[] | undefined {
  const dsl = snapshot as WorkflowSnapshotDsl | null | undefined;
  return isUsableSnapshot(dsl) ? dsl.transitions : undefined;
}

/**
 * v9.0.444 (TD-612, B01-32): step id → title in an instance's snapshot (empty when the snapshot is not usable). History rows
 * and the instance hold the step ids of their own snapshot, which a later design save removes from the live table.
 */
export function snapshotStateTitles(snapshot: unknown): Map<number, string> {
  const dsl = snapshot as WorkflowSnapshotDsl | null | undefined;
  if (!isUsableSnapshot(dsl)) return new Map();
  return new Map(dsl.states!.filter(s => typeof s.title === 'string' && s.title.trim() !== '').map(s => [s.id, String(s.title)]));
}

/** تصویر کامل تعریف از جدول‌های جاری وضعیت و انتقال. */
export async function buildDefinitionSnapshot(tx: DbClient, definitionId: number, version: number): Promise<WorkflowSnapshotDsl> {
  const [def] = await tx.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, definitionId));
  const states = await tx.select().from(workflowStates)
    .where(eq(workflowStates.workflowDefinitionId, definitionId)).orderBy(asc(workflowStates.id));
  const transitions = await tx.select().from(workflowTransitions)
    .where(eq(workflowTransitions.workflowDefinitionId, definitionId)).orderBy(asc(workflowTransitions.id));
  return {
    definitionId,
    code: def?.code,
    title: def?.title,
    entityType: def?.entityType,
    version,
    states,
    transitions,
    publishedAt: new Date().toISOString(),
  };
}

/**
 * نسخه تازه پس از ذخیره تعریف: شماره بعدی، تصویر جدول‌ها و به‌روزرسانی نسخه جاری تعریف (داخل همان تراکنش ذخیره).
 * v9.0.51 (TD-461): شماره زیر قفل ردیف تعریف حساب می‌شود و شاخص یکتای `uq_wdv_definition_version` (مهاجرت 0059)
 * پشتوانه است. قفل `FOR NO KEY UPDATE` است تا با قفل کلید خارجی شروع فرایند (`FOR KEY SHARE`) تداخل نکند.
 */
export async function recordDefinitionVersion(
  tx: DbClient,
  definitionId: number,
  options: { title: string; description: string; userId?: number | null; status: Exclude<WorkflowVersionStatus, 'retired'> },
): Promise<number> {
  const [def] = await tx.select({ version: workflowDefinitions.version })
    .from(workflowDefinitions).where(eq(workflowDefinitions.id, definitionId)).for('no key update');
  const [maxRow] = await tx.select({ v: max(workflowDefinitionVersions.version) })
    .from(workflowDefinitionVersions).where(eq(workflowDefinitionVersions.definitionId, definitionId));
  const lastVersion = Math.max(Number(def?.version) || 0, Number(maxRow?.v) || 0);
  const version = lastVersion + 1;
  const snapshot = await buildDefinitionSnapshot(tx, definitionId, version);
  // v10.1.17 (TD-1270): a new draft retires the older draft; publishing retires the older draft and published versions
  const superseded: WorkflowVersionStatus[] = options.status === 'published' ? ['draft', 'published'] : ['draft'];
  await tx.update(workflowDefinitionVersions).set({ status: 'retired' }).where(and(
    eq(workflowDefinitionVersions.definitionId, definitionId),
    inArray(workflowDefinitionVersions.status, superseded),
  ));
  await tx.insert(workflowDefinitionVersions).values({
    definitionId,
    version,
    title: options.title,
    description: options.description,
    dslJson: snapshot,
    createdBy: options.userId ?? null,
    createdAt: new Date().toISOString(),
    status: options.status,
  });
  await tx.update(workflowDefinitions)
    .set(options.status === 'published' ? { version, publishedVersion: version } : { version })
    .where(eq(workflowDefinitions.id, definitionId));
  return version;
}

/** The published version's number: `published_version`, else (a definition from before migration 0113) its version. */
export function publishedVersionOf(def: { version?: number | null; publishedVersion?: number | null }): number {
  return Number(def.publishedVersion) || Number(def.version) || 1;
}

/** The stored snapshot of a definition version, when it is usable (database ids). */
export async function storedVersionSnapshot(tx: DbClient, definitionId: number, version: number): Promise<WorkflowSnapshotDsl | null> {
  const [row] = await tx.select({ dslJson: workflowDefinitionVersions.dslJson }).from(workflowDefinitionVersions)
    .where(and(eq(workflowDefinitionVersions.definitionId, definitionId), eq(workflowDefinitionVersions.version, version)));
  const snapshot = row?.dslJson as WorkflowSnapshotDsl | null | undefined;
  return isUsableSnapshot(snapshot) ? snapshot : null;
}

/**
 * v10.1.17 (TD-1270): called by a draft save before it rewrites the step tables. While a definition has no draft its step
 * tables are its published design; when the published version has no usable snapshot (a version 1 row from before
 * v7.0.87, or none) the tables are recorded first as a new published version, so new records never start with the draft.
 */
export async function ensurePublishedSnapshot(tx: DbClient, definitionId: number, options: { title: string; userId?: number | null }): Promise<void> {
  const [def] = await tx.select({ version: workflowDefinitions.version, publishedVersion: workflowDefinitions.publishedVersion })
    .from(workflowDefinitions).where(eq(workflowDefinitions.id, definitionId)).for('no key update');
  if (!def) return;
  const published = publishedVersionOf(def);
  if (await storedVersionSnapshot(tx, definitionId, published)) return;
  if (published !== (Number(def.version) || 0) && Number(def.version) > 0) return;
  await recordDefinitionVersion(tx, definitionId, {
    title: options.title, description: 'تصویر نسخه منتشرشده پیش از نخستین پیش‌نویس', userId: options.userId, status: 'published',
  });
}

/** The published design: its stored snapshot, else (no draft, so the tables are the published design) the step tables. */
export async function publishedDesignOf(tx: DbClient, definitionId: number): Promise<WorkflowSnapshotDsl | null> {
  const [def] = await tx.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, definitionId));
  if (!def) return null;
  const published = publishedVersionOf(def);
  const stored = await storedVersionSnapshot(tx, definitionId, published);
  if (stored) return stored;
  return published === (Number(def.version) || published) ? buildDefinitionSnapshot(tx, definitionId, published) : null;
}
