import type { DbExecutor } from '../../db/drizzle.js';
import { logActivity } from '../../lib/auditLogger.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import type { ProjectBomAllocationRecord } from './bomAllocationRecord.js';

/**
 * TD-943 (P5-M10, OBS-R2-07): the audit rows of a project material allocation, its consumption and its release are written
 * with the allocation's own `tx`, so a refused audit row refuses the change and a rolled-back change leaves no row. Before,
 * the routes wrote them after the commit.
 */
export const BOM_ALLOCATION_AUDIT_ENTITY = 'تخصیص مواد BOM پروژه';
export const BOM_RELEASE_AUDIT_ENTITY = 'آزادسازی تخصیص BOM';

/** The request (user and IP address) or the user of a service caller, for the audit row */
export interface BomAllocationAuditActor {
  req?: unknown;
  userId?: number;
  username?: string;
}

const actorFields = (actor: BomAllocationAuditActor) => ({ req: actor.req, userId: actor.userId, username: actor.username });

export async function logBomAllocation(
  tx: DbExecutor,
  actor: BomAllocationAuditActor,
  projectId: number,
  result: { allocatedCount: number; allocations: ProjectBomAllocationRecord[] },
): Promise<void> {
  await logActivity({
    tx,
    ...actorFields(actor),
    action: 'CREATE',
    entity: BOM_ALLOCATION_AUDIT_ENTITY,
    entityId: String(projectId),
    description: `تخصیص ${toPersianDigits(result.allocatedCount)} قلم مواد اولیه به پروژه شناسه ${toPersianDigits(projectId)}`,
    details: result,
  });
}

export async function logBomConsumption(tx: DbExecutor, actor: BomAllocationAuditActor, record: ProjectBomAllocationRecord): Promise<void> {
  await logActivity({
    tx,
    ...actorFields(actor),
    action: 'UPDATE',
    entity: BOM_ALLOCATION_AUDIT_ENTITY,
    entityId: String(record.id),
    description: `مصرف قطعی تخصیص شماره ${toPersianDigits(record.id)} برای پروژه ${record.projectCode} (کالا: ${record.itemName})`,
    details: record,
  });
}

export async function logBomRelease(tx: DbExecutor, actor: BomAllocationAuditActor, record: ProjectBomAllocationRecord): Promise<void> {
  await logActivity({
    tx,
    ...actorFields(actor),
    action: 'UPDATE',
    entity: BOM_RELEASE_AUDIT_ENTITY,
    entityId: String(record.id),
    description: `آزادسازی و عودت ${toPersianDigits(record.quantity)} واحد از کالا ${record.itemName} به انبار ${record.sourceLocation} بابت پروژه ${record.projectCode}`,
    details: record,
  });
}
