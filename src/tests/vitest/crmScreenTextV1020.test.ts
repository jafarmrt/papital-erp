/**
 * v10.2.0: the «فروش موفق» message promised a proforma notice to the warehouse that is never sent; the seller and
 * follow-up pickers showed only personnel whose status was exactly «فعال»; an older English activity result
 * («positive») was shown as is in the lead drawer.
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { WON_LEAD_MESSAGE, activityResultLabel, crmAssignablePersonnel } from '../../lib/crm/crmScreenText';

const WAREHOUSE = 'انبار';
const ACTIVE = 'فعال';
const ON_LEAVE = 'مرخصی';
const LEFT = 'قطع همکاری';
const POSITIVE_FA = 'مثبت';
const FREE_TEXT = 'پاسخ داد و توافق شد';

const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');

describe('crm_screen_text_v10_2_0', () => {
  it('the won message names no warehouse notice, and the lead screens use it', () => {
    expect(WON_LEAD_MESSAGE).not.toContain(WAREHOUSE);
    const hook = read('src/hooks/useCRMData.ts');
    expect(hook).not.toContain('واحد انبار');
    expect(hook.match(/toast\.success\(WON_LEAD_MESSAGE/g)?.length).toBe(2);
  });

  it('every personnel but one who left can be picked', () => {
    const people = [
      { id: 1, employmentStatus: ACTIVE },
      { id: 2, employmentStatus: ` ${ACTIVE} ` },
      { id: 3, employmentStatus: ON_LEAVE },
      { id: 4, employmentStatus: null },
      { id: 5, employmentStatus: LEFT },
      { id: 6, employmentStatus: ` ${LEFT}` },
    ];
    expect(crmAssignablePersonnel(people).map(p => p.id)).toEqual([1, 2, 3, 4]);
    expect(read('src/hooks/useCRMData.ts')).toContain('crmAssignablePersonnel(personnelQuery.data');
  });

  it('an older English result is shown in Persian, free text as written', () => {
    expect(activityResultLabel('positive')).toBe(POSITIVE_FA);
    expect(activityResultLabel(' Positive ')).toBe(POSITIVE_FA);
    expect(activityResultLabel(FREE_TEXT)).toBe(FREE_TEXT);
    expect(activityResultLabel(null)).toBe('');
    for (const file of ['src/components/crm/CRMLeadDrawer.tsx', 'src/components/crm/CRMFollowupsView.tsx', 'src/components/crm/CustomerDossierDrawer.tsx']) {
      const source = read(file);
      expect(source, file).toContain('activityResultLabel(act.result)');
      expect(source, file).not.toMatch(/[{ ]act\.result( \|\||\})/);
    }
  });
});
