import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { INBOX_ENTITY_TABS, UNKNOWN_ENTITY_TYPE_LABEL, workflowEntityTypeLabel } from '../../lib/workflow/workflowEntityLabels';

/** TD-1151: the approval inbox tabs are the entity types the server starts a workflow for */

function serverFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'tests' ? [] : serverFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

const startedEntityTypes = new Set(
  [...serverFiles('src/services'), ...serverFiles('src/routes')]
    .flatMap(f => [...readFileSync(f, 'utf8').matchAll(/maybeStartWorkflow\(\{[\s\S]{0,200}?entityType: '([a-z_]+)'/g)].map(m => m[1])),
);

describe('approval inbox entity tabs (TD-1151)', () => {
  const ids = INBOX_ENTITY_TABS.map(t => t.id).filter(id => id !== 'all');

  it('offers purchase requisitions', () => {
    expect(INBOX_ENTITY_TABS).toContainEqual({ id: 'purchase_requisition', label: 'درخواست خرید' });
  });

  it('has a tab for every entity type a workflow starts on, and only those or a known workflow entity', () => {
    for (const type of startedEntityTypes) expect(ids).toContain(type);
    for (const id of ids) expect(workflowEntityTypeLabel(id)).not.toBe(UNKNOWN_ENTITY_TYPE_LABEL);
    expect(ids).not.toContain('project');
  });

  it('is the list the inbox page renders', () => {
    const page = readFileSync('src/pages/ApprovalInboxPage.tsx', 'utf8');
    expect(page).toContain('INBOX_ENTITY_TABS.map');
  });
});
