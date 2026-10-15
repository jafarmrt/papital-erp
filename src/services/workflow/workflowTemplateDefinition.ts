import type { Request } from 'express';
import { inArray } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { workflowDefinitions } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { workflowTemplateById } from '../../lib/workflow/workflowTemplates.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import { WorkflowDefinitionService } from './workflowDefinitionService.js';

/** Codes tried for a template definition: its base code, then `_2` … `_50` */
const MAX_TEMPLATE_COPIES = 50;

async function freeTemplateCode(base: string): Promise<{ code: string; copy: number }> {
  const candidates = Array.from({ length: MAX_TEMPLATE_COPIES }, (_, i) => (i === 0 ? base : `${base}_${i + 1}`));
  const taken = new Set((await orm.select({ code: workflowDefinitions.code }).from(workflowDefinitions)
    .where(inArray(workflowDefinitions.code, candidates))).map(r => r.code));
  const index = candidates.findIndex(c => !taken.has(c));
  if (index < 0) {
    throw new ValidationError(`از این الگو پیش‌تر ${toPersianDigits(MAX_TEMPLATE_COPIES)} گردش کار ساخته شده است؛ یکی از آن‌ها را ویرایش کنید.`, undefined, 'WF_TEMPLATE_COPIES_EXHAUSTED');
  }
  return { code: candidates[index], copy: index + 1 };
}

/**
 * v10.1.11 (TD-1263, D-06 part B, decisions ت۴ / ت۵): «ساخت از الگو» makes an inactive definition from a ready-made
 * template; the design save writes its version and audit row (with the template id) in one transaction. The new
 * definition never changes an existing one and never starts records until the user turns it on (part A).
 */
export async function makeDefinitionFromTemplate(params: { templateId: string; userId?: number; req?: Request }) {
  const template = workflowTemplateById(params.templateId);
  if (!template) throw new ValidationError('این الگوی گردش کار شناخته نیست.', undefined, 'WF_TEMPLATE_UNKNOWN');
  const { code, copy } = await freeTemplateCode(template.code);
  return WorkflowDefinitionService.saveWorkflowDefinition({
    code,
    title: copy > 1 ? `${template.title} (${toPersianDigits(copy)})` : template.title,
    entityType: template.entityType,
    description: template.description,
    version: 1,
    states: template.states.map(st => ({ ...st })),
    transitions: template.transitions.map(tr => ({ ...tr })),
    userId: params.userId,
    startInactive: true,
    fromTemplate: template.id,
  }, params.req);
}
