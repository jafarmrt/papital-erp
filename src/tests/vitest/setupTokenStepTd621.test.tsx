import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { fetchJsonMock } = vi.hoisted(() => ({ fetchJsonMock: vi.fn() }));
vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn(), success: vi.fn() }, default: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../api', async (orig) => ({ ...(await orig<typeof import('../../api')>()), fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));

import SetupPage from '../../pages/SetupPage';

// v9.0.363 (TD-621, B01-41): step 1 of the setup wizard needs the setup token, and a wrong token (401 from POST /setup)
// takes the wizard back to step 1 with the error under the token field. On v9.0.362 step 1 moved on with a blank token
// and the 401 was shown on step 2, which has no token field. The password half (8 characters, as the server asks) was
// fixed by TD-532 (v9.0.217) and is kept here as a guard.

afterEach(() => { cleanup(); fetchJsonMock.mockReset(); });

const WRONG_TOKEN = 'رمز راه‌اندازی نادرست است';
const ALREADY_DONE = 'سامانه پیش‌تر راه‌اندازی شده است.';
const serverError = (message: string, status: number) => Object.assign(new Error(message), { status });

const tokenInput = () => screen.getAllByRole('textbox')[0] as HTMLInputElement;
const fill = (placeholder: string, value: string, index = 0) => {
  fireEvent.change(screen.getAllByPlaceholderText(placeholder)[index], { target: { value } });
};
const fillStep1 = (token: string, password = 'abcd12345678') => {
  fireEvent.change(tokenInput(), { target: { value: token } });
  fill('مثال: علی رضایی', 'مدیر آزمون');
  fill('••••••••', password, 0);
  fill('••••••••', password, 1);
  fireEvent.click(screen.getByText(/گام بعدی/));
};
const onStep2 = () => !!screen.queryByText(/اطلاعات فروشگاه \/ شرکت جهت درج/);

async function submitStep2() {
  await screen.findByText(/اطلاعات فروشگاه \/ شرکت جهت درج/);
  fill('مثال: فروشگاه مرکزی انبار', 'کارگاه آزمون');
  fireEvent.click(screen.getByText(/تکمیل و ورود به سامانه/));
}

describe('setup wizard step 1 (TD-621)', () => {
  it('keeps a password shorter than the server minimum on step 1', () => {
    render(<SetupPage onLogin={vi.fn()} />);
    fillStep1('test_setup_token_at_least_16_chars_long', 'abc1234');
    expect(onStep2()).toBe(false);
  });

  it('needs the setup token before step 2', () => {
    render(<SetupPage onLogin={vi.fn()} />);
    fillStep1('   ');
    expect(onStep2()).toBe(false);
    expect(screen.getByRole('alert').textContent).toBe('رمز راه‌اندازی را وارد کنید.');
    expect(tokenInput().getAttribute('aria-invalid')).toBe('true');
  });

  it('shows a wrong token under the token field on step 1 and keeps what was typed', async () => {
    fetchJsonMock.mockRejectedValue(serverError(WRONG_TOKEN, 401));
    render(<SetupPage onLogin={vi.fn()} />);
    fillStep1('wrong-token-value-123');
    await submitStep2();
    await waitFor(() => expect(onStep2()).toBe(false));
    expect(screen.getByRole('alert').textContent).toBe(WRONG_TOKEN);
    expect(tokenInput().value).toBe('wrong-token-value-123');
    expect(tokenInput().getAttribute('aria-describedby')).toBe('setup-token-error');
    expect((screen.getByPlaceholderText('مثال: علی رضایی') as HTMLInputElement).value).toBe('مدیر آزمون');
    fireEvent.change(tokenInput(), { target: { value: 'test_setup_token_at_least_16_chars_long' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps any other server error on step 2', async () => {
    fetchJsonMock.mockRejectedValue(serverError(ALREADY_DONE, 400));
    render(<SetupPage onLogin={vi.fn()} />);
    fillStep1('test_setup_token_at_least_16_chars_long');
    await submitStep2();
    expect(await screen.findByText(ALREADY_DONE)).toBeTruthy();
    expect(onStep2()).toBe(true);
  });
});
