import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  CUSTOMER_TAG_NAME_MAX, customerTagNameError, customerTagNameKey, tagColorClass,
} from '../../lib/customers/customerTags';
import { tagRowsOf } from '../../hooks/queries/useCustomerTagQueries';
import { buildLeadQueryParams } from '../../hooks/useCRMFilters';
import { CustomerTagChips, CustomerTagFilter, CustomerTagPicker } from '../../components/customers/CustomerTags';
import { CustomerTagsWindow } from '../../components/customers/CustomerTagsWindow';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
const confirmAction = vi.fn();
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: (...args: unknown[]) => confirmAction(...args) }));

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
  confirmAction.mockReset();
});

const TAGS = [
  { id: 1, name: 'عمده‌فروش', color: 'emerald' as const },
  { id: 2, name: 'مغازه', color: 'amber' as const },
];

describe('customer tag rules (N-02 part 3)', () => {
  it('checks the name the way the server does', () => {
    expect(customerTagNameError('   ')).toBeTruthy();
    expect(customerTagNameError('x'.repeat(CUSTOMER_TAG_NAME_MAX + 1))).toBeTruthy();
    expect(customerTagNameError(' عمده ')).toBeNull();
    expect(customerTagNameKey('  Shop ')).toBe('shop');
  });

  it('gives an unknown colour the grey chip', () => {
    expect(tagColorClass('black')).toBe(tagColorClass('slate'));
    expect(tagColorClass('rose')).toContain('rose');
  });

  it('reads the tag list from the data envelope and drops broken rows', () => {
    const rows = tagRowsOf({ data: [{ id: 3, name: 'نمایشگاه', color: 'pink', version: 2, customerCount: 4 }, { name: 'بی شناسه' }] });
    expect(rows).toEqual([{ id: 3, name: 'نمایشگاه', color: 'slate', version: 2, customerCount: 4 }]);
  });

  it('sends the tag filter of the sales page as tagId', () => {
    expect(buildLeadQueryParams({ filterTag: '7' }).get('tagId')).toBe('7');
    expect(buildLeadQueryParams({}).has('tagId')).toBe(false);
  });
});

describe('customer tag components (N-02 part 3)', () => {
  it('shows the chips of a party', () => {
    render(<CustomerTagChips tags={TAGS} />);
    expect(screen.getByText('عمده‌فروش')).toBeTruthy();
    expect(screen.getByText('مغازه')).toBeTruthy();
  });

  it('filters by one tag and offers nothing when no tag exists', () => {
    const onChange = vi.fn();
    const { rerender, container } = render(<CustomerTagFilter tags={[]} value={null} onChange={onChange} />);
    expect(container.innerHTML).toBe('');
    rerender(<CustomerTagFilter tags={TAGS} value={null} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('برچسب'), { target: { value: '2' } });
    expect(onChange).toHaveBeenLastCalledWith(2);
    rerender(<CustomerTagFilter tags={TAGS} value={2} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('برچسب'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('toggles tags in the party form', () => {
    const onChange = vi.fn();
    render(<CustomerTagPicker tags={TAGS} selected={[1]} onChange={onChange} />);
    const wholesale = screen.getByRole('button', { name: 'عمده‌فروش' });
    expect(wholesale.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(wholesale);
    expect(onChange).toHaveBeenLastCalledWith([]);
    fireEvent.click(screen.getByRole('button', { name: 'مغازه' }));
    expect(onChange).toHaveBeenLastCalledWith([1, 2]);
  });

  it('renames a tag with its version and asks before deleting one in use', async () => {
    fetchJson.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === '/customers/tags' && !init?.method) return Promise.resolve({ data: [{ ...TAGS[0], version: 3, customerCount: 5 }] });
      return Promise.resolve({ success: true });
    });
    confirmAction.mockResolvedValue(false);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><CustomerTagsWindow onClose={() => undefined} /></QueryClientProvider>);

    const nameInput = await screen.findByLabelText('نام برچسب');
    const save = screen.getByRole('button', { name: 'ذخیره' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(nameInput, { target: { value: 'عمده' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(fetchJson).toHaveBeenCalledWith('/customers/tags/1', expect.objectContaining({ method: 'PUT' })));
    const put = fetchJson.mock.calls.find(([u, i]) => u === '/customers/tags/1' && i?.method === 'PUT');
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ name: 'عمده', color: 'emerald', version: 3 });

    fireEvent.click(screen.getByRole('button', { name: 'حذف برچسب عمده‌فروش' }));
    await waitFor(() => expect(confirmAction).toHaveBeenCalled());
    expect(String(confirmAction.mock.calls[0][0].message)).toContain('۵');
    expect(fetchJson.mock.calls.some(([, i]) => i?.method === 'DELETE')).toBe(false);
  });
});
