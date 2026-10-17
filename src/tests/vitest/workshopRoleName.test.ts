import { describe, expect, it } from 'vitest';
import { ROLE_TEMPLATES } from '../../lib/permissions/roleTemplates';

const WORKSHOP_ROLE_NAME = 'همکار کارگاه';
const OLD_WORKSHOP_ROLE_NAME = 'کارکن کارگاه';

describe('workshop role template name', () => {
  it('names the workshop_worker template with the product owner wording', () => {
    const template = ROLE_TEMPLATES.find(t => t.code === 'workshop_worker');
    expect(template?.name).toBe(WORKSHOP_ROLE_NAME);
    expect(ROLE_TEMPLATES.some(t => t.name === OLD_WORKSHOP_ROLE_NAME)).toBe(false);
  });
});
