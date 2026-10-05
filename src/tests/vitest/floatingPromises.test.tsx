import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { copyToClipboard } from '../../utils/clipboard';
import { ErrorStateView } from '../../components/common/ErrorStateView';

// v8.0.46: Promise رهاشده (no-floating-promises) صفر شد و قاعده error است؛ کپی در کلیپ‌بورد شکست را گزارش می‌کند.
const setClipboard = (writeText: ((t: string) => Promise<void>) | undefined) =>
  Object.defineProperty(navigator, 'clipboard', { value: writeText ? { writeText } : undefined, configurable: true });

afterEach(() => { cleanup(); setClipboard(undefined); });

describe('copyToClipboard', () => {
  it('returns true when the browser copies the text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    expect(await copyToClipboard('abc')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('abc');
  });

  it('returns false instead of rejecting when the browser refuses or has no Clipboard API', async () => {
    setClipboard(vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')));
    expect(await copyToClipboard('abc')).toBe(false);
    setClipboard(undefined);
    expect(await copyToClipboard('abc')).toBe(false);
  });
});

describe('copy feedback follows the real clipboard result', () => {
  const openDetails = () => {
    render(<ErrorStateView error={new Error('boom')} />);
    fireEvent.click(screen.getByText('مشاهده جزئیات فنی خطا (ویژه پشتیبانی)'));
    return screen.getByTitle('کپی کردن متن خطا');
  };

  it('shows the copied mark only after a successful copy', async () => {
    setClipboard(vi.fn().mockResolvedValue(undefined));
    const button = openDetails();
    fireEvent.click(button);
    await waitFor(() => expect(button.querySelector('.lucide-check')).not.toBeNull());
  });

  it('keeps the copy icon when the copy fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    setClipboard(writeText);
    const button = openDetails();
    fireEvent.click(button);
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    await new Promise(r => setTimeout(r, 0));
    expect(button.querySelector('.lucide-check')).toBeNull();
    expect(button.querySelector('.lucide-copy')).not.toBeNull();
  });
});

describe('no-floating-promises gate', () => {
  it('is an error in browser, server and script files so the ratchet rejects any new floating promise', async () => {
    const { ESLint } = await import('eslint');
    const eslint = new ESLint({ cwd: process.cwd() });
    for (const file of ['src/pages/Dashboard.tsx', 'src/hooks/queries/useSettingsQueries.ts', 'server.ts', 'scripts/eslint-ratchet.ts']) {
      const config = await eslint.calculateConfigForFile(file) as { rules?: Record<string, unknown> };
      const rule = config.rules?.['@typescript-eslint/no-floating-promises'];
      expect(Array.isArray(rule) ? rule[0] : rule, file).toBe(2);
    }
  });
});
