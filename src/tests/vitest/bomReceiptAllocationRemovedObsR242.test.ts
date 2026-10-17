import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

// v10.1.63 (OBS-R2-42, decision ت۴۰ item 17): the allocation-from-receipt path had no route or screen and was removed;
// materials are allocated to a project from stock only, with allocateMaterialsForProject.
function productionFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === 'tests' || name === 'changelogs') continue;
      out.push(...productionFiles(path));
    } else if (/\.tsx?$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

describe('OBS-R2-42: no allocation from a receipt', () => {
  it('no production file names the removed allocation-from-receipt path', () => {
    const offenders = productionFiles('src').filter(file => {
      const text = readFileSync(file, 'utf8');
      return /allocateReceiptItemsForProjectBom|BomReceiptAllocation|bomReceiptAllocation|RECEIPT_ALLOCATED/.test(text);
    });
    expect(offenders).toEqual([]);
  });
});
