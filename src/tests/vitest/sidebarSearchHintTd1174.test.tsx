import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SidebarSearch } from '../../components/layout/SidebarSearch';

describe('Menu search shortcut hint (TD-1174)', () => {
  it('shows no Ctrl+K hint, since Ctrl+K opens the top-bar search', () => {
    const { container } = render(<SidebarSearch query="" onQueryChange={() => {}} totalResultsCount={0} />);
    expect(container.textContent).not.toContain('Ctrl+K');
    expect(container.querySelector('kbd')).toBeNull();
  });
});
