import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn(), success: vi.fn() }, default: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../api', async (orig) => ({ ...(await orig<typeof import('../../api')>()), fetchJson: vi.fn() }));

import SetupPage from '../../pages/SetupPage';

// OBS-R1-13 (TD-983), v10.0.265: the setup token is typed into the form, never read from the address. On v10.0.262 the
// wizard filled the field from `?token=` / `?setupToken=`, so the token stayed in the browser history and proxy logs;
// now the field starts empty and the parameter is removed from the address bar.

afterEach(() => { cleanup(); window.history.replaceState(null, '', '/'); });

const tokenInput = () => screen.getAllByRole('textbox')[0] as HTMLInputElement;

describe('setup token stays out of the address (OBS-R1-13)', () => {
  it.each(['token', 'setupToken'])('does not take ?%s= and removes it from the address bar', (param) => {
    window.history.replaceState(null, '', `/setup?${param}=leaked-setup-token-123&step=1`);
    render(<SetupPage onLogin={vi.fn()} />);
    expect(tokenInput().value).toBe('');
    expect(window.location.search).not.toContain('leaked-setup-token-123');
    expect(window.location.search).toContain('step=1');
  });
});
