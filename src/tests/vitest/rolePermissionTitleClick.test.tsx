/**
 * v9.0.221 (TD-536, B02-21): clicking a permission's title in the role form ticks it once. The label that wraps the
 * checkbox toggled on its own click and again on the click it passes to the checkbox, so a click on the title did nothing.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { RoleFormModal } from '../../components/users/RoleFormModal';
import { PERMISSION_CATALOG } from '../../lib/permissions/permissionCatalog';
import type { PermissionCategory } from '../../types';

const catalog = PERMISSION_CATALOG as unknown as PermissionCategory[];

function labelOf(key: string): HTMLLabelElement {
  const label = Array.from(document.querySelectorAll('label')).find(l => l.textContent?.includes(`(${key})`));
  if (!label) throw new Error(`no permission row for ${key}`);
  return label as HTMLLabelElement;
}
const box = (key: string) => labelOf(key).querySelector('input[type="checkbox"]') as HTMLInputElement;
const description = (key: string) => labelOf(key).querySelector('div > div:nth-child(2)') as HTMLElement;

afterEach(() => cleanup());

describe('role form permission title (TD-536)', () => {
  it('a click on the title or the description ticks and unticks the permission once', () => {
    render(<RoleFormModal isOpen onClose={() => {}} editingRole={null} permCatalog={catalog} onSuccess={() => {}} />);
    fireEvent.click(description('customers.view'));
    expect(box('customers.view').checked).toBe(true);
    fireEvent.click(description('customers.view'));
    expect(box('customers.view').checked).toBe(false);

    fireEvent.click(box('customers.view'));
    expect(box('customers.view').checked).toBe(true);
  });
});
