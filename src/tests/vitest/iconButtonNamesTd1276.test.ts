/**
 * Every icon-only button has a spoken name (v10.1.27, TD-1276, Vibe Farsi package 3b).
 */
import { describe, expect, it } from 'vitest';
import { repositoryUnnamedIconButtons, unnamedIconButtonsOfSource } from '../../../scripts/icon-button-names';

const PROBE = `
export const Probe = ({ onClose, name }: { onClose: () => void; name: string }) => (
  <div>
    <button onClick={onClose}><X size={18} /></button>
    <button aria-label="بستن" onClick={onClose}><X size={18} /></button>
    <button title="حذف"><Trash2 /></button>
    <button><X /> بستن</button>
    <button><span>{name}</span></button>
    <button><SafeImage src="a.png" alt={name} /></button>
    <button className="p-1"><ChevronLeft className="w-4" /><ChevronLeft /></button>
  </div>
);
`;

describe('icon_button_names_td_1276', () => {
  it('the scanner finds icon-only buttons without a name and accepts named ones', () => {
    const found = unnamedIconButtonsOfSource(PROBE, 'src/components/Probe.tsx');
    expect(found.map((site) => `${site.line} ${site.icons}`)).toEqual(['4 X', '10 ChevronLeft+ChevronLeft']);
  });

  it('no icon-only button in the browser code is left without a Persian name', () => {
    const found = repositoryUnnamedIconButtons();
    expect(found.map((site) => `${site.file}:${site.line} ${site.icons}`)).toEqual([]);
  }, 60_000);
});
