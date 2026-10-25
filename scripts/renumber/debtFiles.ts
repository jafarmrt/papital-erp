/**
 * v11.0.4 (sub-phase 1.3): where closed debt rows live. Kept under scripts/renumber/ so a branch that takes this
 * command's code (`git checkout <ref> -- scripts/release-renumber.ts scripts/renumber`) gets the paths too.
 */

/** Debt rows closed since series 11, with the debt lessons (replaces TECH_DEBT_ARCHIVE.md). */
export const CLOSED_DEBT_FILE = 'docs/rules/DEBT_LESSONS.md';
/** The rows closed up to series 10, frozen; read only so an id is never used twice and the closed count stays whole. */
export const FROZEN_DEBT_ARCHIVE = 'docs/rules/archive/TECH_DEBT_ARCHIVE_V10.md';
/** Rows the frozen archive holds; a closed row written there by an old branch's merge makes it grow. */
export const FROZEN_DEBT_ROWS = 1123;
