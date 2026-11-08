import 'dotenv/config';
import { pool } from '../src/db/drizzle.js';
import { repairItemCovers } from '../src/services/media/mediaCoverRepair.service.js';
import { liveLinks } from '../src/services/woocommerce/wcCatalog.service.js';
import { imagePushSettings } from '../src/services/woocommerce/wcImagePush.service.js';

/**
 * v12 phase 7: marks the library cover of items whose featured image was chosen from the library but never marked
 * (src/services/media/mediaCoverRepair.service.ts). Terminal output is English (AGENTS.md §1.8).
 *   npm run media:cover-repair             dry run: counts and lists, nothing changes
 *   npm run media:cover-repair -- --apply  marks the covers, one audit row per changed file
 * A newly marked cover is a new featured image for the WooCommerce push: while «ارسال تصویر شاخص» is on, the next pushes
 * replace the shop's featured image of each linked product (the dry run says how many).
 */
async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const report = await repairItemCovers({ apply });
  console.log(apply ? 'Marking library covers' : 'Dry run (nothing changed). To mark: npm run media:cover-repair -- --apply');
  console.log(`   Products with library photos and no cover: ${report.withPhotosNoCover} (the site shows their first photo)`);
  console.log(`   Covers known from the featured-image history: ${report.markable.length}${apply ? `, marked in this run ${report.markedNow}` : ''}`);
  for (const row of report.markable.slice(0, 50)) console.log(`     item ${row.code} (id ${row.itemId}) <- library file ${row.assetId}`);
  if (report.markable.length > 50) console.log(`     ... and ${report.markable.length - 50} more`);
  for (const row of report.skipped) console.log(`   Skipped item id ${row.itemId}: ${row.reason}`);
  const links = await liveLinks(report.markable.map(m => m.itemId));
  const push = await imagePushSettings();
  console.log(`   WooCommerce: ${links.length} of these products are linked to the shop; the featured-image push is ${push.enabled ? 'ON, so the next pushes replace their shop featured image' : 'off, so the shop is not changed'}`);
  console.log(`   Products whose picture is not in the library (the site cannot show it): ${report.pictureOutsideLibrary.length}`);
  for (const row of report.pictureOutsideLibrary.slice(0, 50)) console.log(`     item ${row.code} (id ${row.itemId})`);
  if (report.pictureOutsideLibrary.length > 50) console.log(`     ... and ${report.pictureOutsideLibrary.length - 50} more`);
}

main()
  .catch((err) => {
    console.error(`Cover repair failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
