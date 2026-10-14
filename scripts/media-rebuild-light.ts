import 'dotenv/config';
import { pool } from '../src/db/drizzle.js';
import { MediaLightRebuildService } from '../src/services/media/mediaLightRebuild.js';
import { terminalLine } from '../src/lib/terminalText.js';

/**
 * v10.1.2 (N-05 PR 4): makes the light versions and thumbnails of the media library's images again.
 *   npm run media:rebuild-light                  preview: lists the images whose light version is missing or failed
 *   npm run media:rebuild-light -- --apply       builds them
 *   npm run media:rebuild-light -- --all --apply builds every live image again (after a change of the light size)
 * The originals are only read. The health page shows how many images still need it.
 */
async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const scope = process.argv.includes('--all') ? 'all' : 'missing';
  const outcome = await MediaLightRebuildService.rebuild({ apply, scope, actor: 'cli:media-rebuild-light' });
  if (!outcome.acquired) {
    console.error('Another light rebuild is running; try again when it ends.');
    process.exitCode = 2;
    return;
  }
  const r = outcome.report;
  console.log(apply ? 'Light rebuild done' : 'Preview (no changes); to build them: npm run media:rebuild-light -- --apply');
  console.log(`   Live images checked: ${r.checkedImages}`);
  console.log(`   ${scope === 'all' ? 'Contents to rebuild (all)' : 'Contents missing a light version'}: ${r.candidates} (${r.candidateAssets} files)`);
  if (apply) console.log(`   Rebuilt: ${r.rebuilt}`);
  if (r.failures.length > 0) {
    console.error(`${r.failures.length} contents failed:`);
    for (const f of r.failures) console.error(terminalLine(`   - files ${f.assetIds.join(', ')}: ${f.error}`));
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(terminalLine(`${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
  })
  .finally(() => pool.end());
