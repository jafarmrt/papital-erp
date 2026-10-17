import { describe, expect, it } from 'vitest';
import { buildConditionalConstraintsHealthTest, CONDITIONAL_CONSTRAINT_RULES } from '../../services/system/conditionalConstraints';

// review of #301: the health check's description named only the Sayad id, account code and document number among the
// unique keys it lists, while personnel code, national id (v10.1.57) and username (v10.1.61) are listed too
const UNIQUE_KEY_WORDS = ['شناسه صیاد', 'کد حساب', 'شماره سند', 'کد پرسنلی', 'کد ملی پرسنل', 'نام کاربری'];

describe('conditional_constraints_health_text_v10_1_66', () => {
  it('names every unique key the check lists', () => {
    expect(CONDITIONAL_CONSTRAINT_RULES.some(rule => rule.name === 'uq_users_username_key')).toBe(true);
    const test = buildConditionalConstraintsHealthTest([]);
    for (const word of UNIQUE_KEY_WORDS) expect(test.description).toContain(word);
  });
});
