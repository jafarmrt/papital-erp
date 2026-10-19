import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';

type FetchOpts = { method?: string; body?: string; signal?: AbortSignal };
const puts: Array<Record<string, unknown>> = [];
const fetchJson = vi.fn(async (url: string, opts?: FetchOpts) => {
  if (opts?.method === 'PUT') {
    puts.push(JSON.parse(opts.body ?? '{}') as Record<string, unknown>);
    return { id: 1, version: 9, partTokens: { status: TOKEN_C } };
  }
  return null;
});
vi.mock('../../api', () => ({ fetchJson: (url: string, opts?: FetchOpts) => fetchJson(url, opts) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: vi.fn(async () => true) }));

import { useProjectVersion } from '../../hooks/useProjectVersion';
import {
  isPartBehind, projectPartConflictMessage, projectPartTokensOf, PROJECT_PARTS,
} from '../../lib/projects/projectParts';
import { removedLoggedScheduleRows, scheduleWithoutLogLinks } from '../../lib/projects/scheduleWorkLog';
import { ProjectStatusActions } from '../../components/project/ProjectStatusActions';

const TOKEN_A = 'a'.repeat(32);
const TOKEN_B = 'b'.repeat(32);
const TOKEN_C = 'c'.repeat(32);
const all = (token: string) => Object.fromEntries(PROJECT_PARTS.map(p => [p, token]));

// Persian text the screens show (kept in constants: terminal output stays English)
const PAUSE = 'توقف پروژه';
const TWO_PARTS = '«کنترل موجودی» و «برنامهٔ کارگاه» پروژه را کاربر دیگری تغییر داده؛ دوباره باز کنید.';

afterEach(() => { cleanup(); puts.length = 0; vi.clearAllMocks(); });

describe('project part tokens (TD-1342)', () => {
  it('keeps only well-formed tokens of known parts', () => {
    expect(projectPartTokensOf({ partTokens: { inventory: TOKEN_A, status: 'xyz', other: TOKEN_B } })).toEqual({ inventory: TOKEN_A });
    expect(projectPartTokensOf({ partTokens: [TOKEN_A] })).toBeUndefined();
    expect(projectPartTokensOf({ partTokens: { status: 12 } })).toBeUndefined();
    expect(projectPartTokensOf(null)).toBeUndefined();
  });

  it('names the parts that changed in the conflict message', () => {
    expect(projectPartConflictMessage(['inventory', 'schedule'])).toBe(TWO_PARTS);
  });

  it('compares a part by its token and falls back to the version without one', () => {
    const base = { version: 4, partTokens: { inventory: TOKEN_A } };
    expect(isPartBehind(base, 'inventory', { version: 7, token: TOKEN_A })).toBe(false);
    expect(isPartBehind(base, 'inventory', { version: 4, token: TOKEN_B })).toBe(true);
    expect(isPartBehind({ version: 4 }, 'inventory', { version: 7, token: TOKEN_A })).toBe(true);
    expect(isPartBehind({ version: 4 }, 'inventory', { version: 4 })).toBe(false);
  });

  it('leaves the work log links out of the schedule part and finds a removed logged row', () => {
    const saved = { 5: { p: { productId: 'p', tasks: [{ id: 'r1', quantity: 2, pieceworkLogId: 70 }, { id: 'r2', quantity: 3 }] } } };
    expect(scheduleWithoutLogLinks(saved)).toEqual({ 5: { p: { productId: 'p', tasks: [{ id: 'r1', quantity: 2 }, { id: 'r2', quantity: 3 }] } } });
    const incoming = { 5: { p: { productId: 'p', tasks: [{ id: 'r2', quantity: 4 }] } } };
    expect(removedLoggedScheduleRows(incoming, saved)).toEqual([{ stageKey: '5', productId: 'p', rowId: 'r1' }]);
    // removing a row nobody logged is the tab's own change, not a conflict
    expect(removedLoggedScheduleRows({ 5: { p: { productId: 'p', tasks: [{ id: 'r1' }] } } }, saved)).toEqual([]);
  });
});

