// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ROLE_TEMPLATES } from '../../lib/permissions/roleTemplates';

// TD-1187: the product owner's decision ت۱۶ — the sales template writes its own daily work log, like the other
// operational templates, without managing other people's logs.
const salesTemplate = () => {
  const template = ROLE_TEMPLATES.find(t => t.code === 'sales_agent');
  if (!template) throw new Error('missing role template sales_agent');
  return template.permissions;
};

describe('sales_template_daily_logs_td_1187: the sales template keeps a daily work log', () => {
  it('views and records its own daily work log', () => {
    expect(salesTemplate()).toEqual(expect.arrayContaining(['daily_logs.view', 'daily_logs.create']));
  });
  it('does not manage the logs of others', () => {
    expect(salesTemplate()).not.toContain('daily_logs.manage_all');
  });
});
