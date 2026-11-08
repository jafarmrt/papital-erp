import 'dotenv/config';
import { pool } from '../src/db/drizzle.js';
import { repairItemCovers } from '../src/services/media/mediaCoverRepair.service.js';

/**
 * v12 phase 7: marks the library cover of items whose featured image was chosen from the library but never marked
 * (src/services/media/mediaCoverRepair.service.ts). Terminal output is English (AGENTS.md §1.8).
 *   npm run media:cover-repair             dry run: counts and lists, nothing changes
 *   npm run media:cover-repair -- --apply  marks the covers, one audit row per changed file
 */
async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const report = await repairItemCovers({ apply });
  console.log(apply ? 'Marking library covers' : 'Dry run (nothing changed). To mark: npm run media:cover-repair -- --apply');
  console.log(`   Items with library photos and no cover: ${report.withPhotosNoCover} (the site shows their first photo)`);
  console.log(`   Covers known from the featured-image history: ${report.markable.length}${apply ? `, marked in this run ${report.markedNow}` : ''}`);
  for (const row of report.markable.slice(0, 50)) console.log(`     item ${row.code} (id ${row.itemId}) <- library file ${row.assetId}`);
  console.log(`   Items whose picture is not in the library (the site cannot show it): ${report.pictureOutsideLibrary.length}`);
  for (const row of report.pictureOutsideLibrary.slice(0, 50)) console.log(`     item ${row.code} (id ${row.itemId})`);
  if (report.pictureOutsideLibrary.length > 50) console.log(`     ... and ${report.pictureOutsideLibrary.length - 50} more`);
}

main()
  .catch((err) => {
    console.error(`Cover repair failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
