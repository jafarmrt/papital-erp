import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

// v9.0.309 (TD-680، B16-16): مقدار ازپیش‌انتخاب‌شده با fetchUrl برچسب دارد و درخواست یک limit دارد
const requested: string[] = [];
vi.mock('../../api', async (original) => ({
  ...(await original<typeof import('../../api')>()),
  fetchJson: vi.fn(async (url: string) => {
    requested.push(url);
    return { data: [{ id: 7, name: 'بازرگانی آرین' }, { id: 8, name: 'نگین' }] };
  }),
}));

const { SearchableSelect } = await import('../../components/SearchableSelect');
afterEach(() => { cleanup(); requested.length = 0; });

const map = (c: { id: number; name: string }) => ({ value: String(c.id), label: c.name });

describe('searchable select with a preselected value (TD-680)', () => {
  it('shows the label of a preselected value from the fetched options', async () => {
    render(<SearchableSelect value="7" onChange={() => undefined} fetchUrl="/customers/options?limit=1000" mapResultToOption={map} />);
    await waitFor(() => expect(screen.getByRole('button').textContent).toBe('بازرگانی آرین'));
    const url = new URL(requested[0], 'http://x');
    expect(url.searchParams.getAll('limit')).toEqual(['50']);
  });

  it('shows the given value label before the value is in the fetched options', () => {
    render(<SearchableSelect value="99" valueLabel="خریدار از پیش‌نویس" onChange={() => undefined} fetchUrl="/customers/options" mapResultToOption={map} />);
    expect(screen.getByRole('button').textContent).toBe('خریدار از پیش‌نویس');
  });
});
