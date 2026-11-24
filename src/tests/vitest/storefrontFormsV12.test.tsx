import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { FormDetail, FormList } from '../../lib/storefront/storefrontFormContracts';
import { contactFormTemplate, type FormValues } from '../../lib/storefront/storefrontFormRules';

/**
 * v12 phase 10f (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2 «۱۰و»): «فرم‌های سایت» in the ERP: the list with each
 * form's state, a new form from «فرم تماس», the editor (fields added, moved and removed; the rules run before a save;
 * a save under the version the screen read), the switch that puts a saved form on the site, the removal, and the
 * screen for a holder of the view key alone.
 */
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ API_URL: '/api', fetchJson: (...args: unknown[]) => fetchJson(...(args as [])), isAbortError: () => false }));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});
const permissions = vi.hoisted(() => ({ current: [] as string[] }));
vi.mock('../../contexts/AuthContext', async () => {
  const actual = await vi.importActual<typeof import('../../contexts/AuthContext')>('../../contexts/AuthContext');
  return { ...actual, useHasPermission: (key: string) => permissions.current.includes(key) };
});

const StorefrontFormsPage = (await import('../../pages/StorefrontFormsPage')).default;

const CONTACT: FormValues = { key: 'contact', title: 'تماس با ما', ...contactFormTemplate() };
const detailOf = (over: Partial<FormDetail> = {}): FormDetail => ({
  id: 3, key: CONTACT.key, title: CONTACT.title, enabled: false, fieldCount: CONTACT.fields.length, updatedAt: '2026-11-24T08:00:00.000Z', updatedBy: 'owner', version: 4, form: CONTACT, ...over,
});
const LIST: FormList = {
  data: [{ id: 3, key: 'contact', title: 'تماس با ما', enabled: true, fieldCount: 5, updatedAt: '', updatedBy: '', version: 4 }, { id: 4, key: 'survey', title: 'نظرسنجی', enabled: false, fieldCount: 0, updatedAt: '', updatedBy: '', version: 1 }],
  max: 50,
};

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
  permissions.current = [];
});

type Call = [string, { method?: string; body?: string } | undefined];
const sent = (method: string) => (fetchJson.mock.calls as Call[]).filter(([, init]) => init?.method === method).map(([url, init]) => ({ url, body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null }));

