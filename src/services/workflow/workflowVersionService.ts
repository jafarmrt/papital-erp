import { orm } from '../../db/drizzle.js';
import { workflowDefinitionVersions } from '../../db/schema.js';
import { NotFoundError } from '../../errors/customErrors.js';
import { eq, and, desc } from 'drizzle-orm';
import { WorkflowVersionDTO } from './contracts/workflowDomainContracts.js';

/**
 * v7.0.87 (TD-112): تاریخچه نسخه‌های تعریف ورکفلو فقط‌خواندنی است. نسخه‌ها در هر ذخیره تعریف ثبت می‌شوند
 * (recordDefinitionVersion در workflowSnapshot.ts)؛ انتشار دستی و بازگردانی حذف شدند.
 */
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
      throw new NotFoundError(`نسخه شماره ${versionNumber} برای این فرآیند کاری یافت نشد`, undefined, 'WF_VER_NOT_FOUND');
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
}
