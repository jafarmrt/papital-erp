import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GlobalHeaderSearch from '../../components/GlobalHeaderSearch';
import { SearchProvider } from '../../SearchContext';

// TD-1170: a project hit in the global search names its status in Persian («برنامه‌ریزی‌شده»), never the stored code.

vi.mock('../../api', () => ({
  fetchJson: () => Promise.resolve({
    items: [], customers: [], documents: [],
    projects: [{ id: 7, project_code: 'P-7', title: 'سفارش گردنبند', customer_name: 'بوتیک رز', status: 'planned' }],
  }),
}));

afterEach(cleanup);

describe('global search project status (TD-1170)', () => {
  it('shows the Persian status label', async () => {
    render(<SearchProvider><MemoryRouter><GlobalHeaderSearch /></MemoryRouter></SearchProvider>);
    const input = screen.getByPlaceholderText(/جستجوی سراسری/);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'گردن' } });
    const line = await screen.findByText(/وضعیت:/, {}, { timeout: 2000 });
    expect(line.textContent).not.toContain('planned');
    expect(line.textContent).toContain('وضعیت: برنامه‌ریزی');
  });
});