function open(at: string, detail: FormDetail = detailOf(), list: FormList = LIST) {
  let current = detail;
  fetchJson.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    if (url === '/storefront/forms' && !init) return list;
    if (url === '/storefront/forms' && init?.method === 'POST') return { data: detailOf({ id: 9, key: String(body.key), title: String(body.title) }) };
    if (url === `/storefront/forms/${detail.id}` && !init) return { data: current };
    if (url === `/storefront/forms/${detail.id}` && init?.method === 'PUT') {
      const { version, ...form } = body as unknown as FormValues & { version: number };
      current = { ...current, form, title: form.title, key: form.key, fieldCount: form.fields.length, version: version + 1 };
      return { data: current };
    }
    if (url === `/storefront/forms/${detail.id}/enabled` && init?.method === 'PUT') {
      current = { ...current, enabled: body.enabled === true, version: Number(body.version) + 1 };
      return { data: current };
    }
    if (url.startsWith(`/storefront/forms/${detail.id}?version=`) && init?.method === 'DELETE') return { success: true };
    throw new Error(`unexpected call ${init?.method ?? 'GET'} ${url}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[at]}><StorefrontFormsPage /></MemoryRouter></QueryClientProvider>);
  return {
    /** a colleague saves the form elsewhere, and this screen reads it again */
    colleagueSaves: async (title: string) => {
      current = { ...current, title, form: { ...current.form, title }, version: current.version + 1 };
      await client.invalidateQueries();
    },
  };
}
const fieldsOnScreen = () => within(screen.getByRole('region', { name: 'فیلدهای فرم' })).getAllByRole('listitem').map(li => li.getAttribute('aria-label'));
const saveButton = () => screen.getByRole('button', { name: 'ذخیرهٔ فرم' }) as HTMLButtonElement;
const siteSwitch = () => screen.getByRole('checkbox', { name: 'این فرم روی سایت باشد' }) as HTMLInputElement;

describe('the screen of the forms of the site', () => {
  it('lists the forms with their state, and makes a new one from the contact form template', async () => {
    permissions.current = ['site_content.manage'];
    open('/site-forms');
    const list = await screen.findByRole('list', { name: 'فرم‌ها' });
    expect(within(list).getAllByRole('listitem').map(li => li.textContent)).toEqual([expect.stringContaining('تماس با ما'), expect.stringContaining('نظرسنجی')]);
    expect(within(list).getByText('روی سایت')).toBeTruthy();
    expect(within(list).getByText('خاموش')).toBeTruthy();
    expect(within(list).getByText('۵ فیلد')).toBeTruthy();
    const create = screen.getByRole('form', { name: 'فرم تازه' });
    const make = within(create).getByRole('button', { name: 'ساختن فرم' }) as HTMLButtonElement;
    expect(make.disabled).toBe(true);
    fireEvent.change(within(create).getByLabelText('عنوان فرم'), { target: { value: 'همکاری' } });
    fireEvent.change(within(create).getByLabelText('نام لاتین'), { target: { value: 'Work With Us' } });
    // the rule the server checks with says so before anything is sent
    expect(within(create).getByRole('alert').textContent).toContain('نام لاتین فرم');
    expect(make.disabled).toBe(true);
    fireEvent.change(within(create).getByLabelText('نام لاتین'), { target: { value: 'work-with-us' } });
    fireEvent.click(make);
    await waitFor(() => expect(sent('POST')).toEqual([{ url: '/storefront/forms', body: { title: 'همکاری', key: 'work-with-us', template: 'contact' } }]));
  });

  it('adds, moves and removes fields, checks them, and saves under the version it read', async () => {
    permissions.current = ['site_content.manage'];
    open('/site-forms?form=3');
    await screen.findByRole('region', { name: 'فیلدهای فرم' });
    expect(fieldsOnScreen()).toEqual(['فیلد ۱، متن کوتاه', 'فیلد ۲، شمارهٔ همراه', 'فیلد ۳، ایمیل', 'فیلد ۴، متن کوتاه', 'فیلد ۵، متن بلند']);
    expect(saveButton().disabled).toBe(true);
    // a new choice: without a name and options the form is not saved, and the screen says why
    fireEvent.change(screen.getByLabelText('فیلد تازه'), { target: { value: 'choice' } });
    fireEvent.click(screen.getByRole('button', { name: 'افزودن فیلد' }));
    expect(fieldsOnScreen()[5]).toBe('فیلد ۶، یک انتخاب');
    expect(screen.getByRole('alert').textContent).toContain('فیلد ۶');
    expect(saveButton().disabled).toBe(true);
    const added = screen.getByRole('listitem', { name: 'فیلد ۶، یک انتخاب' });
    fireEvent.change(within(added).getByLabelText('عنوان فیلد'), { target: { value: 'چگونه با ما آشنا شدید؟' } });
    fireEvent.change(within(added).getByLabelText('گزینهٔ ۱ فیلد ۶'), { target: { value: 'اینستاگرام' } });
    fireEvent.change(within(added).getByLabelText('گزینهٔ ۲ فیلد ۶'), { target: { value: 'دوستان' } });
    expect(screen.queryByRole('alert')).toBeNull();
    // it moves up one place, and the subject field goes
    fireEvent.click(screen.getByRole('button', { name: 'فیلد ۶، یک انتخاب: بالا' }));
    fireEvent.click(screen.getByRole('button', { name: 'حذف فیلد ۴، متن کوتاه' }));
    expect(fieldsOnScreen()).toEqual(['فیلد ۱، متن کوتاه', 'فیلد ۲، شمارهٔ همراه', 'فیلد ۳، ایمیل', 'فیلد ۴، یک انتخاب', 'فیلد ۵، متن بلند']);
    // the switch waits for the save
    expect(siteSwitch().disabled).toBe(true);
    fireEvent.click(saveButton());
    await waitFor(() => expect(sent('PUT')).toHaveLength(1));
    const [{ url, body }] = sent('PUT');
    expect(url).toBe('/storefront/forms/3');
    expect(body?.version).toBe(4);
    expect((body?.fields as Array<{ id: string; kind: string }>).map(f => `${f.id}:${f.kind}`)).toEqual(['f1:shortText', 'f2:mobile', 'f3:email', 'f6:choice', 'f5:longText']);
    expect((body?.fields as Array<{ options: string[] }>)[3].options).toEqual(['اینستاگرام', 'دوستان']);
    // the next request goes under the version the save returned
    await waitFor(() => expect(siteSwitch().disabled).toBe(false));
    fireEvent.click(siteSwitch());
    await waitFor(() => expect(sent('PUT')).toHaveLength(2));
    expect(sent('PUT')[1]).toEqual({ url: '/storefront/forms/3/enabled', body: { enabled: true, version: 5 } });
    await waitFor(() => expect(siteSwitch().checked).toBe(true));
    // on the site its Latin name is fixed
    expect((screen.getByLabelText('نام لاتین') as HTMLInputElement).disabled).toBe(true);
  });

  it('keeps unsaved edits beside a colleague\'s newer version, and reads that version once the edits are gone', async () => {
    permissions.current = ['site_content.manage'];
    const { colleagueSaves } = open('/site-forms?form=3');
    const title = await screen.findByLabelText('عنوان فرم') as HTMLInputElement;
    fireEvent.change(title, { target: { value: 'عنوان من' } });
    await colleagueSaves('عنوان همکار');
    const banner = await screen.findByText(/همکار دیگری این فرم را در همین فاصله عوض کرده است/);
    // my words stay, and nothing of mine is sent over the colleague's version
    expect(title.value).toBe('عنوان من');
    expect(saveButton().disabled).toBe(true);
    expect(banner).toBeTruthy();
    // I take my edit back by hand: nothing is unsaved, so the screen reads the newer version and works again
    fireEvent.change(title, { target: { value: 'تماس با ما' } });
    await waitFor(() => expect((screen.getByLabelText('عنوان فرم') as HTMLInputElement).value).toBe('عنوان همکار'));
    expect(screen.queryByText(/همکار دیگری این فرم را/)).toBeNull();
    expect(siteSwitch().disabled).toBe(false);
    fireEvent.click(siteSwitch());
    await waitFor(() => expect(sent('PUT')).toEqual([{ url: '/storefront/forms/3/enabled', body: { enabled: true, version: 5 } }]));
  });

  it('sends a save once, however it is started twice', async () => {
    permissions.current = ['site_content.manage'];
    open('/site-forms?form=3');
    const title = await screen.findByLabelText('عنوان فرم');
    fireEvent.change(title, { target: { value: 'تماس تازه' } });
    const form = title.closest('form') as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(sent('PUT')).toHaveLength(1));
    await waitFor(() => expect(saveButton().disabled).toBe(true));
    expect(sent('PUT')).toHaveLength(1);
  });

  it('does not offer the site a form with nothing to fill in, and asks before a removal', async () => {
    permissions.current = ['site_content.manage'];
    open('/site-forms?form=3', detailOf({ form: { ...CONTACT, fields: [] }, fieldCount: 0 }));
    await screen.findByText(/این فرم هنوز فیلدی ندارد/);
    expect(siteSwitch().disabled).toBe(true);
    expect(screen.getByRole('region', { name: 'فرم روی سایت' }).textContent).toContain('دست‌کم یک فیلد بسازید');
    fireEvent.click(screen.getByRole('button', { name: 'حذف فرم' }));
    expect(sent('DELETE')).toHaveLength(0);
    fireEvent.click(within(screen.getByRole('group', { name: 'تأیید حذف فرم' })).getByRole('button', { name: 'بله، حذف شود' }));
    await waitFor(() => expect(sent('DELETE').map(call => call.url)).toEqual(['/storefront/forms/3?version=4']));
  });

  it('shows a holder of the view key the form, with nothing to change it by', async () => {
    permissions.current = [];
    open('/site-forms?form=3', detailOf({ enabled: true }));
    await screen.findByRole('region', { name: 'فیلدهای فرم' });
    expect((screen.getByLabelText('عنوان فرم').closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
    for (const name of ['ذخیرهٔ فرم', 'حذف فرم', 'افزودن فیلد']) expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'این فرم روی سایت باشد' })).toBeNull();
    expect(screen.getAllByText('روی سایت').length).toBeGreaterThan(0);
  });
});
