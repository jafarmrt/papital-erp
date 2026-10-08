import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ConfirmModal, { CONFIRM_LAYER_CLASS } from '../../components/ConfirmModal';

// v10.0.1 (TD-1040): the confirmation dialog (confirmAction) opened under the payslip payment window (z-[90]),
// so «ثبت تسویه کامل» could not be confirmed. A confirmation stacks above every full-screen window of the app.

const ROOT = join(__dirname, '..', '..');
const ABOVE_CONFIRM_ALLOWED = new Set(['components/common/SystemStartingOverlay.tsx']);
const CONFIRM_MESSAGE = 'پیام تأیید آزمون';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'tests' ? [] : sourceFiles(path);
    return name.endsWith('.tsx') ? [path] : [];
  });
}

const layerOf = (className: string): number => {
  const match = className.match(/(?:^|\s)z-(?:\[(\d+)\]|(\d+))(?:\s|$)/);
  return match ? Number(match[1] ?? match[2]) : 0;
};

describe('confirmation layer (TD-1040)', () => {
  it('renders the confirmation backdrop on the confirmation layer', () => {
    render(<ConfirmModal isOpen message={CONFIRM_MESSAGE} onConfirm={() => undefined} onCancel={() => undefined} />);
    const backdrop = screen.getByRole('dialog');
    expect(backdrop.className.split(/\s+/)).toContain(CONFIRM_LAYER_CLASS);
  });

  it('stacks the confirmation above every full-screen window of the app', () => {
    const confirmLayer = layerOf(CONFIRM_LAYER_CLASS);
    const above: string[] = [];
    for (const file of sourceFiles(ROOT)) {
      const rel = relative(ROOT, file).replace(/\\/g, '/');
      if (ABOVE_CONFIRM_ALLOWED.has(rel)) continue;
      for (const overlay of readFileSync(file, 'utf8').match(/fixed inset-0[^"'`]*/g) ?? []) {
        if (layerOf(overlay) >= confirmLayer) above.push(`${rel}: ${overlay}`);
      }
    }
    expect(confirmLayer).toBeGreaterThan(90);
    expect(above).toEqual([]);
  });
});
