/**
 * v11 (owner report 9 Aban 1405, blank white page in Firefox until Ctrl+Shift+R): the production server answers every
 * unknown path with the app page (index.html, 200) so the browser router can open it. A build file is not a page: a
 * chunk of an older version, asked for by a tab or a service worker that still runs that version, got the app page
 * back as «JavaScript». The module then failed to load with a MIME error instead of a clean 404, and the service
 * worker's cache-first rule for hashed build files (src/lib/pwa/pwaConfig.ts, 200 responses only) kept the HTML under
 * the chunk's name. A path this function names gets a 404 when the file is not in dist/.
 */
const BUILD_FILE_FOLDERS = /^\/(assets|fonts|pwa)\//;
const BUILD_FILE_EXTENSION = /\.(m?js|css|map|woff2?|ttf|webmanifest)$/i;

export function isBuildFilePath(requestPath: string): boolean {
  return BUILD_FILE_FOLDERS.test(requestPath) || BUILD_FILE_EXTENSION.test(requestPath);
}
