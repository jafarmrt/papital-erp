import fs from 'fs';
import path from 'path';

/**
 * v9.0.180 (TD-588): what `vite build` copies from `public/` into `dist/`. `public/uploads/` holds the only copy of
 * the attachment files (AGENTS §10) and the uploaded images; it is served by the app from `public/uploads`, so a
 * copy in `dist/` only doubled the disk use, slowed every build and kept deleted attachments out of reach of the
 * cleanup and the backup.
 */
export const PUBLIC_DIRS_NOT_COPIED = ['uploads'];

/** Copies `publicDir` into `outDir` without the directories above; returns the number of files copied */
export function copyPublicAssets(publicDir: string, outDir: string): number {
  if (!fs.existsSync(publicDir)) return 0;
  let files = 0;
  fs.cpSync(publicDir, outDir, {
    recursive: true,
    filter: (src: string) => {
      const rel = path.relative(publicDir, src);
      if (rel === '') return true;
      if (PUBLIC_DIRS_NOT_COPIED.includes(rel.split(path.sep)[0])) return false;
      if (fs.statSync(src).isFile()) files++;
      return true;
    },
  });
  return files;
}
