// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ROLE_TEMPLATES } from '../../lib/permissions/roleTemplates';
import { WORKFLOW_WIDGET_PERMISSIONS } from '../../lib/recordReadPermissions';

// v10.0.89 (TD-1160): a sales document recorded as draft or proforma enters the approval workflow
// (`needsApprovalWorkflow`), so a template that records one also sees that workflow's step.
describe('role_template_workflow_view_td_1160: a template that records sales documents sees their workflow', () => {
  it('every template holding documents.create holds a workflow widget key', () => {
    const blind = ROLE_TEMPLATES
      .filter(t => t.permissions.includes('documents.create'))
      .filter(t => !t.permissions.some(p => (WORKFLOW_WIDGET_PERMISSIONS as readonly string[]).includes(p)))
      .map(t => t.code);
    expect(blind).toEqual([]);
  });
});
