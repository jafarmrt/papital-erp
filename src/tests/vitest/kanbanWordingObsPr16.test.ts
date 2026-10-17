// @vitest-environment node
/**
 * v10.1.63 (OBS-PR-16, decision ت۴۰ item 16): the transliteration «کانبان» is banned on every screen, not only in the CRM
 * files of package 9; the projects page's view switch says «نمای ستونی». The UI wording ratchet counts it like its other
 * words, so no file may gain one. Red on v10.1.62, where the ratchet did not know the word and the page showed it.
 */
import fs from 'fs';
import { describe, expect, it } from 'vitest';
import { countFileSites } from '../../../scripts/ui-wording-ratchet';

// built from code points so that this file holds none of the words
const KANBAN = String.fromCodePoint(0x6a9, 0x627, 0x646, 0x628, 0x627, 0x646);
const BOARD = String.fromCodePoint(0x62a, 0x62e, 0x62a, 0x647);
const COLUMN_VIEW = 'نمای ستونی';

describe('kanban_wording_obs_pr_16', () => {
  it('the UI wording ratchet counts the word, alone and in a phrase', () => {
    expect(countFileSites(`const a = '${BOARD} ${KANBAN}';`, 'a.ts')).toBe(1);
    expect(countFileSites(`const A = () => <span>${KANBAN}</span>;`, 'a.tsx')).toBe(1);
    expect(countFileSites(`// ${KANBAN} in a comment\nconst a = 1;`, 'a.ts')).toBe(0);
  });

  it('the projects page names its view as columns', () => {
    const page = fs.readFileSync('src/pages/ProjectsPage.tsx', 'utf8');
    expect(countFileSites(page, 'ProjectsPage.tsx')).toBe(0);
    expect(page).toContain(COLUMN_VIEW);
  });
});