describe('the version hook keeps the part tokens (TD-1342)', () => {
  it('sends the tokens of whichever source is newest and keeps them over an answer without any', () => {
    const { result, rerender } = renderHook(({ project }) => useProjectVersion(project), {
      initialProps: { project: { id: 1, version: 2, partTokens: all(TOKEN_A) } as { id: number; version: number; partTokens?: Record<string, string> } },
    });
    expect(result.current.writeBase).toEqual({ version: 2, partTokens: all(TOKEN_A) });
    const first = result.current.writeBase;
    rerender({ project: { id: 1, version: 2, partTokens: all(TOKEN_A) } });
    expect(result.current.writeBase).toBe(first);
    act(() => result.current.remember({ id: 1, version: 3, partTokens: all(TOKEN_B) }, PROJECT_PARTS));
    expect(result.current.writeBase).toEqual({ version: 3, partTokens: all(TOKEN_B) });
    act(() => result.current.remember({ id: 1, version: 4 }, PROJECT_PARTS));
    expect(result.current.writeBase).toEqual({ version: 4, partTokens: all(TOKEN_B) });
    // the reloaded record is newer than any answer: its tokens win
    rerender({ project: { id: 1, version: 6, partTokens: all(TOKEN_C) } });
    expect(result.current.writeBase).toEqual({ version: 6, partTokens: all(TOKEN_C) });
    // a record without tokens sends the version only, the old rule
    rerender({ project: { id: 2, version: 1 } });
    expect(result.current.writeBase).toEqual({ version: 1 });
  });

  it('takes from a save answer only the tokens of the parts that save wrote (review N2)', () => {
    const TOKEN_D = 'd'.repeat(32);
    const TOKEN_E = 'e'.repeat(32);
    const { result, rerender } = renderHook(({ project }) => useProjectVersion(project), {
      initialProps: { project: { id: 1, version: 2, partTokens: all(TOKEN_A) } },
    });
    // a status save answered every part of version 5, two of them changed by others; the page still shows version 2 there
    act(() => result.current.remember({ id: 1, version: 5, partTokens: all(TOKEN_B) }, ['status']));
    expect(result.current.writeBase).toEqual({ version: 5, partTokens: { ...all(TOKEN_A), status: TOKEN_B } });
    act(() => result.current.remember({ id: 1, version: 6, partTokens: all(TOKEN_C) }, ['inventory']));
    expect(result.current.writeBase).toEqual({ version: 6, partTokens: { ...all(TOKEN_A), status: TOKEN_B, inventory: TOKEN_C } });
    // a read only moves the version
    act(() => result.current.remember({ id: 1, version: 7, partTokens: all(TOKEN_D) }, []));
    expect(result.current.writeBase).toEqual({ version: 7, partTokens: { ...all(TOKEN_A), status: TOKEN_B, inventory: TOKEN_C } });
    // the page reloaded the project: its tokens are what the page shows, and earlier answers no longer count
    rerender({ project: { id: 1, version: 7, partTokens: all(TOKEN_E) } });
    expect(result.current.writeBase).toEqual({ version: 7, partTokens: all(TOKEN_E) });
    act(() => result.current.remember({ id: 1, version: 8, partTokens: all(TOKEN_D) }, ['schedule']));
    expect(result.current.writeBase).toEqual({ version: 8, partTokens: { ...all(TOKEN_E), schedule: TOKEN_D } });
  });

  it('the status buttons send the tokens they were built from', async () => {
    render(<ProjectStatusActions projectId={1} status="in_progress" writeBase={{ version: 5, partTokens: { status: TOKEN_A } }} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: PAUSE }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ status: 'paused', version: 5, partTokens: { status: TOKEN_A } });
  });
});
