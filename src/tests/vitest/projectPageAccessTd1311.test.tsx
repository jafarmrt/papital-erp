import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { canOpenPage } from '../../lib/permissions/pageAccess';
import { ProtectedRoute } from '../../components/auth/ProtectedRoute';
import type { User } from '../../types';

afterEach(() => cleanup());

describe('project page access (10.2 package 10, TD-1311)', () => {
  const viewer = (permissions: string[]) => ({ permissions, isAdmin: false });

  it('opens the project page to holders of projects.view, by its route key and by a real address', () => {
    for (const path of ['/projects/:projectId/:tab?', '/projects/7', '/projects/7/progress']) {
      expect(canOpenPage(path, viewer(['projects.view'])), path).toBe(true);
      expect(canOpenPage(path, viewer(['warehouse.view'])), path).toBe(false);
    }
    expect(canOpenPage('/projects/7/progress/extra', viewer(['projects.view']))).toBe(false);
    expect(canOpenPage('/media-library/products/12', viewer(['media.view']))).toBe(true);
    expect(canOpenPage('/media-library/products/12', viewer(['products.view']))).toBe(false);
    expect(canOpenPage('/media-library/products/:itemId', viewer(['media.view']))).toBe(true);
    expect(canOpenPage('/media-library/products/:itemId', viewer(['products.view']))).toBe(false);
  });

  it('gives an address of odd shape no rule, so only the system admin passes (delta N1)', () => {
    const odd = [
      '//projects/7', 'projects/7', '/projects//7', '/projects/../users', '/projects/./7', '/projects/%2e%2e',
      '/projects/7%2Fsettings', '/projects/7\\settings', '//media-library/products/12', '/media-library/products/%2e%2e',
    ];
    for (const path of odd) {
      expect(canOpenPage(path, viewer(['projects.view', 'media.view'])), path).toBe(false);
      expect(canOpenPage(path, { permissions: [], isAdmin: true }), path).toBe(true);
    }
    expect(canOpenPage('/projects/7/', viewer(['projects.view']))).toBe(true);
  });

  it('lets a production manager through the route guard of the project page', () => {
    const user = { id: 2, username: 'manager', role: 'production_manager' } as unknown as User;
    const page = (permissions: string[]) => render(
      <MemoryRouter>
        <ProtectedRoute page="/projects/:projectId/:tab?" userPermissions={{ permissions, isAdmin: false }} permissionsLoaded user={user}>
          <p>صفحه پروژه</p>
        </ProtectedRoute>
      </MemoryRouter>,
    );
    page(['projects.view']);
    expect(screen.getByText('صفحه پروژه')).toBeTruthy();
    cleanup();
    page(['warehouse.view']);
    expect(screen.queryByText('صفحه پروژه')).toBeNull();
  });
});
