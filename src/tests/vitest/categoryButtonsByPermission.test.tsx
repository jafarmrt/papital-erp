import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CategoriesTab } from '../../components/settings/CategoriesTab';
import type { Category } from '../../types';

// v10.0.41 (TD-1163): the categories tab opens with products.create, but editing needs products.edit and deleting
// products.delete; the row buttons used to show to every reader of the tab.
const granted = new Set<string>();
vi.mock('../../contexts/AuthContext', () => ({
  useHasPermission: (key: string) => granted.has(key),
}));

const categories = [{ id: 7, name: 'انگشتر', type: 'product', defaultUnit: 'عدد' }] as unknown as Category[];

function renderTab() {
  render(<CategoriesTab categories={categories} onOpenCreateModal={vi.fn()} onOpenEditModal={vi.fn()} onDeleteCategory={vi.fn()} />);
}

afterEach(() => {
  cleanup();
  granted.clear();
});

describe('category_buttons_by_permission_td_1163: category row buttons follow their route keys', () => {
  it('a products.create holder sees neither edit nor delete', () => {
    granted.add('products.create');
    renderTab();
    expect(screen.queryByTitle('ویرایش')).toBeNull();
    expect(screen.queryByTitle('حذف')).toBeNull();
  });

  it('edit shows with products.edit and delete with products.delete', () => {
    granted.add('products.edit');
    renderTab();
    expect(screen.getByTitle('ویرایش')).toBeTruthy();
    expect(screen.queryByTitle('حذف')).toBeNull();
    cleanup();
    granted.clear();
    granted.add('products.delete');
    renderTab();
    expect(screen.queryByTitle('ویرایش')).toBeNull();
    expect(screen.getByTitle('حذف')).toBeTruthy();
  });
});
