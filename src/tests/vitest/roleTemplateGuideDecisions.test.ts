// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ROLE_TEMPLATES } from '../../lib/permissions/roleTemplates';

// v10.0.39 (TD-1181): the product owner's guide decisions ت۱ (the warehouse keeper receives purchased goods)
// and ت۳ (the seller sends its pre-invoice for approval, the workshop operator picks projects, the production
// manager no longer approves raw material requests).
const permissionsOf = (code: string): readonly string[] => {
  const template = ROLE_TEMPLATES.find(t => t.code === code);
  if (!template) throw new Error(`missing role template ${code}`);
  return template.permissions;
};

describe('role_template_guide_decisions_td_1181: role templates follow the guide decisions', () => {
  it('the warehouse keeper sees and delivers procurement orders', () => {
    expect(permissionsOf('warehouse_keeper')).toEqual(expect.arrayContaining(['procurement.view', 'procurement.manage']));
  });
  it('the buyer does not receive goods into stock', () => {
    expect(permissionsOf('procurement_officer')).not.toContain('warehouse.in');
  });
  it('the seller edits and sends its documents through the workflow', () => {
    expect(permissionsOf('sales_agent')).toEqual(expect.arrayContaining(['documents.edit', 'workflow.execute']));
  });
  it('the workshop operator reads projects', () => {
    expect(permissionsOf('workshop_operator')).toContain('projects.view');
  });
  it('the production manager does not approve raw material requests', () => {
    expect(permissionsOf('production_manager')).not.toContain('pending_materials.approve');
  });
});
