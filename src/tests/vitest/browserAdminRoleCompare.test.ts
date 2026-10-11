// @vitest-environment node
/**
 * TD-1164: the browser recognises the system admin through the server's `isAdmin` answer
 * (`isSystemAdminViewer` / `useIsSystemAdmin`, AGENTS.md §5), never by comparing the user's role code with
 * SYSTEM_ADMIN_ROLE. The list of files that still compare may only shrink.
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { describe, expect, it } from 'vitest';

const ROLE_COMPARE = /role\s*[!=]==?\s*SYSTEM_ADMIN_ROLE|SYSTEM_ADMIN_ROLE\s*[!=]==?\s*[\w.?]*role\b/;
const BROWSER_DIRS = ['src/pages', 'src/components', 'src/hooks', 'src/contexts'];
// files that still compare the role code; owned by another lane, remove when fixed
const KNOWN_ROLE_COMPARES = ['src/pages/CreateInvoicePage.tsx'];

function roleComparingFiles(): string[] {
  const files = execSync(`git ls-files ${BROWSER_DIRS.join(' ')}`, { encoding: 'utf8' })
    .split('\n').filter(f => /\.tsx?$/.test(f));
  return files.filter(f => ROLE_COMPARE.test(fs.readFileSync(path.join(process.cwd(), f), 'utf8'))).sort();
}

describe('browser_admin_role_compare_td_1164: the system admin comes from isAdmin, not a role code', () => {
  it('recognises a role comparison and leaves isAdmin checks alone', () => {
    expect(ROLE_COMPARE.test('canReactivate={currentUser.role === SYSTEM_ADMIN_ROLE}')).toBe(true);
    expect(ROLE_COMPARE.test('if (SYSTEM_ADMIN_ROLE !== user.role) return;')).toBe(true);
    expect(ROLE_COMPARE.test('canReactivate={isSystemAdmin}')).toBe(false);
    expect(ROLE_COMPARE.test('targetRole: SYSTEM_ADMIN_ROLE,')).toBe(false);
  });

  it('no browser file outside the shrinking list compares the role code', () => {
    expect(roleComparingFiles()).toEqual(KNOWN_ROLE_COMPARES);
  });

  it('the settings page offers warehouse reactivation from the system admin answer', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/pages/SettingsPage.tsx'), 'utf8');
    expect(source).toContain('canReactivate={isSystemAdmin}');
  });
});
